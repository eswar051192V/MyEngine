from __future__ import annotations

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, Response, StreamingResponse
from pydantic import BaseModel
import json
import os
import sqlite3
import shutil
import threading
import uuid
from urllib.parse import quote
import yfinance as yf
import pandas as pd
import numpy as np
import requests
import asyncio
import random

from market_universe import (
    build_category_summaries,
    build_presets,
    load_tickers as load_universe_tickers,
    load_tickers_enriched as load_universe_tickers_enriched,
    ticker_name_map as load_ticker_name_map,
    search_local_instruments,
    symbol_profile,
)
from wiki_profiles import (
    get_wiki_profile,
    get_wiki_profile_background,
    clear_cache as clear_wiki_cache,
    cache_stats as wiki_cache_stats,
)
from context.india_mutual_funds import (
    MUTUAL_FUND_CATEGORY,
    get_mutual_fund_details,
    is_mutual_fund_symbol,
    nav_history_as_ohlc,
    refresh_nav_history,
    refresh_scheme_registry,
    search_mutual_funds,
)

app = FastAPI()


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
    "^NSEBANK": "NSE_INDEX|Nifty Bank",
    "^NSEI": "NSE_INDEX|Nifty 50",
    "^CNXFIN": "NSE_INDEX|Nifty Fin Service",
    "^NSEMDCP50": "NSE_INDEX|Nifty Midcap 50",
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
    sleep_seconds: float = 0.1
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


# --- New AI Integration Models ---
class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None
    symbol: str | None = None
    model: str | None = None
    role: str = "chat"


class ModelAssignmentRequest(BaseModel):
    role: str
    model: str
    fallback: str | None = None


class OllamaInstanceRequest(BaseModel):
    instance_id: str
    label: str
    base_url: str


class ScreenerScanRequest(BaseModel):
    symbols: list[str] | None = None
    use_ai: bool = True
    model: str | None = None


class AlertsQueryRequest(BaseModel):
    limit: int = 50
    symbol: str | None = None
    unread_only: bool = False
    severity: str | None = None


class AlertActionRequest(BaseModel):
    alert_ids: list[int]


class SessionUpdateRequest(BaseModel):
    title: str | None = None
    metadata: dict | None = None


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
    categories: list[str] | None = None
    limit: int | None = None
    sleep_seconds: float = 0.75


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
    sleep_seconds: float = 0.75


REDOWNLOAD_JOBS: dict[str, dict] = {}
REDOWNLOAD_JOBS_LOCK = threading.Lock()
ALLDATA_JOBS: dict[str, dict] = {}
ALLDATA_JOBS_LOCK = threading.Lock()
TICKER_REFRESH_JOBS: dict[str, dict] = {}
TICKER_REFRESH_JOBS_LOCK = threading.Lock()


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


