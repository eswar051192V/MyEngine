from __future__ import annotations

import logging
import os
import sqlite3
from collections import deque
from datetime import datetime
from threading import Lock
from typing import Any
from zoneinfo import ZoneInfo

from apscheduler.executors.pool import ThreadPoolExecutor
from apscheduler.jobstores.memory import MemoryJobStore
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from context.exchange_session import is_exchange_trading_day
from context.portfolio_ledger import derive_holdings_from_transactions
from context.watchlist_store import get_portfolios, get_watchlist
from market_universe import EXCHANGE_SCHEDULE, get_symbols_by_exchange, is_market_open, symbol_profile
from market_download import batch_fetch_live_quotes, download_eod_bar, download_intraday_session

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None
_scheduler_lock = Lock()
_registered_defaults = False
_job_last_runs: dict[str, dict[str, Any]] = {}
_job_last_runs_lock = Lock()
_live_quote_cache: dict[str, dict[str, Any]] = {}
_live_quote_cache_lock = Lock()
_log_buffer: deque[dict[str, Any]] = deque(maxlen=300)
_log_lock = Lock()


def _scheduler_db_path() -> str:
    base = os.path.abspath("local_market_data")
    os.makedirs(base, exist_ok=True)
    return os.path.join(base, "scheduler_jobs.sqlite")


def _live_quotes_db_path() -> str:
    base = os.path.abspath("local_market_data")
    os.makedirs(base, exist_ok=True)
    return os.path.join(base, "ohlc.sqlite")


def _log(message: str, level: str = "info", **extra: Any) -> None:
    row = {"ts": datetime.utcnow().isoformat(), "level": level, "message": message, "extra": extra}
    with _log_lock:
        _log_buffer.appendleft(row)
    if level == "error":
        logger.error("%s | %s", message, extra)
    elif level == "warning":
        logger.warning("%s | %s", message, extra)
    else:
        logger.info("%s | %s", message, extra)


def _set_last_run(job_id: str, *, status: str, message: str = "", stats: dict | None = None) -> None:
    payload = {
        "status": status,
        "message": message,
        "stats": stats or {},
        "finished_at": datetime.utcnow().isoformat(),
    }
    with _job_last_runs_lock:
        _job_last_runs[job_id] = payload


def _resolve_exchange_symbols(exchange: str) -> list[str]:
    grouped = get_symbols_by_exchange()
    return grouped.get(exchange, [])


def _all_watchlist_symbols() -> list[str]:
    return [str(s).strip().upper() for s in (get_watchlist() or []) if str(s).strip()]


def _portfolio_symbols_positive_quantity() -> list[str]:
    """Symbols with net held quantity > 0 across all portfolios (ledger-derived)."""
    portfolios = get_portfolios() or {}
    agg: dict[str, float] = {}
    for rows in portfolios.values():
        for holding in derive_holdings_from_transactions(rows or []):
            sym = str(holding.get("symbol") or "").strip().upper()
            qty = float(holding.get("quantity") or 0.0)
            if sym and qty > 0:
                agg[sym] = agg.get(sym, 0.0) + qty
    return sorted(sym for sym, qty in agg.items() if qty > 0)


def _filter_symbols_by_exchange(symbols: list[str], exchange: str) -> list[str]:
    out: list[str] = []
    for sym in symbols:
        try:
            if str(symbol_profile(sym).get("exchange") or "").strip() == exchange:
                out.append(sym)
        except Exception:
            continue
    return out


