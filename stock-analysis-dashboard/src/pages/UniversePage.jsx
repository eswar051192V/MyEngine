import React, { useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../utils/constants';

export default function UniversePage({ state, setState, openAnalysisSymbol }) {
    const [assetSnapshots, setAssetSnapshots] = useState({});
    const [assetLoadState, setAssetLoadState] = useState({ phase: 'idle', loaded: 0, total: 0, current: '' });
    const [assetIndustryFilter, setAssetIndustryFilter] = useState('All');
    const [assetGroupMode, setAssetGroupMode] = useState('category');
    const [assetVisibleSections, setAssetVisibleSections] = useState({});

    const indexCategories = useMemo(() => {
        const result = [];
        Object.keys(state.tickersData).forEach((cat) => {
            const filtered = state.tickersData[cat].filter((t) => t.toUpperCase().includes(state.searchTerm));
            if (filtered.length > 0) result.push({ cat, filtered });
        });
        return result;
    }, [state.tickersData, state.searchTerm]);

    const visibleAssetSymbols = useMemo(
        () => indexCategories.flatMap(({ filtered }) => filtered).slice(0, 240),
        [indexCategories]
    );

    useEffect(() => {
        setAssetVisibleSections({});
    }, [state.searchTerm, assetIndustryFilter, assetGroupMode]);

    useEffect(() => {
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
            const batchSize = 12;
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
    }, [visibleAssetSymbols, assetSnapshots]);

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

    return (
        <div className="md-content mw-content mdl-page mdl-page--redesign mdl mdl--dense uni-page">
            <header className="md-hero wl-hero mdl-hero uni-hero">
                <p className="md-hero__label">Universe</p>
                <h1 className="md-hero__title">Instrument universe</h1>
                <p className="md-hero__sub">
                    Grouped India and global coverage with async Yahoo snapshots; filter by industry, group by category or industry, and open any symbol for research.
                </p>
                <input
                    className="md-search"
                    placeholder="Search symbol..."
                    value={state.searchInput}
                    onChange={(e) => setState.setSearchInput(e.target.value)}
                />
                <div className="mdl-kpi-grid uni-kpi">
                    <div className="mdl-metric"><span>Visible</span><strong>{assetOverview.visible}</strong><small>After search & filters</small></div>
                    <div className="mdl-metric"><span>Loaded</span><strong>{assetOverview.loaded}</strong><small>Snapshots cached</small></div>
                    <div className="mdl-metric"><span>Families</span><strong>{assetOverview.familyCount}</strong><small>In view</small></div>
                    <div className="mdl-metric"><span>Proxy</span><strong>{assetOverview.proxyCount}</strong><small>Mapped names</small></div>
                </div>
                <div className="mdl-card uni-progress-card">
                    <div className="mdl-card__header"><h2>Snapshot load</h2><span className="uni-progress-meta">{assetLoadState.current || 'Ready'}</span></div>
                    <div className="mw-universe-progress">
                        <div className="mw-universe-progress__row">
                            <strong>{assetLoadState.phase === 'loading' ? `Loading ${assetLoadState.loaded}/${assetLoadState.total}` : assetLoadState.phase === 'complete' ? 'Snapshots loaded' : 'Snapshots idle'}</strong>
                            <span>{assetLoadState.phase === 'loading' ? 'Batching ticker calls' : 'Idle'}</span>
                        </div>
                        <div className="mw-universe-progress__bar">
                            <span style={{ width: `${assetLoadState.total ? Math.min(100, Math.round((assetLoadState.loaded / assetLoadState.total) * 100)) : 0}%` }} />
                        </div>
                    </div>
                </div>
                <div className="wl-toolbar uni-toolbar">
                    <div className="md-input-group">
                        <label className="md-field-label">Industry filter</label>
                        <select className="md-select-inline" value={assetIndustryFilter} onChange={(e) => setAssetIndustryFilter(e.target.value)}>
                            {assetIndustryOptions.map((o) => (<option key={o} value={o}>{o}</option>))}
                        </select>
                    </div>
                    <div className="md-input-group">
                        <label className="md-field-label">Grouping</label>
                        <div className="wl-chip-group">
                            <button type="button" className={`wl-chip ${assetGroupMode === 'category' ? 'wl-chip--on' : ''}`} onClick={() => setAssetGroupMode('category')}>By category</button>
                            <button type="button" className={`wl-chip ${assetGroupMode === 'industry' ? 'wl-chip--on' : ''}`} onClick={() => setAssetGroupMode('industry')}>By industry</button>
                        </div>
                    </div>
                </div>
            </header>
            <div className="mw-universe-chipbar uni-chipbar">
                {filteredAssetSections.slice(0, 8).map(({ label, symbols }) => (
                    <button key={label} type="button" className="wl-chip" onClick={() => setAssetVisibleSections((prev) => ({ ...prev, [label]: Math.max(prev[label] || 0, 24) }))}>
                        {label} ({symbols.length})
                    </button>
                ))}
            </div>
            {!filteredAssetSections.length && (
                <div className="mdl-card uni-empty"><div className="mdl-card__header"><h2>No instruments match</h2></div><p className="md-rail__muted wl-panel__hint">Try clearing the search box, setting industry to All, or switching grouping mode.</p></div>
            )}
            {filteredAssetSections.map(({ label, symbols }) => (
                <section key={label} className="uni-section">
                    <div className="mdl-card uni-section-card">
                        <div className="mdl-card__header uni-section-head">
                            <div><h2>{label}</h2><span className="uni-section-count">{symbols.length} symbols</span></div>
                            <div className="mw-universe-section__actions">
                                {symbols.length > (assetVisibleSections[label] || 24) && (
                                    <button type="button" className="md-btn md-btn--small" onClick={() => setAssetVisibleSections((prev) => ({ ...prev, [label]: (prev[label] || 24) + 24 }))}>Show more</button>
                                )}
                            </div>
                        </div>
                        <div className="md-grid mw-assets-grid uni-assets-grid">
                            {symbols.slice(0, assetVisibleSections[label] || 24).map((s) => {
                                const snap = assetSnapshots[s];
                                const isLoading = !snap;
                                return (
                                    <div key={s} className={`md-tile mw-asset-card uni-asset-card ${isLoading ? 'mw-asset-card--loading' : ''}`}>
                                        <button type="button" className="mw-asset-open" onClick={() => openAnalysisSymbol(s)}>Open</button>
                                        <div className="mw-asset-head"><span className="md-tile__sym">{s}</span><span className={`mw-asset-trend ${(snap?.changePct || 0) >= 0 ? 'md-text-up' : 'md-text-down'}`}>{isLoading ? 'Sync' : (snap?.changePct || 0) >= 0 ? 'Up' : 'Down'}</span></div>
                                        <div className="mw-asset-name">{snap?.name || 'Loading market snapshot...'}</div>
                                        <div className="mw-asset-meta"><span className="mw-asset-tag">{snap?.industry || 'Unknown industry'}</span>{snap?.assetFamily && <span className="mw-asset-tag mw-asset-tag--soft">{snap.assetFamily}</span>}{snap?.isProxy && <span className="mw-asset-tag mw-asset-tag--proxy">Proxy</span>}</div>
                                        <div className="mw-asset-price-row"><div className="mw-asset-price">{snap?.price != null ? `${snap?.currencySymbol || '$'}${Number(snap.price).toLocaleString()}` : 'Price: --'}</div><div className={`mw-asset-change ${(snap?.changePct || 0) >= 0 ? 'md-text-up' : 'md-text-down'}`}>{isLoading ? '--' : `${Number(snap?.changePct || 0).toFixed(2)}%`}</div></div>
                                        <div className="mw-asset-updated">{snap?.marketRegion || 'Market'} {snap?.marketExchange ? `· ${snap.marketExchange}` : ''}</div>
                                        <div className="mw-asset-updated">Last updated: {snap?.updatedAt ? new Date(snap.updatedAt).toLocaleTimeString() : '--'}</div>
                                        <div className="mw-asset-actions"><button type="button" className="mw-mini-btn">Buy</button><button type="button" className="mw-mini-btn">Sell</button><button type="button" className="mw-mini-btn">Alert</button><button type="button" className="mw-mini-btn">Compare</button></div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </section>
            ))}
        </div>
    );
}
