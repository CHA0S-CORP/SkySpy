import { useState, useEffect } from 'react';

/**
 * Custom hook for drawing profile canvases (altitude, speed, vertical speed, distance).
 * Extracted from MapView.jsx — manages 4 profile canvas useEffects plus the
 * shared drawWaitingSpinner helper and the auto-refresh animation timer.
 */
export function useProfileCanvases({
  selectedAircraft,
  sidebarAircraftHex,
  aircraftInfo,
  config,
  trackHistory,
  sortedAircraft,
  feederLat,
  feederLon,
  getDistanceNm,
  altProfileCanvasRef,
  speedProfileCanvasRef,
  vsProfileCanvasRef,
  distProfileCanvasRef,
}) {
  // Animation frame counter for loading spinners
  const [_canvasAnimFrame, setCanvasAnimFrame] = useState(0);

  // Auto-refresh canvas animation when waiting for data
  useEffect(() => {
    if (!selectedAircraft) return;

    const history = trackHistory[selectedAircraft.hex];
    const needsAnimation = !history || history.length < 2;

    if (needsAnimation) {
      const interval = setInterval(() => {
        setCanvasAnimFrame((f) => (f + 1) % 12);
      }, 150);
      return () => clearInterval(interval);
    }
  }, [selectedAircraft, trackHistory]);

  // Helper to draw animated "waiting for data" spinner on canvas
  const drawWaitingSpinner = (
    ctx,
    width,
    height,
    color = 'rgba(138, 148, 158, 0.4)',
    frame = 0
  ) => {
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = 12;
    const dotCount = 8;

    // Draw spinning dots
    for (let i = 0; i < dotCount; i++) {
      const angle = (i / dotCount) * Math.PI * 2 - Math.PI / 2;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      const opacity = ((i + frame) % dotCount) / dotCount;

      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fillStyle = color.replace('0.4', opacity.toFixed(2));
      ctx.fill();
    }

    // Draw text below spinner
    ctx.fillStyle = color;
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Loading...', centerX, centerY + 24);
  };

  // Draw altitude profile canvas
  useEffect(() => {
    if (!altProfileCanvasRef.current || !selectedAircraft) return;

    const canvas = altProfileCanvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 280, 60);

    const history = trackHistory[selectedAircraft.hex];
    if (!history || history.length === 0) {
      drawWaitingSpinner(ctx, 280, 60, 'rgba(0, 212, 255, 0.4)');
      return;
    }

    const alts = history.map((p) => p.alt || 0);
    const validAlts = alts.filter((a) => a > 0);

    // If only one point or no valid alts, draw a horizontal line at center
    if (validAlts.length === 0) {
      drawWaitingSpinner(ctx, 280, 60, 'rgba(0, 212, 255, 0.4)');
      return;
    }

    const minAlt = Math.min(...validAlts);
    const maxAlt = Math.max(...validAlts);
    const range = Math.max(maxAlt - minAlt, 100);
    const pad = 5;

    const getY = (alt) => {
      const normalized = Math.max(0, Math.min(1, (alt - minAlt) / range));
      return 60 - pad - normalized * (60 - pad * 2);
    };

    // Draw gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 60);
    gradient.addColorStop(0, 'rgba(0, 212, 255, 0.3)');
    gradient.addColorStop(1, 'rgba(0, 212, 255, 0.05)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, 60 - pad);

    const xStep = history.length > 1 ? 280 / (history.length - 1) : 280;
    history.forEach((p, i) => {
      const x = history.length > 1 ? i * xStep : 140;
      ctx.lineTo(x, getY(p.alt || minAlt));
    });

    // If single point, extend to full width
    if (history.length === 1) {
      ctx.lineTo(280, getY(history[0].alt || minAlt));
    }

    ctx.lineTo(280, 60 - pad);
    ctx.closePath();
    ctx.fill();

    // Draw line
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();

    history.forEach((p, i) => {
      const x = history.length > 1 ? i * xStep : 0;
      const y = getY(p.alt || minAlt);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    // If single point, draw horizontal line
    if (history.length === 1) {
      ctx.lineTo(280, getY(history[0].alt || minAlt));
    }

    ctx.stroke();
  }, [selectedAircraft, trackHistory]);

  // Draw speed profile canvas
  useEffect(() => {
    if (!speedProfileCanvasRef.current || !selectedAircraft) return;

    const canvas = speedProfileCanvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 280, 60);

    const history = trackHistory[selectedAircraft.hex];
    if (!history || history.length === 0) {
      drawWaitingSpinner(ctx, 280, 60, 'rgba(74, 222, 128, 0.4)');
      return;
    }

    const speeds = history.map((p) => p.spd || 0);
    const validSpeeds = speeds.filter((s) => s > 0);

    if (validSpeeds.length === 0) {
      drawWaitingSpinner(ctx, 280, 60, 'rgba(74, 222, 128, 0.4)');
      return;
    }

    const minSpd = Math.min(...validSpeeds);
    const maxSpd = Math.max(...validSpeeds);
    const range = Math.max(maxSpd - minSpd, 20);
    const pad = 5;

    const getY = (spd) => {
      const normalized = Math.max(0, Math.min(1, (spd - minSpd) / range));
      return 60 - pad - normalized * (60 - pad * 2);
    };

    // Draw gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 60);
    gradient.addColorStop(0, 'rgba(74, 222, 128, 0.3)');
    gradient.addColorStop(1, 'rgba(74, 222, 128, 0.05)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, 60 - pad);

    const xStep = history.length > 1 ? 280 / (history.length - 1) : 280;
    history.forEach((p, i) => {
      const x = history.length > 1 ? i * xStep : 140;
      ctx.lineTo(x, getY(p.spd || minSpd));
    });

    if (history.length === 1) {
      ctx.lineTo(280, getY(history[0].spd || minSpd));
    }

    ctx.lineTo(280, 60 - pad);
    ctx.closePath();
    ctx.fill();

    // Draw line
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();

    history.forEach((p, i) => {
      const x = history.length > 1 ? i * xStep : 0;
      const y = getY(p.spd || minSpd);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    if (history.length === 1) {
      ctx.lineTo(280, getY(history[0].spd || minSpd));
    }

    ctx.stroke();
  }, [selectedAircraft, trackHistory]);

  // Draw vertical speed profile canvas
  useEffect(() => {
    if (!vsProfileCanvasRef.current || !selectedAircraft) return;

    const canvas = vsProfileCanvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 280, 60);

    const history = trackHistory[selectedAircraft.hex];
    const pad = 5;
    const centerY = 30;
    const halfHeight = centerY - pad;

    // Always draw zero line
    ctx.strokeStyle = 'rgba(138, 148, 158, 0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(280, centerY);
    ctx.stroke();
    ctx.setLineDash([]);

    if (!history || history.length === 0) {
      drawWaitingSpinner(ctx, 280, 60, 'rgba(138, 148, 158, 0.4)');
      return;
    }

    const vsValues = history.map((p) => p.vs || 0);
    const maxAbsVs = Math.max(
      Math.abs(Math.min(...vsValues)),
      Math.abs(Math.max(...vsValues)),
      500
    );

    const getY = (vs) => {
      const normalized = Math.max(-1, Math.min(1, vs / maxAbsVs));
      return centerY - normalized * halfHeight;
    };

    // Draw gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 60);
    gradient.addColorStop(0, 'rgba(34, 197, 94, 0.2)');
    gradient.addColorStop(0.5, 'rgba(138, 148, 158, 0.05)');
    gradient.addColorStop(1, 'rgba(249, 115, 22, 0.2)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, centerY);

    const xStep = history.length > 1 ? 280 / (history.length - 1) : 280;
    history.forEach((p, i) => {
      const x = history.length > 1 ? i * xStep : 140;
      ctx.lineTo(x, getY(p.vs || 0));
    });

    if (history.length === 1) {
      ctx.lineTo(280, getY(history[0].vs || 0));
    }

    ctx.lineTo(280, centerY);
    ctx.closePath();
    ctx.fill();

    // Draw line - use green for climbing, orange for descending
    const latestVs = history.length > 0 ? history[history.length - 1].vs || 0 : 0;
    ctx.strokeStyle =
      latestVs > 0
        ? 'rgba(34, 197, 94, 0.9)'
        : latestVs < 0
          ? 'rgba(249, 115, 22, 0.9)'
          : 'rgba(138, 148, 158, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();

    history.forEach((p, i) => {
      const x = history.length > 1 ? i * xStep : 0;
      const y = getY(p.vs || 0);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    if (history.length === 1) {
      ctx.lineTo(280, getY(history[0].vs || 0));
    }

    ctx.stroke();
  }, [selectedAircraft, trackHistory]);

  // Draw distance profile canvas
  useEffect(() => {
    if (!distProfileCanvasRef.current || !selectedAircraft) return;

    const canvas = distProfileCanvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 280, 60);

    const history = trackHistory[selectedAircraft.hex];
    if (!history || history.length === 0) {
      drawWaitingSpinner(ctx, 280, 60, 'rgba(163, 113, 247, 0.4)');
      return;
    }

    const dists = history.map((p) => p.dist || 0).filter((d) => d > 0);

    if (dists.length === 0) {
      drawWaitingSpinner(ctx, 280, 60, 'rgba(163, 113, 247, 0.4)');
      return;
    }

    const minDist = Math.min(...dists);
    const maxDist = Math.max(...dists);
    const range = maxDist - minDist || 10;
    const pad = 5;

    // Helper to clamp Y values within canvas bounds
    const getY = (dist) => {
      const normalized = Math.max(0, Math.min(1, (dist - minDist) / range));
      return 60 - pad - normalized * (60 - pad * 2);
    };

    // Draw gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 60);
    gradient.addColorStop(0, 'rgba(163, 113, 247, 0.3)');
    gradient.addColorStop(1, 'rgba(163, 113, 247, 0.05)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, 60 - pad);

    const xStep = history.length > 1 ? 280 / (history.length - 1) : 280;
    history.forEach((p, i) => {
      const x = history.length > 1 ? i * xStep : 140;
      ctx.lineTo(x, getY(p.dist || minDist));
    });

    if (history.length === 1) {
      ctx.lineTo(280, getY(history[0].dist || minDist));
    }

    ctx.lineTo(280, 60 - pad);
    ctx.closePath();
    ctx.fill();

    // Draw line
    ctx.strokeStyle = 'rgba(163, 113, 247, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();

    history.forEach((p, i) => {
      const x = history.length > 1 ? i * xStep : 0;
      const y = getY(p.dist || minDist);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    if (history.length === 1) {
      ctx.lineTo(280, getY(history[0].dist || minDist));
    }

    ctx.stroke();
  }, [selectedAircraft, trackHistory]);
}
