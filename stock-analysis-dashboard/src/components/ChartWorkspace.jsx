import React, { useMemo, useState } from 'react';
import Chart from 'react-apexcharts';
import { chartUsesLightPalette } from '../utils/constants';
import { calculateEMA, calculateSMA, buildPitchforkAtIndex } from '../utils/math';


const ChartWorkspace = ({ state, handlers, setState }) => {
    const [showKeyEvents, setShowKeyEvents] = useState(true);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [chartStyle, setChartStyle] = useState('mountain');
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
                    y: [
                        Number(d.y[0]),
                        Number(d.y[1]),
                        Number(d.y[2]),
                        Number(d.y[3]),
                    ],
                    volume: Number.isFinite(Number(d.volume)) ? Number(d.volume) : 0,
                })),
        [state.ohlcData]
    );

    const keyEventPoints = useMemo(() => {
        if (!showKeyEvents || safeOhlcData.length < 6) return [];
        const points = [];
        const last = safeOhlcData[safeOhlcData.length - 1];
        points.push({
            x: new Date(last.x).getTime(),
            y: last.y[3],
            marker: { size: 5, fillColor: '#0ea5a4', strokeColor: '#0ea5a4' },
            label: { text: 'Now', style: { background: '#0ea5a4', color: '#fff' } },
        });
        const moves = safeOhlcData
            .map((d) => ({ x: new Date(d.x).getTime(), y: d.y[3], move: Math.abs((d.y[3] - d.y[0]) / Math.max(1e-6, d.y[0])) }))
            .sort((a, b) => b.move - a.move)
            .slice(0, 2);
        moves.forEach((m, idx) =>
            points.push({
                x: m.x,
                y: m.y,
                marker: { size: 4, fillColor: '#f59e0b', strokeColor: '#f59e0b' },
                label: { text: idx === 0 ? 'Event A' : 'Event B', style: { background: '#f59e0b', color: '#111' } },
            })
        );
        return points;
    }, [safeOhlcData, showKeyEvents]);
    const formatHoverValue = (value, digits = 2) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return '-';
        return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
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

    // Generate Chart Data Dynamically
    let terminalSeries = [];
    if (chartStyle === 'candle') {
        terminalSeries.push({ name: 'Price', type: 'candlestick', data: safeOhlcData });
    } else if (chartStyle === 'line') {
        terminalSeries.push({ name: 'Close', type: 'line', data: safeOhlcData.map(d => ({ x: d.x, y: d.y[3] })) });
    } else if (chartStyle === 'mixed') {
        terminalSeries.push({ name: 'Price', type: 'candlestick', data: safeOhlcData });
        terminalSeries.push({ name: 'Mountain', type: 'area', data: safeOhlcData.map(d => ({ x: d.x, y: d.y[3] })) });
    } else {
        terminalSeries.push({ name: 'Close', type: 'area', data: safeOhlcData.map(d => ({ x: d.x, y: d.y[3] })) });
    }
    
    if (state.showVolume) terminalSeries.push({ name: 'Volume', type: 'area', data: safeOhlcData.map(d => ({ x: d.x, y: Number.isFinite(Number(d.volume)) ? Number(d.volume) : 0 })) });
    if (state.showEMA20) terminalSeries.push({ name: 'EMA 20', type: 'line', data: calculateEMA(safeOhlcData, 20) });
    if (state.showSMA50) terminalSeries.push({ name: 'SMA 50', type: 'line', data: calculateSMA(safeOhlcData, 50) });
    if (state.showSMA200) terminalSeries.push({ name: 'SMA 200', type: 'line', data: calculateSMA(safeOhlcData, 200) });
    if (state.showPitchfork && state.hasScannedPitchforks && state.detectedPivots[state.activePivotIndex] && safeOhlcData.length > 0) {
        const p = state.detectedPivots[state.activePivotIndex];
        const rebuilt = buildPitchforkAtIndex(safeOhlcData, p.dataIndex, p.variation);
        if (rebuilt?.series?.length) terminalSeries.push(...rebuilt.series);
    }
  
    const terminalYAxis = []; const strokeWidths = []; const dashArrays = []; let hasPrimaryAxis = false;
  
    terminalSeries.forEach(s => {
        if (s.name === 'Price' || s.name === 'Close' || s.name === 'Mountain') { 
            if (!hasPrimaryAxis) { terminalYAxis.push({ seriesName: 'Price', opposite: true, show: true, labels: { style: { colors: '#8b909a' } } }); hasPrimaryAxis = true; } 
            else { terminalYAxis.push({ seriesName: 'Price', show: false }); }
            strokeWidths.push(s.type === 'line' || s.type === 'area' ? 2 : 1); dashArrays.push(0); 
        }
        else if (s.name === 'Volume') { terminalYAxis.push({ seriesName: 'Volume', opposite: false, show: false, max: (max) => max * 5 }); strokeWidths.push(1); dashArrays.push(0); }
        else if (s.name.includes('MA')) { terminalYAxis.push({ seriesName: 'Price', show: false }); strokeWidths.push(2); dashArrays.push(0); }
        else if (s.name.includes('PF')) {
            terminalYAxis.push({ seriesName: 'Price', show: false });
            if (s.name === 'PF Zone') { strokeWidths.push(0); dashArrays.push(0); }
            else if (s.name === 'PF Chord') { strokeWidths.push(2); dashArrays.push(0); }
            else if (s.name === 'PF Median') { strokeWidths.push(1.5); dashArrays.push(8); }
            else { strokeWidths.push(1); dashArrays.push(0); }
        } else {
            // Fallback: keep any unknown overlay mapped to the primary price axis.
            terminalYAxis.push({ seriesName: 'Price', show: false });
            strokeWidths.push(2);
            dashArrays.push(0);
        }
    });
  
    const terminalChartOptions = {
      chart: {
        type: 'line',
        background: 'transparent',
        toolbar: { show: true, tools: { download: false, selection: true, zoom: true, zoomin: true, zoomout: true, pan: true, reset: true } },
        zoom: { enabled: true, type: 'x', autoScaleYaxis: true },
        selection: { enabled: true, type: 'x' },
        animations: { enabled: false },
        events: {
          dataPointSelection: (_event, _chartContext, config) => {
            setSelectedFromIndex(config?.dataPointIndex);
          },
          dataPointMouseEnter: (_event, _chartContext, config) => {
            setSelectedFromIndex(config?.dataPointIndex);
          },
        },
      },
      dataLabels: { enabled: false },
      colors: ['#0f766e', '#9ca3af', '#5c616b', '#c084fc', '#fbbf24', '#a8a29e', '#f0d875', '#4ade80', '#f87171', '#60a5fa'],
      plotOptions: {
        candlestick: {
          colors: {
            upward: '#22c55e',
            downward: '#ef4444',
          },
        },
      },
      xaxis: {
        type: 'datetime',
        min: state.chartZoom.min,
        max: state.chartZoom.max,
        labels: { style: { colors: '#8b909a' } },
        crosshairs: { show: true },
      },
      yaxis: terminalYAxis,
      annotations: { points: keyEventPoints },
      fill: {
        type: terminalSeries.map((s) => (s.type === 'area' ? 'gradient' : 'solid')),
        opacity: terminalSeries.map((s) => (s.name === 'PF Zone' ? 0.16 : 1)),
        gradient: { shadeIntensity: 0.25, opacityFrom: 0.3, opacityTo: 0.02, stops: [0, 100] },
      },
      grid: { borderColor: 'rgba(255,255,255,0.06)' },
      stroke: { width: strokeWidths, dashArray: dashArrays, curve: 'straight' },
      tooltip: {
        shared: true,
        intersect: false,
        theme: chartUsesLightPalette(state.theme) ? 'light' : 'dark',
        custom: ({ dataPointIndex }) => {
            if (!Number.isInteger(dataPointIndex) || dataPointIndex < 0 || dataPointIndex >= safeOhlcData.length) return '';
            const d = safeOhlcData[dataPointIndex];
            const [o, h, l, c] = d.y || [0, 0, 0, 0];
            return `
                <div class="md-chart-tooltip">
                    <div class="md-chart-tooltip__time">${new Date(d.x).toLocaleString()}</div>
                    <div class="md-chart-tooltip__row"><span>Open</span><strong>${formatHoverValue(o)}</strong></div>
                    <div class="md-chart-tooltip__row"><span>High</span><strong>${formatHoverValue(h)}</strong></div>
                    <div class="md-chart-tooltip__row"><span>Low</span><strong>${formatHoverValue(l)}</strong></div>
                    <div class="md-chart-tooltip__row"><span>Close</span><strong>${formatHoverValue(c)}</strong></div>
                    <div class="md-chart-tooltip__row"><span>Volume Trades</span><strong>${Math.round(Number(d.volume || 0)).toLocaleString()}</strong></div>
                </div>
            `;
        },
      },
      legend: { show: false },
    };

    return (
        <div className="md-chart-shell">
            {state.chartLoading || state.mathCalculating ? (
                <div className="md-loader">Loading series…</div>
            ) : safeOhlcData.length > 0 ? (
                <div className="md-chart-inner">
                    <div className="md-chart-controls">
                        <div className="md-timechips">
                            {Object.keys(tfMap).map((lbl) => (
                                <button
                                    key={lbl}
                                    type="button"
                                    className={`md-chip-btn ${state.currentTimeframe === tfMap[lbl] ? 'md-chip-btn--on' : ''}`}
                                    onClick={() => handlers.openTerminal(state.selectedTicker, tfMap[lbl])}
                                >
                                    {lbl}
                                </button>
                            ))}
                        </div>
                        <div className="md-chart-actions">
                            <label className="md-toggle">
                                <input type="checkbox" checked={showKeyEvents} onChange={(e) => setShowKeyEvents(e.target.checked)} />
                                <span>Key Events</span>
                            </label>
                            <select className="md-select-inline" value={chartStyle} onChange={(e) => setChartStyle(e.target.value)}>
                                <option value="mountain">Mountain</option>
                                <option value="mixed">Hybrid</option>
                                <option value="line">Line</option>
                                <option value="candle">Candles</option>
                            </select>
                            <button type="button" className={`md-btn md-btn--small ${showAdvanced ? 'md-btn--on' : ''}`} onClick={() => setShowAdvanced((v) => !v)}>
                                Advanced Chart
                            </button>
                            <button type="button" className={`md-btn md-btn--small ${state.showPitchfork ? 'md-btn--on' : ''}`} onClick={() => setState.setShowPitchfork(!state.showPitchfork)}>
                                Fork
                            </button>
                            <button type="button" className="md-btn md-btn--small" disabled={state.isScreening} onClick={() => handlers.findForkInAll()}>
                                {state.isScreening ? 'Scanning...' : 'Scan Entire Universe'}
                            </button>
                        </div>
                    </div>
                    {showAdvanced && (
                        <div className="md-chart-advanced">
                            <button type="button" className={`md-chip-btn ${state.showVolume ? 'md-chip-btn--on' : ''}`} onClick={() => setState.setShowVolume(!state.showVolume)}>Volume</button>
                            <button type="button" className={`md-chip-btn ${state.showEMA20 ? 'md-chip-btn--on' : ''}`} onClick={() => setState.setShowEMA20(!state.showEMA20)}>EMA20</button>
                            <button type="button" className={`md-chip-btn ${state.showSMA50 ? 'md-chip-btn--on' : ''}`} onClick={() => setState.setShowSMA50(!state.showSMA50)}>SMA50</button>
                            <button type="button" className={`md-chip-btn ${state.showSMA200 ? 'md-chip-btn--on' : ''}`} onClick={() => setState.setShowSMA200(!state.showSMA200)}>SMA200</button>
                        </div>
                    )}
                    <div className="md-home-list" style={{ marginTop: '0.5rem' }}>
                        <div className="md-home-row md-home-row--headline">
                            <span className="md-home-row__headline">Fork scanner</span>
                            {state.isScreening ? (
                                <span className="md-home-row__price">
                                    {Math.round((state.screenerProgress.current / Math.max(1, state.screenerProgress.total)) * 100)}%
                                </span>
                            ) : null}
                        </div>
                        {state.isScreening ? (
                            <div className="md-list-item">
                                Scanning {state.screenerProgress.symbol || '...'} ({state.screenerProgress.current}/{state.screenerProgress.total})
                            </div>
                        ) : state.screenerResults.length ? (
                            state.screenerResults.slice(0, 8).map((r) => (
                                <button
                                    key={r.symbol}
                                    type="button"
                                    className="md-list-item"
                                    onClick={() => handlers.openTerminal(r.symbol, state.currentTimeframe || '1Y', false)}
                                >
                                    <span>{r.symbol}</span>
                                    <span className="md-home-row__price">{(r.fork?.nearnessScore ?? 0).toFixed(3)}</span>
                                </button>
                            ))
                        ) : (
                            <div className="md-list-item">Use "Scan Entire Universe" to locate active pitchfork setups.</div>
                        )}
                    </div>
                    {state.chartZoom.min != null && (
                        <button type="button" className="md-btn md-reset-zoom" onClick={handlers.resetZoom}>
                            Reset zoom
                        </button>
                    )}
                    <Chart options={terminalChartOptions} series={terminalSeries} type="line" height="100%" width="100%" />
                    {state.selectedCandle && (
                        <div className="md-candle-inspector">
                            <span>{new Date(state.selectedCandle.x).toLocaleString()}</span>
                            <span>O {state.selectedCandle.open.toFixed(2)}</span>
                            <span>H {state.selectedCandle.high.toFixed(2)}</span>
                            <span>L {state.selectedCandle.low.toFixed(2)}</span>
                            <span>C {state.selectedCandle.close.toFixed(2)}</span>
                            <span>V {Math.round(state.selectedCandle.volume).toLocaleString()}</span>
                        </div>
                    )}
                </div>
            ) : (
                <div className="md-chart-error">No historical data for this symbol and range.</div>
            )}
        </div>
    );
};

export default ChartWorkspace;
