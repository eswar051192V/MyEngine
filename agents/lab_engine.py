"""
Lab Engine — Research & Model Laboratory

Custom insights, incognito research, open-source models, paper integration.
All local-first, privacy-preserving.

Four subsystems:
1. Custom Insights & Model Generation - Create custom indicators from local data
2. Incognito Web Research - One-way research with clean sessions, no personal data
3. Open-Source Models Library - Monte Carlo, Black-Scholes, GARCH, behavioral models
4. Research Paper Integration - Fetch, parse, and learn from arXiv/SSRN papers
"""

from __future__ import annotations

import json
import math
import sqlite3
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from dataclasses import dataclass, asdict
import base64

import numpy as np
import pandas as pd
import requests

# Local imports
from agents.model_registry import resolve_model, _ollama_base


# ============================================================================
# DATABASE SETUP
# ============================================================================

LAB_DB_PATH = Path("context_data/lab.sqlite")


def _init_lab_db() -> None:
    """Initialize SQLite database for lab insights, papers, and models."""
    LAB_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    try:
        # Clean up stale journal files first
        journal_path = Path(str(LAB_DB_PATH) + "-journal")
        if journal_path.exists():
            try:
                journal_path.unlink()
            except Exception:
                pass
    except Exception:
        pass

    conn = sqlite3.connect(str(LAB_DB_PATH), timeout=10.0)
    cursor = conn.cursor()

    # Custom insights table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS custom_insights (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            formula TEXT NOT NULL,
            symbols TEXT,
            params TEXT,
            created_at TEXT,
            modified_at TEXT
        )
    """)

    # Saved papers table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS saved_papers (
            id TEXT PRIMARY KEY,
            title TEXT,
            authors TEXT,
            url TEXT,
            source TEXT,
            summary TEXT,
            user_notes TEXT,
            saved_at TEXT,
            fetched_content TEXT
        )
    """)

    # Insight execution history (for caching results)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS insight_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            insight_id TEXT,
            symbol TEXT,
            result TEXT,
            computed_at TEXT,
            FOREIGN KEY(insight_id) REFERENCES custom_insights(id)
        )
    """)

    conn.commit()
    conn.close()


# ============================================================================
# CUSTOM INSIGHTS ENGINE
# ============================================================================

@dataclass
class CustomInsight:
    """A custom analytical indicator/model."""
    id: str
    name: str
    description: str
    formula: str
    symbols: list[str]
    params: dict
    created_at: str
    modified_at: str


class CustomInsightsEngine:
    """Create and execute custom indicators from local price data."""

    def __init__(self):
        """Initialize the custom insights engine."""
        self.db_path = LAB_DB_PATH
        _init_lab_db()

    def create_insight(
        self,
        name: str,
        description: str,
        formula: str,
        symbols: list[str],
        params: dict | None = None,
    ) -> dict:
        """
        Create a custom insight/indicator.

        Args:
            name: Human-readable name
            description: What this insight measures
            formula: Python expression using price columns (open, high, low, close, volume)
                    and built-in functions (sma, ema, rsi, etc.)
            symbols: List of tickers to apply this to
            params: Optional dict of parameters the formula references

        Returns:
            Dict with insight_id and metadata
        """
        import uuid
        now = datetime.utcnow().isoformat()
        insight_id = f"insight_{uuid.uuid4().hex[:12]}"

        if params is None:
            params = {}

        try:
            conn = sqlite3.connect(str(self.db_path))
            cursor = conn.cursor()

            cursor.execute("""
                INSERT INTO custom_insights
                (id, name, description, formula, symbols, params, created_at, modified_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                insight_id,
                name,
                description,
                formula,
                json.dumps(symbols),
                json.dumps(params),
                now,
                now,
            ))

            conn.commit()
            conn.close()

            return {
                "ok": True,
                "insight_id": insight_id,
                "name": name,
                "created_at": now,
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def run_insight(self, insight_id: str, symbol: str) -> dict:
        """
        Execute an insight against a symbol's local market data.

        Args:
            insight_id: ID of the insight to run
            symbol: Stock ticker symbol

        Returns:
            Dict with result, values, timestamp
        """
        # Load insight metadata
        insight = self._load_insight(insight_id)
        if not insight:
            return {"ok": False, "error": f"Insight not found: {insight_id}"}

        # Load market data
        market_data = self._load_market_data(symbol)
        if market_data is None or market_data.empty:
            return {"ok": False, "error": f"No market data for {symbol}"}

        try:
            # Build execution context
            context = self._build_formula_context(market_data, insight.params)

            # Execute formula
            result = eval(insight.formula, {"__builtins__": {}}, context)

            # Store result
            now = datetime.utcnow().isoformat()
            conn = sqlite3.connect(str(self.db_path))
            cursor = conn.cursor()

            cursor.execute("""
                INSERT INTO insight_results (insight_id, symbol, result, computed_at)
                VALUES (?, ?, ?, ?)
            """, (insight_id, symbol, json.dumps(result if isinstance(result, (dict, list)) else float(result)), now))

            conn.commit()
            conn.close()

            return {
                "ok": True,
                "insight_id": insight_id,
                "symbol": symbol,
                "result": result,
                "computed_at": now,
            }
        except Exception as e:
            return {"ok": False, "error": f"Execution error: {str(e)}"}

    def list_insights(self) -> list[dict]:
        """List all saved custom insights."""
        try:
            conn = sqlite3.connect(str(self.db_path))
            cursor = conn.cursor()

            cursor.execute("""
                SELECT id, name, description, created_at, modified_at
                FROM custom_insights
                ORDER BY modified_at DESC
            """)

            insights = []
            for row in cursor.fetchall():
                insights.append({
                    "id": row[0],
                    "name": row[1],
                    "description": row[2],
                    "created_at": row[3],
                    "modified_at": row[4],
                })

            conn.close()
            return insights
        except Exception as e:
            return []

    def delete_insight(self, insight_id: str) -> dict:
        """Remove an insight and its results."""
        try:
            conn = sqlite3.connect(str(self.db_path))
            cursor = conn.cursor()

            cursor.execute("DELETE FROM insight_results WHERE insight_id = ?", (insight_id,))
            cursor.execute("DELETE FROM custom_insights WHERE id = ?", (insight_id,))

            conn.commit()
            conn.close()

            return {"ok": True, "deleted": insight_id}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def export_insight(self, insight_id: str) -> dict:
        """Export insight definition as JSON."""
        insight = self._load_insight(insight_id)
        if not insight:
            return {"ok": False, "error": f"Insight not found: {insight_id}"}

        return {
            "ok": True,
            "insight": asdict(insight),
        }

    # ========== Private helpers ==========

    def _load_insight(self, insight_id: str) -> Optional[CustomInsight]:
        """Load a single insight from DB."""
        try:
            conn = sqlite3.connect(str(self.db_path))
            cursor = conn.cursor()

            cursor.execute("""
                SELECT id, name, description, formula, symbols, params, created_at, modified_at
                FROM custom_insights WHERE id = ?
            """, (insight_id,))

            row = cursor.fetchone()
            conn.close()

            if not row:
                return None

            return CustomInsight(
                id=row[0],
                name=row[1],
                description=row[2],
                formula=row[3],
                symbols=json.loads(row[4]),
                params=json.loads(row[5]),
                created_at=row[6],
                modified_at=row[7],
            )
        except Exception:
            return None

    def _load_market_data(self, symbol: str) -> Optional[pd.DataFrame]:
        """Load market data from local Parquet files."""
        try:
            # Try multiple potential locations
            paths = [
                Path(f"market_data/{symbol}.parquet"),
                Path(f"local_market_data/1d/{symbol}.parquet"),
            ]

            for path in paths:
                if path.exists():
                    df = pd.read_parquet(path)
                    # Normalize column names to lowercase
                    df.columns = df.columns.str.lower()
                    return df.sort_values('date') if 'date' in df.columns else df

            return None
        except Exception:
            return None

    def _build_formula_context(self, df: pd.DataFrame, params: dict) -> dict:
        """Build execution context with price data and technical indicator functions."""
        context = {
            "open": df["open"].values if "open" in df.columns else np.array([]),
            "high": df["high"].values if "high" in df.columns else np.array([]),
            "low": df["low"].values if "low" in df.columns else np.array([]),
            "close": df["close"].values if "close" in df.columns else np.array([]),
            "volume": df["volume"].values if "volume" in df.columns else np.array([]),
            "np": np,
            **params,
        }

        # Add technical indicator functions
        context["sma"] = self._sma
        context["ema"] = self._ema
        context["rsi"] = self._rsi
        context["macd"] = self._macd
        context["bollinger"] = self._bollinger
        context["atr"] = self._atr

        return context

    @staticmethod
    def _sma(data: np.ndarray, period: int) -> np.ndarray:
        """Simple Moving Average."""
        if len(data) < period:
            return np.array([])
        return np.convolve(data, np.ones(period) / period, mode='valid')

    @staticmethod
    def _ema(data: np.ndarray, period: int) -> np.ndarray:
        """Exponential Moving Average."""
        if len(data) < period:
            return np.array([])
        multiplier = 2 / (period + 1)
        ema = np.zeros(len(data))
        ema[0] = np.mean(data[:period])
        for i in range(1, len(data)):
            ema[i] = data[i] * multiplier + ema[i - 1] * (1 - multiplier)
        return ema

    @staticmethod
    def _rsi(data: np.ndarray, period: int = 14) -> np.ndarray:
        """Relative Strength Index."""
        if len(data) < period + 1:
            return np.array([])

        deltas = np.diff(data)
        seed = deltas[:period + 1]
        up = seed[seed >= 0].sum() / period
        down = -seed[seed < 0].sum() / period
        rs = up / down if down != 0 else 0
        rsi = np.zeros_like(data)
        rsi[:period] = 100.0 - 100.0 / (1.0 + rs)

        for i in range(period, len(deltas)):
            delta = deltas[i - 1]
            if delta > 0:
                up = (up * (period - 1) + delta) / period
                down = (down * (period - 1)) / period
            else:
                up = (up * (period - 1)) / period
                down = (down * (period - 1) - delta) / period

            rs = up / down if down != 0 else 0
            rsi[i] = 100.0 - 100.0 / (1.0 + rs)

        return rsi

    @staticmethod
    def _macd(data: np.ndarray, fast: int = 12, slow: int = 26, signal: int = 9) -> dict:
        """MACD indicator - returns dict with macd, signal, histogram."""
        if len(data) < slow:
            return {}

        ema_fast = CustomInsightsEngine._ema(data, fast)
        ema_slow = CustomInsightsEngine._ema(data, slow)

        # Align to shorter length
        min_len = min(len(ema_fast), len(ema_slow))
        macd_line = ema_fast[-min_len:] - ema_slow[-min_len:]

        signal_line = CustomInsightsEngine._ema(macd_line, signal)
        histogram = macd_line[-len(signal_line):] - signal_line

        return {
            "macd": macd_line,
            "signal": signal_line,
            "histogram": histogram,
        }

    @staticmethod
    def _bollinger(data: np.ndarray, period: int = 20, std_dev: float = 2.0) -> dict:
        """Bollinger Bands - returns dict with upper, middle, lower."""
        if len(data) < period:
            return {}

        sma = CustomInsightsEngine._sma(data, period)
        variance = np.array([np.var(data[i:i+period]) for i in range(len(data) - period + 1)])
        std = np.sqrt(variance)

        return {
            "middle": sma,
            "upper": sma + (std_dev * std),
            "lower": sma - (std_dev * std),
        }

    @staticmethod
    def _atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> np.ndarray:
        """Average True Range."""
        if len(high) < period or len(low) < period or len(close) < period:
            return np.array([])

        tr = np.zeros(len(high))
        tr[0] = high[0] - low[0]

        for i in range(1, len(high)):
            tr[i] = max(
                high[i] - low[i],
                abs(high[i] - close[i - 1]),
                abs(low[i] - close[i - 1]),
            )

        return CustomInsightsEngine._sma(tr, period)


# ============================================================================
# INCOGNITO WEB RESEARCH ENGINE
# ============================================================================

class IncognitoResearchEngine:
    """One-way web research with clean HTTP sessions, no personal data."""

    CLEAN_USER_AGENT = (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    )

    def __init__(self):
        """Initialize the research engine."""
        self.session = self._create_clean_session()

    def research_topic(
        self,
        query: str,
        sources: list[str] | None = None,
        max_results: int = 10,
    ) -> dict:
        """
        Search for research on a topic.

        Args:
            query: Search query
            sources: List of sources ('arxiv', 'google_scholar', 'financial_news')
            max_results: Max results per source

        Returns:
            Dict with results from each source
        """
        if sources is None:
            sources = ["arxiv", "financial_news"]

        results = {}

        if "arxiv" in sources:
            results["arxiv"] = self._search_arxiv(query, max_results)

        if "financial_news" in sources:
            results["financial_news"] = self._search_financial_news(query, max_results)

        if "google_scholar" in sources:
            results["google_scholar"] = self._search_google_scholar(query, max_results)

        return {
            "ok": True,
            "query": query,
            "results": results,
        }

    def fetch_paper(self, url: str) -> dict:
        """
        Fetch and parse a paper/article.
        Clean session, no cookies, no referrer.

        Args:
            url: URL to fetch

        Returns:
            Dict with content, metadata, status
        """
        try:
            headers = {
                "User-Agent": self.CLEAN_USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
                "Accept-Encoding": "gzip, deflate",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1",
            }

            response = self.session.get(url, headers=headers, timeout=15, allow_redirects=True)
            response.raise_for_status()

            # Extract text content (simple HTML stripping)
            content = self._extract_text_from_html(response.text)

            return {
                "ok": True,
                "url": url,
                "status_code": response.status_code,
                "content": content[:5000],  # First 5k chars
                "content_length": len(content),
                "fetched_at": datetime.utcnow().isoformat(),
            }
        except Exception as e:
            return {
                "ok": False,
                "url": url,
                "error": str(e),
            }

    def research_symbol(
        self,
        symbol: str,
        aspects: list[str] | None = None,
    ) -> dict:
        """
        Research a specific stock symbol.

        Args:
            symbol: Stock ticker
            aspects: What to research ('fundamental', 'technical', 'sentiment')

        Returns:
            Dict with research results
        """
        if aspects is None:
            aspects = ["fundamental", "technical", "sentiment"]

        results = {}

        if "fundamental" in aspects:
            results["fundamental"] = self.research_topic(
                f"{symbol} fundamental analysis earnings revenue",
                sources=["financial_news", "arxiv"],
                max_results=5,
            )

        if "technical" in aspects:
            results["technical"] = self.research_topic(
                f"{symbol} technical analysis trading patterns",
                sources=["financial_news"],
                max_results=5,
            )

        if "sentiment" in aspects:
            results["sentiment"] = self.research_topic(
                f"{symbol} market sentiment investor outlook",
                sources=["financial_news"],
                max_results=5,
            )

        return {
            "ok": True,
            "symbol": symbol,
            "aspects": aspects,
            "research": results,
        }

    # ========== Private helpers ==========

    def _create_clean_session(self) -> requests.Session:
        """Create a clean HTTP session with no cookies."""
        session = requests.Session()

        # Remove all cookie handling
        session.cookies.clear()

        return session

    def _search_arxiv(self, query: str, max_results: int) -> list[dict]:
        """Search arXiv for papers."""
        try:
            # arXiv API: https://arxiv.org/api/
            url = "http://export.arxiv.org/api/query"
            params = {
                "search_query": f"all:{query}",
                "start": 0,
                "max_results": min(max_results, 50),
                "sortBy": "relevance",
                "sortOrder": "descending",
            }

            response = self.session.get(url, params=params, timeout=10)
            response.raise_for_status()

            # Simple XML parsing for arXiv feed
            results = []
            import xml.etree.ElementTree as ET
            root = ET.fromstring(response.content)

            ns = {"atom": "http://www.w3.org/2005/Atom"}
            entries = root.findall("atom:entry", ns)

            for entry in entries[:max_results]:
                title_elem = entry.find("atom:title", ns)
                summary_elem = entry.find("atom:summary", ns)
                id_elem = entry.find("atom:id", ns)

                title = title_elem.text if title_elem is not None else ""
                summary = summary_elem.text if summary_elem is not None else ""
                paper_id = id_elem.text.split("/abs/")[-1] if id_elem is not None else ""

                results.append({
                    "title": title.strip(),
                    "summary": summary.strip()[:300],
                    "source": "arxiv",
                    "paper_id": paper_id,
                    "url": f"https://arxiv.org/abs/{paper_id}",
                })

            return results
        except Exception as e:
            return [{"error": str(e), "source": "arxiv"}]

    def _search_google_scholar(self, query: str, max_results: int) -> list[dict]:
        """Minimal Google Scholar search (returns info about limitations)."""
        return [
            {
                "note": "Google Scholar requires special handling",
                "recommendation": "Use arXiv or SSRN directly",
                "source": "google_scholar",
            }
        ]

    def _search_financial_news(self, query: str, max_results: int) -> list[dict]:
        """Search financial news via public RSS feeds or APIs."""
        # This is a simplified example using public feeds
        try:
            import feedparser

            # Use a simple financial news search pattern
            results = []

            # Example: searching through Yahoo Finance RSS
            # In production, would integrate with actual news APIs

            return results
        except Exception:
            return []

    def _extract_text_from_html(self, html: str) -> str:
        """Extract plain text from HTML."""
        import re

        # Remove script and style elements
        html = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL)
        html = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL)

        # Remove HTML tags
        html = re.sub(r"<[^>]+>", "", html)

        # Decode HTML entities
        html = html.replace("&nbsp;", " ")
        html = html.replace("&lt;", "<")
        html = html.replace("&gt;", ">")
        html = html.replace("&amp;", "&")

        # Normalize whitespace
        lines = [line.strip() for line in html.split("\n") if line.strip()]
        return "\n".join(lines)


