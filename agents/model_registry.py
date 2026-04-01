"""
Multi-model registry for local Ollama instances.

Discovers available models, lets users assign models to specific roles
(chat, analysis, embedding, screening), and handles fallback logic.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import requests

SETTINGS_PATH = Path(os.environ.get("USER_SETTINGS", "user_settings.json"))
OLLAMA_DEFAULT = "http://127.0.0.1:11434"

# ---------------------------------------------------------------------------
# Role definitions – each role can have a preferred model + fallback
# ---------------------------------------------------------------------------
ROLES = {
    "chat":       {"description": "General conversational assistant", "default": "llama3.1"},
    "analysis":   {"description": "Deep equity / macro analysis", "default": "llama3.1"},
    "embedding":  {"description": "Text embedding for RAG pipelines", "default": "nomic-embed-text"},
    "screening":  {"description": "Fast pattern scanning & alerts", "default": "llama3.1"},
    "coding":     {"description": "Code generation & tool planning", "default": "llama3.1"},
    "summarizer": {"description": "Quick headline / news summarisation", "default": "llama3.1"},
}


def _ollama_base() -> str:
    return os.environ.get("OLLAMA_HOST", OLLAMA_DEFAULT).rstrip("/")


# ---------------------------------------------------------------------------
# Discover models from Ollama
# ---------------------------------------------------------------------------
def list_available_models(ollama_base: str | None = None) -> list[dict]:
    """Query Ollama /api/tags and return [{name, size, modified_at, ...}]."""
    base = (ollama_base or _ollama_base()).rstrip("/")
    try:
        r = requests.get(f"{base}/api/tags", timeout=10)
        if r.status_code == 200:
            data = r.json()
            models = data.get("models") or []
            return [
                {
                    "name": m.get("name", ""),
                    "size": m.get("size", 0),
                    "modified_at": m.get("modified_at", ""),
                    "digest": m.get("digest", ""),
                    "parameter_size": m.get("details", {}).get("parameter_size", ""),
                    "family": m.get("details", {}).get("family", ""),
                    "quantization": m.get("details", {}).get("quantization_level", ""),
                }
                for m in models
            ]
        return []
    except Exception:
        return []


def check_ollama_health(ollama_base: str | None = None) -> dict:
    """Quick health check – returns {ok, version?, models_count, latency_ms}."""
    base = (ollama_base or _ollama_base()).rstrip("/")
    t0 = time.time()
    try:
        r = requests.get(f"{base}/api/tags", timeout=5)
        latency = int((time.time() - t0) * 1000)
        if r.status_code == 200:
            models = r.json().get("models") or []
            return {"ok": True, "models_count": len(models), "latency_ms": latency, "base_url": base}
        return {"ok": False, "error": f"HTTP {r.status_code}", "latency_ms": latency, "base_url": base}
    except requests.exceptions.ConnectionError:
        return {"ok": False, "error": "Cannot reach Ollama", "latency_ms": -1, "base_url": base}
    except Exception as e:
        return {"ok": False, "error": str(e), "latency_ms": -1, "base_url": base}


# ---------------------------------------------------------------------------
# Model-role assignment (persisted in user_settings.json)
# ---------------------------------------------------------------------------
def _load_settings() -> dict:
    try:
        return json.loads(SETTINGS_PATH.read_text()) if SETTINGS_PATH.exists() else {}
    except Exception:
        return {}


def _save_settings(data: dict) -> None:
    SETTINGS_PATH.write_text(json.dumps(data, indent=2))


def get_model_assignments() -> dict[str, dict]:
    """Return {role: {model, fallback, description}} for every role."""
    settings = _load_settings()
    saved = settings.get("ai_model_assignments") or {}
    out: dict[str, dict] = {}
    for role, meta in ROLES.items():
        entry = saved.get(role) or {}
        out[role] = {
            "model": entry.get("model") or meta["default"],
            "fallback": entry.get("fallback") or meta["default"],
            "description": meta["description"],
        }
    return out


def set_model_assignment(role: str, model: str, fallback: str | None = None) -> dict:
    """Assign a model to a role. Returns updated assignment."""
    if role not in ROLES:
        return {"ok": False, "error": f"Unknown role: {role}. Valid: {list(ROLES.keys())}"}
    settings = _load_settings()
    saved = settings.setdefault("ai_model_assignments", {})
    saved[role] = {
        "model": model,
        "fallback": fallback or ROLES[role]["default"],
    }
    _save_settings(settings)
    return {"ok": True, "role": role, **saved[role]}


def resolve_model(role: str, override: str | None = None, ollama_base: str | None = None) -> str:
    """
    Resolve which model to use for a given role.
    Priority: explicit override > user assignment > env var > role default.
    Validates the model is actually available in Ollama; falls back if not.
    """
    if override:
        return override

    assignments = get_model_assignments()
    entry = assignments.get(role, {})
    preferred = entry.get("model") or ROLES.get(role, {}).get("default", "llama3.1")

    # Quick validation – is the model loaded in Ollama?
    available = {m["name"] for m in list_available_models(ollama_base)}
    if not available:
        # Ollama unreachable – return preferred and hope for the best
        return preferred

    # Check exact match or prefix match (e.g. "llama3.1" matches "llama3.1:latest")
    if preferred in available:
        return preferred
    for avail_name in available:
        if avail_name.startswith(preferred):
            return avail_name

    # Preferred not found – try fallback
    fallback = entry.get("fallback") or preferred
    if fallback in available:
        return fallback
    for avail_name in available:
        if avail_name.startswith(fallback):
            return avail_name

    # Last resort – return first available
    return next(iter(available), preferred)


# ---------------------------------------------------------------------------
# Multi-Ollama instance support
# ---------------------------------------------------------------------------
def get_ollama_instances() -> list[dict]:
    """Return configured Ollama instances from settings."""
    settings = _load_settings()
    instances = settings.get("ai_ollama_instances") or []
    if not instances:
        return [{"id": "default", "label": "Local Ollama", "base_url": _ollama_base(), "is_default": True}]
    return instances


def add_ollama_instance(instance_id: str, label: str, base_url: str) -> dict:
    """Register an additional Ollama instance (e.g. a second machine on LAN)."""
    settings = _load_settings()
    instances = settings.setdefault("ai_ollama_instances", [])

    # Ensure default exists
    if not instances:
        instances.append({"id": "default", "label": "Local Ollama", "base_url": _ollama_base(), "is_default": True})

    # Add or update
    for inst in instances:
        if inst["id"] == instance_id:
            inst["label"] = label
            inst["base_url"] = base_url
            _save_settings(settings)
            return {"ok": True, "action": "updated", "instance": inst}

    new_inst = {"id": instance_id, "label": label, "base_url": base_url.rstrip("/"), "is_default": False}
    instances.append(new_inst)
    _save_settings(settings)
    return {"ok": True, "action": "added", "instance": new_inst}


def remove_ollama_instance(instance_id: str) -> dict:
    """Remove a non-default Ollama instance."""
    if instance_id == "default":
        return {"ok": False, "error": "Cannot remove the default instance."}
    settings = _load_settings()
    instances = settings.get("ai_ollama_instances") or []
    before = len(instances)
    instances = [i for i in instances if i["id"] != instance_id]
    settings["ai_ollama_instances"] = instances
    _save_settings(settings)
    return {"ok": True, "removed": before > len(instances)}
