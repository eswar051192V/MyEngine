import React, { useMemo, useState } from 'react';
import './watchlist.css';
import ServerWatchlistPanel from './ServerWatchlistPanel';
import CustomListsPanel from './CustomListsPanel';
import WatchlistAutomationPanel from './WatchlistAutomationPanel';
import { ResearchMacroLab } from './ResearchMacroLab';
import WatchlistInsights from './WatchlistInsights';

const TABS = [
    { id: 'saved', label: 'Saved (server)' },
    { id: 'custom', label: 'Custom lists' },
    { id: 'automation', label: 'Automation' },
    { id: 'macro', label: 'Macro inputs' },
];

export default function WatchlistsDashboard({ state, handlers, openAnalysisSymbol, apiBase }) {
    const [tab, setTab] = useState('saved');
    const listNames = Object.keys(state.customWatchlists || {});
    const activeList = state.selectedCustomWatchlist || listNames[0] || 'Default';
    const activeSymbols = useMemo(
        () => state.customWatchlists?.[activeList] || [],
        [state.customWatchlists, activeList]
    );
    const presetRows = state.tickerPresets || [];
    const industryListRows = Object.keys(state.autoIndustryWatchlists || {})
        .map((industry) => ({ industry, symbols: state.autoIndustryWatchlists[industry] || [] }))
        .sort((a, b) => b.symbols.length - a.symbols.length);
    const activeLabs = (state.watchlistLabs || []).filter((x) => (x.listName || 'Default') === activeList);
    const activeCron = (state.watchlistCronJobs || []).filter((x) => (x.listName || 'Default') === activeList);
    const portfolioNames = Object.keys(state.portfolios || {});
    const portfolioSymbols = [...new Set((state.selectedPortfolioPositions || []).map((p) => String(p.symbol || '').toUpperCase()).filter(Boolean))];
    const heroMetrics = useMemo(() => {
        const rows = state.watchSummaryRows || [];
        const mf = rows.filter((r) => String(r.instrumentKind || '').toLowerCase() === 'mutual_fund').length;
        return {
            savedCount: (state.watchlistSymbols || []).length,
            customCount: activeSymbols.length,
            mfCount: mf,
            macroRows: (state.macroLabImpactRows || []).length,
        };
    }, [state.watchSummaryRows, state.watchlistSymbols, activeSymbols, state.macroLabImpactRows]);

    const goOpen = (sym) => {
        if (typeof openAnalysisSymbol === 'function') openAnalysisSymbol(sym);
        else handlers.handlePromptSubmit(`$${sym}`);
    };

    return (
        <div className="md-content mw-content mdl-page mdl-page--redesign mdl mdl--dense">
            <header className="md-hero wl-hero mdl-hero">
                <p className="md-hero__label">Watchlists</p>
                <h1 className="md-hero__title">Watchlist command center v2</h1>
                <p className="md-hero__sub">
                    A unified workspace for saved symbols, custom baskets, macro posture, and quick projections. Add listed tickers (stocks, ETFs,
                    MF: schemes, commodity/FX symbols) or manual symbols for private holdings—same asset scope as portfolio segments (metals, real
                    estate, bonds, derivatives, and more).
                </p>
                <div className="mdl-hero-strip">
                    <span className="mdl-pill">Saved: {heroMetrics.savedCount}</span>
                    <span className="mdl-pill">Custom active: {heroMetrics.customCount}</span>
                    <span className="mdl-pill">MF in saved: {heroMetrics.mfCount}</span>
                    <span className="mdl-pill">Macro rows: {heroMetrics.macroRows}</span>
                </div>
            </header>

            <nav className="wl-tabs" role="tablist" aria-label="Watchlist sections">
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={tab === t.id}
                        className={`wl-tab ${tab === t.id ? 'wl-tab--active' : ''}`}
                        onClick={() => setTab(t.id)}
                    >
                        {t.label}
                    </button>
                ))}
            </nav>

            <WatchlistInsights
                apiBase={apiBase}
                tab={tab}
                watchlistSymbols={state.watchlistSymbols}
                activeSymbols={activeSymbols}
                macroLabInputSymbols={state.macroLabInputSymbols}
                watchSummaryRows={state.watchSummaryRows}
                macroLabImpactRows={state.macroLabImpactRows}
            />

            <section className="wl-tab-panels">
                {tab === 'saved' && (
                    <div role="tabpanel" className="wl-tab-panel">
                        <ServerWatchlistPanel state={state} handlers={handlers} />
                    </div>
                )}
                {tab === 'custom' && (
                    <div role="tabpanel" className="wl-tab-panel">
                        <CustomListsPanel
                            state={state}
                            handlers={handlers}
                            listNames={listNames}
                            activeList={activeList}
                            activeSymbols={activeSymbols}
                            presetRows={presetRows}
                            industryListRows={industryListRows}
                            portfolioNames={portfolioNames}
                            portfolioSymbols={portfolioSymbols}
                        />
                    </div>
                )}
                {tab === 'automation' && (
                    <div role="tabpanel" className="wl-tab-panel">
                        <p className="wl-panel__hint wl-automation-hint">
                            Notes and cron jobs are scoped to the <strong>{activeList}</strong> custom list. Switch lists in the Custom lists tab.
                        </p>
                        <WatchlistAutomationPanel state={state} handlers={handlers} activeList={activeList} activeLabs={activeLabs} activeCron={activeCron} />
                    </div>
                )}
                {tab === 'macro' && (
                    <div role="tabpanel" className="wl-tab-panel">
                        <p className="wl-panel__hint">
                            Macro Lab uses your selected input source (custom list, saved watchlist, or portfolio). Refresh macro snapshot after changing inputs on the Research tab or here.
                        </p>
                        <ResearchMacroLab state={state} handlers={handlers} openAnalysisSymbol={goOpen} />
                    </div>
                )}
            </section>
        </div>
    );
}
