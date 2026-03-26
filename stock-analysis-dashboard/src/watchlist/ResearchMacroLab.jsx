import React, { useState, useMemo } from 'react';

export function ResearchMacroLab({ state, handlers, openAnalysisSymbol }) {
    const [expandedMacroNotes, setExpandedMacroNotes] = useState({});
    const regime = state.macroLabSnapshot?.regime || {};
    const macroRows = useMemo(() => {
        const rows = [...(state.macroLabImpactRows || [])];
        const key = state.macroLabSort?.key || 'totalScore';
        const dir = state.macroLabSort?.dir || 'desc';
        const getVal = (r) => {
            if (key === 'risk') return Number(r.factors?.risk || 0);
            if (key === 'rates') return Number(r.factors?.rates || 0);
            if (key === 'inflation') return Number(r.factors?.inflation || 0);
            if (key === 'fx') return Number(r.factors?.fx || 0);
            return r[key];
        };
        rows.sort((a, b) => {
            const av = getVal(a);
            const bv = getVal(b);
            if (typeof av === 'string' || typeof bv === 'string') {
                return dir === 'asc' ? String(av || '').localeCompare(String(bv || '')) : String(bv || '').localeCompare(String(av || ''));
            }
            return dir === 'asc' ? Number(av || 0) - Number(bv || 0) : Number(bv || 0) - Number(av || 0);
        });
        return rows.slice(0, 30);
    }, [state.macroLabImpactRows, state.macroLabSort]);
    const topBeneficiaries = [...(state.macroLabImpactRows || [])].sort((a, b) => Number(b.totalScore || 0) - Number(a.totalScore || 0)).slice(0, 3);
    const topHeadwinds = [...(state.macroLabImpactRows || [])].sort((a, b) => Number(a.totalScore || 0) - Number(b.totalScore || 0)).slice(0, 3);
    const toggleMacroNote = (symbol) => {
        const sym = String(symbol || '').toUpperCase();
        setExpandedMacroNotes((prev) => ({ ...prev, [sym]: !prev[sym] }));
    };

    return (
        <section className="mdl-card md-home-panel research-macro-panel wl-macro-embedded">
            <div className="md-section-head">
                <h2>Macro Lab</h2>
                <span>{(state.macroLabInputSymbols || []).length} symbols</span>
            </div>
            <div className="research-macro-toolbar">
                <div className="md-input-group">
                    <label className="md-field-label">Input source</label>
                    <div className="md-home-actions">
                        <button
                            type="button"
                            className={`md-btn md-btn--small ${state.macroLabInputMode === 'custom_watchlist' ? 'md-btn--on' : ''}`}
                            onClick={() => handlers.setMacroLabInputMode('custom_watchlist')}
                        >
                            Custom list
                        </button>
                        <button
                            type="button"
                            className={`md-btn md-btn--small ${state.macroLabInputMode === 'saved_watchlist' ? 'md-btn--on' : ''}`}
                            onClick={() => handlers.setMacroLabInputMode('saved_watchlist')}
                        >
                            Saved watchlist
                        </button>
                        <button
                            type="button"
                            className={`md-btn md-btn--small ${state.macroLabInputMode === 'portfolio' ? 'md-btn--on' : ''}`}
                            onClick={() => handlers.setMacroLabInputMode('portfolio')}
                        >
                            Portfolio
                        </button>
                    </div>
                </div>
                <div className="md-input-group">
                    <label className="md-field-label">Lookback</label>
                    <input
                        className="md-input"
                        type="number"
                        min="90"
                        max="3650"
                        value={state.macroLabConfig?.lookbackDays || 365}
                        onChange={(e) => handlers.setMacroLabLookbackDays(e.target.value)}
                    />
                </div>
                <div className="md-input-group">
                    <label className="md-field-label">Scenario</label>
                    <select className="md-select-inline" value={state.macroLabConfig?.scenario || 'Base'} onChange={(e) => handlers.setMacroLabScenario(e.target.value)}>
                        <option value="Base">Base</option>
                        <option value="Bull">Bull</option>
                        <option value="Bear">Bear</option>
                        <option value="Shock">Shock</option>
                    </select>
                </div>
                <div className="md-input-group">
                    <label className="md-field-label">Risk / Rates / Inflation / FX</label>
                    <div className="research-macro-weights">
                        <input className="md-input" type="number" min="0" max="5" step="0.1" value={state.macroLabConfig?.weights?.risk ?? 1} onChange={(e) => handlers.setMacroLabWeight('risk', e.target.value)} />
                        <input className="md-input" type="number" min="0" max="5" step="0.1" value={state.macroLabConfig?.weights?.rates ?? 1} onChange={(e) => handlers.setMacroLabWeight('rates', e.target.value)} />
                        <input className="md-input" type="number" min="0" max="5" step="0.1" value={state.macroLabConfig?.weights?.inflation ?? 1} onChange={(e) => handlers.setMacroLabWeight('inflation', e.target.value)} />
                        <input className="md-input" type="number" min="0" max="5" step="0.1" value={state.macroLabConfig?.weights?.fx ?? 1} onChange={(e) => handlers.setMacroLabWeight('fx', e.target.value)} />
                    </div>
                </div>
                <button type="button" className="md-btn md-btn--small" onClick={() => handlers.refreshMacroLab()}>
                    {state.macroLabLoading ? 'Refreshing...' : 'Refresh Macro'}
                </button>
            </div>
            <div className="md-home-actions wl-regime-row">
                <div className="wl-regime-pill">Source: {state.macroLabInputMode.replace(/_/g, ' ')}</div>
                <div className="wl-regime-pill">Risk-on: {Number(regime.riskOn || 0).toFixed(2)}</div>
                <div className="wl-regime-pill">Rates pressure: {Number(regime.ratesPressure || 0).toFixed(2)}</div>
                <div className="wl-regime-pill">Inflation pressure: {Number(regime.inflationPressure || 0).toFixed(2)}</div>
                <div className="wl-regime-pill">USD pressure: {Number(regime.usdPressure || 0).toFixed(2)}</div>
            </div>
            <div className="md-home-actions research-macro-symbols">
                {(state.macroLabInputSymbols || []).slice(0, 12).map((sym) => (
                    <button key={sym} type="button" className="md-chip-btn" onClick={() => openAnalysisSymbol(sym)}>
                        {sym}
                    </button>
                ))}
                {!(state.macroLabInputSymbols || []).length && <div className="md-empty">Choose a watchlist or portfolio input to populate the lab.</div>}
            </div>
            <div className="md-home-grid" style={{ marginBottom: '12px' }}>
                <div className="md-home-panel">
                    <div className="md-section-head">
                        <h2>Top beneficiaries</h2>
                    </div>
                    <div className="md-home-list">
                        {topBeneficiaries.map((r) => (
                            <div key={r.symbol} className="md-list-item">
                                <strong>{r.symbol}</strong>
                                <span className="md-text-up">{Number(r.totalScore || 0).toFixed(2)}</span>
                            </div>
                        ))}
                        {!topBeneficiaries.length && <div className="md-empty">No beneficiaries yet.</div>}
                    </div>
                </div>
                <div className="md-home-panel">
                    <div className="md-section-head">
                        <h2>Top headwinds</h2>
                    </div>
                    <div className="md-home-list">
                        {topHeadwinds.map((r) => (
                            <div key={r.symbol} className="md-list-item">
                                <strong>{r.symbol}</strong>
                                <span className="md-text-down">{Number(r.totalScore || 0).toFixed(2)}</span>
                            </div>
                        ))}
                        {!topHeadwinds.length && <div className="md-empty">No headwinds yet.</div>}
                    </div>
                </div>
            </div>
            <div className="wl-macro-table-wrap">
                <table className="wl-macro-table">
                    <thead>
                        <tr>
                            <th>
                                <button type="button" className="wl-th-btn" onClick={() => handlers.setMacroLabSort('symbol')}>
                                    Symbol
                                </button>
                            </th>
                            <th>Stance</th>
                            <th>
                                <button type="button" className="wl-th-btn" onClick={() => handlers.setMacroLabSort('totalScore')}>
                                    Total
                                </button>
                            </th>
                            <th>
                                <button type="button" className="wl-th-btn" onClick={() => handlers.setMacroLabSort('risk')}>
                                    Risk
                                </button>
                            </th>
                            <th>
                                <button type="button" className="wl-th-btn" onClick={() => handlers.setMacroLabSort('rates')}>
                                    Rates
                                </button>
                            </th>
                            <th>
                                <button type="button" className="wl-th-btn" onClick={() => handlers.setMacroLabSort('inflation')}>
                                    Inflation
                                </button>
                            </th>
                            <th>
                                <button type="button" className="wl-th-btn" onClick={() => handlers.setMacroLabSort('fx')}>
                                    FX
                                </button>
                            </th>
                            <th>
                                <button type="button" className="wl-th-btn" onClick={() => handlers.setMacroLabSort('confidence')}>
                                    Confidence
                                </button>
                            </th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {macroRows.map((r) => (
                            <tr key={r.symbol}>
                                <td>{r.symbol}</td>
                                <td>
                                    <span className={`wl-stance ${r.stance === 'Beneficiary' ? 'wl-stance--up' : r.stance === 'Headwind' ? 'wl-stance--down' : ''}`}>{r.stance}</span>
                                </td>
                                <td>{Number(r.totalScore || 0).toFixed(2)}</td>
                                <td>{Number(r.factors?.risk || 0).toFixed(2)}</td>
                                <td>{Number(r.factors?.rates || 0).toFixed(2)}</td>
                                <td>{Number(r.factors?.inflation || 0).toFixed(2)}</td>
                                <td>{Number(r.factors?.fx || 0).toFixed(2)}</td>
                                <td>{Math.round(100 * Number(r.confidence || 0))}%</td>
                                <td>
                                    <div className="md-home-actions">
                                        <button type="button" className="md-btn md-btn--small" onClick={() => openAnalysisSymbol(r.symbol)}>
                                            Open
                                        </button>
                                        <button type="button" className="md-btn md-btn--small" onClick={() => handlers.generateMacroBrief(r.symbol)}>
                                            {state.macroLabBriefLoading ? 'LLM...' : 'Generate brief'}
                                        </button>
                                        <button type="button" className="md-btn md-btn--small wl-note-toggle" onClick={() => toggleMacroNote(r.symbol)}>
                                            {expandedMacroNotes[r.symbol] ? 'Collapse' : 'Expand'}
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {!macroRows.length && (
                    <div className="md-empty">{state.macroLabLoading ? 'Computing macro impact...' : 'No macro impact rows yet. Choose a watchlist or portfolio input and refresh macro snapshot.'}</div>
                )}
            </div>
            <div className="md-home-list wl-note-grid" style={{ marginTop: '0.6rem' }}>
                {macroRows.slice(0, 6).map((r) => (
                    <div key={`${r.symbol}_note`} className="md-list-item md-list-item--col wl-note-card">
                        <div className="wl-note-head">
                            <strong className="wl-note-symbol">{r.symbol}</strong>
                            <div className="md-home-actions">
                                <span className={`wl-stance ${r.stance === 'Beneficiary' ? 'wl-stance--up' : r.stance === 'Headwind' ? 'wl-stance--down' : ''}`}>{r.stance}</span>
                                <button type="button" className="md-btn md-btn--small wl-note-toggle" onClick={() => toggleMacroNote(r.symbol)}>
                                    {expandedMacroNotes[r.symbol] ? 'Collapse' : 'Expand'}
                                </button>
                            </div>
                        </div>
                        {expandedMacroNotes[r.symbol] ? (
                            <textarea
                                className="md-input wl-note-textarea"
                                placeholder="Macro note / desk comment..."
                                value={state.macroLabNotes?.[r.symbol] || ''}
                                onChange={(e) => handlers.setMacroLabNote(r.symbol, e.target.value)}
                            />
                        ) : (
                            <div className="wl-note-preview">
                                {state.macroLabNotes?.[r.symbol] ? String(state.macroLabNotes[r.symbol]).slice(0, 140) : 'Macro note / desk comment...'}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </section>
    );
}
