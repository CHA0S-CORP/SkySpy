/**
 * Canvas click and double-click handlers extracted from MapView.jsx.
 *
 * These are pure functions (no hooks). Each receives the React synthetic event
 * and a params object containing the dependencies formerly captured via closure
 * inside the component.
 */

/**
 * Compute the common screen-geometry values that both handlers need.
 * @returns {{ rect, clickX, clickY, centerX, centerY, maxRadius, pixelsPerNm }}
 */
function computeClickGeometry(e, canvasRef, radarRange) {
  const rect = canvasRef.current.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const clickY = e.clientY - rect.top;
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const maxRadius = Math.min(rect.width, rect.height) * 0.45;
  const pixelsPerNm = maxRadius / radarRange;
  return { rect, clickX, clickY, centerX, centerY, maxRadius, pixelsPerNm };
}

/**
 * Build a helper that converts a lat/lon pair to canvas screen position.
 */
function makeGetScreenPos({
  centerX,
  centerY,
  pixelsPerNm,
  maxRadius,
  config,
  feederLat,
  feederLon,
  proPanOffset,
  radarRange,
  getBearing,
}) {
  return (lat, lon) => {
    const dLat = lat - feederLat;
    const dLon = lon - feederLon;
    const nmY = dLat * 60;
    const nmX = dLon * 60 * Math.cos((feederLat * Math.PI) / 180);

    if (config.mapMode === 'pro') {
      return {
        x: centerX + nmX * pixelsPerNm + proPanOffset.x,
        y: centerY - nmY * pixelsPerNm + proPanOffset.y,
      };
    } else {
      const dist = Math.sqrt(nmX * nmX + nmY * nmY);
      const bearing = getBearing(lat, lon);
      const radius = (dist / radarRange) * maxRadius;
      const rad = ((bearing - 90) * Math.PI) / 180;
      return {
        x: centerX + Math.cos(rad) * radius,
        y: centerY + Math.sin(rad) * radius,
      };
    }
  };
}

/**
 * onClick handler for the radar canvas.
 *
 * @param {React.MouseEvent} e - React synthetic mouse event
 * @param {object} params - all external dependencies
 */
