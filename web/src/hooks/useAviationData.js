import { useState, useEffect, useCallback } from 'react';

/**
 * Hook for fetching aviation data (navaids, airports, airspace, METARs, PIREPs)
 */
export function useAviationData(config, feederLat, feederLon, radarRange, overlays) {
  const [aviationData, setAviationData] = useState({
    navaids: [],
    airports: [],
    airspace: [],
    metars: [],
    pireps: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Helper to extract data from GeoJSON format or direct array
  const extractData = useCallback((response, type = 'generic') => {
    let data = [];
    if (Array.isArray(response)) {
      data = response;
    } else if (response?.features) {
      // GeoJSON FeatureCollection format from aviationweather.gov
      data = response.features.map(f => ({
        ...f.properties,
        lat: f.geometry?.coordinates?.[1],
        lon: f.geometry?.coordinates?.[0]
      }));
    } else if (response?.data) {
      data = response.data;
    }
    
    // Normalize airport fields
    if (type === 'airport') {
      data = data.map(apt => ({
        ...apt,
        icao: apt.icao || apt.icaoId || apt.faaId || apt.id || 'UNK',
        id: apt.id || apt.icaoId || apt.faaId || 'UNK',
        name: apt.name || apt.site || null,
        city: apt.city || apt.assocCity || null,
        state: apt.state || apt.stateProv || null,
        elev: apt.elev ?? apt.elev_ft ?? apt.elevation ?? null,
        class: apt.class || apt.airspaceClass || null,
      }));
    }
    
    return data;
  }, []);

  // Fetch all aviation data
  const fetchAviationData = useCallback(async () => {
    if (!feederLat || !feederLon) return;
    
    const baseUrl = config?.apiUrl || '';
    setLoading(true);
    setError(null);
    
    try {
      // Fetch NAVAIDs
      const navRes = await fetch(`${baseUrl}/api/v1/aviation/navaids?lat=${feederLat}&lon=${feederLon}&radius=${radarRange * 1.5}`);
      if (navRes.ok) {
        const navData = await navRes.json();
        setAviationData(prev => ({ ...prev, navaids: extractData(navData) }));
      }
      
      // Fetch airports
      const aptRes = await fetch(`${baseUrl}/api/v1/aviation/airports?lat=${feederLat}&lon=${feederLon}&radius=${radarRange * 1.2}`);
      if (aptRes.ok) {
        const aptData = await aptRes.json();
        setAviationData(prev => ({ ...prev, airports: extractData(aptData, 'airport') }));
      }
      
      // Fetch airspace
      const asRes = await fetch(`${baseUrl}/api/v1/aviation/airspace?lat=${feederLat}&lon=${feederLon}`);
      if (asRes.ok) {
        const asData = await asRes.json();
        setAviationData(prev => ({ ...prev, airspace: extractData(asData) }));
      }
      
      // Fetch METARs if enabled
      if (overlays?.metars) {
        const metarRes = await fetch(`${baseUrl}/api/v1/aviation/metars?lat=${feederLat}&lon=${feederLon}&radius=${radarRange}`);
        if (metarRes.ok) {
          const metarData = await metarRes.json();
          setAviationData(prev => ({ ...prev, metars: extractData(metarData) }));
        }
      }
      
      // Fetch PIREPs if enabled
      if (overlays?.pireps) {
        const pirepRes = await fetch(`${baseUrl}/api/v1/aviation/pireps?lat=${feederLat}&lon=${feederLon}&radius=${radarRange}`);
        if (pirepRes.ok) {
          const pirepData = await pirepRes.json();
          setAviationData(prev => ({ ...prev, pireps: extractData(pirepData) }));
        }
      }
    } catch (err) {
      console.error('Aviation data fetch error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [config?.apiUrl, feederLat, feederLon, radarRange, overlays?.metars, overlays?.pireps, extractData]);

  // Fetch on mount and when dependencies change
  useEffect(() => {
    fetchAviationData();
  }, [fetchAviationData]);

  // Refresh data periodically (every 5 minutes for weather data)
  useEffect(() => {
    const interval = setInterval(fetchAviationData, 300000);
    return () => clearInterval(interval);
  }, [fetchAviationData]);

  return {
    aviationData,
    loading,
    error,
    refresh: fetchAviationData,
  };
}

export default useAviationData;
