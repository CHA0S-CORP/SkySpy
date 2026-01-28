import React, { useRef, useCallback, useEffect } from 'react';
import { History, Map as MapIcon } from 'lucide-react';
import L from 'leaflet';
import { MiniGraph, useGraphInteraction } from '../components/MiniGraph';
import { ReplayControls } from '../components/ReplayControls';

export function HistoryTab({
  sightings,
  feederLocation,
  showTrackMap,
  setShowTrackMap,
  replayPosition,
  setReplayPosition,
  isPlaying,
  setIsPlaying,
  graphZoom,
  setGraphZoom,
  graphScrollOffset,
  setGraphScrollOffset
}) {
  const mapRef = useRef(null);
  const replayMarkerRef = useRef(null);
  const animationRef = useRef(null);

  const {
    handleGraphWheel,
    handleGraphDragStart,
    handleGraphDragMove,
    handleGraphDragEnd,
    resetGraphZoom
  } = useGraphInteraction(graphZoom, setGraphZoom, graphScrollOffset, setGraphScrollOffset);

  // Create aircraft icon for map
  const createAircraftIcon = useCallback((track, color) => {
    const rotation = track || 0;
    return L.divIcon({
      className: 'history-aircraft-marker',
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

  // Get interpolated position along track
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

    const lerpAngle = (a1, a2, t) => {
      if (a1 == null || a2 == null) return a1;
      let diff = a2 - a1;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      return ((a1 + diff * t) + 360) % 360;
    };

    const lerp = (v1, v2, t) => {
      if (v1 == null) return v2;
      if (v2 == null) return v1;
      return v1 + (v2 - v1) * t;
    };

    return {
      ...p1,
      lat: lerp(p1.lat, p2.lat, fraction),
      lon: lerp(p1.lon, p2.lon, fraction),
      altitude: Math.round(lerp(p1.altitude, p2.altitude, fraction)),
      gs: lerp(p1.gs, p2.gs, fraction),
      vr: Math.round(lerp(p1.vr, p2.vr, fraction)),
      track: lerpAngle(p1.track, p2.track, fraction),
      timestamp: p1.timestamp
    };
  }, []);

  // Initialize map
  const initializeMap = useCallback((containerEl) => {
    if (!containerEl || mapRef.current) return;
    if (!sightings || sightings.length === 0) return;

    const validSightings = sightings.filter(s => s.lat && s.lon);
    if (validSightings.length === 0) return;

    const latest = validSightings[0];

    const map = L.map(containerEl, {
      center: [latest.lat, latest.lon],
      zoom: 10,
      zoomControl: true,
      attributionControl: false
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(map);

    const trackCoords = [...validSightings].reverse().map(s => [s.lat, s.lon]);
    if (trackCoords.length > 1) {
      L.polyline(trackCoords, { color: '#00ff88', weight: 3, opacity: 0.7 }).addTo(map);
    }

    const step = Math.max(1, Math.floor(validSightings.length / 20));
    validSightings.forEach((s, i) => {
      if (i % step === 0 || i === 0 || i === validSightings.length - 1) {
        const isFirst = i === validSightings.length - 1;
        const isLast = i === 0;

        L.circleMarker([s.lat, s.lon], {
          radius: isFirst || isLast ? 6 : 3,
          color: isLast ? '#00ff88' : isFirst ? '#ff8844' : '#5a7a9a',
          fillColor: isLast ? '#00ff88' : isFirst ? '#ff8844' : '#5a7a9a',
          fillOpacity: 0.8,
          weight: 1
        }).addTo(map).bindPopup(`
          <b>${new Date(s.timestamp).toLocaleTimeString()}</b><br>
          Alt: ${s.altitude?.toLocaleString() || '--'} ft<br>
          Speed: ${s.gs?.toFixed(0) || '--'} kts<br>
          VS: ${s.vr > 0 ? '+' : ''}${s.vr || 0} fpm
        `);
      }
    });

    if (feederLocation?.lat && feederLocation?.lon) {
      L.circleMarker([feederLocation.lat, feederLocation.lon], {
        radius: 8, color: '#ff4444', fillColor: '#ff4444', fillOpacity: 0.3, weight: 2
      }).addTo(map).bindPopup('<b>Feeder Location</b>');
    }

    const pos = getInterpolatedPosition(validSightings, replayPosition);
    if (pos) {
      const icon = createAircraftIcon(pos.track, '#00ff88');
      replayMarkerRef.current = L.marker([pos.lat, pos.lon], { icon }).addTo(map);
    }

    if (trackCoords.length > 1) {
      const bounds = L.latLngBounds(trackCoords);
      map.fitBounds(bounds.pad(0.1));
    }

    mapRef.current = map;
  }, [sightings, feederLocation, replayPosition, getInterpolatedPosition, createAircraftIcon]);

  // Update replay marker position
  const updateReplayMarker = useCallback((position) => {
    if (!mapRef.current || !sightings || sightings.length === 0) return;

    const validSightings = sightings.filter(s => s.lat && s.lon);
    const pos = getInterpolatedPosition(validSightings, position);
    if (!pos) return;

    if (replayMarkerRef.current) {
      mapRef.current.removeLayer(replayMarkerRef.current);
    }

    const icon = createAircraftIcon(pos.track, '#00ff88');
    replayMarkerRef.current = L.marker([pos.lat, pos.lon], { icon }).addTo(mapRef.current);
  }, [sightings, getInterpolatedPosition, createAircraftIcon]);

  // Handle replay slider change
  const handleReplayChange = useCallback((newPosition) => {
    setReplayPosition(newPosition);
    updateReplayMarker(newPosition);
  }, [setReplayPosition, updateReplayMarker]);

  // Toggle play/pause
  const togglePlay = useCallback(() => {
    setIsPlaying(prev => {
      if (!prev) {
        let pos = replayPosition <= 0 ? 0 : replayPosition;
        const animate = () => {
          pos += 0.5;
          if (pos >= 100) {
            setReplayPosition(100);
            updateReplayMarker(100);
            setIsPlaying(false);
            return;
          }
          setReplayPosition(pos);
          updateReplayMarker(pos);
          animationRef.current = requestAnimationFrame(animate);
        };
        animationRef.current = requestAnimationFrame(animate);
        return true;
      } else {
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
        return false;
      }
    });
  }, [replayPosition, setReplayPosition, updateReplayMarker, setIsPlaying]);

  // Skip to start/end
  const skipToStart = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    setIsPlaying(false);
    setReplayPosition(0);
    updateReplayMarker(0);
  }, [setIsPlaying, setReplayPosition, updateReplayMarker]);

  const skipToEnd = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    setIsPlaying(false);
    setReplayPosition(100);
    updateReplayMarker(100);
  }, [setIsPlaying, setReplayPosition, updateReplayMarker]);

  // Get timestamp for replay position
  const getReplayTimestamp = useCallback(() => {
    if (!sightings || sightings.length === 0) return null;
    const validSightings = sightings.filter(s => s.lat && s.lon);
    const pos = getInterpolatedPosition(validSightings, replayPosition);
    if (!pos?.timestamp) return null;
    return new Date(pos.timestamp).toLocaleTimeString();
  }, [sightings, replayPosition, getInterpolatedPosition]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  // Cleanup map when hiding
  useEffect(() => {
    if (!showTrackMap && mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
      replayMarkerRef.current = null;
    }
  }, [showTrackMap]);

  // Empty state
  if (sightings.length === 0) {
    return (
      <div className="detail-history" id="panel-history" role="tabpanel" aria-labelledby="tab-history">
        <div className="detail-empty" role="status">
          <History size={48} aria-hidden="true" />
          <p>No sighting history</p>
          <span>No position reports recorded in the last 24 hours</span>
        </div>
      </div>
    );
  }

  return (
    <div className="detail-history" id="panel-history" role="tabpanel" aria-labelledby="tab-history">
      <div className="history-stats">
        <div className="history-header">
          <p aria-live="polite">{sightings.length} position reports in the last 24 hours</p>
          <button
            className={`map-toggle-btn ${showTrackMap ? 'active' : ''}`}
            onClick={() => setShowTrackMap(!showTrackMap)}
            aria-pressed={showTrackMap}
          >
            <MapIcon size={16} aria-hidden="true" />
            {showTrackMap ? 'Hide Map' : 'Show Map'}
          </button>
        </div>

        {showTrackMap && sightings.some(s => s.lat && s.lon) && (
          <div className="history-map-container">
            <div
              className="history-map"
              ref={(el) => {
                if (el && showTrackMap && !mapRef.current) {
                  setTimeout(() => initializeMap(el), 50);
                }
              }}
              role="application"
              aria-label="Flight history map"
            />

            <div className="flight-graphs">
              <div className="graphs-row">
                <MiniGraph
                  data={sightings}
                  dataKey="altitude"
                  color="#00ff88"
                  label="Altitude"
                  unit="ft"
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
                  formatFn={v => v?.toFixed(0)}
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
                  formatFn={v => (v > 0 ? '+' : '') + v}
                  graphZoom={graphZoom}
                  graphScrollOffset={graphScrollOffset}
                  onWheel={handleGraphWheel}
                  onDragStart={handleGraphDragStart}
                  onDragMove={handleGraphDragMove}
                  onDragEnd={handleGraphDragEnd}
                  onResetZoom={resetGraphZoom}
                />
              </div>
            </div>

            <ReplayControls
              isPlaying={isPlaying}
              position={replayPosition}
              timestamp={getReplayTimestamp()}
              onPlayToggle={togglePlay}
              onSkipToStart={skipToStart}
              onSkipToEnd={skipToEnd}
              onPositionChange={handleReplayChange}
              showSpeedControl={false}
            />

            <div className="history-map-legend">
              <div className="legend-item">
                <span className="legend-marker" style={{ background: '#00ff88' }}></span>
                <span>Current Position</span>
              </div>
              <div className="legend-item">
                <span className="legend-marker" style={{ background: '#ff8844' }}></span>
                <span>Start</span>
              </div>
              {feederLocation?.lat && (
                <div className="legend-item">
                  <span className="legend-marker" style={{ background: '#ff4444' }}></span>
                  <span>Feeder</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="history-table" role="table" aria-label="Position history">
          <div className="history-row header" role="row">
            <span role="columnheader">Time</span>
            <span role="columnheader">Alt (ft)</span>
            <span role="columnheader">Speed (kts)</span>
            <span role="columnheader">Dist (nm)</span>
          </div>
          {sightings.slice(0, 50).map((s, i) => (
            <div key={i} className="history-row" role="row">
              <span role="cell">{new Date(s.timestamp).toLocaleTimeString()}</span>
              <span role="cell">{s.altitude?.toLocaleString() || '--'}</span>
              <span role="cell">{s.gs?.toFixed(0) || '--'}</span>
              <span role="cell">{s.distance_nm?.toFixed(1) || '--'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