def _download_symbol_full_to_db(
    symbol: str,
    db_path: str,
    include_intraday: bool = True,
    intraday_15m_days: int = 60,
    intraday_1h_days: int = 730,
) -> dict:
    _ensure_ohlc_sqlite(db_path)
    ticker = yf.Ticker(symbol)
    stats: dict[str, int] = {}
    with sqlite3.connect(db_path) as conn:
        # Full history available from Yahoo for these intervals.
        for interval in ("1d", "1wk", "1mo"):
            df = ticker.history(period="max", interval=interval, auto_adjust=False)
            stats[f"{interval}_rows"] = _save_df_to_ohlc_sqlite(conn, symbol, interval, df)

        if include_intraday:
            # Intraday is limited by Yahoo; we still persist the maximum allowed window.
            i15 = max(1, int(intraday_15m_days))
            i1h = max(1, int(intraday_1h_days))
            df_15m = ticker.history(period=f"{i15}d", interval="15m", auto_adjust=False)
            df_1h = ticker.history(period=f"{i1h}d", interval="1h", auto_adjust=False)
            stats["15m_rows"] = _save_df_to_ohlc_sqlite(conn, symbol, "15m", df_15m)
            stats["1h_rows"] = _save_df_to_ohlc_sqlite(conn, symbol, "1h", df_1h)

        conn.commit()

    return {
        "symbol": symbol,
        "db_path": os.path.abspath(db_path),
        "saved_rows": stats,
        "note": "Daily/weekly/monthly use Yahoo max history. Intraday stores Yahoo maximum allowed lookback window.",
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

        out_results = []
        ok = fail = 0
        for i, sym in enumerate(symbols):
            _set({"current": i + 1, "current_symbol": sym})
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
            except Exception:
                fail += 1
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
    except Exception as e:
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

    # 1) Parquet
    try:
        p = os.path.join("local_market_data", interval, f"{symbol}.parquet")
        if os.path.exists(p):
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

    _set({"status": "running"})
    try:
        md.setup_directories()
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
            _set({"status": "failed", "error": "No symbols found to download."})
            return

        def on_progress(i: int, n: int, sym: str) -> None:
            _set({"current": i, "total": n, "current_symbol": sym})

        stats = md.download_symbols(
            symbols,
            sleep_seconds=max(0.0, float(body.sleep_seconds)),
            on_progress=on_progress,
        )
        _set({"status": "completed", "stats": stats})
    except Exception as e:
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
    return {"error": "Ticker file not found."}


@app.get("/api/tickers/enriched")
def get_all_tickers_enriched():
    """Return tickers with names: {category: [{s: symbol, n: name}, ...]}."""
    data = load_universe_tickers_enriched()
    if data:
        return {"ok": True, "data": data}
    return {"ok": False, "error": "Ticker file not found."}


@app.get("/api/tickers/names")
def get_ticker_names():
    """Return a flat {symbol: name} map for all tickers."""
    names = load_ticker_name_map()
    return {"ok": True, "names": names, "count": len(names)}


@app.get("/api/wiki/{symbol}")
def get_wiki_profile_endpoint(symbol: str, force: bool = False):
    """Get Wikipedia profile for a ticker. Uses background caching."""
    name_map = load_ticker_name_map()
    name = name_map.get(symbol, name_map.get(symbol.upper(), ""))
    if force:
        profile = get_wiki_profile(symbol, name, force_refresh=True)
    else:
        profile = get_wiki_profile_background(symbol, name)
    return {"ok": True, "profile": profile}


@app.get("/api/wiki/{symbol}/full")
def get_wiki_profile_full_endpoint(symbol: str):
    """Get full Wikipedia profile (waits for fetch if not cached)."""
    name_map = load_ticker_name_map()
    name = name_map.get(symbol, name_map.get(symbol.upper(), ""))
    profile = get_wiki_profile(symbol, name)
    return {"ok": True, "profile": profile}


@app.delete("/api/wiki/cache")
def clear_wiki_cache_endpoint(symbol: str | None = None):
    """Clear wiki profile cache (all or specific symbol)."""
    count = clear_wiki_cache(symbol)
    return {"ok": True, "cleared": count}


@app.get("/api/wiki/cache/stats")
def get_wiki_cache_stats():
    """Get wiki profile cache statistics."""
    return {"ok": True, **wiki_cache_stats()}


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


# ---------------------------------------------------------------------------
# India City-Wise Precious Metals
# ---------------------------------------------------------------------------

@app.get("/api/metals/gold")
def metals_gold(force_refresh: bool = False):
    """City-wise gold prices across Indian cities."""
    from agents.india_metals_scraper import get_gold_prices
    prices = get_gold_prices(force_refresh=force_refresh)
    return {"ok": True, "metal": "gold", "cities": len(prices), "prices": prices}


@app.get("/api/metals/silver")
def metals_silver(force_refresh: bool = False):
    """City-wise silver prices across Indian cities."""
    from agents.india_metals_scraper import get_silver_prices
    prices = get_silver_prices(force_refresh=force_refresh)
    return {"ok": True, "metal": "silver", "cities": len(prices), "prices": prices}


@app.get("/api/metals/platinum")
def metals_platinum(force_refresh: bool = False):
    """City-wise platinum prices across Indian cities (derived from gold)."""
    from agents.india_metals_scraper import get_platinum_prices
    prices = get_platinum_prices(force_refresh=force_refresh)
    return {"ok": True, "metal": "platinum", "cities": len(prices), "prices": prices}


@app.get("/api/metals/all")
def metals_all(force_refresh: bool = False):
    """All city-wise precious metal prices."""
    from agents.india_metals_scraper import get_all_metal_prices
    all_prices = get_all_metal_prices(force_refresh=force_refresh)
    return {
        "ok": True,
        "metals": list(all_prices.keys()),
        "prices": all_prices,
    }


@app.get("/api/metals/tickers")
def metals_tickers():
    """Get all metal ticker data in standard ticker format."""
    from agents.india_metals_scraper import get_all_metal_tickers_data
    tickers = get_all_metal_tickers_data()
    return {"ok": True, "count": len(tickers), "tickers": tickers}


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


@app.get("/api/ticker/{symbol}")
def get_ticker_details(symbol: str):
    try:
        # Check if this is a synthetic Indian metal ticker (GOLD_DELHI.MCX etc.)
        from agents.india_metals_scraper import is_metal_ticker, get_metal_price_for_ticker
        if is_metal_ticker(symbol):
            metal_data = get_metal_price_for_ticker(symbol)
            if metal_data:
                return metal_data
            return {"error": f"No price data available for {symbol}"}

        if is_mutual_fund_symbol(symbol):
            if not refresh_scheme_registry(force=False).get("count"):
                return {"error": "Mutual fund registry is unavailable."}
            return get_mutual_fund_details(symbol)
        profile = symbol_profile(symbol)
        ticker = yf.Ticker(symbol)
        info = ticker.info
        current_price = info.get("currentPrice") or info.get("regularMarketPrice", 0)
        prev_close = info.get("previousClose") or info.get("regularMarketPreviousClose", 0)
        curr_symbol = CURRENCY_SYMBOLS.get(info.get("currency", "USD"), "$")
        change = current_price - prev_close if current_price and prev_close else 0
        change_pct = (change / prev_close) * 100 if prev_close else 0

        news_data = []
        if ticker.news:
            for n in ticker.news[:5]:
                news_data.append(
                    {
                        "title": n.get("title", "Market Update"),
                        "link": n.get("link", "#"),
                        "publisher": n.get("publisher", "Market Feed"),
                    }
                )

        return {
            "symbol": symbol,
            "name": info.get("shortName", info.get("longName", symbol)),
            "longName": info.get("longName", info.get("shortName", symbol)),
            "price": round(current_price, 2),
            "prevClose": round(prev_close, 2),
            "currencySymbol": curr_symbol,
            "change": round(change, 2),
            "changePct": round(change_pct, 2),
            "marketCap": info.get("marketCap", 0),
            "peRatio": round(info.get("trailingPE", 0), 2) if info.get("trailingPE") else "N/A",
            "high52": round(info.get("fiftyTwoWeekHigh", 0), 2) if info.get("fiftyTwoWeekHigh") else "N/A",
            "low52": round(info.get("fiftyTwoWeekLow", 0), 2) if info.get("fiftyTwoWeekLow") else "N/A",
            "sector": info.get("sector", "N/A"),
            "industry": info.get("industry", profile["category_label"] or "N/A"),
            "assetFamily": profile["asset_family"],
            "marketRegion": profile["region"],
            "marketExchange": profile["exchange"],
            "isProxy": profile["is_proxy"],
            "categories": profile["categories"],
            "categoryLabel": profile["category_label"],
            "website": info.get("website", ""),
            "wikiUrl": f"https://en.wikipedia.org/wiki/{quote((info.get('longName') or info.get('shortName') or symbol).replace(' ', '_'))}",
            "yahooUrl": f"https://finance.yahoo.com/quote/{quote(symbol)}",
            "description": info.get("longBusinessSummary", "No company profile available for this asset."),
            "news": news_data
        }
    except Exception as e:
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
                df.to_parquet(f"{data_dir}/{tf}/{symbol}.parquet")
                stats[f"{tf}_rows"] = len(df)
        return {"status": "success", "records_saved": stats}
    except Exception as e:
        return {"error": str(e)}


@app.post("/api/ticker/{symbol}/download-full-db")
def download_ticker_full_history_to_db(symbol: str, body: DownloadFullHistoryBody = DownloadFullHistoryBody()):
    """
    Download the maximum history available from Yahoo Finance for a single symbol
    and upsert it into local SQLite DB: local_market_data/ohlc.sqlite.
    """
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
        return {"ok": True, **result}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/screener/cron")
def setup_screener_cron(data: CronJobRequest):
    return {"status": "success", "message": f"Cron Job set for {data.category} on schedule {data.cron_schedule}"}


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
        rows.append(
            {
                "symbol": s,
                "headline": head,
                "updated_at": updated,
                "assetFamily": profile["asset_family"],
                "categoryLabel": profile["category_label"],
                "isProxy": profile["is_proxy"],
            }
        )
    return {"watchlist": wl, "rows": rows}


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


# ---------------------------------------------------------------------------
# Ticker Universe Refresh & Download
# ---------------------------------------------------------------------------

def _run_ticker_refresh_job(job_id: str) -> None:
    """Background worker: runs fetch_all_tickers.main() and captures output."""
    import io as _io
    import sys as _sys
    import contextlib

    def _update(patch: dict) -> None:
        with TICKER_REFRESH_JOBS_LOCK:
            TICKER_REFRESH_JOBS[job_id].update(patch)

    _update({"status": "running"})
    log_buf = _io.StringIO()
    try:
        from fetch_all_tickers import main as fetch_main
        with contextlib.redirect_stdout(log_buf):
            fetch_main()
        # Reload the tickers data in-memory
        import importlib, market_universe
        importlib.reload(market_universe)
        _update({
            "status": "completed",
            "log": log_buf.getvalue(),
        })
    except Exception as exc:
        _update({
            "status": "failed",
            "error": str(exc),
            "log": log_buf.getvalue(),
        })


@app.post("/api/admin/refresh-tickers")
def admin_refresh_tickers():
    """Run fetch_all_tickers.py in background to rebuild the ticker universe JSON."""
    # Check if one is already running
    with TICKER_REFRESH_JOBS_LOCK:
        for jid, job in TICKER_REFRESH_JOBS.items():
            if job.get("status") in ("queued", "running"):
                return {"ok": True, "job_id": jid, "status": job["status"], "message": "Already running"}

    job_id = uuid.uuid4().hex[:12]
    with TICKER_REFRESH_JOBS_LOCK:
        TICKER_REFRESH_JOBS[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "log": "",
            "error": None,
        }
    t = threading.Thread(target=_run_ticker_refresh_job, args=(job_id,), daemon=True)
    t.start()
    return {"ok": True, "job_id": job_id, "status": "queued"}


@app.get("/api/admin/refresh-tickers-status/{job_id}")
def admin_refresh_tickers_status(job_id: str):
    """Check status of a ticker refresh job."""
    with TICKER_REFRESH_JOBS_LOCK:
        row = TICKER_REFRESH_JOBS.get(job_id)
    if not row:
        return {"ok": False, "error": "Unknown job_id"}
    return {"ok": True, **row}


@app.get("/api/admin/download-tickers-json")
def admin_download_tickers_json():
    """Download the current all_global_tickers.json file."""
    import os
    json_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "all_global_tickers.json")
    if not os.path.exists(json_path):
        json_path = "all_global_tickers.json"
    if not os.path.exists(json_path):
        return {"ok": False, "error": "Ticker JSON not found"}
    from fastapi.responses import FileResponse
    return FileResponse(
        path=json_path,
        media_type="application/json",
        filename="all_global_tickers.json",
    )


