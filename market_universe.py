from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Any

from context.india_mutual_funds import (
    MUTUAL_FUND_CATEGORY,
    get_scheme_record,
    is_mutual_fund_symbol,
)

TICKERS_JSON = os.environ.get("TICKERS_JSON", "all_global_tickers.json")
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
    # --- India Mutual Funds ---
    MUTUAL_FUND_CATEGORY: {
        "label": "India Mutual Funds",
        "asset_family": "mutual_fund",
        "region": "India",
        "exchange": "AMFI",
        "is_proxy": False,
    },

    # --- Indian Equities ---
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

    # --- Indian Indices ---
    "India_Indices": {
        "label": "Indian Market Indices",
        "asset_family": "index",
        "region": "India",
        "exchange": "NSE/BSE",
        "is_proxy": False,
    },
    "India_Nifty50_Constituents": {
        "label": "Nifty 50 Constituents",
        "asset_family": "equity",
        "region": "India",
        "exchange": "NSE",
        "is_proxy": False,
    },

    # --- Indian ETFs ---
    "India_ETFs": {
        "label": "Indian ETFs",
        "asset_family": "etf",
        "region": "India",
        "exchange": "NSE",
        "is_proxy": False,
    },

    # --- Indian F&O ---
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

    # --- Indian Bonds ---
    "India_Bond_ETFs": {
        "label": "Indian Bond & Gilt ETFs",
        "asset_family": "bond",
        "region": "India",
        "exchange": "NSE",
        "is_proxy": False,
    },
    "India_Bond_Proxies": {
        "label": "Indian Bond Proxies (Global)",
        "asset_family": "bond",
        "region": "India",
        "exchange": "Global",
        "is_proxy": True,
    },

    # --- INR Forex ---
    "INR_Forex_Pairs": {
        "label": "INR Forex Pairs",
        "asset_family": "forex",
        "region": "India",
        "exchange": "FX",
        "is_proxy": False,
    },
    "INR_Cross_Rates": {
        "label": "INR Cross Rate References",
        "asset_family": "forex",
        "region": "India",
        "exchange": "FX",
        "is_proxy": False,
    },

    # --- Crypto ---
    "Crypto_Major_USD": {
        "label": "Crypto Majors (USD)",
        "asset_family": "crypto",
        "region": "Global",
        "exchange": "Crypto",
        "is_proxy": False,
    },
    "Crypto_INR_Pairs": {
        "label": "Crypto (INR Pairs)",
        "asset_family": "crypto",
        "region": "India",
        "exchange": "Crypto",
        "is_proxy": False,
    },
    "Crypto_Stablecoins": {
        "label": "Stablecoins",
        "asset_family": "crypto",
        "region": "Global",
        "exchange": "Crypto",
        "is_proxy": False,
    },

    # --- City-wise Precious Metals ---
    "India_Gold_CityWise": {
        "label": "Gold Prices — Indian Cities",
        "asset_family": "commodity",
        "region": "India",
        "exchange": "MCX/Retail",
        "is_proxy": False,
    },
    "India_Silver_CityWise": {
        "label": "Silver Prices — Indian Cities",
        "asset_family": "commodity",
        "region": "India",
        "exchange": "MCX/Retail",
        "is_proxy": False,
    },
    "India_Platinum_CityWise": {
        "label": "Platinum Prices — Indian Cities",
        "asset_family": "commodity",
        "region": "India",
        "exchange": "MCX/Retail",
        "is_proxy": False,
    },
    "India_PreciousMetals_Benchmark": {
        "label": "Precious Metals Benchmarks (India)",
        "asset_family": "commodity",
        "region": "India",
        "exchange": "Global/NSE",
        "is_proxy": False,
    },

    # --- Indian MCX Commodity Proxies ---
    "Indian_MCX_Proxy_PreciousMetals": {
        "label": "MCX Proxy — Precious Metals",
        "asset_family": "commodity",
        "region": "India",
        "exchange": "MCX Proxy",
        "is_proxy": True,
    },
    "Indian_MCX_Proxy_Energy": {
        "label": "MCX Proxy — Energy",
        "asset_family": "commodity",
        "region": "India",
        "exchange": "MCX Proxy",
        "is_proxy": True,
    },
    "Indian_MCX_Proxy_BaseMetals": {
        "label": "MCX Proxy — Base Metals",
        "asset_family": "commodity",
        "region": "India",
        "exchange": "MCX Proxy",
        "is_proxy": True,
    },
    "Indian_MCX_Commodities_Extended": {
        "label": "MCX Extended Commodities",
        "asset_family": "commodity",
        "region": "India",
        "exchange": "MCX Proxy",
        "is_proxy": True,
    },
    "India_Commodity_ETFs": {
        "label": "Indian Commodity ETFs",
        "asset_family": "etf",
        "region": "India",
        "exchange": "NSE",
        "is_proxy": False,
    },

    # --- Global Forex ---
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

    # --- Global Commodities ---
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

    # --- Additional US Markets ---
    "Russell_1000": {
        "label": "Russell 1000",
        "asset_family": "equity",
        "region": "US",
        "exchange": "NYSE/NASDAQ",
        "is_proxy": False,
    },

    # --- Additional Global Indices ---
    "France_CAC40": {
        "label": "CAC 40 (France)",
        "asset_family": "equity",
        "region": "Europe",
        "exchange": "Euronext Paris",
        "is_proxy": False,
    },
    "Switzerland_SMI": {
        "label": "SMI 20 (Switzerland)",
        "asset_family": "equity",
        "region": "Europe",
        "exchange": "SIX Swiss",
        "is_proxy": False,
    },
    "Canada_TSX60": {
        "label": "S&P/TSX 60 (Canada)",
        "asset_family": "equity",
        "region": "Americas",
        "exchange": "TSX",
        "is_proxy": False,
    },
    "Australia_ASX200": {
        "label": "S&P/ASX 200 (Australia)",
        "asset_family": "equity",
        "region": "Asia-Pacific",
        "exchange": "ASX",
        "is_proxy": False,
    },
    "Korea_KOSPI50": {
        "label": "KOSPI 50 (South Korea)",
        "asset_family": "equity",
        "region": "Asia",
        "exchange": "KRX",
        "is_proxy": False,
    },
    "Taiwan_TWSE50": {
        "label": "FTSE TWSE Taiwan 50",
        "asset_family": "equity",
        "region": "Asia",
        "exchange": "TWSE",
        "is_proxy": False,
    },
    "Brazil_Bovespa": {
        "label": "Bovespa / B3 (Brazil)",
        "asset_family": "equity",
        "region": "Americas",
        "exchange": "B3",
        "is_proxy": False,
    },
    "SouthAfrica_JSE40": {
        "label": "JSE Top 40 (South Africa)",
        "asset_family": "equity",
        "region": "Africa",
        "exchange": "JSE",
        "is_proxy": False,
    },
    "Global_Benchmark_Indices": {
        "label": "Global Benchmark Indices",
        "asset_family": "index",
        "region": "Global",
        "exchange": "Multiple",
        "is_proxy": False,
    },
}

