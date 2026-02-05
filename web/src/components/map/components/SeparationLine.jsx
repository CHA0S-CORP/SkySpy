/**
 * SeparationLine Component
 * Phase 8.5 Implementation - Pro Radar Mode
 *
 * Renders the separation measurement line and labels between two aircraft
 * on the Pro Mode radar canvas.
 *
 * This component provides the drawing logic - the actual canvas drawing
 * is done by passing the draw function to the parent component.
 */

import React from 'react';
import PropTypes from 'prop-types';
import { getSeparationColor, SEPARATION_STATUS } from '../../../utils/separationRules';

/**
 * Draw separation line and labels on canvas
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D context
 * @param {Object} options - Drawing options
 * @param {Object} options.aircraft1 - First aircraft { lat, lon, hex, flight }
 * @param {Object} options.aircraft2 - Second aircraft { lat, lon, hex, flight }
 * @param {Object} options.separationData - Result from checkSeparation()
 * @param {number} options.centerX - Canvas center X
 * @param {number} options.centerY - Canvas center Y
 * @param {number} options.pixelsPerNm - Pixels per nautical mile
 * @param {number} options.feederLat - Feeder latitude
 * @param {number} options.feederLon - Feeder longitude
 * @param {Object} options.panOffset - Pan offset { x, y }
 */
