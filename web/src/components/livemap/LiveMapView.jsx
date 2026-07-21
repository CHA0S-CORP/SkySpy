import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { Icon, BottomSheet } from '../v2/primitives';
import { useHashParamState } from '../../hooks/useHashParamState';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useAuth } from '../../contexts/AuthContext';
import { useLiveLeafletMap } from './hooks/useLiveLeafletMap';
import { useMapOverlayData } from './hooks/useMapOverlayData';
import { CanvasAircraftLayer } from './render/CanvasAircraftLayer';
import { DetailPanel } from './panel/DetailPanel';
import { WildfirePanel } from './panel/WildfirePanel';
import { AirmetPanel } from './panel/AirmetPanel';
import { HoverTip } from './HoverTip';
import { LiveMapToolbar } from './LiveMapToolbar';
import { FilterPanel } from './panels/FilterPanel';
import { LayersPanel } from './panels/LayersPanel';
import { LegendPanel } from './panels/LegendPanel';
import {
  filtersActive,
  loadFilters,
  loadOverlays,
  makeFilterFn,
  makeRadarMatchFn,
  overlaysActiveCount,
  saveFilters,
  saveOverlays,
  DEFAULT_FILTERS,
} from './mapState';

const NEXRAD_WMS = 'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi';

/**
 * v2 Live Map (design SkySpy.dc.html): Leaflet slippy map with the design's
 * dart symbology on a viewport-culled `<canvas>` (smooth at >1k aircraft), the
 * full 56px toolbar (search, label toggles, traffic filters, map layers, zoom,
 * recenter, fullscreen, legend), overlays (range rings, trails, weather radar,
 * airspace, navaids, airports, NOTAMs), a coordinate readout + compass, and the
 * 392px collapsible detail panel.
 *
 * @param {object} props
 * @param {string} [props.apiBase]
 * @param {object[]} props.aircraft
 * @param {object[]} [props.safetyEvents]
 * @param {{lat:number, lon:number}|null} props.feederLocation
 * @param {React.RefObject} props.positionsRef
 * @param {Function} [props.wsRequest]
 * @param {boolean} [props.wsConnected]
 * @param {(hex: string) => void} props.onOpenFull
 */
