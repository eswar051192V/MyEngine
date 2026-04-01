"""
AI-powered screener and alerts agent.

Runs periodic scans on watchlist/portfolio symbols using local LLMs
to detect anomalies, patterns, and generate actionable alerts.
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Any

import requests

from agents.model_registry import resolve_model, _ollama_base
from agents.orchestrator_tools import (
    tool_technical_indicators,
    tool_ohlc_tail,
    tool_macro_snapshot,
)

ALERTS_DB = Path(os.environ.get("ALERTS_DB", "context_data/alerts.sqlite"))


def _ensure_alerts_db() -> None:
    ALERTS_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(ALERTS_DB))
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS alerts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol      TEXT NOT NULL,
            alert_type  TEXT NOT NULL,
            severity    TEXT NOT NULL DEFAULT 'info',
            title       TEXT NOT NULL,
            detail      TEXT NOT NULL DEFAULT '',
            data_json   TEXT,
            created_at  REAL NOT NULL,
            read        INTEGER NOT NULL DEFAULT 0,
            dismissed   INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_alerts_time ON alerts(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_alerts_symbol ON alerts(symbol, created_at DESC);

        CREATE TABLE IF NOT EXISTS scan_runs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at  REAL NOT NULL,
            finished_at REAL,
            symbols     TEXT,
            alerts_generated INTEGER DEFAULT 0,
            status      TEXT NOT NULL DEFAULT 'running',
            error       TEXT
        );
    """)
    conn.close()


# ---------------------------------------------------------------------------
# Rule-based screener (fast, no LLM needed)
# ---------------------------------------------------------------------------
def _screen_symbol_rules(symbol: str) -> list[dict]:
    """Run fast rule-based checks on a symbol. Returns list of alert dicts."""
    alerts = []

    # Technical indicators
    ti = tool_technical_indicators(symbol, indicators=["rsi", "macd", "bollinger", "sma_50", "sma_200", "atr"])
    if not ti.get("ok"):
        return alerts

    # RSI extremes
    rsi = ti.get("rsi")
    if rsi is not None:
        if rsi > 75:
            alerts.append({
                "symbol": symbol,
                "alert_type": "rsi_overbought",
                "severity": "warning",
                "title": f"{symbol}: RSI overbought ({rsi})",
                "detail": f"RSI at {rsi} — significantly overbought. Watch for potential reversal.",
                "data": {"rsi": rsi},
            })
        elif rsi < 25:
            alerts.append({
                "symbol": symbol,
                "alert_type": "rsi_oversold",
                "severity": "warning",
                "title": f"{symbol}: RSI oversold ({rsi})",
                "detail": f"RSI at {rsi} — deeply oversold. Potential bounce opportunity.",
                "data": {"rsi": rsi},
            })

    # MACD crossover signal
    macd_hist = ti.get("macd_histogram")
    if macd_hist is not None:
        if abs(macd_hist) < 0.01 * (ti.get("last_close") or 1):
            alerts.append({
                "symbol": symbol,
                "alert_type": "macd_crossover",
                "severity": "info",
                "title": f"{symbol}: MACD near crossover",
                "detail": f"MACD histogram at {macd_hist} — potential signal line crossover approaching.",
                "data": {"macd_histogram": macd_hist, "macd_trend": ti.get("macd_trend")},
            })

    # Bollinger squeeze or band touch
    boll_pos = ti.get("bollinger_position")
    boll_width = ti.get("bollinger_width_pct")
    if boll_pos == "near_upper":
        alerts.append({
            "symbol": symbol,
            "alert_type": "bollinger_upper",
            "severity": "info",
            "title": f"{symbol}: Near upper Bollinger Band",
            "detail": f"Price touching upper band. Band width: {boll_width}%.",
            "data": {"position": boll_pos, "width_pct": boll_width},
        })
    elif boll_pos == "near_lower":
        alerts.append({
            "symbol": symbol,
            "alert_type": "bollinger_lower",
            "severity": "info",
            "title": f"{symbol}: Near lower Bollinger Band",
            "detail": f"Price touching lower band. Band width: {boll_width}%.",
            "data": {"position": boll_pos, "width_pct": boll_width},
        })
    if boll_width is not None and boll_width < 5:
        alerts.append({
            "symbol": symbol,
            "alert_type": "bollinger_squeeze",
            "severity": "warning",
            "title": f"{symbol}: Bollinger Band squeeze ({boll_width}%)",
            "detail": "Tight bands suggest a big move is coming. Watch for breakout direction.",
            "data": {"width_pct": boll_width},
        })

    # Golden/Death cross (SMA 50 vs 200)
    sma50 = ti.get("sma_50")
    sma200 = ti.get("sma_200")
    if sma50 and sma200:
        ratio = sma50 / sma200
        if 0.99 < ratio < 1.01:
            cross_type = "golden_cross" if sma50 > sma200 else "death_cross"
            alerts.append({
                "symbol": symbol,
                "alert_type": cross_type,
                "severity": "warning",
                "title": f"{symbol}: {'Golden' if cross_type == 'golden_cross' else 'Death'} cross forming",
                "detail": f"SMA50 ({sma50}) crossing SMA200 ({sma200}). Major trend signal.",
                "data": {"sma_50": sma50, "sma_200": sma200},
            })

    # High ATR (volatility spike)
    atr_pct = ti.get("atr_pct")
    if atr_pct and atr_pct > 5:
        alerts.append({
            "symbol": symbol,
            "alert_type": "high_volatility",
            "severity": "info",
            "title": f"{symbol}: High volatility (ATR {atr_pct}%)",
            "detail": f"Average True Range is {atr_pct}% of price — elevated volatility.",
            "data": {"atr_pct": atr_pct},
        })

    return alerts


