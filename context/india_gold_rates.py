"""
Scraper for Indian city-wise gold and silver rates from goodreturns.in.
Caches results locally with a 30-minute TTL.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Any

import requests

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None  # type: ignore[assignment,misc]

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.environ.get("INDIA_GOLD_DATA_DIR", os.path.join(_REPO_ROOT, "context_data", "india_gold_rates"))
GOLD_CACHE = os.path.join(DATA_DIR, "gold_latest.json")
SILVER_CACHE = os.path.join(DATA_DIR, "silver_latest.json")
CACHE_TTL_SECONDS = 1800  # 30 minutes

GOLD_URL = "https://www.goodreturns.in/gold-rates/"
SILVER_URL = "https://www.goodreturns.in/silver-rates/"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}

MAJOR_CITIES = [
    "Delhi", "Mumbai", "Chennai", "Bangalore", "Hyderabad", "Kolkata",
    "Ahmedabad", "Pune", "Jaipur", "Lucknow", "Chandigarh", "Bhopal",
    "Patna", "Coimbatore", "Kochi", "Visakhapatnam", "Nagpur", "Surat",
    "Indore", "Vadodara",
]


def _ensure_dirs() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)


def _read_cache(path: str) -> dict[str, Any] | None:
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        ts = data.get("scraped_at")
        if ts:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(ts)).total_seconds()
            if age < CACHE_TTL_SECONDS:
                return data
    except (json.JSONDecodeError, ValueError, OSError):
        pass
    return None


def _write_cache(path: str, data: dict[str, Any]) -> None:
    _ensure_dirs()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _parse_rate(text: str) -> float | None:
    """Extract numeric rate from text like '₹72,350' or 'Rs 72,350'."""
    cleaned = re.sub(r"[^\d.]", "", str(text or "").replace(",", ""))
    try:
        val = float(cleaned)
        return val if val > 0 else None
    except (ValueError, TypeError):
        return None


def scrape_gold_rates() -> dict[str, Any]:
    """Scrape gold rates from goodreturns.in and return structured data."""
    if BeautifulSoup is None:
        return _fallback_gold()

    try:
        resp = requests.get(GOLD_URL, headers=HEADERS, timeout=30)
        resp.raise_for_status()
    except requests.RequestException as exc:
        print(f"Gold scrape failed: {exc}")
        return _fallback_gold()

    soup = BeautifulSoup(resp.text, "html.parser")

    gold_22k: dict[str, float | None] = {}
    gold_24k: dict[str, float | None] = {}

    tables = soup.find_all("table")
    for table in tables:
        rows = table.find_all("tr")
        for row in rows:
            cells = row.find_all(["td", "th"])
            if len(cells) >= 3:
                city_text = cells[0].get_text(strip=True)
                city_match = None
                for c in MAJOR_CITIES:
                    if c.lower() in city_text.lower():
                        city_match = c
                        break
                if not city_match:
                    if re.search(r"[A-Z][a-z]+", city_text) and "gold" not in city_text.lower():
                        city_match = city_text.split("(")[0].strip().split(",")[0].strip()
                if city_match:
                    rate_22 = _parse_rate(cells[1].get_text(strip=True))
                    rate_24 = _parse_rate(cells[2].get_text(strip=True)) if len(cells) > 2 else None
                    if rate_22 and rate_22 > 10000:
                        gold_22k[city_match] = rate_22
                    if rate_24 and rate_24 > 10000:
                        gold_24k[city_match] = rate_24

    today_rate_22k = None
    today_rate_24k = None
    spans = soup.find_all(["span", "div", "td"], string=re.compile(r"₹[\d,]+"))
    rate_values = []
    for span in spans:
        val = _parse_rate(span.get_text(strip=True))
        if val and val > 10000:
            rate_values.append(val)

    if rate_values and not gold_22k:
        rate_values.sort()
        if len(rate_values) >= 2:
            today_rate_22k = rate_values[0]
            today_rate_24k = rate_values[-1]
        elif len(rate_values) == 1:
            today_rate_24k = rate_values[0]

    result = {
        "source": "goodreturns.in",
        "url": GOLD_URL,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "unit": "per 10 grams",
        "currency": "INR",
        "gold_22k": gold_22k if gold_22k else ({"India": today_rate_22k} if today_rate_22k else {}),
        "gold_24k": gold_24k if gold_24k else ({"India": today_rate_24k} if today_rate_24k else {}),
    }

    _write_cache(GOLD_CACHE, result)
    return result


def scrape_silver_rates() -> dict[str, Any]:
    """Scrape silver rates from goodreturns.in."""
    if BeautifulSoup is None:
        return _fallback_silver()

    try:
        resp = requests.get(SILVER_URL, headers=HEADERS, timeout=30)
        resp.raise_for_status()
    except requests.RequestException as exc:
        print(f"Silver scrape failed: {exc}")
        return _fallback_silver()

    soup = BeautifulSoup(resp.text, "html.parser")

    silver_rates: dict[str, float | None] = {}

    tables = soup.find_all("table")
    for table in tables:
        rows = table.find_all("tr")
        for row in rows:
            cells = row.find_all(["td", "th"])
            if len(cells) >= 2:
                city_text = cells[0].get_text(strip=True)
                city_match = None
                for c in MAJOR_CITIES:
                    if c.lower() in city_text.lower():
                        city_match = c
                        break
                if city_match:
                    rate = _parse_rate(cells[1].get_text(strip=True))
                    if rate and rate > 1000:
                        silver_rates[city_match] = rate

    result = {
        "source": "goodreturns.in",
        "url": SILVER_URL,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "unit": "per kg",
        "currency": "INR",
        "silver": silver_rates,
    }

    _write_cache(SILVER_CACHE, result)
    return result


def _fallback_gold() -> dict[str, Any]:
    """Return empty structure when scraping is unavailable."""
    return {
        "source": "unavailable",
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "unit": "per 10 grams",
        "currency": "INR",
        "gold_22k": {},
        "gold_24k": {},
        "error": "BeautifulSoup not installed or scraping failed. Install: pip install beautifulsoup4",
    }


def _fallback_silver() -> dict[str, Any]:
    return {
        "source": "unavailable",
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "unit": "per kg",
        "currency": "INR",
        "silver": {},
        "error": "BeautifulSoup not installed or scraping failed. Install: pip install beautifulsoup4",
    }


def load_gold_rates(force_refresh: bool = False) -> dict[str, Any]:
    """Return cached gold rates or scrape fresh data."""
    if not force_refresh:
        cached = _read_cache(GOLD_CACHE)
        if cached:
            return cached
    return scrape_gold_rates()


def load_silver_rates(force_refresh: bool = False) -> dict[str, Any]:
    """Return cached silver rates or scrape fresh data."""
    if not force_refresh:
        cached = _read_cache(SILVER_CACHE)
        if cached:
            return cached
    return scrape_silver_rates()


def load_all_precious_rates(force_refresh: bool = False) -> dict[str, Any]:
    """Combined gold + silver rates."""
    gold = load_gold_rates(force_refresh)
    silver = load_silver_rates(force_refresh)
    return {
        "gold": gold,
        "silver": silver,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
