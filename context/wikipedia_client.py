"""
Best-effort Wikipedia extracts for instrument metadata (used after Yahoo `.info`).
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any
import requests

logger = logging.getLogger(__name__)

UA = {"User-Agent": "StockAnalysisDashboard/1.0 (research; local)"}

_WIKI_API = "https://en.wikipedia.org/w/api.php"


def _clean_title(s: str) -> str:
    s = (s or "").strip()
    s = re.sub(r"\s+", " ", s)
    return s[:200] if s else ""


def _opensearch_first_title(query: str) -> str | None:
    q = _clean_title(query)
    if len(q) < 2:
        return None
    try:
        r = requests.get(
            _WIKI_API,
            params={
                "action": "opensearch",
                "format": "json",
                "search": q,
                "limit": 1,
                "namespace": 0,
            },
            headers=UA,
            timeout=12,
        )
        r.raise_for_status()
        data = r.json()
        if isinstance(data, list) and len(data) > 1 and isinstance(data[1], list) and data[1]:
            return str(data[1][0]).strip() or None
    except Exception as exc:
        logger.debug("wikipedia opensearch failed: %s", exc)
    return None


def _fetch_extract_by_title(title: str) -> tuple[str | None, str | None]:
    t = title.strip()
    if not t:
        return None, None
    try:
        r = requests.get(
            _WIKI_API,
            params={
                "action": "query",
                "format": "json",
                "prop": "extracts",
                "exintro": 1,
                "explaintext": 1,
                "titles": t,
            },
            headers=UA,
            timeout=12,
        )
        r.raise_for_status()
        data = r.json() or {}
        pages = (data.get("query") or {}).get("pages") or {}
        for _pid, page in pages.items():
            if page.get("missing"):
                continue
            extract = (page.get("extract") or "").strip()
            if extract:
                return page.get("title") or t, extract
    except Exception as exc:
        logger.debug("wikipedia extract failed for %s: %s", t, exc)
    return None, None


def _guess_queries(yahoo_info: dict[str, Any], symbol: str) -> list[str]:
    out: list[str] = []
    for key in ("longName", "shortName", "displayName", "name"):
        v = yahoo_info.get(key)
        if isinstance(v, str) and v.strip():
            out.append(v.strip())
    sym = (symbol or "").strip().upper()
    if sym and sym not in out:
        out.append(sym.replace(".NS", "").replace(".BO", " "))
    # strip common suffixes
    cleaned: list[str] = []
    for q in out:
        q2 = re.sub(r"\s+(Inc\.?|Corp\.?|Ltd\.?|PLC|N\.V\.?)$", "", q, flags=re.I).strip()
        cleaned.append(q2 or q)
    seen: set[str] = set()
    uniq: list[str] = []
    for q in cleaned:
        k = q.lower()
        if k not in seen:
            seen.add(k)
            uniq.append(q)
    return uniq


def wikipedia_enrichment_from_yahoo(yahoo_info: dict[str, Any], symbol: str) -> dict[str, Any]:
    """
    Returns flat keys merged into instrument_info JSON:
    wikipedia_title, wikipedia_extract, wikipedia_fetched_at (or empty dict if nothing found).
    """
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for query in _guess_queries(yahoo_info or {}, symbol):
        title, extract = _fetch_extract_by_title(query)
        if extract:
            return {
                "wikipedia_title": title or query,
                "wikipedia_extract": extract[:12000],
                "wikipedia_fetched_at": now,
            }
        alt = _opensearch_first_title(query)
        if alt:
            title, extract = _fetch_extract_by_title(alt)
            if extract:
                return {
                    "wikipedia_title": title or alt,
                    "wikipedia_extract": extract[:12000],
                    "wikipedia_fetched_at": now,
                }
    return {}