export function handleCanvasClick(e, params) {
  const {
    canvasRef,
    config,
    radarRange,
    feederLat,
    feederLon,
    proPanOffset,
    measurementPoints,
    setMeasurementPoints,
    overlays,
    sortedAircraft,
    aviationData,
    airspaceTypeFilters,
    weatherAdvisoryFilters,
    getDistanceNm,
    getBearing,
    getTafForAirport,
    panelPinned,
    selectAircraft,
    setSelectedMetar,
    setSelectedPirep,
    setSelectedNavaid,
    setSelectedAirport,
    setSelectedAirspace,
    setSelectedTaf,
    setSelectedSigmet,
    setPopupPosition,
  } = params;

  const { rect, clickX, clickY, centerX, centerY, maxRadius, pixelsPerNm } = computeClickGeometry(
    e,
    canvasRef,
    radarRange
  );

  // Phase 1.2: Measurement tool (Shift+click)
  if (e.shiftKey && config.mapMode === 'pro') {
    // Convert click position to lat/lon
    const nmX = (clickX - centerX - proPanOffset.x) / pixelsPerNm;
    const nmY = -(clickY - centerY - proPanOffset.y) / pixelsPerNm;
    const clickLat = feederLat + nmY / 60;
    const clickLon = feederLon + nmX / (60 * Math.cos((feederLat * Math.PI) / 180));

    if (measurementPoints.length === 0) {
      // First point
      setMeasurementPoints([{ lat: clickLat, lon: clickLon }]);
    } else if (measurementPoints.length === 1) {
      // Second point
      setMeasurementPoints((prev) => [...prev, { lat: clickLat, lon: clickLon }]);
    } else {
      // Third click clears and starts new measurement
      setMeasurementPoints([{ lat: clickLat, lon: clickLon }]);
    }
    return; // Don't process as regular click
  }

  // Helper to convert lat/lon to screen position
  const getScreenPos = makeGetScreenPos({
    centerX,
    centerY,
    pixelsPerNm,
    maxRadius,
    config,
    feederLat,
    feederLon,
    proPanOffset,
    radarRange,
    getBearing,
  });

  let closest = null;
  let closestDist = 30;
  let closestType = null; // 'aircraft', 'metar', 'pirep', 'navaid', 'airport'

  // Check aircraft (if overlay enabled)
  if (overlays.aircraft) {
    sortedAircraft.forEach((ac) => {
      const dist = ac.distance_nm || getDistanceNm(ac.lat, ac.lon);
      if (config.mapMode === 'crt' && dist > radarRange) return;
      if (config.mapMode === 'pro' && dist > radarRange * 1.5) return;

      const pos = getScreenPos(ac.lat, ac.lon);
      const clickDist = Math.sqrt((clickX - pos.x) ** 2 + (clickY - pos.y) ** 2);
      if (clickDist < closestDist) {
        closestDist = clickDist;
        closest = ac;
        closestType = 'aircraft';
      }
    });
  }

  // Check METARs if enabled
  if (overlays.metars && aviationData.metars.length > 0) {
    aviationData.metars.forEach((metar) => {
      if (!metar.lat || !metar.lon) return;
      const pos = getScreenPos(metar.lat, metar.lon);
      if (pos.x < 0 || pos.x > rect.width || pos.y < 0 || pos.y > rect.height) return;

      const clickDist = Math.sqrt((clickX - pos.x) ** 2 + (clickY - pos.y) ** 2);
      if (clickDist < closestDist) {
        closestDist = clickDist;
        closest = metar;
        closestType = 'metar';
      }
    });
  }

  // Check PIREPs if enabled
  if (overlays.pireps && aviationData.pireps.length > 0) {
    aviationData.pireps.forEach((pirep) => {
      if (!pirep.lat || !pirep.lon) return;
      const pos = getScreenPos(pirep.lat, pirep.lon);
      if (pos.x < 0 || pos.x > rect.width || pos.y < 0 || pos.y > rect.height) return;

      const clickDist = Math.sqrt((clickX - pos.x) ** 2 + (clickY - pos.y) ** 2);
      if (clickDist < closestDist) {
        closestDist = clickDist;
        closest = pirep;
        closestType = 'pirep';
      }
    });
  }

  // Check Navaids if enabled (use fallback data if API data empty)
  if (overlays.vors) {
    const navAidsToCheck =
      aviationData.navaids.length > 0
        ? aviationData.navaids
        : [
            {
              id: 'SEA',
              name: 'Seattle VORTAC',
              lat: 47.435,
              lon: -122.309,
              type: 'VORTAC',
            },
            {
              id: 'PAE',
              name: 'Paine Field',
              lat: 47.906,
              lon: -122.283,
              type: 'VOR/DME',
            },
            {
              id: 'BFI',
              name: 'Boeing Field',
              lat: 47.529,
              lon: -122.302,
              type: 'VOR/DME',
            },
            {
              id: 'TCM',
              name: 'McChord',
              lat: 47.136,
              lon: -122.476,
              type: 'TACAN',
            },
            {
              id: 'OLM',
              name: 'Olympia',
              lat: 46.969,
              lon: -122.902,
              type: 'VOR/DME',
            },
            {
              id: 'EPH',
              name: 'Ephrata',
              lat: 47.385,
              lon: -119.515,
              type: 'VOR/DME',
            },
            {
              id: 'ELN',
              name: 'Ellensburg',
              lat: 47.033,
              lon: -120.53,
              type: 'VOR/DME',
            },
            {
              id: 'YYJ',
              name: 'Victoria',
              lat: 48.647,
              lon: -123.426,
              type: 'VOR/DME',
            },
            {
              id: 'CV',
              name: 'Coupeville',
              lat: 48.188,
              lon: -122.688,
              type: 'NDB',
            },
            {
              id: 'BTG',
              name: 'Battleground',
              lat: 45.816,
              lon: -122.531,
              type: 'VOR/DME',
            },
            {
              id: 'UBG',
              name: 'Bellingham',
              lat: 48.795,
              lon: -122.538,
              type: 'VOR/DME',
            },
            {
              id: 'GEG',
              name: 'Spokane',
              lat: 47.625,
              lon: -117.539,
              type: 'VORTAC',
            },
          ];
    navAidsToCheck.forEach((nav) => {
      if (!nav.lat || !nav.lon) return;
      const pos = getScreenPos(nav.lat, nav.lon);
      if (pos.x < 0 || pos.x > rect.width || pos.y < 0 || pos.y > rect.height) return;

      const clickDist = Math.sqrt((clickX - pos.x) ** 2 + (clickY - pos.y) ** 2);
      if (clickDist < closestDist) {
        closestDist = clickDist;
        closest = nav;
        closestType = 'navaid';
      }
    });
  }

  // Check Airports if enabled (use fallback data if API data empty)
  if (overlays.airports) {
    const airportsToCheck =
      aviationData.airports.length > 0
        ? aviationData.airports
        : [
            {
              icao: 'KSEA',
              name: 'Seattle-Tacoma',
              lat: 47.449,
              lon: -122.309,
              class: 'B',
            },
            {
              icao: 'KBFI',
              name: 'Boeing Field',
              lat: 47.529,
              lon: -122.302,
              class: 'D',
            },
            {
              icao: 'KPAE',
              name: 'Paine Field',
              lat: 47.906,
              lon: -122.283,
              class: 'D',
            },
            {
              icao: 'KPDX',
              name: 'Portland Intl',
              lat: 45.589,
              lon: -122.597,
              class: 'C',
            },
            {
              icao: 'KGEG',
              name: 'Spokane',
              lat: 47.62,
              lon: -117.534,
              class: 'C',
            },
          ];
    airportsToCheck.forEach((apt) => {
      if (!apt.lat || !apt.lon) return;
      const pos = getScreenPos(apt.lat, apt.lon);
      if (pos.x < 0 || pos.x > rect.width || pos.y < 0 || pos.y > rect.height) return;

      const clickDist = Math.sqrt((clickX - pos.x) ** 2 + (clickY - pos.y) ** 2);
      if (clickDist < closestDist) {
        closestDist = clickDist;
        closest = apt;
        closestType = 'airport';
      }
    });
  }

  // Check Airspaces if enabled - use point-in-polygon test
  if (overlays.airspace) {
    // Compute filtered airspace data inline (same logic as canvas rendering)
    const rawAirspaces = [...(aviationData.airspaces || []), ...(aviationData.boundaries || [])];
    const filteredAirspaces = rawAirspaces.filter((as) => {
      const asClass = as.class || as.airspace_class || as.type?.replace('CLASS_', '') || '';
      if (airspaceTypeFilters[asClass] !== undefined) {
        return airspaceTypeFilters[asClass];
      }
      // For G-AIRMETs and other advisories, filter by hazard type
      if (as.isAdvisory && as.hazard) {
        if (weatherAdvisoryFilters[as.hazard] !== undefined) {
          return weatherAdvisoryFilters[as.hazard];
        }
      }
      return true;
    });
    filteredAirspaces.forEach((as) => {
      // Get polygon coordinates
      let polygonCoords = null;
      if (as.polygon) {
        if (Array.isArray(as.polygon) && as.polygon.length >= 3) {
          polygonCoords = as.polygon;
        } else if (as.polygon.type === 'Polygon' && as.polygon.coordinates?.[0]) {
          polygonCoords = as.polygon.coordinates[0];
        } else if (as.polygon.type === 'MultiPolygon' && as.polygon.coordinates?.[0]?.[0]) {
          polygonCoords = as.polygon.coordinates[0][0];
        }
      }

      if (!polygonCoords || polygonCoords.length < 3) return;

      // Convert click position to lat/lon
      const clickLat = feederLat + ((centerY - clickY + proPanOffset.y) / pixelsPerNm) * (1 / 60);
      const clickLon =
        feederLon +
        ((clickX - centerX - proPanOffset.x) / pixelsPerNm) *
          (1 / 60) *
          (1 / Math.cos((feederLat * Math.PI) / 180));

      // Point-in-polygon test (ray casting algorithm)
      let inside = false;
      for (let i = 0, j = polygonCoords.length - 1; i < polygonCoords.length; j = i++) {
        const xi = Array.isArray(polygonCoords[i]) ? polygonCoords[i][0] : polygonCoords[i].lon;
        const yi = Array.isArray(polygonCoords[i]) ? polygonCoords[i][1] : polygonCoords[i].lat;
        const xj = Array.isArray(polygonCoords[j]) ? polygonCoords[j][0] : polygonCoords[j].lon;
        const yj = Array.isArray(polygonCoords[j]) ? polygonCoords[j][1] : polygonCoords[j].lat;

        if (
          yi > clickLat !== yj > clickLat &&
          clickLon < ((xj - xi) * (clickLat - yi)) / (yj - yi) + xi
        ) {
          inside = !inside;
        }
      }

      if (inside) {
        // Don't override aircraft selections - aircraft have priority
        if (closestType === 'aircraft') return;

        // Use center distance as priority (closer centers = higher priority)
        const centerLat = as.center_lat || as.lat;
        const centerLon = as.center_lon || as.lon;
        if (centerLat && centerLon) {
          const centerPos = getScreenPos(centerLat, centerLon);
          const clickDist = Math.sqrt((clickX - centerPos.x) ** 2 + (clickY - centerPos.y) ** 2);
          // Only select airspace if nothing else is close (closestDist > 30)
          if (closestDist > 30) {
            closestDist = Math.min(clickDist, 25); // Cap distance for polygon items
            closest = as;
            closestType = 'airspace';
          }
        } else if (closestDist > 30) {
          // No center, just select if inside and nothing else is close
          closest = as;
          closestType = 'airspace';
          closestDist = 20;
        }
      }
    });
  }

  // Handle click based on type
  if (closest) {
    // Only clear aircraft selection if not pinned, or if selecting a new aircraft
    if (!panelPinned || closestType === 'aircraft') {
      selectAircraft(null);
    }
    setSelectedMetar(null);
    setSelectedPirep(null);
    setSelectedNavaid(null);
    setSelectedAirport(null);
    setSelectedAirspace(null);
    setSelectedTaf(null);
    setSelectedSigmet(null);

    if (closestType === 'aircraft') {
      selectAircraft(closest);
    } else if (closestType === 'metar') {
      setSelectedMetar(closest);
    } else if (closestType === 'pirep') {
      setSelectedPirep(closest);
    } else if (closestType === 'navaid') {
      setSelectedNavaid(closest);
    } else if (closestType === 'airport') {
      setSelectedAirport(closest);
      // Also show TAF if available for this airport
      if (overlays.tafs) {
        const aptTaf = getTafForAirport(closest);
        if (aptTaf) {
          setSelectedTaf(aptTaf);
        }
      }
    } else if (closestType === 'airspace') {
      setSelectedAirspace(closest);
    } else if (closestType === 'sigmet') {
      setSelectedSigmet(closest);
    }
  } else {
    // Clicked on empty area - clear all selections (unless panel is pinned)
    if (!panelPinned) {
      selectAircraft(null);
    }
    setSelectedMetar(null);
    setSelectedTaf(null);
    setSelectedPirep(null);
    setSelectedNavaid(null);
    setSelectedAirport(null);
    setSelectedAirspace(null);
    setSelectedSigmet(null);
  }
}

