"""Aggregate saved news, open ledger, and consumer preview for a symbol."""
from __future__ import annotations

from typing import Any

from context.news_store import load_saved_news
from context.open_context import filter_ledger_for_symbol
from context.consumer_query import preview_consumer_context


def get_unified_context(symbol: str, open_limit: int = 20) -> dict[str, Any]:
    news = load_saved_news(symbol)
    open_rows = filter_ledger_for_symbol(symbol)[:open_limit]
    consumer = preview_consumer_context(symbol, limit=10)
    return {
        "symbol": symbol,
        "news": news,
        "open_context": open_rows,
        "consumer": consumer,
    }
