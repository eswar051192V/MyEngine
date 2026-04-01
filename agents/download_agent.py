"""
Ollama chat agent with tool-use for orchestrating market_download jobs.
"""
from __future__ import annotations

import json
import os
from typing import Any

import requests

from agents.download_tools import OLLAMA_TOOLS_SPEC, dispatch_tool

OLLAMA_BASE = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
MAX_TURNS = 12

SYSTEM = """You are a market data download agent. You control tools that save Yahoo Finance history to local Parquet files under local_market_data/.

Rules:
- Call prepare_data_folders once before bulk downloads if unsure folders exist.
- Use list_categories / get_category_symbols to discover valid category names (they are exact keys).
- Prefer small batches: use limit<=25 for download_category unless the user clearly asks for more (max 200).
- After tools run, summarize what was downloaded and any failures for the user.
- Do not invent ticker symbols; use tools to list them.
"""


def run_download_agent(
    user_message: str,
    model: str | None = None,
    ollama_base: str | None = None,
) -> dict[str, Any]:
    model = model or os.environ.get("OLLAMA_MODEL", "llama3.1")
    base = (ollama_base or OLLAMA_BASE).rstrip("/")
    url = f"{base}/api/chat"

    messages: list[dict] = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": user_message},
    ]
    tool_log: list[dict] = []

    for turn in range(MAX_TURNS):
        payload = {
            "model": model,
            "messages": messages,
            "tools": OLLAMA_TOOLS_SPEC,
            "stream": False,
        }
        try:
            r = requests.post(url, json=payload, timeout=600)
        except requests.exceptions.ConnectionError:
            return {
                "ok": False,
                "error": f"Cannot reach Ollama at {base}. Start Ollama or set OLLAMA_HOST.",
                "tool_log": tool_log,
            }
        if r.status_code != 200:
            return {
                "ok": False,
                "error": f"Ollama HTTP {r.status_code}: {r.text[:500]}",
                "tool_log": tool_log,
            }
        body = r.json()
        msg = body.get("message") or {}
        messages.append(msg)

        tool_calls = msg.get("tool_calls") or []
        if not tool_calls:
            return {
                "ok": True,
                "model": model,
                "turns": turn + 1,
                "final_message": msg.get("content") or "",
                "tool_log": tool_log,
                "raw_last_message": msg,
            }

        for tc in tool_calls:
            fn = tc.get("function") or {}
            name = fn.get("name")
            raw_args = fn.get("arguments")
            if isinstance(raw_args, str):
                try:
                    args = json.loads(raw_args) if raw_args.strip() else {}
                except json.JSONDecodeError:
                    args = {}
            elif isinstance(raw_args, dict):
                args = raw_args
            else:
                args = {}
            result = dispatch_tool(name, args)
            tool_log.append({"tool": name, "arguments": args, "result": result})
            messages.append({"role": "tool", "content": json.dumps(result)})

    return {
        "ok": False,
        "error": f"Stopped after {MAX_TURNS} turns (max tool loop).",
        "tool_log": tool_log,
        "final_message": "",
    }