def _ensure_live_quotes_table() -> None:
    path = _live_quotes_db_path()
    with sqlite3.connect(path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS live_quotes (
                symbol TEXT NOT NULL,
                ts TEXT NOT NULL,
                price REAL,
                change REAL,
                change_pct REAL,
                volume REAL,
                source TEXT,
                PRIMARY KEY(symbol, ts)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_live_quotes_symbol_ts ON live_quotes(symbol, ts)")
        conn.commit()


def _append_live_quotes(rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    _ensure_live_quotes_table()
    path = _live_quotes_db_path()
    payload = []
    for row in rows:
        payload.append(
            (
                str(row.get("symbol") or "").upper(),
                str(row.get("ts") or datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")),
                float(row.get("price")) if row.get("price") is not None else None,
                float(row.get("change")) if row.get("change") is not None else None,
                float(row.get("change_pct")) if row.get("change_pct") is not None else None,
                float(row.get("volume")) if row.get("volume") is not None else None,
                str(row.get("source") or "yfinance"),
            )
        )
    with sqlite3.connect(path) as conn:
        conn.executemany(
            """
            INSERT OR REPLACE INTO live_quotes(symbol, ts, price, change, change_pct, volume, source)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            payload,
        )
        conn.commit()


def _eod_universe_download(exchange: str) -> None:
    job_id = f"eod_universe_{exchange.lower()}"
    if not is_exchange_trading_day(exchange):
        _set_last_run(job_id, status="skipped", message="Not a trading day (weekend/holiday)")
        _log("EOD universe skipped — not a trading day", exchange=exchange)
        return
    symbols = _resolve_exchange_symbols(exchange)
    if not symbols:
        _set_last_run(job_id, status="skipped", message="No symbols mapped to exchange")
        return
    ok = fail = 0
    for sym in symbols:
        try:
            if download_eod_bar(sym, interval="1d"):
                ok += 1
            else:
                fail += 1
        except Exception:
            fail += 1
    _set_last_run(job_id, status="ok", stats={"exchange": exchange, "successful": ok, "failed": fail, "total": len(symbols)})
    _log("EOD universe download finished", exchange=exchange, successful=ok, failed=fail, total=len(symbols))


def _eod_watchlist_download(exchange: str) -> None:
    job_id = f"eod_watchlist_{exchange.lower()}"
    if not is_exchange_trading_day(exchange):
        _set_last_run(job_id, status="skipped", message="Not a trading day (weekend/holiday)")
        _log("EOD watchlist skipped — not a trading day", exchange=exchange)
        return
    watchlist_symbols = _all_watchlist_symbols()
    symbols = _filter_symbols_by_exchange(watchlist_symbols, exchange)
    if not symbols:
        _set_last_run(job_id, status="skipped", message="No watchlist symbols for exchange")
        return
    ok = fail = 0
    for sym in symbols:
        try:
            if download_intraday_session(sym, interval="1m"):
                ok += 1
            else:
                fail += 1
        except Exception:
            fail += 1
    _set_last_run(job_id, status="ok", stats={"exchange": exchange, "successful": ok, "failed": fail, "total": len(symbols)})
    _log("EOD watchlist intraday download finished", exchange=exchange, successful=ok, failed=fail, total=len(symbols))


def _portfolio_live_fetch() -> None:
    job_id = "portfolio_live"
    all_symbols = _all_portfolio_symbols()
    if not all_symbols:
        _set_last_run(job_id, status="skipped", message="Portfolio has no symbols")
        return
    to_fetch: list[str] = []
    for sym in all_symbols:
        try:
            ex = str(symbol_profile(sym).get("exchange") or "")
            if ex and is_market_open(ex):
                to_fetch.append(sym)
        except Exception:
            continue
    if not to_fetch:
        _set_last_run(job_id, status="skipped", message="No open session for portfolio holdings (closed/holiday)")
        return
    quotes = batch_fetch_live_quotes(to_fetch)
    ts = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    rows: list[dict[str, Any]] = []
    for sym, quote in quotes.items():
        row = {"symbol": sym, "ts": ts, **quote, "source": "yfinance"}
        rows.append(row)
    _append_live_quotes(rows)
    with _live_quote_cache_lock:
        for row in rows:
            _live_quote_cache[row["symbol"]] = row
    _set_last_run(job_id, status="ok", stats={"total": len(to_fetch), "saved": len(rows)})
    _log("Portfolio live quote fetch completed", symbols=len(to_fetch), saved=len(rows))


def _register_default_jobs() -> None:
    global _registered_defaults
    sch = _scheduler
    if sch is None or _registered_defaults:
        return
    exchanges = sorted(set(EXCHANGE_SCHEDULE.keys()))
    for exchange in exchanges:
        cfg = EXCHANGE_SCHEDULE.get(exchange) or {}
        tz_name = str(cfg.get("tz") or "UTC")
        close_h = int(cfg.get("close_hour", 16))
        close_m = int(cfg.get("close_min", 0))
        universe_min = (close_m + 30) % 60
        universe_hour = (close_h + ((close_m + 30) // 60)) % 24
        watch_min = (close_m + 15) % 60
        watch_hour = (close_h + ((close_m + 15) // 60)) % 24

        sch.add_job(
            _eod_universe_download,
            trigger=CronTrigger(day_of_week="mon-fri", hour=universe_hour, minute=universe_min, timezone=ZoneInfo(tz_name)),
            kwargs={"exchange": exchange},
            id=f"eod_universe_{exchange.lower()}",
            replace_existing=True,
            misfire_grace_time=1200,
            coalesce=True,
            max_instances=1,
        )
        sch.add_job(
            _eod_watchlist_download,
            trigger=CronTrigger(day_of_week="mon-fri", hour=watch_hour, minute=watch_min, timezone=ZoneInfo(tz_name)),
            kwargs={"exchange": exchange},
            id=f"eod_watchlist_{exchange.lower()}",
            replace_existing=True,
            misfire_grace_time=1200,
            coalesce=True,
            max_instances=1,
        )

    sch.add_job(
        _portfolio_live_fetch,
        trigger=IntervalTrigger(seconds=60),
        id="portfolio_live",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=30,
    )
    _registered_defaults = True
    _log("Scheduler default jobs registered", total_jobs=len(sch.get_jobs()))


def start_scheduler() -> dict[str, Any]:
    global _scheduler
    with _scheduler_lock:
        if _scheduler and _scheduler.running:
            return get_scheduler_status()
        db_path = _scheduler_db_path()
        _scheduler = BackgroundScheduler(
            jobstores={
                "default": SQLAlchemyJobStore(url=f"sqlite:///{db_path}"),
                "memory": MemoryJobStore(),
            },
            executors={"default": ThreadPoolExecutor(max_workers=8)},
            timezone="UTC",
        )
        _scheduler.start(paused=False)
        _register_default_jobs()
        _log("Scheduler started", db_path=db_path)
    return get_scheduler_status()


def stop_scheduler() -> dict[str, Any]:
    global _scheduler
    with _scheduler_lock:
        if _scheduler:
            _scheduler.shutdown(wait=False)
            _scheduler = None
            _log("Scheduler stopped")
    return {"running": False, "jobs": []}


def get_job_list() -> list[dict[str, Any]]:
    sch = _scheduler
    if not sch:
        return []
    rows = []
    with _job_last_runs_lock:
        last = dict(_job_last_runs)
    for job in sch.get_jobs():
        next_run = job.next_run_time.isoformat() if job.next_run_time else None
        rows.append(
            {
                "id": job.id,
                "name": job.name,
                "next_run_time": next_run,
                "trigger": str(job.trigger),
                "paused": job.next_run_time is None,
                "last_run": last.get(job.id),
            }
        )
    return rows


def get_scheduler_status() -> dict[str, Any]:
    sch = _scheduler
    return {"running": bool(sch and sch.running), "jobs": get_job_list(), "job_count": len(get_job_list())}


def pause_job(job_id: str) -> bool:
    sch = _scheduler
    if not sch:
        return False
    try:
        sch.pause_job(job_id)
        _log("Scheduler job paused", job_id=job_id)
        return True
    except Exception:
        return False


def resume_job(job_id: str) -> bool:
    sch = _scheduler
    if not sch:
        return False
    try:
        sch.resume_job(job_id)
        _log("Scheduler job resumed", job_id=job_id)
        return True
    except Exception:
        return False


def trigger_job_now(job_id: str) -> bool:
    sch = _scheduler
    if not sch:
        return False
    try:
        sch.modify_job(job_id=job_id, next_run_time=datetime.now(ZoneInfo("UTC")))
        _log("Scheduler job triggered manually", job_id=job_id)
        return True
    except Exception:
        return False


def get_scheduler_logs(limit: int = 100) -> list[dict[str, Any]]:
    n = max(1, min(500, int(limit)))
    with _log_lock:
        return list(_log_buffer)[:n]


def get_live_quote_cache(symbol: str | None = None) -> dict[str, Any]:
    with _live_quote_cache_lock:
        if symbol:
            return _live_quote_cache.get(str(symbol).upper(), {})
        return dict(_live_quote_cache)
