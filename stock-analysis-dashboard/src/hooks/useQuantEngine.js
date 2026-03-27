import { useState, useEffect, useRef, useMemo } from 'react';
import {
  API_BASE,
  THEME_KEY,
  THEME_OPTIONS,
  THEME_IDS,
  DEFAULT_PORTFOLIOS,
  TRANSACTION_SIDE_CHOICES,
  DEFAULT_PORTFOLIO_FORM,
  CUSTOM_WATCHLISTS_KEY,
  PORTFOLIOS_KEY,
  LEGACY_PORTFOLIO_KEY,
  PORTFOLIO_SNAPSHOTS_KEY,
  FORK_SCAN_STORAGE_KEY,
  LOCAL_LLM_CONFIG_KEY,
  WATCHLIST_LABS_KEY,
  WATCHLIST_CRON_KEY,
  MACRO_LAB_CONFIG_KEY,
  MACRO_LAB_NOTES_KEY,
} from '../utils/constants';
import {
  calcPearson,
  calcZScore,
  toReturnSeries,
  findActivePitchforks,
  enumerateAllPitchforks,
} from '../utils/math';
import {
  normalizePortfolioSegment,
  derivePurchaseTypeForSegment,
  deriveCountryFromInstrument,
  deriveCountryFromSegment,
  normalizePortfolioMap,
  normalizeLegacyPortfolioRows,
  normalizePortfolioSnapshots,
  buildPortfolioSnapshot,
  ledgerDeriveHoldingsFromTransactions,
  ledgerNormalizePortfolioTransaction,
} from '../utils/portfolio';

