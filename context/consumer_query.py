from __future__ import annotations

import os
from typing import Any

import requests

from context.consumer_correlation import correlation_report, load_ohlc_daily
from context.consumer_rag import DEFAULT_EMBED_MODEL, enrich_chunks_with_case_meta, index_stats, search
from context.india_consumer_ingest import iter_cases

OLLAMA_BASE = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
DEFAULT_CHAT_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.1")


def _ohlc_snippet(symbol: str, max_lines: int = 8) -> str:
    df = load_ohlc_daily(symbol)
    if df is None or df.empty:
        return "No local daily Parquet for this symbol (post to /api/ticker/{symbol}/download to save OHLC)."
    t = df.tail(max_lines)
    lines = []
    for ts, row in t.iterrows():
        lines.append(f"{ts.date().isoformat()}: close={row['Close']:.2f} vol={int(row['Volume'])}")
    return "\n".join(lines)


def run_consumer_query(
    symbol: str,
    question: str,
    k: int = 8,
    months_back: int = 24,
    model: str | None = None,
    embed_model: str | None = None,
) -> dict[str, Any]:
    model = model or DEFAULT_CHAT_MODEL
    embed_model = embed_model or DEFAULT_EMBED_MODEL
    cases = iter_cases()
    hits = search(
        question or "consumer complaints and regulatory risk",
        k=k,
        symbol=symbol,
        months_back=months_back if months_back > 0 else None,
        embed_model=embed_model,
    )
    enriched = enrich_chunks_with_case_meta(hits, cases)
    corr = correlation_report(symbol, cases)
    ohlc_txt = _ohlc_snippet(symbol)

    excerpts = []
    for i, h in enumerate(enriched, 1):
        excerpts.append(
            f"[{i}] ({h.get('published_at')}) {h.get('title') or ''}\n"
            f"Source: {h.get('source')} | score={h.get('score', 0):.3f}\n"
            f"{(h.get('text') or '')[:1200]}"
        )
    rag_block = "\n\n".join(excerpts) if excerpts else "(No retrieved chunks; index may be empty—run POST /api/context/consumer/reindex after ingest.)"

    corr_lines = []
    if corr.get("pearson_complaints_vs_log_ret") is not None:
        corr_lines.append(f"Pearson(complaints, monthly log return): {corr['pearson_complaints_vs_log_ret']:.4f}")
    if corr.get("spearman_complaints_vs_log_ret") is not None:
        corr_lines.append(f"Spearman: {corr['spearman_complaints_vs_log_ret']:.4f}")
    corr_lines.append(f"Months in sample: {corr.get('sample_months', 0)}")
    corr_block = "\n".join(corr_lines)

    system = """You are an analyst assistant. Answer using the retrieved consumer-case excerpts and the numeric correlation summary.
Rules: cite themes (product/service/refunds) not legal advice; say when data is thin; remind that correlation is not causation; not investment advice."""

    user = f"""Symbol: {symbol}

User question:
{question}

Retrieved case excerpts:
{rag_block}

Monthly correlation summary (India consumer cases vs local OHLC monthly returns for this symbol):
{corr_block}
Note: {corr.get('note', '')}

Recent daily OHLC (local Parquet tail):
{ohlc_txt}
"""

    url = f"{OLLAMA_BASE}/api/chat"
    try:
        r = requests.post(
            url,
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "stream": False,
            },
            timeout=600,
        )
    except requests.exceptions.ConnectionError:
        return {
            "ok": False,
            "error": f"Cannot reach Ollama at {OLLAMA_BASE}. Start Ollama and pull {model} and {embed_model}.",
            "retrieved": enriched,
            "correlation": corr,
        }
    if r.status_code != 200:
        return {
            "ok": False,
            "error": f"Ollama HTTP {r.status_code}: {r.text[:500]}",
            "retrieved": enriched,
            "correlation": corr,
        }
    body = r.json()
    msg = body.get("message") or {}
    analysis = msg.get("content") or ""
    return {
        "ok": True,
        "model": model,
        "embed_model": embed_model,
        "analysis": analysis,
        "retrieved": enriched,
        "correlation": corr,
    }


def preview_consumer_context(
    symbol: str,
    limit: int = 12,
    months_back: int = 120,
) -> dict[str, Any]:
    from datetime import date, timedelta

    cutoff = (date.today() - timedelta(days=30 * months_back)).isoformat()[:10]
    cases = iter_cases()
    rows = []
    for c in cases:
        if symbol not in (c.get("tickers") or []):
            continue
        pub = c.get("published_at") or ""
        if pub and pub < cutoff:
            continue
        rows.append(
            {
                "id": c.get("id"),
                "published_at": pub,
                "title": c.get("title"),
                "raw_url": c.get("raw_url"),
                "source": c.get("source"),
                "resolution": c.get("resolution"),
            }
        )
    rows.sort(key=lambda x: (x.get("published_at") or "", x.get("id") or ""), reverse=True)
    corr = correlation_report(symbol, cases)
    return {
        "symbol": symbol,
        "cases": rows[:limit],
        "total_for_symbol": len(rows),
        "correlation": corr,
        "index": index_stats(),
    }