@app.get("/api/admin/tickers-json-stats")
def admin_tickers_json_stats():
    """Get summary stats of the current all_global_tickers.json."""
    import os
    json_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "all_global_tickers.json")
    if not os.path.exists(json_path):
        json_path = "all_global_tickers.json"
    if not os.path.exists(json_path):
        return {"ok": False, "error": "Ticker JSON not found"}
    try:
        with open(json_path, encoding="utf-8") as f:
            data = json.load(f)
        stats = {
            "ok": True,
            "total_categories": len(data),
            "total_tickers": sum(len(v) for v in data.values()),
            "categories": {cat: len(syms) for cat, syms in sorted(data.items())},
            "file_size_kb": round(os.path.getsize(json_path) / 1024, 1),
            "last_modified": os.path.getmtime(json_path),
        }
        return stats
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


NON_EQUITY_CATEGORIES = [
    # Commodities
    "Precious_Metals_Futures", "Energy_Futures", "Base_Metals_Futures",
    "Agriculture_Grains_Futures", "Softs_Futures", "Livestock_Futures",
    "Indian_MCX_Proxy_PreciousMetals", "Indian_MCX_Proxy_Energy",
    "Indian_MCX_Proxy_BaseMetals", "Indian_MCX_Commodities_Extended",
    "India_Commodity_ETFs", "India_PreciousMetals_Benchmark",
    # Forex
    "Global_Forex_Majors", "Global_Forex_Crosses", "Asia_Forex_USD_Pairs",
    "INR_Forex_Pairs", "INR_Cross_Rates",
    # Crypto
    "Crypto_Major_USD", "Crypto_INR_Pairs", "Crypto_Stablecoins",
    # Bonds
    "India_Bond_ETFs", "India_Bond_Proxies",
    # Indian ETFs & Indices (lightweight — not full NSE equity)
    "India_ETFs", "India_Indices",
]