function useQuantEngine() {
    // Global App State
    const [viewMode, setViewMode] = useState('home');
    const [theme, setTheme] = useState('sand');
    const [loading, setLoading] = useState(true);
    const [tickersData, setTickersData] = useState({});
    const [tickersLoadError, setTickersLoadError] = useState(null);
    const [tickerCategorySummary, setTickerCategorySummary] = useState([]);
    const [tickerPresets, setTickerPresets] = useState([]);
    const [homeLoading, setHomeLoading] = useState(false);
    const [homeStats, setHomeStats] = useState(null);
    const [homeLeaders, setHomeLeaders] = useState([]);
    const [homeLaggers, setHomeLaggers] = useState([]);
    const [homeFocusList, setHomeFocusList] = useState([]);
    const [maintenanceBusy, setMaintenanceBusy] = useState(false);
    const [redownloadJob, setRedownloadJob] = useState(null);
    const [allDataJob, setAllDataJob] = useState(null);
    const [dailyInsights, setDailyInsights] = useState([]);
    const [aiSuggestions, setAiSuggestions] = useState([]);
    const [aiSuggesting, setAiSuggesting] = useState(false);
    const [customWatchlists, setCustomWatchlists] = useState({});
    const [newWatchlistName, setNewWatchlistName] = useState('');
    const [watchlistSymbolInput, setWatchlistSymbolInput] = useState('');
    const [selectedCustomWatchlist, setSelectedCustomWatchlist] = useState('Default');
    const [portfolios, setPortfolios] = useState(DEFAULT_PORTFOLIOS);
    const [newPortfolioName, setNewPortfolioName] = useState('');
    const [selectedPortfolio, setSelectedPortfolio] = useState('Main');
    const [portfolioRenameInput, setPortfolioRenameInput] = useState('');
    const [portfolioForm, setPortfolioForm] = useState(DEFAULT_PORTFOLIO_FORM);
    const [portfolioHydrated, setPortfolioHydrated] = useState(false);
    const [portfolioSyncing, setPortfolioSyncing] = useState(false);
    const [portfolioSnapshots, setPortfolioSnapshots] = useState([]);
    const [portfolioSearchResults, setPortfolioSearchResults] = useState([]);
    const [portfolioSearchLoading, setPortfolioSearchLoading] = useState(false);
    const [portfolioSearchOpen, setPortfolioSearchOpen] = useState(false);
    const [portfolioModalOpen, setPortfolioModalOpen] = useState(false);
    const [portfolioModalMode, setPortfolioModalMode] = useState('add');
    const [editingPortfolioPositionId, setEditingPortfolioPositionId] = useState(null);
    const [portfolioAutoFillHint, setPortfolioAutoFillHint] = useState('');
    const [portfolioFeeRegistry, setPortfolioFeeRegistry] = useState(null);
    const [portfolioFeePreview, setPortfolioFeePreview] = useState(null);
    const [portfolioFeePreviewLoading, setPortfolioFeePreviewLoading] = useState(false);
    
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
    const [forkScanResults, setForkScanResults] = useState([]);
    const [forkScanMeta, setForkScanMeta] = useState({
        savedAt: null,
        totalScanned: 0,
        pitchforkType: 'Standard',
        lookback: 365,
    });

    // AI Chat State
    const [userPrompt, setUserPrompt] = useState("");
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [chatHistory, setChatHistory] = useState([
        { role: 'system', text: 'Market Watcher initialized. Enter a ticker (e.g. $AAPL), type /SCAN, or ask for analysis.' }
    ]);
    const [localLlmEnabled, setLocalLlmEnabled] = useState(true);
    const [localLlmBaseUrl, setLocalLlmBaseUrl] = useState('http://127.0.0.1:11434');
    const [localLlmModel, setLocalLlmModel] = useState('llama3.1');
    const [localLlmTesting, setLocalLlmTesting] = useState(false);
    const [localLlmLastStatus, setLocalLlmLastStatus] = useState('');
    const chatEndRef = useRef(null);

    // India consumer context (RAG + correlation preview)
    const [consumerPreview, setConsumerPreview] = useState(null);
    const [consumerLoading, setConsumerLoading] = useState(false);
    const [consumerRagLoading, setConsumerRagLoading] = useState(false);

    const [watchlistSymbols, setWatchlistSymbols] = useState([]);
    const [watchSummaryRows, setWatchSummaryRows] = useState([]);
    const [watchlistLoading, setWatchlistLoading] = useState(false);
    const [watchlistSymbolMeta, setWatchlistSymbolMeta] = useState({});
    const [watchlistSearchResults, setWatchlistSearchResults] = useState([]);
    const [watchlistSearchLoading, setWatchlistSearchLoading] = useState(false);
    const [watchlistSearchOpen, setWatchlistSearchOpen] = useState(false);
    const [watchlistLabs, setWatchlistLabs] = useState([]);
    const [watchlistLabForm, setWatchlistLabForm] = useState({
        symbol: '',
        type: 'economics',
        title: '',
        notes: '',
    });
    const [watchlistCronJobs, setWatchlistCronJobs] = useState([]);
    const [watchlistCronForm, setWatchlistCronForm] = useState({
        category: '',
        lookback: 365,
        cron_schedule: '0 9 * * 1-5',
        note: 'Morning fork scan and alert processing',
    });
    const [macroLabConfig, setMacroLabConfig] = useState({
        lookbackDays: 365,
        scenario: 'Base',
        weights: {
            rates: 1,
            inflation: 1,
            fx: 1,
            risk: 1,
        },
    });
    const [macroLabSnapshot, setMacroLabSnapshot] = useState(null);
    const [macroLabLoading, setMacroLabLoading] = useState(false);
    const [macroLabImpactRows, setMacroLabImpactRows] = useState([]);
    const [macroLabNotes, setMacroLabNotes] = useState({});
    const [macroLabBriefLoading, setMacroLabBriefLoading] = useState(false);
    const [macroLabSort, setMacroLabSort] = useState({ key: 'totalScore', dir: 'desc' });
    const [macroLabInputMode, setMacroLabInputMode] = useState('custom_watchlist');
    const [mlResearchConfig, setMlResearchConfig] = useState({
        lookbackDays: 365,
        forecastHorizon: 5,
        trainWindow: 160,
    });
    const [mlResearchRows, setMlResearchRows] = useState([]);
    const [mlResearchLoading, setMlResearchLoading] = useState(false);
    const [unifiedContext, setUnifiedContext] = useState(null);
    const [unifiedLoading, setUnifiedLoading] = useState(false);
    const [contextAgentLoading, setContextAgentLoading] = useState(false);
    const [selectedCandle, setSelectedCandle] = useState(null);

    // Live Socket
    const ws = useRef(null);
    const [liveStatus, setLiveStatus] = useState("DISCONNECTED");

    const ohlcSig = useMemo(() => {
        if (!ohlcData?.length) return '';
        const a = ohlcData[0];
        const b = ohlcData[ohlcData.length - 1];
        return `${ohlcData.length}|${a.x}|${b.x}`;
    }, [ohlcData]);
    const selectedPortfolioTransactions = useMemo(
        () => portfolios[selectedPortfolio] || [],
        [portfolios, selectedPortfolio]
    );
    const selectedPortfolioPositions = useMemo(
        () => ledgerDeriveHoldingsFromTransactions(selectedPortfolioTransactions),
        [selectedPortfolioTransactions]
    );
    const watchlistUniverseSymbols = useMemo(() => {
        const merged = new Set([...(watchlistSymbols || [])]);
        Object.values(customWatchlists || {}).forEach((arr) => {
            (arr || []).forEach((s) => merged.add(String(s || '').toUpperCase()));
        });
        return Array.from(merged).filter(Boolean);
    }, [watchlistSymbols, customWatchlists]);
    const categoryLabelMap = useMemo(() => {
        const out = {};
        (tickerCategorySummary || []).forEach((row) => {
            out[row.category] = row.label || row.category;
        });
        return out;
    }, [tickerCategorySummary]);
    const autoIndustryWatchlists = useMemo(() => {
        const out = {};
        watchlistUniverseSymbols.forEach((sym) => {
            const meta = watchlistSymbolMeta[sym] || {};
            const industry = meta.industry || meta.assetFamily || meta.categoryLabel || 'Unknown';
            if (!out[industry]) out[industry] = [];
            out[industry].push(sym);
        });
        Object.keys(out).forEach((k) => out[k].sort());
        return out;
    }, [watchlistUniverseSymbols, watchlistSymbolMeta]);
    const macroLabInputSymbols = useMemo(() => {
        if (macroLabInputMode === 'saved_watchlist') return (watchlistSymbols || []).slice(0, 36);
        if (macroLabInputMode === 'portfolio') {
            return [...new Set((selectedPortfolioPositions || []).map((p) => String(p.symbol || '').toUpperCase()).filter(Boolean))].slice(0, 36);
        }
        return (customWatchlists[selectedCustomWatchlist] || []).slice(0, 36);
    }, [macroLabInputMode, watchlistSymbols, selectedPortfolioPositions, customWatchlists, selectedCustomWatchlist]);

    // --- EFFECTS ---
    useEffect(() => {
        const timer = setTimeout(() => setSearchTerm(searchInput.toUpperCase()), 300);
        return () => clearTimeout(timer);
    }, [searchInput]);

    useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatHistory]);

    useEffect(() => {
        try {
            const saved = localStorage.getItem(THEME_KEY);
            if (saved && THEME_IDS.has(saved)) setTheme(saved);
        } catch {
            setTheme('sand');
        }
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem(THEME_KEY, theme);
        } catch (e) {
            console.error(e);
        }
    }, [theme]);

    const loadWatchlistSummary = async () => {
        setWatchlistLoading(true);
        try {
            const r = await fetch(`${API_BASE}/api/watchlist/summary`);
            const d = await r.json();
            setWatchlistSymbols(d.watchlist || []);
            setWatchSummaryRows(d.rows || []);
        } catch (e) {
            console.error(e);
        } finally {
            setWatchlistLoading(false);
        }
    };

    const resolveHomeSymbols = (universe) => {
        const preferredCats = ['SP_500', 'US Equity (S&P 500)', 'DOW', 'NASDAQ_100', 'NSE_Equity'];
        const symbols = [];
        preferredCats.forEach((cat) => {
            (universe?.[cat] || []).forEach((sym) => {
                if (symbols.length < 20 && !symbols.includes(sym)) symbols.push(sym);
            });
        });
        if (symbols.length < 20) {
            Object.values(universe || {}).forEach((arr) => {
                (arr || []).forEach((sym) => {
                    if (symbols.length < 20 && !symbols.includes(sym)) symbols.push(sym);
                });
            });
        }
        return symbols.slice(0, 14);
    };

    const loadHomeDashboard = async (universe, watchRows) => {
        const targets = resolveHomeSymbols(universe);
        if (!targets.length) {
            setHomeStats(null);
            setHomeLeaders([]);
            setHomeLaggers([]);
            setHomeFocusList([]);
            return;
        }
        setHomeLoading(true);
        try {
            const responses = await Promise.all(
                targets.map((sym) =>
                    fetch(`${API_BASE}/api/ticker/${encodeURIComponent(sym)}`)
                        .then((r) => (r.ok ? r.json() : null))
                        .catch(() => null)
                )
            );
            const rows = responses
                .filter((r) => r && !r.error && typeof r.changePct === 'number')
                .map((r) => ({
                    symbol: r.symbol,
                    name: r.name,
                    price: r.price,
                    changePct: r.changePct,
                    change: r.change,
                    currencySymbol: r.currencySymbol || '$',
                }));

            const advancing = rows.filter((r) => r.changePct > 0).length;
            const declining = rows.filter((r) => r.changePct < 0).length;
            const unchanged = Math.max(0, rows.length - advancing - declining);
            const avgMove = rows.length
                ? rows.reduce((sum, r) => sum + Number(r.changePct || 0), 0) / rows.length
                : 0;
            const leaders = [...rows].sort((a, b) => b.changePct - a.changePct).slice(0, 5);
            const laggers = [...rows].sort((a, b) => a.changePct - b.changePct).slice(0, 5);

            setHomeStats({
                sampleSize: rows.length,
                advancing,
                declining,
                unchanged,
                avgMove,
                watchlistCount: (watchRows || []).length,
            });
            setHomeLeaders(leaders);
            setHomeLaggers(laggers);
            setHomeFocusList(rows.slice(0, 8));
        } finally {
            setHomeLoading(false);
        }
    };

    useEffect(() => {
        fetch(`${API_BASE}/api/tickers`)
        .then(res => res.json())
        .then(data => {
            if (data && data.error) {
                setTickersLoadError(String(data.error));
                setTickersData({});
            } else if (data && typeof data === 'object') {
                setTickersLoadError(null);
                setTickersData(data);
                setScreenerCategory(Object.keys(data)[0] || '');
                loadHomeDashboard(data, watchSummaryRows);
            } else {
                setTickersLoadError('Unexpected response from /api/tickers');
                setTickersData({});
            }
            setLoading(false);
        }).catch((err) => {
            console.error('API Offline', err);
            setTickersLoadError(`Cannot reach backend at ${API_BASE}. Start the API (e.g. ./run_backend.sh) or set REACT_APP_API_BASE.`);
            setTickersData({});
            setLoading(false);
        });
        fetch(`${API_BASE}/api/tickers/summary`)
        .then((res) => res.json())
        .then((data) => setTickerCategorySummary(Array.isArray(data?.categories) ? data.categories : []))
        .catch((err) => console.error(err));
        fetch(`${API_BASE}/api/tickers/presets`)
        .then((res) => res.json())
        .then((data) => setTickerPresets(Array.isArray(data?.presets) ? data.presets : []))
        .catch((err) => console.error(err));
        loadWatchlistSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap once on mount
    }, []);

    useEffect(() => {
        if (!Object.keys(tickersData).length) return;
        loadHomeDashboard(tickersData, watchSummaryRows);
        if (!watchlistCronForm.category) {
            const first = Object.keys(tickersData)[0] || '';
            setWatchlistCronForm((prev) => ({ ...prev, category: prev.category || first }));
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally recompute for watchlist changes
    }, [watchSummaryRows]);

    useEffect(() => {
        if (!watchlistUniverseSymbols.length) return;
        const missing = watchlistUniverseSymbols.filter((s) => !watchlistSymbolMeta[s]).slice(0, 60);
        if (!missing.length) return;
        let cancelled = false;
        (async () => {
            const rows = await Promise.all(
                missing.map(async (sym) => {
                    try {
                        const r = await fetch(`${API_BASE}/api/ticker/${encodeURIComponent(sym)}`);
                        const d = await r.json();
                        if (d && !d.error) {
                            return [
                                sym,
                                {
                                    name: d.longName || d.name || sym,
                                    industry: d.industry || d.assetFamily || d.categoryLabel || 'Unknown',
                                    sector: d.sector || 'Unknown',
                                    assetFamily: d.assetFamily || '',
                                    categoryLabel: d.categoryLabel || '',
                                    isProxy: Boolean(d.isProxy),
                                },
                            ];
                        }
                    } catch {
                        // ignore
                    }
                    return [sym, { name: sym, industry: 'Unknown', sector: 'Unknown', assetFamily: '', categoryLabel: '', isProxy: false }];
                })
            );
            if (!cancelled) {
                setWatchlistSymbolMeta((prev) => {
                    const next = { ...prev };
                    rows.forEach(([s, meta]) => {
                        next[s] = meta;
                    });
                    return next;
                });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [watchlistUniverseSymbols, watchlistSymbolMeta]);

    useEffect(() => {
        const q = (watchlistSymbolInput || '').trim();
        if (q.length < 2) {
            setWatchlistSearchResults([]);
            setWatchlistSearchLoading(false);
            return undefined;
        }
        let cancelled = false;
        setWatchlistSearchLoading(true);
        const t = setTimeout(async () => {
            try {
                const r = await fetch(`${API_BASE}/api/search/instruments?q=${encodeURIComponent(q)}&limit=20`);
                const d = await r.json();
                if (!cancelled) {
                    setWatchlistSearchResults(Array.isArray(d?.results) ? d.results : []);
                    setWatchlistSearchOpen(true);
                }
            } catch {
                if (!cancelled) setWatchlistSearchResults([]);
            } finally {
                if (!cancelled) setWatchlistSearchLoading(false);
            }
        }, 220);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [watchlistSymbolInput]);

    useEffect(() => {
        const query = String(portfolioForm.symbol || portfolioForm.assetName || '').trim();
        if (query.length < 2) {
            setPortfolioSearchResults([]);
            setPortfolioSearchLoading(false);
            setPortfolioSearchOpen(false);
            return undefined;
        }
        let cancelled = false;
        setPortfolioSearchLoading(true);
        const t = setTimeout(async () => {
            try {
                const r = await fetch(`${API_BASE}/api/search/instruments?q=${encodeURIComponent(query)}&limit=12`);
                const d = await r.json();
                if (!cancelled) {
                    setPortfolioSearchResults(Array.isArray(d?.results) ? d.results : []);
                    setPortfolioSearchOpen(true);
                }
            } catch {
                if (!cancelled) setPortfolioSearchResults([]);
            } finally {
                if (!cancelled) setPortfolioSearchLoading(false);
            }
        }, 220);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [portfolioForm.symbol, portfolioForm.assetName]);

    const loadMacroLabSnapshot = async () => {
        setMacroLabLoading(true);
        try {
            const r = await fetch(
                `${API_BASE}/api/macro/snapshot?lookback_days=${encodeURIComponent(
                    Math.max(90, Number(macroLabConfig.lookbackDays || 365))
                )}`
            );
            const d = await r.json();
            if (d?.ok) setMacroLabSnapshot(d);
            else setMacroLabSnapshot(null);
        } catch {
            setMacroLabSnapshot(null);
        } finally {
            setMacroLabLoading(false);
        }
    };

    useEffect(() => {
        loadMacroLabSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [macroLabConfig.lookbackDays]);

    useEffect(() => {
        const run = async () => {
            if (!macroLabSnapshot?.ok) {
                setMacroLabImpactRows([]);
                return;
            }
            const symbols = macroLabInputSymbols;
            if (!symbols.length) {
                setMacroLabImpactRows([]);
                return;
            }
            const proxyReturns = {
                risk: macroLabSnapshot?.proxies?.risk?.returns || [],
                rates: macroLabSnapshot?.proxies?.rates?.returns || [],
                inflation: macroLabSnapshot?.proxies?.inflation?.returns || [],
                fx: macroLabSnapshot?.proxies?.fx?.returns || [],
            };
            const regime = {
                risk: Number(macroLabSnapshot?.regime?.riskOn || 0),
                rates: Number(macroLabSnapshot?.regime?.ratesPressure || 0),
                inflation: Number(macroLabSnapshot?.regime?.inflationPressure || 0),
                fx: Number(macroLabSnapshot?.regime?.usdPressure || 0),
            };
            const scenarioScales = {
                Base: { risk: 1, rates: 1, inflation: 1, fx: 1 },
                Bull: { risk: 1.35, rates: 0.8, inflation: 0.85, fx: 0.9 },
                Bear: { risk: 0.7, rates: 1.2, inflation: 1.2, fx: 1.15 },
                Shock: { risk: 0.45, rates: 1.45, inflation: 1.35, fx: 1.4 },
            };
            const s = scenarioScales[macroLabConfig?.scenario] || scenarioScales.Base;
            const w = {
                rates: Number(macroLabConfig?.weights?.rates || 1),
                inflation: Number(macroLabConfig?.weights?.inflation || 1),
                fx: Number(macroLabConfig?.weights?.fx || 1),
                risk: Number(macroLabConfig?.weights?.risk || 1),
            };

            const rows = await Promise.all(
                symbols.map(async (sym) => {
                    try {
                        const tf = Number(macroLabConfig.lookbackDays || 365) > 500 ? '5Y' : '2Y';
                        const raw = await fetch(`${API_BASE}/api/ticker/${encodeURIComponent(sym)}/ohlc?timeframe=${tf}`)
                            .then((x) => x.json())
                            .catch(() => []);
                        const symRet = toReturnSeries(raw);
                        const factorCorr = {
                            risk: calcPearson(symRet.slice(-proxyReturns.risk.length), proxyReturns.risk.slice(-symRet.length)),
                            rates: calcPearson(symRet.slice(-proxyReturns.rates.length), proxyReturns.rates.slice(-symRet.length)),
                            inflation: calcPearson(symRet.slice(-proxyReturns.inflation.length), proxyReturns.inflation.slice(-symRet.length)),
                            fx: calcPearson(symRet.slice(-proxyReturns.fx.length), proxyReturns.fx.slice(-symRet.length)),
                        };
                        const contributions = {
                            risk: factorCorr.risk * regime.risk * w.risk * s.risk * 100,
                            rates: factorCorr.rates * regime.rates * w.rates * s.rates * 100,
                            inflation: factorCorr.inflation * regime.inflation * w.inflation * s.inflation * 100,
                            fx: factorCorr.fx * regime.fx * w.fx * s.fx * 100,
                        };
                        const totalScore =
                            contributions.risk + contributions.rates + contributions.inflation + contributions.fx;
                        const confidence =
                            (Math.abs(factorCorr.risk) +
                                Math.abs(factorCorr.rates) +
                                Math.abs(factorCorr.inflation) +
                                Math.abs(factorCorr.fx)) /
                            4;
                        return {
                            symbol: sym,
                            totalScore,
                            factors: contributions,
                            corr: factorCorr,
                            confidence,
                            stance: totalScore > 8 ? 'Beneficiary' : totalScore < -8 ? 'Headwind' : 'Neutral',
                            note: macroLabNotes[sym] || '',
                            scenario: macroLabConfig?.scenario || 'Base',
                        };
                    } catch {
                        return null;
                    }
                })
            );

            const cleaned = rows.filter(Boolean);
            const totals = cleaned.map((r) => r.totalScore);
            cleaned.forEach((r) => {
                r.zScore = calcZScore(r.totalScore, totals);
            });
            cleaned.sort((a, b) => b.totalScore - a.totalScore);
            setMacroLabImpactRows(cleaned);
        };
        run();
    }, [macroLabSnapshot, macroLabInputSymbols, macroLabConfig, macroLabNotes]);

    useEffect(() => {
        setMlResearchRows([]);
    }, [macroLabInputMode]);

    useEffect(() => {
        if (viewMode !== 'home') return undefined;
        const t = setInterval(() => {
            if (!Object.keys(tickersData).length) return;
            loadHomeDashboard(tickersData, watchSummaryRows);
        }, 60000);
        return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- periodic home pulse refresh
    }, [viewMode, tickersData, watchSummaryRows]);

    useEffect(() => {
        try {
            const rawWl = localStorage.getItem(CUSTOM_WATCHLISTS_KEY);
            if (rawWl) {
                const parsed = JSON.parse(rawWl);
                if (parsed && typeof parsed === 'object') {
                    setCustomWatchlists(parsed);
                    const keys = Object.keys(parsed);
                    if (keys.length && !keys.includes(selectedCustomWatchlist)) {
                        setSelectedCustomWatchlist(keys[0]);
                    }
                }
            } else {
                setCustomWatchlists({ Default: [] });
            }
        } catch {
            setCustomWatchlists({ Default: [] });
        }
        (async () => {
            let localPortfolios = null;
            try {
                const rawPortfolios = localStorage.getItem(PORTFOLIOS_KEY);
                if (rawPortfolios) {
                    localPortfolios = normalizePortfolioMap(JSON.parse(rawPortfolios));
                } else {
                    const legacy = localStorage.getItem(LEGACY_PORTFOLIO_KEY);
                    if (legacy) localPortfolios = normalizeLegacyPortfolioRows(JSON.parse(legacy));
                }
            } catch {
                localPortfolios = null;
            }

            const serverHasMeaningfulData = (portfolioMap) => {
                const names = Object.keys(portfolioMap || {});
                return names.length > 1 || names.some((name) => (portfolioMap?.[name] || []).length > 0);
            };

            try {
                const response = await fetch(`${API_BASE}/api/portfolios`);
                const data = await response.json();
                const serverPortfolios = normalizePortfolioMap(data?.portfolios);
                const resolved = serverHasMeaningfulData(serverPortfolios)
                    ? serverPortfolios
                    : (localPortfolios || serverPortfolios || DEFAULT_PORTFOLIOS);
                setPortfolios(resolved);
                setSelectedPortfolio(Object.keys(resolved)[0] || 'Main');
                if (!serverHasMeaningfulData(serverPortfolios) && localPortfolios) {
                    await fetch(`${API_BASE}/api/portfolios`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ portfolios: localPortfolios }),
                    }).catch(() => null);
                }
            } catch {
                const fallback = localPortfolios || DEFAULT_PORTFOLIOS;
                setPortfolios(fallback);
                setSelectedPortfolio(Object.keys(fallback)[0] || 'Main');
            } finally {
                setPortfolioHydrated(true);
            }
        })();
        try {
            const rawForks = localStorage.getItem(FORK_SCAN_STORAGE_KEY);
            if (rawForks) {
                const parsed = JSON.parse(rawForks);
                const results = Array.isArray(parsed?.results) ? parsed.results : [];
                const meta = parsed?.meta && typeof parsed.meta === 'object' ? parsed.meta : {};
                setForkScanResults(results);
                setScreenerResults(results);
                setForkScanMeta((prev) => ({
                    ...prev,
                    savedAt: meta.savedAt || null,
                    totalScanned: Number(meta.totalScanned || 0),
                    pitchforkType: meta.pitchforkType || prev.pitchforkType,
                    lookback: Number(meta.lookback || prev.lookback),
                }));
            }
        } catch {
            setForkScanResults([]);
        }
        try {
            const rawLocalLlm = localStorage.getItem(LOCAL_LLM_CONFIG_KEY);
            if (rawLocalLlm) {
                const parsed = JSON.parse(rawLocalLlm);
                if (typeof parsed?.enabled === 'boolean') setLocalLlmEnabled(parsed.enabled);
                if (typeof parsed?.baseUrl === 'string' && parsed.baseUrl.trim()) setLocalLlmBaseUrl(parsed.baseUrl.trim());
                if (typeof parsed?.model === 'string' && parsed.model.trim()) setLocalLlmModel(parsed.model.trim());
            }
        } catch {
            // keep defaults
        }
        try {
            const rawLabs = localStorage.getItem(WATCHLIST_LABS_KEY);
            if (rawLabs) {
                const parsed = JSON.parse(rawLabs);
                if (Array.isArray(parsed)) setWatchlistLabs(parsed);
            }
        } catch {
            setWatchlistLabs([]);
        }
        try {
            const rawCron = localStorage.getItem(WATCHLIST_CRON_KEY);
            if (rawCron) {
                const parsed = JSON.parse(rawCron);
                if (Array.isArray(parsed)) setWatchlistCronJobs(parsed);
            }
        } catch {
            setWatchlistCronJobs([]);
        }
        try {
            const rawMacroConfig = localStorage.getItem(MACRO_LAB_CONFIG_KEY);
            if (rawMacroConfig) {
                const parsed = JSON.parse(rawMacroConfig);
                if (parsed && typeof parsed === 'object') {
                    setMacroLabConfig((prev) => ({
                        ...prev,
                        lookbackDays: Number(parsed.lookbackDays || prev.lookbackDays),
                        scenario: parsed.scenario || prev.scenario,
                        weights: {
                            rates: Number(parsed?.weights?.rates ?? prev.weights.rates),
                            inflation: Number(parsed?.weights?.inflation ?? prev.weights.inflation),
                            fx: Number(parsed?.weights?.fx ?? prev.weights.fx),
                            risk: Number(parsed?.weights?.risk ?? prev.weights.risk),
                        },
                    }));
                }
            }
        } catch {
            // keep defaults
        }
        try {
            const rawMacroNotes = localStorage.getItem(MACRO_LAB_NOTES_KEY);
            if (rawMacroNotes) {
                const parsed = JSON.parse(rawMacroNotes);
                if (parsed && typeof parsed === 'object') setMacroLabNotes(parsed);
            }
        } catch {
            setMacroLabNotes({});
        }
        try {
            const rawSnapshots = localStorage.getItem(PORTFOLIO_SNAPSHOTS_KEY);
            if (rawSnapshots) {
                setPortfolioSnapshots(normalizePortfolioSnapshots(JSON.parse(rawSnapshots)));
            }
        } catch {
            setPortfolioSnapshots([]);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrapped local storage state
    }, []);

    useEffect(() => {
        localStorage.setItem(CUSTOM_WATCHLISTS_KEY, JSON.stringify(customWatchlists || {}));
    }, [customWatchlists]);

    useEffect(() => {
        const keys = Object.keys(customWatchlists || {});
        if (!keys.length) {
            setCustomWatchlists({ Default: [] });
            setSelectedCustomWatchlist('Default');
            return;
        }
        if (!keys.includes(selectedCustomWatchlist)) {
            setSelectedCustomWatchlist(keys[0]);
        }
    }, [customWatchlists, selectedCustomWatchlist]);

    useEffect(() => {
        const keys = Object.keys(portfolios || {});
        if (!keys.length) {
            setPortfolios({ ...DEFAULT_PORTFOLIOS });
            setSelectedPortfolio('Main');
            return;
        }
        if (!keys.includes(selectedPortfolio)) setSelectedPortfolio(keys[0]);
    }, [portfolios, selectedPortfolio]);

    useEffect(() => {
        setPortfolioRenameInput(selectedPortfolio || '');
    }, [selectedPortfolio]);

    useEffect(() => {
        if (!portfolioHydrated) return undefined;
        try {
            localStorage.setItem(PORTFOLIOS_KEY, JSON.stringify(portfolios || {}));
        } catch (e) {
            console.error(e);
        }
        let cancelled = false;
        setPortfolioSyncing(true);
        (async () => {
            try {
                await fetch(`${API_BASE}/api/portfolios`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ portfolios }),
                });
            } catch (e) {
                console.error(e);
            } finally {
                if (!cancelled) setPortfolioSyncing(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [portfolios, portfolioHydrated]);

    useEffect(() => {
        if (!portfolioHydrated) return;
        try {
            localStorage.setItem(PORTFOLIO_SNAPSHOTS_KEY, JSON.stringify(portfolioSnapshots || []));
        } catch (e) {
            console.error(e);
        }
    }, [portfolioSnapshots, portfolioHydrated]);

    useEffect(() => {
        if (!portfolioHydrated) return;
        const nextSnapshot = buildPortfolioSnapshot(portfolios);
        setPortfolioSnapshots((prev) => {
            const normalized = normalizePortfolioSnapshots(prev);
            const nextRows = [...normalized.filter((row) => row.dateKey !== nextSnapshot.dateKey), nextSnapshot]
                .sort((a, b) => String(a.capturedAt || a.dateKey).localeCompare(String(b.capturedAt || b.dateKey)))
                .slice(-365);
            const prevLatest = normalized[normalized.length - 1];
            const nextLatest = nextRows[nextRows.length - 1];
            if (
                prevLatest &&
                nextLatest &&
                prevLatest.dateKey === nextLatest.dateKey &&
                prevLatest.overall?.current === nextLatest.overall?.current &&
                prevLatest.overall?.invested === nextLatest.overall?.invested &&
                prevLatest.overall?.grossPnl === nextLatest.overall?.grossPnl &&
                JSON.stringify(prevLatest.portfolios) === JSON.stringify(nextLatest.portfolios) &&
                normalized.length === nextRows.length
            ) {
                return prev;
            }
            return nextRows;
        });
    }, [portfolios, portfolioHydrated]);

    useEffect(() => {
        try {
            localStorage.setItem(
                FORK_SCAN_STORAGE_KEY,
                JSON.stringify({
                    results: forkScanResults || [],
                    meta: forkScanMeta || {},
                })
            );
        } catch (e) {
            console.error(e);
        }
    }, [forkScanResults, forkScanMeta]);

    useEffect(() => {
        try {
            localStorage.setItem(
                LOCAL_LLM_CONFIG_KEY,
                JSON.stringify({
                    enabled: localLlmEnabled,
                    baseUrl: localLlmBaseUrl,
                    model: localLlmModel,
                })
            );
        } catch (e) {
            console.error(e);
        }
    }, [localLlmEnabled, localLlmBaseUrl, localLlmModel]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const response = await fetch(`${API_BASE}/api/portfolio/fee-registry`);
                const data = await response.json();
                if (!cancelled && data?.ok) {
                    setPortfolioFeeRegistry(data);
                }
            } catch (e) {
                console.error(e);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        const symbol = String(portfolioForm.symbol || '').trim().toUpperCase();
        const side = String(portfolioForm.side || 'BUY').trim().toUpperCase();
        const quantity = Number(portfolioForm.quantity || 0);
        const price = Number(portfolioForm.price || 0);
        if (!portfolioModalOpen || !symbol || !['BUY', 'SELL'].includes(side) || quantity <= 0 || price <= 0) {
            setPortfolioFeePreview(null);
            setPortfolioFeePreviewLoading(false);
            return undefined;
        }
        let cancelled = false;
        setPortfolioFeePreviewLoading(true);
        (async () => {
            try {
                const response = await fetch(`${API_BASE}/api/portfolio/fee-preview`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        platform: portfolioForm.platform || (portfolioFeeRegistry?.defaultPlatformId || ''),
                        country: portfolioForm.country || 'India',
                        state: portfolioForm.state || '',
                        purchaseType: portfolioForm.purchaseType || 'Delivery',
                        segment: portfolioForm.segment || 'Equity',
                        side: portfolioForm.side || 'BUY',
                        quantity,
                        price,
                        manualCharge: Number(portfolioForm.manualCharge || 0),
                        manualTax: Number(portfolioForm.manualTax || 0),
                    }),
                });
                const data = await response.json();
                if (!cancelled) setPortfolioFeePreview(data?.preview || null);
            } catch (e) {
                console.error(e);
                if (!cancelled) setPortfolioFeePreview(null);
            } finally {
                if (!cancelled) setPortfolioFeePreviewLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [
        portfolioModalOpen,
        portfolioForm.symbol,
        portfolioForm.quantity,
        portfolioForm.price,
        portfolioForm.platform,
        portfolioForm.country,
        portfolioForm.state,
        portfolioForm.purchaseType,
        portfolioForm.segment,
        portfolioForm.side,
        portfolioForm.manualCharge,
        portfolioForm.manualTax,
        portfolioFeeRegistry,
    ]);

    useEffect(() => {
        localStorage.setItem(WATCHLIST_LABS_KEY, JSON.stringify(watchlistLabs || []));
    }, [watchlistLabs]);

    useEffect(() => {
        localStorage.setItem(WATCHLIST_CRON_KEY, JSON.stringify(watchlistCronJobs || []));
    }, [watchlistCronJobs]);

    useEffect(() => {
        localStorage.setItem(MACRO_LAB_CONFIG_KEY, JSON.stringify(macroLabConfig || {}));
    }, [macroLabConfig]);

    useEffect(() => {
        localStorage.setItem(MACRO_LAB_NOTES_KEY, JSON.stringify(macroLabNotes || {}));
    }, [macroLabNotes]);

    useEffect(() => {
        const insights = [];
        if (homeStats?.sampleSize) {
            insights.push(
                `Breadth: ${homeStats.advancing}/${homeStats.sampleSize} advancing and ${homeStats.declining} declining.`
            );
            insights.push(`Average move in sampled market watch is ${Number(homeStats.avgMove || 0).toFixed(2)}%.`);
        }
        if (homeLeaders?.length) {
            insights.push(
                `Leader: ${homeLeaders[0].symbol} (${homeLeaders[0].changePct.toFixed(2)}%) while lagger is ${homeLaggers?.[0]?.symbol || '-'} (${homeLaggers?.[0]?.changePct?.toFixed?.(2) || '0.00'}%).`
            );
        }
        if (watchSummaryRows?.length) {
            insights.push(`Watchlist pulse: ${watchSummaryRows.length} symbols have tracked headlines in cache.`);
        }
        if (!insights.length) insights.push('Load market data to generate daily insights.');
        setDailyInsights(insights.slice(0, 5));
    }, [homeStats, homeLeaders, homeLaggers, watchSummaryRows]);

    useEffect(() => {
        if (!redownloadJob?.job_id) return undefined;
        if (redownloadJob.status === 'completed' || redownloadJob.status === 'failed') return undefined;
        const t = setInterval(async () => {
            try {
                const r = await fetch(`${API_BASE}/api/admin/redownload-status/${redownloadJob.job_id}`);
                const d = await r.json();
                if (d.ok) {
                    setRedownloadJob(d);
                    if (d.status === 'completed') {
                        setChatHistory((prev) => [...prev, { role: 'system', text: 'Redownload completed.' }]);
                        loadHomeDashboard(tickersData, watchSummaryRows);
                    }
                    if (d.status === 'failed') {
                        setChatHistory((prev) => [...prev, { role: 'system', text: `Redownload failed: ${d.error || 'unknown error'}` }]);
                    }
                }
            } catch (e) {
                console.error(e);
            }
        }, 2500);
        return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- polling tied to job status lifecycle
    }, [redownloadJob?.job_id, redownloadJob?.status]);

    useEffect(() => {
        if (!allDataJob?.job_id) return undefined;
        if (allDataJob.status === 'completed' || allDataJob.status === 'failed') return undefined;
        const t = setInterval(async () => {
            try {
                const r = await fetch(`${API_BASE}/api/admin/download-all-and-calculate-status/${allDataJob.job_id}`);
                const d = await r.json();
                if (!d.ok) return;
                setAllDataJob(d);
                if (d.status === 'completed') {
                    const results = Array.isArray(d.results) ? d.results : [];
                    setForkScanResults(results);
                    setScreenerResults(results);
                    setForkScanMeta({
                        savedAt: new Date().toISOString(),
                        totalScanned: d.stats?.total || d.total || 0,
                        pitchforkType: 'Standard',
                        lookback: screenerLookback,
                    });
                    setChatHistory((prev) => [
                        ...prev,
                        { role: 'system', text: `All ticker data downloaded and calculated. Found ${results.length} fork setups.` },
                    ]);
                }
                if (d.status === 'failed') {
                    setChatHistory((prev) => [
                        ...prev,
                        { role: 'system', text: `Download+calculate failed: ${d.error || 'unknown error'}` },
                    ]);
                }
            } catch (e) {
                console.error(e);
            }
        }, 2500);
        return () => clearInterval(t);
    }, [allDataJob?.job_id, allDataJob?.status, screenerLookback]);

    // WebSocket Effect
    useEffect(() => {
        if (viewMode === 'terminal' && selectedTicker) {
            if (ws.current) ws.current.close();
            ws.current = new WebSocket(`ws://127.0.0.1:8000/ws/live/${encodeURIComponent(selectedTicker)}`);
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

    useEffect(() => {
        if (viewMode !== 'terminal' || !selectedTicker) {
            setConsumerPreview(null);
            return undefined;
        }
        let cancelled = false;
        setConsumerLoading(true);
        fetch(`${API_BASE}/api/context/consumer/preview/${encodeURIComponent(selectedTicker)}`)
            .then((r) => r.json())
            .then((data) => {
                if (!cancelled) setConsumerPreview(data);
            })
            .catch(() => {
                if (!cancelled) setConsumerPreview(null);
            })
            .finally(() => {
                if (!cancelled) setConsumerLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [viewMode, selectedTicker]);

    useEffect(() => {
        if (viewMode !== 'terminal' || !selectedTicker) {
            setUnifiedContext(null);
            return undefined;
        }
        let cancelled = false;
        setUnifiedLoading(true);
        fetch(`${API_BASE}/api/context/unified/${encodeURIComponent(selectedTicker)}`)
            .then((r) => r.json())
            .then((data) => {
                if (!cancelled) setUnifiedContext(data);
            })
            .catch(() => {
                if (!cancelled) setUnifiedContext(null);
            })
            .finally(() => {
                if (!cancelled) setUnifiedLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [viewMode, selectedTicker]);

    // Enumerate all LHL/HLH pivots when pitchfork mode is on (full list → cards in rail).
    useEffect(() => {
        if (viewMode !== 'terminal' || !showPitchfork || ohlcData.length < 5) return undefined;
        setMathCalculating(true);
        const t = setTimeout(() => {
            const all = enumerateAllPitchforks(ohlcData, screenerLookback, pitchforkType);
            setDetectedPivots(all);
            setHasScannedPitchforks(true);
            setUserPrompt('');
            if (all.length > 0) {
                setActivePivotIndex(0);
                const pivot = all[0];
                const startIdx = Math.max(0, pivot.dataIndex - 12);
                setChartZoom({
                    min: new Date(ohlcData[startIdx].x).getTime(),
                    max: new Date(ohlcData[ohlcData.length - 1].x).getTime(),
                });
            } else {
                setActivePivotIndex(0);
                setChartZoom({ min: undefined, max: undefined });
            }
            setMathCalculating(false);
        }, 50);
        return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ohlcSig gates rescans; avoid re-enumerating on every live tick
    }, [pitchforkType, showPitchfork, ohlcSig, screenerLookback, viewMode]);


    const runLocalLlmChat = async ({ prompt, system, temperature = 0.2 }) => {
        const base = (localLlmBaseUrl || 'http://127.0.0.1:11434').trim().replace(/\/+$/, '');
        const model = (localLlmModel || 'llama3.1').trim();
        const res = await fetch(`${base}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                stream: false,
                options: { temperature },
                messages: [
                    { role: 'system', content: system || 'You are a concise market analysis assistant.' },
                    { role: 'user', content: prompt || '' },
                ],
            }),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Local LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
        }
        const data = await res.json();
        return data?.message?.content || '';
    };

    // --- HANDLERS & LOGIC ---
    const handlers = {
        resetZoom: () => setChartZoom({ min: undefined, max: undefined }),
        setSelectedCandle: (row) => setSelectedCandle(row),
        setTheme: (id) => {
            if (id && THEME_IDS.has(id)) setTheme(id);
        },
        toggleTheme: () =>
            setTheme((prev) => {
                const list = THEME_OPTIONS.map((t) => t.id);
                const i = list.indexOf(prev);
                return list[(Math.max(0, i) + 1) % list.length];
            }),
        setSelectedCustomWatchlist: (name) => setSelectedCustomWatchlist(name),
        setNewWatchlistName: (name) => setNewWatchlistName(name),
        setWatchlistSymbolInput: (symbol) => {
            setWatchlistSymbolInput(symbol);
            setWatchlistSearchOpen(true);
        },
        setSelectedPortfolio: (name) => setSelectedPortfolio(name),
        setNewPortfolioName: (name) => setNewPortfolioName(name),
        setPortfolioRenameInput: (name) => setPortfolioRenameInput(name),
        openPortfolioModal: (mode = 'add', row = null) => {
            const defaultAddForm = {
                ...DEFAULT_PORTFOLIO_FORM,
                platform: portfolioFeeRegistry?.platforms?.[0]?.label || '',
                country: portfolioFeeRegistry?.country || 'India',
            };
            if (mode === 'edit' && row) {
                const txn = ledgerNormalizePortfolioTransaction(row);
                if (!txn) return;
                setPortfolioModalMode('edit');
                setEditingPortfolioPositionId(txn.id || null);
                setPortfolioForm({
                    ...DEFAULT_PORTFOLIO_FORM,
                    ...txn,
                    side: String(txn.side || 'BUY'),
                    transactionSubtype: String(txn.transactionSubtype || ''),
                    symbol: String(txn.symbol || '').toUpperCase(),
                    assetName: String(txn.assetName || '').trim(),
                    description: String(txn.description || '').trim(),
                    notes: String(txn.notes || '').trim(),
                    brokerReference: String(txn.brokerReference || '').trim(),
                    purchaseType: String(txn.purchaseType || 'Delivery'),
                    tradeDate: String(txn.tradeDate || ''),
                    price: String(txn.price ?? ''),
                    quantity: String(txn.quantity ?? ''),
                    platform: String(txn.platform || ''),
                    country: String(txn.country || ''),
                    state: String(txn.state || ''),
                    segment: String(txn.segment || 'Equity'),
                    manualCharge: String(txn.manualCharge ?? ''),
                    manualTax: String(txn.manualTax ?? ''),
                });
                setPortfolioAutoFillHint(
                    txn.segment === 'Other'
                        ? 'Custom asset mode: all fields are manual.'
                        : 'Editing existing transaction. Broker fee preview will refresh as you change side, price, or quantity.'
                );
            } else if (mode === 'add' && row) {
                const txn = ledgerNormalizePortfolioTransaction(row);
                if (!txn) return;
                setPortfolioModalMode('add');
                setEditingPortfolioPositionId(null);
                setPortfolioForm({
                    ...defaultAddForm,
                    side: String(txn.side || 'BUY'),
                    transactionSubtype: '',
                    symbol: String(txn.symbol || '').toUpperCase(),
                    assetName: String(txn.assetName || '').trim(),
                    description: String(txn.description || '').trim(),
                    notes: String(txn.notes || '').trim(),
                    brokerReference: '',
                    purchaseType: String(txn.purchaseType || 'Delivery'),
                    platform: String(txn.platform || defaultAddForm.platform || ''),
                    country: String(txn.country || defaultAddForm.country || ''),
                    state: String(txn.state || ''),
                    segment: String(txn.segment || 'Equity'),
                    currencySymbol: String(txn.currencySymbol || defaultAddForm.currencySymbol || ''),
                    tradeDate: '',
                    price: '',
                    quantity: '',
                    manualCharge: '',
                    manualTax: '',
                });
                setPortfolioAutoFillHint('Add more mode: asset, platform, and segment were copied from the selected transaction. Enter a fresh date, price, and quantity.');
            } else {
                setPortfolioModalMode('add');
                setEditingPortfolioPositionId(null);
                setPortfolioForm(defaultAddForm);
                setPortfolioAutoFillHint('');
            }
            setPortfolioFeePreview(null);
            setPortfolioSearchResults([]);
            setPortfolioSearchOpen(false);
            setPortfolioModalOpen(true);
        },
        openPortfolioQuickTransaction: (side = 'BUY', row = null, portfolioName = '') => {
            const targetPortfolio = String(portfolioName || '').trim();
            if (targetPortfolio && targetPortfolio !== selectedPortfolio) {
                setSelectedPortfolio(targetPortfolio);
            }
            const baseTxn = row ? ledgerNormalizePortfolioTransaction(row) : null;
            handlers.openPortfolioModal('add', baseTxn || row);
            const resolvedSide = String(side || 'BUY').trim().toUpperCase();
            setTimeout(() => {
                setPortfolioForm((prev) => ({
                    ...prev,
                    side: TRANSACTION_SIDE_CHOICES.includes(resolvedSide) ? resolvedSide : 'BUY',
                    transactionSubtype: resolvedSide === 'ADJUSTMENT' ? (prev.transactionSubtype || 'Manual') : '',
                    tradeDate: '',
                    price: '',
                    quantity: '',
                    manualCharge: '',
                    manualTax: '',
                }));
                setPortfolioAutoFillHint(
                    resolvedSide === 'SELL'
                        ? 'Quick sell mode: asset details were copied. Enter the sell date, units, and execution price.'
                        : resolvedSide === 'BUY'
                            ? 'Quick buy mode: asset details were copied. Enter the new buy date, units, and execution price.'
                            : 'Quick transaction mode: asset details were copied. Complete the remaining fields before saving.'
                );
            }, 0);
        },
        closePortfolioModal: () => {
            setPortfolioModalOpen(false);
            setPortfolioModalMode('add');
            setEditingPortfolioPositionId(null);
            setPortfolioForm({ ...DEFAULT_PORTFOLIO_FORM });
            setPortfolioFeePreview(null);
            setPortfolioSearchResults([]);
            setPortfolioSearchOpen(false);
            setPortfolioAutoFillHint('');
        },
        setPortfolioFormValue: (key, value) => {
            let nextHint = null;
            setPortfolioForm((prev) => {
                const next = {
                    ...prev,
                    [key]: value,
                };
                if (key === 'segment') {
                    const normalizedSegment = normalizePortfolioSegment(value);
                    next.segment = normalizedSegment;
                    if (normalizedSegment === 'Other') {
                        nextHint = 'Custom asset mode: all fields are manual.';
                    } else {
                        next.purchaseType = derivePurchaseTypeForSegment(normalizedSegment);
                        if (!String(prev.country || '').trim()) {
                            next.country = deriveCountryFromSegment(normalizedSegment, prev.symbol);
                        }
                        nextHint = 'Fields were guided from asset family defaults. You can override them.';
                    }
                }
                if (key === 'purchaseType') {
                    next.purchaseType = value;
                    if (!String(prev.segment || '').trim() || prev.segment === 'Equity') {
                        if (value === 'ETF') next.segment = 'ETF';
                        if (value === 'Mutual Fund') next.segment = 'Mutual Fund';
                    }
                }
                if (key === 'side' && value !== 'ADJUSTMENT') {
                    next.transactionSubtype = '';
                }
                return next;
            });
            if (nextHint !== null) setPortfolioAutoFillHint(nextHint);
            if (key === 'symbol' || key === 'assetName') setPortfolioSearchOpen(true);
        },
        selectPortfolioSearchResult: (row) => {
            const symbol = String(row?.symbol || '').trim().toUpperCase();
            if (!symbol) return;
            const normalizedSegment = normalizePortfolioSegment(row?.assetFamily || row?.assetType || 'Equity');
            const inferredCountry =
                deriveCountryFromInstrument(row) ||
                deriveCountryFromSegment(normalizedSegment, symbol);
            setPortfolioForm((prev) => ({
                ...prev,
                symbol,
                assetName: String(row?.name || prev.assetName || symbol).trim(),
                segment: normalizedSegment,
                purchaseType: derivePurchaseTypeForSegment(normalizedSegment),
                country: inferredCountry || prev.country || '',
            }));
            setPortfolioSearchOpen(false);
            setPortfolioAutoFillHint(
                normalizedSegment === 'Other'
                    ? 'Custom asset mode: all fields are manual.'
                    : 'Fields were prefilled from asset metadata. You can override them.'
            );
        },
        closePortfolioSearch: () => setPortfolioSearchOpen(false),
        setLocalLlmEnabled: (val) => setLocalLlmEnabled(Boolean(val)),
        setLocalLlmBaseUrl: (val) => setLocalLlmBaseUrl(String(val || '')),
        setLocalLlmModel: (val) => setLocalLlmModel(String(val || '')),
        testLocalLlm: async () => {
            if (localLlmTesting) return;
            setLocalLlmTesting(true);
            setLocalLlmLastStatus('Testing local LLM...');
            try {
                const out = await runLocalLlmChat({
                    system: 'You are a concise assistant. Reply in under 8 words.',
                    prompt: 'Reply with exactly: Local LLM OK',
                    temperature: 0,
                });
                const msg = (out || '').trim() || 'Connected, but empty reply.';
                setLocalLlmLastStatus(`Success: ${msg}`);
            } catch (e) {
                const tip = 'If blocked by CORS, start Ollama with OLLAMA_ORIGINS=*';
                setLocalLlmLastStatus(`Failed: ${e?.message || 'Unknown error'}. ${tip}`);
            } finally {
                setLocalLlmTesting(false);
            }
        },
        askLocalLlm: async ({ system, prompt, temperature = 0.2 }) => runLocalLlmChat({ system, prompt, temperature }),
        
        cycleChartType: () => {
            if (chartDisplayType === 'candle') setChartDisplayType('line');
            else if (chartDisplayType === 'line') setChartDisplayType('both');
            else setChartDisplayType('candle');
        },

        createCustomWatchlist: () => {
            const name = (newWatchlistName || '').trim();
            if (!name) return;
            setCustomWatchlists((prev) => {
                if (prev[name]) return prev;
                return { ...prev, [name]: [] };
            });
            setSelectedCustomWatchlist(name);
            setNewWatchlistName('');
        },
        deleteCustomWatchlist: (name) => {
            const listName = (name || '').trim();
            if (!listName || listName === 'Default') return;
            setCustomWatchlists((prev) => {
                const next = { ...prev };
                delete next[listName];
                return Object.keys(next).length ? next : { Default: [] };
            });
            setWatchlistLabs((prev) => prev.filter((x) => x.listName !== listName));
            if (selectedCustomWatchlist === listName) {
                setSelectedCustomWatchlist('Default');
            }
        },

        addSymbolToCustomWatchlist: () => {
            const raw = (watchlistSymbolInput || '').trim().toUpperCase();
            let sym = '';
            const mf = raw.match(/^MF:\d+/i);
            if (mf) {
                sym = `MF:${mf[0].slice(3).replace(/\D/g, '')}`;
            } else {
                const matched = raw.match(/[A-Z0-9.^=-]+/);
                sym = matched ? matched[0] : '';
            }
            const listName = selectedCustomWatchlist || 'Default';
            if (!sym) return;
            setCustomWatchlists((prev) => {
                const current = prev[listName] || [];
                if (current.includes(sym)) return prev;
                return { ...prev, [listName]: [...current, sym] };
            });
            if (!selectedCustomWatchlist) setSelectedCustomWatchlist(listName);
            setWatchlistSymbolInput('');
            setWatchlistSearchResults([]);
            setWatchlistSearchOpen(false);
        },
        addSearchResultToWatchlist: (row) => {
            const sym = String(row?.symbol || '').trim().toUpperCase();
            if (!sym) return;
            const listName = selectedCustomWatchlist || 'Default';
            setCustomWatchlists((prev) => {
                const current = prev[listName] || [];
                if (current.includes(sym)) return prev;
                return { ...prev, [listName]: [...current, sym] };
            });
            setWatchlistSymbolInput(sym);
            setWatchlistSearchOpen(false);
            setWatchlistSearchResults([]);
        },
        addPresetToCustomWatchlist: (preset) => {
            const listName = selectedCustomWatchlist || 'Default';
            const symbols = Array.isArray(preset?.symbols)
                ? preset.symbols.map((s) => String(s || '').toUpperCase()).filter(Boolean)
                : [];
            if (!symbols.length) return;
            setCustomWatchlists((prev) => {
                const current = prev[listName] || [];
                return { ...prev, [listName]: [...new Set([...current, ...symbols])] };
            });
            if (!selectedCustomWatchlist) setSelectedCustomWatchlist(listName);
        },
        importSymbolsToCustomWatchlist: (symbols, targetListName) => {
            const listName = targetListName || selectedCustomWatchlist || 'Default';
            const clean = [...new Set((symbols || []).map((s) => String(s || '').trim().toUpperCase()).filter(Boolean))];
            if (!clean.length) return;
            setCustomWatchlists((prev) => {
                const current = prev[listName] || [];
                return { ...prev, [listName]: [...new Set([...current, ...clean])] };
            });
            if (!selectedCustomWatchlist) setSelectedCustomWatchlist(listName);
        },

        removeSymbolFromCustomWatchlist: (listName, symbol) => {
            setCustomWatchlists((prev) => {
                const current = prev[listName] || [];
                return { ...prev, [listName]: current.filter((s) => s !== symbol) };
            });
        },
        clearCustomWatchlist: (listName) => {
            const name = (listName || '').trim() || 'Default';
            setCustomWatchlists((prev) => ({ ...prev, [name]: [] }));
        },
        setWatchlistLabFormValue: (key, value) =>
            setWatchlistLabForm((prev) => ({
                ...prev,
                [key]: value,
            })),
        addWatchlistLabEntry: () => {
            const listName = selectedCustomWatchlist || 'Default';
            const symbol = (watchlistLabForm.symbol || '').trim().toUpperCase();
            const title = (watchlistLabForm.title || '').trim();
            const notes = (watchlistLabForm.notes || '').trim();
            if (!symbol || !title) return;
            setWatchlistLabs((prev) => [
                {
                    id: `${Date.now()}_${symbol}`,
                    listName,
                    symbol,
                    type: watchlistLabForm.type || 'economics',
                    title,
                    notes,
                    createdAt: new Date().toISOString(),
                },
                ...prev,
            ]);
            setWatchlistLabForm((prev) => ({ ...prev, title: '', notes: '' }));
        },
        removeWatchlistLabEntry: (id) => {
            setWatchlistLabs((prev) => prev.filter((x) => x.id !== id));
        },
        engageWatchlistLlm: async (symbol, mode = 'analyze') => {
            const sym = (symbol || '').trim().toUpperCase();
            if (!sym) return;
            if (mode === 'review') {
                await handlers.handlePromptSubmit(`Review watchlist thesis for $${sym}. Include risk triggers, industry drift, and next checkpoint.`);
            } else if (mode === 'economics') {
                await handlers.handlePromptSubmit(`Build an economics lab brief for $${sym}: macro sensitivity, rates/inflation links, and scenario table.`);
            } else {
                await handlers.handlePromptSubmit(`$${sym}`);
            }
        },
        setWatchlistCronFormValue: (key, value) =>
            setWatchlistCronForm((prev) => ({
                ...prev,
                [key]: value,
            })),
        createWatchlistCronJob: async () => {
            const payload = {
                category: (watchlistCronForm.category || screenerCategory || '').trim(),
                lookback: Math.max(30, Number(watchlistCronForm.lookback || 365)),
                cron_schedule: (watchlistCronForm.cron_schedule || '').trim(),
            };
            if (!payload.category || !payload.cron_schedule) return;
            let remoteMessage = 'Saved locally';
            try {
                const r = await fetch(`${API_BASE}/api/screener/cron`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                const d = await r.json();
                remoteMessage = d?.message || 'Saved remotely';
            } catch {
                remoteMessage = 'Saved locally (API unavailable)';
            }
            setWatchlistCronJobs((prev) => [
                {
                    id: `${Date.now()}_${payload.category}`,
                    listName: selectedCustomWatchlist || 'Default',
                    category: payload.category,
                    lookback: payload.lookback,
                    cron_schedule: payload.cron_schedule,
                    note: (watchlistCronForm.note || '').trim(),
                    status: remoteMessage,
                    createdAt: new Date().toISOString(),
                },
                ...prev,
            ]);
        },
        removeWatchlistCronJob: (id) => {
            setWatchlistCronJobs((prev) => prev.filter((x) => x.id !== id));
        },
        setMacroLabLookbackDays: (days) => {
            const d = Math.max(90, Math.min(3650, Number(days || 365)));
            setMacroLabConfig((prev) => ({ ...prev, lookbackDays: d }));
        },
        setMacroLabWeight: (key, value) => {
            const v = Math.max(0, Math.min(5, Number(value || 0)));
            setMacroLabConfig((prev) => ({
                ...prev,
                weights: { ...prev.weights, [key]: v },
            }));
        },
        setMacroLabScenario: (scenario) => {
            const allowed = ['Base', 'Bull', 'Bear', 'Shock'];
            const s = allowed.includes(scenario) ? scenario : 'Base';
            setMacroLabConfig((prev) => ({ ...prev, scenario: s }));
        },
        setMacroLabSort: (key) => {
            const numericKeys = ['totalScore', 'confidence', 'risk', 'rates', 'inflation', 'fx', 'zScore'];
            setMacroLabSort((prev) => {
                if (prev.key === key) {
                    return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
                }
                return { key, dir: numericKeys.includes(key) ? 'desc' : 'asc' };
            });
        },
        refreshMacroLab: async () => {
            await loadMacroLabSnapshot();
        },
        setMacroLabInputMode: (mode) => setMacroLabInputMode(mode),
        setMlResearchConfigValue: (key, value) => {
            const nextValue =
                key === 'forecastHorizon'
                    ? Math.max(1, Math.min(20, Number(value || 5)))
                    : key === 'trainWindow'
                        ? Math.max(60, Math.min(400, Number(value || 160)))
                        : Math.max(120, Math.min(3650, Number(value || 365)));
            setMlResearchConfig((prev) => ({ ...prev, [key]: nextValue }));
        },
        runResearchMl: async () => {
            const symbols = (macroLabInputSymbols || []).slice(0, 18);
            if (!symbols.length || mlResearchLoading) {
                if (!symbols.length) setMlResearchRows([]);
                return;
            }
            setMlResearchLoading(true);
            try {
                const response = await fetch(`${API_BASE}/api/research/ml/signals`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        symbols,
                        lookback_days: Number(mlResearchConfig.lookbackDays || 365),
                        forecast_horizon: Number(mlResearchConfig.forecastHorizon || 5),
                        train_window: Number(mlResearchConfig.trainWindow || 160),
                    }),
                });
                const data = await response.json();
                setMlResearchRows(Array.isArray(data?.rows) ? data.rows : []);
            } catch (e) {
                console.error(e);
                setMlResearchRows([]);
            } finally {
                setMlResearchLoading(false);
            }
        },
        setMacroLabNote: (symbol, value) => {
            const sym = String(symbol || '').toUpperCase();
            if (!sym) return;
            setMacroLabNotes((prev) => ({ ...prev, [sym]: value }));
        },
        generateMacroBrief: async (symbol) => {
            const sym = String(symbol || '').toUpperCase();
            if (!sym || macroLabBriefLoading) return;
            const row = (macroLabImpactRows || []).find((r) => r.symbol === sym);
            if (!row) return;
            if (!localLlmEnabled) {
                setChatHistory((prev) => [
                    ...prev,
                    { role: 'system', text: 'Enable local LLM in Platform settings to generate macro brief.' },
                ]);
                return;
            }
            setMacroLabBriefLoading(true);
            try {
                const analysis = await runLocalLlmChat({
                    system:
                        'You are a macro strategist. Write a concise, practical 4-bullet macro brief with positioning risks and catalysts. No investment advice.',
                    prompt: [
                        `Symbol: ${sym}`,
                        `Macro stance: ${row.stance}`,
                        `Total impact score: ${row.totalScore.toFixed(2)} (z=${Number(row.zScore || 0).toFixed(2)})`,
                        `Factor contributions: risk=${row.factors.risk.toFixed(2)}, rates=${row.factors.rates.toFixed(2)}, inflation=${row.factors.inflation.toFixed(2)}, fx=${row.factors.fx.toFixed(2)}`,
                        `Regime: riskOn=${Number(macroLabSnapshot?.regime?.riskOn || 0).toFixed(2)}, ratesPressure=${Number(macroLabSnapshot?.regime?.ratesPressure || 0).toFixed(2)}, inflationPressure=${Number(macroLabSnapshot?.regime?.inflationPressure || 0).toFixed(2)}, usdPressure=${Number(macroLabSnapshot?.regime?.usdPressure || 0).toFixed(2)}`,
                        'Output: 1) macro read, 2) exposure map, 3) trigger levels, 4) risk controls.',
                    ].join('\n'),
                    temperature: 0.25,
                });
                setMacroLabNotes((prev) => ({ ...prev, [sym]: analysis || prev[sym] || '' }));
            } catch (e) {
                setChatHistory((prev) => [...prev, { role: 'system', text: `Macro brief failed: ${e?.message || 'unknown error'}` }]);
            } finally {
                setMacroLabBriefLoading(false);
            }
        },

        createPortfolio: () => {
            const name = (newPortfolioName || '').trim();
            if (!name) return;
            setPortfolios((prev) => {
                if (prev[name]) return prev;
                return { ...prev, [name]: [] };
            });
            setSelectedPortfolio(name);
            setNewPortfolioName('');
            setPortfolioRenameInput('');
        },

        renamePortfolio: () => {
            const nextName = (portfolioRenameInput || '').trim();
            const currentName = (selectedPortfolio || '').trim();
            if (!currentName || !nextName || currentName === nextName) return;
            setPortfolios((prev) => {
                if (!prev[currentName] || prev[nextName]) return prev;
                const clone = { ...prev, [nextName]: prev[currentName] };
                delete clone[currentName];
                return clone;
            });
            setSelectedPortfolio(nextName);
            setPortfolioRenameInput(nextName);
        },
        duplicatePortfolio: (mode = 'full', targetName = '') => {
            const sourceName = (selectedPortfolio || '').trim();
            const nextName = (targetName || '').trim();
            if (!sourceName || !nextName || sourceName === nextName) return;
            setPortfolios((prev) => {
                if (!prev[sourceName] || prev[nextName]) return prev;
                const sourceRows = Array.isArray(prev[sourceName]) ? prev[sourceName] : [];
                const clonedRows = mode === 'structure'
                    ? []
                    : sourceRows.map((row, idx) => ({
                        ...row,
                        id: `${Date.now()}_${idx}_${String(row?.symbol || 'ROW').toUpperCase()}`,
                        importSource: row?.importSource || 'portfolio_duplicate',
                        importBatchId: `clone_${Date.now()}`,
                    }));
                return { ...prev, [nextName]: clonedRows };
            });
            setSelectedPortfolio(nextName);
            setPortfolioRenameInput(nextName);
        },
        replacePortfolios: (nextPortfolios) => {
            setPortfolios(normalizePortfolioMap(nextPortfolios));
        },

        deletePortfolio: (name) => {
            if (!name) return;
            if (!window.confirm(`Delete portfolio "${name}"?`)) return;
            setPortfolios((prev) => {
                const clone = { ...prev };
                delete clone[name];
                return Object.keys(clone).length ? clone : { ...DEFAULT_PORTFOLIOS };
            });
        },

        refreshPortfolioPrices: async () => {
            if (!selectedPortfolioTransactions.length) return;
            const updated = await Promise.all(
                selectedPortfolioTransactions.map(async (p) => {
                    try {
                        const r = await fetch(`${API_BASE}/api/ticker/${encodeURIComponent(p.symbol)}`);
                        const d = await r.json();
                        return {
                            ...p,
                            assetName: p.assetName || d?.longName || d?.name || p.symbol,
                            currentPrice: d && !d.error && typeof d.price === 'number' ? d.price : p.currentPrice,
                            currencySymbol: d?.currencySymbol || p.currencySymbol || '$',
                            segment: p.segment || d?.assetFamily || p.segment || 'Equity',
                        };
                    } catch {
                        return p;
                    }
                })
            );
            setPortfolios((prev) => ({ ...prev, [selectedPortfolio]: updated }));
        },

        submitPortfolioPosition: async () => {
            const symbol = (portfolioForm.symbol || '').trim().toUpperCase();
            const assetNameInput = (portfolioForm.assetName || '').trim();
            const description = (portfolioForm.description || '').trim();
            const notes = (portfolioForm.notes || '').trim();
            const side = (portfolioForm.side || 'BUY').trim().toUpperCase();
            const subtype = (portfolioForm.transactionSubtype || '').trim();
            const quantityInput = Number(portfolioForm.quantity || 0);
            const priceInput = Number(portfolioForm.price || 0);
            const quantity = ['FEE', 'TAX'].includes(side) && quantityInput <= 0 ? 1 : quantityInput;
            const price = ['FEE', 'TAX'].includes(side) ? Math.max(priceInput, Number(portfolioForm.manualCharge || 0), Number(portfolioForm.manualTax || 0), 0) : priceInput;
            const manualCharge = Number(portfolioForm.manualCharge || 0);
            const manualTax = Number(portfolioForm.manualTax || 0);
            const tradeDate = (portfolioForm.tradeDate || '').trim();
            const purchaseType = (portfolioForm.purchaseType || 'Delivery').trim() || 'Delivery';
            const platform = (portfolioForm.platform || '').trim();
            const country = (portfolioForm.country || '').trim();
            const stateName = (portfolioForm.state || '').trim();
            const brokerReference = (portfolioForm.brokerReference || '').trim();
            const needsPositivePrice = side !== 'ADJUSTMENT';
            const needsPositiveQty = !['FEE', 'TAX'].includes(side);
            if (!symbol) return;
            if (needsPositiveQty && quantity <= 0) return;
            if (needsPositivePrice && price <= 0) return;
            let currentPrice = price;
            let currencySymbol = 'INR';
            let assetName = assetNameInput || symbol;
            let segment = portfolioForm.segment || 'Equity';
            try {
                const r = await fetch(`${API_BASE}/api/ticker/${encodeURIComponent(symbol)}`);
                const d = await r.json();
                if (d && !d.error && typeof d.price === 'number') currentPrice = d.price;
                if (d?.currencySymbol) currencySymbol = d.currencySymbol;
                if (!assetNameInput) assetName = d?.longName || d?.name || assetName;
                if (d?.assetFamily && (!portfolioForm.segment || portfolioForm.segment === 'Equity')) {
                    segment = d.assetFamily;
                }
            } catch (e) {
                console.error(e);
            }
            const row = {
                id: editingPortfolioPositionId || `${Date.now()}_${symbol}`,
                entryType: 'transaction',
                side,
                transactionSubtype: side === 'ADJUSTMENT' ? (subtype || 'Manual') : '',
                symbol,
                assetName,
                description,
                notes,
                brokerReference,
                purchaseType,
                tradeDate,
                platform,
                country: country || 'India',
                state: stateName,
                segment,
                quantity,
                price,
                currentPrice,
                currencySymbol,
                manualCharge,
                manualTax,
                chargeSnapshot: portfolioFeePreview || null,
                createdAt: new Date().toISOString(),
            };
            setPortfolios((prev) => {
                const currentRows = prev[selectedPortfolio] || [];
                if (portfolioModalMode === 'edit' && editingPortfolioPositionId) {
                    return {
                        ...prev,
                        [selectedPortfolio]: currentRows.map((p) => (p.id === editingPortfolioPositionId ? row : p)),
                    };
                }
                return {
                    ...prev,
                    [selectedPortfolio]: [row, ...currentRows],
                };
            });
            handlers.closePortfolioModal();
        },

        removePortfolioPosition: (id, portfolioName = selectedPortfolio) => {
            if (!portfolioName) return;
            setPortfolios((prev) => ({
                ...prev,
                [portfolioName]: (prev[portfolioName] || []).filter((p) => p.id !== id),
            }));
        },

        generateAiSuggestions: async () => {
            const symbols =
                (customWatchlists[selectedCustomWatchlist] || []).slice(0, 3).length > 0
                    ? (customWatchlists[selectedCustomWatchlist] || []).slice(0, 3)
                    : (watchlistSymbols || []).slice(0, 3);
            if (!symbols.length || aiSuggesting) return;
            setAiSuggesting(true);
            try {
                const outs = await Promise.all(
                    symbols.map(async (sym) => {
                        try {
                            const res = await fetch(`${API_BASE}/api/agents/context-run`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    symbol: sym,
                                    instruction:
                                        'Give one concise actionable watchlist suggestion with risk note, based on fresh context and price behavior.',
                                }),
                            });
                            const data = await res.json();
                            if (data.ok && data.final_message) return { symbol: sym, text: data.final_message };
                            // Fallback to deterministic suggestion when local LLM is unavailable.
                            const td = await fetch(`${API_BASE}/api/ticker/${encodeURIComponent(sym)}`).then((r) => r.json());
                            if (td && !td.error) {
                                const pct = Number(td.changePct || 0);
                                const stance = pct >= 0 ? 'momentum watch' : 'mean-reversion watch';
                                return {
                                    symbol: sym,
                                    text: `${stance}: day change ${pct.toFixed(2)}%, monitor support/resistance and news drift before adding exposure.`,
                                };
                            }
                            return { symbol: sym, text: data.error || 'AI suggestion failed.' };
                        } catch {
                            return { symbol: sym, text: 'AI suggestion request failed.' };
                        }
                    })
                );
                setAiSuggestions(outs);
            } finally {
                setAiSuggesting(false);
            }
        },

        handlePivotClick: (idx, customPivots = detectedPivots) => {
            setActivePivotIndex(idx);
            setUserPrompt("");
            const pivot = customPivots[idx];
            if (ohlcData && ohlcData.length > 0 && pivot) {
                const startIdx = Math.max(0, pivot.dataIndex - 12);
                setChartZoom({
                    min: new Date(ohlcData[startIdx].x).getTime(),
                    max: new Date(ohlcData[ohlcData.length - 1].x).getTime(),
                });
            }
        },

        openTerminal: async (symbol, tf = '1Y', autoScan = false, opts = {}) => {
            const skipViewMode = Boolean(opts && opts.skipViewMode);
            if (!skipViewMode) {
                setViewMode('terminal');
            }
            setChartLoading(true);
            setCurrentTimeframe(tf);

            const symEnc = encodeURIComponent(symbol);
            const tfEnc = encodeURIComponent(tf);
            
            if (symbol !== selectedTicker) {
                setSelectedTicker(symbol); setTickerDetails(null); setOptionsData(null); setOhlcData([]);
                setSelectedCandle(null);
                setDetectedPivots([]); setHasScannedPitchforks(false); 
                setShowPitchfork(autoScan); setChartZoom({ min: undefined, max: undefined });
            } else if (autoScan) setShowPitchfork(true);
      
            try {
              const [detailRes, ohlcRes, optRes] = await Promise.all([
                fetch(`${API_BASE}/api/ticker/${symEnc}`),
                fetch(`${API_BASE}/api/ticker/${symEnc}/ohlc?timeframe=${tfEnc}`),
                fetch(`${API_BASE}/api/ticker/${symEnc}/options`)
              ]);
              
              setTickerDetails(await detailRes.json());
              const rawOhlc = await ohlcRes.json();
              const ohlcSeries = Array.isArray(rawOhlc) ? rawOhlc : [];
              setOhlcData(ohlcRes.ok ? ohlcSeries : []);
              setOptionsData(await optRes.json());
      
              if (autoScan && ohlcSeries.length > 0) {
                  setMathCalculating(true);
                  setTimeout(() => {
                      const all = enumerateAllPitchforks(ohlcSeries, screenerLookback, pitchforkType);
                      setDetectedPivots(all);
                      setActivePivotIndex(0);
                      setHasScannedPitchforks(true);
                      if (all.length > 0) {
                          const startIdx = Math.max(0, all[0].dataIndex - 12);
                          setChartZoom({
                              min: new Date(ohlcSeries[startIdx].x).getTime(),
                              max: new Date(ohlcSeries[ohlcSeries.length - 1].x).getTime(),
                          });
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
                    const res = await fetch(`${API_BASE}/api/ticker/${encodeURIComponent(sym)}/ohlc?timeframe=10Y`);
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

        findForkInAll: async () => {
            const symbolsToScan = Object.values(tickersData || {}).flat();
            if (!symbolsToScan.length) return;
            const deduped = Array.from(new Set(symbolsToScan)).slice(0, 1200);
            setIsScreening(true);
            setScreenerResults([]);
            const foundResults = [];
            for (let i = 0; i < deduped.length; i++) {
                const sym = deduped[i];
                setScreenerProgress({ current: i + 1, total: deduped.length, symbol: sym });
                await new Promise((resolve) => setTimeout(resolve, 4));
                try {
                    const res = await fetch(`${API_BASE}/api/ticker/${encodeURIComponent(sym)}/ohlc?timeframe=10Y`);
                    const data = await res.json();
                    if (data && data.length > 50) {
                        const forks = findActivePitchforks(data, screenerLookback, pitchforkType);
                        if (forks.length > 0) foundResults.push({ symbol: sym, fork: forks[0] });
                    }
                } catch (e) {
                    // continue scanning
                }
            }
            foundResults.sort((a, b) => a.fork.nearnessScore - b.fork.nearnessScore);
            setScreenerResults(foundResults);
            setForkScanResults(foundResults);
            setForkScanMeta({
                savedAt: new Date().toISOString(),
                totalScanned: deduped.length,
                pitchforkType,
                lookback: screenerLookback,
            });
            setIsScreening(false);
            setChatHistory((prev) => [
                ...prev,
                { role: 'system', text: `Fork scan complete across ${deduped.length} symbols. Found ${foundResults.length} setups.` },
            ]);
        },
        clearForkScanResults: () => {
            setForkScanResults([]);
            setScreenerResults([]);
            setForkScanMeta((prev) => ({ ...prev, savedAt: null, totalScanned: 0 }));
            try {
                localStorage.removeItem(FORK_SCAN_STORAGE_KEY);
            } catch (e) {
                console.error(e);
            }
        },
        downloadAllAndCalculateForks: async () => {
            if (allDataJob?.status === 'queued' || allDataJob?.status === 'running') return;
            setAllDataJob({ status: 'queued', current: 0, total: 0, current_symbol: null });
            try {
                const res = await fetch(`${API_BASE}/api/admin/download-all-and-calculate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        include_intraday: false,
                        sleep_seconds: 0.05,
                        lookback_days: Math.max(365, Number(screenerLookback || 365)),
                    }),
                });
                const d = await res.json();
                if (d.ok && d.job_id) {
                    setAllDataJob({
                        job_id: d.job_id,
                        status: d.status || 'queued',
                        current: 0,
                        total: 0,
                        current_symbol: null,
                    });
                } else {
                    setAllDataJob(null);
                    setChatHistory((prev) => [
                        ...prev,
                        { role: 'system', text: `Unable to start download+calculate: ${d.error || 'unknown error'}` },
                    ]);
                }
            } catch {
                setAllDataJob(null);
                setChatHistory((prev) => [
                    ...prev,
                    { role: 'system', text: 'Unable to start download+calculate: API unavailable.' },
                ]);
            }
        },

        fetchOptionsForDate: async (symbol, date) => {
            setOptionsLoading(true);
            try {
              const res = await fetch(`${API_BASE}/api/ticker/${encodeURIComponent(symbol)}/options?date=${encodeURIComponent(date)}`);
              setOptionsData(await res.json());
            } catch (err) { console.error(err); } finally { setOptionsLoading(false); }
        },

        handlePromptSubmit: async (overrideText = null) => {
            const text = overrideText || userPrompt;
            if (!text.trim() || isAnalyzing) return;
            
            setUserPrompt("");
            setChatHistory(prev => [...prev, { role: 'user', text }]);
            const upper = text.toUpperCase();
      
            if (upper.match(/\$([-A-Z0-9.^]+)/)) {
                const symbol = upper.match(/\$([-A-Z0-9.^]+)/)[1];
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
                let pivotContext = 'No pitchfork pivot selected.';
                if (hasScannedPitchforks && detectedPivots.length > 0) {
                    const p = detectedPivots[activePivotIndex];
                    if (p?.encompassesAllFutureOhlc && p.isActive) {
                        pivotContext = `${p.variation} ${p.type} fork: every bar after the pivot (high and low) has stayed inside the channel through the last bar (${p.totalFutureBars} bars). Last close ${p.positionPct}% of band (${p.zoneLabel}).`;
                    } else if (p?.closeContainedFullHistory && !p.encompassesAllFutureOhlc) {
                        pivotContext = `${p.variation} ${p.type} at ${p.date}: all closes inside fork to the end, but some wicks pierced the channel. OHLC inside streak ${p.daysActive} of ${p.totalFutureBars} bars.`;
                    } else if (p) {
                        pivotContext = `Selected ${p.variation} ${p.type} at ${p.date}. Not a full future contain: first ${p.daysActive} bar(s) fully inside (OHLC), then a wick or close left the fork. Extended band vs last close: ${p.zoneLabel} (${p.positionPct}%).`;
                    }
                }
                let newsContext = "";
                if (tickerDetails?.news?.length > 0) {
                    newsContext = "\n\nRecent News:\n" + tickerDetails.news.map(n => `- ${n.title}`).join("\n");
                }
                const finalPrompt = `Context: ${selectedTicker} is currently trading at ${tickerDetails?.price || 'unknown'}. ${pivotContext}${newsContext}\n\nUser Question: ${text}`;
      
                try {
                    if (localLlmEnabled) {
                        const analysis = await runLocalLlmChat({
                            system:
                                'You are an elite quantitative trader. Give a concise 3-bullet trading thesis: Risk, Reward, Action. Not investment advice.',
                            prompt: finalPrompt,
                        });
                        setChatHistory(prev => [...prev, { role: 'ai', text: analysis || 'Local LLM returned no output.' }]);
                    } else {
                        const res = await fetch(`${API_BASE}/api/ai/analyze`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ symbol: selectedTicker, price: tickerDetails?.price || 0, zoneLabel: detectedPivots[activePivotIndex]?.zoneLabel || "None", positionPct: detectedPivots[activePivotIndex]?.positionPct || "0", daysActive: detectedPivots[activePivotIndex]?.daysActive || 0, customPrompt: finalPrompt })
                        });
                        const data = await res.json();
                        setChatHistory(prev => [...prev, { role: 'ai', text: data.analysis || data.error }]);
                    }
                } catch (err) { setChatHistory(prev => [...prev, { role: 'ai', text: "Error connecting to local LLM/backend AI." }]); } finally { setIsAnalyzing(false); }
            } else {
                setChatHistory(prev => [...prev, { role: 'ai', text: "Please open an asset first." }]);
                setIsAnalyzing(false);
            }
        },

        handleFullSync: async () => {
            setIsSyncing(true);
            try {
                const res = await fetch(`${API_BASE}/api/ticker/${encodeURIComponent(selectedTicker)}/download`, { method: 'POST' });
                const data = await res.json();
                if (data.status === "success") setChatHistory(prev => [...prev, { role: 'system', text: `✅ Downloaded complete history for ${selectedTicker}.` }]);
                else setChatHistory(prev => [...prev, { role: 'system', text: `❌ Sync failed: ${data.error}` }]);
            } catch (err) { setChatHistory(prev => [...prev, { role: 'system', text: `❌ Connection lost.` }]); } finally { setIsSyncing(false); }
        },

        refreshConsumerPreview: async () => {
            if (!selectedTicker) return;
            setConsumerLoading(true);
            try {
                const res = await fetch(`${API_BASE}/api/context/consumer/preview/${encodeURIComponent(selectedTicker)}`);
                setConsumerPreview(await res.json());
            } catch {
                setConsumerPreview(null);
            } finally {
                setConsumerLoading(false);
            }
        },

        runConsumerRag: async () => {
            if (!selectedTicker || consumerRagLoading) return;
            setConsumerRagLoading(true);
            setChatHistory((prev) => [
                ...prev,
                {
                    role: 'user',
                    text: `[Consumer Risk RAG] ${selectedTicker}: complaints vs. market context (retrieve + correlation + local LLM).`,
                },
            ]);
            try {
                const res = await fetch(`${API_BASE}/api/context/consumer/query`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        symbol: selectedTicker,
                        question:
                            'Summarize consumer complaint themes for this issuer using retrieved excerpts. Comment on monthly complaint counts vs monthly log returns; stress correlation is not causation.',
                        k: 8,
                        months_back: 24,
                    }),
                });
                const data = await res.json();
                const txt = data.ok ? data.analysis : data.error || 'Consumer Risk RAG failed.';
                setChatHistory((prev) => [...prev, { role: 'ai', text: typeof txt === 'string' ? txt : JSON.stringify(txt) }]);
            } catch {
                setChatHistory((prev) => [...prev, { role: 'ai', text: 'Consumer Risk RAG request failed (is the API up?).' }]);
            } finally {
                setConsumerRagLoading(false);
            }
        },

        refreshWatchlistSummary: loadWatchlistSummary,

        addToWatchlist: async (sym) => {
            const s = sym || selectedTicker;
            if (!s) return;
            const next = [...new Set([...watchlistSymbols, s])];
            try {
                await fetch(`${API_BASE}/api/watchlist`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ symbols: next }),
                });
                await loadWatchlistSummary();
            } catch (e) {
                console.error(e);
            }
        },

        removeFromWatchlist: async (sym) => {
            const next = watchlistSymbols.filter((x) => x !== sym);
            try {
                await fetch(`${API_BASE}/api/watchlist`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ symbols: next }),
                });
                await loadWatchlistSummary();
            } catch (e) {
                console.error(e);
            }
        },

        refreshWatchlistNews: async () => {
            if (!watchlistSymbols.length) return;
            try {
                await fetch(`${API_BASE}/api/context/news/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ symbols: watchlistSymbols }),
                });
                await loadWatchlistSummary();
            } catch (e) {
                console.error(e);
            }
        },

        refreshSavedNewsForTicker: async () => {
            if (!selectedTicker) return;
            try {
                await fetch(`${API_BASE}/api/context/news/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ symbol: selectedTicker }),
                });
                const u = await fetch(
                    `${API_BASE}/api/context/unified/${encodeURIComponent(selectedTicker)}`
                ).then((r) => r.json());
                setUnifiedContext(u);
                await loadWatchlistSummary();
            } catch (e) {
                console.error(e);
            }
        },

        runContextAgent: async () => {
            if (!selectedTicker || contextAgentLoading) return;
            setContextAgentLoading(true);
            setChatHistory((prev) => [
                ...prev,
                { role: 'user', text: `[Context AI] ${selectedTicker} — news, open web context, consumer cases, OHLC.` },
            ]);
            try {
                const res = await fetch(`${API_BASE}/api/agents/context-run`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ symbol: selectedTicker }),
                });
                const data = await res.json();
                const txt = data.ok ? data.final_message : data.error || JSON.stringify(data);
                setChatHistory((prev) => [...prev, { role: 'ai', text: typeof txt === 'string' ? txt : JSON.stringify(txt) }]);
            } catch {
                setChatHistory((prev) => [...prev, { role: 'ai', text: 'Context AI failed (API / Ollama?).' }]);
            } finally {
                setContextAgentLoading(false);
            }
        },
        refreshHomeDashboard: async () => {
            if (!Object.keys(tickersData).length) return;
            await loadHomeDashboard(tickersData, watchSummaryRows);
        },
        nukeLocalData: async () => {
            const ok = window.confirm(
                'This will permanently delete local market parquet data, saved news, and context caches. Continue?'
            );
            if (!ok) return;
            setMaintenanceBusy(true);
            try {
                const res = await fetch(`${API_BASE}/api/admin/nuke-local-data`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                });
                const data = await res.json();
                if (data.ok) {
                    setChatHistory((prev) => [...prev, { role: 'system', text: 'Local data nuked successfully.' }]);
                    await loadWatchlistSummary();
                    await loadHomeDashboard(tickersData, watchSummaryRows);
                } else {
                    setChatHistory((prev) => [...prev, { role: 'system', text: `Nuke failed: ${data.error || 'unknown error'}` }]);
                }
            } catch {
                setChatHistory((prev) => [...prev, { role: 'system', text: 'Nuke failed: API unavailable.' }]);
            } finally {
                setMaintenanceBusy(false);
            }
        },
        resetAndRedownloadAll: async () => {
            const ok = window.confirm(
                'This will delete local saved data and start full redownload for all symbols. Continue?'
            );
            if (!ok) return;
            setMaintenanceBusy(true);
            try {
                const res = await fetch(`${API_BASE}/api/admin/reset-and-redownload`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                });
                const data = await res.json();
                if (data.ok && data.redownload?.job_id) {
                    setRedownloadJob({
                        job_id: data.redownload.job_id,
                        status: data.redownload.status || 'queued',
                        current: 0,
                        total: 0,
                    });
                    setChatHistory((prev) => [
                        ...prev,
                        {
                            role: 'system',
                            text: `Reset complete. Redownload started (job ${data.redownload.job_id}).`,
                        },
                    ]);
                } else {
                    setChatHistory((prev) => [...prev, { role: 'system', text: `Reset/redownload failed: ${data.error || 'unknown error'}` }]);
                }
            } catch {
                setChatHistory((prev) => [...prev, { role: 'system', text: 'Reset/redownload failed: API unavailable.' }]);
            } finally {
                setMaintenanceBusy(false);
            }
        },
        cleanDashboard: async () => {
            const ok = window.confirm(
                'Reset workspace and clear local UI data (watchlists, portfolios, AI insights, local chat), and clear server watchlist?'
            );
            if (!ok) return;
            setMaintenanceBusy(true);
            try {
                localStorage.removeItem(CUSTOM_WATCHLISTS_KEY);
                localStorage.removeItem(PORTFOLIOS_KEY);
                localStorage.removeItem(LEGACY_PORTFOLIO_KEY);
                localStorage.removeItem(FORK_SCAN_STORAGE_KEY);
                localStorage.removeItem(WATCHLIST_LABS_KEY);
                localStorage.removeItem(WATCHLIST_CRON_KEY);
                localStorage.removeItem(MACRO_LAB_CONFIG_KEY);
                localStorage.removeItem(MACRO_LAB_NOTES_KEY);

                setCustomWatchlists({ Default: [] });
                setSelectedCustomWatchlist('Default');
                setNewWatchlistName('');
                setWatchlistSymbolInput('');

                setPortfolios({ ...DEFAULT_PORTFOLIOS });
                setSelectedPortfolio('Main');
                setNewPortfolioName('');
                setPortfolioRenameInput('');
                setPortfolioForm({ ...DEFAULT_PORTFOLIO_FORM });
                setPortfolioModalOpen(false);
                setPortfolioModalMode('add');
                setEditingPortfolioPositionId(null);
                setPortfolioSearchResults([]);
                setPortfolioSearchOpen(false);
                setPortfolioAutoFillHint('');

                setAiSuggestions([]);
                setDailyInsights([]);
                setForkScanResults([]);
                setForkScanMeta({
                    savedAt: null,
                    totalScanned: 0,
                    pitchforkType,
                    lookback: screenerLookback,
                });
                setScreenerResults([]);
                setWatchlistLabs([]);
                setWatchlistCronJobs([]);
                setWatchlistLabForm({ symbol: '', type: 'economics', title: '', notes: '' });
                setWatchlistCronForm({
                    category: Object.keys(tickersData || {})[0] || '',
                    lookback: 365,
                    cron_schedule: '0 9 * * 1-5',
                    note: 'Morning fork scan and alert processing',
                });
                setMacroLabConfig({
                    lookbackDays: 365,
                    scenario: 'Base',
                    weights: { rates: 1, inflation: 1, fx: 1, risk: 1 },
                });
                setMacroLabSnapshot(null);
                setMacroLabImpactRows([]);
                setMacroLabNotes({});
                setMacroLabSort({ key: 'totalScore', dir: 'desc' });
                setUserPrompt('');
                setChatHistory([
                    {
                        role: 'system',
                        text: 'Workspace reset. Enter a ticker (e.g. $AAPL), type /SCAN, or ask for analysis.',
                    },
                ]);

                try {
                    await fetch(`${API_BASE}/api/watchlist`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ symbols: [] }),
                    });
                } catch (e) {
                    console.error(e);
                }

                await loadWatchlistSummary();
                if (Object.keys(tickersData).length) {
                    await loadHomeDashboard(tickersData, []);
                }
            } finally {
                setMaintenanceBusy(false);
            }
        },
    };

    return {
        state: {
            loading, viewMode, theme, themeOptions: THEME_OPTIONS, tickersData, tickersLoadError, tickerCategorySummary, tickerPresets, categoryLabelMap, searchInput, searchTerm,
            homeLoading, homeStats, homeLeaders, homeLaggers, homeFocusList,
            maintenanceBusy, redownloadJob,
            allDataJob,
            dailyInsights, aiSuggestions, aiSuggesting,
            customWatchlists, newWatchlistName, watchlistSymbolInput, selectedCustomWatchlist,
            portfolios, newPortfolioName, selectedPortfolio, selectedPortfolioTransactions, selectedPortfolioPositions, portfolioRenameInput, portfolioForm, portfolioHydrated, portfolioSyncing, portfolioSnapshots,
            portfolioSearchResults, portfolioSearchLoading, portfolioSearchOpen, portfolioModalOpen, portfolioModalMode, editingPortfolioPositionId, portfolioAutoFillHint, portfolioFeeRegistry, portfolioFeePreview, portfolioFeePreviewLoading,
            selectedCandle,
            selectedTicker, tickerDetails, ohlcData, optionsData, currentTimeframe, chartLoading, mathCalculating, optionsLoading, isSyncing,
            liveStatus, chartDisplayType, showVolume, showEMA20, showSMA50, showSMA200, showPitchfork, chartZoom,
            pitchforkType, hasScannedPitchforks, detectedPivots, activePivotIndex,
            screenerCategory, screenerLookback, isScreening, screenerResults, screenerProgress,
            forkScanResults, forkScanMeta,
            userPrompt, isAnalyzing, chatHistory, chatEndRef,
            localLlmEnabled, localLlmBaseUrl, localLlmModel, localLlmTesting, localLlmLastStatus,
            consumerPreview, consumerLoading, consumerRagLoading,
            watchlistSymbols, watchSummaryRows, watchlistLoading, watchlistSymbolMeta, autoIndustryWatchlists,
            watchlistSearchResults, watchlistSearchLoading, watchlistSearchOpen,
            watchlistLabs, watchlistLabForm, watchlistCronJobs, watchlistCronForm,
            macroLabConfig, macroLabSnapshot, macroLabLoading, macroLabImpactRows, macroLabNotes, macroLabBriefLoading, macroLabSort, macroLabInputMode, macroLabInputSymbols,
            mlResearchConfig, mlResearchRows, mlResearchLoading,
            unifiedContext, unifiedLoading,
            contextAgentLoading,
        },
        setState: {
            setViewMode, setSearchInput, setShowVolume, setShowEMA20, setShowSMA50, setShowSMA200, setShowPitchfork,
            setPitchforkType, setScreenerCategory, setScreenerLookback, setUserPrompt, setChartDisplayType,
        },
        handlers
    };
}

export default useQuantEngine;
