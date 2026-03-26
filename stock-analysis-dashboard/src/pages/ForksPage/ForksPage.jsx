import React from 'react';
import '../../watchlist/watchlist.css';
import './ForksPage.css';
import PitchforkLabPanel from '../../components/PitchforkLabPanel';

export default function ForksPage({ state, handlers, openAnalysisSymbol }) {
    return (
        <div className="md-content mw-content fork-page mdl-page mdl-page--redesign mdl mdl--dense">
            <PitchforkLabPanel state={state} handlers={handlers} openAnalysisSymbol={openAnalysisSymbol} variant="page" />
        </div>
    );
}
