import React, { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'react-apexcharts';

// =========================================================================
// 1. PURE MATHEMATICS & UTILITIES (No State)
// =========================================================================

const formatLargeNumber = (num) => {
    if (!num || num === 0 || num === "N/A") return "N/A";
    if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    return num.toLocaleString();
};

const calculateMaxPain = (calls, puts) => {
    if (!calls || !puts || calls.length === 0) return null;
    let strikes = new Set([...calls.map(c => c.strike), ...puts.map(p => p.strike)]);
    strikes = Array.from(strikes).sort((a, b) => a - b);
    let minLoss = Infinity, maxPainStrike = 0;
    strikes.forEach(strike => {
        let loss = 0;
        calls.forEach(c => { if (c.strike < strike) loss += (strike - c.strike) * (c.openInterest || 1); });
        puts.forEach(p => { if (p.strike > strike) loss += (p.strike - strike) * (p.openInterest || 1); });
        if (loss < minLoss) { minLoss = loss; maxPainStrike = strike; }
    });
    return maxPainStrike;
};

const calculateSMA = (data, period) => {
    let sma = []; let sum = 0;
    for (let i = 0; i < data.length; i++) {
        sum += data[i].y[3]; 
        if (i >= period) sum -= data[i - period].y[3]; 
        if (i >= period - 1) sma.push({ x: data[i].x, y: parseFloat((sum / period).toFixed(2)) });
        else sma.push({ x: data[i].x, y: null });
    }
    return sma;
};

const calculateEMA = (data, period) => {
    let ema = []; const k = 2 / (period + 1); let emaPrev = null;
    for (let i = 0; i < data.length; i++) {
        const close = data[i].y[3];
        if (i < period - 1) ema.push({ x: data[i].x, y: null });
        else if (i === period - 1) {
            let sum = 0; for (let j = 0; j < period; j++) sum += data[i - j].y[3];
            emaPrev = sum / period; ema.push({ x: data[i].x, y: parseFloat(emaPrev.toFixed(2)) });
        } else {
            emaPrev = (close - emaPrev) * k + emaPrev;
            ema.push({ x: data[i].x, y: parseFloat(emaPrev.toFixed(2)) });
        }
    }
    return ema;
};

const findActivePitchforks = (data, lookbackDays = 5475, type = 'Standard') => { 
    if (!data || data.length < 5) return [];
    const pitchforks = [];
    const endX = data.length - 1;
    const currentClose = data[endX].y[3]; 
    const cutoffTime = new Date().getTime() - (lookbackDays * 24 * 60 * 60 * 1000);
    const startScanIndex = Math.max(1, data.length - 1500);

    for (let i = startScanIndex; i < data.length - 1; i++) {
        const p1 = data[i-1], p2 = data[i], p3 = data[i+1];
        if (new Date(p2.x).getTime() < cutoffTime) continue;

        const h1 = p1.y[1], h2 = p2.y[1], h3 = p3.y[1];
        const l1 = p1.y[2], l2 = p2.y[2], l3 = p3.y[2];

        let pivotType = null, y1, y2, y3, pivotPrice;
        if (h2 > h1 && h2 > h3) { pivotType = 'LHL'; y1 = h1; y2 = h2; y3 = h3; pivotPrice = h2; }
        else if (l2 < l1 && l2 < l3) { pivotType = 'HLH'; y1 = l1; y2 = l2; y3 = l3; pivotPrice = l2; }

        if (pivotType) {
            const x1 = i - 1, x2 = i, x3 = i + 1;
            const midIndexX = (x2 + x3) / 2, midY = (y2 + y3) / 2;

            let originIndexX = x1, originY = y1, originTime = new Date(p1.x).getTime();
            if (type === 'Schiff') {
                originIndexX = x1 + (x2 - x1) / 2; originY = y1 + (y2 - y1) / 2; originTime = (new Date(p1.x).getTime() + new Date(p2.x).getTime()) / 2;
            } else if (type === 'Modified') {
                originIndexX = x1; originY = y1 + (y2 - y1) / 2; originTime = new Date(p1.x).getTime();
            }
            const slope = (midY - originY) / (midIndexX - originIndexX);

            let isUnbroken = true, daysActive = 0;
            for (let j = x3 + 1; j < data.length; j++) {
                const checkClose = data[j].y[3]; 
                const upperBound = Math.max(y2 + slope * (j - x2), y3 + slope * (j - x3));
                const lowerBound = Math.min(y2 + slope * (j - x2), y3 + slope * (j - x3));
                if (checkClose > upperBound || checkClose < lowerBound) { isUnbroken = false; break; }
                daysActive++;
            }

            if (isUnbroken && daysActive >= 3) {
                const currentUpper = Math.max(y2 + slope * (endX - x2), y3 + slope * (endX - x3));
                const currentLower = Math.min(y2 + slope * (endX - x2), y3 + slope * (endX - x3));
                const range = currentUpper - currentLower;
                const positionPct = range !== 0 ? ((currentClose - currentLower) / range) * 100 : 50;
                
                let zoneLabel = "Neutral Zone", zoneColor = "#888888"; 
                if (positionPct <= 20) { zoneLabel = "Testing Support"; zoneColor = "#10B981"; } 
                else if (positionPct >= 80) { zoneLabel = "Testing Resistance"; zoneColor = "#EF4444"; } 
                else if (positionPct >= 45 && positionPct <= 55) { zoneLabel = "Testing Median"; zoneColor = "#F59E0B"; } 

                pitchforks.push({
                    type: pivotType, variation: type, date: p2.x, dataIndex: i, daysActive, price: pivotPrice,
                    positionPct: positionPct.toFixed(1), zoneLabel, zoneColor,
                    nearnessScore: Math.min(positionPct, 100 - positionPct, Math.abs(50 - positionPct)),
                    series: [
                        { name: `PF Median`, type: 'line', data: [{x: originTime, y: originY}, {x: new Date(data[endX].x).getTime(), y: originY + (slope * (endX - originIndexX))}] },
                        { name: 'PF Upper', type: 'line', data: [{x: new Date(p2.x).getTime(), y: y2}, {x: new Date(data[endX].x).getTime(), y: y2 + (slope * (endX - x2))}] },
                        { name: 'PF Lower', type: 'line', data: [{x: new Date(p3.x).getTime(), y: y3}, {x: new Date(data[endX].x).getTime(), y: y3 + (slope * (endX - x3))}] }
                    ]
                });
            }
        }
    }
    return pitchforks.sort((a, b) => a.nearnessScore - b.nearnessScore);
};

// =========================================================================
// 2. THE LOGIC ENGINE (Custom Hook)
// =========================================================================
function useQuantEngine() {
    // Global App State
    const [viewMode, setViewMode] = useState('index'); 
    const [loading, setLoading] = useState(true);
    const [tickersData, setTickersData] = useState({});
    
    // Index State
    const [searchInput, setSearchInput] = useState(''); 
    const [searchTerm, setSearchTerm] = useState('');   

    // Terminal State
    const [selectedTicker, setSelectedTicker] = useState(null);
    const [tickerDetails, setTickerDetails] = useState(null);
    const [ohlcData, setOhlcData] = useState([]);
    const [optionsData, setOptionsData] = useState(null);
    const [currentTimeframe, setCurrentTimeframe] = useState('1Y'); 
    const [chartLoading, setChartLoading] = useState(false);
    const [mathCalculating, setMathCalculating] = useState(false); 
    const [optionsLoading, setOptionsLoading] = useState(false); 
    const [isSyncing, setIsSyncing] = useState(false);           
    
    // Indicators & Chart Display
    const [chartDisplayType, setChartDisplayType] = useState('candle'); // 'candle', 'line', 'both'
    const [showVolume, setShowVolume] = useState(true);
    const [showEMA20, setShowEMA20] = useState(false);
    const [showSMA50, setShowSMA50] = useState(false);
    const [showSMA200, setShowSMA200] = useState(false);
    const [showPitchfork, setShowPitchfork] = useState(false);
    const [chartZoom, setChartZoom] = useState({ min: undefined, max: undefined });

    // Geometric Math State
    const [pitchforkType, setPitchforkType] = useState('Standard'); 
    const [hasScannedPitchforks, setHasScannedPitchforks] = useState(false);
    const [detectedPivots, setDetectedPivots] = useState([]);
    const [activePivotIndex, setActivePivotIndex] = useState(0);

    // Screener State
    const [screenerCategory, setScreenerCategory] = useState('');
    const [screenerLookback, setScreenerLookback] = useState(365);
    const [isScreening, setIsScreening] = useState(false);
    const [screenerResults, setScreenerResults] = useState([]);
    const [screenerProgress, setScreenerProgress] = useState({ current: 0, total: 0, symbol: '' });

    // AI Chat State
    const [userPrompt, setUserPrompt] = useState("");
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [chatHistory, setChatHistory] = useState([
        { role: 'system', text: 'Quant Engine Initialized. Enter a ticker (e.g. $AAPL), type /SCAN, or ask for analysis.' }
    ]);
    const chatEndRef = useRef(null);

    // Live Socket
    const ws = useRef(null);
    const [liveStatus, setLiveStatus] = useState("DISCONNECTED");

    // --- EFFECTS ---
    useEffect(() => {
        const timer = setTimeout(() => setSearchTerm(searchInput.toUpperCase()), 300);
        return () => clearTimeout(timer);
    }, [searchInput]);

    useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatHistory]);

    useEffect(() => {
        fetch('http://127.0.0.1:8000/api/tickers')
        .then(res => res.json())
        .then(data => { 
            if(!data.error) { setTickersData(data); setScreenerCategory(Object.keys(data)[0] || ''); }
            setLoading(false); 
        }).catch(err => { console.error("API Offline", err); setLoading(false); });
    }, []);

    // WebSocket Effect
    useEffect(() => {
        if (viewMode === 'terminal' && selectedTicker) {
            if (ws.current) ws.current.close();
            ws.current = new WebSocket(`ws://127.0.0.1:8000/ws/live/${selectedTicker}`);
            ws.current.onopen = () => setLiveStatus("LIVE");
            ws.current.onclose = () => setLiveStatus("DISCONNECTED");
            ws.current.onmessage = (event) => {
                const data = JSON.parse(event.data);
                setTickerDetails(prev => {
                    if(!prev) return prev;
                    const newChange = data.live_price - prev.prevClose;
                    return { ...prev, price: data.live_price, change: parseFloat(newChange.toFixed(2)), changePct: parseFloat(((newChange / prev.prevClose) * 100).toFixed(2)) };
                });
                setOhlcData(prevData => {
                    if (!prevData || prevData.length === 0) return prevData;
                    const newData = [...prevData];
                    const lastIndex = newData.length - 1;
                    const currentCandle = newData[lastIndex];
                    currentCandle.y[3] = data.live_price;
                    if (data.live_price > currentCandle.y[1]) currentCandle.y[1] = data.live_price; 
                    if (data.live_price < currentCandle.y[2]) currentCandle.y[2] = data.live_price;
                    newData[lastIndex] = { ...currentCandle };
                    return newData;
                });
            };
            return () => { if (ws.current) ws.current.close(); };
        }
    }, [selectedTicker, viewMode]);

    // Geometric Scan Effect
    useEffect(() => {
        if (viewMode === 'terminal' && showPitchfork && ohlcData.length > 0) {
            setMathCalculating(true);
            setTimeout(() => {
                const forks = findActivePitchforks(ohlcData, screenerLookback, pitchforkType);
                setDetectedPivots(forks.slice(0, 5));
                setActivePivotIndex(0); setHasScannedPitchforks(true);
                setUserPrompt("");
                if(forks.length > 0) handlers.handlePivotClick(0, forks);
                setMathCalculating(false);
            }, 50);
        }
    }, [pitchforkType, showPitchfork]); // Trigger when Pitchfork turned on or type changed


    // --- HANDLERS & LOGIC ---
    const handlers = {
        resetZoom: () => setChartZoom({ min: undefined, max: undefined }),
        
        cycleChartType: () => {
            if (chartDisplayType === 'candle') setChartDisplayType('line');
            else if (chartDisplayType === 'line') setChartDisplayType('both');
            else setChartDisplayType('candle');
        },

        handlePivotClick: (idx, customPivots = detectedPivots) => {
            setActivePivotIndex(idx);
            setUserPrompt("");
            const pivot = customPivots[idx];
            if (ohlcData && ohlcData.length > 0) {
                const startIdx = Math.max(0, pivot.dataIndex - 10);
                setChartZoom({ min: new Date(ohlcData[startIdx].x).getTime(), max: new Date(ohlcData[ohlcData.length - 1].x).getTime() });
            }
        },

        openTerminal: async (symbol, tf = '1Y', autoScan = false) => {
            setViewMode('terminal');
            setChartLoading(true);
            setCurrentTimeframe(tf);
            
            if (symbol !== selectedTicker) {
                setSelectedTicker(symbol); setTickerDetails(null); setOptionsData(null); setOhlcData([]);
                setDetectedPivots([]); setHasScannedPitchforks(false); 
                setShowPitchfork(autoScan); setChartZoom({ min: undefined, max: undefined });
            } else if (autoScan) setShowPitchfork(true);
      
            try {
              const [detailRes, ohlcRes, optRes] = await Promise.all([
                fetch(`http://127.0.0.1:8000/api/ticker/${symbol}`),
                fetch(`http://127.0.0.1:8000/api/ticker/${symbol}/ohlc?timeframe=${tf}`),
                fetch(`http://127.0.0.1:8000/api/ticker/${symbol}/options`)
              ]);
              
              setTickerDetails(await detailRes.json());
              const rawOhlc = await ohlcRes.json();
              setOhlcData(rawOhlc);
              setOptionsData(await optRes.json());
      
              if (autoScan && rawOhlc.length > 0) {
                  setMathCalculating(true);
                  setTimeout(() => {
                      const forks = findActivePitchforks(rawOhlc, screenerLookback, pitchforkType);
                      setDetectedPivots(forks.slice(0, 5));
                      setActivePivotIndex(0); setHasScannedPitchforks(true);
                      if(forks.length > 0) {
                          const startIdx = Math.max(0, forks[0].dataIndex - 10);
                          setChartZoom({ min: new Date(rawOhlc[startIdx].x).getTime(), max: new Date(rawOhlc[rawOhlc.length - 1].x).getTime() });
                      }
                      setMathCalculating(false);
                  }, 50);
              }
            } catch (err) { console.error(err); } 
            finally { setChartLoading(false); }
        },

        runMarketScreener: async () => {
            if (!screenerCategory || !tickersData[screenerCategory]) return;
            const symbolsToScan = tickersData[screenerCategory];
            setViewMode('screener');
            setIsScreening(true); setScreenerResults([]);
            
            const foundResults = [];
            for (let i = 0; i < symbolsToScan.length; i++) {
                const sym = symbolsToScan[i];
                setScreenerProgress({ current: i + 1, total: symbolsToScan.length, symbol: sym });
                await new Promise(resolve => setTimeout(resolve, 5)); 
      
                try {
                    const res = await fetch(`http://127.0.0.1:8000/api/ticker/${sym}/ohlc?timeframe=10Y`);
                    const data = await res.json();
                    if (data && data.length > 50) {
                        const forks = findActivePitchforks(data, screenerLookback, pitchforkType);
                        if (forks.length > 0) foundResults.push({ symbol: sym, fork: forks[0] });
                    }
                } catch (e) {}
            }
            foundResults.sort((a, b) => a.fork.nearnessScore - b.fork.nearnessScore);
            setScreenerResults(foundResults);
            setIsScreening(false);
            setChatHistory(prev => [...prev, { role: 'system', text: `Screener complete. Found ${foundResults.length} ${pitchforkType} setups.` }]);
        },

        fetchOptionsForDate: async (symbol, date) => {
            setOptionsLoading(true);
            try {
              const res = await fetch(`http://127.0.0.1:8000/api/ticker/${symbol}/options?date=${date}`);
              setOptionsData(await res.json());
            } catch (err) { console.error(err); } finally { setOptionsLoading(false); }
        },

        handlePromptSubmit: async (overrideText = null) => {
            const text = overrideText || userPrompt;
            if (!text.trim() || isAnalyzing) return;
            
            setUserPrompt("");
            setChatHistory(prev => [...prev, { role: 'user', text }]);
            const upper = text.toUpperCase();
      
            if (upper.match(/\$([A-Z0-9.\-\^]+)/)) {
                const symbol = upper.match(/\$([A-Z0-9.\-\^]+)/)[1];
                setChatHistory(prev => [...prev, { role: 'system', text: `Opening terminal for ${symbol}...` }]);
                await handlers.openTerminal(symbol, '1Y');
                return;
            }
            if (upper.startsWith('/SCAN')) {
                setChatHistory(prev => [...prev, { role: 'system', text: `Initiating market scan...` }]);
                handlers.runMarketScreener(); return;
            }
            if (upper.startsWith('/INDEX') || upper.includes('SHOW INDEX')) {
                setViewMode('index'); return;
            }
      
            if (selectedTicker && ohlcData.length > 0) {
                setIsAnalyzing(true);
                let pivotContext = "No active geometric channel detected.";
                if (hasScannedPitchforks && detectedPivots.length > 0) {
                    const p = detectedPivots[activePivotIndex];
                    pivotContext = `Asset is trapped in an active ${p.variation} ${p.type} pitchfork for ${p.daysActive} days. Price is currently at ${p.positionPct}% of the channel boundaries (${p.zoneLabel}).`;
                }
                let newsContext = "";
                if (tickerDetails?.news?.length > 0) {
                    newsContext = "\n\nRecent News:\n" + tickerDetails.news.map(n => `- ${n.title}`).join("\n");
                }
                const finalPrompt = `Context: ${selectedTicker} is currently trading at ${tickerDetails?.price || 'unknown'}. ${pivotContext}${newsContext}\n\nUser Question: ${text}`;
      
                try {
                    const res = await fetch('http://127.0.0.1:8000/api/ai/analyze', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ symbol: selectedTicker, price: tickerDetails?.price || 0, zoneLabel: detectedPivots[activePivotIndex]?.zoneLabel || "None", positionPct: detectedPivots[activePivotIndex]?.positionPct || "0", daysActive: detectedPivots[activePivotIndex]?.daysActive || 0, customPrompt: finalPrompt })
                    });
                    const data = await res.json();
                    setChatHistory(prev => [...prev, { role: 'ai', text: data.analysis || data.error }]);
                } catch (err) { setChatHistory(prev => [...prev, { role: 'ai', text: "Error connecting to AI backend." }]); } finally { setIsAnalyzing(false); }
            } else {
                setChatHistory(prev => [...prev, { role: 'ai', text: "Please open an asset first." }]);
                setIsAnalyzing(false);
            }
        },

        handleFullSync: async () => {
            setIsSyncing(true);
            try {
                const res = await fetch(`http://127.0.0.1:8000/api/ticker/${selectedTicker}/download`, { method: 'POST' });
                const data = await res.json();
                if (data.status === "success") setChatHistory(prev => [...prev, { role: 'system', text: `✅ Downloaded complete history for ${selectedTicker}.` }]);
                else setChatHistory(prev => [...prev, { role: 'system', text: `❌ Sync failed: ${data.error}` }]);
            } catch (err) { setChatHistory(prev => [...prev, { role: 'system', text: `❌ Connection lost.` }]); } finally { setIsSyncing(false); }
        }
    };

    return {
        state: {
            loading, viewMode, tickersData, searchInput, searchTerm,
            selectedTicker, tickerDetails, ohlcData, optionsData, currentTimeframe, chartLoading, mathCalculating, optionsLoading, isSyncing,
            liveStatus, chartDisplayType, showVolume, showEMA20, showSMA50, showSMA200, showPitchfork, chartZoom,
            pitchforkType, hasScannedPitchforks, detectedPivots, activePivotIndex,
            screenerCategory, screenerLookback, isScreening, screenerResults, screenerProgress,
            userPrompt, isAnalyzing, chatHistory, chatEndRef,
        },
        setState: {
            setViewMode, setSearchInput, setShowVolume, setShowEMA20, setShowSMA50, setShowSMA200, setShowPitchfork,
            setPitchforkType, setScreenerCategory, setScreenerLookback, setUserPrompt
        },
        handlers
    };
}