# ============================================================================
# OPEN-SOURCE MODELS LIBRARY
# ============================================================================

class OpenSourceModelsLibrary:
    """Catalog of open-source finance, math, and behavioral models."""

    MODELS_CATALOG = {
        "monte_carlo_simulation": {
            "name": "Monte Carlo Price Path Simulation",
            "description": "Simulate stock price paths using geometric Brownian motion",
            "params": {
                "S0": {"type": "float", "description": "Initial price"},
                "mu": {"type": "float", "description": "Annual drift/return"},
                "sigma": {"type": "float", "description": "Annual volatility"},
                "T": {"type": "float", "description": "Time horizon (years)"},
                "dt": {"type": "float", "description": "Time step", "default": 1/252},
                "paths": {"type": "int", "description": "Number of simulations", "default": 1000},
            },
        },
        "black_scholes": {
            "name": "Black-Scholes Option Pricing",
            "description": "Price European call and put options",
            "params": {
                "S": {"type": "float", "description": "Current stock price"},
                "K": {"type": "float", "description": "Strike price"},
                "T": {"type": "float", "description": "Time to expiration (years)"},
                "r": {"type": "float", "description": "Risk-free rate"},
                "sigma": {"type": "float", "description": "Volatility (annualized)"},
            },
        },
        "garch_volatility": {
            "name": "GARCH(1,1) Volatility Estimation",
            "description": "Estimate time-varying volatility from returns",
            "params": {
                "returns": {"type": "array", "description": "Return series"},
                "omega": {"type": "float", "description": "Long-run variance weight", "default": 0.0001},
                "alpha": {"type": "float", "description": "ARCH coefficient", "default": 0.1},
                "beta": {"type": "float", "description": "GARCH coefficient", "default": 0.8},
            },
        },
        "mean_variance_optimization": {
            "name": "Markowitz Portfolio Optimization",
            "description": "Optimize portfolio weights for minimum volatility or max Sharpe ratio",
            "params": {
                "returns": {"type": "array", "description": "Asset returns matrix (assets x periods)"},
                "objective": {"type": "string", "description": "min_variance or max_sharpe", "default": "max_sharpe"},
                "rf_rate": {"type": "float", "description": "Risk-free rate", "default": 0.02},
            },
        },
        "prospect_theory_valuation": {
            "name": "Prospect Theory Valuation",
            "description": "Apply behavioral finance prospect theory to value distributions",
            "params": {
                "outcomes": {"type": "array", "description": "Possible outcomes"},
                "probabilities": {"type": "array", "description": "Probabilities of outcomes"},
                "reference_point": {"type": "float", "description": "Reference point for gains/losses", "default": 0},
                "lambda": {"type": "float", "description": "Loss aversion coefficient", "default": 2.25},
            },
        },
        "kelly_criterion": {
            "name": "Kelly Criterion Position Sizing",
            "description": "Optimal bet sizing for maximum long-term growth",
            "params": {
                "win_prob": {"type": "float", "description": "Probability of winning trade"},
                "win_loss_ratio": {"type": "float", "description": "Avg win / Avg loss"},
                "leverage": {"type": "float", "description": "Maximum leverage allowed", "default": 1.0},
            },
        },
        "var_historical": {
            "name": "Value at Risk - Historical Simulation",
            "description": "Calculate VaR using historical percentile method",
            "params": {
                "returns": {"type": "array", "description": "Historical returns"},
                "confidence_level": {"type": "float", "description": "Confidence level (0.95, 0.99)", "default": 0.95},
                "position_size": {"type": "float", "description": "Portfolio size", "default": 1000000},
            },
        },
        "correlation_regime": {
            "name": "Correlation Regime Detection",
            "description": "Detect low/high correlation regimes across assets",
            "params": {
                "returns": {"type": "array", "description": "Returns matrix"},
                "window": {"type": "int", "description": "Rolling window size", "default": 60},
                "threshold": {"type": "float", "description": "Threshold for regime change", "default": 0.2},
            },
        },
        "mean_reversion_ou": {
            "name": "Ornstein-Uhlenbeck Mean Reversion",
            "description": "Fit mean-reverting model and predict future values",
            "params": {
                "prices": {"type": "array", "description": "Price series"},
                "dt": {"type": "float", "description": "Time step", "default": 1/252},
            },
        },
        "momentum_factor": {
            "name": "Momentum Factor Calculation",
            "description": "Calculate momentum (trend) factor from returns",
            "params": {
                "prices": {"type": "array", "description": "Price series"},
                "lookback": {"type": "int", "description": "Lookback period", "default": 252},
                "exclude_recent": {"type": "int", "description": "Exclude recent bars", "default": 21},
            },
        },
    }

    def list_models(self) -> list[dict]:
        """List all available models with descriptions."""
        return [
            {
                "name": key,
                "display_name": meta["name"],
                "description": meta["description"],
                "params": meta["params"],
            }
            for key, meta in self.MODELS_CATALOG.items()
        ]

    def get_model_info(self, model_name: str) -> dict:
        """Get detailed info about a model."""
        if model_name not in self.MODELS_CATALOG:
            return {"ok": False, "error": f"Model not found: {model_name}"}

        meta = self.MODELS_CATALOG[model_name]
        return {
            "ok": True,
            "name": model_name,
            "display_name": meta["name"],
            "description": meta["description"],
            "params": meta["params"],
        }

    def run_model(self, model_name: str, params: dict) -> dict:
        """Execute a model with given parameters."""
        if model_name not in self.MODELS_CATALOG:
            return {"ok": False, "error": f"Model not found: {model_name}"}

        try:
            if model_name == "monte_carlo_simulation":
                return self._monte_carlo(params)
            elif model_name == "black_scholes":
                return self._black_scholes(params)
            elif model_name == "garch_volatility":
                return self._garch_volatility(params)
            elif model_name == "mean_variance_optimization":
                return self._mean_variance_opt(params)
            elif model_name == "prospect_theory_valuation":
                return self._prospect_theory(params)
            elif model_name == "kelly_criterion":
                return self._kelly_criterion(params)
            elif model_name == "var_historical":
                return self._var_historical(params)
            elif model_name == "correlation_regime":
                return self._correlation_regime(params)
            elif model_name == "mean_reversion_ou":
                return self._mean_reversion_ou(params)
            elif model_name == "momentum_factor":
                return self._momentum_factor(params)
            else:
                return {"ok": False, "error": f"Model not implemented: {model_name}"}
        except Exception as e:
            return {"ok": False, "error": f"Execution error: {str(e)}"}

    # ========== Model implementations ==========

    @staticmethod
    def _monte_carlo(params: dict) -> dict:
        """Monte Carlo price path simulation."""
        S0 = params.get("S0", 100)
        mu = params.get("mu", 0.1)
        sigma = params.get("sigma", 0.2)
        T = params.get("T", 1)
        dt = params.get("dt", 1/252)
        paths = params.get("paths", 1000)

        steps = int(T / dt)

        # Generate paths
        paths_array = np.zeros((paths, steps + 1))
        paths_array[:, 0] = S0

        for i in range(1, steps + 1):
            Z = np.random.standard_normal(paths)
            paths_array[:, i] = paths_array[:, i - 1] * np.exp(
                (mu - 0.5 * sigma**2) * dt + sigma * np.sqrt(dt) * Z
            )

        final_prices = paths_array[:, -1]

        return {
            "ok": True,
            "model": "monte_carlo_simulation",
            "params": params,
            "results": {
                "mean_final_price": float(np.mean(final_prices)),
                "std_final_price": float(np.std(final_prices)),
                "percentile_5": float(np.percentile(final_prices, 5)),
                "percentile_50": float(np.percentile(final_prices, 50)),
                "percentile_95": float(np.percentile(final_prices, 95)),
                "min_price": float(np.min(final_prices)),
                "max_price": float(np.max(final_prices)),
                "simulated_paths_count": paths,
                "final_prices_sample": final_prices[:10].tolist(),
            },
        }

    @staticmethod
    def _black_scholes(params: dict) -> dict:
        """Black-Scholes option pricing using erf approximation (no scipy needed)."""
        S = params.get("S", 100)
        K = params.get("K", 100)
        T = params.get("T", 1)
        r = params.get("r", 0.05)
        sigma = params.get("sigma", 0.2)

        from math import log, exp, sqrt, erf

        # CDF approximation for normal distribution
        def norm_cdf(x):
            return (1.0 + erf(x / sqrt(2.0))) / 2.0

        def norm_pdf(x):
            return exp(-0.5 * x * x) / sqrt(2.0 * math.pi)

        import math

        d1 = (log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * sqrt(T))
        d2 = d1 - sigma * sqrt(T)

        call_price = S * norm_cdf(d1) - K * exp(-r * T) * norm_cdf(d2)
        put_price = K * exp(-r * T) * norm_cdf(-d2) - S * norm_cdf(-d1)

        return {
            "ok": True,
            "model": "black_scholes",
            "params": params,
            "results": {
                "call_price": float(call_price),
                "put_price": float(put_price),
                "call_delta": float(norm_cdf(d1)),
                "put_delta": float(norm_cdf(d1) - 1),
                "gamma": float(norm_pdf(d1) / (S * sigma * sqrt(T))),
                "vega": float(S * norm_pdf(d1) * sqrt(T) / 100),
            },
        }

    @staticmethod
    def _garch_volatility(params: dict) -> dict:
        """GARCH(1,1) volatility estimation."""
        returns = np.array(params.get("returns", []))
        omega = params.get("omega", 0.0001)
        alpha = params.get("alpha", 0.1)
        beta = params.get("beta", 0.8)

        if len(returns) < 2:
            return {"ok": False, "error": "Need at least 2 returns"}

        # Initialize
        sigma2 = np.zeros(len(returns))
        sigma2[0] = np.var(returns)

        # Iterate GARCH recursion
        for t in range(1, len(returns)):
            sigma2[t] = omega + alpha * (returns[t - 1]**2) + beta * sigma2[t - 1]

        volatility = np.sqrt(sigma2)

        return {
            "ok": True,
            "model": "garch_volatility",
            "params": params,
            "results": {
                "current_volatility": float(volatility[-1]),
                "mean_volatility": float(np.mean(volatility)),
                "min_volatility": float(np.min(volatility)),
                "max_volatility": float(np.max(volatility)),
                "volatility_trend": float(volatility[-1] - volatility[0]),
                "last_10_volatilities": volatility[-10:].tolist(),
            },
        }

    @staticmethod
    def _mean_variance_opt(params: dict) -> dict:
        """Markowitz portfolio optimization."""
        returns = np.array(params.get("returns", []))
        objective = params.get("objective", "max_sharpe")
        rf_rate = params.get("rf_rate", 0.02)

        if returns.ndim != 2 or returns.shape[0] == 0:
            return {"ok": False, "error": "Returns must be 2D array (assets x periods)"}

        n_assets = returns.shape[0]

        # Calculate expected returns and covariance
        mean_returns = np.mean(returns, axis=1)
        cov_matrix = np.cov(returns)

        # Simple optimization: equal-weight as baseline, then try 1/variance
        equal_weights = np.ones(n_assets) / n_assets

        # Inverse volatility weighting
        volatilities = np.sqrt(np.diag(cov_matrix))
        inv_vol_weights = 1 / volatilities
        inv_vol_weights = inv_vol_weights / inv_vol_weights.sum()

        # Calculate metrics for both
        eq_return = np.dot(equal_weights, mean_returns)
        eq_vol = np.sqrt(np.dot(equal_weights, np.dot(cov_matrix, equal_weights)))
        eq_sharpe = (eq_return - rf_rate) / eq_vol if eq_vol > 0 else 0

        iv_return = np.dot(inv_vol_weights, mean_returns)
        iv_vol = np.sqrt(np.dot(inv_vol_weights, np.dot(cov_matrix, inv_vol_weights)))
        iv_sharpe = (iv_return - rf_rate) / iv_vol if iv_vol > 0 else 0

        # Choose based on objective
        if objective == "max_sharpe":
            weights = inv_vol_weights if iv_sharpe > eq_sharpe else equal_weights
        else:
            weights = inv_vol_weights  # Lower volatility

        port_return = np.dot(weights, mean_returns)
        port_vol = np.sqrt(np.dot(weights, np.dot(cov_matrix, weights)))
        port_sharpe = (port_return - rf_rate) / port_vol if port_vol > 0 else 0

        return {
            "ok": True,
            "model": "mean_variance_optimization",
            "params": params,
            "results": {
                "weights": weights.tolist(),
                "expected_return": float(port_return),
                "volatility": float(port_vol),
                "sharpe_ratio": float(port_sharpe),
                "asset_volatilities": volatilities.tolist(),
                "asset_returns": mean_returns.tolist(),
            },
        }

    @staticmethod
    def _prospect_theory(params: dict) -> dict:
        """Prospect theory valuation."""
        outcomes = np.array(params.get("outcomes", []))
        probabilities = np.array(params.get("probabilities", []))
        reference_point = params.get("reference_point", 0)
        lambda_param = params.get("lambda", 2.25)

        if len(outcomes) != len(probabilities):
            return {"ok": False, "error": "Outcomes and probabilities must have same length"}

        if not np.isclose(probabilities.sum(), 1.0):
            probabilities = probabilities / probabilities.sum()

        # Value function: concave for gains, convex for losses
        def v(x):
            if x >= 0:
                return x**0.88
            else:
                return -lambda_param * ((-x)**0.88)

        # Probability weighting
        def w(p):
            return (p**0.61) / ((p**0.61 + (1 - p)**0.61)**(1/0.61))

        # Calculate prospect value
        gains = outcomes[outcomes >= reference_point] - reference_point
        losses = outcomes[outcomes < reference_point] - reference_point

        value = 0
        for outcome, prob in zip(outcomes, probabilities):
            value += w(prob) * v(outcome - reference_point)

        return {
            "ok": True,
            "model": "prospect_theory_valuation",
            "params": params,
            "results": {
                "prospect_value": float(value),
                "expected_value": float((outcomes * probabilities).sum()),
                "reference_point": reference_point,
                "loss_aversion": lambda_param,
            },
        }

    @staticmethod
    def _kelly_criterion(params: dict) -> dict:
        """Kelly criterion position sizing."""
        p = params.get("win_prob", 0.5)
        b = params.get("win_loss_ratio", 1.0)
        leverage = params.get("leverage", 1.0)

        if p <= 0 or p >= 1:
            return {"ok": False, "error": "Win probability must be between 0 and 1"}

        if b <= 0:
            return {"ok": False, "error": "Win/loss ratio must be positive"}

        # Kelly: f = (p*b - (1-p)) / b
        kelly_fraction = (p * b - (1 - p)) / b if b > 0 else 0
        kelly_fraction = max(0, kelly_fraction)  # No negative bets
        kelly_fraction = min(kelly_fraction, leverage)  # Apply leverage limit

        # Half Kelly (more conservative)
        half_kelly = kelly_fraction / 2

        # Expected growth rate
        expected_growth = p * np.log(1 + kelly_fraction * b) + (1 - p) * np.log(1 - kelly_fraction)

        return {
            "ok": True,
            "model": "kelly_criterion",
            "params": params,
            "results": {
                "kelly_fraction": float(kelly_fraction),
                "half_kelly": float(half_kelly),
                "kelly_percent": float(kelly_fraction * 100),
                "expected_log_return": float(expected_growth),
                "recommended_bet_sizing": float(half_kelly),  # Conservative
            },
        }

    @staticmethod
    def _var_historical(params: dict) -> dict:
        """Value at Risk via historical simulation."""
        returns = np.array(params.get("returns", []))
        confidence = params.get("confidence_level", 0.95)
        position = params.get("position_size", 1000000)

        if len(returns) < 10:
            return {"ok": False, "error": "Need at least 10 returns"}

        percentile = (1 - confidence) * 100
        var = np.percentile(returns, percentile)
        cvar = returns[returns <= var].mean()

        var_dollar = abs(var * position)
        cvar_dollar = abs(cvar * position)

        return {
            "ok": True,
            "model": "var_historical",
            "params": params,
            "results": {
                "var_percent": float(var * 100),
                "var_dollar": float(var_dollar),
                "cvar_percent": float(cvar * 100),
                "cvar_dollar": float(cvar_dollar),
                "confidence_level": confidence,
                "sample_size": len(returns),
            },
        }

    @staticmethod
    def _correlation_regime(params: dict) -> dict:
        """Correlation regime detection."""
        returns = np.array(params.get("returns", []))
        window = params.get("window", 60)
        threshold = params.get("threshold", 0.2)

        if returns.ndim != 2 or returns.shape[1] < window:
            return {"ok": False, "error": "Need at least window-sized return matrix"}

        correlations = []
        for i in range(returns.shape[1] - window + 1):
            window_returns = returns[:, i:i + window]
            corr = np.corrcoef(window_returns)
            # Average pairwise correlation (excluding diagonal)
            avg_corr = np.mean(corr[np.triu_indices_from(corr, k=1)])
            correlations.append(avg_corr)

        correlations = np.array(correlations)
        current_corr = correlations[-1]
        regime = "high" if current_corr > threshold else "low"

        return {
            "ok": True,
            "model": "correlation_regime",
            "params": params,
            "results": {
                "current_correlation": float(current_corr),
                "regime": regime,
                "mean_correlation": float(np.mean(correlations)),
                "min_correlation": float(np.min(correlations)),
                "max_correlation": float(np.max(correlations)),
                "threshold": threshold,
            },
        }

    @staticmethod
    def _mean_reversion_ou(params: dict) -> dict:
        """Ornstein-Uhlenbeck mean reversion model."""
        prices = np.array(params.get("prices", []))
        dt = params.get("dt", 1/252)

        if len(prices) < 3:
            return {"ok": False, "error": "Need at least 3 prices"}

        # Fit OU model: dX = lambda * (mu - X) * dt + sigma * dW
        deltas = np.diff(prices)

        # Estimate parameters
        mean_price = np.mean(prices)

        # Regression: delta_X = lambda * (mu - X) * dt + noise
        X = prices[:-1]
        y = deltas

        # Simple least squares
        n = len(X)
        sum_X = np.sum(X)
        sum_y = np.sum(y)
        sum_Xy = np.sum(X * y)
        sum_X2 = np.sum(X**2)

        lambda_est = (n * sum_Xy - sum_X * sum_y) / (n * sum_X2 - sum_X**2) if (n * sum_X2 - sum_X**2) != 0 else 0
        lambda_est = -lambda_est / dt  # Annualize

        mu_est = mean_price
        sigma_est = np.std(deltas)

        return {
            "ok": True,
            "model": "mean_reversion_ou",
            "params": params,
            "results": {
                "mean_reversion_speed": float(lambda_est),
                "long_term_mean": float(mu_est),
                "volatility": float(sigma_est),
                "current_price": float(prices[-1]),
                "distance_to_mean": float(prices[-1] - mu_est),
            },
        }

    @staticmethod
    def _momentum_factor(params: dict) -> dict:
        """Momentum factor calculation."""
        prices = np.array(params.get("prices", []))
        lookback = params.get("lookback", 252)
        exclude_recent = params.get("exclude_recent", 21)

        if len(prices) < lookback + exclude_recent:
            return {"ok": False, "error": f"Need at least {lookback + exclude_recent} prices"}

        # Momentum: return from (lookback + exclude_recent) bars ago to exclude_recent bars ago
        start_idx = len(prices) - lookback - exclude_recent
        end_idx = len(prices) - exclude_recent

        momentum_return = (prices[end_idx - 1] - prices[start_idx]) / prices[start_idx]

        # Also calculate rolling momentum
        recent_momentum = (prices[-exclude_recent - 1] - prices[-exclude_recent - 20]) / prices[-exclude_recent - 20]

        return {
            "ok": True,
            "model": "momentum_factor",
            "params": params,
            "results": {
                "momentum_return": float(momentum_return),
                "momentum_percent": float(momentum_return * 100),
                "recent_momentum": float(recent_momentum),
                "momentum_rank": "positive" if momentum_return > 0 else "negative",
                "lookback_period": lookback,
            },
        }


