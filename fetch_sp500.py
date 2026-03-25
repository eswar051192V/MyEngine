import pandas as pd
import json
import os
import requests

def fetch_and_update_sp500():
    file_path = "all_global_tickers.json"
    
    print("🌐 Fetching live S&P 500 list from Wikipedia...")
    try:
        # 1. Disguise our Python script as a standard Google Chrome browser
        url = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies'
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        
        # 2. Fetch the page securely
        response = requests.get(url, headers=headers)
        response.raise_for_status() # Verify we got a 200 OK response
        
        # 3. Pass the raw HTML text to pandas to find the tables
        tables = pd.read_html(response.text)
        sp500_table = tables[0]
        
        # Extract the 'Symbol' column to a list
        raw_tickers = sp500_table['Symbol'].tolist()
        
        # Yahoo Finance uses hyphens instead of dots for class shares (e.g. BRK.B -> BRK-B)
        clean_tickers = [ticker.replace('.', '-') for ticker in raw_tickers]
        
        print(f"✅ Successfully fetched {len(clean_tickers)} S&P 500 tickers.")
        
        # Load your existing database
        data = {}
        if os.path.exists(file_path):
            with open(file_path, "r") as f:
                data = json.load(f)
                
        # Add the new category
        category_name = "US Equity (S&P 500)"
        data[category_name] = sorted(clean_tickers)
        
        # Save it back to your Mac
        with open(file_path, "w") as f:
            json.dump(data, f, indent=4)
            
        print(f"💾 Saved successfully! Added '{category_name}' to your local database.")
        
    except Exception as e:
        print(f"❌ Failed to fetch S&P 500: {str(e)}")

if __name__ == "__main__":
    fetch_and_update_sp500()