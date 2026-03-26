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

const AIChatSidebar = ({ state, setState, handlers }) => {
    return (
        <aside className="md-sidebar" aria-label="Assistant">
            <div className="md-sidebar__brand">
                <h1 className="md-sidebar__logo" onClick={() => setState.setViewMode('home')}>
                    <span className="md-sidebar__logo-mark" aria-hidden>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 3v18h18" />
                            <path d="m19 9-5 5-4-4-3 3" />
                        </svg>
                    </span>
                    Market Watcher
                </h1>
                <span className={`md-pill ${state.liveStatus === 'LIVE' ? 'md-pill--live' : ''}`}>{state.liveStatus}</span>
            </div>

            <div className="md-chat">
                {state.chatHistory.map((msg, i) => (
                    <div
                        key={i}
                        className={`md-msg md-msg--${msg.role === 'user' ? 'user' : msg.role === 'system' ? 'system' : 'ai'}`}
                    >
                        <div className={`md-bubble md-bubble--${msg.role === 'user' ? 'user' : msg.role === 'system' ? 'system' : 'ai'}`}>
                            {msg.role === 'ai' ? (
                                <div className="md-bubble__ai-row">
                                    <span className="md-bubble__ai-icon" aria-hidden>✦</span>
                                    <span>{msg.text}</span>
                                </div>
                            ) : (
                                msg.text
                            )}
                        </div>
                    </div>
                ))}
                {(state.isAnalyzing || state.consumerRagLoading || state.contextAgentLoading) && (
                    <div className="md-msg md-msg--ai">
                        <div className="md-bubble md-bubble--ai" style={{ fontStyle: 'italic', opacity: 0.85 }}>
                            {state.contextAgentLoading
                                ? 'Context AI (tools + local LLM)…'
                                : state.consumerRagLoading
                                  ? 'Consumer Risk RAG + local LLM…'
                                  : 'Synthesizing with local LLM…'}
                        </div>
                    </div>
                )}
                <div ref={state.chatEndRef} />
            </div>

            <div className="md-composer">
                {!state.userPrompt.trim() && (
                    <div className="md-quick-row">
                        {state.viewMode === 'terminal' && state.selectedTicker ? (
                            <>
                                <button type="button" className="md-chip" onClick={() => handlers.handlePromptSubmit('Analyze the current chart pattern.')}>
                                    Analyze chart
                                </button>
                                <button
                                    type="button"
                                    className="md-chip"
                                    disabled={state.consumerRagLoading || state.contextAgentLoading}
                                    onClick={() => handlers.runConsumerRag()}
                                >
                                    Consumer Risk RAG
                                </button>
                                <button
                                    type="button"
                                    className="md-chip"
                                    disabled={state.contextAgentLoading || state.consumerRagLoading}
                                    onClick={() => handlers.runContextAgent()}
                                >
                                    Context AI
                                </button>
                                {state.tickerDetails?.news?.length > 0 && (
                                    <button type="button" className="md-chip" onClick={() => handlers.handlePromptSubmit('Summarize the latest news for this company.')}>
                                        Summarize news
                                    </button>
                                )}
                            </>
                        ) : (
                            <>
                                <button type="button" className="md-chip" onClick={() => setState.setViewMode('home')}>
                                    Home
                                </button>
                                <button type="button" className="md-chip" onClick={() => handlers.handlePromptSubmit('/INDEX')}>
                                    Market Universe
                                </button>
                                <button type="button" className="md-chip" onClick={() => handlers.handlePromptSubmit('/SCAN')}>
                                    Screener
                                </button>
                            </>
                        )}
                    </div>
                )}

                <div className="md-input-wrap">
                    <textarea
                        className="md-textarea"
                        rows={2}
                        placeholder="Ticker ($AAPL), /SCAN, or a question…"
                        value={state.userPrompt}
                        onChange={(e) => setState.setUserPrompt(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handlers.handlePromptSubmit();
                            }
                        }}
                    />
                    <button
                        type="button"
                        className="md-send"
                        onClick={() => handlers.handlePromptSubmit()}
                        disabled={state.isAnalyzing || !state.userPrompt.trim()}
                        aria-label="Send"
                    >
                        ↑
                    </button>
                </div>
            </div>
        </aside>
    );
};

export default AIChatSidebar;
