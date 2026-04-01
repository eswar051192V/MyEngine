"""
Open-source Financial AI integrations.

Connects to popular open-source finance-specific models and tools
that run locally alongside the base Ollama models. These provide
specialized financial reasoning, sentiment analysis, and forecasting.

Supported integrations:
1. FinGPT-style sentiment analysis (via Ollama fine-tuned models)
2. FinBERT sentiment classification (via local transformers)
3. Time-series forecasting (custom statistical + ML models)
4. Financial entity extraction (NER for tickers, amounts, dates)
5. Earnings/SEC document analysis pipeline
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import requests

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from agents.model_registry import resolve_model, _ollama_base

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
FINAI_CONFIG_PATH = Path(os.environ.get("FINAI_CONFIG", "context_data/finai_config.json"))
FINAI_CACHE_DIR = Path(os.environ.get("FINAI_CACHE", "context_data/finai_cache"))

# Well-known finance-tuned models available on Ollama
RECOMMENDED_FIN_MODELS = {
    "sentiment": {
        "models": ["finma", "fingpt", "llama3.1"],
        "description": "Financial sentiment analysis — bullish/bearish/neutral classification",
    },
    "analyst": {
        "models": ["deepseek-r1", "qwen2.5", "llama3.1", "mistral"],
        "description": "Deep financial reasoning and analysis",
    },
    "coder": {
        "models": ["deepseek-coder-v2", "codellama", "qwen2.5-coder"],
        "description": "Quantitative strategy code generation",
    },
    "summarizer": {
        "models": ["phi3", "gemma2", "llama3.1"],
        "description": "Fast document and earnings summarization",
    },
}


def get_finai_config() -> dict:
    """Load FinAI config or return defaults."""
    if FINAI_CONFIG_PATH.exists():
        try:
            return json.loads(FINAI_CONFIG_PATH.read_text())
        except Exception:
            pass
    return {
        "sentiment_model": None,
        "analyst_model": None,
        "finbert_enabled": False,
        "timeseries_enabled": True,
        "ner_enabled": True,
    }


def save_finai_config(config: dict) -> dict:
    FINAI_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    FINAI_CONFIG_PATH.write_text(json.dumps(config, indent=2))
    return {"ok": True}


# ---------------------------------------------------------------------------
# 1. Financial Sentiment Analysis (via Ollama)
# ---------------------------------------------------------------------------
SENTIMENT_SYSTEM = """You are a financial sentiment classifier.
Given a piece of financial text (news headline, social media post, analyst comment), classify the sentiment.

Output ONLY a JSON object with these fields:
- sentiment: "bullish", "bearish", or "neutral"
- confidence: float between 0 and 1
- reasoning: one sentence explanation

