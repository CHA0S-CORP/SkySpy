import React, { useRef, useEffect, useCallback, useState } from 'react';
import L from 'leaflet';
import { Target } from 'lucide-react';
import { aircraftArrowIcon } from '../../utils/mapMarkerIcon';

/**
 * Event Map Visualization Component
 * Displays the map with aircraft positions, tracks, and event location
 */
export function EventMapVisualization({ event, trackData, replayPosition, onMapReady }) {
  const mapRef = useRef(null);
  // Callback-ref target held in state so the init effect re-runs once the
  // container is actually in the DOM (an inline ref that inits inside a
  // setTimeout races the layout and leaves Leaflet sized to 0 → grey tiles).
  const [containerEl, setContainerEl] = useState(null);
  const replayMarkersRef = useRef({});
  const replayTracksRef = useRef({});
  const staticTracksRef = useRef([]);
  const eventMarkerRef = useRef(null);

  // Create aircraft icon — shared heading dart, consistent with the Live and
  // Detail maps.
  const createAircraftIcon = useCallback((track, color) => {
    return aircraftArrowIcon({ track, color, size: 30 });
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
  const updateReplayMarkers = useCallback(
    (position) => {
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
        const ordered = [...track].reverse().filter((p) => p.lat && p.lon);
        if (ordered.length > 1) {
          const endIndex = Math.floor((position / 100) * (ordered.length - 1));
          const visibleTrack = ordered.slice(0, endIndex + 1);

          if (replayTracksRef.current[trackId]) {
            map.removeLayer(replayTracksRef.current[trackId]);
          }

          if (visibleTrack.length > 1) {
            const coords = visibleTrack.map((p) => [p.lat, p.lon]);
            const polyline = L.polyline(coords, {
              color: colors[i],
              weight: 4,
              opacity: 0.8,
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
    },
    [event, trackData, getInterpolatedPosition, createAircraftIcon]
  );

  // Event center from the best available position (details → both snapshots →
  // either snapshot). Returns null when nothing is geolocated.
  const eventCenter = useCallback(() => {
    if (!event) return null;
    const s1 = event.aircraft_snapshot;
    const s2 = event.aircraft_snapshot_2;
    if (event.details?.lat && event.details?.lon) return [event.details.lat, event.details.lon];
    if (s1?.lat && s1?.lon && s2?.lat && s2?.lon)
      return [(s1.lat + s2.lat) / 2, (s1.lon + s2.lon) / 2];
    if (s1?.lat && s1?.lon) return [s1.lat, s1.lon];
    if (s2?.lat && s2?.lon) return [s2.lat, s2.lon];
    return null;
  }, [event]);

  // Init the Leaflet map once the container is mounted and the event has a
  // position. Kept minimal — content (markers/tracks) is drawn in a separate
  // effect so late-arriving track data doesn't force a re-init.
  useEffect(() => {
    if (!containerEl || mapRef.current) return undefined;
    const center = eventCenter();
    if (!center) return undefined;

    const map = L.map(containerEl, {
      center,
      zoom: 10,
      zoomControl: true,
      attributionControl: false,
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    onMapReady?.(map);

    // Leaflet caches the container size at construction; inside a sticky grid
    // column that size is often stale/zero on first paint, which renders grey
    // half-tiles. Recompute after layout settles and whenever the box resizes.
    const invalidate = () => mapRef.current?.invalidateSize();
    const raf = requestAnimationFrame(invalidate);
    const t = setTimeout(invalidate, 250);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(invalidate) : null;
    ro?.observe(containerEl);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      ro?.disconnect();
      map.remove();
      mapRef.current = null;
      replayMarkersRef.current = {};
      replayTracksRef.current = {};
      staticTracksRef.current = [];
      eventMarkerRef.current = null;
    };
  }, [containerEl, eventCenter, onMapReady]);

  // Draw / refresh the event marker, faint background tracks, and fit bounds
  // whenever the event or its track data changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !event) return;
    const center = eventCenter();
    if (!center) return;

    // Event location marker
    if (eventMarkerRef.current) map.removeLayer(eventMarkerRef.current);
    const eventIcon = L.divIcon({
      className: 'event-location-marker',
      html: `
        <div class="event-marker-pulse-ring"></div>
        <div class="event-marker-core"></div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
    const eventMarker = L.marker(center, { icon: eventIcon }).addTo(map);
    eventMarker.bindPopup(
      `<b>Event Location</b><br>${event.event_type?.replace(/_/g, ' ')}<br>${
        event.timestamp ? new Date(event.timestamp).toLocaleString() : ''
      }`
    );
    eventMarkerRef.current = eventMarker;

    // Faint background tracks
    staticTracksRef.current.forEach((l) => map.removeLayer(l));
    staticTracksRef.current = [];
    const icaos = [event.icao, event.icao_hex, event.icao_2].filter(Boolean);
    const colors = ['#00ff88', '#44aaff'];
    icaos.forEach((icao, i) => {
      const track = trackData[icao];
      if (track?.length > 1) {
        const coords = [...track]
          .reverse()
          .filter((p) => p.lat && p.lon)
          .map((p) => [p.lat, p.lon]);
        if (coords.length > 1) {
          const line = L.polyline(coords, {
            color: colors[i % colors.length],
            weight: 2,
            opacity: 0.2,
            dashArray: '4, 6',
          }).addTo(map);
          staticTracksRef.current.push(line);
        }
      }
    });

    // Fit bounds to the involved aircraft (snapshots preferred, else tracks)
    const s1 = event.aircraft_snapshot;
    const s2 = event.aircraft_snapshot_2;
    const pts = [];
    if (s1?.lat && s1?.lon) pts.push([s1.lat, s1.lon]);
    if (s2?.lat && s2?.lon) pts.push([s2.lat, s2.lon]);
    staticTracksRef.current.forEach((l) => l.getLatLngs().forEach((ll) => pts.push(ll)));
    if (pts.length > 1) {
      map.fitBounds(L.latLngBounds(pts).pad(0.3));
    }

    updateReplayMarkers(replayPosition);
  }, [event, trackData, eventCenter, updateReplayMarkers, replayPosition]);

  // Update markers when replay position changes
  useEffect(() => {
    if (mapRef.current) {
      updateReplayMarkers(replayPosition);
    }
  }, [replayPosition, updateReplayMarkers]);

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
      <div className="sep-map" ref={setContainerEl} />
      <div className="sep-map-overlay-gradient" />
    </div>
  );
}

export default EventMapVisualization;
