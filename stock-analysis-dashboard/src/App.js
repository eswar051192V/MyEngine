import React, { useCallback, useEffect, useRef, useState } from 'react';
import './styles/design-system.css';
import './styles/shared.css';
import './styles/layout.css';
import useQuantEngine from './hooks/useQuantEngine';
import { API_BASE } from './utils/constants';
import WatchlistsDashboard from './watchlist/WatchlistsDashboard';
import HomeDashboard from './pages/HomeDashboard/HomeDashboard';
import PortfolioDashboard from './pages/PortfolioDashboard/PortfolioDashboard';
import UniversePage from './pages/UniversePage/UniversePage';
import AnalysisPage from './pages/AnalysisPage/AnalysisPage';
import ForksPage from './pages/ForksPage/ForksPage';
import AlertsPage from './pages/AlertsPage/AlertsPage';
import SettingsPage from './pages/SettingsPage/SettingsPage';
import AssetDetailPage from './pages/AssetDetailPage/AssetDetailPage';

function App() {
    const { state, setState, handlers } = useQuantEngine();
    const [module, setModule] = useState('dashboard');
    const [detailSymbol, setDetailSymbol] = useState(null);
    const deepLinkConsumed = useRef(false);

    const switchModule = (next) => {
        setModule(next);
        if (next !== 'asset-detail') setDetailSymbol(null);
        if (next === 'dashboard') setState.setViewMode('home');
        if (next === 'portfolio') setState.setViewMode('home');
        if (next === 'watchlists') setState.setViewMode('home');
        if (next === 'assets') setState.setViewMode('index');
        if (next === 'analysis') setState.setViewMode('terminal');
        if (next === 'forks' || next === 'alerts' || next === 'settings') setState.setViewMode('home');
    };

    const openAnalysisSymbol = async (sym) => {
        await handlers.openTerminal(sym, '1Y');
        switchModule('analysis');
    };

    const openAssetDetail = useCallback((sym) => {
        const s = String(sym || '').trim().toUpperCase();
        if (!s) return;
        setDetailSymbol(s);
        setModule('asset-detail');
    }, []);

    const backToUniverse = useCallback(() => {
        setDetailSymbol(null);
        setModule('assets');
        setState.setViewMode('index');
    }, [setState]);

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
        if (moduleParam === 'asset-detail' && symbol) {
            openAssetDetail(symbol);
            return;
        }
        if (symbol) {
            handlers.openTerminal(symbol, '1Y', forkMode);
            setModule('analysis');
        }
    }, [state.loading, handlers, openAssetDetail]);

    if (state.loading) {
        return <div className="md-loader md-loader--fullscreen">Initializing…</div>;
    }

    return (
        <div className="md-app" data-theme={state.theme}>
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
                            ['forks', 'Pitchforks'],
                            ['alerts', 'Alerts'],
                            ['settings', 'Platform'],
                        ].map(([id, label]) => (
                            <button
                                key={id}
                                type="button"
                                className={`mw-sidebar__link ${module === id || (id === 'assets' && module === 'asset-detail') ? 'mw-sidebar__link--active' : ''}`}
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
                            className="md-select-inline mw-sidebar__theme"
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
                        {module === 'watchlists' && (
                            <WatchlistsDashboard state={state} handlers={handlers} openAnalysisSymbol={openAnalysisSymbol} apiBase={API_BASE} />
                        )}
                {module === 'assets' && (
                            <UniversePage state={state} setState={setState} openAnalysisSymbol={openAnalysisSymbol} openAssetDetail={openAssetDetail} />
                        )}
                        {module === 'asset-detail' && (
                            <AssetDetailPage
                                state={state}
                                handlers={handlers}
                                setState={setState}
                                symbol={detailSymbol}
                                onBack={backToUniverse}
                            />
                        )}
                {module === 'analysis' && (
                            <AnalysisPage state={state} handlers={handlers} setState={setState} openAnalysisSymbol={openAnalysisSymbol} />
                        )}
                        {module === 'forks' && <ForksPage state={state} handlers={handlers} openAnalysisSymbol={openAnalysisSymbol} />}
                        {module === 'alerts' && <AlertsPage />}
                        {module === 'settings' && <SettingsPage state={state} handlers={handlers} />}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default App;