Example output:
{"sentiment": "bullish", "confidence": 0.85, "reasoning": "Strong earnings beat suggests positive momentum."}"""


def analyze_sentiment(
    texts: list[str],
    model: str | None = None,
    ollama_base: str | None = None,
) -> list[dict]:
    """
    Classify financial sentiment for a list of texts.
    Uses a finance-tuned model if available, otherwise falls back to general.
    """
    config = get_finai_config()
    resolved = model or config.get("sentiment_model") or resolve_model("summarizer", ollama_base=ollama_base)
    base = (ollama_base or _ollama_base()).rstrip("/")

    results = []
    for text in texts[:50]:  # Cap at 50
        try:
            r = requests.post(
                f"{base}/api/chat",
                json={
                    "model": resolved,
                    "messages": [
                        {"role": "system", "content": SENTIMENT_SYSTEM},
                        {"role": "user", "content": text},
                    ],
                    "stream": False,
                    "format": "json",
                },
                timeout=60,
            )
            if r.status_code == 200:
                content = r.json().get("message", {}).get("content", "")
                try:
                    parsed = json.loads(content)
                    parsed["text"] = text[:200]
                    results.append(parsed)
                except json.JSONDecodeError:
                    results.append({"text": text[:200], "sentiment": "unknown", "confidence": 0, "reasoning": content[:200]})
            else:
                results.append({"text": text[:200], "sentiment": "error", "error": f"HTTP {r.status_code}"})
        except Exception as e:
            results.append({"text": text[:200], "sentiment": "error", "error": str(e)})

    return results


def analyze_news_sentiment(symbol: str, model: str | None = None) -> dict:
    """Fetch saved news for a symbol and classify sentiment."""
    from context.news_store import load_saved_news
    news = load_saved_news(symbol)
    if not news or not news.get("items"):
        return {"ok": False, "error": f"No saved news for {symbol}. Refresh news first."}

    headlines = [item.get("title", "") for item in news["items"][:20] if item.get("title")]
    sentiments = analyze_sentiment(headlines, model=model)

    bullish = sum(1 for s in sentiments if s.get("sentiment") == "bullish")
    bearish = sum(1 for s in sentiments if s.get("sentiment") == "bearish")
    neutral = sum(1 for s in sentiments if s.get("sentiment") == "neutral")
    total = len(sentiments)

    avg_confidence = np.mean([s.get("confidence", 0) for s in sentiments if isinstance(s.get("confidence"), (int, float))]) if sentiments else 0

    composite = "neutral"
    if total > 0:
        if bullish / total > 0.5:
            composite = "bullish"
        elif bearish / total > 0.5:
            composite = "bearish"

    return {
        "ok": True,
        "symbol": symbol,
        "composite_sentiment": composite,
        "bullish": bullish,
        "bearish": bearish,
        "neutral": neutral,
        "total_analyzed": total,
        "avg_confidence": round(float(avg_confidence), 3),
        "details": sentiments,
    }


# ---------------------------------------------------------------------------
# 2. Time-Series Forecasting (statistical + ML)
# ---------------------------------------------------------------------------
def forecast_price(
    symbol: str,
    horizon_days: int = 5,
    method: str = "ensemble",
) -> dict:
    """
    Generate price forecast using statistical methods:
    - Linear regression trend
    - Exponential smoothing
    - Mean reversion model
    - Ensemble (weighted average)
    """
    from agents.orchestrator_tools import _load_ohlc_df
    import sqlite3

    df = _load_ohlc_df(symbol)
    if df is None or df.empty:
        return {"ok": False, "error": f"No OHLC data for {symbol}."}

    close = df["Close"].astype(float).dropna()
    if len(close) < 30:
        return {"ok": False, "error": "Need at least 30 data points for forecasting."}

    recent = close.tail(252)  # Last year
    last_price = float(recent.iloc[-1])
    returns = recent.pct_change().dropna()

    forecasts: dict[str, dict] = {}

    # Linear regression trend
    try:
        x = np.arange(len(recent)).reshape(-1, 1)
        y = recent.values
        x_mean = x.mean()
        y_mean = y.mean()
        slope = np.sum((x.flatten() - x_mean) * (y - y_mean)) / np.sum((x.flatten() - x_mean) ** 2)
        intercept = y_mean - slope * x_mean

        future_x = np.arange(len(recent), len(recent) + horizon_days)
        linear_forecast = slope * future_x + intercept
        forecasts["linear_trend"] = {
            "prices": [round(float(p), 2) for p in linear_forecast],
            "final_price": round(float(linear_forecast[-1]), 2),
            "change_pct": round((float(linear_forecast[-1]) - last_price) / last_price * 100, 2),
            "direction": "up" if slope > 0 else "down",
        }
    except Exception:
        pass

    # Exponential smoothing
    try:
        alpha = 0.3
        smoothed = [float(recent.iloc[0])]
        for val in recent.values[1:]:
            smoothed.append(alpha * float(val) + (1 - alpha) * smoothed[-1])
        level = smoothed[-1]
        trend = float(returns.tail(20).mean())
        exp_forecast = [level * (1 + trend) ** i for i in range(1, horizon_days + 1)]
        forecasts["exp_smoothing"] = {
            "prices": [round(p, 2) for p in exp_forecast],
            "final_price": round(exp_forecast[-1], 2),
            "change_pct": round((exp_forecast[-1] - last_price) / last_price * 100, 2),
        }
    except Exception:
        pass

    # Mean reversion
    try:
        sma_50 = float(recent.tail(50).mean())
        reversion_speed = 0.1
        mr_forecast = []
        current = last_price
        for _ in range(horizon_days):
            current = current + reversion_speed * (sma_50 - current)
            mr_forecast.append(round(current, 2))
        forecasts["mean_reversion"] = {
            "prices": mr_forecast,
            "final_price": mr_forecast[-1],
            "change_pct": round((mr_forecast[-1] - last_price) / last_price * 100, 2),
            "target": round(sma_50, 2),
        }
    except Exception:
        pass

    # Ensemble
    if len(forecasts) >= 2:
        all_finals = [f["final_price"] for f in forecasts.values()]
        ensemble_price = round(float(np.mean(all_finals)), 2)
        forecasts["ensemble"] = {
            "final_price": ensemble_price,
            "change_pct": round((ensemble_price - last_price) / last_price * 100, 2),
            "components": list(forecasts.keys()),
        }

    # Volatility context
    vol_20 = float(returns.tail(20).std() * np.sqrt(252) * 100) if len(returns) >= 20 else None
    confidence_band = round(last_price * (vol_20 / 100 / np.sqrt(252) * np.sqrt(horizon_days)), 2) if vol_20 else None

    return {
        "ok": True,
        "symbol": symbol,
        "last_price": last_price,
        "horizon_days": horizon_days,
        "forecasts": forecasts,
        "annualized_vol_pct": round(vol_20, 2) if vol_20 else None,
        "confidence_band_1sigma": confidence_band,
        "note": "Not investment advice. Statistical models have significant limitations.",
    }


# ---------------------------------------------------------------------------
# 3. Financial Entity Extraction (NER)
# ---------------------------------------------------------------------------
NER_SYSTEM = """Extract financial entities from the given text. Output ONLY a JSON object with:
- tickers: list of stock ticker symbols mentioned (uppercase)
- amounts: list of {value, currency, context} for monetary amounts
- dates: list of dates or time references
- metrics: list of financial metrics mentioned (e.g. "P/E ratio", "EPS", "revenue")
- events: list of financial events (e.g. "earnings", "IPO", "merger", "dividend")

