import React, { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'react-apexcharts';
import {
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Tooltip as ReTooltip,
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Legend,
} from 'recharts';
import './App.css';
import {
    buildPortfolioSnapshot as ledgerBuildPortfolioSnapshot,
    deriveHoldingsFromTransactions as ledgerDeriveHoldingsFromTransactions,
    getPortfolioStats as ledgerGetPortfolioStats,
    normalizeLegacyPortfolioRows as ledgerNormalizeLegacyPortfolioRows,
    normalizePortfolioMap as ledgerNormalizePortfolioMap,
    normalizePortfolioSnapshots as ledgerNormalizePortfolioSnapshots,
    normalizePortfolioTransaction as ledgerNormalizePortfolioTransaction,
} from './portfolioLedger';

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

const ixTime = (data, ix) => new Date(data[ix].x).getTime();
const CUSTOM_WATCHLISTS_KEY = 'qe_custom_watchlists_v1';
const PORTFOLIOS_KEY = 'qe_portfolios_v2';
const LEGACY_PORTFOLIO_KEY = 'qe_portfolio_positions_v1';
const PORTFOLIO_SNAPSHOTS_KEY = 'qe_portfolio_snapshots_v1';
const SEGMENT_CHOICES = [
    'Equity',
    'ETF',
    'Index',
    'Mutual Fund',
    'Bond',
    'Fixed Income',
    'Commodity',
    'FX',
    'Crypto',
    'Cash',
    'Real Estate',
    'Private Asset',
    'Insurance / Pension',
    'Other',
];
const PURCHASE_TYPE_CHOICES = ['Delivery', 'Intraday', 'Futures', 'Options', 'ETF', 'Mutual Fund', 'Crypto', 'FX', 'Commodity'];
const API_BASE = process.env.REACT_APP_API_BASE || 'http://127.0.0.1:8000';
const THEME_KEY = 'qe_theme_v1';
/** light = traditional dashboard; dark = midnight; ocean = cool slate; sand = warm paper */
const THEME_OPTIONS = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Midnight' },
    { id: 'ocean', label: 'Ocean' },
    { id: 'sand', label: 'Sand' },
];
const THEME_IDS = new Set(THEME_OPTIONS.map((t) => t.id));
const chartUsesLightPalette = (t) => t === 'light' || t === 'sand';
const FORK_SCAN_STORAGE_KEY = 'qe_fork_scan_results_v1';
const LOCAL_LLM_CONFIG_KEY = 'qe_local_llm_config_v1';
const WATCHLIST_LABS_KEY = 'qe_watchlist_labs_v1';
const WATCHLIST_CRON_KEY = 'qe_watchlist_cron_v1';
const MACRO_LAB_CONFIG_KEY = 'qe_macro_lab_config_v1';
const MACRO_LAB_NOTES_KEY = 'qe_macro_lab_notes_v1';
const PORTFOLIO_PROMPT_LIBRARY_KEY = 'qe_portfolio_prompt_library_v1';
const PORTFOLIO_PROMPT_HISTORY_KEY = 'qe_portfolio_prompt_history_v1';
const PORTFOLIO_JOURNAL_KEY = 'qe_portfolio_journal_v1';
const DEFAULT_PORTFOLIOS = { Main: [] };
const TRANSACTION_SIDE_CHOICES = ['BUY', 'SELL', 'DIVIDEND', 'FEE', 'TAX', 'ADJUSTMENT'];
const ADJUSTMENT_SUBTYPE_CHOICES = ['Manual', 'Split', 'Bonus', 'Merger'];
const DEFAULT_PORTFOLIO_FORM = {
    side: 'BUY',
    transactionSubtype: '',
    assetName: '',
    symbol: '',
    description: '',
    notes: '',
    purchaseType: 'Delivery',
    tradeDate: '',
    price: '',
    quantity: '',
    platform: '',
    country: '',
    state: '',
    segment: 'Equity',
    brokerReference: '',
    manualCharge: '',
    manualTax: '',
};

const REGION_TO_COUNTRY = {
    us: 'United States',
    usa: 'United States',
    india: 'India',
    uk: 'United Kingdom',
    europe: 'Europe',
    japan: 'Japan',
    asia: 'Asia',
    australia: 'Australia',
    canada: 'Canada',
    china: 'China',
    singapore: 'Singapore',
    hongkong: 'Hong Kong',
    'hong kong': 'Hong Kong',
    global: 'Global',
};

const normalizePortfolioSegment = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return 'Equity';
    const lower = raw.toLowerCase();
    if (lower === 'stock' || lower === 'stocks' || lower === 'equities') return 'Equity';
    if (lower === 'etf') return 'ETF';
    if (lower === 'index' || lower === 'indices') return 'Index';
    if (lower === 'mutual fund' || lower === 'mutualfund') return 'Mutual Fund';
    if (lower === 'bond') return 'Bond';
    if (lower === 'fixed income' || lower === 'fixedincome') return 'Fixed Income';
    if (lower === 'commodity' || lower === 'commodities') return 'Commodity';
    if (lower === 'fx' || lower === 'forex') return 'FX';
    if (lower === 'crypto' || lower === 'cryptocurrency') return 'Crypto';
    if (lower === 'cash') return 'Cash';
    if (lower === 'real estate' || lower === 'realestate') return 'Real Estate';
    if (lower === 'private asset' || lower === 'privateasset') return 'Private Asset';
    if (lower === 'insurance / pension' || lower === 'insurance' || lower === 'pension') return 'Insurance / Pension';
    if (lower === 'other') return 'Other';
    return SEGMENT_CHOICES.includes(raw) ? raw : 'Equity';
};

const derivePurchaseTypeForSegment = (segment) => {
    const normalized = normalizePortfolioSegment(segment);
    if (PURCHASE_TYPE_CHOICES.includes(normalized)) return normalized;
    if (normalized === 'Index') return 'Delivery';
    if (normalized === 'Bond' || normalized === 'Fixed Income') return 'Delivery';
    if (normalized === 'Cash' || normalized === 'Real Estate' || normalized === 'Private Asset' || normalized === 'Insurance / Pension' || normalized === 'Other') {
        return 'Delivery';
    }
    return 'Delivery';
};

const deriveCountryFromInstrument = (row) => {
    const region = String(row?.region || '').trim().toLowerCase();
    if (REGION_TO_COUNTRY[region]) return REGION_TO_COUNTRY[region];
    const exchange = String(row?.exchange || '').trim().toLowerCase();
    if (exchange.includes('nse') || exchange.includes('bse') || exchange.includes('india')) return 'India';
    if (exchange.includes('nasdaq') || exchange.includes('nyse') || exchange.includes('amex') || exchange.includes('arca')) return 'United States';
    if (exchange.includes('lse')) return 'United Kingdom';
    if (exchange.includes('tsx')) return 'Canada';
    if (exchange.includes('asx')) return 'Australia';
    if (exchange.includes('hkex') || exchange.includes('hong kong')) return 'Hong Kong';
    if (exchange.includes('sgx')) return 'Singapore';
    return '';
};

const deriveCountryFromSegment = (segment, fallbackSymbol = '') => {
    const normalized = normalizePortfolioSegment(segment);
    const sym = String(fallbackSymbol || '').toUpperCase();
    if (sym.endsWith('.NS') || sym.endsWith('.BO')) return 'India';
    if (normalized === 'Cash' || normalized === 'Other') return '';
    if (normalized === 'Mutual Fund' || normalized === 'Bond' || normalized === 'Fixed Income' || normalized === 'Insurance / Pension') return 'India';
    if (normalized === 'Real Estate' || normalized === 'Private Asset') return 'Global';
    return '';
};

const normalizePortfolioMap = (input) => {
    const next = ledgerNormalizePortfolioMap(input);
    return Object.keys(next).length ? next : { ...DEFAULT_PORTFOLIOS };
};

const normalizeLegacyPortfolioRows = (rows) => ledgerNormalizeLegacyPortfolioRows(rows);

const getPortfolioStats = (positions, transactions = []) => {
    const rows = Array.isArray(positions) ? positions : [];
    const looksLikeTransactions = rows.some((row) => row && typeof row === 'object' && (row.entryType || row.side || row.transactionType));
    if (looksLikeTransactions) {
        const holdings = ledgerDeriveHoldingsFromTransactions(rows);
        return ledgerGetPortfolioStats(holdings, rows);
    }
    return ledgerGetPortfolioStats(positions, transactions);
};

const normalizePortfolioSnapshots = (raw) => ledgerNormalizePortfolioSnapshots(raw);

const buildPortfolioSnapshot = (portfolioMap, capturedAt = new Date().toISOString()) => ledgerBuildPortfolioSnapshot(portfolioMap, capturedAt);

const buildForkLink = (symbol) => {
    const base = `${window.location.origin}${window.location.pathname}`;
    const p = new URLSearchParams({
        module: 'analysis',
        symbol: String(symbol || '').toUpperCase(),
        fork: '1',
    });
    return `${base}?${p.toString()}`;
};

const downloadTextFile = (filename, text, mimeType = 'text/plain;charset=utf-8') => {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
};

const rowsToCsv = (rows) => {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return '';
    const keys = Array.from(new Set(list.flatMap((row) => Object.keys(row || {}))));
    const escape = (value) => {
        const text = String(value ?? '');
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return [keys.join(','), ...list.map((row) => keys.map((key) => escape(row?.[key])).join(','))].join('\n');
};

const calcPearson = (a, b) => {
    const n = Math.min(a.length, b.length);
    if (n < 8) return 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
        const x = Number(a[i]);
        const y = Number(b[i]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        sx += x;
        sy += y;
        sxx += x * x;
        syy += y * y;
        sxy += x * y;
    }
    const num = n * sxy - sx * sy;
    const den = Math.sqrt(Math.max(1e-12, (n * sxx - sx * sx) * (n * syy - sy * sy)));
    return den === 0 ? 0 : num / den;
};

const calcZScore = (v, arr) => {
    if (!arr.length) return 0;
    const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
    const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, arr.length - 1);
    const sd = Math.sqrt(Math.max(1e-12, variance));
    return (v - mean) / sd;
};

const toReturnSeries = (ohlcRows) => {
    const closes = (ohlcRows || [])
        .map((d) => Number(d?.y?.[3]))
        .filter((x) => Number.isFinite(x) && x > 0);
    const out = [];
    for (let i = 1; i < closes.length; i++) {
        out.push(Math.log(closes[i] / closes[i - 1]));
    }
    return out;
};

/**
 * Pure Andrews pitchfork:
 * L1–H–L2 (swing high at center): chord H→L2; median from L1 through midpoint(H,L2); parallels through H and L2.
 * H1–L–H2 (swing low at center): chord L→H2; median from H1 through midpoint(L,H2); parallels through L and H2.
 */
const buildPitchforkAtIndex = (data, i, type = 'Standard') => {
    if (!data || i < 1 || i >= data.length - 1) return null;
    const endX = data.length - 1;
    const currentClose = data[endX].y[3];
    const p1 = data[i - 1], p2 = data[i], p3 = data[i + 1];
    const h1 = p1.y[1], h2 = p2.y[1], h3 = p3.y[1];
    const l1 = p1.y[2], l2 = p2.y[2], l3 = p3.y[2];

    const x1 = i - 1, x2 = i, x3 = i + 1;

    let pivotType = null;
    /** Fork pivots P1→P2→P3 in time (prices at bar lows/highs per pattern). */
    let P1, P2, P3, pivotPrice;

    if (h2 > h1 && h2 > h3) {
        pivotType = 'LHL';
        P1 = { ix: x1, py: l1 };
        P2 = { ix: x2, py: h2 };
        P3 = { ix: x3, py: l3 };
        pivotPrice = h2;
    } else if (l2 < l1 && l2 < l3) {
        pivotType = 'HLH';
        P1 = { ix: x1, py: h1 };
        P2 = { ix: x2, py: l2 };
        P3 = { ix: x3, py: h3 };
        pivotPrice = l2;
    }
    if (!pivotType) return null;

    const Mx = (P2.ix + P3.ix) / 2;
    const My = (P2.py + P3.py) / 2;

    let Sx = P1.ix;
    let Sy = P1.py;
    if (type === 'Schiff') {
        Sx = (P1.ix + P2.ix) / 2;
        Sy = (P1.py + P2.py) / 2;
    } else if (type === 'Modified') {
        Sx = P1.ix;
        Sy = (P1.py + P2.py) / 2;
    }

    const denom = Mx - Sx;
    if (Math.abs(denom) < 1e-12) return null;
    const m = (My - Sy) / (Mx - Sx);

    const lineAt = (j, anchorIx, anchorPy) => anchorPy + m * (j - anchorIx);
    const yMedian = (j) => Sy + m * (j - Sx);
    const yThroughP2 = (j) => lineAt(j, P2.ix, P2.py);
    const yThroughP3 = (j) => lineAt(j, P3.ix, P3.py);

    const channelBounds = (j) => {
        const ub = Math.max(yThroughP2(j), yThroughP3(j));
        const lb = Math.min(yThroughP2(j), yThroughP3(j));
        return { ub, lb };
    };

    /** Bars after pivot (x3+1 … end) whose full range stays inside the fork (encompasses all future OHLC). */
    const totalFutureBars = endX - x3;
    let ohlcBarsInsideStreak = 0;
    for (let j = x3 + 1; j < data.length; j++) {
        const { ub, lb } = channelBounds(j);
        const hi = data[j].y[1];
        const low = data[j].y[2];
        if (low >= lb && hi <= ub) ohlcBarsInsideStreak++;
        else break;
    }
    const encompassesAllFutureOhlc =
        totalFutureBars > 0 && ohlcBarsInsideStreak === totalFutureBars;

    /** Every close still inside (weaker — wicks may pierce). */
    let closeBarsInsideStreak = 0;
    for (let j = x3 + 1; j < data.length; j++) {
        const { ub, lb } = channelBounds(j);
        const cl = data[j].y[3];
        if (cl <= ub && cl >= lb) closeBarsInsideStreak++;
        else break;
    }
    const closeContainedFullHistory =
        totalFutureBars > 0 && closeBarsInsideStreak === totalFutureBars;

    const MIN_FUTURE_BARS = 3;
    const isActive =
        encompassesAllFutureOhlc && totalFutureBars >= MIN_FUTURE_BARS;

    const currentUpper = Math.max(yThroughP2(endX), yThroughP3(endX));
    const currentLower = Math.min(yThroughP2(endX), yThroughP3(endX));
    const range = currentUpper - currentLower;
    const positionPct = range !== 0 ? ((currentClose - currentLower) / range) * 100 : 50;

    let zoneLabel = 'Neutral Zone', zoneColor = '#888888';
    if (positionPct <= 20) { zoneLabel = 'Testing Support'; zoneColor = '#10B981'; }
    else if (positionPct >= 80) { zoneLabel = 'Testing Resistance'; zoneColor = '#EF4444'; }
    else if (positionPct >= 45 && positionPct <= 55) { zoneLabel = 'Testing Median'; zoneColor = '#F59E0B'; }

    const nearnessScore = Math.min(positionPct, 100 - positionPct, Math.abs(50 - positionPct));

    const tEnd = ixTime(data, endX);
    const drawStart = Math.max(0, Math.min(Sx, P1.ix, P2.ix) - 1);

    const upperProng = pivotType === 'LHL'
        ? { ix: P2.ix, py: P2.py, yEnd: yThroughP2(endX) }
        : { ix: P3.ix, py: P3.py, yEnd: yThroughP3(endX) };
    const lowerProng = pivotType === 'LHL'
        ? { ix: P3.ix, py: P3.py, yEnd: yThroughP3(endX) }
        : { ix: P2.ix, py: P2.py, yEnd: yThroughP2(endX) };
    const zoneStart = Math.min(P2.ix, P3.ix);
    const zoneData = [];
    for (let j = zoneStart; j <= endX; j++) {
        zoneData.push({
            x: ixTime(data, j),
            y: [Math.min(yThroughP2(j), yThroughP3(j)), Math.max(yThroughP2(j), yThroughP3(j))],
        });
    }

    const series = [
        {
            name: 'PF Zone',
            type: 'rangeArea',
            color: '#d4af37',
            data: zoneData,
        },
        {
            name: 'PF Chord',
            type: 'line',
            data: [
                { x: ixTime(data, P2.ix), y: P2.py },
                { x: ixTime(data, P3.ix), y: P3.py },
            ],
        },
        {
            name: 'PF Median',
            type: 'line',
            data: [
                { x: ixTime(data, drawStart), y: yMedian(drawStart) },
                { x: tEnd, y: yMedian(endX) },
            ],
        },
        {
            name: 'PF Upper',
            type: 'line',
            data: [
                { x: ixTime(data, upperProng.ix), y: upperProng.py },
                { x: tEnd, y: upperProng.yEnd },
            ],
        },
        {
            name: 'PF Lower',
            type: 'line',
            data: [
                { x: ixTime(data, lowerProng.ix), y: lowerProng.py },
                { x: tEnd, y: lowerProng.yEnd },
            ],
        },
    ];

    return {
        type: pivotType,
        variation: type,
        date: p2.x,
        dataIndex: i,
        /** Consecutive bars from first post-pivot bar with full OHLC inside fork (until first violation). */
        daysActive: ohlcBarsInsideStreak,
        totalFutureBars,
        encompassesAllFutureOhlc,
        closeContainedFullHistory,
        price: pivotPrice,
        positionPct: positionPct.toFixed(1),
        zoneLabel,
        zoneColor,
        nearnessScore,
        isUnbroken: closeContainedFullHistory,
        isActive,
        series,
        pivotKey: `${i}-${pivotType}-${p2.x}`,
    };
};

/** Every LHL/HLH pivot in lookback (newest / active first for UI). */
const enumerateAllPitchforks = (data, lookbackDays = 5475, type = 'Standard') => {
    if (!data || data.length < 5) return [];
    const cutoffTime = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
    const out = [];
    for (let i = 1; i < data.length - 1; i++) {
        if (new Date(data[i].x).getTime() < cutoffTime) continue;
        const pf = buildPitchforkAtIndex(data, i, type);
        if (pf) out.push(pf);
    }
    const sortRank = (p) =>
        (p.encompassesAllFutureOhlc ? 4 : 0) +
        (p.closeContainedFullHistory && !p.encompassesAllFutureOhlc ? 2 : 0) +
        (p.isActive ? 1 : 0);
    out.sort((a, b) => sortRank(b) - sortRank(a) || b.dataIndex - a.dataIndex);
    return out;
};

/** Screener: forks whose full OHLC stayed inside through the last bar (≥3 future bars). */
const findActivePitchforks = (data, lookbackDays, type = 'Standard') =>
    enumerateAllPitchforks(data, lookbackDays, type)
        .filter((p) => p.isActive)
        .sort((a, b) => a.nearnessScore - b.nearnessScore);

