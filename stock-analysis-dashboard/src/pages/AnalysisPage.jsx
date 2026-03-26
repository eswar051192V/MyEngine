import React from 'react';
import { ResearchMacroLab } from '../watchlist/ResearchMacroLab';
import ResearchMlLab from '../components/ResearchMlLab';
import FundamentalRibbon from '../components/FundamentalRibbon';
import ChartWorkspace from '../components/ChartWorkspace';
import { formatLargeNumber } from '../utils/math';

export default function AnalysisPage({ state, handlers, setState, openAnalysisSymbol }) {
    return (
        <div className="md-content mw-content">
            <header className="md-hero">
                <p className="md-hero__label">Research</p>
                <h1 className="md-hero__title">Research Desk</h1>
                <p className="md-hero__sub">Run Macro Lab and ML signal studies on your custom watchlists, saved watchlist, or active portfolio, then open any symbol for full chart analysis.</p>
            </header>
            <ResearchMacroLab state={state} handlers={handlers} openAnalysisSymbol={openAnalysisSymbol} />
            <ResearchMlLab state={state} handlers={handlers} openAnalysisSymbol={openAnalysisSymbol} />
            {!state.selectedTicker ? (
                <div className="md-panel">
                    <h3>Select an asset to start analysis</h3>
                    <p className="md-rail__muted">Go to Universe and open a symbol, or pick from watchlist below.</p>
                    <div className="md-grid">
                        {(state.watchlistSymbols || []).slice(0, 10).map((s) => (
                            <button key={s} type="button" className="md-tile" onClick={() => openAnalysisSymbol(s)}>
                                <span className="md-tile__sym">{s}</span>
                                <span className="md-tile__action">Analyze</span>
                            </button>
                        ))}
                    </div>
                </div>
            ) : (
                <>
                    <FundamentalRibbon tickerDetails={state.tickerDetails} />
                    <div className="md-content md-content--terminal">
                        <ChartWorkspace state={state} handlers={handlers} setState={setState} />
                        <aside className="md-rail">
                            <div className="md-rail__block">
                                <div className="md-rail__head">Company profile</div>
                                <div className="md-rail__body md-rail__body--compact">
                                    <div className="md-profile-title"><strong>{state.tickerDetails?.longName || state.tickerDetails?.name || state.selectedTicker}</strong><span>{state.selectedTicker}</span></div>
                                    <div className="md-profile-grid">
                                        <div><span>Market cap</span><strong>{state.tickerDetails?.currencySymbol}{formatLargeNumber(state.tickerDetails?.marketCap)}</strong></div>
                                        <div><span>P/E</span><strong>{state.tickerDetails?.peRatio ?? 'N/A'}</strong></div>
                                        <div><span>52W high</span><strong>{state.tickerDetails?.currencySymbol}{state.tickerDetails?.high52 ?? 'N/A'}</strong></div>
                                        <div><span>52W low</span><strong>{state.tickerDetails?.currencySymbol}{state.tickerDetails?.low52 ?? 'N/A'}</strong></div>
                                    </div>
                                    <div className="md-profile-grid"><div><span>Sector</span><strong>{state.tickerDetails?.sector || 'N/A'}</strong></div><div><span>Industry</span><strong>{state.tickerDetails?.industry || 'N/A'}</strong></div></div>
                                    <p className="md-rail__muted">Sources: Yahoo Finance fundamentals + Wikipedia reference.</p>
                                    <div className="md-home-actions">
                                        {state.tickerDetails?.website && (<a className="md-link-btn" href={state.tickerDetails.website} target="_blank" rel="noreferrer">Website</a>)}
                                        {state.tickerDetails?.wikiUrl && (<a className="md-link-btn" href={state.tickerDetails.wikiUrl} target="_blank" rel="noreferrer">Wikipedia</a>)}
                                        {state.tickerDetails?.yahooUrl && (<a className="md-link-btn" href={state.tickerDetails.yahooUrl} target="_blank" rel="noreferrer">Yahoo quote</a>)}
                                    </div>
                                </div>
                            </div>
                            <div className="md-rail__block"><div className="md-rail__head">Research tools</div><div className="md-rail__body md-rail__body--compact"><div className="md-home-actions"><button type="button" className="md-btn md-btn--small" onClick={() => handlers.runContextAgent()}>Context AI</button><button type="button" className="md-btn md-btn--small" onClick={() => handlers.runConsumerRag()}>Consumer Risk RAG</button><button type="button" className="md-btn md-btn--small" onClick={() => handlers.addToWatchlist()}>Add to watchlist</button></div></div></div>
                            <div className="md-rail__block"><div className="md-rail__head">Options chain</div><div className="md-rail__body">{state.optionsData?.calls?.slice(0, 8).map((call, i) => (<div className="md-opt-row" key={i}><span className="md-opt-muted">{call.strike}</span><span className="md-opt-call">{call.lastPrice != null ? Number(call.lastPrice).toFixed(2) : '—'}</span></div>))}{!state.optionsData?.calls?.length && <div className="md-empty">No options data.</div>}</div></div>
                        </aside>
                    </div>
                </>
            )}
        </div>
    );
}
