import { useState, useRef, useCallback, useEffect } from 'react';
import L from 'leaflet';
import { safeJson } from '../components/history/historyConstants';

/**
 * Hook for managing map replay state and animations for safety events
 */
export function useReplayState({
  apiBase,
  wsRequest,
  wsConnected
}) {
  const [expandedMaps, setExpandedMaps] = useState({});
  const [trackData, setTrackData] = useState({});
  const [replayState, setReplayState] = useState({});
  const [graphZoomState, setGraphZoomState] = useState({});

  const graphDragRef = useRef({});
  const mapRefs = useRef({});
  const replayMarkersRef = useRef({});
  const replayTracksRef = useRef({});
  const animationFrameRef = useRef({});

  // Get interpolated position along a track
  const getInterpolatedPosition = useCallback((track, percentage) => {
    if (!track || track.length === 0) return null;
    if (track.length === 1) return { ...track[0], index: 0 };

    // Track is newest first, so reverse for timeline order
    const ordered = [...track].reverse();
    const index = Math.floor((percentage / 100) * (ordered.length - 1));
    const clampedIndex = Math.max(0, Math.min(index, ordered.length - 1));
    return { ...ordered[clampedIndex], index: clampedIndex };
  }, []);

  // Create aircraft icon
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
      const ordered = [...track].reverse().filter(p => p.lat && p.lon);
      if (ordered.length > 1) {
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
  }, [trackData, getInterpolatedPosition, createAircraftIcon]);

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
            let data;
            if (wsRequest && wsConnected) {
              const result = await wsRequest('sightings', { icao_hex: icao, hours: 2, limit: 500 });
              if (result && (result.sightings || result.results)) {
                data = result;
              } else {
                throw new Error('Invalid sightings response');
              }
            } else {
              const res = await fetch(`${apiBase}/api/v1/sightings?icao_hex=${icao}&hours=2&limit=500`);
              data = await safeJson(res);
              if (!data) throw new Error('HTTP request failed');
            }
            const sightings = data?.sightings || data?.results || [];
            setTrackData(prev => ({ ...prev, [icao]: sightings }));
          } catch (err) {
            console.error('Failed to fetch track data:', err);
          }
        }
      }

      // Initialize replay state for this event
      setReplayState(prev => ({
        ...prev,
        [eventKey]: { position: 100, isPlaying: false, speed: 1 }
      }));
    }
  }, [expandedMaps, trackData, apiBase, wsRequest, wsConnected]);

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
      let pos = state.position <= 0 ? 0 : state.position;
      let lastTime = performance.now();

      const animate = (currentTime) => {
        const currentState = replayState[eventKey];
        const speed = currentState?.speed || 1;

        const deltaTime = currentTime - lastTime;
        lastTime = currentTime;

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
      if (animationFrameRef.current[eventKey]) {
        cancelAnimationFrame(animationFrameRef.current[eventKey]);
      }
    }
  }, [replayState, updateReplayMarkers]);

  // Skip to start
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

  // Skip to end
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

  // Jump to event position (50%)
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

  // Graph zoom/scroll handlers
  const handleGraphWheel = useCallback((eventKey, e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.25 : 0.25;
    setGraphZoomState(prev => {
      const current = prev[eventKey] || { zoom: 1, offset: 0 };
      const newZoom = Math.max(1, Math.min(8, current.zoom + delta));
      let newOffset = current.offset;
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

  // Get timestamp for replay position
  const getReplayTimestamp = useCallback((eventKey, event) => {
    const state = replayState[eventKey];
    if (!state) return null;

    const icao = event.icao || event.icao_2;
    const track = trackData[icao];
    if (!track || track.length === 0) return null;

    const pos = getInterpolatedPosition(track, state.position);
    if (!pos?.timestamp) return null;

    return new Date(pos.timestamp).toLocaleTimeString();
  }, [replayState, trackData, getInterpolatedPosition]);

  // Initialize map when expanded
  const initializeMap = useCallback((eventKey, event, containerRef) => {
    if (!containerRef || mapRefs.current[eventKey]) return;

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

    const map = L.map(containerRef, {
      center: [eventLat, eventLon],
      zoom: 10,
      zoomControl: false,
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
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    const eventMarker = L.marker([eventLat, eventLon], { icon: eventIcon }).addTo(map);
    eventMarker.bindPopup(`<b>Event Location</b><br>${event.event_type?.replace(/_/g, ' ')}<br>${new Date(event.timestamp).toLocaleString()}`);

    // Add background track lines
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
            weight: 1,
            opacity: 0.25,
            dashArray: '4, 6'
          }).addTo(map);
        }
      }
    });

    // Add initial aircraft markers
    const state = replayState[eventKey];
    if (state) {
      updateReplayMarkers(eventKey, event, state.position);
    }

    // Fit bounds if two aircraft
    if (snapshot1?.lat && snapshot2?.lat) {
      const bounds = L.latLngBounds([
        [snapshot1.lat, snapshot1.lon],
        [snapshot2.lat, snapshot2.lon]
      ]);
      map.fitBounds(bounds.pad(0.3));
    }

    mapRefs.current[eventKey] = map;
  }, [trackData, replayState, updateReplayMarkers]);

  // Cleanup maps on unmount
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
        Object.keys(replayMarkersRef.current).forEach(mKey => {
          if (mKey.startsWith(key)) {
            delete replayMarkersRef.current[mKey];
          }
        });
        Object.keys(replayTracksRef.current).forEach(tKey => {
          if (tKey.startsWith(key)) {
            delete replayTracksRef.current[tKey];
          }
        });
        if (animationFrameRef.current[key]) {
          cancelAnimationFrame(animationFrameRef.current[key]);
          delete animationFrameRef.current[key];
        }
      }
    });
  }, [expandedMaps]);

  return {
    // State
    expandedMaps,
    trackData,
    replayState,
    graphZoomState,
    mapRefs,

    // Actions
    toggleMap,
    handleReplayChange,
    togglePlay,
    skipToStart,
    skipToEnd,
    handleSpeedChange,
    jumpToEvent,
    handleGraphWheel,
    handleGraphDragStart,
    handleGraphDragMove,
    handleGraphDragEnd,
    resetGraphZoom,
    getReplayTimestamp,
    initializeMap,
    getInterpolatedPosition,
  };
}