@app.get("/api/admin/non-equity-categories")
def admin_non_equity_categories():
    """Return the list of non-equity categories and their symbol counts."""
    from market_universe import load_tickers
    universe = load_tickers()
    cats = []
    total = 0
    for cat in NON_EQUITY_CATEGORIES:
        syms = universe.get(cat, [])
        if syms:
            cats.append({"category": cat, "count": len(syms)})
            total += len(syms)
    return {"ok": True, "categories": cats, "total_symbols": total}


@app.post("/api/admin/download-non-equity")
def admin_download_non_equity(body: RedownloadAllBody):
    """Start background job to download OHLC data for all non-equity instruments."""
    # Override categories to non-equity only
    body.categories = NON_EQUITY_CATEGORIES
    if not body.sleep_seconds:
        body.sleep_seconds = 0.5  # slightly faster for smaller universe

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
            "type": "non-equity",
        }
    t = threading.Thread(target=_run_redownload_job, args=(job_id, body), daemon=True)
    t.start()
    return {"ok": True, "job_id": job_id, "status": "queued"}


# ==========================================
# AI INTEGRATION ENDPOINTS
# ==========================================

# --- Unified Chat (non-streaming) ---
@app.post("/api/ai/chat")
def ai_chat(body: ChatRequest):
    """Unified AI chat with tool-calling orchestrator and conversation memory."""
    from agents.orchestrator import run_orchestrator

    return run_orchestrator(
        user_message=body.message,
        session_id=body.session_id,
        symbol=body.symbol,
        model_override=body.model,
        role=body.role,
    )


