import { useEffect, useRef } from 'react';
import L from 'leaflet';

/**
 * Manages the Leaflet map instance, aircraft markers, short track polylines,
 * and the feeder location marker. Extracted from MapView.jsx.
 *
 * @param {Object} params
 * @param {Object} params.config - { mapMode, mapDarkMode, shortTrackLength }
 * @param {Object} params.mapRef - DOM ref for the map container element
 * @param {number} params.feederLat
 * @param {number} params.feederLon
 * @param {Array} params.sortedAircraft
 * @param {Array} params.safetyEvents
 * @param {Object} params.positionsRef - ref to interpolated positions
 * @param {boolean} params.showShortTracks
 * @param {Object} params.shortTrackHistory
 * @param {Object} params.trackHistory
 * @param {Function} params.selectAircraft - callback
 * @param {Function} params.openAircraftSidebar - callback
 * @param {Function} params.setViewportCenter - state setter
 * @param {Object} params.initialCenterRef - ref
 * @param {Object} params.initialZoomRef - ref
 * @param {Object} params.feederLatRef - ref
 * @param {Object} params.feederLonRef - ref
 * @param {Object} params.setHashParamsRef - ref containing the setHashParams function
 * @param {Object} params.viewportUpdateTimeoutRef - ref for debounce timer
 * @returns {{ leafletMapRef: React.MutableRefObject }}
 */
