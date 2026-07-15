import { useEffect } from 'react';

/**
 * Custom hook that fetches terrain overlay GeoJSON data for pro mode.
 * Fetches countries, states, counties, and water (lakes + rivers) boundaries,
 * processes them into a simplified format with viewport filtering.
 *
 * State is managed externally — the caller owns terrainData and passes setters in.
 */
export function useTerrainOverlays({
  config,
  overlays,
  feederLat,
  feederLon,
  radarRange,
  terrainData,
  setTerrainData,
}) {
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
        const isNearViewport = coords.some(
          ([lon, lat]) =>
            lat >= minLat - 2 && lat <= maxLat + 2 && lon >= minLon - 2 && lon <= maxLon + 2
        );
        if (isNearViewport) {
          features.push({ type, coords });
        }
      };

      geojson.features?.forEach((feature) => {
        const geomType = feature.geometry?.type;
        const coords = feature.geometry?.coordinates;
        if (!coords) return;

        if (geomType === 'Polygon') {
          coords.forEach((ring) => processCoords(ring, 'polygon'));
        } else if (geomType === 'MultiPolygon') {
          coords.forEach((poly) => poly.forEach((ring) => processCoords(ring, 'polygon')));
        } else if (geomType === 'LineString') {
          processCoords(coords, 'line');
        } else if (geomType === 'MultiLineString') {
          coords.forEach((line) => processCoords(line, 'line'));
        }
      });
      return features;
    };

    const degPerNm = 1 / 60;
    const lonScale = Math.cos((feederLat * Math.PI) / 180);
    const filterBounds = {
      minLat: feederLat - radarRange * degPerNm * 2,
      maxLat: feederLat + radarRange * degPerNm * 2,
      minLon: feederLon - (radarRange * degPerNm * 2) / lonScale,
      maxLon: feederLon + (radarRange * degPerNm * 2) / lonScale,
    };

    const dataUrls = {
      countries:
        'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson',
      states:
        'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json',
      counties:
        'https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json',
      // Water - 50m resolution lakes and rivers
      lakes:
        'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/50m/physical/ne_50m_lakes.json',
      rivers:
        'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/50m/physical/ne_50m_rivers_lake_centerlines.json',
    };

    const fetchTerrain = async (type, url) => {
      try {
        // Fetching terrain data
        const resp = await fetch(url);
        if (!resp.ok) {
          console.warn(`Failed to fetch ${type}: HTTP ${resp.status}`);
          return [];
        }
        // External GeoJSON files may not have application/json content-type
        // so we try to parse JSON regardless of content-type
        let geojson;
        try {
          geojson = await resp.json();
        } catch (e) {
          console.warn(`Failed to fetch ${type}: invalid JSON`);
          return [];
        }
        const processed = processGeoJSON(geojson, filterBounds);
        // Terrain data processed
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
        // Fetch both lakes and rivers, combine them
        const [lakes, rivers] = await Promise.all([
          fetchTerrain('lakes', dataUrls.lakes),
          fetchTerrain('rivers', dataUrls.rivers),
        ]);
        updates.water = [...lakes, ...rivers];
        // Water features combined
      }
      if (overlays.counties && !terrainData.counties) {
        updates.counties = await fetchTerrain('counties', dataUrls.counties);
      }
      if (Object.keys(updates).length > 0) {
        // Updating terrain data
        setTerrainData((prev) => ({ ...prev, ...updates }));
      }
    };

    loadTerrainData();
  }, [
    config.mapMode,
    overlays.water,
    overlays.counties,
    overlays.states,
    overlays.countries,
    feederLat,
    feederLon,
    radarRange,
    terrainData.countries,
    terrainData.states,
    terrainData.water,
    terrainData.counties,
  ]);
}
