from __future__ import annotations

import json
import os
from datetime import datetime, time, timedelta
from functools import lru_cache
from typing import Any
from zoneinfo import ZoneInfo

from context.india_mutual_funds import (
    MUTUAL_FUND_CATEGORY,
    get_scheme_record,
    is_mutual_fund_symbol,
)

_REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
_DEFAULT_TICKERS = os.path.join(_REPO_ROOT, "all_global_tickers.json")


def _resolve_tickers_json_path() -> str:
    """Prefer TICKERS_JSON env, then repo-root file, then cwd (uvicorn may run from a subfolder)."""
    env = os.environ.get("TICKERS_JSON", "").strip()
    if env and os.path.isfile(env):
        return env
    if os.path.isfile(_DEFAULT_TICKERS):
        return _DEFAULT_TICKERS
    cwd = os.path.join(os.getcwd(), "all_global_tickers.json")
    if os.path.isfile(cwd):
        return cwd
    return _DEFAULT_TICKERS


TICKERS_JSON = _resolve_tickers_json_path()
CONSUMER_DATA_DIR = os.environ.get("CONSUMER_DATA_DIR", "context_data/india_consumer")
INSTRUMENT_ALIASES_JSON = os.path.join(CONSUMER_DATA_DIR, "instrument_aliases.json")

INDEX_PROXY_MAP = {
    "NIFTY 50": "^NSEI",
    "NIFTY BANK": "^NSEBANK",
    "NIFTY FINANCIAL SERVICES": "^CNXFIN",
    "NIFTY MID SELECT": "^NSEMDCP50",
    "NIFTY NEXT 50": "^NSMIDCP",
}

CATEGORY_METADATA: dict[str, dict[str, Any]] = {
    MUTUAL_FUND_CATEGORY: {
        "label": "India Mutual Funds",
        "asset_family": "mutual_fund",
        "region": "India",
        "exchange": "AMFI",
        "is_proxy": False,
    },
    "NSE_Equity": {
        "label": "NSE Equity",
        "asset_family": "equity",
        "region": "India",
        "exchange": "NSE",
        "is_proxy": False,
    },
    "BSE_Equity": {
        "label": "BSE Equity",
        "asset_family": "equity",
        "region": "India",
        "exchange": "BSE",
        "is_proxy": False,
    },
    "NSE_Index_Options": {
        "label": "NSE Index Options",
        "asset_family": "index",
        "region": "India",
        "exchange": "NSE",
        "is_proxy": True,
    },
    "NSE_Futures_Stock_Underlyings": {
        "label": "NSE Futures Stock Underlyings",
        "asset_family": "futures",
        "region": "India",
        "exchange": "NSE",
        "is_proxy": False,
    },
    "NSE_Futures_Indices_Proxy": {
        "label": "NSE Futures Index Proxies",
        "asset_family": "futures",
        "region": "India",
        "exchange": "NSE",
        "is_proxy": True,
    },
    "NSE_Futures_Options_Underlying": {
        "label": "NSE Futures And Options Underlyings",
        "asset_family": "futures",
        "region": "India",
        "exchange": "NSE",
        "is_proxy": False,
    },
    "Global_Forex_Majors": {
        "label": "Global Forex Majors",
        "asset_family": "forex",
        "region": "Global",
        "exchange": "FX",
        "is_proxy": False,
    },
    "Global_Forex_Crosses": {
        "label": "Global Forex Crosses",
        "asset_family": "forex",
        "region": "Global",
        "exchange": "FX",
        "is_proxy": False,
    },
    "Asia_Forex_USD_Pairs": {
        "label": "Asia USD Forex Pairs",
        "asset_family": "forex",
        "region": "Asia",
        "exchange": "FX",
        "is_proxy": False,
    },
    "INR_Forex_Pairs": {
        "label": "INR Forex Pairs",
        "asset_family": "forex",
        "region": "India",
        "exchange": "FX",
        "is_proxy": False,
    },
    "Precious_Metals_Futures": {
        "label": "Precious Metals Futures",
        "asset_family": "commodity",
        "region": "Global",
        "exchange": "COMEX",
        "is_proxy": False,
    },
    "Energy_Futures": {
        "label": "Energy Futures",
        "asset_family": "commodity",
        "region": "Global",
        "exchange": "NYMEX",
        "is_proxy": False,
    },
    "Base_Metals_Futures": {
        "label": "Base Metals Futures",
        "asset_family": "commodity",
        "region": "Global",
        "exchange": "COMEX/LME",
        "is_proxy": False,
    },
    "Agriculture_Grains_Futures": {
        "label": "Agriculture Grains Futures",
        "asset_family": "commodity",
        "region": "Global",
        "exchange": "CBOT",
        "is_proxy": False,
    },
    "Softs_Futures": {
        "label": "Soft Commodities Futures",
        "asset_family": "commodity",
        "region": "Global",
        "exchange": "ICE",
        "is_proxy": False,
    },
    "Livestock_Futures": {
        "label": "Livestock Futures",
        "asset_family": "commodity",
        "region": "Global",
        "exchange": "CME",
        "is_proxy": False,
    },
    "Indian_MCX_Proxy_PreciousMetals": {
        "label": "Indian MCX Proxy Precious Metals",
        "asset_family": "commodity",
        "region": "India",
        "exchange": "MCX Proxy",
        "is_proxy": True,
    },
    "Indian_MCX_Proxy_Energy": {
        "label": "Indian MCX Proxy Energy",
        "asset_family": "commodity",
        "region": "India",
        "exchange": "MCX Proxy",
        "is_proxy": True,
    },
    "Indian_MCX_Proxy_BaseMetals": {
        "label": "Indian MCX Proxy Base Metals",
        "asset_family": "commodity",
        "region": "India",
        "exchange": "MCX Proxy",
        "is_proxy": True,
    },
    "Global_Crypto_Majors": {
        "label": "Global Crypto (Majors)",
        "asset_family": "crypto",
        "region": "Global",
        "exchange": "CCY",
        "is_proxy": False,
    },
    "Global_Government_Bonds_Proxy": {
        "label": "Global Government Bonds (Proxy)",
        "asset_family": "bond",
        "region": "Global",
        "exchange": "INDEX",
        "is_proxy": True,
    },
    "US_Options_Liquid_Underlyings": {
        "label": "US Options — Liquid Underlyings",
        "asset_family": "equity",
        "region": "United States",
        "exchange": "US",
        "is_proxy": False,
    },
    "India_NSE_Options_Underlyings": {
        "label": "India NSE — Options Underlyings",
        "asset_family": "equity",
        "region": "India",
        "exchange": "NSE",
        "is_proxy": False,
    },
}

