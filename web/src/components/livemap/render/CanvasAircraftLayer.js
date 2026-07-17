import L from 'leaflet';
import {
  CATEGORY_COLORS,
  SELECTED_COLOR,
  altitudeOf,
  categoryOf,
  drawAirport,
  drawAirspacePoly,
  drawDart,
  drawLabel,
  drawLead,
  drawNavaid,
  drawNotam,
  drawSafetyRing,
  drawSelectionRing,
  drawTrail,
  rectsOverlap,
  severityColor,
} from './symbology';

/**
 * Single-canvas aircraft renderer for the Live Map. A `<canvas>` is overlaid on
 * the Leaflet container (pointer-events:none) and redrawn every rAF frame; each
 * frame reprojects via `map.latLngToContainerPoint`, culls to `getBounds().pad`,
 * and draws only the visible blips — smooth at >1k aircraft. Selection/safety
 * pulses are computed per-frame in JS. Click/hover hit-test against a per-frame
 * screen-position index. Leaflet owns pan/zoom; this never touches the map
 * transform.
 */
export class CanvasAircraftLayer {
  /**
   * @param {import('leaflet').Map} map
   * @param {object} opts
   * @param {(hex: string|null) => void} [opts.onSelect]
   * @param {(hex: string|null) => void} [opts.onHover]
   */
  constructor(map, { onSelect, onHover } = {}) {
    this.map = map;
    this.onSelect = onSelect;
    this.onHover = onHover;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'lm-canvas';
    Object.assign(this.canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '400',
    });
    map.getContainer().appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    // render state (mutated from React each update)
    this.aircraft = [];
    this.positionsRef = null;
    this.selectedHex = null;
    this.hoveredHex = null;
    this.safetyHexes = new Set();
    this.labelMode = 'auto'; // 'auto' | 'all'
    this.labelDensity = 'full'; // 'full' | 'minimal'
    this.filterFn = null; // (a) => boolean, or null for all
    this.overlays = {}; // { trails, airspace, navaids, airports }
    this.overlayData = { trails: {}, airspaces: [], navaids: [], airports: [] };

    this.frame = 0;
    this.screenIndex = []; // [{hex, x, y}] rebuilt each frame for hit-test
    this._raf = null;
    this._dpr = 1;

    this._resize = this._resize.bind(this);
    this._onClick = this._onClick.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._loop = this._loop.bind(this);

