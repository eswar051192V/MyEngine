import React from 'react';

export default function WatchlistAutomationPanel({ state, handlers, activeList, activeLabs, activeCron }) {
    return (
        <div className="wl-automation-grid">
            <div className="mdl-card wl-card wl-card--lab">
                <div className="mdl-card__header">
                    <h2>Research notes · {activeList}</h2>
                </div>
                <div className="md-form-grid">
                    <input
                        className="md-input"
                        placeholder="Symbol"
                        value={state.watchlistLabForm.symbol}
                        onChange={(e) => handlers.setWatchlistLabFormValue('symbol', e.target.value.toUpperCase())}
                    />
                    <select className="md-select-inline" value={state.watchlistLabForm.type} onChange={(e) => handlers.setWatchlistLabFormValue('type', e.target.value)}>
                        <option value="economics">Economics</option>
                        <option value="risk">Risk</option>
                        <option value="valuation">Valuation</option>
                        <option value="event">Event</option>
                        <option value="thesis">Thesis</option>
                    </select>
                    <input className="md-input" placeholder="Title" value={state.watchlistLabForm.title} onChange={(e) => handlers.setWatchlistLabFormValue('title', e.target.value)} />
                    <input
                        className="md-input"
                        placeholder="Notes / hypothesis"
                        value={state.watchlistLabForm.notes}
                        onChange={(e) => handlers.setWatchlistLabFormValue('notes', e.target.value)}
                    />
                </div>
                <div className="md-home-actions">
                    <button type="button" className="md-btn md-btn--small" onClick={() => handlers.addWatchlistLabEntry()}>
                        Add note
                    </button>
                </div>
                <div className="md-home-list">
                    {activeLabs.slice(0, 16).map((x) => (
                        <div key={x.id} className="md-list-item md-list-item--col">
                            <div className="md-home-row">
                                <strong>{x.symbol}</strong>
                                <span>{x.type}</span>
                                <button type="button" className="md-watch-card__rm" onClick={() => handlers.removeWatchlistLabEntry(x.id)} aria-label="Remove note">
                                    ×
                                </button>
                            </div>
                            <span>{x.title}</span>
                            <span className="md-rail__muted">{x.notes || '-'}</span>
                        </div>
                    ))}
                    {!activeLabs.length && <div className="md-empty">No notes yet for this watchlist.</div>}
                </div>
            </div>

            <div className="mdl-card wl-card wl-card--automation">
                <div className="mdl-card__header">
                    <h2>Automation &amp; alerts · {activeList}</h2>
                </div>
                <div className="md-form-grid">
                    <select
                        className="md-select-inline"
                        value={state.watchlistCronForm.category}
                        onChange={(e) => handlers.setWatchlistCronFormValue('category', e.target.value)}
                    >
                        {Object.keys(state.tickersData || {}).map((cat) => (
                            <option key={cat} value={cat}>
                                {state.categoryLabelMap?.[cat] || cat.replace(/_/g, ' ')}
                            </option>
                        ))}
                    </select>
                    <input
                        className="md-input"
                        type="number"
                        min="30"
                        value={state.watchlistCronForm.lookback}
                        onChange={(e) => handlers.setWatchlistCronFormValue('lookback', e.target.value)}
                    />
                    <input
                        className="md-input"
                        placeholder="0 9 * * 1-5"
                        value={state.watchlistCronForm.cron_schedule}
                        onChange={(e) => handlers.setWatchlistCronFormValue('cron_schedule', e.target.value)}
                    />
                    <input className="md-input" placeholder="Note" value={state.watchlistCronForm.note} onChange={(e) => handlers.setWatchlistCronFormValue('note', e.target.value)} />
                </div>
                <div className="md-home-actions">
                    <button type="button" className="md-btn md-btn--small" onClick={() => handlers.createWatchlistCronJob()}>
                        Create cron job
                    </button>
                </div>
                <div className="md-home-list">
                    {activeCron.slice(0, 12).map((c) => (
                        <div key={c.id} className="md-list-item md-list-item--col">
                            <div className="md-home-row">
                                <strong>{c.category}</strong>
                                <span>{c.cron_schedule}</span>
                                <button type="button" className="md-watch-card__rm" onClick={() => handlers.removeWatchlistCronJob(c.id)} aria-label="Remove cron job">
                                    ×
                                </button>
                            </div>
                            <span>
                                Lookback {c.lookback}d · {c.status}
                            </span>
                            <span className="md-rail__muted">{c.note || '-'}</span>
                        </div>
                    ))}
                    {!activeCron.length && <div className="md-empty">No cron jobs configured for this watchlist.</div>}
                </div>
            </div>
        </div>
    );
}
