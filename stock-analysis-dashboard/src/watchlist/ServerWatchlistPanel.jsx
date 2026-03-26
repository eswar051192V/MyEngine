import React, { useEffect, useMemo, useState } from 'react';
import { filterWatchlistRows, sortWatchlistRows, rowInstrumentKind } from './watchlistUtils';

export default function ServerWatchlistPanel({ state, handlers }) {
    const [filter, setFilter] = useState('all');
    const [sortKey, setSortKey] = useState('symbol');
    const [moveTarget, setMoveTarget] = useState(() => state.selectedCustomWatchlist || 'Default');

    useEffect(() => {
        setMoveTarget(state.selectedCustomWatchlist || 'Default');
    }, [state.selectedCustomWatchlist]);

    const listNames = Object.keys(state.customWatchlists || {});

    const visibleRows = useMemo(() => {
        const rows = state.watchSummaryRows || [];
        return sortWatchlistRows(filterWatchlistRows(rows, filter), sortKey);
    }, [state.watchSummaryRows, filter, sortKey]);

    return (
        <div className="wl-panel wl-panel--saved mdl-card">
            <div className="mdl-card__header wl-panel__head">
                <h2>Saved watchlist</h2>
                <span className="md-rail__muted">{state.watchlistLoading ? 'Syncing…' : `${visibleRows.length} shown`}</span>
            </div>
            <p className="wl-panel__hint">
                Server-backed list (synced via API). Use filters and sorting to scan equities, mutual funds (<code>MF:</code>
                ), and other instruments. Move rows into a named custom list for grouping.
            </p>
            <div className="wl-toolbar">
                <div className="wl-chip-group" role="group" aria-label="Filter by instrument type">
                    {[
                        { id: 'all', label: 'All' },
                        { id: 'mf', label: 'Mutual funds' },
                        { id: 'other', label: 'Equities & other' },
                    ].map((c) => (
                        <button
                            key={c.id}
                            type="button"
                            className={`wl-chip ${filter === c.id ? 'wl-chip--on' : ''}`}
                            onClick={() => setFilter(c.id)}
                        >
                            {c.label}
                        </button>
                    ))}
                </div>
                <div className="wl-toolbar__sort">
                    <label className="md-field-label" htmlFor="wl-saved-sort">
                        Sort
                    </label>
                    <select
                        id="wl-saved-sort"
                        className="md-select-inline"
                        value={sortKey}
                        onChange={(e) => setSortKey(e.target.value)}
                    >
                        <option value="symbol">Symbol A–Z</option>
                        <option value="displayName">Name A–Z</option>
                        <option value="updated">News updated</option>
                    </select>
                </div>
            </div>

            <div className="mdl-card__body">
                <div className="wl-table-wrap">
                    <table className="wl-saved-table">
                        <thead>
                            <tr>
                                <th>Symbol</th>
                                <th>Name</th>
                                <th>Type</th>
                                <th>Headline</th>
                                <th className="wl-saved-table__actions">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visibleRows.map((r) => {
                                const kind = rowInstrumentKind(r);
                                const display = r.displayName || r.symbol;
                                return (
                                    <tr key={r.symbol}>
                                        <td>
                                            <button type="button" className="wl-saved-sym" onClick={() => handlers.handlePromptSubmit(`$${r.symbol}`)}>
                                                {r.symbol}
                                            </button>
                                        </td>
                                        <td className="wl-saved-name">{display}</td>
                                        <td>
                                            <span className={`wl-type-tag ${kind === 'mutual_fund' ? 'wl-type-tag--mf' : ''}`}>
                                                {kind === 'mutual_fund' ? 'MF' : r.assetFamily || '—'}
                                            </span>
                                        </td>
                                        <td className="wl-saved-headline">{r.headline || '—'}</td>
                                        <td className="wl-saved-table__actions">
                                            <div className="wl-saved-actions">
                                                <select
                                                    className="md-select-inline wl-saved-move"
                                                    value={moveTarget}
                                                    onChange={(e) => setMoveTarget(e.target.value)}
                                                    aria-label="Target custom list"
                                                >
                                                    {listNames.map((n) => (
                                                        <option key={n} value={n}>
                                                            {n}
                                                        </option>
                                                    ))}
                                                </select>
                                                <button
                                                    type="button"
                                                    className="md-btn md-btn--small"
                                                    onClick={() => handlers.importSymbolsToCustomWatchlist([r.symbol], moveTarget)}
                                                >
                                                    Move
                                                </button>
                                                <button type="button" className="md-btn md-btn--small md-btn--danger" onClick={() => handlers.removeFromWatchlist(r.symbol)}>
                                                    Remove
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {!visibleRows.length && (
                        <div className="md-empty wl-empty">No symbols match this filter, or your saved watchlist is empty.</div>
                    )}
                </div>
            </div>
        </div>
    );
}
