import L from 'leaflet';
import {
  AIRSPACE_CLASSES,
  SELECTED_COLOR,
  airmetRgb,
  airspaceRings,
  altitudeOf,
  colorFor,
  drawAirmetArea,
  drawAirmetLine,
  drawAirport,
  drawAirspaceDisc,
  drawAirspacePoly,
  drawCoast,
  drawDart,
  drawLabel,
  drawLeaderLine,
  drawNavaid,
  drawNotam,
  drawPirep,
  drawPredictor,
  drawSafetyRing,
  drawSelectionRing,
  drawTfrDisc,
  drawTfrPoly,
  drawTrail,
  drawWildfire,
  normAirspaceClass,
  pirepColor,
  pointInRing,
  rectsOverlap,
  severityColor,
  wildfireColor,
} from './symbology';

// Distinct, high-contrast line colours cycled across the aircraft in a
// historical-track overlay (LLM "plot these planes' paths on the radar").
const HIST_TRACK_COLORS = [
  '#ffd166',
  '#4cc9f0',
  '#f72585',
  '#80ed99',
  '#ff9e00',
  '#b388ff',
  '#00f5d4',
  '#ef476f',
];

/** class → RGB triplet, derived once from the shared AIRSPACE_CLASSES table. */
const AIRSPACE_RGB = Object.fromEntries(AIRSPACE_CLASSES.map((c) => [c.key, c.rgb]));

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
   * @param {(pirep: object|null, pt: {x:number,y:number}|null) => void} [opts.onPirepHover]
   * @param {(notam: object|null, pt: {x:number,y:number}|null) => void} [opts.onNotamHover]
   * @param {(airport: object|null, pt: {x:number,y:number}|null) => void} [opts.onAirportHover]
   * @param {(airspace: object|null, pt: {x:number,y:number}|null) => void} [opts.onAirspaceHover]
   * @param {(airmet: object|null, pt: {x:number,y:number}|null) => void} [opts.onAirmetHover]
   */
  constructor(
    map,
    {
      onSelect,
      onHover,
      onPirepHover,
      onNotamHover,
      onAirportHover,
      onAirspaceHover,
      onAirmetHover,
      onWildfireSelect,
      onAirmetSelect,
    } = {}
  ) {
    this.map = map;
    this.onSelect = onSelect;
    this.onHover = onHover;
    this.onPirepHover = onPirepHover;
    this.onNotamHover = onNotamHover;
    this.onAirportHover = onAirportHover;
    this.onAirspaceHover = onAirspaceHover;
    this.onAirmetHover = onAirmetHover;
    this.onWildfireSelect = onWildfireSelect;
    this.onAirmetSelect = onAirmetSelect;

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
    this.overlays = {}; // { trails, airspace, navaids, airports, notams, pireps }
    this.overlayData = {
      trails: {},
      airspaces: [],
      navaids: [],
      airports: [],
      notams: [],
      tfrs: [],
      pireps: [],
      wildfires: [],
    };
    // Historical flown-path polylines pushed by the assistant (plot_tracks). Keyed
    // by ICAO hex → { cs, color, pts:[{lat,lon,alt}] }. Drawn independently of the
    // live-trail toggle and the traffic filter, always on top when present.
    this.histTracks = null;
    // display prefs (pushed from React via setDisplay)
    this.display = {
      colorMode: 'category', // 'category' | 'altitude'
      showPredictor: true,
      predictorSeconds: 60,
      showLeaders: true,
      showCoast: true,
    };
    // per-hex kinematics for the curved predictor + coast detection
    this._omega = new Map(); // hex → smoothed turn rate (deg/s)
    this._track = new Map(); // hex → { track, t } last sample
    this._lastSeen = new Map(); // hex → last time a fresh position was present

    this.frame = 0;
    this.screenIndex = []; // [{hex, x, y}] rebuilt each frame for hit-test
    this.pirepIndex = []; // [{x, y, pr}] rebuilt each frame for pirep hit-test
    this.hoveredPirep = null;
    this.wildfireIndex = []; // [{x, y, wf}] rebuilt each frame for wildfire hit-test
    this.notamIndex = []; // [{x, y, r, t}] rebuilt each frame for notam hit-test
    this.hoveredNotam = null;
    this.airportIndex = []; // [{x, y, ap}] rebuilt each frame for airport hit-test
    this.hoveredAirport = null;
    this.airspaceIndex = []; // [{rings|disc, poly}] rebuilt each frame for airspace hit-test
    this.hoveredAirspace = null;
    this.hoveredAirmet = null;
    this.airspaceClasses = null; // {B:true,...} class visibility filter, or null (=all)
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
    this._updateKinematics();
  }

  /**
   * Update per-hex turn rate + last-seen from the current aircraft list. Turn
   * rate feeds the curved predictor; last-seen feeds coast detection. Both are
   * independent of the trails overlay so they work even when trails are off.
   * Caches are pruned to the present set to stay bounded.
   */
  _updateKinematics() {
    const now = Date.now();
    const present = new Set();
    for (const raw of this.aircraft) {
      const hex = (raw?.hex || '').toUpperCase();
      if (!hex) continue;
      present.add(hex);
      const live = this.positionsRef?.current?.[hex];
      const track = Number.isFinite(live?.track) ? live.track : (raw.track ?? raw.hdg);
      // freshness: a live interpolated position (or a base lat/lon) counts as seen
      if (live || Number.isFinite(raw.lat)) this._lastSeen.set(hex, now);
      if (!Number.isFinite(track)) continue;
      const prev = this._track.get(hex);
      if (prev && now > prev.t) {
        const dt = (now - prev.t) / 1000;
        if (dt > 0.2) {
          let d = track - prev.track;
          while (d > 180) d -= 360;
          while (d < -180) d += 360;
          const rawOmega = d / dt;
          const clamped = Math.max(-6, Math.min(6, rawOmega));
          const smooth = this._omega.get(hex);
          this._omega.set(hex, smooth == null ? clamped : smooth * 0.7 + clamped * 0.3);
          this._track.set(hex, { track, t: now });
        }
      } else {
        this._track.set(hex, { track, t: now });
      }
    }
    // prune caches for aircraft no longer present
    for (const m of [this._omega, this._track, this._lastSeen]) {
      for (const hex of m.keys()) if (!present.has(hex)) m.delete(hex);
    }
  }

  setDisplay(prefs) {
    this.display = { ...this.display, ...(prefs || {}) };
  }
  setSelected(hex) {
    this.selectedHex = hex ? hex.toUpperCase() : null;
  }
  setSelectedWildfire(id) {
    this.selectedWildfireId = id ?? null;
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
  /**
   * Set (or clear) the historical-track overlay. Accepts the plot_tracks payload
   * { HEX: { cs, pts:[[lat,lon,alt], ...] } } and normalizes points to objects,
   * assigning each aircraft a stable colour. Pass null/empty to clear.
   */
  setHistoricalTracks(tracks) {
    if (!tracks || typeof tracks !== 'object' || !Object.keys(tracks).length) {
      this.histTracks = null;
      return;
    }
    const out = {};
    let i = 0;
    for (const [hex, t] of Object.entries(tracks)) {
      const raw = Array.isArray(t?.pts) ? t.pts : Array.isArray(t) ? t : [];
      const pts = raw
        .map((p) => (Array.isArray(p) ? { lat: p[0], lon: p[1], alt: p[2] } : p))
        .filter((p) => typeof p?.lat === 'number' && typeof p?.lon === 'number');
      if (pts.length < 2) continue;
      out[String(hex).toUpperCase()] = {
        cs: t?.cs || hex,
        color: HIST_TRACK_COLORS[i % HIST_TRACK_COLORS.length],
        pts,
      };
      i++;
    }
    this.histTracks = Object.keys(out).length ? out : null;
  }
  /** Per-class airspace visibility map ({B:true,...}), or null to show all. */
  setAirspaceClasses(map) {
    this.airspaceClasses = map || null;
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

  /**
   * Dead-reckon a curved velocity predictor for one aircraft: step forward in
   * lat/lon from the live position using ground speed + heading, rotating the
   * heading by the smoothed turn rate each step, then project to screen. Returns
   * { pts, ticks } or null for slow/invalid traffic. `project(lat,lon)` handles
   * antimeridian wrap. ~12 samples over predictorSeconds.
   */
  _predictorPoints(hex, a, track, project) {
    const gs = a.gs ?? a.spd;
    if (!Number.isFinite(gs) || gs <= 50) return null;
    if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon) || !Number.isFinite(track)) return null;
    const T = this.display.predictorSeconds || 60;
    const N = 12;
    const dt = T / N;
    const omega = this._omega.get(hex) || 0; // deg/s
    let lat = a.lat;
    let lon = a.lon;
    let hdg = track;
    const cosLat = Math.cos((a.lat * Math.PI) / 180) || 1e-6;
    const pts = [project(lat, lon)];
    const ticks = [];
    for (let i = 1; i <= N; i++) {
      const distNm = (gs * dt) / 3600; // nm this step
      const hr = (hdg * Math.PI) / 180;
      lat += (distNm / 60) * Math.cos(hr);
      lon += ((distNm / 60) * Math.sin(hr)) / cosLat;
      hdg += omega * dt;
      pts.push(project(lat, lon));
      // horizon tick each time cumulative time crosses a 30s mark
      const tSec = i * dt;
      if (Math.floor(tSec / 30) !== Math.floor((tSec - dt) / 30)) ticks.push(pts.length - 1);
    }
    return { pts, ticks };
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
    const now = Date.now();
    const coastMs = 15000;
    const disp = this.display;

    // priority: normal → safety → hovered → selected (draw important last / on top)
    const rank = (v) =>
      v.hex === selectedHex
        ? 3
        : v.hex === hoveredHex
          ? 2
          : this.safetyHexes.has(v.hex) || v.a.safety
            ? 1
            : 0;
    visible.sort((p, q) => rank(p) - rank(q));

    // Auto-label ramp: at low zoom only high-priority tags show; as the operator
    // zooms in the priority threshold drops so progressively MORE aircraft label.
    // 'all' shows everything; 'auto' gates on this per-zoom threshold.
    const autoThreshold = this._autoLabelThreshold();

    // Pass 1: rings + leads + darts for every visible aircraft (bottom→top).
    const labelCandidates = [];
    for (const v of visible) {
      const { a, x, y } = v;
      const selected = v.hex === selectedHex;
      const hovered = v.hex === hoveredHex;
      const isSafety = this.safetyHexes.has(v.hex) || !!a.safety;
      const color = colorFor(a, disp.colorMode, selected);
      const track = a.track ?? a.hdg ?? 0;
      const sevColor = severityColor(a, isSafety);
      const seen = this._lastSeen.get(v.hex);
      const coasting = disp.showCoast && seen != null && now - seen > coastMs;

      if (isSafety && sevColor) drawSafetyRing(ctx, x, y, sevColor, this.frame);
      if (selected) drawSelectionRing(ctx, x, y, this.frame);
      // curved velocity predictor (skip in dense fields unless important)
      if (disp.showPredictor && (!dense || selected || hovered || isSafety)) {
        const pred = this._predictorPoints(v.hex, a, track, project);
        if (pred) drawPredictor(ctx, pred.pts, selected ? SELECTED_COLOR : color);
      }
      // Ghosts (non-ICAO ~ duplicates) render dimmed when revealed via the toggle.
      drawDart(ctx, x, y, track, color, (coasting ? 0.4 : 1) * (a.ghost ? 0.45 : 1));
      if (coasting) drawCoast(ctx, x, y);

      // priority: selected(4) > hovered(3) > safety(2) > interesting(1) > normal(0)
      const interesting = altitudeOf(a) >= 30000 || !!a.military || !!a.mil;
      const prio = selected ? 4 : hovered ? 3 : isSafety ? 2 : interesting ? 1 : 0;
      const showLabel = this.labelMode === 'all' || prio >= autoThreshold;
      if (showLabel) {
        labelCandidates.push({ a, x, y, selected, isSafety, sevColor, color, prio });
      }
    }

    // Pass 2: place labels in priority order, skipping any that would overlap an
    // already-placed one. In dense clusters only a few fit; the rest are
    // suppressed (their rings/darts still show) instead of piling up.
    labelCandidates.sort((p, q) => q.prio - p.prio);
    const placedLabels = [];
    for (const c of labelCandidates) {
      const badge = c.isSafety
        ? String(c.a.safety?.label || c.a.safety?.severity || 'ALERT').toUpperCase()
        : null;
      const rect = probeLabelRect(ctx, c.x, c.y, c.a, this.labelDensity, badge, 0);
      if (placedLabels.some((p) => rectsOverlap(rect, p))) {
        // selected/hovered always win — nudge once, else skip
        if (c.prio >= 3) {
          const alt = probeLabelRect(ctx, c.x, c.y, c.a, this.labelDensity, badge, -(rect.h + 6));
          if (placedLabels.some((p) => rectsOverlap(alt, p))) continue;
          if (disp.showLeaders) drawLeaderLine(ctx, c.x, c.y, alt);
          drawLabel(ctx, c.x, c.y, c.a, {
            density: this.labelDensity,
            color: c.selected ? SELECTED_COLOR : c.sevColor || c.color,
            badge,
            offsetY: -(rect.h + 6),
          });
          placedLabels.push(alt);
          continue;
        }
        continue;
      }
      if (disp.showLeaders) drawLeaderLine(ctx, c.x, c.y, rect);
      const placed = drawLabel(ctx, c.x, c.y, c.a, {
        density: this.labelDensity,
        color: c.selected ? SELECTED_COLOR : c.sevColor || c.color,
        badge,
      });
      placedLabels.push(placed);
    }
  }

  /**
   * Auto-label priority threshold for the current Leaflet zoom. A label shows
   * when its priority (selected 4 / hovered 3 / safety 2 / interesting 1 /
   * normal 0) is >= this threshold, so zooming IN reveals progressively more
   * tags: far out only safety+ show, mid-zoom adds high-altitude/military, and
   * close in everything is eligible (declutter still thins the rest).
   */
  _autoLabelThreshold() {
    const z = typeof this.map?.getZoom === 'function' ? this.map.getZoom() : 9;
    if (!Number.isFinite(z)) return 2;
    if (z <= 7) return 2; // only safety / hovered / selected
    if (z <= 9) return 1; // + high-altitude / military
    return 0; // everything eligible (subject to declutter)
  }

  /** Draw enabled aviation overlays under the aircraft. */
  /** Stroke one on-screen run of a historical track (thicker, solid colour). */
  _strokeHistRun(ctx, run, color) {
    if (!run || run.length < 2) return;
    ctx.save();
    ctx.lineWidth = 2.25;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(run[0].x, run[0].y);
    for (let i = 1; i < run.length; i++) ctx.lineTo(run[i].x, run[i].y);
    ctx.stroke();
    ctx.restore();
  }

  _drawOverlays(bounds, project, contains, wrapLon) {
    const { ctx } = this;
    const o = this.overlays;
    const d = this.overlayData;
    this.pirepIndex = []; // rebuilt each frame for pirep hover hit-test
    this.wildfireIndex = []; // rebuilt each frame for wildfire click hit-test
    this.notamIndex = []; // rebuilt each frame for notam hover hit-test
    this.airportIndex = []; // rebuilt each frame for airport hover hit-test
    this.airspaceIndex = []; // rebuilt each frame for airspace hover hit-test
    this.airmetIndex = []; // rebuilt each frame for AIRMET click hit-test
    if (o.airspace && d.airspaces?.length) {
      const classFilter = this.airspaceClasses; // {B:true,...} or null (=all)
      for (const poly of d.airspaces) {
        const cls = normAirspaceClass(poly.class ?? poly.airspace_class);
        if (classFilter && classFilter[cls] === false) continue;
        const rgb = AIRSPACE_RGB[cls];
        // Prefer polygon geometry (Polygon or MultiPolygon); each yields one or
        // more rings. Index the projected rings for point-in-polygon hover.
        const rings = airspaceRings(poly.polygon || poly);
        let drew = false;
        const projRings = [];
        for (const ring of rings) {
          const pts = ring.map((c) => project(c.lat, c.lon));
          if (pts.length >= 3) {
            drawAirspacePoly(ctx, pts, rgb);
            projRings.push(pts);
            drew = true;
          }
        }
        if (drew) {
          this.airspaceIndex.push({ rings: projRings, disc: null, poly });
          continue;
        }
        // Fallback: radius-only airspace (center + radius_nm, no polygon).
        const lat = poly.lat ?? poly.latitude ?? poly.center_lat;
        const lon = poly.lon ?? poly.lng ?? poly.longitude ?? poly.center_lon;
        const rNm = poly.radius ?? poly.radius_nm;
        if (typeof lat !== 'number' || typeof lon !== 'number' || !(rNm > 0)) continue;
        if (!contains(lat, lon)) continue;
        const p = project(lat, lon);
        const edge = project(lat + rNm / 60, lon);
        const radiusPx = Math.abs(edge.y - p.y);
        drawAirspaceDisc(ctx, p.x, p.y, radiusPx, rgb);
        this.airspaceIndex.push({ rings: null, disc: { x: p.x, y: p.y, r: radiusPx }, poly });
      }
    }
    // AIRMETs: G-AIRMET hazard geometry — AREA polygons (filled) and LINE
    // advisories (open polyline, e.g. freezing level), colour-coded by hazard.
    if (o.airmets && d.airmets?.length) {
      for (const adv of d.airmets) {
        const rgb = airmetRgb(adv.hazard);
        const geom = adv.polygon;
        if (geom?.type === 'LineString' && Array.isArray(geom.coordinates)) {
          const pts = geom.coordinates
            .filter((c) => Array.isArray(c) && c.length >= 2)
            .map((c) => project(c[1], c[0]));
          if (pts.length >= 2) drawAirmetLine(ctx, pts, rgb, adv.hazard);
          continue;
        }
        // AREA: Polygon exterior ring / MultiPolygon first ring / legacy array.
        let ring = null;
        if (geom?.type === 'Polygon') ring = geom.coordinates?.[0];
        else if (geom?.type === 'MultiPolygon') ring = geom.coordinates?.[0]?.[0];
        else if (Array.isArray(geom)) ring = geom;
        else if (Array.isArray(adv.coords)) ring = adv.coords;
        if (!Array.isArray(ring) || ring.length < 3) continue;
        const pts = ring
          .map((c) => (Array.isArray(c) ? { lat: c[1], lon: c[0] } : c))
          .filter((c) => typeof c.lat === 'number' && typeof c.lon === 'number')
          .map((c) => project(c.lat, c.lon));
        if (pts.length < 3) continue;
        drawAirmetArea(ctx, pts, rgb, adv.hazard);
        this.airmetIndex.push({ rings: [pts], poly: adv });
      }
    }
    if (o.trails && d.trails) {
      // pad once (pad() allocates a bounds + two latlngs - never per point)
      const tb = bounds.pad(0.3);
      const now = Date.now();
      const maxAgeMs = (this.overlays.trailSeconds || 300) * 1000;
      const trailOpts = { mode: this.display.colorMode, maxAgeMs, now, color: '#4cc9f0' };
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
            const p = project(pnt.lat, pnt.lon);
            run.push({ x: p.x, y: p.y, alt: pnt.alt, t: pnt.time });
          } else if (run.length) {
            if (run.length >= 2) drawTrail(ctx, run, trailOpts);
            run = [];
          }
        }
        if (run.length >= 2) drawTrail(ctx, run, trailOpts);
      }
    }
    // Historical flown-path polylines (assistant plot_tracks). Always drawn when
    // present — not gated by the trail toggle or the traffic filter.
    if (this.histTracks) {
      const tb = bounds.pad(0.3);
      for (const t of Object.values(this.histTracks)) {
        let run = [];
        let last = null;
        for (const pnt of t.pts) {
          const inView = tb.contains(L.latLng(pnt.lat, wrapLon(pnt.lon)));
          if (inView) {
            const p = project(pnt.lat, pnt.lon);
            run.push(p);
            last = { ...p, cs: t.cs };
          } else if (run.length) {
            this._strokeHistRun(ctx, run, t.color);
            run = [];
          }
        }
        this._strokeHistRun(ctx, run, t.color);
        if (last) {
          // Endpoint marker + callsign at the newest position.
          ctx.save();
          ctx.fillStyle = t.color;
          ctx.beginPath();
          ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.font = '11px system-ui, sans-serif';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.75)';
          ctx.strokeText(t.cs, last.x + 6, last.y - 6);
          ctx.fillText(t.cs, last.x + 6, last.y - 6);
          ctx.restore();
        }
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
        this.airportIndex.push({ x: p.x, y: p.y, ap });
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
        this.notamIndex.push({ x: p.x, y: p.y, r: Math.max(radiusPx, 8), t: n });
      }
    }
    // TFRs share the NOTAMs toggle but render with distinct restriction
    // symbology. Prefer a polygon ring when present, else fall back to the
    // point+radius disc the backend supplies (lat/lon + radius_nm).
    if (o.notams && d.tfrs?.length) {
      for (const t of d.tfrs) {
        const geo = t.polygon || t.geometry;
        const ring =
          geo?.coordinates?.[0] || (Array.isArray(geo?.points) ? geo.points : null) || null;
        if (Array.isArray(ring) && ring.length >= 3) {
          const pts = ring
            .map((c) => (Array.isArray(c) ? { lat: c[1], lon: c[0] } : c))
            .filter((c) => typeof c.lat === 'number' && typeof c.lon === 'number')
            .map((c) => project(c.lat, c.lon));
          if (pts.length >= 3) {
            drawTfrPoly(ctx, pts, t.notam_id || t.name || 'TFR');
            let cx = 0;
            let cy = 0;
            let maxR = 0;
            for (const q of pts) {
              cx += q.x;
              cy += q.y;
            }
            cx /= pts.length;
            cy /= pts.length;
            for (const q of pts) maxR = Math.max(maxR, Math.hypot(q.x - cx, q.y - cy));
            this.notamIndex.push({ x: cx, y: cy, r: Math.max(maxR, 8), t });
            continue;
          }
        }
        const lat = t.latitude ?? t.lat;
        const lon = t.longitude ?? t.lon ?? t.lng;
        if (typeof lat !== 'number' || typeof lon !== 'number' || !contains(lat, lon)) continue;
        const p = project(lat, lon);
        let radiusPx = 0;
        const rNm = t.radius_nm ?? t.radius;
        if (typeof rNm === 'number' && rNm > 0) {
          const edge = project(lat + rNm / 60, lon);
          radiusPx = Math.abs(edge.y - p.y);
        }
        drawTfrDisc(ctx, p.x, p.y, radiusPx, t.notam_id || t.name || 'TFR');
        this.notamIndex.push({ x: p.x, y: p.y, r: Math.max(radiusPx, 8), t });
      }
    }
    // PIREPs: severity-colored dots at the report position (guard missing coords).
    if (o.pireps && d.pireps?.length) {
      for (const pr of d.pireps) {
        const lat = pr.lat ?? pr.latitude;
        const lon = pr.lon ?? pr.lng ?? pr.longitude;
        if (typeof lat !== 'number' || typeof lon !== 'number' || !contains(lat, lon)) continue;
        const p = project(lat, lon);
        drawPirep(ctx, p.x, p.y, pirepColor(pr));
        this.pirepIndex.push({ x: p.x, y: p.y, pr });
      }
    }
    // Wildfires: threat-colored flame markers, size nudged up with acreage.
    if (o.wildfires && d.wildfires?.length) {
      for (const wf of d.wildfires) {
        const lat = wf.lat ?? wf.latitude;
        const lon = wf.lon ?? wf.lng ?? wf.longitude;
        if (typeof lat !== 'number' || typeof lon !== 'number' || !contains(lat, lon)) continue;
        const p = project(lat, lon);
        const acres = typeof wf.acreage === 'number' ? wf.acreage : 0;
        const r = 5 + Math.min(4, Math.log10(1 + acres) / 1.2); // 5..9 px
        drawWildfire(ctx, p.x, p.y, wildfireColor(wf.threat_score), r);
        // Selected fire gets the same targeting ring/brackets an aircraft does.
        if (wf.id != null && wf.id === this.selectedWildfireId) {
          drawSelectionRing(ctx, p.x, p.y, this.frame);
        }
        this.wildfireIndex.push({ x: p.x, y: p.y, r: Math.max(r, 8), wf });
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

  /** Nearest PIREP within `radius` px of a container point, or null. */
  hitTestPirep(containerPoint, radius = 10) {
    let best = null;
    let bestD = radius * radius;
    for (const p of this.pirepIndex) {
      const dx = p.x - containerPoint.x;
      const dy = p.y - containerPoint.y;
      const d = dx * dx + dy * dy;
      if (d <= bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** Nearest wildfire within its marker radius of a container point, or null. */
  hitTestWildfire(containerPoint, radius = 10) {
    let best = null;
    let bestD = Infinity;
    for (const w of this.wildfireIndex) {
      const dx = w.x - containerPoint.x;
      const dy = w.y - containerPoint.y;
      const d = dx * dx + dy * dy;
      const rr = Math.max(w.r, radius);
      if (d <= rr * rr && d < bestD) {
        bestD = d;
        best = w;
      }
    }
    return best;
  }

  /** NOTAM/TFR whose area contains the point (smallest wins on overlap), or null. */
  hitTestNotam(containerPoint) {
    let best = null;
    let bestR = Infinity;
    for (const n of this.notamIndex) {
      const dx = n.x - containerPoint.x;
      const dy = n.y - containerPoint.y;
      if (dx * dx + dy * dy <= n.r * n.r && n.r < bestR) {
        bestR = n.r;
        best = n;
      }
    }
    return best;
  }

  /** Nearest airport within `radius` px of a container point, or null. */
  hitTestAirport(containerPoint, radius = 9) {
    let best = null;
    let bestD = radius * radius;
    for (const a of this.airportIndex) {
      const dx = a.x - containerPoint.x;
      const dy = a.y - containerPoint.y;
      const d = dx * dx + dy * dy;
      if (d <= bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  /** Innermost airspace containing the point (polygon or disc), or null. */
  hitTestAirspace(containerPoint) {
    let best = null;
    let bestArea = Infinity;
    for (const a of this.airspaceIndex) {
      let hit = false;
      let area = Infinity;
      if (a.rings) {
        for (const ring of a.rings) {
          if (pointInRing(containerPoint, ring)) hit = !hit; // even-odd across holes
        }
        if (hit) area = ringsArea(a.rings);
      } else if (a.disc) {
        const dx = a.disc.x - containerPoint.x;
        const dy = a.disc.y - containerPoint.y;
        if (dx * dx + dy * dy <= a.disc.r * a.disc.r) {
          hit = true;
          area = Math.PI * a.disc.r * a.disc.r;
        }
      }
      if (hit && area < bestArea) {
        bestArea = area;
        best = a;
      }
    }
    return best;
  }

  /** Smallest AIRMET AREA whose polygon contains the point, or null. */
  hitTestAirmet(containerPoint) {
    let best = null;
    let bestArea = Infinity;
    for (const a of this.airmetIndex) {
      let hit = false;
      for (const ring of a.rings) {
        if (pointInRing(containerPoint, ring)) hit = !hit;
      }
      if (hit) {
        const area = ringsArea(a.rings);
        if (area < bestArea) {
          bestArea = area;
          best = a;
        }
      }
    }
    return best;
  }

  _onClick(e) {
    const hex = this.hitTest(e.containerPoint);
    if (hex) {
      L.DomEvent.stop(e);
      this.onSelect?.(hex);
      return;
    }
    // Wildfire markers open the detail panel (takes priority over deselect).
    const wf = this.hitTestWildfire(e.containerPoint);
    if (wf?.wf) {
      L.DomEvent.stop(e);
      this.onWildfireSelect?.(wf.wf);
      return;
    }
    // AIRMET areas open the AIRMET detail panel.
    const airmet = this.hitTestAirmet(e.containerPoint);
    if (airmet?.poly) {
      L.DomEvent.stop(e);
      this.onAirmetSelect?.(airmet.poly);
      return;
    }
    // Click on empty space deselects.
    this.onSelect?.(null);
  }

  _onMouseMove(e) {
    const hex = this.hitTest(e.containerPoint, 12);
    const container = this.map.getContainer();
    if (hex !== this.hoveredHex) {
      this.setHovered(hex);
      this.onHover?.(hex);
    }
    // Priority: aircraft > point markers (pirep/airport) > area fills
    // (notam/airspace). Only probe a tier when the ones above it missed.
    const pr = hex ? null : this.hitTestPirep(e.containerPoint);
    const wf = hex || pr ? null : this.hitTestWildfire(e.containerPoint);
    const airport = hex || pr ? null : this.hitTestAirport(e.containerPoint);
    const notam = hex || pr || airport ? null : this.hitTestNotam(e.containerPoint);
    const airmet = hex || pr || airport || notam ? null : this.hitTestAirmet(e.containerPoint);
    const airspace =
      hex || pr || airport || notam || airmet ? null : this.hitTestAirspace(e.containerPoint);
    if (pr?.pr !== this.hoveredPirep) {
      this.hoveredPirep = pr?.pr || null;
      this.onPirepHover?.(pr?.pr || null, pr ? { x: pr.x, y: pr.y } : null);
    }
    if (airport?.ap !== this.hoveredAirport) {
      this.hoveredAirport = airport?.ap || null;
      this.onAirportHover?.(airport?.ap || null, airport ? { x: airport.x, y: airport.y } : null);
    }
    if (notam?.t !== this.hoveredNotam) {
      this.hoveredNotam = notam?.t || null;
      this.onNotamHover?.(notam?.t || null, notam ? { x: notam.x, y: notam.y } : null);
    }
    if (airmet?.poly !== this.hoveredAirmet) {
      this.hoveredAirmet = airmet?.poly || null;
      this.onAirmetHover?.(airmet?.poly || null, airmet ? e.containerPoint : null);
    }
    if (airspace?.poly !== this.hoveredAirspace) {
      this.hoveredAirspace = airspace?.poly || null;
      this.onAirspaceHover?.(airspace?.poly || null, airspace ? e.containerPoint : null);
    }
    container.style.cursor =
      hex || pr || wf || airport || notam || airmet || airspace ? 'pointer' : '';
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this.map.off('resize zoomend moveend', this._resize);
    this.map.off('click', this._onClick);
    this.map.off('mousemove', this._onMouseMove);
    this.canvas.remove();
  }
}

/** Shoelace area (px²) of an airspace's outer projected ring; used to prefer
 * the innermost airspace when several overlap under the cursor. */
function ringsArea(rings) {
  const ring = rings[0];
  if (!ring || ring.length < 3) return Infinity;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
  }
  return Math.abs(a / 2);
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
