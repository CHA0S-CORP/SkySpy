import React, { memo, useRef, useEffect, useCallback } from 'react';
import { X, Cloud, Wind, Eye, Clock, ChevronRight, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
import { useDraggable } from '../../../../hooks/useDraggable';
import {
  formatTafTime,
  formatTafValidity,
  formatTafWind,
  formatTafVisibility,
  formatTafCeiling,
  formatCloudLayer,
  getTafSummary,
  getCategoryTransition,
  isTafStale,
  getTafRemainingHours,
  isTafImproving,
  isTafDeteriorating,
} from '../../../../utils/tafUtils';
import { FLIGHT_CATEGORIES } from '../../../../utils/metarUtils';

/**
 * Custom hook for popup accessibility (Escape key and auto-focus)
 */
function usePopupAccessibility(isOpen, onClose) {
  const popupRef = useRef(null);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen && popupRef.current) {
      popupRef.current.focus();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  return popupRef;
}

/**
 * Flight category badge component
 */
const FlightCategoryBadge = memo(function FlightCategoryBadge({ category, small = false }) {
  const info = FLIGHT_CATEGORIES[category] || FLIGHT_CATEGORIES.VFR;

  return (
    <span
      className={`flight-cat-badge ${category.toLowerCase()} ${small ? 'small' : ''}`}
      title={info.description}
    >
      {category}
    </span>
  );
});

/**
 * Change group component - renders a single TAF change group
 */
const ChangeGroupItem = memo(function ChangeGroupItem({ group, index }) {
  const timeStr = group.startTime
    ? formatTafTime(group.startTime)
    : group.rawTime || '--';

  const endTimeStr = group.endTime ? ` - ${formatTafTime(group.endTime)}` : '';

  return (
    <div className={`taf-change-group ${group.type.toLowerCase()}`}>
      <div className="change-header">
        <span className="change-type">{group.typeDesc}</span>
        <span className="change-time">
          <Clock size={12} /> {timeStr}{endTimeStr}
        </span>
        {group.flightCategory && (
          <FlightCategoryBadge category={group.flightCategory} small />
        )}
      </div>

      <div className="change-conditions">
        {/* Wind */}
        {group.wind && (
          <div className="condition-item">
            <Wind size={14} />
            <span>{formatTafWind(group.wind)}</span>
          </div>
        )}

        {/* Visibility */}
        {group.visibility && (
          <div className="condition-item">
            <Eye size={14} />
            <span>{formatTafVisibility(group.visibility)}</span>
          </div>
        )}

        {/* Ceiling */}
        {group.ceiling !== null && group.ceiling !== undefined && (
          <div className="condition-item">
            <Cloud size={14} />
            <span>{formatTafCeiling(group.ceiling)}</span>
          </div>
        )}

        {/* Weather phenomena */}
        {group.weather && group.weather.length > 0 && (
          <div className="condition-item weather">
            {group.weather.some((w) => w.isSignificant) && (
              <AlertTriangle size={14} className="significant" />
            )}
            <span>{group.weather.map((w) => w.description).join(', ')}</span>
          </div>
        )}

        {/* Clouds */}
        {group.clouds && group.clouds.length > 0 && (
          <div className="condition-item clouds">
            {group.clouds.map((c, i) => (
              <span key={i} className="cloud-layer">
                {c.cover} {Math.round(c.base / 100).toString().padStart(3, '0')}
                {c.type && <span className="cloud-type">{c.type}</span>}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

/**
 * Category transition indicator
 */
const TransitionIndicator = memo(function TransitionIndicator({ transitionInfo }) {
  if (!transitionInfo || transitionInfo.transitions.length === 0) return null;

  const improving = transitionInfo.transitions.some(
    (t) =>
      ['LIFR', 'IFR'].includes(t.from) &&
      ['MVFR', 'VFR'].includes(t.to)
  );

  const deteriorating = transitionInfo.transitions.some(
    (t) =>
      ['VFR', 'MVFR'].includes(t.from) &&
      ['IFR', 'LIFR'].includes(t.to)
  );

  return (
    <div className={`transition-indicator ${improving ? 'improving' : deteriorating ? 'deteriorating' : ''}`}>
      {improving && <TrendingUp size={16} />}
      {deteriorating && <TrendingDown size={16} />}
      <span className="transition-summary">
        {transitionInfo.transitions.slice(0, 3).map((t, i) => (
          <span key={i} className="transition-item">
            <FlightCategoryBadge category={t.from} small />
            <ChevronRight size={12} />
            <FlightCategoryBadge category={t.to} small />
            {t.isTemporary && <span className="temp-label">temp</span>}
          </span>
        ))}
        {transitionInfo.transitions.length > 3 && (
          <span className="more">+{transitionInfo.transitions.length - 3} more</span>
        )}
      </span>
    </div>
  );
});

/**
 * TAF Popup Component
 * Displays decoded TAF forecast data for an airport
 *
 * @param {Object} taf - Decoded TAF object from useTafData
 * @param {Function} onClose - Close handler
 * @param {string} mapMode - 'pro' or 'crt' for styling
 * @param {Function} getDistanceNm - Distance calculation function
 */
export const TafPopup = memo(function TafPopup({
  taf,
  onClose,
  mapMode,
  getDistanceNm,
}) {
  const { position, isDragging, handleMouseDown } = useDraggable({ x: 120, y: 120 });
  const popupRef = usePopupAccessibility(!!taf, onClose);
  const titleId = `taf-popup-title-${taf?.stationId || 'unknown'}`;

  if (!taf) return null;

  const isStale = isTafStale(taf);
  const remainingHours = getTafRemainingHours(taf);
  const transitionInfo = getCategoryTransition(taf);
  const improving = isTafImproving(taf);
  const deteriorating = isTafDeteriorating(taf);

  return (
    <div
      ref={popupRef}
      className={`weather-popup taf-popup ${mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${isDragging ? 'dragging' : ''} ${isStale ? 'stale' : ''}`}
      style={{ left: position.x, top: position.y }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      {/* Drag handle */}
      <div className="popup-drag-handle" onMouseDown={handleMouseDown} aria-hidden="true" />

      <button className="popup-close no-drag" onClick={onClose} aria-label="Close TAF popup">
        <X size={16} />
      </button>

      {/* Header */}
      <div className="popup-header">
        <Cloud size={20} aria-hidden="true" />
        <span id={titleId} className="popup-callsign">
          {taf.stationId} TAF
        </span>
        <FlightCategoryBadge category={taf.currentCategory} />
        {improving && <TrendingUp size={16} className="trend-icon improving" title="Improving" />}
        {deteriorating && <TrendingDown size={16} className="trend-icon deteriorating" title="Deteriorating" />}
      </div>

      <div className="popup-details">
        {/* Station name */}
        {taf.name && (
          <div className="detail-row">
            <span>Station</span>
            <span>{taf.name}</span>
          </div>
        )}

        {/* Validity period */}
        <div className="detail-row">
          <span>Valid</span>
          <span>
            {formatTafValidity(taf.validFrom, taf.validTo)}
            {remainingHours >= 0 && (
              <span className="validity-remaining">
                ({remainingHours}h remaining)
              </span>
            )}
          </span>
        </div>

        {/* Summary */}
        <div className="detail-row summary-row">
          <span>Summary</span>
          <span className="taf-summary">{getTafSummary(taf)}</span>
        </div>

        {/* Category transitions */}
        {transitionInfo && (
          <div className="detail-row transitions-row">
            <span>Forecast</span>
            <TransitionIndicator transitionInfo={transitionInfo} />
          </div>
        )}

        {/* Base conditions */}
        <div className="detail-section">
          <div className="section-header">
            <span>Current Conditions</span>
            <FlightCategoryBadge category={taf.currentCategory} small />
          </div>

          {taf.baseConditions && (
            <div className="base-conditions">
              {taf.baseConditions.wind && (
                <div className="condition-item">
                  <Wind size={14} />
                  <span>{formatTafWind(taf.baseConditions.wind)}</span>
                </div>
              )}

              {taf.baseConditions.visibility && (
                <div className="condition-item">
                  <Eye size={14} />
                  <span>{formatTafVisibility(taf.baseConditions.visibility)}</span>
                </div>
              )}

              {taf.baseConditions.ceiling !== null && (
                <div className="condition-item">
                  <Cloud size={14} />
                  <span>Ceiling {formatTafCeiling(taf.baseConditions.ceiling)}</span>
                </div>
              )}

              {taf.baseConditions.weather && taf.baseConditions.weather.length > 0 && (
                <div className="condition-item weather">
                  {taf.baseConditions.weather.some((w) => w.isSignificant) && (
                    <AlertTriangle size={14} className="significant" />
                  )}
                  <span>
                    {taf.baseConditions.weather.map((w) => w.description).join(', ')}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Change groups */}
        {taf.changeGroups && taf.changeGroups.length > 0 && (
          <div className="detail-section changes-section">
            <div className="section-header">
              <span>Forecast Changes ({taf.changeGroups.length})</span>
            </div>

            <div className="change-groups">
              {taf.changeGroups.map((group, index) => (
                <ChangeGroupItem key={index} group={group} index={index} />
              ))}
            </div>
          </div>
        )}

        {/* Significant weather warning */}
        {taf.hasSignificantWeather && taf.significantWeather && taf.significantWeather.length > 0 && (
          <div className="detail-section significant-weather-section">
            <div className="section-header warning">
              <AlertTriangle size={14} />
              <span>Significant Weather</span>
            </div>
            <div className="significant-weather-list">
              {taf.significantWeather.map((wx, i) => (
                <span key={i} className="sig-wx-item">
                  {wx.description || wx.code}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Raw TAF */}
        {taf.raw && (
          <div className="detail-row raw-section">
            <span>Raw TAF</span>
            <span className="mono raw-text">{taf.raw}</span>
          </div>
        )}

        {/* Distance */}
        {getDistanceNm && taf.lat && (
          <div className="detail-row">
            <span>Distance</span>
            <span>{getDistanceNm(taf.lat, taf.lon).toFixed(1)} nm</span>
          </div>
        )}

        {/* Stale warning */}
        {isStale && (
          <div className="stale-warning">
            <AlertTriangle size={14} />
            <span>TAF data may be outdated</span>
          </div>
        )}
      </div>
    </div>
  );
});

export default TafPopup;
