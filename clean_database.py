import json
import os
import shutil
import yfinance as yf
from concurrent.futures import ThreadPoolExecutor, as_completed

# 1. Map the known broken indices to their actual Yahoo codes
INDEX_MAP = {
    "NIFTY 50 .NS": "^NSEI",
    "NIFTY BANK .NS": "^NSEBANK",
    "NIFTY FINANCIAL SERVICES .NS": "^CNXFIN",
    "NIFTY MID SELECT .NS": "^NSEMDCP50",
    "NIFTY NEXT 50 .NS": "^NSMIDCP",
    "INDIA VIX .NS": "^INDIAVIX"
}

def is_valid_ticker(symbol):
    """Pings Yahoo Finance to see if the symbol actually returns data."""
    try:
        # Quickest API call to verify existence without downloading massive data
        hist = yf.Ticker(symbol).history(period="1d")
        if not hist.empty:
            return symbol
    except:
        pass
    return None

def full_json_repair():
    file_path = "all_global_tickers.json"
    backup_path = "all_global_tickers_backup.json"
    
    if not os.path.exists(file_path):
        print(f"❌ Error: {file_path} not found.")
        return

    # Create a safe backup before we destroy the garbage data
    shutil.copy(file_path, backup_path)
    
    with open(file_path, "r") as f:
        data = json.load(f)

    print("🚀 Starting Full Global Database Verification...")
    print("This will test every single ticker against Yahoo Finance's live servers.")
    
    cleaned_data = {}
    total_valid = 0
    total_removed = 0

    for category, tickers in data.items():
        print(f"\n📁 Scanning Category: {category} ({len(tickers)} items)")
        
        # Step 1: Clean basic strings and map indices
        processed_tickers = []
        for t in tickers:
            clean_t = t.strip()
            clean_t = clean_t.replace(" .NS", ".NS") # Fix accidental spaces before the suffix
            
            # Apply the index map if it matches
            if clean_t in INDEX_MAP:
                processed_tickers.append(INDEX_MAP[clean_t])
            else:
                processed_tickers.append(clean_t)
                
        # Remove duplicates before hitting the API
        processed_tickers = list(set(processed_tickers))
        
        valid_for_category = []
        
        # Step 2: Multi-threaded live verification (Fast!)
        # We use 20 workers to test 20 tickers simultaneously
        with ThreadPoolExecutor(max_workers=20) as executor:
            future_to_symbol = {executor.submit(is_valid_ticker, sym): sym for sym in processed_tickers}
            
            for future in as_completed(future_to_symbol):
                result = future.result()
                if result:
                    valid_for_category.append(result)
                else:
                    total_removed += 1
                    
        # Step 3: Save category only if it has valid tickers surviving
        if valid_for_category:
            cleaned_data[category] = sorted(valid_for_category)
            total_valid += len(valid_for_category)
            print(f"  ✅ Kept {len(valid_for_category)} valid assets. Dropped invalid ones.")

    # Step 4: Overwrite the JSON with 100% working data
    with open(file_path, "w") as f:
        json.dump(cleaned_data, f, indent=4)
        
    print("\n" + "="*50)
    print("🎯 FULL DATABASE REPAIR COMPLETE!")
    print(f"📈 Total Valid, Working Tickers: {total_valid}")
    print(f"🗑️ Total Garbage/Broken Tickers Purged: {total_removed}")
    print("="*50)

if __name__ == "__main__":
    full_json_repair()