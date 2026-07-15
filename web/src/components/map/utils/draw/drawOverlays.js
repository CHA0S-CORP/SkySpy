/**
 * Aviation overlay drawing functions extracted from MapView.jsx
 *
 * Each function takes (ctx, geo, data) where:
 *   ctx  = Canvas 2D rendering context
 *   geo  = { width, height, centerX, centerY, maxRadius, isPro, radarRange, themeColors,
 *            latLonToScreen, feederLat, feederLon, proPanOffset, frameCount }
 *   data = overlay-specific data object (see individual function signatures)
 */

// ---------------------------------------------------------------------------
// 1. Weather Radar
// ---------------------------------------------------------------------------

/**
 * Draw weather radar tile overlay (underneath other layers).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geo
 * @param {object} data
 * @param {object} data.overlays            - Overlay toggle map
 * @param {HTMLImageElement} data.weatherRadarImage
 * @param {object} data.weatherRadarBounds
 * @param {object} data.layerOpacities
 * @param {Function} data.drawWeatherRadar  - Callback that paints the radar image
 */
export function drawWeatherRadarOverlay(ctx, geo, data) {
  const { isPro, latLonToScreen } = geo;
  const { overlays, weatherRadarImage, weatherRadarBounds, layerOpacities, drawWeatherRadar } =
    data;

  if (isPro && overlays.radar && weatherRadarImage && weatherRadarBounds) {
    const radarOpacity = layerOpacities.radar ?? 0.5;
    drawWeatherRadar(ctx, latLonToScreen, radarOpacity);
  }
}

// ---------------------------------------------------------------------------
// 2. Convective SIGMETs
// ---------------------------------------------------------------------------

/**
 * Draw convective SIGMET polygon outlines (above radar, below terrain).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geo
 * @param {object} data
 * @param {object} data.overlays
 * @param {Array}  data.convectiveSigmets
 * @param {object} data.layerOpacities
 * @param {object|null} data.selectedSigmet
 * @param {Function} data.drawSigmets       - Callback that paints sigmet polygons
 */
export function drawConvectiveSigmetPolygons(ctx, geo, data) {
  const { isPro, latLonToScreen } = geo;
  const { overlays, convectiveSigmets, layerOpacities, drawSigmets } = data;

  if (isPro && overlays.convectiveSigmets && convectiveSigmets.length > 0) {
    const sigmetOpacity = layerOpacities.convectiveSigmets ?? 0.8;
    drawSigmets(ctx, latLonToScreen, sigmetOpacity);
  }
}

// ---------------------------------------------------------------------------
// 3. Terrain Boundaries
// ---------------------------------------------------------------------------

/**
 * Draw a GeoJSON-style polygon/line path on the canvas.
 * Local helper used by drawTerrainBoundaries.
 */