export function LiveMapView({
  apiBase = '',
  aircraft,
  safetyEvents = [],
  feederLocation,
  positionsRef,
  wsRequest,
  wsConnected,
  hashParams,
  radarCommand,
  onClearRadarCommand,
  radarTracks,
  onClearRadarTracks,
  onOpenFull,
}) {
  const containerRef = useRef(null);
  const layerRef = useRef(null);
  const radarLayerRef = useRef(null);
  const feederRef = useRef(null);
  // Selection + label mode + open tool panel are mirrored in the URL so they
  // deep-link and survive reload/back-forward (URL is the source of truth).
  // Selection pushes a history entry (Back deselects); the display toggles use
  // replaceState (default) so they don't spam Back.
  const [selectedHex, setSelectedHex] = useHashParamState('selected', null, {
    parse: (v) => v.toUpperCase(),
    serialize: (v) => v || '',
    replace: false,
  });
  const [panelOpen, setPanelOpen] = useState(true);
  const [labelMode, setLabelMode] = useHashParamState('labelMode', 'auto');
  const [labelDensity, setLabelDensity] = useState('full');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(loadFilters);
  const [overlays, setOverlays] = useState(loadOverlays);
  // 'filters' | 'layers' | 'legend' | null
  const [openPanel, setOpenPanel] = useHashParamState('toolPanel', null);
  const [zoom, setZoom] = useState(9);
  // Server-side clustering: below the threshold the map renders cluster bubbles
  // (centroid + count) from the aircraft-clusters request instead of per-aircraft
  // darts; at/above it, the normal dart stream. `moveTick` re-requests on pan.
  const [clusters, setClusters] = useState(null);
  const [moveTick, setMoveTick] = useState(0);
  const { config: authConfig } = useAuth();
  const clusterThreshold = authConfig?.mapClusterZoomThreshold ?? 8;
  const clusterMode = zoom < clusterThreshold;
  const [coords, setCoords] = useState(null); // {lat, lon, dist, brg}
  const [hoverTip, setHoverTip] = useState(null); // {kind:'pirep'|'notam', data, x, y}
  const [selectedWildfire, setSelectedWildfire] = useState(null); // Watch Duty fire marker
  const [selectedAirmet, setSelectedAirmet] = useState(null); // clicked G-AIRMET area
  const [moreOpen, setMoreOpen] = useState(false); // mobile overflow controls sheet

  // On phones the 392px side panel + dense toolbar don't fit; panels/popovers
  // render as bottom sheets and the toolbar collapses to a "more" overflow.
  const { isMobile } = useBreakpoint();

  const feeder = feederLocation ? { lat: feederLocation.lat, lon: feederLocation.lon } : null;
  feederRef.current = feeder;
  const { mapRef } = useLiveLeafletMap({ containerRef, feeder, active: true });

  const overlayData = useMapOverlayData({ wsRequest, wsConnected, feeder, aircraft, overlays });

  // Active assistant filter, from (in priority): a live dock command
  // (radarCommand), a rich deep-link (#map?rf=<json match spec>), or a simple
  // hex/callsign list (#map?filter=A0E2E5,N739MH). Unified into { label, match }.
  const activeFilter = useMemo(() => {
    if (radarCommand?.match) {
      return { label: radarCommand.label, match: radarCommand.match, view: radarCommand.view };
    }
    if (hashParams?.rf) {
      try {
        const spec = JSON.parse(hashParams.rf);
        if (spec?.match) return { label: spec.label, match: spec.match, view: spec.view };
        if (spec && typeof spec === 'object') return { label: spec.label, match: spec };
      } catch {
        /* malformed rf param — ignore */
      }
    }
    if (hashParams?.filter) {
      const hexes = String(hashParams.filter)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (hexes.length) return { label: `${hexes.length} aircraft`, match: { hexes } };
    }
    return null;
  }, [radarCommand, hashParams?.rf, hashParams?.filter]);

  const filterFn = useMemo(() => {
    const base = makeFilterFn(filters);
    const radar = makeRadarMatchFn(activeFilter?.match, feeder);
    // Ghosts (non-ICAO ~ duplicates of a real ICAO track) are hidden unless the
    // Layers "Ghost Tracks" toggle is on.
    return (a) => {
      if (!overlays.showGhosts && a.ghost) return false;
      if (radar && !radar(a)) return false;
      return base(a);
    };
    // feeder identity is stable per render; distMax handles its absence.
  }, [filters, overlays.showGhosts, activeFilter]);
  // Only highlight *active* events: the 24h snapshot includes long-finished
  // events, and resolved ones are flagged (not removed) by the socket layer —
  // without this filter an aircraft stays permanently marked on the map.
  const activeSafetyEvents = useMemo(() => {
    const cutoff = Date.now() - 15 * 60 * 1000;
    return (safetyEvents || []).filter((e) => {
      if (e.resolved) return false;
      const t = Date.parse(e.timestamp || e.created_at || '');
      return Number.isFinite(t) ? t >= cutoff : true;
    });
  }, [safetyEvents]);
  // Two-aircraft events (proximity/TCAS) carry a second hex - highlight both
  const safetyHexes = useMemo(
    () =>
      activeSafetyEvents
        .flatMap((e) => [e.icao_hex || e.hex || e.aircraftId, e.icao_2 || e.icao_hex_2])
        .map((h) => (h || '').toString())
        .filter(Boolean),
    [activeSafetyEvents]
  );
  const annotated = useMemo(() => {
    if (!activeSafetyEvents.length) return aircraft;
    const byHex = new Map();
    for (const e of activeSafetyEvents) {
      for (const h of [e.icao_hex || e.hex, e.icao_2 || e.icao_hex_2]) {
        if (h) byHex.set(String(h).toUpperCase(), e);
      }
    }
    return aircraft.map((a) => {
      const ev = byHex.get((a.hex || '').toUpperCase());
      return ev ? { ...a, safety: { severity: ev.severity, label: ev.event_type || ev.kind } } : a;
    });
  }, [aircraft, activeSafetyEvents]);

  // init canvas layer once the map exists; wire coordinate readout + zoom sync
  useEffect(() => {
    if (!mapRef.current || layerRef.current) return undefined;
    const map = mapRef.current;
    layerRef.current = new CanvasAircraftLayer(map, {
      // Only one side pane at a time: selecting an aircraft clears any fire/airmet
      // selection (and vice-versa) so the plane and fire panels never co-exist.
      onSelect: (hex) => {
        setSelectedHex(hex);
        setSelectedWildfire(null);
        setSelectedAirmet(null);
        if (hex) setPanelOpen(true);
      },
      onWildfireSelect: (wf) => {
        setSelectedWildfire(wf);
        setSelectedHex(null);
        setSelectedAirmet(null);
      },
      onAirmetSelect: (a) => {
        setSelectedAirmet(a);
        setSelectedHex(null);
        setSelectedWildfire(null);
      },
      // Each callback only clears the tip it owns, so a pirep→notam move (which
      // fires both a pirep-null and a notam-set in one event) doesn't clobber.
      onPirepHover: (pr, pt) =>
        setHoverTip((cur) =>
          pr ? { kind: 'pirep', data: pr, x: pt.x, y: pt.y } : cur?.kind === 'pirep' ? null : cur
        ),
      onNotamHover: (t, pt) =>
        setHoverTip((cur) =>
          t ? { kind: 'notam', data: t, x: pt.x, y: pt.y } : cur?.kind === 'notam' ? null : cur
        ),
      onAirportHover: (a, pt) =>
        setHoverTip((cur) =>
          a ? { kind: 'airport', data: a, x: pt.x, y: pt.y } : cur?.kind === 'airport' ? null : cur
        ),
      onAirspaceHover: (a, pt) =>
        setHoverTip((cur) =>
          a
            ? { kind: 'airspace', data: a, x: pt.x, y: pt.y }
            : cur?.kind === 'airspace'
              ? null
              : cur
        ),
      onAirmetHover: (a, pt) =>
        setHoverTip((cur) =>
          a ? { kind: 'airmet', data: a, x: pt.x, y: pt.y } : cur?.kind === 'airmet' ? null : cur
        ),
      // Clicking a cluster bubble zooms into its bbox; the next request (now at a
      // higher zoom) flips that area to raw points.
      onClusterSelect: (bbox) => {
        if (bbox && bbox.length === 4) {
          const [s, w, n, e] = bbox;
          map.fitBounds(
            [
              [s, w],
              [n, e],
            ],
            { maxZoom: clusterThreshold + 2, padding: [40, 40] }
          );
        }
      },
    });
    const onZoomEnd = () => setZoom(map.getZoom());
    const onMoveEnd = () => setMoveTick((t) => t + 1);
    const onMouseMove = (e) => {
      const { lat, lng } = e.latlng;
      let dist = null;
      let brg = null;
      const f = feederRef.current;
      if (f) {
        const dLat = lat - f.lat;
        const dLon = lng - f.lon;
        const nmY = dLat * 60;
        const nmX = dLon * 60 * Math.cos((f.lat * Math.PI) / 180);
        dist = Math.sqrt(nmX * nmX + nmY * nmY);
        brg = (Math.atan2(nmX, nmY) * 180) / Math.PI;
        if (brg < 0) brg += 360;
      }
      setCoords({ lat, lon: lng, dist, brg });
    };
    map.on('zoomend', onZoomEnd);
    map.on('moveend', onMoveEnd);
    map.on('mousemove', onMouseMove);
    setZoom(map.getZoom());
    return () => {
      map.off('zoomend', onZoomEnd);
      map.off('moveend', onMoveEnd);
      map.off('mousemove', onMouseMove);
      layerRef.current?.destroy();
      layerRef.current = null;
    };
    // Built once per map; feeder is read via feederRef so status polls (which
    // change feederLocation's identity) don't tear down the layer + rAF loop.
  }, [mapRef]);

  // push aircraft + render state to the canvas layer
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.setData(annotated, positionsRef);
    layer.setSelected(selectedHex);
    layer.setSelectedWildfire(selectedWildfire?.id ?? null);
    layer.setSafetyHexes(safetyHexes);
    layer.setLabelMode(labelMode);
    layer.setLabelDensity(labelDensity);
    layer.setFilter(filterFn);
    layer.setClusters(clusterMode ? clusters : null);
  }, [
    annotated,
    positionsRef,
    selectedHex,
    selectedWildfire,
    safetyHexes,
    labelMode,
    labelDensity,
    filterFn,
    clusters,
    clusterMode,
  ]);

  // Request server-side clusters when zoomed out (debounced on pan/zoom); clear
  // when zoomed in so the normal dart stream renders.
  useEffect(() => {
    if (!clusterMode || typeof wsRequest !== 'function' || !mapRef.current) {
      setClusters(null);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      const b = mapRef.current?.getBounds?.();
      if (!b) return;
      const bbox = {
        north: b.getNorth(),
        south: b.getSouth(),
        east: b.getEast(),
        west: b.getWest(),
      };
      wsRequest('aircraft-clusters', { zoom, bbox })
        .then((res) => {
          if (!cancelled) setClusters(res?.clustered ? res.clusters || [] : null);
        })
        .catch(() => {
          if (!cancelled) setClusters(null);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [clusterMode, zoom, moveTick, wsRequest, mapRef]);

  // When the assistant applies/changes a radar filter, move the view to it:
  // explicit center/zoom, or fit to the matched aircraft (view === 'fit').
  const appliedViewRef = useRef(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !activeFilter) {
      appliedViewRef.current = null;
      return;
    }
    // Only reposition once per distinct command (not on every aircraft tick).
    const key = JSON.stringify({ m: activeFilter.match, v: activeFilter.view });
    if (appliedViewRef.current === key) return;
    appliedViewRef.current = key;

    const view = activeFilter.view;
    if (view && typeof view === 'object' && Array.isArray(view.center)) {
      map.setView(view.center, view.zoom || map.getZoom());
      return;
    }
    // Fit to the currently-matched aircraft.
    const match = makeRadarMatchFn(activeFilter.match, feeder);
    const pts = (annotated || [])
      .filter((a) => typeof a.lat === 'number' && typeof a.lon === 'number' && (!match || match(a)))
      .map((a) => [a.lat, a.lon]);
    if (pts.length === 1) {
      map.setView(pts[0], Math.max(map.getZoom(), 11));
    } else if (pts.length > 1) {
      map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 12 });
    }
  }, [activeFilter, mapRef]);

  // push overlay flags + data + display prefs to the canvas layer
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.setOverlays(overlays);
    layer.setOverlayData(overlayData);
    layer.setAirspaceClasses(overlays.airspaceClasses || null);
    layer.setDisplay({
      colorMode: overlays.colorMode,
      showPredictor: overlays.showPredictor,
      predictorSeconds: overlays.predictorSeconds,
      showLeaders: overlays.showLeaders,
      showCoast: overlays.showCoast,
    });
  }, [overlays, overlayData]);

  // Historical flown-path overlay pushed by the assistant (plot_tracks): draw the
  // polylines on the radar and fit the view to them once per distinct command.
  const appliedTracksRef = useRef(null);
  useEffect(() => {
    const layer = layerRef.current;
    const map = mapRef.current;
    if (!layer) return;
    const tracks = radarTracks?.tracks || null;
    layer.setHistoricalTracks(tracks);
    if (!tracks || !map) return;
    const key = radarTracks.ts || JSON.stringify(radarTracks.label);
    if (appliedTracksRef.current === key) return;
    appliedTracksRef.current = key;
    const pts = [];
    for (const t of Object.values(tracks)) {
      const raw = Array.isArray(t?.pts) ? t.pts : Array.isArray(t) ? t : [];
      for (const p of raw) {
        const lat = Array.isArray(p) ? p[0] : p?.lat;
        const lon = Array.isArray(p) ? p[1] : p?.lon;
        if (typeof lat === 'number' && typeof lon === 'number') pts.push([lat, lon]);
      }
    }
    if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 11));
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 12 });
  }, [radarTracks, mapRef]);

  // range rings toggle
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getContainer().classList.toggle('lm--no-rings', !overlays.rangeRings);
  }, [overlays.rangeRings, mapRef]);

  // weather radar WMS tile layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    if (overlays.weatherRadar && !radarLayerRef.current) {
      radarLayerRef.current = L.tileLayer
        .wms(NEXRAD_WMS, {
          layers: 'nexrad-n0q-900913',
          format: 'image/png',
          transparent: true,
          opacity: 0.5,
        })
        .addTo(map);
    } else if (!overlays.weatherRadar && radarLayerRef.current) {
      map.removeLayer(radarLayerRef.current);
      radarLayerRef.current = null;
    }
    return undefined;
  }, [overlays.weatherRadar, mapRef]);

  const selected = useMemo(
    () =>
      aircraft.find((a) => (a.hex || '').toUpperCase() === (selectedHex || '').toUpperCase()) ||
      null,
    [aircraft, selectedHex]
  );

  // Panel only shows when open AND an aircraft is selected; used for both the
  // render gate and the invalidateSize effect so the map resizes when either
  // toggles.
  const panelVisible = panelOpen && !!selected;

  // Tool popovers (filters/layers/legend) are absolute-positioned cards on
  // desktop but would fall off a phone screen — render them as bottom sheets
  // there. The inner panels keep their own heads (titles/reset/close); sheet
  // CSS strips the card chrome so they sit flush.
  const wrapPanel = (name, node) =>
    isMobile ? (
      <BottomSheet key={name} open onOpenChange={(o) => !o && setOpenPanel(null)} padded={false}>
        {node}
      </BottomSheet>
    ) : (
      <div className={`lm__pop lm__pop--${name}`}>{node}</div>
    );

  // Side detail panels (aircraft / wildfire / airmet) are a fixed 392px column
  // on desktop; on a phone that squeezes the map, so slide them up as a sheet.
  const wrapSide = (node, onClose) =>
    isMobile ? (
      <BottomSheet open onOpenChange={(o) => !o && onClose()} padded={false} maxHeight="82vh">
        {node}
      </BottomSheet>
    ) : (
      node
    );

  const patchFilters = (patch) =>
    setFilters((f) => {
      const n = { ...f, ...patch };
      saveFilters(n);
      return n;
    });
  const patchOverlays = (patch) =>
    setOverlays((o) => {
      const n = { ...o, ...patch };
      saveOverlays(n);
      return n;
    });

  const onSubmit = (e) => {
    e.preventDefault();
    const q = search.trim().toLowerCase();
    if (!q) return;
    const match = aircraft.find(
      (a) => (a.hex || '').toLowerCase() === q || (a.flight || '').trim().toLowerCase() === q
    );
    if (match) {
      setSelectedHex(match.hex);
      setPanelOpen(true);
      if (mapRef.current && typeof match.lat === 'number' && typeof match.lon === 'number')
        mapRef.current.panTo([match.lat, match.lon]);
    }
  };

  const recenter = () => {
    if (mapRef.current && feederLocation)
      mapRef.current.setView([feederLocation.lat, feederLocation.lon], 9);
  };
  const fullscreen = () => {
    const el = containerRef.current?.closest('.lm');
    if (!document.fullscreenElement) el?.requestFullscreen?.();
    else document.exitFullscreen?.();
  };
  const doZoom = (z) => mapRef.current?.setZoom(z);

  // The 392px detail panel and fullscreen both resize the map container
  // without a window resize - Leaflet caches its size, leaving the canvas
  // stretched and hit-testing offset until invalidateSize() runs.
  useEffect(() => {
    const invalidate = () => mapRef.current?.invalidateSize();
    const t = setTimeout(invalidate, 50);
    document.addEventListener('fullscreenchange', invalidate);
    return () => {
      clearTimeout(t);
      document.removeEventListener('fullscreenchange', invalidate);
    };
  }, [panelVisible, mapRef]);

  return (
    <div className="lm" data-testid="lm-live-map">
      <div className="lm__center">
        <LiveMapToolbar
          search={search}
          onSearch={setSearch}
          onSubmit={onSubmit}
          labelMode={labelMode}
          setLabelMode={setLabelMode}
          labelDensity={labelDensity}
          setLabelDensity={setLabelDensity}
          filtersOn={filtersActive(filters)}
          overlaysCount={overlaysActiveCount(overlays)}
          onToggleFilters={() => setOpenPanel((p) => (p === 'filters' ? null : 'filters'))}
          onToggleLayers={() => setOpenPanel((p) => (p === 'layers' ? null : 'layers'))}
          onToggleLegend={() => setOpenPanel((p) => (p === 'legend' ? null : 'legend'))}
          zoom={zoom}
          onZoom={doZoom}
          onRecenter={recenter}
          onFullscreen={fullscreen}
          isMobile={isMobile}
          onOpenMore={() => setMoreOpen(true)}
        />

        <div className="lm__stage">
          <div ref={containerRef} className="lm__surface" data-testid="lm-surface" />

          {activeFilter && (
            <div className="lm__focus" role="status">
              <Icon name="filter" size={12} />
              <span>
                Assistant filter: <b>{activeFilter.label || 'filtered'}</b>
              </span>
              <button
                type="button"
                className="lm__focus-clear"
                onClick={() => {
                  onClearRadarCommand?.();
                  if (hashParams?.rf || hashParams?.filter) window.location.hash = '#map';
                }}
              >
                Clear
              </button>
            </div>
          )}

          {radarTracks?.tracks && Object.keys(radarTracks.tracks).length > 0 && (
            <div className="lm__focus lm__focus--tracks" role="status">
              <Icon name="activity" size={12} />
              <span>
                {radarTracks.label || `Tracks (${Object.keys(radarTracks.tracks).length})`}
              </span>
              <button
                type="button"
                className="lm__focus-clear"
                onClick={() => onClearRadarTracks?.()}
              >
                Clear
              </button>
            </div>
          )}

          {openPanel === 'filters' &&
            wrapPanel(
              'filters',
              <FilterPanel
                filters={filters}
                onChange={patchFilters}
                onReset={() => {
                  saveFilters(DEFAULT_FILTERS);
                  setFilters(DEFAULT_FILTERS);
                }}
              />
            )}
          {openPanel === 'layers' &&
            wrapPanel('layers', <LayersPanel overlays={overlays} onChange={patchOverlays} />)}
          {openPanel === 'legend' &&
            wrapPanel('legend', <LegendPanel onClose={() => setOpenPanel(null)} />)}

          {/* coordinate readout */}
          <div className="lm__coords">
            <div>
              LAT{' '}
              <span>{coords ? coords.lat.toFixed(4) : (feederLocation?.lat ?? 0).toFixed(4)}</span>
            </div>
            <div>
              LON{' '}
              <span>{coords ? coords.lon.toFixed(4) : (feederLocation?.lon ?? 0).toFixed(4)}</span>
            </div>
            {coords?.dist != null && (
              <div>
                DST <span>{coords.dist.toFixed(1)} nm</span> · BRG{' '}
                <span>{Math.round(coords.brg)}°</span>
              </div>
            )}
          </div>

          <HoverTip tip={hoverTip} />

          {/* mini compass */}
          <div className="lm__compass" aria-hidden="true">
            <span className="lm__compass-n">N</span>
            <span className="lm__compass-needle" />
          </div>

          {!panelOpen && (
            <button
              type="button"
              className="lm__reopen"
              onClick={() => setPanelOpen(true)}
              aria-label="Open detail panel"
            >
              <Icon
                name="chevron-right"
                size={16}
                strokeWidth={2}
                style={{ transform: 'rotate(180deg)' }}
              />
            </button>
          )}
        </div>
      </div>

      {panelVisible &&
        wrapSide(
          <DetailPanel
            apiBase={apiBase}
            aircraft={selected}
            track={overlayData.trails?.[(selectedHex || '').toUpperCase()] || []}
            onClose={() => setPanelOpen(false)}
            onOpenFull={onOpenFull}
          />,
          () => setPanelOpen(false)
        )}

      {selectedWildfire &&
        wrapSide(
          <WildfirePanel
            apiBase={apiBase}
            fire={selectedWildfire}
            onClose={() => setSelectedWildfire(null)}
          />,
          () => setSelectedWildfire(null)
        )}

      {selectedAirmet &&
        wrapSide(
          <AirmetPanel
            airmet={selectedAirmet}
            apiBase={apiBase}
            onClose={() => setSelectedAirmet(null)}
          />,
          () => setSelectedAirmet(null)
        )}

      {isMobile && (
        <BottomSheet open={moreOpen} onOpenChange={setMoreOpen} title="Map controls">
          <div className="lm__more-sheet">
            <div className="lm__more-row">
              <span>Labels</span>
              <div className="lm__seg" role="group" aria-label="Label visibility">
                <button
                  type="button"
                  className={labelMode === 'auto' ? 'lm__seg-on' : ''}
                  onClick={() => setLabelMode('auto')}
                >
                  Auto
                </button>
                <button
                  type="button"
                  className={labelMode === 'all' ? 'lm__seg-on' : ''}
                  onClick={() => setLabelMode('all')}
                >
                  All
                </button>
              </div>
            </div>
            <div className="lm__more-row">
              <span>Density</span>
              <div className="lm__seg" role="group" aria-label="Label density">
                <button
                  type="button"
                  className={labelDensity === 'full' ? 'lm__seg-on' : ''}
                  onClick={() => setLabelDensity('full')}
                >
                  Full
                </button>
                <button
                  type="button"
                  className={labelDensity === 'minimal' ? 'lm__seg-on' : ''}
                  onClick={() => setLabelDensity('minimal')}
                >
                  Min
                </button>
              </div>
            </div>
            <div className="lm__more-row">
              <span>Zoom</span>
              <input
                type="range"
                min={3}
                max={18}
                value={zoom}
                onChange={(e) => doZoom(Number(e.target.value))}
                aria-label="Zoom"
                className="lm__zoom-slider"
              />
              <span className="lm__zoom-val">{zoom}</span>
            </div>
            <button
              type="button"
              className="lm__more-btn"
              onClick={() => {
                recenter();
                setMoreOpen(false);
              }}
            >
              <Icon name="crosshair" size={16} strokeWidth={1.7} />
              <span>Recenter on feeder</span>
            </button>
            <button type="button" className="lm__more-btn" onClick={fullscreen}>
              <Icon name="fullscreen" size={16} strokeWidth={1.7} />
              <span>Toggle fullscreen</span>
            </button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