    this._resize();
    map.on('resize zoomend moveend', this._resize);
    map.on('click', this._onClick);
    map.on('mousemove', this._onMouseMove);
    this._raf = requestAnimationFrame(this._loop);
  }

  setData(aircraft, positionsRef) {
    this.aircraft = aircraft || [];
    if (positionsRef) this.positionsRef = positionsRef;
  }
  setSelected(hex) {
    this.selectedHex = hex ? hex.toUpperCase() : null;
  }
  setHovered(hex) {
    this.hoveredHex = hex ? hex.toUpperCase() : null;
  }
  setSafetyHexes(hexes) {
    this.safetyHexes = new Set((hexes || []).map((h) => String(h).toUpperCase()));
  }
  setLabelMode(mode) {
    this.labelMode = mode;
  }
  setLabelDensity(density) {
    this.labelDensity = density;
  }
  setFilter(fn) {
    this.filterFn = typeof fn === 'function' ? fn : null;
  }
  setOverlays(flags) {
    this.overlays = flags || {};
  }
  setOverlayData(data) {
    this.overlayData = { ...this.overlayData, ...data };
  }

  _resize() {
    const size = this.map.getSize();
    const dpr = window.devicePixelRatio || 1;
    this._dpr = dpr;
    this.canvas.width = Math.round(size.x * dpr);
    this.canvas.height = Math.round(size.y * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Merge interpolated positions onto an aircraft record (lat/lon/track). */
  _live(a) {
    const p = this.positionsRef?.current?.[(a.hex || '').toUpperCase()];
    if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
      return { ...a, lat: p.lat, lon: p.lon, track: Number.isFinite(p.track) ? p.track : a.track };
    }
    return a;
  }

  _loop() {
    this.frame += 1;
    this._draw();
    this._raf = requestAnimationFrame(this._loop);
  }

  _draw() {
    const { ctx, map } = this;
    const size = map.getSize();
    ctx.clearRect(0, 0, size.x, size.y);

    const bounds = map.getBounds().pad(0.15);
    const selectedHex = this.selectedHex;
    const hoveredHex = this.hoveredHex;

    // Leaflet bounds are un-normalized (panning a world copy or viewing across
    // the antimeridian yields lng ranges like 170..190 or 240..250) while data
    // lons are normalized to [-180,180] - shift each lon by ±360 toward the
    // view center so culling and projection land on the viewed world copy.
    const centerLng = bounds.getCenter().lng;
    const wrapLon = (lon) => {
      let l = lon;
      while (l < centerLng - 180) l += 360;
      while (l > centerLng + 180) l -= 360;
      return l;
    };
    const contains = (lat, lon) => bounds.contains(L.latLng(lat, wrapLon(lon)));
    const project = (lat, lon) => map.latLngToContainerPoint(L.latLng(lat, wrapLon(lon)));

    // aviation overlays (drawn under aircraft, gated by toggles)
    this._drawOverlays(bounds, project, contains, wrapLon);

    // project + cull + filter
    const visible = [];
    for (const raw of this.aircraft) {
      if (!raw?.hex) continue;
      if (this.filterFn && !this.filterFn(raw)) continue;
      // Merge the interpolated live position BEFORE validating coords — an
      // aircraft may have a fresh socket position without lat/lon on the base record.
      const a = this._live(raw);
      if (typeof a.lat !== 'number' || typeof a.lon !== 'number') continue;
      if (!contains(a.lat, a.lon)) continue;
      const pt = project(a.lat, a.lon);
      visible.push({ a, hex: a.hex.toUpperCase(), x: pt.x, y: pt.y });
    }
    this.screenIndex = visible.map((v) => ({ hex: v.hex, x: v.x, y: v.y }));

    // LOD: thin lead/labels when the field is dense
    const dense = visible.length > 600;

    // priority: normal → safety → hovered → selected (draw important last / on top)
    const rank = (v) =>
      v.hex === selectedHex ? 3 : v.hex === hoveredHex ? 2 : this.safetyHexes.has(v.hex) || v.a.safety ? 1 : 0;
    visible.sort((p, q) => rank(p) - rank(q));

    // Pass 1: rings + leads + darts for every visible aircraft (bottom→top).
    const labelCandidates = [];
    for (const v of visible) {
      const { a, x, y } = v;
      const selected = v.hex === selectedHex;
      const hovered = v.hex === hoveredHex;
      const isSafety = this.safetyHexes.has(v.hex) || !!a.safety;
      const cat = categoryOf(a);
      const color = selected ? SELECTED_COLOR : CATEGORY_COLORS[cat];
      const track = a.track ?? a.hdg ?? 0;
      const sevColor = severityColor(a, isSafety);

      if (isSafety && sevColor) drawSafetyRing(ctx, x, y, sevColor, this.frame);
      if (selected) drawSelectionRing(ctx, x, y, this.frame);
      if (!dense || selected || hovered || isSafety) drawLead(ctx, x, y, track, a.gs ?? a.spd);
      drawDart(ctx, x, y, track, color);

      const showLabel = this.labelMode === 'all' || selected || hovered || isSafety;
      if (showLabel) {
        // priority: selected(3) > hovered(2) > safety(1) > normal(0)
        const prio = selected ? 3 : hovered ? 2 : isSafety ? 1 : 0;
        labelCandidates.push({ a, x, y, selected, isSafety, sevColor, color, prio });
      }
    }

    // Pass 2: place labels in priority order, skipping any that would overlap an
    // already-placed one. In dense clusters only a few fit; the rest are
    // suppressed (their rings/darts still show) instead of piling up.
    labelCandidates.sort((p, q) => q.prio - p.prio);
    const placedLabels = [];
    for (const c of labelCandidates) {
      const badge = c.isSafety ? String(c.a.safety?.label || c.a.safety?.severity || 'ALERT').toUpperCase() : null;
      const rect = probeLabelRect(ctx, c.x, c.y, c.a, this.labelDensity, badge, 0);
      if (placedLabels.some((p) => rectsOverlap(rect, p))) {
        // selected/hovered always win — nudge once, else skip
        if (c.prio >= 2) {
          const alt = probeLabelRect(ctx, c.x, c.y, c.a, this.labelDensity, badge, -(rect.h + 6));
          if (placedLabels.some((p) => rectsOverlap(alt, p))) continue;
          drawLabel(ctx, c.x, c.y, c.a, { density: this.labelDensity, color: c.selected ? SELECTED_COLOR : c.sevColor || c.color, badge, offsetY: -(rect.h + 6) });
          placedLabels.push(alt);
          continue;
        }
        continue;
      }
      const placed = drawLabel(ctx, c.x, c.y, c.a, {
        density: this.labelDensity,
        color: c.selected ? SELECTED_COLOR : c.sevColor || c.color,
        badge,
      });
      placedLabels.push(placed);
    }
  }

  /** Draw enabled aviation overlays under the aircraft. */
  _drawOverlays(bounds, project, contains, wrapLon) {
    const { ctx } = this;
    const o = this.overlays;
    const d = this.overlayData;
    if (o.airspace && d.airspaces?.length) {
      for (const poly of d.airspaces) {
        // Backend nests a GeoJSON Polygon under `.polygon` ({coordinates:[[[lon,lat]...]]});
        // also accept a bare ring or {points} for flexibility.
        const geo = poly.polygon || poly;
        const ring = geo.coordinates?.[0] || geo.points || (Array.isArray(geo) ? geo : null);
        if (!Array.isArray(ring)) continue;
        const pts = ring
          .map((c) => (Array.isArray(c) ? { lat: c[1], lon: c[0] } : c))
          .filter((c) => typeof c.lat === 'number')
          .map((c) => project(c.lat, c.lon));
        if (pts.length >= 2) drawAirspacePoly(ctx, pts);
      }
    }
    if (o.trails && d.trails) {
      // pad once (pad() allocates a bounds + two latlngs - never per point)
      const tb = bounds.pad(0.3);
      // trails accumulate from the UNfiltered aircraft list - hide the trail
      // when the traffic filter hides its aircraft
      let allowed = null;
      if (this.filterFn) {
        allowed = new Set();
        for (const a of this.aircraft) {
          if (a?.hex && this.filterFn(a)) allowed.add(a.hex.toUpperCase());
        }
      }
      for (const [hex, track] of Object.entries(d.trails)) {
        if (!Array.isArray(track) || track.length < 2) continue;
        if (allowed && !allowed.has(String(hex).toUpperCase())) continue;
        // Split at cull gaps: joining survivors across an off-screen stretch
        // would paint a straight false segment across the viewport.
        let run = [];
        for (const pnt of track) {
          const ok =
            typeof pnt.lat === 'number' &&
            typeof pnt.lon === 'number' &&
            tb.contains(L.latLng(pnt.lat, wrapLon(pnt.lon)));
          if (ok) {
            run.push(project(pnt.lat, pnt.lon));
          } else if (run.length) {
            if (run.length >= 2) drawTrail(ctx, run, '#4cc9f0');
            run = [];
          }
        }
        if (run.length >= 2) drawTrail(ctx, run, '#4cc9f0');
      }
    }
    if (o.navaids && d.navaids?.length) {
      for (const n of d.navaids) {
        if (typeof n.lat !== 'number' || !contains(n.lat, n.lon ?? n.lng)) continue;
        const p = project(n.lat, n.lon ?? n.lng);
        drawNavaid(ctx, p.x, p.y, n.ident || n.id || '');
      }
    }
    if (o.airports && d.airports?.length) {
      for (const ap of d.airports) {
        if (typeof ap.lat !== 'number' || !contains(ap.lat, ap.lon ?? ap.lng)) continue;
        const p = project(ap.lat, ap.lon ?? ap.lng);
        drawAirport(ctx, p.x, p.y, ap.ident || ap.icao || ap.iata || '');
      }
    }
    if (o.notams && d.notams?.length) {
      for (const n of d.notams) {
        const lat = n.latitude ?? n.lat;
        const lon = n.longitude ?? n.lon ?? n.lng;
        if (typeof lat !== 'number' || typeof lon !== 'number' || !contains(lat, lon)) continue;
        const p = project(lat, lon);
        // project the area radius (nm) to pixels via a point one radius north
        let radiusPx = 0;
        const rNm = n.radius_nm ?? n.radius;
        if (typeof rNm === 'number' && rNm > 0) {
          const edge = project(lat + rNm / 60, lon);
          radiusPx = Math.abs(edge.y - p.y);
        }
        drawNotam(ctx, p.x, p.y, radiusPx, (n.type || '').toUpperCase() === 'TFR');
      }
    }
  }

  /** Nearest blip within `radius` px of a container point, or null. */
  hitTest(containerPoint, radius = 14) {
    let best = null;
    let bestD = radius * radius;
    for (const p of this.screenIndex) {
      const dx = p.x - containerPoint.x;
      const dy = p.y - containerPoint.y;
      const d = dx * dx + dy * dy;
      if (d <= bestD) {
        bestD = d;
        best = p.hex;
      }
    }
    return best;
  }

  _onClick(e) {
    const hex = this.hitTest(e.containerPoint);
    if (hex) {
      L.DomEvent.stop(e);
      this.onSelect?.(hex);
    }
  }

  _onMouseMove(e) {
    const hex = this.hitTest(e.containerPoint, 12);
    const container = this.map.getContainer();
    container.style.cursor = hex ? 'pointer' : '';
    if (hex !== this.hoveredHex) {
      this.setHovered(hex);
      this.onHover?.(hex);
    }
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this.map.off('resize zoomend moveend', this._resize);
    this.map.off('click', this._onClick);
    this.map.off('mousemove', this._onMouseMove);
    this.canvas.remove();
  }
}

/** Measure-only variant of drawLabel for declutter probing (no paint). */
function probeLabelRect(ctx, x, y, a, density, badge, offsetY) {
  const minimal = density === 'minimal';
  const padX = minimal ? 6 : 7;
  const padY = minimal ? 2 : 3;
  const csSize = minimal ? 14 : 12;
  const lh = csSize + 3;
  const cs = (a.flight || a.hex || '').trim() || '——';
  const alt = altitudeOf(a);
  const l1 = `${Math.round(a.gs ?? 0)}kts · ${Math.round(alt / 100)}`;
  const l2 = a.t || a.type || '';
  const rows = [cs, l1, l2].filter((s) => s !== '');
  ctx.save();
  ctx.font = `600 ${csSize}px "IBM Plex Mono", monospace`;
  let w = 0;
  for (const r of rows) w = Math.max(w, ctx.measureText(r).width);
  if (badge) w = Math.max(w, ctx.measureText(badge).width + 12);
  ctx.restore();
  return {
    x: x + 15,
    y: y - 7 + offsetY,
    w: w + padX * 2,
    h: rows.length * lh + (badge ? 16 : 0) + padY * 2,
  };
}
