import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import './UniversePage.css';
import { API_BASE } from '../../utils/constants';

function TickersErrorBanner({ message }) {
    if (!message) return null;
    return (
        <div className="uni-tickers-error" role="alert">
            <strong>Universe data unavailable</strong>
            <p>{message}</p>
            <p className="uni-tickers-error__hint">
                API base: <code>{API_BASE}</code> — ensure the backend is running and <code>all_global_tickers.json</code> exists in the project root (run <code>python fetch_all_tickers.py</code> once).
            </p>
        </div>
    );
}

const ASSET_TYPE_ICONS = {
    equity: 'Eq',
    etf: 'ETF',
    index: 'Idx',
    'mutual fund': 'MF',
    commodity: 'Cmd',
    fx: 'FX',
    crypto: 'Cry',
    bond: 'Bnd',
    gold: 'Au',
    other: '…',
};

const SPECIAL_PANELS = ['mf-browser', 'gold-silver'];

function fmtBig(n) {
    if (n == null || isNaN(n)) return '--';
    const abs = Math.abs(n);
    if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return String(n);
}

function deriveAssetType(snap) {
    if (!snap) return 'other';
    const fam = (snap.assetFamily || '').toLowerCase();
    if (fam.includes('equity') || fam.includes('stock')) return 'equity';
    if (fam.includes('etf')) return 'etf';
    if (fam.includes('index') || fam.includes('indice')) return 'index';
    if (fam.includes('mutual') || fam.includes('mf')) return 'mutual fund';
    if (fam.includes('commod') || fam.includes('gold') || fam.includes('silver') || fam.includes('metal') || fam.includes('crude') || fam.includes('energy')) return 'commodity';
    if (fam.includes('fx') || fam.includes('forex') || fam.includes('currency')) return 'fx';
    if (fam.includes('crypto')) return 'crypto';
    if (fam.includes('bond') || fam.includes('fixed')) return 'bond';
    return 'other';
}