function drawBoundaryPath(ctx, latLonToScreen, coords, strokeColor, fillColor = null, lineWidth = 1) {
  if (!coords || coords.length < 2) return;
  ctx.beginPath();
  coords.forEach((coord, i) => {
    const pos = latLonToScreen(coord[1], coord[0]); // GeoJSON is [lon, lat]
    if (i === 0) {
      ctx.moveTo(pos.x, pos.y);
    } else {
      ctx.lineTo(pos.x, pos.y);
    }
  });
  if (fillColor) {
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
  if (strokeColor) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

/**
 * Draw terrain overlays: water bodies, country/state/county boundaries,
 * and aviation GeoJSON layers (ARTCC, refueling tracks, military zones, etc.).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geo
 * @param {object} data
 * @param {object} data.overlays
 * @param {object} data.terrainData           - { water, countries, states, counties }
 * @param {object} data.aviationOverlayData   - { usArtcc, usRefueling, ukMilZones, euMilAwacs, trainingAreas }
 * @param {object} data.layerOpacities
 */
export function drawTerrainBoundaries(ctx, geo, data) {
  const { isPro, latLonToScreen } = geo;
  const { overlays, terrainData, aviationOverlayData } = data;

  if (!isPro) return;

  const _draw = (coords, stroke, fill = null, lw = 1) =>
    drawBoundaryPath(ctx, latLonToScreen, coords, stroke, fill, lw);

  // Water bodies (lakes, coastlines) - subtle blue
  if (overlays.water && terrainData.water?.length > 0) {
    terrainData.water.forEach((feature) => {
      if (feature.type === 'polygon') {
        _draw(
          feature.coords,
          'rgba(40, 120, 180, 0.5)',
          'rgba(20, 60, 100, 0.25)',
          1
        );
      } else {
        _draw(feature.coords, 'rgba(40, 120, 180, 0.4)', null, 1);
      }
    });
  }

  // Country boundaries - subtle white/gray
  if (overlays.countries && terrainData.countries?.length > 0) {
    terrainData.countries.forEach((feature) => {
      _draw(feature.coords, 'rgba(180, 180, 180, 0.5)', null, 1.5);
    });
  }

  // State/province boundaries - lighter
  if (overlays.states && terrainData.states?.length > 0) {
    terrainData.states.forEach((feature) => {
      _draw(feature.coords, 'rgba(120, 160, 200, 0.4)', null, 1);
    });
  }

  // County boundaries - very subtle
  if (overlays.counties && terrainData.counties?.length > 0) {
    terrainData.counties.forEach((feature) => {
      _draw(feature.coords, 'rgba(100, 130, 160, 0.25)', null, 0.5);
    });
  }

  // Aviation overlays - tar1090 GeoJSON data
  // US ARTCC boundaries - cyan dashed lines
  if (overlays.usArtcc && aviationOverlayData.usArtcc?.length > 0) {
    ctx.save();
    ctx.setLineDash([8, 4]);
    aviationOverlayData.usArtcc.forEach((feature) => {
      _draw(feature.coords, 'rgba(0, 200, 255, 0.6)', null, 1.5);
    });
    ctx.setLineDash([]);
    ctx.restore();
  }

  // US A2A Refueling tracks - yellow/orange lines
  if (overlays.usRefueling && aviationOverlayData.usRefueling?.length > 0) {
    ctx.save();
    ctx.setLineDash([6, 3]);
    aviationOverlayData.usRefueling.forEach((feature) => {
      if (feature.type === 'polygon') {
        _draw(
          feature.coords,
          'rgba(255, 180, 0, 0.7)',
          'rgba(255, 180, 0, 0.15)',
          2
        );
      } else {
        _draw(feature.coords, 'rgba(255, 180, 0, 0.8)', null, 2);
      }
    });
    ctx.setLineDash([]);
    ctx.restore();
  }

  // UK Military zones - magenta/purple
  if (overlays.ukMilZones && aviationOverlayData.ukMilZones?.length > 0) {
    ctx.save();
    ctx.setLineDash([5, 3]);
    aviationOverlayData.ukMilZones.forEach((feature) => {
      const isAwacs = feature.sourceType?.includes('awacs');
      const isAar = feature.sourceType?.includes('aar');
      if (isAwacs) {
        // AWACS orbits - purple dashed circles/polygons
        _draw(
          feature.coords,
          'rgba(180, 100, 255, 0.7)',
          'rgba(180, 100, 255, 0.1)',
          2
        );
      } else if (isAar) {
        // AAR zones - magenta
        _draw(
          feature.coords,
          'rgba(255, 50, 150, 0.7)',
          'rgba(255, 50, 150, 0.1)',
          2
        );
      } else {
        // RC (restricted/controlled) - red
        _draw(
          feature.coords,
          'rgba(255, 80, 80, 0.6)',
          'rgba(255, 80, 80, 0.1)',
          1.5
        );
      }
    });
    ctx.setLineDash([]);
    ctx.restore();
  }

  // EU AWACS orbits - purple circles
  if (overlays.euMilAwacs && aviationOverlayData.euMilAwacs?.length > 0) {
    ctx.save();
    ctx.setLineDash([5, 3]);
    aviationOverlayData.euMilAwacs.forEach((feature) => {
      _draw(
        feature.coords,
        'rgba(160, 80, 220, 0.7)',
        'rgba(160, 80, 220, 0.1)',
        2
      );
    });
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Training areas - green
  if (overlays.trainingAreas && aviationOverlayData.trainingAreas?.length > 0) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    aviationOverlayData.trainingAreas.forEach((feature) => {
      const isRoute = feature.sourceType?.includes('route');
      if (isRoute) {
        // Nav routes - green lines
        _draw(feature.coords, 'rgba(50, 200, 100, 0.8)', null, 2);
      } else {
        // Training areas - green polygons
        _draw(
          feature.coords,
          'rgba(50, 200, 100, 0.6)',
          'rgba(50, 200, 100, 0.1)',
          1.5
        );
      }
    });
    ctx.setLineDash([]);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// 4. Navaids (VORs, TACANs, NDBs)
// ---------------------------------------------------------------------------

/**
 * Draw VOR, TACAN, and NDB navaid symbols with labels.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geo
 * @param {object} data
 * @param {object} data.overlays
 * @param {Array}  data.navAids
 * @param {object|null} data.selectedNavaid
 * @param {Function} data.getDistanceNm  - (lat, lon) => distance in NM
 */
export function drawNavaids(ctx, geo, data) {
  const { width, height, isPro, radarRange, latLonToScreen } = geo;
  const { overlays, navAids, selectedNavaid, getDistanceNm } = data;

  if (!overlays.vors) return;

  navAids.forEach((nav) => {
    const dist = getDistanceNm(nav.lat, nav.lon);
    if (!isPro && dist > radarRange * 1.1) return;
    if (isPro && dist > radarRange * 1.5) return;

    const pos = latLonToScreen(nav.lat, nav.lon);
    const x = pos.x;
    const y = pos.y;

    // Skip if outside canvas
    if (x < 0 || x > width || y < 0 || y > height) return;

    // Check if selected
    const isSelected =
      selectedNavaid && selectedNavaid.lat === nav.lat && selectedNavaid.lon === nav.lon;

    // Draw selection indicator
    if (isSelected) {
      ctx.save();
      ctx.strokeStyle = 'rgba(100, 220, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Draw VOR symbol (hexagon)
    const vorSize = isPro ? 9 : 8;
    ctx.save();
    ctx.translate(x, y);

    const navType = nav.type || '';
    const baseColor = isSelected ? 1.0 : 0.7;
    if (navType.includes('VORTAC') || navType.includes('VOR')) {
      // Hexagon for VOR
      ctx.strokeStyle = isPro
        ? `rgba(80, 140, 220, ${baseColor + 0.1})`
        : `rgba(100, 150, 255, ${baseColor})`;
      ctx.lineWidth = isSelected ? 2 : 1.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = ((i * 60 - 30) * Math.PI) / 180;
        const px = Math.cos(angle) * vorSize;
        const py = Math.sin(angle) * vorSize;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();

      // Center dot
      ctx.fillStyle = isPro
        ? `rgba(80, 140, 220, ${baseColor + 0.2})`
        : `rgba(100, 150, 255, ${baseColor + 0.1})`;
      ctx.beginPath();
      ctx.arc(0, 0, 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (navType.includes('TACAN')) {
      // Triangle for TACAN
      ctx.strokeStyle = `rgba(255, 150, 100, ${baseColor})`;
      ctx.lineWidth = isSelected ? 2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -vorSize);
      ctx.lineTo(vorSize * 0.866, vorSize * 0.5);
      ctx.lineTo(-vorSize * 0.866, vorSize * 0.5);
      ctx.closePath();
      ctx.stroke();
    } else if (navType.includes('NDB')) {
      // Circle with dots for NDB
      ctx.strokeStyle = `rgba(200, 100, 255, ${baseColor - 0.1})`;
      ctx.lineWidth = isSelected ? 1.5 : 1;
      ctx.beginPath();
      ctx.arc(0, 0, vorSize, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();

    // Label with background
    ctx.font = isSelected
      ? 'bold 12px "JetBrains Mono", monospace'
      : '12px "JetBrains Mono", monospace';
    const navLabelWidth = ctx.measureText(nav.id).width + 6;
    ctx.fillStyle = isPro ? 'rgba(10, 13, 18, 0.8)' : 'rgba(10, 15, 10, 0.75)';
    ctx.fillRect(x + 7, y - 6, navLabelWidth, 16);
    ctx.fillStyle = isPro
      ? `rgba(80, 140, 220, ${baseColor + 0.1})`
      : `rgba(100, 150, 255, ${baseColor})`;
    ctx.textAlign = 'left';
    ctx.fillText(nav.id, x + 10, y + 4);
  });
}

// ---------------------------------------------------------------------------
// 5. Airports
// ---------------------------------------------------------------------------

/**
 * Draw airport symbols with runway markers, flight category coloring, and TAF indicators.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geo
 * @param {object} data
 * @param {object}   data.overlays
 * @param {Array}    data.airports
 * @param {object}   data.aviationData         - { metars, ... }
 * @param {Set|null} data.stationsWithTaf
 * @param {object|null} data.selectedAirport
 * @param {Function} data.findMetarForAirport  - (apt, metars) => metar|null
 * @param {Function} data.getFlightCategoryColor - (metar, isFill) => color string
 * @param {Function} data.getDistanceNm
 * @param {Function} data.getTafForAirport     - (apt) => taf|null
 */
export function drawAirports(ctx, geo, data) {
  const { width, height, isPro, radarRange, latLonToScreen } = geo;
  const {
    overlays,
    airports,
    aviationData,
    stationsWithTaf,
    selectedAirport,
    findMetarForAirport,
    getFlightCategoryColor,
    getDistanceNm,
    getTafForAirport,
  } = data;

  if (!overlays.airports) return;

  airports.forEach((apt) => {
    const dist = getDistanceNm(apt.lat, apt.lon);
    if (!isPro && dist > radarRange * 1.1) return;
    if (isPro && dist > radarRange * 1.5) return;

    const pos = latLonToScreen(apt.lat, apt.lon);
    const x = pos.x;
    const y = pos.y;

    if (x < 0 || x > width || y < 0 || y > height) return;

    // Check if selected
    const isSelected =
      selectedAirport && selectedAirport.lat === apt.lat && selectedAirport.lon === apt.lon;

    // Draw selection indicator
    if (isSelected) {
      ctx.save();
      ctx.strokeStyle = 'rgba(100, 220, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Airport symbol based on class
    ctx.save();
    ctx.translate(x, y);

    const aptClass = apt.class || 'E';
    let color = 'rgba(180, 180, 180, 0.6)';
    let hasMetar = false;
    let aptMetar = null;

    // Check for METAR-based flight category coloring (Pro mode feature)
    if (
      overlays.airportFlightCategory &&
      aviationData.metars &&
      aviationData.metars.length > 0
    ) {
      aptMetar = findMetarForAirport(apt, aviationData.metars);
      if (aptMetar) {
        hasMetar = true;
        color = getFlightCategoryColor(aptMetar, true);
      }
    }

    // Fall back to airspace class coloring if no METAR
    if (!hasMetar) {
      if (aptClass === 'B') color = 'rgba(100, 150, 255, 0.7)';
      else if (aptClass === 'C') color = 'rgba(200, 100, 200, 0.7)';
      else if (aptClass === 'D') color = 'rgba(100, 200, 100, 0.7)';
    }

    // Brighten if selected
    if (isSelected) {
      color = color.replace(/[\d.]+\)$/, '1)');
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 1.5 : 1;

    // Draw runway symbol (circle with lines)
    ctx.beginPath();
    ctx.arc(0, 0, isSelected ? 5 : 4, 0, Math.PI * 2);
    if (hasMetar) {
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(isSelected ? -10 : -8, 0);
    ctx.lineTo(isSelected ? 10 : 8, 0);
    ctx.stroke();

    // TAF indicator (small dot in upper right if TAF available)
    const aptId = apt.icao || apt.icaoId || apt.faaId || apt.id || 'APT';
    if (overlays.tafs && stationsWithTaf && stationsWithTaf.has(aptId.toUpperCase())) {
      const aptTaf = getTafForAirport(apt);
      if (aptTaf) {
        // Draw TAF indicator dot
        ctx.beginPath();
        ctx.arc(6, -6, 3, 0, Math.PI * 2);
        // Color based on worst forecast category
        const worstCat = aptTaf.forecastCategories?.includes('LIFR')
          ? 'LIFR'
          : aptTaf.forecastCategories?.includes('IFR')
            ? 'IFR'
            : aptTaf.forecastCategories?.includes('MVFR')
              ? 'MVFR'
              : 'VFR';
        const tafColors = {
          VFR: 'rgba(0, 200, 80, 0.9)',
          MVFR: 'rgba(80, 120, 255, 0.9)',
          IFR: 'rgba(255, 80, 80, 0.9)',
          LIFR: 'rgba(255, 50, 200, 0.9)',
        };
        ctx.fillStyle = tafColors[worstCat] || 'rgba(200, 200, 200, 0.9)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Pulsing ring for IFR transitions
        if (aptTaf.hasIfrTransition) {
          ctx.beginPath();
          ctx.arc(6, -6, 5, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255, 100, 100, 0.4)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    ctx.restore();

    // Label with background - add flight category if has METAR
    const labelSuffix = hasMetar ? ` ${aptMetar.fltCat || 'VFR'}` : '';
    const fullLabel = aptId + labelSuffix;
    ctx.font = isSelected
      ? 'bold 11px "JetBrains Mono", monospace'
      : '11px "JetBrains Mono", monospace';
    const aptLabelWidth = ctx.measureText(fullLabel).width + 6;
    ctx.fillStyle = isPro ? 'rgba(10, 13, 18, 0.8)' : 'rgba(10, 15, 10, 0.75)';
    ctx.fillRect(x + 7, y - 6, aptLabelWidth, 15);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(fullLabel, x + 10, y + 4);
  });
}

// ---------------------------------------------------------------------------
// 6. Airspaces
// ---------------------------------------------------------------------------

/**
 * Get airspace color based on type/class.
 * Local helper for drawAirspaces.
 */
function getAirspaceColor(as) {
  const asClass = as.class || as.airspace_class || as.type?.replace('CLASS_', '');
  if (asClass === 'B' || as.type === 'CLASS_B') return 'rgba(80, 120, 200, 0.35)';
  if (asClass === 'C' || as.type === 'CLASS_C') return 'rgba(180, 80, 180, 0.35)';
  if (asClass === 'D' || as.type === 'CLASS_D') return 'rgba(80, 180, 180, 0.35)';
  if (asClass === 'E' || as.type === 'CLASS_E') return 'rgba(100, 150, 100, 0.25)';
  if (asClass === 'RESTRICTED' || as.type === 'RESTRICTED') return 'rgba(200, 80, 80, 0.4)';
  if (asClass === 'PROHIBITED' || as.type === 'PROHIBITED') return 'rgba(255, 50, 50, 0.5)';
  if (asClass === 'WARNING' || as.type === 'WARNING') return 'rgba(255, 180, 50, 0.35)';
  if (asClass === 'MOA' || as.type === 'MOA') return 'rgba(200, 150, 80, 0.3)';
  if (asClass === 'ALERT' || as.type === 'ALERT') return 'rgba(255, 150, 80, 0.35)';
  if (asClass === 'TFR' || as.type === 'TFR') return 'rgba(255, 80, 80, 0.5)';
  return 'rgba(100, 100, 200, 0.3)';
}

/**
 * Draw airspace polygons, circular rings, and radius circles with labels.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geo
 * @param {object} data
 * @param {object}  data.overlays
 * @param {boolean} data.showAirspaceLabels
 * @param {Array}   data.airspaceData
 */
export function drawAirspaces(ctx, geo, data) {
  const { width, height, isPro, radarRange, maxRadius, latLonToScreen } = geo;
  const { overlays, showAirspaceLabels, airspaceData } = data;

  if (!overlays.airspace) return;

  airspaceData.forEach((as) => {
    const asColor = getAirspaceColor(as);

    // Extract polygon coordinates - handle GeoJSON and simple array formats
    let polygonCoords = null;
    if (as.polygon) {
      if (Array.isArray(as.polygon) && as.polygon.length >= 3) {
        // Simple array format: [[lon, lat], ...]
        polygonCoords = as.polygon;
      } else if (as.polygon.type === 'Polygon' && as.polygon.coordinates?.[0]) {
        // GeoJSON Polygon: {type: "Polygon", coordinates: [[[lon, lat], ...]]}
        polygonCoords = as.polygon.coordinates[0];
      } else if (as.polygon.type === 'MultiPolygon' && as.polygon.coordinates?.[0]?.[0]) {
        // GeoJSON MultiPolygon - use first polygon
        polygonCoords = as.polygon.coordinates[0][0];
      }
    }

    // Draw polygon boundaries (from API)
    if (polygonCoords && polygonCoords.length >= 3) {
      ctx.strokeStyle = asColor;
      ctx.fillStyle = asColor.replace(/[\d.]+\)$/, '0.1)'); // Lighter fill
      ctx.lineWidth = isPro ? 2 : 1.5;
      ctx.setLineDash([8, 4]);

      ctx.beginPath();
      polygonCoords.forEach((coord, idx) => {
        // Polygon coords are [lon, lat] format
        const lon = Array.isArray(coord) ? coord[0] : coord.lon;
        const lat = Array.isArray(coord) ? coord[1] : coord.lat;
        const screenPos = latLonToScreen(lat, lon);

        if (idx === 0) {
          ctx.moveTo(screenPos.x, screenPos.y);
        } else {
          ctx.lineTo(screenPos.x, screenPos.y);
        }
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw label at center (if labels enabled)
      if (as.name && showAirspaceLabels) {
        const asCenter = as.center || {
          lat: as.center_lat || as.lat,
          lon: as.center_lon || as.lon,
        };
        if (asCenter?.lat && asCenter?.lon) {
          const labelPos = latLonToScreen(asCenter.lat, asCenter.lon);
          ctx.fillStyle = asColor.replace(/[\d.]+\)$/, '0.8)');
          ctx.font = isPro
            ? 'bold 12px "JetBrains Mono", monospace'
            : '11px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(as.name, labelPos.x, labelPos.y);
          if (as.floor_ft !== undefined && as.ceiling_ft !== undefined) {
            ctx.font = isPro
              ? '10px "JetBrains Mono", monospace'
              : '9px "JetBrains Mono", monospace';
            ctx.fillText(`${as.floor_ft}-${as.ceiling_ft}ft`, labelPos.x, labelPos.y + 12);
          }
        }
      }
    }
    // Draw circular rings (fallback for simple boundaries)
    else if (as.rings) {
      const asCenter = as.center || {
        lat: as.center_lat || as.lat,
        lon: as.center_lon || as.lon,
      };
      const pos = latLonToScreen(asCenter.lat, asCenter.lon);

      as.rings.forEach((ring, idx) => {
        const radiusNm = ring.radius_nm || ring.radius;
        // Use same scaling as latLonToScreen for consistency
        const pixelsPerNm = isPro
          ? (Math.min(width, height) * 0.45) / radarRange
          : maxRadius / radarRange;
        const radiusPx = radiusNm * pixelsPerNm;

        if (radiusPx > 5) {
          ctx.strokeStyle = asColor;
          ctx.lineWidth = isPro ? 1.5 : 1;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, radiusPx, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);

          if (idx === 0 && as.name) {
            ctx.fillStyle = asColor.replace(/[\d.]+\)$/, '0.7)');
            ctx.font = '11px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(as.name, pos.x, pos.y - radiusPx - 6);
          }
        }
      });
    }
    // Draw simple radius circle (when only radius_nm is provided)
    else if (as.radius_nm && (as.center || (as.center_lat && as.center_lon))) {
      const asCenter = as.center || { lat: as.center_lat, lon: as.center_lon };
      const pos = latLonToScreen(asCenter.lat, asCenter.lon);
      const pixelsPerNm = isPro
        ? (Math.min(width, height) * 0.45) / radarRange
        : maxRadius / radarRange;
      const radiusPx = as.radius_nm * pixelsPerNm;

      if (radiusPx > 5) {
        ctx.strokeStyle = asColor;
        ctx.lineWidth = isPro ? 1.5 : 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radiusPx, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        if (as.name) {
          ctx.fillStyle = asColor.replace(/[\d.]+\)$/, '0.7)');
          ctx.font = '11px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(as.name, pos.x, pos.y - radiusPx - 6);
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// 7. Advisories (SIGMETs, AIRMETs, G-AIRMETs)
// ---------------------------------------------------------------------------

/**
 * Draw airspace advisories with hazard-colored polygons and labels.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geo
 * @param {object} data
 * @param {object}      data.overlays
 * @param {Array}       data.airspaceAdvisories
 * @param {string|null} data.selectedAdvisoryId
 * @param {Set|null}    data.acknowledgedAdvisories
 * @param {object}      data.weatherAdvisoryFilters
 * @param {object}      data.HAZARD_CONFIG  - Map of hazard type to { color, ... }
 */
export function drawAdvisories(ctx, geo, data) {
  const { width, height, isPro, latLonToScreen } = geo;
  const {
    overlays,
    airspaceAdvisories,
    selectedAdvisoryId,
    acknowledgedAdvisories,
    weatherAdvisoryFilters,
    HAZARD_CONFIG,
  } = data;

  if (!overlays.advisories || !airspaceAdvisories?.length || !isPro) return;

  ctx.save();
  ctx.setLineDash([6, 4]);

  // Filter advisories by hazard type
  const filteredAdvisories = airspaceAdvisories.filter((adv) => {
    if (adv.hazard && weatherAdvisoryFilters[adv.hazard] !== undefined) {
      return weatherAdvisoryFilters[adv.hazard];
    }
    return true;
  });

  filteredAdvisories.forEach((adv) => {
    // Handle GeoJSON format: { type: "Polygon", coordinates: [[[lon, lat], ...]] }
    // or flat array format: [[lon, lat], ...]
    let polygonCoords = adv.polygon;
    if (adv.polygon?.type === 'Polygon' && adv.polygon?.coordinates?.[0]) {
      polygonCoords = adv.polygon.coordinates[0];
    } else if (adv.polygon?.coordinates) {
      polygonCoords = adv.polygon.coordinates;
    }

    if (!polygonCoords || polygonCoords.length < 3) return;

    // Calculate bounding box for viewport culling and label positioning
    const lats = polygonCoords.map((p) => (Array.isArray(p) ? p[1] : p.lat));
    const lons = polygonCoords.map((p) => (Array.isArray(p) ? p[0] : p.lon));
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);

    // Check if advisory intersects viewport - convert center to screen and check distance
    const centerLat = (minLat + maxLat) / 2;
    const centerLon = (minLon + maxLon) / 2;
    const centerScreen = latLonToScreen(centerLat, centerLon);

    // Estimate advisory size on screen (rough approximation)
    const corner1 = latLonToScreen(maxLat, maxLon);
    const corner2 = latLonToScreen(minLat, minLon);
    const advisoryScreenRadius =
      Math.max(Math.abs(corner1.x - corner2.x), Math.abs(corner1.y - corner2.y)) / 2;

    // Skip if center is too far outside viewport (with advisory radius as margin)
    const margin = advisoryScreenRadius + 100;
    if (
      centerScreen.x < -margin ||
      centerScreen.x > width + margin ||
      centerScreen.y < -margin ||
      centerScreen.y > height + margin
    ) {
      return;
    }

    // Get color from hazard type
    const hazardConfig = HAZARD_CONFIG[adv.hazard] || { color: '#888888' };
    const isSelected = selectedAdvisoryId === adv.id;
    const isAck = acknowledgedAdvisories?.has(adv.id);

    // Skip acknowledged advisories in rendering (or dim them)
    const baseAlpha = isAck ? 0.15 : 0.4;
    const strokeAlpha = isAck ? 0.3 : 0.7;

    ctx.strokeStyle = isSelected
      ? hazardConfig.color
      : `${hazardConfig.color}${Math.round(strokeAlpha * 255)
          .toString(16)
          .padStart(2, '0')}`;
    ctx.fillStyle = `${hazardConfig.color}${Math.round(baseAlpha * 255 * 0.3)
      .toString(16)
      .padStart(2, '0')}`;
    ctx.lineWidth = isSelected ? 3 : 1.5;

    ctx.beginPath();
    polygonCoords.forEach((coord, idx) => {
      // Polygon coords are [lon, lat] format
      const lon = Array.isArray(coord) ? coord[0] : coord.lon;
      const lat = Array.isArray(coord) ? coord[1] : coord.lat;
      const screenPos = latLonToScreen(lat, lon);

      if (idx === 0) {
        ctx.moveTo(screenPos.x, screenPos.y);
      } else {
        ctx.lineTo(screenPos.x, screenPos.y);
      }
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Draw hazard label at center if selected
    if (isSelected) {
      // Reuse minLat/maxLat/minLon/maxLon computed above for bounds check
      const labelCenterLat = (minLat + maxLat) / 2;
      const labelCenterLon = (minLon + maxLon) / 2;
      const labelPos = latLonToScreen(labelCenterLat, labelCenterLon);

      ctx.setLineDash([]);
      ctx.fillStyle = hazardConfig.color;
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(adv.hazard || adv.advisory_type || 'ADVISORY', labelPos.x, labelPos.y);

      if (adv.lower_alt_ft !== undefined && adv.upper_alt_ft !== undefined) {
        ctx.font = '10px "JetBrains Mono", monospace';
        const lower =
          adv.lower_alt_ft === 0 ? 'SFC' : `FL${Math.round(adv.lower_alt_ft / 100)}`;
        const upper =
          adv.upper_alt_ft >= 18000
            ? `FL${Math.round(adv.upper_alt_ft / 100)}`
            : `${adv.upper_alt_ft}ft`;
        ctx.fillText(`${lower}-${upper}`, labelPos.x, labelPos.y + 14);
      }
      ctx.setLineDash([6, 4]);
    }
  });

  ctx.setLineDash([]);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 8. NOTAMs
// ---------------------------------------------------------------------------

/**
 * Draw NOTAM markers with radius circles, type icons, and labels.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geo
 * @param {object} data
 * @param {object}      data.overlays
 * @param {Array}       data.mapNotams
 * @param {string|null} data.selectedNotamId
 * @param {Set|null}    data.acknowledgedNotams
 * @param {object}      data.NOTAM_TYPE_CONFIG  - Map of NOTAM type to { color, ... }
 */
export function drawNotams(ctx, geo, data) {
  const { width, height, isPro, radarRange, latLonToScreen } = geo;
  const { overlays, mapNotams, selectedNotamId, acknowledgedNotams, NOTAM_TYPE_CONFIG } = data;

  if (!overlays.notams || !mapNotams?.length || !isPro) return;

  ctx.save();

  mapNotams.forEach((notam) => {
    // Skip NOTAMs without location data
    if (!notam.latitude || !notam.longitude) return;

    const pos = latLonToScreen(notam.latitude, notam.longitude);
    if (pos.x < -50 || pos.x > width + 50 || pos.y < -50 || pos.y > height + 50) return;

    // Get color from NOTAM type
    const typeConfig = NOTAM_TYPE_CONFIG[notam.type] || { color: '#6b7280' };
    const isSelected = selectedNotamId === (notam.notam_id || notam.id);
    const isAck = acknowledgedNotams?.has(notam.notam_id || notam.id);
    const isTfr = notam.type === 'TFR';

    // Dimmed if acknowledged
    const baseAlpha = isAck ? 0.3 : 0.8;

    // Calculate radius in pixels (if radius_nm is available)
    const pixelsPerNm = (Math.min(width, height) * 0.45) / radarRange;
    const radiusPx = notam.radius_nm ? notam.radius_nm * pixelsPerNm : 12;

    // Draw circle/radius for NOTAM
    ctx.strokeStyle = isSelected
      ? typeConfig.color
      : `${typeConfig.color}${Math.round(baseAlpha * 255)
          .toString(16)
          .padStart(2, '0')}`;
    ctx.fillStyle = `${typeConfig.color}${Math.round(baseAlpha * 0.2 * 255)
      .toString(16)
      .padStart(2, '0')}`;
    ctx.lineWidth = isSelected ? 2.5 : isTfr ? 2 : 1.5;

    // TFRs get dashed lines, others solid
    if (isTfr) {
      ctx.setLineDash([6, 3]);
    } else {
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, Math.max(radiusPx, 8), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Draw NOTAM marker icon
    ctx.fillStyle = typeConfig.color;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y - 6);
    ctx.lineTo(pos.x - 4, pos.y + 4);
    ctx.lineTo(pos.x + 4, pos.y + 4);
    ctx.closePath();
    ctx.fill();

    // Draw label for selected or TFR NOTAMs
    if (isSelected || isTfr) {
      ctx.setLineDash([]);
      ctx.fillStyle = typeConfig.color;
      ctx.font = isSelected
        ? 'bold 11px "JetBrains Mono", monospace'
        : '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';

      // Show type and location
      const label = isTfr ? 'TFR' : notam.type || 'NOTAM';
      ctx.fillText(label, pos.x, pos.y - radiusPx - 8);

      if (isSelected && notam.location) {
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.fillText(notam.location, pos.x, pos.y - radiusPx - 20);
      }

      // Show altitude info if available
      if (isSelected && (notam.floor_ft != null || notam.ceiling_ft != null)) {
        ctx.font = '9px "JetBrains Mono", monospace';
        const altText =
          notam.floor_ft != null && notam.ceiling_ft != null
            ? `${notam.floor_ft}-${notam.ceiling_ft}ft`
            : notam.ceiling_ft != null
              ? `\u2264${notam.ceiling_ft}ft`
              : `\u2265${notam.floor_ft}ft`;
        ctx.fillText(altText, pos.x, pos.y + radiusPx + 14);
      }
    }
  });

  ctx.setLineDash([]);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 9. PIREPs
// ---------------------------------------------------------------------------

/**
 * Draw PIREP diamond markers with severity-based sizing, type-specific inner symbols,
 * glow effects, and altitude labels.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geo
 * @param {object} data
 * @param {object}   data.overlays
 * @param {object}   data.aviationData          - { pireps: [...] }
 * @param {object|null} data.selectedPirep
 * @param {Function} data.getPirepMaxSeverity   - (pirep) => { level, isUrgent }
 * @param {Function} data.getPirepAgeMinutes    - (pirep) => minutes
 * @param {Function} data.getAgeOpacity         - (minutes) => opacity 0-1
 * @param {Function} data.getPirepType          - (pirep) => 'urgent'|'turbulence'|'icing'|'both'|'windshear'|'routine'
 * @param {Function} data.formatPirepAltitude   - (pirep) => string|null
 */
export function drawPireps(ctx, geo, data) {
  const { width, height, latLonToScreen, frameCount } = geo;
  const {
    overlays,
    aviationData,
    selectedPirep,
    getPirepMaxSeverity,
    getPirepAgeMinutes,
    getAgeOpacity,
    getPirepType,
    formatPirepAltitude,
  } = data;

  if (!overlays.pireps || !aviationData.pireps.length) return;

  aviationData.pireps.forEach((pirep) => {
    if (!pirep.lat || !pirep.lon) return;
    const pos = latLonToScreen(pirep.lat, pirep.lon);
    if (pos.x < 0 || pos.x > width || pos.y < 0 || pos.y > height) return;

    ctx.save();
    ctx.translate(pos.x, pos.y);

    // Check if this PIREP is selected
    const isSelected =
      selectedPirep && selectedPirep.lat === pirep.lat && selectedPirep.lon === pirep.lon;

    // Get severity info for sizing and effects
    const severity = getPirepMaxSeverity(pirep);
    const severityLevel = severity.level;

    // Get age for opacity
    const ageMinutes = getPirepAgeMinutes(pirep);
    const ageOpacity = getAgeOpacity(ageMinutes);

    // Severity-based marker sizing (12-20px)
    const baseSize = 6; // Half of 12px base
    let markerSize = baseSize;
    if (severityLevel >= 5)
      markerSize = 10; // 20px for severe/extreme
    else if (severityLevel >= 4)
      markerSize = 9; // 18px for mod-severe
    else if (severityLevel >= 3)
      markerSize = 8; // 16px for moderate
    else if (severityLevel >= 2) markerSize = 7; // 14px for light-moderate
    // Level 0-1 stays at baseSize (12px)

    // Draw selection indicator
    if (isSelected) {
      const selFlash = Math.floor(frameCount / 10) % 2 === 0;
      const selAlpha = selFlash ? 0.9 : 0.4;
      const selSize = markerSize + (selFlash ? 12 : 10);

      ctx.strokeStyle = `rgba(100, 220, 255, ${selAlpha})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(0, 0, selSize, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Corner brackets
      const bSize = markerSize + 6;
      const bLen = 5;
      ctx.strokeStyle = `rgba(100, 220, 255, ${selAlpha})`;
      ctx.lineWidth = 2;
      // Top-left
      ctx.beginPath();
      ctx.moveTo(-bSize, -bSize + bLen);
      ctx.lineTo(-bSize, -bSize);
      ctx.lineTo(-bSize + bLen, -bSize);
      ctx.stroke();
      // Top-right
      ctx.beginPath();
      ctx.moveTo(bSize - bLen, -bSize);
      ctx.lineTo(bSize, -bSize);
      ctx.lineTo(bSize, -bSize + bLen);
      ctx.stroke();
      // Bottom-left
      ctx.beginPath();
      ctx.moveTo(-bSize, bSize - bLen);
      ctx.lineTo(-bSize, bSize);
      ctx.lineTo(-bSize + bLen, bSize);
      ctx.stroke();
      // Bottom-right
      ctx.beginPath();
      ctx.moveTo(bSize - bLen, bSize);
      ctx.lineTo(bSize, bSize);
      ctx.lineTo(bSize, bSize - bLen);
      ctx.stroke();
    }

    // PIREP color based on type
    const pirepType = getPirepType(pirep);
    let baseColor, glowColor;
    switch (pirepType) {
      case 'urgent':
        baseColor = { r: 255, g: 50, b: 50 }; // Red for urgent
        glowColor = 'rgba(255, 50, 50, 0.6)';
        break;
      case 'turbulence':
        baseColor = { r: 255, g: 150, b: 50 }; // Orange for turbulence
        glowColor = 'rgba(255, 150, 50, 0.5)';
        break;
      case 'icing':
        baseColor = { r: 100, g: 180, b: 255 }; // Blue for icing
        glowColor = 'rgba(100, 180, 255, 0.5)';
        break;
      case 'both':
        baseColor = { r: 200, g: 100, b: 255 }; // Purple for both
        glowColor = 'rgba(200, 100, 255, 0.5)';
        break;
      case 'windshear':
        baseColor = { r: 255, g: 100, b: 200 }; // Magenta for wind shear
        glowColor = 'rgba(255, 100, 200, 0.5)';
        break;
      default:
        baseColor = { r: 255, g: 220, b: 100 }; // Yellow for routine
        glowColor = 'rgba(255, 220, 100, 0.3)';
    }

    // Apply age-based opacity
    const colorAlpha = isSelected ? 1.0 : Math.min(0.9, ageOpacity);
    const fillAlpha = isSelected ? 0.4 : Math.min(0.25, ageOpacity * 0.3);
    const color = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${colorAlpha})`;
    const fillColor = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${fillAlpha})`;

    // Glow effects for severe conditions (level 3+)
    if (severityLevel >= 3) {
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = severityLevel >= 5 ? 12 : severityLevel >= 4 ? 8 : 4;
    }

    // Pulsing effect for UUA/extreme (level 5+)
    let pulseScale = 1;
    if (severity.isUrgent || severityLevel >= 5) {
      const pulsePhase = (frameCount % 60) / 60;
      pulseScale = 1 + 0.1 * Math.sin(pulsePhase * Math.PI * 2);
      ctx.shadowBlur = 8 + 8 * Math.sin(pulsePhase * Math.PI * 2);
    }

    const scaledSize = markerSize * pulseScale;

    // Draw diamond symbol
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 2.5 : severityLevel >= 3 ? 2 : 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -scaledSize);
    ctx.lineTo(scaledSize * 0.85, 0);
    ctx.lineTo(0, scaledSize);
    ctx.lineTo(-scaledSize * 0.85, 0);
    ctx.closePath();
    ctx.stroke();

    // Fill based on type (always fill slightly, more if selected)
    ctx.fillStyle = fillColor;
    ctx.fill();

    // Reset shadow for inner symbols
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';

    // Improved inner symbols based on type
    const innerScale = scaledSize / 7; // Scale inner symbols with marker
    if (pirepType === 'both') {
      // Split diamond for both - orange/blue halves
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, -scaledSize * 0.5);
      ctx.lineTo(0, scaledSize * 0.5);
      ctx.lineTo(-scaledSize * 0.4, 0);
      ctx.closePath();
      ctx.fillStyle = `rgba(255, 150, 50, ${colorAlpha})`; // Orange half
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -scaledSize * 0.5);
      ctx.lineTo(0, scaledSize * 0.5);
      ctx.lineTo(scaledSize * 0.4, 0);
      ctx.closePath();
      ctx.fillStyle = `rgba(100, 180, 255, ${colorAlpha})`; // Blue half
      ctx.fill();
      ctx.restore();
    } else if (pirepType === 'turbulence') {
      // Three horizontal wavy lines for turbulence
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      const waveY = [-2, 0, 2];
      waveY.forEach((y) => {
        const yScaled = y * innerScale;
        ctx.beginPath();
        ctx.moveTo(-3 * innerScale, yScaled);
        ctx.quadraticCurveTo(-1.5 * innerScale, yScaled - 1.2 * innerScale, 0, yScaled);
        ctx.quadraticCurveTo(
          1.5 * innerScale,
          yScaled + 1.2 * innerScale,
          3 * innerScale,
          yScaled
        );
        ctx.stroke();
      });
    } else if (pirepType === 'icing') {
      // 6-arm asterisk/snowflake for icing
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      const armLen = 3 * innerScale;
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(angle) * armLen, Math.sin(angle) * armLen);
        ctx.stroke();
        // Add small branches on each arm
        const branchLen = armLen * 0.4;
        const branchDist = armLen * 0.6;
        const bx = Math.cos(angle) * branchDist;
        const by = Math.sin(angle) * branchDist;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(
          bx + Math.cos(angle + 0.5) * branchLen,
          by + Math.sin(angle + 0.5) * branchLen
        );
        ctx.moveTo(bx, by);
        ctx.lineTo(
          bx + Math.cos(angle - 0.5) * branchLen,
          by + Math.sin(angle - 0.5) * branchLen
        );
        ctx.stroke();
      }
    } else if (pirepType === 'windshear') {
      // Vertical double-headed arrow for wind shear
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      const arrowLen = 3.5 * innerScale;
      const arrowHead = 1.5 * innerScale;
      // Vertical line
      ctx.beginPath();
      ctx.moveTo(0, -arrowLen);
      ctx.lineTo(0, arrowLen);
      ctx.stroke();
      // Top arrow head
      ctx.beginPath();
      ctx.moveTo(-arrowHead, -arrowLen + arrowHead);
      ctx.lineTo(0, -arrowLen);
      ctx.lineTo(arrowHead, -arrowLen + arrowHead);
      ctx.stroke();
      // Bottom arrow head
      ctx.beginPath();
      ctx.moveTo(-arrowHead, arrowLen - arrowHead);
      ctx.lineTo(0, arrowLen);
      ctx.lineTo(arrowHead, arrowLen - arrowHead);
      ctx.stroke();
    }

    // Altitude label below marker
    const altLabel = formatPirepAltitude(pirep);
    if (altLabel) {
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.7, ageOpacity * 0.8)})`;
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(altLabel, 0, scaledSize + 4);
    }

    ctx.restore();
  });
}

// ---------------------------------------------------------------------------
// 10. Winds Aloft
// ---------------------------------------------------------------------------

/**
 * Draw winds aloft barb grid and level indicator.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geo
 * @param {object} data
 * @param {object}   data.overlays
 * @param {Array}    data.windGrid
 * @param {string}   data.windsAloftLevel
 * @param {Function} data.drawWindBarbs          - (ctx, grid, latLonToScreen, opts) => void
 * @param {Function} data.drawWindsLevelIndicator - (ctx, x, y, level, opts) => void
 */
export function drawWindsAloft(ctx, geo, data) {
  const { isPro, height, radarRange, latLonToScreen, themeColors } = geo;
  const { overlays, windGrid, windsAloftLevel, drawWindBarbs, drawWindsLevelIndicator } = data;

  if (!isPro || !overlays.windsAloft || !windGrid || windGrid.length === 0) return;

  // Adapt barb size to zoom level
  const barbSize =
    radarRange <= 25 ? 30 : radarRange <= 50 ? 25 : radarRange <= 100 ? 22 : 18;
  const minSpacing =
    radarRange <= 25 ? 50 : radarRange <= 50 ? 45 : radarRange <= 100 ? 40 : 35;

  drawWindBarbs(ctx, windGrid, latLonToScreen, {
    size: barbSize,
    minSpacing,
    opacity: 0.85,
    showLabels: radarRange <= 50,
  });

  // Draw level indicator in corner
  drawWindsLevelIndicator(ctx, 10, height - 60, windsAloftLevel, {
    themeColors,
  });
}

// ---------------------------------------------------------------------------
// 11. METARs
// ---------------------------------------------------------------------------

/**
 * Draw METAR station dots with flight category colors, selection indicators,
 * and wind barbs for significant winds.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geo
 * @param {object} data
 * @param {object}      data.overlays
 * @param {object}      data.aviationData    - { metars: [...] }
 * @param {object|null} data.selectedMetar
 * @param {Function}    data.drawWindBarb    - (ctx, x, y, dir, spd, opts) => void
 */
export function drawMetars(ctx, geo, data) {
  const { width, height, latLonToScreen, frameCount } = geo;
  const { overlays, aviationData, selectedMetar, drawWindBarb } = data;

  if (!overlays.metars || !aviationData.metars.length) return;

  aviationData.metars.forEach((metar) => {
    if (!metar.lat || !metar.lon) return;
    const pos = latLonToScreen(metar.lat, metar.lon);
    if (pos.x < 0 || pos.x > width || pos.y < 0 || pos.y > height) return;

    // Check if this METAR is selected
    const isSelected =
      selectedMetar && selectedMetar.lat === metar.lat && selectedMetar.lon === metar.lon;

    // Draw selection indicator
    if (isSelected) {
      const selFlash = Math.floor(frameCount / 10) % 2 === 0;
      const selAlpha = selFlash ? 0.9 : 0.4;
      const selSize = selFlash ? 18 : 16;

      ctx.save();
      ctx.strokeStyle = `rgba(100, 220, 255, ${selAlpha})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, selSize, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Corner brackets
      const bSize = 12;
      const bLen = 5;
      ctx.strokeStyle = `rgba(100, 220, 255, ${selAlpha})`;
      ctx.lineWidth = 2;
      // Top-left
      ctx.beginPath();
      ctx.moveTo(pos.x - bSize, pos.y - bSize + bLen);
      ctx.lineTo(pos.x - bSize, pos.y - bSize);
      ctx.lineTo(pos.x - bSize + bLen, pos.y - bSize);
      ctx.stroke();
      // Top-right
      ctx.beginPath();
      ctx.moveTo(pos.x + bSize - bLen, pos.y - bSize);
      ctx.lineTo(pos.x + bSize, pos.y - bSize);
      ctx.lineTo(pos.x + bSize, pos.y - bSize + bLen);
      ctx.stroke();
      // Bottom-left
      ctx.beginPath();
      ctx.moveTo(pos.x - bSize, pos.y + bSize - bLen);
      ctx.lineTo(pos.x - bSize, pos.y + bSize);
      ctx.lineTo(pos.x - bSize + bLen, pos.y + bSize);
      ctx.stroke();
      // Bottom-right
      ctx.beginPath();
      ctx.moveTo(pos.x + bSize - bLen, pos.y + bSize);
      ctx.lineTo(pos.x + bSize, pos.y + bSize);
      ctx.lineTo(pos.x + bSize, pos.y + bSize - bLen);
      ctx.stroke();
      ctx.restore();
    }

    // Flight category color
    let color = 'rgba(0, 255, 0, 0.7)'; // VFR
    if (metar.fltCat === 'MVFR') color = 'rgba(100, 150, 255, 0.8)';
    else if (metar.fltCat === 'IFR') color = 'rgba(255, 100, 100, 0.8)';
    else if (metar.fltCat === 'LIFR') color = 'rgba(255, 50, 200, 0.8)';

    // Make selected METARs brighter
    if (isSelected) {
      color = color.replace('0.7', '1').replace('0.8', '1');
    }

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, isSelected ? 7 : 5, 0, Math.PI * 2);
    ctx.fill();

    // Add outline if selected
    if (isSelected) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Wind barb if significant wind
    if (metar.wspd && metar.wspd > 10) {
      drawWindBarb(ctx, pos.x, pos.y, metar.wdir || 0, metar.wspd, {
        size: 21,
        barbLength: 8,
        barbSpacing: 4,
        lineWidth: isSelected ? 2 : 1.5,
        color,
        opacity: 0.9,
      });
    }
  });
}
