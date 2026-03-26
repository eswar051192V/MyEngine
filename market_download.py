"""
Shared Yahoo Finance → Parquet download utilities (used by bulk_downloader and agents).
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import time
from datetime import datetime
from typing import Callable

import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)

_REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("MARKET_DATA_DIR", "local_market_data")
TICKERS_JSON = os.environ.get("TICKERS_JSON", os.path.join(_REPO_ROOT, "all_global_tickers.json"))


def setup_directories() -> None:
    for sub in ("15m", "1h", "1d", "1wk", "1mo", "options"):
        os.makedirs(f"{DATA_DIR}/{sub}", exist_ok=True)


def _ohlc_sqlite_path() -> str:
    os.makedirs(DATA_DIR, exist_ok=True)
    return os.path.join(DATA_DIR, "ohlc.sqlite")


def _ensure_ohlc_sqlite() -> None:
    db_path = _ohlc_sqlite_path()
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ohlc (
                symbol TEXT NOT NULL,
                interval TEXT NOT NULL,
                ts TEXT NOT NULL,
                open REAL,
                high REAL,
                low REAL,
                close REAL,
                volume REAL,
                PRIMARY KEY(symbol, interval, ts)
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_ohlc_symbol_interval_ts ON ohlc(symbol, interval, ts)"
        )
        conn.commit()


def _save_df_to_sqlite(symbol: str, interval: str, df: pd.DataFrame) -> int:
    if df is None or df.empty:
        return 0
    _ensure_ohlc_sqlite()
    frame = df.copy()
    frame = frame[~frame.index.duplicated(keep="last")]
    frame.sort_index(inplace=True)
    rows: list[tuple] = []
    for ts, row in frame.iterrows():
        rows.append(
            (
                str(symbol).upper(),
                interval,
                pd.Timestamp(ts).strftime("%Y-%m-%d %H:%M:%S"),
                float(row.get("Open")) if pd.notna(row.get("Open")) else None,
                float(row.get("High")) if pd.notna(row.get("High")) else None,
                float(row.get("Low")) if pd.notna(row.get("Low")) else None,
                float(row.get("Close")) if pd.notna(row.get("Close")) else None,
                float(row.get("Volume")) if pd.notna(row.get("Volume")) else None,
            )
        )
    if not rows:
        return 0
    with sqlite3.connect(_ohlc_sqlite_path()) as conn:
        conn.executemany(
            """
            INSERT OR REPLACE INTO ohlc (symbol, interval, ts, open, high, low, close, volume)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        conn.commit()
    return len(rows)


def _append_parquet(path: str, incoming: pd.DataFrame) -> int:
    if incoming is None or incoming.empty:
        return 0
    frame = incoming.copy()
    if os.path.exists(path):
        try:
            existing = pd.read_parquet(path)
            frame = pd.concat([existing, frame], axis=0)
        except Exception:
            pass
    frame = frame[~frame.index.duplicated(keep="last")].sort_index()
    frame.to_parquet(path)
    return len(frame)


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
    except Exception as exc:
        logger.warning("download_ticker_data %s failed: %s", symbol, exc)
        return False


def download_eod_bar(symbol: str, interval: str = "1d") -> bool:
    sym = str(symbol).strip().upper()
    if not sym:
        return False
    setup_directories()
    ticker = yf.Ticker(sym)
    try:
        df = ticker.history(period="5d", interval=interval, auto_adjust=False)
        if df is None or df.empty:
            return False
        tail = df.tail(1)
        _save_df_to_sqlite(sym, interval, tail)
        if interval in {"1d", "1wk", "1mo"}:
            folder = interval
            path = os.path.join(DATA_DIR, folder, f"{sym}.parquet")
            _append_parquet(path, tail)
        return True
    except Exception as exc:
        logger.warning("download_eod_bar %s failed: %s", sym, exc)
        return False


def download_intraday_session(symbol: str, interval: str = "1m") -> bool:
    sym = str(symbol).strip().upper()
    if not sym:
        return False
    ticker = yf.Ticker(sym)
    try:
        df = ticker.history(period="1d", interval=interval, auto_adjust=False)
        if df is None or df.empty:
            return False
        _save_df_to_sqlite(sym, interval, df)
        return True
    except Exception as exc:
        logger.warning("download_intraday_session %s failed: %s", sym, exc)
        return False


