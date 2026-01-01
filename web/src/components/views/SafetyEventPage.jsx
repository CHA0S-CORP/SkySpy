import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Map as MapIcon, Play, Pause, SkipBack, SkipForward, ArrowLeft, ExternalLink, Copy, Check } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export function SafetyEventPage({ eventId, apiBase, onClose, onSelectAircraft }) {
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
            const trackRes = await fetch(`${apiBase}/api/v1/history/sightings/${icao}?hours=2&limit=500`);
            if (trackRes.ok) {
              const trackResult = await trackRes.json();
              setTrackData(prev => ({ ...prev, [icao]: trackResult.sightings || [] }));
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
  }, [eventId, apiBase]);

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

  if (loading) {
    return (
      <div className="safety-event-page">
        <div className="safety-event-page-loading">
          <AlertTriangle size={48} className="pulse" />
          <span>Loading safety event...</span>
        </div>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="safety-event-page">
        <div className="safety-event-page-error">
          <AlertTriangle size={48} />
          <h2>{error || 'Event not found'}</h2>
          <p>The safety event could not be loaded.</p>
          <button className="back-btn" onClick={onClose}>
            <ArrowLeft size={16} /> Go Back
          </button>
        </div>
      </div>
    );
  }

  const hasSnapshot = event.aircraft_snapshot || event.aircraft_snapshot_2;
  const isExpanded = expandedSnapshots[eventId];

  return (
    <div className="safety-event-page">
      <div className="safety-event-page-header">
        <button className="back-btn" onClick={onClose}>
          <ArrowLeft size={18} /> Back
        </button>
        <h1>Safety Event Details</h1>
        <button className="copy-link-btn" onClick={copyLink} title="Copy link to this event">
          {copied ? <Check size={18} /> : <Copy size={18} />}
          {copied ? 'Copied!' : 'Copy Link'}
        </button>
      </div>

      <div className="safety-event-page-content">
        <div className={`safety-event-main-card severity-${event.severity}`}>
          <div className="safety-event-title">
            <span className={`safety-severity-badge large severity-${event.severity}`}>
              {event.severity?.toUpperCase()}
            </span>
            <span className="safety-event-type large">
              {event.event_type?.replace(/_/g, ' ').toUpperCase()}
            </span>
          </div>

          <div className="safety-event-timestamp">
            {new Date(event.timestamp).toLocaleString()}
          </div>

          <div className="safety-event-message large">{event.message}</div>

          <div className="safety-event-aircraft-row">
            <div className="aircraft-card" onClick={() => onSelectAircraft?.(event.icao)}>
              <div className="aircraft-label">Aircraft 1</div>
              <div className="aircraft-callsign">{event.callsign || event.icao}</div>
              <div className="aircraft-icao">{event.icao}</div>
            </div>
            {event.icao_2 && (
              <>
                <div className="aircraft-separator">
                  <span className="separator-icon">↔</span>
                  {event.details?.horizontal_nm && (
                    <span className="separation-info">{event.details.horizontal_nm.toFixed(1)} nm</span>
                  )}
                  {event.details?.vertical_ft && (
                    <span className="separation-info">{event.details.vertical_ft} ft vert</span>
                  )}
                </div>
                <div className="aircraft-card" onClick={() => onSelectAircraft?.(event.icao_2)}>
                  <div className="aircraft-label">Aircraft 2</div>
                  <div className="aircraft-callsign">{event.callsign_2 || event.icao_2}</div>
                  <div className="aircraft-icao">{event.icao_2}</div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Map Section */}
        <div className="safety-event-map-section">
          <h2><MapIcon size={20} /> Event Location & Replay</h2>
          <div
            className="safety-event-map large"
            ref={(el) => {
              if (el && !mapRef.current) {
                mapContainerRef.current = el;
                setTimeout(() => initializeMap(el), 100);
              }
            }}
          />

          {/* Flight data graphs */}
          <div className="flight-graphs large">
            {[event.icao, event.icao_2].filter(Boolean).map((icao, idx) => {
              const track = trackData[icao];
              if (!track || track.length < 2) return null;
              const color = idx === 0 ? '#00ff88' : '#44aaff';
              const position = replayState.position;
              return (
                <div key={icao} className="aircraft-graphs large">
                  <div className="graphs-header" style={{ color }}>
                    {event[idx === 0 ? 'callsign' : 'callsign_2'] || icao}
                  </div>
                  <div className="graphs-row">
                    {renderMiniGraph(track, 'altitude', color, 'Altitude', 'ft', null, position)}
                    {renderMiniGraph(track, 'gs', color, 'Speed', 'kts', v => v?.toFixed(0), position)}
                    {renderMiniGraph(track, 'vr', color, 'V/S', 'fpm', v => (v > 0 ? '+' : '') + v, position)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Replay controls */}
          <div className="replay-controls large">
            <div className="replay-buttons">
              <button className="replay-btn" onClick={skipToStart} title="Skip to start">
                <SkipBack size={20} />
              </button>
              <button className="replay-btn play-btn large" onClick={togglePlay} title={replayState.isPlaying ? 'Pause' : 'Play'}>
                {replayState.isPlaying ? <Pause size={24} /> : <Play size={24} />}
              </button>
              <button className="replay-btn" onClick={skipToEnd} title="Skip to end">
                <SkipForward size={20} />
              </button>
              <button className="replay-btn event-btn" onClick={jumpToEvent} title="Jump to event">
                <AlertTriangle size={18} />
              </button>
              <select
                className="speed-select large"
                value={replayState.speed}
                onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                title="Playback speed"
              >
                <option value={0.25}>0.25x</option>
                <option value={0.5}>0.5x</option>
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={4}>4x</option>
              </select>
            </div>
            <div className="replay-slider-container large">
              <input
                type="range"
                className="replay-slider"
                min="0"
                max="100"
                value={replayState.position}
                onChange={(e) => handleReplayChange(parseFloat(e.target.value))}
              />
              <div className="replay-time">{getReplayTimestamp || '--:--'}</div>
            </div>
          </div>

          <div className="safety-map-legend large">
            <div className="legend-item">
              <span className="legend-marker event-marker"></span>
              <span>Event Location</span>
            </div>
            {event.aircraft_snapshot?.lat && (
              <div className="legend-item clickable" onClick={() => onSelectAircraft?.(event.icao)}>
                <span className="legend-marker ac1-marker"></span>
                <span className="legend-callsign">{event.callsign || event.icao}</span>
              </div>
            )}
            {event.aircraft_snapshot_2?.lat && (
              <div className="legend-item clickable" onClick={() => onSelectAircraft?.(event.icao_2)}>
                <span className="legend-marker ac2-marker"></span>
                <span className="legend-callsign">{event.callsign_2 || event.icao_2}</span>
              </div>
            )}
          </div>
        </div>

        {/* Telemetry Section */}
        {hasSnapshot && (
          <div className="safety-event-telemetry-section">
            <button
              className="telemetry-toggle"
              onClick={() => setExpandedSnapshots(prev => ({ ...prev, [eventId]: !prev[eventId] }))}
            >
              {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              {isExpanded ? 'Hide' : 'Show'} Aircraft Telemetry at Event Time
            </button>

            {isExpanded && (
              <div className="snapshot-container large">
                {renderSnapshot(event.aircraft_snapshot, event.aircraft_snapshot_2 ? 'Aircraft 1' : null)}
                {renderSnapshot(event.aircraft_snapshot_2, 'Aircraft 2')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