export default function UniversePage({ state, setState, openAnalysisSymbol, openAssetDetail }) {
    const [assetSnapshots, setAssetSnapshots] = useState({});
    const [assetLoadState, setAssetLoadState] = useState({ phase: 'idle', loaded: 0, total: 0, current: '' });
    const [activeAssetType, setActiveAssetType] = useState('all');
    const [industryFilter, setIndustryFilter] = useState('All');
    const [groupMode, setGroupMode] = useState('category');
    const [visibleSections, setVisibleSections] = useState({});
    const [viewStyle, setViewStyle] = useState('list');

    const [mfQuery, setMfQuery] = useState('');
    const [mfCategory, setMfCategory] = useState('');
    const [mfHouse, setMfHouse] = useState('');
    const [mfSchemes, setMfSchemes] = useState([]);
    const [mfTotal, setMfTotal] = useState(0);
    const [mfOffset, setMfOffset] = useState(0);
    const [mfLoading, setMfLoading] = useState(false);
    const [mfCategories, setMfCategories] = useState([]);
    const [mfHouses, setMfHouses] = useState([]);

    const [goldData, setGoldData] = useState(null);
    const [silverData, setSilverData] = useState(null);
    const [goldLoading, setGoldLoading] = useState(false);

    const [selectedSymbols, setSelectedSymbols] = useState(() => new Set());
    const [dlJob, setDlJob] = useState(null);
    const dlPollRef = useRef(null);
    const [fullDataJob, setFullDataJob] = useState(null);
    const fullDlPollRef = useRef(null);

    const toggleSelect = useCallback((sym) => {
        setSelectedSymbols((prev) => {
            const next = new Set(prev);
            if (next.has(sym)) next.delete(sym); else next.add(sym);
            return next;
        });
    }, []);

    const toggleSectionAll = useCallback((sectionSymbols) => {
        setSelectedSymbols((prev) => {
            const next = new Set(prev);
            const allIn = sectionSymbols.every((s) => next.has(s));
            sectionSymbols.forEach((s) => { if (allIn) next.delete(s); else next.add(s); });
            return next;
        });
    }, []);

    const clearSelection = useCallback(() => setSelectedSymbols(new Set()), []);

    const startBatchDownload = useCallback(async () => {
        if (!selectedSymbols.size) return;
        try {
            const r = await fetch(`${API_BASE}/api/admin/redownload-all`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbols: [...selectedSymbols], sleep_seconds: 0.75 }),
            });
            const d = await r.json();
            if (d.ok && d.job_id) {
                setDlJob({ job_id: d.job_id, status: 'queued', current: 0, total: selectedSymbols.size, current_symbol: null, error: null });
            }
        } catch (e) { console.error('batch download start failed:', e); }
    }, [selectedSymbols]);

    useEffect(() => {
        if (dlPollRef.current) clearInterval(dlPollRef.current);
        if (!dlJob?.job_id || dlJob.status === 'completed' || dlJob.status === 'failed') return;
        dlPollRef.current = setInterval(async () => {
            try {
                const r = await fetch(`${API_BASE}/api/admin/redownload-status/${dlJob.job_id}`);
                const d = await r.json();
                if (d.ok) setDlJob(d);
                if (d.status === 'completed' || d.status === 'failed') clearInterval(dlPollRef.current);
            } catch (_) { /* ignore */ }
        }, 2000);
        return () => clearInterval(dlPollRef.current);
    }, [dlJob?.job_id, dlJob?.status]);

    useEffect(() => {
        if (fullDlPollRef.current) clearInterval(fullDlPollRef.current);
        if (!fullDataJob?.job_id || fullDataJob.status === 'completed' || fullDataJob.status === 'failed') return;
        fullDlPollRef.current = setInterval(async () => {
            try {
                const r = await fetch(`${API_BASE}/api/admin/download-all-and-calculate-status/${fullDataJob.job_id}`);
                const d = await r.json();
                if (d.ok) setFullDataJob(d);
                if (d.status === 'completed' || d.status === 'failed') clearInterval(fullDlPollRef.current);
            } catch (_) { /* ignore */ }
        }, 3000);
        return () => clearInterval(fullDlPollRef.current);
    }, [fullDataJob?.job_id, fullDataJob?.status]);

    const jobsRunning = Boolean(
        (dlJob && (dlJob.status === 'queued' || dlJob.status === 'running'))
        || (fullDataJob && (fullDataJob.status === 'queued' || fullDataJob.status === 'running'))
    );

    const startCategoryParquetDownload = useCallback(async (categoryKey, sectionLabel) => {
        if (!categoryKey || jobsRunning) return;
        if (!window.confirm(
            `Download all instruments in "${sectionLabel}" to local Parquet (Yahoo OHLC: 15m/1h/1d/1wk)? This runs in the background and may take a long time for large lists.`
        )) return;
        try {
            const r = await fetch(`${API_BASE}/api/admin/redownload-all`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ categories: [categoryKey], sleep_seconds: 0.75 }),
            });
            const d = await r.json();
            if (d.ok && d.job_id) {
                setDlJob({
                    job_id: d.job_id,
                    status: 'queued',
                    current: 0,
                    total: 0,
                    current_symbol: null,
                    error: null,
                    contextLabel: sectionLabel,
                    kind: 'category-parquet',
                });
            }
        } catch (e) { console.error('category parquet download failed:', e); }
    }, [jobsRunning]);

    const startCategoryFullDataDownload = useCallback(async (categoryKey, sectionLabel, symbolCount) => {
        if (!categoryKey || jobsRunning) return;
        if (!window.confirm(
            `Full data download for "${sectionLabel}" (${symbolCount} symbols): Yahoo max history into SQLite, optional intraday bars. Pitchfork scan runs after each symbol. This can take many hours. Continue?`
        )) return;
        try {
            const r = await fetch(`${API_BASE}/api/admin/download-all-and-calculate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    categories: [categoryKey],
                    sleep_seconds: 0.1,
                    include_intraday: true,
                    intraday_15m_days: 60,
                    intraday_1h_days: 730,
                    lookback_days: 3650,
                }),
            });
            const d = await r.json();
            if (d.ok && d.job_id) {
                setFullDataJob({
                    job_id: d.job_id,
                    status: 'queued',
                    current: 0,
                    total: 0,
                    current_symbol: null,
                    error: null,
                    contextLabel: sectionLabel,
                });
            }
        } catch (e) { console.error('category full data download failed:', e); }
    }, [jobsRunning]);

    const indexCategories = useMemo(() => {
        const result = [];
        Object.keys(state.tickersData).forEach((cat) => {
            const filtered = state.tickersData[cat].filter((t) => t.toUpperCase().includes(state.searchTerm));
            if (filtered.length > 0) result.push({ cat, filtered });
        });
        return result;
    }, [state.tickersData, state.searchTerm]);

    const visibleAssetSymbols = useMemo(
        () => indexCategories.flatMap(({ filtered }) => filtered).slice(0, 300),
        [indexCategories]
    );

    useEffect(() => {
        setVisibleSections({});
    }, [state.searchTerm, industryFilter, groupMode, activeAssetType]);

    useEffect(() => {
        if (!visibleAssetSymbols.length) {
            setAssetLoadState({ phase: 'idle', loaded: 0, total: 0, current: '' });
            return undefined;
        }
        let cancelled = false;
        (async () => {
            const missing = visibleAssetSymbols.filter((s) => !assetSnapshots[s]);
            if (!missing.length) {
                setAssetLoadState({ phase: 'complete', loaded: visibleAssetSymbols.length, total: visibleAssetSymbols.length, current: '' });
                return;
            }
            const now = new Date().toISOString();
            const batchSize = 40;
            let completed = 0;
            setAssetLoadState({ phase: 'loading', loaded: 0, total: missing.length, current: '' });

            for (let i = 0; i < missing.length; i += batchSize) {
                if (cancelled) return;
                const batch = missing.slice(i, i + batchSize);
                setAssetLoadState((prev) => ({ ...prev, current: `Batch ${Math.floor(i / batchSize) + 1}` }));
                try {
                    const r = await fetch(`${API_BASE}/api/instruments/batch-quote`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ symbols: batch }),
                    });
                    const d = await r.json();
                    if (cancelled) return;
                    if (d.ok) {
                        const snapMap = {};
                        (d.quotes || []).forEach((q) => {
                            snapMap[q.symbol] = {
                                name: q.displayName || q.name || q.symbol,
                                price: q.price,
                                change: q.change,
                                prevClose: q.prevClose,
                                currencySymbol: q.currencySymbol || '$',
                                changePct: Number(q.changePct || 0),
                                industry: q.industry || q.assetFamily || q.categoryLabel || 'Unknown',
                                sector: q.sector || '',
                                assetFamily: q.assetFamily || '',
                                categoryLabel: q.categoryLabel || '',
                                marketRegion: q.marketRegion || '',
                                marketExchange: q.marketExchange || '',
                                isProxy: false,
                                updatedAt: now,
                                marketCap: q.marketCap,
                                volume: q.volume,
                                high52: q.high52,
                                low52: q.low52,
                                peRatio: q.peRatio,
                            };
                        });
                        batch.forEach((sym) => {
                            if (!snapMap[sym]) {
                                snapMap[sym] = {
                                    name: sym, price: null, change: null, prevClose: null,
                                    currencySymbol: '$', changePct: 0,
                                    industry: 'Unknown', sector: '', assetFamily: '', categoryLabel: '',
                                    marketRegion: '', marketExchange: '', isProxy: false, updatedAt: now,
                                };
                            }
                        });
                        setAssetSnapshots((prev) => ({ ...prev, ...snapMap }));
                    }
                } catch (e) { console.error('batch-quote error:', e); }
                completed += batch.length;
                setAssetLoadState({
                    phase: completed >= missing.length ? 'complete' : 'loading',
                    loaded: Math.min(completed, missing.length),
                    total: missing.length,
                    current: '',
                });
            }
        })();
        return () => { cancelled = true; };
    }, [visibleAssetSymbols, assetSnapshots]);

    const assetTypeCounts = useMemo(() => {
        const counts = { all: 0 };
        visibleAssetSymbols.forEach((s) => {
            const snap = assetSnapshots[s];
            const t = deriveAssetType(snap);
            counts.all = (counts.all || 0) + 1;
            counts[t] = (counts[t] || 0) + 1;
        });
        return counts;
    }, [visibleAssetSymbols, assetSnapshots]);

    const assetTypeList = useMemo(() => {
        const list = [{ id: 'all', label: 'All', count: assetTypeCounts.all || 0 }];
        Object.keys(ASSET_TYPE_ICONS).forEach((key) => {
            if (assetTypeCounts[key]) {
                list.push({ id: key, label: key.charAt(0).toUpperCase() + key.slice(1), count: assetTypeCounts[key] });
            }
        });
        return list;
    }, [assetTypeCounts]);

    const industryOptions = useMemo(() => {
        const vals = new Set(['All']);
        visibleAssetSymbols.forEach((s) => vals.add(assetSnapshots[s]?.industry || 'Unknown'));
        return Array.from(vals);
    }, [visibleAssetSymbols, assetSnapshots]);

    const filteredSections = useMemo(() => {
        const applyFilters = (syms) =>
            syms.filter((s) => {
                const snap = assetSnapshots[s];
                if (activeAssetType !== 'all' && deriveAssetType(snap) !== activeAssetType) return false;
                if (industryFilter !== 'All' && (snap?.industry || 'Unknown') !== industryFilter) return false;
                return true;
            });

        if (groupMode === 'industry') {
            const grouped = {};
            indexCategories.forEach(({ filtered }) => {
                applyFilters(filtered).forEach((s) => {
                    const ind = assetSnapshots[s]?.industry || 'Unknown';
                    if (!grouped[ind]) grouped[ind] = [];
                    grouped[ind].push(s);
                });
            });
            return Object.keys(grouped).sort().map((industry) => ({ categoryKey: null, label: industry, symbols: grouped[industry] }));
        }

        if (groupMode === 'asset-type') {
            const grouped = {};
            indexCategories.forEach(({ filtered }) => {
                applyFilters(filtered).forEach((s) => {
                    const t = deriveAssetType(assetSnapshots[s]);
                    const label = t.charAt(0).toUpperCase() + t.slice(1);
                    if (!grouped[label]) grouped[label] = [];
                    grouped[label].push(s);
                });
            });
            return Object.keys(grouped).sort().map((label) => ({ categoryKey: null, label, symbols: grouped[label] }));
        }

        return indexCategories
            .map(({ cat, filtered }) => ({
                categoryKey: cat,
                label: state.categoryLabelMap?.[cat] || cat.replace(/_/g, ' '),
                symbols: applyFilters(filtered),
            }))
            .filter((x) => x.symbols.length > 0);
    }, [indexCategories, assetSnapshots, industryFilter, groupMode, state.categoryLabelMap, activeAssetType]);

    const overview = useMemo(() => {
        const symbols = filteredSections.flatMap(({ symbols: rows }) => rows);
        const loaded = symbols.map((s) => assetSnapshots[s]).filter(Boolean);
        const rising = loaded.filter((r) => Number(r?.changePct || 0) >= 0).length;
        const families = new Set(loaded.map((r) => r?.assetFamily).filter(Boolean));
        return { visible: symbols.length, loaded: loaded.length, rising, falling: Math.max(0, loaded.length - rising), familyCount: families.size };
    }, [filteredSections, assetSnapshots]);

    const handleOpen = useCallback(
        (sym) => {
            if (openAssetDetail) openAssetDetail(sym);
            else openAnalysisSymbol(sym);
        },
        [openAssetDetail, openAnalysisSymbol]
    );

    useEffect(() => {
        fetch(`${API_BASE}/api/mf/categories`)
            .then((r) => r.json())
            .then((d) => {
                if (d.ok) {
                    setMfCategories(d.categories || []);
                    setMfHouses(d.fund_houses || []);
                }
            })
            .catch(() => {});
    }, []);

    const loadMfSchemes = useCallback((query, cat, house, offset) => {
        setMfLoading(true);
        const params = new URLSearchParams({ q: query, category: cat, fund_house: house, offset: String(offset), limit: '50' });
        fetch(`${API_BASE}/api/mf/browse?${params}`)
            .then((r) => r.json())
            .then((d) => {
                if (d.ok) {
                    setMfSchemes((prev) => (offset === 0 ? d.schemes : [...prev, ...d.schemes]));
                    setMfTotal(d.total);
                    setMfOffset(offset + d.schemes.length);
                }
            })
            .catch(() => {})
            .finally(() => setMfLoading(false));
    }, []);

    useEffect(() => {
        if (activeAssetType === 'mf-browser') {
            setMfSchemes([]);
            setMfOffset(0);
            loadMfSchemes(mfQuery, mfCategory, mfHouse, 0);
        }
    }, [activeAssetType, mfQuery, mfCategory, mfHouse, loadMfSchemes]);

    useEffect(() => {
        if (activeAssetType === 'gold-silver' && !goldData && !goldLoading) {
            setGoldLoading(true);
            Promise.all([
                fetch(`${API_BASE}/api/gold-rates`).then((r) => r.json()).catch(() => null),
                fetch(`${API_BASE}/api/silver-rates`).then((r) => r.json()).catch(() => null),
            ]).then(([g, s]) => {
                if (g) setGoldData(g);
                if (s) setSilverData(s);
            }).finally(() => setGoldLoading(false));
        }
    }, [activeAssetType, goldData, goldLoading]);

    const isSpecialPanel = SPECIAL_PANELS.includes(activeAssetType);

    return (
        <div className="md-content mw-content mdl-page mdl-page--redesign mdl mdl--dense uni-page">
            {/* Hero */}
            <header className="mdl-card uni-hero-card">
                <TickersErrorBanner message={state.tickersLoadError} />
                <div className="uni-hero-top">
                    <div>
                        <span className="wl-card-eyebrow">Directory</span>
                        <h1 className="uni-hero__title">Universe</h1>
                        <p className="uni-hero__sub">
                            Browse all tracked instruments across asset classes. Click any row to open a full Yahoo-style detail page with live quotes, charts, OHLC data, options, and downloads.
                        </p>
                    </div>
                    <div className="uni-hero-kpi">
                        <div className="mdl-metric"><span>Total</span><strong>{overview.visible}</strong></div>
                        <div className="mdl-metric"><span>Loaded</span><strong>{overview.loaded}</strong></div>
                        <div className="mdl-metric"><span>Rising</span><strong className="md-text-up">{overview.rising}</strong></div>
                        <div className="mdl-metric"><span>Falling</span><strong className="md-text-down">{overview.falling}</strong></div>
                        <div className="mdl-metric"><span>Families</span><strong>{overview.familyCount}</strong></div>
                    </div>
                </div>

                {/* Search */}
                <input
                    className="md-search uni-search"
                    placeholder="Search symbol or name…"
                    value={state.searchInput}
                    onChange={(e) => setState.setSearchInput(e.target.value)}
                />

                {/* Progress */}
                {assetLoadState.phase === 'loading' && (
                    <div className="uni-progress">
                        <div className="uni-progress__text">
                            <span>Loading snapshots</span>
                            <span className="uni-progress__counter">{assetLoadState.loaded}/{assetLoadState.total}</span>
                        </div>
                        <div className="uni-progress__bar">
                            <span style={{ width: `${Math.min(100, Math.round((assetLoadState.loaded / assetLoadState.total) * 100))}%` }} />
                        </div>
                    </div>
                )}
            </header>

            {/* Asset type navigator */}
            <nav className="uni-type-nav" role="tablist" aria-label="Asset type filter">
                {assetTypeList.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={activeAssetType === t.id}
                        className={`uni-type-chip ${activeAssetType === t.id ? 'uni-type-chip--active' : ''}`}
                        onClick={() => setActiveAssetType(t.id)}
                    >
                        <span className="uni-type-chip__icon">{ASSET_TYPE_ICONS[t.id] || t.label.slice(0, 2)}</span>
                        <span className="uni-type-chip__label">{t.label}</span>
                        <span className="uni-type-chip__count">{t.count}</span>
                    </button>
                ))}
                <button
                    type="button"
                    role="tab"
                    aria-selected={activeAssetType === 'mf-browser'}
                    className={`uni-type-chip uni-type-chip--special ${activeAssetType === 'mf-browser' ? 'uni-type-chip--active' : ''}`}
                    onClick={() => setActiveAssetType('mf-browser')}
                >
                    <span className="uni-type-chip__icon">MF</span>
                    <span className="uni-type-chip__label">Mutual Funds</span>
                    <span className="uni-type-chip__count">14K+</span>
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={activeAssetType === 'gold-silver'}
                    className={`uni-type-chip uni-type-chip--special ${activeAssetType === 'gold-silver' ? 'uni-type-chip--active' : ''}`}
                    onClick={() => setActiveAssetType('gold-silver')}
                >
                    <span className="uni-type-chip__icon">Au</span>
                    <span className="uni-type-chip__label">Gold / Silver</span>
                </button>
            </nav>

            {/* ——— MF Browser Panel ——— */}
            {activeAssetType === 'mf-browser' && (
                <div className="uni-mf-panel">
                    <div className="mdl-card uni-mf-card">
                        <div className="uni-mf-header">
                            <div>
                                <span className="wl-card-eyebrow">AMFI Registry</span>
                                <h2 className="uni-section-title">India Mutual Funds</h2>
                                <span className="uni-section-count">{mfTotal.toLocaleString()} schemes found</span>
                            </div>
                        </div>
                        <div className="uni-mf-filters">
                            <input
                                className="md-search uni-mf-search"
                                placeholder="Search scheme name, fund house, ISIN…"
                                value={mfQuery}
                                onChange={(e) => { setMfQuery(e.target.value); setMfOffset(0); }}
                            />
                            <select className="md-select-inline" value={mfCategory} onChange={(e) => { setMfCategory(e.target.value); setMfOffset(0); }}>
                                <option value="">All categories</option>
                                {mfCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <select className="md-select-inline" value={mfHouse} onChange={(e) => { setMfHouse(e.target.value); setMfOffset(0); }}>
                                <option value="">All fund houses</option>
                                {mfHouses.map((h) => <option key={h} value={h}>{h}</option>)}
                            </select>
                        </div>
                        <div className="uni-list-wrap uni-mf-list">
                            <table className="uni-list-table">
                                <thead>
                                    <tr>
                                        <th>Symbol</th>
                                        <th>Scheme name</th>
                                        <th>Fund house</th>
                                        <th>Category</th>
                                        <th>NAV</th>
                                        <th>NAV date</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {mfSchemes.map((s) => (
                                        <tr key={s.symbol} className="uni-list-row" onClick={() => handleOpen(s.symbol)} role="button" tabIndex={0}>
                                            <td className="uni-list-sym">{s.symbol}</td>
                                            <td className="uni-list-name uni-mf-name">{s.scheme_name}</td>
                                            <td className="uni-list-industry">{s.fund_house}</td>
                                            <td className="uni-list-industry">{s.scheme_category}</td>
                                            <td className="uni-list-price">{s.latest_nav != null ? `₹${Number(s.latest_nav).toFixed(4)}` : '--'}</td>
                                            <td className="uni-list-exchange">{s.latest_nav_date || '--'}</td>
                                            <td className="uni-list-action"><span className="uni-open-arrow">&rarr;</span></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {mfLoading && <div className="uni-mf-loading">Loading schemes…</div>}
                            {!mfLoading && !mfSchemes.length && <div className="uni-mf-loading">No schemes match your filters.</div>}
                        </div>
                        {mfSchemes.length < mfTotal && !mfLoading && (
                            <button
                                type="button"
                                className="md-btn md-btn--small uni-mf-more"
                                onClick={() => loadMfSchemes(mfQuery, mfCategory, mfHouse, mfOffset)}
                            >
                                Load more ({mfTotal - mfSchemes.length} remaining)
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* ——— Gold / Silver Panel ——— */}
            {activeAssetType === 'gold-silver' && (
                <div className="uni-gold-panel">
                    <div className="uni-gold-grid">
                        <section className="mdl-card uni-gold-card">
                            <div className="uni-gold-header">
                                <span className="wl-card-eyebrow">India rates</span>
                                <h2 className="uni-section-title">Gold — 24 Karat</h2>
                                <span className="uni-section-count">per 10 grams · ₹ INR</span>
                            </div>
                            {goldLoading && <div className="uni-mf-loading">Loading rates…</div>}
                            {goldData && Object.keys(goldData.gold_24k || {}).length > 0 ? (
                                <div className="uni-gold-table-wrap">
                                    <table className="uni-list-table uni-gold-table">
                                        <thead><tr><th>City</th><th>Rate (₹)</th></tr></thead>
                                        <tbody>
                                            {Object.entries(goldData.gold_24k).map(([city, rate]) => (
                                                <tr key={city}><td>{city}</td><td className="uni-list-price">₹{Number(rate).toLocaleString()}</td></tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (!goldLoading && <div className="uni-mf-loading">No 24K gold data available. Start the backend to scrape rates.</div>)}
                        </section>

                        <section className="mdl-card uni-gold-card">
                            <div className="uni-gold-header">
                                <span className="wl-card-eyebrow">India rates</span>
                                <h2 className="uni-section-title">Gold — 22 Karat</h2>
                                <span className="uni-section-count">per 10 grams · ₹ INR</span>
                            </div>
                            {goldData && Object.keys(goldData.gold_22k || {}).length > 0 ? (
                                <div className="uni-gold-table-wrap">
                                    <table className="uni-list-table uni-gold-table">
                                        <thead><tr><th>City</th><th>Rate (₹)</th></tr></thead>
                                        <tbody>
                                            {Object.entries(goldData.gold_22k).map(([city, rate]) => (
                                                <tr key={city}><td>{city}</td><td className="uni-list-price">₹{Number(rate).toLocaleString()}</td></tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (!goldLoading && <div className="uni-mf-loading">No 22K gold data available.</div>)}
                        </section>

                        <section className="mdl-card uni-gold-card">
                            <div className="uni-gold-header">
                                <span className="wl-card-eyebrow">India rates</span>
                                <h2 className="uni-section-title">Silver</h2>
                                <span className="uni-section-count">per kg · ₹ INR</span>
                            </div>
                            {silverData && Object.keys(silverData.silver || {}).length > 0 ? (
                                <div className="uni-gold-table-wrap">
                                    <table className="uni-list-table uni-gold-table">
                                        <thead><tr><th>City</th><th>Rate (₹)</th></tr></thead>
                                        <tbody>
                                            {Object.entries(silverData.silver).map(([city, rate]) => (
                                                <tr key={city}><td>{city}</td><td className="uni-list-price">₹{Number(rate).toLocaleString()}</td></tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (!goldLoading && <div className="uni-mf-loading">No silver data available.</div>)}
                        </section>
                    </div>
                    {goldData?.scraped_at && (
                        <div className="uni-gold-meta">
                            Source: {goldData.source} · Last updated: {new Date(goldData.scraped_at).toLocaleString()}
                        </div>
                    )}
                    <div className="uni-gold-comex">
                        <span className="wl-card-eyebrow">COMEX Futures (via Yahoo)</span>
                        <div className="uni-gold-comex-row">
                            {['GC=F', 'SI=F', 'PL=F', 'PA=F', 'HG=F'].map((sym) => (
                                <button key={sym} type="button" className="uni-type-chip" onClick={() => handleOpen(sym)}>
                                    {sym.replace('=F', '')}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ——— Standard asset list (hidden when special panel active) ——— */}
            {!isSpecialPanel && (
                <>
                    {/* Download job progress banner */}
                    {dlJob && dlJob.status !== 'dismissed' && (
                        <div className={`uni-dl-banner ${dlJob.status === 'failed' ? 'uni-dl-banner--fail' : ''} ${dlJob.status === 'completed' ? 'uni-dl-banner--done' : ''}`}>
                            <div className="uni-dl-banner__text">
                                {dlJob.contextLabel && (dlJob.status === 'queued' || dlJob.status === 'running') && (
                                    <span className="uni-dl-banner__ctx">{dlJob.contextLabel} · </span>
                                )}
                                {dlJob.status === 'completed' && <span>Parquet download complete — {dlJob.stats?.successful || 0} symbols saved ({dlJob.stats?.data_dir || 'local_market_data'}).</span>}
                                {dlJob.status === 'failed' && <span>Parquet download failed: {dlJob.error || 'unknown error'}</span>}
                                {(dlJob.status === 'queued' || dlJob.status === 'running') && (
                                    <span>
                                        Parquet {dlJob.current || 0}/{dlJob.total || '?'}
                                        {dlJob.current_symbol ? ` — ${dlJob.current_symbol}` : ''}
                                    </span>
                                )}
                            </div>
                            {(dlJob.status === 'queued' || dlJob.status === 'running') && dlJob.total > 0 && (
                                <div className="uni-dl-banner__bar">
                                    <span style={{ width: `${Math.min(100, Math.round((100 * (dlJob.current || 0)) / dlJob.total))}%` }} />
                                </div>
                            )}
                            {(dlJob.status === 'completed' || dlJob.status === 'failed') && (
                                <button type="button" className="uni-dl-banner__dismiss" onClick={() => setDlJob((p) => ({ ...p, status: 'dismissed' }))}>Dismiss</button>
                            )}
                        </div>
                    )}

                    {fullDataJob && fullDataJob.status !== 'dismissed' && (
                        <div className={`uni-dl-banner uni-dl-banner--full ${fullDataJob.status === 'failed' ? 'uni-dl-banner--fail' : ''} ${fullDataJob.status === 'completed' ? 'uni-dl-banner--done' : ''}`}>
                            <div className="uni-dl-banner__text">
                                {fullDataJob.contextLabel && (fullDataJob.status === 'queued' || fullDataJob.status === 'running') && (
                                    <span className="uni-dl-banner__ctx">{fullDataJob.contextLabel} · </span>
                                )}
                                {fullDataJob.status === 'completed' && (
                                    <span>
                                        Full data job complete — {fullDataJob.stats?.successful ?? 0} ok, {fullDataJob.stats?.failed ?? 0} failed
                                        {fullDataJob.stats?.matches != null ? ` · ${fullDataJob.stats.matches} fork matches` : ''}.
                                    </span>
                                )}
                                {fullDataJob.status === 'failed' && <span>Full data job failed: {fullDataJob.error || 'unknown error'}</span>}
                                {(fullDataJob.status === 'queued' || fullDataJob.status === 'running') && (
                                    <span>
                                        SQLite + intraday {fullDataJob.current || 0}/{fullDataJob.total || '?'}
                                        {fullDataJob.current_symbol ? ` — ${fullDataJob.current_symbol}` : ''}
                                    </span>
                                )}
                            </div>
                            {(fullDataJob.status === 'queued' || fullDataJob.status === 'running') && fullDataJob.total > 0 && (
                                <div className="uni-dl-banner__bar">
                                    <span style={{ width: `${Math.min(100, Math.round((100 * (fullDataJob.current || 0)) / fullDataJob.total))}%` }} />
                                </div>
                            )}
                            {(fullDataJob.status === 'completed' || fullDataJob.status === 'failed') && (
                                <button type="button" className="uni-dl-banner__dismiss" onClick={() => setFullDataJob((p) => ({ ...p, status: 'dismissed' }))}>Dismiss</button>
                            )}
                        </div>
                    )}

                    {/* Toolbar */}
                    <div className="uni-explorer-bar">
                        <div className="uni-explorer-controls">
                            <div className="uni-ctrl-group">
                                <label className="uni-ctrl-label">Group by</label>
                                <div className="uni-chip-set">
                                    {['category', 'industry', 'asset-type'].map((g) => (
                                        <button
                                            key={g}
                                            type="button"
                                            className={`uni-ctrl-chip ${groupMode === g ? 'uni-ctrl-chip--active' : ''}`}
                                            onClick={() => setGroupMode(g)}
                                        >
                                            {g === 'asset-type' ? 'Type' : g.charAt(0).toUpperCase() + g.slice(1)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="uni-ctrl-group">
                                <label className="uni-ctrl-label">Industry</label>
                                <select className="md-select-inline uni-ctrl-select" value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)}>
                                    {industryOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                                </select>
                            </div>
                            <div className="uni-ctrl-group">
                                <label className="uni-ctrl-label">View</label>
                                <div className="uni-chip-set">
                                    <button type="button" className={`uni-ctrl-chip ${viewStyle === 'list' ? 'uni-ctrl-chip--active' : ''}`} onClick={() => setViewStyle('list')}>List</button>
                                    <button type="button" className={`uni-ctrl-chip ${viewStyle === 'card' ? 'uni-ctrl-chip--active' : ''}`} onClick={() => setViewStyle('card')}>Card</button>
                                </div>
                            </div>
                            {selectedSymbols.size > 0 && (
                                <div className="uni-ctrl-group uni-ctrl-group--actions">
                                    <button
                                        type="button"
                                        className="md-btn md-btn--small uni-dl-btn"
                                        disabled={jobsRunning}
                                        onClick={startBatchDownload}
                                    >
                                        Download selected ({selectedSymbols.size})
                                    </button>
                                    <button type="button" className="md-btn md-btn--small md-btn--ghost" onClick={clearSelection}>
                                        Clear
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Section chips */}
                    {filteredSections.length > 4 && (
                        <div className="uni-section-chips">
                            {filteredSections.slice(0, 12).map(({ label, symbols }) => (
                                <button
                                    key={label}
                                    type="button"
                                    className="uni-section-chip"
                                    onClick={() => {
                                        const el = document.getElementById(`uni-sect-${label.replace(/\W/g, '_')}`);
                                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                    }}
                                >
                                    {label} ({symbols.length})
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Empty state */}
                    {!filteredSections.length && (
                        <div className="mdl-card uni-empty-card">
                            <h2>No instruments match</h2>
                            <p>Try clearing search, changing asset type, or switching grouping mode.</p>
                        </div>
                    )}

                    {/* Sections */}
                    {filteredSections.map(({ label, symbols, categoryKey }) => {
                        const limit = visibleSections[label] || 30;
                        return (
                            <section key={label} id={`uni-sect-${label.replace(/\W/g, '_')}`} className="uni-section">
                                <div className="mdl-card uni-section-card">
                                    <div className="uni-section-head">
                                        <div>
                                            <h2 className="uni-section-title">{label}</h2>
                                            <span className="uni-section-count">{symbols.length} instruments</span>
                                        </div>
                                        <div className="uni-section-actions">
                                            {categoryKey && (
                                                <>
                                                    <button
                                                        type="button"
                                                        className="md-btn md-btn--small uni-section-dl"
                                                        title="Yahoo Finance → local Parquet (15m, 1h, 1d, 1wk max periods)"
                                                        disabled={jobsRunning}
                                                        onClick={() => startCategoryParquetDownload(categoryKey, label)}
                                                    >
                                                        Download all instruments
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="md-btn md-btn--small uni-section-dl uni-section-dl--full"
                                                        title="Full history to SQLite + intraday where Yahoo allows; runs pitchfork scan per symbol"
                                                        disabled={jobsRunning}
                                                        onClick={() => startCategoryFullDataDownload(categoryKey, label, symbols.length)}
                                                    >
                                                        Download all data
                                                    </button>
                                                </>
                                            )}
                                            {symbols.length > limit && (
                                                <button
                                                    type="button"
                                                    className="md-btn md-btn--small"
                                                    onClick={() => setVisibleSections((prev) => ({ ...prev, [label]: (prev[label] || 30) + 30 }))}
                                                >
                                                    Show more
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {viewStyle === 'list' ? (
                                        <div className="uni-list-wrap">
                                            <table className="uni-list-table uni-list-table--full">
                                                <thead>
                                                    <tr>
                                                        <th className="uni-th-chk">
                                                            <input
                                                                type="checkbox"
                                                                checked={symbols.slice(0, limit).length > 0 && symbols.slice(0, limit).every((s) => selectedSymbols.has(s))}
                                                                onChange={() => toggleSectionAll(symbols.slice(0, limit))}
                                                            />
                                                        </th>
                                                        <th>Symbol</th>
                                                        <th>Name</th>
                                                        <th>Type</th>
                                                        <th className="uni-th-r">Price</th>
                                                        <th className="uni-th-r">Chg</th>
                                                        <th className="uni-th-r">Chg %</th>
                                                        <th>Sector</th>
                                                        <th>Industry</th>
                                                        <th>Exchange</th>
                                                        <th>Country</th>
                                                        <th className="uni-th-r">Mkt Cap</th>
                                                        <th className="uni-th-r">Volume</th>
                                                        <th className="uni-th-r">52W H</th>
                                                        <th className="uni-th-r">52W L</th>
                                                        <th className="uni-th-r">P/E</th>
                                                        <th></th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {symbols.slice(0, limit).map((s) => {
                                                        const snap = assetSnapshots[s];
                                                        const loading = !snap;
                                                        const up = (snap?.changePct || 0) >= 0;
                                                        const checked = selectedSymbols.has(s);
                                                        return (
                                                            <tr key={s} className={`uni-list-row ${loading ? 'uni-list-row--loading' : ''} ${checked ? 'uni-list-row--selected' : ''}`} onClick={() => handleOpen(s)} role="button" tabIndex={0}>
                                                                <td className="uni-list-chk" onClick={(e) => e.stopPropagation()}>
                                                                    <input type="checkbox" checked={checked} onChange={() => toggleSelect(s)} />
                                                                </td>
                                                                <td className="uni-list-sym">{s}</td>
                                                                <td className="uni-list-name">{snap?.name || '…'}</td>
                                                                <td className="uni-list-type">
                                                                    <span className="uni-type-badge">{ASSET_TYPE_ICONS[deriveAssetType(snap)] || '…'}</span>
                                                                </td>
                                                                <td className="uni-list-price">
                                                                    {snap?.price != null ? `${snap.currencySymbol}${Number(snap.price).toLocaleString()}` : '--'}
                                                                </td>
                                                                <td className={`uni-list-num ${up ? 'md-text-up' : 'md-text-down'}`}>
                                                                    {snap?.change != null ? `${up ? '+' : ''}${Number(snap.change).toFixed(2)}` : '--'}
                                                                </td>
                                                                <td className={`uni-list-num ${up ? 'md-text-up' : 'md-text-down'}`}>
                                                                    {loading ? '--' : `${up ? '+' : ''}${Number(snap.changePct).toFixed(2)}%`}
                                                                </td>
                                                                <td className="uni-list-dim">{snap?.sector || '--'}</td>
                                                                <td className="uni-list-dim">{snap?.industry || '--'}</td>
                                                                <td className="uni-list-dim">{snap?.marketExchange || '--'}</td>
                                                                <td className="uni-list-dim">{snap?.marketRegion || '--'}</td>
                                                                <td className="uni-list-num">{fmtBig(snap?.marketCap)}</td>
                                                                <td className="uni-list-num">{fmtBig(snap?.volume)}</td>
                                                                <td className="uni-list-num">{snap?.high52 != null ? Number(snap.high52).toLocaleString() : '--'}</td>
                                                                <td className="uni-list-num">{snap?.low52 != null ? Number(snap.low52).toLocaleString() : '--'}</td>
                                                                <td className="uni-list-num">{snap?.peRatio && snap.peRatio !== 'N/A' ? Number(snap.peRatio).toFixed(2) : '--'}</td>
                                                                <td className="uni-list-action">
                                                                    <span className="uni-open-arrow">&rarr;</span>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        <div className="uni-card-grid">
                                            {symbols.slice(0, limit).map((s) => {
                                                const snap = assetSnapshots[s];
                                                const loading = !snap;
                                                const up = (snap?.changePct || 0) >= 0;
                                                return (
                                                    <div key={s} className={`uni-asset-tile ${loading ? 'uni-asset-tile--loading' : ''}`} onClick={() => handleOpen(s)} role="button" tabIndex={0}>
                                                        <div className="uni-tile-head">
                                                            <span className="uni-tile-sym">{s}</span>
                                                            <span className="uni-type-badge">{ASSET_TYPE_ICONS[deriveAssetType(snap)] || '…'}</span>
                                                        </div>
                                                        <div className="uni-tile-name">{snap?.name || 'Loading…'}</div>
                                                        <div className="uni-tile-price-row">
                                                            <span className="uni-tile-price">
                                                                {snap?.price != null ? `${snap.currencySymbol}${Number(snap.price).toLocaleString()}` : '--'}
                                                            </span>
                                                            <span className={`uni-tile-change ${up ? 'md-text-up' : 'md-text-down'}`}>
                                                                {loading ? '--' : `${up ? '+' : ''}${Number(snap.changePct).toFixed(2)}%`}
                                                            </span>
                                                        </div>
                                                        <div className="uni-tile-stats">
                                                            {snap?.marketCap ? <span>MCap {fmtBig(snap.marketCap)}</span> : null}
                                                            {snap?.volume ? <span>Vol {fmtBig(snap.volume)}</span> : null}
                                                            {snap?.peRatio && snap.peRatio !== 'N/A' ? <span>P/E {Number(snap.peRatio).toFixed(1)}</span> : null}
                                                        </div>
                                                        <div className="uni-tile-meta">
                                                            <span>{snap?.sector || snap?.industry || '--'}</span>
                                                            <span>{snap?.marketExchange || '--'}</span>
                                                        </div>
                                                        <div className="uni-tile-meta">
                                                            <span>{snap?.marketRegion || '--'}</span>
                                                            {snap?.high52 != null && <span>52W {Number(snap.low52).toLocaleString()}–{Number(snap.high52).toLocaleString()}</span>}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </section>
                        );
                    })}
                </>
            )}
        </div>
    );
}
