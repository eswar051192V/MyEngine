"""
India City-Wise Precious Metals Price Scraper
==============================================
Fetches live gold, silver, and platinum prices for 30+ Indian cities
from GoodReturns.in (free public data).

Synthetic ticker format:
    GOLD_DELHI.MCX, SILVER_MUMBAI.MCX, PLATINUM_CHENNAI.MCX

Prices are returned in INR per gram (gold/platinum) or INR per kg (silver).

Usage:
    from agents.india_metals_scraper import (
        get_gold_prices, get_silver_prices, get_platinum_prices,
        get_metal_price_for_ticker, get_all_metal_prices,
    )

    prices = get_gold_prices()  # -> dict[city, {price_24k, price_22k, change, ...}]
    ticker_data = get_metal_price_for_ticker("GOLD_DELHI.MCX")
"""

from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timedelta
from typing import Any

import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", "context_data", "india_metals")
CACHE_TTL_SECONDS = 900  # 15 minutes

# GoodReturns URLs for city-wise prices
GOLD_URL = "https://www.goodreturns.in/gold-rates/"
SILVER_URL = "https://www.goodreturns.in/silver-rates/"

# City name normalisation map (scraper name -> canonical)
CITY_ALIASES: dict[str, str] = {
    "bengaluru": "bangalore",
    "new delhi": "delhi",
    "thiruvananthapuram": "thiruvananthapuram",
    "trivandrum": "thiruvananthapuram",
    "vizag": "visakhapatnam",
}

SUPPORTED_CITIES = {
    "delhi", "mumbai", "chennai", "kolkata", "bangalore", "hyderabad",
    "ahmedabad", "jaipur", "pune", "lucknow", "chandigarh", "coimbatore",
    "patna", "bhopal", "nagpur", "visakhapatnam", "kochi", "surat",
    "vadodara", "indore", "mangalore", "madurai", "vijayawada",
    "thiruvananthapuram", "mysore", "guwahati", "bhubaneswar", "ranchi",
    "dehradun", "amritsar",
}


def _ensure_cache_dir() -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)


def _cache_path(metal: str) -> str:
    return os.path.join(CACHE_DIR, f"{metal}_prices.json")


def _read_cache(metal: str) -> dict[str, Any] | None:
    path = _cache_path(metal)
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        cached_at = data.get("cached_at", "")
        if cached_at:
            cached_time = datetime.fromisoformat(cached_at)
            if datetime.now() - cached_time < timedelta(seconds=CACHE_TTL_SECONDS):
                return data
    except Exception:
        pass
    return None


