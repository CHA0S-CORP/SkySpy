import React, { useMemo } from 'react';
import { X, TestTube2, Plane } from 'lucide-react';
import { findMatchingAircraft, getRelevantValues } from '../../utils/alertEvaluator';

export function TestRuleModal({ rule, aircraft, feederLocation, onClose }) {
  const matches = useMemo(() => {
    if (!rule || !aircraft) return [];
    return findMatchingAircraft(rule, aircraft, feederLocation);
  }, [rule, aircraft, feederLocation]);

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="test-modal-title">
      <div className="modal modal-medium" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id="test-modal-title">
            <TestTube2 size={20} aria-hidden="true" style={{ marginRight: '8px' }} />
            Test Rule: {rule?.name}
          </h3>
          <button onClick={onClose} aria-label="Close test results"><X size={20} /></button>
        </div>
        <div className="modal-content">
          <div className="test-results-summary" role="status" aria-live="polite">
            <span className={`match-count ${matches.length > 0 ? 'has-matches' : ''}`}>
              {matches.length} of {aircraft?.length || 0} aircraft match
            </span>
          </div>

          {matches.length > 0 ? (
            <div className="test-results-list" role="list" aria-label="Matching aircraft">
              {matches.slice(0, 20).map(ac => {
                const values = getRelevantValues(rule, ac);
                return (
                  <div key={ac.hex} className="test-result-item" role="listitem">
                    <div className="test-result-header">
                      <Plane size={16} aria-hidden="true" />
                      <span className="test-callsign">{ac.flight?.trim() || 'N/A'}</span>
                      <span className="test-hex">{ac.hex}</span>
                    </div>
                    <div className="test-result-values">
                      {values.altitude != null && (
                        <span className="test-value">Alt: {values.altitude}ft</span>
                      )}
                      {values.speed != null && (
                        <span className="test-value">Spd: {values.speed}kts</span>
                      )}
                      {values.distance != null && (
                        <span className="test-value">Dist: {values.distance.toFixed(1)}nm</span>
                      )}
                      {ac.calculatedDistance != null && !values.distance && (
                        <span className="test-value">Dist: {ac.calculatedDistance.toFixed(1)}nm</span>
                      )}
                      {values.squawk && (
                        <span className="test-value">Sqwk: {values.squawk}</span>
                      )}
                      {values.type && (
                        <span className="test-value">Type: {values.type}</span>
                      )}
                      {values.military && (
                        <span className="test-value military">Military</span>
                      )}
                      {values.emergency && (
                        <span className="test-value emergency">Emergency</span>
                      )}
                    </div>
                    {ac.matchReasons && ac.matchReasons.length > 0 && (
                      <div className="test-result-reasons">
                        {ac.matchReasons.map((reason, i) => (
                          <span key={i} className="match-reason">{reason}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {matches.length > 20 && (
                <div className="test-result-more">
                  ...and {matches.length - 20} more aircraft
                </div>
              )}
            </div>
          ) : (
            <div className="test-results-empty" role="status">
              <p>No aircraft currently match this rule.</p>
              <p className="hint">Try adjusting the conditions or wait for matching aircraft to appear.</p>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
