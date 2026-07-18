import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { Icon } from '../v2/primitives';
import { useLiveLeafletMap } from './hooks/useLiveLeafletMap';
import { useMapOverlayData } from './hooks/useMapOverlayData';
import { CanvasAircraftLayer } from './render/CanvasAircraftLayer';
import { DetailPanel } from './panel/DetailPanel';
import { LiveMapToolbar } from './LiveMapToolbar';
import { FilterPanel } from './panels/FilterPanel';
import { LayersPanel } from './panels/LayersPanel';
import { LegendPanel } from './panels/LegendPanel';
import {
  filtersActive,
  loadFilters,
  loadOverlays,
  makeFilterFn,
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
  onOpenFull,
}) {
  const containerRef = useRef(null);
  const layerRef = useRef(null);
  const radarLayerRef = useRef(null);
  const feederRef = useRef(null);
  const [selectedHex, setSelectedHex] = useState(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [labelMode, setLabelMode] = useState('auto');
  const [labelDensity, setLabelDensity] = useState('full');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(loadFilters);
  const [overlays, setOverlays] = useState(loadOverlays);
  const [openPanel, setOpenPanel] = useState(null); // 'filters' | 'layers' | 'legend' | null
  const [zoom, setZoom] = useState(9);
  const [coords, setCoords] = useState(null); // {lat, lon, dist, brg}

  const feeder = feederLocation ? { lat: feederLocation.lat, lon: feederLocation.lon } : null;
  feederRef.current = feeder;
  const { mapRef } = useLiveLeafletMap({ containerRef, feeder, active: true });

  const overlayData = useMapOverlayData({ wsRequest, wsConnected, feeder, aircraft, overlays });

  const filterFn = useMemo(() => makeFilterFn(filters), [filters]);
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
      onSelect: (hex) => {
        setSelectedHex(hex);
        if (hex) setPanelOpen(true);
      },
    });
    const onZoomEnd = () => setZoom(map.getZoom());
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
    map.on('mousemove', onMouseMove);
    setZoom(map.getZoom());
    return () => {
      map.off('zoomend', onZoomEnd);
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
    layer.setSafetyHexes(safetyHexes);
    layer.setLabelMode(labelMode);
    layer.setLabelDensity(labelDensity);
    layer.setFilter(filterFn);
  }, [annotated, positionsRef, selectedHex, safetyHexes, labelMode, labelDensity, filterFn]);

  // push overlay flags + data + display prefs to the canvas layer
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.setOverlays(overlays);
    layer.setOverlayData(overlayData);
    layer.setDisplay({
      colorMode: overlays.colorMode,
      showPredictor: overlays.showPredictor,
      predictorSeconds: overlays.predictorSeconds,
      showLeaders: overlays.showLeaders,
      showCoast: overlays.showCoast,
    });
  }, [overlays, overlayData]);

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
        />

        <div className="lm__stage">
          <div ref={containerRef} className="lm__surface" data-testid="lm-surface" />

          {openPanel === 'filters' && (
            <div className="lm__pop lm__pop--filters">
              <FilterPanel
                filters={filters}
                onChange={patchFilters}
                onReset={() => {
                  saveFilters(DEFAULT_FILTERS);
                  setFilters(DEFAULT_FILTERS);
                }}
              />
            </div>
          )}
          {openPanel === 'layers' && (
            <div className="lm__pop lm__pop--layers">
              <LayersPanel overlays={overlays} onChange={patchOverlays} />
            </div>
          )}
          {openPanel === 'legend' && (
            <div className="lm__pop lm__pop--legend">
              <LegendPanel onClose={() => setOpenPanel(null)} />
            </div>
          )}

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

      {panelVisible && (
        <DetailPanel
          apiBase={apiBase}
          aircraft={selected}
          track={overlayData.trails?.[(selectedHex || '').toUpperCase()] || []}
          onClose={() => setPanelOpen(false)}
          onOpenFull={onOpenFull}
        />
      )}
    </div>
  );
}
