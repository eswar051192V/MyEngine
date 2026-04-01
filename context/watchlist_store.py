from __future__ import annotations

import json
import os

from context.portfolio_ledger import clean_portfolios

SETTINGS_PATH = os.environ.get("USER_SETTINGS_PATH", "user_settings.json")
DEFAULT_PORTFOLIO_NAME = "Main"


def _default_settings() -> dict:
    return {"last_viewed": "", "watchlist": [], "portfolios": {DEFAULT_PORTFOLIO_NAME: []}}


def _as_string(value, default: str = "") -> str:
    if value is None:
        return default
    return str(value).strip()


def _as_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _clean_portfolios(portfolios: dict | None) -> dict[str, list[dict]]:
    return clean_portfolios(portfolios)


def load_settings() -> dict:
    if not os.path.exists(SETTINGS_PATH):
        return _default_settings()
    with open(SETTINGS_PATH, encoding="utf-8") as f:
        data = json.load(f)
    if "watchlist" not in data:
        data["watchlist"] = []
    if "portfolios" not in data:
        data["portfolios"] = {DEFAULT_PORTFOLIO_NAME: []}
    data["portfolios"] = _clean_portfolios(data.get("portfolios"))
    return data


def save_settings(data: dict) -> None:
    with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def get_watchlist() -> list[str]:
    wl = load_settings().get("watchlist") or []
    return [str(s).strip() for s in wl if str(s).strip()]


def set_watchlist(symbols: list[str]) -> list[str]:
    data = load_settings()
    clean = []
    seen: set[str] = set()
    for s in symbols:
        u = str(s).strip()
        if u and u not in seen:
            seen.add(u)
            clean.append(u)
    data["watchlist"] = clean[:100]
    save_settings(data)
    return clean


def get_portfolios() -> dict[str, list[dict]]:
    portfolios = load_settings().get("portfolios") or {}
    return _clean_portfolios(portfolios)


def set_portfolios(portfolios: dict | None) -> dict[str, list[dict]]:
    data = load_settings()
    data["portfolios"] = _clean_portfolios(portfolios)
    save_settings(data)
    return data["portfolios"]
