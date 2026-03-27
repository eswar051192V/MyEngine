from __future__ import annotations

import io
import json
import re
import time

import pandas as pd
import requests
from pytickersymbols import PyTickerSymbols

from context.india_mutual_funds import refresh_scheme_registry
from market_universe import INDEX_PROXY_MAP

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}

# BSE JSON API expects browser-like headers; old ?flag=true URLs now redirect to HTML.
BSE_API_LIST = "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w"
# All listing groups that can contain Equity segment (aligned with BSE India API docs / unofficial clients).
BSE_EQUITY_GROUPS = (
    "A",
    "B",
    "E",
    "F",
    "FC",
    "GC",
    "I",
    "IF",
    "IP",
    "M",
    "MS",
    "MT",
    "P",
    "R",
    "T",
    "TS",
    "W",
    "X",
    "XD",
    "XT",
    "Y",
    "Z",
    "ZP",
    "ZY",
)


def _yahoo_bse_symbol(scrip_id: str, scrip_cd: str) -> str | None:
    """Map BSE row to Yahoo Finance symbol (e.g. M&M.BO)."""
    raw = (scrip_id or scrip_cd or "").strip().upper()
    if not raw:
        return None
    if not re.fullmatch(r"[A-Z0-9&\-]+", raw):
        return None
    return f"{raw}.BO"


def _dedupe(symbols: list[str]) -> list[str]:
    out = []
    seen: set[str] = set()
    for symbol in symbols:
        sym = str(symbol).strip()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        out.append(sym)
    return out


def _http_get(session: requests.Session, url: str) -> bytes:
    response = session.get(url, timeout=45)
    response.raise_for_status()
    return response.content


def get_indian_markets() -> dict[str, list[str]]:
    print("Fetching Indian markets (NSE equity + derivatives underlyings)...")
    session = requests.Session()
    session.headers.update(HEADERS)

    nse_url = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"
    nse_df = pd.read_csv(io.BytesIO(_http_get(session, nse_url)))
    nse_tickers = _dedupe([f"{ticker}.NS" for ticker in nse_df["SYMBOL"].dropna().tolist()])

    fo_url = "https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv"
    fo_df = pd.read_csv(io.BytesIO(_http_get(session, fo_url)))
    fo_df.columns = fo_df.columns.str.strip()
    raw_underlyings = _dedupe([str(v).strip() for v in fo_df["UNDERLYING"].dropna().tolist()])

    fo_index_symbols = []
    fo_stock_symbols = []
    fo_all_symbols = []
    for value in raw_underlyings:
        if value in INDEX_PROXY_MAP:
            sym = INDEX_PROXY_MAP[value]
            fo_index_symbols.append(sym)
            fo_all_symbols.append(sym)
        else:
            sym = f"{value}.NS"
            fo_stock_symbols.append(sym)
            fo_all_symbols.append(sym)

    return {
        "NSE_Equity": sorted(nse_tickers),
        "NSE_Futures_Options_Underlying": sorted(_dedupe(fo_all_symbols)),
        "NSE_Futures_Stock_Underlyings": sorted(_dedupe(fo_stock_symbols)),
        "NSE_Futures_Indices_Proxy": sorted(_dedupe(fo_index_symbols)),
    }


