import React, { useEffect, useMemo, useState } from 'react';
import {
    deriveCompositionMetrics,
    deriveMacroRollup,
    selectSnapshotSymbols,
    symbolsForTab,
} from './watchlistInsightsModel';

export default function WatchlistInsights({
    apiBase,
    tab,
    watchlistSymbols,
    activeSymbols,
    macroLabInputSymbols,
    watchSummaryRows,
    macroLabImpactRows,
}) {
    const [quoteState, setQuoteState] = useState({ loading: false, rows: [], error: '' });
    const activeSet = useMemo(
        () => symbolsForTab(tab, watchlistSymbols, activeSymbols, macroLabInputSymbols),
        [tab, watchlistSymbols, activeSymbols, macroLabInputSymbols]
    );
    const scopedRows = useMemo(() => {
        const bySymbol = new Map((watchSummaryRows || []).map((r) => [String(r.symbol || '').toUpperCase(), r]));
        return activeSet.map((s) => bySymbol.get(s)).filter(Boolean);
    }, [watchSummaryRows, activeSet]);
    const composition = useMemo(() => deriveCompositionMetrics(scopedRows), [scopedRows]);
    const macro = useMemo(() => deriveMacroRollup(macroLabImpactRows || [], activeSet), [macroLabImpactRows, activeSet]);

    const snapshotSymbols = useMemo(
        () => selectSnapshotSymbols(tab, watchlistSymbols, activeSymbols, macroLabInputSymbols, 36),
        [tab, watchlistSymbols, activeSymbols, macroLabInputSymbols]
    );

    useEffect(() => {
        if (!snapshotSymbols.length) {
            setQuoteState({ loading: false, rows: [], error: '' });
            return undefined;
        }
        let cancelled = false;
        setQuoteState((prev) => ({ ...prev, loading: true, error: '' }));
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(`${apiBase}/api/instruments/batch-quote`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ symbols: snapshotSymbols }),
                });
                const data = await res.json();
                if (cancelled) return;
                setQuoteState({
                    loading: false,
                    rows: Array.isArray(data?.quotes) ? data.quotes : [],
                    error: data?.ok ? '' : data?.error || '',
                });
            } catch {
                if (cancelled) return;
                setQuoteState({ loading: false, rows: [], error: 'Unable to load market snapshot.' });
            }
        }, 420);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [apiBase, snapshotSymbols]);

    return (
        <section className="mdl-card mdl-insights wl-insights-card">
            <div className="mdl-card__header wl-insights-card__header">
                <div className="wl-insights-card__headline">
                    <span className="wl-card-eyebrow">Scope</span>
                    <h2>Insights & projections</h2>
                </div>
                <span className="wl-insights-card__scope">{activeSet.length} symbols in active scope</span>
            </div>
            <div className="mdl-kpi-grid wl-insights-kpi">
                <article className="mdl-metric">
                    <span>Coverage</span>
                    <strong>{composition.total}</strong>
                    <small>tracked rows</small>
                </article>
                <article className="mdl-metric">
                    <span>Mutual funds</span>
                    <strong>{composition.mfCount}</strong>
                    <small>MF: schemes</small>
                </article>
                <article className="mdl-metric">
                    <span>Other assets</span>
                    <strong>{composition.otherCount}</strong>
                    <small>equity, FX, commodity</small>
                </article>
                <article className="mdl-metric">
                    <span>Fresh headlines</span>
                    <strong>{composition.withNewsCount}</strong>
                    <small>{composition.newsStaleCount} stale / missing</small>
                </article>
                <article className="mdl-metric">
                    <span>Macro avg score</span>
                    <strong>{macro.avgScore.toFixed(2)}</strong>
                    <small>{macro.count} rows in overlap</small>
                </article>
                <article className="mdl-metric">
                    <span>Macro stance mix</span>
                    <strong>
                        {macro.beneficiary}/{macro.neutral}/{macro.headwind}
                    </strong>
                    <small>beneficiary / neutral / headwind</small>
                </article>
            </div>
            <div className="mdl-card__body wl-snapshot-panel">
                <div className="mdl-snapshot-head wl-snapshot-panel__head">
                    <h3>Market snapshot</h3>
                    <span className="wl-snapshot-panel__meta">
                        {quoteState.loading ? 'Refreshing…' : `${quoteState.rows.length} quotes`}
                    </span>
                </div>
                {quoteState.error ? <div className="md-empty wl-snapshot-panel__error">{quoteState.error}</div> : null}
                <div className="mdl-quote-grid wl-snapshot-panel__grid">
                    {(quoteState.rows || []).slice(0, 30).map((row) => {
                        const cp = Number(row.changePct || 0);
                        const up = cp >= 0;
                        return (
                            <article key={row.symbol} className="mdl-quote-card">
                                <div className="mdl-quote-card__top">
                                    <strong>{row.symbol}</strong>
                                    <span className={`wl-type-tag ${String(row.instrumentKind || '') === 'mutual_fund' ? 'wl-type-tag--mf' : ''}`}>
                                        {row.instrumentKind === 'mutual_fund' ? 'MF' : (row.assetFamily || 'asset')}
                                    </span>
                                </div>
                                <div className="mdl-quote-card__name">{row.displayName || row.name || row.symbol}</div>
                                <div className="mdl-quote-card__row">
                                    <span>{row.currencySymbol || '$'}{Number(row.price || 0).toLocaleString()}</span>
                                    <span className={up ? 'md-text-up' : 'md-text-down'}>{up ? '+' : ''}{cp.toFixed(2)}%</span>
                                </div>
                            </article>
                        );
                    })}
                    {!quoteState.loading && !quoteState.rows.length ? (
                        <div className="wl-empty-state wl-empty-state--snapshot wl-empty-state--compact">
                            <p className="wl-empty-state__title">No snapshot rows</p>
                            <p className="wl-empty-state__sub">Add symbols to your active tab scope to load live quotes.</p>
                        </div>
                    ) : null}
                </div>
            </div>
        </section>
    );
}