// =========================================================================
// 2. THE LOGIC ENGINE (Custom Hook)
// =========================================================================
function useQuantEngine() {
    // Global App State
    const [viewMode, setViewMode] = useState('home');
    const [theme, setTheme] = useState('sand');
    const [loading, setLoading] = useState(true);
    const [tickersData, setTickersData] = useState({});
    const [tickerNameMap, setTickerNameMap] = useState({});
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
    const [tickerRefreshJob, setTickerRefreshJob] = useState(null);
    const [nonEquityJob, setNonEquityJob] = useState(null);
    const [homeMacro, setHomeMacro] = useState(null);
    const [homePortfolioAnalytics, setHomePortfolioAnalytics] = useState(null);
    const [homeAiHealth, setHomeAiHealth] = useState(null);
    const [homeAiAlertCount, setHomeAiAlertCount] = useState(0);
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
        { role: 'system', text: 'Quant Engine AI ready. Ask anything — portfolio, technicals, comparisons, or type $AAPL to open a ticker.' }
    ]);
    const [localLlmEnabled, setLocalLlmEnabled] = useState(true);
    const [localLlmBaseUrl, setLocalLlmBaseUrl] = useState('http://127.0.0.1:11434');
    const [localLlmModel, setLocalLlmModel] = useState('llama3.1');
    const [localLlmTesting, setLocalLlmTesting] = useState(false);
    const [localLlmLastStatus, setLocalLlmLastStatus] = useState('');
    const chatEndRef = useRef(null);

    // AI Session & Streaming State
    const [chatSessionId, setChatSessionId] = useState(null);
    const [chatSessions, setChatSessions] = useState([]);
    const [chatSessionsOpen, setChatSessionsOpen] = useState(false);
    const [streamingText, setStreamingText] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [activeTools, setActiveTools] = useState([]);

    // AI Model Registry
    const [availableModels, setAvailableModels] = useState([]);
    const [modelAssignments, setModelAssignments] = useState({});
    const [ollamaHealth, setOllamaHealth] = useState(null);

    // AI Alerts & Screener
    const [aiAlerts, setAiAlerts] = useState([]);
    const [aiAlertsLoading, setAiAlertsLoading] = useState(false);
    const [screenerJobId, setScreenerJobId] = useState(null);
    const [screenerRunning, setScreenerRunning] = useState(false);
    const [unreadAlertCount, setUnreadAlertCount] = useState(0);

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
            // Fire all fetches in parallel: ticker data + macro + portfolio analytics + AI health + alerts
            const [responses, macroRes, portfolioRes, aiHealthRes, alertsRes] = await Promise.all([
                Promise.all(
                    targets.map((sym) =>
                        fetch(`${API_BASE}/api/ticker/${encodeURIComponent(sym)}`)
                            .then((r) => (r.ok ? r.json() : null))
                            .catch(() => null)
                    )
                ),
                fetch(`${API_BASE}/api/macro/snapshot`).then(r => r.ok ? r.json() : null).catch(() => null),
                fetch(`${API_BASE}/api/portfolio/analytics`).then(r => r.ok ? r.json() : null).catch(() => null),
                fetch(`${API_BASE}/api/ai/models/health`).then(r => r.ok ? r.json() : null).catch(() => null),
                fetch(`${API_BASE}/api/ai/alerts?unread_only=true&limit=10`).then(r => r.ok ? r.json() : null).catch(() => null),
            ]);

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

            // Store macro snapshot
            if (macroRes) setHomeMacro(macroRes);
            // Store portfolio analytics
            if (portfolioRes?.ok) setHomePortfolioAnalytics(portfolioRes.analytics || null);
            // Store AI health
            if (aiHealthRes) setHomeAiHealth(aiHealthRes);
            // Store unread alert count
            if (alertsRes?.ok) setHomeAiAlertCount((alertsRes.alerts || []).length);
        } finally {
            setHomeLoading(false);
        }
    };

    useEffect(() => {
        fetch(`${API_BASE}/api/tickers`)
        .then(res => res.json())
        .then(data => {
            if(!data.error) {
                setTickersData(data);
                setScreenerCategory(Object.keys(data)[0] || '');
                loadHomeDashboard(data, watchSummaryRows);
            }
            setLoading(false);
        }).catch(err => { console.error("API Offline", err); setLoading(false); });
        // Fetch enriched ticker names for instant display
        fetch(`${API_BASE}/api/tickers/names`)
        .then(res => res.json())
        .then(data => { if (data?.ok && data.names) setTickerNameMap(data.names); })
        .catch(err => console.error("Ticker names fetch failed", err));
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
            const matched = raw.match(/[A-Z0-9.^=-]+/);
            const sym = matched ? matched[0] : '';
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

        openTerminal: async (symbol, tf = '1Y', autoScan = false) => {
            setViewMode('terminal');
            setChartLoading(true);
            setCurrentTimeframe(tf);
            
            if (symbol !== selectedTicker) {
                setSelectedTicker(symbol); setTickerDetails(null); setOptionsData(null); setOhlcData([]);
                setSelectedCandle(null);
                setDetectedPivots([]); setHasScannedPitchforks(false); 
                setShowPitchfork(autoScan); setChartZoom({ min: undefined, max: undefined });
            } else if (autoScan) setShowPitchfork(true);
      
            try {
              const [detailRes, ohlcRes, optRes] = await Promise.all([
                fetch(`${API_BASE}/api/ticker/${symbol}`),
                fetch(`${API_BASE}/api/ticker/${symbol}/ohlc?timeframe=${tf}`),
                fetch(`${API_BASE}/api/ticker/${symbol}/options`)
              ]);
              
              setTickerDetails(await detailRes.json());
              const rawOhlc = await ohlcRes.json();
              setOhlcData(rawOhlc);
              setOptionsData(await optRes.json());
      
              if (autoScan && rawOhlc.length > 0) {
                  setMathCalculating(true);
                  setTimeout(() => {
                      const all = enumerateAllPitchforks(rawOhlc, screenerLookback, pitchforkType);
                      setDetectedPivots(all);
                      setActivePivotIndex(0);
                      setHasScannedPitchforks(true);
                      if (all.length > 0) {
                          const startIdx = Math.max(0, all[0].dataIndex - 12);
                          setChartZoom({
                              min: new Date(rawOhlc[startIdx].x).getTime(),
                              max: new Date(rawOhlc[rawOhlc.length - 1].x).getTime(),
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
                    const res = await fetch(`${API_BASE}/api/ticker/${sym}/ohlc?timeframe=10Y`);
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
                    const res = await fetch(`${API_BASE}/api/ticker/${sym}/ohlc?timeframe=10Y`);
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
              const res = await fetch(`${API_BASE}/api/ticker/${symbol}/options?date=${date}`);
              setOptionsData(await res.json());
            } catch (err) { console.error(err); } finally { setOptionsLoading(false); }
        },

        handlePromptSubmit: async (overrideText = null) => {
            const text = overrideText || userPrompt;
            if (!text.trim() || isAnalyzing || isStreaming) return;

            setUserPrompt("");
            setChatHistory(prev => [...prev, { role: 'user', text }]);
            const upper = text.toUpperCase();

            // Command shortcuts
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
            if (upper.startsWith('/SCREEN')) {
                setChatHistory(prev => [...prev, { role: 'system', text: 'Running AI screener on watchlist + portfolio...' }]);
                handlers.runAiScreener(); return;
            }
            if (upper === '/NEW') {
                setChatSessionId(null);
                setChatHistory([{ role: 'system', text: 'New conversation started.' }]);
                return;
            }
            if (upper === '/SESSIONS') {
                setChatSessionsOpen(prev => !prev); return;
            }

            // Unified AI chat with streaming
            setIsStreaming(true);
            setStreamingText('');
            setActiveTools([]);

            try {
                const response = await fetch(`${API_BASE}/api/ai/chat/stream`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: text,
                        session_id: chatSessionId,
                        symbol: selectedTicker || null,
                        model: localLlmModel,
                        role: 'chat',
                    }),
                });

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let accumulated = '';
                let sessionCaptured = false;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });

                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (line.startsWith('event: ')) {
                            const eventType = line.slice(7).trim();
                            continue;
                        }
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                const parentLine = lines[lines.indexOf(line) - 1] || '';
                                const evType = parentLine.startsWith('event: ') ? parentLine.slice(7).trim() : '';

                                if (evType === 'session' && data.session_id) {
                                    if (!sessionCaptured) {
                                        setChatSessionId(data.session_id);
                                        sessionCaptured = true;
                                    }
                                } else if (evType === 'tool_start') {
                                    setActiveTools(prev => [...prev, data.tool]);
                                    setChatHistory(prev => [...prev, { role: 'system', text: `Using tool: ${data.tool}...` }]);
                                } else if (evType === 'tool_result') {
                                    setActiveTools(prev => prev.filter(t => t !== data.tool));
                                } else if (evType === 'token') {
                                    accumulated += data.content;
                                    setStreamingText(accumulated);
                                } else if (evType === 'done') {
                                    if (accumulated) {
                                        setChatHistory(prev => [...prev, { role: 'ai', text: accumulated }]);
                                    }
                                    setStreamingText('');
                                } else if (evType === 'error') {
                                    setChatHistory(prev => [...prev, { role: 'ai', text: `Error: ${data.error}` }]);
                                }
                            } catch {}
                        }
                    }
                }

                // If stream ended without a done event
                if (accumulated && !streamingText) {
                    setChatHistory(prev => [...prev, { role: 'ai', text: accumulated }]);
                }
            } catch (err) {
                // Fallback: try non-streaming endpoint
                try {
                    const res = await fetch(`${API_BASE}/api/ai/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            message: text,
                            session_id: chatSessionId,
                            symbol: selectedTicker || null,
                            model: localLlmModel,
                        }),
                    });
                    const data = await res.json();
                    if (data.session_id) setChatSessionId(data.session_id);
                    const reply = data.ok ? data.final_message : (data.error || 'AI request failed.');
                    setChatHistory(prev => [...prev, { role: 'ai', text: reply }]);
                } catch {
                    setChatHistory(prev => [...prev, { role: 'ai', text: 'Error connecting to AI backend. Is the server running?' }]);
                }
            } finally {
                setIsStreaming(false);
                setStreamingText('');
                setActiveTools([]);
            }
        },

        handleFullSync: async () => {
            setIsSyncing(true);
            try {
                const res = await fetch(`${API_BASE}/api/ticker/${selectedTicker}/download`, { method: 'POST' });
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
        // --- New AI Handlers ---
        runAiScreener: async () => {
            if (screenerRunning) return;
            setScreenerRunning(true);
            setChatHistory(prev => [...prev, { role: 'user', text: '[AI Screener] Scanning watchlist + portfolio for signals...' }]);
            try {
                const res = await fetch(`${API_BASE}/api/ai/screener/scan`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ use_ai: true }),
                });
                const data = await res.json();
                if (data.ok) {
                    setAiAlerts(data.alerts || []);
                    const stats = data.stats || {};
                    let summary = `Screener complete: ${stats.total_alerts || 0} alerts across ${stats.symbols_with_alerts || 0} symbols (${data.symbols_scanned} scanned).`;
                    if (data.ai_summaries && Object.keys(data.ai_summaries).length > 0) {
                        summary += '\n\n' + Object.entries(data.ai_summaries).map(([sym, s]) => `**${sym}**: ${s}`).join('\n\n');
                    } else if (data.alerts?.length > 0) {
                        summary += '\n\n' + data.alerts.slice(0, 8).map(a => `[${a.severity}] ${a.title}`).join('\n');
                    }
                    setChatHistory(prev => [...prev, { role: 'ai', text: summary }]);
                } else {
                    setChatHistory(prev => [...prev, { role: 'ai', text: data.error || 'Screener failed.' }]);
                }
            } catch {
                setChatHistory(prev => [...prev, { role: 'ai', text: 'AI Screener request failed.' }]);
            } finally {
                setScreenerRunning(false);
            }
        },

        loadAiAlerts: async () => {
            setAiAlertsLoading(true);
            try {
                const res = await fetch(`${API_BASE}/api/ai/alerts?limit=50&unread_only=false`);
                const data = await res.json();
                if (data.ok) {
                    setAiAlerts(data.alerts || []);
                    setUnreadAlertCount((data.alerts || []).filter(a => !a.read).length);
                }
            } catch {} finally { setAiAlertsLoading(false); }
        },

        loadChatSessions: async () => {
            try {
                const res = await fetch(`${API_BASE}/api/ai/sessions?limit=30`);
                const data = await res.json();
                if (data.ok) setChatSessions(data.sessions || []);
            } catch {}
        },

        loadChatSession: async (sid) => {
            try {
                const res = await fetch(`${API_BASE}/api/ai/sessions/${sid}/messages?limit=200`);
                const data = await res.json();
                if (data.ok) {
                    setChatSessionId(sid);
                    const msgs = (data.messages || [])
                        .filter(m => m.role === 'user' || (m.role === 'assistant' && m.content))
                        .map(m => ({ role: m.role === 'user' ? 'user' : 'ai', text: m.content }));
                    setChatHistory([
                        { role: 'system', text: 'Loaded previous conversation.' },
                        ...msgs,
                    ]);
                    setChatSessionsOpen(false);
                }
            } catch {}
        },

        deleteChatSession: async (sid) => {
            try {
                await fetch(`${API_BASE}/api/ai/sessions/${sid}`, { method: 'DELETE' });
                setChatSessions(prev => prev.filter(s => s.session_id !== sid));
                if (chatSessionId === sid) {
                    setChatSessionId(null);
                    setChatHistory([{ role: 'system', text: 'Session deleted. New conversation started.' }]);
                }
            } catch {}
        },

        loadAvailableModels: async () => {
            try {
                const [modelsRes, healthRes, assignRes] = await Promise.all([
                    fetch(`${API_BASE}/api/ai/models`),
                    fetch(`${API_BASE}/api/ai/models/health`),
                    fetch(`${API_BASE}/api/ai/models/assignments`),
                ]);
                const modelsData = await modelsRes.json();
                const healthData = await healthRes.json();
                const assignData = await assignRes.json();
                if (modelsData.ok) setAvailableModels(modelsData.models || []);
                setOllamaHealth(healthData);
                if (assignData.ok) setModelAssignments(assignData.assignments || {});
            } catch {}
        },

        setModelForRole: async (role, model) => {
            try {
                const res = await fetch(`${API_BASE}/api/ai/models/assignments`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ role, model }),
                });
                const data = await res.json();
                if (data.ok) {
                    setModelAssignments(prev => ({ ...prev, [role]: { ...prev[role], model } }));
                }
            } catch {}
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
        refreshTickerUniverse: async () => {
            if (tickerRefreshJob?.status === 'running' || tickerRefreshJob?.status === 'queued') return;
            setTickerRefreshJob({ status: 'queued', job_id: null, log: '' });
            try {
                const res = await fetch(`${API_BASE}/api/admin/refresh-tickers`, { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                    setTickerRefreshJob({ status: data.status, job_id: data.job_id, log: '' });
                    // Poll for completion
                    const poll = setInterval(async () => {
                        try {
                            const sr = await fetch(`${API_BASE}/api/admin/refresh-tickers-status/${data.job_id}`);
                            const sd = await sr.json();
                            if (sd.ok) {
                                setTickerRefreshJob({ status: sd.status, job_id: sd.job_id, log: sd.log || '' });
                                if (sd.status === 'completed' || sd.status === 'failed') {
                                    clearInterval(poll);
                                    if (sd.status === 'completed') {
                                        // Reload tickers data + names
                                        const [tickRes, namesRes] = await Promise.all([
                                            fetch(`${API_BASE}/api/tickers`),
                                            fetch(`${API_BASE}/api/tickers/names`),
                                        ]);
                                        const tickData = await tickRes.json();
                                        if (!tickData.error) {
                                            setTickersData(tickData);
                                            setScreenerCategory(Object.keys(tickData)[0] || '');
                                            setChatHistory((prev) => [...prev, { role: 'system', text: `Ticker universe refreshed successfully. ${Object.keys(tickData).length} categories loaded.` }]);
                                        }
                                        try {
                                            const namesData = await namesRes.json();
                                            if (namesData?.ok && namesData.names) setTickerNameMap(namesData.names);
                                        } catch { /* ignore */ }
                                    } else {
                                        setChatHistory((prev) => [...prev, { role: 'system', text: `Ticker refresh failed: ${sd.error || 'unknown error'}` }]);
                                    }
                                }
                            }
                        } catch { /* ignore poll errors */ }
                    }, 3000);
                } else {
                    setTickerRefreshJob(null);
                    setChatHistory((prev) => [...prev, { role: 'system', text: `Ticker refresh failed: ${data.error || 'unknown error'}` }]);
                }
            } catch {
                setTickerRefreshJob(null);
                setChatHistory((prev) => [...prev, { role: 'system', text: 'Ticker refresh failed: API unavailable.' }]);
            }
        },
        downloadTickersJson: () => {
            window.open(`${API_BASE}/api/admin/download-tickers-json`, '_blank');
        },
        downloadNonEquityData: async () => {
            if (nonEquityJob?.status === 'running' || nonEquityJob?.status === 'queued') return;
            setNonEquityJob({ status: 'queued', current: 0, total: 0, current_symbol: '' });
            try {
                const res = await fetch(`${API_BASE}/api/admin/download-non-equity`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sleep_seconds: 0.5 }),
                });
                const data = await res.json();
                if (data.ok) {
                    setNonEquityJob({ status: 'running', job_id: data.job_id, current: 0, total: 0, current_symbol: '' });
                    const poll = setInterval(async () => {
                        try {
                            const sr = await fetch(`${API_BASE}/api/admin/redownload-status/${data.job_id}`);
                            const sd = await sr.json();
                            if (sd.ok) {
                                setNonEquityJob({
                                    status: sd.status, job_id: sd.job_id,
                                    current: sd.current || 0, total: sd.total || 0,
                                    current_symbol: sd.current_symbol || '',
                                });
                                if (sd.status === 'completed' || sd.status === 'failed') {
                                    clearInterval(poll);
                                    if (sd.status === 'completed') {
                                        setChatHistory((prev) => [...prev, { role: 'system', text: `Non-equity data download complete. ${sd.stats?.success || 0} symbols downloaded.` }]);
                                    } else {
                                        setChatHistory((prev) => [...prev, { role: 'system', text: `Non-equity download failed: ${sd.error || 'unknown'}` }]);
                                    }
                                }
                            }
                        } catch { /* poll error */ }
                    }, 3000);
                } else {
                    setNonEquityJob(null);
                }
            } catch {
                setNonEquityJob(null);
                setChatHistory((prev) => [...prev, { role: 'system', text: 'Non-equity download failed: API unavailable.' }]);
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
            loading, viewMode, theme, themeOptions: THEME_OPTIONS, tickersData, tickerNameMap, tickerCategorySummary, tickerPresets, categoryLabelMap, searchInput, searchTerm,
            homeLoading, homeStats, homeLeaders, homeLaggers, homeFocusList, homeMacro, homePortfolioAnalytics, homeAiHealth, homeAiAlertCount,
            maintenanceBusy, redownloadJob,
            allDataJob, tickerRefreshJob, nonEquityJob,
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
            chatSessionId, chatSessions, chatSessionsOpen, streamingText, isStreaming, activeTools,
            availableModels, modelAssignments, ollamaHealth,
            aiAlerts, aiAlertsLoading, screenerRunning, unreadAlertCount,
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
            setChatSessionId, setChatSessionsOpen, setChatHistory,
        },
        handlers
    };
}


// =========================================================================
// 3. UI COMPONENTS (Pure Presentation Layer)
// =========================================================================

const AIChatSidebar = ({ state, setState, handlers }) => {
    return (
        <aside className="qe-sidebar" aria-label="Assistant">
            <div className="qe-sidebar__brand">
                <h1 className="qe-sidebar__logo" onClick={() => setState.setViewMode('home')}>
                    <span className="qe-sidebar__logo-mark" aria-hidden>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 3v18h18" />
                            <path d="m19 9-5 5-4-4-3 3" />
                        </svg>
                    </span>
                    Quant Engine
                </h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {state.unreadAlertCount > 0 && (
                        <span className="qe-pill qe-pill--alert" title={`${state.unreadAlertCount} unread alerts`} onClick={() => handlers.loadAiAlerts()} style={{ cursor: 'pointer', background: '#e74c3c', color: '#fff', fontSize: 11 }}>
                            {state.unreadAlertCount}
                        </span>
                    )}
                    <span className={`qe-pill ${state.liveStatus === 'LIVE' ? 'qe-pill--live' : ''}`}>{state.liveStatus}</span>
                </div>
            </div>

            {/* Session switcher */}
            {state.chatSessionsOpen && (
                <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-color, #333)', maxHeight: 200, overflowY: 'auto', fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <strong>Chat Sessions</strong>
                        <button type="button" className="qe-chip" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => { setState.setChatSessionId(null); setState.setChatHistory([{ role: 'system', text: 'New conversation.' }]); setState.setChatSessionsOpen(false); }}>
                            + New
                        </button>
                    </div>
                    {state.chatSessions.map(s => (
                        <div key={s.session_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', opacity: s.session_id === state.chatSessionId ? 1 : 0.7, cursor: 'pointer' }} onClick={() => handlers.loadChatSession(s.session_id)}>
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || 'Untitled'}</span>
                            <button type="button" onClick={e => { e.stopPropagation(); handlers.deleteChatSession(s.session_id); }} style={{ background: 'none', border: 'none', color: '#e74c3c', cursor: 'pointer', fontSize: 11, padding: '0 4px' }}>×</button>
                        </div>
                    ))}
                    {state.chatSessions.length === 0 && <div style={{ opacity: 0.5 }}>No saved sessions yet.</div>}
                </div>
            )}

            <div className="qe-chat">
                {state.chatHistory.map((msg, i) => {
                    // Find the preceding user message for evaluation context
                    const prevUserMsg = msg.role === 'ai' ? state.chatHistory.slice(0, i).reverse().find(m => m.role === 'user') : null;
                    return (
                    <div
                        key={i}
                        className={`qe-msg qe-msg--${msg.role === 'user' ? 'user' : msg.role === 'system' ? 'system' : 'ai'}`}
                    >
                        <div className={`qe-bubble qe-bubble--${msg.role === 'user' ? 'user' : msg.role === 'system' ? 'system' : 'ai'}`}>
                            {msg.role === 'ai' ? (
                                <>
                                <div className="qe-bubble__ai-row">
                                    <span className="qe-bubble__ai-icon" aria-hidden>✦</span>
                                    <span style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</span>
                                </div>
                                {/* Evaluation buttons */}
                                <div className="qe-eval-row" style={{ display: 'flex', gap: 4, marginTop: 6, paddingLeft: 36, opacity: msg.rated ? 0.5 : 0.7 }}>
                                    <button type="button" className="qe-eval-btn" title="Good response" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: msg.rated === 'up' ? '#27ae60' : 'inherit', padding: '2px 4px' }}
                                        onClick={async () => {
                                            try {
                                                await fetch(`${API_BASE}/api/ai/evaluate`, {
                                                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ user_query: prevUserMsg?.text || '', ai_response: msg.text, rating: 5, session_id: state.chatSessionId, symbol: state.selectedTicker }),
                                                });
                                                const updated = [...state.chatHistory]; updated[i] = { ...msg, rated: 'up' }; setState.setChatHistory(updated);
                                            } catch {}
                                        }}>&#x1F44D;</button>
                                    <button type="button" className="qe-eval-btn" title="Bad response" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: msg.rated === 'down' ? '#e74c3c' : 'inherit', padding: '2px 4px' }}
                                        onClick={async () => {
                                            const correction = window.prompt('What should the correct response be? (optional)');
                                            try {
                                                await fetch(`${API_BASE}/api/ai/evaluate`, {
                                                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ user_query: prevUserMsg?.text || '', ai_response: msg.text, rating: 1, correction: correction || undefined, session_id: state.chatSessionId, symbol: state.selectedTicker }),
                                                });
                                                const updated = [...state.chatHistory]; updated[i] = { ...msg, rated: 'down' }; setState.setChatHistory(updated);
                                            } catch {}
                                        }}>&#x1F44E;</button>
                                </div>
                                </>
                            ) : (
                                msg.text
                            )}
                        </div>
                    </div>
                    );
                })}
                {/* Streaming response */}
                {state.isStreaming && state.streamingText && (
                    <div className="qe-msg qe-msg--ai">
                        <div className="qe-bubble qe-bubble--ai">
                            <div className="qe-bubble__ai-row">
                                <span className="qe-bubble__ai-icon" aria-hidden>✦</span>
                                <span style={{ whiteSpace: 'pre-wrap' }}>{state.streamingText}<span className="qe-cursor-blink">▊</span></span>
                            </div>
                        </div>
                    </div>
                )}
                {/* Active tools indicator */}
                {state.activeTools?.length > 0 && (
                    <div className="qe-msg qe-msg--system">
                        <div className="qe-bubble qe-bubble--system" style={{ fontStyle: 'italic', opacity: 0.85 }}>
                            Calling: {state.activeTools.join(', ')}...
                        </div>
                    </div>
                )}
                {(state.isAnalyzing || state.consumerRagLoading || state.contextAgentLoading) && (
                    <div className="qe-msg qe-msg--ai">
                        <div className="qe-bubble qe-bubble--ai" style={{ fontStyle: 'italic', opacity: 0.85 }}>
                            {state.contextAgentLoading
                                ? 'Context AI (tools + local LLM)…'
                                : state.consumerRagLoading
                                  ? 'Consumer Risk RAG + local LLM…'
                                  : 'Synthesizing with local LLM…'}
                        </div>
                    </div>
                )}
                {state.isStreaming && !state.streamingText && state.activeTools?.length === 0 && (
                    <div className="qe-msg qe-msg--ai">
                        <div className="qe-bubble qe-bubble--ai" style={{ fontStyle: 'italic', opacity: 0.85 }}>
                            Thinking...
                        </div>
                    </div>
                )}
                <div ref={state.chatEndRef} />
            </div>

            <div className="qe-composer">
                {!state.userPrompt.trim() && (
                    <div className="qe-quick-row">
                        {state.viewMode === 'terminal' && state.selectedTicker ? (
                            <>
                                <button type="button" className="qe-chip" onClick={() => handlers.handlePromptSubmit(`What are the key technical levels for ${state.selectedTicker}?`)}>
                                    Technicals
                                </button>
                                <button type="button" className="qe-chip" onClick={() => handlers.handlePromptSubmit(`Give me a full analysis of ${state.selectedTicker} using news, price data, and indicators.`)}>
                                    Full Analysis
                                </button>
                                <button type="button" className="qe-chip" onClick={() => handlers.handlePromptSubmit(`What is the news sentiment for ${state.selectedTicker}? Classify headlines as bullish/bearish/neutral.`)}>
                                    Sentiment
                                </button>
                                <button type="button" className="qe-chip" onClick={() => handlers.handlePromptSubmit(`Generate a 5-day price forecast for ${state.selectedTicker}.`)}>
                                    Forecast
                                </button>
                                <button
                                    type="button"
                                    className="qe-chip"
                                    disabled={state.contextAgentLoading || state.consumerRagLoading}
                                    onClick={() => handlers.runContextAgent()}
                                >
                                    Context AI
                                </button>
                            </>
                        ) : (
                            <>
                                <button type="button" className="qe-chip" onClick={() => handlers.handlePromptSubmit('How is my portfolio doing? Show me top gainers and losers.')}>
                                    Portfolio Review
                                </button>
                                <button type="button" className="qe-chip" onClick={() => handlers.handlePromptSubmit('Give me a macro market overview.')}>
                                    Macro Snapshot
                                </button>
                                <button type="button" className="qe-chip" onClick={() => handlers.handlePromptSubmit('/SCREEN')}>
                                    AI Screener
                                </button>
                                <button type="button" className="qe-chip" onClick={() => { handlers.loadChatSessions(); setState.setChatSessionsOpen(prev => !prev); }}>
                                    Sessions
                                </button>
                            </>
                        )}
                    </div>
                )}

                <div className="qe-input-wrap">
                    <textarea
                        className="qe-textarea"
                        rows={2}
                        placeholder={state.selectedTicker ? `Ask about ${state.selectedTicker}, or any question…` : "Ask anything — portfolio, market, $AAPL, /SCREEN…"}
                        value={state.userPrompt}
                        onChange={(e) => setState.setUserPrompt(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handlers.handlePromptSubmit();
                            }
                        }}
                    />
                    <button
                        type="button"
                        className="qe-send"
                        onClick={() => handlers.handlePromptSubmit()}
                        disabled={state.isAnalyzing || state.isStreaming || !state.userPrompt.trim()}
                        aria-label="Send"
                    >
                        {state.isStreaming ? '…' : '↑'}
                    </button>
                </div>
            </div>
        </aside>
    );
};

const TopNavigation = ({ state, setState, handlers }) => {
    const title =
        state.viewMode === 'home'
            ? 'Market Overview'
            : state.viewMode === 'index'
            ? 'Market Universe'
            : state.viewMode === 'screener'
              ? 'Pitchfork Screener'
              : state.selectedTicker || 'Terminal';

    return (
        <header className="qe-topbar">
            <div className="qe-topbar__left">
                <span className="qe-crumb">{state.viewMode}</span>
                <div className="qe-topbar__title">
                    {title}
                    {state.viewMode === 'terminal' && state.selectedTicker && state.tickerDetails?.price != null && (
                        <span className="qe-price">
                            {state.tickerDetails.currencySymbol}
                            {Number(state.tickerDetails.price).toLocaleString()}
                        </span>
                    )}
                </div>
            </div>

            <div className="qe-toolbar">
                <label className="qe-field-label qe-field-label--inline" htmlFor="qe-theme-top">Theme</label>
                <select
                    id="qe-theme-top"
                    className="qe-select-inline"
                    value={state.theme}
                    onChange={(e) => handlers.setTheme(e.target.value)}
                    aria-label="Color theme"
                >
                    {THEME_OPTIONS.map((o) => (
                        <option key={o.id} value={o.id}>
                            {o.label}
                        </option>
                    ))}
                </select>
                {state.viewMode === 'terminal' && state.selectedTicker && (
                    <>
                        <div className="qe-seg" role="group" aria-label="Timeframe">
                            {['1D', '7D', '2W', '1M', '3M', '6M', '1Y', '2Y', '5Y', 'MAX'].map((tf) => (
                                <button
                                    key={tf}
                                    type="button"
                                    className={state.currentTimeframe === tf ? 'qe-seg--on' : ''}
                                    onClick={() => handlers.openTerminal(state.selectedTicker, tf)}
                                >
                                    {tf}
                                </button>
                            ))}
                        </div>
                        <div className="qe-seg" role="group" aria-label="Chart type">
                            <button
                                type="button"
                                className={state.chartDisplayType === 'candle' ? 'qe-seg--on' : ''}
                                onClick={() => setState.setChartDisplayType('candle')}
                            >
                                OHLC
                            </button>
                            <button
                                type="button"
                                className={state.chartDisplayType === 'line' ? 'qe-seg--on' : ''}
                                onClick={() => setState.setChartDisplayType('line')}
                            >
                                Line
                            </button>
                            <button
                                type="button"
                                className={state.chartDisplayType === 'both' ? 'qe-seg--on' : ''}
                                onClick={() => setState.setChartDisplayType('both')}
                            >
                                Both
                            </button>
                        </div>
                        <div className="qe-seg" role="group" aria-label="Indicators">
                            <button
                                type="button"
                                className={state.showVolume ? 'qe-seg--on' : ''}
                                onClick={() => setState.setShowVolume(!state.showVolume)}
                            >
                                Vol
                            </button>
                            <button
                                type="button"
                                className={state.showEMA20 ? 'qe-seg--on' : ''}
                                onClick={() => setState.setShowEMA20(!state.showEMA20)}
                            >
                                E20
                            </button>
                            <button
                                type="button"
                                className={state.showSMA50 ? 'qe-seg--on' : ''}
                                onClick={() => setState.setShowSMA50(!state.showSMA50)}
                            >
                                S50
                            </button>
                            <button
                                type="button"
                                className={state.showSMA200 ? 'qe-seg--on' : ''}
                                onClick={() => setState.setShowSMA200(!state.showSMA200)}
                            >
                                S200
                            </button>
                        </div>
                        {state.showPitchfork && (
                            <select
                                className="qe-select-inline qe-pf-type"
                                value={state.pitchforkType}
                                onChange={(e) => setState.setPitchforkType(e.target.value)}
                                aria-label="Pitchfork type"
                            >
                                <option value="Standard">Andrews</option>
                                <option value="Schiff">Schiff</option>
                                <option value="Modified">Modified</option>
                            </select>
                        )}
                        <button
                            type="button"
                            className={`qe-btn qe-pf-toggle ${state.showPitchfork ? 'qe-btn--on' : ''}`}
                            onClick={() => {
                                setState.setShowPitchfork(!state.showPitchfork);
                                if (state.showPitchfork) handlers.resetZoom();
                                else if (state.hasScannedPitchforks && state.detectedPivots.length) handlers.handlePivotClick(0);
                            }}
                        >
                            Pitchfork
                        </button>
                    </>
                )}
                {state.viewMode === 'screener' && (
                    <select
                        className="qe-select-inline"
                        value={state.screenerCategory}
                        onChange={(e) => setState.setScreenerCategory(e.target.value)}
                        aria-label="Screener category"
                    >
                        {Object.keys(state.tickersData).map((cat) => (
                            <option key={cat} value={cat}>
                                {state.categoryLabelMap?.[cat] || cat.replace(/_/g, ' ')}
                            </option>
                        ))}
                    </select>
                )}
            </div>
        </header>
    );
};

// ---------------------------------------------------------------------------
// TICKER DETAIL PAGE (shown when a ticker is clicked in Universe)
// ---------------------------------------------------------------------------
const TickerDetailPage = ({ symbol, tickerData, wikiData, onBack, onChart, onWatch, nameMap }) => {
    if (!symbol) return null;
    const name = tickerData?.name || tickerData?.longName || nameMap?.[symbol] || symbol;
    const wiki = wikiData || {};
    const isWikiLoading = !wikiData || wikiData.status === 'fetching';
    const price = tickerData?.price;
    const change = tickerData?.change;
    const changePct = tickerData?.changePct;
    const isUp = (changePct || 0) >= 0;

    const infoItems = [
        { label: 'Sector', value: tickerData?.sector || wiki.sector },
        { label: 'Industry', value: tickerData?.industry || wiki.industry },
        { label: 'Headquarters', value: wiki.headquarters },
        { label: 'CEO / Key People', value: wiki.ceo },
        { label: 'Founded', value: wiki.founded },
        { label: 'Founder', value: wiki.founder },
        { label: 'Employees', value: wiki.employees },
        { label: 'Revenue', value: wiki.revenue },
        { label: 'Market Cap', value: tickerData?.marketCap ? `${(tickerData.marketCap / 1e9).toFixed(2)}B` : wiki.market_cap },
        { label: 'P/E Ratio', value: tickerData?.peRatio },
        { label: '52-Week High', value: tickerData?.high52 },
        { label: '52-Week Low', value: tickerData?.low52 },
        { label: 'Products / Services', value: wiki.products },
        { label: 'Parent Company', value: wiki.parent },
        { label: 'Subsidiaries', value: wiki.subsidiaries },
        { label: 'ISIN', value: wiki.isin },
        { label: 'Exchange', value: tickerData?.marketExchange },
        { label: 'Region', value: tickerData?.marketRegion },
    ].filter(item => item.value && item.value !== 'N/A' && item.value !== '');

    return (
        <div className="td-detail-page">
            <div className="td-detail-topbar">
                <button type="button" className="td-back-btn" onClick={onBack}>&larr; Back to Universe</button>
                <div className="td-topbar-actions">
                    <button type="button" className="qe-btn qe-btn--small" onClick={() => onChart(symbol)}>Open Chart</button>
                    <button type="button" className="qe-btn qe-btn--small" onClick={() => onWatch(symbol)}>Add to Watchlist</button>
                    {wiki.wikiUrl && <a href={wiki.wikiUrl} target="_blank" rel="noopener noreferrer" className="qe-btn qe-btn--small">Wikipedia</a>}
                    {tickerData?.website && <a href={tickerData.website} target="_blank" rel="noopener noreferrer" className="qe-btn qe-btn--small">Website</a>}
                </div>
            </div>

            <div className="td-detail-header">
                <div className="td-detail-header__info">
                    {wiki.thumbnail && <img src={wiki.thumbnail} alt={name} className="td-detail-logo" />}
                    <div>
                        <h1 className="td-detail-title">{name}</h1>
                        <p className="td-detail-symbol">{symbol}</p>
                        {wiki.description && <p className="td-detail-tagline">{wiki.description}</p>}
                    </div>
                </div>
                <div className="td-detail-header__price">
                    {price != null ? (
                        <>
                            <span className="td-price-main">{tickerData?.currencySymbol || '$'}{Number(price).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                            <span className={`td-price-change ${isUp ? 'qe-text-up' : 'qe-text-down'}`}>
                                {isUp ? '+' : ''}{Number(change || 0).toFixed(2)} ({isUp ? '+' : ''}{Number(changePct || 0).toFixed(2)}%)
                            </span>
                        </>
                    ) : (
                        <span className="td-price-main td-price-main--loading">Loading price...</span>
                    )}
                </div>
            </div>

            <div className="td-detail-body">
                <div className="td-detail-section td-detail-section--about">
                    <h2 className="td-section-title">About</h2>
                    {isWikiLoading ? (
                        <p className="td-loading-text">Fetching Wikipedia profile...</p>
                    ) : wiki.extract ? (
                        <p className="td-about-text">{wiki.extract}</p>
                    ) : tickerData?.description ? (
                        <p className="td-about-text">{tickerData.description}</p>
                    ) : (
                        <p className="td-about-text td-about-text--empty">No profile available for this instrument.</p>
                    )}
                </div>

                <div className="td-detail-section td-detail-section--info">
                    <h2 className="td-section-title">Company Details</h2>
                    {infoItems.length > 0 ? (
                        <div className="td-info-grid">
                            {infoItems.map(({ label, value }) => (
                                <div key={label} className="td-info-item">
                                    <span className="td-info-label">{label}</span>
                                    <span className="td-info-value">{value}</span>
                                </div>
                            ))}
                        </div>
                    ) : isWikiLoading ? (
                        <p className="td-loading-text">Loading details...</p>
                    ) : (
                        <p className="td-about-text td-about-text--empty">No detailed information available.</p>
                    )}
                </div>

                {tickerData?.news && tickerData.news.length > 0 && (
                    <div className="td-detail-section td-detail-section--news">
                        <h2 className="td-section-title">Recent News</h2>
                        <div className="td-news-list">
                            {tickerData.news.map((n, i) => (
                                <a key={i} href={n.link} target="_blank" rel="noopener noreferrer" className="td-news-item">
                                    <span className="td-news-title">{n.title}</span>
                                    <span className="td-news-publisher">{n.publisher}</span>
                                </a>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};


const WatchlistsDashboard = ({ state, handlers }) => {
    const listNames = Object.keys(state.customWatchlists || {});
    const activeList = state.selectedCustomWatchlist || listNames[0] || 'Default';
    const activeSymbols = state.customWatchlists?.[activeList] || [];
    const presetRows = state.tickerPresets || [];
    const industryListRows = Object.keys(state.autoIndustryWatchlists || {})
        .map((industry) => ({ industry, symbols: state.autoIndustryWatchlists[industry] || [] }))
        .sort((a, b) => b.symbols.length - a.symbols.length);
    const activeLabs = (state.watchlistLabs || []).filter((x) => (x.listName || 'Default') === activeList);
    const activeCron = (state.watchlistCronJobs || []).filter((x) => (x.listName || 'Default') === activeList);
    const portfolioNames = Object.keys(state.portfolios || {});
    const portfolioSymbols = [...new Set((state.selectedPortfolioPositions || []).map((p) => String(p.symbol || '').toUpperCase()).filter(Boolean))];

    return (
        <div className="qe-content mw-content wl-page">
            <header className="qe-hero wl-hero">
                <p className="qe-hero__label">Watchlists</p>
                <h1 className="qe-hero__title">Watchlist Command Center</h1>
                <p className="qe-hero__sub">Build custom lists, import from saved watchlists and portfolios, and keep your list-specific notes and automation in one place.</p>
            </header>
            <section className="wl-grid">
                <div className="qe-home-panel wl-card wl-card--list">
                    <div className="qe-section-head"><h2>List Builder</h2></div>
                    <div className="qe-home-actions">
                        <input
                            className="qe-input"
                            placeholder="New list name"
                            value={state.newWatchlistName}
                            onChange={(e) => handlers.setNewWatchlistName(e.target.value)}
                        />
                        <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.createCustomWatchlist()}>
                            Create
                        </button>
                        <button
                            type="button"
                            className="qe-btn qe-btn--small qe-btn--danger"
                            disabled={activeList === 'Default'}
                            onClick={() => handlers.deleteCustomWatchlist(activeList)}
                        >
                            Delete list
                        </button>
                    </div>
                    <div className="qe-home-actions">
                        <select
                            className="qe-select-inline"
                            value={activeList}
                            onChange={(e) => handlers.setSelectedCustomWatchlist(e.target.value)}
                        >
                            {listNames.map((n) => (
                                <option key={n} value={n}>{n}</option>
                            ))}
                        </select>
                        <div className="qe-autocomplete">
                            <input
                                className="qe-input"
                                placeholder="Search ticker, company, forex, crypto..."
                                value={state.watchlistSymbolInput}
                                onChange={(e) => handlers.setWatchlistSymbolInput(e.target.value.toUpperCase())}
                                onFocus={() => handlers.setWatchlistSymbolInput(state.watchlistSymbolInput || '')}
                            />
                            {state.watchlistSearchOpen && (state.watchlistSearchLoading || state.watchlistSearchResults.length > 0) && (
                                <div className="qe-autocomplete__menu">
                                    {state.watchlistSearchLoading ? (
                                        <div className="qe-autocomplete__item">Searching instruments...</div>
                                    ) : (
                                        state.watchlistSearchResults.map((r) => (
                                            <button
                                                key={`${r.symbol}_${r.exchange}_${r.source}`}
                                                type="button"
                                                className="qe-autocomplete__item"
                                                onClick={() => handlers.addSearchResultToWatchlist(r)}
                                            >
                                                <strong>{r.symbol}</strong>
                                                <span>{r.name}</span>
                                                <em>
                                                    {r.assetType}
                                                    {r.assetFamily ? ` · ${r.assetFamily}` : ''}
                                                    {r.exchange ? ` · ${r.exchange}` : ''}
                                                    {r.isProxy ? ' · proxy' : ''}
                                                </em>
                                            </button>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                        <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.addSymbolToCustomWatchlist()}>
                            Add
                        </button>
                    </div>
                    <div className="qe-home-summary wl-summary-row">
                        <div>Active list: {activeList}</div>
                        <div>Symbols: {activeSymbols.length}</div>
                        <div>Saved watchlist: {(state.watchlistSymbols || []).length}</div>
                    </div>
                    <div className="qe-home-list">
                        {activeSymbols.map((sym) => (
                            <div key={sym} className="qe-list-item qe-list-item--col">
                                <div className="qe-home-row">
                                    <button type="button" className="qe-home-row__symbol" onClick={() => handlers.handlePromptSubmit(`$${sym}`)}>{sym}</button>
                                    <span className="qe-rail__muted">
                                        {state.watchlistSymbolMeta?.[sym]?.industry || state.watchlistSymbolMeta?.[sym]?.assetFamily || 'Unknown industry'}
                                    </span>
                                </div>
                                <div className="qe-home-actions">
                                    <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.engageWatchlistLlm(sym, 'analyze')}>Analyze</button>
                                    <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.engageWatchlistLlm(sym, 'review')}>Review</button>
                                    <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.setWatchlistLabFormValue('symbol', sym)}>Add note</button>
                                    <button type="button" className="qe-watch-card__rm" onClick={() => handlers.removeSymbolFromCustomWatchlist(activeList, sym)}>×</button>
                                </div>
                            </div>
                        ))}
                        {!activeSymbols.length && <div className="qe-empty">No symbols in this custom watchlist.</div>}
                    </div>
                </div>

                <div className="qe-home-panel wl-card wl-card--presets">
                    <div className="qe-section-head"><h2>Market Presets</h2></div>
                    <div className="qe-home-list">
                        {presetRows.map((preset) => (
                            <div key={preset.id} className="qe-list-item qe-list-item--col">
                                <div className="qe-home-row">
                                    <strong>{preset.label}</strong>
                                    <span>{preset.count} symbols</span>
                                </div>
                                <span className="qe-rail__muted">{preset.description}</span>
                                <div className="qe-home-actions">
                                    {(preset.symbols || []).slice(0, 6).map((sym) => (
                                        <button key={sym} type="button" className="qe-chip-btn" onClick={() => handlers.handlePromptSubmit(`$${sym}`)}>
                                            {sym}
                                        </button>
                                    ))}
                                </div>
                                <div className="qe-home-actions">
                                    <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.addPresetToCustomWatchlist(preset)}>
                                        Add to {activeList}
                                    </button>
                                </div>
                            </div>
                        ))}
                        {!presetRows.length && <div className="qe-empty">Preset baskets will appear once the backend metadata loads.</div>}
                    </div>
                </div>

                <div className="qe-home-panel wl-card wl-card--sources">
                    <div className="qe-section-head"><h2>Input Sources</h2></div>
                    <div className="qe-home-list">
                        <div className="qe-list-item qe-list-item--col">
                            <strong>Saved server watchlist</strong>
                            <span className="qe-rail__muted">{(state.watchlistSymbols || []).length} symbols ready to import into {activeList}</span>
                            <div className="qe-home-actions">
                                <button
                                    type="button"
                                    className="qe-btn qe-btn--small"
                                    onClick={() => handlers.importSymbolsToCustomWatchlist(state.watchlistSymbols, activeList)}
                                >
                                    Import watchlist
                                </button>
                            </div>
                        </div>
                        <div className="qe-list-item qe-list-item--col">
                            <strong>Active portfolio</strong>
                            <div className="qe-home-actions">
                                <select
                                    className="qe-select-inline"
                                    value={state.selectedPortfolio}
                                    onChange={(e) => handlers.setSelectedPortfolio(e.target.value)}
                                >
                                    {portfolioNames.map((p) => (
                                        <option key={p} value={p}>{p}</option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    className="qe-btn qe-btn--small"
                                    onClick={() => handlers.importSymbolsToCustomWatchlist(portfolioSymbols, activeList)}
                                >
                                    Import holdings
                                </button>
                            </div>
                            <div className="qe-home-actions">
                                {portfolioSymbols.slice(0, 8).map((sym) => (
                                    <button key={sym} type="button" className="qe-chip-btn" onClick={() => handlers.handlePromptSubmit(`$${sym}`)}>
                                        {sym}
                                    </button>
                                ))}
                            </div>
                            {!portfolioSymbols.length && <span className="qe-rail__muted">No holdings in this portfolio yet.</span>}
                        </div>
                        <div className="qe-list-item qe-list-item--col">
                            <strong>Research workflow</strong>
                            <span className="qe-rail__muted">Macro Lab now lives under the `Research` tab, where you can switch inputs between custom lists, saved watchlists, and portfolio holdings.</span>
                        </div>
                    </div>
                </div>

                <div className="qe-home-panel wl-card wl-card--industry">
                    <div className="qe-section-head"><h2>Auto Industry Baskets</h2></div>
                    <div className="qe-home-list">
                        {industryListRows.slice(0, 8).map((row) => (
                            <div key={row.industry} className="qe-list-item qe-list-item--col">
                                <strong>{row.industry}</strong>
                                <span>{row.symbols.length} symbols</span>
                                <div className="qe-home-actions">
                                    {row.symbols.slice(0, 5).map((s) => (
                                        <button key={s} type="button" className="qe-chip-btn" onClick={() => handlers.engageWatchlistLlm(s, 'review')}>
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                        {!industryListRows.length && <div className="qe-empty">Industry watchlists will auto-generate once symbols are added.</div>}
                    </div>
                </div>

                <div className="qe-home-panel wl-card wl-card--lab">
                    <div className="qe-section-head"><h2>Research Notes</h2></div>
                    <div className="qe-form-grid">
                        <input
                            className="qe-input"
                            placeholder="Symbol"
                            value={state.watchlistLabForm.symbol}
                            onChange={(e) => handlers.setWatchlistLabFormValue('symbol', e.target.value.toUpperCase())}
                        />
                        <select
                            className="qe-select-inline"
                            value={state.watchlistLabForm.type}
                            onChange={(e) => handlers.setWatchlistLabFormValue('type', e.target.value)}
                        >
                            <option value="economics">Economics</option>
                            <option value="risk">Risk</option>
                            <option value="valuation">Valuation</option>
                            <option value="event">Event</option>
                            <option value="thesis">Thesis</option>
                        </select>
                        <input
                            className="qe-input"
                            placeholder="Title"
                            value={state.watchlistLabForm.title}
                            onChange={(e) => handlers.setWatchlistLabFormValue('title', e.target.value)}
                        />
                        <input
                            className="qe-input"
                            placeholder="Notes / hypothesis"
                            value={state.watchlistLabForm.notes}
                            onChange={(e) => handlers.setWatchlistLabFormValue('notes', e.target.value)}
                        />
                    </div>
                    <div className="qe-home-actions">
                        <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.addWatchlistLabEntry()}>
                            Add note
                        </button>
                    </div>
                    <div className="qe-home-list">
                        {activeLabs.slice(0, 16).map((x) => (
                            <div key={x.id} className="qe-list-item qe-list-item--col">
                                <div className="qe-home-row">
                                    <strong>{x.symbol}</strong>
                                    <span>{x.type}</span>
                                    <button type="button" className="qe-watch-card__rm" onClick={() => handlers.removeWatchlistLabEntry(x.id)}>×</button>
                                </div>
                                <span>{x.title}</span>
                                <span className="qe-rail__muted">{x.notes || '-'}</span>
                            </div>
                        ))}
                        {!activeLabs.length && <div className="qe-empty">No notes yet for this watchlist.</div>}
                    </div>
                </div>

                <div className="qe-home-panel wl-card wl-card--automation">
                    <div className="qe-section-head"><h2>Automation & Alerts</h2></div>
                    <div className="qe-form-grid">
                        <select
                            className="qe-select-inline"
                            value={state.watchlistCronForm.category}
                            onChange={(e) => handlers.setWatchlistCronFormValue('category', e.target.value)}
                        >
                            {Object.keys(state.tickersData || {}).map((cat) => (
                                <option key={cat} value={cat}>{state.categoryLabelMap?.[cat] || cat.replace(/_/g, ' ')}</option>
                            ))}
                        </select>
                        <input
                            className="qe-input"
                            type="number"
                            min="30"
                            value={state.watchlistCronForm.lookback}
                            onChange={(e) => handlers.setWatchlistCronFormValue('lookback', e.target.value)}
                        />
                        <input
                            className="qe-input"
                            placeholder="0 9 * * 1-5"
                            value={state.watchlistCronForm.cron_schedule}
                            onChange={(e) => handlers.setWatchlistCronFormValue('cron_schedule', e.target.value)}
                        />
                        <input
                            className="qe-input"
                            placeholder="Note"
                            value={state.watchlistCronForm.note}
                            onChange={(e) => handlers.setWatchlistCronFormValue('note', e.target.value)}
                        />
                    </div>
                    <div className="qe-home-actions">
                        <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.createWatchlistCronJob()}>
                            Create cron job
                        </button>
                    </div>
                    <div className="qe-home-list">
                        {activeCron.slice(0, 12).map((c) => (
                            <div key={c.id} className="qe-list-item qe-list-item--col">
                                <div className="qe-home-row">
                                    <strong>{c.category}</strong>
                                    <span>{c.cron_schedule}</span>
                                    <button type="button" className="qe-watch-card__rm" onClick={() => handlers.removeWatchlistCronJob(c.id)}>×</button>
                                </div>
                                <span>Lookback {c.lookback}d · {c.status}</span>
                                <span className="qe-rail__muted">{c.note || '-'}</span>
                            </div>
                        ))}
                        {!activeCron.length && <div className="qe-empty">No cron jobs configured for this watchlist.</div>}
                    </div>
                </div>
            </section>
        </div>
    );
};

const ResearchMacroLab = ({ state, handlers, openAnalysisSymbol }) => {
    const [expandedMacroNotes, setExpandedMacroNotes] = useState({});
    const [expandedNotesSection, setExpandedNotesSection] = useState(false);
    const regime = state.macroLabSnapshot?.regime || {};
    const macroRows = useMemo(() => {
        const rows = [...(state.macroLabImpactRows || [])];
        const key = state.macroLabSort?.key || 'totalScore';
        const dir = state.macroLabSort?.dir || 'desc';
        const getVal = (r) => {
            if (key === 'risk') return Number(r.factors?.risk || 0);
            if (key === 'rates') return Number(r.factors?.rates || 0);
            if (key === 'inflation') return Number(r.factors?.inflation || 0);
            if (key === 'fx') return Number(r.factors?.fx || 0);
            return r[key];
        };
        rows.sort((a, b) => {
            const av = getVal(a);
            const bv = getVal(b);
            if (typeof av === 'string' || typeof bv === 'string') {
                return dir === 'asc'
                    ? String(av || '').localeCompare(String(bv || ''))
                    : String(bv || '').localeCompare(String(av || ''));
            }
            return dir === 'asc' ? Number(av || 0) - Number(bv || 0) : Number(bv || 0) - Number(av || 0);
        });
        return rows.slice(0, 30);
    }, [state.macroLabImpactRows, state.macroLabSort]);
    const topBeneficiaries = [...(state.macroLabImpactRows || [])]
        .sort((a, b) => Number(b.totalScore || 0) - Number(a.totalScore || 0))
        .slice(0, 3);
    const topHeadwinds = [...(state.macroLabImpactRows || [])]
        .sort((a, b) => Number(a.totalScore || 0) - Number(b.totalScore || 0))
        .slice(0, 3);
    const toggleMacroNote = (symbol) => {
        const sym = String(symbol || '').toUpperCase();
        setExpandedMacroNotes((prev) => ({ ...prev, [sym]: !prev[sym] }));
    };

    return (
        <div className="rs-macro-lab">
            <div className="rs-section-header">
                <h2 className="rs-section-title">Macro Impact Analysis</h2>
                <p className="rs-section-sub">Configure parameters and review macro regime impact across your universe</p>
            </div>

            <div className="rs-config-bar">
                <div className="rs-config-group">
                    <span className="rs-config-label">Source</span>
                    <div className="rs-segmented-buttons">
                        <button type="button" className={`rs-seg-btn ${state.macroLabInputMode === 'custom_watchlist' ? 'rs-seg-btn--active' : ''}`} onClick={() => handlers.setMacroLabInputMode('custom_watchlist')}>Custom</button>
                        <button type="button" className={`rs-seg-btn ${state.macroLabInputMode === 'saved_watchlist' ? 'rs-seg-btn--active' : ''}`} onClick={() => handlers.setMacroLabInputMode('saved_watchlist')}>Watchlist</button>
                        <button type="button" className={`rs-seg-btn ${state.macroLabInputMode === 'portfolio' ? 'rs-seg-btn--active' : ''}`} onClick={() => handlers.setMacroLabInputMode('portfolio')}>Portfolio</button>
                    </div>
                </div>
                <div className="rs-config-group">
                    <span className="rs-config-label">Lookback (days)</span>
                    <input className="rs-config-input" type="number" min="90" max="3650" value={state.macroLabConfig?.lookbackDays || 365} onChange={(e) => handlers.setMacroLabLookbackDays(e.target.value)} />
                </div>
                <div className="rs-config-group">
                    <span className="rs-config-label">Scenario</span>
                    <select className="rs-config-input" value={state.macroLabConfig?.scenario || 'Base'} onChange={(e) => handlers.setMacroLabScenario(e.target.value)}>
                        <option value="Base">Base</option>
                        <option value="Bull">Bull</option>
                        <option value="Bear">Bear</option>
                        <option value="Shock">Shock</option>
                    </select>
                </div>
                <div className="rs-config-group">
                    <span className="rs-config-label">Weights</span>
                    <div className="rs-weights-inline">
                        <input className="rs-weight-input" type="number" min="0" max="5" step="0.1" value={state.macroLabConfig?.weights?.risk ?? 1} onChange={(e) => handlers.setMacroLabWeight('risk', e.target.value)} title="Risk weight" />
                        <input className="rs-weight-input" type="number" min="0" max="5" step="0.1" value={state.macroLabConfig?.weights?.rates ?? 1} onChange={(e) => handlers.setMacroLabWeight('rates', e.target.value)} title="Rates weight" />
                        <input className="rs-weight-input" type="number" min="0" max="5" step="0.1" value={state.macroLabConfig?.weights?.inflation ?? 1} onChange={(e) => handlers.setMacroLabWeight('inflation', e.target.value)} title="Inflation weight" />
                        <input className="rs-weight-input" type="number" min="0" max="5" step="0.1" value={state.macroLabConfig?.weights?.fx ?? 1} onChange={(e) => handlers.setMacroLabWeight('fx', e.target.value)} title="FX weight" />
                    </div>
                </div>
                <button type="button" className="rs-refresh-btn" onClick={() => handlers.refreshMacroLab()}>
                    {state.macroLabLoading ? 'Computing...' : 'Refresh'}
                </button>
            </div>

            <div className="rs-regime-kpi-strip">
                <div className="rs-kpi-card">
                    <div className="rs-kpi-label">Risk-on Score</div>
                    <div className="rs-kpi-value">{Number(regime.riskOn || 0).toFixed(2)}</div>
                </div>
                <div className="rs-kpi-card">
                    <div className="rs-kpi-label">Rates Pressure</div>
                    <div className="rs-kpi-value">{Number(regime.ratesPressure || 0).toFixed(2)}</div>
                </div>
                <div className="rs-kpi-card">
                    <div className="rs-kpi-label">Inflation Pressure</div>
                    <div className="rs-kpi-value">{Number(regime.inflationPressure || 0).toFixed(2)}</div>
                </div>
                <div className="rs-kpi-card">
                    <div className="rs-kpi-label">USD Pressure</div>
                    <div className="rs-kpi-value">{Number(regime.usdPressure || 0).toFixed(2)}</div>
                </div>
            </div>

            <div className="rs-impact-leaders">
                <div className="rs-leaders-panel rs-leaders-panel--benefits">
                    <h3 className="rs-leaders-title">Top Beneficiaries</h3>
                    <div className="rs-leaders-list">
                        {topBeneficiaries.map((r) => (
                            <div key={r.symbol} className="rs-leader-item rs-leader-item--up">
                                <div className="rs-leader-symbol">{r.symbol}</div>
                                <div className="rs-leader-score rs-leader-score--up">{Number(r.totalScore || 0).toFixed(2)}</div>
                            </div>
                        ))}
                        {!topBeneficiaries.length && <div className="qe-empty">No beneficiaries yet.</div>}
                    </div>
                </div>
                <div className="rs-leaders-panel rs-leaders-panel--headwinds">
                    <h3 className="rs-leaders-title">Top Headwinds</h3>
                    <div className="rs-leaders-list">
                        {topHeadwinds.map((r) => (
                            <div key={r.symbol} className="rs-leader-item rs-leader-item--down">
                                <div className="rs-leader-symbol">{r.symbol}</div>
                                <div className="rs-leader-score rs-leader-score--down">{Number(r.totalScore || 0).toFixed(2)}</div>
                            </div>
                        ))}
                        {!topHeadwinds.length && <div className="qe-empty">No headwinds yet.</div>}
                    </div>
                </div>
            </div>

            <div className="rs-table-wrapper">
                <div className="rs-table-head">
                    <h3>Full Impact Table</h3>
                    <span className="rs-table-count">{macroRows.length} assets</span>
                </div>
                <table className="rs-impact-table">
                    <thead>
                        <tr>
                            <th><button type="button" className="rs-th-btn" onClick={() => handlers.setMacroLabSort('symbol')}>Symbol</button></th>
                            <th>Stance</th>
                            <th><button type="button" className="rs-th-btn" onClick={() => handlers.setMacroLabSort('totalScore')}>Total</button></th>
                            <th><button type="button" className="rs-th-btn" onClick={() => handlers.setMacroLabSort('risk')}>Risk</button></th>
                            <th><button type="button" className="rs-th-btn" onClick={() => handlers.setMacroLabSort('rates')}>Rates</button></th>
                            <th><button type="button" className="rs-th-btn" onClick={() => handlers.setMacroLabSort('inflation')}>Inflation</button></th>
                            <th><button type="button" className="rs-th-btn" onClick={() => handlers.setMacroLabSort('fx')}>FX</button></th>
                            <th><button type="button" className="rs-th-btn" onClick={() => handlers.setMacroLabSort('confidence')}>Confidence</button></th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {macroRows.map((r) => (
                            <tr key={r.symbol} className="rs-table-row">
                                <td className="rs-td-symbol">{r.symbol}</td>
                                <td>
                                    <span className={`rs-stance-badge ${r.stance === 'Beneficiary' ? 'rs-stance-badge--up' : r.stance === 'Headwind' ? 'rs-stance-badge--down' : ''}`}>{r.stance}</span>
                                </td>
                                <td>{Number(r.totalScore || 0).toFixed(2)}</td>
                                <td>{Number(r.factors?.risk || 0).toFixed(2)}</td>
                                <td>{Number(r.factors?.rates || 0).toFixed(2)}</td>
                                <td>{Number(r.factors?.inflation || 0).toFixed(2)}</td>
                                <td>{Number(r.factors?.fx || 0).toFixed(2)}</td>
                                <td>{Math.round(100 * Number(r.confidence || 0))}%</td>
                                <td>
                                    <div className="rs-actions-cell">
                                        <button type="button" className="rs-action-btn" onClick={() => openAnalysisSymbol(r.symbol)}>Open</button>
                                        <button type="button" className="rs-action-btn" onClick={() => handlers.generateMacroBrief(r.symbol)}>
                                            {state.macroLabBriefLoading ? 'LLM...' : 'Brief'}
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {!macroRows.length && (
                    <div className="rs-empty-state">
                        {state.macroLabLoading ? 'Computing macro impact...' : 'No macro impact rows yet. Choose a watchlist or portfolio input and refresh macro snapshot.'}
                    </div>
                )}
            </div>

            <div className="rs-notes-section">
                <button type="button" className="rs-collapsible-header" onClick={() => setExpandedNotesSection(!expandedNotesSection)}>
                    <span className="rs-collapsible-icon">{expandedNotesSection ? '▼' : '▶'}</span>
                    <h3>Desk Notes</h3>
                    <span className="rs-notes-count">{macroRows.length} assets</span>
                </button>
                {expandedNotesSection && (
                    <div className="rs-notes-grid">
                        {macroRows.slice(0, 6).map((r) => (
                            <div key={`${r.symbol}_note`} className="rs-note-card">
                                <div className="rs-note-header">
                                    <strong className="rs-note-symbol">{r.symbol}</strong>
                                    <span className={`rs-stance-badge ${r.stance === 'Beneficiary' ? 'rs-stance-badge--up' : r.stance === 'Headwind' ? 'rs-stance-badge--down' : ''}`}>{r.stance}</span>
                                </div>
                                {expandedMacroNotes[r.symbol] ? (
                                    <textarea
                                        className="rs-note-textarea"
                                        placeholder="Macro note / desk comment..."
                                        value={state.macroLabNotes?.[r.symbol] || ''}
                                        onChange={(e) => handlers.setMacroLabNote(r.symbol, e.target.value)}
                                    />
                                ) : (
                                    <div className="rs-note-preview">
                                        {state.macroLabNotes?.[r.symbol]
                                            ? String(state.macroLabNotes[r.symbol]).slice(0, 120)
                                            : 'Add a note...'}
                                    </div>
                                )}
                                <button type="button" className="rs-note-toggle" onClick={() => toggleMacroNote(r.symbol)}>
                                    {expandedMacroNotes[r.symbol] ? 'Done' : 'Edit'}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

const ResearchMlLab = ({ state, handlers, openAnalysisSymbol }) => {
    const [expandedErrorLog, setExpandedErrorLog] = useState(false);
    const mlRows = useMemo(() => {
        const rows = [...(state.mlResearchRows || [])].filter((row) => !row.error);
        rows.sort((a, b) => {
            const aScore = Math.abs(Number(a.predicted_return_pct || 0)) * Number(a.confidence_pct || 0);
            const bScore = Math.abs(Number(b.predicted_return_pct || 0)) * Number(b.confidence_pct || 0);
            return bScore - aScore;
        });
        return rows;
    }, [state.mlResearchRows]);
    const mlErrors = (state.mlResearchRows || []).filter((row) => row.error);
    const leaders = mlRows.slice(0, 3);
    const bullishCount = mlRows.filter((row) => Number(row.predicted_return_pct || 0) > 0).length;
    const bearishCount = mlRows.filter((row) => Number(row.predicted_return_pct || 0) < 0).length;
    const avgConfidence = mlRows.length > 0
        ? (mlRows.reduce((sum, row) => sum + Number(row.confidence_pct || 0), 0) / mlRows.length).toFixed(1)
        : 0;

    return (
        <div className="rs-ml-lab">
            <div className="rs-section-header">
                <h2 className="rs-section-title">ML Signal Engine</h2>
                <p className="rs-section-sub">Local linear signal model trained on return, momentum, volatility, and moving-average features</p>
            </div>

            <div className="rs-config-bar">
                <div className="rs-config-group">
                    <span className="rs-config-label">Training lookback (days)</span>
                    <input
                        className="rs-config-input"
                        type="number"
                        min="120"
                        max="3650"
                        value={state.mlResearchConfig?.lookbackDays || 365}
                        onChange={(e) => handlers.setMlResearchConfigValue('lookbackDays', e.target.value)}
                    />
                </div>
                <div className="rs-config-group">
                    <span className="rs-config-label">Forecast horizon (days)</span>
                    <input
                        className="rs-config-input"
                        type="number"
                        min="1"
                        max="20"
                        value={state.mlResearchConfig?.forecastHorizon || 5}
                        onChange={(e) => handlers.setMlResearchConfigValue('forecastHorizon', e.target.value)}
                    />
                </div>
                <div className="rs-config-group">
                    <span className="rs-config-label">Train window (bars)</span>
                    <input
                        className="rs-config-input"
                        type="number"
                        min="60"
                        max="400"
                        value={state.mlResearchConfig?.trainWindow || 160}
                        onChange={(e) => handlers.setMlResearchConfigValue('trainWindow', e.target.value)}
                    />
                </div>
                <button type="button" className="rs-refresh-btn" onClick={() => handlers.runResearchMl()}>
                    {state.mlResearchLoading ? 'Running ML...' : 'Run Signals'}
                </button>
            </div>

            <div className="rs-signal-summary">
                <div className="rs-kpi-card">
                    <div className="rs-kpi-label">Bullish Signals</div>
                    <div className="rs-kpi-value rs-kpi-up">{bullishCount}</div>
                </div>
                <div className="rs-kpi-card">
                    <div className="rs-kpi-label">Bearish Signals</div>
                    <div className="rs-kpi-value rs-kpi-down">{bearishCount}</div>
                </div>
                <div className="rs-kpi-card">
                    <div className="rs-kpi-label">Avg Confidence</div>
                    <div className="rs-kpi-value">{avgConfidence}%</div>
                </div>
                <div className="rs-kpi-card">
                    <div className="rs-kpi-label">Forecast Horizon</div>
                    <div className="rs-kpi-value">{state.mlResearchConfig?.forecastHorizon || 5}d</div>
                </div>
            </div>

            <div className="rs-leader-cards">
                {leaders.map((row) => (
                    <div key={row.symbol} className={`rs-leader-card ${Number(row.predicted_return_pct || 0) >= 0 ? 'rs-leader-card--up' : 'rs-leader-card--down'}`}>
                        <div className="rs-leader-card-header">
                            <h3 className="rs-leader-card-symbol">{row.symbol}</h3>
                            <span className={`rs-leader-card-return ${Number(row.predicted_return_pct || 0) >= 0 ? 'rs-text-up' : 'rs-text-down'}`}>
                                {Number(row.predicted_return_pct || 0) >= 0 ? '+' : ''}{Number(row.predicted_return_pct || 0).toFixed(2)}%
                            </span>
                        </div>
                        <div className="rs-leader-card-metrics">
                            <div className="rs-metric">
                                <span>Label:</span>
                                <strong>{row.label || 'Neutral'}</strong>
                            </div>
                            <div className="rs-metric">
                                <span>Confidence:</span>
                                <strong>{Number(row.confidence_pct || 0).toFixed(1)}%</strong>
                            </div>
                            <div className="rs-metric">
                                <span>Prob up:</span>
                                <strong>{Number(row.probability_up_pct || 0).toFixed(1)}%</strong>
                            </div>
                            <div className="rs-metric">
                                <span>Momentum 20d:</span>
                                <strong>{Number(row.momentum_20_pct || 0).toFixed(2)}%</strong>
                            </div>
                        </div>
                        <button type="button" className="rs-leader-action" onClick={() => openAnalysisSymbol(row.symbol)}>
                            Open Chart
                        </button>
                    </div>
                ))}
                {!leaders.length && (
                    <div className="rs-leader-card-empty">
                        {state.mlResearchLoading ? 'Running ML signal engine...' : 'Run ML signals to score the current watchlist or portfolio universe.'}
                    </div>
                )}
            </div>

            <div className="rs-table-wrapper">
                <div className="rs-table-head">
                    <h3>Signal Details</h3>
                    <span className="rs-table-count">{mlRows.length} signals</span>
                </div>
                <table className="rs-signal-table">
                    <thead>
                        <tr>
                            <th>Symbol</th>
                            <th>Label</th>
                            <th>Predicted return</th>
                            <th>Prob up</th>
                            <th>Confidence</th>
                            <th>Direction accuracy</th>
                            <th>Volatility</th>
                            <th>20d momentum</th>
                            <th>Samples</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {mlRows.map((row) => (
                            <tr key={row.symbol} className="rs-table-row">
                                <td className="rs-td-symbol">{row.symbol}</td>
                                <td>
                                    <span className={`rs-stance-badge ${row.label === 'Bullish' ? 'rs-stance-badge--up' : row.label === 'Bearish' ? 'rs-stance-badge--down' : ''}`}>
                                        {row.label || 'Neutral'}
                                    </span>
                                </td>
                                <td className={Number(row.predicted_return_pct || 0) >= 0 ? 'rs-td-up' : 'rs-td-down'}>
                                    {Number(row.predicted_return_pct || 0) >= 0 ? '+' : ''}{Number(row.predicted_return_pct || 0).toFixed(2)}%
                                </td>
                                <td>{Number(row.probability_up_pct || 0).toFixed(1)}%</td>
                                <td>
                                    <div className="rs-confidence-bar">
                                        <div className="rs-confidence-fill" style={{ width: `${Number(row.confidence_pct || 0)}%` }}></div>
                                        <span className="rs-confidence-text">{Number(row.confidence_pct || 0).toFixed(0)}%</span>
                                    </div>
                                </td>
                                <td>{Number(row.direction_accuracy_pct || 0).toFixed(1)}%</td>
                                <td>{Number(row.volatility_pct || 0).toFixed(2)}%</td>
                                <td>{Number(row.momentum_20_pct || 0).toFixed(2)}%</td>
                                <td>{Number(row.training_samples || 0)}/{Number(row.validation_samples || 0)}</td>
                                <td>
                                    <button type="button" className="rs-action-btn" onClick={() => openAnalysisSymbol(row.symbol)}>
                                        Open
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {!mlRows.length && !state.mlResearchLoading && <div className="rs-empty-state">No ML signal rows yet.</div>}
            </div>

            {!!mlErrors.length && (
                <div className="rs-error-log-section">
                    <button type="button" className="rs-collapsible-header" onClick={() => setExpandedErrorLog(!expandedErrorLog)}>
                        <span className="rs-collapsible-icon">{expandedErrorLog ? '▼' : '▶'}</span>
                        <h3>Error Log</h3>
                        <span className="rs-error-count">{mlErrors.length} errors</span>
                    </button>
                    {expandedErrorLog && (
                        <div className="rs-error-list">
                            {mlErrors.slice(0, 12).map((row) => (
                                <div key={`${row.symbol}_err`} className="rs-error-item">
                                    <strong>{row.symbol}</strong>
                                    <span className="rs-error-msg">{row.error}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const PortfolioDashboard = ({ state, handlers, openAnalysisSymbol }) => {
    const [portfolioCopilotPrompt, setPortfolioCopilotPrompt] = useState('');
    const [portfolioCopilotAnswer, setPortfolioCopilotAnswer] = useState('');
    const [portfolioCopilotLoading, setPortfolioCopilotLoading] = useState(false);
    const [portfolioCopilotError, setPortfolioCopilotError] = useState('');
    const [portfolioCopilotLastPrompt, setPortfolioCopilotLastPrompt] = useState('');
    const [holdingsScope, setHoldingsScope] = useState('selected');
    const [performanceRange, setPerformanceRange] = useState('90D');
    const [transactionFilters, setTransactionFilters] = useState({ symbol: '', side: 'ALL', platform: 'ALL', segment: 'ALL', startDate: '', endDate: '' });
    const [duplicatePortfolioMode, setDuplicatePortfolioMode] = useState('full');
    const [duplicatePortfolioName, setDuplicatePortfolioName] = useState('');
    const [portfolioImportCsv, setPortfolioImportCsv] = useState('');
    const [portfolioImportPreview, setPortfolioImportPreview] = useState(null);
    const [portfolioImportLoading, setPortfolioImportLoading] = useState(false);
    const [portfolioAnalytics, setPortfolioAnalytics] = useState(null);
    const [portfolioAnalyticsLoading, setPortfolioAnalyticsLoading] = useState(false);
    const [portfolioTaxSummary, setPortfolioTaxSummary] = useState(null);
    const [portfolioTaxSummaryAll, setPortfolioTaxSummaryAll] = useState(null);
    const [portfolioTaxLoading, setPortfolioTaxLoading] = useState(false);
    const [portfolioFeeSummary, setPortfolioFeeSummary] = useState(null);
    const [portfolioFeeSummaryLoading, setPortfolioFeeSummaryLoading] = useState(false);
    const [financialYearFilter, setFinancialYearFilter] = useState('All');
    const [savedPrompts, setSavedPrompts] = useState([
        'Summarize diversification and concentration risk in this portfolio.',
        'Which holdings should I review first and why?',
        'Where are fees, taxes, or churn hurting this portfolio most?',
    ]);
    const [promptHistory, setPromptHistory] = useState([]);
    const [portfolioJournalMap, setPortfolioJournalMap] = useState({});
    const [copilotContextPayload, setCopilotContextPayload] = useState(null);

    const portfolioNames = Object.keys(state.portfolios || {});
    const activeTransactions = useMemo(() => state.selectedPortfolioTransactions || [], [state.selectedPortfolioTransactions]);
    const activeStats = useMemo(() => getPortfolioStats(state.selectedPortfolioPositions || [], activeTransactions), [state.selectedPortfolioPositions, activeTransactions]);
    const portfolioRollup = useMemo(
        () => portfolioNames.map((name) => {
            const transactions = state.portfolios?.[name] || [];
            const holdingsRows = ledgerDeriveHoldingsFromTransactions(transactions);
            const stats = getPortfolioStats(holdingsRows, transactions);
            return { name, holdings: stats.holdings, invested: stats.invested, current: stats.current, pnl: stats.grossPnl, net: stats.netAfterCosts };
        }),
        [portfolioNames, state.portfolios]
    );
    const holdings = useMemo(() => state.selectedPortfolioPositions || [], [state.selectedPortfolioPositions]);
    const combinedHoldings = useMemo(
        () => Object.entries(state.portfolios || {}).flatMap(([portfolioName, rows]) => ledgerDeriveHoldingsFromTransactions(rows || []).map((row) => ({ ...row, portfolioName }))),
        [state.portfolios]
    );
    const visibleHoldings = useMemo(
        () => (
            holdingsScope === 'combined'
                ? combinedHoldings
                : holdings.map((row) => ({ ...row, portfolioName: state.selectedPortfolio || 'Main' }))
        ),
        [holdingsScope, combinedHoldings, holdings, state.selectedPortfolio]
    );
    const visibleHoldingsStats = useMemo(() => getPortfolioStats(visibleHoldings), [visibleHoldings]);
    const visibleCurrentValue = visibleHoldingsStats.current;
    const holdingRows = useMemo(
        () => visibleHoldings.map((p) => {
            const invested = Number(p.invested || (Number(p.buyPrice || 0) * Number(p.quantity || 0)));
            const current = Number(p.current || (Number(p.currentPrice || 0) * Number(p.quantity || 0)));
            const pnl = Number(p.netPnl ?? p.pnl ?? (current - invested));
            return { ...p, invested, current, pnl, weightPct: visibleCurrentValue > 0 ? (100 * current) / visibleCurrentValue : 0 };
        }),
        [visibleHoldings, visibleCurrentValue]
    );
    const sortedSegments = useMemo(() => [...(activeStats.bySegment || [])].sort((a, b) => b.current - a.current), [activeStats.bySegment]);
    const sortedCountries = useMemo(() => [...(activeStats.byCountry || [])].sort((a, b) => b.current - a.current), [activeStats.byCountry]);
    const topHoldings = useMemo(() => [...holdingRows].sort((a, b) => b.current - a.current).slice(0, 5), [holdingRows]);
    const recentPurchases = activeStats.recentPurchases || [];
    const transactionRows = useMemo(
        () => (state.selectedPortfolioTransactions || [])
            .map((row) => ledgerNormalizePortfolioTransaction(row))
            .filter(Boolean)
            .sort((a, b) => `${b.tradeDate || b.createdAt}`.localeCompare(`${a.tradeDate || a.createdAt}`)),
        [state.selectedPortfolioTransactions]
    );
    const filteredTransactionRows = useMemo(
        () => transactionRows.filter((txn) => {
            const symbolOk = !transactionFilters.symbol || String(txn.symbol || '').toUpperCase().includes(transactionFilters.symbol.toUpperCase()) || String(txn.assetName || '').toLowerCase().includes(transactionFilters.symbol.toLowerCase());
            const sideOk = transactionFilters.side === 'ALL' || txn.side === transactionFilters.side;
            const platformOk = transactionFilters.platform === 'ALL' || (txn.platform || 'Unspecified') === transactionFilters.platform;
            const segmentOk = transactionFilters.segment === 'ALL' || (txn.segment || 'Other') === transactionFilters.segment;
            const dateKey = String(txn.tradeDate || '').slice(0, 10);
            const startOk = !transactionFilters.startDate || (dateKey && dateKey >= transactionFilters.startDate);
            const endOk = !transactionFilters.endDate || (dateKey && dateKey <= transactionFilters.endDate);
            return symbolOk && sideOk && platformOk && segmentOk && startOk && endOk;
        }),
        [transactionRows, transactionFilters]
    );
    const isEditingPosition = state.portfolioModalMode === 'edit';
    const profitablePct = activeStats.holdings ? Math.round((100 * activeStats.profitable) / activeStats.holdings) : 0;
    const concentrationPct = activeStats.current ? (100 * topHoldings.slice(0, 2).reduce((acc, row) => acc + row.current, 0)) / activeStats.current : 0;
    const primarySegment = sortedSegments[0] || null;
    const primaryCountry = sortedCountries[0] || null;
    const liveSnapshot = useMemo(() => buildPortfolioSnapshot(state.portfolios || {}), [state.portfolios]);
    const historicalSnapshots = useMemo(() => normalizePortfolioSnapshots(state.portfolioSnapshots || []), [state.portfolioSnapshots]);
    const filteredSnapshots = useMemo(() => {
        if (!historicalSnapshots.length) return [];
        if (performanceRange === 'ALL') return historicalSnapshots;
        const days = performanceRange === '30D' ? 30 : performanceRange === '90D' ? 90 : 365;
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        const rows = historicalSnapshots.filter((row) => {
            const ts = new Date(row.capturedAt || row.dateKey).getTime();
            return Number.isFinite(ts) && ts >= cutoff;
        });
        return rows.length ? rows : historicalSnapshots.slice(-1);
    }, [historicalSnapshots, performanceRange]);
    const latestPerformanceSnapshot = filteredSnapshots[filteredSnapshots.length - 1] || historicalSnapshots[historicalSnapshots.length - 1] || liveSnapshot;
    const firstPerformanceSnapshot = filteredSnapshots[0] || latestPerformanceSnapshot;
    const asOfLabel = useMemo(
        () => new Date(latestPerformanceSnapshot.capturedAt || latestPerformanceSnapshot.dateKey).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
        [latestPerformanceSnapshot]
    );
    const performanceChartRows = useMemo(() => {
        const source = filteredSnapshots.length ? filteredSnapshots : [latestPerformanceSnapshot];
        return source.map((row) => ({
            date: row.dateKey,
            current: Number(row.overall?.current || 0),
            invested: Number(row.overall?.invested || 0),
            pnl: Number(row.overall?.grossPnl || 0),
        }));
    }, [filteredSnapshots, latestPerformanceSnapshot]);
    const portfolioComparisonRows = useMemo(() => {
        const startMap = new Map((firstPerformanceSnapshot?.portfolios || []).map((row) => [row.name, row]));
        return (latestPerformanceSnapshot?.portfolios || []).map((row) => {
            const start = startMap.get(row.name);
            return {
                ...row,
                currentDelta: Number((row.current - Number(start?.current || 0)).toFixed(2)),
                pnlDelta: Number((row.pnl - Number(start?.pnl || 0)).toFixed(2)),
            };
        }).sort((a, b) => b.current - a.current);
    }, [latestPerformanceSnapshot, firstPerformanceSnapshot]);
    const showPortfolioSearch = state.portfolioSearchOpen && (state.portfolioSearchLoading || state.portfolioSearchResults.length > 0 || state.portfolioForm.symbol || state.portfolioForm.assetName);
    const projectionSymbol = String(state.portfolioForm.symbol || '').trim().toUpperCase();
    const projectionAssetName = String(state.portfolioForm.assetName || '').trim();
    const projectionSegment = normalizePortfolioSegment(state.portfolioForm.segment || 'Equity');
    const macroRegime = state.macroLabSnapshot?.regime || {};
    const heldSymbols = useMemo(() => Array.from(new Set(holdings.map((p) => String(p.symbol || '').trim().toUpperCase()).filter(Boolean))), [holdings]);
    const heldSymbolSet = useMemo(() => new Set(heldSymbols), [heldSymbols]);
    const heldMlSignals = useMemo(
        () => (state.mlResearchRows || []).filter((row) => !row.error && heldSymbolSet.has(String(row.symbol || '').trim().toUpperCase())).sort((a, b) => Math.abs(Number(b.predicted_return_pct || 0)) * Number(b.confidence_pct || 0) - Math.abs(Number(a.predicted_return_pct || 0)) * Number(a.confidence_pct || 0)).slice(0, 4),
        [state.mlResearchRows, heldSymbolSet]
    );
    const heldMacroSignals = useMemo(
        () => (state.macroLabImpactRows || []).filter((row) => heldSymbolSet.has(String(row.symbol || '').trim().toUpperCase())).sort((a, b) => Math.abs(Number(b.totalScore || 0)) - Math.abs(Number(a.totalScore || 0))).slice(0, 4),
        [state.macroLabImpactRows, heldSymbolSet]
    );
    const mlProjection = useMemo(() => {
        if (!projectionSymbol) return null;
        return (state.mlResearchRows || []).find((row) => String(row?.symbol || '').trim().toUpperCase() === projectionSymbol) || null;
    }, [projectionSymbol, state.mlResearchRows]);
    const macroProjection = useMemo(() => {
        if (!projectionSymbol) return null;
        return (state.macroLabImpactRows || []).find((row) => String(row?.symbol || '').trim().toUpperCase() === projectionSymbol) || null;
    }, [projectionSymbol, state.macroLabImpactRows]);
    const macroDriver = useMemo(() => {
        if (!macroProjection?.factors) return null;
        const ranked = Object.entries(macroProjection.factors).sort((a, b) => Math.abs(Number(b[1] || 0)) - Math.abs(Number(a[1] || 0)));
        return ranked[0] || null;
    }, [macroProjection]);
    const projectionHasData = Boolean((mlProjection && !mlProjection.error) || macroProjection);
    const projectionIsCustomOnly = projectionSegment === 'Other' || (!projectionSymbol && !!projectionAssetName);
    const projectionWaitingForSelection = !projectionSymbol && !projectionAssetName;
    const projectionLoading = !projectionHasData && (state.mlResearchLoading || state.macroLabLoading);
    const projectionPromptResearch = Boolean(projectionSymbol) && !projectionHasData && !state.mlResearchLoading && !state.macroLabLoading;
    const portfolioAnalyticsData = portfolioAnalytics?.kpis ? portfolioAnalytics : null;
    const analyticsKpis = portfolioAnalyticsData?.kpis || {
        invested: activeStats.invested,
        current: activeStats.current,
        realizedPnl: activeStats.realizedPnl,
        unrealizedPnl: Number((activeStats.grossPnl - activeStats.realizedPnl).toFixed(2)),
        netAfterCosts: activeStats.netAfterCosts,
        totalFeesPaid: activeStats.totalChargesPaid,
        projectedExitCharges: activeStats.projectedExitCharges,
    };
    const analyticsSeries = portfolioAnalyticsData?.cumulativeSeries?.length
        ? portfolioAnalyticsData.cumulativeSeries
        : performanceChartRows.map((row) => ({ month: row.date, invested: row.invested, current: row.current, realized: 0 }));
    const analyticsHeatmap = portfolioAnalyticsData?.transactionHeatmap || [];
    const analyticsCostLadders = portfolioAnalyticsData?.costLadders || [];
    const analyticsFeeByHolding = portfolioAnalyticsData?.feeDrainByHolding || [];
    const analyticsFeeByPlatform = portfolioAnalyticsData?.feeDrainByPlatform || [];
    const taxBuckets = portfolioTaxSummary?.buckets || [];
    const taxHoldings = portfolioTaxSummary?.holdingLiabilities || [];
    const taxPortfolioBreakdown = portfolioTaxSummaryAll?.perPortfolio || [];
    const taxYears = useMemo(() => {
        const years = new Set((portfolioTaxSummary?.realizedEvents || []).map((row) => row.financialYear).filter(Boolean));
        return ['All', ...Array.from(years)];
    }, [portfolioTaxSummary]);
    const uniquePlatforms = useMemo(() => ['ALL', ...Array.from(new Set(transactionRows.map((row) => row.platform || 'Unspecified')))], [transactionRows]);
    const uniqueSegments = useMemo(() => ['ALL', ...Array.from(new Set(transactionRows.map((row) => row.segment || 'Other')))], [transactionRows]);
    const portfolioCopilotContext = useMemo(() => {
        if (!holdings.length) return `Active portfolio: ${state.selectedPortfolio || 'Main'}\nNo holdings are currently saved.`;
        const lines = [
            `Active portfolio: ${state.selectedPortfolio || 'Main'}`,
            `Current value: ${activeStats.current.toFixed(2)}`,
            `Invested: ${activeStats.invested.toFixed(2)}`,
            `Gross P/L: ${activeStats.grossPnl.toFixed(2)}`,
            `Net after costs: ${activeStats.netAfterCosts.toFixed(2)}`,
            `Holdings: ${activeStats.holdings}`,
            `Profitable holdings: ${activeStats.profitable}`,
            `Top segment: ${primarySegment ? `${primarySegment.label} (${primarySegment.current.toFixed(2)})` : 'N/A'}`,
            `Top country: ${primaryCountry ? `${primaryCountry.label} (${primaryCountry.current.toFixed(2)})` : 'N/A'}`,
            'Top holdings:',
            ...topHoldings.slice(0, 5).map((row) => `- ${row.symbol}: current ${row.current.toFixed(2)}, invested ${row.invested.toFixed(2)}, pnl ${row.pnl.toFixed(2)}, weight ${row.weightPct.toFixed(1)}%, segment ${row.segment || 'N/A'}, country ${row.country || 'N/A'}`),
            'Country exposure:',
            ...sortedCountries.slice(0, 4).map((row) => `- ${row.label}: ${row.current.toFixed(2)}`),
        ];
        if (heldMlSignals.length) {
            lines.push('ML signals:');
            heldMlSignals.forEach((row) => lines.push(`- ${row.symbol}: ${row.label || 'Neutral'}, predicted ${Number(row.predicted_return_pct || 0).toFixed(2)}%, confidence ${Number(row.confidence_pct || 0).toFixed(1)}%, probability up ${Number(row.probability_up_pct || 0).toFixed(1)}%`));
        }
        if (heldMacroSignals.length) {
            lines.push(`Macro scenario: ${state.macroLabConfig?.scenario || 'Base'}`);
            lines.push('Macro impact rows:');
            heldMacroSignals.forEach((row) => lines.push(`- ${row.symbol}: ${row.stance || 'Neutral'}, total score ${Number(row.totalScore || 0).toFixed(2)}, confidence ${Math.round(Number(row.confidence || 0) * 100)}%`));
        }
        if (portfolioAnalyticsData?.feeDrainByHolding?.length) {
            lines.push('Fee drag:');
            portfolioAnalyticsData.feeDrainByHolding.slice(0, 3).forEach((row) => lines.push(`- ${row.symbol}: fees ${Number(row.fees || 0).toFixed(2)}`));
        }
        if (portfolioTaxSummary?.buckets?.length) {
            lines.push('Tax buckets:');
            portfolioTaxSummary.buckets.forEach((row) => lines.push(`- ${row.taxBucket}: pnl ${Number(row.pnl || 0).toFixed(2)} across ${row.events || 0} realized events`));
        }
        if (copilotContextPayload?.context) {
            lines.push('Backend copilot context:');
            lines.push(copilotContextPayload.context);
        }
        return lines.join('\n');
    }, [holdings, state.selectedPortfolio, activeStats, primarySegment, primaryCountry, topHoldings, sortedCountries, heldMlSignals, heldMacroSignals, state.macroLabConfig, portfolioAnalyticsData, portfolioTaxSummary, copilotContextPayload]);

    useEffect(() => {
        setPortfolioCopilotPrompt('');
        setPortfolioCopilotAnswer('');
        setPortfolioCopilotError('');
        setPortfolioCopilotLastPrompt('');
    }, [state.selectedPortfolio]);

    useEffect(() => {
        try {
            const rawLibrary = localStorage.getItem(PORTFOLIO_PROMPT_LIBRARY_KEY);
            if (rawLibrary) {
                const parsed = JSON.parse(rawLibrary);
                if (Array.isArray(parsed) && parsed.length) setSavedPrompts(parsed);
            }
            const rawHistory = localStorage.getItem(PORTFOLIO_PROMPT_HISTORY_KEY);
            if (rawHistory) {
                const parsed = JSON.parse(rawHistory);
                if (Array.isArray(parsed)) setPromptHistory(parsed);
            }
            const rawJournal = localStorage.getItem(PORTFOLIO_JOURNAL_KEY);
            if (rawJournal) {
                const parsed = JSON.parse(rawJournal);
                if (parsed && typeof parsed === 'object') setPortfolioJournalMap(parsed);
            }
        } catch (e) {
            console.error(e);
        }
    }, []);

    useEffect(() => {
        localStorage.setItem(PORTFOLIO_PROMPT_LIBRARY_KEY, JSON.stringify(savedPrompts || []));
    }, [savedPrompts]);

    useEffect(() => {
        localStorage.setItem(PORTFOLIO_PROMPT_HISTORY_KEY, JSON.stringify((promptHistory || []).slice(0, 30)));
    }, [promptHistory]);

    useEffect(() => {
        localStorage.setItem(PORTFOLIO_JOURNAL_KEY, JSON.stringify(portfolioJournalMap || {}));
    }, [portfolioJournalMap]);

    useEffect(() => {
        let cancelled = false;
        const portfolioName = encodeURIComponent(state.selectedPortfolio || 'Main');
        setPortfolioAnalyticsLoading(true);
        setPortfolioTaxLoading(true);
        setPortfolioFeeSummaryLoading(true);
        (async () => {
            try {
                const [analyticsRes, taxRes, taxAllRes, feeRes, copilotRes] = await Promise.all([
                    fetch(`${API_BASE}/api/portfolio/analytics?portfolio_name=${portfolioName}`),
                    fetch(`${API_BASE}/api/portfolio/report/tax-summary?portfolio_name=${portfolioName}${financialYearFilter !== 'All' ? `&financial_year=${encodeURIComponent(financialYearFilter)}` : ''}`),
                    fetch(`${API_BASE}/api/portfolio/report/tax-summary?portfolio_name=__all__${financialYearFilter !== 'All' ? `&financial_year=${encodeURIComponent(financialYearFilter)}` : ''}`),
                    fetch(`${API_BASE}/api/portfolio/report/fee-summary?portfolio_name=${portfolioName}`),
                    fetch(`${API_BASE}/api/portfolio/copilot/context`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ portfolio_name: state.selectedPortfolio || 'Main' }),
                    }),
                ]);
                const [analyticsData, taxData, taxAllData, feeData, copilotData] = await Promise.all([
                    analyticsRes.json(),
                    taxRes.json(),
                    taxAllRes.json(),
                    feeRes.json(),
                    copilotRes.json(),
                ]);
                if (cancelled) return;
                setPortfolioAnalytics(analyticsData?.analytics || null);
                setPortfolioTaxSummary(taxData?.report || null);
                setPortfolioTaxSummaryAll(taxAllData?.report || null);
                setPortfolioFeeSummary(feeData?.report || null);
                setCopilotContextPayload(copilotData?.ok ? copilotData : null);
            } catch (e) {
                console.error(e);
                if (!cancelled) {
                    setPortfolioAnalytics(null);
                    setPortfolioTaxSummary(null);
                    setPortfolioTaxSummaryAll(null);
                    setPortfolioFeeSummary(null);
                    setCopilotContextPayload(null);
                }
            } finally {
                if (!cancelled) {
                    setPortfolioAnalyticsLoading(false);
                    setPortfolioTaxLoading(false);
                    setPortfolioFeeSummaryLoading(false);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [state.selectedPortfolio, state.portfolios, financialYearFilter]);

    const openHoldingEditor = (row) => {
        if (row?.portfolioName && row.portfolioName !== state.selectedPortfolio) {
            handlers.setSelectedPortfolio(row.portfolioName);
        }
        const latestTxn = Array.isArray(row?.transactions) && row.transactions.length ? row.transactions[row.transactions.length - 1] : null;
        if (latestTxn) handlers.openPortfolioModal('edit', latestTxn);
    };

    const runPortfolioCopilot = async (promptOverride = '') => {
        const nextPrompt = String(promptOverride || portfolioCopilotPrompt || '').trim();
        if (!nextPrompt || portfolioCopilotLoading) return;
        if (!holdings.length) {
            setPortfolioCopilotError('Add holdings to the active portfolio before asking the copilot.');
            setPortfolioCopilotAnswer('');
            return;
        }
        if (!state.localLlmEnabled) {
            setPortfolioCopilotError('Enable the local LLM runtime first, then ask the portfolio copilot.');
            setPortfolioCopilotAnswer('');
            return;
        }
        setPortfolioCopilotLoading(true);
        setPortfolioCopilotError('');
        setPortfolioCopilotLastPrompt(nextPrompt);
        setPromptHistory((prev) => [{ prompt: nextPrompt, portfolio: state.selectedPortfolio || 'Main', askedAt: new Date().toISOString() }, ...prev].slice(0, 30));
        try {
            const out = await handlers.askLocalLlm({
                system: 'You are Quant Engine Portfolio Copilot. Give concise, practical portfolio guidance. Use the provided portfolio context only, avoid making up missing data, and structure the answer with short markdown sections for Summary, Risks, Opportunities, and Next checks.',
                prompt: `Portfolio context:\n${portfolioCopilotContext}\n\nUser question: ${nextPrompt}`,
                temperature: 0.2,
            });
            setPortfolioCopilotAnswer((out || '').trim() || 'No reply returned by the local model.');
        } catch (e) {
            const tip = 'Check Ollama, local LLM settings, and browser access to the configured base URL.';
            setPortfolioCopilotError(`${e?.message || 'Portfolio copilot failed.'} ${tip}`.trim());
            setPortfolioCopilotAnswer('');
        } finally {
            setPortfolioCopilotLoading(false);
        }
    };

    const quickCopilotPrompts = [
        'Summarize diversification and concentration risk in this portfolio.',
        'What are the biggest risks or overexposures in this portfolio?',
        'Which holdings should I review first and why?',
    ];
    const anomalyPrompts = (copilotContextPayload?.anomalies || []).slice(0, 4).map((item) => `Explain this anomaly in my portfolio and what to check next: ${item}`);
    const saveCurrentPrompt = () => {
        const nextPrompt = String(portfolioCopilotPrompt || '').trim();
        if (!nextPrompt || savedPrompts.includes(nextPrompt)) return;
        setSavedPrompts((prev) => [nextPrompt, ...prev].slice(0, 12));
    };
    const explainHolding = (row) => {
        const prompt = `Explain this holding using portfolio context, fees, concentration, and recent activity: ${row.symbol} (${row.assetName || row.symbol}), current ${Number(row.current || 0).toFixed(2)}, invested ${Number(row.invested || 0).toFixed(2)}, net pnl ${Number(row.pnl || row.netPnl || 0).toFixed(2)}, ${Number(row.transactionCount || 0)} transactions, segment ${row.segment || 'Equity'}, platform ${row.platform || 'Unknown'}.`;
        setPortfolioCopilotPrompt(prompt);
        runPortfolioCopilot(prompt);
    };
    const generateJournalSummary = async (scope = 'portfolio', row = null) => {
        if (portfolioCopilotLoading || !state.localLlmEnabled) return;
        const key = scope === 'holding' && row ? row.symbol : `portfolio:${state.selectedPortfolio || 'Main'}`;
        const prompt = scope === 'holding' && row
            ? `Write a compact transaction journal summary for ${row.symbol}. Include accumulation pattern, realized vs unrealized state, fees, and next review points.`
            : `Write a compact transaction journal summary for the full portfolio ${state.selectedPortfolio || 'Main'}. Include activity clusters, fee drag, realized vs unrealized profile, and what changed recently.`;
        setPortfolioCopilotLoading(true);
        try {
            const out = await handlers.askLocalLlm({
                system: 'You are a portfolio journal assistant. Summarize trading behavior in concise markdown with 3 short sections: Activity, Cost/Fee Notes, Next Review.',
                prompt: `${portfolioCopilotContext}\n\n${prompt}`,
                temperature: 0.2,
            });
            setPortfolioJournalMap((prev) => ({
                ...prev,
                [key]: {
                    scope,
                    symbol: row?.symbol || '',
                    text: (out || '').trim(),
                    updatedAt: new Date().toISOString(),
                },
            }));
        } catch (e) {
            setPortfolioCopilotError(e?.message || 'Journal generation failed.');
        } finally {
            setPortfolioCopilotLoading(false);
        }
    };
    const previewPortfolioImport = async () => {
        if (!portfolioImportCsv.trim() || portfolioImportLoading) return;
        setPortfolioImportLoading(true);
        try {
            const response = await fetch(`${API_BASE}/api/portfolio/import/preview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    csv_text: portfolioImportCsv,
                    portfolio_name: state.selectedPortfolio || 'Main',
                    platform: state.portfolioForm.platform || state.portfolioFeeRegistry?.platforms?.[0]?.label || '',
                    country: state.portfolioForm.country || state.portfolioFeeRegistry?.country || 'India',
                    state: state.portfolioForm.state || '',
                    purchaseType: state.portfolioForm.purchaseType || 'Delivery',
                    segment: state.portfolioForm.segment || 'Equity',
                    side: 'BUY',
                }),
            });
            const data = await response.json();
            setPortfolioImportPreview(data);
        } catch (e) {
            console.error(e);
            setPortfolioImportPreview({ previewRows: [], errorRows: [e?.message || 'Import preview failed.'], summary: { parsedRows: 0, importableRows: 0, errorCount: 1 } });
        } finally {
            setPortfolioImportLoading(false);
        }
    };
    const commitPortfolioImport = async () => {
        const previewRows = portfolioImportPreview?.previewRows || [];
        if (!previewRows.length || portfolioImportLoading) return;
        setPortfolioImportLoading(true);
        try {
            const response = await fetch(`${API_BASE}/api/portfolio/import/commit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ portfolio_name: state.selectedPortfolio || 'Main', preview_rows: previewRows }),
            });
            const data = await response.json();
            if (data?.portfolios) {
                handlers.replacePortfolios(data.portfolios);
                setPortfolioImportPreview(null);
                setPortfolioImportCsv('');
            }
        } catch (e) {
            console.error(e);
        } finally {
            setPortfolioImportLoading(false);
        }
    };
    const exportTaxSummary = () => downloadTextFile(`portfolio-tax-summary-${state.selectedPortfolio || 'main'}.csv`, rowsToCsv(portfolioTaxSummary?.realizedEvents || []), 'text/csv;charset=utf-8');
    const exportFeeSummary = () => downloadTextFile(`portfolio-fee-summary-${state.selectedPortfolio || 'main'}.csv`, rowsToCsv([...(portfolioFeeSummary?.lines || []), ...(portfolioFeeSummary?.platforms || []).map((row) => ({ scope: 'platform', ...row }))]), 'text/csv;charset=utf-8');

    return (
        <div className="qe-content mw-content pf-page">
            <header className="qe-hero pf-hero">
                <p className="qe-hero__label">Portfolio</p>
                <h1 className="qe-hero__title">Portfolio Desk</h1>
                <p className="qe-hero__sub">
                    AI-led workspace for portfolio oversight, allocations, holding management, and an Ollama-powered copilot for portfolio questions.
                </p>
            </header>

            <div className="pf-dock-layout">
                <div className="pf-main-column">
                    <section className="pf-performance-section">
                        <div className="qe-home-panel pf-performance-panel">
                            <div className="qe-section-head">
                                <h2>Total holdings performance</h2>
                                <div className="qe-home-actions qe-home-actions--wrap">
                                    {['30D', '90D', '1Y', 'ALL'].map((range) => (
                                        <button key={range} type="button" className={`qe-btn qe-btn--small ${performanceRange === range ? 'qe-btn--on' : ''}`} onClick={() => setPerformanceRange(range)}>
                                            {range}
                                        </button>
                                    ))}
                                    <span>As of {asOfLabel}</span>
                                </div>
                            </div>
                            <div className="pf-kpi-strip pf-kpi-strip--performance">
                                <div className="pf-kpi-card"><span>Current value</span><strong>{Number(latestPerformanceSnapshot.overall?.current || 0).toFixed(2)}</strong></div>
                                <div className="pf-kpi-card"><span>Total invested</span><strong>{Number(latestPerformanceSnapshot.overall?.invested || 0).toFixed(2)}</strong></div>
                                <div className="pf-kpi-card"><span>Gross P/L</span><strong className={Number(latestPerformanceSnapshot.overall?.grossPnl || 0) >= 0 ? 'qe-text-up' : 'qe-text-down'}>{Number(latestPerformanceSnapshot.overall?.grossPnl || 0).toFixed(2)}</strong></div>
                                <div className="pf-kpi-card"><span>Net after costs</span><strong className={Number(latestPerformanceSnapshot.overall?.netAfterCosts || 0) >= 0 ? 'qe-text-up' : 'qe-text-down'}>{Number(latestPerformanceSnapshot.overall?.netAfterCosts || 0).toFixed(2)}</strong></div>
                                <div className="pf-kpi-card"><span>Window change</span><strong className={Number((latestPerformanceSnapshot.overall?.current || 0) - (firstPerformanceSnapshot.overall?.current || 0)) >= 0 ? 'qe-text-up' : 'qe-text-down'}>{Number((latestPerformanceSnapshot.overall?.current || 0) - (firstPerformanceSnapshot.overall?.current || 0)).toFixed(2)}</strong></div>
                                <div className="pf-kpi-card"><span>Snapshot days</span><strong>{filteredSnapshots.length || 1}</strong></div>
                            </div>
                            <div className="pf-performance-grid">
                                <div className="qe-mini-chart pf-chart-card pf-performance-chart">
                                    {performanceChartRows.length ? (
                                        <ResponsiveContainer width="100%" height={270}>
                                            <LineChart data={performanceChartRows}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                                                <XAxis dataKey="date" tick={{ fill: '#8b909a', fontSize: 11 }} />
                                                <YAxis tick={{ fill: '#8b909a', fontSize: 11 }} />
                                                <ReTooltip />
                                                <Legend />
                                                <Line type="monotone" dataKey="invested" stroke="#d4af37" strokeWidth={2} dot={false} />
                                                <Line type="monotone" dataKey="current" stroke="#4ade80" strokeWidth={2} dot={false} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    ) : <div className="qe-empty">Add holdings over time to build the equity curve.</div>}
                                </div>
                                <div className="pf-performance-list">
                                    <div className="pf-dual-list__label">Per portfolio performance</div>
                                    <div className="qe-home-list pf-compact-list">
                                        {portfolioComparisonRows.map((row) => (
                                            <button key={`${row.name}_performance`} type="button" className={`qe-list-item qe-list-item--col pf-rollup-card ${state.selectedPortfolio === row.name ? 'pf-rollup-card--active' : ''}`} onClick={() => handlers.setSelectedPortfolio(row.name)}>
                                                <div className="pf-rollup-card__row">
                                                    <strong>{row.name}</strong>
                                                    <span>{row.holdings} holdings</span>
                                                </div>
                                                <span className="pf-rollup-card__meta">Invested {row.invested.toFixed(2)} · Current {row.current.toFixed(2)}</span>
                                                <span className={row.pnl >= 0 ? 'qe-text-up' : 'qe-text-down'}>P/L {row.pnl.toFixed(2)} · Delta {row.currentDelta.toFixed(2)} · As of {asOfLabel}</span>
                                            </button>
                                        ))}
                                        {!portfolioComparisonRows.length && <div className="qe-empty">No portfolio performance yet.</div>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="pf-workspace-full">
                        <div className="qe-home-panel pf-actions-panel pf-workspace-panel">
                            <div className="qe-section-head">
                                <h2>Portfolio workspace</h2>
                                <span>{state.selectedPortfolio || 'Main'} active</span>
                            </div>
                            <div className="pf-workspace-panel__grid">
                                <div className="pf-actions-card pf-workspace-panel__controls">
                                    <div className="pf-actions-card__head"><h3>Controls</h3><span>Switch and maintain the active portfolio</span></div>
                                    <div className="pf-workspace-toolbar">
                                        <div className="qe-input-group">
                                            <label className="qe-field-label">Switch portfolio</label>
                                            <select className="qe-select-inline" value={state.selectedPortfolio} onChange={(e) => handlers.setSelectedPortfolio(e.target.value)}>
                                                {portfolioNames.map((p) => <option key={p} value={p}>{p}</option>)}
                                            </select>
                                        </div>
                                        <div className="qe-home-actions qe-home-actions--wrap">
                                            <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.openPortfolioModal('add')}>Add item</button>
                                            <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.refreshPortfolioPrices()}>Refresh prices</button>
                                        </div>
                                    </div>
                                    <div className="pf-rail-stats-inline pf-rail-stats-inline--workspace">
                                        <div className="pf-rail-stat"><span>Active value</span><strong>{activeStats.current.toFixed(2)}</strong></div>
                                        <div className="pf-rail-stat"><span>Invested</span><strong>{activeStats.invested.toFixed(2)}</strong></div>
                                        <div className="pf-rail-stat"><span>Gross P/L</span><strong className={activeStats.grossPnl >= 0 ? 'qe-text-up' : 'qe-text-down'}>{activeStats.grossPnl.toFixed(2)}</strong></div>
                                        <div className="pf-rail-stat"><span>Holdings</span><strong>{holdings.length}</strong></div>
                                    </div>
                                </div>

                                <div className="pf-actions-card pf-workspace-panel__manage">
                                    <div className="pf-actions-card__head"><h3>Manage portfolios</h3><span>Create, rename, and review books</span></div>
                                    <div className="qe-portfolio-toolbar pf-toolbar-tight">
                                        <div className="qe-input-group">
                                            <label className="qe-field-label">Create portfolio</label>
                                            <div className="qe-home-actions qe-home-actions--wrap">
                                                <input className="qe-input" placeholder="Portfolio name" value={state.newPortfolioName} onChange={(e) => handlers.setNewPortfolioName(e.target.value)} />
                                                <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.createPortfolio()}>Create</button>
                                            </div>
                                        </div>
                                        <div className="qe-input-group">
                                            <label className="qe-field-label">Rename active portfolio</label>
                                            <div className="qe-home-actions qe-home-actions--wrap">
                                                <input className="qe-input" placeholder="Rename active portfolio" value={state.portfolioRenameInput} onChange={(e) => handlers.setPortfolioRenameInput(e.target.value)} />
                                                <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.renamePortfolio()}>Rename</button>
                                                <button type="button" className="qe-btn qe-btn--small qe-btn--danger" onClick={() => handlers.deletePortfolio(state.selectedPortfolio)}>Delete</button>
                                            </div>
                                        </div>
                                        <div className="qe-input-group">
                                            <label className="qe-field-label">Duplicate active portfolio</label>
                                            <div className="qe-home-actions qe-home-actions--wrap">
                                                <input className="qe-input" placeholder="Copy name" value={duplicatePortfolioName} onChange={(e) => setDuplicatePortfolioName(e.target.value)} />
                                                <select className="qe-select-inline" value={duplicatePortfolioMode} onChange={(e) => setDuplicatePortfolioMode(e.target.value)}>
                                                    <option value="structure">Structure only</option>
                                                    <option value="transactions">Transactions only</option>
                                                    <option value="full">Full clone</option>
                                                </select>
                                                <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.duplicatePortfolio(duplicatePortfolioMode, duplicatePortfolioName)}>Duplicate</button>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="qe-home-list pf-compact-list pf-rail-rollup">
                                        {portfolioRollup.map((row) => (
                                            <button key={`${row.name}_workspace`} type="button" className={`qe-list-item qe-list-item--col pf-rollup-card ${state.selectedPortfolio === row.name ? 'pf-rollup-card--active' : ''}`} onClick={() => handlers.setSelectedPortfolio(row.name)}>
                                                <div className="pf-rollup-card__row">
                                                    <strong>{row.name}</strong>
                                                    <span>{row.holdings} holdings</span>
                                                </div>
                                                <span className="pf-rollup-card__meta">Current {row.current.toFixed(2)} · P/L {row.pnl.toFixed(2)}</span>
                                            </button>
                                        ))}
                                        {!portfolioRollup.length && <div className="qe-empty">Create your first portfolio to get started.</div>}
                                    </div>
                                </div>
                            </div>
                            <div className="qe-rail__muted pf-form-note">Search-backed assets autofill when available, and custom assets can still be tracked manually with descriptions and notes.</div>
                        </div>
                    </section>

                    <section className="pf-insights-full">
                        <div className="qe-home-panel pf-side-card pf-insights-panel">
                            <div className="pf-side-card__head"><h3>Insights</h3><span>{holdings.length} holdings · as of {asOfLabel}</span></div>
                            <div className="pf-health-grid pf-health-grid--minimal">
                                <div className="pf-health-tile"><span>Profitable</span><strong>{profitablePct}%</strong><em>{activeStats.profitable}/{activeStats.holdings || 0} holdings</em></div>
                                <div className="pf-health-tile"><span>Top 2</span><strong>{concentrationPct.toFixed(1)}%</strong><em>Current concentration</em></div>
                                <div className="pf-health-tile"><span>Lead</span><strong>{primarySegment?.label || '—'}</strong><em>{primaryCountry?.label || 'No country yet'}</em></div>
                            </div>
                            <div className="pf-insights-grid">
                                <div className="pf-compact-section">
                                    <div className="pf-dual-list__label">Top holdings</div>
                                    <div className="qe-home-list pf-top-holdings">
                                        {topHoldings.slice(0, 3).map((row) => (
                                            <button key={`${row.id}_top`} type="button" className="qe-list-item qe-list-item--col pf-holding-card" onClick={() => openAnalysisSymbol(row.symbol)}>
                                                <div className="pf-holding-card__top">
                                                    <strong>{row.assetName || row.symbol}</strong>
                                                    <span>{row.weightPct.toFixed(1)}%</span>
                                                </div>
                                                <div className="pf-holding-card__meta">{row.symbol} · {row.segment || 'Equity'} · {row.country || 'Country n/a'}</div>
                                            </button>
                                        ))}
                                        {!topHoldings.length && <div className="qe-empty">Add holdings to surface quick insights.</div>}
                                    </div>
                                </div>
                                <div className="pf-compact-section">
                                    <div className="pf-dual-list__label">Research signals</div>
                                    <div className="pf-signal-grid">
                                        {heldMlSignals.slice(0, 3).map((row) => <div key={`${row.symbol}_ml`} className="pf-signal-card"><div className="pf-signal-card__head"><strong>{row.symbol}</strong><span className={Number(row.predicted_return_pct || 0) >= 0 ? 'qe-text-up' : 'qe-text-down'}>{Number(row.predicted_return_pct || 0).toFixed(2)}%</span></div><em>{row.label || 'Neutral'} · Confidence {Number(row.confidence_pct || 0).toFixed(1)}%</em></div>)}
                                        {heldMacroSignals.slice(0, 3).map((row) => <div key={`${row.symbol}_macro`} className="pf-signal-card"><div className="pf-signal-card__head"><strong>{row.symbol}</strong><span className={Number(row.totalScore || 0) >= 0 ? 'qe-text-up' : 'qe-text-down'}>{Number(row.totalScore || 0).toFixed(2)}</span></div><em>{row.stance || 'Neutral'} · Macro {row.scenario || state.macroLabConfig?.scenario || 'Base'}</em></div>)}
                                        {!heldMlSignals.length && !heldMacroSignals.length && <div className="qe-empty">Run Macro Lab or ML Signal Lab in `Research` to surface held-symbol signals here.</div>}
                                    </div>
                                </div>
                                <div className="pf-compact-section">
                                    <div className="pf-dual-list__label">Latest activity</div>
                                    <div className="qe-home-list pf-compact-list">
                                        {recentPurchases.slice(0, 3).map((p) => (
                                            <div key={`${p.id}_recent`} className="qe-list-item qe-list-item--col pf-activity-card">
                                                <div className="pf-activity-card__top">
                                                    <strong>{p.symbol}</strong>
                                                    <span>{p.tradeDate || 'No date'}</span>
                                                </div>
                                                <div className="pf-activity-card__meta">{p.assetName || p.symbol} · {p.side || 'BUY'} · {p.purchaseType || 'Delivery'}</div>
                                            </div>
                                        ))}
                                        {!recentPurchases.length && <div className="qe-empty">No dated purchases yet.</div>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="pf-analytics-suite">
                        <div className="qe-home-panel pf-analytics-panel">
                            <div className="qe-section-head">
                                <h2>Analytics suite</h2>
                                <span>{portfolioAnalyticsLoading ? 'Refreshing derived analytics...' : `${state.selectedPortfolio || 'Main'} derived from backend ledger`}</span>
                            </div>
                            <div className="pf-kpi-strip pf-kpi-strip--performance">
                                <div className="pf-kpi-card"><span>Invested</span><strong>{Number(analyticsKpis.invested || 0).toFixed(2)}</strong></div>
                                <div className="pf-kpi-card"><span>Current</span><strong>{Number(analyticsKpis.current || 0).toFixed(2)}</strong></div>
                                <div className="pf-kpi-card"><span>Realized P/L</span><strong className={Number(analyticsKpis.realizedPnl || 0) >= 0 ? 'qe-text-up' : 'qe-text-down'}>{Number(analyticsKpis.realizedPnl || 0).toFixed(2)}</strong></div>
                                <div className="pf-kpi-card"><span>Unrealized P/L</span><strong className={Number(analyticsKpis.unrealizedPnl || 0) >= 0 ? 'qe-text-up' : 'qe-text-down'}>{Number(analyticsKpis.unrealizedPnl || 0).toFixed(2)}</strong></div>
                                <div className="pf-kpi-card"><span>Total fees</span><strong>{Number(analyticsKpis.totalFeesPaid || 0).toFixed(2)}</strong></div>
                                <div className="pf-kpi-card"><span>Projected exit</span><strong>{Number(analyticsKpis.projectedExitCharges || 0).toFixed(2)}</strong></div>
                            </div>
                            <div className="pf-analytics-grid">
                                <div className="qe-mini-chart pf-chart-card">
                                    {analyticsSeries.length ? (
                                        <ResponsiveContainer width="100%" height={260}>
                                            <LineChart data={analyticsSeries}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                                                <XAxis dataKey="month" tick={{ fill: '#8b909a', fontSize: 11 }} />
                                                <YAxis tick={{ fill: '#8b909a', fontSize: 11 }} />
                                                <ReTooltip />
                                                <Legend />
                                                <Line type="monotone" dataKey="invested" stroke="#d4af37" strokeWidth={2} dot={false} />
                                                <Line type="monotone" dataKey="current" stroke="#4ade80" strokeWidth={2} dot={false} />
                                                <Line type="monotone" dataKey="realized" stroke="#60a5fa" strokeWidth={2} dot={false} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    ) : <div className="qe-empty">No cumulative series yet.</div>}
                                </div>
                                <div className="pf-analytics-side">
                                    <div className="pf-compact-section">
                                        <div className="pf-dual-list__label">Fee drain by holding</div>
                                        <div className="qe-home-list pf-compact-list">
                                            {analyticsFeeByHolding.slice(0, 5).map((row) => (
                                                <div key={`${row.symbol}_fee`} className="qe-list-item qe-list-item--col">
                                                    <strong>{row.symbol}</strong>
                                                    <span>{Number(row.fees || 0).toFixed(2)}</span>
                                                </div>
                                            ))}
                                            {!analyticsFeeByHolding.length && <div className="qe-empty">No fee leaders yet.</div>}
                                        </div>
                                    </div>
                                    <div className="pf-compact-section">
                                        <div className="pf-dual-list__label">Fee drain by platform</div>
                                        <div className="qe-home-list pf-compact-list">
                                            {analyticsFeeByPlatform.slice(0, 5).map((row) => (
                                                <div key={`${row.platform}_platform_fee`} className="qe-list-item qe-list-item--col">
                                                    <strong>{row.platform}</strong>
                                                    <span>{Number(row.fees || 0).toFixed(2)}</span>
                                                </div>
                                            ))}
                                            {!analyticsFeeByPlatform.length && <div className="qe-empty">No platform fee data yet.</div>}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="pf-analytics-grid">
                                <div className="pf-compact-section">
                                    <div className="pf-dual-list__label">Average cost ladders</div>
                                    <div className="pf-ladder-grid">
                                        {analyticsCostLadders.slice(0, 4).map((row) => (
                                            <div key={`${row.symbol}_ladder`} className="pf-ladder-card">
                                                <strong>{row.symbol}</strong>
                                                {(row.steps || []).slice(-4).map((step) => (
                                                    <div key={`${row.symbol}_${step.tradeDate}_${step.price}`} className="pf-ladder-step">
                                                        <span>{step.tradeDate || 'No date'}</span>
                                                        <em>{Number(step.quantity || 0).toLocaleString()} @ {Number(step.price || 0).toFixed(2)}</em>
                                                        <strong>Avg {Number(step.runningAverage || 0).toFixed(2)}</strong>
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                        {!analyticsCostLadders.length && <div className="qe-empty">Add multiple buy legs to populate average-cost ladders.</div>}
                                    </div>
                                </div>
                                <div className="pf-compact-section">
                                    <div className="pf-dual-list__label">Transaction heatmap</div>
                                    <div className="pf-heatmap-grid">
                                        {analyticsHeatmap.slice(0, 12).map((row) => (
                                            <div key={row.key} className="pf-heatmap-cell">
                                                <strong>{row.month}</strong>
                                                <span>{row.platform}</span>
                                                <em>{row.segment}</em>
                                                <b>{row.count} txns</b>
                                            </div>
                                        ))}
                                        {!analyticsHeatmap.length && <div className="qe-empty">Transaction heatmap appears once activity builds up.</div>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="pf-details-grid">
                        <div className="qe-home-panel pf-holdings-panel">
                            <div className="qe-section-head">
                                <h2>Holdings</h2>
                                <div className="qe-home-actions qe-home-actions--wrap pf-holdings-controls">
                                    <div className="wl-regime-pill">{holdingRows.length} rows</div>
                                    <button type="button" className={`qe-btn qe-btn--small ${holdingsScope === 'selected' ? 'qe-btn--on' : ''}`} onClick={() => setHoldingsScope('selected')}>
                                        {state.selectedPortfolio || 'Main'}
                                    </button>
                                    <button type="button" className={`qe-btn qe-btn--small ${holdingsScope === 'combined' ? 'qe-btn--on' : ''}`} onClick={() => setHoldingsScope('combined')}>
                                        Combined
                                    </button>
                                </div>
                            </div>
                            <div className="pf-holdings-grid">
                                {holdingRows.map((p) => (
                                    <div key={`${p.portfolioName || 'Main'}_${p.id}`} className="pf-holding-mini-card">
                                        <div className="pf-holding-mini-card__top">
                                            <div className="pf-holding-mini-card__identity">
                                                <strong>{p.assetName || p.symbol}</strong>
                                                <div className="pf-holding-mini-card__meta">{p.symbol} · {p.purchaseType || 'Delivery'} · {p.segment || 'Equity'}</div>
                                                {holdingsScope === 'combined' && <div className="pf-holding-mini-card__portfolio">{p.portfolioName || 'Main'}</div>}
                                                {!!p.description && <div className="pf-holding-mini-card__meta">{p.description}</div>}
                                            </div>
                                            <div className="qe-home-actions pf-holding-mini-card__actions">
                                                <button type="button" className="qe-btn qe-btn--small" onClick={() => openHoldingEditor(p)}>Edit</button>
                                                <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.openPortfolioQuickTransaction('BUY', p.transactions?.[p.transactions.length - 1] || p, p.portfolioName)}>Buy more</button>
                                                <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.openPortfolioQuickTransaction('SELL', p.transactions?.[p.transactions.length - 1] || p, p.portfolioName)}>Sell more</button>
                                                <button type="button" className="qe-btn qe-btn--small" onClick={() => explainHolding(p)}>Explain</button>
                                                <button type="button" className="qe-btn qe-btn--small" onClick={() => generateJournalSummary('holding', p)}>Journal</button>
                                                <button type="button" className="qe-btn qe-btn--small" onClick={() => openAnalysisSymbol(p.symbol)}>Open</button>
                                                <button type="button" className="qe-watch-card__rm" onClick={() => handlers.removePortfolioPosition(p.id, p.portfolioName)}>×</button>
                                            </div>
                                        </div>
                                        <div className="pf-holding-mini-card__stats">
                                            <div><span>Units</span><strong>{Number(p.quantity || 0).toLocaleString()}</strong></div>
                                            <div><span>Net P/L</span><strong className={p.pnl >= 0 ? 'qe-text-up' : 'qe-text-down'}>{p.pnl.toFixed(2)}</strong></div>
                                            <div><span>Avg cost</span><strong>{p.currencySymbol || '$'}{Number(p.buyPrice || 0).toFixed(2)}</strong></div>
                                            <div><span>Current</span><strong>{p.currencySymbol || '$'}{Number(p.currentPrice || 0).toFixed(2)}</strong></div>
                                            <div><span>Country</span><strong>{p.country || '—'}</strong></div>
                                            <div><span>Last trade</span><strong>{p.lastTradeDate || '—'}</strong></div>
                                        </div>
                                        <div className="pf-holding-mini-card__footer">
                                            <div className="pf-holding-mini-card__footer-item">
                                                <span>Platform</span>
                                                <strong>{p.platform || '—'}</strong>
                                            </div>
                                            <div className="pf-holding-mini-card__footer-item">
                                                <span>Realized</span>
                                                <strong>{Number(p.realizedPnl || 0).toFixed(2)}</strong>
                                            </div>
                                        </div>
                                        <div className="pf-note-preview">Transactions {Number(p.transactionCount || 0)} · Exit cost est. {Number(p.projectedExitCharges || 0).toFixed(2)}</div>
                                        {!!p.notes && <div className="pf-note-preview">{String(p.notes).slice(0, 220)}</div>}
                                    </div>
                                ))}
                                {!holdingRows.length && <div className="qe-empty">No holdings in this portfolio yet.</div>}
                            </div>
                        </div>
                    </section>

                    <section className="pf-transaction-section">
                        <div className="qe-home-panel pf-transaction-panel">
                            <div className="qe-section-head">
                                <h2>Transaction ledger</h2>
                                <div className="qe-home-actions qe-home-actions--wrap">
                                    <span>{state.selectedPortfolio || 'Main'} · {filteredTransactionRows.length}/{transactionRows.length} entries</span>
                                    <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.openPortfolioModal('add')}>
                                        Add transaction
                                    </button>
                                </div>
                            </div>
                            <div className="pf-filter-toolbar">
                                <input className="qe-input" placeholder="Filter by symbol or name" value={transactionFilters.symbol} onChange={(e) => setTransactionFilters((prev) => ({ ...prev, symbol: e.target.value }))} />
                                <select className="qe-select-inline" value={transactionFilters.side} onChange={(e) => setTransactionFilters((prev) => ({ ...prev, side: e.target.value }))}>
                                    <option value="ALL">All sides</option>
                                    {TRANSACTION_SIDE_CHOICES.map((side) => <option key={side} value={side}>{side}</option>)}
                                </select>
                                <select className="qe-select-inline" value={transactionFilters.platform} onChange={(e) => setTransactionFilters((prev) => ({ ...prev, platform: e.target.value }))}>
                                    {uniquePlatforms.map((row) => <option key={row} value={row}>{row === 'ALL' ? 'All platforms' : row}</option>)}
                                </select>
                                <select className="qe-select-inline" value={transactionFilters.segment} onChange={(e) => setTransactionFilters((prev) => ({ ...prev, segment: e.target.value }))}>
                                    {uniqueSegments.map((row) => <option key={row} value={row}>{row === 'ALL' ? 'All segments' : row}</option>)}
                                </select>
                                <input className="qe-input" type="date" value={transactionFilters.startDate} onChange={(e) => setTransactionFilters((prev) => ({ ...prev, startDate: e.target.value }))} />
                                <input className="qe-input" type="date" value={transactionFilters.endDate} onChange={(e) => setTransactionFilters((prev) => ({ ...prev, endDate: e.target.value }))} />
                            </div>
                            <div className="pf-transaction-list">
                                {filteredTransactionRows.map((txn) => (
                                    <div key={txn.id} className="pf-transaction-row">
                                        <div className="pf-transaction-row__main">
                                            <strong>{txn.symbol}</strong>
                                            <span>{txn.assetName || txn.symbol}</span>
                                            <em>{txn.tradeDate || 'No date'} · {txn.side}{txn.transactionSubtype ? `/${txn.transactionSubtype}` : ''} · {txn.purchaseType || 'Delivery'} · {txn.platform || 'Platform n/a'}</em>
                                            {!!txn.brokerReference && <span>Ref: {txn.brokerReference}</span>}
                                        </div>
                                        <div className="pf-transaction-row__stats">
                                            <div><span>Units</span><strong>{Number(txn.quantity || 0).toLocaleString()}</strong></div>
                                            <div><span>Price</span><strong>{Number(txn.price || 0).toFixed(2)}</strong></div>
                                            <div><span>Charges</span><strong>{Number(txn.chargeSnapshot?.totalCharges || 0).toFixed(2)}</strong></div>
                                        </div>
                                        <div className="qe-home-actions pf-transaction-row__actions">
                                            <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.openPortfolioQuickTransaction('BUY', txn)}>Buy more</button>
                                            <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.openPortfolioQuickTransaction('SELL', txn)}>Sell more</button>
                                            <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.openPortfolioModal('edit', txn)}>Edit</button>
                                            <button type="button" className="qe-btn qe-btn--small" onClick={() => explainHolding(txn)}>Explain</button>
                                            <button type="button" className="qe-btn qe-btn--small" onClick={() => openAnalysisSymbol(txn.symbol)}>Open</button>
                                            <button type="button" className="qe-watch-card__rm" onClick={() => handlers.removePortfolioPosition(txn.id, state.selectedPortfolio)}>×</button>
                                        </div>
                                    </div>
                                ))}
                                {!filteredTransactionRows.length && <div className="qe-empty">No transactions match the active filters.</div>}
                            </div>
                        </div>
                    </section>

                    <section className="pf-ideas-section">
                        <div className="qe-home-panel pf-ideas-panel">
                            <div className="qe-section-head">
                                <h2>Workflow import suite</h2>
                                <span>Preview broker CSV rows before they become transactions</span>
                            </div>
                            <div className="pf-import-suite">
                                <div className="pf-idea-card">
                                    <div className="pf-dual-list__label">Paste broker CSV</div>
                                    <textarea className="qe-input pf-import-textarea" placeholder="symbol,side,tradeDate,quantity,price,platform&#10;INFY,BUY,2025-03-01,10,1520.5,Zerodha" value={portfolioImportCsv} onChange={(e) => setPortfolioImportCsv(e.target.value)} />
                                    <div className="qe-home-actions qe-home-actions--wrap">
                                        <button type="button" className="qe-btn qe-btn--small" disabled={portfolioImportLoading} onClick={() => previewPortfolioImport()}>{portfolioImportLoading ? 'Previewing...' : 'Preview import'}</button>
                                        <button type="button" className="qe-btn qe-btn--small" disabled={portfolioImportLoading || !(portfolioImportPreview?.previewRows || []).length} onClick={() => commitPortfolioImport()}>Commit rows</button>
                                    </div>
                                </div>
                                <div className="pf-idea-card">
                                    <div className="pf-dual-list__label">Preview results</div>
                                    <div className="qe-home-list pf-compact-list">
                                        <div className="qe-list-item qe-list-item--col">
                                            <strong>Parsed rows</strong>
                                            <span>{portfolioImportPreview?.summary?.parsedRows || 0}</span>
                                        </div>
                                        <div className="qe-list-item qe-list-item--col">
                                            <strong>Importable rows</strong>
                                            <span>{portfolioImportPreview?.summary?.importableRows || 0}</span>
                                        </div>
                                        <div className="qe-list-item qe-list-item--col">
                                            <strong>Errors</strong>
                                            <span>{portfolioImportPreview?.summary?.errorCount || 0}</span>
                                        </div>
                                        {(portfolioImportPreview?.errorRows || []).slice(0, 4).map((row) => (
                                            <div key={row} className="qe-list-item qe-list-item--col">
                                                <strong>Issue</strong>
                                                <span>{row}</span>
                                            </div>
                                        ))}
                                        {(portfolioImportPreview?.previewRows || []).slice(0, 4).map((row) => (
                                            <div key={row.id} className="qe-list-item qe-list-item--col">
                                                <strong>{row.symbol}</strong>
                                                <span>{row.side} · {row.tradeDate || 'No date'} · Qty {Number(row.quantity || 0).toFixed(2)} @ {Number(row.price || 0).toFixed(2)}</span>
                                            </div>
                                        ))}
                                        {!portfolioImportPreview && <div className="qe-empty">Preview validates rows, shows mapping issues, and only then lets you commit.</div>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="pf-reports-section">
                        <div className="qe-home-panel pf-reports-panel">
                            <div className="qe-section-head">
                                <h2>India tax and fee reports</h2>
                                <div className="qe-home-actions qe-home-actions--wrap">
                                    <select className="qe-select-inline" value={financialYearFilter} onChange={(e) => setFinancialYearFilter(e.target.value)}>
                                        {taxYears.map((row) => <option key={row} value={row}>{row}</option>)}
                                    </select>
                                    <button type="button" className="qe-btn qe-btn--small" onClick={() => exportTaxSummary()}>Export tax CSV</button>
                                    <button type="button" className="qe-btn qe-btn--small" onClick={() => exportFeeSummary()}>Export fee CSV</button>
                                </div>
                            </div>
                            <div className="pf-report-grid">
                                <div className="pf-idea-card">
                                    <div className="pf-dual-list__label">Current-year tax liability</div>
                                    <div className="pf-report-metrics">
                                        <div><span>{state.selectedPortfolio || 'Main'} realized FY tax estimate</span><strong>{Number(portfolioTaxSummary?.currentYearRealizedTax || 0).toFixed(2)}</strong></div>
                                        <div><span>{state.selectedPortfolio || 'Main'} sell-now holding tax estimate</span><strong>{Number(portfolioTaxSummary?.sellNowTaxLiability || 0).toFixed(2)}</strong></div>
                                        <div><span>{state.selectedPortfolio || 'Main'} net FY tax liability</span><strong>{Number(portfolioTaxSummary?.netTaxLiabilityCurrentYear || 0).toFixed(2)}</strong></div>
                                        <div><span>All holdings net FY tax liability</span><strong>{Number(portfolioTaxSummaryAll?.netTaxLiabilityCurrentYear || 0).toFixed(2)}</strong></div>
                                        <div><span>Suggested cover for {state.selectedPortfolio || 'Main'} (2x net FY liability)</span><strong>{Number((portfolioTaxSummary?.netTaxLiabilityCurrentYear || 0) * 2).toFixed(2)}</strong></div>
                                        <div><span>Suggested cover for all holdings (2x net FY liability)</span><strong>{Number((portfolioTaxSummaryAll?.netTaxLiabilityCurrentYear || 0) * 2).toFixed(2)}</strong></div>
                                    </div>
                                </div>
                                <div className="pf-idea-card">
                                    <div className="pf-dual-list__label">Per portfolio tax view</div>
                                    <div className="qe-home-list pf-compact-list">
                                        {taxPortfolioBreakdown.map((row) => (
                                            <div key={row.portfolioName} className="qe-list-item qe-list-item--col">
                                                <strong>{row.portfolioName}</strong>
                                                <span>Realized FY {Number(row.currentYearRealizedTax || 0).toFixed(2)} · Sell now {Number(row.sellNowTaxLiability || 0).toFixed(2)} · Net FY {Number(row.netTaxLiabilityCurrentYear || 0).toFixed(2)}</span>
                                            </div>
                                        ))}
                                        {!taxPortfolioBreakdown.length && <div className="qe-empty">{portfolioTaxLoading ? 'Refreshing tax estimates...' : 'No portfolio tax rows yet.'}</div>}
                                    </div>
                                </div>
                                <div className="pf-idea-card">
                                    <div className="pf-dual-list__label">Sell-now holding liabilities</div>
                                    <div className="qe-home-list pf-compact-list">
                                        {taxHoldings.slice(0, 8).map((row) => (
                                            <div key={row.symbol} className="qe-list-item qe-list-item--col">
                                                <strong>{row.symbol} · {row.taxProfileLabel}</strong>
                                                <span>Gain {Number(row.sellNowGain || 0).toFixed(2)} · Tax {Number(row.estimatedTaxLiability || 0).toFixed(2)} · LT gain {Number(row.longTermGain || 0).toFixed(2)} · ST gain {Number(row.shortTermGain || 0).toFixed(2)}</span>
                                                <span>{row.rateNote || `ST ${Number(row.shortTermRatePct || 0).toFixed(1)}% · LT ${Number(row.longTermRatePct || 0).toFixed(1)}%`} {Number(row.equityExemptionUsed || 0) > 0 ? `· Equity exemption used ${Number(row.equityExemptionUsed || 0).toFixed(2)}` : ''}</span>
                                            </div>
                                        ))}
                                        {!taxHoldings.length && <div className="qe-empty">{portfolioTaxLoading ? 'Refreshing sell-now holding taxes...' : 'No open holding liabilities yet.'}</div>}
                                    </div>
                                </div>
                                <div className="pf-idea-card">
                                    <div className="pf-dual-list__label">Realized tax buckets</div>
                                    <div className="qe-home-list pf-compact-list">
                                        {taxBuckets.map((row) => (
                                            <div key={`${row.taxProfile}_${row.taxBucket}`} className="qe-list-item qe-list-item--col">
                                                <strong>{row.taxProfileLabel} · {row.taxBucket}</strong>
                                                <span>P/L {Number(row.pnl || 0).toFixed(2)} · Est. tax {Number(row.estimatedTax || 0).toFixed(2)} · {row.events || 0} events · Qty {Number(row.quantity || 0).toFixed(2)}</span>
                                                <span>{row.rateNote || `ST ${Number(row.shortTermRatePct || 0).toFixed(1)}% · LT ${Number(row.longTermRatePct || 0).toFixed(1)}%`}</span>
                                            </div>
                                        ))}
                                        {!taxBuckets.length && <div className="qe-empty">{portfolioTaxLoading ? 'Refreshing tax estimates...' : 'No realized tax events yet.'}</div>}
                                    </div>
                                </div>
                                <div className="pf-idea-card">
                                    <div className="pf-dual-list__label">Portfolio exit estimate</div>
                                    <div className="pf-report-metrics">
                                        <div><span>Sell-all exit charges</span><strong>{Number(portfolioTaxSummary?.sellAllExitEstimate || 0).toFixed(2)}</strong></div>
                                        <div><span>Fees already paid</span><strong>{Number(portfolioTaxSummary?.estimatedFeeBurden || 0).toFixed(2)}</strong></div>
                                        <div><span>Equity LTCG exemption used</span><strong>{Number(portfolioTaxSummary?.equityLtcgExemptionUsed || 0).toFixed(2)}</strong></div>
                                        <div><span>Equity LTCG exemption left</span><strong>{Number(portfolioTaxSummary?.equityLtcgExemptionRemaining || 0).toFixed(2)}</strong></div>
                                    </div>
                                </div>
                                <div className="pf-idea-card">
                                    <div className="pf-dual-list__label">Fee line summary</div>
                                    <div className="qe-home-list pf-compact-list">
                                        {(portfolioFeeSummary?.lines || []).slice(0, 6).map((row) => (
                                            <div key={row.label} className="qe-list-item qe-list-item--col">
                                                <strong>{row.label}</strong>
                                                <span>{Number(row.amount || 0).toFixed(2)}</span>
                                            </div>
                                        ))}
                                        {!portfolioFeeSummary?.lines?.length && <div className="qe-empty">{portfolioFeeSummaryLoading ? 'Refreshing fee summary...' : 'No fee lines available yet.'}</div>}
                                    </div>
                                </div>
                                <div className="pf-idea-card">
                                    <div className="pf-dual-list__label">India tax assumptions</div>
                                    <div className="qe-home-list pf-compact-list">
                                        <div className="qe-list-item qe-list-item--col">
                                            <strong>Financial year</strong>
                                            <span>{portfolioTaxSummary?.financialYear || financialYearFilter}</span>
                                        </div>
                                        <div className="qe-list-item qe-list-item--col">
                                            <strong>Cash cover suggestion</strong>
                                            <span>Keep at least 2x of the displayed net FY tax liability as a reserve cover for the selected portfolio and the combined book.</span>
                                        </div>
                                        {(portfolioTaxSummary?.assumptions || []).map((row) => (
                                            <div key={row} className="qe-list-item qe-list-item--col">
                                                <span>{row}</span>
                                            </div>
                                        ))}
                                        {!(portfolioTaxSummary?.assumptions || []).length && <div className="qe-empty">Tax estimation assumptions will appear here.</div>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>

                <aside className="pf-dock-column">
                    <section className="pf-ai-shell pf-ai-shell--dock">
                        <div className="qe-home-panel pf-ai-hero pf-ai-hero--dock">
                            <div className="pf-ai-hero__head">
                                <div>
                                    <div className="pf-eyebrow">Ollama Portfolio Copilot</div>
                                    <h2 className="pf-hero-card__title">Ask first, review second</h2>
                                    <p className="pf-hero-card__sub">
                                        Keep the copilot visible while you review performance, workspace controls, insights, and holdings.
                                    </p>
                                </div>
                                <div className="pf-ai-hero__status">
                                    <div className={`pf-sync-badge ${state.portfolioSyncing ? 'pf-sync-badge--live' : ''}`}>{state.portfolioSyncing ? 'Syncing' : state.portfolioHydrated ? 'Synced' : 'Loading'}</div>
                                    <div className="wl-regime-pill">LLM: {state.localLlmEnabled ? 'On' : 'Off'}</div>
                                    <div className="wl-regime-pill">Model: {state.localLlmModel || 'llama3.1'}</div>
                                </div>
                            </div>
                            <div className="pf-ai-hero__grid">
                                <div className="pf-ai-hero__ask">
                                    <div className="pf-copilot-head">
                                        <div>
                                            <h3>Portfolio copilot</h3>
                                            <p className="qe-rail__muted">Ask about diversification, overexposure, weak holdings, or what deserves action next.</p>
                                        </div>
                                        <div className="wl-regime-pill">{state.selectedPortfolio || 'Main'} active</div>
                                    </div>
                                    <textarea className="qe-input pf-copilot-textarea pf-copilot-textarea--hero" placeholder="Ask about diversification, risk, weakest holdings, or portfolio next steps..." value={portfolioCopilotPrompt} onChange={(e) => setPortfolioCopilotPrompt(e.target.value)} />
                                    <div className="pf-copilot-actions">
                                        <button type="button" className="qe-btn qe-btn--small" disabled={portfolioCopilotLoading || !holdings.length} onClick={() => runPortfolioCopilot()}>{portfolioCopilotLoading ? 'Thinking...' : 'Ask copilot'}</button>
                                        <button type="button" className="qe-btn qe-btn--small" disabled={!portfolioCopilotPrompt.trim()} onClick={() => saveCurrentPrompt()}>Save prompt</button>
                                        <button type="button" className="qe-btn qe-btn--small" disabled={portfolioCopilotLoading || !holdings.length} onClick={() => generateJournalSummary('portfolio')}>Journal</button>
                                        {quickCopilotPrompts.map((prompt) => (
                                            <button key={prompt} type="button" className="qe-btn qe-btn--small" disabled={portfolioCopilotLoading || !holdings.length} onClick={() => { setPortfolioCopilotPrompt(prompt); runPortfolioCopilot(prompt); }}>
                                                {prompt.length > 28 ? `${prompt.slice(0, 28)}...` : prompt}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="pf-copilot-meta">{portfolioCopilotLastPrompt ? `Last question: ${portfolioCopilotLastPrompt}` : state.localLlmLastStatus || 'Local runtime status appears in Settings.'}</div>
                                </div>
                                <div className={`pf-copilot-answer pf-copilot-answer--hero ${portfolioCopilotError ? 'pf-copilot-answer--error' : ''}`}>
                                    {portfolioCopilotError ? <div>{portfolioCopilotError}</div> : portfolioCopilotAnswer ? <div>{portfolioCopilotAnswer}</div> : <div className="pf-copilot-answer--empty">{holdings.length ? 'Try a quick prompt or ask your own question to get a concise portfolio readout from the local model.' : 'Add holdings to the active portfolio before using the copilot.'}</div>}
                                </div>
                            </div>
                            <div className="pf-ai-context-grid">
                                <div className="pf-context-card"><span>Active value</span><strong>{activeStats.current.toFixed(2)}</strong><em>{holdings.length} holdings</em></div>
                                <div className="pf-context-card"><span>Top 2 concentration</span><strong>{concentrationPct.toFixed(1)}%</strong><em>Share of current book</em></div>
                                <div className="pf-context-card"><span>Lead segment</span><strong>{primarySegment?.label || '—'}</strong><em>{primarySegment ? primarySegment.current.toFixed(2) : 'No allocation yet'}</em></div>
                            </div>
                            <div className="pf-dock-stacks">
                                <div className="pf-compact-section">
                                    <div className="pf-dual-list__label">Saved prompts</div>
                                    <div className="pf-chip-list">
                                        {savedPrompts.map((prompt) => (
                                            <button key={prompt} type="button" className="qe-btn qe-btn--small" onClick={() => { setPortfolioCopilotPrompt(prompt); runPortfolioCopilot(prompt); }}>
                                                {prompt.length > 32 ? `${prompt.slice(0, 32)}...` : prompt}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="pf-compact-section">
                                    <div className="pf-dual-list__label">Anomaly prompts</div>
                                    <div className="pf-chip-list">
                                        {anomalyPrompts.map((prompt) => (
                                            <button key={prompt} type="button" className="qe-btn qe-btn--small" onClick={() => { setPortfolioCopilotPrompt(prompt); runPortfolioCopilot(prompt); }}>
                                                {prompt.length > 32 ? `${prompt.slice(0, 32)}...` : prompt}
                                            </button>
                                        ))}
                                        {!anomalyPrompts.length && <div className="qe-empty">Anomaly prompts appear once backend portfolio context detects notable fee or tax flags.</div>}
                                    </div>
                                </div>
                                <div className="pf-compact-section">
                                    <div className="pf-dual-list__label">Prompt history</div>
                                    <div className="qe-home-list pf-compact-list">
                                        {promptHistory.slice(0, 5).map((row) => (
                                            <button key={`${row.askedAt}_${row.prompt}`} type="button" className="qe-list-item qe-list-item--col" onClick={() => { setPortfolioCopilotPrompt(row.prompt); runPortfolioCopilot(row.prompt); }}>
                                                <strong>{row.portfolio}</strong>
                                                <span>{row.prompt}</span>
                                            </button>
                                        ))}
                                        {!promptHistory.length && <div className="qe-empty">Your recent portfolio prompts will appear here.</div>}
                                    </div>
                                </div>
                                <div className="pf-compact-section">
                                    <div className="pf-dual-list__label">Saved journals</div>
                                    <div className="qe-home-list pf-compact-list">
                                        {Object.entries(portfolioJournalMap).slice(0, 4).map(([key, row]) => (
                                            <div key={key} className="qe-list-item qe-list-item--col">
                                                <strong>{row.symbol || row.scope}</strong>
                                                <span>{String(row.text || '').slice(0, 180)}</span>
                                            </div>
                                        ))}
                                        {!Object.keys(portfolioJournalMap).length && <div className="qe-empty">Generate a portfolio or holding journal to save a reusable narrative.</div>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>
                </aside>
            </div>


            {state.portfolioModalOpen && (
                <div className="pf-modal-backdrop" role="presentation" onClick={() => handlers.closePortfolioModal()}>
                    <div className="pf-modal" role="dialog" aria-modal="true" aria-label={isEditingPosition ? 'Edit transaction' : 'Add transaction'} onClick={(e) => e.stopPropagation()}>
                        <div className="pf-modal__head">
                            <div>
                                <div className="pf-eyebrow">Portfolio Transaction</div>
                                <h2 className="pf-modal__title">{isEditingPosition ? 'Edit transaction' : 'Add transaction'}</h2>
                                <p className="pf-modal__sub">
                                    Record buys, sells, dividends, fees, taxes, and corporate-action adjustments so average cost, realized P/L, and broker charges stay accurate.
                                </p>
                            </div>
                            <button type="button" className="pf-modal__close" onClick={() => handlers.closePortfolioModal()}>
                                Close
                            </button>
                        </div>

                        <div className="pf-modal__top">
                            <div className="pf-form-search">
                            <div className="qe-input-group">
                                <label className="qe-field-label">Asset name</label>
                                <input
                                    className="qe-input"
                                    placeholder="Apple Inc. or custom asset"
                                    value={state.portfolioForm.assetName}
                                    onChange={(e) => handlers.setPortfolioFormValue('assetName', e.target.value)}
                                    onFocus={() => handlers.setPortfolioFormValue('assetName', state.portfolioForm.assetName || '')}
                                />
                            </div>
                            <div className="qe-input-group">
                                <label className="qe-field-label">Ticker name</label>
                                <div className="qe-autocomplete pf-autocomplete">
                                    <input
                                        className="qe-input"
                                        placeholder="AAPL or custom ticker"
                                        value={state.portfolioForm.symbol}
                                        onChange={(e) => handlers.setPortfolioFormValue('symbol', e.target.value.toUpperCase())}
                                        onFocus={() => handlers.setPortfolioFormValue('symbol', state.portfolioForm.symbol || '')}
                                    />
                                    {showPortfolioSearch && (
                                        <div className="qe-autocomplete__menu">
                                            {state.portfolioSearchLoading ? (
                                                <div className="qe-autocomplete__item">Searching instruments...</div>
                                            ) : state.portfolioSearchResults.length > 0 ? (
                                                state.portfolioSearchResults.map((r) => (
                                                    <button
                                                        key={`${r.symbol}_${r.exchange}_${r.source}_portfolio`}
                                                        type="button"
                                                        className="qe-autocomplete__item"
                                                        onClick={() => handlers.selectPortfolioSearchResult(r)}
                                                    >
                                                        <strong>{r.symbol}</strong>
                                                        <span>{r.name}</span>
                                                        <em>
                                                            {r.assetType}
                                                            {r.assetFamily ? ` · ${r.assetFamily}` : ''}
                                                            {r.exchange ? ` · ${r.exchange}` : ''}
                                                            {r.isProxy ? ' · proxy' : ''}
                                                        </em>
                                                    </button>
                                                ))
                                            ) : (
                                                <div className="qe-autocomplete__item">No searchable match. You can still add this asset manually.</div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <section className="pf-projection-panel">
                            <div className="pf-projection-panel__head">
                                <div>
                                    <div className="pf-eyebrow">Projection Snapshot</div>
                                    <h3 className="pf-projection-panel__title">
                                        {projectionSymbol || projectionAssetName || 'Current portfolio item'}
                                    </h3>
                                    <p className="pf-projection-panel__sub">
                                        Compact Macro Lab and ML Signal Lab context for the holding you are editing.
                                    </p>
                                </div>
                                <div className="qe-home-actions qe-home-actions--wrap">
                                    <div className="wl-regime-pill">Macro: {state.macroLabConfig?.scenario || 'Base'}</div>
                                    <div className="wl-regime-pill">ML: {state.mlResearchConfig?.forecastHorizon || 5}d</div>
                                    <div className="wl-regime-pill">Segment: {projectionSegment}</div>
                                </div>
                            </div>

                            {projectionWaitingForSelection && (
                                <div className="pf-projection-empty">
                                    Pick a searchable symbol or enter a custom asset to see linked projections here.
                                </div>
                            )}

                            {projectionIsCustomOnly && !projectionWaitingForSelection && (
                                <div className="pf-projection-empty">
                                    No linked lab projection yet for this custom asset. Save it manually, or use a market-linked symbol to pull in Macro and ML context.
                                </div>
                            )}

                            {projectionLoading && (
                                <div className="pf-projection-empty">
                                    Loading research context from the current Macro Lab and ML Signal Lab runs...
                                </div>
                            )}

                            {projectionPromptResearch && (
                                <div className="pf-projection-empty">
                                    No projection is loaded for this symbol yet. Run Macro Lab or ML Signal Lab in `Research` to populate this panel.
                                </div>
                            )}

                            {!projectionWaitingForSelection && !projectionIsCustomOnly && !projectionLoading && !projectionPromptResearch && (
                                <div className="pf-projection-grid">
                                    <div className="pf-projection-card">
                                        <span>ML direction</span>
                                        {mlProjection && !mlProjection.error ? (
                                            <>
                                                <strong className={Number(mlProjection.predicted_return_pct || 0) >= 0 ? 'qe-text-up' : 'qe-text-down'}>
                                                    {mlProjection.label || 'Neutral'} · {Number(mlProjection.predicted_return_pct || 0).toFixed(2)}%
                                                </strong>
                                                <em>Forecast over {state.mlResearchConfig?.forecastHorizon || 5} trading days</em>
                                            </>
                                        ) : (
                                            <>
                                                <strong>No ML signal yet</strong>
                                                <em>Run ML Signal Lab for this symbol.</em>
                                            </>
                                        )}
                                    </div>
                                    <div className="pf-projection-card">
                                        <span>ML conviction</span>
                                        {mlProjection && !mlProjection.error ? (
                                            <>
                                                <strong>{Number(mlProjection.probability_up_pct || 0).toFixed(1)}% up probability</strong>
                                                <em>Confidence {Number(mlProjection.confidence_pct || 0).toFixed(1)}%</em>
                                            </>
                                        ) : (
                                            <>
                                                <strong>Awaiting ML coverage</strong>
                                                <em>Probability and confidence appear after an ML run.</em>
                                            </>
                                        )}
                                    </div>
                                    <div className="pf-projection-card">
                                        <span>Macro stance</span>
                                        {macroProjection ? (
                                            <>
                                                <strong className={Number(macroProjection.totalScore || 0) >= 0 ? 'qe-text-up' : 'qe-text-down'}>
                                                    {macroProjection.stance || 'Neutral'} · {Number(macroProjection.totalScore || 0).toFixed(2)}
                                                </strong>
                                                <em>
                                                    {macroDriver
                                                        ? `${String(macroDriver[0]).toUpperCase()} is the strongest driver (${Number(macroDriver[1] || 0).toFixed(2)})`
                                                        : `Confidence ${Math.round(Number(macroProjection.confidence || 0) * 100)}%`}
                                                </em>
                                            </>
                                        ) : (
                                            <>
                                                <strong>No macro stance yet</strong>
                                                <em>Refresh Macro Lab with this symbol in scope.</em>
                                            </>
                                        )}
                                    </div>
                                    <div className="pf-projection-card">
                                        <span>Scenario context</span>
                                        <strong>{state.macroLabConfig?.scenario || 'Base'} scenario</strong>
                                        <em>
                                            Risk {Number(macroRegime.riskOn || 0).toFixed(2)} · Rates {Number(macroRegime.ratesPressure || 0).toFixed(2)} · FX {Number(macroRegime.usdPressure || 0).toFixed(2)}
                                        </em>
                                    </div>
                                </div>
                            )}
                        </section>
                        </div>

                        <div className="qe-form-grid portfolio-form-grid pf-form-grid">
                            <div className="qe-input-group">
                                <label className="qe-field-label">Transaction side</label>
                                <select className="qe-select-inline" value={state.portfolioForm.side} onChange={(e) => handlers.setPortfolioFormValue('side', e.target.value)}>
                                    {TRANSACTION_SIDE_CHOICES.map((row) => (
                                        <option key={row} value={row}>{row}</option>
                                    ))}
                                </select>
                            </div>
                            {state.portfolioForm.side === 'ADJUSTMENT' && (
                                <div className="qe-input-group">
                                    <label className="qe-field-label">Adjustment subtype</label>
                                    <select className="qe-select-inline" value={state.portfolioForm.transactionSubtype || 'Manual'} onChange={(e) => handlers.setPortfolioFormValue('transactionSubtype', e.target.value)}>
                                        {ADJUSTMENT_SUBTYPE_CHOICES.map((row) => <option key={row} value={row}>{row}</option>)}
                                    </select>
                                </div>
                            )}
                            <div className="qe-input-group">
                                <label className="qe-field-label">Purchase type</label>
                                <select className="qe-select-inline" value={state.portfolioForm.purchaseType} onChange={(e) => handlers.setPortfolioFormValue('purchaseType', e.target.value)}>
                                    {PURCHASE_TYPE_CHOICES.map((s) => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div className="qe-input-group">
                                <label className="qe-field-label">Asset family</label>
                                <select className="qe-select-inline" value={state.portfolioForm.segment} onChange={(e) => handlers.setPortfolioFormValue('segment', e.target.value)}>
                                    {SEGMENT_CHOICES.map((s) => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div className="qe-input-group">
                                <label className="qe-field-label">Trade date</label>
                                <input className="qe-input" type="date" value={state.portfolioForm.tradeDate} onChange={(e) => handlers.setPortfolioFormValue('tradeDate', e.target.value)} />
                            </div>
                            <div className="qe-input-group">
                                <label className="qe-field-label">Country</label>
                                <input className="qe-input" list="pf-country-options" placeholder="India" value={state.portfolioForm.country} onChange={(e) => handlers.setPortfolioFormValue('country', e.target.value)} />
                            </div>
                            <div className="qe-input-group">
                                <label className="qe-field-label">State / UT</label>
                                <input className="qe-input" list="pf-state-options" placeholder="Maharashtra" value={state.portfolioForm.state || ''} onChange={(e) => handlers.setPortfolioFormValue('state', e.target.value)} />
                            </div>
                            <div className="qe-input-group">
                                <label className="qe-field-label">Platform</label>
                                <input className="qe-input" list="pf-platform-options" placeholder="Zerodha" value={state.portfolioForm.platform} onChange={(e) => handlers.setPortfolioFormValue('platform', e.target.value)} />
                            </div>
                            <div className="qe-input-group">
                                <label className="qe-field-label">Broker reference</label>
                                <input className="qe-input" placeholder="Order ID / contract note ref" value={state.portfolioForm.brokerReference || ''} onChange={(e) => handlers.setPortfolioFormValue('brokerReference', e.target.value)} />
                            </div>
                            <div className="qe-input-group">
                                <label className="qe-field-label">Trade price / unit</label>
                                <input className="qe-input" placeholder="125.50" type="number" min="0" step="0.01" value={state.portfolioForm.price} onChange={(e) => handlers.setPortfolioFormValue('price', e.target.value)} />
                            </div>
                            <div className="qe-input-group">
                                <label className="qe-field-label">Units</label>
                                <input className="qe-input" placeholder="10" type="number" min="0" value={state.portfolioForm.quantity} onChange={(e) => handlers.setPortfolioFormValue('quantity', e.target.value)} />
                            </div>
                            <div className="qe-input-group">
                                <label className="qe-field-label">Manual charge override</label>
                                <input className="qe-input" placeholder="0" type="number" min="0" step="0.01" value={state.portfolioForm.manualCharge} onChange={(e) => handlers.setPortfolioFormValue('manualCharge', e.target.value)} />
                            </div>
                            <div className="qe-input-group">
                                <label className="qe-field-label">Manual tax override</label>
                                <input className="qe-input" placeholder="0" type="number" min="0" step="0.01" value={state.portfolioForm.manualTax} onChange={(e) => handlers.setPortfolioFormValue('manualTax', e.target.value)} />
                            </div>
                        </div>

                        <datalist id="pf-platform-options">
                            {(state.portfolioFeeRegistry?.platforms || []).map((row) => (
                                <option key={row.id} value={row.label} />
                            ))}
                        </datalist>
                        <datalist id="pf-country-options">
                            {(state.portfolioFeeRegistry?.countryOptions || ['India']).map((row) => (
                                <option key={row} value={row} />
                            ))}
                        </datalist>
                        <datalist id="pf-state-options">
                            {(state.portfolioFeeRegistry?.stateOptions || []).map((row) => (
                                <option key={row} value={row} />
                            ))}
                        </datalist>

                        <section className="pf-projection-panel pf-fee-preview-panel">
                            <div className="pf-projection-panel__head">
                                <div>
                                    <div className="pf-eyebrow">True P/L Preview</div>
                                    <h3 className="pf-projection-panel__title">Estimated broker fees and taxes</h3>
                                    <p className="pf-projection-panel__sub">
                                        Uses the India-first platform registry and adds manual overrides when you specify them.
                                    </p>
                                </div>
                                <div className="qe-home-actions qe-home-actions--wrap">
                                    <div className="wl-regime-pill">{state.portfolioForm.side || 'BUY'}</div>
                                    <div className="wl-regime-pill">{state.portfolioFeePreview?.segmentLabel || 'Awaiting values'}</div>
                                </div>
                            </div>
                            {state.portfolioFeePreviewLoading ? (
                                <div className="pf-projection-empty">Refreshing fee preview...</div>
                            ) : state.portfolioFeePreview ? (
                                <div className="pf-fee-preview-grid">
                                    <div className="pf-projection-card">
                                        <span>Turnover</span>
                                        <strong>{Number(state.portfolioFeePreview.turnover || 0).toFixed(2)}</strong>
                                        <em>{state.portfolioFeePreview.platformLabel || state.portfolioForm.platform || 'Platform default'}{state.portfolioFeePreview.state ? ` · ${state.portfolioFeePreview.state}` : ''}</em>
                                    </div>
                                    <div className="pf-projection-card">
                                        <span>Total charges</span>
                                        <strong>{Number(state.portfolioFeePreview.totalCharges || 0).toFixed(2)}</strong>
                                        <em>{state.portfolioFeePreview.exactness || 'template_estimate'}</em>
                                    </div>
                                    <div className="pf-projection-card">
                                        <span>Registry version</span>
                                        <strong>{state.portfolioFeePreview.registryVersion || 'n/a'}</strong>
                                        <em>{state.portfolioFeePreview.sourceTitle || 'Broker template'}</em>
                                    </div>
                                    <div className="pf-fee-lines">
                                        {(state.portfolioFeePreview.lines || []).map((line) => (
                                            <div key={`${line.key}_${line.label}`} className="pf-fee-line">
                                                <span>{line.label}</span>
                                                <strong>{Number(line.amount || 0).toFixed(2)}</strong>
                                            </div>
                                        ))}
                                        {!!state.portfolioFeePreview.stampDutyNote && (
                                            <div className="pf-fee-line">
                                                <span>Stamp duty note</span>
                                                <strong>{state.portfolioFeePreview.stampDutyNote}</strong>
                                            </div>
                                        )}
                                        {!(state.portfolioFeePreview.lines || []).length && <div className="qe-empty">No fee lines for this transaction yet.</div>}
                                    </div>
                                </div>
                            ) : (
                                <div className="pf-projection-empty">
                                    Enter symbol, units, and price to preview broker charges and taxes for this transaction.
                                </div>
                            )}
                        </section>

                        <div className="pf-modal__notes">
                            <div className="qe-input-group">
                                <label className="qe-field-label">Short description</label>
                                <input className="qe-input" placeholder="Large-cap growth mutual fund, gold ETF, private debt note..." value={state.portfolioForm.description} onChange={(e) => handlers.setPortfolioFormValue('description', e.target.value)} />
                            </div>
                            <div className="qe-input-group">
                                <label className="qe-field-label">Tracking notes</label>
                                <textarea className="qe-input pf-modal__textarea" placeholder="Write your thesis, SIP note, exit criteria, or manual tracking memo..." value={state.portfolioForm.notes} onChange={(e) => handlers.setPortfolioFormValue('notes', e.target.value)} />
                            </div>
                        </div>

                        <div className="qe-home-actions pf-modal__actions">
                            <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.submitPortfolioPosition()}>
                                {isEditingPosition ? 'Save transaction' : 'Add transaction'}
                            </button>
                            <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.closePortfolioModal()}>
                                Cancel
                            </button>
                        </div>
                        {state.portfolioAutoFillHint && (
                            <div className="pf-autofill-banner">
                                {state.portfolioAutoFillHint}
                            </div>
                        )}
                        <div className="qe-rail__muted pf-form-note">
                            Search by ticker or asset name to autofill tradable instruments. Save each buy or sell as its own transaction so average cost and realized P/L stay accurate.
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const HomeDashboard = ({ state, handlers, setState }) => {
    const bullishPct = state.homeStats?.sampleSize
        ? Math.round((100 * (state.homeStats.advancing || 0)) / state.homeStats.sampleSize)
        : 50;

    // Build macro proxy chart data from real API data
    const macroProxies = state.homeMacro?.proxies || {};
    const riskSeries = macroProxies.risk?.series || [];
    const marketChartData = riskSeries.slice(-12).map((pt, idx) => {
        const ratesPt = (macroProxies.rates?.series || []).slice(-12)[idx];
        return {
            m: pt.x ? pt.x.slice(5) : `${idx + 1}`,
            'Risk (SPY)': Number((pt.y || 0).toFixed(2)),
            'Rates (TLT)': ratesPt ? Number((ratesPt.y || 0).toFixed(2)) : 0,
        };
    });
    // Fallback if no macro data: use focus list as before
    const fallbackChartData = (state.homeFocusList || []).slice(0, 8).map((r, idx) => {
        const base = 100 + idx * 0.9;
        const move = Number(r.changePct || 0);
        return {
            m: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'][idx] || `${idx + 1}`,
            'Risk (SPY)': Number((base + move * 0.8).toFixed(2)),
            'Rates (TLT)': Number((base + move * 1.05).toFixed(2)),
        };
    });
    const chartData = marketChartData.length > 0 ? marketChartData : fallbackChartData;

    // Regime signals from macro snapshot
    const regime = state.homeMacro?.regime || {};
    const regimeCards = [
        { label: 'Risk-On', value: regime.riskOn || 0, desc: 'Equity momentum' },
        { label: 'Rates', value: regime.ratesPressure || 0, desc: 'Bond pressure' },
        { label: 'Inflation', value: regime.inflationPressure || 0, desc: 'Commodity trend' },
        { label: 'USD', value: regime.usdPressure || 0, desc: 'Dollar strength' },
    ];

    // Build macro rows from real proxy data (last price from series)
    const macroRows = Object.entries(macroProxies).map(([key, data]) => {
        const series = data.series || [];
        const lastPt = series.length ? series[series.length - 1] : null;
        const prevPt = series.length >= 2 ? series[series.length - 2] : null;
        const lastVal = lastPt ? lastPt.y : 0;
        const prevVal = prevPt ? prevPt.y : lastVal;
        const chgPct = prevVal ? ((lastVal - prevVal) / prevVal) * 100 : 0;
        return {
            label: data.name || key,
            symbol: data.symbol || key.toUpperCase(),
            value: lastVal,
            chg: chgPct,
            source: data.source || 'unknown',
        };
    });
    // Fallback if no macro data
    if (!macroRows.length) {
        macroRows.push(
            { label: 'Risk Proxy (SPY)', symbol: 'SPY', value: 0, chg: 0, source: 'pending' },
            { label: 'Rates Proxy (TLT)', symbol: 'TLT', value: 0, chg: 0, source: 'pending' },
            { label: 'Commodity Proxy (DBC)', symbol: 'DBC', value: 0, chg: 0, source: 'pending' },
            { label: 'USD Proxy (UUP)', symbol: 'UUP', value: 0, chg: 0, source: 'pending' },
        );
    }

    const topMovers = (state.homeLeaders || []).slice(0, 5);
    const bottomMovers = (state.homeLaggers || []).slice(0, 5);
    const majorCards = (state.homeFocusList || []).slice(0, 4);

    // Portfolio summary from analytics
    const analytics = state.homePortfolioAnalytics || {};
    const portfolioNames = Object.keys(state.portfolios || {});
    const totalHoldings = portfolioNames.reduce((sum, name) => sum + (state.portfolios[name]?.length || 0), 0);

    // AI Health
    const aiHealth = state.homeAiHealth || {};
    const ollamaOnline = aiHealth.ollama_reachable || aiHealth.ok || false;
    const modelCount = (aiHealth.models || []).length;

    // Watchlist summary
    const watchSymbols = state.watchlistSymbols || [];
    const watchRows = state.watchSummaryRows || [];

    return (
        <div className="qe-content qe-content--home">
            {/* === KPI Ribbon === */}
            <section className="hd-kpi-ribbon">
                <div className="hd-kpi-card">
                    <span className="hd-kpi-card__label">Universe</span>
                    <strong className="hd-kpi-card__value">{state.homeStats?.sampleSize || 0}</strong>
                    <span className="hd-kpi-card__sub">symbols tracked</span>
                </div>
                <div className="hd-kpi-card">
                    <span className="hd-kpi-card__label">Advancing</span>
                    <strong className="hd-kpi-card__value qe-text-up">{state.homeStats?.advancing || 0}</strong>
                    <span className="hd-kpi-card__sub">of {state.homeStats?.sampleSize || 0}</span>
                </div>
                <div className="hd-kpi-card">
                    <span className="hd-kpi-card__label">Declining</span>
                    <strong className="hd-kpi-card__value qe-text-down">{state.homeStats?.declining || 0}</strong>
                    <span className="hd-kpi-card__sub">of {state.homeStats?.sampleSize || 0}</span>
                </div>
                <div className="hd-kpi-card">
                    <span className="hd-kpi-card__label">Avg Move</span>
                    <strong className={`hd-kpi-card__value ${(state.homeStats?.avgMove || 0) >= 0 ? 'qe-text-up' : 'qe-text-down'}`}>
                        {(state.homeStats?.avgMove || 0).toFixed(2)}%
                    </strong>
                    <span className="hd-kpi-card__sub">breadth</span>
                </div>
                <div className="hd-kpi-card">
                    <span className="hd-kpi-card__label">Watchlist</span>
                    <strong className="hd-kpi-card__value">{watchSymbols.length}</strong>
                    <span className="hd-kpi-card__sub">symbols</span>
                </div>
                <div className="hd-kpi-card">
                    <span className="hd-kpi-card__label">Portfolios</span>
                    <strong className="hd-kpi-card__value">{portfolioNames.length}</strong>
                    <span className="hd-kpi-card__sub">{totalHoldings} holdings</span>
                </div>
                <div className="hd-kpi-card">
                    <span className="hd-kpi-card__label">AI</span>
                    <strong className={`hd-kpi-card__value ${ollamaOnline ? 'qe-text-up' : 'qe-text-down'}`}>
                        {ollamaOnline ? 'Online' : 'Offline'}
                    </strong>
                    <span className="hd-kpi-card__sub">{modelCount} model{modelCount !== 1 ? 's' : ''} · {state.homeAiAlertCount || 0} alerts</span>
                </div>
            </section>

            {/* === Header + Actions === */}
            <section className="qe-market-shell">
                <div className="qe-market-header">
                    <div>
                        <p className="qe-hero__label">Market monitor</p>
                        <h1 className="qe-market-title">Market Overview</h1>
                    </div>
                    <div className="qe-home-actions">
                        <button type="button" className="qe-btn qe-btn--small" onClick={() => setState.setViewMode('index')}>Universe</button>
                        <button type="button" className="qe-btn qe-btn--small" onClick={() => setState.setViewMode('screener')}>Research</button>
                        <button type="button" className="qe-btn qe-btn--small" disabled={state.homeLoading} onClick={() => handlers.refreshHomeDashboard()}>
                            {state.homeLoading ? 'Refreshing...' : 'Refresh'}
                        </button>
                        <button type="button" className="qe-btn qe-btn--small" disabled={state.aiSuggesting} onClick={() => handlers.generateAiSuggestions()}>
                            {state.aiSuggesting ? 'AI...' : 'AI suggestions'}
                        </button>
                        <button type="button" className="qe-btn qe-btn--small qe-btn--danger" disabled={state.maintenanceBusy} onClick={() => handlers.cleanDashboard()}>
                            Clean
                        </button>
                    </div>
                </div>

                {/* === Regime Indicators === */}
                <div className="hd-regime-strip">
                    {regimeCards.map((r) => {
                        const cls = r.value > 0.3 ? 'hd-regime--positive' : r.value < -0.3 ? 'hd-regime--negative' : 'hd-regime--neutral';
                        return (
                            <div className={`hd-regime-card ${cls}`} key={r.label}>
                                <span className="hd-regime-card__label">{r.label}</span>
                                <strong className="hd-regime-card__value">{r.value > 0 ? '+' : ''}{r.value.toFixed(2)}</strong>
                                <span className="hd-regime-card__desc">{r.desc}</span>
                            </div>
                        );
                    })}
                </div>

                <div className="qe-market-grid">
                    {/* Left Column: Top Movers + Laggards */}
                    <div className="qe-market-col-left">
                        <div className="qe-market-card">
                            <div className="qe-market-card__title">Leaders</div>
                            {topMovers.map((m) => (
                                <button className="qe-market-row qe-market-row--btn" key={m.symbol} onClick={() => handlers.handlePromptSubmit(`$${m.symbol}`)}>
                                    <span>{m.symbol}</span>
                                    <span className="qe-text-up">+{Number(m.changePct || 0).toFixed(2)}%</span>
                                </button>
                            ))}
                            {!topMovers.length && <div className="qe-empty">No movers yet</div>}
                        </div>
                        <div className="qe-market-card">
                            <div className="qe-market-card__title">Laggards</div>
                            {bottomMovers.map((m) => (
                                <button className="qe-market-row qe-market-row--btn" key={m.symbol} onClick={() => handlers.handlePromptSubmit(`$${m.symbol}`)}>
                                    <span>{m.symbol}</span>
                                    <span className="qe-text-down">{Number(m.changePct || 0).toFixed(2)}%</span>
                                </button>
                            ))}
                            {!bottomMovers.length && <div className="qe-empty">No laggards yet</div>}
                        </div>
                    </div>

                    {/* Center: Macro Proxy Chart + Major Cards */}
                    <div className="qe-market-col-main">
                        <div className="qe-market-card qe-market-card--chart">
                            <div className="qe-market-card__title">
                                Macro Proxy Performance
                                {state.homeMacro?.ok && <span className="hd-source-badge">Live</span>}
                            </div>
                            <ResponsiveContainer width="100%" height={250}>
                                <LineChart data={chartData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--qe-chart-grid)" />
                                    <XAxis dataKey="m" tick={{ fill: 'var(--qe-faint)', fontSize: 11 }} />
                                    <YAxis tick={{ fill: 'var(--qe-faint)', fontSize: 11 }} />
                                    <ReTooltip />
                                    <Legend />
                                    <Line type="monotone" dataKey="Risk (SPY)" stroke="#60a5fa" strokeWidth={2} dot={false} />
                                    <Line type="monotone" dataKey="Rates (TLT)" stroke="#f59e0b" strokeWidth={2} dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="qe-market-mini-cards">
                            {majorCards.map((c) => (
                                <button key={c.symbol} className="qe-market-mini" onClick={() => handlers.handlePromptSubmit(`$${c.symbol}`)}>
                                    <div className="qe-market-mini__sym">{c.symbol}</div>
                                    <div className="qe-market-mini__val">{c.currencySymbol}{Number(c.price || 0).toLocaleString()}</div>
                                    <div className={Number(c.changePct || 0) >= 0 ? 'qe-text-up' : 'qe-text-down'}>
                                        {Number(c.changePct || 0).toFixed(2)}%
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Right Column: Sentiment + Macro Proxies */}
                    <div className="qe-market-col-right">
                        <div className="qe-market-card">
                            <div className="qe-market-card__title">Market Breadth</div>
                            <div className="qe-sentiment-ring">
                                <ResponsiveContainer width="100%" height={180}>
                                    <PieChart>
                                        <Pie
                                            data={[
                                                { name: 'Bullish', value: bullishPct },
                                                { name: 'Other', value: Math.max(0, 100 - bullishPct) },
                                            ]}
                                            dataKey="value"
                                            innerRadius={48}
                                            outerRadius={70}
                                        >
                                            <Cell fill="#22c55e" />
                                            <Cell fill="rgba(148,163,184,0.25)" />
                                        </Pie>
                                        <ReTooltip />
                                    </PieChart>
                                </ResponsiveContainer>
                                <div className="qe-sentiment-label">
                                    <strong>{bullishPct}%</strong>
                                    <span>{bullishPct >= 55 ? 'Bullish' : bullishPct <= 45 ? 'Bearish' : 'Neutral'}</span>
                                </div>
                            </div>
                        </div>
                        <div className="qe-market-card">
                            <div className="qe-market-card__title">Macro Proxies</div>
                            {macroRows.map((r) => (
                                <div className="qe-market-row" key={r.label}>
                                    <span className="hd-macro-sym">{r.symbol}</span>
                                    <span>{r.value ? r.value.toFixed(2) : 'N/A'}</span>
                                    <span className={r.chg >= 0 ? 'qe-text-up' : 'qe-text-down'}>
                                        {r.chg >= 0 ? '+' : ''}{r.chg.toFixed(2)}%
                                    </span>
                                </div>
                            ))}
                            {macroRows[0]?.source === 'pending' && <div className="qe-empty" style={{ fontSize: 11, marginTop: 4 }}>Refresh to load macro data</div>}
                        </div>
                    </div>
                </div>
            </section>

            {/* === Watchlist + Portfolio Summary === */}
            <section className="qe-home-grid">
                <div className="qe-home-panel hd-panel--watchlist">
                    <div className="qe-section-head"><h2>Watchlist</h2></div>
                    {watchSymbols.length > 0 ? (
                        <>
                            <div className="hd-panel-kpi-row">
                                <div className="hd-panel-kpi"><strong>{watchSymbols.length}</strong><span>Symbols</span></div>
                                <div className="hd-panel-kpi"><strong>{watchRows.filter(r => r.headline && r.headline !== '-').length}</strong><span>With news</span></div>
                            </div>
                            <div className="hd-symbol-chips">
                                {watchSymbols.slice(0, 12).map((sym) => (
                                    <button key={sym} className="hd-chip" onClick={() => handlers.handlePromptSubmit(`$${sym}`)}>{sym}</button>
                                ))}
                                {watchSymbols.length > 12 && <span className="hd-chip hd-chip--more">+{watchSymbols.length - 12} more</span>}
                            </div>
                            <button type="button" className="qe-btn qe-btn--small hd-panel-link" onClick={() => setState.setViewMode('screener')}>
                                Open Watchlist tab
                            </button>
                        </>
                    ) : (
                        <p className="qe-rail__muted">No symbols in watchlist yet. Add symbols from the Watchlist tab.</p>
                    )}
                </div>

                <div className="qe-home-panel hd-panel--portfolio">
                    <div className="qe-section-head"><h2>Portfolios</h2></div>
                    {portfolioNames.length > 0 ? (
                        <>
                            <div className="hd-panel-kpi-row">
                                <div className="hd-panel-kpi"><strong>{portfolioNames.length}</strong><span>Portfolios</span></div>
                                <div className="hd-panel-kpi"><strong>{totalHoldings}</strong><span>Holdings</span></div>
                                <div className="hd-panel-kpi">
                                    <strong>{state.selectedPortfolio || 'Main'}</strong>
                                    <span>Active</span>
                                </div>
                            </div>
                            {analytics && typeof analytics === 'object' && Object.keys(analytics).length > 0 && (
                                <div className="hd-analytics-summary">
                                    {analytics.total_value != null && (
                                        <div className="hd-analytics-row">
                                            <span>Total value</span>
                                            <strong>{Number(analytics.total_value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                                        </div>
                                    )}
                                    {analytics.total_invested != null && (
                                        <div className="hd-analytics-row">
                                            <span>Invested</span>
                                            <strong>{Number(analytics.total_invested || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                                        </div>
                                    )}
                                    {analytics.unrealized_pnl != null && (
                                        <div className="hd-analytics-row">
                                            <span>Unrealized P&L</span>
                                            <strong className={Number(analytics.unrealized_pnl || 0) >= 0 ? 'qe-text-up' : 'qe-text-down'}>
                                                {Number(analytics.unrealized_pnl || 0) >= 0 ? '+' : ''}{Number(analytics.unrealized_pnl || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </strong>
                                        </div>
                                    )}
                                </div>
                            )}
                            <div className="hd-portfolio-list">
                                {portfolioNames.slice(0, 5).map((name) => (
                                    <div key={name} className={`hd-portfolio-pill ${name === state.selectedPortfolio ? 'hd-portfolio-pill--active' : ''}`}>
                                        {name} <span className="hd-portfolio-pill__count">{(state.portfolios[name] || []).length}</span>
                                    </div>
                                ))}
                            </div>
                            <button type="button" className="qe-btn qe-btn--small hd-panel-link" onClick={() => { /* switch to portfolio module */ }}>
                                Open Portfolio tab
                            </button>
                        </>
                    ) : (
                        <p className="qe-rail__muted">No portfolios yet. Create one from the Portfolio tab.</p>
                    )}
                </div>
            </section>

            {/* === Data Operations === */}
            <section className="qe-home-maintenance">
                <div className="qe-home-panel">
                    <div className="qe-section-head">
                        <h2>Data operations</h2>
                    </div>
                    <p className="qe-rail__muted">
                        Use these only when you want a full reset of local caches/database and a clean redownload.
                    </p>
                    <div className="qe-home-actions">
                        <button
                            type="button"
                            className="qe-btn qe-btn--small qe-btn--danger"
                            disabled={state.maintenanceBusy}
                            onClick={() => handlers.nukeLocalData()}
                        >
                            {state.maintenanceBusy ? 'Working...' : 'Nuke local data'}
                        </button>
                        <button
                            type="button"
                            className="qe-btn qe-btn--small"
                            disabled={state.maintenanceBusy}
                            onClick={() => handlers.resetAndRedownloadAll()}
                        >
                            {state.maintenanceBusy ? 'Working...' : 'Reset + redownload all'}
                        </button>
                    </div>
                    {state.redownloadJob?.job_id && (
                        <div className="qe-home-job">
                            <p className="qe-home-job__meta">
                                Job {state.redownloadJob.job_id} · {state.redownloadJob.status}
                                {state.redownloadJob.current_symbol ? ` · ${state.redownloadJob.current_symbol}` : ''}
                            </p>
                            {state.redownloadJob.total > 0 && (
                                <>
                                    <div className="qe-progress" aria-hidden>
                                        <div
                                            className="qe-progress__bar"
                                            style={{
                                                width: `${Math.min(
                                                    100,
                                                    Math.round((100 * (state.redownloadJob.current || 0)) / state.redownloadJob.total)
                                                )}%`,
                                            }}
                                        />
                                    </div>
                                    <p className="qe-progress__meta">
                                        {state.redownloadJob.current || 0} / {state.redownloadJob.total}
                                    </p>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </section>

            {/* === Quick Access Grid === */}
            <section>
                <div className="qe-section-head">
                    <h2>Quick access</h2>
                </div>
                <div className="qe-grid">
                    {state.homeFocusList.map((row) => (
                        <button key={row.symbol} type="button" className="qe-tile" onClick={() => handlers.handlePromptSubmit(`$${row.symbol}`)}>
                            <span className="qe-tile__sym">{row.symbol}</span>
                            <span className={`qe-tile__action ${row.changePct >= 0 ? 'qe-text-up' : 'qe-text-down'}`}>
                                {row.changePct.toFixed(2)}%
                            </span>
                        </button>
                    ))}
                    {!state.homeFocusList.length && <div className="qe-empty">Loading symbols from market universe...</div>}
                </div>
            </section>
        </div>
    );
};

const TerminalPivotRail = ({ state, handlers }) => {
    if (!state.showPitchfork) return null;
    const list = state.detectedPivots;
    const n = list.length;
    return (
        <div className="qe-rail__block qe-pivot-block">
            <div className="qe-rail__head">
                LHL / HLH setups ({n})
                <span className="qe-pivot-hint">Full contain = all future highs/lows inside fork</span>
            </div>
            <div className="qe-pivot-cards">
                {state.mathCalculating ? (
                    <div className="qe-empty">Scanning pivots…</div>
                ) : n === 0 ? (
                    <div className="qe-empty">No 3-bar LHL or HLH pivots in this lookback.</div>
                ) : (
                    list.map((p, idx) => (
                        <button
                            type="button"
                            key={p.pivotKey}
                            className={`qe-pivot-card ${idx === state.activePivotIndex ? 'qe-pivot-card--active' : ''}`}
                            onClick={() => handlers.handlePivotClick(idx, list)}
                        >
                            <div className="qe-pivot-card__row">
                                <span className={`qe-pivot-type ${p.type === 'HLH' ? 'qe-pivot-type--hlh' : 'qe-pivot-type--lhl'}`}>
                                    {p.type}
                                </span>
                                {p.encompassesAllFutureOhlc ? (
                                    <span className="qe-pivot-badge qe-pivot-badge--full">
                                        {p.totalFutureBars >= 3 ? 'Full OHLC' : 'Full · short'}
                                    </span>
                                ) : p.closeContainedFullHistory ? (
                                    <span className="qe-pivot-badge qe-pivot-badge--close">Close only</span>
                                ) : (
                                    <span className="qe-pivot-badge qe-pivot-badge--broken">Broken</span>
                                )}
                            </div>
                            <div className="qe-pivot-card__date">{String(p.date).replace('T', ' ').slice(0, 16)}</div>
                            <div className="qe-pivot-card__meta">
                                {p.variation} · idx {p.dataIndex}
                                {p.encompassesAllFutureOhlc
                                    ? ` · ${p.totalFutureBars} bars inside · ${p.positionPct}% ${p.zoneLabel}`
                                    : ` · OHLC streak ${p.daysActive}/${p.totalFutureBars}`}
                            </div>
                        </button>
                    ))
                )}
            </div>
        </div>
    );
};

const FundamentalRibbon = ({ tickerDetails }) => {
    if (!tickerDetails) return null;
    return (
        <div className="qe-ribbon" role="region" aria-label="Fundamentals">
            <div className="qe-stat">
                <span className="qe-stat__label">Market cap</span>
                <span className="qe-stat__value">
                    {tickerDetails.currencySymbol}
                    {formatLargeNumber(tickerDetails.marketCap)}
                </span>
            </div>
            <div className="qe-stat">
                <span className="qe-stat__label">P/E</span>
                <span className="qe-stat__value">{tickerDetails.peRatio}</span>
            </div>
            <div className="qe-stat">
                <span className="qe-stat__label">52W high</span>
                <span className="qe-stat__value">
                    {tickerDetails.currencySymbol}
                    {tickerDetails.high52}
                </span>
            </div>
            <div className="qe-stat">
                <span className="qe-stat__label">52W low</span>
                <span className="qe-stat__value">
                    {tickerDetails.currencySymbol}
                    {tickerDetails.low52}
                </span>
            </div>
        </div>
    );
};

const ChartWorkspace = ({ state, handlers, setState }) => {
    const [showKeyEvents, setShowKeyEvents] = useState(true);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [chartStyle, setChartStyle] = useState('mountain');
    const tfMap = {
        '1D': '1D',
        '5D': '7D',
        '1M': '1M',
        '6M': '6M',
        'YTD': '1Y',
        '1Y': '1Y',
        '5Y': '5Y',
        'All': 'MAX',
    };
    const safeOhlcData = useMemo(
        () =>
            (state.ohlcData || [])
                .filter(
                    (d) =>
                        d &&
                        d.x != null &&
                        Array.isArray(d.y) &&
                        d.y.length >= 4 &&
                        d.y.slice(0, 4).every((v) => Number.isFinite(Number(v)))
                )
                .map((d) => ({
                    ...d,
                    y: [
                        Number(d.y[0]),
                        Number(d.y[1]),
                        Number(d.y[2]),
                        Number(d.y[3]),
                    ],
                    volume: Number.isFinite(Number(d.volume)) ? Number(d.volume) : 0,
                })),
        [state.ohlcData]
    );

    const keyEventPoints = useMemo(() => {
        if (!showKeyEvents || safeOhlcData.length < 6) return [];
        const points = [];
        const last = safeOhlcData[safeOhlcData.length - 1];
        points.push({
            x: new Date(last.x).getTime(),
            y: last.y[3],
            marker: { size: 5, fillColor: '#0ea5a4', strokeColor: '#0ea5a4' },
            label: { text: 'Now', style: { background: '#0ea5a4', color: '#fff' } },
        });
        const moves = safeOhlcData
            .map((d) => ({ x: new Date(d.x).getTime(), y: d.y[3], move: Math.abs((d.y[3] - d.y[0]) / Math.max(1e-6, d.y[0])) }))
            .sort((a, b) => b.move - a.move)
            .slice(0, 2);
        moves.forEach((m, idx) =>
            points.push({
                x: m.x,
                y: m.y,
                marker: { size: 4, fillColor: '#f59e0b', strokeColor: '#f59e0b' },
                label: { text: idx === 0 ? 'Event A' : 'Event B', style: { background: '#f59e0b', color: '#111' } },
            })
        );
        return points;
    }, [safeOhlcData, showKeyEvents]);
    const formatHoverValue = (value, digits = 2) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return '-';
        return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    };
    const setSelectedFromIndex = (idx) => {
        if (!Number.isInteger(idx) || idx < 0 || idx >= safeOhlcData.length) return;
        const d = safeOhlcData[idx];
        handlers.setSelectedCandle({
            x: d.x,
            open: Number(d.y?.[0] ?? 0),
            high: Number(d.y?.[1] ?? 0),
            low: Number(d.y?.[2] ?? 0),
            close: Number(d.y?.[3] ?? 0),
            volume: Number(d.volume ?? 0),
        });
    };

    // Generate Chart Data Dynamically
    let terminalSeries = [];
    if (chartStyle === 'candle') {
        terminalSeries.push({ name: 'Price', type: 'candlestick', data: safeOhlcData });
    } else if (chartStyle === 'line') {
        terminalSeries.push({ name: 'Close', type: 'line', data: safeOhlcData.map(d => ({ x: d.x, y: d.y[3] })) });
    } else if (chartStyle === 'mixed') {
        terminalSeries.push({ name: 'Price', type: 'candlestick', data: safeOhlcData });
        terminalSeries.push({ name: 'Mountain', type: 'area', data: safeOhlcData.map(d => ({ x: d.x, y: d.y[3] })) });
    } else {
        terminalSeries.push({ name: 'Close', type: 'area', data: safeOhlcData.map(d => ({ x: d.x, y: d.y[3] })) });
    }
    
    if (state.showVolume) terminalSeries.push({ name: 'Volume', type: 'area', data: safeOhlcData.map(d => ({ x: d.x, y: Number.isFinite(Number(d.volume)) ? Number(d.volume) : 0 })) });
    if (state.showEMA20) terminalSeries.push({ name: 'EMA 20', type: 'line', data: calculateEMA(safeOhlcData, 20) });
    if (state.showSMA50) terminalSeries.push({ name: 'SMA 50', type: 'line', data: calculateSMA(safeOhlcData, 50) });
    if (state.showSMA200) terminalSeries.push({ name: 'SMA 200', type: 'line', data: calculateSMA(safeOhlcData, 200) });
    if (state.showPitchfork && state.hasScannedPitchforks && state.detectedPivots[state.activePivotIndex] && safeOhlcData.length > 0) {
        const p = state.detectedPivots[state.activePivotIndex];
        const rebuilt = buildPitchforkAtIndex(safeOhlcData, p.dataIndex, p.variation);
        if (rebuilt?.series?.length) terminalSeries.push(...rebuilt.series);
    }
  
    const terminalYAxis = []; const strokeWidths = []; const dashArrays = []; let hasPrimaryAxis = false;
  
    terminalSeries.forEach(s => {
        if (s.name === 'Price' || s.name === 'Close' || s.name === 'Mountain') { 
            if (!hasPrimaryAxis) { terminalYAxis.push({ seriesName: 'Price', opposite: true, show: true, labels: { style: { colors: '#8b909a' } } }); hasPrimaryAxis = true; } 
            else { terminalYAxis.push({ seriesName: 'Price', show: false }); }
            strokeWidths.push(s.type === 'line' || s.type === 'area' ? 2 : 1); dashArrays.push(0); 
        }
        else if (s.name === 'Volume') { terminalYAxis.push({ seriesName: 'Volume', opposite: false, show: false, max: (max) => max * 5 }); strokeWidths.push(1); dashArrays.push(0); }
        else if (s.name.includes('MA')) { terminalYAxis.push({ seriesName: 'Price', show: false }); strokeWidths.push(2); dashArrays.push(0); }
        else if (s.name.includes('PF')) {
            terminalYAxis.push({ seriesName: 'Price', show: false });
            if (s.name === 'PF Zone') { strokeWidths.push(0); dashArrays.push(0); }
            else if (s.name === 'PF Chord') { strokeWidths.push(2); dashArrays.push(0); }
            else if (s.name === 'PF Median') { strokeWidths.push(1.5); dashArrays.push(8); }
            else { strokeWidths.push(1); dashArrays.push(0); }
        } else {
            // Fallback: keep any unknown overlay mapped to the primary price axis.
            terminalYAxis.push({ seriesName: 'Price', show: false });
            strokeWidths.push(2);
            dashArrays.push(0);
        }
    });
  
    const terminalChartOptions = {
      chart: {
        type: 'line',
        background: 'transparent',
        toolbar: { show: true, tools: { download: false, selection: true, zoom: true, zoomin: true, zoomout: true, pan: true, reset: true } },
        zoom: { enabled: true, type: 'x', autoScaleYaxis: true },
        selection: { enabled: true, type: 'x' },
        animations: { enabled: false },
        events: {
          dataPointSelection: (_event, _chartContext, config) => {
            setSelectedFromIndex(config?.dataPointIndex);
          },
          dataPointMouseEnter: (_event, _chartContext, config) => {
            setSelectedFromIndex(config?.dataPointIndex);
          },
        },
      },
      dataLabels: { enabled: false },
      colors: ['#0f766e', '#9ca3af', '#5c616b', '#c084fc', '#fbbf24', '#a8a29e', '#f0d875', '#4ade80', '#f87171', '#60a5fa'],
      plotOptions: {
        candlestick: {
          colors: {
            upward: '#22c55e',
            downward: '#ef4444',
          },
        },
      },
      xaxis: {
        type: 'datetime',
        min: state.chartZoom.min,
        max: state.chartZoom.max,
        labels: { style: { colors: '#8b909a' } },
        crosshairs: { show: true },
      },
      yaxis: terminalYAxis,
      annotations: { points: keyEventPoints },
      fill: {
        type: terminalSeries.map((s) => (s.type === 'area' ? 'gradient' : 'solid')),
        opacity: terminalSeries.map((s) => (s.name === 'PF Zone' ? 0.16 : 1)),
        gradient: { shadeIntensity: 0.25, opacityFrom: 0.3, opacityTo: 0.02, stops: [0, 100] },
      },
      grid: { borderColor: 'rgba(255,255,255,0.06)' },
      stroke: { width: strokeWidths, dashArray: dashArrays, curve: 'straight' },
      tooltip: {
        shared: true,
        intersect: false,
        theme: chartUsesLightPalette(state.theme) ? 'light' : 'dark',
        custom: ({ dataPointIndex }) => {
            if (!Number.isInteger(dataPointIndex) || dataPointIndex < 0 || dataPointIndex >= safeOhlcData.length) return '';
            const d = safeOhlcData[dataPointIndex];
            const [o, h, l, c] = d.y || [0, 0, 0, 0];
            return `
                <div class="qe-chart-tooltip">
                    <div class="qe-chart-tooltip__time">${new Date(d.x).toLocaleString()}</div>
                    <div class="qe-chart-tooltip__row"><span>Open</span><strong>${formatHoverValue(o)}</strong></div>
                    <div class="qe-chart-tooltip__row"><span>High</span><strong>${formatHoverValue(h)}</strong></div>
                    <div class="qe-chart-tooltip__row"><span>Low</span><strong>${formatHoverValue(l)}</strong></div>
                    <div class="qe-chart-tooltip__row"><span>Close</span><strong>${formatHoverValue(c)}</strong></div>
                    <div class="qe-chart-tooltip__row"><span>Volume Trades</span><strong>${Math.round(Number(d.volume || 0)).toLocaleString()}</strong></div>
                </div>
            `;
        },
      },
      legend: { show: false },
    };

    return (
        <div className="qe-chart-shell">
            {state.chartLoading || state.mathCalculating ? (
                <div className="qe-loader">Loading series…</div>
            ) : safeOhlcData.length > 0 ? (
                <div className="qe-chart-inner">
                    <div className="qe-chart-controls">
                        <div className="qe-timechips">
                            {Object.keys(tfMap).map((lbl) => (
                                <button
                                    key={lbl}
                                    type="button"
                                    className={`qe-chip-btn ${state.currentTimeframe === tfMap[lbl] ? 'qe-chip-btn--on' : ''}`}
                                    onClick={() => handlers.openTerminal(state.selectedTicker, tfMap[lbl])}
                                >
                                    {lbl}
                                </button>
                            ))}
                        </div>
                        <div className="qe-chart-actions">
                            <label className="qe-toggle">
                                <input type="checkbox" checked={showKeyEvents} onChange={(e) => setShowKeyEvents(e.target.checked)} />
                                <span>Key Events</span>
                            </label>
                            <select className="qe-select-inline" value={chartStyle} onChange={(e) => setChartStyle(e.target.value)}>
                                <option value="mountain">Mountain</option>
                                <option value="mixed">Hybrid</option>
                                <option value="line">Line</option>
                                <option value="candle">Candles</option>
                            </select>
                            <button type="button" className={`qe-btn qe-btn--small ${showAdvanced ? 'qe-btn--on' : ''}`} onClick={() => setShowAdvanced((v) => !v)}>
                                Advanced Chart
                            </button>
                            <button type="button" className={`qe-btn qe-btn--small ${state.showPitchfork ? 'qe-btn--on' : ''}`} onClick={() => setState.setShowPitchfork(!state.showPitchfork)}>
                                Fork
                            </button>
                            <button type="button" className="qe-btn qe-btn--small" disabled={state.isScreening} onClick={() => handlers.findForkInAll()}>
                                {state.isScreening ? 'Scanning...' : 'Scan Entire Universe'}
                            </button>
                        </div>
                    </div>
                    {showAdvanced && (
                        <div className="qe-chart-advanced">
                            <button type="button" className={`qe-chip-btn ${state.showVolume ? 'qe-chip-btn--on' : ''}`} onClick={() => setState.setShowVolume(!state.showVolume)}>Volume</button>
                            <button type="button" className={`qe-chip-btn ${state.showEMA20 ? 'qe-chip-btn--on' : ''}`} onClick={() => setState.setShowEMA20(!state.showEMA20)}>EMA20</button>
                            <button type="button" className={`qe-chip-btn ${state.showSMA50 ? 'qe-chip-btn--on' : ''}`} onClick={() => setState.setShowSMA50(!state.showSMA50)}>SMA50</button>
                            <button type="button" className={`qe-chip-btn ${state.showSMA200 ? 'qe-chip-btn--on' : ''}`} onClick={() => setState.setShowSMA200(!state.showSMA200)}>SMA200</button>
                        </div>
                    )}
                    <div className="qe-home-list" style={{ marginTop: '0.5rem' }}>
                        <div className="qe-home-row qe-home-row--headline">
                            <span className="qe-home-row__headline">Fork scanner</span>
                            {state.isScreening ? (
                                <span className="qe-home-row__price">
                                    {Math.round((state.screenerProgress.current / Math.max(1, state.screenerProgress.total)) * 100)}%
                                </span>
                            ) : null}
                        </div>
                        {state.isScreening ? (
                            <div className="qe-list-item">
                                Scanning {state.screenerProgress.symbol || '...'} ({state.screenerProgress.current}/{state.screenerProgress.total})
                            </div>
                        ) : state.screenerResults.length ? (
                            state.screenerResults.slice(0, 8).map((r) => (
                                <button
                                    key={r.symbol}
                                    type="button"
                                    className="qe-list-item"
                                    onClick={() => handlers.openTerminal(r.symbol, state.currentTimeframe || '1Y', false)}
                                >
                                    <span>{r.symbol}</span>
                                    <span className="qe-home-row__price">{(r.fork?.nearnessScore ?? 0).toFixed(3)}</span>
                                </button>
                            ))
                        ) : (
                            <div className="qe-list-item">Use "Scan Entire Universe" to locate active pitchfork setups.</div>
                        )}
                    </div>
                    {state.chartZoom.min != null && (
                        <button type="button" className="qe-btn qe-reset-zoom" onClick={handlers.resetZoom}>
                            Reset zoom
                        </button>
                    )}
                    <Chart options={terminalChartOptions} series={terminalSeries} type="line" height="100%" width="100%" />
                    {state.selectedCandle && (
                        <div className="qe-candle-inspector">
                            <span>{new Date(state.selectedCandle.x).toLocaleString()}</span>
                            <span>O {state.selectedCandle.open.toFixed(2)}</span>
                            <span>H {state.selectedCandle.high.toFixed(2)}</span>
                            <span>L {state.selectedCandle.low.toFixed(2)}</span>
                            <span>C {state.selectedCandle.close.toFixed(2)}</span>
                            <span>V {Math.round(state.selectedCandle.volume).toLocaleString()}</span>
                        </div>
                    )}
                </div>
            ) : (
                <div className="qe-chart-error">No historical data for this symbol and range.</div>
            )}
        </div>
    );
};

const ForkChartThumb = ({ symbol }) => {
    const [data, setData] = useState([]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`${API_BASE}/api/ticker/${encodeURIComponent(symbol)}/ohlc?timeframe=5Y`);
                const raw = await res.json();
                if (!cancelled) {
                    const rows = (raw || [])
                        .map((d) => Number(d?.y?.[3]))
                        .filter((v) => Number.isFinite(v));
                    setData(rows.slice(-160));
                }
            } catch {
                if (!cancelled) setData([]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [symbol]);

    if (!data.length) {
        return (
            <div
                style={{
                    width: 170,
                    height: 68,
                    borderRadius: 8,
                    background: 'rgba(148,163,184,0.14)',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 11,
                    color: '#8b909a',
                }}
            >
                Loading...
            </div>
        );
    }

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = Math.max(1e-9, max - min);
    const w = 170;
    const h = 68;
    const pad = 6;
    const points = data
        .map((v, i) => {
            const x = pad + (i / Math.max(1, data.length - 1)) * (w - pad * 2);
            const y = h - pad - ((v - min) / range) * (h - pad * 2);
            return `${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(' ');
    const areaPoints = `${pad},${h - pad} ${points} ${w - pad},${h - pad}`;

    return (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${symbol} fork chart thumbnail`}>
            <defs>
                <linearGradient id={`forkThumb_${symbol}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d4af37" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#d4af37" stopOpacity="0.04" />
                </linearGradient>
            </defs>
            <rect x="0" y="0" width={w} height={h} rx="8" fill="rgba(15,23,42,0.35)" />
            <polygon points={areaPoints} fill={`url(#forkThumb_${symbol})`} />
            <polyline points={points} fill="none" stroke="#f0d875" strokeWidth="1.6" />
        </svg>
    );
};

// =========================================================================
// 4. MAIN APP COMPONENT
// =========================================================================

function App() {
    const { state, setState, handlers } = useQuantEngine();
    // Keep legacy modules referenced while new shell is active.
    const legacyRefs = [calculateMaxPain, AIChatSidebar, TopNavigation, TerminalPivotRail];
    void legacyRefs;
    const [module, setModule] = useState('dashboard');
    const [alertForm, setAlertForm] = useState({ symbol: '', condition: 'Price >', value: '' });
    const [alerts, setAlerts] = useState([]);
    const [assetSnapshots, setAssetSnapshots] = useState({});
    const [assetLoadState, setAssetLoadState] = useState({ phase: 'idle', loaded: 0, total: 0, current: '' });
    const [assetIndustryFilter, setAssetIndustryFilter] = useState('All');
    const [assetGroupMode, setAssetGroupMode] = useState('category');
    const [assetVisibleSections, setAssetVisibleSections] = useState({});
    const [universeDetailSymbol, setUniverseDetailSymbol] = useState(null);
    const [universeDetailData, setUniverseDetailData] = useState(null);
    const [universeDetailWiki, setUniverseDetailWiki] = useState(null);
    const deepLinkConsumed = useRef(false);

    // Lab state
    const [labTab, setLabTab] = useState('insights'); // insights | models | research | papers
    const [labInsights, setLabInsights] = useState([]);
    const [labModels, setLabModels] = useState([]);
    const [labSavedPapers, setLabSavedPapers] = useState([]);
    const [labLoading, setLabLoading] = useState(false);
    const [labResult, setLabResult] = useState(null);
    const [labInsightForm, setLabInsightForm] = useState({ name: '', description: '', formula: '', symbols: '', params: '{}' });
    const [labModelParams, setLabModelParams] = useState('{}');
    const [labSelectedModel, setLabSelectedModel] = useState('');
    const [labResearchQuery, setLabResearchQuery] = useState('');
    const [labPaperQuery, setLabPaperQuery] = useState('');
    const [labPaperResults, setLabPaperResults] = useState([]);
    const [labResearchResults, setLabResearchResults] = useState([]);

    const indexCategories = useMemo(() => {
        const result = [];
        Object.keys(state.tickersData).forEach((cat) => {
            const filtered = state.tickersData[cat].filter((t) => t.toUpperCase().includes(state.searchTerm));
            if (filtered.length > 0) result.push({ cat, filtered });
        });
        return result;
    }, [state.tickersData, state.searchTerm]);

    useEffect(() => {
        try {
            const raw = localStorage.getItem('qe_alerts_v1');
            if (raw) setAlerts(JSON.parse(raw));
        } catch {
            setAlerts([]);
        }
    }, []);
    useEffect(() => {
        localStorage.setItem('qe_alerts_v1', JSON.stringify(alerts));
    }, [alerts]);

    const visibleAssetSymbols = useMemo(() => {
        // Only fetch data for symbols currently visible in expanded sections
        const syms = [];
        for (const { cat, filtered } of indexCategories) {
            const limit = assetVisibleSections[state.categoryLabelMap?.[cat] || cat.replace(/_/g, ' ')] || 48;
            syms.push(...filtered.slice(0, limit));
        }
        return syms.slice(0, 600);
    }, [indexCategories, assetVisibleSections, state.categoryLabelMap]);

    useEffect(() => {
        setAssetVisibleSections({});
    }, [state.searchTerm, assetIndustryFilter, assetGroupMode]);

    useEffect(() => {
        if (module !== 'assets') return undefined;
        if (!visibleAssetSymbols.length) {
            setAssetLoadState({ phase: 'idle', loaded: 0, total: 0, current: '' });
            return undefined;
        }

        let cancelled = false;
        (async () => {
            const missing = visibleAssetSymbols.filter((s) => !assetSnapshots[s]);
            if (!missing.length) {
                setAssetLoadState({
                    phase: 'complete',
                    loaded: visibleAssetSymbols.length,
                    total: visibleAssetSymbols.length,
                    current: '',
                });
                return;
            }
            const now = new Date().toISOString();
            const batchSize = 20;
            let completed = 0;
            setAssetLoadState({ phase: 'loading', loaded: 0, total: missing.length, current: missing[0] || '' });
            for (let i = 0; i < missing.length; i += batchSize) {
                const batch = missing.slice(i, i + batchSize);
                const results = await Promise.all(
                    batch.map(async (sym) => {
                        try {
                            const r = await fetch(`${API_BASE}/api/ticker/${encodeURIComponent(sym)}`);
                            const d = await r.json();
                            if (d && !d.error) {
                                return [
                                    sym,
                                    {
                                        name: d.longName || d.name || sym,
                                        price: d.price,
                                        currencySymbol: d.currencySymbol || '$',
                                        changePct: Number(d.changePct || 0),
                                        industry: d.industry || d.assetFamily || d.categoryLabel || 'Unknown',
                                        sector: d.sector || 'Unknown',
                                        assetFamily: d.assetFamily || '',
                                        categoryLabel: d.categoryLabel || '',
                                        marketRegion: d.marketRegion || '',
                                        marketExchange: d.marketExchange || '',
                                        isProxy: Boolean(d.isProxy),
                                        updatedAt: now,
                                    },
                                ];
                            }
                        } catch (e) {
                            console.error(e);
                        }
                        return [
                            sym,
                            {
                                name: sym,
                                price: null,
                                currencySymbol: '$',
                                changePct: 0,
                                industry: 'Unknown',
                                sector: 'Unknown',
                                assetFamily: '',
                                categoryLabel: '',
                                marketRegion: '',
                                marketExchange: '',
                                isProxy: false,
                                updatedAt: now,
                            },
                        ];
                    })
                );
                if (cancelled) return;
                completed += batch.length;
                setAssetSnapshots((prev) => {
                    const next = { ...prev };
                    results.forEach(([k, v]) => {
                        next[k] = v;
                    });
                    return next;
                });
                setAssetLoadState({
                    phase: completed >= missing.length ? 'complete' : 'loading',
                    loaded: completed,
                    total: missing.length,
                    current: missing[Math.min(i + batchSize, missing.length - 1)] || '',
                });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [module, visibleAssetSymbols, assetSnapshots]);


    const assetIndustryOptions = useMemo(() => {
        const symbols = indexCategories.flatMap(({ filtered }) => filtered);
        const vals = new Set(['All']);
        symbols.forEach((s) => vals.add(assetSnapshots[s]?.industry || 'Unknown'));
        return Array.from(vals);
    }, [indexCategories, assetSnapshots]);

    const filteredAssetSections = useMemo(() => {
        const filterIndustry = assetIndustryFilter;
        if (assetGroupMode === 'industry') {
            const grouped = {};
            indexCategories.forEach(({ filtered }) => {
                filtered.forEach((s) => {
                    const ind = assetSnapshots[s]?.industry || 'Unknown';
                    if (filterIndustry !== 'All' && ind !== filterIndustry) return;
                    if (!grouped[ind]) grouped[ind] = [];
                    grouped[ind].push(s);
                });
            });
            return Object.keys(grouped)
                .sort()
                .map((industry) => ({ label: industry, symbols: grouped[industry] }));
        }
        return indexCategories
            .map(({ cat, filtered }) => {
                const syms = filtered.filter((s) => {
                    const ind = assetSnapshots[s]?.industry || 'Unknown';
                    return filterIndustry === 'All' ? true : ind === filterIndustry;
                });
                return { label: state.categoryLabelMap?.[cat] || cat.replace(/_/g, ' '), symbols: syms };
            })
            .filter((x) => x.symbols.length > 0);
    }, [indexCategories, assetSnapshots, assetIndustryFilter, assetGroupMode, state.categoryLabelMap]);

    const assetOverview = useMemo(() => {
        const symbols = filteredAssetSections.flatMap(({ symbols: rows }) => rows);
        const loadedRows = symbols.map((s) => assetSnapshots[s]).filter(Boolean);
        const rising = loadedRows.filter((row) => Number(row?.changePct || 0) >= 0).length;
        const proxyCount = loadedRows.filter((row) => row?.isProxy).length;
        const families = new Set(loadedRows.map((row) => row?.assetFamily).filter(Boolean));
        return {
            visible: symbols.length,
            loaded: loadedRows.length,
            rising,
            falling: Math.max(0, loadedRows.length - rising),
            proxyCount,
            familyCount: families.size,
        };
    }, [filteredAssetSections, assetSnapshots]);

    // ── Lab handlers ──
    const labApi = state.localLlmBaseUrl ? state.localLlmBaseUrl.replace(':11434', ':8000') : 'http://127.0.0.1:8000';

    const loadLabInsights = async () => {
        try {
            const r = await fetch(`${labApi}/api/lab/insights`);
            const d = await r.json();
            if (d.ok) setLabInsights(d.insights || []);
        } catch { /* api unavailable */ }
    };
    const loadLabModels = async () => {
        try {
            const r = await fetch(`${labApi}/api/lab/models`);
            const d = await r.json();
            if (d.ok) setLabModels(d.models || []);
        } catch { /* api unavailable */ }
    };
    const loadLabSavedPapers = async () => {
        try {
            const r = await fetch(`${labApi}/api/lab/papers/saved`);
            const d = await r.json();
            if (d.ok) setLabSavedPapers(d.papers || []);
        } catch { /* api unavailable */ }
    };
    const labCreateInsight = async () => {
        setLabLoading(true);
        try {
            const syms = labInsightForm.symbols.split(',').map(s => s.trim()).filter(Boolean);
            let params = {};
            try { params = JSON.parse(labInsightForm.params); } catch { params = {}; }
            const r = await fetch(`${labApi}/api/lab/insights`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: labInsightForm.name, description: labInsightForm.description, formula: labInsightForm.formula, symbols: syms, params }),
            });
            const d = await r.json();
            setLabResult(d);
            loadLabInsights();
        } catch (e) { setLabResult({ ok: false, error: String(e) }); }
        setLabLoading(false);
    };
    const labRunInsight = async (insightId, symbol) => {
        setLabLoading(true);
        try {
            const r = await fetch(`${labApi}/api/lab/insights/${insightId}/run`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol }),
            });
            setLabResult(await r.json());
        } catch (e) { setLabResult({ ok: false, error: String(e) }); }
        setLabLoading(false);
    };
    const labDeleteInsight = async (insightId) => {
        try {
            await fetch(`${labApi}/api/lab/insights/${insightId}`, { method: 'DELETE' });
            loadLabInsights();
        } catch { /* */ }
    };
    const labRunModel = async () => {
        setLabLoading(true);
        try {
            let params = {};
            try { params = JSON.parse(labModelParams); } catch { params = {}; }
            const r = await fetch(`${labApi}/api/lab/models/run`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_name: labSelectedModel, params }),
            });
            setLabResult(await r.json());
        } catch (e) { setLabResult({ ok: false, error: String(e) }); }
        setLabLoading(false);
    };
    const labResearchTopic = async () => {
        setLabLoading(true);
        try {
            const r = await fetch(`${labApi}/api/lab/research/topic`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: labResearchQuery, max_results: 10 }),
            });
            const d = await r.json();
            setLabResearchResults(d.results || []);
            setLabResult(d);
        } catch (e) { setLabResult({ ok: false, error: String(e) }); }
        setLabLoading(false);
    };
    const labSearchPapers = async () => {
        setLabLoading(true);
        try {
            const r = await fetch(`${labApi}/api/lab/papers/search`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: labPaperQuery, max_results: 8 }),
            });
            const d = await r.json();
            setLabPaperResults(d.results || d.papers || []);
            setLabResult(d);
        } catch (e) { setLabResult({ ok: false, error: String(e) }); }
        setLabLoading(false);
    };
    const labSavePaper = async (paperId) => {
        try {
            await fetch(`${labApi}/api/lab/papers/save`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paper_id: paperId }),
            });
            loadLabSavedPapers();
        } catch { /* */ }
    };
    const labSummarizePaper = async (paperId) => {
        setLabLoading(true);
        try {
            const r = await fetch(`${labApi}/api/lab/papers/${paperId}/summarize`, { method: 'POST' });
            setLabResult(await r.json());
        } catch (e) { setLabResult({ ok: false, error: String(e) }); }
        setLabLoading(false);
    };

    // Load lab data when switching to lab
    useEffect(() => {
        if (module === 'lab') {
            loadLabInsights();
            loadLabModels();
            loadLabSavedPapers();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [module]);

    const switchModule = (next) => {
        setModule(next);
        if (next !== 'assets') { setUniverseDetailSymbol(null); setUniverseDetailData(null); setUniverseDetailWiki(null); }
        if (next === 'dashboard') setState.setViewMode('home');
        if (next === 'portfolio') setState.setViewMode('home');
        if (next === 'watchlists') setState.setViewMode('home');
        if (next === 'assets') setState.setViewMode('index');
        if (next === 'analysis') setState.setViewMode('terminal');
        if (next === 'lab') setState.setViewMode('home');
        if (next === 'forks' || next === 'alerts' || next === 'settings') setState.setViewMode('home');
    };

    const openAnalysisSymbol = async (sym) => {
        await handlers.openTerminal(sym, '1Y');
        switchModule('analysis');
    };

    const openTickerDetail = async (sym) => {
        setUniverseDetailSymbol(sym);
        setUniverseDetailData(null);
        setUniverseDetailWiki(null);
        // Fetch ticker data + wiki profile in parallel
        try {
            const [tickerResp, wikiResp] = await Promise.all([
                fetch(`${API_BASE}/api/ticker/${encodeURIComponent(sym)}`).then(r => r.json()),
                fetch(`${API_BASE}/api/wiki/${encodeURIComponent(sym)}/full`).then(r => r.json()),
            ]);
            setUniverseDetailData(tickerResp);
            setUniverseDetailWiki(wikiResp?.profile || null);
        } catch (e) {
            console.error('Detail fetch error:', e);
        }
    };

    const closeTickerDetail = () => {
        setUniverseDetailSymbol(null);
        setUniverseDetailData(null);
        setUniverseDetailWiki(null);
    };

    useEffect(() => {
        if (deepLinkConsumed.current || state.loading) return;
        const params = new URLSearchParams(window.location.search);
        const symbol = (params.get('symbol') || '').trim().toUpperCase();
        const moduleParam = (params.get('module') || '').trim().toLowerCase();
        const forkMode = params.get('fork') === '1';
        if (!symbol && !moduleParam) return;
        deepLinkConsumed.current = true;
        if (moduleParam === 'forks') {
            setModule('forks');
            return;
        }
        if (symbol) {
            handlers.openTerminal(symbol, '1Y', forkMode);
            setModule('analysis');
        }
    }, [state.loading, handlers]);

    if (state.loading) {
        return <div className="qe-loader qe-loader--fullscreen">Initializing…</div>;
    }

    return (
        <div className="qe-app" data-theme={state.theme}>
            <div className="mw-layout">
                <aside className="mw-sidebar mw-sidebar--primary" aria-label="Main navigation">
                    <div className="mw-sidebar__brand">
                        <div className="mw-logo">MW</div>
                        <div>
                            <div className="mw-brand__title">Market Watcher</div>
                            <div className="mw-brand__sub">Multi-Asset Research Terminal</div>
                        </div>
                    </div>
                    <nav className="mw-sidebar__nav">
                        {[
                            ['dashboard', 'Overview'],
                            ['portfolio', 'Portfolio'],
                            ['watchlists', 'Watchlists'],
                            ['assets', 'Universe'],
                            ['analysis', 'Research'],
                            ['lab', 'Lab'],
                            ['forks', 'Pitchforks'],
                            ['alerts', 'Alerts'],
                            ['settings', 'Platform'],
                        ].map(([id, label]) => (
                            <button
                                key={id}
                                type="button"
                                className={`mw-sidebar__link ${module === id ? 'mw-sidebar__link--active' : ''}`}
                                onClick={() => switchModule(id)}
                            >
                                {label}
                            </button>
                        ))}
                    </nav>
                    <div className="mw-sidebar__footer">
                        <label className="mw-sidebar__label" htmlFor="mw-theme-select">
                            Theme
                        </label>
                        <select
                            id="mw-theme-select"
                            className="qe-select-inline mw-sidebar__theme"
                            value={state.theme}
                            onChange={(e) => handlers.setTheme(e.target.value)}
                        >
                            {state.themeOptions.map((o) => (
                                <option key={o.id} value={o.id}>
                                    {o.label}
                                </option>
                            ))}
                        </select>
                    </div>
                </aside>

                <div className="mw-main">
                    <div className="mw-shell mw-shell--main">
                {module === 'dashboard' && <HomeDashboard state={state} handlers={handlers} setState={setState} />}
                {module === 'portfolio' && <PortfolioDashboard state={state} handlers={handlers} openAnalysisSymbol={openAnalysisSymbol} />}
                {module === 'watchlists' && <WatchlistsDashboard state={state} handlers={handlers} />}

                {module === 'assets' && universeDetailSymbol && (
                    <div className="qe-content mw-content">
                        <TickerDetailPage
                            symbol={universeDetailSymbol}
                            tickerData={universeDetailData}
                            wikiData={universeDetailWiki}
                            nameMap={state.tickerNameMap}
                            onBack={closeTickerDetail}
                            onChart={(s) => { closeTickerDetail(); openAnalysisSymbol(s); }}
                            onWatch={(s) => { handlers.addSymbolToWatchlist?.(s) || handlers.addToWatchlist?.(s); }}
                        />
                    </div>
                )}

                {module === 'assets' && !universeDetailSymbol && (
                    <div className="qe-content mw-content">
                        <header className="qe-hero mw-universe-hero">
                            <p className="qe-hero__label">Universe</p>
                            <h1 className="qe-hero__title">Instrument Universe</h1>
                            <p className="qe-hero__sub">
                                Explore the expanded India forex, commodities, and futures coverage with async snapshot loading and grouped market views.
                            </p>
                            <input
                                className="qe-search"
                                placeholder="Search symbol…"
                                value={state.searchInput}
                                onChange={(e) => setState.setSearchInput(e.target.value)}
                            />
                            <div className="mw-universe-stats">
                                <div className="mw-universe-stat">
                                    <span>Visible</span>
                                    <strong>{assetOverview.visible}</strong>
                                </div>
                                <div className="mw-universe-stat">
                                    <span>Loaded</span>
                                    <strong>{assetOverview.loaded}</strong>
                                </div>
                                <div className="mw-universe-stat">
                                    <span>Asset families</span>
                                    <strong>{assetOverview.familyCount}</strong>
                                </div>
                                <div className="mw-universe-stat">
                                    <span>Proxy mapped</span>
                                    <strong>{assetOverview.proxyCount}</strong>
                                </div>
                            </div>
                            <div className="mw-universe-progress">
                                <div className="mw-universe-progress__row">
                                    <strong>
                                        {assetLoadState.phase === 'loading'
                                            ? `Loading ${assetLoadState.loaded}/${assetLoadState.total}`
                                            : assetLoadState.phase === 'complete'
                                                ? 'Snapshots loaded'
                                                : 'Snapshots idle'}
                                    </strong>
                                    <span>{assetLoadState.current || 'Ready'}</span>
                                </div>
                                <div className="mw-universe-progress__bar">
                                    <span
                                        style={{
                                            width: `${
                                                assetLoadState.total
                                                    ? Math.min(100, Math.round((assetLoadState.loaded / assetLoadState.total) * 100))
                                                    : 0
                                            }%`,
                                        }}
                                    />
                                </div>
                            </div>
                            <div className="mw-assets-controls mw-assets-controls--toolbar">
                                <div className="qe-input-group">
                                    <label className="qe-field-label">Industry filter</label>
                                    <select
                                        className="qe-select-inline"
                                        value={assetIndustryFilter}
                                        onChange={(e) => setAssetIndustryFilter(e.target.value)}
                                    >
                                        {assetIndustryOptions.map((o) => (
                                            <option key={o} value={o}>{o}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="qe-input-group">
                                    <label className="qe-field-label">Grouping</label>
                                    <div className="qe-home-actions">
                                        <button
                                            type="button"
                                            className={`qe-btn qe-btn--small ${assetGroupMode === 'category' ? 'qe-btn--on' : ''}`}
                                            onClick={() => setAssetGroupMode('category')}
                                        >
                                            By category
                                        </button>
                                        <button
                                            type="button"
                                            className={`qe-btn qe-btn--small ${assetGroupMode === 'industry' ? 'qe-btn--on' : ''}`}
                                            onClick={() => setAssetGroupMode('industry')}
                                        >
                                            By industry
                                        </button>
                                    </div>
                                </div>
                                <div className="qe-input-group">
                                    <label className="qe-field-label">Data</label>
                                    <div className="qe-home-actions">
                                        <button
                                            type="button"
                                            className="qe-btn qe-btn--small"
                                            disabled={assetLoadState.phase === 'loading'}
                                            onClick={() => {
                                                setAssetSnapshots({});
                                                setAssetLoadState({ phase: 'idle', loaded: 0, total: 0, current: '' });
                                            }}
                                        >
                                            {assetLoadState.phase === 'loading' ? 'Loading…' : 'Refresh Snapshots'}
                                        </button>
                                        <button
                                            type="button"
                                            className="qe-btn qe-btn--small"
                                            disabled={state.allDataJob?.status === 'queued' || state.allDataJob?.status === 'running'}
                                            onClick={() => handlers.downloadAllAndCalculateForks()}
                                        >
                                            {state.allDataJob?.status === 'queued' || state.allDataJob?.status === 'running'
                                                ? `Downloading ${state.allDataJob?.current || 0}/${state.allDataJob?.total || 0}…`
                                                : 'Download All OHLC'}
                                        </button>
                                        <button
                                            type="button"
                                            className="qe-btn qe-btn--small"
                                            disabled={state.allDataJob?.status === 'queued' || state.allDataJob?.status === 'running'}
                                            onClick={() => handlers.resetAndRedownloadAll()}
                                        >
                                            Reset + Redownload
                                        </button>
                                    </div>
                                </div>
                                <div className="qe-input-group">
                                    <label className="qe-field-label">Ticker Universe</label>
                                    <div className="qe-home-actions">
                                        <button
                                            type="button"
                                            className="qe-btn qe-btn--small qe-btn--accent"
                                            disabled={state.tickerRefreshJob?.status === 'running' || state.tickerRefreshJob?.status === 'queued'}
                                            onClick={() => handlers.refreshTickerUniverse()}
                                        >
                                            {state.tickerRefreshJob?.status === 'running'
                                                ? 'Fetching tickers…'
                                                : state.tickerRefreshJob?.status === 'queued'
                                                    ? 'Queued…'
                                                    : 'Refresh All Tickers'}
                                        </button>
                                        <button
                                            type="button"
                                            className="qe-btn qe-btn--small"
                                            onClick={() => handlers.downloadTickersJson()}
                                        >
                                            Download JSON
                                        </button>
                                        <button
                                            type="button"
                                            className="qe-btn qe-btn--small qe-btn--accent"
                                            disabled={state.nonEquityJob?.status === 'running' || state.nonEquityJob?.status === 'queued'}
                                            onClick={() => handlers.downloadNonEquityData()}
                                            title="Download OHLC data for commodities, forex, crypto, bonds, ETFs, indices — everything except equities"
                                        >
                                            {state.nonEquityJob?.status === 'running'
                                                ? `Non-Equity ${state.nonEquityJob.current || 0}/${state.nonEquityJob.total || '?'}…`
                                                : state.nonEquityJob?.status === 'queued'
                                                    ? 'Starting…'
                                                    : 'Download Non-Equity Data'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                            {(state.tickerRefreshJob || state.nonEquityJob) && (
                                <div className="mw-ticker-refresh-status">
                                    {state.tickerRefreshJob && (
                                        <div>
                                            <span className={`mw-refresh-badge mw-refresh-badge--${state.tickerRefreshJob.status}`}>
                                                {state.tickerRefreshJob.status === 'completed' ? 'Ticker refresh complete' :
                                                 state.tickerRefreshJob.status === 'failed' ? 'Ticker refresh failed' :
                                                 state.tickerRefreshJob.status === 'running' ? 'Fetching from NSE, BSE, Yahoo, AMFI…' :
                                                 'Starting ticker refresh…'}
                                            </span>
                                            {state.tickerRefreshJob.log && (
                                                <details className="mw-refresh-log">
                                                    <summary>Show log</summary>
                                                    <pre>{state.tickerRefreshJob.log}</pre>
                                                </details>
                                            )}
                                        </div>
                                    )}
                                    {state.nonEquityJob && (
                                        <div>
                                            <span className={`mw-refresh-badge mw-refresh-badge--${state.nonEquityJob.status}`}>
                                                {state.nonEquityJob.status === 'completed' ? 'Non-equity download complete' :
                                                 state.nonEquityJob.status === 'failed' ? 'Non-equity download failed' :
                                                 state.nonEquityJob.status === 'running'
                                                    ? `Downloading non-equity OHLC: ${state.nonEquityJob.current}/${state.nonEquityJob.total} — ${state.nonEquityJob.current_symbol}`
                                                    : 'Starting non-equity download…'}
                                            </span>
                                            {state.nonEquityJob.status === 'running' && state.nonEquityJob.total > 0 && (
                                                <div className="mw-universe-progress__bar" style={{ marginTop: 6 }}>
                                                    <span style={{ width: `${Math.min(100, Math.round((state.nonEquityJob.current / state.nonEquityJob.total) * 100))}%` }} />
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </header>
                        <div className="mw-universe-chipbar">
                            {filteredAssetSections.slice(0, 8).map(({ label, symbols }) => (
                                <button
                                    key={label}
                                    type="button"
                                    className="qe-chip-btn"
                                    onClick={() => setAssetVisibleSections((prev) => ({ ...prev, [label]: Math.max(prev[label] || 0, 24) }))}
                                >
                                    {label} ({symbols.length})
                                </button>
                            ))}
                        </div>
                        {!filteredAssetSections.length && !Object.keys(state.tickersData || {}).length && (
                            <div className="qe-panel mw-offline-panel">
                                <h3>Universe data unavailable</h3>
                                <p className="qe-rail__muted">
                                    Cannot reach backend at <code>{API_BASE}</code>. Start the API server first:
                                </p>
                                <pre className="mw-cmd-block">
{`cd ${window.location.hostname === 'localhost' ? '~/StockAnalysisProject' : '/path/to/StockAnalysisProject'}

# Option 1: Quick start (backend only)
bash run_backend.sh

# Option 2: Full stack (Ollama + Backend + Frontend)
bash start_terminal.sh

# Option 3: Manual
source .venv/bin/activate
uvicorn backend.app:app --reload --host 127.0.0.1 --port 8000`}
                                </pre>
                                <p className="qe-rail__muted" style={{ marginTop: 8 }}>
                                    Once backend is running, refresh this page. Make sure <code>all_global_tickers.json</code> exists
                                    (run <code>python3 fetch_all_tickers.py</code> if it doesn't).
                                </p>
                            </div>
                        )}
                        {!filteredAssetSections.length && Object.keys(state.tickersData || {}).length > 0 && (
                            <div className="qe-panel">
                                <h3>No instruments match the current filters</h3>
                                <p className="qe-rail__muted">Try a broader search term, switch grouping mode, or reset the industry filter.</p>
                            </div>
                        )}
                        {filteredAssetSections.map(({ label, symbols }) => (
                            <section key={label} className="mw-universe-section">
                                <div className="qe-section-head">
                                    <div className="mw-universe-section__title">
                                        <h2>{label}</h2>
                                        <span>{symbols.length} symbols</span>
                                    </div>
                                    <div className="mw-universe-section__actions">
                                        {symbols.length > (assetVisibleSections[label] || 48) && (
                                            <button
                                                type="button"
                                                className="qe-btn qe-btn--small"
                                                onClick={() =>
                                                    setAssetVisibleSections((prev) => ({
                                                        ...prev,
                                                        [label]: (prev[label] || 48) + 48,
                                                    }))
                                                }
                                            >
                                                Show more ({symbols.length - (assetVisibleSections[label] || 48)} remaining)
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="mw-assets-list">
                                    <div className="mw-assets-list__header">
                                        <span className="mw-list-col mw-list-col--sym">Symbol</span>
                                        <span className="mw-list-col mw-list-col--name">Name</span>
                                        <span className="mw-list-col mw-list-col--price">Price</span>
                                        <span className="mw-list-col mw-list-col--change">Change</span>
                                        <span className="mw-list-col mw-list-col--industry">Industry</span>
                                        <span className="mw-list-col mw-list-col--actions">Actions</span>
                                    </div>
                                    {symbols.slice(0, assetVisibleSections[label] || 48).map((s) => {
                                        const snap = assetSnapshots[s];
                                        const isLoading = !snap;
                                        const rawName = snap?.name || state.tickerNameMap?.[s] || state.tickerNameMap?.[s.toUpperCase()] || '';
                                        // If name equals the symbol, strip suffix for cleaner display
                                        const displayName = (rawName && rawName !== s && rawName !== s.toUpperCase())
                                            ? rawName
                                            : s.replace(/\.(NS|BO|MCX|L|T|HK|DE)$/i, '').replace(/_/g, ' ');
                                        const changePct = Number(snap?.changePct || 0);
                                        return (
                                        <div key={s} className={`mw-assets-list__row ${isLoading ? 'mw-assets-list__row--loading' : ''}`} onClick={() => openTickerDetail(s)}>
                                            <span className="mw-list-col mw-list-col--sym">
                                                <span className="mw-list-sym">{s}</span>
                                                {snap?.isProxy && <span className="mw-asset-tag mw-asset-tag--proxy">Proxy</span>}
                                            </span>
                                            <span className="mw-list-col mw-list-col--name" title={rawName || s}>{displayName}</span>
                                            <span className="mw-list-col mw-list-col--price">
                                                {snap?.price != null
                                                    ? `${snap?.currencySymbol || '₹'}${Number(snap.price).toLocaleString()}`
                                                    : isLoading ? '' : '--'}
                                            </span>
                                            <span className={`mw-list-col mw-list-col--change ${changePct >= 0 ? 'qe-text-up' : 'qe-text-down'}`}>
                                                {isLoading ? '' : `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`}
                                            </span>
                                            <span className="mw-list-col mw-list-col--industry">
                                                {snap?.industry || snap?.assetFamily || snap?.categoryLabel || ''}
                                            </span>
                                            <span className="mw-list-col mw-list-col--actions" onClick={(e) => e.stopPropagation()}>
                                                <button type="button" className="mw-mini-btn" onClick={() => openAnalysisSymbol(s)}>Chart</button>
                                                <button type="button" className="mw-mini-btn" onClick={async (e) => {
                                                    const btn = e.currentTarget;
                                                    btn.textContent = '...';
                                                    btn.disabled = true;
                                                    try {
                                                        const r = await fetch(`${API_BASE}/api/ticker/${encodeURIComponent(s)}/download`, { method: 'POST' });
                                                        const d = await r.json();
                                                        btn.textContent = d.status === 'success' ? 'OK' : 'Err';
                                                    } catch { btn.textContent = 'Err'; }
                                                    setTimeout(() => { btn.textContent = 'DL'; btn.disabled = false; }, 1500);
                                                }}>DL</button>
                                                <button type="button" className="mw-mini-btn" onClick={() => { handlers.addSymbolToWatchlist?.(s) || handlers.addToWatchlist?.(s); }}>Watch</button>
                                            </span>
                                        </div>
                                    );})}
                                </div>
                            </section>
                        ))}
                    </div>
                )}

                {module === 'analysis' && (
                    <div className="qe-content mw-content">
                        <header className="qe-hero">
                            <p className="qe-hero__label">Research & Analysis</p>
                            <h1 className="qe-hero__title">Research Desk</h1>
                            <p className="qe-hero__sub">Macro regime analysis, ML signals, and full chart workspace for each symbol. Configure and run research studies on your watchlists or active portfolio.</p>
                        </header>

                        {!state.selectedTicker ? (
                            <>
                                <div className="rs-research-nav">
                                    <div className="rs-nav-tabs">
                                        <button type="button" className="rs-nav-tab rs-nav-tab--active">Macro Lab</button>
                                        <button type="button" className="rs-nav-tab">ML Signals</button>
                                        <button type="button" className="rs-nav-tab">Terminal</button>
                                    </div>
                                </div>

                                <div className="rs-research-stats">
                                    <div className="rs-stat-card">
                                        <span className="rs-stat-label">Universe</span>
                                        <strong className="rs-stat-value">{(state.macroLabInputSymbols || []).length} symbols</strong>
                                    </div>
                                    <div className="rs-stat-card">
                                        <span className="rs-stat-label">Macro Updated</span>
                                        <strong className="rs-stat-value">{state.macroLabSnapshot?.ok ? 'Yes' : 'No'}</strong>
                                    </div>
                                    <div className="rs-stat-card">
                                        <span className="rs-stat-label">ML Signals Ready</span>
                                        <strong className="rs-stat-value">{(state.mlResearchRows || []).filter(r => !r.error).length} assets</strong>
                                    </div>
                                    <div className="rs-stat-card">
                                        <span className="rs-stat-label">Source</span>
                                        <strong className="rs-stat-value">{state.macroLabInputMode.replace(/_/g, ' ')}</strong>
                                    </div>
                                </div>

                                <ResearchMacroLab state={state} handlers={handlers} openAnalysisSymbol={openAnalysisSymbol} />
                                <ResearchMlLab state={state} handlers={handlers} openAnalysisSymbol={openAnalysisSymbol} />

                                <div className="rs-symbol-picker">
                                    <div className="rs-picker-header">
                                        <h2 className="rs-picker-title">Quick Pick: Watchlist Symbols</h2>
                                        <p className="rs-picker-sub">Select a symbol to open chart analysis with research tools</p>
                                    </div>
                                    <div className="rs-picker-grid">
                                        {(state.watchlistSymbols || []).slice(0, 12).map((s) => (
                                            <button key={s} type="button" className="rs-picker-card" onClick={() => openAnalysisSymbol(s)}>
                                                <div className="rs-picker-symbol">{s}</div>
                                                <div className="rs-picker-action">Analyze</div>
                                            </button>
                                        ))}
                                    </div>
                                    {!(state.watchlistSymbols || []).length && (
                                        <div className="qe-empty">No symbols available. Go to Watchlists or Universe to create a list.</div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="rs-research-nav">
                                    <div className="rs-nav-tabs">
                                        <button type="button" className="rs-nav-tab">Macro Lab</button>
                                        <button type="button" className="rs-nav-tab">ML Signals</button>
                                        <button type="button" className="rs-nav-tab rs-nav-tab--active">Terminal</button>
                                    </div>
                                </div>

                                <FundamentalRibbon tickerDetails={state.tickerDetails} />
                                <div className="qe-content qe-content--terminal">
                                    <ChartWorkspace state={state} handlers={handlers} setState={setState} />
                                    <aside className="qe-rail">
                                        <div className="qe-rail__block">
                                            <div className="qe-rail__head">Company profile</div>
                                            <div className="qe-rail__body qe-rail__body--compact">
                                                <div className="qe-profile-title">
                                                    <strong>{state.tickerDetails?.longName || state.tickerDetails?.name || state.selectedTicker}</strong>
                                                    <span>{state.selectedTicker}</span>
                                                </div>
                                                <div className="qe-profile-grid">
                                                    <div><span>Market cap</span><strong>{state.tickerDetails?.currencySymbol}{formatLargeNumber(state.tickerDetails?.marketCap)}</strong></div>
                                                    <div><span>P/E</span><strong>{state.tickerDetails?.peRatio ?? 'N/A'}</strong></div>
                                                    <div><span>52W high</span><strong>{state.tickerDetails?.currencySymbol}{state.tickerDetails?.high52 ?? 'N/A'}</strong></div>
                                                    <div><span>52W low</span><strong>{state.tickerDetails?.currencySymbol}{state.tickerDetails?.low52 ?? 'N/A'}</strong></div>
                                                </div>
                                                <div className="qe-profile-grid">
                                                    <div><span>Sector</span><strong>{state.tickerDetails?.sector || 'N/A'}</strong></div>
                                                    <div><span>Industry</span><strong>{state.tickerDetails?.industry || 'N/A'}</strong></div>
                                                </div>
                                                <p className="qe-rail__muted">Sources: Yahoo Finance fundamentals + Wikipedia reference.</p>
                                                <div className="qe-home-actions">
                                                    {state.tickerDetails?.website && (
                                                        <a className="qe-link-btn" href={state.tickerDetails.website} target="_blank" rel="noreferrer">
                                                            Website
                                                        </a>
                                                    )}
                                                    {state.tickerDetails?.wikiUrl && (
                                                        <a className="qe-link-btn" href={state.tickerDetails.wikiUrl} target="_blank" rel="noreferrer">
                                                            Wikipedia
                                                        </a>
                                                    )}
                                                    {state.tickerDetails?.yahooUrl && (
                                                        <a className="qe-link-btn" href={state.tickerDetails.yahooUrl} target="_blank" rel="noreferrer">
                                                            Yahoo quote
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="qe-rail__block">
                                            <div className="qe-rail__head">Research tools</div>
                                            <div className="qe-rail__body qe-rail__body--compact">
                                                <div className="qe-home-actions">
                                                    <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.runContextAgent()}>
                                                        Context AI
                                                    </button>
                                                    <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.runConsumerRag()}>
                                                        Consumer Risk RAG
                                                    </button>
                                                    <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.addToWatchlist()}>
                                                        Add to watchlist
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="qe-rail__block">
                                            <div className="qe-rail__head">Options chain</div>
                                            <div className="qe-rail__body">
                                                {state.optionsData?.calls?.slice(0, 8).map((call, i) => (
                                                    <div className="qe-opt-row" key={i}>
                                                        <span className="qe-opt-muted">{call.strike}</span>
                                                        <span className="qe-opt-call">{call.lastPrice != null ? Number(call.lastPrice).toFixed(2) : '—'}</span>
                                                    </div>
                                                ))}
                                                {!state.optionsData?.calls?.length && <div className="qe-empty">No options data.</div>}
                                            </div>
                                        </div>
                                    </aside>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {module === 'forks' && (
                    <div className="qe-content mw-content">
                        <header className="qe-hero">
                            <p className="qe-hero__label">Pitchforks</p>
                            <h1 className="qe-hero__title">Pitchfork Scan Dashboard</h1>
                            <p className="qe-rail__muted">
                                Persisted scan results across all symbols. Click any row to open full chart analysis.
                            </p>
                            <div className="qe-home-actions">
                                <button type="button" className="qe-btn qe-btn--small" disabled={state.isScreening} onClick={() => handlers.findForkInAll()}>
                                    {state.isScreening ? 'Scanning...' : 'Scan Entire Universe'}
                                </button>
                                <button
                                    type="button"
                                    className="qe-btn qe-btn--small"
                                    disabled={state.allDataJob?.status === 'queued' || state.allDataJob?.status === 'running'}
                                    onClick={() => handlers.downloadAllAndCalculateForks()}
                                >
                                    {state.allDataJob?.status === 'queued' || state.allDataJob?.status === 'running'
                                        ? 'Downloading...'
                                        : 'Download all + calculate'}
                                </button>
                                <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.clearForkScanResults()}>
                                    Clear saved
                                </button>
                            </div>
                            <div className="qe-home-job__meta" style={{ marginTop: '0.5rem' }}>
                                {state.forkScanMeta?.savedAt ? (
                                    <>
                                        <span>Last scan: {new Date(state.forkScanMeta.savedAt).toLocaleString()}</span>
                                        <span>Scanned: {state.forkScanMeta.totalScanned || 0}</span>
                                        <span>Type: {state.forkScanMeta.pitchforkType}</span>
                                        <span>Lookback: {state.forkScanMeta.lookback}d</span>
                                    </>
                                ) : (
                                    <span>No saved pitchfork scan yet. Run "Scan Entire Universe".</span>
                                )}
                            </div>
                            {state.isScreening && (
                                <div className="qe-home-job__meta" style={{ marginTop: '0.35rem' }}>
                                    <span>
                                        Progress: {state.screenerProgress.current}/{state.screenerProgress.total}
                                    </span>
                                    <span>Symbol: {state.screenerProgress.symbol || '...'}</span>
                                </div>
                            )}
                            {(state.allDataJob?.status === 'queued' || state.allDataJob?.status === 'running') && (
                                <div className="qe-home-job__meta" style={{ marginTop: '0.35rem' }}>
                                    <span>
                                        Download+calc: {state.allDataJob?.current || 0}/{state.allDataJob?.total || 0}
                                    </span>
                                    <span>Symbol: {state.allDataJob?.current_symbol || '...'}</span>
                                </div>
                            )}
                        </header>
                        <div className="qe-home-panel">
                            <div className="qe-section-head">
                                <h2>Matches</h2>
                                <span>{state.forkScanResults.length} results</span>
                            </div>
                            <div
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
                                    gap: '0.8rem',
                                }}
                            >
                                {state.forkScanResults.map((r) => (
                                    <div
                                        key={`${r.symbol}-${r.fork?.pivotKey || r.fork?.date || 'fork'}`}
                                        style={{
                                            border: '1px solid rgba(148,163,184,0.22)',
                                            borderRadius: 12,
                                            background: 'rgba(15,23,42,0.22)',
                                            padding: '0.75rem',
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                gap: '0.6rem',
                                                alignItems: 'center',
                                                marginBottom: '0.55rem',
                                            }}
                                        >
                                            <div style={{ minWidth: 0 }}>
                                                <div className="qe-home-row__headline">{r.symbol}</div>
                                                <div className="qe-rail__muted" style={{ fontSize: 12 }}>
                                                    {r.fork?.zoneLabel || 'Fork zone'}
                                                </div>
                                            </div>
                                            <div
                                                className={`qe-home-row__price ${(Number(r.fork?.positionPct || 50) >= 80) ? 'qe-text-down' : (Number(r.fork?.positionPct || 50) <= 20) ? 'qe-text-up' : ''}`}
                                                title="Nearness score"
                                            >
                                                {(r.fork?.nearnessScore ?? 0).toFixed(3)}
                                            </div>
                                        </div>
                                        <div
                                            style={{
                                                display: 'grid',
                                                gridTemplateColumns: '170px minmax(0, 1fr)',
                                                gap: '0.75rem',
                                                width: '100%',
                                                alignItems: 'center',
                                            }}
                                        >
                                            <ForkChartThumb symbol={r.symbol} />
                                            <div style={{ minWidth: 0 }}>
                                                <div className="qe-profile-grid" style={{ marginBottom: '0.5rem' }}>
                                                    <div><span>Type</span><strong>{r.fork?.variation || '-'} {r.fork?.type || ''}</strong></div>
                                                    <div><span>Pivot</span><strong>{r.fork?.date ? new Date(r.fork.date).toLocaleDateString() : 'N/A'}</strong></div>
                                                    <div><span>Inside bars</span><strong>{r.fork?.daysActive ?? 0}/{r.fork?.totalFutureBars ?? 0}</strong></div>
                                                    <div><span>Position</span><strong>{r.fork?.positionPct ?? '0'}%</strong></div>
                                                    <div><span>Status</span><strong>{r.fork?.isActive ? 'Active' : 'Watch'}</strong></div>
                                                    <div><span>Containment</span><strong>{r.fork?.encompassesAllFutureOhlc ? 'OHLC full' : (r.fork?.closeContainedFullHistory ? 'Close full' : 'Partial')}</strong></div>
                                                </div>
                                                <div className="qe-home-actions">
                                                    <button
                                                        type="button"
                                                        className="qe-btn qe-btn--small"
                                                        onClick={() => openAnalysisSymbol(r.symbol)}
                                                    >
                                                        Open research chart
                                                    </button>
                                                    <a
                                                        className="qe-link-btn"
                                                        href={buildForkLink(r.symbol)}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        title="Direct link to this fork chart"
                                                    >
                                                        Direct link
                                                    </a>
                                                    <button
                                                        type="button"
                                                        className="qe-btn qe-btn--small"
                                                        onClick={() => handlers.addToWatchlist(r.symbol)}
                                                    >
                                                        Add to watchlist
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {!state.forkScanResults.length && (
                                    <div className="qe-empty">No fork setups saved.</div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {module === 'alerts' && (
                    <div className="qe-content mw-content">
                        <div className="mw-split">
                            <div className="qe-home-panel">
                                <div className="qe-section-head"><h2>Active alerts</h2></div>
                                <div className="qe-home-list">
                                    {alerts.map((a) => (
                                        <div key={a.id} className="qe-list-item">
                                            <span>{a.symbol}</span>
                                            <span>{a.condition} {a.value}</span>
                                            <button className="qe-watch-card__rm" onClick={() => setAlerts((prev) => prev.filter((x) => x.id !== a.id))}>×</button>
                                        </div>
                                    ))}
                                    {!alerts.length && <div className="qe-empty">No alerts configured.</div>}
                                </div>
                            </div>
                            <div className="qe-home-panel">
                                <div className="qe-section-head"><h2>Create alert</h2></div>
                                <div className="qe-form-grid">
                                    <input className="qe-input" placeholder="AAPL" value={alertForm.symbol} onChange={(e) => setAlertForm((p) => ({ ...p, symbol: e.target.value.toUpperCase() }))} />
                                    <select className="qe-select-inline" value={alertForm.condition} onChange={(e) => setAlertForm((p) => ({ ...p, condition: e.target.value }))}>
                                        <option>Price &gt;</option>
                                        <option>Price &lt;</option>
                                        <option>% Change &gt;</option>
                                        <option>% Change &lt;</option>
                                    </select>
                                    <input className="qe-input" placeholder="Target value" value={alertForm.value} onChange={(e) => setAlertForm((p) => ({ ...p, value: e.target.value }))} />
                                </div>
                                <button
                                    type="button"
                                    className="qe-btn qe-btn--small"
                                    onClick={() => {
                                        if (!alertForm.symbol || !alertForm.value) return;
                                        setAlerts((prev) => [{ id: `${Date.now()}`, ...alertForm }, ...prev]);
                                        setAlertForm({ symbol: '', condition: 'Price >', value: '' });
                                    }}
                                >
                                    Save alert
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {module === 'lab' && (
                    <div className="qe-content mw-content lab-page">
                        <header className="qe-hero">
                            <p className="qe-hero__label">Laboratory</p>
                            <h1 className="qe-hero__title">Research Lab</h1>
                            <p className="qe-hero__sub">Custom insights, open-source models, incognito web research, and research paper integration — all local-first and privacy-preserving.</p>
                        </header>

                        <div className="lab-tabs">
                            {[['insights', 'Custom Insights'], ['models', 'Models Library'], ['research', 'Web Research'], ['papers', 'Papers']].map(([id, label]) => (
                                <button key={id} type="button" className={`lab-tab ${labTab === id ? 'lab-tab--active' : ''}`} onClick={() => { setLabTab(id); setLabResult(null); }}>
                                    {label}
                                </button>
                            ))}
                        </div>

                        {/* ── Custom Insights Tab ── */}
                        {labTab === 'insights' && (
                            <div className="lab-section">
                                <div className="lab-grid">
                                    <div className="qe-home-panel lab-panel">
                                        <div className="qe-section-head"><h2>Create Insight</h2></div>
                                        <div className="lab-form">
                                            <div className="qe-input-group">
                                                <label className="qe-field-label">Name</label>
                                                <input className="qe-input" placeholder="My custom indicator" value={labInsightForm.name} onChange={e => setLabInsightForm(p => ({...p, name: e.target.value}))} />
                                            </div>
                                            <div className="qe-input-group">
                                                <label className="qe-field-label">Description</label>
                                                <input className="qe-input" placeholder="What does this insight measure?" value={labInsightForm.description} onChange={e => setLabInsightForm(p => ({...p, description: e.target.value}))} />
                                            </div>
                                            <div className="qe-input-group">
                                                <label className="qe-field-label">Formula</label>
                                                <textarea className="qe-input lab-textarea" placeholder="sma(close, 20) - sma(close, 50)" value={labInsightForm.formula} onChange={e => setLabInsightForm(p => ({...p, formula: e.target.value}))} />
                                            </div>
                                            <div className="qe-input-group">
                                                <label className="qe-field-label">Symbols (comma-separated)</label>
                                                <input className="qe-input" placeholder="AAPL, MSFT, RELIANCE.NS" value={labInsightForm.symbols} onChange={e => setLabInsightForm(p => ({...p, symbols: e.target.value}))} />
                                            </div>
                                            <div className="qe-input-group">
                                                <label className="qe-field-label">Parameters (JSON)</label>
                                                <input className="qe-input" placeholder='{"period": 20}' value={labInsightForm.params} onChange={e => setLabInsightForm(p => ({...p, params: e.target.value}))} />
                                            </div>
                                            <button type="button" className="qe-btn-primary" disabled={labLoading || !labInsightForm.name || !labInsightForm.formula} onClick={labCreateInsight}>
                                                {labLoading ? 'Creating...' : 'Create Insight'}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="qe-home-panel lab-panel">
                                        <div className="qe-section-head"><h2>Saved Insights</h2><span>{labInsights.length} insights</span></div>
                                        <div className="lab-list">
                                            {labInsights.length === 0 && <p className="qe-empty">No custom insights yet. Create one to get started.</p>}
                                            {labInsights.map(ins => (
                                                <div key={ins.id} className="lab-insight-card">
                                                    <div className="lab-insight-card__top">
                                                        <strong>{ins.name}</strong>
                                                        <span className="qe-badge">{ins.formula?.substring(0, 30)}…</span>
                                                    </div>
                                                    {ins.description && <p className="lab-insight-card__desc">{ins.description}</p>}
                                                    <div className="lab-insight-card__actions">
                                                        <button type="button" className="qe-btn qe-btn--small" onClick={() => labRunInsight(ins.id, state.currentSymbol || 'AAPL')}>
                                                            Run
                                                        </button>
                                                        <button type="button" className="qe-btn qe-btn--small qe-btn--danger" onClick={() => labDeleteInsight(ins.id)}>
                                                            Delete
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ── Models Library Tab ── */}
                        {labTab === 'models' && (
                            <div className="lab-section">
                                <div className="lab-grid">
                                    <div className="qe-home-panel lab-panel">
                                        <div className="qe-section-head"><h2>Available Models</h2><span>{labModels.length} models</span></div>
                                        <div className="lab-models-grid">
                                            {labModels.map(m => (
                                                <button key={m.name} type="button" className={`lab-model-card ${labSelectedModel === m.name ? 'lab-model-card--active' : ''}`} onClick={() => { setLabSelectedModel(m.name); setLabResult(null); setLabModelParams(JSON.stringify(m.default_params || m.params || {}, null, 2)); }}>
                                                    <strong>{(m.name || '').replace(/_/g, ' ')}</strong>
                                                    <span>{m.description?.substring(0, 80)}</span>
                                                    <em>{m.category || 'quantitative'}</em>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="qe-home-panel lab-panel">
                                        <div className="qe-section-head"><h2>{labSelectedModel ? labSelectedModel.replace(/_/g, ' ') : 'Select a Model'}</h2></div>
                                        {labSelectedModel ? (
                                            <div className="lab-form">
                                                <div className="qe-input-group">
                                                    <label className="qe-field-label">Parameters (JSON)</label>
                                                    <textarea className="qe-input lab-textarea lab-textarea--tall" value={labModelParams} onChange={e => setLabModelParams(e.target.value)} />
                                                </div>
                                                <button type="button" className="qe-btn-primary" disabled={labLoading} onClick={labRunModel}>
                                                    {labLoading ? 'Running...' : 'Run Model'}
                                                </button>
                                            </div>
                                        ) : (
                                            <p className="qe-empty">Select a model from the library to configure and run it.</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ── Incognito Web Research Tab ── */}
                        {labTab === 'research' && (
                            <div className="lab-section">
                                <div className="qe-home-panel lab-panel">
                                    <div className="qe-section-head"><h2>Incognito Research</h2><span>One-way fetch — no cookies, no tracking</span></div>
                                    <div className="lab-research-bar">
                                        <input className="qe-input lab-research-input" placeholder="Search topic, e.g. 'GARCH volatility modeling equity markets'" value={labResearchQuery} onChange={e => setLabResearchQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && labResearchTopic()} />
                                        <button type="button" className="qe-btn-primary lab-research-btn" disabled={labLoading || !labResearchQuery} onClick={labResearchTopic}>
                                            {labLoading ? 'Researching...' : 'Research'}
                                        </button>
                                    </div>
                                    {labResearchResults.length > 0 && (
                                        <div className="lab-research-results">
                                            {labResearchResults.map((r, i) => (
                                                <div key={i} className="lab-research-card">
                                                    <strong>{r.title || r.name || `Result ${i + 1}`}</strong>
                                                    <p>{r.snippet || r.summary || r.description || ''}</p>
                                                    {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" className="lab-research-link">{r.source || 'View source'}</a>}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* ── Research Papers Tab ── */}
                        {labTab === 'papers' && (
                            <div className="lab-section">
                                <div className="lab-grid">
                                    <div className="qe-home-panel lab-panel">
                                        <div className="qe-section-head"><h2>Search Papers</h2><span>arXiv, SSRN</span></div>
                                        <div className="lab-research-bar">
                                            <input className="qe-input lab-research-input" placeholder="Search papers, e.g. 'deep learning stock prediction'" value={labPaperQuery} onChange={e => setLabPaperQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && labSearchPapers()} />
                                            <button type="button" className="qe-btn-primary lab-research-btn" disabled={labLoading || !labPaperQuery} onClick={labSearchPapers}>
                                                {labLoading ? 'Searching...' : 'Search'}
                                            </button>
                                        </div>
                                        <div className="lab-paper-results">
                                            {labPaperResults.map((p, i) => (
                                                <div key={i} className="lab-paper-card">
                                                    <strong>{p.title || `Paper ${i + 1}`}</strong>
                                                    <span className="lab-paper-authors">{typeof p.authors === 'string' ? p.authors : (p.authors || []).join(', ')}</span>
                                                    <p>{(p.summary || p.abstract || '').substring(0, 200)}{(p.summary || p.abstract || '').length > 200 ? '…' : ''}</p>
                                                    <div className="lab-paper-actions">
                                                        <button type="button" className="qe-btn qe-btn--small" onClick={() => labSavePaper(p.id || p.paper_id || `paper_${i}`)}>Save</button>
                                                        <button type="button" className="qe-btn qe-btn--small" onClick={() => labSummarizePaper(p.id || p.paper_id || `paper_${i}`)}>Summarize</button>
                                                        {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer" className="qe-btn qe-btn--small">Open</a>}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="qe-home-panel lab-panel">
                                        <div className="qe-section-head"><h2>Saved Papers</h2><span>{labSavedPapers.length} papers</span></div>
                                        <div className="lab-list">
                                            {labSavedPapers.length === 0 && <p className="qe-empty">No saved papers. Search and save papers to build your library.</p>}
                                            {labSavedPapers.map((p, i) => (
                                                <div key={i} className="lab-paper-card">
                                                    <strong>{p.title || 'Untitled'}</strong>
                                                    <span className="lab-paper-authors">{p.authors || ''}</span>
                                                    {p.user_notes && <p className="lab-paper-notes">{p.user_notes}</p>}
                                                    <div className="lab-paper-actions">
                                                        <button type="button" className="qe-btn qe-btn--small" onClick={() => labSummarizePaper(p.id)}>Summarize with AI</button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ── Results Panel (shared across all tabs) ── */}
                        {labResult && (
                            <div className="qe-home-panel lab-result-panel">
                                <div className="qe-section-head">
                                    <h2>Result</h2>
                                    <button type="button" className="qe-btn qe-btn--small" onClick={() => setLabResult(null)}>Clear</button>
                                </div>
                                <pre className="lab-result-pre">{JSON.stringify(labResult, null, 2)}</pre>
                            </div>
                        )}
                    </div>
                )}

                {module === 'settings' && (
                    <div className="qe-content mw-content">
                        <div className="mw-split">
                            <div className="qe-home-panel">
                                <div className="qe-section-head"><h2>Preferences</h2></div>
                                <div className="qe-home-actions qe-home-actions--wrap">
                                    <label className="qe-field-label" htmlFor="mw-theme-settings">
                                        Theme
                                    </label>
                                    <select
                                        id="mw-theme-settings"
                                        className="qe-select-inline"
                                        value={state.theme}
                                        onChange={(e) => handlers.setTheme(e.target.value)}
                                    >
                                        {state.themeOptions.map((o) => (
                                            <option key={o.id} value={o.id}>
                                                {o.label}
                                            </option>
                                        ))}
                                    </select>
                                    <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.cleanDashboard()}>
                                        Reset workspace
                                    </button>
                                </div>
                            </div>
                            <div className="qe-home-panel">
                                <div className="qe-section-head"><h2>Local LLM Runtime</h2></div>
                                <div className="qe-form-grid">
                                    <label className="qe-toggle">
                                        <input
                                            type="checkbox"
                                            checked={state.localLlmEnabled}
                                            onChange={(e) => handlers.setLocalLlmEnabled(e.target.checked)}
                                        />
                                        <span>Use local LLM for analysis</span>
                                    </label>
                                    <input
                                        className="qe-input"
                                        placeholder="http://127.0.0.1:11434"
                                        value={state.localLlmBaseUrl}
                                        onChange={(e) => handlers.setLocalLlmBaseUrl(e.target.value)}
                                    />
                                    <input
                                        className="qe-input"
                                        placeholder="llama3.1"
                                        value={state.localLlmModel}
                                        onChange={(e) => handlers.setLocalLlmModel(e.target.value)}
                                    />
                                </div>
                                <div className="qe-home-actions">
                                    <button
                                        type="button"
                                        className="qe-btn qe-btn--small"
                                        disabled={state.localLlmTesting}
                                        onClick={() => handlers.testLocalLlm()}
                                    >
                                        {state.localLlmTesting ? 'Testing...' : 'Test local runtime'}
                                    </button>
                                </div>
                                {state.localLlmLastStatus && (
                                    <p className="qe-rail__muted" style={{ marginTop: '0.5rem' }}>
                                        {state.localLlmLastStatus}
                                    </p>
                                )}
                            </div>
                            <div className="qe-home-panel">
                                <div className="qe-section-head"><h2>Data operations</h2></div>
                                <div className="qe-home-actions">
                                    <button type="button" className="qe-btn qe-btn--small qe-btn--danger" onClick={() => handlers.nukeLocalData()}>
                                        Nuke local data
                                    </button>
                                    <button type="button" className="qe-btn qe-btn--small" onClick={() => handlers.resetAndRedownloadAll()}>
                                        Reset + redownload
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default App;