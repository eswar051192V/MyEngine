from __future__ import annotations

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel
from datetime import datetime, timedelta
import json
import os
import sqlite3
import shutil
import threading
import time
import uuid
from urllib.parse import quote
import yfinance as yf
import pandas as pd
import numpy as np
import requests
import asyncio
import logging
import random

logger = logging.getLogger(__name__)

from market_download import parquet_symbol_key

from context.exchange_session import EXCHANGE_CALENDAR_KEY, EXCHANGE_COUNTRY_FALLBACK
from market_universe import (
    EXCHANGE_SCHEDULE,
    TICKERS_JSON,
    build_category_summaries,
    build_presets,
    get_symbols_by_exchange,
    load_tickers as load_universe_tickers,
    search_local_instruments,
    symbol_profile,
)
from backend.scheduler import (
    get_live_quote_cache,
    get_scheduler_logs,
    get_scheduler_status,
    pause_job,
    resume_job,
    start_scheduler,
    stop_scheduler,
    trigger_job_now,
)
from context.wikipedia_client import wikipedia_enrichment_from_yahoo
from context.india_mutual_funds import (
    MUTUAL_FUND_CATEGORY,
    get_mutual_fund_details,
    is_mutual_fund_symbol,
    load_scheme_registry,
    nav_history_as_ohlc,
    refresh_nav_history,
    refresh_scheme_registry,
    search_mutual_funds,
)

app = FastAPI()


@app.on_event("startup")
def _configure_download_logging() -> None:
    """Route download job logs to stderr so they always appear in the uvicorn terminal."""
    fmt = logging.Formatter("%(levelname)s [%(name)s] %(message)s")
    for name in ("market_download", __name__):
        lg = logging.getLogger(name)
        lg.setLevel(logging.INFO)
        if not lg.handlers:
            h = logging.StreamHandler()
            h.setFormatter(fmt)
            h.setLevel(logging.INFO)
            lg.addHandler(h)
        lg.propagate = False


@app.on_event("startup")
def _startup_scheduler() -> None:
    try:
        start_scheduler()
    except Exception:
        logger.exception("Scheduler startup failed")


@app.on_event("shutdown")
def _shutdown_scheduler() -> None:
    try:
        stop_scheduler()
    except Exception:
        logger.exception("Scheduler shutdown failed")


@app.get("/")
def root():
    """OpenAPI UI; the React dashboard is a separate dev server (see stock-analysis-dashboard)."""
    return RedirectResponse(url="/docs")


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# BROKER CREDENTIALS & SDK SETUP
# ==========================================
UPSTOX_ACCESS_TOKEN = "YOUR_UPSTOX_TOKEN_HERE"
ZERODHA_API_KEY = "YOUR_ZERODHA_API_KEY"
ZERODHA_ACCESS_TOKEN = "YOUR_ZERODHA_TOKEN"

UPSTOX_INDEX_MAP = {
    "^NSEI": "NSE_INDEX|Nifty 50",
    "^NSEBANK": "NSE_INDEX|Nifty Bank",
    "^CNXFIN": "NSE_INDEX|Nifty Fin Service",
    "^NSEMDCP50": "NSE_INDEX|Nifty Midcap 50",
    "^CNXIT": "NSE_INDEX|Nifty IT",
    "^CNXPHARMA": "NSE_INDEX|Nifty Pharma",
    "^CNXAUTO": "NSE_INDEX|Nifty Auto",
    "^CNXMETAL": "NSE_INDEX|Nifty Metal",
    "^CNXENERGY": "NSE_INDEX|Nifty Energy",
    "^CNXREALTY": "NSE_INDEX|Nifty Realty",
    "^CNXPSUBANK": "NSE_INDEX|Nifty PSU Bank",
    "^CNXINFRA": "NSE_INDEX|Nifty Infra",
}

CURRENCY_SYMBOLS = {
    "USD": "$",
    "INR": "₹",
    "GBP": "£",
    "EUR": "€",
    "JPY": "¥",
    "CAD": "C$",
    "AUD": "A$",
    "CNY": "¥",
}


class AIAnalysisRequest(BaseModel):
    symbol: str
    price: float
    zoneLabel: str
    positionPct: str
    daysActive: int
    model: str = "llama3"
    customPrompt: str = None


class CronJobRequest(BaseModel):
    category: str
    lookback: int
    cron_schedule: str


class DownloadAgentRequest(BaseModel):
    instruction: str
    model: str = "llama3.1"


class DownloadFullHistoryBody(BaseModel):
    include_intraday: bool = True
    intraday_15m_days: int = 60
    intraday_1h_days: int = 730


class DownloadAllAndCalculateBody(BaseModel):
    categories: list[str] | None = None
    limit: int | None = None
    sleep_seconds: float = 0.5
    include_intraday: bool = False
    intraday_15m_days: int = 60
    intraday_1h_days: int = 730
    lookback_days: int = 3650


class ConsumerQueryRequest(BaseModel):
    symbol: str
    question: str = "Summarize consumer complaint themes and how they line up with recent price action."
    k: int = 8
    months_back: int = 24
    model: str | None = None
    embed_model: str | None = None


class NewsRefreshBody(BaseModel):
    symbol: str | None = None
    symbols: list[str] | None = None


class WatchlistBody(BaseModel):
    symbols: list[str]


class InstrumentBatchQuoteBody(BaseModel):
    symbols: list[str]


class PortfoliosBody(BaseModel):
    portfolios: dict[str, list[dict]]


class PortfolioFeePreviewBody(BaseModel):
    platform: str | None = None
    country: str | None = "India"
    state: str | None = ""
    purchaseType: str | None = "Delivery"
    segment: str | None = "Equity"
    side: str = "BUY"
    quantity: float
    price: float
    manualCharge: float = 0.0
    manualTax: float = 0.0


class PortfolioImportPreviewBody(BaseModel):
    csv_text: str
    portfolio_name: str | None = "Main"
    platform: str | None = ""
    country: str | None = "India"
    state: str | None = ""
    purchaseType: str | None = "Delivery"
    segment: str | None = "Equity"
    side: str = "BUY"


class PortfolioImportCommitBody(BaseModel):
    portfolio_name: str
    preview_rows: list[dict]


class PortfolioCopilotContextBody(BaseModel):
    portfolio_name: str | None = None


class ContextAgentBody(BaseModel):
    symbol: str
    instruction: str | None = None
    model: str | None = None


class ResearchMLSignalsBody(BaseModel):
    symbols: list[str]
    lookback_days: int = 365
    forecast_horizon: int = 5
    train_window: int = 160


class NukeLocalDataBody(BaseModel):
    nuke_market_data: bool = True
    nuke_saved_news: bool = True
    nuke_open_context_ledger: bool = True
    nuke_consumer_cases: bool = True
    nuke_consumer_rag_db: bool = True
    nuke_watchlist_settings: bool = False
    recreate_folders: bool = True


class RedownloadAllBody(BaseModel):
    symbols: list[str] | None = None
    categories: list[str] | None = None
    limit: int | None = None
    sleep_seconds: float = 0.5


class ResetAndRedownloadBody(BaseModel):
    nuke_market_data: bool = True
    nuke_saved_news: bool = True
    nuke_open_context_ledger: bool = True
    nuke_consumer_cases: bool = True
    nuke_consumer_rag_db: bool = True
    nuke_watchlist_settings: bool = False
    recreate_folders: bool = True
    categories: list[str] | None = None
    limit: int | None = None
    sleep_seconds: float = 0.5


class BulkInfoLoadBody(BaseModel):
    symbols: list[str] | None = None
    categories: list[str] | None = None
    limit: int | None = None
    sleep_seconds: float = 0.5


class SchedulerLogQuery(BaseModel):
    limit: int = 100


REDOWNLOAD_JOBS: dict[str, dict] = {}
REDOWNLOAD_JOBS_LOCK = threading.Lock()
ALLDATA_JOBS: dict[str, dict] = {}
ALLDATA_JOBS_LOCK = threading.Lock()
BULK_INFO_JOBS: dict[str, dict] = {}
BULK_INFO_JOBS_LOCK = threading.Lock()


# ==========================================
# WEBSOCKET CONNECTION MANAGER
# ==========================================
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except RuntimeError:
                pass


manager = ConnectionManager()


def _ensure_ohlc_sqlite(db_path: str) -> None:
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    try:
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
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS instrument_info (
                symbol TEXT PRIMARY KEY,
                info_json TEXT,
                fetched_at TEXT
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_instrument_info_fetched_at ON instrument_info(fetched_at)"
        )
        conn.commit()
    finally:
        conn.close()


