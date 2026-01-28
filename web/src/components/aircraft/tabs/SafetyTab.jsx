import React, { useRef, useCallback, useEffect } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Map as MapIcon, History, ExternalLink } from 'lucide-react';
import L from 'leaflet';
import { ReplayControlsCompact } from '../components/ReplayControls';

// Helper to safely parse JSON from fetch response
const safeJson = async (res) => {
  if (!res.ok) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try { return await res.json(); } catch { return null; }
};

const EVENT_TYPE_LABELS = {
  'tcas_ra': 'TCAS RA',
  'tcas_ta': 'TCAS TA',
  'extreme_vs': 'Extreme VS',
  'vs_reversal': 'VS Reversal',
  'proximity_conflict': 'Proximity',
  'squawk_hijack': 'Squawk 7500',
  'squawk_radio_failure': 'Squawk 7600',
  'squawk_emergency': 'Squawk 7700'
};

function getSeverityClass(severity) {
  switch (severity) {
    case 'critical': return 'severity-critical';
    case 'warning': return 'severity-warning';
    case 'low': return 'severity-low';
    default: return '';
  }
}

function formatEventType(type) {
  return EVENT_TYPE_LABELS[type] || type;
}

export function SafetyTab({
  hex,
  safetyEvents,
  safetyHours,
  setSafetyHours,
  expandedSnapshots,
  setExpandedSnapshots,
  expandedSafetyMaps,
  setExpandedSafetyMaps,
  safetyTrackData,
  setSafetyTrackData,
  safetyReplayState,
  setSafetyReplayState,
  onSelectAircraft,
  onViewHistoryEvent,
  onViewEvent,
  baseUrl,
  wsRequest,
  wsConnected
}) {
  // Map refs
  const safetyMapRefs = useRef({});
  const safetyMarkersRef = useRef({});
  const safetyTracksRef = useRef({});
  const safetyAnimationRef = useRef({});

  // Toggle snapshot expansion
  const toggleSnapshot = useCallback((eventId) => {
    setExpandedSnapshots(prev => ({ ...prev, [eventId]: !prev[eventId] }));
  }, [setExpandedSnapshots]);

  // Create aircraft icon for map
  const createAircraftIcon = useCallback((track, color) => {
    const rotation = track || 0;
    return L.divIcon({
      className: 'safety-aircraft-marker',
      html: `
        <svg width="24" height="24" viewBox="0 0 24 24" style="transform: rotate(${rotation}deg)">
          <path d="M12 2 L14 8 L20 10 L14 12 L14 18 L12 16 L10 18 L10 12 L4 10 L10 8 Z"
                fill="${color}" stroke="#000" stroke-width="0.5"/>
        </svg>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
  }, []);

  // Get interpolated position for safety replay
  const getSafetyInterpolatedPosition = useCallback((positions, percentage) => {
    if (!positions || positions.length === 0) return null;
    if (positions.length === 1) return positions[0];

    const ordered = [...positions].reverse();
    const exactIndex = (percentage / 100) * (ordered.length - 1);
    const lowerIndex = Math.floor(exactIndex);
    const upperIndex = Math.min(lowerIndex + 1, ordered.length - 1);
    const fraction = exactIndex - lowerIndex;

    if (lowerIndex === upperIndex || fraction === 0) return ordered[lowerIndex];

    const p1 = ordered[lowerIndex];
    const p2 = ordered[upperIndex];

    const lerp = (v1, v2, t) => {
      if (v1 == null) return v2;
      if (v2 == null) return v1;
      return v1 + (v2 - v1) * t;
    };

    const lerpAngle = (a1, a2, t) => {
      if (a1 == null || a2 == null) return a1;
      let diff = a2 - a1;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      return ((a1 + diff * t) + 360) % 360;
    };

    return {
      ...p1,
      lat: lerp(p1.lat, p2.lat, fraction),
      lon: lerp(p1.lon, p2.lon, fraction),
      altitude: Math.round(lerp(p1.altitude, p2.altitude, fraction)),
      gs: lerp(p1.gs, p2.gs, fraction),
      vr: Math.round(lerp(p1.vr, p2.vr, fraction)),
      track: lerpAngle(p1.track, p2.track, fraction),
    };
  }, []);

  // Update safety replay markers
  const updateSafetyReplayMarkers = useCallback((eventId, position) => {
    const map = safetyMapRefs.current[eventId];
    const data = safetyTrackData[eventId];
    if (!map || !data) return;

    // Update aircraft 1
    if (data.track1?.length > 0) {
      const pos = getSafetyInterpolatedPosition(data.track1, position);
      if (pos) {
        if (safetyMarkersRef.current[`${eventId}_1`]) {
          map.removeLayer(safetyMarkersRef.current[`${eventId}_1`]);
        }
        const icon = createAircraftIcon(pos.track, '#00ff88');
        safetyMarkersRef.current[`${eventId}_1`] = L.marker([pos.lat, pos.lon], { icon }).addTo(map);

        const ordered = [...data.track1].reverse();
        const numPoints = Math.floor((position / 100) * ordered.length);
        const trackCoords = ordered.slice(0, Math.max(1, numPoints)).map(s => [s.lat, s.lon]);
        if (safetyTracksRef.current[`${eventId}_1`]) {
          map.removeLayer(safetyTracksRef.current[`${eventId}_1`]);
        }
        if (trackCoords.length > 1) {
          safetyTracksRef.current[`${eventId}_1`] = L.polyline(trackCoords, {
            color: '#00ff88', weight: 3, opacity: 0.9
          }).addTo(map);
        }
      }
    }

    // Update aircraft 2
    if (data.track2?.length > 0) {
      const pos = getSafetyInterpolatedPosition(data.track2, position);
      if (pos) {
        if (safetyMarkersRef.current[`${eventId}_2`]) {
          map.removeLayer(safetyMarkersRef.current[`${eventId}_2`]);
        }
        const icon = createAircraftIcon(pos.track, '#ff4444');
        safetyMarkersRef.current[`${eventId}_2`] = L.marker([pos.lat, pos.lon], { icon }).addTo(map);

        const ordered = [...data.track2].reverse();
        const numPoints = Math.floor((position / 100) * ordered.length);
        const trackCoords = ordered.slice(0, Math.max(1, numPoints)).map(s => [s.lat, s.lon]);
        if (safetyTracksRef.current[`${eventId}_2`]) {
          map.removeLayer(safetyTracksRef.current[`${eventId}_2`]);
        }
        if (trackCoords.length > 1) {
          safetyTracksRef.current[`${eventId}_2`] = L.polyline(trackCoords, {
            color: '#ff4444', weight: 3, opacity: 0.9
          }).addTo(map);
        }
      }
    }
  }, [safetyTrackData, getSafetyInterpolatedPosition, createAircraftIcon]);

  // Toggle safety event map
  const toggleSafetyMap = useCallback(async (eventId, event) => {
    const isExpanding = !expandedSafetyMaps[eventId];
    setExpandedSafetyMaps(prev => ({ ...prev, [eventId]: isExpanding }));

    if (isExpanding && !safetyTrackData[eventId]) {
      const eventTime = new Date(event.timestamp);
      const startTime = new Date(eventTime.getTime() - 5 * 60 * 1000);
      const endTime = new Date(eventTime.getTime() + 5 * 60 * 1000);

      try {
        const fetchTracks = async (icao) => {
          if (!icao) return [];
          let data;
          if (wsRequest && wsConnected) {
            const result = await wsRequest('sightings', { icao_hex: icao, hours: 1, limit: 500 });
            if (result && (result.sightings || result.results)) data = result;
            else return [];
          } else {
            // Django API uses /api/v1/sightings with query params (was /api/v1/history/sightings/{icao})
            const res = await fetch(`${baseUrl}/api/v1/sightings?icao_hex=${icao}&hours=1&limit=500`);
            data = await safeJson(res);
            if (!data) return [];
          }
          return (data?.sightings || data?.results || []).filter(s => {
            const t = new Date(s.timestamp);
            return t >= startTime && t <= endTime && s.lat && s.lon;
          });
        };

        const [track1, track2] = await Promise.all([
          fetchTracks(event.icao),
          fetchTracks(event.icao_2)
        ]);

        setSafetyTrackData(prev => ({ ...prev, [eventId]: { track1, track2, event } }));
        setSafetyReplayState(prev => ({ ...prev, [eventId]: { position: 50, isPlaying: false, speed: 1 } }));
      } catch (err) {
        console.error('Error fetching safety track data:', err);
      }
    }
  }, [expandedSafetyMaps, safetyTrackData, baseUrl, wsRequest, wsConnected, setExpandedSafetyMaps, setSafetyTrackData, setSafetyReplayState]);

  // Initialize safety event map
  const initializeSafetyMap = useCallback((containerEl, eventId) => {
    if (!containerEl || safetyMapRefs.current[eventId]) return;
    const data = safetyTrackData[eventId];
    if (!data) return;

    const { track1, track2, event } = data;
    const allPoints = [...(track1 || []), ...(track2 || [])];
    if (allPoints.length === 0) return;

    const centerLat = event.lat || allPoints[0]?.lat;
    const centerLon = event.lon || allPoints[0]?.lon;

    const map = L.map(containerEl, {
      center: [centerLat, centerLon],
      zoom: 11,
      zoomControl: false,
      attributionControl: false
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(map);

    if (event.lat && event.lon) {
      L.circleMarker([event.lat, event.lon], {
        radius: 10, color: '#ffaa00', fillColor: '#ffaa00', fillOpacity: 0.3, weight: 2
      }).addTo(map).bindPopup(`<b>Safety Event</b><br>${event.message || formatEventType(event.event_type)}`);
    }

    if (track1?.length > 1) {
      const coords = [...track1].reverse().map(s => [s.lat, s.lon]);
      L.polyline(coords, { color: '#00ff88', weight: 2, opacity: 0.2 }).addTo(map);
    }
    if (track2?.length > 1) {
      const coords = [...track2].reverse().map(s => [s.lat, s.lon]);
      L.polyline(coords, { color: '#ff4444', weight: 2, opacity: 0.2 }).addTo(map);
    }

    if (allPoints.length > 0) {
      const bounds = L.latLngBounds(allPoints.map(p => [p.lat, p.lon]));
      map.fitBounds(bounds.pad(0.1));
    }

    safetyMapRefs.current[eventId] = map;

    const replayState = safetyReplayState[eventId] || { position: 50 };
    setTimeout(() => updateSafetyReplayMarkers(eventId, replayState.position), 100);
  }, [safetyTrackData, safetyReplayState, updateSafetyReplayMarkers]);

  // Handle safety replay slider change
  const handleSafetyReplayChange = useCallback((eventId, newPosition) => {
    setSafetyReplayState(prev => ({ ...prev, [eventId]: { ...prev[eventId], position: newPosition } }));
    updateSafetyReplayMarkers(eventId, newPosition);
  }, [setSafetyReplayState, updateSafetyReplayMarkers]);

  // Toggle safety play/pause
  const toggleSafetyPlay = useCallback((eventId) => {
    setSafetyReplayState(prev => {
      const current = prev[eventId] || { position: 0, isPlaying: false, speed: 1 };
      if (!current.isPlaying) {
        let pos = current.position <= 0 ? 0 : current.position;
        let lastTime = performance.now();
        const speed = current.speed;
        const animate = (currentTime) => {
          const deltaTime = currentTime - lastTime;
          lastTime = currentTime;
          const increment = (deltaTime / 200) * speed;
          pos += increment;
          if (pos >= 100) {
            setSafetyReplayState(p => ({ ...p, [eventId]: { ...p[eventId], position: 100, isPlaying: false } }));
            updateSafetyReplayMarkers(eventId, 100);
            return;
          }
          setSafetyReplayState(p => ({ ...p, [eventId]: { ...p[eventId], position: pos } }));
          updateSafetyReplayMarkers(eventId, pos);
          safetyAnimationRef.current[eventId] = requestAnimationFrame(animate);
        };
        safetyAnimationRef.current[eventId] = requestAnimationFrame(animate);
        return { ...prev, [eventId]: { ...current, isPlaying: true } };
      } else {
        if (safetyAnimationRef.current[eventId]) cancelAnimationFrame(safetyAnimationRef.current[eventId]);
        return { ...prev, [eventId]: { ...current, isPlaying: false } };
      }
    });
  }, [setSafetyReplayState, updateSafetyReplayMarkers]);

  // Skip safety to start/end
  const skipSafetyToStart = useCallback((eventId) => {
    if (safetyAnimationRef.current[eventId]) cancelAnimationFrame(safetyAnimationRef.current[eventId]);
    const current = safetyReplayState[eventId] || { speed: 1 };
    setSafetyReplayState(prev => ({ ...prev, [eventId]: { position: 0, isPlaying: false, speed: current.speed } }));
    updateSafetyReplayMarkers(eventId, 0);
  }, [safetyReplayState, setSafetyReplayState, updateSafetyReplayMarkers]);

  const skipSafetyToEnd = useCallback((eventId) => {
    if (safetyAnimationRef.current[eventId]) cancelAnimationFrame(safetyAnimationRef.current[eventId]);
    const current = safetyReplayState[eventId] || { speed: 1 };
    setSafetyReplayState(prev => ({ ...prev, [eventId]: { position: 100, isPlaying: false, speed: current.speed } }));
    updateSafetyReplayMarkers(eventId, 100);
  }, [safetyReplayState, setSafetyReplayState, updateSafetyReplayMarkers]);

  const jumpToSafetyEvent = useCallback((eventId) => {
    if (safetyAnimationRef.current[eventId]) cancelAnimationFrame(safetyAnimationRef.current[eventId]);
    const current = safetyReplayState[eventId] || { speed: 1 };
    setSafetyReplayState(prev => ({ ...prev, [eventId]: { position: 50, isPlaying: false, speed: current.speed } }));
    updateSafetyReplayMarkers(eventId, 50);
  }, [safetyReplayState, setSafetyReplayState, updateSafetyReplayMarkers]);

  const handleSafetySpeedChange = useCallback((eventId, newSpeed) => {
    setSafetyReplayState(prev => ({ ...prev, [eventId]: { ...prev[eventId], speed: newSpeed } }));
  }, [setSafetyReplayState]);

  // Get timestamp for safety replay position
  const getSafetyReplayTimestamp = useCallback((eventId) => {
    const data = safetyTrackData[eventId];
    const state = safetyReplayState[eventId];
    if (!data || !state) return null;
    const track = data.track1?.length > 0 ? data.track1 : data.track2;
    if (!track || track.length === 0) return null;
    const pos = getSafetyInterpolatedPosition(track, state.position);
    if (!pos?.timestamp) return null;
    return new Date(pos.timestamp).toLocaleTimeString();
  }, [safetyTrackData, safetyReplayState, getSafetyInterpolatedPosition]);

  // Cleanup maps
  useEffect(() => {
    return () => {
      Object.keys(safetyMapRefs.current).forEach(eventId => {
        if (safetyMapRefs.current[eventId]) {
          safetyMapRefs.current[eventId].remove();
        }
        if (safetyAnimationRef.current[eventId]) {
          cancelAnimationFrame(safetyAnimationRef.current[eventId]);
        }
      });
    };
  }, []);

  // Render snapshot data
  const renderSnapshot = (snapshot, label) => {
    if (!snapshot) return null;
    return (
      <div className="snapshot-section">
        {label && <div className="snapshot-label">{label}</div>}
        <div className="snapshot-grid">
          {snapshot.flight && <div className="snapshot-item"><span>Callsign</span><span>{snapshot.flight}</span></div>}
          {snapshot.hex && (
            <div className="snapshot-item">
              <span>ICAO</span>
              {snapshot.hex?.toLowerCase() !== hex?.toLowerCase() ? (
                <button className="icao-link" onClick={() => onSelectAircraft?.(snapshot.hex)}>{snapshot.hex}</button>
              ) : (
                <span>{snapshot.hex}</span>
              )}
            </div>
          )}
          {snapshot.lat && <div className="snapshot-item"><span>Lat</span><span>{snapshot.lat?.toFixed(5)}</span></div>}
          {snapshot.lon && <div className="snapshot-item"><span>Lon</span><span>{snapshot.lon?.toFixed(5)}</span></div>}
          {snapshot.alt_baro && <div className="snapshot-item"><span>Alt (baro)</span><span>{snapshot.alt_baro?.toLocaleString()} ft</span></div>}
          {snapshot.alt_geom && <div className="snapshot-item"><span>Alt (geom)</span><span>{snapshot.alt_geom?.toLocaleString()} ft</span></div>}
          {snapshot.gs && <div className="snapshot-item"><span>Ground Speed</span><span>{snapshot.gs?.toFixed(0)} kts</span></div>}
          {snapshot.track !== undefined && snapshot.track !== null && <div className="snapshot-item"><span>Track</span><span>{snapshot.track?.toFixed(0)}°</span></div>}
          {snapshot.baro_rate && <div className="snapshot-item"><span>Baro Rate</span><span>{snapshot.baro_rate > 0 ? '+' : ''}{snapshot.baro_rate} fpm</span></div>}
          {snapshot.geom_rate && <div className="snapshot-item"><span>Geom Rate</span><span>{snapshot.geom_rate > 0 ? '+' : ''}{snapshot.geom_rate} fpm</span></div>}
          {snapshot.squawk && <div className="snapshot-item"><span>Squawk</span><span>{snapshot.squawk}</span></div>}
        </div>
      </div>
    );
  };

  return (
    <div className="detail-safety" id="panel-safety" role="tabpanel" aria-labelledby="tab-safety">
      <div className="safety-filter">
        <label htmlFor="safety-time-range">Time Range:</label>
        <select id="safety-time-range" value={safetyHours} onChange={(e) => setSafetyHours(Number(e.target.value))}>
          <option value={1}>Last 1 hour</option>
          <option value={6}>Last 6 hours</option>
          <option value={12}>Last 12 hours</option>
          <option value={24}>Last 24 hours</option>
          <option value={48}>Last 48 hours</option>
          <option value={72}>Last 72 hours</option>
          <option value={168}>Last 7 days</option>
        </select>
      </div>

      {safetyEvents.length === 0 ? (
        <div className="detail-empty" role="status">
          <AlertTriangle size={48} aria-hidden="true" />
          <p>No safety events</p>
          <span>No safety events recorded for this aircraft in the selected time range</span>
        </div>
      ) : (
        <div className="safety-events-list">
          <p className="safety-count" aria-live="polite">
            {safetyEvents.length} safety event{safetyEvents.length !== 1 ? 's' : ''} in the last {safetyHours} hour{safetyHours !== 1 ? 's' : ''}
          </p>
          {safetyEvents.map((event, i) => {
            const eventKey = event.id || i;
            const hasSnapshot = event.aircraft_snapshot || event.aircraft_snapshot_2;
            const isExpanded = expandedSnapshots[eventKey];
            const currentHex = hex?.toLowerCase();
            const isCurrentPrimary = event.icao?.toLowerCase() === currentHex;
            const otherIcao = isCurrentPrimary ? event.icao_2 : event.icao;
            const otherCallsign = isCurrentPrimary ? event.callsign_2 : event.callsign;

            return (
              <article key={eventKey} className={`safety-event-item ${getSeverityClass(event.severity)}`}>
                <div className="safety-event-header">
                  <span className={`safety-severity-badge ${getSeverityClass(event.severity)}`}>
                    {event.severity?.toUpperCase()}
                  </span>
                  <span className="safety-event-type">{formatEventType(event.event_type)}</span>
                  <time className="safety-event-time" dateTime={event.timestamp}>
                    {new Date(event.timestamp).toLocaleString()}
                  </time>
                </div>
                <div className="safety-event-message">{event.message}</div>
                {event.details && (
                  <div className="safety-event-details">
                    {event.details.altitude && <span>Alt: {event.details.altitude?.toLocaleString()}ft</span>}
                    {event.details.vertical_rate && <span>VS: {event.details.vertical_rate > 0 ? '+' : ''}{event.details.vertical_rate}fpm</span>}
                    {event.details.distance_nm && <span>Dist: {event.details.distance_nm}nm</span>}
                    {event.details.altitude_diff_ft && <span>ΔAlt: {event.details.altitude_diff_ft}ft</span>}
                    {otherIcao && (
                      <span className="safety-other-aircraft">
                        With:{' '}
                        {onSelectAircraft ? (
                          <button className="safety-aircraft-link" onClick={() => onSelectAircraft(otherIcao)} title={`View ${otherIcao}`}>
                            {otherCallsign || otherIcao}
                          </button>
                        ) : (
                          <span>{otherCallsign || otherIcao}</span>
                        )}
                      </span>
                    )}
                  </div>
                )}
                <div className="safety-event-actions">
                  {hasSnapshot && (
                    <button className="snapshot-toggle" onClick={() => toggleSnapshot(eventKey)} aria-expanded={isExpanded}>
                      {isExpanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                      {isExpanded ? 'Hide' : 'Show'} Telemetry
                    </button>
                  )}
                  <button className={`map-toggle-btn small ${expandedSafetyMaps[eventKey] ? 'active' : ''}`} onClick={() => toggleSafetyMap(eventKey, event)}>
                    <MapIcon size={14} aria-hidden="true" />
                    {expandedSafetyMaps[eventKey] ? 'Hide Map' : 'Show Map'}
                  </button>
                  {onViewHistoryEvent && (
                    <button className="history-link-btn small" onClick={() => onViewHistoryEvent(event.id || eventKey)} title="View in History with expanded map">
                      <History size={14} aria-hidden="true" />
                      View in History
                    </button>
                  )}
                  {onViewEvent && event.id && (
                    <button className="view-details-btn small" onClick={() => onViewEvent(event.id)} title="View full event details page">
                      <ExternalLink size={14} aria-hidden="true" />
                      View Details
                    </button>
                  )}
                </div>
                {isExpanded && hasSnapshot && (
                  <div className="snapshot-container">
                    {event.aircraft_snapshot && renderSnapshot(event.aircraft_snapshot, event.aircraft_snapshot_2 ? (event.aircraft_snapshot.flight || event.icao) : null)}
                    {event.aircraft_snapshot_2 && renderSnapshot(event.aircraft_snapshot_2, event.aircraft_snapshot_2.flight || event.icao_2)}
                  </div>
                )}
                {expandedSafetyMaps[eventKey] && safetyTrackData[eventKey] && (
                  <div className="safety-map-container">
                    <div className="safety-event-map" ref={(el) => {
                      if (el && expandedSafetyMaps[eventKey] && !safetyMapRefs.current[eventKey]) {
                        setTimeout(() => initializeSafetyMap(el, eventKey), 50);
                      }
                    }} />
                    <ReplayControlsCompact
                      isPlaying={safetyReplayState[eventKey]?.isPlaying}
                      position={safetyReplayState[eventKey]?.position || 50}
                      timestamp={getSafetyReplayTimestamp(eventKey)}
                      onPlayToggle={() => toggleSafetyPlay(eventKey)}
                      onSkipToStart={() => skipSafetyToStart(eventKey)}
                      onSkipToEnd={() => skipSafetyToEnd(eventKey)}
                      onJumpToEvent={() => jumpToSafetyEvent(eventKey)}
                      onPositionChange={(pos) => handleSafetyReplayChange(eventKey, pos)}
                      speed={safetyReplayState[eventKey]?.speed || 1}
                      onSpeedChange={(speed) => handleSafetySpeedChange(eventKey, speed)}
                    />
                    <div className="safety-map-legend">
                      <div className="legend-item clickable" onClick={() => onSelectAircraft?.(event.icao)}>
                        <span className="legend-marker ac1-marker"></span>
                        <span className="legend-callsign">{event.callsign || event.icao}</span>
                      </div>
                      {event.icao_2 && (
                        <div className="legend-item clickable" onClick={() => onSelectAircraft?.(event.icao_2)}>
                          <span className="legend-marker ac2-marker"></span>
                          <span className="legend-callsign">{event.callsign_2 || event.icao_2}</span>
                        </div>
                      )}
                      <div className="legend-item">
                        <span className="legend-marker event-marker"></span>
                        <span>Event Location</span>
                      </div>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