// =========================================================================
// 3. UI COMPONENTS (Pure Presentation Layer)
// =========================================================================

const AIChatSidebar = ({ state, setState, handlers }) => {
    return (
        <div className="ai-sidebar">
            <div className="sidebar-header">
                <h1 className="engine-title" onClick={() => setState.setViewMode('index')}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
                    Quant Engine
                </h1>
                <span className="engine-status" style={{color: state.liveStatus === "LIVE" ? '#10B981' : '#64748B', background: state.liveStatus === "LIVE" ? 'rgba(16, 185, 129, 0.1)' : 'rgba(100,116,139,0.1)'}}>{state.liveStatus}</span>
            </div>

            <div className="chat-feed">
                {state.chatHistory.map((msg, i) => (
                    <div key={i} className={`msg-container ${msg.role}`}>
                        <div className={`msg-bubble ${msg.role}`}>
                            {msg.role === 'ai' ? <div style={{display: 'flex', gap: '8px', alignItems: 'flex-start'}}><span style={{color: '#3B82F6'}}>🤖</span> <span>{msg.text}</span></div> : msg.text}
                        </div>
                    </div>
                ))}
                {state.isAnalyzing && (
                    <div className="msg-container ai"><div className="msg-bubble ai" style={{fontStyle: 'italic', color: '#64748B'}}>Synthesizing data with LLM...</div></div>
                )}
                <div ref={state.chatEndRef} />
            </div>

            <div className="input-area">
                {!state.userPrompt.trim() && (
                    <div className="quick-actions-row">
                        {state.viewMode === 'terminal' && state.selectedTicker ? (
                            <>
                                <button className="quick-action-btn" onClick={() => handlers.handlePromptSubmit("Analyze the current chart pattern.")}>📈 Analyze Chart</button>
                                {state.tickerDetails?.news?.length > 0 && <button className="quick-action-btn" onClick={() => handlers.handlePromptSubmit("Summarize the latest news for this company.")}>📰 Summarize News</button>}
                            </>
                        ) : (
                            <>
                                <button className="quick-action-btn" onClick={() => handlers.handlePromptSubmit("/INDEX")}>Show Index</button>
                                <button className="quick-action-btn" onClick={() => handlers.handlePromptSubmit("/SCAN")}>Run Screener</button>
                            </>
                        )}
                    </div>
                )}
                
                <div className="chat-input-wrapper">
                    <textarea 
                        className="chat-textarea" rows="2" placeholder="Message Quant Engine..." 
                        value={state.userPrompt} onChange={(e) => setState.setUserPrompt(e.target.value)} 
                        onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); handlers.handlePromptSubmit(); } }}
                    />
                    <button className="send-btn" onClick={() => handlers.handlePromptSubmit()} disabled={state.isAnalyzing || !state.userPrompt.trim()}>↑</button>
                </div>
            </div>
        </div>
    );
};