PRESET_DEFINITIONS = [
    # --- Indian Presets ---
    {
        "id": "india_nifty50",
        "label": "Nifty 50",
        "description": "All 50 constituents of the NSE Nifty 50 index.",
        "categories": ["India_Nifty50_Constituents"],
        "max_symbols": 50,
    },
    {
        "id": "india_indices_all",
        "label": "India All Indices",
        "description": "Major Indian market indices (Nifty, Sensex, Bank Nifty, sectoral).",
        "categories": ["India_Indices"],
        "max_symbols": 20,
    },
    {
        "id": "india_etfs",
        "label": "India ETFs",
        "description": "Popular Indian ETFs — equity, gold, silver, debt, and international.",
        "categories": ["India_ETFs"],
        "max_symbols": 30,
    },
    {
        "id": "india_forex_core",
        "label": "India Forex Core",
        "description": "INR pairs and Asia FX names relevant to Indian macro screens.",
        "categories": ["INR_Forex_Pairs", "INR_Cross_Rates"],
        "max_symbols": 24,
    },
    {
        "id": "india_bonds",
        "label": "India Bonds & Gilts",
        "description": "Indian bond/gilt ETFs and global bond proxies with India exposure.",
        "categories": ["India_Bond_ETFs", "India_Bond_Proxies"],
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
            "Indian_MCX_Commodities_Extended",
        ],
        "max_symbols": 20,
    },
    {
        "id": "india_commodity_etfs",
        "label": "India Commodity ETFs",
        "description": "Gold, silver, and commodity ETFs on NSE.",
        "categories": ["India_Commodity_ETFs"],
        "max_symbols": 10,
    },
    {
        "id": "india_gold_citywise",
        "label": "Gold Prices — Indian Cities",
        "description": "Live gold prices across 30 Indian cities.",
        "categories": ["India_Gold_CityWise"],
        "max_symbols": 30,
    },
    {
        "id": "india_silver_citywise",
        "label": "Silver Prices — Indian Cities",
        "description": "Live silver prices across 30 Indian cities.",
        "categories": ["India_Silver_CityWise"],
        "max_symbols": 30,
    },
    {
        "id": "india_platinum_citywise",
        "label": "Platinum Prices — Indian Cities",
        "description": "Live platinum prices across 30 Indian cities.",
        "categories": ["India_Platinum_CityWise"],
        "max_symbols": 30,
    },
    {
        "id": "india_precious_metals_all",
        "label": "India Precious Metals (All)",
        "description": "City-wise gold/silver/platinum + benchmarks + ETFs.",
        "categories": [
            "India_Gold_CityWise", "India_Silver_CityWise", "India_Platinum_CityWise",
            "India_PreciousMetals_Benchmark", "India_Commodity_ETFs",
        ],
        "max_symbols": 100,
    },
    {
        "id": "crypto_inr",
        "label": "Crypto INR Pairs",
        "description": "Major cryptocurrencies priced in INR.",
        "categories": ["Crypto_INR_Pairs"],
        "max_symbols": 15,
    },
    {
        "id": "crypto_all",
        "label": "All Crypto",
        "description": "Major cryptos in USD, INR, and stablecoins.",
        "categories": ["Crypto_Major_USD", "Crypto_INR_Pairs", "Crypto_Stablecoins"],
        "max_symbols": 40,
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
            "RELIANCE.NS", "HDFCBANK.NS", "ICICIBANK.NS", "SBIN.NS",
            "AXISBANK.NS", "INFY.NS", "TCS.NS", "LT.NS",
            "ITC.NS", "BHARTIARTL.NS", "MARUTI.NS", "TATAMOTORS.NS",
        ],
    },
    # --- Global Presets ---
    {
        "id": "global_fx_majors",
        "label": "Global FX Majors",
        "description": "Liquid G10 FX pairs for broad dollar and carry monitoring.",
        "categories": ["Global_Forex_Majors", "Global_Forex_Crosses"],
        "max_symbols": 16,
    },
    {
        "id": "commodity_benchmarks",
        "label": "Commodity Benchmarks",
        "description": "A cross-section of global metals, energy, and agriculture futures.",
        "symbols": [
            "GC=F", "SI=F", "CL=F", "BZ=F", "NG=F", "HG=F", "ALI=F",
            "ZC=F", "ZW=F", "ZS=F", "KC=F", "SB=F",
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
    """Load tickers — returns flat symbol lists (backward compatible).
    Handles both old format (["SYM1", "SYM2"]) and
    enriched format ([{"s": "SYM1", "n": "Name 1"}, ...]).
    """
    file_path = path or TICKERS_JSON
    if not os.path.exists(file_path):
        return {}
    with open(file_path, encoding="utf-8") as f:
        raw = json.load(f)
    out: dict[str, list[str]] = {}
    for category, items in raw.items():
        if not isinstance(items, list):
            continue
        symbols = []
        for item in items:
            if isinstance(item, dict):
                sym = str(item.get("s", "")).strip()
            else:
                sym = str(item).strip()
            if sym:
                symbols.append(sym)
        out[str(category)] = symbols
    return out


def load_tickers_enriched(path: str | None = None) -> dict[str, list[dict[str, str]]]:
    """Load tickers with names — returns [{s: symbol, n: name}, ...] per category.
    Handles both old format and enriched format.
    """
    file_path = path or TICKERS_JSON
    if not os.path.exists(file_path):
        return {}
    with open(file_path, encoding="utf-8") as f:
        raw = json.load(f)
    out: dict[str, list[dict[str, str]]] = {}
    for category, items in raw.items():
        if not isinstance(items, list):
            continue
        enriched = []
        for item in items:
            if isinstance(item, dict):
                sym = str(item.get("s", "")).strip()
                name = str(item.get("n", "") or "").strip()
                if sym:
                    enriched.append({"s": sym, "n": name or sym})
            else:
                sym = str(item).strip()
                if sym:
                    enriched.append({"s": sym, "n": sym})
        out[str(category)] = enriched
    return out


@lru_cache(maxsize=1)
def ticker_name_map(path: str | None = None) -> dict[str, str]:
    """Build a flat {SYMBOL: name} lookup from the enriched ticker JSON."""
    enriched = load_tickers_enriched(path)
    out: dict[str, str] = {}
    for items in enriched.values():
        for item in items:
            sym = item["s"].upper()
            if sym not in out or (item["n"] and item["n"] != sym):
                out[sym] = item["n"]
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
    # Priority for display_name: instrument_aliases > ticker_name_map > symbol
    display_name = aliases.get("name") or ""
    if not display_name:
        names = ticker_name_map()
        display_name = names.get(sym, "")
    if not display_name:
        display_name = sym
    return {
        "symbol": sym,
        "categories": categories,
        "primary_category": primary_category,
        "category_label": category_meta.get("label") or "Instrument",
        "asset_family": category_meta.get("asset_family") or "instrument",
        "region": category_meta.get("region") or "",
        "exchange": category_meta.get("exchange") or "",
        "is_proxy": bool(category_meta.get("is_proxy")),
        "display_name": display_name,
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
