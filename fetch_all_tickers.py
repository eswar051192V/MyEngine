import pandas as pd
import requests
import io
import json
from pytickersymbols import PyTickerSymbols

def get_indian_markets():
    print("Fetching Indian Markets (NSE & F&O)...")
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    session = requests.Session()
    session.headers.update(headers)
    
    # 1. NSE Equity Tickers (Official NSE CSV)
    nse_url = 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv'
    response = session.get(nse_url)
    nse_df = pd.read_csv(io.BytesIO(response.content))
    nse_tickers = nse_df['SYMBOL'].tolist()
    
    # 2. Indian Futures & Options (Official NSE F&O Lot CSV)
    fo_url = 'https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv'
    fo_response = session.get(fo_url)
    fo_df = pd.read_csv(io.BytesIO(fo_response.content))
    fo_df.columns = fo_df.columns.str.strip()
    fo_tickers = fo_df['UNDERLYING'].dropna().unique().tolist()
    
    return {
        "NSE_Equity": [f"{ticker}.NS" for ticker in nse_tickers],
        "NSE_Futures_Options_Underlying": [f"{ticker}.NS" for ticker in fo_tickers]
    }

def get_us_markets():
    print("Fetching US Markets (S&P 500, DOW, NASDAQ 100)...")
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    
    # 1. DOW Jones
    dow_url = 'https://en.wikipedia.org/wiki/Dow_Jones_Industrial_Average'
    dow_html = requests.get(dow_url, headers=headers).text
    dow_df = pd.read_html(io.StringIO(dow_html), attrs={'id': 'constituents'})[0]
    dow_tickers = dow_df['Symbol'].tolist()
    
    # 2. S&P 500
    sp500_url = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies'
    sp_html = requests.get(sp500_url, headers=headers).text
    sp_df = pd.read_html(io.StringIO(sp_html), attrs={'id': 'constituents'})[0]
    sp_tickers = sp_df['Symbol'].tolist()
    
    # 3. NASDAQ 100
    nasdaq_url = 'https://en.wikipedia.org/wiki/Nasdaq-100'
    nasdaq_html = requests.get(nasdaq_url, headers=headers).text
    nasdaq_df = pd.read_html(io.StringIO(nasdaq_html), attrs={'id': 'constituents'})[0]
    nasdaq_tickers = nasdaq_df['Ticker'].tolist()
    
    return {
        "DOW": dow_tickers,
        "NASDAQ_100": nasdaq_tickers,
        "SP_500": sp_tickers
    }

def get_global_markets():
    print("Fetching Global Markets (LSE, Tokyo, Hang Seng)...")
    stock_data = PyTickerSymbols()
    
    uk_ftse = [stock['symbol'] for stock in stock_data.get_stocks_by_index('FTSE 100')]
    tokyo_nikkei = [stock['symbol'] for stock in stock_data.get_stocks_by_index('NIKKEI 225')]
    hongkong_hangseng = [stock['symbol'] for stock in stock_data.get_stocks_by_index('HANG SENG')]
    germany_dax = [stock['symbol'] for stock in stock_data.get_stocks_by_index('DAX')]
    
    return {
        "LSE_FTSE100": uk_ftse,
        "Tokyo_Nikkei225": tokyo_nikkei,
        "HangSeng": hongkong_hangseng,
        "Germany_DAX": germany_dax
    }

def get_currencies():
    print("Fetching Currencies (Global Forex & INR Crosses)...")
    global_forex = [
        "EURUSD=X", "JPY=X", "GBPUSD=X", "AUDUSD=X", 
        "NZDUSD=X", "EURJPY=X", "GBPJPY=X", "USDCHF=X",
        "USDCAD=X", "USDCNY=X", "USDINR=X"
    ]
    inr_crosses = ["EURINR=X", "GBPINR=X", "JPYINR=X"]
    
    return {
        "Global_Forex": global_forex,
        "INR_Crosses": inr_crosses
    }

def get_commodities():
    print("Fetching Commodities (Global Benchmarks & Indian MCX Base)...")
    global_commodities = [
        "GC=F", "SI=F", "CL=F", "BZ=F", "NG=F", 
        "HG=F", "ALI=F", "ZC=F", "ZW=F"
    ]
    indian_mcx_base = [
        "GOLD", "GOLDM", "SILVER", "SILVERMIC", 
        "CRUDEOIL", "NATURALGAS", "COPPER", "ZINC", "LEAD", "ALUMINIUM"
    ]
    
    return {
        "Global_Commodities_Futures": global_commodities,
        "Indian_MCX_Underlying": indian_mcx_base
    }

def main():
    print("Starting master ticker aggregation...")
    
    master_ticker_dict = {}
    master_ticker_dict.update(get_indian_markets())
    master_ticker_dict.update(get_us_markets())
    master_ticker_dict.update(get_global_markets())
    master_ticker_dict.update(get_currencies())
    master_ticker_dict.update(get_commodities())
    
    output_file = "all_global_tickers.json"
    with open(output_file, "w") as f:
        json.dump(master_ticker_dict, f, indent=4)
        
    print(f"✅ Successfully saved thousands of tickers, currencies, and commodities to {output_file}!")

if __name__ == "__main__":
    main()