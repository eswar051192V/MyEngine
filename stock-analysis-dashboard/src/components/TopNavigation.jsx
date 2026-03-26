import React, { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'react-apexcharts';
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
import {
  API_BASE,
  SEGMENT_CHOICES,
  TRANSACTION_SIDE_CHOICES,
  chartUsesLightPalette,
} from '../utils/constants';
import {
  formatLargeNumber,
  calculateMaxPain,
  calculateSMA,
  calculateEMA,
} from '../utils/math';
import {
  buildForkLink,
  normalizePortfolioSegment,
  downloadTextFile,
  rowsToCsv,
} from '../utils/portfolio';

const TopNavigation = ({ state, setState, handlers }) => {
    const title =
        state.viewMode === 'home'
            ? 'Market Overview'
            : state.viewMode === 'index'
            ? 'Market Universe'
            : state.viewMode === 'screener'
              ? 'Pitchfork Screener'
              : state.selectedTicker || 'Terminal';

    return (
        <header className="md-topbar">
            <div className="md-topbar__left">
                <span className="md-crumb">{state.viewMode}</span>
                <div className="md-topbar__title">
                    {title}
                    {state.viewMode === 'terminal' && state.selectedTicker && state.tickerDetails?.price != null && (
                        <span className="md-price">
                            {state.tickerDetails.currencySymbol}
                            {Number(state.tickerDetails.price).toLocaleString()}
                        </span>
                    )}
                </div>
            </div>

            <div className="md-toolbar">
                <label className="md-field-label md-field-label--inline" htmlFor="md-theme-top">Theme</label>
                <select
                    id="md-theme-top"
                    className="md-select-inline"
                    value={state.theme}
                    onChange={(e) => handlers.setTheme(e.target.value)}
                    aria-label="Color theme"
                >
                    {THEME_OPTIONS.map((o) => (
                        <option key={o.id} value={o.id}>
                            {o.label}
                        </option>
                    ))}
                </select>
                {state.viewMode === 'terminal' && state.selectedTicker && (
                    <>
                        <div className="md-seg" role="group" aria-label="Timeframe">
                            {['1D', '7D', '2W', '1M', '3M', '6M', '1Y', '2Y', '5Y', 'MAX'].map((tf) => (
                                <button
                                    key={tf}
                                    type="button"
                                    className={state.currentTimeframe === tf ? 'md-seg--on' : ''}
                                    onClick={() => handlers.openTerminal(state.selectedTicker, tf)}
                                >
                                    {tf}
                                </button>
                            ))}
                        </div>
                        <div className="md-seg" role="group" aria-label="Chart type">
                            <button
                                type="button"
                                className={state.chartDisplayType === 'candle' ? 'md-seg--on' : ''}
                                onClick={() => setState.setChartDisplayType('candle')}
                            >
                                OHLC
                            </button>
                            <button
                                type="button"
                                className={state.chartDisplayType === 'line' ? 'md-seg--on' : ''}
                                onClick={() => setState.setChartDisplayType('line')}
                            >
                                Line
                            </button>
                            <button
                                type="button"
                                className={state.chartDisplayType === 'both' ? 'md-seg--on' : ''}
                                onClick={() => setState.setChartDisplayType('both')}
                            >
                                Both
                            </button>
                        </div>
                        <div className="md-seg" role="group" aria-label="Indicators">
                            <button
                                type="button"
                                className={state.showVolume ? 'md-seg--on' : ''}
                                onClick={() => setState.setShowVolume(!state.showVolume)}
                            >
                                Vol
                            </button>
                            <button
                                type="button"
                                className={state.showEMA20 ? 'md-seg--on' : ''}
                                onClick={() => setState.setShowEMA20(!state.showEMA20)}
                            >
                                E20
                            </button>
                            <button
                                type="button"
                                className={state.showSMA50 ? 'md-seg--on' : ''}
                                onClick={() => setState.setShowSMA50(!state.showSMA50)}
                            >
                                S50
                            </button>
                            <button
                                type="button"
                                className={state.showSMA200 ? 'md-seg--on' : ''}
                                onClick={() => setState.setShowSMA200(!state.showSMA200)}
                            >
                                S200
                            </button>
                        </div>
                        {state.showPitchfork && (
                            <select
                                className="md-select-inline md-pf-type"
                                value={state.pitchforkType}
                                onChange={(e) => setState.setPitchforkType(e.target.value)}
                                aria-label="Pitchfork type"
                            >
                                <option value="Standard">Andrews</option>
                                <option value="Schiff">Schiff</option>
                                <option value="Modified">Modified</option>
                            </select>
                        )}
                        <button
                            type="button"
                            className={`md-btn md-pf-toggle ${state.showPitchfork ? 'md-btn--on' : ''}`}
                            onClick={() => {
                                setState.setShowPitchfork(!state.showPitchfork);
                                if (state.showPitchfork) handlers.resetZoom();
                                else if (state.hasScannedPitchforks && state.detectedPivots.length) handlers.handlePivotClick(0);
                            }}
                        >
                            Pitchfork
                        </button>
                    </>
                )}
                {state.viewMode === 'screener' && (
                    <select
                        className="md-select-inline"
                        value={state.screenerCategory}
                        onChange={(e) => setState.setScreenerCategory(e.target.value)}
                        aria-label="Screener category"
                    >
                        {Object.keys(state.tickersData).map((cat) => (
                            <option key={cat} value={cat}>
                                {state.categoryLabelMap?.[cat] || cat.replace(/_/g, ' ')}
                            </option>
                        ))}
                    </select>
                )}
            </div>
        </header>
    );
};

export default TopNavigation;
