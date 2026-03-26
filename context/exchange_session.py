"""
Trading-session helpers: exchange calendars (when available) plus country holiday fallbacks.
Used by the scheduler and market_universe.is_market_open.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

from market_universe import EXCHANGE_SCHEDULE

try:
    import exchange_calendars as xcals
except ImportError:
    xcals = None

try:
    import holidays
except ImportError:
    holidays = None

# exchange_calendars registry keys (see `exchange_calendars.get_calendar_names()`).
EXCHANGE_CALENDAR_KEY: dict[str, str] = {
    "NSE": "XBOM",
    "BSE": "XBOM",
    "AMFI": "XBOM",
    "MCX Proxy": "XBOM",
    "NYSE": "XNYS",
    "NASDAQ": "XNAS",
    "FX": "XNYS",
    "COMEX": "COMEX",
    "NYMEX": "NYMEX",
    "CME": "CME",
    "ICE": "ICE",
    "CBOT": "CBOT",
    "COMEX/LME": "XLON",
}

# When the exchange calendar is missing or the date is outside its supported range, use country holidays + weekends.
EXCHANGE_COUNTRY_FALLBACK: dict[str, str] = {
    "NSE": "IN",
    "BSE": "IN",
    "AMFI": "IN",
    "MCX Proxy": "IN",
    "NYSE": "US",
    "NASDAQ": "US",
    "FX": "US",
    "COMEX": "US",
    "NYMEX": "US",
    "CME": "US",
    "ICE": "US",
    "CBOT": "US",
    "COMEX/LME": "GB",
}


def _local_date_for_exchange(exchange: str, now: datetime | None) -> date:
    cfg = EXCHANGE_SCHEDULE.get(exchange) or {}
    tz = ZoneInfo(str(cfg.get("tz") or "UTC"))
    dt = now.astimezone(tz) if now else datetime.now(tz)
    return dt.date()


def _is_weekend(d: date) -> bool:
    return d.weekday() >= 5


def _calendar_is_session(calendar_name: str, d: date) -> bool | None:
    if xcals is None:
        return None
    try:
        cal = xcals.get_calendar(calendar_name)
        first = cal.first_session
        last = cal.last_session
        first_d = first.date() if hasattr(first, "date") else pd.Timestamp(first).date()
        last_d = last.date() if hasattr(last, "date") else pd.Timestamp(last).date()
        if d < first_d or d > last_d:
            return None
        ts = pd.Timestamp(d)
        return bool(cal.is_session(ts))
    except Exception:
        return None


def _country_is_trading_day(country: str, d: date) -> bool:
    if _is_weekend(d):
        return False
    if holidays is None:
        return True
    c = country.upper()
    if c == "IN":
        cal = holidays.IN()
    elif c == "US":
        cal = holidays.US()
    elif c in ("GB", "UK"):
        cal = holidays.UK()
    else:
        return True
    return d not in cal


def is_exchange_trading_day(exchange: str, now: datetime | None = None) -> bool:
    """
    True if the exchange has a regular session on this local calendar date (not weekend/holiday).
    Uses exchange_calendars when the date is within the calendar's supported range; otherwise
    country public holidays (holidays package), then weekdays-only if holidays is unavailable.
    """
    ex = str(exchange or "").strip()
    if not ex:
        return True
    d = _local_date_for_exchange(ex, now)
    if _is_weekend(d):
        return False
    cal_name = EXCHANGE_CALENDAR_KEY.get(ex)
    if cal_name:
        session = _calendar_is_session(cal_name, d)
        if session is not None:
            return session
    country = EXCHANGE_COUNTRY_FALLBACK.get(ex)
    if country:
        return _country_is_trading_day(country, d)
    return True


def exchange_session_debug(exchange: str, now: datetime | None = None) -> dict[str, Any]:
    ex = str(exchange or "").strip()
    d = _local_date_for_exchange(ex, now)
    cal_name = EXCHANGE_CALENDAR_KEY.get(ex)
    session = _calendar_is_session(cal_name, d) if cal_name else None
    country = EXCHANGE_COUNTRY_FALLBACK.get(ex)
    return {
        "exchange": ex,
        "localDate": d.isoformat(),
        "calendar": cal_name,
        "calendarSession": session,
        "countryFallback": country,
    }