def _write_cache(metal: str, data: dict[str, Any]) -> None:
    _ensure_cache_dir()
    data["cached_at"] = datetime.now().isoformat()
    try:
        with open(_cache_path(metal), "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception:
        pass


def _normalise_city(raw: str) -> str:
    city = raw.strip().lower()
    city = re.sub(r"[^a-z\s]", "", city).strip()
    return CITY_ALIASES.get(city, city)


def _parse_price(text: str) -> float:
    """Parse price string like '₹7,235' or '7235.50' to float."""
    cleaned = re.sub(r"[₹,\s]", "", text.strip())
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def _scrape_goodreturns_gold() -> dict[str, dict[str, Any]]:
    """Scrape GoodReturns for city-wise gold prices."""
    session = requests.Session()
    session.headers.update(HEADERS)
    prices: dict[str, dict[str, Any]] = {}

    try:
        resp = session.get(GOLD_URL, timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        # GoodReturns lists city-wise gold rates in tables
        tables = soup.find_all("table")
        for table in tables:
            rows = table.find_all("tr")
            for row in rows:
                cells = row.find_all("td")
                if len(cells) >= 3:
                    city_raw = cells[0].get_text(strip=True)
                    city = _normalise_city(city_raw)
                    if city not in SUPPORTED_CITIES:
                        continue
                    price_22k = _parse_price(cells[1].get_text(strip=True))
                    price_24k = _parse_price(cells[2].get_text(strip=True))
                    if price_22k > 0 or price_24k > 0:
                        prices[city] = {
                            "city": city_raw.strip().title(),
                            "price_22k": price_22k,
                            "price_24k": price_24k,
                            "price": price_24k if price_24k > 0 else price_22k,
                            "unit": "per gram",
                            "currency": "INR",
                            "metal": "gold",
                        }
    except Exception as exc:
        print(f"[india_metals] Gold scrape failed: {exc}")

    return prices


def _scrape_goodreturns_silver() -> dict[str, dict[str, Any]]:
    """Scrape GoodReturns for city-wise silver prices."""
    session = requests.Session()
    session.headers.update(HEADERS)
    prices: dict[str, dict[str, Any]] = {}

    try:
        resp = session.get(SILVER_URL, timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        tables = soup.find_all("table")
        for table in tables:
            rows = table.find_all("tr")
            for row in rows:
                cells = row.find_all("td")
                if len(cells) >= 2:
                    city_raw = cells[0].get_text(strip=True)
                    city = _normalise_city(city_raw)
                    if city not in SUPPORTED_CITIES:
                        continue
                    price_val = _parse_price(cells[1].get_text(strip=True))
                    if price_val > 0:
                        prices[city] = {
                            "city": city_raw.strip().title(),
                            "price": price_val,
                            "unit": "per kg",
                            "currency": "INR",
                            "metal": "silver",
                        }
    except Exception as exc:
        print(f"[india_metals] Silver scrape failed: {exc}")

    return prices


def _derive_platinum_prices(gold_prices: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """
    Platinum city-wise prices are rarely published in India.
    We derive them from global platinum-to-gold ratio applied to city gold prices.
    Global ratio: Platinum ≈ 0.42x Gold (typical recent range).
    """
    PT_TO_GOLD_RATIO = 0.42  # approximate global ratio
    prices: dict[str, dict[str, Any]] = {}

    for city, gold_data in gold_prices.items():
        gold_price = gold_data.get("price_24k") or gold_data.get("price", 0)
        if gold_price > 0:
            pt_price = round(gold_price * PT_TO_GOLD_RATIO, 2)
            prices[city] = {
                "city": gold_data["city"],
                "price": pt_price,
                "unit": "per gram",
                "currency": "INR",
                "metal": "platinum",
                "derived": True,
                "note": f"Derived from gold price at {PT_TO_GOLD_RATIO:.2f}x ratio",
            }

    return prices


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_gold_prices(force_refresh: bool = False) -> dict[str, dict[str, Any]]:
    """Get city-wise gold prices in INR. Returns dict keyed by normalised city name."""
    if not force_refresh:
        cached = _read_cache("gold")
        if cached and cached.get("prices"):
            return cached["prices"]

    prices = _scrape_goodreturns_gold()
    if prices:
        _write_cache("gold", {"prices": prices})
    return prices


def get_silver_prices(force_refresh: bool = False) -> dict[str, dict[str, Any]]:
    """Get city-wise silver prices in INR."""
    if not force_refresh:
        cached = _read_cache("silver")
        if cached and cached.get("prices"):
            return cached["prices"]

    prices = _scrape_goodreturns_silver()
    if prices:
        _write_cache("silver", {"prices": prices})
    return prices


def get_platinum_prices(force_refresh: bool = False) -> dict[str, dict[str, Any]]:
    """Get city-wise platinum prices in INR (derived from gold prices)."""
    if not force_refresh:
        cached = _read_cache("platinum")
        if cached and cached.get("prices"):
            return cached["prices"]

    gold_prices = get_gold_prices(force_refresh=force_refresh)
    prices = _derive_platinum_prices(gold_prices)
    if prices:
        _write_cache("platinum", {"prices": prices})
    return prices


def get_all_metal_prices(force_refresh: bool = False) -> dict[str, dict[str, dict[str, Any]]]:
    """Get all city-wise precious metal prices."""
    return {
        "gold": get_gold_prices(force_refresh),
        "silver": get_silver_prices(force_refresh),
        "platinum": get_platinum_prices(force_refresh),
    }


def parse_metal_ticker(ticker: str) -> tuple[str, str] | None:
    """
    Parse a synthetic metal ticker like GOLD_DELHI.MCX.
    Returns (metal, city) or None if not a metal ticker.
    """
    ticker = ticker.strip().upper()
    if not ticker.endswith(".MCX"):
        return None

    base = ticker[:-4]  # Remove .MCX
    for prefix in ("GOLD_", "SILVER_", "PLATINUM_"):
        if base.startswith(prefix):
            metal = prefix.rstrip("_").lower()
            city = base[len(prefix):].lower().replace("_", " ").strip()
            return metal, city

    return None


def is_metal_ticker(ticker: str) -> bool:
    """Check if a ticker is a synthetic Indian metal ticker."""
    return parse_metal_ticker(ticker) is not None


def get_metal_price_for_ticker(ticker: str) -> dict[str, Any] | None:
    """
    Get price data for a synthetic metal ticker like GOLD_DELHI.MCX.
    Returns dict with price, change info, etc., or None if not found.
    """
    parsed = parse_metal_ticker(ticker)
    if not parsed:
        return None

    metal, city = parsed

    if metal == "gold":
        prices = get_gold_prices()
    elif metal == "silver":
        prices = get_silver_prices()
    elif metal == "platinum":
        prices = get_platinum_prices()
    else:
        return None

    # Try exact match then fuzzy
    city_data = prices.get(city)
    if not city_data:
        # Try without spaces
        for k, v in prices.items():
            if k.replace(" ", "") == city.replace(" ", ""):
                city_data = v
                break

    if not city_data:
        return None

    return {
        "symbol": ticker.upper(),
        "name": f"{metal.title()} — {city_data.get('city', city.title())}",
        "price": city_data.get("price", 0),
        "price_22k": city_data.get("price_22k"),
        "price_24k": city_data.get("price_24k"),
        "changePct": 0,  # No intraday change available from scrape
        "change": 0,
        "currencySymbol": "₹",
        "currency": "INR",
        "unit": city_data.get("unit", "per gram"),
        "metal": metal,
        "city": city_data.get("city", city.title()),
        "derived": city_data.get("derived", False),
        "source": "goodreturns.in",
    }


def get_all_metal_tickers_data() -> list[dict[str, Any]]:
    """Get price data for all city-wise metal tickers."""
    all_prices = get_all_metal_prices()
    results = []

    for metal, city_prices in all_prices.items():
        for city, data in city_prices.items():
            ticker = f"{metal.upper()}_{city.upper().replace(' ', '_')}.MCX"
            results.append({
                "symbol": ticker,
                "name": f"{metal.title()} — {data.get('city', city.title())}",
                "price": data.get("price", 0),
                "price_22k": data.get("price_22k"),
                "price_24k": data.get("price_24k"),
                "changePct": 0,
                "change": 0,
                "currencySymbol": "₹",
                "currency": "INR",
                "unit": data.get("unit", "per gram"),
                "metal": metal,
                "city": data.get("city", city.title()),
                "derived": data.get("derived", False),
                "source": "goodreturns.in",
            })

    return results
