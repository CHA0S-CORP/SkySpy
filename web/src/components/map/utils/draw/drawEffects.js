/**
 * Canvas draw effects extracted from MapView.jsx
 *
 * Each function takes (ctx, geo) where:
 *   ctx  = Canvas 2D rendering context
 *   geo  = { width, height, centerX, centerY, maxRadius, isPro, reducedMotion, frameCount, sweepAngleRef }
 */

/**
 * Rotating radar sweep line with trailing gradient arc (CRT mode only).
 * Updates geo.sweepAngleRef.current each frame to animate the rotation.
 */
export function drawSweepLine(ctx, geo) {
  const { centerX, centerY, maxRadius, isPro, reducedMotion, sweepAngleRef } = geo;

  // Sweep line - CRT mode only (Phase 7.3: respect reduced motion)
  if (!isPro && !reducedMotion) {
    sweepAngleRef.current = (sweepAngleRef.current + 1.5) % 360;
    const sweepRad = ((sweepAngleRef.current - 90) * Math.PI) / 180;

    // Draw sweep as gradient arc
    const sweepSpan = 45;
    ctx.save();
    ctx.translate(centerX, centerY);

    for (let i = 0; i < sweepSpan; i += 3) {
      const angle1 = ((sweepAngleRef.current - i - 90) * Math.PI) / 180;
      const angle2 = ((sweepAngleRef.current - i - 3 - 90) * Math.PI) / 180;
      const alpha = 0.4 * (1 - i / sweepSpan);

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, maxRadius, angle2, angle1);
      ctx.closePath();
      ctx.fillStyle = `rgba(0, 255, 100, ${alpha * 0.15})`;
      ctx.fill();
    }

    // Main sweep line
    ctx.strokeStyle = 'rgba(0, 255, 100, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(sweepRad) * maxRadius, Math.sin(sweepRad) * maxRadius);
    ctx.stroke();

    ctx.restore();
  }
}

/**
 * Horizontal scanlines and radial vignette gradient overlay (CRT mode only).
 */
export function drawScanlines(ctx, geo) {
  const { width, height, centerX, centerY, isPro } = geo;

  // Add scanlines effect - CRT mode only
  if (!isPro) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.03)';
    for (let y = 0; y < height; y += 2) {
      ctx.fillRect(0, y, width, 1);
    }

    // Subtle vignette - CRT mode only
    const gradient = ctx.createRadialGradient(
      centerX,
      centerY,
      0,
      centerX,
      centerY,
      Math.max(width, height) * 0.7
    );
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
}