Be precise. Only extract what's explicitly stated."""


def extract_financial_entities(
    text: str,
    model: str | None = None,
    ollama_base: str | None = None,
) -> dict:
    """Extract tickers, amounts, dates, and financial terms from text."""
    resolved = model or resolve_model("summarizer", ollama_base=ollama_base)
    base = (ollama_base or _ollama_base()).rstrip("/")

    try:
        r = requests.post(
            f"{base}/api/chat",
            json={
                "model": resolved,
                "messages": [
                    {"role": "system", "content": NER_SYSTEM},
                    {"role": "user", "content": text[:3000]},
                ],
                "stream": False,
                "format": "json",
            },
            timeout=60,
        )
        if r.status_code == 200:
            content = r.json().get("message", {}).get("content", "")
            try:
                entities = json.loads(content)
                return {"ok": True, **entities}
            except json.JSONDecodeError:
                return {"ok": False, "raw": content[:500]}
        return {"ok": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ---------------------------------------------------------------------------
# 4. AI-Powered Earnings Analysis
# ---------------------------------------------------------------------------
EARNINGS_SYSTEM = """You are a financial analyst. Analyze the given earnings-related text and provide:
1. Key financial highlights (revenue, EPS, margins)
2. Guidance changes (forward-looking statements)
3. Sentiment implications (positive/negative/mixed)
4. Risk factors mentioned
5. Comparison to market expectations if mentioned

Be concise and data-driven. Not investment advice."""


def analyze_earnings_text(
    text: str,
    symbol: str | None = None,
    model: str | None = None,
    ollama_base: str | None = None,
) -> dict:
    """Analyze earnings call transcripts, press releases, or SEC filings."""
    resolved = model or resolve_model("analysis", ollama_base=ollama_base)
    base = (ollama_base or _ollama_base()).rstrip("/")

    context = f"Company: {symbol}\n\n" if symbol else ""

    try:
        r = requests.post(
            f"{base}/api/chat",
            json={
                "model": resolved,
                "messages": [
                    {"role": "system", "content": EARNINGS_SYSTEM},
                    {"role": "user", "content": context + text[:8000]},
                ],
                "stream": False,
            },
            timeout=120,
        )
        if r.status_code == 200:
            analysis = r.json().get("message", {}).get("content", "")
            return {"ok": True, "symbol": symbol, "analysis": analysis}
        return {"ok": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ---------------------------------------------------------------------------
# 5. Strategy Idea Generator
# ---------------------------------------------------------------------------
STRATEGY_SYSTEM = """You are a quantitative strategist. Given the market data and user context, generate trading strategy ideas.

For each idea, provide:
- Strategy name
- Type (momentum, mean-reversion, event-driven, etc.)
- Entry conditions
- Exit conditions
- Risk management rules
- Expected holding period
- Confidence level (low/medium/high)

Base your ideas on the actual data provided. Be specific about price levels and conditions. Not investment advice."""


def generate_strategy_ideas(
    symbol: str,
    model: str | None = None,
    ollama_base: str | None = None,
) -> dict:
    """Generate trading strategy ideas based on local data for a symbol."""
    from agents.orchestrator_tools import tool_technical_indicators, tool_ohlc_tail

    # Gather data
    ti = tool_technical_indicators(symbol, indicators=["rsi", "macd", "bollinger", "sma_50", "sma_200", "atr"])
    ohlc = tool_ohlc_tail(symbol, rows=10)

    data_context = f"Symbol: {symbol}\n"
    if ti.get("ok"):
        data_context += f"Technical Indicators: {json.dumps({k: v for k, v in ti.items() if k != 'ok'}, indent=2)}\n"
    if ohlc.get("ok"):
        data_context += f"Recent OHLC: {json.dumps(ohlc.get('tail', []))}\n"

    resolved = model or resolve_model("analysis", ollama_base=ollama_base)
    base = (ollama_base or _ollama_base()).rstrip("/")

    try:
        r = requests.post(
            f"{base}/api/chat",
            json={
                "model": resolved,
                "messages": [
                    {"role": "system", "content": STRATEGY_SYSTEM},
                    {"role": "user", "content": data_context},
                ],
                "stream": False,
            },
            timeout=120,
        )
        if r.status_code == 200:
            ideas = r.json().get("message", {}).get("content", "")
            return {"ok": True, "symbol": symbol, "strategies": ideas}
        return {"ok": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Discover available FinAI capabilities
# ---------------------------------------------------------------------------
def discover_finai_capabilities(ollama_base: str | None = None) -> dict:
    """Check which FinAI features are available given installed models."""
    from agents.model_registry import list_available_models

    available = [m["name"] for m in list_available_models(ollama_base)]
    config = get_finai_config()

    capabilities = {
        "sentiment_analysis": {
            "available": True,  # Works with any model
            "recommended_models": RECOMMENDED_FIN_MODELS["sentiment"]["models"],
            "installed": [m for m in RECOMMENDED_FIN_MODELS["sentiment"]["models"] if any(m in a for a in available)],
            "configured_model": config.get("sentiment_model"),
        },
        "deep_analysis": {
            "available": True,
            "recommended_models": RECOMMENDED_FIN_MODELS["analyst"]["models"],
            "installed": [m for m in RECOMMENDED_FIN_MODELS["analyst"]["models"] if any(m in a for a in available)],
            "configured_model": config.get("analyst_model"),
        },
        "code_generation": {
            "available": True,
            "recommended_models": RECOMMENDED_FIN_MODELS["coder"]["models"],
            "installed": [m for m in RECOMMENDED_FIN_MODELS["coder"]["models"] if any(m in a for a in available)],
        },
        "time_series_forecast": {
            "available": True,  # Statistical, no LLM needed
            "note": "Uses statistical methods (linear, exponential smoothing, mean reversion)",
        },
        "entity_extraction": {
            "available": True,
            "note": "Financial NER using any available LLM",
        },
        "earnings_analysis": {
            "available": True,
            "note": "Requires text input (copy/paste earnings data)",
        },
        "strategy_generation": {
            "available": True,
            "note": "Generates ideas from local technical data",
        },
    }

    return {
        "ok": True,
        "ollama_models": available,
        "capabilities": capabilities,
        "recommendation": "For best results, install a finance-tuned model via 'ollama pull finma' or 'ollama pull deepseek-r1'.",
    }
