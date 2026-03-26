import React, { useMemo } from 'react';

const ResearchMlLab = ({ state, handlers, openAnalysisSymbol }) => {
    const mlRows = useMemo(() => {
        const rows = [...(state.mlResearchRows || [])].filter((row) => !row.error);
        rows.sort((a, b) => {
            const aScore = Math.abs(Number(a.predicted_return_pct || 0)) * Number(a.confidence_pct || 0);
            const bScore = Math.abs(Number(b.predicted_return_pct || 0)) * Number(b.confidence_pct || 0);
            return bScore - aScore;
        });
        return rows;
    }, [state.mlResearchRows]);
    const mlErrors = (state.mlResearchRows || []).filter((row) => row.error);
    const leaders = mlRows.slice(0, 3);
    const bullishCount = mlRows.filter((row) => Number(row.predicted_return_pct || 0) > 0).length;
    const bearishCount = mlRows.filter((row) => Number(row.predicted_return_pct || 0) < 0).length;

    return (
        <section className="md-home-panel research-macro-panel">
            <div className="md-section-head">
                <h2>ML Signal Lab</h2>
                <span>{(state.macroLabInputSymbols || []).length} symbols in scope</span>
            </div>
            <div className="research-macro-toolbar">
                <div className="md-input-group">
                    <label className="md-field-label">Training lookback</label>
                    <input
                        className="md-input"
                        type="number"
                        min="120"
                        max="3650"
                        value={state.mlResearchConfig?.lookbackDays || 365}
                        onChange={(e) => handlers.setMlResearchConfigValue('lookbackDays', e.target.value)}
                    />
                </div>
                <div className="md-input-group">
                    <label className="md-field-label">Forecast horizon</label>
                    <input
                        className="md-input"
                        type="number"
                        min="1"
                        max="20"
                        value={state.mlResearchConfig?.forecastHorizon || 5}
                        onChange={(e) => handlers.setMlResearchConfigValue('forecastHorizon', e.target.value)}
                    />
                </div>
                <div className="md-input-group">
                    <label className="md-field-label">Train window</label>
                    <input
                        className="md-input"
                        type="number"
                        min="60"
                        max="400"
                        value={state.mlResearchConfig?.trainWindow || 160}
                        onChange={(e) => handlers.setMlResearchConfigValue('trainWindow', e.target.value)}
                    />
                </div>
                <div className="md-input-group">
                    <label className="md-field-label">What it does</label>
                    <div className="md-rail__muted">
                        Fits a local linear signal model on daily return, momentum, volatility, and moving-average features.
                    </div>
                </div>
                <button type="button" className="md-btn md-btn--small" onClick={() => handlers.runResearchMl()}>
                    {state.mlResearchLoading ? 'Running ML...' : 'Run ML signals'}
                </button>
            </div>
            <div className="md-home-actions wl-regime-row">
                <div className="wl-regime-pill">Source: {state.macroLabInputMode.replace(/_/g, ' ')}</div>
                <div className="wl-regime-pill">Bullish: {bullishCount}</div>
                <div className="wl-regime-pill">Bearish: {bearishCount}</div>
                <div className="wl-regime-pill">Forecast: {state.mlResearchConfig?.forecastHorizon || 5}d</div>
                <div className="wl-regime-pill">Window: {state.mlResearchConfig?.trainWindow || 160} bars</div>
            </div>
            <div className="md-home-grid" style={{ marginBottom: '12px' }}>
                {leaders.map((row) => (
                    <div key={row.symbol} className="md-home-panel research-ml-card">
                        <div className="md-section-head">
                            <h2>{row.symbol}</h2>
                            <span className={Number(row.predicted_return_pct || 0) >= 0 ? 'md-text-up' : 'md-text-down'}>
                                {Number(row.predicted_return_pct || 0).toFixed(2)}%
                            </span>
                        </div>
                        <div className="md-profile-grid">
                            <div><span>Label</span><strong>{row.label || 'Neutral'}</strong></div>
                            <div><span>Prob up</span><strong>{Number(row.probability_up_pct || 0).toFixed(1)}%</strong></div>
                            <div><span>Confidence</span><strong>{Number(row.confidence_pct || 0).toFixed(1)}%</strong></div>
                            <div><span>20d momentum</span><strong>{Number(row.momentum_20_pct || 0).toFixed(2)}%</strong></div>
                        </div>
                        <div className="md-home-actions">
                            <button type="button" className="md-btn md-btn--small" onClick={() => openAnalysisSymbol(row.symbol)}>Open chart</button>
                        </div>
                    </div>
                ))}
                {!leaders.length && (
                    <div className="md-home-panel research-ml-card research-ml-card--empty">
                        <div className="md-empty">
                            {state.mlResearchLoading ? 'Running ML signal engine...' : 'Run ML signals to score the current watchlist or portfolio universe.'}
                        </div>
                    </div>
                )}
            </div>
            <div className="wl-macro-table-wrap">
                <table className="wl-macro-table research-ml-table">
                    <thead>
                        <tr>
                            <th>Symbol</th>
                            <th>Label</th>
                            <th>Predicted return</th>
                            <th>Prob up</th>
                            <th>Confidence</th>
                            <th>Direction accuracy</th>
                            <th>Volatility</th>
                            <th>20d momentum</th>
                            <th>Samples</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {mlRows.map((row) => (
                            <tr key={row.symbol}>
                                <td>{row.symbol}</td>
                                <td>
                                    <span className={`wl-stance ${row.label === 'Bullish' ? 'wl-stance--up' : row.label === 'Bearish' ? 'wl-stance--down' : ''}`}>
                                        {row.label || 'Neutral'}
                                    </span>
                                </td>
                                <td className={Number(row.predicted_return_pct || 0) >= 0 ? 'md-text-up' : 'md-text-down'}>
                                    {Number(row.predicted_return_pct || 0).toFixed(2)}%
                                </td>
                                <td>{Number(row.probability_up_pct || 0).toFixed(1)}%</td>
                                <td>{Number(row.confidence_pct || 0).toFixed(1)}%</td>
                                <td>{Number(row.direction_accuracy_pct || 0).toFixed(1)}%</td>
                                <td>{Number(row.volatility_pct || 0).toFixed(2)}%</td>
                                <td>{Number(row.momentum_20_pct || 0).toFixed(2)}%</td>
                                <td>{Number(row.training_samples || 0)}/{Number(row.validation_samples || 0)}</td>
                                <td>
                                    <button type="button" className="md-btn md-btn--small" onClick={() => openAnalysisSymbol(row.symbol)}>
                                        Open
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {!mlRows.length && !state.mlResearchLoading && <div className="md-empty">No ML signal rows yet.</div>}
            </div>
            {!!mlErrors.length && (
                <div className="md-home-list" style={{ marginTop: '0.65rem' }}>
                    {mlErrors.slice(0, 8).map((row) => (
                        <div key={`${row.symbol}_err`} className="md-list-item md-list-item--col">
                            <strong>{row.symbol}</strong>
                            <span className="md-rail__muted">{row.error}</span>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
};

export default ResearchMlLab;
