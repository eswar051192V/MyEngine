"""
Tools for the context-analysis agent (news, open ledger, consumer preview, OHLC tail).
"""
from __future__ import annotations

import os
import sys

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from context.consumer_correlation import load_ohlc_daily
from context.consumer_query import preview_consumer_context
from context.news_store import load_saved_news, refresh_and_save
from context.open_context import filter_ledger_for_symbol, run_open_ingest


def tool_refresh_news(symbol: str, **_) -> dict:
    if not symbol or not str(symbol).strip():
        return {"ok": False, "error": "symbol required"}
    return refresh_and_save(str(symbol).strip())


def tool_load_saved_news(symbol: str, **_) -> dict:
    if not symbol or not str(symbol).strip():
        return {"ok": False, "error": "symbol required"}
    data = load_saved_news(str(symbol).strip())
    if not data:
        return {"ok": True, "empty": True, "hint": "Call refresh_news first."}
    items = data.get("items") or []
    return {
        "ok": True,
        "symbol": data.get("symbol"),
        "updated_at": data.get("updated_at"),
        "headlines": [f"{i.get('published_at','')} | {i.get('title','')}" for i in items[:25]],
        "count": len(items),
    }


def tool_run_open_ingest(**_) -> dict:
    return run_open_ingest()


def tool_open_context_for_symbol(symbol: str, limit: int = 20, **_) -> dict:
    if not symbol or not str(symbol).strip():
        return {"ok": False, "error": "symbol required"}
    rows = filter_ledger_for_symbol(str(symbol).strip())[: int(limit)]
    slim = [
        {
            "kind": r.get("kind"),
            "published_at": r.get("published_at"),
            "title": r.get("title"),
            "url": r.get("url"),
            "source": r.get("source"),
        }
        for r in rows
    ]
    return {"ok": True, "count": len(slim), "items": slim}


def tool_consumer_preview(symbol: str, **_) -> dict:
    if not symbol or not str(symbol).strip():
        return {"ok": False, "error": "symbol required"}
    prev = preview_consumer_context(str(symbol).strip(), limit=8)
    cases = prev.get("cases") or []
    corr = prev.get("correlation") or {}
    return {
        "ok": True,
        "case_titles": [c.get("title") for c in cases[:8]],
        "pearson_complaints_vs_log_ret": corr.get("pearson_complaints_vs_log_ret"),
        "sample_months": corr.get("sample_months"),
    }


def tool_ohlc_tail(symbol: str, rows: int = 5, **_) -> dict:
    if not symbol or not str(symbol).strip():
        return {"ok": False, "error": "symbol required"}
    df = load_ohlc_daily(str(symbol).strip())
    if df is None or df.empty:
        return {"ok": True, "empty": True, "hint": "Download Parquet via /api/ticker/{symbol}/download"}
    t = df.tail(int(rows))
    lines = []
    for ts, row in t.iterrows():
        lines.append(f"{ts.date().isoformat()} close={float(row['Close']):.2f} vol={int(row['Volume'])}")
    return {"ok": True, "tail": lines}


TOOL_FUNCTIONS = {
    "refresh_news": tool_refresh_news,
    "load_saved_news": tool_load_saved_news,
    "run_open_ingest": tool_run_open_ingest,
    "open_context_for_symbol": tool_open_context_for_symbol,
    "consumer_preview": tool_consumer_preview,
    "ohlc_tail": tool_ohlc_tail,
}

OLLAMA_TOOLS_SPEC = [
    {
        "type": "function",
        "function": {
            "name": "refresh_news",
            "description": "Download latest news from yfinance and optional Finnhub/NewsAPI, merge, save JSON on disk for this symbol.",
            "parameters": {
                "type": "object",
                "properties": {"symbol": {"type": "string"}},
                "required": ["symbol"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "load_saved_news",
            "description": "Read previously saved headlines for the symbol (no network).",
            "parameters": {
                "type": "object",
                "properties": {"symbol": {"type": "string"}},
                "required": ["symbol"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_open_ingest",
            "description": "Append new rows from configured RSS, Reddit, and CourtListener (if API key set) into the local open-context ledger.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "open_context_for_symbol",
            "description": "Filter ledger items that mention this ticker or company stem.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "limit": {"type": "integer"},
                },
                "required": ["symbol"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "consumer_preview",
            "description": "Summarize India consumer-case titles and complaint vs return correlation stats for this symbol.",
            "parameters": {
                "type": "object",
                "properties": {"symbol": {"type": "string"}},
                "required": ["symbol"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ohlc_tail",
            "description": "Last few daily closes/volumes from local Parquet for factual price context.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "rows": {"type": "integer"},
                },
                "required": ["symbol"],
            },
        },
    },
]


def dispatch_tool(name: str, arguments: dict | None) -> dict:
    args = arguments if isinstance(arguments, dict) else {}
    fn = TOOL_FUNCTIONS.get(name)
    if not fn:
        return {"ok": False, "error": f"unknown tool: {name}"}
    try:
        return fn(**args)
    except TypeError as e:
        return {"ok": False, "error": f"bad arguments for {name}: {e}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