const TopNavigation = ({ state, setState, handlers }) => {
    return (
        <div className="workspace-header">
            <div className="w-title">
                <span className="w-mode">{state.viewMode}</span>
                <div className="divider" />
                {state.viewMode === 'index' && <span className="w-asset">Global Market Database</span>}
                {state.viewMode === 'screener' && <span className="w-asset">Screener Engine</span>}
                {state.viewMode === 'terminal' && state.selectedTicker && (
                    <div className="w-asset">
                        {state.selectedTicker}
                        {state.tickerDetails?.price && <span className="w-price">{state.tickerDetails.currencySymbol}{state.tickerDetails.price.toLocaleString()}</span>}
                    </div>
                )}
            </div>

            <div className="w-tools">
                {state.viewMode === 'terminal' && (
                    <>
                        <div className="segmented-control">
                            {['1D', '7D', '2W', '1M', '3M', '6M', '1Y', '2Y', '5Y', 'MAX'].map(tf => (
                                <button key={tf} className={`seg-btn ${state.currentTimeframe === tf ? 'active' : ''}`} onClick={() => handlers.openTerminal(state.selectedTicker, tf)}>{tf}</button>
                            ))}
                        </div>
                        <div className="divider" />
                        
                        {/* CHART DISPLAY TOGGLE */}
                        <div className="segmented-control">
                            <button className={`seg-btn ${state.chartDisplayType === 'candle' ? 'active' : ''}`} onClick={() => handlers.cycleChartType()} title="Candlestick">🕯️</button>
                            <button className={`seg-btn ${state.chartDisplayType === 'line' ? 'active' : ''}`} onClick={() => handlers.cycleChartType()} title="Line Chart">📈</button>
                            <button className={`seg-btn ${state.chartDisplayType === 'both' ? 'active' : ''}`} onClick={() => handlers.cycleChartType()} title="Overlay Both">Over</button>
                        </div>
                        <div className="divider" />

                        {/* INDICATORS */}
                        <div className="segmented-control">
                            <button className={`seg-btn ${state.showVolume ? 'active' : ''}`} onClick={() => setState.setShowVolume(!state.showVolume)}>VOL</button>
                            <button className={`seg-btn ${state.showEMA20 ? 'active' : ''}`} onClick={() => setState.setShowEMA20(!state.showEMA20)}>E20</button>
                            <button className={`seg-btn ${state.showSMA50 ? 'active' : ''}`} onClick={() => setState.setShowSMA50(!state.showSMA50)}>S50</button>
                            <button className={`seg-btn ${state.showSMA200 ? 'active' : ''}`} onClick={() => setState.setShowSMA200(!state.showSMA200)}>S200</button>
                        </div>
                        <div className="divider" />
                        
                        {/* PITCHFORK */}
                        {state.showPitchfork && (
                            <select className="mini-select" style={{marginRight: '-4px', borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 'none', height: '26px'}} value={state.pitchforkType} onChange={(e) => setState.setPitchforkType(e.target.value)}>
                                <option value="Standard">Andrw</option><option value="Schiff">Schiff</option><option value="Modified">Mod</option>
                            </select>
                        )}
                        <button className={`tool-btn ${state.showPitchfork ? 'active' : ''}`} style={state.showPitchfork ? {borderTopLeftRadius: 0, borderBottomLeftRadius: 0} : {}} onClick={() => { 
                            setState.setShowPitchfork(!state.showPitchfork); 
                            if(state.showPitchfork) handlers.resetZoom(); else if(state.hasScannedPitchforks && state.detectedPivots.length) handlers.handlePivotClick(0); 
                        }}>PITCHFORK</button>
                    </>
                )}
                {state.viewMode === 'screener' && (
                    <select className="tool-btn" style={{outline: 'none'}} value={state.screenerCategory} onChange={(e) => setState.setScreenerCategory(e.target.value)}>
                        {Object.keys(state.tickersData).map(cat => <option key={cat} value={cat}>{cat.replace(/_/g, ' ')}</option>)}
                    </select>
                )}
            </div>
        </div>
    );
};

