import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Map as MapIcon, Play, Pause, SkipBack, SkipForward, Shield, Search, MessageCircle, ExternalLink } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useApi } from '../../hooks';

const VALID_DATA_TYPES = ['sessions', 'sightings', 'acars', 'safety'];

export function HistoryView({ apiBase, onSelectAircraft, onViewEvent, targetEventId, onEventViewed, hashParams = {}, setHashParams }) {
  // Sync viewType with URL hash params
  const [viewType, setViewTypeState] = useState(() => {
    if (hashParams.data && VALID_DATA_TYPES.includes(hashParams.data)) {
      return hashParams.data;
    }
    return 'sessions';
  });

  // Wrapper to update both state and URL
  const setViewType = (type) => {
    setViewTypeState(type);
    if (setHashParams) {
      setHashParams({ data: type });
    }
  };

  // Sync with hash params changes (back/forward navigation)
  useEffect(() => {
    if (hashParams.data && VALID_DATA_TYPES.includes(hashParams.data) && hashParams.data !== viewType) {
      setViewTypeState(hashParams.data);
    }
  }, [hashParams.data]);

  const [timeRange, setTimeRange] = useState('24h');
  const [expandedSnapshots, setExpandedSnapshots] = useState({});
  const [expandedMaps, setExpandedMaps] = useState({});
  const [trackData, setTrackData] = useState({}); // Cache for flight tracks
  const [replayState, setReplayState] = useState({}); // Per-event replay state
  const [graphZoomState, setGraphZoomState] = useState({}); // Per-event graph zoom: { eventKey: { zoom: 1, offset: 0 } }
  const graphDragRef = useRef({}); // Per-event drag state
  const mapRefs = useRef({}); // Store Leaflet map instances
  const replayMarkersRef = useRef({}); // Store replay markers
  const replayTracksRef = useRef({}); // Store animated track polylines
  const animationFrameRef = useRef({}); // Animation frame IDs
  const eventRefs = useRef({}); // Refs for scrolling to specific events

  // Session filters
  const [sessionSearch, setSessionSearch] = useState('');
  const [showMilitaryOnly, setShowMilitaryOnly] = useState(false);
  const [sortField, setSortField] = useState('last_seen');
  const [sortAsc, setSortAsc] = useState(false);

  // ACARS filters
  const [acarsSearch, setAcarsSearch] = useState('');
  const [acarsSource, setAcarsSource] = useState('all');
  const [acarsHideEmpty, setAcarsHideEmpty] = useState(true);
  const [acarsMessages, setAcarsMessages] = useState([]);
  const [acarsSelectedLabels, setAcarsSelectedLabels] = useState([]);
  const [showLabelDropdown, setShowLabelDropdown] = useState(false);
  const labelDropdownRef = useRef(null);

  // ACARS message label descriptions
  const acarsLabelDescriptions = {
    // Common operational labels
    '_d': 'Command/Response',
    'H1': 'Departure Message',
    'H2': 'Arrival Message',
    '5Z': 'Airline Designated',
    '80': 'Terminal Weather',
    '81': 'Terminal Weather',
    '83': 'Request Terminal Weather',
    'B1': 'Request Departure Clearance',
    'B2': 'Departure Clearance',
    'B3': 'Request Oceanic Clearance',
    'B4': 'Oceanic Clearance',
    'B5': 'Departure Slot',
    'B6': 'Expected Departure Clearance',
    'BA': 'Beacon Request',
    'C1': 'Position Report',
    'CA': 'CPDLC',
    'Q0': 'Link Test',
    'Q1': 'Link Test',
    'Q2': 'Link Test',
    'QA': 'ACARS Test',
    'SA': 'System Report',
    'SQ': 'Squawk Report',
    // OOOI Messages
    '10': 'OUT - Leaving Gate',
    '11': 'OFF - Takeoff',
    '12': 'ON - Landing',
    '13': 'IN - Arrived Gate',
    '14': 'ETA Report',
    '15': 'Flight Status',
    '16': 'Route Change',
    '17': 'Fuel Report',
    '20': 'Delay Report',
    '21': 'Delay Report',
    '22': 'Ground Delay',
    '23': 'Estimated Gate Arrival',
    '24': 'Crew Report',
    '25': 'Passenger Count',
    '26': 'Connecting Passengers',
    '27': 'Load Report',
    '28': 'Weight & Balance',
    '29': 'Cargo/Mail',
    '2Z': 'Progress Report',
    // Weather
    '30': 'Request Weather',
    '31': 'METAR',
    '32': 'TAF',
    '33': 'ATIS',
    '34': 'PIREP',
    '35': 'Wind Data',
    '36': 'SIGMET',
    '37': 'NOTAM',
    '38': 'Turbulence Report',
    '39': 'Weather Update',
    '3M': 'METAR Request',
    '3S': 'SIGMET Request',
    // Flight planning
    '40': 'Flight Plan',
    '41': 'Flight Plan Amendment',
    '42': 'Route Request',
    '43': 'Oceanic Report',
    '44': 'Position Report',
    '45': 'Flight Level Change',
    '46': 'Speed Change',
    '47': 'Waypoint Report',
    '48': 'ETA Update',
    '49': 'Fuel Status',
    '4A': 'Company Specific',
    '4M': 'Company Specific',
    // Maintenance
    '50': 'Maintenance Message',
    '51': 'Engine Report',
    '52': 'APU Report',
    '53': 'Fault Report',
    '54': 'System Status',
    '55': 'Configuration',
    '56': 'Performance Data',
    '57': 'Trend Data',
    '58': 'Oil Status',
    '59': 'Exceedance Report',
    '5A': 'Technical Log',
    '5U': 'Airline Specific',
    // Free text
    'AA': 'Free Text',
    'AB': 'Free Text Reply',
    'F3': 'Free Text',
    'F5': 'Free Text',
    'F7': 'Departure Info',
    'FA': 'Free Text',
    'FF': 'Free Text',
    // ADS-C
    'AD': 'ADS-C Report',
    'AE': 'ADS-C Emergency',
    'AF': 'ADS-C Contract',
    // FANS/CPDLC
    'A0': 'FANS Application',
    'A1': 'CPDLC Connect',
    'A2': 'CPDLC Disconnect',
    'A3': 'CPDLC Uplink',
    'A4': 'CPDLC Downlink',
    'A5': 'CPDLC Cancel',
    'A6': 'CPDLC Status',
    'A7': 'CPDLC Error',
    'CR': 'CPDLC Request',
    'CC': 'CPDLC Communication',
    // Data link
    'D1': 'Data Link',
    'D2': 'Data Link',
    // Miscellaneous
    'RA': 'ACARS Uplink',
    'RF': 'Radio Frequency',
    'MA': 'Media Advisory',
    '00': 'Heartbeat',
    '7A': 'Telex',
    '8A': 'Company Specific',
    '8D': 'Telex Delivery',
    '8E': 'Telex Error',
  };

  // Get human-readable label description
  const getAcarsLabelDescription = (label) => {
    if (!label) return null;
    return acarsLabelDescriptions[label.toUpperCase()] || acarsLabelDescriptions[label] || null;
  };

  // Toggle snapshot expansion
  const toggleSnapshot = (eventId) => {
    setExpandedSnapshots(prev => ({
      ...prev,
      [eventId]: !prev[eventId]
    }));
  };

  // Toggle map expansion
  const toggleMap = useCallback(async (eventKey, event) => {
    const isOpening = !expandedMaps[eventKey];

    setExpandedMaps(prev => ({
      ...prev,
      [eventKey]: !prev[eventKey]
    }));

    // If opening, fetch track data for involved aircraft
    if (isOpening && event) {
      const icaos = [event.icao, event.icao_2].filter(Boolean);

      for (const icao of icaos) {
        if (!trackData[icao]) {
          try {
            const res = await fetch(`${apiBase}/api/v1/history/sightings/${icao}?hours=2&limit=500`);
            if (res.ok) {
              const data = await res.json();
              setTrackData(prev => ({ ...prev, [icao]: data.sightings || [] }));
            }
          } catch (err) {
            console.error('Failed to fetch track data:', err);
          }
        }
      }

      // Initialize replay state for this event
      setReplayState(prev => ({
        ...prev,
        [eventKey]: { position: 100, isPlaying: false, speed: 1 } // Start at most recent (100%)
      }));
    }
  }, [expandedMaps, trackData, apiBase]);

  // Get interpolated position along a track
  const getInterpolatedPosition = (track, percentage) => {
    if (!track || track.length === 0) return null;
    if (track.length === 1) return { ...track[0], index: 0 };

    // Track is newest first, so reverse for timeline order
    const ordered = [...track].reverse();
    const index = Math.floor((percentage / 100) * (ordered.length - 1));
    const clampedIndex = Math.max(0, Math.min(index, ordered.length - 1));
    return { ...ordered[clampedIndex], index: clampedIndex };
  };

  // Update replay markers and track lines when position changes
  const updateReplayMarkers = useCallback((eventKey, event, position) => {
    const map = mapRefs.current[eventKey];
    if (!map) return;

    const icaos = [event.icao, event.icao_2].filter(Boolean);
    const colors = ['#00ff88', '#44aaff'];

    icaos.forEach((icao, i) => {
      const track = trackData[icao];
      if (!track || track.length === 0) return;

      const pos = getInterpolatedPosition(track, position);
      if (!pos || !pos.lat || !pos.lon) return;

      const markerId = `${eventKey}_${icao}`;
      const trackId = `${eventKey}_track_${icao}`;

      // Remove existing marker
      if (replayMarkersRef.current[markerId]) {
        map.removeLayer(replayMarkersRef.current[markerId]);
      }

      // Update track polyline - show only the portion up to current position
      // Track is newest first, reverse for timeline order (oldest to newest)
      const ordered = [...track].reverse().filter(p => p.lat && p.lon);
      if (ordered.length > 1) {
        // Calculate how many points to show based on position percentage
        const endIndex = Math.floor((position / 100) * (ordered.length - 1));
        const visibleTrack = ordered.slice(0, endIndex + 1);

        // Remove existing animated track
        if (replayTracksRef.current[trackId]) {
          map.removeLayer(replayTracksRef.current[trackId]);
        }

        // Create new track polyline up to current position
        if (visibleTrack.length > 1) {
          const coords = visibleTrack.map(p => [p.lat, p.lon]);
          const polyline = L.polyline(coords, {
            color: colors[i],
            weight: 3,
            opacity: 0.8
          }).addTo(map);
          replayTracksRef.current[trackId] = polyline;
        }
      }

      // Create new marker at interpolated position
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
  }, [trackData]);

  // Handle replay slider change
  const handleReplayChange = useCallback((eventKey, event, newPosition) => {
    setReplayState(prev => ({
      ...prev,
      [eventKey]: { ...prev[eventKey], position: newPosition }
    }));
    updateReplayMarkers(eventKey, event, newPosition);
  }, [updateReplayMarkers]);

  // Toggle play/pause
  const togglePlay = useCallback((eventKey, event) => {
    const state = replayState[eventKey];
    if (!state) return;

    const newPlaying = !state.isPlaying;
    setReplayState(prev => ({
      ...prev,
      [eventKey]: { ...prev[eventKey], isPlaying: newPlaying }
    }));

    if (newPlaying) {
      // Start animation with time-based speed control
      let pos = state.position <= 0 ? 0 : state.position;
      let lastTime = performance.now();

      const animate = (currentTime) => {
        // Get current speed from state (may have changed during playback)
        const currentState = replayState[eventKey];
        const speed = currentState?.speed || 1;

        const deltaTime = currentTime - lastTime;
        lastTime = currentTime;

        // Base speed: 100% in ~20 seconds at 1x, adjusted by speed
        const increment = (deltaTime / 200) * speed;
        pos += increment;

        if (pos >= 100) {
          pos = 100;
          setReplayState(prev => ({
            ...prev,
            [eventKey]: { ...prev[eventKey], position: 100, isPlaying: false }
          }));
          updateReplayMarkers(eventKey, event, 100);
          return;
        }
        setReplayState(prev => ({
          ...prev,
          [eventKey]: { ...prev[eventKey], position: pos }
        }));
        updateReplayMarkers(eventKey, event, pos);
        animationFrameRef.current[eventKey] = requestAnimationFrame(animate);
      };
      animationFrameRef.current[eventKey] = requestAnimationFrame(animate);
    } else {
      // Stop animation
      if (animationFrameRef.current[eventKey]) {
        cancelAnimationFrame(animationFrameRef.current[eventKey]);
      }
    }
  }, [replayState, updateReplayMarkers]);

  // Skip to start/end
  const skipToStart = useCallback((eventKey, event) => {
    if (animationFrameRef.current[eventKey]) {
      cancelAnimationFrame(animationFrameRef.current[eventKey]);
    }
    setReplayState(prev => ({
      ...prev,
      [eventKey]: { ...prev[eventKey], position: 0, isPlaying: false }
    }));
    updateReplayMarkers(eventKey, event, 0);
  }, [updateReplayMarkers]);

  const skipToEnd = useCallback((eventKey, event) => {
    if (animationFrameRef.current[eventKey]) {
      cancelAnimationFrame(animationFrameRef.current[eventKey]);
    }
    setReplayState(prev => ({
      ...prev,
      [eventKey]: { ...prev[eventKey], position: 100, isPlaying: false }
    }));
    updateReplayMarkers(eventKey, event, 100);
  }, [updateReplayMarkers]);

  // Handle speed change
  const handleSpeedChange = useCallback((eventKey, newSpeed) => {
    setReplayState(prev => ({
      ...prev,
      [eventKey]: { ...prev[eventKey], speed: newSpeed }
    }));
  }, []);

  // Graph zoom/scroll handlers (per-event)
  const handleGraphWheel = useCallback((eventKey, e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.25 : 0.25;
    setGraphZoomState(prev => {
      const current = prev[eventKey] || { zoom: 1, offset: 0 };
      const newZoom = Math.max(1, Math.min(8, current.zoom + delta));
      let newOffset = current.offset;
      // Adjust offset when zooming out to keep in valid range
      if (newZoom < current.zoom) {
        const maxOffset = Math.max(0, 100 - (100 / newZoom));
        newOffset = Math.min(current.offset, maxOffset);
      }
      return { ...prev, [eventKey]: { zoom: newZoom, offset: newOffset } };
    });
  }, []);

  const handleGraphDragStart = useCallback((eventKey, e) => {
    const current = graphZoomState[eventKey] || { zoom: 1, offset: 0 };
    if (current.zoom <= 1) return;
    graphDragRef.current[eventKey] = {
      isDragging: true,
      startX: e.clientX || e.touches?.[0]?.clientX || 0,
      startOffset: current.offset
    };
  }, [graphZoomState]);

  const handleGraphDragMove = useCallback((eventKey, e) => {
    const drag = graphDragRef.current[eventKey];
    if (!drag?.isDragging) return;
    const current = graphZoomState[eventKey] || { zoom: 1, offset: 0 };
    const currentX = e.clientX || e.touches?.[0]?.clientX || 0;
    const deltaX = drag.startX - currentX;
    const graphWidth = 200;
    const visiblePercent = 100 / current.zoom;
    const maxOffset = 100 - visiblePercent;
    const percentDelta = (deltaX / graphWidth) * visiblePercent;
    const newOffset = Math.max(0, Math.min(maxOffset, drag.startOffset + percentDelta));
    setGraphZoomState(prev => ({
      ...prev,
      [eventKey]: { ...prev[eventKey], offset: newOffset }
    }));
  }, [graphZoomState]);

  const handleGraphDragEnd = useCallback((eventKey) => {
    if (graphDragRef.current[eventKey]) {
      graphDragRef.current[eventKey].isDragging = false;
    }
  }, []);

  const resetGraphZoom = useCallback((eventKey) => {
    setGraphZoomState(prev => ({
      ...prev,
      [eventKey]: { zoom: 1, offset: 0 }
    }));
  }, []);

  // Jump to event position (50% where event occurred)
  const jumpToEvent = useCallback((eventKey, event) => {
    if (animationFrameRef.current[eventKey]) {
      cancelAnimationFrame(animationFrameRef.current[eventKey]);
    }
    const current = replayState[eventKey] || { speed: 1 };
    setReplayState(prev => ({
      ...prev,
      [eventKey]: { position: 50, isPlaying: false, speed: current.speed }
    }));
    updateReplayMarkers(eventKey, event, 50);
  }, [replayState, updateReplayMarkers]);

  // Render mini graph with optional position indicator and zoom/scroll support
  const renderMiniGraph = (track, dataKey, color, label, unit, formatFn, positionPercent = null, eventKey = null) => {
    if (!track || track.length < 2) return null;

    // Reverse so oldest is first (left to right timeline)
    const ordered = [...track].reverse();
    const values = ordered.map(p => p[dataKey]).filter(v => v != null);
    if (values.length < 2) return null;

    const format = formatFn || (v => v?.toLocaleString());
    const width = 200;
    const height = 40;
    const padding = 2;

    // Get zoom state for this event
    const zoomState = eventKey ? (graphZoomState[eventKey] || { zoom: 1, offset: 0 }) : { zoom: 1, offset: 0 };
    const { zoom, offset } = zoomState;
    const isZoomed = zoom > 1;

    // Full range for consistent Y scaling
    const fullMin = Math.min(...values);
    const fullMax = Math.max(...values);
    const fullRange = fullMax - fullMin || 1;

    let visibleValues, visibleMin, visibleMax, startPercent, endPercent;

    if (isZoomed) {
      // Calculate visible window based on zoom and offset
      const visiblePercent = 100 / zoom;
      startPercent = offset;
      endPercent = offset + visiblePercent;

      // Get visible portion of data
      const startIdx = Math.floor((startPercent / 100) * (values.length - 1));
      const endIdx = Math.ceil((endPercent / 100) * (values.length - 1));
      visibleValues = values.slice(startIdx, endIdx + 1);
      visibleMin = visibleValues.length > 0 ? Math.min(...visibleValues) : fullMin;
      visibleMax = visibleValues.length > 0 ? Math.max(...visibleValues) : fullMax;
    } else {
      // Not zoomed - use all values
      startPercent = 0;
      endPercent = 100;
      visibleValues = values;
      visibleMin = fullMin;
      visibleMax = fullMax;
    }

    // Create SVG path - map to full width
    const points = visibleValues.map((v, i) => {
      const x = padding + (i / Math.max(1, visibleValues.length - 1)) * (width - padding * 2);
      const y = height - padding - ((v - fullMin) / fullRange) * (height - padding * 2);
      return `${x},${y}`;
    }).join(' ');

    // Get current value at position (always from full dataset)
    let currentValue = null;
    if (positionPercent !== null && values.length > 0) {
      const idx = Math.floor((positionPercent / 100) * (values.length - 1));
      const clampedIdx = Math.max(0, Math.min(idx, values.length - 1));
      currentValue = values[clampedIdx];
    }

    // Calculate position indicator (only if position is within visible window)
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

    // Graph container props for zoom/scroll
    const graphProps = eventKey ? {
      className: `mini-graph${isZoomed ? ' zoomable' : ''}`,
      onWheel: (e) => handleGraphWheel(eventKey, e),
      onMouseDown: (e) => handleGraphDragStart(eventKey, e),
      onMouseMove: (e) => handleGraphDragMove(eventKey, e),
      onMouseUp: () => handleGraphDragEnd(eventKey),
      onMouseLeave: () => handleGraphDragEnd(eventKey),
      onTouchStart: (e) => handleGraphDragStart(eventKey, e),
      onTouchMove: (e) => handleGraphDragMove(eventKey, e),
      onTouchEnd: () => handleGraphDragEnd(eventKey),
    } : { className: 'mini-graph' };

    return (
      <div {...graphProps}>
        <div className="mini-graph-header">
          <span className="mini-graph-label">{label}</span>
          {isZoomed && (
            <span className="mini-graph-zoom" onClick={() => resetGraphZoom(eventKey)}>
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
            strokeWidth="1.5"
            opacity="0.6"
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
                  r="4"
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
  };

  // Initialize map when expanded
  const initializeMap = useCallback((eventKey, event, containerRef) => {
    if (!containerRef || mapRefs.current[eventKey]) return;

    const snapshot1 = event.aircraft_snapshot;
    const snapshot2 = event.aircraft_snapshot_2;

    // Determine center point - use event location from details if available
    let eventLat, eventLon;

    // Try to get exact event location from details
    if (event.details?.lat && event.details?.lon) {
      eventLat = event.details.lat;
      eventLon = event.details.lon;
    } else if (snapshot1?.lat && snapshot1?.lon && snapshot2?.lat && snapshot2?.lon) {
      // Midpoint between two aircraft
      eventLat = (snapshot1.lat + snapshot2.lat) / 2;
      eventLon = (snapshot1.lon + snapshot2.lon) / 2;
    } else if (snapshot1?.lat && snapshot1?.lon) {
      eventLat = snapshot1.lat;
      eventLon = snapshot1.lon;
    } else if (snapshot2?.lat && snapshot2?.lon) {
      eventLat = snapshot2.lat;
      eventLon = snapshot2.lon;
    } else {
      return; // No valid coordinates
    }

    const map = L.map(containerRef, {
      center: [eventLat, eventLon],
      zoom: 10,
      zoomControl: false,
      attributionControl: false
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(map);

    // Add event location marker with pulsing effect using divIcon
    const eventIcon = L.divIcon({
      className: 'event-location-marker',
      html: `
        <div class="event-marker-pulse-ring"></div>
        <div class="event-marker-core"></div>
      `,
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    const eventMarker = L.marker([eventLat, eventLon], { icon: eventIcon }).addTo(map);
    eventMarker.bindPopup(`<b>Event Location</b><br>${event.event_type?.replace(/_/g, ' ')}<br>${new Date(event.timestamp).toLocaleString()}`);

    // Add faint background track lines (full path for context)
    const icaos = [event.icao, event.icao_2].filter(Boolean);
    const colors = ['#00ff88', '#44aaff'];

    icaos.forEach((icao, i) => {
      const track = trackData[icao];
      if (track?.length > 1) {
        const coords = [...track].reverse()
          .filter(p => p.lat && p.lon)
          .map(p => [p.lat, p.lon]);
        if (coords.length > 1) {
          // Add full track as faint dotted line (background/future path)
          L.polyline(coords, {
            color: colors[i],
            weight: 1,
            opacity: 0.25,
            dashArray: '4, 6'
          }).addTo(map);
        }
      }
    });

    // Add initial aircraft markers at current replay position
    const state = replayState[eventKey];
    if (state) {
      updateReplayMarkers(eventKey, event, state.position);
    }

    // Fit bounds if we have two aircraft
    if (snapshot1?.lat && snapshot2?.lat) {
      const bounds = L.latLngBounds([
        [snapshot1.lat, snapshot1.lon],
        [snapshot2.lat, snapshot2.lon]
      ]);
      map.fitBounds(bounds.pad(0.3));
    }

    mapRefs.current[eventKey] = map;
  }, [trackData, replayState, updateReplayMarkers]);

  // Create aircraft icon
  const createAircraftIcon = (track, color) => {
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
  };

  // Get timestamp for replay position
  const getReplayTimestamp = (eventKey, event) => {
    const state = replayState[eventKey];
    if (!state) return null;

    const icao = event.icao || event.icao_2;
    const track = trackData[icao];
    if (!track || track.length === 0) return null;

    const pos = getInterpolatedPosition(track, state.position);
    if (!pos?.timestamp) return null;

    return new Date(pos.timestamp).toLocaleTimeString();
  };

  // Cleanup maps on unmount or when closing
  useEffect(() => {
    return () => {
      Object.values(mapRefs.current).forEach(map => {
        if (map) map.remove();
      });
      Object.values(animationFrameRef.current).forEach(id => {
        cancelAnimationFrame(id);
      });
      mapRefs.current = {};
      replayMarkersRef.current = {};
      replayTracksRef.current = {};
    };
  }, []);

  // Cleanup individual map when collapsed
  useEffect(() => {
    Object.keys(mapRefs.current).forEach(key => {
      if (!expandedMaps[key] && mapRefs.current[key]) {
        mapRefs.current[key].remove();
        delete mapRefs.current[key];
        // Clean up replay markers for this map
        Object.keys(replayMarkersRef.current).forEach(mKey => {
          if (mKey.startsWith(key)) {
            delete replayMarkersRef.current[mKey];
          }
        });
        // Clean up replay tracks for this map
        Object.keys(replayTracksRef.current).forEach(tKey => {
          if (tKey.startsWith(key)) {
            delete replayTracksRef.current[tKey];
          }
        });
        // Stop animation
        if (animationFrameRef.current[key]) {
          cancelAnimationFrame(animationFrameRef.current[key]);
          delete animationFrameRef.current[key];
        }
      }
    });
  }, [expandedMaps]);

  const hours = { '1h': 1, '6h': 6, '24h': 24, '48h': 48, '7d': 168 };
  const endpoint = viewType === 'sessions'
    ? `/api/v1/history/sessions?hours=${hours[timeRange]}`
    : viewType === 'sightings'
    ? `/api/v1/history/sightings?hours=${hours[timeRange]}&limit=100`
    : viewType === 'acars'
    ? `/api/v1/acars/messages?hours=${hours[timeRange]}&limit=200`
    : `/api/v1/safety/events?hours=${hours[timeRange]}&limit=100`;

  const { data, refetch } = useApi(endpoint, null, apiBase);

  useEffect(() => { refetch(); }, [timeRange, viewType, refetch]);

  // Fetch ACARS messages when viewing ACARS tab
  useEffect(() => {
    if (viewType !== 'acars') return;

    const fetchAcars = async () => {
      try {
        const sourceParam = acarsSource !== 'all' ? `&source=${acarsSource}` : '';
        const res = await fetch(`${apiBase}/api/v1/acars/messages?hours=${hours[timeRange]}&limit=200${sourceParam}`);
        if (res.ok) {
          const result = await res.json();
          setAcarsMessages(result.messages || []);
        }
      } catch (err) {
        console.log('ACARS fetch error:', err.message);
      }
    };
    fetchAcars();
  }, [viewType, timeRange, acarsSource, apiBase]);

  // Close label dropdown when clicking outside
  useEffect(() => {
    if (!showLabelDropdown) return;

    const handleClickOutside = (e) => {
      if (labelDropdownRef.current && !labelDropdownRef.current.contains(e.target)) {
        setShowLabelDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showLabelDropdown]);

  // Get available labels from ACARS messages for the filter dropdown
  const availableLabels = useMemo(() => {
    if (!acarsMessages.length) return [];

    const labelCounts = {};
    acarsMessages.forEach(msg => {
      if (msg.label) {
        const label = msg.label.toUpperCase();
        labelCounts[label] = (labelCounts[label] || 0) + 1;
      }
    });

    return Object.entries(labelCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({
        label,
        count,
        description: getAcarsLabelDescription(label)
      }));
  }, [acarsMessages]);

  // Filter ACARS messages
  const filteredAcarsMessages = useMemo(() => {
    if (!acarsMessages.length) return [];

    let filtered = acarsMessages;

    // Filter out empty messages if hideEmpty is enabled
    if (acarsHideEmpty) {
      filtered = filtered.filter(msg => msg.text && msg.text.trim().length > 0);
    }

    // Apply label filter
    if (acarsSelectedLabels.length > 0) {
      filtered = filtered.filter(msg =>
        msg.label && acarsSelectedLabels.includes(msg.label.toUpperCase())
      );
    }

    // Apply search filter
    if (acarsSearch) {
      const search = acarsSearch.toLowerCase();
      filtered = filtered.filter(msg =>
        msg.icao_hex?.toLowerCase().includes(search) ||
        msg.callsign?.toLowerCase().includes(search) ||
        msg.text?.toLowerCase().includes(search) ||
        msg.label?.toLowerCase().includes(search)
      );
    }

    return filtered;
  }, [acarsMessages, acarsSearch, acarsHideEmpty, acarsSelectedLabels]);

  // Handle navigation to a specific safety event (from aircraft detail page)
  useEffect(() => {
    if (!targetEventId || !data?.events) return;

    // Switch to safety view
    setViewType('safety');

    // Find the event in our data
    const eventIndex = data.events.findIndex(e => e.id === targetEventId || e.id === String(targetEventId));
    if (eventIndex === -1) return;

    const event = data.events[eventIndex];
    const eventKey = event.id || eventIndex;

    // Auto-expand the map for this event
    if (!expandedMaps[eventKey]) {
      toggleMap(eventKey, event);
    }

    // Scroll to the event after a short delay to allow render
    setTimeout(() => {
      const eventEl = eventRefs.current[eventKey];
      if (eventEl) {
        eventEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Add a highlight effect
        eventEl.classList.add('highlight-event');
        setTimeout(() => eventEl.classList.remove('highlight-event'), 2000);
      }
    }, 100);

    // Clear the target after handling
    onEventViewed?.();
  }, [targetEventId, data?.events, expandedMaps, toggleMap, onEventViewed]);

  // Render aircraft snapshot data
  const renderSnapshot = (snapshot, label) => {
    if (!snapshot) return null;
    return (
      <div className="snapshot-section">
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
          {snapshot.emergency && <div className="snapshot-item"><span>Emergency</span><span>{snapshot.emergency}</span></div>}
        </div>
      </div>
    );
  };

  // Filter and sort sessions
  const filteredSessions = useMemo(() => {
    if (!data?.sessions) return [];

    let filtered = [...data.sessions];

    // Search filter
    if (sessionSearch) {
      const search = sessionSearch.toLowerCase();
      filtered = filtered.filter(s =>
        s.icao_hex?.toLowerCase().includes(search) ||
        s.callsign?.toLowerCase().includes(search) ||
        s.type?.toLowerCase().includes(search)
      );
    }

    // Military filter
    if (showMilitaryOnly) {
      filtered = filtered.filter(s => s.is_military);
    }

    // Sort
    filtered.sort((a, b) => {
      let aVal, bVal;
      switch (sortField) {
        case 'last_seen':
          aVal = new Date(a.last_seen).getTime();
          bVal = new Date(b.last_seen).getTime();
          break;
        case 'duration':
          aVal = a.duration_min || 0;
          bVal = b.duration_min || 0;
          break;
        case 'distance':
          aVal = a.min_distance_nm ?? 999999;
          bVal = b.min_distance_nm ?? 999999;
          break;
        case 'altitude':
          aVal = a.max_alt ?? 0;
          bVal = b.max_alt ?? 0;
          break;
        case 'rssi':
          aVal = a.max_rssi ?? -999;
          bVal = b.max_rssi ?? -999;
          break;
        default:
          aVal = a[sortField] ?? '';
          bVal = b[sortField] ?? '';
      }
      if (typeof aVal === 'string') {
        return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortAsc ? aVal - bVal : bVal - aVal;
    });

    return filtered;
  }, [data?.sessions, sessionSearch, showMilitaryOnly, sortField, sortAsc]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(field === 'distance'); // Distance sorts ascending by default (closest first)
    }
  };

  return (
    <div className="history-container">
      <div className="history-toolbar">
        <div className="view-toggle">
          <button className={`time-btn ${viewType === 'sessions' ? 'active' : ''}`} onClick={() => setViewType('sessions')}>
            Sessions
          </button>
          <button className={`time-btn ${viewType === 'sightings' ? 'active' : ''}`} onClick={() => setViewType('sightings')}>
            Sightings
          </button>
          <button className={`time-btn ${viewType === 'acars' ? 'active' : ''}`} onClick={() => setViewType('acars')}>
            <MessageCircle size={14} style={{ marginRight: 4 }} />
            ACARS
          </button>
          <button className={`time-btn ${viewType === 'safety' ? 'active' : ''}`} onClick={() => setViewType('safety')}>
            <AlertTriangle size={14} style={{ marginRight: 4 }} />
            Safety Events
          </button>
        </div>

        <div className="time-range-selector">
          {['1h', '6h', '24h', '48h', '7d'].map(range => (
            <button
              key={range}
              className={`time-btn ${timeRange === range ? 'active' : ''}`}
              onClick={() => setTimeRange(range)}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {viewType === 'sessions' && (
        <>
          <div className="sessions-filters">
            <div className="search-box">
              <Search size={16} />
              <input
                type="text"
                placeholder="Search ICAO, callsign, type..."
                value={sessionSearch}
                onChange={(e) => setSessionSearch(e.target.value)}
              />
            </div>
            <button
              className={`filter-btn ${showMilitaryOnly ? 'active' : ''}`}
              onClick={() => setShowMilitaryOnly(!showMilitaryOnly)}
            >
              <Shield size={16} />
              Military
            </button>
            <div className="sort-controls">
              <span className="sort-label">Sort:</span>
              <button className={`sort-btn ${sortField === 'last_seen' ? 'active' : ''}`} onClick={() => handleSort('last_seen')}>
                Time {sortField === 'last_seen' && (sortAsc ? '↑' : '↓')}
              </button>
              <button className={`sort-btn ${sortField === 'distance' ? 'active' : ''}`} onClick={() => handleSort('distance')}>
                Distance {sortField === 'distance' && (sortAsc ? '↑' : '↓')}
              </button>
              <button className={`sort-btn ${sortField === 'duration' ? 'active' : ''}`} onClick={() => handleSort('duration')}>
                Duration {sortField === 'duration' && (sortAsc ? '↑' : '↓')}
              </button>
              <button className={`sort-btn ${sortField === 'rssi' ? 'active' : ''}`} onClick={() => handleSort('rssi')}>
                Signal {sortField === 'rssi' && (sortAsc ? '↑' : '↓')}
              </button>
            </div>
            <div className="sessions-count">
              {filteredSessions.length} of {data?.sessions?.length || 0} sessions
            </div>
          </div>
          <div className="sessions-grid">
            {filteredSessions.map((session, i) => {
              // Determine category color based on aircraft type
              const getTypeCategory = (type) => {
                if (!type) return 'unknown';
                const t = type.toUpperCase();
                if (['A388', 'A380', 'B748', 'B744', 'A346', 'A345', 'A343', 'A342', 'B77W', 'B77L', 'B789', 'B78X'].includes(t)) return 'heavy';
                if (['A320', 'A321', 'A319', 'A318', 'B737', 'B738', 'B739', 'B38M', 'B39M', 'E190', 'E195', 'E170', 'E175'].includes(t)) return 'medium';
                if (['C172', 'C182', 'C208', 'PA28', 'PA32', 'SR22', 'DA40', 'DA42', 'BE36', 'M20P'].includes(t)) return 'light';
                if (['R22', 'R44', 'EC35', 'EC45', 'AS50', 'B06', 'B407', 'S76', 'A109', 'H145', 'H160'].includes(t)) return 'helicopter';
                if (['F16', 'F15', 'F18', 'F22', 'F35', 'B1', 'B2', 'B52', 'C17', 'C130', 'C5', 'KC10', 'KC135', 'E3', 'E8'].includes(t)) return 'military-type';
                return 'airliner';
              };
              const typeCategory = getTypeCategory(session.type);

              return (
                <div
                  key={i}
                  className={`session-card ${session.is_military ? 'military' : ''} ${session.safety_event_count > 0 ? 'has-safety-events' : ''} type-${typeCategory}`}
                  onClick={() => onSelectAircraft?.(session.icao_hex)}
                >
                  <div className="session-header">
                    <div className="session-identity">
                      <div className="session-callsign">
                        {session.callsign || session.icao_hex}
                        {session.is_military && <span className="military-badge">MIL</span>}
                        {session.safety_event_count > 0 && (
                          <span className="safety-badge" title={`${session.safety_event_count} safety event${session.safety_event_count > 1 ? 's' : ''}`}>
                            <AlertTriangle size={14} />
                            {session.safety_event_count}
                          </span>
                        )}
                      </div>
                      <div className="session-icao-row">
                        <span
                          className="icao-link"
                          onClick={(e) => { e.stopPropagation(); onSelectAircraft?.(session.icao_hex); }}
                        >
                          {session.icao_hex}
                        </span>
                        {session.type && <span className={`session-type type-${typeCategory}`}>{session.type}</span>}
                        {session.registration && <span className="session-reg">{session.registration}</span>}
                      </div>
                    </div>
                    <div className="session-duration-badge">
                      <span className="duration-value">{Math.round(session.duration_min || 0)}</span>
                      <span className="duration-unit">min</span>
                    </div>
                  </div>

                  <div className="session-visual-stats">
                    <div className="session-altitude-bar">
                      <div className="altitude-bar-label">Altitude</div>
                      <div className="altitude-bar-container">
                        <div
                          className="altitude-bar-fill"
                          style={{ width: `${Math.min(100, ((session.max_alt || 0) / 45000) * 100)}%` }}
                        />
                        <span className="altitude-bar-value">
                          {session.max_alt != null ? `${(session.max_alt / 1000).toFixed(0)}k ft` : '--'}
                        </span>
                      </div>
                    </div>
                    <div className="session-signal-indicator">
                      <div className="signal-label">Signal</div>
                      <div className={`signal-bars ${session.max_rssi >= -3 ? 'excellent' : session.max_rssi >= -10 ? 'good' : session.max_rssi >= -20 ? 'fair' : 'weak'}`}>
                        <span className="bar bar-1"></span>
                        <span className="bar bar-2"></span>
                        <span className="bar bar-3"></span>
                        <span className="bar bar-4"></span>
                      </div>
                      <span className="signal-value">{session.max_rssi?.toFixed(0) || '--'} dB</span>
                    </div>
                  </div>

                  <div className="session-stats">
                    <div className="session-stat">
                      <span className="session-stat-label">Distance</span>
                      <span className="session-stat-value">
                        {session.min_distance_nm != null ? `${session.min_distance_nm.toFixed(1)}` : '--'}
                        {session.max_distance_nm != null ? ` - ${session.max_distance_nm.toFixed(1)}` : ''} nm
                      </span>
                    </div>
                    <div className="session-stat">
                      <span className="session-stat-label">Max V/S</span>
                      <span className={`session-stat-value ${session.max_vr > 0 ? 'climbing' : session.max_vr < 0 ? 'descending' : ''}`}>
                        {session.max_vr != null ? `${session.max_vr > 0 ? '+' : ''}${session.max_vr}` : '--'} fpm
                      </span>
                    </div>
                    <div className="session-stat">
                      <span className="session-stat-label">Messages</span>
                      <span className="session-stat-value">{session.message_count?.toLocaleString() || '--'}</span>
                    </div>
                    <div className="session-stat">
                      <span className="session-stat-label">Squawks</span>
                      <span className={`session-stat-value ${session.squawk === '7500' || session.squawk === '7600' || session.squawk === '7700' ? 'emergency-squawk' : ''}`}>
                        {session.squawk || '--'}
                      </span>
                    </div>
                  </div>

                  <div className="session-times">
                    <span className="session-time">
                      <span className="time-label">First:</span> {new Date(session.first_seen).toLocaleTimeString()}
                    </span>
                    <span className="session-time">
                      <span className="time-label">Last:</span> {new Date(session.last_seen).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {viewType === 'sightings' && (
        <div className="sightings-table-wrapper">
          <table className="sightings-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>ICAO</th>
                <th>Callsign</th>
                <th>Altitude</th>
                <th>Speed</th>
                <th>Distance</th>
                <th>Signal</th>
              </tr>
            </thead>
            <tbody>
              {data?.sightings?.map((s, i) => (
                <tr key={i}>
                  <td>{new Date(s.timestamp).toLocaleTimeString()}</td>
                  <td className="mono">
                    <span
                      className="icao-link"
                      onClick={() => onSelectAircraft?.(s.icao_hex)}
                    >
                      {s.icao_hex}
                    </span>
                  </td>
                  <td>{s.callsign || '--'}</td>
                  <td className="mono">{s.altitude?.toLocaleString() || '--'}</td>
                  <td className="mono">{s.gs?.toFixed(0) || '--'}</td>
                  <td className="mono">{s.distance_nm?.toFixed(1) || '--'}</td>
                  <td className="mono">{s.rssi != null ? `${s.rssi.toFixed(1)} dB` : '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewType === 'safety' && (
        <div className="safety-events-grid">
          {data?.events?.length === 0 && (
            <div className="no-events-message">No safety events in the selected time range</div>
          )}
          {data?.events?.map((event, i) => {
            const eventKey = event.id || i;
            const hasSnapshot = event.aircraft_snapshot || event.aircraft_snapshot_2;
            const isExpanded = expandedSnapshots[eventKey];
            const state = replayState[eventKey];

            return (
              <div
                key={eventKey}
                ref={el => eventRefs.current[eventKey] = el}
                className={`safety-event-item severity-${event.severity}`}
              >
                <div className="safety-event-header">
                  <span className={`safety-severity-badge severity-${event.severity}`}>
                    {event.severity?.toUpperCase()}
                  </span>
                  <span className="safety-event-type">
                    {event.event_type?.replace(/_/g, ' ').toUpperCase()}
                  </span>
                  <span className="safety-event-time">
                    {new Date(event.timestamp).toLocaleString()}
                  </span>
                </div>
                <div className="safety-event-message">{event.message}</div>
                <div className="safety-event-details">
                  <span
                    className="mono safety-aircraft-link"
                    onClick={() => onSelectAircraft?.(event.icao)}
                  >
                    {event.callsign || event.icao}
                  </span>
                  {event.icao_2 && (
                    <>
                      <span className="safety-event-separator">↔</span>
                      <span
                        className="mono safety-aircraft-link"
                        onClick={() => onSelectAircraft?.(event.icao_2)}
                      >
                        {event.callsign_2 || event.icao_2}
                      </span>
                    </>
                  )}
                  {event.details?.horizontal_nm && (
                    <span>Sep: {event.details.horizontal_nm.toFixed(1)} nm</span>
                  )}
                  {event.details?.vertical_ft && (
                    <span>Alt diff: {event.details.vertical_ft} ft</span>
                  )}
                </div>

                <div className="safety-event-actions">
                  {hasSnapshot && (
                    <button
                      className="snapshot-toggle"
                      onClick={() => toggleSnapshot(eventKey)}
                    >
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      {isExpanded ? 'Hide' : 'Show'} Telemetry
                    </button>
                  )}

                  {(event.aircraft_snapshot?.lat || event.aircraft_snapshot_2?.lat) && (
                    <button
                      className="snapshot-toggle map-toggle"
                      onClick={() => toggleMap(eventKey, event)}
                    >
                      <MapIcon size={14} />
                      {expandedMaps[eventKey] ? 'Hide' : 'Show'} Map
                    </button>
                  )}

                  {onViewEvent && event.id && (
                    <button
                      className="snapshot-toggle view-details-btn"
                      onClick={() => onViewEvent(event.id)}
                      title="View full event details"
                    >
                      <ExternalLink size={14} />
                      View Details
                    </button>
                  )}
                </div>

                {isExpanded && (
                  <div className="snapshot-container">
                    {renderSnapshot(event.aircraft_snapshot, event.aircraft_snapshot_2 ? 'Aircraft 1' : null)}
                    {renderSnapshot(event.aircraft_snapshot_2, 'Aircraft 2')}
                  </div>
                )}

                {expandedMaps[eventKey] && (
                  <div className="safety-event-map-container">
                    <div
                      className="safety-event-map"
                      ref={(el) => {
                        if (el && expandedMaps[eventKey]) {
                          setTimeout(() => initializeMap(eventKey, event, el), 50);
                        }
                      }}
                    />

                    {/* Flight data graphs */}
                    <div className="flight-graphs">
                      {[event.icao, event.icao_2].filter(Boolean).map((icao, idx) => {
                        const track = trackData[icao];
                        if (!track || track.length < 2) return null;
                        const color = idx === 0 ? '#00ff88' : '#44aaff';
                        const position = state?.position ?? 100;
                        return (
                          <div key={icao} className="aircraft-graphs">
                            <div className="graphs-header" style={{ color }}>
                              {event[idx === 0 ? 'callsign' : 'callsign_2'] || icao}
                            </div>
                            <div className="graphs-row">
                              {renderMiniGraph(track, 'altitude', color, 'Altitude', 'ft', null, position, eventKey)}
                              {renderMiniGraph(track, 'gs', color, 'Speed', 'kts', v => v?.toFixed(0), position, eventKey)}
                              {renderMiniGraph(track, 'vr', color, 'V/S', 'fpm', v => (v > 0 ? '+' : '') + v, position, eventKey)}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Replay controls */}
                    <div className="replay-controls">
                      <div className="replay-buttons">
                        <button
                          className="replay-btn"
                          onClick={() => skipToStart(eventKey, event)}
                          title="Skip to start"
                        >
                          <SkipBack size={16} />
                        </button>
                        <button
                          className="replay-btn play-btn"
                          onClick={() => togglePlay(eventKey, event)}
                          title={state?.isPlaying ? 'Pause' : 'Play'}
                        >
                          {state?.isPlaying ? <Pause size={18} /> : <Play size={18} />}
                        </button>
                        <button
                          className="replay-btn"
                          onClick={() => skipToEnd(eventKey, event)}
                          title="Skip to end"
                        >
                          <SkipForward size={16} />
                        </button>
                        <button
                          className="replay-btn event-btn"
                          onClick={() => jumpToEvent(eventKey, event)}
                          title="Jump to event"
                        >
                          <AlertTriangle size={14} />
                        </button>
                        <select
                          className="speed-select"
                          value={state?.speed || 1}
                          onChange={(e) => handleSpeedChange(eventKey, parseFloat(e.target.value))}
                          title="Playback speed"
                        >
                          <option value={0.25}>0.25x</option>
                          <option value={0.5}>0.5x</option>
                          <option value={1}>1x</option>
                          <option value={2}>2x</option>
                          <option value={4}>4x</option>
                        </select>
                      </div>
                      <div className="replay-slider-container">
                        <input
                          type="range"
                          className="replay-slider"
                          min="0"
                          max="100"
                          value={state?.position || 100}
                          onChange={(e) => handleReplayChange(eventKey, event, parseFloat(e.target.value))}
                        />
                        <div className="replay-time">
                          {getReplayTimestamp(eventKey, event) || '--:--'}
                        </div>
                      </div>
                    </div>

                    <div className="safety-map-legend">
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
                )}
              </div>
            );
          })}
        </div>
      )}

      {viewType === 'acars' && (
        <>
          <div className="acars-history-filters">
            <div className="search-box">
              <Search size={16} />
              <input
                type="text"
                placeholder="Search ICAO, callsign, text, label..."
                value={acarsSearch}
                onChange={(e) => setAcarsSearch(e.target.value)}
              />
            </div>
            <select
              className="source-filter"
              value={acarsSource}
              onChange={(e) => setAcarsSource(e.target.value)}
            >
              <option value="all">All Sources</option>
              <option value="acars">ACARS</option>
              <option value="vdlm2">VDL Mode 2</option>
            </select>
            <div className="label-filter-container" ref={labelDropdownRef}>
              <button
                className={`label-filter-btn ${acarsSelectedLabels.length > 0 ? 'active' : ''}`}
                onClick={() => setShowLabelDropdown(!showLabelDropdown)}
              >
                Message Types
                {acarsSelectedLabels.length > 0 && (
                  <span className="label-filter-count">{acarsSelectedLabels.length}</span>
                )}
                <ChevronDown size={14} className={showLabelDropdown ? 'rotated' : ''} />
              </button>
              {showLabelDropdown && (
                <div className="label-filter-dropdown">
                  <div className="label-filter-header">
                    <span>Filter by Message Type</span>
                    {acarsSelectedLabels.length > 0 && (
                      <button
                        className="label-clear-btn"
                        onClick={() => setAcarsSelectedLabels([])}
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                  <div className="label-filter-list">
                    {availableLabels.map(({ label, count, description }) => (
                      <label key={label} className="label-filter-item">
                        <input
                          type="checkbox"
                          checked={acarsSelectedLabels.includes(label)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setAcarsSelectedLabels([...acarsSelectedLabels, label]);
                            } else {
                              setAcarsSelectedLabels(acarsSelectedLabels.filter(l => l !== label));
                            }
                          }}
                        />
                        <span className="label-code">{label}</span>
                        <span className="label-desc">{description || label}</span>
                        <span className="label-count">{count}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <label className="hide-empty-toggle">
              <input
                type="checkbox"
                checked={acarsHideEmpty}
                onChange={(e) => setAcarsHideEmpty(e.target.checked)}
              />
              Hide empty
            </label>
            <div className="acars-history-count">
              {filteredAcarsMessages.length} message{filteredAcarsMessages.length !== 1 ? 's' : ''}
            </div>
          </div>
          <div className="acars-history-list">
            {filteredAcarsMessages.length === 0 ? (
              <div className="no-events-message">
                <MessageCircle size={32} />
                <p>No ACARS messages in the selected time range</p>
              </div>
            ) : (
              filteredAcarsMessages.map((msg, i) => {
                const timestamp = typeof msg.timestamp === 'number'
                  ? new Date(msg.timestamp * 1000)
                  : new Date(msg.timestamp);

                return (
                  <div key={i} className="acars-history-item">
                    <div className="acars-history-header">
                      <span className="acars-history-time">{timestamp.toLocaleString()}</span>
                      {msg.label && (
                        <span className="acars-history-label" title={getAcarsLabelDescription(msg.label) || msg.label}>
                          {msg.label}
                          {getAcarsLabelDescription(msg.label) && (
                            <span className="acars-label-desc">{getAcarsLabelDescription(msg.label)}</span>
                          )}
                        </span>
                      )}
                      <span className={`acars-history-source ${msg.source}`}>{msg.source?.toUpperCase()}</span>
                      {msg.frequency && <span className="acars-history-freq">{msg.frequency} MHz</span>}
                    </div>
                    <div className="acars-history-aircraft">
                      {msg.callsign && (
                        <span
                          className="acars-history-callsign clickable"
                          onClick={() => onSelectAircraft?.(msg.icao_hex)}
                        >
                          {msg.callsign}
                        </span>
                      )}
                      {msg.icao_hex && (
                        <span
                          className="acars-history-icao clickable"
                          onClick={() => onSelectAircraft?.(msg.icao_hex)}
                        >
                          {msg.icao_hex}
                        </span>
                      )}
                      {msg.registration && (
                        <span className="acars-history-reg">{msg.registration}</span>
                      )}
                    </div>
                    {msg.text && <pre className="acars-history-text">{msg.text}</pre>}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
