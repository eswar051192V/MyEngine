"""
Wikipedia profile fetcher with background caching.

Fetches company profiles from Wikipedia (sector, industry, HQ, CEO, founded,
description, wiki URL) and caches them to disk for instant access.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from urllib.parse import quote

import requests

HEADERS = {
    "User-Agent": (
        "StockAnalysisBot/1.0 (https://github.com/stockanalysis; contact@example.com) "
        "Python/3.11"
    )
}

CACHE_DIR = Path(__file__).parent / "cache" / "wiki_profiles"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# How long before a cached profile is considered stale (7 days)
CACHE_TTL_SECONDS = 7 * 24 * 60 * 60

# In-memory cache for current session (avoids repeated disk reads)
_mem_cache: dict[str, dict] = {}
_fetch_locks: dict[str, threading.Lock] = {}
_global_lock = threading.Lock()


def _cache_path(symbol: str) -> Path:
    """Get the cache file path for a symbol."""
    safe = symbol.replace("/", "_").replace("\\", "_").replace(":", "_")
    return CACHE_DIR / f"{safe}.json"


def _read_cache(symbol: str) -> dict | None:
    """Read cached profile from disk, return None if missing or stale."""
    if symbol in _mem_cache:
        entry = _mem_cache[symbol]
        if time.time() - entry.get("_cached_at", 0) < CACHE_TTL_SECONDS:
            return entry
    path = _cache_path(symbol)
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if time.time() - data.get("_cached_at", 0) < CACHE_TTL_SECONDS:
                _mem_cache[symbol] = data
                return data
        except Exception:
            pass
    return None


def _write_cache(symbol: str, data: dict) -> None:
    """Write profile to disk cache."""
    data["_cached_at"] = time.time()
    _mem_cache[symbol] = data
    try:
        _cache_path(symbol).write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except Exception:
        pass


def _get_lock(symbol: str) -> threading.Lock:
    """Get a per-symbol lock to prevent duplicate fetches."""
    with _global_lock:
        if symbol not in _fetch_locks:
            _fetch_locks[symbol] = threading.Lock()
        return _fetch_locks[symbol]


# ---------------------------------------------------------------------------
# Wikipedia API fetching
# ---------------------------------------------------------------------------

def _search_wikipedia(query: str) -> str | None:
    """Search Wikipedia and return the best page title."""
    try:
        resp = requests.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "list": "search",
                "srsearch": query,
                "srlimit": 3,
                "format": "json",
            },
            headers=HEADERS,
            timeout=15,
        )
        data = resp.json()
        results = data.get("query", {}).get("search", [])
        if results:
            return results[0]["title"]
    except Exception:
        pass
    return None


def _get_wiki_summary(title: str) -> dict:
    """Get Wikipedia summary via the REST API."""
    try:
        url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{quote(title)}"
        resp = requests.get(url, headers=HEADERS, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            return {
                "title": data.get("title", title),
                "description": data.get("description", ""),
                "extract": data.get("extract", ""),
                "thumbnail": data.get("thumbnail", {}).get("source", ""),
                "wikiUrl": data.get("content_urls", {}).get("desktop", {}).get("page", ""),
            }
    except Exception:
        pass
    return {}


def _get_wiki_infobox(title: str) -> dict:
    """Parse Wikipedia infobox data via the API (wikitext parsing)."""
    info: dict[str, str] = {}
    try:
        resp = requests.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "parse",
                "page": title,
                "prop": "wikitext",
                "section": 0,
                "format": "json",
            },
            headers=HEADERS,
            timeout=15,
        )
        data = resp.json()
        wikitext = data.get("parse", {}).get("wikitext", {}).get("*", "")
        if not wikitext:
            return info

        # Extract key fields from infobox wikitext
        field_map = {
            "founded": ["founded", "foundation", "established", "inception"],
            "headquarters": ["headquarters", "hq_location", "hq", "location", "city"],
            "ceo": ["key_people", "leader_name", "ceo", "chairman"],
            "industry": ["industry", "industries"],
            "sector": ["sector", "type"],
            "employees": ["num_employees", "employees", "number_of_employees"],
            "revenue": ["revenue"],
            "website": ["website", "url", "homepage"],
            "traded_as": ["traded_as", "symbol"],
            "isin": ["isin"],
            "founder": ["founder", "founders"],
            "products": ["products", "services"],
            "parent": ["parent", "owner"],
            "subsidiaries": ["subsidiaries", "divisions"],
            "market_cap": ["market_cap", "market_capitalization"],
        }

        for output_key, wiki_keys in field_map.items():
            for wk in wiki_keys:
                pattern = rf"\|\s*{re.escape(wk)}\s*=\s*(.+?)(?:\n\||\n\}})"
                match = re.search(pattern, wikitext, re.IGNORECASE | re.DOTALL)
                if match:
                    raw = match.group(1).strip()
                    # Clean wiki markup
                    cleaned = re.sub(r"\[\[([^|\]]*\|)?([^\]]*)\]\]", r"\2", raw)
                    cleaned = re.sub(r"\{\{[^}]*\}\}", "", cleaned)
                    cleaned = re.sub(r"<[^>]+>", "", cleaned)
                    cleaned = re.sub(r"\s+", " ", cleaned).strip()
                    if cleaned and len(cleaned) < 500:
                        info[output_key] = cleaned
                    break

    except Exception:
        pass
    return info


def _build_search_query(symbol: str, name: str = "") -> str:
    """Build a Wikipedia search query from symbol and name."""
    # Strip Yahoo Finance suffixes
    clean = re.sub(r"\.(NS|BO|MCX|L|T|HK|DE|PA|SW|TO|AX|KS|TW|SA|JO)$", "", symbol, flags=re.IGNORECASE)
    clean = clean.replace("_", " ").replace("-", " ")
    # Prefer name if available
    if name and name != symbol and name != clean:
        return f"{name} company"
    return f"{clean} company stock"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_wiki_profile(symbol: str, name: str = "", force_refresh: bool = False) -> dict:
    """
    Get a full Wikipedia profile for a symbol.
    Returns cached version if available, otherwise fetches from Wikipedia.
    """
    if not force_refresh:
        cached = _read_cache(symbol)
        if cached:
            return cached

    lock = _get_lock(symbol)
    if not lock.acquire(timeout=0.1):
        # Another thread is fetching, return what we have
        cached = _read_cache(symbol)
        if cached:
            return cached
        return {"symbol": symbol, "status": "fetching", "name": name or symbol}

    try:
        query = _build_search_query(symbol, name)
        title = _search_wikipedia(query)

        if not title:
            profile = {
                "symbol": symbol,
                "name": name or symbol,
                "status": "not_found",
                "wikiUrl": "",
                "description": "",
                "extract": "",
            }
            _write_cache(symbol, profile)
            return profile

        summary = _get_wiki_summary(title)
        infobox = _get_wiki_infobox(title)

        profile = {
            "symbol": symbol,
            "name": name or summary.get("title", symbol),
            "status": "ok",
            "wikiTitle": summary.get("title", title),
            "wikiUrl": summary.get("wikiUrl", f"https://en.wikipedia.org/wiki/{quote(title)}"),
            "description": summary.get("description", ""),
            "extract": summary.get("extract", ""),
            "thumbnail": summary.get("thumbnail", ""),
            # Infobox fields
            "founded": infobox.get("founded", ""),
            "headquarters": infobox.get("headquarters", ""),
            "ceo": infobox.get("ceo", ""),
            "industry": infobox.get("industry", ""),
            "sector": infobox.get("sector", ""),
            "employees": infobox.get("employees", ""),
            "revenue": infobox.get("revenue", ""),
            "website": infobox.get("website", ""),
            "founder": infobox.get("founder", ""),
            "products": infobox.get("products", ""),
            "parent": infobox.get("parent", ""),
            "subsidiaries": infobox.get("subsidiaries", ""),
            "traded_as": infobox.get("traded_as", ""),
            "isin": infobox.get("isin", ""),
            "market_cap": infobox.get("market_cap", ""),
        }
        _write_cache(symbol, profile)
        return profile

    except Exception as exc:
        return {
            "symbol": symbol,
            "name": name or symbol,
            "status": "error",
            "error": str(exc),
        }
    finally:
        lock.release()


def get_wiki_profile_background(symbol: str, name: str = "") -> dict:
    """
    Return cached profile immediately if available.
    If not cached, start a background fetch and return a placeholder.
    """
    cached = _read_cache(symbol)
    if cached:
        return cached

    # Start background fetch
    def _bg():
        get_wiki_profile(symbol, name)

    thread = threading.Thread(target=_bg, daemon=True)
    thread.start()

    return {
        "symbol": symbol,
        "name": name or symbol,
        "status": "fetching",
    }


def clear_cache(symbol: str | None = None) -> int:
    """Clear cache for a symbol or all symbols. Returns count cleared."""
    if symbol:
        path = _cache_path(symbol)
        _mem_cache.pop(symbol, None)
        if path.exists():
            path.unlink()
            return 1
        return 0
    else:
        count = 0
        for f in CACHE_DIR.glob("*.json"):
            f.unlink()
            count += 1
        _mem_cache.clear()
        return count


def cache_stats() -> dict:
    """Return cache statistics."""
    files = list(CACHE_DIR.glob("*.json"))
    total_size = sum(f.stat().st_size for f in files)
    return {
        "cached_profiles": len(files),
        "total_size_kb": round(total_size / 1024, 1),
        "cache_dir": str(CACHE_DIR),
        "ttl_days": CACHE_TTL_SECONDS // (24 * 3600),
    }
