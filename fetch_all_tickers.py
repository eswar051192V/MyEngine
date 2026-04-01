from __future__ import annotations

import io
import json
import zipfile

import pandas as pd
import requests

try:
    from pytickersymbols import PyTickerSymbols
except ImportError:
    PyTickerSymbols = None  # type: ignore
    print("Warning: pytickersymbols not installed — global equity indexes will use fallback lists.")

try:
    from bsedata.bse import BSE as BseDataLib
except ImportError:
    BseDataLib = None  # type: ignore

from context.india_mutual_funds import refresh_scheme_registry
from market_universe import INDEX_PROXY_MAP

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}


# ---------------------------------------------------------------------------
# ENRICHED TICKER FORMAT
# ---------------------------------------------------------------------------
# Each ticker is stored as {"s": "SYMBOL", "n": "Display Name"}
# This allows the frontend to show names immediately without fetching each one.

def _t(symbol: str, name: str = "") -> dict:
    """Create an enriched ticker entry."""
    return {"s": symbol.strip(), "n": (name or symbol).strip()}


def _dedupe_enriched(items: list[dict]) -> list[dict]:
    """Deduplicate enriched ticker items by symbol."""
    out = []
    seen: set[str] = set()
    for item in items:
        sym = item["s"].strip()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        out.append(item)
    return out


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


