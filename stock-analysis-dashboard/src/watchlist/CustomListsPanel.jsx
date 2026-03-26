import React from 'react';
import { formatSearchResultLabel } from './watchlistUtils';

export default function CustomListsPanel({
    state,
    handlers,
    listNames,
    activeList,
    activeSymbols,
    presetRows,
    industryListRows,
    portfolioNames,
    portfolioSymbols,
}) {
    return (
        <div className="wl-custom-layout wl-custom-page">
            <aside className="mdl-card wl-custom-rail wl-custom-rail-card" aria-label="Custom watchlists">
                <div className="wl-custom-rail__head">
                    <span className="wl-card-eyebrow">Library</span>
                    <h2 className="wl-custom-rail__title">Lists</h2>
                </div>
                <div className="wl-rail-create">
                    <input
                        className="md-input wl-custom-rail__input"
                        placeholder="New list name"
                        value={state.newWatchlistName}
                        onChange={(e) => handlers.setNewWatchlistName(e.target.value)}
                    />
                    <button type="button" className="md-btn md-btn--small wl-custom-rail__create" onClick={() => handlers.createCustomWatchlist()}>
                        Create
                    </button>
                </div>
                <ul className="wl-rail-list">
                    {listNames.map((n) => {
                        const count = (state.customWatchlists?.[n] || []).length;
                        return (
                            <li key={n}>
                                <button
                                    type="button"
                                    className={`wl-rail-item ${activeList === n ? 'wl-rail-item--active' : ''}`}
                                    onClick={() => handlers.setSelectedCustomWatchlist(n)}
                                >
                                    <span className="wl-rail-item__name">{n}</span>
                                    <span className="wl-rail-item__badge">{count}</span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
                <button
                    type="button"
                    className="md-btn md-btn--small md-btn--danger wl-rail-delete wl-custom-rail__delete"
                    disabled={activeList === 'Default'}
                    onClick={() => handlers.deleteCustomWatchlist(activeList)}
                >
                    Delete list
                </button>
            </aside>

            <div className="wl-custom-main">
                <div className="mdl-card wl-card wl-card--list wl-sticky-search wl-list-builder">
                    <div className="mdl-card__header wl-list-builder__header">
                        <div className="wl-list-builder__headline">
                            <span className="wl-card-eyebrow">Active basket</span>
                            <h2>List builder · {activeList}</h2>
                        </div>
                    </div>
                    <div className="wl-list-builder__stats" role="status">
                        <span className="wl-stat-pill">
                            <em>Symbols</em>
                            <strong>{activeSymbols.length}</strong>
                        </span>
                        <span className="wl-stat-pill">
                            <em>Saved server</em>
                            <strong>{(state.watchlistSymbols || []).length}</strong>
                        </span>
                    </div>
                    <div className="md-home-actions wl-search-row wl-list-builder__search">
                        <div className="md-autocomplete wl-autocomplete">
                            <input
                                className="md-input"
                                placeholder="Search tickers, companies, MF schemes (MF:code)…"
                                value={state.watchlistSymbolInput}
                                onChange={(e) => handlers.setWatchlistSymbolInput(e.target.value.toUpperCase())}
                                onFocus={() => handlers.setWatchlistSymbolInput(state.watchlistSymbolInput || '')}
                            />
                            {state.watchlistSearchOpen && (state.watchlistSearchLoading || state.watchlistSearchResults.length > 0) && (
                                <div className="md-autocomplete__menu wl-autocomplete__menu">
                                    {state.watchlistSearchLoading ? (
                                        <div className="md-autocomplete__item">Searching instruments...</div>
                                    ) : (
                                        state.watchlistSearchResults.map((r) => {
                                            const { title, meta } = formatSearchResultLabel(r);
                                            return (
                                                <button
                                                    key={`${r.symbol}_${r.exchange}_${r.source}`}
                                                    type="button"
                                                    className="md-autocomplete__item wl-ac-item"
                                                    onClick={() => handlers.addSearchResultToWatchlist(r)}
                                                >
                                                    <span className="wl-ac-item__title">
                                                        <strong>{r.symbol}</strong>
                                                        <span className="wl-ac-item__name">{title}</span>
                                                    </span>
                                                    <span className="wl-ac-item__meta">{meta}</span>
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                            )}
                        </div>
                        <button type="button" className="md-btn md-btn--small" onClick={() => handlers.addSymbolToCustomWatchlist()}>
                            Add
                        </button>
                        <button
                            type="button"
                            className="md-btn md-btn--small md-btn--danger"
                            onClick={() => {
                                if (window.confirm(`Clear all symbols from “${activeList}”?`)) {
                                    handlers.clearCustomWatchlist(activeList);
                                }
                            }}
                        >
                            Clear list
                        </button>
                    </div>
                    <div className="md-home-list wl-list-builder__rows">
                        {activeSymbols.map((sym) => (
                            <div key={sym} className="md-list-item md-list-item--col wl-symbol-row wl-symbol-tile">
                                <div className="md-home-row">
                                    <button type="button" className="md-home-row__symbol" onClick={() => handlers.handlePromptSubmit(`$${sym}`)}>
                                        {sym}
                                    </button>
                                    <span className="md-rail__muted">
                                        {state.watchlistSymbolMeta?.[sym]?.industry || state.watchlistSymbolMeta?.[sym]?.assetFamily || '—'}
                                    </span>
                                </div>
                                <div className="md-home-actions">
                                    <button type="button" className="md-btn md-btn--small" onClick={() => handlers.engageWatchlistLlm(sym, 'analyze')}>
                                        Analyze
                                    </button>
                                    <button type="button" className="md-btn md-btn--small" onClick={() => handlers.engageWatchlistLlm(sym, 'review')}>
                                        Review
                                    </button>
                                    <button type="button" className="md-btn md-btn--small" onClick={() => handlers.setWatchlistLabFormValue('symbol', sym)}>
                                        Add note
                                    </button>
                                    <button type="button" className="md-watch-card__rm" onClick={() => handlers.removeSymbolFromCustomWatchlist(activeList, sym)} aria-label={`Remove ${sym}`}>
                                        ×
                                    </button>
                                </div>
                            </div>
                        ))}
                        {!activeSymbols.length && (
                            <div className="wl-empty-state" role="status">
                                <p className="wl-empty-state__title">No symbols yet</p>
                                <p className="wl-empty-state__sub">Search above to add tickers, funds, or FX pairs to this list.</p>
                            </div>
                        )}
                    </div>
                </div>

                <div className="mdl-card wl-card wl-card--presets wl-presets-panel">
                    <div className="mdl-card__header wl-presets-panel__header">
                        <div>
                            <span className="wl-card-eyebrow">Baskets</span>
                            <h2>Market presets</h2>
                        </div>
                    </div>
                    <div className="wl-presets-stack">
                        {presetRows.map((preset) => (
                            <article key={preset.id} className="wl-preset-card">
                                <header className="wl-preset-card__head">
                                    <strong className="wl-preset-card__title">{preset.label}</strong>
                                    <span className="wl-preset-card__count">{preset.count} symbols</span>
                                </header>
                                <p className="wl-preset-card__desc">{preset.description}</p>
                                <div className="wl-preset-card__chips">
                                    {(preset.symbols || []).slice(0, 8).map((sym) => (
                                        <button key={sym} type="button" className="wl-preset-chip" onClick={() => handlers.handlePromptSubmit(`$${sym}`)}>
                                            {sym}
                                        </button>
                                    ))}
                                </div>
                                <div className="wl-preset-card__actions">
                                    <button type="button" className="md-btn md-btn--small wl-preset-card__add" onClick={() => handlers.addPresetToCustomWatchlist(preset)}>
                                        Add to {activeList}
                                    </button>
                                </div>
                            </article>
                        ))}
                        {!presetRows.length && (
                            <div className="wl-empty-state wl-empty-state--compact">
                                <p className="wl-empty-state__title">No presets loaded</p>
                                <p className="wl-empty-state__sub">Preset baskets appear when backend ticker metadata is available.</p>
                            </div>
                        )}
                    </div>
                </div>

                <div className="mdl-card wl-card wl-card--sources wl-sources-panel">
                    <div className="mdl-card__header">
                        <div>
                            <span className="wl-card-eyebrow">Bulk add</span>
                            <h2>Import sources</h2>
                        </div>
                    </div>
                    <div className="wl-source-grid">
                        <article className="wl-source-card">
                            <h3 className="wl-source-card__title">Saved server watchlist</h3>
                            <p className="wl-source-card__meta">{(state.watchlistSymbols || []).length} symbols · merge into {activeList}</p>
                            <button
                                type="button"
                                className="md-btn md-btn--small wl-source-card__btn"
                                onClick={() => handlers.importSymbolsToCustomWatchlist(state.watchlistSymbols, activeList)}
                            >
                                Import watchlist
                            </button>
                        </article>
                        <article className="wl-source-card">
                            <h3 className="wl-source-card__title">Active portfolio</h3>
                            <div className="wl-source-card__row">
                                <select className="md-select-inline wl-source-card__select" value={state.selectedPortfolio} onChange={(e) => handlers.setSelectedPortfolio(e.target.value)}>
                                    {portfolioNames.map((p) => (
                                        <option key={p} value={p}>
                                            {p}
                                        </option>
                                    ))}
                                </select>
                                <button type="button" className="md-btn md-btn--small" onClick={() => handlers.importSymbolsToCustomWatchlist(portfolioSymbols, activeList)}>
                                    Import holdings
                                </button>
                            </div>
                            <div className="wl-preset-card__chips wl-source-card__chips">
                                {portfolioSymbols.slice(0, 8).map((sym) => (
                                    <button key={sym} type="button" className="wl-preset-chip" onClick={() => handlers.handlePromptSubmit(`$${sym}`)}>
                                        {sym}
                                    </button>
                                ))}
                            </div>
                            {!portfolioSymbols.length && <p className="wl-source-card__empty">No holdings in this portfolio yet.</p>}
                        </article>
                    </div>
                </div>

                <div className="mdl-card wl-card wl-card--industry wl-industry-panel">
                    <div className="mdl-card__header">
                        <div>
                            <span className="wl-card-eyebrow">Discovery</span>
                            <h2>Auto industry baskets</h2>
                        </div>
                    </div>
                    <div className="wl-industry-stack">
                        {industryListRows.slice(0, 8).map((row) => (
                            <article key={row.industry} className="wl-industry-card">
                                <div className="wl-industry-card__head">
                                    <strong>{row.industry}</strong>
                                    <span className="wl-industry-card__count">{row.symbols.length} symbols</span>
                                </div>
                                <div className="wl-preset-card__chips">
                                    {row.symbols.slice(0, 5).map((s) => (
                                        <button key={s} type="button" className="wl-preset-chip" onClick={() => handlers.engageWatchlistLlm(s, 'review')}>
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            </article>
                        ))}
                        {!industryListRows.length && (
                            <div className="wl-empty-state wl-empty-state--compact">
                                <p className="wl-empty-state__title">No industry clusters yet</p>
                                <p className="wl-empty-state__sub">Add symbols to your lists to auto-generate industry groupings.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