export function drawSeparationLine(ctx, options) {
  const {
    aircraft1,
    aircraft2,
    separationData,
    centerX,
    centerY,
    pixelsPerNm,
    feederLat,
    feederLon,
    panOffset = { x: 0, y: 0 },
  } = options;

  if (!aircraft1 || !aircraft2 || !separationData) return;

  // Get positions on screen
  const getScreenPos = (lat, lon) => {
    const nmY = (lat - feederLat) * 60;
    const nmX = (lon - feederLon) * 60 * Math.cos((feederLat * Math.PI) / 180);
    return {
      x: centerX + nmX * pixelsPerNm + panOffset.x,
      y: centerY - nmY * pixelsPerNm + panOffset.y,
    };
  };

  const pos1 = getScreenPos(aircraft1.lat, aircraft1.lon);
  const pos2 = getScreenPos(aircraft2.lat, aircraft2.lon);

  // Get color based on separation status
  const color = getSeparationColor(separationData.status?.overall || SEPARATION_STATUS.ADEQUATE);

  ctx.save();

  // Draw line between aircraft
  ctx.beginPath();
  ctx.setLineDash([8, 4]);
  ctx.strokeStyle = color.stroke;
  ctx.lineWidth = 2;
  ctx.moveTo(pos1.x, pos1.y);
  ctx.lineTo(pos2.x, pos2.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw markers at aircraft positions
  ctx.fillStyle = color.fill;
  ctx.strokeStyle = color.stroke;
  ctx.lineWidth = 2;

  // Aircraft 1 marker
  ctx.beginPath();
  ctx.arc(pos1.x, pos1.y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Aircraft 2 marker
  ctx.beginPath();
  ctx.arc(pos2.x, pos2.y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Calculate midpoint for label
  const midX = (pos1.x + pos2.x) / 2;
  const midY = (pos1.y + pos2.y) / 2;

  // Calculate label offset (perpendicular to line)
  const lineAngle = Math.atan2(pos2.y - pos1.y, pos2.x - pos1.x);
  const labelOffset = 25;
  const labelX = midX + Math.cos(lineAngle + Math.PI / 2) * labelOffset;
  const labelY = midY + Math.sin(lineAngle + Math.PI / 2) * labelOffset;

  // Draw separation info box
  ctx.font = 'bold 11px "JetBrains Mono", monospace';

  // Prepare text lines
  const lateralText = separationData.actual?.lateralFormatted || '-- nm';
  const verticalText = separationData.actual?.verticalFormatted || '-- ft';
  const statusText = separationData.status?.overall?.toUpperCase() || '';

  // Measure text widths
  const line1 = `${lateralText} / ${verticalText}`;
  const line1Width = ctx.measureText(line1).width;
  const statusWidth = ctx.measureText(statusText).width;
  const boxWidth = Math.max(line1Width, statusWidth) + 16;
  const boxHeight = 38;

  // Draw background box
  ctx.fillStyle = 'rgba(10, 15, 25, 0.95)';
  ctx.beginPath();
  ctx.roundRect(labelX - boxWidth / 2, labelY - boxHeight / 2, boxWidth, boxHeight, 4);
  ctx.fill();

  // Draw border based on status
  ctx.strokeStyle = color.stroke;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Draw text
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Separation values
  ctx.fillStyle = color.text;
  ctx.fillText(line1, labelX, labelY - 8);

  // Status indicator
  ctx.font = 'bold 10px "JetBrains Mono", monospace';
  ctx.fillStyle =
    separationData.status?.overall === SEPARATION_STATUS.VIOLATION
      ? 'rgba(255, 100, 100, 1)'
      : separationData.status?.overall === SEPARATION_STATUS.MARGINAL
        ? 'rgba(255, 220, 100, 1)'
        : 'rgba(100, 255, 150, 1)';
  ctx.fillText(statusText, labelX, labelY + 8);

  // Draw callsign labels near aircraft markers
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.fillStyle = color.text;
  ctx.textAlign = 'left';

  const callsign1 = aircraft1.flight?.trim() || aircraft1.hex?.toUpperCase() || 'AC1';
  const callsign2 = aircraft2.flight?.trim() || aircraft2.hex?.toUpperCase() || 'AC2';

  // Aircraft 1 label
  ctx.fillText(callsign1, pos1.x + 12, pos1.y - 4);
  ctx.fillStyle = 'rgba(180, 200, 220, 0.8)';
  ctx.fillText(`${aircraft1.alt_baro ?? aircraft1.alt_geom ?? aircraft1.altitude ?? '--'} ft`, pos1.x + 12, pos1.y + 8);

  // Aircraft 2 label
  ctx.fillStyle = color.text;
  ctx.fillText(callsign2, pos2.x + 12, pos2.y - 4);
  ctx.fillStyle = 'rgba(180, 200, 220, 0.8)';
  ctx.fillText(`${aircraft2.alt_baro ?? aircraft2.alt_geom ?? aircraft2.altitude ?? '--'} ft`, pos2.x + 12, pos2.y + 8);

  ctx.restore();
}

/**
 * SeparationLine React Component
 * Renders nothing directly - use the drawSeparationLine function in canvas drawing
 *
 * This component can be used for displaying separation info in a UI panel
 */
function SeparationLine({ aircraft1, aircraft2, separationData, onClear }) {
  if (!separationData) return null;

  const color = getSeparationColor(separationData.status?.overall || SEPARATION_STATUS.ADEQUATE);

  return (
    <div className="separation-tool-panel" style={{ borderColor: color.stroke }}>
      <div className="separation-tool-header">
        <span>Separation Measurement</span>
        <button onClick={onClear} className="separation-tool-close">
          &times;
        </button>
      </div>
      <div className="separation-tool-content">
        <div className="separation-aircraft">
          <span className="sep-label">AC1:</span>
          <span className="sep-value">
            {aircraft1?.flight?.trim() || aircraft1?.hex?.toUpperCase() || '--'}
          </span>
        </div>
        <div className="separation-aircraft">
          <span className="sep-label">AC2:</span>
          <span className="sep-value">
            {aircraft2?.flight?.trim() || aircraft2?.hex?.toUpperCase() || '--'}
          </span>
        </div>
        <div className="separation-values">
          <div className="sep-row">
            <span className="sep-label">Lateral:</span>
            <span className="sep-value" style={{ color: color.text }}>
              {separationData.actual?.lateralFormatted || '--'}
            </span>
            <span className="sep-required">
              ({separationData.required?.lateral?.required} nm min)
            </span>
          </div>
          <div className="sep-row">
            <span className="sep-label">Vertical:</span>
            <span className="sep-value" style={{ color: color.text }}>
              {separationData.actual?.verticalFormatted || '--'}
            </span>
            <span className="sep-required">
              ({separationData.required?.vertical?.required?.toLocaleString()} ft min)
            </span>
          </div>
        </div>
        <div
          className="separation-status"
          style={{ backgroundColor: color.fill, borderColor: color.stroke }}
        >
          <span style={{ color: color.text }}>
            {separationData.status?.overall?.toUpperCase() || 'UNKNOWN'}
          </span>
        </div>
      </div>
    </div>
  );
}

SeparationLine.propTypes = {
  aircraft1: PropTypes.object,
  aircraft2: PropTypes.object,
  separationData: PropTypes.object,
  onClear: PropTypes.func,
};

export { SeparationLine };
export default SeparationLine;