def get_bse_markets() -> dict[str, list[str]]:
    """Fetch all active BSE Equity listings (all groups) as Yahoo `.BO` symbols."""
    print("Fetching BSE equity list (active, all groups via BSE India API)...")
    session = requests.Session()
    session.headers.update(
        {
            **HEADERS,
            "Accept": "application/json, text/plain, */*",
            "Origin": "https://www.bseindia.com/",
            "Referer": "https://www.bseindia.com/",
        }
    )

    symbols: list[str] = []
    for group in BSE_EQUITY_GROUPS:
        params = {
            "Group": group,
            "segment": "Equity",
            "status": "Active",
            "scripcode": "",
            "industry": "",
        }
        try:
            resp = session.get(BSE_API_LIST, params=params, timeout=60)
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            print(f"  Warning: BSE API error for group {group}: {exc}")
            time.sleep(0.2)
            continue

        if isinstance(data, list):
            for item in data:
                scrip_cd = str(item.get("SCRIP_CD", "") or "").strip()
                scrip_id = str(item.get("scrip_id", "") or "").strip()
                y = _yahoo_bse_symbol(scrip_id, scrip_cd)
                if y:
                    symbols.append(y)
        else:
            print(f"  Warning: BSE API group {group}: unexpected payload type {type(data).__name__}")
        time.sleep(0.15)

    if len(symbols) < 500:
        print("  BSE API returned very few symbols; adding curated BSE-only tickers as fallback.")
        symbols.extend(
            [
                "RELIANCE.BO",
                "TCS.BO",
                "HDFCBANK.BO",
                "INFY.BO",
                "ICICIBANK.BO",
                "HINDUNILVR.BO",
                "SBIN.BO",
                "BHARTIARTL.BO",
                "KOTAKBANK.BO",
                "ITC.BO",
                "LT.BO",
                "AXISBANK.BO",
                "BAJFINANCE.BO",
                "MARUTI.BO",
                "HCLTECH.BO",
                "ASIANPAINT.BO",
                "SUNPHARMA.BO",
                "TATAMOTORS.BO",
                "WIPRO.BO",
                "NTPC.BO",
                "TITAN.BO",
                "ULTRACEMCO.BO",
                "TECHM.BO",
                "POWERGRID.BO",
                "ONGC.BO",
                "NESTLEIND.BO",
                "BAJAJFINSV.BO",
                "ADANIENT.BO",
                "ADANIPORTS.BO",
                "JSWSTEEL.BO",
            ]
        )

    deduped = _dedupe(sorted(symbols))
    print(f"  BSE equity: {len(deduped)} symbols")
    return {"BSE_Equity": deduped}


def get_nse_index_options() -> dict[str, list[str]]:
    """Return Yahoo symbols for NSE indices with active options trading."""
    print("Adding NSE index options symbols...")
    return {
        "NSE_Index_Options": _dedupe([
            "^NSEI",       # Nifty 50
            "^NSEBANK",    # Bank Nifty
            "^CNXFIN",     # Fin Nifty
            "^NSEMDCP50",  # Nifty Midcap 50
            "^NSMIDCP",    # Nifty Next 50
            "^CNXIT",      # Nifty IT
            "^CNXPHARMA",  # Nifty Pharma
            "^CNXAUTO",    # Nifty Auto
            "^CNXMETAL",   # Nifty Metal
            "^CNXENERGY",  # Nifty Energy
            "^CNXREALTY",  # Nifty Realty
            "^CNXPSUBANK", # Nifty PSU Bank
            "^CNXINFRA",   # Nifty Infra
        ])
    }


def get_us_markets() -> dict[str, list[str]]:
    print("Fetching US markets (Dow, S&P 500, Nasdaq 100)...")

    dow_html = requests.get(
        "https://en.wikipedia.org/wiki/Dow_Jones_Industrial_Average",
        headers=HEADERS,
        timeout=45,
    ).text
    dow_df = pd.read_html(io.StringIO(dow_html), attrs={"id": "constituents"})[0]

    sp_html = requests.get(
        "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
        headers=HEADERS,
        timeout=45,
    ).text
    sp_df = pd.read_html(io.StringIO(sp_html), attrs={"id": "constituents"})[0]

    nasdaq_html = requests.get(
        "https://en.wikipedia.org/wiki/Nasdaq-100",
        headers=HEADERS,
        timeout=45,
    ).text
    nasdaq_df = pd.read_html(io.StringIO(nasdaq_html), attrs={"id": "constituents"})[0]

    return {
        "DOW": _dedupe(dow_df["Symbol"].dropna().astype(str).tolist()),
        "NASDAQ_100": _dedupe(nasdaq_df["Ticker"].dropna().astype(str).tolist()),
        "SP_500": _dedupe(sp_df["Symbol"].dropna().astype(str).tolist()),
    }