# ---------------------------------------------------------------------------
# AI-enhanced screening (uses local LLM for synthesis)
# ---------------------------------------------------------------------------
def _ai_synthesize_alerts(
    symbol: str,
    rule_alerts: list[dict],
    model: str | None = None,
    ollama_base: str | None = None,
) -> str | None:
    """Use local LLM to synthesize rule-based alerts into actionable summary."""
    if not rule_alerts:
        return None

    resolved_model = resolve_model("screening", override=model, ollama_base=ollama_base)
    base = (ollama_base or _ollama_base()).rstrip("/")

    alert_text = "\n".join(f"- [{a['severity']}] {a['title']}: {a['detail']}" for a in rule_alerts)
    prompt = f"""You are a quantitative trading signal reviewer. Analyze these alerts for {symbol} and provide a 2-3 sentence actionable summary. Be direct and specific.

Alerts:
{alert_text}

Summary:"""

    try:
        r = requests.post(
            f"{base}/api/generate",
            json={"model": resolved_model, "prompt": prompt, "stream": False},
            timeout=120,
        )
        if r.status_code == 200:
            return r.json().get("response", "").strip()
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Full screener scan
# ---------------------------------------------------------------------------
def run_screener_scan(
    symbols: list[str] | None = None,
    use_ai: bool = True,
    model: str | None = None,
    ollama_base: str | None = None,
) -> dict[str, Any]:
    """
    Run a full screening scan on the given symbols (or watchlist + portfolio).

    Returns: {ok, scan_id, alerts, ai_summaries, stats}
    """
    _ensure_alerts_db()

    # Gather symbols
    if not symbols:
        try:
            from context.watchlist_store import get_watchlist, get_portfolios
            wl = get_watchlist()
            portfolios = get_portfolios()
            portfolio_syms = set()
            for txns in portfolios.values():
                for t in txns:
                    s = t.get("symbol", "")
                    if s:
                        portfolio_syms.add(s)
            symbols = list(set(wl) | portfolio_syms)
        except Exception:
            symbols = []

    if not symbols:
        return {"ok": False, "error": "No symbols to scan. Add to watchlist or portfolio first."}

    # Record scan run
    conn = sqlite3.connect(str(ALERTS_DB))
    now = time.time()
    cur = conn.execute(
        "INSERT INTO scan_runs (started_at, symbols, status) VALUES (?, ?, 'running')",
        (now, json.dumps(symbols)),
    )
    scan_id = cur.lastrowid
    conn.commit()

    all_alerts: list[dict] = []
    ai_summaries: dict[str, str] = {}

    for sym in symbols:
        try:
            # Rule-based screening
            sym_alerts = _screen_symbol_rules(sym)
            all_alerts.extend(sym_alerts)

            # AI synthesis per symbol (if enabled and there are alerts)
            if use_ai and sym_alerts:
                summary = _ai_synthesize_alerts(sym, sym_alerts, model=model, ollama_base=ollama_base)
                if summary:
                    ai_summaries[sym] = summary
        except Exception:
            continue

    # Store alerts in DB
    for alert in all_alerts:
        conn.execute(
            "INSERT INTO alerts (symbol, alert_type, severity, title, detail, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                alert["symbol"],
                alert["alert_type"],
                alert["severity"],
                alert["title"],
                alert["detail"],
                json.dumps(alert.get("data", {})),
                now,
            ),
        )

    conn.execute(
        "UPDATE scan_runs SET finished_at = ?, alerts_generated = ?, status = 'completed' WHERE id = ?",
        (time.time(), len(all_alerts), scan_id),
    )
    conn.commit()
    conn.close()

    return {
        "ok": True,
        "scan_id": scan_id,
        "symbols_scanned": len(symbols),
        "alerts": all_alerts,
        "ai_summaries": ai_summaries,
        "stats": {
            "total_alerts": len(all_alerts),
            "warnings": len([a for a in all_alerts if a["severity"] == "warning"]),
            "info": len([a for a in all_alerts if a["severity"] == "info"]),
            "symbols_with_alerts": len(set(a["symbol"] for a in all_alerts)),
        },
    }