EXCHANGE_SCHEDULE: dict[str, dict[str, Any]] = {
    "NSE": {"tz": "Asia/Kolkata", "open_hour": 9, "open_min": 15, "close_hour": 15, "close_min": 30},
    "BSE": {"tz": "Asia/Kolkata", "open_hour": 9, "open_min": 15, "close_hour": 15, "close_min": 30},
    "AMFI": {"tz": "Asia/Kolkata", "open_hour": 9, "open_min": 0, "close_hour": 22, "close_min": 0},
    "NYSE": {"tz": "America/New_York", "open_hour": 9, "open_min": 30, "close_hour": 16, "close_min": 0},
    "NASDAQ": {"tz": "America/New_York", "open_hour": 9, "open_min": 30, "close_hour": 16, "close_min": 0},
    "FX": {"tz": "America/New_York", "open_hour": 0, "open_min": 0, "close_hour": 23, "close_min": 59},
    "COMEX": {"tz": "America/New_York", "open_hour": 8, "open_min": 20, "close_hour": 17, "close_min": 0},
    "NYMEX": {"tz": "America/New_York", "open_hour": 8, "open_min": 20, "close_hour": 17, "close_min": 0},
    "CME": {"tz": "America/New_York", "open_hour": 8, "open_min": 20, "close_hour": 17, "close_min": 0},
    "ICE": {"tz": "America/New_York", "open_hour": 8, "open_min": 0, "close_hour": 17, "close_min": 0},
    "CBOT": {"tz": "America/Chicago", "open_hour": 8, "open_min": 30, "close_hour": 13, "close_min": 20},
    "MCX Proxy": {"tz": "Asia/Kolkata", "open_hour": 9, "open_min": 0, "close_hour": 23, "close_min": 30},
    "COMEX/LME": {"tz": "Europe/London", "open_hour": 8, "open_min": 0, "close_hour": 17, "close_min": 0},
}

