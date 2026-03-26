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

const TerminalPivotRail = ({ state, handlers }) => {
    if (!state.showPitchfork) return null;
    const list = state.detectedPivots;
    const n = list.length;
    return (
        <div className="md-rail__block md-pivot-block">
            <div className="md-rail__head">
                LHL / HLH setups ({n})
                <span className="md-pivot-hint">Full contain = all future highs/lows inside fork</span>
            </div>
            <div className="md-pivot-cards">
                {state.mathCalculating ? (
                    <div className="md-empty">Scanning pivots…</div>
                ) : n === 0 ? (
                    <div className="md-empty">No 3-bar LHL or HLH pivots in this lookback.</div>
                ) : (
                    list.map((p, idx) => (
                        <button
                            type="button"
                            key={p.pivotKey}
                            className={`md-pivot-card ${idx === state.activePivotIndex ? 'md-pivot-card--active' : ''}`}
                            onClick={() => handlers.handlePivotClick(idx, list)}
                        >
                            <div className="md-pivot-card__row">
                                <span className={`md-pivot-type ${p.type === 'HLH' ? 'md-pivot-type--hlh' : 'md-pivot-type--lhl'}`}>
                                    {p.type}
                                </span>
                                {p.encompassesAllFutureOhlc ? (
                                    <span className="md-pivot-badge md-pivot-badge--full">
                                        {p.totalFutureBars >= 3 ? 'Full OHLC' : 'Full · short'}
                                    </span>
                                ) : p.closeContainedFullHistory ? (
                                    <span className="md-pivot-badge md-pivot-badge--close">Close only</span>
                                ) : (
                                    <span className="md-pivot-badge md-pivot-badge--broken">Broken</span>
                                )}
                            </div>
                            <div className="md-pivot-card__date">{String(p.date).replace('T', ' ').slice(0, 16)}</div>
                            <div className="md-pivot-card__meta">
                                {p.variation} · idx {p.dataIndex}
                                {p.encompassesAllFutureOhlc
                                    ? ` · ${p.totalFutureBars} bars inside · ${p.positionPct}% ${p.zoneLabel}`
                                    : ` · OHLC streak ${p.daysActive}/${p.totalFutureBars}`}
                            </div>
                        </button>
                    ))
                )}
            </div>
        </div>
    );
};

export default TerminalPivotRail;
