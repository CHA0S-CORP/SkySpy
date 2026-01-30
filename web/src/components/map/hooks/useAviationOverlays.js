import { useState, useEffect, useRef } from 'react';

// Helper to safely parse JSON from fetch response
const safeJson = async (res) => {
  if (!res.ok) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try { return await res.json(); } catch { return null; }
};

/**
 * Custom hook for fetching aviation overlay data (navaids, airports, airspaces, metars, pireps)
 */
export function useAviationOverlays({
  config,
  overlays,
  radarRange,
  feederLat,
  feederLon,
  viewportCenter,
  isProPanning,
  wsRequest,
  wsConnected,
}) {
  // Aviation data from REST endpoints
  const [aviationData, setAviationData] = useState({
    navaids: [],
    airports: [],
    airspaces: [],      // G-AIRMET advisories from /api/v1/aviation/airspaces
    boundaries: [],     // Static airspace boundaries from /api/v1/aviation/airspace-boundaries
    metars: [],
    pireps: [],
  });

  // Terrain overlay data (pro mode only) - cached GeoJSON boundaries
  const [terrainData, setTerrainData] = useState({
    water: null,
    counties: null,
    states: null,
    countries: null,
  });

  // Aviation overlay data (pro mode only) - tar1090 GeoJSON from API
  const [aviationOverlayData, setAviationOverlayData] = useState({
    usArtcc: null,
    usRefueling: null,
    ukMilZones: null,  // Combined: uk_mil_awacs, uk_mil_aar, uk_mil_rc
    euMilAwacs: null,  // Combined: de_mil_awacs, nl_mil_awacs, pl_mil_awacs
    trainingAreas: null,  // Combined: ift_nav_routes, ift_training_areas, usafa_training_areas
  });

  // Fetch aviation data via WebSocket with HTTP fallback - uses viewport center for dynamic loading
  useEffect(() => {
    // Don't fetch while actively panning
    if (isProPanning) return;

    // Use viewport center if available, otherwise fall back to feeder location
    const centerLat = viewportCenter.lat ?? feederLat;
    const centerLon = viewportCenter.lon ?? feederLon;
    const baseUrl = config.apiBaseUrl || '';

    const extractData = (response) => {
      if (!response) return [];
      if (Array.isArray(response)) return response;
      if (response.data && Array.isArray(response.data)) return response.data;
      if (response.features) {
        return response.features.map(f => ({
          ...f.properties,
          lat: f.geometry?.coordinates?.[1],
          lon: f.geometry?.coordinates?.[0]
        }));
      }
      return [];
    };

    const normalizeAirport = (apt) => ({
      ...apt,
      icao: apt.icao || apt.icaoId || apt.faaId || apt.id || 'UNK',
      id: apt.id || apt.icaoId || apt.faaId || 'UNK',
      name: apt.name || apt.site || null,
      city: apt.city || apt.assocCity || null,
      state: apt.state || apt.stateProv || null,
      elev: apt.elev ?? apt.elev_ft ?? apt.elevation ?? null,
      class: apt.class || apt.airspaceClass || null,
    });

    // HTTP fallback helper for aviation data endpoints
    const fetchHttp = async (endpoint, params = {}) => {
      const queryParams = new URLSearchParams(params);
      const url = `${baseUrl}/api/v1/aviation/${endpoint}?${queryParams}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    };

    const fetchAviationData = async () => {
      const baseParams = { lat: centerLat, lon: centerLon };

      try {
        // Fetch all data in parallel - use WebSocket if connected, otherwise HTTP
        const promises = [];

        // NAVAIDs
        promises.push(
          (wsRequest && wsConnected
            ? wsRequest('navaids', { ...baseParams, radius: Math.round(radarRange * 1.5) })
            : fetchHttp('navaids', { ...baseParams, radius: Math.round(radarRange * 1.5) })
          )
            .then(data => ({ type: 'navaids', data: extractData(data) }))
            .catch(err => ({ type: 'navaids', error: err.message }))
        );

        // Airports
        promises.push(
          (wsRequest && wsConnected
            ? wsRequest('airports', { ...baseParams, radius: Math.round(radarRange * 1.2), limit: 50 })
            : fetchHttp('airports', { ...baseParams, radius: Math.round(radarRange * 1.2), limit: 50 })
          )
            .then(data => ({ type: 'airports', data: extractData(data).map(normalizeAirport) }))
            .catch(err => ({ type: 'airports', error: err.message }))
        );

        // Airspace (if enabled)
        if (overlays.airspace) {
          // G-AIRMET advisories
          promises.push(
            (wsRequest && wsConnected
              ? wsRequest('airspaces', baseParams)
              : fetchHttp('airspace/advisories', baseParams)
            )
              .then(data => {
                const advisories = (data?.advisories || extractData(data)).map(adv => ({
                  ...adv,
                  isAdvisory: true,
                  type: adv.type || 'GAIRMET',
                }));
                return { type: 'airspaces', data: advisories };
              })
              .catch(err => ({ type: 'airspaces', error: err.message }))
          );

          // Static boundaries
          promises.push(
            (wsRequest && wsConnected
              ? wsRequest('airspace-boundaries', { ...baseParams, radius: Math.round(radarRange * 1.5) })
              : fetchHttp('airspace/boundaries', { ...baseParams, radius: Math.round(radarRange * 1.5) })
            )
              .then(data => {
                // Response has { boundaries: [...], count, source, ... }
                const rawBoundaries = data?.boundaries || extractData(data);
                const boundaries = rawBoundaries.map(b => ({
                  ...b,
                  isBoundary: true,
                  type: b.class ? `CLASS_${b.class}` : b.type,
                }));
                return { type: 'boundaries', data: boundaries };
              })
              .catch(err => ({ type: 'boundaries', error: err.message }))
          );
        }

        // METARs (if enabled)
        if (overlays.metars) {
          promises.push(
            (wsRequest && wsConnected
              ? wsRequest('metars', { ...baseParams, radius: Math.round(radarRange) })
              : fetchHttp('metars', { ...baseParams, radius: Math.round(radarRange) })
            )
              .then(data => ({ type: 'metars', data: extractData(data) }))
              .catch(err => ({ type: 'metars', error: err.message }))
          );
        }

        // PIREPs (if enabled)
        if (overlays.pireps) {
          promises.push(
            (wsRequest && wsConnected
              ? wsRequest('pireps', { ...baseParams, radius: Math.round(radarRange * 1.5), hours: 3 })
              : fetchHttp('pireps', { ...baseParams, radius: Math.round(radarRange * 1.5), hours: 3 })
            )
              .then(data => ({ type: 'pireps', data: extractData(data) }))
              .catch(err => ({ type: 'pireps', error: err.message }))
          );
        }

        const results = await Promise.all(promises);

        // Update state with results
        setAviationData(prev => {
          const updated = { ...prev };
          results.forEach(result => {
            if (!result.error && result.data) {
              updated[result.type] = result.data;
            }
          });
          return updated;
        });

        const errors = results.filter(r => r.error);
        if (errors.length > 0) {
          console.warn('Some aviation data requests failed:', errors);
        }
      } catch (err) {
        console.log('Aviation data fetch error:', err.message);
      }
    };

    // Debounce the fetch to wait for pan/zoom to settle
    const debounceTimeout = setTimeout(() => {
      fetchAviationData();
    }, 500);

    // Refresh every 5 minutes
    const interval = setInterval(fetchAviationData, 300000);

    return () => {
      clearTimeout(debounceTimeout);
      clearInterval(interval);
    };
  }, [wsRequest, wsConnected, config.apiBaseUrl, viewportCenter.lat, viewportCenter.lon, feederLat, feederLon, radarRange, overlays.metars, overlays.pireps, overlays.airspace, isProPanning]);

  // Fetch terrain overlay data (pro mode only) - simplified GeoJSON boundaries
  useEffect(() => {
    if (config.mapMode !== 'pro') return;

    const needsAny = overlays.water || overlays.counties || overlays.states || overlays.countries;
    if (!needsAny) return;

    // Helper to convert GeoJSON to our simplified format with viewport filtering
    const processGeoJSON = (geojson, filterBounds) => {
      const features = [];
      const { minLat, maxLat, minLon, maxLon } = filterBounds;

      const processCoords = (coords, type) => {
        const isNearViewport = coords.some(([lon, lat]) =>
          lat >= minLat - 2 && lat <= maxLat + 2 &&
          lon >= minLon - 2 && lon <= maxLon + 2
        );
        if (isNearViewport) {
          features.push({ type, coords });
        }
      };

      geojson.features?.forEach(feature => {
        const geomType = feature.geometry?.type;
        const coords = feature.geometry?.coordinates;
        if (!coords) return;

        if (geomType === 'Polygon') {
          coords.forEach(ring => processCoords(ring, 'polygon'));
        } else if (geomType === 'MultiPolygon') {
          coords.forEach(poly => poly.forEach(ring => processCoords(ring, 'polygon')));
        } else if (geomType === 'LineString') {
          processCoords(coords, 'line');
        } else if (geomType === 'MultiLineString') {
          coords.forEach(line => processCoords(line, 'line'));
        }
      });
      return features;
    };

    const degPerNm = 1/60;
    const lonScale = Math.cos(feederLat * Math.PI / 180);
    const filterBounds = {
      minLat: feederLat - radarRange * degPerNm * 2,
      maxLat: feederLat + radarRange * degPerNm * 2,
      minLon: feederLon - (radarRange * degPerNm * 2) / lonScale,
      maxLon: feederLon + (radarRange * degPerNm * 2) / lonScale,
    };

    const dataUrls = {
      countries: 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson',
      states: 'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json',
      counties: 'https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json',
      lakes: 'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/50m/physical/ne_50m_lakes.json',
      rivers: 'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/50m/physical/ne_50m_rivers_lake_centerlines.json',
    };

    const fetchTerrain = async (type, url) => {
      try {
        console.log(`Fetching ${type} terrain data from:`, url);
        const resp = await fetch(url);
        if (!resp.ok) {
          console.warn(`Failed to fetch ${type}: HTTP ${resp.status}`);
          return [];
        }
        let geojson;
        try {
          geojson = await resp.json();
        } catch (e) {
          console.warn(`Failed to fetch ${type}: invalid JSON`);
          return [];
        }
        const processed = processGeoJSON(geojson, filterBounds);
        console.log(`Processed ${type}: ${processed.length} features`);
        return processed;
      } catch (err) {
        console.warn(`Failed to fetch ${type} terrain data:`, err.message);
        return [];
      }
    };

    const loadTerrainData = async () => {
      const updates = {};
      if (overlays.countries && !terrainData.countries) {
        updates.countries = await fetchTerrain('countries', dataUrls.countries);
      }
      if (overlays.states && !terrainData.states) {
        updates.states = await fetchTerrain('states', dataUrls.states);
      }
      if (overlays.water && !terrainData.water) {
        const [lakes, rivers] = await Promise.all([
          fetchTerrain('lakes', dataUrls.lakes),
          fetchTerrain('rivers', dataUrls.rivers),
        ]);
        updates.water = [...lakes, ...rivers];
        console.log(`Combined water features: ${updates.water.length}`);
      }
      if (overlays.counties && !terrainData.counties) {
        updates.counties = await fetchTerrain('counties', dataUrls.counties);
      }
      if (Object.keys(updates).length > 0) {
        console.log('Updating terrain data:', Object.keys(updates));
        setTerrainData(prev => ({ ...prev, ...updates }));
      }
    };

    loadTerrainData();
  }, [config.mapMode, overlays.water, overlays.counties, overlays.states, overlays.countries, feederLat, feederLon, radarRange, terrainData.countries, terrainData.states, terrainData.water, terrainData.counties]);

  // Fetch aviation overlay data (pro mode only) - tar1090 GeoJSON from API with browser caching
  useEffect(() => {
    if (config.mapMode !== 'pro') return;

    const needsAny = overlays.usArtcc || overlays.usRefueling || overlays.ukMilZones || overlays.euMilAwacs || overlays.trainingAreas;
    if (!needsAny) return;

    const apiBase = config.apiBaseUrl || '';

    // Helper to fetch GeoJSON from API (browser will cache via Cache-Control header)
    const fetchAviationGeoJSON = async (dataTypes) => {
      const allFeatures = [];
      for (const dataType of dataTypes) {
        try {
          const resp = await fetch(`${apiBase}/api/v1/aviation/geojson/${dataType}`);
          const data = await safeJson(resp);
          if (!data) {
            console.warn(`Failed to fetch ${dataType}: invalid response`);
            continue;
          }
          if (data.features) {
            data.features.forEach(f => {
              f.properties = f.properties || {};
              f.properties._sourceType = dataType;
            });
            allFeatures.push(...data.features);
          }
        } catch (err) {
          console.warn(`Failed to fetch ${dataType}:`, err.message);
        }
      }
      return allFeatures;
    };

    // Helper to convert GeoJSON features to simplified format for canvas rendering
    const processFeatures = (features, filterBounds) => {
      const result = [];
      const { minLat, maxLat, minLon, maxLon } = filterBounds;

      features.forEach(feature => {
        const geomType = feature.geometry?.type;
        const coords = feature.geometry?.coordinates;
        if (!coords) return;

        const processCoords = (coordArray, type) => {
          const isNearViewport = coordArray.some(([lon, lat]) =>
            lat >= minLat - 5 && lat <= maxLat + 5 &&
            lon >= minLon - 5 && lon <= maxLon + 5
          );
          if (isNearViewport) {
            result.push({
              type,
              coords: coordArray,
              name: feature.properties?.name || feature.properties?.NAME || feature.id,
              sourceType: feature.properties?._sourceType,
            });
          }
        };

        if (geomType === 'Polygon') {
          coords.forEach(ring => processCoords(ring, 'polygon'));
        } else if (geomType === 'MultiPolygon') {
          coords.forEach(poly => poly.forEach(ring => processCoords(ring, 'polygon')));
        } else if (geomType === 'LineString') {
          processCoords(coords, 'line');
        } else if (geomType === 'MultiLineString') {
          coords.forEach(line => processCoords(line, 'line'));
        } else if (geomType === 'Point') {
          result.push({
            type: 'point',
            coords: coords,
            name: feature.properties?.name || feature.properties?.NAME || feature.id,
            sourceType: feature.properties?._sourceType,
          });
        }
      });
      return result;
    };

    const degPerNm = 1/60;
    const lonScale = Math.cos(feederLat * Math.PI / 180);
    const filterBounds = {
      minLat: feederLat - radarRange * degPerNm * 2,
      maxLat: feederLat + radarRange * degPerNm * 2,
      minLon: feederLon - (radarRange * degPerNm * 2) / lonScale,
      maxLon: feederLon + (radarRange * degPerNm * 2) / lonScale,
    };

    const loadAviationData = async () => {
      const updates = {};

      if (overlays.usArtcc && !aviationOverlayData.usArtcc) {
        const features = await fetchAviationGeoJSON(['us_artcc']);
        updates.usArtcc = processFeatures(features, filterBounds);
        console.log(`Loaded US ARTCC: ${updates.usArtcc.length} features`);
      }

      if (overlays.usRefueling && !aviationOverlayData.usRefueling) {
        const features = await fetchAviationGeoJSON(['us_a2a_refueling']);
        updates.usRefueling = processFeatures(features, filterBounds);
        console.log(`Loaded US Refueling: ${updates.usRefueling.length} features`);
      }

      if (overlays.ukMilZones && !aviationOverlayData.ukMilZones) {
        const features = await fetchAviationGeoJSON(['uk_mil_awacs', 'uk_mil_aar', 'uk_mil_rc']);
        updates.ukMilZones = processFeatures(features, filterBounds);
        console.log(`Loaded UK Mil Zones: ${updates.ukMilZones.length} features`);
      }

      if (overlays.euMilAwacs && !aviationOverlayData.euMilAwacs) {
        const features = await fetchAviationGeoJSON(['de_mil_awacs', 'nl_mil_awacs', 'pl_mil_awacs']);
        updates.euMilAwacs = processFeatures(features, filterBounds);
        console.log(`Loaded EU AWACS: ${updates.euMilAwacs.length} features`);
      }

      if (overlays.trainingAreas && !aviationOverlayData.trainingAreas) {
        const features = await fetchAviationGeoJSON(['ift_nav_routes', 'ift_training_areas', 'usafa_training_areas']);
        updates.trainingAreas = processFeatures(features, filterBounds);
        console.log(`Loaded Training Areas: ${updates.trainingAreas.length} features`);
      }

      if (Object.keys(updates).length > 0) {
        console.log('Updating aviation overlay data:', Object.keys(updates));
        setAviationOverlayData(prev => ({ ...prev, ...updates }));
      }
    };

    loadAviationData();
  }, [config.mapMode, config.apiBaseUrl, overlays.usArtcc, overlays.usRefueling, overlays.ukMilZones, overlays.euMilAwacs, overlays.trainingAreas, feederLat, feederLon, radarRange, aviationOverlayData.usArtcc, aviationOverlayData.usRefueling, aviationOverlayData.ukMilZones, aviationOverlayData.euMilAwacs, aviationOverlayData.trainingAreas]);

  return {
    aviationData,
    setAviationData,
    terrainData,
    setTerrainData,
    aviationOverlayData,
    setAviationOverlayData,
  };
}