def _save_df_to_ohlc_sqlite(conn: sqlite3.Connection, symbol: str, interval: str, df: pd.DataFrame) -> int:
    if df is None or df.empty:
        return 0
    frame = df.copy()
    frame = frame[~frame.index.duplicated(keep="last")]
    frame.sort_index(inplace=True)
    rows = []
    for ts, row in frame.iterrows():
        ts_str = pd.Timestamp(ts).strftime("%Y-%m-%d %H:%M:%S")
        rows.append(
            (
                symbol,
                interval,
                ts_str,
                float(row.get("Open", np.nan)) if pd.notna(row.get("Open", np.nan)) else None,
                float(row.get("High", np.nan)) if pd.notna(row.get("High", np.nan)) else None,
                float(row.get("Low", np.nan)) if pd.notna(row.get("Low", np.nan)) else None,
                float(row.get("Close", np.nan)) if pd.notna(row.get("Close", np.nan)) else None,
                float(row.get("Volume", np.nan)) if pd.notna(row.get("Volume", np.nan)) else None,
            )
        )
    if not rows:
        return 0
    conn.executemany(
        """
        INSERT OR REPLACE INTO ohlc (symbol, interval, ts, open, high, low, close, volume)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    return len(rows)


YAHOO_CALL_SPACING_SEC = 0.5


def _sleep_between_yahoo_calls() -> None:
    time.sleep(YAHOO_CALL_SPACING_SEC)


def _normalize_index_naive_utc(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return df
    out = df.copy()
    idx = out.index
    if isinstance(idx, pd.DatetimeIndex) and idx.tz is not None:
        out.index = idx.tz_convert("UTC").tz_localize(None)
    return out


def _tiered_intraday_history_to_sqlite(conn: sqlite3.Connection, symbol: str, ticker: yf.Ticker) -> dict[str, int]:
    """
    Tiered intraday ladder (Yahoo limits apply; 15m beyond ~60d uses 60d rolling windows).
    0–7d: 1m; 7–60d: 2m (excluding last 7d overlap); 61–729d: 15m in ~60d chunks.
    Daily 730d–5y and full history are covered by separate 1d max pulls.
    """
    stats: dict[str, int] = {}
    df1 = ticker.history(period="7d", interval="1m", auto_adjust=False)
    df1 = _normalize_index_naive_utc(df1)
    stats["1m_rows"] = _save_df_to_ohlc_sqlite(conn, symbol, "1m", df1)
    _sleep_between_yahoo_calls()

    df2 = ticker.history(period="60d", interval="2m", auto_adjust=False)
    df2 = _normalize_index_naive_utc(df2)
    if df2 is not None and not df2.empty:
        cutoff = pd.Timestamp.utcnow() - pd.Timedelta(days=7)
        df2 = df2[df2.index < cutoff]
        stats["2m_rows"] = _save_df_to_ohlc_sqlite(conn, symbol, "2m", df2)
    else:
        stats["2m_rows"] = 0
    _sleep_between_yahoo_calls()

    now = pd.Timestamp.utcnow()
    seg_end = now - pd.Timedelta(days=61)
    seg_floor = now - pd.Timedelta(days=729)
    total_15 = 0
    safety = 0
    while seg_end > seg_floor and safety < 32:
        safety += 1
        seg_start = max(seg_floor, seg_end - pd.Timedelta(days=60))
        df15 = ticker.history(
            start=seg_start.strftime("%Y-%m-%d"),
            end=seg_end.strftime("%Y-%m-%d"),
            interval="15m",
            auto_adjust=False,
        )
        df15 = _normalize_index_naive_utc(df15)
        if df15 is not None and not df15.empty:
            total_15 += _save_df_to_ohlc_sqlite(conn, symbol, "15m", df15)
        _sleep_between_yahoo_calls()
        seg_end = seg_start - pd.Timedelta(seconds=1)
    stats["15m_rows"] = total_15
    return stats


def _download_symbol_full_to_db(
    symbol: str,
    db_path: str,
    include_intraday: bool = True,
    intraday_15m_days: int = 60,
    intraday_1h_days: int = 730,
) -> dict:
    """
    Persist Yahoo OHLC into SQLite. Daily/weekly/monthly: max history.
    Intraday: tiered 1m/2m/15m ladder plus 1h long intraday window (intraday_* params retained for API compat).
    """
    _ensure_ohlc_sqlite(db_path)
    ticker = yf.Ticker(symbol)
    stats: dict[str, int] = {}
    with sqlite3.connect(db_path) as conn:
        for interval in ("1d", "1wk", "1mo"):
            df = ticker.history(period="max", interval=interval, auto_adjust=False)
            df = _normalize_index_naive_utc(df)
            stats[f"{interval}_rows"] = _save_df_to_ohlc_sqlite(conn, symbol, interval, df)
            _sleep_between_yahoo_calls()

        if include_intraday:
            intra = _tiered_intraday_history_to_sqlite(conn, symbol, ticker)
            stats.update(intra)
            i1h = max(1, int(intraday_1h_days))
            df_1h = ticker.history(period=f"{i1h}d", interval="1h", auto_adjust=False)
            df_1h = _normalize_index_naive_utc(df_1h)
            stats["1h_rows"] = _save_df_to_ohlc_sqlite(conn, symbol, "1h", df_1h)
            _sleep_between_yahoo_calls()

        conn.commit()

    return {
        "symbol": symbol,
        "db_path": os.path.abspath(db_path),
        "saved_rows": stats,
        "note": "Daily/weekly/monthly: Yahoo max. Intraday: tiered 1m/2m/15m plus 1h window; 15m 61–729d uses 60d Yahoo windows.",
    }


def _fork_from_rows(rows: list[dict], lookback_bars: int = 2500) -> dict | None:
    if not rows or len(rows) < 5:
        return None
    data = rows[-lookback_bars:] if lookback_bars and lookback_bars > 0 else rows
    if len(data) < 5:
        return None

    def _build_at(i: int):
        if i < 1 or i >= len(data) - 1:
            return None
        p1, p2, p3 = data[i - 1], data[i], data[i + 1]
        h1, h2, h3 = float(p1["high"]), float(p2["high"]), float(p3["high"])
        l1, l2, l3 = float(p1["low"]), float(p2["low"]), float(p3["low"])
        x1, x2, x3 = i - 1, i, i + 1
        end_x = len(data) - 1
        curr_close = float(data[end_x]["close"])

        if h2 > h1 and h2 > h3:
            pivot_type = "LHL"
            P1, P2, P3 = {"ix": x1, "py": l1}, {"ix": x2, "py": h2}, {"ix": x3, "py": l3}
        elif l2 < l1 and l2 < l3:
            pivot_type = "HLH"
            P1, P2, P3 = {"ix": x1, "py": h1}, {"ix": x2, "py": l2}, {"ix": x3, "py": h3}
        else:
            return None

        mx, my = (P2["ix"] + P3["ix"]) / 2.0, (P2["py"] + P3["py"]) / 2.0
        sx, sy = P1["ix"], P1["py"]
        den = mx - sx
        if abs(den) < 1e-12:
            return None
        m = (my - sy) / den

        def y_p2(j): return P2["py"] + m * (j - P2["ix"])
        def y_p3(j): return P3["py"] + m * (j - P3["ix"])

        def bounds(j):
            a, b = y_p2(j), y_p3(j)
            return (min(a, b), max(a, b))

        total_future = end_x - x3
        inside_streak = 0
        for j in range(x3 + 1, len(data)):
            lb, ub = bounds(j)
            lo, hi = float(data[j]["low"]), float(data[j]["high"])
            if lo >= lb and hi <= ub:
                inside_streak += 1
            else:
                break

        if total_future < 3 or inside_streak != total_future:
            return None

        lb_now, ub_now = bounds(end_x)
        rng = max(1e-9, ub_now - lb_now)
        pos_pct = ((curr_close - lb_now) / rng) * 100.0
        if pos_pct <= 20:
            zone = "Testing Support"
        elif pos_pct >= 80:
            zone = "Testing Resistance"
        elif 45 <= pos_pct <= 55:
            zone = "Testing Median"
        else:
            zone = "Neutral Zone"

        return {
            "type": pivot_type,
            "variation": "Standard",
            "date": data[i]["ts"],
            "daysActive": inside_streak,
            "totalFutureBars": total_future,
            "encompassesAllFutureOhlc": True,
            "positionPct": round(pos_pct, 1),
            "zoneLabel": zone,
            "nearnessScore": round(min(pos_pct, 100 - pos_pct, abs(50 - pos_pct)), 3),
            "isActive": True,
        }

    best = None
    for i in range(1, len(data) - 1):
        pf = _build_at(i)
        if not pf:
            continue
        if best is None or pf["nearnessScore"] < best["nearnessScore"]:
            best = pf
    return best


def _load_symbol_daily_rows_from_db(conn: sqlite3.Connection, symbol: str, lookback_days: int) -> list[dict]:
    bars = max(300, int(lookback_days))
    cur = conn.execute(
        """
        SELECT ts, open, high, low, close, volume
        FROM ohlc
        WHERE symbol = ? AND interval = '1d'
        ORDER BY ts DESC
        LIMIT ?
        """,
        (symbol, bars),
    )
    rows = [
        {"ts": r[0], "open": r[1], "high": r[2], "low": r[3], "close": r[4], "volume": r[5]}
        for r in cur.fetchall()
    ]
    rows.reverse()
    return rows


def _run_download_all_and_calculate_job(job_id: str, body: DownloadAllAndCalculateBody) -> None:
    import market_download as md
    import time as _time

    def _set(update: dict) -> None:
        with ALLDATA_JOBS_LOCK:
            ALLDATA_JOBS[job_id].update(update)

    _set({"status": "running"})
    try:
        md.setup_directories()
        db_path = os.path.join("local_market_data", "ohlc.sqlite")
        _ensure_ohlc_sqlite(db_path)

        if body.categories:
            tdb = md.load_tickers()
            symbols = []
            for cat in body.categories:
                symbols.extend(tdb.get(cat, []))
            symbols = sorted(set(symbols))
        else:
            symbols = md.all_symbols_flat()
        if body.limit and body.limit > 0:
            symbols = symbols[: body.limit]
        total = len(symbols)
        _set({"total": total, "current": 0, "current_symbol": None})
        if total == 0:
            _set({"status": "failed", "error": "No symbols found."})
            return

        logger.info(
            "download-all-calculate job %s: %d symbols categories=%s limit=%s intraday=%s",
            job_id,
            total,
            body.categories,
            body.limit,
            body.include_intraday,
        )

        out_results = []
        ok = fail = 0
        for i, sym in enumerate(symbols):
            _set({"current": i + 1, "current_symbol": sym})
            logger.info("[full-db] %d/%d %s — fetching Yahoo → SQLite + fork scan", i + 1, total, sym)
            try:
                _download_symbol_full_to_db(
                    symbol=sym,
                    db_path=db_path,
                    include_intraday=body.include_intraday,
                    intraday_15m_days=body.intraday_15m_days,
                    intraday_1h_days=body.intraday_1h_days,
                )
                ok += 1
                with sqlite3.connect(db_path) as conn:
                    rows = _load_symbol_daily_rows_from_db(conn, sym, body.lookback_days)
                pf = _fork_from_rows(rows, lookback_bars=max(300, body.lookback_days))
                if pf:
                    out_results.append({"symbol": sym, "fork": pf})
                logger.info("[full-db] %d/%d %s OK (fork=%s)", i + 1, total, sym, "yes" if pf else "no")
            except Exception as exc:
                fail += 1
                logger.warning("[full-db] %d/%d %s FAIL: %s", i + 1, total, sym, exc)
            if i < total - 1 and body.sleep_seconds > 0:
                _time.sleep(float(body.sleep_seconds))

        out_results.sort(key=lambda x: x["fork"]["nearnessScore"])
        _set(
            {
                "status": "completed",
                "stats": {"successful": ok, "failed": fail, "total": total, "matches": len(out_results)},
                "results": out_results[:800],
            }
        )
        logger.info(
            "download-all-calculate job %s: done ok=%d fail=%d fork_matches=%d",
            job_id,
            ok,
            fail,
            len(out_results),
        )
    except Exception as e:
        logger.exception("download-all-calculate job %s failed", job_id)
        _set({"status": "failed", "error": str(e)})


def _safe_remove_path(path: str, *, is_dir: bool) -> bool:
    if not os.path.exists(path):
        return False
    if is_dir:
        shutil.rmtree(path)
    else:
        os.remove(path)
    return True


def _read_local_series(symbol: str, interval: str = "1d", lookback_days: int = 365) -> pd.DataFrame:
    """
    Local-first series loader.
    Priority:
      1) local_market_data/{interval}/{symbol}.parquet
      2) local_market_data/ohlc.sqlite table
      3) Yahoo fallback
    """
    cutoff = pd.Timestamp.utcnow() - pd.Timedelta(days=max(30, int(lookback_days)))

    # 1) Parquet (try filesystem-safe key first, then legacy raw symbol path)
    try:
        safe_key = parquet_symbol_key(symbol)
        raw_sym = str(symbol).strip().upper()
        parquet_paths = [os.path.join("local_market_data", interval, f"{safe_key}.parquet")]
        if safe_key != raw_sym:
            parquet_paths.append(os.path.join("local_market_data", interval, f"{raw_sym}.parquet"))
        p = next((x for x in parquet_paths if os.path.exists(x)), None)
        if p:
            df = pd.read_parquet(p)
            if not df.empty:
                if not isinstance(df.index, pd.DatetimeIndex):
                    if "Date" in df.columns:
                        df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
                        df = df.set_index("Date")
                    elif "Datetime" in df.columns:
                        df["Datetime"] = pd.to_datetime(df["Datetime"], errors="coerce")
                        df = df.set_index("Datetime")
                if isinstance(df.index, pd.DatetimeIndex):
                    df = df[df.index >= cutoff]
                df = df.sort_index()
                if "Close" in df.columns:
                    return df
    except Exception:
        pass

    # 2) SQLite
    try:
        dbp = os.path.join("local_market_data", "ohlc.sqlite")
        if os.path.exists(dbp):
            conn = sqlite3.connect(dbp)
            try:
                rows = conn.execute(
                    """
                    SELECT ts, open, high, low, close, volume
                    FROM ohlc
                    WHERE symbol = ? AND interval = ?
                    ORDER BY ts ASC
                    """,
                    (symbol, interval),
                ).fetchall()
            finally:
                conn.close()
            if rows:
                df = pd.DataFrame(rows, columns=["ts", "Open", "High", "Low", "Close", "Volume"])
                df["ts"] = pd.to_datetime(df["ts"], errors="coerce")
                df = df.set_index("ts").sort_index()
                df = df[df.index >= cutoff]
                if not df.empty:
                    return df
    except Exception:
        pass

    # 3) Yahoo fallback
    try:
        period = f"{max(60, int(lookback_days))}d"
        df = yf.Ticker(symbol).history(period=period, interval=interval)
        if not df.empty:
            return df.sort_index()
    except Exception:
        pass
    return pd.DataFrame()


def _info_db_path() -> str:
    return os.path.join("local_market_data", "ohlc.sqlite")


def _normalize_symbols(raw_symbols: list[str] | None) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for symbol in raw_symbols or []:
        sym = str(symbol).strip().upper()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        out.append(sym)
    return out


def _resolve_bulk_info_symbols(body: BulkInfoLoadBody) -> list[str]:
    explicit = _normalize_symbols(body.symbols)
    if explicit:
        symbols = explicit
    else:
        universe = load_universe_tickers()
        if body.categories:
            symbols = []
            for cat in body.categories:
                symbols.extend(universe.get(cat, []))
            symbols = sorted(set([str(s).strip().upper() for s in symbols if str(s).strip()]))
        else:
            symbols = sorted(
                set([str(sym).strip().upper() for row in universe.values() for sym in (row or []) if str(sym).strip()])
            )
    if body.limit and body.limit > 0:
        symbols = symbols[: body.limit]
    return symbols


def _save_instrument_info(conn: sqlite3.Connection, symbol: str, info: dict) -> None:
    conn.execute(
        """
        INSERT OR REPLACE INTO instrument_info(symbol, info_json, fetched_at)
        VALUES (?, ?, ?)
        """,
        (symbol, json.dumps(info or {}), datetime.utcnow().isoformat()),
    )


def _read_cached_instrument_info(symbol: str) -> dict:
    db_path = _info_db_path()
    _ensure_ohlc_sqlite(db_path)
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT info_json, fetched_at FROM instrument_info WHERE symbol = ?",
            (symbol,),
        ).fetchone()
    if not row:
        return {}
    info_json, fetched_at = row
    try:
        payload = json.loads(info_json or "{}")
    except Exception:
        payload = {}
    return {"symbol": symbol, "info": payload, "fetched_at": fetched_at}


def _is_cache_stale(fetched_at: str | None, max_age_hours: int = 24) -> bool:
    if not fetched_at:
        return True
    try:
        dt = datetime.fromisoformat(str(fetched_at))
    except Exception:
        return True
    return dt < (datetime.utcnow() - timedelta(hours=max(1, int(max_age_hours))))


def _fetch_and_cache_instrument_info(symbol: str) -> dict:
    info = yf.Ticker(symbol).info or {}
    _sleep_between_yahoo_calls()
    wiki = wikipedia_enrichment_from_yahoo(info, symbol)
    merged = {**info, **wiki}
    db_path = _info_db_path()
    _ensure_ohlc_sqlite(db_path)
    with sqlite3.connect(db_path) as conn:
        _save_instrument_info(conn, symbol, merged)
        conn.commit()
    return {"symbol": symbol, "info": merged, "fetched_at": datetime.utcnow().isoformat()}


def _run_bulk_info_job(job_id: str, body: BulkInfoLoadBody) -> None:
    def _set(update: dict) -> None:
        with BULK_INFO_JOBS_LOCK:
            BULK_INFO_JOBS[job_id].update(update)

    _set({"status": "running"})
    symbols = _resolve_bulk_info_symbols(body)
    total = len(symbols)
    _set({"total": total, "current": 0, "current_symbol": None})
    if total == 0:
        _set({"status": "failed", "error": "No symbols found for info load."})
        return
    ok = fail = 0
    db_path = _info_db_path()
    _ensure_ohlc_sqlite(db_path)
    with sqlite3.connect(db_path) as conn:
        for idx, symbol in enumerate(symbols):
            _set({"current": idx + 1, "current_symbol": symbol})
            try:
                info = yf.Ticker(symbol).info or {}
                _sleep_between_yahoo_calls()
                wiki = wikipedia_enrichment_from_yahoo(info, symbol)
                merged = {**info, **wiki}
                _save_instrument_info(conn, symbol, merged)
                ok += 1
            except Exception as exc:
                fail += 1
                logger.warning("bulk-info %s failed: %s", symbol, exc)
            if idx < total - 1 and body.sleep_seconds > 0:
                time.sleep(float(body.sleep_seconds))
        conn.commit()
    _set({"status": "completed", "stats": {"successful": ok, "failed": fail, "total": total}})


def _dir_size_bytes(path: str) -> int:
    total = 0
    if not os.path.exists(path):
        return 0
    for root, _, files in os.walk(path):
        for name in files:
            fp = os.path.join(root, name)
            try:
                total += os.path.getsize(fp)
            except OSError:
                continue
    return total


def _nuke_local_data(body: NukeLocalDataBody) -> dict:
    removed: list[str] = []
    skipped: list[str] = []

    targets = [
        ("local_market_data", True, body.nuke_market_data),
        ("context_data/news", True, body.nuke_saved_news),
        ("context_data/open_context/ledger.jsonl", False, body.nuke_open_context_ledger),
        ("context_data/india_consumer/cases.jsonl", False, body.nuke_consumer_cases),
        ("context_data/india_consumer/rag.sqlite", False, body.nuke_consumer_rag_db),
        ("user_settings.json", False, body.nuke_watchlist_settings),
    ]
    for rel_path, is_dir, enabled in targets:
        if not enabled:
            skipped.append(rel_path)
            continue
        abs_path = os.path.abspath(rel_path)
        try:
            if _safe_remove_path(abs_path, is_dir=is_dir):
                removed.append(rel_path)
        except Exception as e:
            return {"ok": False, "error": f"Failed removing {rel_path}: {e}"}

    recreated: list[str] = []
    if body.recreate_folders:
        from market_download import setup_directories
        from context.india_consumer_paths import ensure_consumer_dirs

        setup_directories()
        os.makedirs("context_data/news", exist_ok=True)
        os.makedirs("context_data/open_context", exist_ok=True)
        ensure_consumer_dirs()
        recreated = [
            "local_market_data/*",
            "context_data/news",
            "context_data/open_context",
            "context_data/india_consumer",
        ]

    return {"ok": True, "removed": removed, "skipped": skipped, "recreated": recreated}


def _run_redownload_job(job_id: str, body: RedownloadAllBody) -> None:
    import market_download as md

    def _set(update: dict) -> None:
        with REDOWNLOAD_JOBS_LOCK:
            REDOWNLOAD_JOBS[job_id].update(update)

    MAX_EXPLICIT_SYMBOLS = 500

    _set({"status": "running"})
    try:
        md.setup_directories()
        explicit = [s.strip().upper() for s in (body.symbols or []) if s and s.strip()]
        seen: set[str] = set()
        explicit = [s for s in explicit if not (s in seen or seen.add(s))]

        if explicit:
            symbols = explicit[:MAX_EXPLICIT_SYMBOLS]
        elif body.categories:
            tdb = md.load_tickers()
            symbols = []
            for cat in body.categories:
                symbols.extend(tdb.get(cat, []))
            symbols = sorted(set(symbols))
        else:
            symbols = md.all_symbols_flat()

        if not explicit and body.limit and body.limit > 0:
            symbols = symbols[: body.limit]
        total = len(symbols)
        _set({"total": total, "current": 0, "current_symbol": None})
        if total == 0:
            _set({"status": "failed", "error": "No symbols found to download."})
            return

        logger.info(
            "redownload job %s: %d symbols explicit=%s categories=%s limit=%s",
            job_id,
            total,
            bool(explicit),
            body.categories,
            body.limit,
        )

        def on_progress(i: int, n: int, sym: str) -> None:
            _set({"current": i, "total": n, "current_symbol": sym})

        stats = md.download_symbols(
            symbols,
            sleep_seconds=max(0.0, float(body.sleep_seconds)),
            on_progress=on_progress,
        )
        _set({"status": "completed", "stats": stats})
        logger.info("redownload job %s: completed %s", job_id, stats)
    except Exception as e:
        logger.exception("redownload job %s failed", job_id)
        _set({"status": "failed", "error": str(e)})


@app.websocket("/ws/live/{symbol}")
async def live_ticker_socket(websocket: WebSocket, symbol: str):
    await manager.connect(websocket)
    try:
        base_price = 100.0
        try:
            ticker = yf.Ticker(symbol)
            base_price = ticker.info.get("regularMarketPrice", 100.0)
        except Exception:
            pass

        while True:
            fluctuation = random.uniform(-0.05, 0.05)
            base_price = base_price * (1 + (fluctuation / 100))
            payload = {
                "symbol": symbol,
                "live_price": round(base_price, 2),
                "volume_tick": random.randint(1, 500),
            }

            await websocket.send_text(json.dumps(payload))
            await asyncio.sleep(0.5)

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


# ==========================================
# TICKER & ASSET ENDPOINTS (REST)
# ==========================================
@app.get("/api/tickers")
def get_all_tickers():
    data = load_universe_tickers()
    if data:
        return data
    return {
        "error": f"Ticker universe is empty or file missing. Expected data at {TICKERS_JSON} (set TICKERS_JSON to override). Run fetch_all_tickers.py from the project root if needed.",
    }


@app.get("/api/tickers/summary")
def get_ticker_category_summary():
    data = load_universe_tickers()
    return {"ok": True, "categories": build_category_summaries(data)}


@app.get("/api/tickers/presets")
def get_ticker_presets():
    data = load_universe_tickers()
    return {"ok": True, "presets": build_presets(data)}


@app.get("/api/search/instruments")
def search_instruments(q: str, limit: int = 20):
    query = (q or "").strip()
    if not query:
        return {"ok": True, "results": []}
    lim = max(1, min(int(limit or 20), 60))

    results = []
    seen = set()
    universe = load_universe_tickers()

    # 1) Local universe symbol match (fast, offline for known tickers)
    try:
        for row in search_local_instruments(query, limit=lim * 2, data=universe):
            sym = str(row.get("symbol") or "").upper()
            if not sym or sym in seen:
                continue
            seen.add(sym)
            results.append(row)
            if len(results) >= lim:
                return {"ok": True, "results": results[:lim]}
    except Exception:
        pass

    # 2) India mutual fund search (AMFI-backed registry)
    try:
        for row in search_mutual_funds(query, limit=lim * 2):
            sym = str(row.get("symbol") or "").upper()
            if not sym or sym in seen:
                continue
            seen.add(sym)
            results.append(row)
            if len(results) >= lim:
                return {"ok": True, "results": results[:lim]}
    except Exception:
        pass

    # 3) Yahoo instrument search (company names, FX pairs, crypto, ETFs, etc.)
    try:
        r = requests.get(
            "https://query2.finance.yahoo.com/v1/finance/search",
            params={"q": query, "quotesCount": max(10, lim), "newsCount": 0},
            timeout=12,
            headers={"User-Agent": "Mozilla/5.0"},
        )
        if r.status_code == 200:
            data = r.json() if r.text else {}
            quotes = data.get("quotes", []) or []
            for row in quotes:
                sym = str(row.get("symbol") or "").strip().upper()
                if not sym or sym in seen:
                    continue
                seen.add(sym)
                profile = symbol_profile(sym, universe)
                results.append(
                    {
                        "symbol": sym,
                        "name": row.get("shortname") or row.get("longname") or profile["display_name"] or sym,
                        "assetType": profile["category_label"] if profile["primary_category"] else (row.get("quoteType") or "Instrument"),
                        "assetFamily": profile["asset_family"] if profile["primary_category"] else (row.get("quoteType") or "instrument"),
                        "exchange": profile["exchange"] or row.get("exchDisp") or row.get("exchange") or "",
                        "region": profile["region"],
                        "isProxy": profile["is_proxy"],
                        "categories": profile["categories"],
                        "source": "yahoo",
                    }
                )
                if len(results) >= lim:
                    break
    except Exception:
        pass

    return {"ok": True, "results": results[:lim]}


@app.get("/api/mf/categories")
def mf_categories():
    """Return distinct scheme categories and fund houses for MF browser filters."""
    registry = load_scheme_registry(auto_refresh=True)
    schemes = registry.get("schemes") or []
    categories = sorted({str(s.get("scheme_category") or "").strip() for s in schemes if str(s.get("scheme_category") or "").strip()})
    fund_houses = sorted({str(s.get("fund_house") or "").strip() for s in schemes if str(s.get("fund_house") or "").strip()})
    return {"ok": True, "total_schemes": len(schemes), "categories": categories, "fund_houses": fund_houses}


@app.get("/api/mf/browse")
def mf_browse(q: str = "", category: str = "", fund_house: str = "", offset: int = 0, limit: int = 50):
    """Paginated MF scheme browser with optional search and filters."""
    registry = load_scheme_registry(auto_refresh=True)
    schemes = registry.get("schemes") or []

    query = (q or "").strip().lower()
    cat_filter = (category or "").strip().lower()
    house_filter = (fund_house or "").strip().lower()
    lim = max(1, min(int(limit or 50), 200))
    off = max(0, int(offset or 0))

    filtered = []
    for s in schemes:
        if cat_filter and cat_filter not in str(s.get("scheme_category") or "").lower():
            continue
        if house_filter and house_filter not in str(s.get("fund_house") or "").lower():
            continue
        if query:
            haystack = " ".join([
                str(s.get("scheme_code") or ""),
                str(s.get("scheme_name") or ""),
                str(s.get("fund_house") or ""),
                str(s.get("scheme_category") or ""),
                str(s.get("isin_growth") or ""),
            ]).lower()
            if query not in haystack:
                continue
        filtered.append({
            "scheme_code": s.get("scheme_code"),
            "symbol": s.get("symbol"),
            "scheme_name": s.get("scheme_name"),
            "fund_house": s.get("fund_house"),
            "scheme_category": s.get("scheme_category"),
            "scheme_type": s.get("scheme_type"),
            "latest_nav": s.get("latest_nav"),
            "latest_nav_date": s.get("latest_nav_date"),
        })

    total = len(filtered)
    page = filtered[off : off + lim]
    return {"ok": True, "total": total, "offset": off, "limit": lim, "schemes": page}


@app.get("/api/gold-rates")
def gold_rates(refresh: bool = False):
    """Indian city-wise gold rates (22K/24K) scraped from goodreturns.in."""
    try:
        from context.india_gold_rates import load_gold_rates
        return load_gold_rates(force_refresh=refresh)
    except Exception as exc:
        return {"error": str(exc), "gold_22k": {}, "gold_24k": {}}


@app.get("/api/silver-rates")
def silver_rates(refresh: bool = False):
    """Indian city-wise silver rates scraped from goodreturns.in."""
    try:
        from context.india_gold_rates import load_silver_rates
        return load_silver_rates(force_refresh=refresh)
    except Exception as exc:
        return {"error": str(exc), "silver": {}}


@app.get("/api/precious-metals/india")
def precious_metals_india(refresh: bool = False):
    """Combined gold + silver Indian rates."""
    try:
        from context.india_gold_rates import load_all_precious_rates
        return load_all_precious_rates(force_refresh=refresh)
    except Exception as exc:
        return {"error": str(exc)}


@app.get("/api/macro/snapshot")
def macro_snapshot(lookback_days: int = 365):
    """
    Local-first macro proxy snapshot.
    Returns normalized proxy series + regime pressures for frontend Macro Lab.
    """
    lb = max(90, min(int(lookback_days or 365), 3650))
    proxies = {
        "risk": {"symbol": "SPY", "name": "Risk Proxy (SPY)"},
        "rates": {"symbol": "TLT", "name": "Rates Proxy (TLT)"},
        "inflation": {"symbol": "DBC", "name": "Commodity/Inflation Proxy (DBC)"},
        "fx": {"symbol": "UUP", "name": "USD Proxy (UUP)"},
    }

    out = {}
    returns_means = {}
    for key, meta in proxies.items():
        sym = meta["symbol"]
        df = _read_local_series(sym, interval="1d", lookback_days=lb)
        if df.empty or "Close" not in df.columns:
            out[key] = {
                "symbol": sym,
                "name": meta["name"],
                "series": [],
                "returns": [],
                "last_return": 0.0,
                "source": "missing",
            }
            returns_means[key] = 0.0
            continue

        px = pd.to_numeric(df["Close"], errors="coerce").dropna()
        px = px[~px.index.duplicated(keep="last")]
        px = px.sort_index().tail(lb)
        rets = np.log(px / px.shift(1)).dropna()
        last_ret = float(rets.iloc[-1]) if len(rets) else 0.0
        mu = float(rets.tail(min(20, len(rets))).mean()) if len(rets) else 0.0
        returns_means[key] = mu
        out[key] = {
            "symbol": sym,
            "name": meta["name"],
            "series": [
                {"x": ts.strftime("%Y-%m-%d"), "y": round(float(v), 6)}
                for ts, v in px.tail(lb).items()
            ],
            "returns": [round(float(x), 8) for x in rets.tail(lb).tolist()],
            "last_return": round(last_ret, 8),
            "source": "local-first",
        }

    # Regime signals in [-3, +3] style band.
    risk_on = float(np.clip(returns_means.get("risk", 0.0) * 400, -3, 3))
    rates_pressure = float(np.clip(-returns_means.get("rates", 0.0) * 400, -3, 3))
    inflation_pressure = float(np.clip(returns_means.get("inflation", 0.0) * 350, -3, 3))
    usd_pressure = float(np.clip(returns_means.get("fx", 0.0) * 350, -3, 3))

    return {
        "ok": True,
        "lookback_days": lb,
        "proxies": out,
        "regime": {
            "riskOn": round(risk_on, 4),
            "ratesPressure": round(rates_pressure, 4),
            "inflationPressure": round(inflation_pressure, 4),
            "usdPressure": round(usd_pressure, 4),
        },
    }


def _sigmoid(x: float) -> float:
    return float(1.0 / (1.0 + np.exp(-np.clip(x, -20, 20))))


def _fit_linear_signal_model(close: pd.Series, forecast_horizon: int, train_window: int) -> dict | None:
    px = pd.to_numeric(close, errors="coerce").dropna()
    px = px[~px.index.duplicated(keep="last")].sort_index()
    if len(px) < max(80, forecast_horizon + 30):
        return None

    ret_1 = np.log(px / px.shift(1))
    ret_5 = np.log(px / px.shift(5))
    ret_20 = np.log(px / px.shift(20))
    vol_20 = ret_1.rolling(20).std()
    sma_10 = px.rolling(10).mean()
    sma_20 = px.rolling(20).mean()
    sma_50 = px.rolling(50).mean()
    ma_spread = (sma_10 / sma_20) - 1.0
    ma_long = (px / sma_50) - 1.0
    target = np.log(px.shift(-forecast_horizon) / px)

    frame = pd.DataFrame(
        {
            "ret_1": ret_1,
            "ret_5": ret_5,
            "ret_20": ret_20,
            "vol_20": vol_20,
            "ma_spread": ma_spread,
            "ma_long": ma_long,
            "target": target,
        }
    ).dropna()
    if len(frame) < max(50, forecast_horizon + 15):
        return None

    feature_cols = ["ret_1", "ret_5", "ret_20", "vol_20", "ma_spread", "ma_long"]
    if train_window > 0 and len(frame) > train_window:
        frame = frame.tail(train_window)

    val_size = max(12, min(30, len(frame) // 4))
    train = frame.iloc[:-val_size]
    valid = frame.iloc[-val_size:]
    if len(train) < 20 or len(valid) < 5:
        return None

    x_train = train[feature_cols].to_numpy(dtype=float)
    y_train = train["target"].to_numpy(dtype=float)
    x_valid = valid[feature_cols].to_numpy(dtype=float)
    y_valid = valid["target"].to_numpy(dtype=float)
    x_last = frame[feature_cols].iloc[-1].to_numpy(dtype=float)

    mu = x_train.mean(axis=0)
    sigma = x_train.std(axis=0)
    sigma[sigma < 1e-9] = 1.0
    x_train_z = (x_train - mu) / sigma
    x_valid_z = (x_valid - mu) / sigma
    x_last_z = (x_last - mu) / sigma

    x_design = np.column_stack([np.ones(len(x_train_z)), x_train_z])
    coeffs, _, _, _ = np.linalg.lstsq(x_design, y_train, rcond=None)
    valid_pred = np.column_stack([np.ones(len(x_valid_z)), x_valid_z]) @ coeffs
    last_pred = float(np.array([1.0, *x_last_z]) @ coeffs)

    direction_accuracy = float(np.mean(np.sign(valid_pred) == np.sign(y_valid))) if len(y_valid) else 0.0
    mae = float(np.mean(np.abs(valid_pred - y_valid))) if len(y_valid) else 0.0
    baseline_vol = float(np.nanmean(np.abs(y_valid))) if len(y_valid) else 0.0
    normalized_signal = last_pred / max(float(frame["target"].std()), 1e-6)
    prob_up = _sigmoid(normalized_signal)
    confidence = float(np.clip(0.45 * direction_accuracy + 0.55 * (1.0 - min(1.0, mae / max(baseline_vol, 1e-6))), 0.0, 1.0))

    latest = frame.iloc[-1]
    return {
        "predicted_return_pct": round(last_pred * 100.0, 3),
        "probability_up_pct": round(prob_up * 100.0, 1),
        "direction_accuracy_pct": round(direction_accuracy * 100.0, 1),
        "confidence_pct": round(confidence * 100.0, 1),
        "volatility_pct": round(float(latest["vol_20"]) * np.sqrt(252) * 100.0, 2),
        "momentum_20_pct": round(float(latest["ret_20"]) * 100.0, 2),
        "feature_weights": {
            name: round(float(weight), 4)
            for name, weight in zip(feature_cols, coeffs[1:])
        },
        "training_samples": int(len(train)),
        "validation_samples": int(len(valid)),
    }


@app.post("/api/research/ml/signals")
def research_ml_signals(body: ResearchMLSignalsBody):
    symbols = [str(s).strip().upper() for s in (body.symbols or []) if str(s).strip()]
    symbols = list(dict.fromkeys(symbols))[:24]
    if not symbols:
        return {"ok": False, "error": "Provide at least one symbol."}

    lookback_days = max(120, min(int(body.lookback_days or 365), 3650))
    forecast_horizon = max(1, min(int(body.forecast_horizon or 5), 20))
    train_window = max(60, min(int(body.train_window or 160), 400))

    rows = []
    for symbol in symbols:
        try:
            df = _read_local_series(symbol, interval="1d", lookback_days=lookback_days + 120)
            if df.empty or "Close" not in df.columns:
                rows.append({"symbol": symbol, "error": "No local or Yahoo daily close data available."})
                continue
            model = _fit_linear_signal_model(df["Close"], forecast_horizon=forecast_horizon, train_window=train_window)
            if not model:
                rows.append({"symbol": symbol, "error": "Not enough history to fit signal model."})
                continue
            signal = model["predicted_return_pct"]
            if signal > 1.0:
                label = "Bullish"
            elif signal < -1.0:
                label = "Bearish"
            else:
                label = "Neutral"
            rows.append(
                {
                    "symbol": symbol,
                    "label": label,
                    **model,
                }
            )
        except Exception as e:
            rows.append({"symbol": symbol, "error": str(e)})

    ranked = [row for row in rows if not row.get("error")]
    ranked.sort(
        key=lambda row: (
            -(abs(float(row.get("predicted_return_pct", 0.0))) * float(row.get("confidence_pct", 0.0))),
            row["symbol"],
        )
    )
    errors = [row for row in rows if row.get("error")]
    return {
        "ok": True,
        "lookback_days": lookback_days,
        "forecast_horizon": forecast_horizon,
        "train_window": train_window,
        "rows": ranked + errors,
        "successful": len(ranked),
        "failed": len(errors),
    }


def _safe_round(val, digits=2):
    """Round numeric values safely; return None for missing/invalid."""
    if val is None:
        return None
    try:
        n = float(val)
        if not (n == n):  # NaN check
            return None
        return round(n, digits)
    except (TypeError, ValueError):
        return None


def _wiki_for_ticker(info: dict, symbol: str) -> dict:
    """Get Wikipedia metadata — prefer cached instrument_info, fall back to live lookup."""
    cached = _read_cached_instrument_info(symbol)
    ci = (cached.get("info") or {}) if cached else {}
    if ci.get("wikipedia_title") and ci.get("wikipedia_extract"):
        return {
            "wikipediaTitle": ci["wikipedia_title"],
            "wikipediaExtract": ci["wikipedia_extract"][:4000],
            "wikiUrl": f"https://en.wikipedia.org/wiki/{quote(ci['wikipedia_title'].replace(' ', '_'))}",
        }
    # Live lookup (lightweight, one call)
    try:
        from context.wikipedia_client import wikipedia_enrichment_from_yahoo
        wiki = wikipedia_enrichment_from_yahoo(info or {}, symbol)
        if wiki.get("wikipedia_title"):
            return {
                "wikipediaTitle": wiki["wikipedia_title"],
                "wikipediaExtract": (wiki.get("wikipedia_extract") or "")[:4000],
                "wikiUrl": f"https://en.wikipedia.org/wiki/{quote(wiki['wikipedia_title'].replace(' ', '_'))}",
            }
    except Exception:
        pass
    # Fallback: heuristic URL
    name = (info.get("longName") or info.get("shortName") or symbol).replace(" ", "_")
    return {
        "wikipediaTitle": "",
        "wikipediaExtract": "",
        "wikiUrl": f"https://en.wikipedia.org/wiki/{quote(name)}",
    }


@app.get("/api/ticker/{symbol}")
def get_ticker_details(symbol: str):
    try:
        if is_mutual_fund_symbol(symbol):
            if not refresh_scheme_registry(force=False).get("count"):
                return {"error": "Mutual fund registry is unavailable."}
            return get_mutual_fund_details(symbol)
        profile = symbol_profile(symbol)
        ticker = yf.Ticker(symbol)
        info = ticker.info or {}

        current_price = _safe_round(info.get("currentPrice") or info.get("regularMarketPrice"))
        prev_close = _safe_round(info.get("previousClose") or info.get("regularMarketPreviousClose"))
        curr_symbol = CURRENCY_SYMBOLS.get(info.get("currency", "USD"), "$")
        change = _safe_round(current_price - prev_close) if current_price is not None and prev_close else None
        change_pct = _safe_round((change / prev_close) * 100) if change is not None and prev_close else None

        volume = info.get("volume") or info.get("regularMarketVolume")
        avg_volume = info.get("averageVolume") or info.get("averageDailyVolume10Day")

        news_data = []
        try:
            raw_news = ticker.news or []
            for n in raw_news[:5]:
                news_data.append(
                    {
                        "title": n.get("title", "Market Update"),
                        "link": n.get("link", "#"),
                        "publisher": n.get("publisher", "Market Feed"),
                    }
                )
        except Exception:
            pass

        wiki = _wiki_for_ticker(info, symbol)
        yahoo_desc = info.get("longBusinessSummary") or ""

        return {
            "symbol": symbol,
            "name": info.get("shortName") or info.get("longName") or symbol,
            "longName": info.get("longName") or info.get("shortName") or symbol,
            "price": current_price,
            "previousClose": prev_close,
            "prevClose": prev_close,  # keep legacy alias
            "currencySymbol": curr_symbol,
            "change": change,
            "changePct": change_pct,
            "marketCap": info.get("marketCap"),
            "peRatio": _safe_round(info.get("trailingPE")),
            "eps": _safe_round(info.get("trailingEps")),
            "dividendYield": _safe_round(info.get("dividendYield"), 4),
            "beta": _safe_round(info.get("beta")),
            "high52": _safe_round(info.get("fiftyTwoWeekHigh")),
            "low52": _safe_round(info.get("fiftyTwoWeekLow")),
            "volume": volume,
            "avgVolume": avg_volume,
            "sector": info.get("sector") or None,
            "industry": info.get("industry") or profile.get("category_label") or None,
            "assetFamily": profile["asset_family"],
            "marketRegion": profile["region"],
            "marketExchange": profile["exchange"],
            "isProxy": profile["is_proxy"],
            "categories": profile["categories"],
            "categoryLabel": profile["category_label"],
            "website": info.get("website") or "",
            "wikiUrl": wiki["wikiUrl"],
            "wikipediaTitle": wiki["wikipediaTitle"],
            "wikipediaExtract": wiki["wikipediaExtract"],
            "yahooUrl": f"https://finance.yahoo.com/quote/{quote(symbol)}",
            "description": wiki["wikipediaExtract"] if wiki["wikipediaExtract"] else (yahoo_desc or "No description available for this instrument."),
            "yahooDescription": yahoo_desc,
            "news": news_data,
        }
    except Exception as e:
        logger.warning("get_ticker_details %s failed: %s", symbol, e)
        return {"error": str(e)}


@app.get("/api/ticker/{symbol}/ohlc")
def get_ohlc_data(symbol: str, timeframe: str = "1Y"):
    if is_mutual_fund_symbol(symbol):
        return nav_history_as_ohlc(symbol, timeframe=timeframe)
    tf_map = {
        "1D": {"period": "1d", "interval": "1m"},
        "7D": {"period": "7d", "interval": "1m"},
        "2W": {"period": "1mo", "interval": "15m"},
        "1M": {"period": "1mo", "interval": "30m"},
        "3M": {"period": "3mo", "interval": "1d"},
        "6M": {"period": "6mo", "interval": "1d"},
        "1Y": {"period": "1y", "interval": "1d"},
        "2Y": {"period": "2y", "interval": "1d"},
        "5Y": {"period": "5y", "interval": "1d"},
        "10Y": {"period": "10y", "interval": "1wk"},
        "MAX": {"period": "max", "interval": "1wk"},
    }

    config = tf_map.get(timeframe, tf_map["1Y"])

    try:
        df = yf.Ticker(symbol).history(period=config["period"], interval=config["interval"])
        if df.empty:
            return []

        if timeframe == "2W":
            cutoff = df.index.max() - pd.Timedelta(days=14)
            df = df[df.index >= cutoff]

        ohlc = []
        for date, row in df.iterrows():
            if config["interval"] in ["1m", "5m", "15m", "30m", "60m", "1h"]:
                date_str = date.strftime("%Y-%m-%d %H:%M:%S")
            else:
                date_str = date.strftime("%Y-%m-%d")

            ohlc.append(
                {
                    "x": date_str,
                    "y": [round(row["Open"], 2), round(row["High"], 2), round(row["Low"], 2), round(row["Close"], 2)],
                    "volume": int(row.get("Volume", 0)),
                }
            )
        return ohlc
    except Exception as e:
        print(f"Failed to fetch OHLC: {e}")
        return []


@app.get("/api/ticker/{symbol}/options")
def get_ticker_options(symbol: str, date: str = None):
    if is_mutual_fund_symbol(symbol):
        return {"error": "Options chain is not available for mutual fund schemes."}
    if symbol in UPSTOX_INDEX_MAP:
        if not UPSTOX_ACCESS_TOKEN or UPSTOX_ACCESS_TOKEN == "YOUR_UPSTOX_TOKEN_HERE":
            return {"error": "Upstox Access Token is missing in main.py"}
        try:
            instrument_key = UPSTOX_INDEX_MAP[symbol]
            params = {"instrument_key": instrument_key}
            if date:
                params["expiry_date"] = date
            res = requests.get(
                "https://api.upstox.com/v2/option/chain",
                params=params,
                headers={"Accept": "application/json", "Authorization": f"Bearer {UPSTOX_ACCESS_TOKEN}"},
            )

            if res.status_code != 200:
                return {"error": f"Upstox API Error: {res.text}"}
            data = res.json().get("data", [])
            if not data:
                return {"error": "No options derivatives available for this asset on Upstox."}

            calls, puts, expirations = [], [], set()
            current_price = yf.Ticker(symbol).info.get("regularMarketPrice", 0)

            for item in data:
                strike = item.get("strike_price")
                if item.get("expiry"):
                    expirations.add(item.get("expiry"))
                ce, pe = item.get("call_options", {}), item.get("put_options", {})
                if ce:
                    calls.append(
                        {
                            "strike": strike,
                            "lastPrice": ce.get("market_data", {}).get("ltp", 0),
                            "impliedVolatility": ce.get("market_data", {}).get("iv", 0),
                            "openInterest": ce.get("market_data", {}).get("oi", 0),
                        }
                    )
                if pe:
                    puts.append(
                        {
                            "strike": strike,
                            "lastPrice": pe.get("market_data", {}).get("ltp", 0),
                            "impliedVolatility": pe.get("market_data", {}).get("iv", 0),
                            "openInterest": pe.get("market_data", {}).get("oi", 0),
                        }
                    )

            sorted_expirations = sorted(list(expirations))
            return {
                "expirations": sorted_expirations,
                "selected_date": date or sorted_expirations[0],
                "current_price": current_price,
                "calls": calls,
                "puts": puts,
            }
        except Exception as e:
            return {"error": f"Upstox Routing Failed: {str(e)}"}

    try:
        ticker = yf.Ticker(symbol)
        expirations = ticker.options
        if not expirations:
            return {"error": "No options derivatives available for this asset."}
        target_date = date if date in expirations else expirations[0]
        opt_chain = ticker.option_chain(target_date)
        current_price = ticker.info.get("regularMarketPrice", 0)

        calls = opt_chain.calls.replace([np.inf, -np.inf, np.nan], 0)
        puts = opt_chain.puts.replace([np.inf, -np.inf, np.nan], 0)

        return {
            "expirations": list(expirations),
            "selected_date": target_date,
            "current_price": current_price,
            "calls": calls[["strike", "lastPrice", "impliedVolatility", "openInterest"]].to_dict(orient="records"),
            "puts": puts[["strike", "lastPrice", "impliedVolatility", "openInterest"]].to_dict(orient="records"),
        }
    except Exception as e:
        return {"error": f"Failed to fetch Yahoo options chain. {str(e)}"}


@app.post("/api/ticker/{symbol}/download")
def download_ticker_data_on_demand(symbol: str):
    logger.info("on-demand parquet download: %s", symbol)
    if is_mutual_fund_symbol(symbol):
        try:
            payload = refresh_nav_history(symbol, force=True)
            return {
                "status": "success",
                "records_saved": {"1d_rows": len(payload.get("data") or [])},
                "category": MUTUAL_FUND_CATEGORY,
                "source": payload.get("source"),
            }
        except Exception as e:
            return {"error": str(e)}
    data_dir = "local_market_data"
    for folder in ["1h", "1d", "1wk", "1mo", "options"]:
        os.makedirs(f"{data_dir}/{folder}", exist_ok=True)
    try:
        ticker = yf.Ticker(symbol)
        stats = {}
        for tf, period, interval in [("1h", "730d", "1h"), ("1d", "max", "1d"), ("1wk", "max", "1wk"), ("1mo", "max", "1mo")]:
            df = ticker.history(period=period, interval=interval)
            if not df.empty:
                key = parquet_symbol_key(symbol)
                df.to_parquet(f"{data_dir}/{tf}/{key}.parquet")
                stats[f"{tf}_rows"] = len(df)
        logger.info("on-demand parquet download %s: %s", symbol, stats)
        return {"status": "success", "records_saved": stats}
    except Exception as e:
        logger.warning("on-demand parquet download %s failed: %s", symbol, e)
        return {"error": str(e)}


@app.post("/api/ticker/{symbol}/download-full-db")
def download_ticker_full_history_to_db(symbol: str, body: DownloadFullHistoryBody = DownloadFullHistoryBody()):
    """
    Download the maximum history available from Yahoo Finance for a single symbol
    and upsert it into local SQLite DB: local_market_data/ohlc.sqlite.
    """
    logger.info("on-demand full-db download: %s intraday=%s", symbol, body.include_intraday)
    try:
        if is_mutual_fund_symbol(symbol):
            payload = refresh_nav_history(symbol, force=True)
            return {
                "ok": True,
                "symbol": symbol,
                "db_path": "",
                "saved_rows": {"1d_rows": len(payload.get("data") or [])},
                "note": "Mutual fund NAV history was refreshed from MFapi cache rather than Yahoo OHLC storage.",
            }
        db_path = os.path.join("local_market_data", "ohlc.sqlite")
        result = _download_symbol_full_to_db(
            symbol=symbol,
            db_path=db_path,
            include_intraday=body.include_intraday,
            intraday_15m_days=body.intraday_15m_days,
            intraday_1h_days=body.intraday_1h_days,
        )
        logger.info("on-demand full-db download %s: %s", symbol, result.get("saved_rows"))
        return {"ok": True, **result}
    except Exception as e:
        logger.warning("on-demand full-db download %s failed: %s", symbol, e)
        return {"ok": False, "error": str(e)}


@app.get("/api/instrument/{symbol}/info")
def instrument_info(symbol: str, max_age_hours: int = 24):
    sym = str(symbol or "").strip().upper()
    if not sym:
        return {"ok": False, "error": "Missing symbol."}
    cached = _read_cached_instrument_info(sym)
    if cached and not _is_cache_stale(cached.get("fetched_at"), max_age_hours=max_age_hours):
        return {"ok": True, "symbol": sym, "source": "cache", **cached}
    try:
        fresh = _fetch_and_cache_instrument_info(sym)
        return {"ok": True, "symbol": sym, "source": "live", **fresh}
    except Exception as exc:
        if cached:
            return {
                "ok": True,
                "symbol": sym,
                "source": "stale_cache",
                "warning": f"Live refresh failed: {exc}",
                **cached,
            }
        return {"ok": False, "error": str(exc)}


@app.post("/api/screener/cron")
def setup_screener_cron(data: CronJobRequest):
    return {"status": "success", "message": f"Cron Job set for {data.category} on schedule {data.cron_schedule}"}


@app.get("/api/scheduler/status")
def scheduler_status():
    status = get_scheduler_status()
    status["exchangeSchedules"] = EXCHANGE_SCHEDULE
    status["exchangeSymbolCounts"] = {k: len(v) for k, v in get_symbols_by_exchange().items()}
    status["marketDataBytes"] = _dir_size_bytes("local_market_data")
    last_full = None
    with ALLDATA_JOBS_LOCK:
        for row in ALLDATA_JOBS.values():
            if row.get("status") != "completed":
                continue
            last_full = row
    status["lastFullDownload"] = last_full
    status["sessionPolicy"] = {
        "exchangeCalendars": EXCHANGE_CALENDAR_KEY,
        "countryHolidayFallback": EXCHANGE_COUNTRY_FALLBACK,
        "portfolioLiveQuotes": "ledger_holdings_with_quantity_gt_0_and_open_trading_session",
    }
    return {"ok": True, **status}


@app.post("/api/scheduler/start")
def scheduler_start():
    return {"ok": True, **start_scheduler()}


@app.post("/api/scheduler/stop")
def scheduler_stop():
    return {"ok": True, **stop_scheduler()}


@app.post("/api/scheduler/job/{job_id}/trigger")
def scheduler_trigger_job(job_id: str):
    ok = trigger_job_now(job_id)
    return {"ok": ok, "job_id": job_id, "status": "triggered" if ok else "failed"}


@app.post("/api/scheduler/job/{job_id}/pause")
def scheduler_pause_job(job_id: str):
    ok = pause_job(job_id)
    return {"ok": ok, "job_id": job_id, "status": "paused" if ok else "failed"}


@app.post("/api/scheduler/job/{job_id}/resume")
def scheduler_resume_job(job_id: str):
    ok = resume_job(job_id)
    return {"ok": ok, "job_id": job_id, "status": "resumed" if ok else "failed"}


@app.get("/api/scheduler/logs")
def scheduler_logs(limit: int = 100):
    return {"ok": True, "logs": get_scheduler_logs(limit=limit)}


@app.get("/api/scheduler/live-quotes")
def scheduler_live_quotes(symbol: str | None = None):
    return {"ok": True, "quotes": get_live_quote_cache(symbol)}


@app.post("/api/ai/analyze")
def analyze_setup_ollama(data: AIAnalysisRequest):
    prompt = data.customPrompt or f"""
    You are an elite quantitative trader. Analyze this structural setup:
    - Asset: {data.symbol}
    - Current Price: {data.price}
    - Pitchfork Geometry: Active for {data.daysActive} days
    - Proximity: {data.positionPct}% ({data.zoneLabel})

    Provide a concise, 3-bullet-point trading thesis (Risk, Reward, Actionable Play). Keep it under 100 words. No fluff.
    """
    try:
        response = requests.post(
            "http://localhost:11434/api/generate",
            json={"model": data.model, "prompt": prompt, "stream": False},
        )
        if response.status_code == 200:
            return {"analysis": response.json().get("response", "No response generated.")}
        return {"error": f"Ollama error: {response.text}"}
    except requests.exceptions.ConnectionError:
        return {"error": "Failed to connect. Is Ollama running on your machine? Run 'ollama run llama3' in your terminal."}
    except Exception as e:
        return {"error": f"Unexpected error: {str(e)}"}


@app.post("/api/agents/download")
def download_agent_endpoint(body: DownloadAgentRequest):
    """Use Ollama tool-calling to plan and run Parquet downloads (see agents/)."""
    from agents.download_agent import run_download_agent

    return run_download_agent(body.instruction, model=body.model)


@app.post("/api/context/consumer/ingest")
def consumer_context_ingest():
    """Merge allowlisted RSS + context_data/india_consumer/incoming/*.jsonl -> cases.jsonl."""
    from context.india_consumer_ingest import run_ingest

    return run_ingest()


@app.post("/api/context/consumer/reindex")
def consumer_context_reindex(embed_model: str | None = None):
    """Rebuild RAG sqlite from cases.jsonl (requires Ollama embeddings model)."""
    from context.consumer_rag import rebuild_index

    return rebuild_index(embed_model=embed_model)


@app.post("/api/context/consumer/query")
def consumer_context_query(body: ConsumerQueryRequest):
    """RAG over India consumer cases + monthly correlation vs local OHLC + Ollama chat."""
    from context.consumer_query import run_consumer_query

    return run_consumer_query(
        symbol=body.symbol,
        question=body.question,
        k=body.k,
        months_back=body.months_back,
        model=body.model,
        embed_model=body.embed_model,
    )


@app.get("/api/context/consumer/preview/{symbol}")
def consumer_context_preview(symbol: str, limit: int = 12):
    """Recent cases for symbol + correlation summary + index stats (no LLM)."""
    from context.consumer_query import preview_consumer_context

    return preview_consumer_context(symbol, limit=limit)


@app.post("/api/context/news/refresh")
def news_refresh(body: NewsRefreshBody):
    """Fetch yfinance (+ optional Finnhub/NewsAPI) and save under context_data/news/{symbol}.json."""
    from context.news_store import refresh_and_save

    syms: list[str] = []
    if body.symbols:
        syms = [s.strip() for s in body.symbols if s and str(s).strip()]
    elif body.symbol:
        syms = [body.symbol.strip()]
    if not syms:
        return {"ok": False, "error": "Provide symbol or symbols[]"}
    results = []
    for s in syms[:50]:
        results.append(refresh_and_save(s))
    return {"ok": True, "results": results}


@app.get("/api/context/news/{symbol}")
def news_get_saved(symbol: str):
    from context.news_store import load_saved_news

    data = load_saved_news(symbol)
    if not data:
        return {"symbol": symbol, "items": [], "empty": True}
    return data


@app.post("/api/context/open/ingest")
def open_context_ingest():
    """RSS + Reddit + CourtListener (if configured) -> append ledger.jsonl."""
    from context.open_context import run_open_ingest

    return run_open_ingest()


@app.get("/api/context/unified/{symbol}")
def unified_context(symbol: str):
    """Saved news + open ledger matches + consumer preview."""
    from context.unified_context import get_unified_context

    return get_unified_context(symbol)


@app.get("/api/watchlist")
def watchlist_get():
    from context.watchlist_store import get_watchlist

    return {"symbols": get_watchlist()}


@app.put("/api/watchlist")
def watchlist_put(body: WatchlistBody):
    from context.watchlist_store import set_watchlist

    return {"ok": True, "symbols": set_watchlist(body.symbols or [])}


@app.get("/api/portfolios")
def portfolios_get():
    from context.watchlist_store import get_portfolios

    portfolios = get_portfolios()
    return {"ok": True, "portfolios": portfolios}


@app.put("/api/portfolios")
def portfolios_put(body: PortfoliosBody):
    from context.watchlist_store import set_portfolios

    portfolios = set_portfolios(body.portfolios or {})
    return {"ok": True, "portfolios": portfolios}


@app.get("/api/portfolio/fee-registry")
def portfolio_fee_registry():
    from context.portfolio_fee_registry import get_fee_registry_summary

    return {"ok": True, **get_fee_registry_summary()}


@app.post("/api/portfolio/fee-preview")
def portfolio_fee_preview(body: PortfolioFeePreviewBody):
    from context.portfolio_fee_registry import estimate_transaction_charges

    preview = estimate_transaction_charges(body.model_dump())
    return {"ok": True, "preview": preview}


@app.get("/api/portfolio/analytics")
def portfolio_analytics(portfolio_name: str | None = None):
    from context.portfolio_reports import derive_portfolio_analytics
    from context.watchlist_store import get_portfolios

    return {"ok": True, "analytics": derive_portfolio_analytics(get_portfolios(), portfolio_name)}


@app.post("/api/portfolio/import/preview")
def portfolio_import_preview(body: PortfolioImportPreviewBody):
    from context.portfolio_import import preview_csv_import

    preview = preview_csv_import(
        body.csv_text,
        platform=body.platform or "",
        country=body.country or "India",
        state=body.state or "",
        purchase_type=body.purchaseType or "Delivery",
        segment=body.segment or "Equity",
        side=body.side or "BUY",
    )
    return {"ok": True, **preview}


@app.post("/api/portfolio/import/commit")
def portfolio_import_commit(body: PortfolioImportCommitBody):
    from context.portfolio_import import commit_csv_import
    from context.watchlist_store import get_portfolios, set_portfolios

    portfolios = commit_csv_import(get_portfolios(), body.portfolio_name, body.preview_rows or [])
    saved = set_portfolios(portfolios)
    return {"ok": True, "portfolios": saved}


@app.get("/api/portfolio/report/tax-summary")
def portfolio_tax_summary(portfolio_name: str | None = None, financial_year: str | None = None):
    from context.portfolio_reports import derive_tax_summary
    from context.watchlist_store import get_portfolios

    return {"ok": True, "report": derive_tax_summary(get_portfolios(), portfolio_name, financial_year)}


@app.get("/api/portfolio/report/fee-summary")
def portfolio_fee_summary(portfolio_name: str | None = None):
    from context.portfolio_reports import derive_fee_summary
    from context.watchlist_store import get_portfolios

    return {"ok": True, "report": derive_fee_summary(get_portfolios(), portfolio_name)}


@app.post("/api/portfolio/copilot/context")
def portfolio_copilot_context(body: PortfolioCopilotContextBody):
    from context.portfolio_reports import build_portfolio_copilot_context
    from context.watchlist_store import get_portfolios

    return {"ok": True, **build_portfolio_copilot_context(get_portfolios(), body.portfolio_name)}


@app.get("/api/watchlist/summary")
def watchlist_summary():
    from context.news_store import load_saved_news
    from context.india_mutual_funds import get_scheme_record, is_mutual_fund_symbol
    from context.watchlist_store import get_watchlist

    wl = get_watchlist()
    rows = []
    for s in wl:
        n = load_saved_news(s)
        head = "-"
        updated = None
        if n and n.get("items"):
            head = (n["items"][0].get("title") or "-")[:120]
            updated = n.get("updated_at")
        profile = symbol_profile(s)
        instrument_kind = "mutual_fund" if is_mutual_fund_symbol(s) else "other"
        display_name = profile.get("display_name") or s
        scheme_code = ""
        fund_house = ""
        if is_mutual_fund_symbol(s):
            scheme = get_scheme_record(s) or {}
            display_name = str(scheme.get("scheme_name") or display_name)
            scheme_code = str(scheme.get("scheme_code") or "")
            fund_house = str(scheme.get("fund_house") or "")
        rows.append(
            {
                "symbol": s,
                "displayName": display_name,
                "instrumentKind": instrument_kind,
                "schemeCode": scheme_code,
                "fundHouse": fund_house,
                "headline": head,
                "updated_at": updated,
                "assetFamily": profile["asset_family"],
                "categoryLabel": profile["category_label"],
                "isProxy": profile["is_proxy"],
            }
        )
    return {"watchlist": wl, "rows": rows}


@app.post("/api/instruments/batch-quote")
def instruments_batch_quote(body: InstrumentBatchQuoteBody):
    raw = [str(s).strip().upper() for s in (body.symbols or []) if str(s).strip()]
    symbols: list[str] = []
    seen: set[str] = set()
    for sym in raw:
        if sym in seen:
            continue
        seen.add(sym)
        symbols.append(sym)
        if len(symbols) >= 80:
            break
    if not symbols:
        return {"ok": False, "error": "Provide at least one symbol.", "quotes": [], "errors": []}

    universe = load_universe_tickers()
    quotes: list[dict] = []
    errors: list[dict] = []
    for sym in symbols:
        try:
            if is_mutual_fund_symbol(sym):
                row = get_mutual_fund_details(sym)
                if row.get("error"):
                    errors.append({"symbol": sym, "error": row.get("error")})
                    continue
                quotes.append(
                    {
                        "symbol": sym,
                        "displayName": row.get("longName") or row.get("name") or sym,
                        "name": row.get("name") or sym,
                        "price": float(row.get("price") or 0.0),
                        "change": float(row.get("change") or 0.0),
                        "changePct": float(row.get("changePct") or 0.0),
                        "currencySymbol": row.get("currencySymbol") or "₹",
                        "instrumentKind": "mutual_fund",
                        "assetFamily": "mutual_fund",
                        "categoryLabel": row.get("categoryLabel") or "India Mutual Fund",
                    }
                )
                continue

            profile = symbol_profile(sym, universe)
            info = yf.Ticker(sym).info or {}
            price = info.get("currentPrice") or info.get("regularMarketPrice")
            prev_close = info.get("previousClose") or info.get("regularMarketPreviousClose")
            price_v = float(price) if price is not None else 0.0
            prev_v = float(prev_close) if prev_close is not None else 0.0
            change = price_v - prev_v if prev_v else 0.0
            change_pct = (change / prev_v) * 100.0 if prev_v else 0.0
            mc = info.get("marketCap")
            vol = info.get("volume") or info.get("regularMarketVolume")
            h52 = info.get("fiftyTwoWeekHigh")
            l52 = info.get("fiftyTwoWeekLow")
            pe = info.get("trailingPE") or info.get("forwardPE")
            quotes.append(
                {
                    "symbol": sym,
                    "displayName": info.get("longName") or info.get("shortName") or profile.get("display_name") or sym,
                    "name": info.get("shortName") or info.get("longName") or sym,
                    "price": round(price_v, 4),
                    "change": round(change, 4),
                    "changePct": round(change_pct, 4),
                    "currencySymbol": CURRENCY_SYMBOLS.get(info.get("currency", "USD"), "$"),
                    "instrumentKind": "other",
                    "assetFamily": profile.get("asset_family") or "instrument",
                    "categoryLabel": profile.get("category_label") or "Instrument",
                    "sector": info.get("sector") or "",
                    "industry": info.get("industry") or profile.get("asset_family") or "",
                    "marketExchange": profile.get("exchange") or info.get("exchange") or "",
                    "marketRegion": profile.get("region") or "",
                    "marketCap": mc,
                    "volume": vol,
                    "high52": h52,
                    "low52": l52,
                    "peRatio": pe,
                    "prevClose": round(prev_v, 4) if prev_v else None,
                }
            )
        except Exception as e:
            errors.append({"symbol": sym, "error": str(e)})

    return {"ok": True, "quotes": quotes, "errors": errors, "requested": len(symbols)}


@app.post("/api/agents/context-run")
def context_agent_run(body: ContextAgentBody):
    """Ollama agent with tools: news, open context, consumer preview, OHLC tail."""
    from agents.context_agent import run_context_agent

    return run_context_agent(
        symbol=body.symbol.strip(),
        user_message=body.instruction,
        model=body.model,
    )


@app.post("/api/admin/nuke-local-data")
def admin_nuke_local_data(body: NukeLocalDataBody):
    """Delete local market/context caches and optional watchlist settings."""
    return _nuke_local_data(body)


@app.post("/api/admin/bulk-info-load")
def admin_bulk_info_load(body: BulkInfoLoadBody):
    job_id = uuid.uuid4().hex[:12]
    with BULK_INFO_JOBS_LOCK:
        BULK_INFO_JOBS[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "current": 0,
            "total": 0,
            "current_symbol": None,
            "stats": None,
            "error": None,
        }
    t = threading.Thread(target=_run_bulk_info_job, args=(job_id, body), daemon=True)
    t.start()
    return {"ok": True, "job_id": job_id, "status": "queued"}


@app.get("/api/admin/bulk-info-load-status/{job_id}")
def admin_bulk_info_status(job_id: str):
    with BULK_INFO_JOBS_LOCK:
        row = BULK_INFO_JOBS.get(job_id)
    if not row:
        return {"ok": False, "error": "Unknown job_id"}
    return {"ok": True, **row}


@app.post("/api/admin/redownload-all")
def admin_redownload_all(body: RedownloadAllBody):
    """Start background job to redownload all selected market data to local parquet."""
    job_id = uuid.uuid4().hex[:12]
    with REDOWNLOAD_JOBS_LOCK:
        REDOWNLOAD_JOBS[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "current": 0,
            "total": 0,
            "current_symbol": None,
            "stats": None,
            "error": None,
        }
    t = threading.Thread(target=_run_redownload_job, args=(job_id, body), daemon=True)
    t.start()
    return {"ok": True, "job_id": job_id, "status": "queued"}


@app.get("/api/admin/redownload-status/{job_id}")
def admin_redownload_status(job_id: str):
    with REDOWNLOAD_JOBS_LOCK:
        row = REDOWNLOAD_JOBS.get(job_id)
    if not row:
        return {"ok": False, "error": "Unknown job_id"}
    return {"ok": True, **row}


@app.post("/api/admin/reset-and-redownload")
def admin_reset_and_redownload(body: ResetAndRedownloadBody):
    nuke_body = NukeLocalDataBody(
        nuke_market_data=body.nuke_market_data,
        nuke_saved_news=body.nuke_saved_news,
        nuke_open_context_ledger=body.nuke_open_context_ledger,
        nuke_consumer_cases=body.nuke_consumer_cases,
        nuke_consumer_rag_db=body.nuke_consumer_rag_db,
        nuke_watchlist_settings=body.nuke_watchlist_settings,
        recreate_folders=body.recreate_folders,
    )
    nuke = _nuke_local_data(nuke_body)
    if not nuke.get("ok"):
        return nuke

    job_req = RedownloadAllBody(
        categories=body.categories,
        limit=body.limit,
        sleep_seconds=body.sleep_seconds,
    )
    start = admin_redownload_all(job_req)
    return {"ok": True, "nuke": nuke, "redownload": start}


@app.post("/api/admin/download-all-and-calculate")
def admin_download_all_and_calculate(body: DownloadAllAndCalculateBody):
    """
    Background job: download full Yahoo history for all selected symbols into sqlite,
    then calculate active pitchfork setups from stored daily bars.
    """
    job_id = uuid.uuid4().hex[:12]
    with ALLDATA_JOBS_LOCK:
        ALLDATA_JOBS[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "current": 0,
            "total": 0,
            "current_symbol": None,
            "stats": None,
            "results": [],
            "error": None,
        }
    t = threading.Thread(target=_run_download_all_and_calculate_job, args=(job_id, body), daemon=True)
    t.start()
    return {"ok": True, "job_id": job_id, "status": "queued"}


@app.get("/api/admin/download-all-and-calculate-status/{job_id}")
def admin_download_all_and_calculate_status(job_id: str):
    with ALLDATA_JOBS_LOCK:
        row = ALLDATA_JOBS.get(job_id)
    if not row:
        return {"ok": False, "error": "Unknown job_id"}
    return {"ok": True, **row}