export function useLeafletMap({
  config,
  mapRef,
  feederLat,
  feederLon,
  sortedAircraft,
  safetyEvents,
  positionsRef,
  showShortTracks,
  shortTrackHistory,
  trackHistory,
  selectAircraft,
  openAircraftSidebar,
  setViewportCenter,
  initialCenterRef,
  initialZoomRef,
  feederLatRef,
  feederLonRef,
  setHashParamsRef,
  viewportUpdateTimeoutRef,
}) {
  const leafletMapRef = useRef(null);
  const markersRef = useRef({});
  const shortTrackPolylinesRef = useRef({});
  const feederMarkerRef = useRef(null);

  // Leaflet map setup
  useEffect(() => {
    if (config.mapMode !== 'map' || !mapRef.current) return;

    if (!leafletMapRef.current) {
      // Use initial center from URL if available, otherwise use feeder location
      const center = initialCenterRef.current
        ? [initialCenterRef.current.lat, initialCenterRef.current.lon]
        : [feederLat, feederLon];
      const zoom = initialZoomRef.current || 8;

      leafletMapRef.current = L.map(mapRef.current, {
        center,
        zoom,
        zoomControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
      }).addTo(leafletMapRef.current);

      // Add feeder marker
      const feederIcon = L.divIcon({
        className: 'feeder-marker',
        html: `<div style="width: 12px; height: 12px; background: #00ff88; border: 2px solid #004422; border-radius: 50%; box-shadow: 0 0 10px #00ff88;"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });
      feederMarkerRef.current = L.marker(center, { icon: feederIcon })
        .addTo(leafletMapRef.current)
        .bindTooltip('Feeder Location', { permanent: false });

      // Update viewport center on map move/zoom for dynamic aviation data loading and URL sync
      const handleViewportChange = () => {
        // Debounce viewport updates to avoid excessive API calls and URL spam
        if (viewportUpdateTimeoutRef.current) {
          clearTimeout(viewportUpdateTimeoutRef.current);
        }
        viewportUpdateTimeoutRef.current = setTimeout(() => {
          const mapCenter = leafletMapRef.current?.getCenter();
          const mapZoom = leafletMapRef.current?.getZoom();
          if (mapCenter) {
            setViewportCenter({ lat: mapCenter.lat, lon: mapCenter.lng });

            // Update URL with center if significantly different from feeder location
            // Use refs to get latest values
            const currentFeederLat = feederLatRef.current;
            const currentFeederLon = feederLonRef.current;
            const latDiff = Math.abs(mapCenter.lat - currentFeederLat);
            const lonDiff = Math.abs(mapCenter.lng - currentFeederLon);
            const zoomDiff = Math.abs(mapZoom - 8);

            // Use ref to get latest setHashParams function
            const updateHash = setHashParamsRef.current;
            if (updateHash && (latDiff > 0.01 || lonDiff > 0.01 || zoomDiff > 0)) {
              updateHash({
                lat: mapCenter.lat.toFixed(4),
                lon: mapCenter.lng.toFixed(4),
                zoom: String(mapZoom),
              });
            } else if (updateHash && latDiff <= 0.01 && lonDiff <= 0.01 && zoomDiff === 0) {
              // Clear center params if back to default
              updateHash({ lat: undefined, lon: undefined, zoom: undefined });
            }
          }
        }, 500); // 500ms debounce
      };

      leafletMapRef.current.on('moveend', handleViewportChange);
      leafletMapRef.current.on('zoomend', handleViewportChange);

      setTimeout(() => {
        leafletMapRef.current?.invalidateSize();
      }, 100);
    }

    const tilePane = leafletMapRef.current.getPane('tilePane');
    if (tilePane) {
      if (config.mapDarkMode) {
        tilePane.classList.add('dark-tiles');
      } else {
        tilePane.classList.remove('dark-tiles');
      }
    }

    return () => {
      // Clean up viewport update timeout
      if (viewportUpdateTimeoutRef.current) {
        clearTimeout(viewportUpdateTimeoutRef.current);
      }
      // Always clean up map on effect re-run or unmount
      if (leafletMapRef.current) {
        leafletMapRef.current.off('moveend');
        leafletMapRef.current.off('zoomend');
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
        markersRef.current = {};
        shortTrackPolylinesRef.current = {};
        feederMarkerRef.current = null;
      }
    };
  }, [config.mapMode, config.mapDarkMode]);

  // Leaflet marker creation/removal (runs when aircraft list changes)
  useEffect(() => {
    if (config.mapMode !== 'map' || !leafletMapRef.current) return;

    // Only the top 150 aircraft (already priority-sorted) get markers; keep the
    // removal set consistent with the creation cap so markers for aircraft that
    // fall out of the displayed set don't linger as stale blips.
    const displayedAircraft = sortedAircraft.slice(0, 150);
    const displayedHexes = new Set(displayedAircraft.map((a) => a.hex));

    // Remove markers for aircraft no longer present or beyond the display cap
    Object.keys(markersRef.current).forEach((hex) => {
      if (!displayedHexes.has(hex)) {
        try {
          markersRef.current[hex]?.remove();
        } catch (e) {
          // Already removed
        }
        delete markersRef.current[hex];
      }
    });

    // Build set of aircraft with safety events for z-index priority
    const safetyAircraftHexes = new Set();
    safetyEvents.forEach((event) => {
      if (event.icao) safetyAircraftHexes.add(event.icao.toUpperCase());
      if (event.icao_2) safetyAircraftHexes.add(event.icao_2.toUpperCase());
    });

    // Create markers for new aircraft (positions updated by animation loop below)
    displayedAircraft.forEach((ac) => {
      if (!ac.lat || !ac.lon) return;

      const hasSafetyEvent = safetyAircraftHexes.has(ac.hex?.toUpperCase());
      const color = ac.emergency ? '#f85149' : ac.military ? '#a371f7' : '#00d4ff';
      const rotation = ac.track || 0;

      const icon = L.divIcon({
        className: `aircraft-marker${hasSafetyEvent ? ' safety-event' : ''}`,
        html: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="transform: rotate(${rotation}deg); filter: drop-shadow(0 0 4px ${color});">
          <path d="M12 2L4 12l8 2 8-2-8-10z" fill="${color}" stroke="${color}" stroke-width="1"/>
          <path d="M12 14v8M8 18l4 2 4-2" stroke="${color}" stroke-width="1.5"/>
        </svg>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      // Set higher z-index for aircraft with safety events or emergencies
      const zOffset = hasSafetyEvent ? 2000 : ac.emergency ? 1000 : 0;

      // Bug fix #1 & #3: Add null check before marker methods
      const existingMarker = markersRef.current[ac.hex];
      if (existingMarker) {
        // Update icon and z-index (position updated by animation loop)
        existingMarker.setIcon(icon);
        existingMarker.setZIndexOffset(zOffset);
      } else {
        const marker = L.marker([ac.lat, ac.lon], { icon, zIndexOffset: zOffset })
          .addTo(leafletMapRef.current)
          .on('click', () => selectAircraft(ac))
          .on('dblclick', () => openAircraftSidebar(ac.hex));
        // Bug fix #10: Handle edge cases for tooltip - fallback for both flight and hex being falsy,
        // and properly handle altitude 0 (valid) vs null/undefined
        const displayName = ac.flight?.trim() || ac.hex || 'Unknown';
        const displayAlt = ac.alt != null ? `${ac.alt}ft` : '?';
        marker.bindTooltip(`${displayName}<br>${displayAlt}`, {
          permanent: false,
          direction: 'top',
        });
        markersRef.current[ac.hex] = marker;
      }
    });
  }, [sortedAircraft, config.mapMode, safetyEvents]);

  // High-frequency Leaflet marker position updates using positionsRef
  // This runs in a requestAnimationFrame loop for smooth interpolated movement
  useEffect(() => {
    // Bug fix #6: Add null check for positionsRef before accessing .current
    if (config.mapMode !== 'map' || !leafletMapRef.current || !positionsRef) return;

    let animFrameId = null;

    const updateMarkerPositions = () => {
      // Bug fix #6: Verify positionsRef still exists before accessing .current
      if (!positionsRef) {
        return; // Stop the loop if positionsRef becomes null
      }
      const positions = positionsRef.current;
      if (!positions) {
        animFrameId = requestAnimationFrame(updateMarkerPositions);
        return;
      }

      // Update marker positions from interpolated data
      // Bug fix #1: Verify markersRef.current exists
      if (!markersRef.current) {
        animFrameId = requestAnimationFrame(updateMarkerPositions);
        return;
      }

      for (const hex in markersRef.current) {
        const marker = markersRef.current[hex];
        if (!marker) continue;

        const interpolated = positions[hex] || positions[hex.toUpperCase()];
        if (interpolated && interpolated.lat != null && interpolated.lon != null) {
          try {
            marker.setLatLng([interpolated.lat, interpolated.lon]);

            // Update icon rotation if track changed significantly
            if (interpolated.track != null) {
              const currentIcon = marker.getIcon();
              if (currentIcon && currentIcon.options && currentIcon.options.html) {
                // Extract current rotation from icon HTML
                const match = currentIcon.options.html.match(/rotate\(([0-9.]+)deg\)/);
                const currentRotation = match ? parseFloat(match[1]) : 0;
                const newRotation = interpolated.track;

                // Only update icon if rotation changed by more than 2 degrees
                let diff = Math.abs(newRotation - currentRotation);
                if (diff > 180) diff = 360 - diff;
                if (diff > 2) {
                  const newHtml = currentIcon.options.html.replace(
                    /rotate\([0-9.]+deg\)/,
                    `rotate(${newRotation}deg)`
                  );
                  marker.setIcon(
                    L.divIcon({
                      ...currentIcon.options,
                      html: newHtml,
                    })
                  );
                }
              }
            }
          } catch (e) {
            // Marker was removed, skip
            continue;
          }
        }
      }

      animFrameId = requestAnimationFrame(updateMarkerPositions);
    };

    animFrameId = requestAnimationFrame(updateMarkerPositions);

    return () => {
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
      }
    };
  }, [config.mapMode, positionsRef]);

  // Leaflet polyline updates for short tracks in map mode
  useEffect(() => {
    if (config.mapMode !== 'map' || !leafletMapRef.current) return;

    // Remove all polylines if short tracks disabled
    if (!showShortTracks) {
      Object.values(shortTrackPolylinesRef.current).forEach((polyline) => polyline.remove());
      shortTrackPolylinesRef.current = {};
      return;
    }

    // Same display cap as markers: prune polylines that fall out of the top 150
    const currentHexes = new Set(sortedAircraft.slice(0, 150).map((a) => a.hex));
    const now = Date.now();
    const trackLength = config.shortTrackLength || 15;
    const maxAge = trackLength * 6000; // ~6 seconds per position

    // Remove polylines for aircraft no longer present or beyond the display cap
    Object.keys(shortTrackPolylinesRef.current).forEach((hex) => {
      if (!currentHexes.has(hex)) {
        shortTrackPolylinesRef.current[hex].remove();
        delete shortTrackPolylinesRef.current[hex];
      }
    });

    // Update or create polylines for each aircraft
    sortedAircraft.slice(0, 150).forEach((ac) => {
      if (!ac.lat || !ac.lon || !ac.hex) return;

      // Combine historical and realtime positions
      const historicPositions = shortTrackHistory[ac.hex] || [];
      const realtimePositions = trackHistory[ac.hex] || [];

      const allPositions = [
        ...historicPositions.filter((p) => now - p.time < maxAge),
        ...realtimePositions.filter((p) => now - p.time < maxAge),
      ].sort((a, b) => a.time - b.time);

      // Keep only last N positions (configurable)
      const positions = allPositions.slice(-trackLength);

      if (positions.length < 2) {
        // Remove existing polyline if not enough points
        if (shortTrackPolylinesRef.current[ac.hex]) {
          shortTrackPolylinesRef.current[ac.hex].remove();
          delete shortTrackPolylinesRef.current[ac.hex];
        }
        return;
      }

      const latlngs = positions.map((p) => [p.lat, p.lon]);
      const color = '#ffffff';

      if (shortTrackPolylinesRef.current[ac.hex]) {
        shortTrackPolylinesRef.current[ac.hex].setLatLngs(latlngs);
      } else {
        const polyline = L.polyline(latlngs, {
          color: color,
          weight: 2,
          opacity: 0.5,
          dashArray: '4, 4',
        }).addTo(leafletMapRef.current);
        shortTrackPolylinesRef.current[ac.hex] = polyline;
      }
    });
  }, [
    sortedAircraft,
    config.mapMode,
    config.shortTrackLength,
    showShortTracks,
    shortTrackHistory,
    trackHistory,
  ]);

  return { leafletMapRef };
}
