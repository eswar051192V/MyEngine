"""Fetch open/market news for a symbol and persist merged JSON on disk."""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import requests
import yfinance as yf

from market_universe import news_queries_for_symbol, symbol_profile

NEWS_DIR = os.environ.get("NEWS_DATA_DIR", "context_data/news")


def _ensure_dir() -> None:
    os.makedirs(NEWS_DIR, exist_ok=True)


def _path_for(symbol: str) -> str:
    safe = symbol.replace("/", "_").replace("..", "")
    return os.path.join(NEWS_DIR, f"{safe}.json")


def _item_id(url: str, title: str, published: str) -> str:
    return hashlib.sha256(f"{url}|{title}|{published}".encode("utf-8")).hexdigest()[:16]


def _yf_news(symbol: str, limit: int = 40) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        t = yf.Ticker(symbol)
        raw = t.news or []
    except Exception:
        return out
    for n in raw[:limit]:
        title = n.get("title") or ""
        link = n.get("link") or ""
        pub = ""
        if n.get("providerPublishTime"):
            try:
                pub = datetime.fromtimestamp(int(n["providerPublishTime"]), tz=timezone.utc).date().isoformat()
            except (TypeError, ValueError, OSError):
                pub = ""
        publisher = (n.get("publisher") or "yfinance")[:120]
        out.append(
            {
                "id": _item_id(link, title, pub),
                "title": title[:500],
                "link": link[:2000],
                "publisher": publisher,
                "published_at": pub,
                "provider": "yfinance",
            }
        )
    return out


def _finnhub_news(symbol: str, days_back: int = 30) -> list[dict[str, Any]]:
    profile = symbol_profile(symbol)
    if profile.get("asset_family") in {"forex", "commodity", "futures", "index"}:
        return []
    key = os.environ.get("FINNHUB_API_KEY", "").strip()
    if not key:
        return []
    # Finnhub expects US tickers often; try stripped symbol
    sym = symbol.replace(".NS", "").replace(".BO", "").replace("-", ".")
    to_d = datetime.now(timezone.utc).date()
    from_d = to_d - timedelta(days=days_back)
    url = "https://finnhub.io/api/v1/company-news"
    params = {
        "symbol": sym,
        "from": from_d.isoformat(),
        "to": to_d.isoformat(),
        "token": key,
    }
    try:
        r = requests.get(url, params=params, timeout=30)
        if r.status_code != 200:
            return []
        data = r.json()
    except requests.RequestException:
        return []
    if not isinstance(data, list):
        return []
    out: list[dict[str, Any]] = []
    for n in data[:50]:
        title = n.get("headline") or ""
        link = n.get("url") or ""
        pub = ""
        if n.get("datetime"):
            try:
                pub = datetime.fromtimestamp(int(n["datetime"]), tz=timezone.utc).date().isoformat()
            except (TypeError, ValueError, OSError):
                pub = ""
        out.append(
            {
                "id": _item_id(link, title, pub),
                "title": title[:500],
                "link": link[:2000],
                "publisher": (n.get("source") or "finnhub")[:120],
                "published_at": pub,
                "provider": "finnhub",
            }
        )
    return out


def _newsapi_symbol(symbol: str, company_name: str | None, search_terms: list[str] | None = None) -> list[dict[str, Any]]:
    key = os.environ.get("NEWSAPI_KEY", "").strip()
    if not key:
        return []
    terms = [str(t).strip() for t in (search_terms or []) if str(t).strip()]
    if company_name:
        terms.insert(0, company_name)
    if not terms:
        terms = [symbol.replace(".NS", "").replace(".BO", "")]
    terms = [term for term in terms if len(term) >= 2]
    if not terms:
        return []
    q = " OR ".join(f'"{term}"' for term in terms[:4])
    url = "https://newsapi.org/v2/everything"
    params = {
        "q": q,
        "language": "en",
        "sortBy": "publishedAt",
        "pageSize": 30,
        "apiKey": key,
    }
    try:
        r = requests.get(url, params=params, timeout=30)
        if r.status_code != 200:
            return []
        data = r.json()
    except requests.RequestException:
        return []
    arts = data.get("articles") or []
    out: list[dict[str, Any]] = []
    for a in arts:
        title = a.get("title") or ""
        link = a.get("url") or ""
        pub = (a.get("publishedAt") or "")[:10]
        out.append(
            {
                "id": _item_id(link, title, pub),
                "title": title[:500],
                "link": link[:2000],
                "publisher": (a.get("source") or {}).get("name") or "newsapi",
                "published_at": pub,
                "provider": "newsapi",
            }
        )
    return out


def fetch_news_live(symbol: str) -> dict[str, Any]:
    """Pull from yfinance + optional Finnhub + optional NewsAPI."""
    profile = symbol_profile(symbol)
    company = None
    try:
        company = (yf.Ticker(symbol).info or {}).get("shortName") or (yf.Ticker(symbol).info or {}).get("longName")
    except Exception:
        pass
    search_terms = news_queries_for_symbol(symbol)
    batches = [_yf_news(symbol)]
    batches.append(_finnhub_news(symbol))
    batches.append(_newsapi_symbol(symbol, company or profile.get("display_name"), search_terms))
    merged: dict[str, dict[str, Any]] = {}
    for batch in batches:
        for it in batch:
            merged[it["id"]] = it
    items = sorted(merged.values(), key=lambda x: (x.get("published_at") or "", x["id"]), reverse=True)
    return {
        "symbol": symbol,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "company_name": company,
        "items": items[:200],
        "counts": {
            "yfinance": sum(1 for i in items if i.get("provider") == "yfinance"),
            "finnhub": sum(1 for i in items if i.get("provider") == "finnhub"),
            "newsapi": sum(1 for i in items if i.get("provider") == "newsapi"),
        },
    }


def load_saved_news(symbol: str) -> dict[str, Any] | None:
    p = _path_for(symbol)
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def save_news(symbol: str, payload: dict[str, Any]) -> str:
    _ensure_dir()
    p = _path_for(symbol)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return p


def refresh_and_save(symbol: str) -> dict[str, Any]:
    payload = fetch_news_live(symbol)
    path = save_news(symbol, payload)
    return {"ok": True, "path": path, **payload}