PRESET_DEFINITIONS = [
    {
        "id": "india_forex_core",
        "label": "India Forex Core",
        "description": "INR pairs and Asia FX names relevant to Indian macro screens.",
        "categories": ["INR_Forex_Pairs", "Asia_Forex_USD_Pairs"],
        "max_symbols": 16,
    },
    {
        "id": "global_fx_majors",
        "label": "Global FX Majors",
        "description": "Liquid G10 FX pairs for broad dollar and carry monitoring.",
        "categories": ["Global_Forex_Majors", "Global_Forex_Crosses"],
        "max_symbols": 16,
    },
    {
        "id": "india_commodity_proxies",
        "label": "India Commodity Proxies",
        "description": "MCX-style gold, silver, energy, and industrial metal proxies.",
        "categories": [
            "Indian_MCX_Proxy_PreciousMetals",
            "Indian_MCX_Proxy_Energy",
            "Indian_MCX_Proxy_BaseMetals",
        ],
        "max_symbols": 16,
    },
    {
        "id": "commodity_benchmarks",
        "label": "Commodity Benchmarks",
        "description": "A cross-section of global metals, energy, and agriculture futures.",
        "symbols": [
            "GC=F",
            "SI=F",
            "CL=F",
            "BZ=F",
            "NG=F",
            "HG=F",
            "ALI=F",
            "ZC=F",
            "ZW=F",
            "ZS=F",
            "KC=F",
            "SB=F",
        ],
    },
    {
        "id": "india_futures_indices",
        "label": "India Futures Indices",
        "description": "Yahoo index proxies for major NSE derivatives benchmarks.",
        "categories": ["NSE_Futures_Indices_Proxy"],
        "max_symbols": 8,
    },
    {
        "id": "india_futures_leaders",
        "label": "India Futures Leaders",
        "description": "Large liquid NSE F&O underlyings for watchlist seeding.",
        "symbols": [
            "RELIANCE.NS",
            "HDFCBANK.NS",
            "ICICIBANK.NS",
            "SBIN.NS",
            "AXISBANK.NS",
            "INFY.NS",
            "TCS.NS",
            "LT.NS",
            "ITC.NS",
            "BHARTIARTL.NS",
            "MARUTI.NS",
            "TATAMOTORS.NS",
        ],
    },
]


def _humanize_category(category: str) -> str:
    return category.replace("_", " ").strip()


def _fallback_category_meta(category: str) -> dict[str, Any]:
    lower = category.lower()
    family = "equity"
    region = "Global"
    exchange = ""
    is_proxy = "proxy" in lower
    if "forex" in lower or "fx" in lower:
        family = "forex"
        exchange = "FX"
    elif "commodity" in lower or "metals" in lower or "energy" in lower or "agriculture" in lower or "softs" in lower or "livestock" in lower:
        family = "commodity"
    elif "future" in lower:
        family = "futures"
    elif "index" in lower:
        family = "index"
    if "india" in lower or "nse" in lower or "mcx" in lower or "inr" in lower:
        region = "India"
    elif "asia" in lower:
        region = "Asia"
    return {
        "label": _humanize_category(category),
        "asset_family": family,
        "region": region,
        "exchange": exchange,
        "is_proxy": is_proxy,
    }


def get_category_meta(category: str) -> dict[str, Any]:
    meta = _fallback_category_meta(category)
    meta.update(CATEGORY_METADATA.get(category, {}))
    meta["category"] = category
    return meta


def load_tickers(path: str | None = None) -> dict[str, list[str]]:
    file_path = path or _resolve_tickers_json_path()
    if not os.path.exists(file_path):
        return {}
    with open(file_path, encoding="utf-8") as f:
        raw = json.load(f)
    out: dict[str, list[str]] = {}
    for category, symbols in raw.items():
        if isinstance(symbols, list):
            out[str(category)] = [str(symbol).strip() for symbol in symbols if str(symbol).strip()]
    return out


@lru_cache(maxsize=1)
def load_instrument_aliases() -> dict[str, dict[str, Any]]:
    if not os.path.exists(INSTRUMENT_ALIASES_JSON):
        return {}
    with open(INSTRUMENT_ALIASES_JSON, encoding="utf-8") as f:
        raw = json.load(f)
    symbols = raw.get("symbols") if isinstance(raw, dict) else {}
    if not isinstance(symbols, dict):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for symbol, payload in symbols.items():
        if isinstance(payload, dict):
            out[str(symbol).upper()] = payload
    return out


def symbol_category_map(data: dict[str, list[str]] | None = None) -> dict[str, list[str]]:
    universe = data or load_tickers()
    out: dict[str, list[str]] = {}
    for category, symbols in universe.items():
        for symbol in symbols:
            key = str(symbol).upper()
            out.setdefault(key, []).append(category)
    for categories in out.values():
        categories.sort()
    return out