# --- Unified Chat (streaming SSE) ---
@app.post("/api/ai/chat/stream")
def ai_chat_stream(body: ChatRequest):
    """Streaming AI chat via Server-Sent Events."""
    from agents.orchestrator import stream_orchestrator

    def event_generator():
        for event in stream_orchestrator(
            user_message=body.message,
            session_id=body.session_id,
            symbol=body.symbol,
            model_override=body.model,
            role=body.role,
        ):
            event_type = event.get("event", "message")
            data = json.dumps(event.get("data", {}))
            yield f"event: {event_type}\ndata: {data}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# --- Conversation Sessions ---
@app.get("/api/ai/sessions")
def ai_list_sessions(limit: int = 50, offset: int = 0):
    """List all chat sessions."""
    from agents.conversation_store import list_sessions
    return {"ok": True, "sessions": list_sessions(limit=limit, offset=offset)}


@app.get("/api/ai/sessions/{session_id}")
def ai_get_session(session_id: str):
    """Get session info."""
    from agents.conversation_store import get_session
    sess = get_session(session_id)
    if not sess:
        return {"ok": False, "error": "Session not found"}
    return {"ok": True, **sess}


@app.get("/api/ai/sessions/{session_id}/messages")
def ai_get_messages(session_id: str, limit: int = 200):
    """Get messages for a session."""
    from agents.conversation_store import get_messages
    return {"ok": True, "messages": get_messages(session_id, limit=limit)}


@app.put("/api/ai/sessions/{session_id}")
def ai_update_session(session_id: str, body: SessionUpdateRequest):
    """Update session title or metadata."""
    from agents.conversation_store import update_session
    return update_session(session_id, title=body.title, metadata=body.metadata)


@app.delete("/api/ai/sessions/{session_id}")
def ai_delete_session(session_id: str):
    """Delete a session and all its messages."""
    from agents.conversation_store import delete_session
    return delete_session(session_id)


# --- Model Registry ---
@app.get("/api/ai/models")
def ai_list_models():
    """List all available Ollama models."""
    from agents.model_registry import list_available_models
    return {"ok": True, "models": list_available_models()}


@app.get("/api/ai/models/health")
def ai_models_health():
    """Check Ollama connectivity and model availability."""
    from agents.model_registry import check_ollama_health
    return check_ollama_health()


@app.get("/api/ai/models/assignments")
def ai_model_assignments():
    """Get current model-to-role assignments."""
    from agents.model_registry import get_model_assignments
    return {"ok": True, "assignments": get_model_assignments()}


@app.put("/api/ai/models/assignments")
def ai_set_model_assignment(body: ModelAssignmentRequest):
    """Assign a model to a role (chat, analysis, embedding, screening, etc.)."""
    from agents.model_registry import set_model_assignment
    return set_model_assignment(body.role, body.model, body.fallback)


# --- Ollama Instances ---
@app.get("/api/ai/instances")
def ai_list_instances():
    """List configured Ollama instances."""
    from agents.model_registry import get_ollama_instances
    return {"ok": True, "instances": get_ollama_instances()}


