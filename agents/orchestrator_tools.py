"""
Expanded tool set for the unified orchestrator agent.

Combines all existing tools (context, download) plus new capabilities:
- Portfolio queries (holdings, P&L, allocation)
- Multi-symbol comparison
- Technical indicators (RSI, MACD, Bollinger)
- Watchlist operations
- Screener / pattern detection
- Macro aggregation
"""
from __future__ import annotations

import os
import sys

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import json
import numpy as np
import pandas as pd
from typing import Any

# ---------------------------------------------------------------------------
# Import existing tool modules
# ---------------------------------------------------------------------------
from agents.context_tools import (
    tool_refresh_news,
    tool_load_saved_news,
    tool_run_open_ingest,
    tool_open_context_for_symbol,
    tool_consumer_preview,
    tool_ohlc_tail,
)
from agents.download_tools import (
    tool_prepare_data_folders,
    tool_list_categories,
    tool_get_category_symbols,
    tool_download_symbols,
    tool_download_category,
)


# ---------------------------------------------------------------------------
# New: Portfolio tools
# ---------------------------------------------------------------------------
def tool_get_portfolio_holdings(portfolio_name: str = "Main", **_) -> dict:
    """Get current holdings for a portfolio with P&L."""
    try:
        from context.watchlist_store import get_portfolios
        from context.portfolio_ledger import derive_holdings_from_transactions
        portfolios = get_portfolios()
        txns = portfolios.get(portfolio_name, [])
        if not txns:
            return {"ok": True, "empty": True, "hint": f"No transactions in portfolio '{portfolio_name}'."}
        holdings = derive_holdings_from_transactions(txns)
        summary = []
        for h in holdings[:30]:  # Cap for context window
            summary.append({
                "symbol": h.get("symbol", ""),
                "quantity": h.get("quantity", 0),
                "avg_price": round(h.get("avg_price", 0), 2),
                "current_value": round(h.get("current_value", 0), 2),
                "pnl": round(h.get("pnl", 0), 2),
                "pnl_pct": round(h.get("pnl_pct", 0), 2),
            })
        return {"ok": True, "portfolio": portfolio_name, "holdings_count": len(holdings), "holdings": summary}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def tool_list_portfolios(**_) -> dict:
    """List all portfolio names and transaction counts."""
    try:
        from context.watchlist_store import get_portfolios
        portfolios = get_portfolios()
        return {
            "ok": True,
            "portfolios": [
                {"name": name, "transaction_count": len(txns)}
                for name, txns in portfolios.items()
            ],
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


def tool_portfolio_analytics(portfolio_name: str = "Main", **_) -> dict:
    """Get portfolio analytics — allocation, total value, top holdings."""
    try:
        from context.watchlist_store import get_portfolios
        from context.portfolio_reports import build_portfolio_copilot_context
        portfolios = get_portfolios()
        result = build_portfolio_copilot_context(portfolios, portfolio_name)
        return {"ok": True, **result}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def tool_portfolio_tax_summary(portfolio_name: str = "Main", fy: str | None = None, **_) -> dict:
    """Get tax summary for a portfolio (India rules: STCG/LTCG)."""
    try:
        from context.watchlist_store import get_portfolios
        from context.portfolio_reports import derive_tax_summary
        portfolios = get_portfolios()
        report = derive_tax_summary(portfolios, portfolio_name, fy=fy)
        return {"ok": True, "report": report}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ---------------------------------------------------------------------------
# New: Technical indicator tools
# ---------------------------------------------------------------------------
def _load_ohlc_df(symbol: str, timeframe: str = "1d") -> pd.DataFrame | None:
    """Load OHLC from local parquet."""
    import market_download as md
    try:
        tf_dir = os.path.join(md.DATA_DIR, timeframe)
        fname = f"{symbol.replace('/', '_').replace('^', '_')}.parquet"
        fpath = os.path.join(tf_dir, fname)
        if os.path.exists(fpath):
            return pd.read_parquet(fpath)
        # Try sqlite
        db_path = os.path.join(md.DATA_DIR, "ohlc.sqlite")
        if os.path.exists(db_path):
            conn = sqlite3.connect(db_path)
            df = pd.read_sql(
                f"SELECT * FROM ohlc WHERE symbol = ? ORDER BY date ASC",
                conn, params=(symbol,)
            )
            conn.close()
            if not df.empty:
                df["date"] = pd.to_datetime(df["date"])
                df = df.set_index("date")
                return df
    except Exception:
        pass
    return None


def tool_technical_indicators(symbol: str, indicators: list[str] | None = None, period: int = 14, **_) -> dict:
    """
    Calculate technical indicators for a symbol.
    Available: rsi, sma_20, sma_50, sma_200, ema_12, ema_26, macd, bollinger, atr, vwap
    """
    import sqlite3
    df = _load_ohlc_df(symbol)
    if df is None or df.empty:
        return {"ok": False, "error": f"No OHLC data for {symbol}. Download it first."}

    requested = indicators or ["rsi", "sma_20", "sma_50", "macd", "bollinger"]
    close = df["Close"].astype(float)
    high = df["High"].astype(float) if "High" in df.columns else close
    low = df["Low"].astype(float) if "Low" in df.columns else close
    volume = df["Volume"].astype(float) if "Volume" in df.columns else pd.Series(0, index=close.index)

    results: dict[str, Any] = {"symbol": symbol, "last_close": round(float(close.iloc[-1]), 2), "data_points": len(close)}

    for ind in requested:
        try:
            if ind == "rsi":
                delta = close.diff()
                gain = delta.where(delta > 0, 0).rolling(window=period).mean()
                loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
                rs = gain / loss.replace(0, np.nan)
                rsi = 100 - (100 / (1 + rs))
                results["rsi"] = round(float(rsi.iloc[-1]), 2) if not rsi.empty and pd.notna(rsi.iloc[-1]) else None
                results["rsi_signal"] = "overbought" if results["rsi"] and results["rsi"] > 70 else ("oversold" if results["rsi"] and results["rsi"] < 30 else "neutral")

            elif ind.startswith("sma_"):
                n = int(ind.split("_")[1])
                sma = close.rolling(window=n).mean()
                val = round(float(sma.iloc[-1]), 2) if not sma.empty and pd.notna(sma.iloc[-1]) else None
                results[ind] = val
                if val:
                    results[f"{ind}_vs_price"] = "above" if close.iloc[-1] > val else "below"

            elif ind.startswith("ema_"):
                n = int(ind.split("_")[1])
                ema = close.ewm(span=n, adjust=False).mean()
                results[ind] = round(float(ema.iloc[-1]), 2) if not ema.empty and pd.notna(ema.iloc[-1]) else None

            elif ind == "macd":
                ema12 = close.ewm(span=12, adjust=False).mean()
                ema26 = close.ewm(span=26, adjust=False).mean()
                macd_line = ema12 - ema26
                signal_line = macd_line.ewm(span=9, adjust=False).mean()
                histogram = macd_line - signal_line
                results["macd_line"] = round(float(macd_line.iloc[-1]), 4) if pd.notna(macd_line.iloc[-1]) else None
                results["macd_signal"] = round(float(signal_line.iloc[-1]), 4) if pd.notna(signal_line.iloc[-1]) else None
                results["macd_histogram"] = round(float(histogram.iloc[-1]), 4) if pd.notna(histogram.iloc[-1]) else None
                results["macd_trend"] = "bullish" if results.get("macd_histogram") and results["macd_histogram"] > 0 else "bearish"

            elif ind == "bollinger":
                sma20 = close.rolling(window=20).mean()
                std20 = close.rolling(window=20).std()
                upper = sma20 + 2 * std20
                lower = sma20 - 2 * std20
                results["bollinger_upper"] = round(float(upper.iloc[-1]), 2) if pd.notna(upper.iloc[-1]) else None
                results["bollinger_middle"] = round(float(sma20.iloc[-1]), 2) if pd.notna(sma20.iloc[-1]) else None
                results["bollinger_lower"] = round(float(lower.iloc[-1]), 2) if pd.notna(lower.iloc[-1]) else None
                if results["bollinger_upper"] and results["bollinger_lower"]:
                    bw = (results["bollinger_upper"] - results["bollinger_lower"]) / results["bollinger_middle"] * 100
                    results["bollinger_width_pct"] = round(bw, 2)
                    price = float(close.iloc[-1])
                    results["bollinger_position"] = "near_upper" if price > results["bollinger_upper"] * 0.98 else ("near_lower" if price < results["bollinger_lower"] * 1.02 else "mid_band")

            elif ind == "atr":
                tr = pd.concat([
                    high - low,
                    (high - close.shift(1)).abs(),
                    (low - close.shift(1)).abs(),
                ], axis=1).max(axis=1)
                atr = tr.rolling(window=period).mean()
                results["atr"] = round(float(atr.iloc[-1]), 2) if pd.notna(atr.iloc[-1]) else None
                if results["atr"]:
                    results["atr_pct"] = round(results["atr"] / float(close.iloc[-1]) * 100, 2)

            elif ind == "vwap":
                typical_price = (high + low + close) / 3
                cum_tp_vol = (typical_price * volume).cumsum()
                cum_vol = volume.cumsum()
                vwap = cum_tp_vol / cum_vol.replace(0, np.nan)
                results["vwap"] = round(float(vwap.iloc[-1]), 2) if pd.notna(vwap.iloc[-1]) else None

        except Exception as e:
            results[ind] = f"error: {e}"

    return {"ok": True, **results}


# ---------------------------------------------------------------------------
# New: Multi-symbol comparison
# ---------------------------------------------------------------------------
def tool_compare_symbols(symbols: list[str], lookback_days: int = 90, **_) -> dict:
    """Compare price performance of multiple symbols over a lookback period."""
    import sqlite3
    if not symbols or len(symbols) < 2:
        return {"ok": False, "error": "Provide at least 2 symbols to compare."}
    if len(symbols) > 10:
        return {"ok": False, "error": "Max 10 symbols for comparison."}

    comparisons = []
    for sym in symbols:
        df = _load_ohlc_df(sym)
        if df is None or df.empty:
            comparisons.append({"symbol": sym, "error": "No data"})
            continue
        close = df["Close"].astype(float)
        recent = close.tail(lookback_days)
        if len(recent) < 2:
            comparisons.append({"symbol": sym, "error": "Insufficient data"})
            continue
        start_price = float(recent.iloc[0])
        end_price = float(recent.iloc[-1])
        returns = (end_price - start_price) / start_price * 100
        vol = float(recent.pct_change().std() * np.sqrt(252) * 100)
        comparisons.append({
            "symbol": sym,
            "start_price": round(start_price, 2),
            "current_price": round(end_price, 2),
            "return_pct": round(returns, 2),
            "annualized_vol_pct": round(vol, 2),
            "data_days": len(recent),
            "high": round(float(recent.max()), 2),
            "low": round(float(recent.min()), 2),
        })

    # Rank by return
    ranked = sorted([c for c in comparisons if "error" not in c], key=lambda x: x["return_pct"], reverse=True)
    for i, c in enumerate(ranked):
        c["rank"] = i + 1

    return {"ok": True, "lookback_days": lookback_days, "comparisons": comparisons}


# ---------------------------------------------------------------------------
# New: Watchlist tools
# ---------------------------------------------------------------------------
def tool_get_watchlist(**_) -> dict:
    """Get current watchlist symbols."""
    try:
        from context.watchlist_store import get_watchlist
        wl = get_watchlist()
        return {"ok": True, "symbols": wl, "count": len(wl)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def tool_watchlist_summary(**_) -> dict:
    """Get watchlist with latest headlines and asset info."""
    try:
        from context.watchlist_store import get_watchlist
        from context.news_store import load_saved_news
        from market_universe import symbol_profile
        wl = get_watchlist()
        rows = []
        for s in wl[:20]:
            n = load_saved_news(s)
            headline = "-"
            if n and n.get("items"):
                headline = (n["items"][0].get("title") or "-")[:120]
            profile = symbol_profile(s)
            rows.append({
                "symbol": s,
                "headline": headline,
                "asset_family": profile.get("asset_family", ""),
                "category": profile.get("category_label", ""),
            })
        return {"ok": True, "rows": rows, "count": len(wl)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ---------------------------------------------------------------------------
# New: Macro snapshot
# ---------------------------------------------------------------------------
def tool_macro_snapshot(lookback_days: int = 30, **_) -> dict:
    """Get macro aggregates across major indices."""
    import sqlite3
    indices = ["^GSPC", "^DJI", "^IXIC", "^NSEI", "^NSEBANK", "^VIX"]
    results = []
    for sym in indices:
        df = _load_ohlc_df(sym)
        if df is None or df.empty:
            continue
        close = df["Close"].astype(float).tail(lookback_days)
        if len(close) < 2:
            continue
        ret = (float(close.iloc[-1]) - float(close.iloc[0])) / float(close.iloc[0]) * 100
        results.append({
            "symbol": sym,
            "last_close": round(float(close.iloc[-1]), 2),
            "period_return_pct": round(ret, 2),
            "period_high": round(float(close.max()), 2),
            "period_low": round(float(close.min()), 2),
        })
    return {"ok": True, "lookback_days": lookback_days, "indices": results}


# ---------------------------------------------------------------------------
# New: Symbol search
# ---------------------------------------------------------------------------
def tool_search_symbols(query: str, limit: int = 15, **_) -> dict:
    """Search for symbols across all categories."""
    try:
        from market_universe import search_local_instruments
        results = search_local_instruments(query, limit=limit)
        return {"ok": True, "query": query, "results": results[:limit]}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Tool registry
# ---------------------------------------------------------------------------
TOOL_FUNCTIONS = {
    # Context tools (existing)
    "refresh_news": tool_refresh_news,
    "load_saved_news": tool_load_saved_news,
    "run_open_ingest": tool_run_open_ingest,
    "open_context_for_symbol": tool_open_context_for_symbol,
    "consumer_preview": tool_consumer_preview,
    "ohlc_tail": tool_ohlc_tail,
    # Download tools (existing)
    "prepare_data_folders": tool_prepare_data_folders,
    "list_categories": tool_list_categories,
    "get_category_symbols": tool_get_category_symbols,
    "download_symbols": tool_download_symbols,
    "download_category": tool_download_category,
    # Portfolio tools (new)
    "get_portfolio_holdings": tool_get_portfolio_holdings,
    "list_portfolios": tool_list_portfolios,
    "portfolio_analytics": tool_portfolio_analytics,
    "portfolio_tax_summary": tool_portfolio_tax_summary,
    # Technical analysis (new)
    "technical_indicators": tool_technical_indicators,
    "compare_symbols": tool_compare_symbols,
    # Watchlist (new)
    "get_watchlist": tool_get_watchlist,
    "watchlist_summary": tool_watchlist_summary,
    # Macro (new)
    "macro_snapshot": tool_macro_snapshot,
    # Search (new)
    "search_symbols": tool_search_symbols,
}


OLLAMA_TOOLS_SPEC: list[dict] = [
    # --- Context tools ---
    {
        "type": "function",
        "function": {
            "name": "refresh_news",
            "description": "Download latest news from yfinance (+ Finnhub/NewsAPI if configured) for a symbol.",
            "parameters": {
                "type": "object",
                "properties": {"symbol": {"type": "string", "description": "Ticker symbol e.g. AAPL, RELIANCE.NS"}},
                "required": ["symbol"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "load_saved_news",
            "description": "Read previously saved headlines for the symbol (no network call).",
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
            "name": "open_context_for_symbol",
            "description": "Filter open-context ledger (RSS, Reddit, court filings) for mentions of a symbol or company.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "limit": {"type": "integer", "description": "Max items (default 20)"},
                },
                "required": ["symbol"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "consumer_preview",
            "description": "India consumer complaint summary and complaint-vs-return correlation for a symbol.",
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
            "description": "Last N daily closes and volumes from local data for price context.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "rows": {"type": "integer", "description": "Number of rows (default 5)"},
                },
                "required": ["symbol"],
            },
        },
    },
    # --- Portfolio tools ---
    {
        "type": "function",
        "function": {
            "name": "get_portfolio_holdings",
            "description": "Get current holdings for a portfolio with symbol, quantity, average price, P&L. Use for questions about what stocks the user owns.",
            "parameters": {
                "type": "object",
                "properties": {
                    "portfolio_name": {"type": "string", "description": "Portfolio name (default: 'Main')"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_portfolios",
            "description": "List all portfolio names and transaction counts.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "portfolio_analytics",
            "description": "Get detailed portfolio analytics: allocation breakdown, total value, top holdings, segment distribution. Use for portfolio review questions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "portfolio_name": {"type": "string", "description": "Portfolio name (default: 'Main')"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "portfolio_tax_summary",
            "description": "India tax summary: STCG/LTCG calculations, holding periods, exemptions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "portfolio_name": {"type": "string"},
                    "fy": {"type": "string", "description": "Financial year e.g. '2024-25'"},
                },
                "required": [],
            },
        },
    },
    # --- Technical analysis ---
    {
        "type": "function",
        "function": {
            "name": "technical_indicators",
            "description": "Calculate technical indicators for a symbol: RSI, SMA (20/50/200), EMA, MACD, Bollinger Bands, ATR, VWAP. Returns current values and signals.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "indicators": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of indicators: rsi, sma_20, sma_50, sma_200, ema_12, ema_26, macd, bollinger, atr, vwap",
                    },
                    "period": {"type": "integer", "description": "Lookback period for RSI/ATR (default 14)"},
                },
                "required": ["symbol"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_symbols",
            "description": "Compare price performance, volatility, and returns across multiple symbols over a lookback period. Use for 'compare X vs Y' questions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbols": {"type": "array", "items": {"type": "string"}, "description": "2-10 ticker symbols to compare"},
                    "lookback_days": {"type": "integer", "description": "Number of days to look back (default 90)"},
                },
                "required": ["symbols"],
            },
        },
    },
    # --- Watchlist ---
    {
        "type": "function",
        "function": {
            "name": "get_watchlist",
            "description": "Get the user's current watchlist symbols.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "watchlist_summary",
            "description": "Get watchlist with latest headlines and asset info for each symbol.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    # --- Macro ---
    {
        "type": "function",
        "function": {
            "name": "macro_snapshot",
            "description": "Macro overview: returns and levels for major indices (S&P 500, Dow, Nasdaq, Nifty 50, Bank Nifty, VIX).",
            "parameters": {
                "type": "object",
                "properties": {
                    "lookback_days": {"type": "integer", "description": "Period in days (default 30)"},
                },
                "required": [],
            },
        },
    },
    # --- Search ---
    {
        "type": "function",
        "function": {
            "name": "search_symbols",
            "description": "Search for ticker symbols by name, ticker, or keyword across all asset categories.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query (company name, ticker, keyword)"},
                    "limit": {"type": "integer", "description": "Max results (default 15)"},
                },
                "required": ["query"],
            },
        },
    },
    # --- Download ---
    {
        "type": "function",
        "function": {
            "name": "download_symbols",
            "description": "Download OHLCV parquet files for specific symbols from Yahoo Finance.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbols": {"type": "array", "items": {"type": "string"}},
                    "sleep_seconds": {"type": "number", "description": "Delay between tickers (default 1.5)"},
                },
                "required": ["symbols"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_categories",
            "description": "List all ticker categories (e.g. SP_500, NSE_Equity, Forex_Majors).",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
]


def dispatch_tool(name: str, arguments: dict | None) -> dict:
    """Execute a tool by name with given arguments."""
    args = arguments if isinstance(arguments, dict) else {}
    fn = TOOL_FUNCTIONS.get(name)
    if not fn:
        return {"ok": False, "error": f"Unknown tool: {name}. Available: {list(TOOL_FUNCTIONS.keys())}"}
    try:
        return fn(**args)
    except TypeError as e:
        return {"ok": False, "error": f"Bad arguments for {name}: {e}"}
    except Exception as e:
        return {"ok": False, "error": f"{name} failed: {e}"}