def symbol_profile(
    symbol: str,
    data: dict[str, list[str]] | None = None,
    category_map: dict[str, list[str]] | None = None,
) -> dict[str, Any]:
    sym = str(symbol or "").strip().upper()
    if is_mutual_fund_symbol(sym):
        scheme = get_scheme_record(sym) or {}
        return {
            "symbol": sym,
            "categories": [MUTUAL_FUND_CATEGORY],
            "primary_category": MUTUAL_FUND_CATEGORY,
            "category_label": "India Mutual Funds",
            "asset_family": "mutual_fund",
            "region": "India",
            "exchange": "AMFI",
            "is_proxy": False,
            "display_name": scheme.get("scheme_name") or sym,
            "aliases": [
                value
                for value in [
                    scheme.get("fund_house"),
                    scheme.get("scheme_category"),
                    scheme.get("scheme_type"),
                    scheme.get("isin_growth"),
                    scheme.get("isin_div_reinvestment"),
                ]
                if value
            ],
            "news_queries": [scheme.get("scheme_name")] if scheme.get("scheme_name") else [],
        }
    universe = data or load_tickers()
    categories = (category_map or symbol_category_map(universe)).get(sym, [])
    primary_category = categories[0] if categories else None
    category_meta = get_category_meta(primary_category) if primary_category else {}
    aliases = load_instrument_aliases().get(sym, {})
    return {
        "symbol": sym,
        "categories": categories,
        "primary_category": primary_category,
        "category_label": category_meta.get("label") or "Instrument",
        "asset_family": category_meta.get("asset_family") or "instrument",
        "region": category_meta.get("region") or "",
        "exchange": category_meta.get("exchange") or "",
        "is_proxy": bool(category_meta.get("is_proxy")),
        "display_name": aliases.get("name") or sym,
        "aliases": aliases.get("aliases") or [],
        "news_queries": aliases.get("news_queries") or [],
    }


def build_category_summaries(data: dict[str, list[str]] | None = None) -> list[dict[str, Any]]:
    universe = data or load_tickers()
    summaries = []
    for category in sorted(universe.keys()):
        meta = get_category_meta(category)
        summaries.append(
            {
                "category": category,
                "label": meta["label"],
                "count": len(universe.get(category, [])),
                "assetFamily": meta["asset_family"],
                "region": meta["region"],
                "exchange": meta["exchange"],
                "isProxy": meta["is_proxy"],
            }
        )
    return summaries


def get_symbols_by_exchange(data: dict[str, list[str]] | None = None) -> dict[str, list[str]]:
    universe = data or load_tickers()
    grouped: dict[str, set[str]] = {}
    for category, symbols in universe.items():
        exchange = str(get_category_meta(category).get("exchange") or "").strip()
        if not exchange:
            continue
        bucket = grouped.setdefault(exchange, set())
        for symbol in symbols:
            sym = str(symbol).strip().upper()
            if sym:
                bucket.add(sym)
    return {exchange: sorted(symbols) for exchange, symbols in grouped.items()}


def is_market_open(exchange: str, now: datetime | None = None) -> bool:
    from context.exchange_session import is_exchange_trading_day

    ex = str(exchange or "").strip()
    if not is_exchange_trading_day(ex, now):
        return False
    cfg = EXCHANGE_SCHEDULE.get(ex)
    if not cfg:
        return True
    tz_name = str(cfg.get("tz") or "UTC")
    tz_now = now.astimezone(ZoneInfo(tz_name)) if now else datetime.now(ZoneInfo(tz_name))
    open_at = time(hour=int(cfg.get("open_hour", 9)), minute=int(cfg.get("open_min", 0)))
    close_at = time(hour=int(cfg.get("close_hour", 16)), minute=int(cfg.get("close_min", 0)))
    current_t = tz_now.time()
    return open_at <= current_t <= close_at


def next_close_time(exchange: str, now: datetime | None = None) -> datetime:
    from context.exchange_session import is_exchange_trading_day

    cfg = EXCHANGE_SCHEDULE.get(str(exchange or "").strip())
    if not cfg:
        ref = now or datetime.now()
        return ref + timedelta(hours=24)
    tz_name = str(cfg.get("tz") or "UTC")
    zone = ZoneInfo(tz_name)
    tz_now = now.astimezone(zone) if now else datetime.now(zone)
    close_t = time(hour=int(cfg.get("close_hour", 16)), minute=int(cfg.get("close_min", 0)))
    candidate_date = tz_now.date()
    close_dt = datetime.combine(candidate_date, close_t, tzinfo=zone)
    if tz_now >= close_dt:
        candidate_date = candidate_date + timedelta(days=1)
    for _ in range(40):
        noon = datetime.combine(candidate_date, time(12, 0), tzinfo=zone)
        if is_exchange_trading_day(str(exchange or "").strip(), noon):
            return datetime.combine(candidate_date, close_t, tzinfo=zone)
        candidate_date = candidate_date + timedelta(days=1)
    return datetime.combine(candidate_date, close_t, tzinfo=zone)


