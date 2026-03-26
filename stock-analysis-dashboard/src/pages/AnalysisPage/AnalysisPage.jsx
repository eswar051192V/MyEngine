import React, { useCallback, useState } from 'react';
import '../../watchlist/watchlist.css';
import './AnalysisPage.css';
import { ResearchMacroLab } from '../../watchlist/ResearchMacroLab';
import ResearchMlLab from '../../components/ResearchMlLab';
import FundamentalRibbon from '../../components/FundamentalRibbon';
import ChartWorkspace from '../../components/ChartWorkspace';
import PitchforkLabPanel from '../../components/PitchforkLabPanel';
import { formatLargeNumber } from '../../utils/math';

const RESEARCH_TABS = [
    { id: 'macro', label: 'Macro Lab' },
    { id: 'ml', label: 'ML Signals' },
    { id: 'pitchfork', label: 'Pitchfork Scanner' },
    { id: 'chart', label: 'Active Chart' },
];

export default function AnalysisPage({ state, handlers, setState, openAnalysisSymbol }) {
    const [researchTab, setResearchTab] = useState('macro');

    const handleOpenSymbol = useCallback(
        async (sym) => {
            setResearchTab('chart');
            await openAnalysisSymbol(sym);
        },
        [openAnalysisSymbol]
    );

    const pills = (
        <div className="mdl-hero-strip research-lab__strip">
            <span className="mdl-pill">Symbol: {state.selectedTicker || '—'}</span>
            <span className="mdl-pill">Tab: {RESEARCH_TABS.find((t) => t.id === researchTab)?.label}</span>
            <span className="mdl-pill">Watchlist: {(state.watchlistSymbols || []).length} names</span>
        </div>
    );

    return (
        <div className="md-content mw-content research-lab mdl-page mdl-page--redesign mdl mdl--dense">
            <header className="md-hero wl-hero mdl-hero research-lab__hero">
                <p className="md-hero__label">Research</p>
                <h1 className="md-hero__title">Research Lab</h1>
                <p className="md-hero__sub">
                    Macro scenarios, ML signal studies, pitchfork scans, and the active chart share one symbol context. Use the workspace
                    tabs to move between tools; opening a symbol jumps to Active Chart.
                </p>
                {pills}
            </header>

            <nav className="research-lab__tabs" role="tablist" aria-label="Research workspace">
                {RESEARCH_TABS.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={researchTab === t.id}
                        className={`research-lab__tab ${researchTab === t.id ? 'research-lab__tab--active' : ''}`}
                        onClick={() => setResearchTab(t.id)}
                    >
                        {t.label}
                    </button>
                ))}
            </nav>

            <div className="research-lab__body">
                {researchTab === 'macro' && (
                    <div className="research-lab__panel" role="tabpanel">
                        <ResearchMacroLab state={state} handlers={handlers} openAnalysisSymbol={handleOpenSymbol} />
                    </div>
                )}

                {researchTab === 'ml' && (
                    <div className="research-lab__panel" role="tabpanel">
                        <ResearchMlLab state={state} handlers={handlers} openAnalysisSymbol={handleOpenSymbol} />
                    </div>
                )}

                {researchTab === 'pitchfork' && (
                    <div className="research-lab__panel research-lab__panel--pitchfork" role="tabpanel">
                        <PitchforkLabPanel state={state} handlers={handlers} openAnalysisSymbol={handleOpenSymbol} variant="embedded" />
                    </div>
                )}

                {researchTab === 'chart' && (
                    <div className="research-lab__panel research-lab__panel--chart" role="tabpanel">
                        {!state.selectedTicker ? (
                            <div className="mdl-card md-panel research-lab__empty-chart">
                                <h3>Select an asset to start analysis</h3>
                                <p className="md-rail__muted">Pick from your watchlist below or switch to Macro / ML / Pitchfork and open a symbol.</p>
                                <div className="md-grid research-lab__quick-grid">
                                    {(state.watchlistSymbols || []).slice(0, 12).map((s) => (
                                        <button key={s} type="button" className="md-tile" onClick={() => handleOpenSymbol(s)}>
                                            <span className="md-tile__sym">{s}</span>
                                            <span className="md-tile__action">Analyze</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <>
                                <FundamentalRibbon tickerDetails={state.tickerDetails} />
                                <div className="md-content md-content--terminal research-lab__terminal">
                                    <ChartWorkspace state={state} handlers={handlers} setState={setState} />
                                    <aside className="md-rail research-lab__rail">
                                        <div className="md-rail__block">
                                            <div className="md-rail__head">Company profile</div>
                                            <div className="md-rail__body md-rail__body--compact">
                                                <div className="md-profile-title">
                                                    <strong>{state.tickerDetails?.longName || state.tickerDetails?.name || state.selectedTicker}</strong>
                                                    <span>{state.selectedTicker}</span>
                                                </div>
                                                <div className="md-profile-grid">
                                                    <div>
                                                        <span>Market cap</span>
                                                        <strong>
                                                            {state.tickerDetails?.currencySymbol}
                                                            {formatLargeNumber(state.tickerDetails?.marketCap)}
                                                        </strong>
                                                    </div>
                                                    <div>
                                                        <span>P/E</span>
                                                        <strong>{state.tickerDetails?.peRatio ?? 'N/A'}</strong>
                                                    </div>
                                                    <div>
                                                        <span>52W high</span>
                                                        <strong>
                                                            {state.tickerDetails?.currencySymbol}
                                                            {state.tickerDetails?.high52 ?? 'N/A'}
                                                        </strong>
                                                    </div>
                                                    <div>
                                                        <span>52W low</span>
                                                        <strong>
                                                            {state.tickerDetails?.currencySymbol}
                                                            {state.tickerDetails?.low52 ?? 'N/A'}
                                                        </strong>
                                                    </div>
                                                </div>
                                                <div className="md-profile-grid">
                                                    <div>
                                                        <span>Sector</span>
                                                        <strong>{state.tickerDetails?.sector || 'N/A'}</strong>
                                                    </div>
                                                    <div>
                                                        <span>Industry</span>
                                                        <strong>{state.tickerDetails?.industry || 'N/A'}</strong>
                                                    </div>
                                                </div>
                                                <p className="md-rail__muted">Sources: Yahoo Finance fundamentals + Wikipedia reference.</p>
                                                <div className="md-home-actions">
                                                    {state.tickerDetails?.website && (
                                                        <a className="md-link-btn" href={state.tickerDetails.website} target="_blank" rel="noreferrer">
                                                            Website
                                                        </a>
                                                    )}
                                                    {state.tickerDetails?.wikiUrl && (
                                                        <a className="md-link-btn" href={state.tickerDetails.wikiUrl} target="_blank" rel="noreferrer">
                                                            Wikipedia
                                                        </a>
                                                    )}
                                                    {state.tickerDetails?.yahooUrl && (
                                                        <a className="md-link-btn" href={state.tickerDetails.yahooUrl} target="_blank" rel="noreferrer">
                                                            Yahoo quote
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="md-rail__block">
                                            <div className="md-rail__head">Research tools</div>
                                            <div className="md-rail__body md-rail__body--compact">
                                                <div className="md-home-actions">
                                                    <button type="button" className="md-btn md-btn--small" onClick={() => handlers.runContextAgent()}>
                                                        Context AI
                                                    </button>
                                                    <button type="button" className="md-btn md-btn--small" onClick={() => handlers.runConsumerRag()}>
                                                        Consumer Risk RAG
                                                    </button>
                                                    <button type="button" className="md-btn md-btn--small" onClick={() => handlers.addToWatchlist()}>
                                                        Add to watchlist
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="md-rail__block">
                                            <div className="md-rail__head">Options chain</div>
                                            <div className="md-rail__body">
                                                {state.optionsData?.calls?.slice(0, 8).map((call, i) => (
                                                    <div className="md-opt-row" key={i}>
                                                        <span className="md-opt-muted">{call.strike}</span>
                                                        <span className="md-opt-call">{call.lastPrice != null ? Number(call.lastPrice).toFixed(2) : '—'}</span>
                                                    </div>
                                                ))}
                                                {!state.optionsData?.calls?.length && <div className="md-empty">No options data.</div>}
                                            </div>
                                        </div>
                                    </aside>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