def get_global_markets() -> dict[str, list[str]]:
    print("Fetching global equity universes (FTSE, Nikkei, Hang Seng, DAX)...")
    stock_data = PyTickerSymbols()
    return {
        "LSE_FTSE100": _dedupe([stock["symbol"] for stock in stock_data.get_stocks_by_index("FTSE 100")]),
        "Tokyo_Nikkei225": _dedupe([stock["symbol"] for stock in stock_data.get_stocks_by_index("NIKKEI 225")]),
        "HangSeng": _dedupe([stock["symbol"] for stock in stock_data.get_stocks_by_index("HANG SENG")]),
        "Germany_DAX": _dedupe([stock["symbol"] for stock in stock_data.get_stocks_by_index("DAX")]),
    }


def get_currencies() -> dict[str, list[str]]:
    print("Building broader forex coverage...")
    return {
        "Global_Forex_Majors": _dedupe(
            [
                "EURUSD=X",
                "GBPUSD=X",
                "AUDUSD=X",
                "NZDUSD=X",
                "USDJPY=X",
                "USDCHF=X",
                "USDCAD=X",
            ]
        ),
        "Global_Forex_Crosses": _dedupe(
            [
                "EURJPY=X",
                "GBPJPY=X",
                "EURGBP=X",
                "EURCHF=X",
                "AUDJPY=X",
                "AUDNZD=X",
                "GBPCHF=X",
                "EURAUD=X",
            ]
        ),
        "Asia_Forex_USD_Pairs": _dedupe(
            [
                "USDINR=X",
                "USDCNY=X",
                "USDHKD=X",
                "USDSGD=X",
                "USDKRW=X",
                "USDIDR=X",
                "USDTHB=X",
                "USDPHP=X",
            ]
        ),
        "INR_Forex_Pairs": _dedupe(
            [
                "USDINR=X",
                "EURINR=X",
                "GBPINR=X",
                "JPYINR=X",
                "AUDINR=X",
                "CADINR=X",
                "CHFINR=X",
                "SGDINR=X",
            ]
        ),
    }


def get_commodities() -> dict[str, list[str]]:
    print("Building broader commodity and India proxy coverage...")
    return {
        "Precious_Metals_Futures": _dedupe(["GC=F", "SI=F", "PL=F", "PA=F"]),
        "Energy_Futures": _dedupe(["CL=F", "BZ=F", "NG=F", "RB=F", "HO=F"]),
        "Base_Metals_Futures": _dedupe(["HG=F", "ALI=F"]),
        "Agriculture_Grains_Futures": _dedupe(["ZC=F", "ZW=F", "ZS=F", "ZM=F", "ZL=F", "KE=F"]),
        "Softs_Futures": _dedupe(["KC=F", "SB=F", "CC=F", "CT=F", "OJ=F"]),
        "Livestock_Futures": _dedupe(["LE=F", "HE=F", "GF=F"]),
        "Indian_MCX_Proxy_PreciousMetals": _dedupe(["GC=F", "SI=F", "PL=F"]),
        "Indian_MCX_Proxy_Energy": _dedupe(["CL=F", "BZ=F", "NG=F", "RB=F"]),
        "Indian_MCX_Proxy_BaseMetals": _dedupe(["HG=F", "ALI=F"]),
    }


def main() -> None:
    print("Starting master ticker aggregation...")
    master_ticker_dict: dict[str, list[str]] = {}
    master_ticker_dict.update(get_indian_markets())
    master_ticker_dict.update(get_bse_markets())
    master_ticker_dict.update(get_nse_index_options())
    master_ticker_dict.update(get_us_markets())
    master_ticker_dict.update(get_global_markets())
    master_ticker_dict.update(get_currencies())
    master_ticker_dict.update(get_commodities())

    output_file = "all_global_tickers.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(master_ticker_dict, f, indent=2, ensure_ascii=False)

    print(f"Saved comprehensive market universe to {output_file}.")
    try:
        registry = refresh_scheme_registry(force=True)
        print(f"Saved {registry.get('count', 0)} AMFI mutual fund schemes to context_data/india_mutual_funds/schemes.json.")
    except requests.RequestException as exc:
        print(f"Warning: failed to refresh AMFI mutual fund registry: {exc}")


if __name__ == "__main__":
    main()