const FundamentalRibbon = ({ tickerDetails }) => {
    if (!tickerDetails) return null;
    return (
        <div className="fundamental-ribbon">
            <div className="ribbon-item"><span className="ribbon-label">Market Cap</span><span className="ribbon-value">{tickerDetails.currencySymbol}{formatLargeNumber(tickerDetails.marketCap)}</span></div>
            <div className="ribbon-item"><span className="ribbon-label">P/E Ratio</span><span className="ribbon-value">{tickerDetails.peRatio}</span></div>
            <div className="ribbon-item"><span className="ribbon-label">52W High</span><span className="ribbon-value">{tickerDetails.currencySymbol}{tickerDetails.high52}</span></div>
            <div className="ribbon-item"><span className="ribbon-label">52W Low</span><span className="ribbon-value">{tickerDetails.currencySymbol}{tickerDetails.low52}</span></div>
        </div>
    );
};

const ChartWorkspace = ({ state, handlers }) => {
    // Generate Chart Data Dynamically
    let terminalSeries = [];
    if (state.chartDisplayType === 'candle' || state.chartDisplayType === 'both') terminalSeries.push({ name: 'Price', type: 'candlestick', data: state.ohlcData });
    if (state.chartDisplayType === 'line' || state.chartDisplayType === 'both') terminalSeries.push({ name: 'Close', type: 'line', data: state.ohlcData.map(d => ({ x: d.x, y: d.y[3] })) });
    
    if (state.showVolume) terminalSeries.push({ name: 'Volume', type: 'bar', data: state.ohlcData.map(d => ({ x: d.x, y: d.volume })) });
    if (state.showEMA20) terminalSeries.push({ name: 'EMA 20', type: 'line', data: calculateEMA(state.ohlcData, 20) });
    if (state.showSMA50) terminalSeries.push({ name: 'SMA 50', type: 'line', data: calculateSMA(state.ohlcData, 50) });
    if (state.showSMA200) terminalSeries.push({ name: 'SMA 200', type: 'line', data: calculateSMA(state.ohlcData, 200) });
    if (state.showPitchfork && state.hasScannedPitchforks && state.detectedPivots[state.activePivotIndex]) terminalSeries.push(...state.detectedPivots[state.activePivotIndex].series);
  
    const terminalYAxis = []; const strokeWidths = []; const dashArrays = []; let hasPrimaryAxis = false;
  
    terminalSeries.forEach(s => {
        if (s.name === 'Price' || s.name === 'Close') { 
            if (!hasPrimaryAxis) { terminalYAxis.push({ seriesName: 'Price', opposite: true, show: true, labels: { style: { colors: '#888' } } }); hasPrimaryAxis = true; } 
            else { terminalYAxis.push({ seriesName: 'Price', show: false }); }
            strokeWidths.push(s.type === 'line' ? 2 : 1); dashArrays.push(0); 
        }
        else if (s.name === 'Volume') { terminalYAxis.push({ seriesName: 'Volume', opposite: false, show: false, max: (max) => max * 5 }); strokeWidths.push(0); dashArrays.push(0); }
        else if (s.name.includes('MA')) { terminalYAxis.push({ seriesName: 'Price', show: false }); strokeWidths.push(2); dashArrays.push(0); }
        else if (s.name.includes('PF')) { terminalYAxis.push({ seriesName: 'Price', show: false }); strokeWidths.push(1); dashArrays.push(s.name.includes('Median') ? 0 : 5); }
    });
  
    const terminalChartOptions = {
      chart: { type: 'line', background: 'transparent', toolbar: { show: false }, animations: { enabled: false } },
      colors: ['#3B82F6', '#2563EB', '#64748B', '#D946EF', '#F59E0B', '#10B981', '#EF4444', '#EF4444'], 
      xaxis: { type: 'datetime', min: state.chartZoom.min, max: state.chartZoom.max, labels: { style: { colors: '#888' } } },
      yaxis: terminalYAxis, grid: { borderColor: '#1A1A1A' }, stroke: { width: strokeWidths, dashArray: dashArrays, curve: 'straight' }, 
      tooltip: { shared: true, intersect: false, theme: 'dark' }, legend: { show: false } 
    };

    return (
        <div className="chart-box">
            {state.chartLoading || state.mathCalculating ? <div className="loader">SYNTHESIZING MARKET DATA...</div> : state.ohlcData.length > 0 ? (
                <div style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0}}>
                    {state.chartZoom.min && <button className="tool-btn" style={{position: 'absolute', top: '16px', left: '16px', zIndex: 10}} onClick={handlers.resetZoom}>↺ RESET ZOOM</button>}
                    <Chart options={terminalChartOptions} series={terminalSeries} type="line" height="100%" width="100%" />
                </div>
            ) : <div style={{display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#EF4444', fontSize: '12px'}}>No Historical Data Available.</div>}
        </div>
    );
};

// =========================================================================
// 4. MAIN APP COMPONENT
// =========================================================================

function App() {
  const { state, setState, handlers } = useQuantEngine();

  const indexCategories = useMemo(() => {
      const result = [];
      Object.keys(state.tickersData).forEach(cat => {
          const filtered = state.tickersData[cat].filter(t => t.toUpperCase().includes(state.searchTerm));
          if (filtered.length > 0) result.push({ cat, filtered });
      });
      return result;
  }, [state.tickersData, state.searchTerm]);

  if (state.loading) return <div className="loader">INITIALIZING QUANT ENGINE...</div>;

  return (
    <>
      <style>{`
        body { background-color: #000000; color: #E5E5E5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 0; overflow-x: hidden; }
        * { box-sizing: border-box; }
        .app-container { display: flex; min-height: 100vh; width: 100vw; flex-direction: row; }
        .loader { height: 100vh; display: flex; align-items: center; justify-content: center; color: #3B82F6; font-family: monospace; font-size: 14px; letter-spacing: 2px; }

        /* AI SIDEBAR */
        .ai-sidebar { width: 340px; min-width: 340px; background: #0A0A0A; border-right: 1px solid #1A1A1A; display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh; z-index: 10; }
        .sidebar-header { padding: 20px; border-bottom: 1px solid #1A1A1A; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;}
        .engine-title { font-size: 16px; font-weight: 800; color: #FFF; margin: 0; display: flex; align-items: center; gap: 8px; cursor: pointer;}
        .engine-status { font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: bold; letter-spacing: 0.5px; }

        .chat-feed { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; }
        .chat-feed::-webkit-scrollbar { width: 4px; }
        .chat-feed::-webkit-scrollbar-thumb { background: #262626; border-radius: 2px; }
        .msg-container { display: flex; flex-direction: column; max-width: 95%; }
        .msg-container.user { align-self: flex-end; }
        .msg-container.ai { align-self: flex-start; }
        .msg-bubble { padding: 12px 16px; border-radius: 12px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; box-shadow: 0 2px 5px rgba(0,0,0,0.2); }
        .msg-bubble.user { background: #1E293B; color: #F8FAFC; border-bottom-right-radius: 2px; border: 1px solid #334155; }
        .msg-bubble.ai { background: #0F172A; color: #E2E8F0; border: 1px solid #1E293B; border-bottom-left-radius: 2px; }

        .input-area { padding: 16px; border-top: 1px solid #1A1A1A; background: #0A0A0A; flex-shrink: 0;}
        .quick-actions-row { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
        .quick-action-btn { background: #171717; border: 1px solid #262626; color: #A3A3A3; padding: 6px 10px; border-radius: 4px; font-size: 10px; cursor: pointer; transition: 0.2s; }
        .quick-action-btn:hover { background: #1E293B; color: #3B82F6; border-color: #3B82F6; }
        .chat-input-wrapper { position: relative; display: flex; flex-direction: column; }
        .chat-textarea { width: 100%; background: #000; border: 1px solid #262626; border-radius: 20px; color: #FFF; padding: 12px 40px 12px 16px; font-size: 13px; font-family: inherit; resize: none; outline: none; transition: 0.2s; }
        .chat-textarea:focus { border-color: #3B82F6; box-shadow: 0 0 0 2px rgba(59,130,246,0.15);}
        .send-btn { position: absolute; right: 6px; bottom: 6px; width: 28px; height: 28px; background: #3B82F6; color: #FFF; border: none; border-radius: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; }

        /* MAIN WORKSPACE */
        .main-workspace { flex: 1; display: flex; flex-direction: column; min-height: 100vh; background: #000; position: relative; }
        .workspace-header { height: 60px; background: #0A0A0A; border-bottom: 1px solid #1A1A1A; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; position: sticky; top: 0; z-index: 5; }
        .w-title { display: flex; align-items: center; gap: 12px; }
        .w-mode { color: #666; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
        .w-asset { color: #FFF; font-size: 18px; font-weight: 800; display: flex; align-items: baseline; gap: 12px;}
        .w-price { font-family: monospace; font-size: 15px; color: #10B981; }
        
        .w-tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap;}
        .tool-btn { background: #111827; border: 1px solid #262626; color: #A3A3A3; padding: 6px 12px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; transition: 0.2s; white-space: nowrap;}
        .tool-btn:hover { color: #FFF; border-color: #404040; }
        .tool-btn.active { color: #3B82F6; border-color: #3B82F6; background: rgba(59, 130, 246, 0.1); }
        .divider { width: 1px; height: 20px; background: #262626; margin: 0; }

        /* SEGMENTED CONTROLS (Fixes Toolbar Wrapping) */
        .segmented-control { display: flex; background: #111827; border: 1px solid #262626; border-radius: 6px; overflow: hidden; }
        .seg-btn { background: transparent; border: none; border-right: 1px solid #262626; color: #A3A3A3; padding: 6px 10px; font-size: 10px; font-weight: 600; cursor: pointer; transition: 0.2s;}
        .seg-btn:last-child { border-right: none; }
        .seg-btn:hover { color: #FFF; background: #1A1A1A; }
        .seg-btn.active { color: #3B82F6; background: rgba(59, 130, 246, 0.1); font-weight: bold; }

        .fundamental-ribbon { display: flex; gap: 24px; padding: 10px 24px; background: #050505; border-bottom: 1px solid #1A1A1A; flex-wrap: wrap; }
        .ribbon-item { display: flex; flex-direction: column; gap: 2px; }
        .ribbon-label { font-size: 9px; color: #666; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
        .ribbon-value { font-size: 12px; color: #E5E5E5; font-weight: 600; font-family: monospace; }

        .workspace-content { flex: 1; padding: 24px; display: flex; flex-direction: column; }
        .workspace-content.terminal-layout { padding: 0; display: flex; flex-direction: row; height: calc(100vh - 60px - 45px); } 
        .chart-box { flex: 1; position: relative; display: flex; flex-direction: column; min-height: 0; width: 100%; } 

        .index-search { width: 100%; padding: 16px 20px; background: #0A0A0A; border: 1px solid #262626; border-radius: 8px; color: #FFF; font-size: 16px; outline: none; margin-bottom: 30px; transition: border-color 0.2s; }
        .category-title { font-size: 12px; color: #888; font-weight: 600; margin-bottom: 16px; border-bottom: 1px solid #1A1A1A; padding-bottom: 8px; display: flex; justify-content: space-between; }
        .asset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 1px; background: #1A1A1A; border: 1px solid #1A1A1A; border-radius: 8px; overflow: hidden; margin-bottom: 40px; }
        .asset-card { background: #0A0A0A; padding: 16px; cursor: pointer; transition: background 0.1s; display: flex; justify-content: space-between; align-items: center; }
        .asset-card:hover { background: #171717; }
        .asset-symbol { font-weight: 600; color: #E5E5E5; font-size: 13px; }

        .screener-header-panel { display: flex; gap: 24px; margin-bottom: 30px; flex-wrap: wrap; }
        .screener-config-box { flex: 1; min-width: 300px; background: #0A0A0A; border: 1px solid #1A1A1A; border-radius: 8px; padding: 24px; }
        .screener-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
        .pf-card { background: #0A0A0A; border: 1px solid #262626; border-radius: 8px; padding: 16px; cursor: pointer; transition: 0.2s; }
        .pf-card:hover { border-color: #404040; transform: translateY(-2px); }
        .pf-badge { font-size: 9px; font-weight: 700; padding: 4px 8px; border-radius: 4px; }
        .pf-badge.sup { color: #10B981; background: rgba(16, 185, 129, 0.1); }
        .pf-badge.res { color: #EF4444; background: rgba(239, 68, 68, 0.1); }
        .prox-track { height: 4px; background: #1A1A1A; border-radius: 2px; position: relative; margin-top: 12px; }
        .prox-fill { position: absolute; top: -2px; width: 4px; height: 8px; border-radius: 2px; }
        .prox-center { position: absolute; left: 50%; top: -2px; width: 1px; height: 8px; background: #666; }

        .terminal-sidebar { width: 320px; background: #0A0A0A; border-left: 1px solid #1A1A1A; display: flex; flex-direction: column; overflow-y: auto; flex-shrink: 0;}
        .terminal-sidebar::-webkit-scrollbar { width: 4px; }
        .terminal-sidebar::-webkit-scrollbar-thumb { background: #262626; border-radius: 2px; }
        
        .collapsible-header { padding: 16px 20px; border-bottom: 1px solid #1A1A1A; display: flex; justify-content: space-between; align-items: center; cursor: pointer; background: #0F172A; transition: 0.2s; position: sticky; top: 0; z-index: 2;}
        .collapsible-header:hover { background: #1E293B; }
        .collapsible-title { font-size: 11px; color: #94A3B8; font-weight: 700; text-transform: uppercase; margin: 0; }
        .collapsible-body { padding: 20px; border-bottom: 1px solid #1A1A1A; background: #0A0A0A; }

        .opt-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #1A1A1A; font-family: monospace; font-size: 12px; }
        .opt-head { color: #666; font-family: sans-serif; font-size: 10px; font-weight: 600; border-bottom: 1px solid #262626; padding-bottom: 6px; margin-bottom: 4px; }
        .mini-select { background: #000; color: #FFF; border: 1px solid #262626; padding: 6px; border-radius: 4px; font-size: 11px; outline: none; cursor: pointer; width: 100%; margin-bottom: 12px;}
      `}</style>

      <div className="app-container">
        
        {/* MODULE 1: AI SIDEBAR */}
        <AIChatSidebar state={state} setState={setState} handlers={handlers} />

        {/* MODULE 2: MAIN WORKSPACE */}
        <div className="main-workspace">
            <TopNavigation state={state} setState={setState} handlers={handlers} />
            <FundamentalRibbon tickerDetails={state.tickerDetails} />

            {/* VIEW: INDEX */}
            {state.viewMode === 'index' && (
                <div className="workspace-content">
                    <input className="index-search" placeholder="Search global equities, indices, and forex..." value={state.searchInput} onChange={(e) => setState.setSearchInput(e.target.value)} />
                    {indexCategories.map(({ cat, filtered }) => {
                        const displayList = filtered.slice(0, 100); 
                        return (
                            <div key={cat} style={{marginBottom: '10px'}}>
                                <div className="category-title"><span>{cat.replace(/_/g, ' ')}</span><span>{filtered.length} ASSETS</span></div>
                                <div className="asset-grid">
                                    {displayList.map(s => (
                                        <div className="asset-card" key={s} onClick={() => handlers.handlePromptSubmit(`$${s}`)}>
                                            <span className="asset-symbol">{s}</span><span className="asset-action">LOAD ➔</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* VIEW: SCREENER */}
            {state.viewMode === 'screener' && (
                <div className="workspace-content">
                    <div className="screener-header-panel">
                        <div className="screener-config-box">
                            <h3 style={{marginTop: 0, color: '#FFF', fontSize: '14px', marginBottom: '16px'}}>Geometric Screener Parameters</h3>
                            <label style={{display: 'block', color: '#666', fontSize: '10px', fontWeight: 'bold', marginBottom: '8px'}}>SECTOR</label>
                            <select className="mini-select" value={state.screenerCategory} onChange={(e) => setState.setScreenerCategory(e.target.value)} disabled={state.isScreening}>
                                {Object.keys(state.tickersData).map(cat => <option key={cat} value={cat}>{cat.replace(/_/g, ' ')}</option>)}
                            </select>

                            <label style={{display: 'block', color: '#666', fontSize: '10px', fontWeight: 'bold', marginBottom: '8px', marginTop: '12px'}}>LOOKBACK</label>
                            <select className="mini-select" value={state.screenerLookback} onChange={(e) => setState.setScreenerLookback(Number(e.target.value))} disabled={state.isScreening}>
                                <option value={90}>3 Months</option><option value={180}>6 Months</option><option value={365}>1 Year</option><option value={1825}>5 Years</option>
                            </select>

                            <button className="tool-btn" style={{width: '100%', marginTop: '16px', padding: '10px', background: '#3B82F6', color: 'white', border: 'none'}} onClick={handlers.runMarketScreener} disabled={state.isScreening}>
                                {state.isScreening ? 'SCANNING...' : '▶ RUN MANUAL SCAN'}
                            </button>
                        </div>
                    </div>

                    <div style={{borderTop: '1px solid #1A1A1A', paddingTop: '24px'}}>
                        <h3 style={{marginTop: 0, color: '#FFF', fontSize: '14px', marginBottom: '20px'}}>Active Setups <span style={{color: '#666', fontWeight: 'normal'}}>({state.screenerResults.length})</span></h3>
                        <div className="screener-grid">
                             {state.screenerResults.map((res, i) => (
                                 <div key={i} className="pf-card" onClick={() => handlers.handlePromptSubmit(`$${res.symbol}`)}>
                                     <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px'}}>
                                         <div>
                                             <div style={{fontSize: '18px', fontWeight: '800', color: '#FFF', marginBottom: '6px'}}>{res.symbol}</div>
                                             <span className={`pf-badge ${res.fork.type === 'HLH' ? 'sup' : 'res'}`}>{res.fork.type === 'HLH' ? 'SUPPORT' : 'RESISTANCE'} ({res.fork.variation})</span>
                                         </div>
                                         <div style={{color: '#666', fontSize: '10px'}}>Active {res.fork.daysActive}d</div>
                                     </div>
                                 </div>
                             ))}
                         </div>
                    </div>
                </div>
            )}

            {/* VIEW: TERMINAL */}
            {state.viewMode === 'terminal' && (
                <div className="workspace-content terminal-layout">
                    
                    {/* CHART WORKSPACE */}
                    <ChartWorkspace state={state} handlers={handlers} />

                    {/* RIGHT SIDEBAR */}
                    <div className="terminal-sidebar">
                        
                        {/* Company Intel */}
                        {state.tickerDetails?.description && (
                            <>
                                <div className="collapsible-header" onClick={() => {}}>
                                    <h3 className="collapsible-title">Company Intelligence</h3>
                                </div>
                                <div className="collapsible-body">
                                    <p style={{fontSize: '11px', color: '#A3A3A3', lineHeight: '1.6', margin: 0}}>{state.tickerDetails.description.substring(0, 400)}...</p>
                                </div>
                            </>
                        )}

                        {/* Derivatives */}
                        <div className="collapsible-header" onClick={() => {}}>
                            <h3 className="collapsible-title">Derivatives</h3>
                        </div>
                        <div className="collapsible-body" style={{padding: '16px'}}>
                            {state.optionsLoading ? <div style={{color: '#3B82F6', fontSize: '11px', textAlign: 'center', padding: '20px 0'}}>Fetching chain...</div> : state.optionsData?.error || !state.optionsData?.calls?.length ? (
                                <div style={{color: '#666', fontSize: '11px', fontStyle: 'italic', textAlign: 'center', background: '#000', padding: '16px', borderRadius: '4px'}}>No derivatives available.</div>
                            ) : (
                                <div style={{width: '100%', fontSize: '11px', fontFamily: 'monospace'}}>
                                    {/* Quick rendering of options - simplified for layout focus */}
                                    <div className="opt-row opt-head"><span>STRIKE</span><span style={{textAlign: 'center'}}>CALL</span><span style={{textAlign: 'right'}}>PUT</span></div>
                                    {state.optionsData.calls.slice(0, 10).map((call, i) => (
                                        <div className="opt-row" key={i}>
                                            <span style={{color: '#888'}}>{call.strike}</span>
                                            <span style={{color: '#10B981', textAlign: 'center'}}>{call.lastPrice?.toFixed(2) || '0.00'}</span>
                                            <span style={{color: '#F43F5E', textAlign: 'right'}}>{0.00}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Data Sync */}
                        <div className="collapsible-body" style={{border: 'none', background: 'transparent', paddingTop: '10px'}}>
                            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px'}}>
                                <button className="tool-btn" style={{gridColumn: 'span 2'}} onClick={handlers.handleFullSync} disabled={state.isSyncing}>{state.isSyncing ? "DOWNLOADING..." : "📥 SYNC TO DB"}</button>
                            </div>
                        </div>

                    </div>
                </div>
            )}
        </div>
      </div>
    </>
  );
}

export default App;