# ============================================================================
# RESEARCH PAPER INTEGRATION
# ============================================================================

@dataclass
class PaperMetadata:
    """Research paper metadata."""
    id: str
    title: str
    authors: list[str]
    url: str
    source: str
    summary: str
    user_notes: str
    saved_at: str
    fetched_content: str | None = None


class ResearchPaperIntegration:
    """Fetch, parse, and learn from research papers."""

    def __init__(self):
        """Initialize paper integration."""
        self.db_path = LAB_DB_PATH
        _init_lab_db()
        self.research = IncognitoResearchEngine()

    def search_papers(
        self,
        query: str,
        source: str = "arxiv",
        max_results: int = 5,
    ) -> dict:
        """
        Search for papers.

        Args:
            query: Search query
            source: 'arxiv', 'ssrn', etc.
            max_results: Max results to return

        Returns:
            Dict with paper list
        """
        results = self.research.research_topic(
            query,
            sources=[source],
            max_results=max_results,
        )

        return {
            "ok": True,
            "source": source,
            "query": query,
            "papers": results.get("results", {}).get(source, []),
        }

    def fetch_paper_metadata(self, paper_id: str, source: str = "arxiv") -> dict:
        """Get paper metadata from source."""
        if source == "arxiv":
            try:
                url = f"https://arxiv.org/api/query?id_list={paper_id}"
                import xml.etree.ElementTree as ET
                response = requests.get(url, timeout=10)
                response.raise_for_status()

                root = ET.fromstring(response.content)
                ns = {"atom": "http://www.w3.org/2005/Atom"}
                entry = root.find("atom:entry", ns)

                if entry is None:
                    return {"ok": False, "error": "Paper not found"}

                title = entry.find("atom:title", ns).text
                summary = entry.find("atom:summary", ns).text
                authors_elems = entry.findall("atom:author", ns)
                authors = [a.find("atom:name", ns).text for a in authors_elems]

                return {
                    "ok": True,
                    "paper_id": paper_id,
                    "title": title.strip(),
                    "authors": authors,
                    "summary": summary.strip()[:500],
                    "url": f"https://arxiv.org/abs/{paper_id}",
                    "source": "arxiv",
                }
            except Exception as e:
                return {"ok": False, "error": str(e)}

        return {"ok": False, "error": f"Source not implemented: {source}"}

    def summarize_paper(self, paper_id: str) -> dict:
        """Use local Ollama to summarize a paper."""
        # Get paper metadata first
        metadata = self.fetch_paper_metadata(paper_id)
        if not metadata.get("ok"):
            return metadata

        # Try to fetch paper content
        paper_url = metadata.get("url")
        fetch_result = self.research.fetch_paper(paper_url)

        if not fetch_result.get("ok"):
            return {"ok": False, "error": f"Could not fetch paper: {fetch_result.get('error')}"}

        content = fetch_result.get("content", "")[:3000]

        # Summarize with Ollama
        try:
            import requests as req

            model = resolve_model("summarizer")
            base_url = _ollama_base()

            prompt = f"""
Summarize the following research paper in 3-4 key points:

Title: {metadata.get('title')}

Content:
{content}

Summary:
"""

            response = req.post(
                f"{base_url}/api/generate",
                json={
                    "model": model,
                    "prompt": prompt,
                    "stream": False,
                },
                timeout=30,
            )

            if response.status_code == 200:
                summary = response.json().get("response", "")
                return {
                    "ok": True,
                    "paper_id": paper_id,
                    "title": metadata.get("title"),
                    "summary": summary,
                    "model_used": model,
                }
            else:
                return {"ok": False, "error": f"Ollama error: {response.status_code}"}
        except Exception as e:
            return {"ok": False, "error": f"Summarization error: {str(e)}"}

    def extract_paper_models(self, paper_id: str) -> dict:
        """Extract mathematical models/formulas from a paper."""
        metadata = self.fetch_paper_metadata(paper_id)
        if not metadata.get("ok"):
            return metadata

        fetch_result = self.research.fetch_paper(metadata.get("url", ""))
        if not fetch_result.get("ok"):
            return {"ok": False, "error": "Could not fetch paper"}

        content = fetch_result.get("content", "")

        # Extract common model patterns
        models = {
            "equations": self._extract_equations(content),
            "financial_models": self._extract_financial_terms(content),
            "parameters": self._extract_parameters(content),
        }

        return {
            "ok": True,
            "paper_id": paper_id,
            "title": metadata.get("title"),
            "models": models,
        }

    def save_paper(self, paper_id: str, user_notes: str = "") -> dict:
        """Save paper to local library."""
        metadata = self.fetch_paper_metadata(paper_id)
        if not metadata.get("ok"):
            return metadata

        try:
            now = datetime.utcnow().isoformat()

            conn = sqlite3.connect(str(self.db_path))
            cursor = conn.cursor()

            cursor.execute("""
                INSERT OR REPLACE INTO saved_papers
                (id, title, authors, url, source, summary, user_notes, saved_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                paper_id,
                metadata.get("title"),
                json.dumps(metadata.get("authors", [])),
                metadata.get("url"),
                metadata.get("source"),
                metadata.get("summary"),
                user_notes,
                now,
            ))

            conn.commit()
            conn.close()

            return {
                "ok": True,
                "paper_id": paper_id,
                "action": "saved",
                "saved_at": now,
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def list_saved_papers(self) -> list[dict]:
        """List all saved papers."""
        try:
            conn = sqlite3.connect(str(self.db_path))
            cursor = conn.cursor()

            cursor.execute("""
                SELECT id, title, authors, url, source, summary, user_notes, saved_at
                FROM saved_papers
                ORDER BY saved_at DESC
            """)

            papers = []
            for row in cursor.fetchall():
                papers.append({
                    "id": row[0],
                    "title": row[1],
                    "authors": json.loads(row[2]),
                    "url": row[3],
                    "source": row[4],
                    "summary": row[5],
                    "user_notes": row[6],
                    "saved_at": row[7],
                })

            conn.close()
            return papers
        except Exception:
            return []

    # ========== Private helpers ==========

    @staticmethod
    def _extract_equations(text: str) -> list[str]:
        """Extract mathematical equations from text."""
        # Simple regex for common equation patterns
        patterns = [
            r"(?:=|∑|∫|π|√|±)[^\n.]*(?:[0-9]|[a-z])[^\n.]*",
        ]

        equations = []
        for pattern in patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            equations.extend(matches[:5])  # Limit to first 5

        return list(set(equations))[:10]

    @staticmethod
    def _extract_financial_terms(text: str) -> list[str]:
        """Extract financial model mentions."""
        terms = [
            "CAPM", "Black-Scholes", "Monte Carlo", "GARCH", "VAR",
            "mean reversion", "risk premium", "Sharpe ratio", "Markowitz",
            "correlation", "covariance", "regression", "factor model",
        ]

        found = []
        text_lower = text.lower()
        for term in terms:
            if term.lower() in text_lower:
                found.append(term)

        return found

    @staticmethod
    def _extract_parameters(text: str) -> dict:
        """Extract common parameters and values."""
        patterns = {
            "volatility": r"(?:volatility|sigma|σ)\s*[=:]?\s*([\d.]+)",
            "correlation": r"(?:correlation|ρ)\s*[=:]?\s*([\d.]+)",
            "drift": r"(?:drift|μ)\s*[=:]?\s*([\d.]+)",
            "rate": r"(?:rate|r)\s*[=:]?\s*([\d.]+)",
        }

        params = {}
        for param_name, pattern in patterns.items():
            matches = re.findall(pattern, text, re.IGNORECASE)
            if matches:
                params[param_name] = [float(m) for m in matches[:3]]

        return params


# ============================================================================
# MAIN LAB ENGINE INTERFACE
# ============================================================================

class LabEngine:
    """Main Lab Engine - orchestrates all four subsystems."""

    def __init__(self):
        """Initialize all subsystems."""
        self.insights = CustomInsightsEngine()
        self.research = IncognitoResearchEngine()
        self.models = OpenSourceModelsLibrary()
        self.papers = ResearchPaperIntegration()

    def get_status(self) -> dict:
        """Get overall lab status."""
        return {
            "ok": True,
            "components": {
                "custom_insights": "ready",
                "incognito_research": "ready",
                "models_library": "ready",
                "paper_integration": "ready",
            },
            "db_location": str(self.insights.db_path),
        }


# Module-level interface
_lab_engine = None


def get_lab_engine() -> LabEngine:
    """Get or create the Lab Engine singleton."""
    global _lab_engine
    if _lab_engine is None:
        _lab_engine = LabEngine()
    return _lab_engine