def _load_existing() -> dict:
    """Load existing ticker JSON for fallback."""
    try:
        with open("all_global_tickers.json", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _extract_symbols_from_existing(existing: dict, category: str) -> list[dict]:
    """Extract enriched ticker list from existing JSON (handles both old and new formats)."""
    items = existing.get(category, [])
    if not items:
        return []
    if isinstance(items[0], dict):
        return items  # already enriched
    return [_t(s) for s in items]  # old format, wrap as enriched


# ---------------------------------------------------------------------------
# INDIAN MARKETS
# ---------------------------------------------------------------------------

def get_indian_markets() -> dict[str, list[dict]]:
    """NSE equity + F&O underlyings with names."""
    print("Fetching Indian markets (NSE equity + derivatives underlyings)...")
    session = requests.Session()
    session.headers.update(HEADERS)

    # --- NSE Equity ---
    nse_tickers: list[dict] = []
    try:
        nse_url = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"
        nse_df = pd.read_csv(io.BytesIO(_http_get(session, nse_url)))
        # Normalize column names: strip whitespace, uppercase
        nse_df.columns = [c.strip() for c in nse_df.columns]
        # Find the symbol and name columns flexibly
        sym_col = None
        name_col = None
        for c in nse_df.columns:
            cu = c.upper()
            if cu == "SYMBOL" and sym_col is None:
                sym_col = c
            if "NAME" in cu and ("COMPANY" in cu or "ISSUER" in cu or "SECURITY" in cu):
                name_col = c
            if cu == "NAME OF COMPANY":
                name_col = c
        if sym_col is None:
            sym_col = nse_df.columns[0]  # fallback to first column
        if name_col is None:
            # Try second column or any column with "name" in it
            for c in nse_df.columns:
                if "name" in c.lower():
                    name_col = c
                    break
            if name_col is None and len(nse_df.columns) > 1:
                name_col = nse_df.columns[1]
        print(f"  NSE CSV columns: {list(nse_df.columns)}")
        print(f"  Using sym_col={sym_col!r}, name_col={name_col!r}")
        for _, row in nse_df.iterrows():
            sym = str(row.get(sym_col, "")).strip()
            name = str(row.get(name_col, "") if name_col else "").strip() if name_col else ""
            if sym and sym != "nan":
                nse_tickers.append(_t(f"{sym}.NS", name if (name and name != "nan") else sym))
        nse_tickers = _dedupe_enriched(nse_tickers)
        names_found = sum(1 for t in nse_tickers if t["n"] != t["s"])
        print(f"  NSE equity: {len(nse_tickers)} tickers fetched live ({names_found} with names)")
    except Exception as exc:
        print(f"  NSE equity fetch failed ({exc}), loading from existing JSON fallback...")
        existing = _load_existing()
        nse_tickers = _extract_symbols_from_existing(existing, "NSE_Equity")
        print(f"  NSE equity fallback: {len(nse_tickers)} tickers from existing file")

    # --- F&O Underlyings ---
    fo_index_symbols: list[dict] = []
    fo_stock_symbols: list[dict] = []
    fo_all_symbols: list[dict] = []
    try:
        fo_url = "https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv"
        fo_df = pd.read_csv(io.BytesIO(_http_get(session, fo_url)))
        fo_df.columns = fo_df.columns.str.strip()

        # The F&O CSV has SYMBOL column (ticker) and UNDERLYING column (full name)
        # Try to use SYMBOL if available, otherwise parse UNDERLYING
        has_symbol_col = "SYMBOL" in fo_df.columns

        seen_fo: set[str] = set()
        for _, row in fo_df.iterrows():
            if has_symbol_col:
                raw_sym = str(row.get("SYMBOL", "")).strip()
                raw_name = str(row.get("UNDERLYING", "") or raw_sym).strip()
            else:
                raw_name = str(row.get("UNDERLYING", "")).strip()
                raw_sym = raw_name  # will be processed below

            if not raw_sym or raw_sym in seen_fo:
                continue
            seen_fo.add(raw_sym)

            if raw_sym in INDEX_PROXY_MAP:
                sym = INDEX_PROXY_MAP[raw_sym]
                entry = _t(sym, raw_name)
                fo_index_symbols.append(entry)
                fo_all_symbols.append(entry)
            elif raw_name in INDEX_PROXY_MAP:
                sym = INDEX_PROXY_MAP[raw_name]
                entry = _t(sym, raw_name)
                fo_index_symbols.append(entry)
                fo_all_symbols.append(entry)
            else:
                # If the raw_sym looks like a full name (has spaces), skip — it's not a valid symbol
                if " " in raw_sym and has_symbol_col:
                    continue
                elif " " in raw_sym:
                    # UNDERLYING column only — try to match with NSE equity list
                    continue
                sym = f"{raw_sym}.NS"
                entry = _t(sym, raw_name if raw_name != raw_sym else "")
                fo_stock_symbols.append(entry)
                fo_all_symbols.append(entry)

        print(f"  NSE F&O: {len(fo_all_symbols)} underlyings fetched live")
    except Exception as exc:
        print(f"  NSE F&O fetch failed ({exc}), loading from existing JSON fallback...")
        existing = _load_existing()
        fo_all_symbols = _extract_symbols_from_existing(existing, "NSE_Futures_Options_Underlying")
        fo_stock_symbols = _extract_symbols_from_existing(existing, "NSE_Futures_Stock_Underlyings")
        fo_index_symbols = _extract_symbols_from_existing(existing, "NSE_Futures_Indices_Proxy")
        print(f"  NSE F&O fallback: {len(fo_all_symbols)} underlyings from existing file")

    return {
        "NSE_Equity": sorted(nse_tickers, key=lambda x: x["s"]),
        "NSE_Futures_Options_Underlying": sorted(_dedupe_enriched(fo_all_symbols), key=lambda x: x["s"]),
        "NSE_Futures_Stock_Underlyings": sorted(_dedupe_enriched(fo_stock_symbols), key=lambda x: x["s"]),
        "NSE_Futures_Indices_Proxy": sorted(_dedupe_enriched(fo_index_symbols), key=lambda x: x["s"]),
    }


# ---------------------------------------------------------------------------
# BSE MARKETS — COMPREHENSIVE
# ---------------------------------------------------------------------------

# Expanded BSE fallback: top ~200 companies by market cap (deduplicated)
BSE_FALLBACK = [
    ("500325", "Reliance Industries"), ("532540", "TCS"), ("500180", "HDFC Bank"),
    ("532174", "ICICI Bank"), ("500209", "Infosys"), ("500112", "State Bank of India"),
    ("532454", "Bharti Airtel"), ("500510", "Larsen & Toubro"), ("500247", "Kotak Mahindra Bank"),
    ("532215", "Axis Bank"), ("500696", "Hindustan Unilever"), ("500875", "ITC"),
    ("500312", "ONGC"), ("500790", "Nestle India"), ("532187", "Bajaj Finance"),
    ("533278", "Power Grid Corporation"), ("500570", "Tata Motors"), ("532978", "Bajaj Finserv"),
    ("500124", "Dr Reddys Laboratories"), ("539448", "HDFC Life Insurance"),
    ("500470", "Tata Steel"), ("500010", "HDFC"), ("500830", "Colgate-Palmolive"),
    ("532977", "Bajaj Auto"), ("500034", "Bajaj Holdings"), ("500182", "Hero MotoCorp"),
    ("532500", "Maruti Suzuki"), ("500295", "Mahindra & Mahindra"), ("500249", "ICICI Lombard"),
    ("507685", "Wipro"), ("500103", "Bharat Heavy Electricals"), ("500087", "Cipla"),
    ("500440", "Hindalco Industries"), ("500520", "Mahindra & Mahindra Financial"),
    ("500085", "Chambal Fertilisers"), ("532921", "Adani Green Energy"),
    ("500483", "Ambuja Cements"), ("532281", "HCL Technologies"),
    ("532286", "Jindal Steel & Power"), ("500228", "Glenmark Pharmaceuticals"),
    ("500260", "Indraprastha Gas"), ("532424", "Godrej Consumer Products"),
    ("500670", "Gujarat Narmada Valley Fertilizers"), ("500188", "Hindustan Zinc"),
    ("500820", "Asian Paints"), ("532538", "Ultratech Cement"),
    ("524715", "Sun Pharmaceutical Industries"), ("532898", "Power Finance Corporation"),
    ("532461", "Adani Enterprises"), ("532155", "Gail India"), ("500390", "Pidilite Industries"),
    ("517334", "JSW Steel"), ("500550", "Siemens"), ("532210", "City Union Bank"),
    ("500413", "Apollo Hospitals"), ("500840", "Indian Hotels"),
    ("532555", "NTPC"), ("500630", "Punjab National Bank"),
    ("532839", "Divis Laboratories"), ("500770", "Tata Chemicals"),
    ("532754", "Cadila Healthcare"), ("500300", "Grasim Industries"),
    ("532648", "UPL"), ("500490", "Shree Cement"),
    ("500271", "Indian Oil Corporation"), ("500680", "Vedanta"), ("540719", "HDFC AMC"),
    ("543257", "Life Insurance Corporation"), ("543396", "Zomato"),
    ("543320", "One 97 Communications (Paytm)"), ("543066", "Nykaa (FSN E-Commerce)"),
    ("541153", "IRCTC"), ("543232", "Adani Wilmar"), ("540376", "Bandhan Bank"),
    ("543242", "Adani Power"), ("543272", "Delhivery"), ("540115", "Dixon Technologies"),
    ("543986", "Mankind Pharma"), ("532531", "Ashok Leyland"), ("500400", "Tata Power"),
    ("532129", "Container Corp of India"), ("500116", "IDBI Bank"), ("500940", "Federal Bank"),
    ("500257", "Lupin"), ("500002", "ABB India"), ("532504", "Bank of Baroda"),
    ("500355", "Rallis India"), ("500164", "Cummins India"),
    ("539876", "ICICI Prudential Life"), ("500408", "Tata Steel BSL"),
    ("524208", "Biocon"), ("530965", "Indian Oil Corporation"), ("500410", "ACC"),
    ("532374", "Sterling & Wilson Renewable"), ("500720", "Torrent Power"),
    ("532149", "Britannia Industries"), ("500480", "Canara Bank"),
    ("541557", "SBI Cards & Payment"), ("540065", "Indigo Paints"),
    ("500331", "Berger Paints"), ("532345", "Godrej Properties"),
    ("540005", "Avenue Supermarts (DMart)"), ("539957", "Apollo Tyres"),
    ("532144", "Mphasis"), ("540777", "SBI Life Insurance"),
    ("531500", "Havells India"), ("521016", "Blue Star"), ("532822", "Titan Company"),
    ("502820", "PI Industries"), ("523395", "Astral"), ("500235", "LIC Housing Finance"),
    ("500096", "Dabur India"), ("539437", "Max Financial Services"),
    ("500459", "Crompton Greaves Consumer"), ("505537", "Minda Industries"),
    ("500241", "IDFC First Bank"), ("541179", "Varun Beverages"),
    ("500179", "Exide Industries"), ("543910", "CG Power & Industrial Solutions"),
    ("500049", "Bharat Forge"), ("505200", "Eicher Motors"),
    ("524280", "Aditya Birla Sun Life AMC"), ("540691", "Bharat Electronics"),
    ("500870", "Oil India"), ("500003", "Aegis Logistics"),
    ("543362", "AU Small Finance Bank"), ("543218", "Happiest Minds Technologies"),
    ("530999", "Balrampur Chini Mills"), ("500302", "Kansai Nerolac Paints"),
    ("519552", "Mahanagar Gas"), ("532273", "Cyient"), ("532488", "Indus Towers"),
    ("500650", "Supreme Industries"), ("500185", "Voltas"), ("540222", "Aarti Industries"),
    ("541154", "HAL (Hindustan Aeronautics)"), ("500214", "JK Cement"),
    ("541450", "Coal India"), ("500147", "National Aluminium Company"),
    ("523367", "Sundram Fasteners"), ("532628", "MRF"), ("543940", "JSW Infrastructure"),
    ("540124", "Star Health Insurance"), ("543235", "Go Digit General Insurance"),
    ("538835", "Page Industries"), ("543246", "Nuvoco Vistas Corporation"),
    ("542066", "Persistent Systems"), ("542652", "Indian Railway Finance Corp"),
    ("540153", "Cholamandalam Investment & Finance"),
    ("543985", "Samvardhana Motherson International"), ("500530", "Bosch"),
    ("500387", "Shriram Finance"), ("500100", "Bharat Electronics"),
    ("541988", "Max Healthcare Institute"), ("500425", "Ambuja Cements (New)"),
    ("500900", "Sterlite Technologies"), ("532374", "Sterling & Wilson"),
    ("500226", "Grasim Industries"), ("539874", "Polycab India"),
    ("543904", "Jio Financial Services"), ("500680", "Vedanta"),
    ("532898", "PFC"), ("543259", "Adani Total Gas"),
    ("532898", "Power Finance Corp"), ("500770", "Tata Chemicals"),
    ("543287", "Adani Green Energy"), ("500034", "Bajaj Holdings"),
    ("543229", "Adani Transmission"), ("500010", "HDFC"),
    ("543526", "Global Health (Medanta)"), ("543654", "Tega Industries"),
    ("543330", "Syrma SGS Technology"), ("500575", "Torrent Pharmaceuticals"),
    ("500800", "Tata Consultancy Services"), ("543401", "Delhivery"),
]


def _extract_bse_scrip(item: dict) -> tuple[str, str]:
    """Extract scrip code and name from a BSE API response item."""
    lower = {k.lower().strip(): v for k, v in item.items()}
    scrip = str(lower.get("scrip_cd", "") or lower.get("scripcode", "") or lower.get("scrip_code", "") or lower.get("sc_code", "") or "").strip()
    name = str(
        lower.get("scrip_name", "") or lower.get("scripname", "")
        or lower.get("long_name", "") or lower.get("longname", "")
        or lower.get("security_name", "") or lower.get("companyname", "")
        or lower.get("company_name", "") or lower.get("sc_name", "") or ""
    ).strip()
    return scrip, name


def get_bse_markets() -> dict[str, list[dict]]:
    """BSE-listed equities — tries multiple sources."""
    print("Fetching BSE equity listings...")
    session = requests.Session()
    session.headers.update(HEADERS)

    # --- Approach 1: bsedata Python library ---
    if BseDataLib is not None:
        try:
            bse_lib = BseDataLib()
            scrip_codes = bse_lib.getScripCodes()  # returns {code: name} dict
            if isinstance(scrip_codes, dict) and len(scrip_codes) > 100:
                bse_tickers = [_t(f"{code}.BO", name) for code, name in scrip_codes.items() if str(code).strip()]
                bse_tickers = _dedupe_enriched(bse_tickers)
                print(f"  BSE via bsedata library: {len(bse_tickers)} equities (with names)")
                return {"BSE_Equity": sorted(bse_tickers, key=lambda x: x["s"])}
        except Exception as exc:
            print(f"  BSE bsedata library failed ({exc})")

    # --- Approach 2: BSE Bhav Copy / equity list CSV ---
    bhav_urls = [
        "https://www.bseindia.com/corporates/List_Scrips.aspx?expandable=1",
        "https://www.bseindia.com/download/BhavCopy/eq_isincode.zip",
    ]
    for bhav_url in bhav_urls:
        try:
            resp = session.get(bhav_url, timeout=45)
            resp.raise_for_status()
            content = resp.content
            # Check if it's a zip file
            if content[:2] == b'PK':
                with zipfile.ZipFile(io.BytesIO(content)) as zf:
                    csv_name = [n for n in zf.namelist() if n.endswith('.csv') or n.endswith('.CSV')]
                    if csv_name:
                        df = pd.read_csv(zf.open(csv_name[0]))
                        df.columns = [c.strip() for c in df.columns]
                        bse_tickers = []
                        for _, row in df.iterrows():
                            scrip, name = _extract_bse_scrip(dict(row))
                            if scrip and scrip.isdigit():
                                bse_tickers.append(_t(f"{scrip}.BO", name or scrip))
                        bse_tickers = _dedupe_enriched(bse_tickers)
                        if len(bse_tickers) > 100:
                            print(f"  BSE from Bhav Copy: {len(bse_tickers)} equities")
                            return {"BSE_Equity": sorted(bse_tickers, key=lambda x: x["s"])}
        except Exception as exc:
            print(f"  BSE Bhav Copy failed ({exc})")

    # --- Approach 3: BSE API endpoints ---
    bse_urls = [
        "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Group=&Atea=&segment=Equity&status=Active",
        "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Group=A&Atea=&segment=Equity&status=Active",
    ]
    for url_idx, bse_url in enumerate(bse_urls):
        try:
            resp = session.get(bse_url, timeout=45)
            resp.raise_for_status()
            # Check if response is JSON (not HTML/CAPTCHA)
            content_type = resp.headers.get("content-type", "")
            if "html" in content_type.lower():
                print(f"  BSE API #{url_idx + 1}: got HTML (CAPTCHA/block page), skipping...")
                continue
            data = resp.json()
            if isinstance(data, dict):
                for key in ["Table", "table", "Data", "data"]:
                    if key in data and isinstance(data[key], list):
                        data = data[key]
                        break
            if isinstance(data, list) and len(data) > 10:
                bse_tickers = []
                for item in data:
                    if not isinstance(item, dict):
                        continue
                    scrip, name = _extract_bse_scrip(item)
                    if scrip and scrip.isdigit():
                        bse_tickers.append(_t(f"{scrip}.BO", name or scrip))
                bse_tickers = _dedupe_enriched(bse_tickers)
                if len(bse_tickers) > 20:
                    print(f"  BSE API #{url_idx + 1}: {len(bse_tickers)} equities")
                    return {"BSE_Equity": sorted(bse_tickers, key=lambda x: x["s"])}
        except Exception as exc:
            print(f"  BSE API #{url_idx + 1} failed ({exc})")

    # --- Approach 4: Existing JSON fallback ---
    existing = _load_existing()
    existing_bse = _extract_symbols_from_existing(existing, "BSE_Equity")
    if len(existing_bse) > 50:
        print(f"  BSE fallback from existing JSON: {len(existing_bse)} tickers")
        return {"BSE_Equity": existing_bse}

    # --- Approach 5: Hardcoded BSE large/mid-cap list ---
    print(f"  BSE using hardcoded fallback: ~{len(BSE_FALLBACK)} large/mid-cap companies")
    seen: set[str] = set()
    bse_tickers = []
    for scrip, name in BSE_FALLBACK:
        sym = f"{scrip}.BO"
        if sym not in seen:
            seen.add(sym)
            bse_tickers.append(_t(sym, name))
    return {"BSE_Equity": sorted(bse_tickers, key=lambda x: x["s"])}


def get_indian_indices() -> dict[str, list[dict]]:
    """Major Indian market indices tracked on Yahoo Finance."""
    print("Building Indian index tickers...")
    return {
        "India_Indices": _dedupe_enriched([
            _t("^NSEI", "Nifty 50"),
            _t("^BSESN", "BSE Sensex"),
            _t("^NSEBANK", "Nifty Bank"),
            _t("^CNXFIN", "Nifty Financial Services"),
            _t("^NSEMDCP50", "Nifty Midcap 50"),
            _t("^CNXIT", "Nifty IT"),
            _t("^CNXPHARMA", "Nifty Pharma"),
            _t("^CNXAUTO", "Nifty Auto"),
            _t("^CNXREALTY", "Nifty Realty"),
            _t("^CNXMETAL", "Nifty Metal"),
            _t("^CNXENERGY", "Nifty Energy"),
            _t("^CNXFMCG", "Nifty FMCG"),
            _t("^CNXPSUBANK", "Nifty PSU Bank"),
            _t("^CNXMEDIA", "Nifty Media"),
            _t("^CNXINFRA", "Nifty Infra"),
            _t("^CNXSERVICE", "Nifty Services Sector"),
            _t("NIFTY_FIN_SERVICE.NS", "Nifty Financial Services (Alternate)"),
        ]),
        "India_Nifty50_Constituents": _dedupe_enriched([
            _t("RELIANCE.NS", "Reliance Industries"), _t("TCS.NS", "Tata Consultancy Services"),
            _t("HDFCBANK.NS", "HDFC Bank"), _t("INFY.NS", "Infosys"),
            _t("ICICIBANK.NS", "ICICI Bank"), _t("HINDUNILVR.NS", "Hindustan Unilever"),
            _t("ITC.NS", "ITC Limited"), _t("SBIN.NS", "State Bank of India"),
            _t("BHARTIARTL.NS", "Bharti Airtel"), _t("KOTAKBANK.NS", "Kotak Mahindra Bank"),
            _t("LT.NS", "Larsen & Toubro"), _t("AXISBANK.NS", "Axis Bank"),
            _t("ASIANPAINT.NS", "Asian Paints"), _t("MARUTI.NS", "Maruti Suzuki"),
            _t("TITAN.NS", "Titan Company"), _t("SUNPHARMA.NS", "Sun Pharmaceutical"),
            _t("BAJFINANCE.NS", "Bajaj Finance"), _t("HCLTECH.NS", "HCL Technologies"),
            _t("TATAMOTORS.NS", "Tata Motors"), _t("NTPC.NS", "NTPC Limited"),
            _t("WIPRO.NS", "Wipro"), _t("M&M.NS", "Mahindra & Mahindra"),
            _t("ONGC.NS", "Oil & Natural Gas Corporation"), _t("ULTRACEMCO.NS", "UltraTech Cement"),
            _t("ADANIPORTS.NS", "Adani Ports & SEZ"), _t("ADANIENT.NS", "Adani Enterprises"),
            _t("POWERGRID.NS", "Power Grid Corporation"), _t("NESTLEIND.NS", "Nestle India"),
            _t("JSWSTEEL.NS", "JSW Steel"), _t("TATASTEEL.NS", "Tata Steel"),
            _t("INDUSINDBK.NS", "IndusInd Bank"), _t("BAJAJFINSV.NS", "Bajaj Finserv"),
            _t("TECHM.NS", "Tech Mahindra"), _t("HDFCLIFE.NS", "HDFC Life Insurance"),
            _t("DIVISLAB.NS", "Divi's Laboratories"), _t("GRASIM.NS", "Grasim Industries"),
            _t("CIPLA.NS", "Cipla"), _t("DRREDDY.NS", "Dr. Reddy's Laboratories"),
            _t("APOLLOHOSP.NS", "Apollo Hospitals"), _t("EICHERMOT.NS", "Eicher Motors"),
            _t("BPCL.NS", "Bharat Petroleum"), _t("COALINDIA.NS", "Coal India"),
            _t("HEROMOTOCO.NS", "Hero MotoCorp"), _t("SBILIFE.NS", "SBI Life Insurance"),
            _t("BRITANNIA.NS", "Britannia Industries"), _t("TATACONSUM.NS", "Tata Consumer Products"),
            _t("BAJAJ-AUTO.NS", "Bajaj Auto"), _t("HINDALCO.NS", "Hindalco Industries"),
            _t("LTIM.NS", "LTIMindtree"), _t("SHRIRAMFIN.NS", "Shriram Finance"),
        ]),
    }


def get_indian_etfs() -> dict[str, list[dict]]:
    """Popular Indian ETFs on NSE."""
    print("Building Indian ETF tickers...")
    return {
        "India_ETFs": _dedupe_enriched([
            _t("NIFTYBEES.NS", "Nippon India ETF Nifty 50 BeES"), _t("BANKBEES.NS", "Nippon India ETF Bank BeES"),
            _t("JUNIORBEES.NS", "Nippon India ETF Junior BeES"), _t("SETFNIF50.NS", "SBI ETF Nifty 50"),
            _t("NETFNIF100.NS", "Nippon India ETF Nifty Next 50"), _t("MOM50.NS", "Motilal Oswal Momentum 50"),
            _t("MIDCPNIFTY.NS", "Motilal Oswal Midcap Nifty"), _t("GOLDBEES.NS", "Nippon India ETF Gold BeES"),
            _t("GOLDSHARE.NS", "UTI Gold ETF"), _t("BSLGOLDETF.NS", "Aditya BSL Gold ETF"),
            _t("HABORETF.NS", "Mirae Asset Gold ETF"), _t("AXISGOLD.NS", "Axis Gold ETF"),
            _t("KOTAKGOLD.NS", "Kotak Gold ETF"), _t("NIPGOLDETF.NS", "Nippon India Gold ETF"),
            _t("IDBIGOLD.NS", "IDBI Gold ETF"), _t("SETFGOLD.NS", "SBI ETF Gold"),
            _t("TATAGOLD.NS", "Tata Gold ETF"), _t("LICNFNHGP.NS", "LIC Nomura MF Gold ETF"),
            _t("SILVERBEES.NS", "Nippon India ETF Silver BeES"), _t("SETFSILVER.NS", "SBI ETF Silver"),
            _t("KOTAKSILVE.NS", "Kotak Silver ETF"), _t("NIPSILETF.NS", "Nippon India Silver ETF"),
            _t("ITBEES.NS", "Nippon India ETF IT"), _t("PSUBNKBEES.NS", "Nippon India ETF PSU Bank BeES"),
            _t("PHARMABEES.NS", "Nippon India ETF Pharma"), _t("INFRABEAT.NS", "Nippon India ETF Infra BeES"),
            _t("MAFANG.NS", "Mirae Asset Hang Seng TECH ETF"), _t("N100.NS", "Motilal Oswal Nasdaq 100 ETF"),
            _t("MON100.NS", "Motilal Oswal Nasdaq 100 FoF"), _t("LIQUIDBEES.NS", "Nippon India ETF Liquid BeES"),
            _t("LIQUIDCASE.NS", "DSP Liquid ETF"), _t("LIQUIDADD.NS", "Aditya BSL Liquid ETF"),
        ]),
    }


def get_indian_bonds() -> dict[str, list[dict]]:
    """Indian Government Securities & bond proxies."""
    print("Building Indian bond & G-Sec tickers...")
    return {
        "India_Bond_ETFs": _dedupe_enriched([
            _t("LIQUIDBEES.NS", "Nippon India ETF Liquid BeES"),
            _t("CPSEETF.NS", "Nippon India CPSE ETF"),
            _t("LONGTERM.NS", "Edelweiss Long Term Bond ETF"),
            _t("NETFGILT5Y.NS", "Nippon India ETF 5yr Gilt"),
            _t("SETF10GILT.NS", "SBI ETF 10yr Gilt"),
            _t("GILT5YBEES.NS", "Nippon India ETF Gilt 5yr BeES"),
            _t("GSEC10YEAR.NS", "DSP 10Y G-Sec ETF"),
            _t("NIFTYBOND.NS", "Nifty Bond ETF"),
        ]),
        "India_Bond_Proxies": _dedupe_enriched([
            _t("TLT", "iShares 20+ Year Treasury Bond ETF"),
            _t("IEF", "iShares 7-10 Year Treasury Bond ETF"),
            _t("SHY", "iShares 1-3 Year Treasury Bond ETF"),
            _t("EMB", "iShares JP Morgan USD EM Bond ETF"),
            _t("LEMB", "iShares JP Morgan EM Local Currency Bond"),
            _t("IGIB", "iShares Investment Grade Corporate Bond"),
            _t("INDY", "iShares India 50 ETF"),
            _t("INDA", "iShares MSCI India ETF"),
        ]),
    }


def get_indian_commodities() -> dict[str, list[dict]]:
    """MCX commodity proxies via global futures tickers (Yahoo Finance)."""
    print("Building Indian commodity tickers (MCX proxies + ETFs)...")
    return {
        "Indian_MCX_Proxy_PreciousMetals": _dedupe_enriched([
            _t("GC=F", "Gold Futures"), _t("SI=F", "Silver Futures"), _t("PL=F", "Platinum Futures"),
        ]),
        "Indian_MCX_Proxy_Energy": _dedupe_enriched([
            _t("CL=F", "Crude Oil WTI Futures"), _t("BZ=F", "Brent Crude Futures"),
            _t("NG=F", "Natural Gas Futures"), _t("RB=F", "RBOB Gasoline Futures"),
        ]),
        "Indian_MCX_Proxy_BaseMetals": _dedupe_enriched([
            _t("HG=F", "Copper Futures"), _t("ALI=F", "Aluminum Futures"),
        ]),
        "Indian_MCX_Commodities_Extended": _dedupe_enriched([
            _t("GC=F", "Gold Futures"), _t("SI=F", "Silver Futures"),
            _t("PL=F", "Platinum Futures"), _t("PA=F", "Palladium Futures"),
            _t("CL=F", "Crude Oil WTI"), _t("BZ=F", "Brent Crude"),
            _t("NG=F", "Natural Gas"), _t("HG=F", "Copper"),
            _t("ALI=F", "Aluminum"), _t("ZN=F", "Zinc (CBOT)"),
            _t("NI=F", "Nickel"), _t("ZS=F", "Soybean"),
            _t("CT=F", "Cotton"), _t("KC=F", "Coffee Arabica"),
            _t("SB=F", "Sugar"), _t("ZW=F", "Wheat"),
            _t("CC=F", "Cocoa"), _t("CPO=F", "Crude Palm Oil"),
        ]),
        "India_Commodity_ETFs": _dedupe_enriched([
            _t("GOLDBEES.NS", "Nippon Gold ETF BeES"), _t("SILVERBEES.NS", "Nippon Silver ETF BeES"),
            _t("SETFGOLD.NS", "SBI Gold ETF"), _t("SETFSILVER.NS", "SBI Silver ETF"),
            _t("KOTAKGOLD.NS", "Kotak Gold ETF"), _t("KOTAKSILVE.NS", "Kotak Silver ETF"),
            _t("NIPGOLDETF.NS", "Nippon India Gold ETF"), _t("NIPSILETF.NS", "Nippon India Silver ETF"),
        ]),
    }


# ---------------------------------------------------------------------------
# INR CURRENCY PAIRS
# ---------------------------------------------------------------------------

def get_inr_currencies() -> dict[str, list[dict]]:
    """All INR forex pairs and related currency tickers."""
    print("Building INR currency pair tickers...")
    return {
        "INR_Forex_Pairs": _dedupe_enriched([
            _t("USDINR=X", "US Dollar / Indian Rupee"), _t("EURINR=X", "Euro / Indian Rupee"),
            _t("GBPINR=X", "British Pound / Indian Rupee"), _t("JPYINR=X", "Japanese Yen / Indian Rupee"),
            _t("AUDINR=X", "Australian Dollar / INR"), _t("CADINR=X", "Canadian Dollar / INR"),
            _t("CHFINR=X", "Swiss Franc / INR"), _t("SGDINR=X", "Singapore Dollar / INR"),
            _t("HKDINR=X", "Hong Kong Dollar / INR"), _t("NZDINR=X", "New Zealand Dollar / INR"),
            _t("ZARINR=X", "South African Rand / INR"), _t("SEKINR=X", "Swedish Krona / INR"),
            _t("NOKINR=X", "Norwegian Krone / INR"), _t("DKKINR=X", "Danish Krone / INR"),
            _t("MYRINR=X", "Malaysian Ringgit / INR"), _t("THBINR=X", "Thai Baht / INR"),
            _t("CNHINR=X", "Chinese Yuan (Offshore) / INR"), _t("KRWINR=X", "Korean Won / INR"),
            _t("SARINR=X", "Saudi Riyal / INR"), _t("AEDINR=X", "UAE Dirham / INR"),
            _t("KWDINR=X", "Kuwaiti Dinar / INR"), _t("BHDINR=X", "Bahraini Dinar / INR"),
        ]),
        "INR_Cross_Rates": _dedupe_enriched([
            _t("DX-Y.NYB", "US Dollar Index (DXY)"), _t("USDINR=X", "USD/INR"),
            _t("USDCNY=X", "USD/CNY"), _t("USDJPY=X", "USD/JPY"),
            _t("USDSGD=X", "USD/SGD"), _t("USDKRW=X", "USD/KRW"),
            _t("USDIDR=X", "USD/IDR"), _t("USDTHB=X", "USD/THB"),
            _t("USDPHP=X", "USD/PHP"), _t("USDMYR=X", "USD/MYR"),
            _t("USDTWD=X", "USD/TWD"),
        ]),
    }


# ---------------------------------------------------------------------------
# CRYPTO (INR context)
# ---------------------------------------------------------------------------

def get_crypto() -> dict[str, list[dict]]:
    """Major crypto tickers — both USD and INR pairs."""
    print("Building crypto tickers (USD + INR pairs)...")
    return {
        "Crypto_Major_USD": _dedupe_enriched([
            _t("BTC-USD", "Bitcoin"), _t("ETH-USD", "Ethereum"),
            _t("BNB-USD", "Binance Coin"), _t("SOL-USD", "Solana"),
            _t("XRP-USD", "Ripple (XRP)"), _t("ADA-USD", "Cardano"),
            _t("DOGE-USD", "Dogecoin"), _t("DOT-USD", "Polkadot"),
            _t("AVAX-USD", "Avalanche"), _t("MATIC-USD", "Polygon"),
            _t("LINK-USD", "Chainlink"), _t("UNI-USD", "Uniswap"),
            _t("ATOM-USD", "Cosmos"), _t("LTC-USD", "Litecoin"),
            _t("NEAR-USD", "NEAR Protocol"), _t("APT-USD", "Aptos"),
            _t("ARB-USD", "Arbitrum"), _t("OP-USD", "Optimism"),
            _t("FIL-USD", "Filecoin"), _t("SHIB-USD", "Shiba Inu"),
        ]),
        "Crypto_INR_Pairs": _dedupe_enriched([
            _t("BTC-INR", "Bitcoin / INR"), _t("ETH-INR", "Ethereum / INR"),
            _t("BNB-INR", "BNB / INR"), _t("SOL-INR", "Solana / INR"),
            _t("XRP-INR", "Ripple / INR"), _t("ADA-INR", "Cardano / INR"),
            _t("DOGE-INR", "Dogecoin / INR"), _t("DOT-INR", "Polkadot / INR"),
            _t("AVAX-INR", "Avalanche / INR"), _t("MATIC-INR", "Polygon / INR"),
            _t("LINK-INR", "Chainlink / INR"), _t("LTC-INR", "Litecoin / INR"),
            _t("SHIB-INR", "Shiba Inu / INR"),
        ]),
        "Crypto_Stablecoins": _dedupe_enriched([
            _t("USDT-USD", "Tether"), _t("USDC-USD", "USD Coin"),
            _t("DAI-USD", "DAI Stablecoin"), _t("BUSD-USD", "Binance USD"),
        ]),
    }


# ---------------------------------------------------------------------------
# PRECIOUS METALS — CITY-WISE INDIA PRICES
# ---------------------------------------------------------------------------

INDIA_CITIES = [
    "Delhi", "Mumbai", "Chennai", "Kolkata", "Bangalore", "Hyderabad",
    "Ahmedabad", "Jaipur", "Pune", "Lucknow", "Chandigarh", "Coimbatore",
    "Patna", "Bhopal", "Nagpur", "Visakhapatnam", "Kochi", "Surat",
    "Vadodara", "Indore", "Mangalore", "Madurai", "Vijayawada",
    "Thiruvananthapuram", "Mysore", "Guwahati", "Bhubaneswar", "Ranchi",
    "Dehradun", "Amritsar",
]


def get_india_precious_metals_citywise() -> dict[str, list[dict]]:
    """City-wise gold, silver, and platinum tickers for 30 Indian cities."""
    print(f"Building city-wise precious metal tickers for {len(INDIA_CITIES)} cities...")
    gold_tickers = [_t(f"GOLD_{city.upper().replace(' ', '_')}.MCX", f"Gold Price — {city}") for city in INDIA_CITIES]
    silver_tickers = [_t(f"SILVER_{city.upper().replace(' ', '_')}.MCX", f"Silver Price — {city}") for city in INDIA_CITIES]
    platinum_tickers = [_t(f"PLATINUM_{city.upper().replace(' ', '_')}.MCX", f"Platinum Price — {city}") for city in INDIA_CITIES]

    return {
        "India_Gold_CityWise": sorted(gold_tickers, key=lambda x: x["s"]),
        "India_Silver_CityWise": sorted(silver_tickers, key=lambda x: x["s"]),
        "India_Platinum_CityWise": sorted(platinum_tickers, key=lambda x: x["s"]),
        "India_PreciousMetals_Benchmark": _dedupe_enriched([
            _t("GC=F", "Gold Futures (Global)"), _t("SI=F", "Silver Futures (Global)"),
            _t("PL=F", "Platinum Futures (Global)"), _t("GOLDBEES.NS", "Nippon India Gold ETF BeES"),
            _t("SILVERBEES.NS", "Nippon India Silver ETF BeES"),
        ]),
    }


# ---------------------------------------------------------------------------
# US MARKETS
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# UNIVERSAL WIKIPEDIA FETCHER
# ---------------------------------------------------------------------------
# Every index uses Wikipedia as primary source with hardcoded fallback.
# Config: (label, wiki_url, table_id_or_None, yahoo_suffix, min_rows, fallback_list)
#
# sym_col and name_col are auto-detected from table headers using flexible matching.
# yahoo_suffix is appended to raw symbols (e.g. ".L" for London, ".T" for Tokyo).

_SYM_HINTS = {"ticker", "symbol", "ticker symbol", "epic", "code", "stock code",
              "stock symbol", "bloomberg ticker", "tsx symbol", "abbreviation"}
_NAME_HINTS = {"company", "name", "security", "company name", "corporation",
               "organisation", "company/security"}


def _wiki_fetch(label: str, url: str, table_id: str | None,
                yahoo_suffix: str, min_rows: int,
                fallback: list[dict], *,
                sym_transform: callable = None) -> list[dict]:
    """Fetch index constituents from a Wikipedia page.

    Args:
        label: display label for logging
        url: Wikipedia article URL
        table_id: HTML table id attribute (None = scan all tables)
        yahoo_suffix: suffix to append to raw symbols (e.g. ".L", ".T", "")
        min_rows: minimum rows for a table to be considered valid
        fallback: hardcoded enriched ticker list to use on failure
        sym_transform: optional callable(raw_sym) -> yahoo_sym override
    """
    try:
        html = requests.get(url, headers=HEADERS, timeout=45).text
        if table_id:
            dfs = pd.read_html(io.StringIO(html), attrs={"id": table_id})
        else:
            dfs = pd.read_html(io.StringIO(html))

        for df in dfs:
            if len(df) < min_rows:
                continue
            # Flatten MultiIndex columns if present
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = [" ".join(str(c) for c in col).strip() for col in df.columns]
            cols = [str(c).strip().lower() for c in df.columns]
            sym_idx = next((i for i, c in enumerate(cols) if c in _SYM_HINTS), None)
            name_idx = next((i for i, c in enumerate(cols)
                             if c in _NAME_HINTS or "company" in c or "name" in c), None)
            if sym_idx is None:
                # Try partial match: any column containing "ticker" or "symbol"
                sym_idx = next((i for i, c in enumerate(cols)
                                if "ticker" in c or "symbol" in c or "code" in c), None)
            if sym_idx is not None:
                tickers = []
                for _, row in df.iterrows():
                    raw_sym = str(row.iloc[sym_idx]).strip()
                    name = str(row.iloc[name_idx]).strip() if name_idx is not None else ""
                    if not raw_sym or raw_sym == "nan" or len(raw_sym) > 20:
                        continue
                    # Clean symbol: remove footnote markers like [1], trailing whitespace
                    raw_sym = raw_sym.split("[")[0].strip()
                    if not raw_sym:
                        continue
                    if sym_transform:
                        sym = sym_transform(raw_sym)
                    elif yahoo_suffix and not raw_sym.endswith(yahoo_suffix):
                        sym = f"{raw_sym}{yahoo_suffix}"
                    else:
                        sym = raw_sym
                    name = name.split("[")[0].strip() if name else ""
                    if name == "nan":
                        name = ""
                    tickers.append(_t(sym, name or raw_sym))
                if len(tickers) >= min_rows:
                    tickers = _dedupe_enriched(tickers)
                    print(f"  {label}: {len(tickers)} tickers fetched from Wikipedia")
                    return tickers
        print(f"  {label}: no suitable table found on Wikipedia, using fallback")
    except Exception as exc:
        print(f"  {label} Wikipedia fetch failed ({exc}), using fallback")

    # Try existing JSON before hardcoded fallback
    existing = _load_existing()
    existing_data = _extract_symbols_from_existing(existing, label)
    if len(existing_data) > len(fallback):
        print(f"  {label}: {len(existing_data)} tickers from existing JSON")
        return existing_data

    if fallback:
        print(f"  {label}: {len(fallback)} tickers (hardcoded fallback)")
        return fallback
    return []


# ---------------------------------------------------------------------------
# HARDCODED FALLBACK LISTS (used only when Wikipedia scraping fails)
# ---------------------------------------------------------------------------

_FALLBACK_FTSE100 = [
    _t("AZN.L", "AstraZeneca"), _t("SHEL.L", "Shell"), _t("HSBA.L", "HSBC Holdings"),
    _t("ULVR.L", "Unilever"), _t("BP.L", "BP"), _t("GSK.L", "GSK"),
    _t("RIO.L", "Rio Tinto"), _t("LSEG.L", "London Stock Exchange"),
    _t("REL.L", "RELX"), _t("DGE.L", "Diageo"),
    _t("BATS.L", "British American Tobacco"), _t("CPG.L", "Compass Group"),
    _t("NG.L", "National Grid"), _t("GLEN.L", "Glencore"),
    _t("VOD.L", "Vodafone"), _t("AHT.L", "Ashtead Group"),
    _t("BHP.L", "BHP Group"), _t("RKT.L", "Reckitt Benckiser"),
    _t("PRU.L", "Prudential"), _t("LLOY.L", "Lloyds Banking Group"),
    _t("BARC.L", "Barclays"), _t("NWG.L", "NatWest Group"),
    _t("AAL.L", "Anglo American"), _t("IMB.L", "Imperial Brands"),
    _t("ANTO.L", "Antofagasta"), _t("III.L", "3i Group"),
    _t("STJ.L", "St James's Place"), _t("AVV.L", "AVEVA Group"),
    _t("EXPN.L", "Experian"), _t("MNDI.L", "Mondi"),
]

_FALLBACK_NIKKEI225 = [
    _t("7203.T", "Toyota Motor"), _t("6758.T", "Sony Group"),
    _t("9984.T", "SoftBank Group"), _t("8306.T", "Mitsubishi UFJ Financial"),
    _t("6861.T", "Keyence"), _t("6902.T", "Denso"),
    _t("9433.T", "KDDI"), _t("6501.T", "Hitachi"),
    _t("7267.T", "Honda Motor"), _t("4502.T", "Takeda Pharmaceutical"),
    _t("7751.T", "Canon"), _t("4063.T", "Shin-Etsu Chemical"),
    _t("8035.T", "Tokyo Electron"), _t("6367.T", "Daikin Industries"),
    _t("7974.T", "Nintendo"), _t("9432.T", "NTT"),
    _t("3382.T", "Seven & i Holdings"), _t("6098.T", "Recruit Holdings"),
    _t("4519.T", "Chugai Pharmaceutical"), _t("2914.T", "Japan Tobacco"),
]

_FALLBACK_HANGSENG = [
    _t("0700.HK", "Tencent Holdings"), _t("9988.HK", "Alibaba Group"),
    _t("0005.HK", "HSBC Holdings"), _t("1299.HK", "AIA Group"),
    _t("0939.HK", "CCB"), _t("2318.HK", "Ping An Insurance"),
    _t("3690.HK", "Meituan"), _t("1398.HK", "ICBC"),
    _t("0388.HK", "HK Exchanges & Clearing"), _t("0941.HK", "China Mobile"),
    _t("0001.HK", "CK Hutchison"), _t("2269.HK", "WuXi Biologics"),
    _t("0027.HK", "Galaxy Entertainment"), _t("0011.HK", "Hang Seng Bank"),
    _t("0883.HK", "CNOOC"), _t("1810.HK", "Xiaomi"),
    _t("0002.HK", "CLP Holdings"), _t("9999.HK", "NetEase"),
    _t("2020.HK", "Anta Sports"), _t("0003.HK", "HK & China Gas"),
]

_FALLBACK_DAX = [
    _t("SAP.DE", "SAP"), _t("SIE.DE", "Siemens"),
    _t("ALV.DE", "Allianz"), _t("DTE.DE", "Deutsche Telekom"),
    _t("AIR.DE", "Airbus"), _t("MBG.DE", "Mercedes-Benz"),
    _t("BMW.DE", "BMW"), _t("BAS.DE", "BASF"),
    _t("MUV2.DE", "Munich Re"), _t("IFX.DE", "Infineon Technologies"),
    _t("DHL.DE", "DHL Group"), _t("ADS.DE", "Adidas"),
    _t("SHL.DE", "Siemens Healthineers"), _t("DB1.DE", "Deutsche Boerse"),
    _t("HEN3.DE", "Henkel"), _t("EOAN.DE", "E.ON"),
    _t("RWE.DE", "RWE"), _t("BEI.DE", "Beiersdorf"),
    _t("VOW3.DE", "Volkswagen"), _t("FRE.DE", "Fresenius"),
]

_FALLBACK_CAC40 = [
    _t("AI.PA", "Air Liquide"), _t("AIR.PA", "Airbus"), _t("ALO.PA", "Alstom"),
    _t("MT.AS", "ArcelorMittal"), _t("CS.PA", "AXA"), _t("BNP.PA", "BNP Paribas"),
    _t("EN.PA", "Bouygues"), _t("CAP.PA", "Capgemini"), _t("CA.PA", "Carrefour"),
    _t("ACA.PA", "Credit Agricole"), _t("BN.PA", "Danone"), _t("DSY.PA", "Dassault Systemes"),
    _t("ENGI.PA", "Engie"), _t("ERF.PA", "Eurofins Scientific"), _t("EL.PA", "EssilorLuxottica"),
    _t("RMS.PA", "Hermes International"), _t("KER.PA", "Kering"), _t("LR.PA", "Legrand"),
    _t("OR.PA", "L'Oreal"), _t("MC.PA", "LVMH"), _t("ML.PA", "Michelin"),
    _t("ORA.PA", "Orange"), _t("RI.PA", "Pernod Ricard"), _t("PUB.PA", "Publicis"),
    _t("RNO.PA", "Renault"), _t("SAF.PA", "Safran"), _t("SGO.PA", "Saint-Gobain"),
    _t("SAN.PA", "Sanofi"), _t("SU.PA", "Schneider Electric"), _t("GLE.PA", "Societe Generale"),
    _t("STLAP.PA", "Stellantis"), _t("STMPA.PA", "STMicroelectronics"),
    _t("TEP.PA", "Teleperformance"), _t("HO.PA", "Thales"),
    _t("TTE.PA", "TotalEnergies"), _t("URW.PA", "Unibail-Rodamco-Westfield"),
    _t("VIE.PA", "Veolia"), _t("DG.PA", "Vinci"), _t("VIV.PA", "Vivendi"),
    _t("WLN.PA", "Worldline"),
]

_FALLBACK_SMI = [
    _t("NESN.SW", "Nestle"), _t("ROG.SW", "Roche"), _t("NOVN.SW", "Novartis"),
    _t("ZURN.SW", "Zurich Insurance"), _t("UBSG.SW", "UBS Group"),
    _t("ABBN.SW", "ABB"), _t("CSGN.SW", "Credit Suisse"), _t("SREN.SW", "Swiss Re"),
    _t("GIVN.SW", "Givaudan"), _t("CFR.SW", "Richemont"),
    _t("GEBN.SW", "Geberit"), _t("SIKA.SW", "Sika"), _t("LONN.SW", "Lonza"),
    _t("PGHN.SW", "Partners Group"), _t("SLHN.SW", "Swiss Life"),
    _t("SCMN.SW", "Swisscom"), _t("HOLN.SW", "Holcim"), _t("BAER.SW", "Julius Baer"),
    _t("ADEN.SW", "Adecco"), _t("SGSN.SW", "SGS"),
]

_FALLBACK_TSX60 = [
    _t("RY.TO", "Royal Bank of Canada"), _t("TD.TO", "Toronto-Dominion Bank"),
    _t("ENB.TO", "Enbridge"), _t("BNS.TO", "Bank of Nova Scotia"),
    _t("CNR.TO", "Canadian National Railway"), _t("CP.TO", "Canadian Pacific"),
    _t("BMO.TO", "Bank of Montreal"), _t("BCE.TO", "BCE Inc"),
    _t("TRP.TO", "TC Energy"), _t("CM.TO", "CIBC"),
    _t("SU.TO", "Suncor Energy"), _t("MFC.TO", "Manulife"),
    _t("ABX.TO", "Barrick Gold"), _t("CSU.TO", "Constellation Software"),
    _t("ATD.TO", "Alimentation Couche-Tard"), _t("T.TO", "Telus"),
    _t("NTR.TO", "Nutrien"), _t("FNV.TO", "Franco-Nevada"),
    _t("QSR.TO", "Restaurant Brands International"), _t("WCN.TO", "Waste Connections"),
    _t("L.TO", "Loblaw Companies"), _t("FTS.TO", "Fortis"),
    _t("IFC.TO", "Intact Financial"), _t("AEM.TO", "Agnico Eagle Mines"),
    _t("GIB-A.TO", "CGI Group"), _t("DOL.TO", "Dollarama"),
    _t("SHOP.TO", "Shopify"), _t("BAM.TO", "Brookfield Asset Management"),
    _t("BN.TO", "Brookfield Corp"), _t("WFG.TO", "West Fraser Timber"),
]

_FALLBACK_ASX200 = [
    _t("BHP.AX", "BHP Group"), _t("CBA.AX", "Commonwealth Bank"),
    _t("CSL.AX", "CSL Limited"), _t("NAB.AX", "National Australia Bank"),
    _t("WBC.AX", "Westpac Banking"), _t("ANZ.AX", "ANZ Group"),
    _t("WES.AX", "Wesfarmers"), _t("MQG.AX", "Macquarie Group"),
    _t("FMG.AX", "Fortescue Metals"), _t("WDS.AX", "Woodside Energy"),
    _t("TLS.AX", "Telstra"), _t("RIO.AX", "Rio Tinto"),
    _t("WOW.AX", "Woolworths"), _t("GMG.AX", "Goodman Group"),
    _t("ALL.AX", "Aristocrat Leisure"), _t("TCL.AX", "Transurban"),
    _t("STO.AX", "Santos"), _t("COL.AX", "Coles Group"),
    _t("QBE.AX", "QBE Insurance"), _t("JHX.AX", "James Hardie"),
]

_FALLBACK_KOSPI = [
    _t("005930.KS", "Samsung Electronics"), _t("000660.KS", "SK Hynix"),
    _t("373220.KS", "LG Energy Solution"), _t("207940.KS", "Samsung Biologics"),
    _t("005380.KS", "Hyundai Motor"), _t("006400.KS", "Samsung SDI"),
    _t("051910.KS", "LG Chem"), _t("035420.KS", "NAVER"),
    _t("000270.KS", "Kia"), _t("035720.KS", "Kakao"),
    _t("105560.KS", "KB Financial"), _t("055550.KS", "Shinhan Financial"),
    _t("066570.KS", "LG Electronics"), _t("003670.KS", "POSCO Holdings"),
    _t("012330.KS", "Hyundai Mobis"), _t("086790.KS", "Hana Financial"),
    _t("068270.KS", "Celltrion"), _t("028260.KS", "Samsung C&T"),
    _t("003550.KS", "LG"), _t("034730.KS", "SK"),
]

_FALLBACK_TWSE = [
    _t("2330.TW", "TSMC"), _t("2317.TW", "Hon Hai Precision (Foxconn)"),
    _t("2454.TW", "MediaTek"), _t("2308.TW", "Delta Electronics"),
    _t("2303.TW", "United Microelectronics"), _t("2882.TW", "Cathay Financial"),
    _t("1301.TW", "Formosa Plastics"), _t("2881.TW", "Fubon Financial"),
    _t("2891.TW", "CTBC Financial"), _t("3711.TW", "ASE Technology"),
    _t("2886.TW", "Mega Financial"), _t("2002.TW", "China Steel"),
    _t("1303.TW", "Nan Ya Plastics"), _t("2412.TW", "Chunghwa Telecom"),
    _t("5880.TW", "Taiwan Cooperative Financial"), _t("2884.TW", "E.SUN Financial"),
    _t("3008.TW", "Largan Precision"), _t("2357.TW", "ASUS"),
    _t("1326.TW", "Formosa Chemicals"), _t("6505.TW", "Formosa Petrochemical"),
]

_FALLBACK_BOVESPA = [
    _t("VALE3.SA", "Vale"), _t("PETR4.SA", "Petrobras"),
    _t("ITUB4.SA", "Itau Unibanco"), _t("BBDC4.SA", "Bradesco"),
    _t("ABEV3.SA", "Ambev"), _t("B3SA3.SA", "B3 (Brasil Bolsa Balcao)"),
    _t("WEGE3.SA", "WEG"), _t("RENT3.SA", "Localiza"),
    _t("BBAS3.SA", "Banco do Brasil"), _t("SUZB3.SA", "Suzano"),
    _t("EQTL3.SA", "Equatorial Energia"), _t("RADL3.SA", "Raia Drogasil"),
    _t("RAIL3.SA", "Rumo"), _t("JBSS3.SA", "JBS"),
    _t("GGBR4.SA", "Gerdau"), _t("CSNA3.SA", "CSN"),
    _t("LREN3.SA", "Lojas Renner"), _t("HAPV3.SA", "Hapvida"),
    _t("PRIO3.SA", "PetroRio"), _t("TOTS3.SA", "TOTVS"),
]

_FALLBACK_JSE = [
    _t("NPN.JO", "Naspers"), _t("PRX.JO", "Prosus"),
    _t("AGL.JO", "Anglo American"), _t("BHP.JO", "BHP Group"),
    _t("FSR.JO", "FirstRand"), _t("SOL.JO", "Sasol"),
    _t("SBK.JO", "Standard Bank"), _t("AMS.JO", "Anglo American Platinum"),
    _t("CFR.JO", "Richemont"), _t("MTN.JO", "MTN Group"),
    _t("VOD.JO", "Vodacom"), _t("SHP.JO", "Shoprite"),
    _t("ABG.JO", "Absa Group"), _t("NED.JO", "Nedbank"),
    _t("IMP.JO", "Impala Platinum"), _t("GFI.JO", "Gold Fields"),
    _t("SLM.JO", "Sanlam"), _t("DSY.JO", "Discovery"),
    _t("REM.JO", "Remgro"), _t("BID.JO", "Bid Corporation"),
]


# ---------------------------------------------------------------------------
# Symbol transform helpers for non-trivial Yahoo suffix rules
# ---------------------------------------------------------------------------

def _hk_sym_transform(raw: str) -> str:
    """Convert HK stock code to Yahoo format: pad to 4 digits + .HK"""
    digits = raw.lstrip("0").zfill(4) if raw.isdigit() else raw
    return f"{digits}.HK" if not raw.endswith(".HK") else raw


def _kr_sym_transform(raw: str) -> str:
    """Convert Korean stock code to Yahoo format: pad to 6 digits + .KS"""
    if raw.isdigit():
        return f"{raw.zfill(6)}.KS"
    return f"{raw}.KS" if not raw.endswith(".KS") else raw


def _tw_sym_transform(raw: str) -> str:
    """Convert Taiwan stock code to Yahoo format: code + .TW"""
    return f"{raw}.TW" if not raw.endswith(".TW") else raw


def _br_sym_transform(raw: str) -> str:
    """Convert Brazil ticker to Yahoo format: ticker + .SA"""
    return f"{raw}.SA" if not raw.endswith(".SA") else raw


# ---------------------------------------------------------------------------
# WIKI_INDICES — master config for all Wikipedia-scraped indices
# ---------------------------------------------------------------------------
# (label, wiki_url, table_id, yahoo_suffix, min_rows, fallback, sym_transform)

WIKI_INDICES: list[tuple] = [
    # --- US Markets ---
    ("DOW", "https://en.wikipedia.org/wiki/Dow_Jones_Industrial_Average",
     "constituents", "", 25, [], None),
    ("SP_500", "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
     "constituents", "", 400, [], None),
    ("NASDAQ_100", "https://en.wikipedia.org/wiki/Nasdaq-100",
     "constituents", "", 90, [], None),
    ("Russell_1000", "https://en.wikipedia.org/wiki/Russell_1000_Index",
     None, "", 100, [], None),

    # --- UK ---
    ("LSE_FTSE100", "https://en.wikipedia.org/wiki/FTSE_100_Index",
     "constituents", ".L", 80, _FALLBACK_FTSE100, None),

    # --- Japan ---
    ("Tokyo_Nikkei225", "https://en.wikipedia.org/wiki/Nikkei_225",
     None, ".T", 15, _FALLBACK_NIKKEI225, None),

    # --- Hong Kong ---
    ("HangSeng", "https://en.wikipedia.org/wiki/Hang_Seng_Index",
     None, ".HK", 15, _FALLBACK_HANGSENG, _hk_sym_transform),

    # --- Germany ---
    ("Germany_DAX", "https://en.wikipedia.org/wiki/DAX",
     "constituents", ".DE", 30, _FALLBACK_DAX, None),

    # --- France ---
    ("France_CAC40", "https://en.wikipedia.org/wiki/CAC_40",
     None, ".PA", 30, _FALLBACK_CAC40, None),

    # --- Switzerland ---
    ("Switzerland_SMI", "https://en.wikipedia.org/wiki/Swiss_Market_Index",
     None, ".SW", 15, _FALLBACK_SMI, None),

    # --- Canada ---
    ("Canada_TSX60", "https://en.wikipedia.org/wiki/S%26P/TSX_60",
     None, ".TO", 40, _FALLBACK_TSX60, None),

    # --- Australia ---
    ("Australia_ASX200", "https://en.wikipedia.org/wiki/S%26P/ASX_200",
     None, ".AX", 15, _FALLBACK_ASX200, None),

    # --- South Korea ---
    ("Korea_KOSPI50", "https://en.wikipedia.org/wiki/KOSPI",
     None, ".KS", 10, _FALLBACK_KOSPI, _kr_sym_transform),

    # --- Taiwan ---
    ("Taiwan_TWSE50", "https://en.wikipedia.org/wiki/FTSE_TWSE_Taiwan_50_Index",
     None, ".TW", 10, _FALLBACK_TWSE, _tw_sym_transform),

    # --- Brazil ---
    ("Brazil_Bovespa", "https://en.wikipedia.org/wiki/List_of_companies_listed_on_B3",
     None, ".SA", 15, _FALLBACK_BOVESPA, _br_sym_transform),

    # --- South Africa ---
    ("SouthAfrica_JSE40", "https://en.wikipedia.org/wiki/FTSE/JSE_Top_40_Index",
     None, ".JO", 15, _FALLBACK_JSE, None),
]


def get_us_markets() -> dict[str, list[dict]]:
    """Fetch US indices (DOW, S&P 500, NASDAQ 100) from Wikipedia."""
    print("Fetching US markets (Dow, S&P 500, Nasdaq 100) from Wikipedia...")
    result: dict[str, list[dict]] = {}
    for label, url, table_id, suffix, min_rows, fallback, sym_xform in WIKI_INDICES:
        if label in ("DOW", "SP_500", "NASDAQ_100"):
            tickers = _wiki_fetch(label, url, table_id, suffix, min_rows, fallback,
                                  sym_transform=sym_xform)
            if tickers:
                result[label] = tickers
    return result


def get_additional_us_markets() -> dict[str, list[dict]]:
    """Russell 1000 from Wikipedia."""
    print("Fetching additional US markets (Russell 1000) from Wikipedia...")
    result: dict[str, list[dict]] = {}
    for label, url, table_id, suffix, min_rows, fallback, sym_xform in WIKI_INDICES:
        if label == "Russell_1000":
            tickers = _wiki_fetch(label, url, table_id, suffix, min_rows, fallback,
                                  sym_transform=sym_xform)
            if tickers:
                result[label] = tickers
    return result


def get_global_markets() -> dict[str, list[dict]]:
    """Fetch all global equity indices from Wikipedia (FTSE, Nikkei, Hang Seng, DAX, etc.)."""
    print("Fetching global equity indices from Wikipedia...")
    result: dict[str, list[dict]] = {}
    us_labels = {"DOW", "SP_500", "NASDAQ_100", "Russell_1000"}
    for label, url, table_id, suffix, min_rows, fallback, sym_xform in WIKI_INDICES:
        if label in us_labels:
            continue  # handled by get_us_markets / get_additional_us_markets
        tickers = _wiki_fetch(label, url, table_id, suffix, min_rows, fallback,
                              sym_transform=sym_xform)
        if tickers:
            result[label] = tickers

    # Global benchmark indices (tracked on Yahoo Finance) — always hardcoded
    result["Global_Benchmark_Indices"] = _dedupe_enriched([
        _t("^GSPC", "S&P 500"), _t("^DJI", "Dow Jones Industrial Average"),
        _t("^IXIC", "NASDAQ Composite"), _t("^RUT", "Russell 2000"),
        _t("^FCHI", "CAC 40"), _t("^GDAXI", "DAX"),
        _t("^STOXX50E", "Euro Stoxx 50"), _t("^FTSE", "FTSE 100"),
        _t("^N225", "Nikkei 225"), _t("^HSI", "Hang Seng"),
        _t("^SSEC", "Shanghai Composite"), _t("^KS11", "KOSPI"),
        _t("^TWII", "TAIEX"), _t("^BVSP", "Bovespa"),
        _t("^GSPTSE", "S&P/TSX Composite"), _t("^AXJO", "ASX 200"),
        _t("^SSMI", "Swiss Market Index"), _t("^NSEI", "Nifty 50"),
        _t("^BSESN", "BSE Sensex"), _t("^JKSE", "Jakarta Composite"),
        _t("^STI", "Straits Times"), _t("^KLSE", "KLCI Malaysia"),
        _t("^SET.BK", "SET Thailand"), _t("^MXX", "IPC Mexico"),
    ])
    print(f"  Global_Benchmark_Indices: {len(result['Global_Benchmark_Indices'])} indices")

    return result


def get_currencies() -> dict[str, list[dict]]:
    print("Building broader forex coverage...")
    return {
        "Global_Forex_Majors": _dedupe_enriched([
            _t("EURUSD=X", "Euro / US Dollar"), _t("GBPUSD=X", "British Pound / US Dollar"),
            _t("AUDUSD=X", "Australian Dollar / US Dollar"), _t("NZDUSD=X", "New Zealand Dollar / US Dollar"),
            _t("USDJPY=X", "US Dollar / Japanese Yen"), _t("USDCHF=X", "US Dollar / Swiss Franc"),
            _t("USDCAD=X", "US Dollar / Canadian Dollar"),
        ]),
        "Global_Forex_Crosses": _dedupe_enriched([
            _t("EURJPY=X", "Euro / Yen"), _t("GBPJPY=X", "Pound / Yen"),
            _t("EURGBP=X", "Euro / Pound"), _t("EURCHF=X", "Euro / Swiss Franc"),
            _t("AUDJPY=X", "Aussie / Yen"), _t("AUDNZD=X", "Aussie / NZ Dollar"),
            _t("GBPCHF=X", "Pound / Swiss Franc"), _t("EURAUD=X", "Euro / Aussie"),
        ]),
        "Asia_Forex_USD_Pairs": _dedupe_enriched([
            _t("USDINR=X", "USD / Indian Rupee"), _t("USDCNY=X", "USD / Chinese Yuan"),
            _t("USDHKD=X", "USD / Hong Kong Dollar"), _t("USDSGD=X", "USD / Singapore Dollar"),
            _t("USDKRW=X", "USD / Korean Won"), _t("USDIDR=X", "USD / Indonesian Rupiah"),
            _t("USDTHB=X", "USD / Thai Baht"), _t("USDPHP=X", "USD / Philippine Peso"),
        ]),
    }


def get_commodities() -> dict[str, list[dict]]:
    print("Building broader commodity and India proxy coverage...")
    return {
        "Precious_Metals_Futures": _dedupe_enriched([
            _t("GC=F", "Gold Futures"), _t("SI=F", "Silver Futures"),
            _t("PL=F", "Platinum Futures"), _t("PA=F", "Palladium Futures"),
        ]),
        "Energy_Futures": _dedupe_enriched([
            _t("CL=F", "Crude Oil WTI"), _t("BZ=F", "Brent Crude"),
            _t("NG=F", "Natural Gas"), _t("RB=F", "RBOB Gasoline"), _t("HO=F", "Heating Oil"),
        ]),
        "Base_Metals_Futures": _dedupe_enriched([
            _t("HG=F", "Copper Futures"), _t("ALI=F", "Aluminum Futures"),
        ]),
        "Agriculture_Grains_Futures": _dedupe_enriched([
            _t("ZC=F", "Corn Futures"), _t("ZW=F", "Wheat Futures"),
            _t("ZS=F", "Soybean Futures"), _t("ZM=F", "Soybean Meal"),
            _t("ZL=F", "Soybean Oil"), _t("KE=F", "KC HRW Wheat"),
        ]),
        "Softs_Futures": _dedupe_enriched([
            _t("KC=F", "Coffee Arabica"), _t("SB=F", "Sugar #11"),
            _t("CC=F", "Cocoa"), _t("CT=F", "Cotton #2"), _t("OJ=F", "Orange Juice"),
        ]),
        "Livestock_Futures": _dedupe_enriched([
            _t("LE=F", "Live Cattle"), _t("HE=F", "Lean Hogs"), _t("GF=F", "Feeder Cattle"),
        ]),
    }


# ---------------------------------------------------------------------------
# MAIN AGGREGATOR
# ---------------------------------------------------------------------------

def main() -> None:
    print("Starting master ticker aggregation (enriched format with names)...")
    master_ticker_dict: dict[str, list[dict]] = {}

    # Indian markets (core)
    master_ticker_dict.update(get_indian_markets())
    master_ticker_dict.update(get_bse_markets())
    master_ticker_dict.update(get_indian_indices())
    master_ticker_dict.update(get_indian_etfs())

    # Indian bonds & G-Secs
    master_ticker_dict.update(get_indian_bonds())

    # Indian commodities (MCX proxies + ETFs)
    master_ticker_dict.update(get_indian_commodities())

    # INR currency pairs
    master_ticker_dict.update(get_inr_currencies())

    # Crypto (USD + INR pairs)
    master_ticker_dict.update(get_crypto())

    # City-wise precious metals (Gold/Silver/Platinum)
    master_ticker_dict.update(get_india_precious_metals_citywise())

    # US markets
    master_ticker_dict.update(get_us_markets())
    master_ticker_dict.update(get_additional_us_markets())

    # Global markets (all from Wikipedia)
    master_ticker_dict.update(get_global_markets())

    # Global forex
    master_ticker_dict.update(get_currencies())

    # Global commodities
    master_ticker_dict.update(get_commodities())

    # Summary
    total_categories = len(master_ticker_dict)
    total_tickers = sum(len(v) for v in master_ticker_dict.values())
    print(f"\nAggregated {total_tickers} tickers across {total_categories} categories.")

    output_file = "all_global_tickers.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(master_ticker_dict, f, indent=2, ensure_ascii=False)

    print(f"Saved comprehensive market universe to {output_file}.")
    try:
        registry = refresh_scheme_registry(force=True)
        print(f"Saved {registry.get('count', 0)} AMFI mutual fund schemes to context_data/india_mutual_funds/schemes.json.")
    except Exception as exc:
        print(f"Warning: failed to refresh AMFI mutual fund registry: {exc}")


if __name__ == "__main__":
    main()
