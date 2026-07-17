/**
 * Pure symbology + canvas draw primitives for the Live Map (design: SkySpy.dc.html).
 * Rendered on a single canvas layer (see CanvasAircraftLayer) — no DOM markers —
 * so this stays smooth at >1k aircraft. Pulse animations are computed per-frame
 * in JS (canvas can't use CSS keyframes).
 */

export const CATEGORY_COLORS = {
  commercial: '#3ddc84', // --accent
  military: '#b39dff', // --mil
  ga: '#4cc9f0', // --accent2
};
export const SELECTED_COLOR = '#ffffff';
export const LEAD_COLOR = '#4cc9f0'; // --accent2

export const SEVERITY_COLORS = {
  info: '#4cc9f0',
  warn: '#f5b544',
  warning: '#f5b544',
  danger: '#f2585d',
  critical: '#f2585d',
};

/** Dotted velocity-trail length: clamp(spd*0.26, 12, 84) px (mock). */
// v1-style velocity vector length: a short line capped at 20px (gs/25), giving
// the cleaner legacy look instead of a long dotted trail.
export function leadLength(speed) {
  const s = typeof speed === 'number' ? speed : 0;
  return Math.min(20, s / 25);
}

/** Category from a normalized socket aircraft record. */
export function categoryOf(a) {
  if (a.military || a.mil) return 'military';
  if (['A1', 'A2', 'A7', 'B1', 'B2', 'B4', 'B6'].includes(a.category)) return 'ga';
  return 'commercial';
}

/** Altitude in feet. */
export function altitudeOf(a) {
  const alt = a.alt ?? a.alt_baro ?? a.alt_geom;
  return typeof alt === 'number' ? alt : 0;
}

/** Full-label lines. l1 altitude shown in hundreds of ft (mock). */
export function labelLines(a) {
  const alt = altitudeOf(a);
  return {
    cs: (a.flight || a.hex || '').trim() || '——',
    l1: `${Math.round(a.gs ?? 0)}kts · ${Math.round(alt / 100)}`,
    l2: a.t || a.type || '',
  };
}

/** Severity color for an aircraft's active safety event (or null). */
export function severityColor(a, isSafety) {
  if (!isSafety && !a.safety) return null;
  const sev = a.safety?.severity || 'warning';
  return SEVERITY_COLORS[sev] || SEVERITY_COLORS.warning;
}

// ---- canvas draw primitives (x,y = projected container-point pixels) ----

