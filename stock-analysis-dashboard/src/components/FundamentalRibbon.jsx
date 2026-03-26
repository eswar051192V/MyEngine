import React from 'react';
import { formatLargeNumber } from '../utils/math';

const FundamentalRibbon = ({ tickerDetails }) => {
    if (!tickerDetails) return null;
    return (
        <div className="md-ribbon" role="region" aria-label="Fundamentals">
            <div className="md-stat">
                <span className="md-stat__label">Market cap</span>
                <span className="md-stat__value">
                    {tickerDetails.currencySymbol}
                    {formatLargeNumber(tickerDetails.marketCap)}
                </span>
            </div>
            <div className="md-stat">
                <span className="md-stat__label">P/E</span>
                <span className="md-stat__value">{tickerDetails.peRatio}</span>
            </div>
            <div className="md-stat">
                <span className="md-stat__label">52W high</span>
                <span className="md-stat__value">
                    {tickerDetails.currencySymbol}
                    {tickerDetails.high52}
                </span>
            </div>
            <div className="md-stat">
                <span className="md-stat__label">52W low</span>
                <span className="md-stat__value">
                    {tickerDetails.currencySymbol}
                    {tickerDetails.low52}
                </span>
            </div>
        </div>
    );
};

export default FundamentalRibbon;