/**
 * onDoubleClick handler for the radar canvas.
 *
 * @param {React.MouseEvent} e - React synthetic mouse event
 * @param {object} params - all external dependencies
 */
export function handleCanvasDoubleClick(e, params) {
  const {
    canvasRef,
    config,
    radarRange,
    feederLat,
    feederLon,
    proPanOffset,
    overlays,
    sortedAircraft,
    getDistanceNm,
    getBearing,
    openAircraftSidebar,
    setFollowingAircraft,
    animatePanTo,
  } = params;

  const { clickX, clickY, centerX, centerY, maxRadius, pixelsPerNm } = computeClickGeometry(
    e,
    canvasRef,
    radarRange
  );

  const getScreenPos = makeGetScreenPos({
    centerX,
    centerY,
    pixelsPerNm,
    maxRadius,
    config,
    feederLat,
    feederLon,
    proPanOffset,
    radarRange,
    getBearing,
  });

  let closestAircraft = null;
  let closestDist = 30;

  if (overlays.aircraft) {
    sortedAircraft.forEach((ac) => {
      const dist = ac.distance_nm || getDistanceNm(ac.lat, ac.lon);
      if (config.mapMode === 'crt' && dist > radarRange) return;
      if (config.mapMode === 'pro' && dist > radarRange * 1.5) return;

      const pos = getScreenPos(ac.lat, ac.lon);
      const clickDist = Math.sqrt((clickX - pos.x) ** 2 + (clickY - pos.y) ** 2);
      if (clickDist < closestDist) {
        closestDist = clickDist;
        closestAircraft = ac;
      }
    });
  }

  if (closestAircraft) {
    openAircraftSidebar(closestAircraft.hex);
  } else if (config.mapMode === 'pro') {
    // Phase 1.3: Double-click on empty space to center
    const newPanX = proPanOffset.x - (clickX - centerX);
    const newPanY = proPanOffset.y - (clickY - centerY);
    setFollowingAircraft(null);
    animatePanTo(newPanX, newPanY);
  }
}
