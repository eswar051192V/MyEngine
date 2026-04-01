"""
Shared Yahoo Finance → Parquet download utilities (used by bulk_downloader and agents).
"""
from __future__ import annotations

import json
import os
import time
from typing import Callable

import yfinance as yf

DATA_DIR = os.environ.get("MARKET_DATA_DIR", "local_market_data")
TICKERS_JSON = os.environ.get("TICKERS_JSON", "all_global_tickers.json")


def setup_directories() -> None:
    for sub in ("15m", "1h", "1d", "1wk", "1mo", "options"):
        os.makedirs(f"{DATA_DIR}/{sub}", exist_ok=True)


def load_tickers(path: str | None = None) -> dict:
    p = path or TICKERS_JSON
    if not os.path.exists(p):
        return {}
    with open(p, "r") as f:
        return json.load(f)


def list_categories() -> list[str]:
    return sorted(load_tickers().keys())


def symbols_in_category(category: str) -> list[str]:
    data = load_tickers()
    return list(data.get(category, []))


def all_symbols_flat() -> list[str]:
    data = load_tickers()
    out: list[str] = []
    for syms in data.values():
        out.extend(syms)
    return sorted(set(out))


def download_ticker_data(symbol: str) -> bool:
    ticker = yf.Ticker(symbol)
    try:
        ok = False
        df_15m = ticker.history(period="60d", interval="15m")
        if not df_15m.empty:
            df_15m.to_parquet(f"{DATA_DIR}/15m/{symbol}.parquet")
            ok = True
        df_1h = ticker.history(period="730d", interval="1h")
        if not df_1h.empty:
            df_1h.to_parquet(f"{DATA_DIR}/1h/{symbol}.parquet")
            ok = True
        df_1d = ticker.history(period="max", interval="1d")
        if not df_1d.empty:
            df_1d.to_parquet(f"{DATA_DIR}/1d/{symbol}.parquet")
            ok = True
        df_1wk = ticker.history(period="max", interval="1wk")
        if not df_1wk.empty:
            df_1wk.to_parquet(f"{DATA_DIR}/1wk/{symbol}.parquet")
            ok = True
        return ok
    except Exception:
        return False


def download_symbols(
    symbols: list[str],
    sleep_seconds: float = 1.5,
    on_progress: Callable[[int, int, str], None] | None = None,
) -> dict:
    setup_directories()
    ok = fail = 0
    n = len(symbols)
    for i, sym in enumerate(symbols):
        if download_ticker_data(sym):
            ok += 1
        else:
            fail += 1
        if on_progress:
            on_progress(i + 1, n, sym)
        if i < n - 1 and sleep_seconds > 0:
            time.sleep(sleep_seconds)
    return {
        "successful": ok,
        "failed": fail,
        "total": n,
        "data_dir": os.path.abspath(DATA_DIR),
    }
