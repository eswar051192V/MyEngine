import json

def format_master_database():
    try:
        with open("all_global_tickers.json", "r") as f:
            data = json.load(f)
    except FileNotFoundError:
        print("❌ Please save your JSON data into a file named 'raw_tickers.json' first.")
        return

    cleaned_data = {}

    # Yahoo's specific internal codes for Indian Indices
    INDEX_MAP = {
        "NIFTY 50": "^NSEI",
        "NIFTY BANK": "^NSEBANK",
        "NIFTY FINANCIAL SERVICES": "^CNXFIN",
        "NIFTY MID SELECT": "^NSEMDCP50",
        "NIFTY NEXT 50": "^NSMIDCP"
    }

    # Yahoo doesn't track MCX, so we map to the exact Global Comex/Nymex equivalents
    MCX_MAP = {
        "GOLD": "GC=F",
        "GOLDM": "GC=F",
        "SILVER": "SI=F",
        "SILVERMIC": "SI=F",
        "CRUDEOIL": "CL=F",
        "NATURALGAS": "NG=F",
        "COPPER": "HG=F",
        "ALUMINIUM": "ALI=F"
    }

    for category, tickers in data.items():
        valid_tickers = []
        
        for ticker in tickers:
            clean_t = ticker.strip()

            # 1. Clean US Equities (BRK.B -> BRK-B)
            if category in ["SP_500", "DOW", "NASDAQ_100"]:
                clean_t = clean_t.replace(".", "-")
                valid_tickers.append(clean_t)
                continue

            # 2. Clean Indian Indices
            if category == "NSE_Futures_Options_Underlying":
                # Extract the base name without the massive spaces and .NS
                base_name = clean_t.split(".NS")[0].strip()
                if base_name in INDEX_MAP:
                    valid_tickers.append(INDEX_MAP[base_name])
                # We ignore the rest of this category because the actual valid stock 
                # symbols are already cleanly stored in your "NSE_Equity" category.
                continue

            # 3. Clean MCX Commodities to Global Equivalents
            if category == "Indian_MCX_Underlying":
                if clean_t in MCX_MAP:
                    valid_tickers.append(MCX_MAP[clean_t])
                continue

            # 4. Standard Cleanup for everything else
            clean_t = clean_t.replace(" .NS", ".NS")
            valid_tickers.append(clean_t)

        # Remove duplicates and save
        if valid_tickers:
            cleaned_data[category] = sorted(list(set(valid_tickers)))

    # Save the perfected database for the React App to consume
    with open("all_global_tickers.json", "w") as f:
        json.dump(cleaned_data, f, indent=4)
        
    print("✅ Successfully formatted all_global_tickers.json!")
    print("Refresh your React dashboard. Every chart should now load perfectly.")

if __name__ == "__main__":
    format_master_database()