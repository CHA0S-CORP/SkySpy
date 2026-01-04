import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Play, Pause, SkipBack, SkipForward, ArrowLeft, Copy, Check, Zap, Radar, Clock, Plane, Activity, Navigation, Shield, Target } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Enhanced slider and animation styles
const sliderStyles = `
  .safety-page-slider::-webkit-slider-thumb {
    -webkit-appearance: none !important;
    appearance: none !important;
    width: 16px !important;
    height: 16px !important;
    background: linear-gradient(135deg, #00d4ff, #00ff88) !important;
    border-radius: 50% !important;
    cursor: pointer !important;
    border: 2px solid rgba(255,255,255,0.9) !important;
    box-shadow: 0 0 20px rgba(0, 212, 255, 0.6), 0 0 40px rgba(0, 212, 255, 0.3) !important;
    transition: transform 0.15s ease, box-shadow 0.15s ease !important;
  }
  .safety-page-slider::-webkit-slider-thumb:hover {
    transform: scale(1.2) !important;
    box-shadow: 0 0 25px rgba(0, 212, 255, 0.8), 0 0 50px rgba(0, 212, 255, 0.4) !important;
  }
  .safety-page-slider::-moz-range-thumb {
    width: 16px !important;
    height: 16px !important;
    background: linear-gradient(135deg, #00d4ff, #00ff88) !important;
    border-radius: 50% !important;
    border: 2px solid rgba(255,255,255,0.9) !important;
    cursor: pointer !important;
    box-shadow: 0 0 20px rgba(0, 212, 255, 0.6) !important;
  }

  @keyframes radarSweep {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  @keyframes pulseGlow {
    0%, 100% { opacity: 0.4; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.05); }
  }

  @keyframes dataStream {
    0% { background-position: 0% 0%; }
    100% { background-position: 100% 100%; }
  }

  @keyframes scanLine {
    0% { transform: translateY(-100%); opacity: 0; }
    50% { opacity: 0.5; }
    100% { transform: translateY(100vh); opacity: 0; }
  }
`;