@app.post("/api/ai/instances")
def ai_add_instance(body: OllamaInstanceRequest):
    """Add or update an Ollama instance."""
    from agents.model_registry import add_ollama_instance
    return add_ollama_instance(body.instance_id, body.label, body.base_url)


@app.delete("/api/ai/instances/{instance_id}")
def ai_remove_instance(instance_id: str):
    """Remove a non-default Ollama instance."""
    from agents.model_registry import remove_ollama_instance
    return remove_ollama_instance(instance_id)


# --- AI Screener & Alerts ---
@app.post("/api/ai/screener/scan")
def ai_screener_scan(body: ScreenerScanRequest):
    """Run AI-powered screener scan on watchlist/portfolio symbols."""
    from agents.screener_agent import run_screener_scan
    return run_screener_scan(
        symbols=body.symbols,
        use_ai=body.use_ai,
        model=body.model,
    )


@app.post("/api/ai/screener/scan/background")
def ai_screener_scan_background(body: ScreenerScanRequest):
    """Run screener in background thread. Returns job_id."""
    from agents.screener_agent import run_screener_scan

    job_id = uuid.uuid4().hex[:12]
    SCREENER_JOBS[job_id] = {"job_id": job_id, "status": "running", "result": None}

    def _run():
        try:
            result = run_screener_scan(symbols=body.symbols, use_ai=body.use_ai, model=body.model)
            SCREENER_JOBS[job_id] = {"job_id": job_id, "status": "completed", "result": result}
        except Exception as e:
            SCREENER_JOBS[job_id] = {"job_id": job_id, "status": "failed", "error": str(e)}

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return {"ok": True, "job_id": job_id, "status": "running"}


@app.get("/api/ai/screener/scan/status/{job_id}")
def ai_screener_scan_status(job_id: str):
    """Check background screener job status."""
    job = SCREENER_JOBS.get(job_id)
    if not job:
        return {"ok": False, "error": "Unknown job_id"}
    return {"ok": True, **job}


@app.get("/api/ai/alerts")
def ai_get_alerts(limit: int = 50, symbol: str | None = None, unread_only: bool = False, severity: str | None = None):
    """Get stored alerts."""
    from agents.screener_agent import get_alerts
    return {"ok": True, "alerts": get_alerts(limit=limit, symbol=symbol, unread_only=unread_only, severity=severity)}


@app.put("/api/ai/alerts/read")
def ai_mark_alerts_read(body: AlertActionRequest):
    """Mark alerts as read."""
    from agents.screener_agent import mark_alerts_read
    return mark_alerts_read(body.alert_ids)


@app.put("/api/ai/alerts/dismiss")
def ai_dismiss_alerts(body: AlertActionRequest):
    """Dismiss alerts."""
    from agents.screener_agent import dismiss_alerts
    return dismiss_alerts(body.alert_ids)


@app.get("/api/ai/screener/history")
def ai_scan_history(limit: int = 20):
    """Get recent scan run history."""
    from agents.screener_agent import get_scan_history
    return {"ok": True, "history": get_scan_history(limit=limit)}


# In-memory screener job tracking
SCREENER_JOBS: dict = {}


# ==========================================
# FINAI & LEARNING MODEL ENDPOINTS
# ==========================================

class SentimentRequest(BaseModel):
    texts: list[str] | None = None
    symbol: str | None = None
    model: str | None = None


class ForecastRequest(BaseModel):
    symbol: str
    horizon_days: int = 5
    method: str = "ensemble"


class EntityExtractionRequest(BaseModel):
    text: str
    model: str | None = None


class EarningsAnalysisRequest(BaseModel):
    text: str
    symbol: str | None = None
    model: str | None = None


class EvaluationRequest(BaseModel):
    user_query: str
    ai_response: str
    rating: int
    feedback_text: str | None = None
    correction: str | None = None
    tags: list[str] | None = None
    symbol: str | None = None
    topic: str | None = None
    session_id: str | None = None


# --- FinAI Endpoints ---
@app.get("/api/finai/capabilities")
def finai_capabilities():
    """Discover available FinAI features and installed models."""
    from agents.finai_integrations import discover_finai_capabilities
    return discover_finai_capabilities()


@app.get("/api/finai/config")
def finai_get_config():
    """Get FinAI configuration."""
    from agents.finai_integrations import get_finai_config
    return {"ok": True, "config": get_finai_config()}


