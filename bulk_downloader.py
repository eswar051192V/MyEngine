import yfinance as yf
import pandas as pd
import json
import os
import time
from tqdm import tqdm

# Configuration
DATA_DIR = "local_market_data"
# For testing, set this to 10. Once you verify it works, set to None to run all thousands of tickers.
TEST_LIMIT = 5 

def setup_directories():
    """Create the folder structure for the data warehouse."""
    directories = [
        f"{DATA_DIR}/15m",
        f"{DATA_DIR}/1h",
        f"{DATA_DIR}/1d",
        f"{DATA_DIR}/1wk"
    ]
    for d in directories:
        os.makedirs(d, exist_ok=True)

def get_all_symbols():
    """Extract a flat list of all symbols from your master JSON."""
    if not os.path.exists("all_global_tickers.json"):
        print("❌ Error: all_global_tickers.json not found. Run fetch_all_tickers.py first.")
        return []
        
    with open("all_global_tickers.json", "r") as f:
        data = json.load(f)
        
    all_symbols = []
    for category, symbols in data.items():
        all_symbols.extend(symbols)
        
    # Remove duplicates and sort
    return sorted(list(set(all_symbols)))

def download_ticker_data(symbol):
    """Download the specific timeframes and save to Parquet format."""
    ticker = yf.Ticker(symbol)
    success_count = 0
    
    try:
        # 1. Fetch last 60 days at 15-minute intervals (yfinance hard limit)
        df_15m = ticker.history(period="60d", interval="15m")
        if not df_15m.empty:
            df_15m.to_parquet(f"{DATA_DIR}/15m/{symbol}.parquet")
            success_count += 1
            
        # 2. Fetch last 2 years at 1-hour intervals (yfinance hard limit for intraday > 60d)
        df_1h = ticker.history(period="730d", interval="1h")
        if not df_1h.empty:
            df_1h.to_parquet(f"{DATA_DIR}/1h/{symbol}.parquet")
            success_count += 1
            
        # 3. Fetch beginning of time to today at Daily intervals
        df_1d = ticker.history(period="max", interval="1d")
        if not df_1d.empty:
            df_1d.to_parquet(f"{DATA_DIR}/1d/{symbol}.parquet")
            success_count += 1
            
        # 4. Fetch beginning of time to today at Weekly intervals
        df_1wk = ticker.history(period="max", interval="1wk")
        if not df_1wk.empty:
            df_1wk.to_parquet(f"{DATA_DIR}/1wk/{symbol}.parquet")
            success_count += 1
            
        return success_count > 0
        
    except Exception as e:
        # Silently fail for delisted or invalid tickers to keep the loop moving
        return False

def main():
    setup_directories()
    symbols = get_all_symbols()
    
    if not symbols:
        return
        
    if TEST_LIMIT:
        print(f"⚠️ TEST MODE ACTIVE: Only downloading the first {TEST_LIMIT} tickers.")
        symbols = symbols[:TEST_LIMIT]
        
    print(f"🚀 Starting bulk download for {len(symbols)} tickers...")
    print("📁 Data will be saved in compressed Parquet format inside /local_market_data")
    
    successful = 0
    failed = 0
    
    # Use tqdm to show a beautiful progress bar in the terminal
    for symbol in tqdm(symbols, desc="Downloading Market Data"):
        if download_ticker_data(symbol):
            successful += 1
        else:
            failed += 1
            
        # CRITICAL: Sleep for 1.5 seconds between tickers to prevent IP Ban
        time.sleep(1.5)
        
    print("\n✅ Bulk Download Complete!")
    print(f"📈 Successfully downloaded: {successful}")
    print(f"❌ Failed/No Data: {failed}")

if __name__ == "__main__":
    main()