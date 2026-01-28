/**
 * CanvasRadar - Canvas-based radar visualization
 *
 * Uses Canvas2D for smooth 60fps animations and better performance
 * with many blips. Features:
 * - True radar sweep effect
 * - Smooth position interpolation
 * - Touch/click interaction for threat selection
 */
import React, { useRef, useEffect, useCallback, memo, useMemo } from 'react';

// Threat level colors
const THREAT_COLORS = {
  critical: '#ef4444',
  warning: '#f59e0b',
  info: '#22c55e',
};

// Convert distance/bearing to canvas coordinates
function threatToCanvas(threat, centerX, centerY, radius, maxRange, userHeading) {
  const normalizedDist = Math.min(threat.distance_nm / maxRange, 1);
  const r = normalizedDist * radius;

  let adjustedBearing = threat.bearing;
  if (userHeading !== null && userHeading !== undefined) {
    adjustedBearing = (threat.bearing - userHeading + 360) % 360;
  }

  const radians = (adjustedBearing - 90) * (Math.PI / 180);

  return {
    x: centerX + r * Math.cos(radians),
    y: centerY + r * Math.sin(radians),
    bearing: adjustedBearing,
  };
}

/**
 * CanvasRadar component
 */
export const CanvasRadar = memo(function CanvasRadar({
  threats = [],
  userHeading = null,
  maxRange = 15,
  size = 200,
  onThreatClick,
  expanded = false,
  sweepEnabled = true,
  className = '',
}) {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const sweepAngleRef = useRef(0);
  const lastTimeRef = useRef(0);
  const threatPositionsRef = useRef([]);

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const actualSize = size * dpr;
  const radius = (size / 2) - 10;
  const centerX = size / 2;
  const centerY = size / 2;

  // Pre-calculate threat positions for current frame
  const threatPositions = useMemo(() => {
    return threats.map(threat => ({
      ...threat,
      ...threatToCanvas(threat, centerX, centerY, radius, maxRange, userHeading),
    }));
  }, [threats, centerX, centerY, radius, maxRange, userHeading]);

  // Store for click detection
  useEffect(() => {
    threatPositionsRef.current = threatPositions;
  }, [threatPositions]);

  // Draw radar frame
  const drawRadar = useCallback((ctx, sweepAngle) => {
    ctx.clearRect(0, 0, size, size);

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();

    // Range rings
    const ringDistances = [5, 10, maxRange];
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.2)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    ringDistances.forEach(distance => {
      const ringRadius = (distance / maxRange) * radius;
      ctx.beginPath();
      ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Range labels for expanded mode
      if (expanded) {
        ctx.fillStyle = 'rgba(34, 197, 94, 0.5)';
        ctx.font = '10px monospace';
        ctx.fillText(`${distance}nm`, centerX + ringRadius - 20, centerY - 5);
      }
    });

    ctx.setLineDash([]);

    // Crosshairs
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.15)';
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - radius);
    ctx.lineTo(centerX, centerY + radius);
    ctx.moveTo(centerX - radius, centerY);
    ctx.lineTo(centerX + radius, centerY);
    ctx.stroke();

    // Cardinal directions
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', centerX, centerY - radius + 12);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fillText('S', centerX, centerY + radius - 4);
    ctx.textAlign = 'right';
    ctx.fillText('E', centerX + radius - 4, centerY + 4);
    ctx.textAlign = 'left';
    ctx.fillText('W', centerX - radius + 4, centerY + 4);

    // Radar sweep effect
    if (sweepEnabled) {
      const sweepGradient = ctx.createConicalGradient(centerX, centerY, (sweepAngle - 90) * Math.PI / 180);
      sweepGradient.addColorStop(0, 'rgba(34, 197, 94, 0.3)');
      sweepGradient.addColorStop(0.1, 'rgba(34, 197, 94, 0.1)');
      sweepGradient.addColorStop(0.2, 'rgba(34, 197, 94, 0)');

      // Fallback if conic gradient not supported
      ctx.fillStyle = 'rgba(34, 197, 94, 0.1)';
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      const startAngle = (sweepAngle - 90) * Math.PI / 180;
      const endAngle = (sweepAngle - 90 + 45) * Math.PI / 180;
      ctx.arc(centerX, centerY, radius, startAngle, endAngle);
      ctx.closePath();
      ctx.fill();

      // Sweep line
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(
        centerX + radius * Math.cos(startAngle),
        centerY + radius * Math.sin(startAngle)
      );
      ctx.stroke();
    }

    // Draw threat blips
    threatPositions.forEach(threat => {
      const color = THREAT_COLORS[threat.threat_level] || THREAT_COLORS.info;
      const blipSize = threat.threat_level === 'critical' ? 8 : 6;

      // Pulse effect for critical threats
      if (threat.threat_level === 'critical') {
        const pulseSize = blipSize + 4 + Math.sin(Date.now() / 200) * 2;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(threat.x, threat.y, pulseSize, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Main blip
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(threat.x, threat.y, blipSize, 0, Math.PI * 2);
      ctx.fill();

      // Border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Direction indicator (for moving aircraft)
      if (threat.ground_speed > 50 && threat.track !== undefined) {
        const trackRad = (threat.track - 90) * Math.PI / 180;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(threat.x, threat.y);
        ctx.lineTo(
          threat.x + Math.cos(trackRad) * 12,
          threat.y + Math.sin(trackRad) * 12
        );
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Distance label for expanded mode
      if (expanded) {
        ctx.fillStyle = color;
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(threat.distance_nm.toFixed(1), threat.x + 10, threat.y + 4);
      }
    });

    // Center marker (user position)
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();

    // User heading indicator
    if (userHeading !== null && userHeading !== undefined) {
      ctx.fillStyle = '#3b82f6';
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY - 15);
      ctx.lineTo(centerX - 5, centerY - 5);
      ctx.lineTo(centerX + 5, centerY - 5);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Border
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();
  }, [size, centerX, centerY, radius, maxRange, userHeading, expanded, sweepEnabled, threatPositions]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Scale for high DPI
    ctx.scale(dpr, dpr);

    const animate = (timestamp) => {
      if (!lastTimeRef.current) lastTimeRef.current = timestamp;
      const delta = timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;

      // Update sweep angle (one rotation per 3 seconds)
      sweepAngleRef.current = (sweepAngleRef.current + (delta / 3000) * 360) % 360;

      // Reset scale before drawing
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      drawRadar(ctx, sweepAngleRef.current);

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [drawRadar, dpr]);

  // Handle click/touch for threat selection
  const handleCanvasClick = useCallback((e) => {
    if (!onThreatClick) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (size / rect.width);
    const y = (e.clientY - rect.top) * (size / rect.height);

    // Find closest threat within 20px
    let closestThreat = null;
    let closestDist = 20;

    threatPositionsRef.current.forEach(threat => {
      const dist = Math.hypot(threat.x - x, threat.y - y);
      if (dist < closestDist) {
        closestDist = dist;
        closestThreat = threat;
      }
    });

    if (closestThreat) {
      onThreatClick(closestThreat);
    }
  }, [onThreatClick, size]);

  return (
    <div
      className={`canvas-radar ${expanded ? 'expanded' : ''} ${className}`}
      style={{ width: size, height: size }}
    >
      <canvas
        ref={canvasRef}
        width={actualSize}
        height={actualSize}
        style={{ width: size, height: size }}
        onClick={handleCanvasClick}
      />

      {/* Legend for expanded mode */}
      {expanded && (
        <div className="radar-legend">
          <span className="legend-item critical">● Critical</span>
          <span className="legend-item warning">● Warning</span>
          <span className="legend-item info">● Clear</span>
        </div>
      )}
    </div>
  );
});

export default CanvasRadar;