def fetch_live_quote(symbol: str) -> dict:
    sym = str(symbol).strip().upper()
    if not sym:
        return {}
    ticker = yf.Ticker(sym)
    try:
        fast = getattr(ticker, "fast_info", {}) or {}
        last = fast.get("last_price") or fast.get("regular_market_price") or fast.get("lastPrice")
        prev = fast.get("previous_close") or fast.get("previousClose")
        change = (float(last) - float(prev)) if last is not None and prev is not None else None
        change_pct = ((change / float(prev)) * 100.0) if change is not None and prev else None
        return {
            "symbol": sym,
            "price": float(last) if last is not None else None,
            "change": float(change) if change is not None else None,
            "change_pct": float(change_pct) if change_pct is not None else None,
            "volume": float(fast.get("last_volume")) if fast.get("last_volume") is not None else None,
            "ts": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
        }
    except Exception as exc:
        logger.warning("fetch_live_quote %s failed: %s", sym, exc)
        return {}


def batch_fetch_live_quotes(symbols: list[str]) -> dict[str, dict]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for sym in symbols or []:
        key = str(sym).strip().upper()
        if key and key not in seen:
            seen.add(key)
            cleaned.append(key)
    out: dict[str, dict] = {}
    if not cleaned:
        return out
    try:
        frame = yf.download(
            tickers=cleaned,
            period="1d",
            interval="1m",
            group_by="ticker",
            auto_adjust=False,
            progress=False,
            threads=True,
        )
        for sym in cleaned:
            row = None
            try:
                # Multi-symbol returns MultiIndex columns, single-symbol returns normal frame.
                if isinstance(frame.columns, pd.MultiIndex):
                    sym_df = frame[sym] if sym in frame.columns.get_level_values(0) else pd.DataFrame()
                    if not sym_df.empty:
                        row = sym_df.tail(1).iloc[0]
                elif len(cleaned) == 1 and not frame.empty:
                    row = frame.tail(1).iloc[0]
            except Exception:
                row = None
            if row is None:
                quote = fetch_live_quote(sym)
                if quote:
                    out[sym] = quote
                continue
            close = row.get("Close")
            open_v = row.get("Open")
            volume = row.get("Volume")
            close_v = float(close) if pd.notna(close) else None
            open_f = float(open_v) if pd.notna(open_v) else None
            change = (close_v - open_f) if close_v is not None and open_f is not None else None
            change_pct = ((change / open_f) * 100.0) if change is not None and open_f else None
            out[sym] = {
                "symbol": sym,
                "price": close_v,
                "change": change,
                "change_pct": change_pct,
                "volume": float(volume) if pd.notna(volume) else None,
                "ts": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
            }
    except Exception:
        for sym in cleaned:
            quote = fetch_live_quote(sym)
            if quote:
                out[sym] = quote
    return out


def download_symbols(
    symbols: list[str],
    sleep_seconds: float = 1.5,
    on_progress: Callable[[int, int, str], None] | None = None,
) -> dict:
    setup_directories()
    ok = fail = 0
    n = len(symbols)
    logger.info(
        "download_symbols: starting batch n=%d sleep_seconds=%.3f data_dir=%s",
        n,
        sleep_seconds,
        os.path.abspath(DATA_DIR),
    )
    for i, sym in enumerate(symbols):
        if download_ticker_data(sym):
            ok += 1
            logger.info("[parquet] %d/%d %s OK", i + 1, n, sym)
        else:
            fail += 1
            logger.warning("[parquet] %d/%d %s FAIL", i + 1, n, sym)
        if on_progress:
            on_progress(i + 1, n, sym)
        if i < n - 1 and sleep_seconds > 0:
            time.sleep(sleep_seconds)
    logger.info("download_symbols: finished ok=%d fail=%d total=%d", ok, fail, n)
    return {
        "successful": ok,
        "failed": fail,
        "total": n,
        "data_dir": os.path.abspath(DATA_DIR),
    }