@app.put("/api/finai/config")
def finai_set_config(config: dict):
    """Update FinAI configuration."""
    from agents.finai_integrations import save_finai_config
    return save_finai_config(config)


@app.post("/api/finai/sentiment")
def finai_sentiment(body: SentimentRequest):
    """Analyze financial sentiment for texts or a symbol's news."""
    from agents.finai_integrations import analyze_sentiment, analyze_news_sentiment
    if body.symbol:
        return analyze_news_sentiment(body.symbol, model=body.model)
    if body.texts:
        results = analyze_sentiment(body.texts, model=body.model)
        return {"ok": True, "results": results}
    return {"ok": False, "error": "Provide either 'symbol' or 'texts'."}


@app.post("/api/finai/forecast")
def finai_forecast(body: ForecastRequest):
    """Generate price forecast using statistical models."""
    from agents.finai_integrations import forecast_price
    return forecast_price(body.symbol, body.horizon_days, body.method)


@app.post("/api/finai/entities")
def finai_entities(body: EntityExtractionRequest):
    """Extract financial entities (tickers, amounts, metrics) from text."""
    from agents.finai_integrations import extract_financial_entities
    return extract_financial_entities(body.text, model=body.model)


@app.post("/api/finai/earnings")
def finai_earnings(body: EarningsAnalysisRequest):
    """Analyze earnings-related text with AI."""
    from agents.finai_integrations import analyze_earnings_text
    return analyze_earnings_text(body.text, symbol=body.symbol, model=body.model)


@app.post("/api/finai/strategies/{symbol}")
def finai_strategies(symbol: str):
    """Generate trading strategy ideas for a symbol."""
    from agents.finai_integrations import generate_strategy_ideas
    return generate_strategy_ideas(symbol)


# --- Learning Model Endpoints ---
@app.post("/api/ai/evaluate")
def ai_submit_evaluation(body: EvaluationRequest):
    """Submit user evaluation of an AI response to improve future outputs."""
    from agents.learning_model import submit_evaluation
    return submit_evaluation(
        user_query=body.user_query,
        ai_response=body.ai_response,
        rating=body.rating,
        feedback_text=body.feedback_text,
        correction=body.correction,
        tags=body.tags,
        symbol=body.symbol,
        topic=body.topic,
        session_id=body.session_id,
    )


@app.get("/api/ai/learning/stats")
def ai_learning_stats():
    """Get learning model statistics — evaluations, patterns, preferences."""
    from agents.learning_model import get_learning_stats
    return get_learning_stats()


@app.get("/api/ai/learning/preferences")
def ai_learning_preferences():
    """Get learned user preferences."""
    from agents.learning_model import get_preferences
    return get_preferences()


@app.post("/api/ai/learning/reset")
def ai_learning_reset():
    """Reset all learning data (evaluations, patterns, preferences)."""
    from agents.learning_model import reset_learning_data
    return reset_learning_data()


@app.get("/api/ai/learning/export")
def ai_learning_export():
    """Export all learning data for backup."""
    from agents.learning_model import export_learning_data
    return export_learning_data()


# ==========================================
# LAB — Research & Model Laboratory
# ==========================================

class InsightCreateRequest(BaseModel):
    name: str
    description: str = ""
    formula: str
    symbols: list[str] = []
    params: dict = {}

class InsightRunRequest(BaseModel):
    symbol: str

class ResearchTopicRequest(BaseModel):
    query: str
    sources: list[str] = ["arxiv", "google_scholar", "financial_news"]
    max_results: int = 10

class ResearchSymbolRequest(BaseModel):
    symbol: str
    aspects: list[str] = ["fundamental", "technical", "sentiment"]

class RunModelRequest(BaseModel):
    model_name: str
    params: dict = {}

class SearchPapersRequest(BaseModel):
    query: str
    source: str = "arxiv"
    max_results: int = 5

class SavePaperRequest(BaseModel):
    paper_id: str
    notes: str = ""

class FetchPaperRequest(BaseModel):
    url: str


# -- Custom Insights --

@app.get("/api/lab/insights")
def lab_list_insights():
    """List all custom insights."""
    from agents.lab_engine import InsightEngine
    engine = InsightEngine()
    return {"ok": True, "insights": engine.list_insights()}

@app.post("/api/lab/insights")
def lab_create_insight(req: InsightCreateRequest):
    """Create a new custom insight."""
    from agents.lab_engine import InsightEngine
    engine = InsightEngine()
    return engine.create_insight(
        name=req.name, description=req.description,
        formula=req.formula, symbols=req.symbols, params=req.params
    )

