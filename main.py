from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
import os
import yfinance as yf
import pandas as pd
import numpy as np
import requests
import asyncio
import random

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# 🔑 BROKER CREDENTIALS & SDK SETUP
# ==========================================
UPSTOX_ACCESS_TOKEN = "YOUR_UPSTOX_TOKEN_HERE"
ZERODHA_API_KEY = "YOUR_ZERODHA_API_KEY"
ZERODHA_ACCESS_TOKEN = "YOUR_ZERODHA_TOKEN"

UPSTOX_INDEX_MAP = {
    "^NSEBANK": "NSE_INDEX|Nifty Bank",
    "^NSEI": "NSE_INDEX|Nifty 50",
    "^CNXFIN": "NSE_INDEX|Nifty Fin Service",
    "^NSEMDCP50": "NSE_INDEX|Nifty Midcap 50"
}

CURRENCY_SYMBOLS = {'USD': '$', 'INR': '₹', 'GBP': '£', 'EUR': '€', 'JPY': '¥', 'CAD': 'C$', 'AUD': 'A$', 'CNY': '¥'}

class AIAnalysisRequest(BaseModel):
    symbol: str
    price: float
    zoneLabel: str
    positionPct: str
    daysActive: int
    model: str = "llama3" 
    customPrompt: str = None 

class CronJobRequest(BaseModel):
    category: str
    lookback: int
    cron_schedule: str

# ==========================================
# ⚡ WEBSOCKET CONNECTION MANAGER
# ==========================================
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except RuntimeError:
                pass 

manager = ConnectionManager()

@app.websocket("/ws/live/{symbol}")
async def live_ticker_socket(websocket: WebSocket, symbol: str):
    await manager.connect(websocket)
    try:
        base_price = 100.0
        try:
            ticker = yf.Ticker(symbol)
            base_price = ticker.info.get("regularMarketPrice", 100.0)
        except: pass

        while True:
            fluctuation = random.uniform(-0.05, 0.05)
            base_price = base_price * (1 + (fluctuation / 100))
            payload = { "symbol": symbol, "live_price": round(base_price, 2), "volume_tick": random.randint(1, 500) }
            
            await websocket.send_text(json.dumps(payload))
            await asyncio.sleep(0.5) 

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        manager.disconnect(websocket)

# ==========================================
# TICKER & ASSET ENDPOINTS (REST)
# ==========================================
@app.get("/api/tickers")
def get_all_tickers():
    file_path = "all_global_tickers.json"
    if os.path.exists(file_path):
        with open(file_path, "r") as f:
            return json.load(f)
    return {"error": "Ticker file not found."}

@app.get("/api/ticker/{symbol}")
def get_ticker_details(symbol: str):
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info
        current_price = info.get("currentPrice") or info.get("regularMarketPrice", 0)
        prev_close = info.get("previousClose") or info.get("regularMarketPreviousClose", 0)
        curr_symbol = CURRENCY_SYMBOLS.get(info.get("currency", "USD"), "$")
        change = current_price - prev_close if current_price and prev_close else 0
        change_pct = (change / prev_close) * 100 if prev_close else 0

        news_data = []
        if ticker.news:
            for n in ticker.news[:5]:
                news_data.append({"title": n.get("title", "Market Update"), "link": n.get("link", "#"), "publisher": n.get("publisher", "Market Feed")})

        return {
            "symbol": symbol, "name": info.get("shortName", info.get("longName", symbol)),
            "price": round(current_price, 2), "prevClose": round(prev_close, 2),
            "currencySymbol": curr_symbol, "change": round(change, 2), "changePct": round(change_pct, 2),
            "marketCap": info.get("marketCap", 0), "peRatio": round(info.get("trailingPE", 0), 2) if info.get("trailingPE") else "N/A",
            "high52": round(info.get("fiftyTwoWeekHigh", 0), 2) if info.get("fiftyTwoWeekHigh") else "N/A",
            "low52": round(info.get("fiftyTwoWeekLow", 0), 2) if info.get("fiftyTwoWeekLow") else "N/A",
            "description": info.get("longBusinessSummary", "No company profile available for this asset."), "news": news_data
        }
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/ticker/{symbol}/ohlc")
def get_ohlc_data(symbol: str, timeframe: str = "1Y"):
    tf_map = {
        "1D": {"period": "1d", "interval": "1m"},
        "7D": {"period": "7d", "interval": "1m"},
        "2W": {"period": "1mo", "interval": "15m"},
        "1M": {"period": "1mo", "interval": "30m"},
        "3M": {"period": "3mo", "interval": "1d"},
        "6M": {"period": "6mo", "interval": "1d"},
        "1Y": {"period": "1y", "interval": "1d"},
        "2Y": {"period": "2y", "interval": "1d"},
        "5Y": {"period": "5y", "interval": "1d"},
        "10Y": {"period": "10y", "interval": "1wk"},
        "MAX": {"period": "max", "interval": "1wk"}
    }
    
    config = tf_map.get(timeframe, tf_map["1Y"])
    
    try:
        df = yf.Ticker(symbol).history(period=config["period"], interval=config["interval"])
        if df.empty:
            return []

        if timeframe == "2W":
            cutoff = df.index.max() - pd.Timedelta(days=14)
            df = df[df.index >= cutoff]

        ohlc = []
        for date, row in df.iterrows():
            if config["interval"] in ["1m", "5m", "15m", "30m", "60m", "1h"]:
                date_str = date.strftime('%Y-%m-%d %H:%M:%S')
            else:
                date_str = date.strftime('%Y-%m-%d')
                
            ohlc.append({
                "x": date_str,
                "y": [round(row['Open'], 2), round(row['High'], 2), round(row['Low'], 2), round(row['Close'], 2)],
                "volume": int(row.get('Volume', 0))
            })
        return ohlc
    except Exception as e:
        print(f"Failed to fetch OHLC: {e}")
        return []

