import React, { useRef, useCallback, useEffect } from 'react';
import L from 'leaflet';
import { MiniGraph, useGraphInteraction } from '../components/MiniGraph';
import { ReplayControls } from '../components/ReplayControls';

/**
 * TrackSection - Mini-map with sparkline graphs and replay controls
 *
 * A compact version of TrackTab for use in the scrollable sections layout.
 */
export function TrackSection({
  aircraft,
  sightings,
  feederLocation,
  trackReplayPosition,
  setTrackReplayPosition,
  trackIsPlaying,
  setTrackIsPlaying,
  trackReplaySpeed,
  setTrackReplaySpeed,
  showTrackPoints,
  setShowTrackPoints,
  trackLiveMode,
  setTrackLiveMode,
  graphZoom,
  setGraphZoom,
  graphScrollOffset,
  setGraphScrollOffset,
}) {
  const trackMapRef = useRef(null);
  const trackMarkerRef = useRef(null);
  const trackAnimationRef = useRef(null);
  const trackPlayingRef = useRef(false);
  const trackPolylineRef = useRef(null);

  const {
    handleGraphWheel,
    handleGraphDragStart,
    handleGraphDragMove,
    handleGraphDragEnd,
    resetGraphZoom,
  } = useGraphInteraction(graphZoom, setGraphZoom, graphScrollOffset, setGraphScrollOffset);

  // Create aircraft icon
  const createAircraftIcon = useCallback((track, color) => {
    const rotation = track || 0;
    return L.divIcon({
      className: 'track-aircraft-marker',
      html: `
        <svg width="24" height="24" viewBox="0 0 24 24" style="transform: rotate(${rotation}deg)">
          <path d="M12 2 L14 8 L20 10 L14 12 L14 18 L12 16 L10 18 L10 12 L4 10 L10 8 Z"
                fill="${color}" stroke="#000" stroke-width="0.5"/>
        </svg>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
  }, []);

  // Get interpolated position
  const getInterpolatedPosition = useCallback((positions, percentage) => {
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

    const lerp = (v1, v2, t) => (v1 == null ? v2 : v2 == null ? v1 : v1 + (v2 - v1) * t);
    const lerpAngle = (a1, a2, t) => {
      if (a1 == null || a2 == null) return a1;
      let diff = a2 - a1;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      return (a1 + diff * t + 360) % 360;
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

  // Initialize map
  const initializeTrackMap = useCallback(
    (containerEl) => {
      if (!containerEl || trackMapRef.current) return;
      if (!sightings || sightings.length === 0) return;

      const validSightings = sightings.filter((s) => s.lat && s.lon);
      if (validSightings.length === 0) return;

      const latest = validSightings[0];

      const map = L.map(containerEl, {
        center: [latest.lat, latest.lon],
        zoom: 10,
        zoomControl: false,
        attributionControl: false,
      });

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
      }).addTo(map);

      const trackCoords = [...validSightings].reverse().map((s) => [s.lat, s.lon]);
      if (trackCoords.length > 1) {
        trackPolylineRef.current = L.polyline(trackCoords, {
          color: '#00ff88',
          weight: 3,
          opacity: 0.7,
        }).addTo(map);
      }

      // Feeder location marker
      if (feederLocation?.lat && feederLocation?.lon) {
        L.circleMarker([feederLocation.lat, feederLocation.lon], {
          radius: 8,
          color: '#ff4444',
          fillColor: '#ff4444',
          fillOpacity: 0.3,
          weight: 2,
        }).addTo(map);
      }

      // Initial aircraft marker
      const pos = getInterpolatedPosition(validSightings, trackReplayPosition);
      if (pos) {
        const icon = createAircraftIcon(pos.track, '#00ff88');
        trackMarkerRef.current = L.marker([pos.lat, pos.lon], { icon }).addTo(map);
      }

      // Fit bounds
      if (trackCoords.length > 1) {
        const bounds = L.latLngBounds(trackCoords);
        map.fitBounds(bounds.pad(0.1));
      }

      trackMapRef.current = map;
    },
    [sightings, feederLocation, trackReplayPosition, getInterpolatedPosition, createAircraftIcon]
  );

  // Update marker position
  const updateTrackMarker = useCallback(
    (position, follow = true) => {
      if (!trackMapRef.current || !sightings || sightings.length === 0) return;

      const validSightings = sightings.filter((s) => s.lat && s.lon);
      const pos = getInterpolatedPosition(validSightings, position);
      if (!pos) return;

      if (trackMarkerRef.current) {
        trackMapRef.current.removeLayer(trackMarkerRef.current);
      }

      const icon = createAircraftIcon(pos.track, '#00ff88');
      trackMarkerRef.current = L.marker([pos.lat, pos.lon], { icon }).addTo(trackMapRef.current);

      if (follow) {
        trackMapRef.current.panTo([pos.lat, pos.lon], { animate: true, duration: 0.15 });
      }
    },
    [sightings, getInterpolatedPosition, createAircraftIcon]
  );

  // Handle replay slider change
  const handleTrackReplayChange = useCallback(
    (newPosition) => {
      if (newPosition < 100) setTrackLiveMode(false);
      setTrackReplayPosition(newPosition);
      updateTrackMarker(newPosition);
    },
    [setTrackLiveMode, setTrackReplayPosition, updateTrackMarker]
  );

  // Toggle play/pause
  const toggleTrackPlay = useCallback(() => {
    if (trackPlayingRef.current) {
      trackPlayingRef.current = false;
      if (trackAnimationRef.current) cancelAnimationFrame(trackAnimationRef.current);
      setTrackIsPlaying(false);
    } else {
      trackPlayingRef.current = true;
      setTrackLiveMode(false);
      setTrackIsPlaying(true);

      let pos = trackReplayPosition <= 0 ? 0 : trackReplayPosition;
      let lastTime = performance.now();

      const animate = (currentTime) => {
        if (!trackPlayingRef.current) return;

        const deltaTime = currentTime - lastTime;
        lastTime = currentTime;
        const increment = (deltaTime / 200) * trackReplaySpeed;
        pos += increment;

        if (pos >= 100) {
          trackPlayingRef.current = false;
          setTrackReplayPosition(100);
          updateTrackMarker(100);
          setTrackIsPlaying(false);
          setTrackLiveMode(true);
          return;
        }

        setTrackReplayPosition(pos);
        updateTrackMarker(pos);
        trackAnimationRef.current = requestAnimationFrame(animate);
      };

      trackAnimationRef.current = requestAnimationFrame(animate);
    }
  }, [
    trackReplayPosition,
    trackReplaySpeed,
    setTrackReplayPosition,
    updateTrackMarker,
    setTrackIsPlaying,
    setTrackLiveMode,
  ]);

  // Skip to start/end
  const skipTrackToStart = useCallback(() => {
    trackPlayingRef.current = false;
    if (trackAnimationRef.current) cancelAnimationFrame(trackAnimationRef.current);
    setTrackIsPlaying(false);
    setTrackLiveMode(false);
    setTrackReplayPosition(0);
    updateTrackMarker(0);
  }, [setTrackIsPlaying, setTrackLiveMode, setTrackReplayPosition, updateTrackMarker]);

  const skipTrackToEnd = useCallback(() => {
    trackPlayingRef.current = false;
    if (trackAnimationRef.current) cancelAnimationFrame(trackAnimationRef.current);
    setTrackIsPlaying(false);
    setTrackLiveMode(true);
    setTrackReplayPosition(100);
    updateTrackMarker(100);
  }, [setTrackIsPlaying, setTrackLiveMode, setTrackReplayPosition, updateTrackMarker]);

  // Toggle live mode
  const handleToggleLiveMode = useCallback(() => {
    if (!trackLiveMode) {
      trackPlayingRef.current = false;
      setTrackLiveMode(true);
      setTrackReplayPosition(100);
      if (trackAnimationRef.current) cancelAnimationFrame(trackAnimationRef.current);
      setTrackIsPlaying(false);
    } else {
      setTrackLiveMode(false);
    }
  }, [trackLiveMode, setTrackLiveMode, setTrackReplayPosition, setTrackIsPlaying]);

  // Live update track map
  useEffect(() => {
    if (!trackMapRef.current || !sightings || sightings.length === 0) return;

    const validSightings = sightings.filter((s) => s.lat && s.lon);
    if (validSightings.length === 0) return;

    const trackCoords = [...validSightings].reverse().map((s) => [s.lat, s.lon]);
    if (trackPolylineRef.current) {
      trackPolylineRef.current.setLatLngs(trackCoords);
    }

    if (trackLiveMode && !trackIsPlaying) {
      setTrackReplayPosition(100);
      const latest = validSightings[0];
      if (latest && trackMarkerRef.current && trackMapRef.current) {
        trackMapRef.current.removeLayer(trackMarkerRef.current);
        const icon = createAircraftIcon(latest.track, '#00ff88');
        trackMarkerRef.current = L.marker([latest.lat, latest.lon], { icon }).addTo(
          trackMapRef.current
        );
        trackMapRef.current.panTo([latest.lat, latest.lon], { animate: true, duration: 0.3 });
      }
    }
  }, [sightings, trackLiveMode, trackIsPlaying, createAircraftIcon, setTrackReplayPosition]);

  // Update from live aircraft position
  useEffect(() => {
    if (!trackMapRef.current || !trackLiveMode || trackIsPlaying) return;
    if (!aircraft?.lat || !aircraft?.lon) return;

    if (trackMarkerRef.current) {
      trackMapRef.current.removeLayer(trackMarkerRef.current);
    }
    const icon = createAircraftIcon(aircraft.track, '#00ff88');
    trackMarkerRef.current = L.marker([aircraft.lat, aircraft.lon], { icon }).addTo(
      trackMapRef.current
    );
    trackMapRef.current.panTo([aircraft.lat, aircraft.lon], { animate: true, duration: 0.3 });
  }, [
    aircraft?.lat,
    aircraft?.lon,
    aircraft?.track,
    trackLiveMode,
    trackIsPlaying,
    createAircraftIcon,
  ]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (trackMapRef.current) {
        trackMapRef.current.remove();
        trackMapRef.current = null;
      }
      if (trackAnimationRef.current) {
        cancelAnimationFrame(trackAnimationRef.current);
      }
    };
  }, []);

  return (
    <div className="track-section-content">
      {/* Mini-map */}
      <div
        className="track-mini-map"
        ref={(el) => {
          if (el && !trackMapRef.current) {
            setTimeout(() => initializeTrackMap(el), 50);
          }
        }}
        role="application"
        aria-label="Flight track map"
      />

      {/* Sparkline graphs */}
      <div className="track-sparklines">
        <MiniGraph
          data={sightings}
          dataKey="altitude"
          color="#00ff88"
          label="Altitude"
          unit="ft"
          positionPercent={trackLiveMode ? null : trackReplayPosition}
          graphZoom={graphZoom}
          graphScrollOffset={graphScrollOffset}
          onWheel={handleGraphWheel}
          onDragStart={handleGraphDragStart}
          onDragMove={handleGraphDragMove}
          onDragEnd={handleGraphDragEnd}
          onResetZoom={resetGraphZoom}
        />
        <MiniGraph
          data={sightings}
          dataKey="gs"
          color="#44aaff"
          label="Speed"
          unit="kts"
          formatFn={(v) => v?.toFixed(0)}
          positionPercent={trackLiveMode ? null : trackReplayPosition}
          graphZoom={graphZoom}
          graphScrollOffset={graphScrollOffset}
          onWheel={handleGraphWheel}
          onDragStart={handleGraphDragStart}
          onDragMove={handleGraphDragMove}
          onDragEnd={handleGraphDragEnd}
          onResetZoom={resetGraphZoom}
        />
        <MiniGraph
          data={sightings}
          dataKey="vr"
          color="#ffaa44"
          label="V/S"
          unit="fpm"
          formatFn={(v) => (v > 0 ? '+' : '') + v}
          positionPercent={trackLiveMode ? null : trackReplayPosition}
          graphZoom={graphZoom}
          graphScrollOffset={graphScrollOffset}
          onWheel={handleGraphWheel}
          onDragStart={handleGraphDragStart}
          onDragMove={handleGraphDragMove}
          onDragEnd={handleGraphDragEnd}
          onResetZoom={resetGraphZoom}
        />
      </div>

      {/* Replay controls */}
      <ReplayControls
        isPlaying={trackIsPlaying}
        position={trackReplayPosition}
        onPlayToggle={toggleTrackPlay}
        onSkipToStart={skipTrackToStart}
        onSkipToEnd={skipTrackToEnd}
        onPositionChange={handleTrackReplayChange}
        speed={trackReplaySpeed}
        onSpeedChange={setTrackReplaySpeed}
        showTrackPoints={showTrackPoints}
        onToggleTrackPoints={() => setShowTrackPoints(!showTrackPoints)}
        liveMode={trackLiveMode}
        onToggleLiveMode={handleToggleLiveMode}
        showSpeedControl={true}
        showTrackPointsControl={false}
        showLiveModeControl={true}
        className="track-controls compact"
      />
    </div>
  );
}
