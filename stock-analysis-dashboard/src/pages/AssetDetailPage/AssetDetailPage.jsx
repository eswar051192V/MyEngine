import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './AssetDetailPage.css';
import '../../watchlist/watchlist.css';
import ChartWorkspace from '../../components/ChartWorkspace';
import { formatLargeNumber } from '../../utils/math';
import { API_BASE } from '../../utils/constants';

const OHLC_VIEW_MODES = [
    { id: 'table', label: 'Table' },
    { id: 'candle', label: 'Candle' },
    { id: 'line', label: 'Line' },
    { id: 'mountain', label: 'Mountain' },
];

const TIMEFRAMES = ['1D', '5D', '1M', '6M', '1Y', '5Y', 'MAX'];

export default function AssetDetailPage({ state, handlers, setState, symbol, onBack }) {
    const [detailTab, setDetailTab] = useState('summary');
    const [ohlcView, setOhlcView] = useState('table');
    const [downloading, setDownloading] = useState(false);
    const [archiving, setArchiving] = useState(false);
    const [downloadMsg, setDownloadMsg] = useState('');
    const [liveQuote, setLiveQuote] = useState(null);
    const refreshRef = useRef(null);
    const [lastRefresh, setLastRefresh] = useState(null);
    const isMF = symbol?.startsWith('MF:');

    const td = state.tickerDetails;

    useEffect(() => {
        if (!symbol) return;
        handlers.openTerminal(symbol, '1Y', false, { skipViewMode: true });
        setLiveQuote(null);
        setLastRefresh(null);
        // handlers is a new object each render from useQuantEngine; depending on it re-runs this effect forever.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbol]);

    useEffect(() => {
        if (!symbol) return;
        const poll = () => {
            fetch(`${API_BASE}/api/ticker/${encodeURIComponent(symbol)}`)
                .then((r) => r.json())
                .then((d) => {
                    if (d && !d.error) {
                        setLiveQuote(d);
                        setLastRefresh(new Date());
                    }
                })
                .catch(() => {});
        };
        poll();
        refreshRef.current = setInterval(poll, 60_000);
        return () => {
            if (refreshRef.current) clearInterval(refreshRef.current);
        };
    }, [symbol]);

    const handleTimeframe = useCallback(
        (tf) => {
            if (!symbol) return;
            handlers.openTerminal(symbol, tf, false, { skipViewMode: true });
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [symbol]
    );

    const handleDownload = useCallback(async () => {
        if (!symbol || downloading) return;
        setDownloading(true);
        setDownloadMsg('');
        try {
            const r = await fetch(`${API_BASE}/api/ticker/${encodeURIComponent(symbol)}/download`, { method: 'POST' });
            const d = await r.json().catch(() => ({}));
            if (r.ok && d && d.status === 'success') {
                const rs = d.records_saved;
                if (rs && typeof rs === 'object' && !Array.isArray(rs)) {
                    const parts = Object.entries(rs)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(', ');
                    setDownloadMsg(parts ? `Saved (${parts})` : 'Download complete');
                } else {
                    setDownloadMsg('Download complete');
                }
            } else {
                setDownloadMsg(d?.error || d?.detail || `Download failed (${r.status})`);
            }
        } catch {
            setDownloadMsg('Download failed');
        } finally {
            setDownloading(false);
        }
    }, [symbol, downloading]);

    const handleArchive = useCallback(async () => {
        if (!symbol || archiving) return;
        setArchiving(true);
        setDownloadMsg('');
        try {
            const r = await fetch(`${API_BASE}/api/ticker/${encodeURIComponent(symbol)}/download-full-db`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            const d = await r.json().catch(() => ({}));
            if (r.ok && d?.ok) {
                const sr = d.saved_rows;
                if (sr && typeof sr === 'object' && !Array.isArray(sr)) {
                    const parts = Object.entries(sr)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(', ');
                    setDownloadMsg(parts ? `Archive saved (${parts})` : (d.note || 'Archive complete'));
                } else {
                    setDownloadMsg(d.note || 'Archive complete');
                }
            } else {
                setDownloadMsg(d?.error || d?.detail || `Archive failed (${r.status})`);
            }
        } catch {
            setDownloadMsg('Archive failed');
        } finally {
            setArchiving(false);
        }
    }, [symbol, archiving]);

    const safeOhlc = useMemo(
        () => {
            const raw = state.ohlcData || [];
            return raw
                .filter((d) => d && d.x != null && Array.isArray(d.y) && d.y.length >= 4)
                .map((d) => ({
                    date: d.x,
                    open: Number(d.y[0]),
                    high: Number(d.y[1]),
                    low: Number(d.y[2]),
                    close: Number(d.y[3]),
                    volume: Number(d.volume || 0),
                }));
        },
        [state.ohlcData]
    );

    const q = liveQuote || td;

    const optCalls = state.optionsData?.calls || [];
    const optPuts = state.optionsData?.puts || [];
    const hasOptions = !isMF && (optCalls.length > 0 || optPuts.length > 0);

    const TABS = useMemo(() => {
        const t = [
            { id: 'summary', label: 'Summary' },
            { id: 'chart', label: 'Chart' },
            { id: 'ohlc', label: 'OHLC Data' },
        ];
        if (hasOptions) t.push({ id: 'options', label: 'Options' });
        t.push({ id: 'download', label: 'Download' });
        return t;
    }, [hasOptions]);

    if (!symbol) {
        return (
            <div className="md-content mw-content mdl-page mdl mdl--dense ad-page">
                <p className="md-rail__muted">No symbol selected.</p>
            </div>
        );
    }

    return (
        <div className="md-content mw-content mdl-page mdl-page--redesign mdl mdl--dense ad-page">
            {/* Back + breadcrumb */}
            <div className="ad-breadcrumb">
                <button type="button" className="ad-back" onClick={onBack}>
                    &larr; Universe
                </button>
                <span className="ad-breadcrumb__sep">/</span>
                <span className="ad-breadcrumb__sym">{symbol}</span>
            </div>

            {td?.error && (
                <div className="mdl-card ad-dl-msg" role="alert" style={{ marginBottom: '0.75rem' }}>
                    <p>{typeof td.error === 'string' ? td.error : 'Could not load ticker details.'}</p>
                </div>
            )}

            {/* Hero quote summary */}
            <header className="mdl-card ad-hero">
                <div className="ad-hero__top">
                    <div className="ad-hero__identity">
                        <h1 className="ad-hero__symbol">{symbol}</h1>
                        <p className="ad-hero__name">{q?.longName || q?.name || symbol}</p>
                        <div className="ad-hero__tags">
                            {q?.sector && <span className="mdl-pill ad-tag">{q.sector}</span>}
                            {q?.industry && <span className="mdl-pill ad-tag">{q.industry}</span>}
                            {q?.assetFamily && <span className="mdl-pill ad-tag">{q.assetFamily}</span>}
                            {q?.marketExchange && <span className="mdl-pill ad-tag">{q.marketExchange}</span>}
                            {q?.marketRegion && <span className="mdl-pill ad-tag">{q.marketRegion}</span>}
                            {isMF && <span className="mdl-pill ad-tag ad-tag--mf">Mutual Fund</span>}
                        </div>
                    </div>
                    <div className="ad-hero__price-block">
                        <div className="ad-hero__price">
                            {q?.currencySymbol || '$'}
                            {q?.price != null ? Number(q.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--'}
                        </div>
                        <div className={`ad-hero__change ${Number(q?.changePct || 0) >= 0 ? 'md-text-up' : 'md-text-down'}`}>
                            {q?.changePct != null ? `${Number(q.changePct) >= 0 ? '+' : ''}${Number(q.changePct).toFixed(2)}%` : '--'}
                        </div>
                        <div className="ad-hero__prev">
                            Prev close: {q?.previousClose != null ? `${q.currencySymbol || '$'}${Number(q.previousClose).toLocaleString()}` : '--'}
                        </div>
                        {lastRefresh && (
                            <div className="ad-hero__refresh">
                                Auto-refresh: {lastRefresh.toLocaleTimeString()}
                            </div>
                        )}
                    </div>
                </div>

                {/* KPI ribbon */}
                <div className="mdl-kpi-grid ad-kpi">
                    <div className="mdl-metric">
                        <span>Market cap</span>
                        <strong>{q?.currencySymbol}{formatLargeNumber(q?.marketCap)}</strong>
                    </div>
                    <div className="mdl-metric">
                        <span>P/E ratio</span>
                        <strong>{q?.peRatio ?? '--'}</strong>
                    </div>
                    <div className="mdl-metric">
                        <span>52W high</span>
                        <strong>{q?.currencySymbol}{q?.high52 ?? '--'}</strong>
                    </div>
                    <div className="mdl-metric">
                        <span>52W low</span>
                        <strong>{q?.currencySymbol}{q?.low52 ?? '--'}</strong>
                    </div>
                    <div className="mdl-metric">
                        <span>Volume</span>
                        <strong>{formatLargeNumber(q?.volume)}</strong>
                    </div>
                    <div className="mdl-metric">
                        <span>Avg volume</span>
                        <strong>{formatLargeNumber(q?.avgVolume)}</strong>
                    </div>
                </div>
            </header>

            {/* Tab nav */}
            <nav className="ad-tabs" role="tablist">
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={detailTab === t.id}
                        className={`ad-tab ${detailTab === t.id ? 'ad-tab--active' : ''}`}
                        onClick={() => setDetailTab(t.id)}
                    >
                        {t.label}
                    </button>
                ))}
            </nav>

            {/* Tab panels */}
            <div className="ad-body">
                {/* ——— SUMMARY ——— */}
                {detailTab === 'summary' && (
                    <div className="ad-panel" role="tabpanel">
                        <div className="ad-summary-grid">
                            {/* Description */}
                            <section className="mdl-card ad-desc-card">
                                <h3 className="ad-section-title">
                                    {q?.wikipediaTitle ? q.wikipediaTitle : 'About'}
                                </h3>
                                <p className="ad-desc-text">
                                    {q?.description || q?.yahooDescription || 'No description available for this instrument.'}
                                </p>
                                {q?.yahooDescription && q?.wikipediaExtract && q.description !== q.yahooDescription && (
                                    <details className="ad-desc-more">
                                        <summary className="ad-desc-more__toggle">Yahoo Finance summary</summary>
                                        <p className="ad-desc-text">{q.yahooDescription}</p>
                                    </details>
                                )}
                                <div className="ad-desc-links">
                                    {q?.website && (
                                        <a className="md-link-btn ad-desc-link" href={q.website} target="_blank" rel="noreferrer">
                                            Website
                                        </a>
                                    )}
                                    {q?.wikiUrl && (
                                        <a className="md-link-btn ad-desc-link" href={q.wikiUrl} target="_blank" rel="noreferrer">
                                            Wikipedia
                                        </a>
                                    )}
                                    {q?.yahooUrl && (
                                        <a className="md-link-btn ad-desc-link" href={q.yahooUrl} target="_blank" rel="noreferrer">
                                            Yahoo Finance
                                        </a>
                                    )}
                                </div>
                            </section>

                            {/* Key statistics */}
                            <section className="mdl-card ad-stats-card">
                                <h3 className="ad-section-title">Key statistics</h3>
                                <div className="ad-stat-list">
                                    <div className="ad-stat-row"><span>Market cap</span><strong>{q?.currencySymbol}{formatLargeNumber(q?.marketCap)}</strong></div>
                                    <div className="ad-stat-row"><span>P/E ratio</span><strong>{q?.peRatio ?? '--'}</strong></div>
                                    <div className="ad-stat-row"><span>EPS</span><strong>{q?.eps ?? '--'}</strong></div>
                                    <div className="ad-stat-row"><span>Dividend yield</span><strong>{q?.dividendYield != null ? `${(Number(q.dividendYield) * 100).toFixed(2)}%` : '--'}</strong></div>
                                    <div className="ad-stat-row"><span>Beta</span><strong>{q?.beta ?? '--'}</strong></div>
                                    <div className="ad-stat-row"><span>52W high</span><strong>{q?.currencySymbol}{q?.high52 ?? '--'}</strong></div>
                                    <div className="ad-stat-row"><span>52W low</span><strong>{q?.currencySymbol}{q?.low52 ?? '--'}</strong></div>
                                    <div className="ad-stat-row"><span>Volume</span><strong>{formatLargeNumber(q?.volume)}</strong></div>
                                    <div className="ad-stat-row"><span>Avg volume</span><strong>{formatLargeNumber(q?.avgVolume)}</strong></div>
                                    <div className="ad-stat-row"><span>Sector</span><strong>{q?.sector || '--'}</strong></div>
                                    <div className="ad-stat-row"><span>Industry</span><strong>{q?.industry || '--'}</strong></div>
                                    <div className="ad-stat-row"><span>Exchange</span><strong>{q?.marketExchange || '--'}</strong></div>
                                </div>
                            </section>

                            {/* Recent news */}
                            {q?.news?.length > 0 && (
                                <section className="mdl-card ad-news-card">
                                    <h3 className="ad-section-title">Recent news</h3>
                                    <div className="ad-news-list">
                                        {q.news.map((n, i) => (
                                            <a key={i} className="ad-news-item" href={n.link} target="_blank" rel="noreferrer">
                                                <strong>{n.title}</strong>
                                                {n.publisher && <span className="ad-news-pub">{n.publisher}</span>}
                                            </a>
                                        ))}
                                    </div>
                                </section>
                            )}
                        </div>

                        {/* Compact chart preview */}
                        <section className="mdl-card ad-chart-preview">
                            <h3 className="ad-section-title">Price chart</h3>
                            <div className="ad-tf-bar">
                                {TIMEFRAMES.map((tf) => (
                                    <button
                                        key={tf}
                                        type="button"
                                        className={`ad-tf-chip ${state.currentTimeframe === tf ? 'ad-tf-chip--active' : ''}`}
                                        onClick={() => handleTimeframe(tf)}
                                    >
                                        {tf}
                                    </button>
                                ))}
                            </div>
                            {state.chartLoading ? (
                                <div className="ad-chart-loading">Loading chart data…</div>
                            ) : (
                                <div className="ad-chart-wrap">
                                    <ChartWorkspace state={state} handlers={handlers} setState={setState} skipViewMode />
                                </div>
                            )}
                        </section>
                    </div>
                )}

                {/* ——— CHART ——— */}
                {detailTab === 'chart' && (
                    <div className="ad-panel ad-panel--chart" role="tabpanel">
                        <div className="mdl-card ad-chart-full">
                            <div className="ad-tf-bar">
                                {TIMEFRAMES.map((tf) => (
                                    <button
                                        key={tf}
                                        type="button"
                                        className={`ad-tf-chip ${state.currentTimeframe === tf ? 'ad-tf-chip--active' : ''}`}
                                        onClick={() => handleTimeframe(tf)}
                                    >
                                        {tf}
                                    </button>
                                ))}
                            </div>
                            {state.chartLoading ? (
                                <div className="ad-chart-loading">Loading chart data…</div>
                            ) : (
                                <div className="ad-chart-wrap ad-chart-wrap--full">
                                    <ChartWorkspace state={state} handlers={handlers} setState={setState} skipViewMode />
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ——— OHLC DATA ——— */}
                {detailTab === 'ohlc' && (
                    <div className="ad-panel" role="tabpanel">
                        <div className="mdl-card ad-ohlc-card">
                            <div className="ad-ohlc-header">
                                <h3 className="ad-section-title">OHLC data</h3>
                                <div className="ad-ohlc-views">
                                    {OHLC_VIEW_MODES.map((v) => (
                                        <button
                                            key={v.id}
                                            type="button"
                                            className={`ad-tf-chip ${ohlcView === v.id ? 'ad-tf-chip--active' : ''}`}
                                            onClick={() => setOhlcView(v.id)}
                                        >
                                            {v.label}
                                        </button>
                                    ))}
                                </div>
                                <div className="ad-tf-bar">
                                    {TIMEFRAMES.map((tf) => (
                                        <button
                                            key={tf}
                                            type="button"
                                            className={`ad-tf-chip ${state.currentTimeframe === tf ? 'ad-tf-chip--active' : ''}`}
                                            onClick={() => handleTimeframe(tf)}
                                        >
                                            {tf}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {ohlcView === 'table' && (
                                <div className="ad-ohlc-table-wrap">
                                    <table className="ad-ohlc-table">
                                        <thead>
                                            <tr>
                                                <th>Date</th>
                                                <th>Open</th>
                                                <th>High</th>
                                                <th>Low</th>
                                                <th>Close</th>
                                                <th>Volume</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {safeOhlc.slice(-200).reverse().map((r, i) => (
                                                <tr key={i}>
                                                    <td>{new Date(r.date).toLocaleDateString()}</td>
                                                    <td>{r.open.toFixed(2)}</td>
                                                    <td>{r.high.toFixed(2)}</td>
                                                    <td>{r.low.toFixed(2)}</td>
                                                    <td className={r.close >= r.open ? 'md-text-up' : 'md-text-down'}>{r.close.toFixed(2)}</td>
                                                    <td>{r.volume.toLocaleString()}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {!safeOhlc.length && <div className="ad-empty">No OHLC data available.</div>}
                                </div>
                            )}

                            {(ohlcView === 'candle' || ohlcView === 'line' || ohlcView === 'mountain') && (
                                <div className="ad-chart-wrap ad-chart-wrap--full">
                                    <ChartWorkspace state={state} handlers={handlers} setState={setState} skipViewMode />
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ——— OPTIONS ——— */}
                {detailTab === 'options' && hasOptions && (
                    <div className="ad-panel" role="tabpanel">
                        <div className="ad-options-grid">
                            <section className="mdl-card ad-opt-card">
                                <h3 className="ad-section-title">Calls ({optCalls.length})</h3>
                                <div className="ad-ohlc-table-wrap">
                                    <table className="ad-ohlc-table ad-opt-table">
                                        <thead>
                                            <tr>
                                                <th>Strike</th>
                                                <th>Last</th>
                                                <th>Bid</th>
                                                <th>Ask</th>
                                                <th>IV</th>
                                                <th>OI</th>
                                                <th>Volume</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {optCalls.map((c, i) => (
                                                <tr key={i}>
                                                    <td>{c.strike}</td>
                                                    <td>{c.lastPrice != null ? Number(c.lastPrice).toFixed(2) : '--'}</td>
                                                    <td>{c.bid ?? '--'}</td>
                                                    <td>{c.ask ?? '--'}</td>
                                                    <td>{c.impliedVolatility != null ? (Number(c.impliedVolatility) * 100).toFixed(1) + '%' : '--'}</td>
                                                    <td>{c.openInterest ?? '--'}</td>
                                                    <td>{c.volume ?? '--'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </section>
                            <section className="mdl-card ad-opt-card">
                                <h3 className="ad-section-title">Puts ({optPuts.length})</h3>
                                <div className="ad-ohlc-table-wrap">
                                    <table className="ad-ohlc-table ad-opt-table">
                                        <thead>
                                            <tr>
                                                <th>Strike</th>
                                                <th>Last</th>
                                                <th>Bid</th>
                                                <th>Ask</th>
                                                <th>IV</th>
                                                <th>OI</th>
                                                <th>Volume</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {optPuts.map((p, i) => (
                                                <tr key={i}>
                                                    <td>{p.strike}</td>
                                                    <td>{p.lastPrice != null ? Number(p.lastPrice).toFixed(2) : '--'}</td>
                                                    <td>{p.bid ?? '--'}</td>
                                                    <td>{p.ask ?? '--'}</td>
                                                    <td>{p.impliedVolatility != null ? (Number(p.impliedVolatility) * 100).toFixed(1) + '%' : '--'}</td>
                                                    <td>{p.openInterest ?? '--'}</td>
                                                    <td>{p.volume ?? '--'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </section>
                        </div>
                    </div>
                )}

                {/* ——— DOWNLOAD ——— */}
                {detailTab === 'download' && (
                    <div className="ad-panel" role="tabpanel">
                        <div className="ad-download-grid">
                            <section className="mdl-card ad-dl-card">
                                <h3 className="ad-section-title">Quick download</h3>
                                <p className="ad-dl-desc">
                                    Download latest Yahoo data for {symbol} to the local Parquet store. Covers 1h, 1d, 1wk, 1mo intervals within Yahoo's available history.
                                </p>
                                <button
                                    type="button"
                                    className="md-btn md-btn--small ad-dl-btn"
                                    disabled={downloading}
                                    onClick={handleDownload}
                                >
                                    {downloading ? 'Downloading…' : 'Download'}
                                </button>
                            </section>
                            <section className="mdl-card ad-dl-card">
                                <h3 className="ad-section-title">Full archive</h3>
                                <p className="ad-dl-desc">
                                    Deep download to SQLite: daily, weekly, monthly max history plus intraday windows (15m/1h where Yahoo allows). Takes longer.
                                </p>
                                <button
                                    type="button"
                                    className="md-btn md-btn--small ad-dl-btn"
                                    disabled={archiving}
                                    onClick={handleArchive}
                                >
                                    {archiving ? 'Archiving…' : 'Full archive'}
                                </button>
                            </section>
                        </div>
                        {downloadMsg && (
                            <div className="mdl-card ad-dl-msg">
                                <p>{downloadMsg}</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
