import React from 'react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip as ReTooltip,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from 'recharts';
import './HomeDashboard.css';

const HomeDashboard = ({ state, handlers, setState }) => {
    const bullishPct = state.homeStats?.sampleSize
        ? Math.round((100 * (state.homeStats.advancing || 0)) / state.homeStats.sampleSize)
        : 50;
    const marketChartData = (state.homeFocusList || []).slice(0, 8).map((r, idx) => {
        const base = 100 + idx * 0.9;
        const move = Number(r.changePct || 0);
        return {
            m: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'][idx] || `${idx + 1}`,
            sp500: Number((base + move * 0.8).toFixed(2)),
            nasdaq: Number((base + move * 1.05).toFixed(2)),
        };
    });
    const sectorPerformance = [
        {
            name: 'Tech',
            value:
                (state.homeLeaders || [])
                    .slice(0, 2)
                    .reduce((a, r) => a + Number(r.changePct || 0), 0) / Math.max(1, Math.min(2, state.homeLeaders?.length || 0)),
        },
        {
            name: 'Healthcare',
            value: Number((state.homeStats?.avgMove || 0) * 0.65),
        },
        {
            name: 'Energy',
            value:
                (state.homeLaggers || [])
                    .slice(0, 2)
                    .reduce((a, r) => a + Number(r.changePct || 0), 0) / Math.max(1, Math.min(2, state.homeLaggers?.length || 0)),
        },
    ];
    const topMovers = (state.homeLeaders || []).slice(0, 3);
    const majorCards = (state.homeFocusList || []).slice(0, 3);
    const macroRows = [
        { label: 'Gold', value: '$2,055.40', chg: '+0.4%' },
        { label: 'Crude Oil', value: '$76.80', chg: '+1.1%' },
        { label: 'EUR/USD', value: '1.085', chg: '+0.3%' },
    ];

    return (
        <div className="md-content md-content--home">
            <section className="md-market-shell">
                <div className="md-market-header">
                    <div>
                        <p className="md-hero__label">Market monitor</p>
                        <h1 className="md-market-title">Market Overview</h1>
                    </div>
                    <div className="md-home-actions">
                        <button type="button" className="md-btn md-btn--small" onClick={() => setState.setViewMode('index')}>Universe</button>
                        <button type="button" className="md-btn md-btn--small" onClick={() => setState.setViewMode('screener')}>Research</button>
                        <button type="button" className="md-btn md-btn--small" disabled={state.homeLoading} onClick={() => handlers.refreshHomeDashboard()}>
                            {state.homeLoading ? 'Refreshing...' : 'Refresh'}
                        </button>
                        <button type="button" className="md-btn md-btn--small" disabled={state.aiSuggesting} onClick={() => handlers.generateAiSuggestions()}>
                            {state.aiSuggesting ? 'AI...' : 'AI suggestions'}
                        </button>
                        <button type="button" className="md-btn md-btn--small md-btn--danger" disabled={state.maintenanceBusy} onClick={() => handlers.cleanDashboard()}>
                            Clean
                        </button>
                    </div>
                </div>

                <div className="md-market-grid">
                    <div className="md-market-col-left">
                        <div className="md-market-card">
                            <div className="md-market-card__title">Sector Performance</div>
                            {sectorPerformance.map((s) => (
                                <div className="md-market-row" key={s.name}>
                                    <span>{s.name}</span>
                                    <span className={s.value >= 0 ? 'md-text-up' : 'md-text-down'}>
                                        {s.value >= 0 ? '+' : ''}{s.value.toFixed(2)}%
                                    </span>
                                </div>
                            ))}
                        </div>
                        <div className="md-market-card">
                            <div className="md-market-card__title">Top Movers</div>
                            {topMovers.map((m) => (
                                <button className="md-market-row md-market-row--btn" key={m.symbol} onClick={() => handlers.handlePromptSubmit(`$${m.symbol}`)}>
                                    <span>{m.symbol}</span>
                                    <span className="md-text-up">+{Number(m.changePct || 0).toFixed(2)}%</span>
                                </button>
                            ))}
                            {!topMovers.length && <div className="md-empty">No movers yet.</div>}
                        </div>
                    </div>

                    <div className="md-market-col-main">
                        <div className="md-market-card md-market-card--chart">
                            <div className="md-market-card__title">Equity Market Performance</div>
                            <ResponsiveContainer width="100%" height={250}>
                                <LineChart data={marketChartData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--md-chart-grid)" />
                                    <XAxis dataKey="m" tick={{ fill: 'var(--md-faint)', fontSize: 11 }} />
                                    <YAxis tick={{ fill: 'var(--md-faint)', fontSize: 11 }} />
                                    <ReTooltip />
                                    <Legend />
                                    <Line type="monotone" dataKey="sp500" stroke="#60a5fa" strokeWidth={2} dot={false} />
                                    <Line type="monotone" dataKey="nasdaq" stroke="#22c55e" strokeWidth={2} dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="md-market-mini-cards">
                            {majorCards.map((c) => (
                                <button key={c.symbol} className="md-market-mini" onClick={() => handlers.handlePromptSubmit(`$${c.symbol}`)}>
                                    <div className="md-market-mini__sym">{c.symbol}</div>
                                    <div className="md-market-mini__val">{c.currencySymbol}{Number(c.price || 0).toLocaleString()}</div>
                                    <div className={Number(c.changePct || 0) >= 0 ? 'md-text-up' : 'md-text-down'}>
                                        {Number(c.changePct || 0).toFixed(2)}%
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="md-market-col-right">
                        <div className="md-market-card">
                            <div className="md-market-card__title">Market Breadth Sentiment</div>
                            <div className="md-sentiment-ring">
                                <ResponsiveContainer width="100%" height={180}>
                                    <PieChart>
                                        <Pie
                                            data={[
                                                { name: 'Bullish', value: bullishPct },
                                                { name: 'Other', value: Math.max(0, 100 - bullishPct) },
                                            ]}
                                            dataKey="value"
                                            innerRadius={48}
                                            outerRadius={70}
                                        >
                                            <Cell fill="#22c55e" />
                                            <Cell fill="rgba(148,163,184,0.25)" />
                                        </Pie>
                                        <ReTooltip />
                                    </PieChart>
                                </ResponsiveContainer>
                                <div className="md-sentiment-label">
                                    <strong>{bullishPct}%</strong>
                                    <span>{bullishPct >= 55 ? 'Bullish' : bullishPct <= 45 ? 'Bearish' : 'Neutral'}</span>
                                </div>
                            </div>
                        </div>
                        <div className="md-market-card">
                            <div className="md-market-card__title">Commodities, FX & Rates</div>
                            {macroRows.map((r) => (
                                <div className="md-market-row" key={r.label}>
                                    <span>{r.label}</span>
                                    <span>{r.value}</span>
                                    <span className="md-text-up">{r.chg}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            <section className="md-home-grid">
                <div className="md-home-panel">
                    <div className="md-section-head"><h2>Watchlists</h2></div>
                    <p className="md-rail__muted">Watchlist workspace moved to the new `Watchlists` top tab.</p>
                </div>

                <div className="md-home-panel">
                    <div className="md-section-head"><h2>Portfolios</h2></div>
                    <p className="md-rail__muted">
                        Portfolio management moved into the dedicated `Portfolio` tab with backend persistence, richer trade fields, and allocation dashboards.
                    </p>
                    <div className="md-home-summary">
                        <div>Active portfolio: {state.selectedPortfolio || 'Main'}</div>
                        <div>Server sync: {state.portfolioSyncing ? 'In progress' : 'Ready'}</div>
                    </div>
                </div>
            </section>

            <section className="md-home-maintenance">
                <div className="md-home-panel">
                    <div className="md-section-head">
                        <h2>Data operations</h2>
                    </div>
                    <p className="md-rail__muted">
                        Use these only when you want a full reset of local caches/database and a clean redownload.
                    </p>
                    <div className="md-home-actions">
                        <button
                            type="button"
                            className="md-btn md-btn--small md-btn--danger"
                            disabled={state.maintenanceBusy}
                            onClick={() => handlers.nukeLocalData()}
                        >
                            {state.maintenanceBusy ? 'Working...' : 'Nuke local data'}
                        </button>
                        <button
                            type="button"
                            className="md-btn md-btn--small"
                            disabled={state.maintenanceBusy}
                            onClick={() => handlers.resetAndRedownloadAll()}
                        >
                            {state.maintenanceBusy ? 'Working...' : 'Reset + redownload all'}
                        </button>
                    </div>
                    {state.redownloadJob?.job_id && (
                        <div className="md-home-job">
                            <p className="md-home-job__meta">
                                Job {state.redownloadJob.job_id} · {state.redownloadJob.status}
                                {state.redownloadJob.current_symbol ? ` · ${state.redownloadJob.current_symbol}` : ''}
                            </p>
                            {state.redownloadJob.total > 0 && (
                                <>
                                    <div className="md-progress" aria-hidden>
                                        <div
                                            className="md-progress__bar"
                                            style={{
                                                width: `${Math.min(
                                                    100,
                                                    Math.round((100 * (state.redownloadJob.current || 0)) / state.redownloadJob.total)
                                                )}%`,
                                            }}
                                        />
                                    </div>
                                    <p className="md-progress__meta">
                                        {state.redownloadJob.current || 0} / {state.redownloadJob.total}
                                    </p>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </section>

            <section>
                <div className="md-section-head">
                    <h2>Quick access</h2>
                </div>
                <div className="md-grid">
                    {state.homeFocusList.map((row) => (
                        <button key={row.symbol} type="button" className="md-tile" onClick={() => handlers.handlePromptSubmit(`$${row.symbol}`)}>
                            <span className="md-tile__sym">{row.symbol}</span>
                            <span className={`md-tile__action ${row.changePct >= 0 ? 'md-text-up' : 'md-text-down'}`}>
                                {row.changePct.toFixed(2)}%
                            </span>
                        </button>
                    ))}
                    {!state.homeFocusList.length && <div className="md-empty">Loading symbols from market universe...</div>}
                </div>
            </section>
        </div>
    );
};

export default HomeDashboard;
