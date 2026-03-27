import React, { useMemo, useState } from 'react';
import Chart from 'react-apexcharts';
import { chartUsesLightPalette } from '../utils/constants';
import { calculateEMA, calculateSMA, buildPitchforkAtIndex } from '../utils/math';

/* Bloomberg-inspired chart palette — adapts to light vs dark via the theme flag */
const PALETTE_DARK = {
    price: '#33b5a5',
    priceLine: '#33b5a5',
    volume: '#334155',
    ema: '#c084fc',
    sma50: '#fbbf24',
    sma200: '#60a5fa',
    candleUp: '#26a69a',
    candleDown: '#ef5350',
    grid: 'rgba(255,255,255,0.045)',
    axis: '#5f6577',
    crosshair: 'rgba(255,255,255,0.25)',
};
const PALETTE_LIGHT = {
    price: '#0f766e',
    priceLine: '#0f766e',
    volume: '#e2e8f0',
    ema: '#7c3aed',
    sma50: '#d97706',
    sma200: '#2563eb',
    candleUp: '#16a34a',
    candleDown: '#dc2626',
    grid: 'rgba(0,0,0,0.06)',
    axis: '#78716c',
    crosshair: 'rgba(0,0,0,0.18)',
};

const ChartWorkspace = ({ state, handlers, setState, skipViewMode = false }) => {
    const [showKeyEvents, setShowKeyEvents] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [chartStyle, setChartStyle] = useState('candle');
    const isLight = chartUsesLightPalette(state.theme);
    const P = isLight ? PALETTE_LIGHT : PALETTE_DARK;

    const tfMap = {
        '1D': '1D',
        '5D': '7D',
        '1M': '1M',
        '6M': '6M',
        'YTD': '1Y',
        '1Y': '1Y',
        '5Y': '5Y',
        'All': 'MAX',
    };

    const safeOhlcData = useMemo(
        () =>
            (state.ohlcData || [])
                .filter(
                    (d) =>
                        d &&
                        d.x != null &&
                        Array.isArray(d.y) &&
                        d.y.length >= 4 &&
                        d.y.slice(0, 4).every((v) => Number.isFinite(Number(v)))
                )
                .map((d) => ({
                    ...d,
                    y: [Number(d.y[0]), Number(d.y[1]), Number(d.y[2]), Number(d.y[3])],
                    volume: Number.isFinite(Number(d.volume)) ? Number(d.volume) : 0,
                })),
        [state.ohlcData]
    );

    /* Derived stats for the header readout */
    const readout = useMemo(() => {
        if (!safeOhlcData.length) return null;
        const last = safeOhlcData[safeOhlcData.length - 1];
        const first = safeOhlcData[0];
        const [o, h, l, c] = last.y;
        const rangeHigh = Math.max(...safeOhlcData.map((d) => d.y[1]));
        const rangeLow = Math.min(...safeOhlcData.map((d) => d.y[2]));
        const periodReturn = first.y[3] ? ((c - first.y[3]) / first.y[3]) * 100 : 0;
        return { o, h, l, c, vol: last.volume, rangeHigh, rangeLow, periodReturn, date: last.x, pts: safeOhlcData.length };
    }, [safeOhlcData]);

    const keyEventPoints = useMemo(() => {
        if (!showKeyEvents || safeOhlcData.length < 6) return [];
        const points = [];
        const last = safeOhlcData[safeOhlcData.length - 1];
        points.push({
            x: new Date(last.x).getTime(),
            y: last.y[3],
            marker: { size: 4, fillColor: P.price, strokeColor: P.price },
            label: { text: 'Now', style: { background: P.price, color: '#fff', fontSize: '10px' } },
        });
        const moves = safeOhlcData
            .map((d) => ({ x: new Date(d.x).getTime(), y: d.y[3], move: Math.abs((d.y[3] - d.y[0]) / Math.max(1e-6, d.y[0])) }))
            .sort((a, b) => b.move - a.move)
            .slice(0, 2);
        moves.forEach((m, idx) =>
            points.push({
                x: m.x,
                y: m.y,
                marker: { size: 3, fillColor: '#f59e0b', strokeColor: '#f59e0b' },
                label: { text: idx === 0 ? 'A' : 'B', style: { background: '#f59e0b', color: '#111', fontSize: '10px' } },
            })
        );
        return points;
    }, [safeOhlcData, showKeyEvents, P.price]);

    const fmt = (v, d = 2) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return '-';
        return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
    };
    const fmtVol = (v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n === 0) return '-';
        if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
        if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
        if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
        return Math.round(n).toLocaleString();
    };

    const setSelectedFromIndex = (idx) => {
        if (!Number.isInteger(idx) || idx < 0 || idx >= safeOhlcData.length) return;
        const d = safeOhlcData[idx];
        handlers.setSelectedCandle({
            x: d.x,
            open: Number(d.y?.[0] ?? 0),
            high: Number(d.y?.[1] ?? 0),
            low: Number(d.y?.[2] ?? 0),
            close: Number(d.y?.[3] ?? 0),
            volume: Number(d.volume ?? 0),
        });
    };

    // --- Series assembly ---
    let terminalSeries = [];
    const seriesColors = [];
    if (chartStyle === 'candle') {
        terminalSeries.push({ name: 'Price', type: 'candlestick', data: safeOhlcData });
        seriesColors.push(P.price);
    } else if (chartStyle === 'line') {
        terminalSeries.push({ name: 'Close', type: 'line', data: safeOhlcData.map((d) => ({ x: d.x, y: d.y[3] })) });
        seriesColors.push(P.priceLine);
    } else if (chartStyle === 'mixed') {
        terminalSeries.push({ name: 'Price', type: 'candlestick', data: safeOhlcData });
        terminalSeries.push({ name: 'Mountain', type: 'area', data: safeOhlcData.map((d) => ({ x: d.x, y: d.y[3] })) });
        seriesColors.push(P.price, P.priceLine);
    } else {
        terminalSeries.push({ name: 'Close', type: 'area', data: safeOhlcData.map((d) => ({ x: d.x, y: d.y[3] })) });
        seriesColors.push(P.priceLine);
    }

    if (state.showVolume) { terminalSeries.push({ name: 'Volume', type: 'area', data: safeOhlcData.map((d) => ({ x: d.x, y: d.volume })) }); seriesColors.push(P.volume); }
    if (state.showEMA20) { terminalSeries.push({ name: 'EMA 20', type: 'line', data: calculateEMA(safeOhlcData, 20) }); seriesColors.push(P.ema); }
    if (state.showSMA50) { terminalSeries.push({ name: 'SMA 50', type: 'line', data: calculateSMA(safeOhlcData, 50) }); seriesColors.push(P.sma50); }
    if (state.showSMA200) { terminalSeries.push({ name: 'SMA 200', type: 'line', data: calculateSMA(safeOhlcData, 200) }); seriesColors.push(P.sma200); }
    if (state.showPitchfork && state.hasScannedPitchforks && state.detectedPivots[state.activePivotIndex] && safeOhlcData.length > 0) {
        const p = state.detectedPivots[state.activePivotIndex];
        const rebuilt = buildPitchforkAtIndex(safeOhlcData, p.dataIndex, p.variation);
        if (rebuilt?.series?.length) {
            rebuilt.series.forEach((s) => { terminalSeries.push(s); seriesColors.push('#a8a29e'); });
        }
    }

    // --- Y-axis / stroke config ---
    const terminalYAxis = [];
    const strokeWidths = [];
    const dashArrays = [];
    let hasPrimaryAxis = false;

    terminalSeries.forEach((s) => {
        if (s.name === 'Price' || s.name === 'Close' || s.name === 'Mountain') {
            if (!hasPrimaryAxis) {
                terminalYAxis.push({
                    seriesName: 'Price',
                    opposite: true,
                    show: true,
                    labels: {
                        style: { colors: P.axis, fontFamily: 'var(--md-mono)', fontSize: '10px' },
                        formatter: (v) => fmt(v),
                    },
                    axisBorder: { show: false },
                    axisTicks: { show: false },
                });
                hasPrimaryAxis = true;
            } else {
                terminalYAxis.push({ seriesName: 'Price', show: false });
            }
            strokeWidths.push(s.type === 'line' || s.type === 'area' ? 1.5 : 1);
            dashArrays.push(0);
        } else if (s.name === 'Volume') {
            terminalYAxis.push({ seriesName: 'Volume', opposite: false, show: false, max: (max) => max * 5 });
            strokeWidths.push(1);
            dashArrays.push(0);
        } else if (s.name.includes('MA')) {
            terminalYAxis.push({ seriesName: 'Price', show: false });
            strokeWidths.push(1.5);
            dashArrays.push(0);
        } else if (s.name.includes('PF')) {
            terminalYAxis.push({ seriesName: 'Price', show: false });
            if (s.name === 'PF Zone') { strokeWidths.push(0); dashArrays.push(0); }
            else if (s.name === 'PF Chord') { strokeWidths.push(2); dashArrays.push(0); }
            else if (s.name === 'PF Median') { strokeWidths.push(1.5); dashArrays.push(8); }
            else { strokeWidths.push(1); dashArrays.push(0); }
        } else {
            terminalYAxis.push({ seriesName: 'Price', show: false });
            strokeWidths.push(1.5);
            dashArrays.push(0);
        }
    });

    const terminalChartOptions = {
        chart: {
            type: 'line',
            fontFamily: 'var(--md-mono)',
            background: 'transparent',
            toolbar: { show: false },
            zoom: { enabled: true, type: 'x', autoScaleYaxis: true },
            selection: { enabled: true, type: 'x' },
            animations: { enabled: false },
            events: {
                dataPointSelection: (_e, _ctx, cfg) => setSelectedFromIndex(cfg?.dataPointIndex),
                dataPointMouseEnter: (_e, _ctx, cfg) => setSelectedFromIndex(cfg?.dataPointIndex),
            },
        },
        dataLabels: { enabled: false },
        colors: seriesColors,
        plotOptions: {
            candlestick: {
                colors: { upward: P.candleUp, downward: P.candleDown },
                wick: { useFillColor: true },
            },
        },
        xaxis: {
            type: 'datetime',
            min: state.chartZoom.min,
            max: state.chartZoom.max,
            labels: { style: { colors: P.axis, fontFamily: 'var(--md-mono)', fontSize: '10px' }, datetimeUTC: false },
            crosshairs: { show: true, stroke: { color: P.crosshair, width: 1, dashArray: 3 } },
            axisBorder: { show: false },
            axisTicks: { show: false },
        },
        yaxis: terminalYAxis,
        annotations: { points: keyEventPoints },
        fill: {
            type: terminalSeries.map((s) => (s.type === 'area' ? 'gradient' : 'solid')),
            opacity: terminalSeries.map((s) => (s.name === 'PF Zone' ? 0.16 : s.name === 'Volume' ? 0.35 : 1)),
            gradient: { shadeIntensity: 0.2, opacityFrom: 0.25, opacityTo: 0.01, stops: [0, 100] },
        },
        grid: {
            borderColor: P.grid,
            strokeDashArray: 2,
            xaxis: { lines: { show: true } },
            yaxis: { lines: { show: true } },
            padding: { top: 8, bottom: 4, left: 8, right: 8 },
        },
        stroke: { width: strokeWidths, dashArray: dashArrays, curve: 'straight' },
        tooltip: {
            shared: true,
            intersect: false,
            theme: isLight ? 'light' : 'dark',
            custom: ({ dataPointIndex }) => {
                if (!Number.isInteger(dataPointIndex) || dataPointIndex < 0 || dataPointIndex >= safeOhlcData.length) return '';
                const d = safeOhlcData[dataPointIndex];
                const [o, h, l, c] = d.y || [0, 0, 0, 0];
                const chg = safeOhlcData.length > 1 && dataPointIndex > 0
                    ? c - safeOhlcData[dataPointIndex - 1].y[3]
                    : 0;
                const chgPct = safeOhlcData.length > 1 && dataPointIndex > 0 && safeOhlcData[dataPointIndex - 1].y[3]
                    ? (chg / safeOhlcData[dataPointIndex - 1].y[3]) * 100
                    : 0;
                const chgClass = chg >= 0 ? 'md-tt-up' : 'md-tt-down';
                return `
                    <div class="md-chart-tooltip md-chart-tooltip--terminal">
                        <div class="md-chart-tooltip__head">
                            <span class="md-chart-tooltip__time">${new Date(d.x).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                            <span class="md-chart-tooltip__chg ${chgClass}">${chg >= 0 ? '+' : ''}${fmt(chg)} (${chg >= 0 ? '+' : ''}${fmt(chgPct)}%)</span>
                        </div>
                        <div class="md-chart-tooltip__grid">
                            <span class="md-tt-lbl">O</span><span>${fmt(o)}</span>
                            <span class="md-tt-lbl">H</span><span>${fmt(h)}</span>
                            <span class="md-tt-lbl">L</span><span>${fmt(l)}</span>
                            <span class="md-tt-lbl">C</span><span>${fmt(c)}</span>
                            <span class="md-tt-lbl">Vol</span><span>${fmtVol(d.volume)}</span>
                        </div>
                    </div>
                `;
            },
        },
        legend: { show: false },
    };

    const openTf = (tf) => handlers.openTerminal(state.selectedTicker, tf, false, { skipViewMode });

    return (
        <div className="md-chart-shell md-chart-shell--terminal">
            {state.chartLoading || state.mathCalculating ? (
                <div className="md-loader">Loading&hellip;</div>
            ) : safeOhlcData.length > 0 ? (
                <div className="md-chart-inner">
                    {/* Terminal header bar */}
                    <div className="md-chart-header">
                        <div className="md-chart-header__left">
                            <span className="md-chart-header__sym">{state.selectedTicker || ''}</span>
                            {readout && (
                                <span className="md-chart-header__readout">
                                    <span className="md-ro-val">{fmt(readout.c)}</span>
                                    <span className={readout.periodReturn >= 0 ? 'md-ro-up' : 'md-ro-down'}>
                                        {readout.periodReturn >= 0 ? '+' : ''}{fmt(readout.periodReturn)}%
                                    </span>
                                </span>
                            )}
                        </div>
                        <div className="md-chart-header__right">
                            <div className="md-timechips">
                                {Object.keys(tfMap).map((lbl) => (
                                    <button
                                        key={lbl}
                                        type="button"
                                        className={`md-chip-btn ${state.currentTimeframe === tfMap[lbl] ? 'md-chip-btn--on' : ''}`}
                                        onClick={() => openTf(tfMap[lbl])}
                                    >
                                        {lbl}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Toolbar row */}
                    <div className="md-chart-toolbar">
                        <div className="md-chart-toolbar__group">
                            <select className="md-select-inline" value={chartStyle} onChange={(e) => setChartStyle(e.target.value)}>
                                <option value="candle">Candles</option>
                                <option value="mountain">Mountain</option>
                                <option value="line">Line</option>
                                <option value="mixed">Hybrid</option>
                            </select>
                            <label className="md-toggle md-toggle--compact">
                                <input type="checkbox" checked={showKeyEvents} onChange={(e) => setShowKeyEvents(e.target.checked)} />
                                <span>Events</span>
                            </label>
                            <button type="button" className={`md-chip-btn ${showAdvanced ? 'md-chip-btn--on' : ''}`} onClick={() => setShowAdvanced((v) => !v)}>
                                Indicators
                            </button>
                            <button type="button" className={`md-chip-btn ${state.showPitchfork ? 'md-chip-btn--on' : ''}`} onClick={() => setState.setShowPitchfork(!state.showPitchfork)}>
                                Fork
                            </button>
                            <button type="button" className="md-chip-btn" disabled={state.isScreening} onClick={() => handlers.findForkInAll()}>
                                {state.isScreening ? `Scan ${Math.round((state.screenerProgress.current / Math.max(1, state.screenerProgress.total)) * 100)}%` : 'Scan All'}
                            </button>
                        </div>
                        {showAdvanced && (
                            <div className="md-chart-toolbar__group md-chart-toolbar__indicators">
                                <button type="button" className={`md-chip-btn ${state.showVolume ? 'md-chip-btn--on' : ''}`} onClick={() => setState.setShowVolume(!state.showVolume)}>Vol</button>
                                <button type="button" className={`md-chip-btn ${state.showEMA20 ? 'md-chip-btn--on' : ''}`} onClick={() => setState.setShowEMA20(!state.showEMA20)}>EMA20</button>
                                <button type="button" className={`md-chip-btn ${state.showSMA50 ? 'md-chip-btn--on' : ''}`} onClick={() => setState.setShowSMA50(!state.showSMA50)}>SMA50</button>
                                <button type="button" className={`md-chip-btn ${state.showSMA200 ? 'md-chip-btn--on' : ''}`} onClick={() => setState.setShowSMA200(!state.showSMA200)}>SMA200</button>
                            </div>
                        )}
                    </div>

                    {/* OHLC readout strip */}
                    {state.selectedCandle && (
                        <div className="md-chart-readout">
                            <span className="md-ro-label">O</span><span className="md-ro-val">{fmt(state.selectedCandle.open)}</span>
                            <span className="md-ro-label">H</span><span className="md-ro-val">{fmt(state.selectedCandle.high)}</span>
                            <span className="md-ro-label">L</span><span className="md-ro-val">{fmt(state.selectedCandle.low)}</span>
                            <span className="md-ro-label">C</span><span className="md-ro-val">{fmt(state.selectedCandle.close)}</span>
                            <span className="md-ro-label">Vol</span><span className="md-ro-val">{fmtVol(state.selectedCandle.volume)}</span>
                            <span className="md-ro-date">{new Date(state.selectedCandle.x).toLocaleDateString()}</span>
                        </div>
                    )}

                    {/* Chart canvas */}
                    <div className="md-chart-canvas">
                        <Chart options={terminalChartOptions} series={terminalSeries} type="line" height="100%" width="100%" />
                    </div>

                    {state.chartZoom.min != null && (
                        <button type="button" className="md-btn md-btn--small md-reset-zoom" onClick={handlers.resetZoom}>
                            Reset zoom
                        </button>
                    )}

                    {/* Scanner results (collapsed into sidebar-style list) */}
                    {state.screenerResults.length > 0 && !state.isScreening && (
                        <div className="md-chart-scanner-results">
                            <span className="md-ro-label">Fork hits</span>
                            {state.screenerResults.slice(0, 6).map((r) => (
                                <button
                                    key={r.symbol}
                                    type="button"
                                    className="md-chip-btn"
                                    onClick={() => openTf(state.currentTimeframe || '1Y')}
                                >
                                    {r.symbol} <small>{(r.fork?.nearnessScore ?? 0).toFixed(3)}</small>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <div className="md-chart-error">No data for this symbol and timeframe.</div>
            )}
        </div>
    );
};

export default ChartWorkspace;
