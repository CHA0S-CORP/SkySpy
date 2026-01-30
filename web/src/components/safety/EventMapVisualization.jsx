import React, { useRef, useEffect, useCallback } from 'react';
import L from 'leaflet';
import { Target } from 'lucide-react';

/**
 * Event Map Visualization Component
 * Displays the map with aircraft positions, tracks, and event location
 */
export function EventMapVisualization({
  event,
  trackData,
  replayPosition,
  onMapReady
}) {
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const replayMarkersRef = useRef({});
  const replayTracksRef = useRef({});

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
    updateReplayMarkers(replayPosition);
    onMapReady?.(map);
  }, [event, trackData, replayPosition, updateReplayMarkers, onMapReady]);

  // Update markers when replay position changes
  useEffect(() => {
    if (mapRef.current) {
      updateReplayMarkers(replayPosition);
    }
  }, [replayPosition, updateReplayMarkers]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  return (
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
  );
}

export default EventMapVisualization;