@app.post("/api/lab/insights/{insight_id}/run")
def lab_run_insight(insight_id: str, req: InsightRunRequest):
    """Run an insight against a symbol."""
    from agents.lab_engine import InsightEngine
    engine = InsightEngine()
    return engine.run_insight(insight_id, req.symbol)

@app.get("/api/lab/insights/{insight_id}/export")
def lab_export_insight(insight_id: str):
    """Export insight definition as JSON."""
    from agents.lab_engine import InsightEngine
    engine = InsightEngine()
    return engine.export_insight(insight_id)

@app.delete("/api/lab/insights/{insight_id}")
def lab_delete_insight(insight_id: str):
    """Delete an insight."""
    from agents.lab_engine import InsightEngine
    engine = InsightEngine()
    return engine.delete_insight(insight_id)


# -- Incognito Web Research --

@app.post("/api/lab/research/topic")
def lab_research_topic(req: ResearchTopicRequest):
    """Run incognito web research on a topic."""
    from agents.lab_engine import IncognitoResearchEngine
    engine = IncognitoResearchEngine()
    return engine.research_topic(req.query, sources=req.sources, max_results=req.max_results)

@app.post("/api/lab/research/symbol")
def lab_research_symbol(req: ResearchSymbolRequest):
    """Run incognito research on a specific symbol."""
    from agents.lab_engine import IncognitoResearchEngine
    engine = IncognitoResearchEngine()
    return engine.research_symbol(req.symbol, aspects=req.aspects)

@app.post("/api/lab/research/fetch")
def lab_fetch_paper(req: FetchPaperRequest):
    """Fetch and parse a paper/article via incognito session."""
    from agents.lab_engine import IncognitoResearchEngine
    engine = IncognitoResearchEngine()
    return engine.fetch_paper(req.url)


# -- Open-Source Models Library --

@app.get("/api/lab/models")
def lab_list_models():
    """List all available open-source models."""
    from agents.lab_engine import ModelsLibrary
    lib = ModelsLibrary()
    return {"ok": True, "models": lib.list_models()}

@app.get("/api/lab/models/{model_name}")
def lab_model_info(model_name: str):
    """Get detailed info about a model."""
    from agents.lab_engine import ModelsLibrary
    lib = ModelsLibrary()
    return lib.get_model_info(model_name)

@app.post("/api/lab/models/run")
def lab_run_model(req: RunModelRequest):
    """Run a model with given parameters."""
    from agents.lab_engine import ModelsLibrary
    lib = ModelsLibrary()
    return lib.run_model(req.model_name, req.params)


# -- Research Paper Integration --

@app.post("/api/lab/papers/search")
def lab_search_papers(req: SearchPapersRequest):
    """Search for research papers."""
    from agents.lab_engine import PaperIntegrationEngine
    engine = PaperIntegrationEngine()
    return engine.search_papers(req.query, source=req.source, max_results=req.max_results)

@app.get("/api/lab/papers/{paper_id}/metadata")
def lab_paper_metadata(paper_id: str, source: str = "arxiv"):
    """Get paper metadata."""
    from agents.lab_engine import PaperIntegrationEngine
    engine = PaperIntegrationEngine()
    return engine.fetch_paper_metadata(paper_id, source=source)

@app.post("/api/lab/papers/{paper_id}/summarize")
def lab_summarize_paper(paper_id: str):
    """Summarize a paper using local AI."""
    from agents.lab_engine import PaperIntegrationEngine
    engine = PaperIntegrationEngine()
    return engine.summarize_paper(paper_id)

@app.post("/api/lab/papers/{paper_id}/extract-models")
def lab_extract_paper_models(paper_id: str):
    """Extract mathematical models from a paper."""
    from agents.lab_engine import PaperIntegrationEngine
    engine = PaperIntegrationEngine()
    return engine.extract_paper_models(paper_id)

@app.post("/api/lab/papers/save")
def lab_save_paper(req: SavePaperRequest):
    """Save a paper to local library."""
    from agents.lab_engine import PaperIntegrationEngine
    engine = PaperIntegrationEngine()
    return engine.save_paper(req.paper_id, user_notes=req.notes)

@app.get("/api/lab/papers/saved")
def lab_list_saved_papers():
    """List all saved papers."""
    from agents.lab_engine import PaperIntegrationEngine
    engine = PaperIntegrationEngine()
    return {"ok": True, "papers": engine.list_saved_papers()}
