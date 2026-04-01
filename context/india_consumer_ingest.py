"""
Ingest allowlisted RSS feeds and hand-placed JSONL drops into normalized consumer cases.

Allowlist only lawful sources (official RSS, your files). Do not scrape ToS-restricted sites.
"""
from __future__ import annotations

import glob
import hashlib
import json
import os
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any

import feedparser

from context.consumer_resolve import resolve_tickers_for_company_guess
from context.india_consumer_paths import (
    CASES_JSONL,
    FEEDS_JSON,
    INCOMING_DIR,
    ensure_consumer_dirs,
)


def _stable_id(source: str, raw_url: str, title: str, published_at: str) -> str:
    h = hashlib.sha256(f"{source}|{raw_url}|{title}|{published_at}".encode("utf-8")).hexdigest()
    return h[:20]


def _parse_rfc822_date(s: str | None) -> str | None:
    if not s:
        return None
    try:
        dt = parsedate_to_datetime(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.date().isoformat()
    except (TypeError, ValueError):
        return None


def _entry_published_iso(entry: Any) -> str:
    if getattr(entry, "published_parsed", None) and entry.published_parsed:
        try:
            t = entry.published_parsed[:6]
            return datetime(*t, tzinfo=timezone.utc).date().isoformat()
        except (TypeError, ValueError):
            pass
    if getattr(entry, "updated_parsed", None) and entry.updated_parsed:
        try:
            t = entry.updated_parsed[:6]
            return datetime(*t, tzinfo=timezone.utc).date().isoformat()
        except (TypeError, ValueError):
            pass
    d = _parse_rfc822_date(getattr(entry, "published", None) or getattr(entry, "updated", None))
    return d or datetime.now(timezone.utc).date().isoformat()


def _coerce_case_row(raw: dict[str, Any], default_source: str) -> dict[str, Any]:
    title = str(raw.get("title") or raw.get("summary") or "Untitled")[:2000]
    summary = str(raw.get("summary") or raw.get("description") or "")[:8000]
    raw_url = str(raw.get("raw_url") or raw.get("link") or "")
    source = str(raw.get("source") or default_source)
    published_at = str(raw.get("published_at") or "")[:32]
    if not published_at:
        published_at = datetime.now(timezone.utc).date().isoformat()
    company_guess = str(raw.get("company_guess") or raw.get("company") or "")
    sector = raw.get("sector")
    cid = raw.get("id")
    if not cid:
        cid = _stable_id(source, raw_url, title, published_at)
    tickers = raw.get("tickers")
    if tickers is None:
        tickers, res_meta = resolve_tickers_for_company_guess(company_guess)
        res = res_meta
    else:
        tickers = [str(t) for t in tickers]
        res = {"method": "provided", "confidence": 1.0}

    return {
        "id": cid,
        "kind": "consumer_india",
        "source": source,
        "published_at": published_at[:10],
        "title": title,
        "summary": summary,
        "company_guess": company_guess,
        "sector": sector,
        "raw_url": raw_url,
        "tickers": tickers,
        "resolution": res,
    }


def load_feeds_config() -> dict[str, Any]:
    ensure_consumer_dirs()
    if not os.path.exists(FEEDS_JSON):
        default = {
            "_comment": "Add only lawful RSS URLs you are permitted to poll.",
            "feeds": [],
        }
        with open(FEEDS_JSON, "w", encoding="utf-8") as f:
            json.dump(default, f, indent=2)
        return default
    with open(FEEDS_JSON, encoding="utf-8") as f:
        return json.load(f)


def _fetch_rss_cases() -> list[dict[str, Any]]:
    cfg = load_feeds_config()
    feeds = cfg.get("feeds") or []
    out: list[dict[str, Any]] = []
    for item in feeds:
        if isinstance(item, str):
            url = item
            source_name = url
        else:
            url = item.get("url")
            source_name = item.get("source_name") or url
        if not url:
            continue
        parsed = feedparser.parse(url)
        for entry in parsed.entries or []:
            title = getattr(entry, "title", "") or ""
            link = getattr(entry, "link", "") or ""
            summary = ""
            if getattr(entry, "summary", None):
                summary = entry.summary
            elif getattr(entry, "description", None):
                summary = entry.description
            published_at = _entry_published_iso(entry)
            company_guess = str(title)[:500]
            row = _coerce_case_row(
                {
                    "title": title,
                    "summary": summary,
                    "raw_url": link,
                    "source": source_name,
                    "published_at": published_at,
                    "company_guess": company_guess,
                },
                source_name,
            )
            out.append(row)
    return out


def _load_incoming_jsonl() -> list[dict[str, Any]]:
    ensure_consumer_dirs()
    paths = glob.glob(os.path.join(INCOMING_DIR, "*.jsonl"))
    out: list[dict[str, Any]] = []
    for path in paths:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                raw = json.loads(line)
                src = str(raw.get("source") or os.path.basename(path))
                out.append(_coerce_case_row(raw, src))
    return out


def load_existing_cases() -> dict[str, dict[str, Any]]:
    if not os.path.exists(CASES_JSONL):
        return {}
    by_id: dict[str, dict[str, Any]] = {}
    with open(CASES_JSONL, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            by_id[row["id"]] = row
    return by_id


def merge_cases(*batches: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id = load_existing_cases()
    for batch in batches:
        for row in batch:
            by_id[row["id"]] = row
    return sorted(by_id.values(), key=lambda r: (r.get("published_at") or "", r["id"]))


def write_cases_jsonl(rows: list[dict[str, Any]]) -> str:
    ensure_consumer_dirs()
    path = CASES_JSONL
    with open(path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    return path


def run_ingest() -> dict[str, Any]:
    """Fetch RSS allowlist + merge incoming/*.jsonl into cases.jsonl."""
    ensure_consumer_dirs()
    rss_rows: list[dict[str, Any]] = []
    rss_err: str | None = None
    try:
        rss_rows = _fetch_rss_cases()
    except Exception as e:
        rss_err = str(e)
    incoming = _load_incoming_jsonl()
    merged = merge_cases(rss_rows, incoming)
    out_path = write_cases_jsonl(merged)
    return {
        "ok": True,
        "cases_path": out_path,
        "count": len(merged),
        "from_rss": len(rss_rows),
        "from_incoming": len(incoming),
        "rss_error": rss_err,
    }


def iter_cases() -> list[dict[str, Any]]:
    if not os.path.exists(CASES_JSONL):
        return []
    rows: list[dict[str, Any]] = []
    with open(CASES_JSONL, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows
