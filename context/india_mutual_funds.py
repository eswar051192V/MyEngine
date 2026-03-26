from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta, timezone
from typing import Any

import requests

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.environ.get("INDIA_MUTUAL_FUNDS_DATA_DIR", os.path.join(_REPO_ROOT, "context_data", "india_mutual_funds"))
SCHEMES_JSON = os.path.join(DATA_DIR, "schemes.json")
NAV_DIR = os.path.join(DATA_DIR, "nav")
AMFI_NAVALL_URL = os.environ.get("AMFI_NAVALL_URL", "https://www.amfiindia.com/spages/NAVAll.TXT")
MFAPI_BASE_URL = os.environ.get("MFAPI_BASE_URL", "https://api.mfapi.in")
MUTUAL_FUND_CATEGORY = "India_Mutual_Funds"
MUTUAL_FUND_SYMBOL_PREFIX = "MF:"
AMFI_WEBSITE = "https://www.amfiindia.com"
MFAPI_WEBSITE = "https://www.mfapi.in"


def _ensure_data_dirs() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(NAV_DIR, exist_ok=True)


def mutual_fund_symbol(scheme_code: str | int) -> str:
    return f"{MUTUAL_FUND_SYMBOL_PREFIX}{str(scheme_code).strip()}"


def is_mutual_fund_symbol(symbol: str | None) -> bool:
    return str(symbol or "").strip().upper().startswith(MUTUAL_FUND_SYMBOL_PREFIX)


def scheme_code_from_symbol(symbol: str | None) -> str:
    raw = str(symbol or "").strip().upper()
    if not raw.startswith(MUTUAL_FUND_SYMBOL_PREFIX):
        return ""
    return raw.split(":", 1)[1].strip()


def nav_cache_path(scheme_code: str | int) -> str:
    safe_code = str(scheme_code).strip()
    return os.path.join(NAV_DIR, f"{safe_code}.json")


def _read_json(path: str) -> dict[str, Any] | None:
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        payload = json.load(f)
    return payload if isinstance(payload, dict) else None


def _write_json(path: str, payload: dict[str, Any]) -> None:
    _ensure_data_dirs()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def _parse_amfi_navall(text: str) -> list[dict[str, Any]]:
    current_scheme_type = ""
    current_scheme_category = ""
    current_fund_house = ""
    rows: list[dict[str, Any]] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("Scheme Code;"):
            continue
        parts = [part.strip() for part in raw_line.split(";")]
        if len(parts) >= 6 and parts[0].strip().isdigit():
            scheme_code = parts[0].strip()
            isin_growth = parts[1].strip() or None
            isin_div_reinvestment = parts[2].strip() or None
            scheme_name = parts[3].strip()
            nav_value = parts[4].strip()
            nav_date = parts[5].strip()
            rows.append(
                {
                    "scheme_code": scheme_code,
                    "symbol": mutual_fund_symbol(scheme_code),
                    "scheme_name": scheme_name,
                    "fund_house": current_fund_house,
                    "scheme_type": current_scheme_type,
                    "scheme_category": current_scheme_category,
                    "isin_growth": isin_growth if isin_growth and isin_growth != "-" else None,
                    "isin_div_reinvestment": (
                        isin_div_reinvestment if isin_div_reinvestment and isin_div_reinvestment != "-" else None
                    ),
                    "latest_nav": float(nav_value) if nav_value else None,
                    "latest_nav_date": nav_date,
                    "currency": "INR",
                }
            )
            continue
        if "(" in line and line.endswith(")"):
            prefix, suffix = line.split("(", 1)
            current_scheme_type = prefix.strip() or current_scheme_type
            current_scheme_category = suffix[:-1].strip() or current_scheme_category
            current_fund_house = ""
            continue
        current_fund_house = line
    return rows


def refresh_scheme_registry(force: bool = False) -> dict[str, Any]:
    cached = _read_json(SCHEMES_JSON)
    today_key = date.today().isoformat()
    if cached and not force and cached.get("snapshot_date") == today_key:
        return load_scheme_registry(auto_refresh=False)
    response = requests.get(
        AMFI_NAVALL_URL,
        timeout=45,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    response.raise_for_status()
    schemes = _parse_amfi_navall(response.text)
    payload = {
        "source": "AMFI NAVAll",
        "source_url": AMFI_NAVALL_URL,
        "snapshot_date": today_key,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(schemes),
        "schemes": schemes,
    }
    _write_json(SCHEMES_JSON, payload)
    return load_scheme_registry(auto_refresh=False)


def load_scheme_registry(auto_refresh: bool = True) -> dict[str, Any]:
    cached = _read_json(SCHEMES_JSON)
    if cached:
        schemes = cached.get("schemes") or []
        cached["count"] = int(cached.get("count") or len(schemes))
        cached["scheme_map"] = {str(row.get("scheme_code")): row for row in schemes if str(row.get("scheme_code") or "")}
        return cached
    if not auto_refresh:
        return {"schemes": [], "scheme_map": {}, "count": 0}
    try:
        return refresh_scheme_registry(force=False)
    except requests.RequestException:
        return {"schemes": [], "scheme_map": {}, "count": 0}


def all_mutual_fund_symbols() -> list[str]:
    registry = load_scheme_registry(auto_refresh=True)
    schemes = registry.get("schemes") or []
    return [str(row.get("symbol") or "") for row in schemes if str(row.get("symbol") or "")]


def get_scheme_record(symbol_or_code: str | int) -> dict[str, Any] | None:
    code = scheme_code_from_symbol(symbol_or_code) if is_mutual_fund_symbol(str(symbol_or_code)) else str(symbol_or_code).strip()
    if not code:
        return None
    registry = load_scheme_registry(auto_refresh=True)
    scheme_map = registry.get("scheme_map") or {}
    row = scheme_map.get(code)
    if row:
        return row
    for item in registry.get("schemes") or []:
        if str(item.get("scheme_code")) == code:
            return item
    return None


def _days_for_timeframe(timeframe: str) -> int | None:
    mapping = {
        "1D": 30,
        "7D": 45,
        "2W": 60,
        "1M": 120,
        "3M": 180,
        "6M": 365,
        "1Y": 366,
        "2Y": 366 * 2,
        "5Y": 366 * 5,
        "10Y": 366 * 10,
        "MAX": None,
    }
    return mapping.get(str(timeframe or "").upper(), 366)


def _parse_nav_date(value: str) -> date | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    for fmt in ("%d-%m-%Y", "%d-%b-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def _normalize_nav_payload(scheme_code: str, payload: dict[str, Any]) -> dict[str, Any]:
    meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
    items = []
    for row in payload.get("data") or []:
        if not isinstance(row, dict):
            continue
        parsed_date = _parse_nav_date(str(row.get("date") or ""))
        nav_raw = row.get("nav")
        try:
            nav_value = float(nav_raw)
        except (TypeError, ValueError):
            continue
        if not parsed_date:
            continue
        items.append(
            {
                "date": parsed_date.isoformat(),
                "nav": nav_value,
            }
        )
    items.sort(key=lambda row: row["date"])
    return {
        "scheme_code": str(scheme_code).strip(),
        "symbol": mutual_fund_symbol(scheme_code),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "source": "MFapi",
        "source_url": f"{MFAPI_BASE_URL}/mf/{scheme_code}",
        "meta": {
            "fund_house": meta.get("fund_house") or "",
            "scheme_type": meta.get("scheme_type") or "",
            "scheme_category": meta.get("scheme_category") or "",
            "scheme_name": meta.get("scheme_name") or "",
            "isin_growth": meta.get("isin_growth"),
            "isin_div_reinvestment": meta.get("isin_div_reinvestment"),
        },
        "data": items,
        "count": len(items),
    }


def refresh_nav_history(symbol_or_code: str | int, force: bool = False) -> dict[str, Any]:
    code = scheme_code_from_symbol(symbol_or_code) if is_mutual_fund_symbol(str(symbol_or_code)) else str(symbol_or_code).strip()
    if not code:
        return {"scheme_code": "", "symbol": "", "data": [], "count": 0}
    path = nav_cache_path(code)
    cached = _read_json(path)
    if cached and not force:
        updated_at = str(cached.get("updated_at") or "")
        if updated_at[:10] == date.today().isoformat():
            return cached
    response = requests.get(
        f"{MFAPI_BASE_URL}/mf/{code}",
        timeout=45,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    response.raise_for_status()
    payload = _normalize_nav_payload(code, response.json())
    _write_json(path, payload)
    return payload


def load_nav_history(symbol_or_code: str | int, auto_refresh: bool = True) -> dict[str, Any]:
    code = scheme_code_from_symbol(symbol_or_code) if is_mutual_fund_symbol(str(symbol_or_code)) else str(symbol_or_code).strip()
    if not code:
        return {"scheme_code": "", "symbol": "", "data": [], "count": 0}
    cached = _read_json(nav_cache_path(code))
    if cached:
        return cached
    if not auto_refresh:
        return {"scheme_code": code, "symbol": mutual_fund_symbol(code), "data": [], "count": 0}
    try:
        return refresh_nav_history(code, force=False)
    except requests.RequestException:
        return {"scheme_code": code, "symbol": mutual_fund_symbol(code), "data": [], "count": 0}


def search_mutual_funds(query: str, limit: int = 20) -> list[dict[str, Any]]:
    q = str(query or "").strip().lower()
    if not q:
        return []
    tokens = [token for token in q.replace("-", " ").split() if token]
    q_compact = "".join(ch for ch in q if ch.isalnum())
    registry = load_scheme_registry(auto_refresh=True)
    results: list[dict[str, Any]] = []
    for row in registry.get("schemes") or []:
        symbol = str(row.get("symbol") or "")
        scheme_code = str(row.get("scheme_code") or "")
        scheme_name = str(row.get("scheme_name") or "")
        fund_house = str(row.get("fund_house") or "")
        scheme_category = str(row.get("scheme_category") or "")
        scheme_type = str(row.get("scheme_type") or "")
        scheme_name_compact = "".join(ch for ch in scheme_name.lower() if ch.isalnum())
        terms = [
            scheme_code.lower(),
            scheme_name.lower(),
            fund_house.lower(),
            scheme_category.lower(),
            scheme_type.lower(),
            str(row.get("isin_growth") or "").lower(),
            str(row.get("isin_div_reinvestment") or "").lower(),
        ]
        haystack = " ".join(term for term in terms if term)
        name_hits = sum(1 for token in tokens if token in scheme_name.lower())
        house_hits = sum(1 for token in tokens if token in fund_house.lower())
        score = 0
        if q == scheme_code.lower():
            score += 160
        elif scheme_code.lower().startswith(q):
            score += 110
        elif q in scheme_code.lower():
            score += 70
        if q == scheme_name.lower():
            score += 140
        elif scheme_name.lower().startswith(q):
            score += 95
        elif q in scheme_name.lower():
            score += 58
        if q_compact and q_compact in scheme_name_compact:
            score += 120
        if q == fund_house.lower():
            score += 90
        elif fund_house.lower().startswith(q):
            score += 55
        elif q in fund_house.lower():
            score += 24
        if q in scheme_category.lower():
            score += 18
        if q in scheme_type.lower():
            score += 12
        token_hits = sum(1 for token in tokens if token in haystack)
        if token_hits:
            score += token_hits * 16
            if tokens and all(token in haystack for token in tokens):
                score += 30
        if name_hits:
            score += name_hits * 22
            if tokens and all(token in scheme_name.lower() for token in tokens):
                score += 45
        if house_hits:
            score += house_hits * 8
        if not score and not any(q in term for term in terms if term):
            continue
        results.append(
            {
                "score": score or 10,
                "symbol": symbol,
                "name": scheme_name or symbol,
                "assetType": scheme_category or "India Mutual Fund",
                "assetFamily": "mutual_fund",
                "exchange": "AMFI",
                "region": "India",
                "isProxy": False,
                "categories": [MUTUAL_FUND_CATEGORY],
                "source": "amfi",
                "schemeCode": scheme_code,
                "fundHouse": fund_house,
            }
        )
    results.sort(key=lambda item: (-int(item["score"]), item["name"], item["symbol"]))
    trimmed = results[: max(1, int(limit))]
    for row in trimmed:
        row.pop("score", None)
    return trimmed


def _series_window(rows: list[dict[str, Any]], timeframe: str) -> list[dict[str, Any]]:
    days = _days_for_timeframe(timeframe)
    if days is None:
        return rows
    cutoff = date.today() - timedelta(days=days)
    return [row for row in rows if row["date"] >= cutoff.isoformat()]


def nav_history_as_ohlc(symbol_or_code: str | int, timeframe: str = "1Y") -> list[dict[str, Any]]:
    history = load_nav_history(symbol_or_code, auto_refresh=True)
    rows = _series_window(history.get("data") or [], timeframe)
    out = []
    for row in rows:
        nav = float(row["nav"])
        out.append(
            {
                "x": row["date"],
                "y": [nav, nav, nav, nav],
                "volume": 0,
            }
        )
    return out


def get_mutual_fund_details(symbol_or_code: str | int) -> dict[str, Any]:
    scheme = get_scheme_record(symbol_or_code)
    if not scheme:
        return {"error": "Unknown mutual fund scheme."}
    history = load_nav_history(symbol_or_code, auto_refresh=True)
    rows = history.get("data") or []
    latest = rows[-1]["nav"] if rows else float(scheme.get("latest_nav") or 0.0)
    prev = rows[-2]["nav"] if len(rows) > 1 else float(scheme.get("latest_nav") or 0.0)
    change = float(latest) - float(prev or 0.0)
    change_pct = (change / float(prev)) * 100 if prev else 0.0
    trailing_year = rows[-366:] if len(rows) > 1 else rows
    nav_values = [float(row["nav"]) for row in trailing_year]
    category = str(scheme.get("scheme_category") or "") or "India Mutual Fund"
    fund_house = str(scheme.get("fund_house") or "") or "Mutual Fund"
    scheme_code = str(scheme.get("scheme_code") or "")
    latest_date = rows[-1]["date"] if rows else str(scheme.get("latest_nav_date") or "")
    return {
        "symbol": mutual_fund_symbol(scheme_code),
        "name": scheme.get("scheme_name") or mutual_fund_symbol(scheme_code),
        "longName": scheme.get("scheme_name") or mutual_fund_symbol(scheme_code),
        "price": round(float(latest), 4),
        "prevClose": round(float(prev or latest), 4),
        "currencySymbol": "₹",
        "change": round(change, 4),
        "changePct": round(change_pct, 4),
        "marketCap": 0,
        "peRatio": "N/A",
        "high52": round(max(nav_values), 4) if nav_values else "N/A",
        "low52": round(min(nav_values), 4) if nav_values else "N/A",
        "sector": fund_house,
        "industry": category,
        "assetFamily": "mutual_fund",
        "marketRegion": "India",
        "marketExchange": "AMFI",
        "isProxy": False,
        "categories": [MUTUAL_FUND_CATEGORY],
        "categoryLabel": "India Mutual Fund",
        "website": AMFI_WEBSITE,
        "wikiUrl": "",
        "yahooUrl": f"{MFAPI_WEBSITE}/mf/{scheme_code}",
        "description": (
            f"{scheme.get('scheme_name') or mutual_fund_symbol(scheme_code)} is tracked as an India mutual fund "
            f"scheme with AMFI scheme code {scheme_code}. Historical NAV is sourced from MFapi and latest scheme "
            "coverage is sourced from AMFI."
        ),
        "news": [],
        "schemeCode": scheme_code,
        "fundHouse": fund_house,
        "schemeType": scheme.get("scheme_type") or "",
        "schemeCategory": category,
        "isinGrowth": scheme.get("isin_growth"),
        "isinDivReinvestment": scheme.get("isin_div_reinvestment"),
        "navDate": latest_date,
        "historyPoints": len(rows),
        "source": "amfi+mfapi",
    }