/** Rotated dart (design path M12 2 19 21 12 16 5 21z ≈ chevron), 17px box → ~8.5 half. */
export function drawDart(ctx, x, y, trackDeg, color) {
  const s = 8.5;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((trackDeg * Math.PI) / 180);
  ctx.shadowColor = color;
  ctx.shadowBlur = 4;
  ctx.fillStyle = color;
  ctx.beginPath();
  // scaled from the 24-box path: nose (0,-s), right (s*.82,s), tuck (0,s*.4), left (-s*.82,s)
  ctx.moveTo(0, -s);
  ctx.lineTo(s * 0.82, s);
  ctx.lineTo(0, s * 0.4);
  ctx.lineTo(-s * 0.82, s);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Velocity lead line: 20px solid stub at the nose + dotted trail scaled by speed. */
export function drawLead(ctx, x, y, trackDeg, speed, color = LEAD_COLOR) {
  const s = typeof speed === 'number' ? speed : 0;
  if (s <= 50) return; // v1: only moving traffic gets a velocity vector
  const len = leadLength(s);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((trackDeg * Math.PI) / 180);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  // v1 clean solid vector from just past the dart nose — no dotted trail
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(0, -(10 + len));
  ctx.stroke();
  ctx.restore();
}

/** Pulsing dashed selection ring, centered on the projected point. */
export function drawSelectionRing(ctx, x, y, frame) {
  // v1 selection highlight: dashed cyan ring + tactical corner brackets,
  // flashing on a discrete 10-frame cadence.
  const flash = Math.floor(frame / 10) % 2 === 0;
  const alpha = flash ? 0.9 : 0.4;
  const r = flash ? 22 : 20;
  ctx.save();
  ctx.strokeStyle = `rgba(100, 220, 255, ${alpha})`;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // corner brackets
  const bSize = 15;
  const bLen = 6;
  ctx.beginPath();
  ctx.moveTo(x - bSize, y - bSize + bLen);
  ctx.lineTo(x - bSize, y - bSize);
  ctx.lineTo(x - bSize + bLen, y - bSize);
  ctx.moveTo(x + bSize - bLen, y - bSize);
  ctx.lineTo(x + bSize, y - bSize);
  ctx.lineTo(x + bSize, y - bSize + bLen);
  ctx.moveTo(x - bSize, y + bSize - bLen);
  ctx.lineTo(x - bSize, y + bSize);
  ctx.lineTo(x - bSize + bLen, y + bSize);
  ctx.moveTo(x + bSize - bLen, y + bSize);
  ctx.lineTo(x + bSize, y + bSize);
  ctx.lineTo(x + bSize, y + bSize - bLen);
  ctx.stroke();
  ctx.restore();
}

/** Pulsing safety ring + expanding ping (safeping), severity-colored. */
export function drawSafetyRing(ctx, x, y, color, frame) {
  // steady pulsing ring
  const pulse = 0.5 + 0.5 * Math.sin(frame / 8);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.9 - pulse * 0.4;
  ctx.lineWidth = 2;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(x, y, 21 + pulse * 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  // expanding ping (safeping): scale .72→1.95, opacity .85→0 over ~1.6s
  const t = (frame % 96) / 96; // 96 frames ≈ 1.6s at 60fps
  const scale = 0.72 + t * (1.95 - 0.72);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.85 * (1 - t);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 21 * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a label chip to the right of the blip. Density 'full' | 'minimal'.
 * Returns the chip rect {x,y,w,h} for declutter bookkeeping (caller supplies
 * an offset so overlapping chips can be nudged).
 */
export function drawLabel(ctx, x, y, a, { density = 'full', color, badge, offsetY = 0 } = {}) {
  const lines = labelLines(a);
  const minimal = density === 'minimal';
  const padX = minimal ? 6 : 7;
  const padY = minimal ? 2 : 3;
  const csSize = minimal ? 14 : 12;
  const lnSize = minimal ? 13 : 11;
  const lh = csSize + 3;
  const rows = [lines.cs, lines.l1, lines.l2].filter((s) => s !== '');
  const badgeH = badge ? 16 : 0;

  ctx.save();
  ctx.font = `600 ${csSize}px "IBM Plex Mono", monospace`;
  let w = 0;
  for (const r of rows) w = Math.max(w, ctx.measureText(r).width);
  if (badge) w = Math.max(w, ctx.measureText(badge).width + 12);
  const chipW = w + padX * 2;
  const chipH = rows.length * lh + badgeH + padY * 2;
  const lx = x + 15;
  const ly = y - 7 + offsetY;

  if (!minimal) {
    ctx.fillStyle = 'rgba(13,19,27,0.95)'; // --bg1
    ctx.strokeStyle = '#1b2531'; // --bord
    ctx.lineWidth = 1;
    roundRect(ctx, lx, ly, chipW, chipH, 6);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(5,7,10,0.55)';
    roundRect(ctx, lx, ly, chipW, chipH, 4);
    ctx.fill();
  }

  ctx.textBaseline = 'top';
  let ty = ly + padY;
  // callsign
  ctx.font = `600 ${csSize}px "IBM Plex Mono", monospace`;
  ctx.fillStyle = minimal ? '#e9f1f8' : color;
  ctx.fillText(lines.cs, lx + padX, ty);
  ty += lh;
  // data lines
  ctx.font = `500 ${lnSize}px "IBM Plex Mono", monospace`;
  ctx.fillStyle = minimal ? '#4cc9f0' : '#8b98a7';
  if (lines.l1) {
    ctx.fillText(lines.l1, lx + padX, ty);
    ty += lh;
  }
  if (lines.l2) {
    ctx.fillText(lines.l2, lx + padX, ty);
    ty += lh;
  }
  // safety badge
  if (badge) {
    const bColor = color;
    ctx.fillStyle = `${bColor}33`;
    roundRect(ctx, lx + padX, ty, ctx.measureText(badge).width + 10, 14, 4);
    ctx.fill();
    ctx.strokeStyle = bColor;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = bColor;
    ctx.font = `700 10px "IBM Plex Mono", monospace`;
    ctx.fillText(badge, lx + padX + 5, ty + 2);
  }
  ctx.restore();
  return { x: lx, y: ly, w: chipW, h: chipH };
}

/** Draw an aircraft track trail from an array of projected points [{x,y}]. */
export function drawTrail(ctx, pts, color) {
  if (!pts || pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.restore();
}

/** Draw an airspace polygon from projected points [{x,y}]. */
export function drawAirspacePoly(ctx, pts) {
  if (!pts || pts.length < 3) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(76,201,240,0.35)'; // --accent2
  ctx.fillStyle = 'rgba(76,201,240,0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Navaid symbol (small hexagon) + ident label. */
export function drawNavaid(ctx, x, y, ident) {
  ctx.save();
  ctx.strokeStyle = '#8b98a7';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    const px = x + Math.cos(a) * 4;
    const py = y + Math.sin(a) * 4;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
  if (ident) {
    ctx.fillStyle = '#586472';
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.fillText(ident, x + 6, y + 3);
  }
  ctx.restore();
}

/** Airport symbol (small circle) + ident label. */
export function drawNotam(ctx, x, y, radiusPx, isTfr) {
  const color = isTfr ? 'rgba(255,80,80,0.85)' : 'rgba(255,180,0,0.8)';
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  // dashed area circle (skip if the projected radius is tiny)
  if (radiusPx && radiusPx > 3) {
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(x, y, radiusPx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // center diamond marker
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x + 4, y);
  ctx.lineTo(x, y + 4);
  ctx.lineTo(x - 4, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
export function drawAirport(ctx, x, y, ident) {
  ctx.save();
  ctx.strokeStyle = '#8b98a7';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, 3.5, 0, Math.PI * 2);
  ctx.stroke();
  if (ident) {
    ctx.fillStyle = '#586472';
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.fillText(ident, x + 6, y + 3);
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Axis-aligned rect overlap test (declutter). */
export function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