export function SafetyEventPage({ eventId, apiBase, onClose, onSelectAircraft, wsRequest, wsConnected }) {
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedSnapshots, setExpandedSnapshots] = useState({});
  const [trackData, setTrackData] = useState({});
  const [replayState, setReplayState] = useState({ position: 100, isPlaying: false, speed: 1 });
  const [graphZoomState, setGraphZoomState] = useState({ zoom: 1, offset: 0 });
  const [copied, setCopied] = useState(false);

  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const replayMarkersRef = useRef({});
  const replayTracksRef = useRef({});
  const animationFrameRef = useRef(null);
  const graphDragRef = useRef({ isDragging: false, startX: 0, startOffset: 0 });
  const replayControlsRef = useRef(null);
  const flightGraphsRef = useRef(null);

  // Fetch event data
  useEffect(() => {
    const fetchEvent = async () => {
      if (!eventId) {
        setError('No event ID provided');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`${apiBase}/api/v1/safety/events/${eventId}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError('Safety event not found');
          } else {
            setError('Failed to load safety event');
          }
          setLoading(false);
          return;
        }

        const data = await res.json();
        setEvent(data);

        // Fetch track data for involved aircraft
        const icaos = [data.icao, data.icao_2].filter(Boolean);
        for (const icao of icaos) {
          try {
            let trackResult = null;

            // Try WebSocket first
            if (wsRequest && wsConnected) {
              try {
                const result = await wsRequest('sightings', { icao_hex: icao, hours: 2, limit: 500 });
                if (result && Array.isArray(result.sightings)) {
                  trackResult = result;
                }
              } catch (wsErr) {
                console.warn('WebSocket sightings request failed, falling back to HTTP:', wsErr.message);
              }
            }

            // Fallback to HTTP if WebSocket failed or unavailable
            if (!trackResult) {
              const trackRes = await fetch(`${apiBase}/api/v1/history/sightings/${icao}?hours=2&limit=500`);
              if (trackRes.ok) {
                const httpResult = await trackRes.json();
                if (httpResult && Array.isArray(httpResult.sightings)) {
                  trackResult = httpResult;
                }
              }
            }

            if (trackResult && trackResult.sightings) {
              setTrackData(prev => ({ ...prev, [icao]: trackResult.sightings }));
            }
          } catch (err) {
            console.error('Failed to fetch track data for', icao, err);
          }
        }
      } catch (err) {
        console.error('Failed to fetch safety event:', err);
        setError('Failed to load safety event');
      }

      setLoading(false);
    };

    fetchEvent();
  }, [eventId, apiBase, wsRequest, wsConnected]);

  // Copy link to clipboard
  const copyLink = useCallback(() => {
    const url = `${window.location.origin}${window.location.pathname}#event?id=${eventId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [eventId]);

  // Create aircraft icon
  const createAircraftIcon = useCallback((track, color) => {
    const rotation = track || 0;
    return L.divIcon({
      className: 'safety-aircraft-marker',
      html: `
        <svg width="32" height="32" viewBox="0 0 24 24" style="transform: rotate(${rotation}deg)">
          <path d="M12 2 L14 8 L20 10 L14 12 L14 18 L12 16 L10 18 L10 12 L4 10 L10 8 Z"
                fill="${color}" stroke="#000" stroke-width="0.5"/>
        </svg>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
  }, []);

  // Get interpolated position along a track
  const getInterpolatedPosition = useCallback((track, percentage) => {
    if (!track || track.length === 0) return null;
    if (track.length === 1) return { ...track[0], index: 0 };

    const ordered = [...track].reverse();
    const index = Math.floor((percentage / 100) * (ordered.length - 1));
    const clampedIndex = Math.max(0, Math.min(index, ordered.length - 1));
    return { ...ordered[clampedIndex], index: clampedIndex };
  }, []);

  // Update replay markers
  const updateReplayMarkers = useCallback((position) => {
    const map = mapRef.current;
    if (!map || !event) return;

    const icaos = [event.icao, event.icao_2].filter(Boolean);
    const colors = ['#00ff88', '#44aaff'];

    icaos.forEach((icao, i) => {
      const track = trackData[icao];
      if (!track || track.length === 0) return;

      const pos = getInterpolatedPosition(track, position);
      if (!pos || !pos.lat || !pos.lon) return;

      const markerId = icao;
      const trackId = `track_${icao}`;

      // Remove existing marker
      if (replayMarkersRef.current[markerId]) {
        map.removeLayer(replayMarkersRef.current[markerId]);
      }

      // Update track polyline
      const ordered = [...track].reverse().filter(p => p.lat && p.lon);
      if (ordered.length > 1) {
        const endIndex = Math.floor((position / 100) * (ordered.length - 1));
        const visibleTrack = ordered.slice(0, endIndex + 1);

        if (replayTracksRef.current[trackId]) {
          map.removeLayer(replayTracksRef.current[trackId]);
        }

        if (visibleTrack.length > 1) {
          const coords = visibleTrack.map(p => [p.lat, p.lon]);
          const polyline = L.polyline(coords, {
            color: colors[i],
            weight: 4,
            opacity: 0.8
          }).addTo(map);
          replayTracksRef.current[trackId] = polyline;
        }
      }

      // Create new marker
      const icon = createAircraftIcon(pos.track, colors[i]);
      const marker = L.marker([pos.lat, pos.lon], { icon }).addTo(map);
      marker.bindPopup(`
        <b>${pos.callsign || icao}</b><br>
        Alt: ${pos.altitude?.toLocaleString() || '--'} ft<br>
        Speed: ${pos.gs?.toFixed(0) || '--'} kts<br>
        VS: ${pos.vr > 0 ? '+' : ''}${pos.vr || 0} fpm
      `);

      replayMarkersRef.current[markerId] = marker;
    });
  }, [event, trackData, getInterpolatedPosition, createAircraftIcon]);

  // Initialize map
  const initializeMap = useCallback((containerEl) => {
    if (!containerEl || mapRef.current || !event) return;

    const snapshot1 = event.aircraft_snapshot;
    const snapshot2 = event.aircraft_snapshot_2;

    let eventLat, eventLon;

    if (event.details?.lat && event.details?.lon) {
      eventLat = event.details.lat;
      eventLon = event.details.lon;
    } else if (snapshot1?.lat && snapshot1?.lon && snapshot2?.lat && snapshot2?.lon) {
      eventLat = (snapshot1.lat + snapshot2.lat) / 2;
      eventLon = (snapshot1.lon + snapshot2.lon) / 2;
    } else if (snapshot1?.lat && snapshot1?.lon) {
      eventLat = snapshot1.lat;
      eventLon = snapshot1.lon;
    } else if (snapshot2?.lat && snapshot2?.lon) {
      eventLat = snapshot2.lat;
      eventLon = snapshot2.lon;
    } else {
      return;
    }

    const map = L.map(containerEl, {
      center: [eventLat, eventLon],
      zoom: 10,
      zoomControl: true,
      attributionControl: false
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(map);

    // Add event location marker
    const eventIcon = L.divIcon({
      className: 'event-location-marker',
      html: `
        <div class="event-marker-pulse-ring"></div>
        <div class="event-marker-core"></div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });

    const eventMarker = L.marker([eventLat, eventLon], { icon: eventIcon }).addTo(map);
    eventMarker.bindPopup(`<b>Event Location</b><br>${event.event_type?.replace(/_/g, ' ')}<br>${new Date(event.timestamp).toLocaleString()}`);

    // Add faint background tracks
    const icaos = [event.icao, event.icao_2].filter(Boolean);
    const colors = ['#00ff88', '#44aaff'];

    icaos.forEach((icao, i) => {
      const track = trackData[icao];
      if (track?.length > 1) {
        const coords = [...track].reverse()
          .filter(p => p.lat && p.lon)
          .map(p => [p.lat, p.lon]);
        if (coords.length > 1) {
          L.polyline(coords, {
            color: colors[i],
            weight: 2,
            opacity: 0.2,
            dashArray: '4, 6'
          }).addTo(map);
        }
      }
    });

    // Fit bounds
    if (snapshot1?.lat && snapshot2?.lat) {
      const bounds = L.latLngBounds([
        [snapshot1.lat, snapshot1.lon],
        [snapshot2.lat, snapshot2.lon]
      ]);
      map.fitBounds(bounds.pad(0.3));
    }

    mapRef.current = map;
    updateReplayMarkers(replayState.position);
  }, [event, trackData, replayState.position, updateReplayMarkers]);

  // Handle replay slider change
  const handleReplayChange = useCallback((newPosition) => {
    setReplayState(prev => ({ ...prev, position: newPosition }));
    updateReplayMarkers(newPosition);
  }, [updateReplayMarkers]);

  // Toggle play/pause
  const togglePlay = useCallback(() => {
    const newPlaying = !replayState.isPlaying;
    setReplayState(prev => ({ ...prev, isPlaying: newPlaying }));

    if (newPlaying) {
      let pos = replayState.position <= 0 ? 0 : replayState.position;
      let lastTime = performance.now();

      const animate = (currentTime) => {
        const deltaTime = currentTime - lastTime;
        lastTime = currentTime;
        const increment = (deltaTime / 200) * replayState.speed;
        pos += increment;

        if (pos >= 100) {
          pos = 100;
          setReplayState(prev => ({ ...prev, position: 100, isPlaying: false }));
          updateReplayMarkers(100);
          return;
        }

        setReplayState(prev => ({ ...prev, position: pos }));
        updateReplayMarkers(pos);
        animationFrameRef.current = requestAnimationFrame(animate);
      };

      animationFrameRef.current = requestAnimationFrame(animate);
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    }
  }, [replayState, updateReplayMarkers]);

  // Skip controls
  const skipToStart = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    setReplayState(prev => ({ ...prev, position: 0, isPlaying: false }));
    updateReplayMarkers(0);
  }, [updateReplayMarkers]);

  const skipToEnd = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    setReplayState(prev => ({ ...prev, position: 100, isPlaying: false }));
    updateReplayMarkers(100);
  }, [updateReplayMarkers]);

  const jumpToEvent = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    setReplayState(prev => ({ ...prev, position: 50, isPlaying: false }));
    updateReplayMarkers(50);
  }, [updateReplayMarkers]);

  // Handle speed change
  const handleSpeedChange = useCallback((newSpeed) => {
    setReplayState(prev => ({ ...prev, speed: newSpeed }));
  }, []);

  // Handle mousewheel on replay controls and graphs to scrub through time
  useEffect(() => {
    const handleWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const step = e.shiftKey ? 10 : 2;
      // Scroll down = forward in time, scroll up = backward
      const delta = e.deltaY > 0 ? step : -step;
      setReplayState(prev => {
        const newPosition = Math.max(0, Math.min(100, prev.position + delta));
        updateReplayMarkers(newPosition);
        return { ...prev, position: newPosition, isPlaying: false };
      });
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };

    const controls = replayControlsRef.current;
    const graphs = flightGraphsRef.current;

    if (controls) controls.addEventListener('wheel', handleWheel, { passive: false });
    if (graphs) graphs.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      if (controls) controls.removeEventListener('wheel', handleWheel);
      if (graphs) graphs.removeEventListener('wheel', handleWheel);
    };
  }, [updateReplayMarkers]);

  // Graph handlers
  const handleGraphWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.25 : 0.25;
    setGraphZoomState(prev => {
      const newZoom = Math.max(1, Math.min(8, prev.zoom + delta));
      let newOffset = prev.offset;
      if (newZoom < prev.zoom) {
        const maxOffset = Math.max(0, 100 - (100 / newZoom));
        newOffset = Math.min(prev.offset, maxOffset);
      }
      return { zoom: newZoom, offset: newOffset };
    });
  }, []);

  const handleGraphDragStart = useCallback((e) => {
    if (graphZoomState.zoom <= 1) return;
    graphDragRef.current = {
      isDragging: true,
      startX: e.clientX || e.touches?.[0]?.clientX || 0,
      startOffset: graphZoomState.offset
    };
  }, [graphZoomState]);

  const handleGraphDragMove = useCallback((e) => {
    const drag = graphDragRef.current;
    if (!drag?.isDragging) return;
    const currentX = e.clientX || e.touches?.[0]?.clientX || 0;
    const deltaX = drag.startX - currentX;
    const graphWidth = 300;
    const visiblePercent = 100 / graphZoomState.zoom;
    const maxOffset = 100 - visiblePercent;
    const percentDelta = (deltaX / graphWidth) * visiblePercent;
    const newOffset = Math.max(0, Math.min(maxOffset, drag.startOffset + percentDelta));
    setGraphZoomState(prev => ({ ...prev, offset: newOffset }));
  }, [graphZoomState]);

  const handleGraphDragEnd = useCallback(() => {
    graphDragRef.current.isDragging = false;
  }, []);

  const resetGraphZoom = useCallback(() => {
    setGraphZoomState({ zoom: 1, offset: 0 });
  }, []);

  // Get replay timestamp
  const getReplayTimestamp = useMemo(() => {
    if (!event) return null;
    const icao = event.icao || event.icao_2;
    const track = trackData[icao];
    if (!track || track.length === 0) return null;
    const pos = getInterpolatedPosition(track, replayState.position);
    if (!pos?.timestamp) return null;
    return new Date(pos.timestamp).toLocaleTimeString();
  }, [event, trackData, replayState.position, getInterpolatedPosition]);

  // Render mini graph
  const renderMiniGraph = useCallback((track, dataKey, color, label, unit, formatFn, positionPercent = null) => {
    if (!track || track.length < 2) return null;

    const ordered = [...track].reverse();
    const values = ordered.map(p => p[dataKey]).filter(v => v != null);
    if (values.length < 2) return null;

    const format = formatFn || (v => v?.toLocaleString());
    const width = 300;
    const height = 60;
    const padding = 2;

    const { zoom, offset } = graphZoomState;
    const isZoomed = zoom > 1;

    const fullMin = Math.min(...values);
    const fullMax = Math.max(...values);
    const fullRange = fullMax - fullMin || 1;

    let visibleValues, visibleMin, visibleMax, startPercent, endPercent;

    if (isZoomed) {
      const visiblePercent = 100 / zoom;
      startPercent = offset;
      endPercent = offset + visiblePercent;
      const startIdx = Math.floor((startPercent / 100) * (values.length - 1));
      const endIdx = Math.ceil((endPercent / 100) * (values.length - 1));
      visibleValues = values.slice(startIdx, endIdx + 1);
      visibleMin = visibleValues.length > 0 ? Math.min(...visibleValues) : fullMin;
      visibleMax = visibleValues.length > 0 ? Math.max(...visibleValues) : fullMax;
    } else {
      startPercent = 0;
      endPercent = 100;
      visibleValues = values;
      visibleMin = fullMin;
      visibleMax = fullMax;
    }

    const points = visibleValues.map((v, i) => {
      const x = padding + (i / Math.max(1, visibleValues.length - 1)) * (width - padding * 2);
      const y = height - padding - ((v - fullMin) / fullRange) * (height - padding * 2);
      return `${x},${y}`;
    }).join(' ');

    let currentValue = null;
    if (positionPercent !== null && values.length > 0) {
      const idx = Math.floor((positionPercent / 100) * (values.length - 1));
      currentValue = values[Math.max(0, Math.min(idx, values.length - 1))];
    }

    let indicatorX = null;
    let indicatorY = null;
    const positionInWindow = positionPercent !== null && positionPercent >= startPercent && positionPercent <= endPercent;
    if (positionInWindow) {
      const visiblePercent = 100 / zoom;
      const relativePosition = (positionPercent - startPercent) / visiblePercent;
      indicatorX = padding + relativePosition * (width - padding * 2);
      if (currentValue !== null) {
        indicatorY = height - padding - ((currentValue - fullMin) / fullRange) * (height - padding * 2);
      }
    }

    return (
      <div
        className={`mini-graph large${isZoomed ? ' zoomable' : ''}`}
        onWheel={handleGraphWheel}
        onMouseDown={handleGraphDragStart}
        onMouseMove={handleGraphDragMove}
        onMouseUp={handleGraphDragEnd}
        onMouseLeave={handleGraphDragEnd}
        onTouchStart={handleGraphDragStart}
        onTouchMove={handleGraphDragMove}
        onTouchEnd={handleGraphDragEnd}
      >
        <div className="mini-graph-header">
          <span className="mini-graph-label">{label}</span>
          {isZoomed && (
            <span className="mini-graph-zoom" onClick={resetGraphZoom}>
              {zoom.toFixed(1)}x
            </span>
          )}
          {currentValue !== null && (
            <span className="mini-graph-current" style={{ color }}>
              {format(currentValue)} {unit}
            </span>
          )}
        </div>
        <svg width={width} height={height} className="mini-graph-svg">
          <polyline
            points={points}
            fill="none"
            stroke={color}
            strokeWidth="2"
            opacity="0.7"
          />
          {indicatorX !== null && (
            <>
              <line
                x1={indicatorX}
                y1={0}
                x2={indicatorX}
                y2={height}
                stroke={color}
                strokeWidth="2"
                opacity="0.9"
              />
              {indicatorY !== null && (
                <circle
                  cx={indicatorX}
                  cy={indicatorY}
                  r="5"
                  fill={color}
                  stroke="#000"
                  strokeWidth="1"
                />
              )}
            </>
          )}
        </svg>
        <div className="mini-graph-range">
          <span>{format(isZoomed ? visibleMin : fullMin)} {unit}</span>
          <span>{format(isZoomed ? visibleMax : fullMax)} {unit}</span>
        </div>
      </div>
    );
  }, [graphZoomState, handleGraphWheel, handleGraphDragStart, handleGraphDragMove, handleGraphDragEnd, resetGraphZoom]);

  // Render snapshot data
  const renderSnapshot = (snapshot, label) => {
    if (!snapshot) return null;
    return (
      <div className="snapshot-section large">
        {label && <div className="snapshot-label">{label}</div>}
        <div className="snapshot-grid">
          {snapshot.flight && <div className="snapshot-item"><span>Callsign</span><span>{snapshot.flight}</span></div>}
          {snapshot.hex && <div className="snapshot-item"><span>ICAO</span><span className="icao-link" onClick={() => onSelectAircraft?.(snapshot.hex)}>{snapshot.hex}</span></div>}
          {snapshot.lat && <div className="snapshot-item"><span>Lat</span><span>{snapshot.lat?.toFixed(5)}</span></div>}
          {snapshot.lon && <div className="snapshot-item"><span>Lon</span><span>{snapshot.lon?.toFixed(5)}</span></div>}
          {snapshot.alt_baro && <div className="snapshot-item"><span>Alt (baro)</span><span>{snapshot.alt_baro?.toLocaleString()} ft</span></div>}
          {snapshot.alt_geom && <div className="snapshot-item"><span>Alt (geom)</span><span>{snapshot.alt_geom?.toLocaleString()} ft</span></div>}
          {snapshot.gs && <div className="snapshot-item"><span>Ground Speed</span><span>{snapshot.gs?.toFixed(0)} kts</span></div>}
          {snapshot.track !== undefined && snapshot.track !== null && <div className="snapshot-item"><span>Track</span><span>{snapshot.track?.toFixed(0)}°</span></div>}
          {snapshot.baro_rate && <div className="snapshot-item"><span>Baro Rate</span><span>{snapshot.baro_rate > 0 ? '+' : ''}{snapshot.baro_rate} fpm</span></div>}
          {snapshot.geom_rate && <div className="snapshot-item"><span>Geom Rate</span><span>{snapshot.geom_rate > 0 ? '+' : ''}{snapshot.geom_rate} fpm</span></div>}
          {snapshot.squawk && <div className="snapshot-item"><span>Squawk</span><span>{snapshot.squawk}</span></div>}
          {snapshot.category && <div className="snapshot-item"><span>Category</span><span>{snapshot.category}</span></div>}
          {snapshot.nav_altitude_mcp && <div className="snapshot-item"><span>MCP Alt</span><span>{snapshot.nav_altitude_mcp?.toLocaleString()} ft</span></div>}
          {snapshot.nav_heading !== undefined && snapshot.nav_heading !== null && <div className="snapshot-item"><span>Nav Heading</span><span>{snapshot.nav_heading?.toFixed(0)}°</span></div>}
          {snapshot.emergency && <div className="snapshot-item"><span>Emergency</span><span className="emergency-value">{snapshot.emergency}</span></div>}
        </div>
      </div>
    );
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Get severity color
  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return '#ff4757';
      case 'warning': return '#ff9f43';
      case 'info': return '#00d4ff';
      default: return '#00d4ff';
    }
  };

  // Get current telemetry values for display
  const getCurrentTelemetry = useCallback((icao) => {
    const track = trackData[icao];
    if (!track || track.length === 0) return null;
    const pos = getInterpolatedPosition(track, replayState.position);
    return pos;
  }, [trackData, replayState.position, getInterpolatedPosition]);

  if (loading) {
    return (
      <div className="safety-event-page-v2">
        <div className="sep-loading">
          <div className="sep-loading-radar">
            <Radar size={64} className="sep-radar-icon" />
            <div className="sep-radar-sweep" />
          </div>
          <span className="sep-loading-text">Analyzing safety event data...</span>
          <div className="sep-loading-dots">
            <span /><span /><span />
          </div>
        </div>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="safety-event-page-v2">
        <div className="sep-error">
          <div className="sep-error-icon">
            <Shield size={64} />
          </div>
          <h2>{error || 'Event not found'}</h2>
          <p>Unable to retrieve safety event data</p>
          <button className="sep-back-btn" onClick={() => { window.location.hash = '#history?data=safety'; onClose?.(); }}>
            <ArrowLeft size={18} /> Return to Safety Events
          </button>
        </div>
      </div>
    );
  }

  const hasSnapshot = event.aircraft_snapshot || event.aircraft_snapshot_2;
  const isExpanded = expandedSnapshots[eventId];
  const severityColor = getSeverityColor(event.severity);
  const telem1 = getCurrentTelemetry(event.icao);
  const telem2 = event.icao_2 ? getCurrentTelemetry(event.icao_2) : null;

  return (
    <div className="safety-event-page-v2">
      <style>{sliderStyles}</style>

      {/* Ambient background effects */}
      <div className="sep-ambient">
        <div className="sep-ambient-glow" style={{ '--severity-color': severityColor }} />
        <div className="sep-grid-overlay" />
      </div>

      {/* Top bar with event info */}
      <div className="sep-topbar">
        <button className="sep-back-btn" onClick={() => { window.location.hash = '#history?data=safety'; onClose?.(); }}>
          <ArrowLeft size={18} />
        </button>

        <div className="sep-event-badge" style={{ '--badge-color': severityColor }}>
          <AlertTriangle size={16} />
          <span className="sep-event-type">{event.event_type?.replace(/_/g, ' ')}</span>
        </div>

        <div className="sep-severity-indicator" style={{ '--severity-color': severityColor }}>
          <Zap size={14} />
          <span>{event.severity?.toUpperCase()}</span>
        </div>

        <div className="sep-timestamp">
          <Clock size={14} />
          <span>{new Date(event.timestamp).toLocaleString()}</span>
        </div>

        <button className="sep-copy-btn" onClick={copyLink}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
          <span>{copied ? 'Copied!' : 'Share'}</span>
        </button>
      </div>

      {/* Main content grid */}
      <div className="sep-main-grid">
        {/* Left column - Event details */}
        <div className="sep-info-column">
          {/* Event message card */}
          <div className="sep-message-card" style={{ '--accent': severityColor }}>
            <div className="sep-message-icon">
              <AlertTriangle size={24} />
            </div>
            <p className="sep-message-text">{event.message}</p>
          </div>

          {/* Aircraft cards */}
          <div className="sep-aircraft-section">
            <div className="sep-section-header">
              <Plane size={16} />
              <span>Involved Aircraft</span>
            </div>

            <div className="sep-aircraft-grid">
              {/* Aircraft 1 */}
              <div
                className="sep-aircraft-card"
                onClick={() => onSelectAircraft?.(event.icao)}
                style={{ '--ac-color': '#00ff88' }}
              >
                <div className="sep-ac-header">
                  <Navigation size={16} style={{ transform: `rotate(${telem1?.track || 0}deg)` }} />
                  <span className="sep-ac-callsign">{event.callsign || event.icao}</span>
                </div>
                <div className="sep-ac-icao">{event.icao}</div>
                {telem1 && (
                  <div className="sep-ac-telemetry">
                    <div className="sep-telem-item">
                      <span className="sep-telem-label">ALT</span>
                      <span className="sep-telem-value">{telem1.altitude?.toLocaleString() || '--'}</span>
                      <span className="sep-telem-unit">ft</span>
                    </div>
                    <div className="sep-telem-item">
                      <span className="sep-telem-label">GS</span>
                      <span className="sep-telem-value">{telem1.gs?.toFixed(0) || '--'}</span>
                      <span className="sep-telem-unit">kts</span>
                    </div>
                    <div className="sep-telem-item">
                      <span className="sep-telem-label">VS</span>
                      <span className={`sep-telem-value ${telem1?.vr > 0 ? 'climbing' : telem1?.vr < 0 ? 'descending' : ''}`}>
                        {telem1.vr > 0 ? '+' : ''}{telem1.vr || 0}
                      </span>
                      <span className="sep-telem-unit">fpm</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Separation indicator */}
              {event.icao_2 && (
                <div className="sep-separation-indicator">
                  <div className="sep-separation-line" />
                  <div className="sep-separation-data">
                    {event.details?.horizontal_nm && (
                      <div className="sep-sep-item">
                        <span className="sep-sep-value">{event.details.horizontal_nm.toFixed(1)}</span>
                        <span className="sep-sep-unit">nm</span>
                      </div>
                    )}
                    {event.details?.vertical_ft && (
                      <div className="sep-sep-item vertical">
                        <span className="sep-sep-value">{event.details.vertical_ft}</span>
                        <span className="sep-sep-unit">ft</span>
                      </div>
                    )}
                  </div>
                  <div className="sep-separation-line" />
                </div>
              )}

              {/* Aircraft 2 */}
              {event.icao_2 && (
                <div
                  className="sep-aircraft-card"
                  onClick={() => onSelectAircraft?.(event.icao_2)}
                  style={{ '--ac-color': '#00d4ff' }}
                >
                  <div className="sep-ac-header">
                    <Navigation size={16} style={{ transform: `rotate(${telem2?.track || 0}deg)` }} />
                    <span className="sep-ac-callsign">{event.callsign_2 || event.icao_2}</span>
                  </div>
                  <div className="sep-ac-icao">{event.icao_2}</div>
                  {telem2 && (
                    <div className="sep-ac-telemetry">
                      <div className="sep-telem-item">
                        <span className="sep-telem-label">ALT</span>
                        <span className="sep-telem-value">{telem2.altitude?.toLocaleString() || '--'}</span>
                        <span className="sep-telem-unit">ft</span>
                      </div>
                      <div className="sep-telem-item">
                        <span className="sep-telem-label">GS</span>
                        <span className="sep-telem-value">{telem2.gs?.toFixed(0) || '--'}</span>
                        <span className="sep-telem-unit">kts</span>
                      </div>
                      <div className="sep-telem-item">
                        <span className="sep-telem-label">VS</span>
                        <span className={`sep-telem-value ${telem2?.vr > 0 ? 'climbing' : telem2?.vr < 0 ? 'descending' : ''}`}>
                          {telem2.vr > 0 ? '+' : ''}{telem2.vr || 0}
                        </span>
                        <span className="sep-telem-unit">fpm</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Telemetry graphs */}
          <div className="sep-graphs-section" ref={flightGraphsRef}>
            <div className="sep-section-header">
              <Activity size={16} />
              <span>Flight Data</span>
              {graphZoomState.zoom > 1 && (
                <button className="sep-reset-zoom" onClick={resetGraphZoom}>
                  Reset Zoom ({graphZoomState.zoom.toFixed(1)}x)
                </button>
              )}
            </div>

            <div className="sep-graphs-container">
              {[event.icao, event.icao_2].filter(Boolean).map((icao, idx) => {
                const track = trackData[icao];
                const color = idx === 0 ? '#00ff88' : '#00d4ff';
                const position = replayState.position;
                const callsign = event[idx === 0 ? 'callsign' : 'callsign_2'] || icao;

                if (!track || track.length < 2) {
                  return (
                    <div key={icao} className="sep-graphs-aircraft">
                      <div className="sep-graphs-label" style={{ color }}>{callsign}</div>
                      <div className="sep-no-data">No telemetry data available</div>
                    </div>
                  );
                }

                return (
                  <div key={icao} className="sep-graphs-aircraft">
                    <div className="sep-graphs-label" style={{ color }}>
                      <Plane size={14} />
                      {callsign}
                    </div>
                    <div className="sep-graphs-row">
                      {renderMiniGraph(track, 'altitude', color, 'Altitude', 'ft', null, position)}
                      {renderMiniGraph(track, 'gs', color, 'Speed', 'kts', v => v?.toFixed(0), position)}
                      {renderMiniGraph(track, 'vr', color, 'Vertical Rate', 'fpm', v => (v > 0 ? '+' : '') + v, position)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Raw telemetry toggle */}
          {hasSnapshot && (
            <div className="sep-telemetry-section">
              <button
                className={`sep-telemetry-toggle ${isExpanded ? 'expanded' : ''}`}
                onClick={() => setExpandedSnapshots(prev => ({ ...prev, [eventId]: !prev[eventId] }))}
              >
                <Radar size={16} />
                <span>Raw Telemetry Snapshot</span>
                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>

              {isExpanded && (
                <div className="sep-telemetry-content">
                  {renderSnapshot(event.aircraft_snapshot, event.aircraft_snapshot_2 ? 'Aircraft 1' : null)}
                  {renderSnapshot(event.aircraft_snapshot_2, 'Aircraft 2')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right column - Map and replay */}
        <div className="sep-map-column">
          <div className="sep-map-container">
            <div className="sep-map-header">
              <Target size={16} />
              <span>Event Visualization</span>
              <div className="sep-map-live-indicator">
                <span className="sep-pulse-dot" />
                REPLAY
              </div>
            </div>
            <div
              className="sep-map"
              ref={(el) => {
                if (el && !mapRef.current) {
                  mapContainerRef.current = el;
                  setTimeout(() => initializeMap(el), 100);
                }
              }}
            />
            <div className="sep-map-overlay-gradient" />
          </div>

          {/* Timeline/Replay controls */}
          <div className="sep-replay-panel" ref={replayControlsRef}>
            <div className="sep-replay-header">
              <Activity size={14} />
              <span>Flight Timeline</span>
              <span className="sep-replay-time">{getReplayTimestamp || '--:--:--'}</span>
            </div>

            <div className="sep-timeline-container">
              <div className="sep-timeline-track">
                <div
                  className="sep-timeline-progress"
                  style={{ width: `${replayState.position}%` }}
                />
                {/* Timeline ticks */}
                <div className="sep-timeline-ticks">
                  {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(tick => (
                    <div key={tick} className={`sep-timeline-tick ${tick === 50 ? 'major' : ''}`} style={{ left: `${tick}%` }}>
                      <div className="sep-tick-line" />
                      {tick % 25 === 0 && <span className="sep-tick-label">{tick}%</span>}
                    </div>
                  ))}
                </div>
                <div
                  className="sep-timeline-event-marker"
                  style={{ left: '50%' }}
                  title="Event occurred here"
                />
                <input
                  type="range"
                  className="sep-timeline-slider safety-page-slider"
                  min="0"
                  max="100"
                  step="0.1"
                  value={replayState.position}
                  onChange={(e) => handleReplayChange(parseFloat(e.target.value))}
                />
              </div>
            </div>

            <div className="sep-replay-controls">
              <div className="sep-control-group">
                <button className="sep-control-btn" onClick={skipToStart} title="Jump to start">
                  <SkipBack size={16} />
                </button>
                <button className={`sep-control-btn sep-play-btn ${replayState.isPlaying ? 'playing' : ''}`} onClick={togglePlay}>
                  {replayState.isPlaying ? <Pause size={20} /> : <Play size={20} />}
                </button>
                <button className="sep-control-btn" onClick={skipToEnd} title="Jump to end">
                  <SkipForward size={16} />
                </button>
              </div>

              <button className="sep-jump-to-event" onClick={jumpToEvent}>
                <AlertTriangle size={14} />
                Jump to Event
              </button>

              <div className="sep-speed-control">
                <span>Speed</span>
                <div className="sep-speed-buttons">
                  {[0.5, 1, 2, 4].map(speed => (
                    <button
                      key={speed}
                      className={`sep-speed-btn ${replayState.speed === speed ? 'active' : ''}`}
                      onClick={() => handleSpeedChange(speed)}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
