from __future__ import annotations

import json

from market_universe import INDEX_PROXY_MAP

LEGACY_MCX_MAP = {
    "GOLD": "GC=F",
    "GOLDM": "GC=F",
    "SILVER": "SI=F",
    "SILVERMIC": "SI=F",
    "CRUDEOIL": "CL=F",
    "NATURALGAS": "NG=F",
    "COPPER": "HG=F",
    "ALUMINIUM": "ALI=F",
}


def _dedupe_sorted(symbols: list[str]) -> list[str]:
    return sorted({str(symbol).strip() for symbol in symbols if str(symbol).strip()})


def format_master_database() -> None:
    try:
        with open("all_global_tickers.json", "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print("Missing all_global_tickers.json. Run fetch_all_tickers.py first.")
        return

    cleaned_data: dict[str, list[str]] = {}
    legacy_mcx_proxy: list[str] = []
    legacy_fo_index_proxy: list[str] = []
    legacy_fo_stocks: list[str] = []

    for category, tickers in data.items():
        valid_tickers: list[str] = []
        for ticker in tickers:
            clean_t = str(ticker).strip().replace(" .NS", ".NS")
            if not clean_t:
                continue

            if category in {"SP_500", "DOW", "NASDAQ_100"}:
                valid_tickers.append(clean_t.replace(".", "-"))
                continue

            if category == "Indian_MCX_Underlying":
                mapped = LEGACY_MCX_MAP.get(clean_t)
                if mapped:
                    legacy_mcx_proxy.append(mapped)
                continue

            if category == "NSE_Futures_Options_Underlying":
                if clean_t in INDEX_PROXY_MAP:
                    proxy = INDEX_PROXY_MAP[clean_t]
                    legacy_fo_index_proxy.append(proxy)
                    valid_tickers.append(proxy)
                elif clean_t.endswith(".NS") or clean_t.startswith("^"):
                    if clean_t.startswith("^"):
                        legacy_fo_index_proxy.append(clean_t)
                    else:
                        legacy_fo_stocks.append(clean_t)
                    valid_tickers.append(clean_t)
                else:
                    legacy_fo_stocks.append(f"{clean_t}.NS")
                    valid_tickers.append(f"{clean_t}.NS")
                continue

            valid_tickers.append(clean_t)

        if valid_tickers:
            cleaned_data[category] = _dedupe_sorted(valid_tickers)

    if legacy_mcx_proxy:
        cleaned_data["Indian_MCX_Proxy_Basket"] = _dedupe_sorted(legacy_mcx_proxy)
    if legacy_fo_index_proxy:
        cleaned_data["NSE_Futures_Indices_Proxy"] = _dedupe_sorted(
            cleaned_data.get("NSE_Futures_Indices_Proxy", []) + legacy_fo_index_proxy
        )
    if legacy_fo_stocks:
        cleaned_data["NSE_Futures_Stock_Underlyings"] = _dedupe_sorted(
            cleaned_data.get("NSE_Futures_Stock_Underlyings", []) + legacy_fo_stocks
        )

    with open("all_global_tickers.json", "w", encoding="utf-8") as f:
        json.dump(cleaned_data, f, indent=2, ensure_ascii=False)

    print("Normalized all_global_tickers.json without collapsing India proxy categories.")


if __name__ == "__main__":
    format_master_database()