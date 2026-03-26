import React from 'react';
import './PitchforkLabPanel.css';
import ForkChartThumb from './ForkChartThumb';
import { buildForkLink } from '../utils/portfolio';

/**
 * Shared pitchfork scanner UI — used on Research (Analysis) and Pitchforks shortcut routes.
 * @param {'page' | 'embedded'} variant — page: full hero + panel; embedded: section inside Research tabs
 */
export default function PitchforkLabPanel({ state, handlers, openAnalysisSymbol, variant = 'page' }) {
    const embedded = variant === 'embedded';

    const toolbar = (
        <>
            <div className={`research-pf__actions ${embedded ? 'research-pf__actions--embedded' : ''}`}>
                <button type="button" className="md-btn md-btn--small" disabled={state.isScreening} onClick={() => handlers.findForkInAll()}>
                    {state.isScreening ? 'Scanning...' : 'Scan Entire Universe'}
                </button>
                <button
                    type="button"
                    className="md-btn md-btn--small"
                    disabled={state.allDataJob?.status === 'queued' || state.allDataJob?.status === 'running'}
                    onClick={() => handlers.downloadAllAndCalculateForks()}
                >
                    {state.allDataJob?.status === 'queued' || state.allDataJob?.status === 'running' ? 'Downloading...' : 'Download all + calculate'}
                </button>
                <button type="button" className="md-btn md-btn--small" onClick={() => handlers.clearForkScanResults()}>
                    Clear saved
                </button>
            </div>
            <div className="research-pf__meta">
                {state.forkScanMeta?.savedAt ? (
                    <>
                        <span>Last scan: {new Date(state.forkScanMeta.savedAt).toLocaleString()}</span>
                        <span>Scanned: {state.forkScanMeta.totalScanned || 0}</span>
                        <span>Type: {state.forkScanMeta.pitchforkType}</span>
                        <span>Lookback: {state.forkScanMeta.lookback}d</span>
                    </>
                ) : (
                    <span>No saved pitchfork scan yet. Run &quot;Scan Entire Universe&quot;.</span>
                )}
            </div>
            {state.isScreening && (
                <div className="research-pf__meta research-pf__meta--progress">
                    <span>
                        Progress: {state.screenerProgress.current}/{state.screenerProgress.total}
                    </span>
                    <span>Symbol: {state.screenerProgress.symbol || '...'}</span>
                </div>
            )}
            {(state.allDataJob?.status === 'queued' || state.allDataJob?.status === 'running') && (
                <div className="research-pf__meta research-pf__meta--progress">
                    <span>
                        Download+calc: {state.allDataJob?.current || 0}/{state.allDataJob?.total || 0}
                    </span>
                    <span>Symbol: {state.allDataJob?.current_symbol || '...'}</span>
                </div>
            )}
        </>
    );

    const matches = (
        <div className="research-pf__panel">
            <div className="md-section-head research-pf__section-head">
                <h2>Matches</h2>
                <span>{state.forkScanResults.length} results</span>
            </div>
            <div className="research-pf__grid">
                {state.forkScanResults.map((r) => (
                    <div
                        key={`${r.symbol}-${r.fork?.pivotKey || r.fork?.date || 'fork'}`}
                        className="research-pf__card"
                    >
                        <div className="research-pf__card-top">
                            <div className="research-pf__card-title">
                                <div className="md-home-row__headline">{r.symbol}</div>
                                <div className="md-rail__muted research-pf__zone">{r.fork?.zoneLabel || 'Fork zone'}</div>
                            </div>
                            <div
                                className={`md-home-row__price research-pf__score ${
                                    Number(r.fork?.positionPct || 50) >= 80
                                        ? 'md-text-down'
                                        : Number(r.fork?.positionPct || 50) <= 20
                                          ? 'md-text-up'
                                          : ''
                                }`}
                                title="Nearness score"
                            >
                                {(r.fork?.nearnessScore ?? 0).toFixed(3)}
                            </div>
                        </div>
                        <div className="research-pf__card-body">
                            <ForkChartThumb symbol={r.symbol} />
                            <div className="research-pf__card-detail">
                                <div className="md-profile-grid research-pf__profile">
                                    <div>
                                        <span>Type</span>
                                        <strong>
                                            {r.fork?.variation || '-'} {r.fork?.type || ''}
                                        </strong>
                                    </div>
                                    <div>
                                        <span>Pivot</span>
                                        <strong>{r.fork?.date ? new Date(r.fork.date).toLocaleDateString() : 'N/A'}</strong>
                                    </div>
                                    <div>
                                        <span>Inside bars</span>
                                        <strong>
                                            {r.fork?.daysActive ?? 0}/{r.fork?.totalFutureBars ?? 0}
                                        </strong>
                                    </div>
                                    <div>
                                        <span>Position</span>
                                        <strong>{r.fork?.positionPct ?? '0'}%</strong>
                                    </div>
                                    <div>
                                        <span>Status</span>
                                        <strong>{r.fork?.isActive ? 'Active' : 'Watch'}</strong>
                                    </div>
                                    <div>
                                        <span>Containment</span>
                                        <strong>
                                            {r.fork?.encompassesAllFutureOhlc
                                                ? 'OHLC full'
                                                : r.fork?.closeContainedFullHistory
                                                  ? 'Close full'
                                                  : 'Partial'}
                                        </strong>
                                    </div>
                                </div>
                                <div className="md-home-actions research-pf__card-actions">
                                    <button type="button" className="md-btn md-btn--small" onClick={() => openAnalysisSymbol(r.symbol)}>
                                        Open research chart
                                    </button>
                                    <a className="md-link-btn" href={buildForkLink(r.symbol)} target="_blank" rel="noreferrer" title="Direct link to this fork chart">
                                        Direct link
                                    </a>
                                    <button type="button" className="md-btn md-btn--small" onClick={() => handlers.addToWatchlist(r.symbol)}>
                                        Add to watchlist
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
                {!state.forkScanResults.length && <div className="md-empty research-pf__empty">No fork setups saved.</div>}
            </div>
        </div>
    );

    if (embedded) {
        return (
            <section className="research-pf research-pf--embedded mdl-card md-home-panel" aria-label="Pitchfork scanner">
                <div className="mdl-card__header research-pf__embed-head">
                    <div>
                        <h2>Pitchfork Scanner</h2>
                        <p className="md-rail__muted research-pf__embed-sub">Universe scan with persisted matches — open any row in the chart workspace.</p>
                    </div>
                </div>
                {toolbar}
                {matches}
            </section>
        );
    }

    return (
        <div className="research-pf research-pf--page">
            <header className="md-hero research-pf__hero">
                <p className="md-hero__label">Pitchforks</p>
                <h1 className="md-hero__title">Pitchfork Scan Dashboard</h1>
                <p className="md-rail__muted">Persisted scan results across all symbols. Click any row to open full chart analysis.</p>
                {toolbar}
            </header>
            {matches}
        </div>
    );
}