# ---------------------------------------------------------------------------
# Alert management
# ---------------------------------------------------------------------------
def get_alerts(
    limit: int = 50,
    symbol: str | None = None,
    unread_only: bool = False,
    severity: str | None = None,
) -> list[dict]:
    """Retrieve stored alerts."""
    _ensure_alerts_db()
    conn = sqlite3.connect(str(ALERTS_DB))
    conn.row_factory = sqlite3.Row

    where = ["dismissed = 0"]
    params: list[Any] = []
    if symbol:
        where.append("symbol = ?")
        params.append(symbol)
    if unread_only:
        where.append("read = 0")
    if severity:
        where.append("severity = ?")
        params.append(severity)

    query = f"SELECT * FROM alerts WHERE {' AND '.join(where)} ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    rows = conn.execute(query, params).fetchall()
    conn.close()

    return [
        {
            "id": r["id"],
            "symbol": r["symbol"],
            "alert_type": r["alert_type"],
            "severity": r["severity"],
            "title": r["title"],
            "detail": r["detail"],
            "data": json.loads(r["data_json"]) if r["data_json"] else {},
            "created_at": r["created_at"],
            "read": bool(r["read"]),
        }
        for r in rows
    ]


def mark_alerts_read(alert_ids: list[int] | None = None) -> dict:
    """Mark alerts as read. If no IDs given, mark all as read."""
    _ensure_alerts_db()
    conn = sqlite3.connect(str(ALERTS_DB))
    if alert_ids:
        placeholders = ",".join("?" * len(alert_ids))
        conn.execute(f"UPDATE alerts SET read = 1 WHERE id IN ({placeholders})", alert_ids)
    else:
        conn.execute("UPDATE alerts SET read = 1 WHERE read = 0")
    conn.commit()
    conn.close()
    return {"ok": True}


def dismiss_alerts(alert_ids: list[int]) -> dict:
    """Dismiss (soft-delete) alerts."""
    _ensure_alerts_db()
    conn = sqlite3.connect(str(ALERTS_DB))
    placeholders = ",".join("?" * len(alert_ids))
    conn.execute(f"UPDATE alerts SET dismissed = 1 WHERE id IN ({placeholders})", alert_ids)
    conn.commit()
    conn.close()
    return {"ok": True}


def get_scan_history(limit: int = 20) -> list[dict]:
    """Get recent scan runs."""
    _ensure_alerts_db()
    conn = sqlite3.connect(str(ALERTS_DB))
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [
        {
            "id": r["id"],
            "started_at": r["started_at"],
            "finished_at": r["finished_at"],
            "symbols": json.loads(r["symbols"]) if r["symbols"] else [],
            "alerts_generated": r["alerts_generated"],
            "status": r["status"],
            "error": r["error"],
        }
        for r in rows
    ]
