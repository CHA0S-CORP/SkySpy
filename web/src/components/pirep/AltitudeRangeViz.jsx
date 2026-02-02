import React from 'react';
import { Plane } from 'lucide-react';

/**
 * Vertical altitude scale showing hazard layers
 * Shows turbulence/icing altitude ranges with aircraft position
 */
export function AltitudeRangeViz({ decoded, pirep }) {
  const maxFL = 450; // FL450 = 45,000 ft
  const minFL = 0;

  // Get reported altitude
  const flightLevel = pirep?.flight_level ?? pirep?.fltLvl;
  const altitudeFt = pirep?.altitude_ft ?? (flightLevel ? flightLevel * 100 : null);
  const reportedFL = altitudeFt ? Math.round(altitudeFt / 100) : null;

  // Get hazard altitude ranges
  const turbBase = pirep?.turbulence_base_ft ? Math.round(pirep.turbulence_base_ft / 100) : null;
  const turbTop = pirep?.turbulence_top_ft ? Math.round(pirep.turbulence_top_ft / 100) : null;
  const iceBase = pirep?.icing_base_ft ? Math.round(pirep.icing_base_ft / 100) : null;
  const iceTop = pirep?.icing_top_ft ? Math.round(pirep.icing_top_ft / 100) : null;

  // Convert FL to percentage position (inverted - top is high)
  const flToPercent = (fl) => {
    if (fl === null || fl === undefined) return null;
    return Math.max(0, Math.min(100, (1 - fl / maxFL) * 100));
  };

  const reportedPercent = flToPercent(reportedFL);

  // Altitude scale markers
  const scaleMarkers = [0, 100, 180, 250, 350, 450];

  return (
    <div className="altitude-range-viz">
      <div className="altitude-scale">
        {/* Scale markers */}
        {scaleMarkers.map((fl) => (
          <div
            key={fl}
            className={`scale-marker ${fl === 180 ? 'fl180' : ''}`}
            style={{ top: `${flToPercent(fl)}%` }}
          >
            <span className="marker-label">FL{fl}</span>
            <span className="marker-line" />
          </div>
        ))}

        {/* Turbulence layer band */}
        {turbBase !== null && turbTop !== null && (
          <div
            className="hazard-band turbulence"
            style={{
              top: `${flToPercent(turbTop)}%`,
              height: `${flToPercent(turbBase) - flToPercent(turbTop)}%`,
            }}
            title={`Turbulence: FL${turbBase}-FL${turbTop}`}
          />
        )}

        {/* Icing layer band */}
        {iceBase !== null && iceTop !== null && (
          <div
            className="hazard-band icing"
            style={{
              top: `${flToPercent(iceTop)}%`,
              height: `${flToPercent(iceBase) - flToPercent(iceTop)}%`,
            }}
            title={`Icing: FL${iceBase}-FL${iceTop}`}
          />
        )}

        {/* Reported altitude marker */}
        {reportedPercent !== null && (
          <div className="aircraft-marker" style={{ top: `${reportedPercent}%` }}>
            <Plane size={14} />
            <span className="altitude-label">FL{reportedFL}</span>
          </div>
        )}
      </div>

      <div className="altitude-legend">
        {decoded?.turbulence && (
          <span className="legend-item turbulence">
            <span className="legend-color" /> Turbulence
          </span>
        )}
        {decoded?.icing && (
          <span className="legend-item icing">
            <span className="legend-color" /> Icing
          </span>
        )}
      </div>
    </div>
  );
}

export default AltitudeRangeViz;