@app.get("/api/ticker/{symbol}/options")
def get_ticker_options(symbol: str, date: str = None):
    if symbol in UPSTOX_INDEX_MAP:
        if not UPSTOX_ACCESS_TOKEN or UPSTOX_ACCESS_TOKEN == "YOUR_UPSTOX_TOKEN_HERE":
            return {"error": "Upstox Access Token is missing in main.py"}
        try:
            instrument_key = UPSTOX_INDEX_MAP[symbol]
            params = {"instrument_key": instrument_key}
            if date: params["expiry_date"] = date
            res = requests.get("https://api.upstox.com/v2/option/chain", params=params, headers={"Accept": "application/json", "Authorization": f"Bearer {UPSTOX_ACCESS_TOKEN}"})
            
            if res.status_code != 200: return {"error": f"Upstox API Error: {res.text}"}
            data = res.json().get("data", [])
            if not data: return {"error": "No options derivatives available for this asset on Upstox."}
                
            calls, puts, expirations = [], [], set()
            current_price = yf.Ticker(symbol).info.get("regularMarketPrice", 0)
            
            for item in data:
                strike = item.get("strike_price")
                if item.get("expiry"): expirations.add(item.get("expiry"))
                ce, pe = item.get("call_options", {}), item.get("put_options", {})
                if ce: calls.append({"strike": strike, "lastPrice": ce.get("market_data", {}).get("ltp", 0), "impliedVolatility": ce.get("market_data", {}).get("iv", 0), "openInterest": ce.get("market_data", {}).get("oi", 0)})
                if pe: puts.append({"strike": strike, "lastPrice": pe.get("market_data", {}).get("ltp", 0), "impliedVolatility": pe.get("market_data", {}).get("iv", 0), "openInterest": pe.get("market_data", {}).get("oi", 0)})

            sorted_expirations = sorted(list(expirations))
            return {"expirations": sorted_expirations, "selected_date": date or sorted_expirations[0], "current_price": current_price, "calls": calls, "puts": puts}
        except Exception as e:
            return {"error": f"Upstox Routing Failed: {str(e)}"}

    try:
        ticker = yf.Ticker(symbol)
        expirations = ticker.options
        if not expirations: return {"error": "No options derivatives available for this asset."}
        target_date = date if date in expirations else expirations[0]
        opt_chain = ticker.option_chain(target_date)
        current_price = ticker.info.get("regularMarketPrice", 0)
        
        calls = opt_chain.calls.replace([np.inf, -np.inf, np.nan], 0)
        puts = opt_chain.puts.replace([np.inf, -np.inf, np.nan], 0)

        return {
            "expirations": list(expirations), "selected_date": target_date, "current_price": current_price,
            "calls": calls[['strike', 'lastPrice', 'impliedVolatility', 'openInterest']].to_dict(orient='records'),
            "puts": puts[['strike', 'lastPrice', 'impliedVolatility', 'openInterest']].to_dict(orient='records')
        }
    except Exception as e:
        return {"error": f"Failed to fetch Yahoo options chain. {str(e)}"}

@app.post("/api/ticker/{symbol}/download")
def download_ticker_data_on_demand(symbol: str):
    DATA_DIR = "local_market_data"
    for folder in ["1h", "1d", "1wk", "1mo", "options"]: os.makedirs(f"{DATA_DIR}/{folder}", exist_ok=True)
    try:
        ticker = yf.Ticker(symbol)
        stats = {}
        for tf, period, interval in [("1h", "730d", "1h"), ("1d", "max", "1d"), ("1wk", "max", "1wk"), ("1mo", "max", "1mo")]:
            df = ticker.history(period=period, interval=interval)
            if not df.empty:
                df.to_parquet(f"{DATA_DIR}/{tf}/{symbol}.parquet")
                stats[f'{tf}_rows'] = len(df)
        return {"status": "success", "records_saved": stats}
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/screener/cron")
def setup_screener_cron(data: CronJobRequest):
    return {"status": "success", "message": f"Cron Job set for {data.category} on schedule {data.cron_schedule}"}

@app.post("/api/ai/analyze")
def analyze_setup_ollama(data: AIAnalysisRequest):
    prompt = data.customPrompt or f"""
    You are an elite quantitative trader. Analyze this structural setup:
    - Asset: {data.symbol}
    - Current Price: {data.price}
    - Pitchfork Geometry: Active for {data.daysActive} days
    - Proximity: {data.positionPct}% ({data.zoneLabel})
    
    Provide a concise, 3-bullet-point trading thesis (Risk, Reward, Actionable Play). Keep it under 100 words. No fluff.
    """
    try:
        response = requests.post('http://localhost:11434/api/generate', json={"model": data.model, "prompt": prompt, "stream": False})
        if response.status_code == 200: return {"analysis": response.json().get("response", "No response generated.")}
        else: return {"error": f"Ollama error: {response.text}"}
    except requests.exceptions.ConnectionError:
         return {"error": "Failed to connect. Is Ollama running on your machine? Run 'ollama run llama3' in your terminal."}
    except Exception as e:
        return {"error": f"Unexpected error: {str(e)}"}