def build_presets(data: dict[str, list[str]] | None = None) -> list[dict[str, Any]]:
    universe = data or load_tickers()
    out = []
    for preset in PRESET_DEFINITIONS:
        symbols = []
        if preset.get("symbols"):
            symbols.extend([str(sym).upper() for sym in preset["symbols"] if str(sym).strip()])
        for category in preset.get("categories", []):
            symbols.extend([str(sym).upper() for sym in universe.get(category, [])])
        deduped = []
        seen: set[str] = set()
        for symbol in symbols:
            if symbol and symbol not in seen:
                seen.add(symbol)
                deduped.append(symbol)
        max_symbols = int(preset.get("max_symbols") or 0)
        payload_symbols = deduped[:max_symbols] if max_symbols > 0 else deduped
        out.append(
            {
                "id": preset["id"],
                "label": preset["label"],
                "description": preset["description"],
                "symbols": payload_symbols,
                "count": len(payload_symbols),
                "categories": preset.get("categories", []),
            }
        )
    return out


def search_local_instruments(query: str, limit: int = 20, data: dict[str, list[str]] | None = None) -> list[dict[str, Any]]:
    q = str(query or "").strip().lower()
    if not q:
        return []
    universe = data or load_tickers()
    aliases = load_instrument_aliases()
    cat_map = symbol_category_map(universe)
    results = []
    seen: set[str] = set()

    def _score(symbol: str, profile: dict[str, Any]) -> int:
        sym = symbol.lower()
        score = 0
        if q == sym:
            score += 100
        if sym.startswith(q):
            score += 60
        if q in sym:
            score += 30
        name = str(profile.get("display_name") or "").lower()
        if q == name:
            score += 90
        elif name.startswith(q):
            score += 50
        elif q in name:
            score += 28
        for alias in profile.get("aliases") or []:
            alias_l = str(alias).lower()
            if q == alias_l:
                score += 95
            elif alias_l.startswith(q):
                score += 58
            elif q in alias_l:
                score += 30
        return score

    for symbol, categories in cat_map.items():
        profile = symbol_profile(symbol, universe, cat_map)
        score = _score(symbol, profile)
        if score <= 0:
            continue
        seen.add(symbol)
        results.append(
            {
                "score": score,
                "symbol": symbol,
                "name": profile["display_name"],
                "assetType": profile["category_label"],
                "assetFamily": profile["asset_family"],
                "exchange": profile["exchange"],
                "region": profile["region"],
                "isProxy": profile["is_proxy"],
                "categories": categories,
                "source": "local",
            }
        )

    for symbol, payload in aliases.items():
        if symbol in seen:
            continue
        name = str(payload.get("name") or symbol)
        terms = [name, *payload.get("aliases", [])]
        if not any(q in str(term).lower() for term in terms):
            continue
        profile = symbol_profile(symbol, universe, cat_map)
        results.append(
            {
                "score": _score(symbol, profile),
                "symbol": symbol,
                "name": profile["display_name"],
                "assetType": profile["category_label"],
                "assetFamily": profile["asset_family"],
                "exchange": profile["exchange"],
                "region": profile["region"],
                "isProxy": profile["is_proxy"],
                "categories": profile["categories"],
                "source": "alias",
            }
        )

    results.sort(key=lambda row: (-int(row["score"]), row["symbol"]))
    trimmed = results[: max(1, int(limit))]
    for row in trimmed:
        row.pop("score", None)
    return trimmed


def news_queries_for_symbol(symbol: str) -> list[str]:
    profile = symbol_profile(symbol)
    queries = [str(q).strip() for q in profile.get("news_queries") or [] if str(q).strip()]
    if queries:
        return queries
    if profile["display_name"] != profile["symbol"]:
        queries.append(profile["display_name"])
    queries.append(profile["symbol"].replace(".NS", "").replace(".BO", ""))
    return [q for q in queries if q]
