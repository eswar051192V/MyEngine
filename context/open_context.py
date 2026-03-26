"""
Ingest open RSS, Reddit (public JSON), and CourtListener search into a local JSONL ledger.
Use only sources you are permitted to access; respect robots and API terms.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from typing import Any

import feedparser
import requests

OPEN_DIR = os.environ.get("OPEN_CONTEXT_DIR", "context_data/open_context")
LEDGER_PATH = os.path.join(OPEN_DIR, "ledger.jsonl")
FEEDS_PATH = os.path.join(OPEN_DIR, "open_feeds.json")
REDDIT_UA = os.environ.get(
    "REDDIT_USER_AGENT",
    "StockAnalysisProject:context-ingest:1.0 (local research)",
)


def _ensure() -> None:
    os.makedirs(OPEN_DIR, exist_ok=True)


def load_feeds_config() -> dict[str, Any]:
    _ensure()
    if not os.path.exists(FEEDS_PATH):
        default = {
            "_comment": "rss: lawful feeds. reddit: public subreddit /new (no auth). courtlistener: needs COURTLISTENER_API_KEY.",
            "rss": [],
            "reddit": [],
            "courtlistener_queries": [],
        }
        with open(FEEDS_PATH, "w", encoding="utf-8") as f:
            json.dump(default, f, indent=2)
        return default
    with open(FEEDS_PATH, encoding="utf-8") as f:
        return json.load(f)


def _row_id(kind: str, url: str, title: str) -> str:
    return hashlib.sha256(f"{kind}|{url}|{title}".encode("utf-8")).hexdigest()[:18]


def _append_ledger(rows: list[dict[str, Any]]) -> int:
    _ensure()
    existing = load_all_ledger_ids()
    n = 0
    with open(LEDGER_PATH, "a", encoding="utf-8") as f:
        for row in rows:
            if row["id"] in existing:
                continue
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
            existing.add(row["id"])
            n += 1
    return n


def load_all_ledger_ids() -> set[str]:
    if not os.path.exists(LEDGER_PATH):
        return set()
    ids: set[str] = set()
    with open(LEDGER_PATH, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ids.add(json.loads(line)["id"])
            except (json.JSONDecodeError, KeyError):
                continue
    return ids


def iter_ledger(limit: int | None = None) -> list[dict[str, Any]]:
    if not os.path.exists(LEDGER_PATH):
        return []
    rows: list[dict[str, Any]] = []
    with open(LEDGER_PATH, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    if limit is not None and limit > 0:
        return rows[-limit:]
    return rows


def ingest_rss() -> dict[str, Any]:
    cfg = load_feeds_config()
    rss_list = cfg.get("rss") or []
    out: list[dict[str, Any]] = []
    for item in rss_list:
        url = item.get("url") if isinstance(item, dict) else item
        if not url:
            continue
        source = item.get("source_name") if isinstance(item, dict) else url
        parsed = feedparser.parse(url)
        for e in parsed.entries or []:
            title = getattr(e, "title", "") or ""
            link = getattr(e, "link", "") or ""
            summary = getattr(e, "summary", "") or getattr(e, "description", "") or ""
            pub = ""
            if getattr(e, "published_parsed", None) and e.published_parsed:
                try:
                    t = e.published_parsed[:6]
                    pub = datetime(*t, tzinfo=timezone.utc).date().isoformat()
                except (TypeError, ValueError):
                    pub = ""
            rid = _row_id("rss", link, title)
            out.append(
                {
                    "id": rid,
                    "kind": "rss",
                    "source": source or "rss",
                    "published_at": pub,
                    "title": title[:500],
                    "summary": summary[:4000],
                    "url": link[:2000],
                    "symbols": [],
                }
            )
    added = _append_ledger(out)
    return {"ok": True, "rss_candidates": len(out), "appended": added}


def ingest_reddit() -> dict[str, Any]:
    cfg = load_feeds_config()
    subs = cfg.get("reddit") or []
    out: list[dict[str, Any]] = []
    headers = {"User-Agent": REDDIT_UA}
    for item in subs:
        if isinstance(item, str):
            sub = item
            lim = 15
        else:
            sub = item.get("subreddit") or item.get("sub")
            lim = int(item.get("limit") or 15)
        if not sub:
            continue
        sub = re.sub(r"[^A-Za-z0-9_]", "", sub)
        url = f"https://www.reddit.com/r/{sub}/new.json?limit={min(lim, 25)}"
        try:
            r = requests.get(url, headers=headers, timeout=25)
            if r.status_code != 200:
                continue
            data = r.json()
        except (requests.RequestException, ValueError):
            continue
        children = (data.get("data") or {}).get("children") or []
        for ch in children:
            p = (ch.get("data") or {}) if isinstance(ch, dict) else {}
            title = p.get("title") or ""
            link = "https://reddit.com" + (p.get("permalink") or "")
            summary = p.get("selftext") or ""
            pub = ""
            if p.get("created_utc"):
                try:
                    pub = datetime.fromtimestamp(float(p["created_utc"]), tz=timezone.utc).date().isoformat()
                except (TypeError, ValueError, OSError):
                    pub = ""
            rid = _row_id("reddit", link, title)
            out.append(
                {
                    "id": rid,
                    "kind": "reddit",
                    "source": f"r/{sub}",
                    "published_at": pub,
                    "title": title[:500],
                    "summary": summary[:4000],
                    "url": link[:2000],
                    "symbols": [],
                }
            )
    added = _append_ledger(out)
    return {"ok": True, "reddit_candidates": len(out), "appended": added}


def ingest_courtlistener() -> dict[str, Any]:
    token = os.environ.get("COURTLISTENER_API_KEY", "").strip()
    if not token:
        return {"ok": True, "skipped": True, "reason": "COURTLISTENER_API_KEY not set"}
    cfg = load_feeds_config()
    queries = cfg.get("courtlistener_queries") or []
    if not queries:
        return {"ok": True, "skipped": True, "reason": "no courtlistener_queries in open_feeds.json"}
    headers = {"Authorization": f"Token {token}"}
    out: list[dict[str, Any]] = []
    for q in queries[:5]:
        if isinstance(q, str):
            query = q
        else:
            query = q.get("q") or ""
        if not query:
            continue
        url = "https://www.courtlistener.com/api/rest/v4/search/"
        try:
            r = requests.get(
                url,
                headers=headers,
                params={"q": query, "type": "o", "order_by": "dateFiled desc"},
                timeout=30,
            )
            if r.status_code != 200:
                continue
            payload = r.json()
        except requests.RequestException:
            continue
        for res in (payload.get("results") or [])[:15]:
            title = res.get("caseName") or res.get("citation") or "Opinion"
            link = res.get("absolute_url") or ""
            if link and not link.startswith("http"):
                link = "https://www.courtlistener.com" + link
            pub = (res.get("dateFiled") or "")[:10]
            rid = _row_id("court", link or title, title)
            out.append(
                {
                    "id": rid,
                    "kind": "court",
                    "source": "courtlistener",
                    "published_at": pub,
                    "title": title[:500],
                    "summary": "",
                    "url": link[:2000],
                    "symbols": [],
                    "query": query,
                }
            )
    added = _append_ledger(out)
    return {"ok": True, "court_candidates": len(out), "appended": added}


def run_open_ingest() -> dict[str, Any]:
    a = ingest_rss()
    b = ingest_reddit()
    c = ingest_courtlistener()
    return {"ok": True, "rss": a, "reddit": b, "courtlistener": c}


def filter_ledger_for_symbol(symbol: str, rows: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    rows = rows if rows is not None else iter_ledger(limit=5000)
    stem = symbol.replace(".NS", "").replace(".BO", "").upper()
    sym_u = symbol.upper()
    out: list[dict[str, Any]] = []
    for r in rows:
        if sym_u in (r.get("symbols") or []):
            out.append(r)
            continue
        blob = f"{r.get('title','')} {r.get('summary','')}".upper()
        if stem and len(stem) >= 3 and stem in blob:
            out.append(r)
            continue
    out.sort(key=lambda x: (x.get("published_at") or "", x.get("id") or ""), reverse=True)
    return out[:40]
