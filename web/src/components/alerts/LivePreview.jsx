import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Eye, ChevronDown, ChevronUp, Plane } from 'lucide-react';
import { findMatchingAircraft, getRelevantValues } from '../../utils/alertEvaluator';

/**
 * PreviewAircraftItem component - renders a single aircraft in the preview list
 */
function PreviewAircraftItem({ aircraft, conditions }) {
  const values = getRelevantValues({ conditions }, aircraft);

  return (
    <div className="preview-aircraft-item" role="listitem">
      <div className="preview-aircraft-header">
        <Plane size={14} aria-hidden="true" />
        <span className="preview-callsign">{aircraft.flight?.trim() || 'N/A'}</span>
        <span className="preview-hex">{aircraft.hex}</span>
      </div>
      <div className="preview-aircraft-values">
        {values.altitude != null && (
          <span className="preview-value">Alt: {values.altitude}ft</span>
        )}
        {values.speed != null && (
          <span className="preview-value">Spd: {values.speed}kts</span>
        )}
        {(values.distance != null || aircraft.calculatedDistance != null) && (
          <span className="preview-value">
            Dist: {(values.distance ?? aircraft.calculatedDistance ?? 0).toFixed(1)}nm
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * LivePreview component - shows matching aircraft based on current conditions
 */
export function LivePreview({
  conditions,
  aircraft = [],
  feederLocation = null,
  debounceMs = 300,
}) {
  const [expanded, setExpanded] = useState(true);
  const [debouncedConditions, setDebouncedConditions] = useState(conditions);
  const debounceTimeoutRef = useRef(null);

  // Debounce conditions changes
  useEffect(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    debounceTimeoutRef.current = setTimeout(() => {
      setDebouncedConditions(conditions);
    }, debounceMs);
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [conditions, debounceMs]);

  // Calculate matching aircraft
  const matchingAircraft = useMemo(() => {
    if (!aircraft || aircraft.length === 0) return [];
    const tempRule = { conditions: debouncedConditions };
    return findMatchingAircraft(tempRule, aircraft, feederLocation);
  }, [debouncedConditions, aircraft, feederLocation]);

  // Don't render if no aircraft data
  if (!aircraft || aircraft.length === 0) {
    return null;
  }

  return (
    <div className="live-preview-panel">
      <button
        type="button"
        className="preview-toggle"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls="preview-content"
      >
        <Eye size={16} aria-hidden="true" />
        <span className="preview-summary">
          Matching <strong>{matchingAircraft.length}</strong> of {aircraft.length} aircraft
        </span>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {expanded && (
        <div id="preview-content" className="preview-content">
          {matchingAircraft.length > 0 ? (
            <div className="preview-aircraft-list" role="list">
              {matchingAircraft.slice(0, 5).map(ac => (
                <PreviewAircraftItem
                  key={ac.hex}
                  aircraft={ac}
                  conditions={conditions}
                />
              ))}
              {matchingAircraft.length > 5 && (
                <div className="preview-more">
                  ...and {matchingAircraft.length - 5} more aircraft
                </div>
              )}
            </div>
          ) : (
            <div className="preview-empty">
              No aircraft currently match these conditions
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default LivePreview;
