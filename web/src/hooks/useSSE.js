import { useState, useEffect, useRef, useCallback } from 'react';

// Normalize aircraft data to handle different API field names
const normalizeAircraft = (data) => {
  const hex = data.hex || data.icao || data.icao_hex || '';
  return {
    hex: hex.toUpperCase(),
    flight: data.flight || data.callsign || data.call || null,
    type: data.type || data.t || data.aircraft_type || null,
    t: data.t || data.type || null,
    alt: data.alt || data.altitude || data.alt_baro || data.alt_geom || null,
    alt_baro: data.alt_baro || data.alt || null,
    alt_geom: data.alt_geom || null,
    gs: data.gs || data.ground_speed || data.speed || null,
    tas: data.tas || null,
    track: data.track || data.heading || data.trk || null,
    true_heading: data.true_heading || null,
    mag_heading: data.mag_heading || null,
    vr: data.vr || data.vertical_rate || data.baro_rate || data.geom_rate || null,
    baro_rate: data.baro_rate || data.vr || null,
    geom_rate: data.geom_rate || null,
    lat: data.lat || data.latitude || null,
    lon: data.lon || data.longitude || data.lng || null,
    squawk: data.squawk || null,
    seen: data.seen || 0,
    rssi: data.rssi || null,
    distance_nm: data.distance_nm || data.distance || null,
    category: data.category || null,
    military: data.military || false,
    emergency: data.emergency || false,
    ...data  // Keep original fields too
  };
};

const handleAlertTriggered = (alertData) => {
  const history = JSON.parse(localStorage.getItem('alert-history') || '[]');
  history.unshift({
    ...alertData,
    id: Date.now(),
    timestamp: new Date().toISOString()
  });
  localStorage.setItem('alert-history', JSON.stringify(history.slice(0, 100)));

  if (Notification.permission === 'granted') {
    new Notification(alertData.rule_name || 'ADS-B Alert', {
      body: alertData.message || `Aircraft ${alertData.icao} triggered alert`,
      icon: '/favicon.ico',
      tag: `alert-${alertData.icao}`,
      requireInteraction: alertData.priority === 'emergency'
    });
  }
};

export function useSSE(enabled, apiBase) {
  const [aircraft, setAircraft] = useState({});
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState({ count: 0 });
  const [safetyEvents, setSafetyEvents] = useState([]);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    if (!enabled) return;

    const connect = () => {
      const baseUrl = apiBase || '';
      const url = `${baseUrl}/api/v1/map/sse?poll=true`;
      console.log('SSE connecting to:', url);
      
      eventSourceRef.current = new EventSource(url);

      eventSourceRef.current.onopen = () => {
        console.log('SSE connection opened');
        setConnected(true);
      };
      
      eventSourceRef.current.onerror = (err) => {
        console.error('SSE error:', err);
        setConnected(false);
        eventSourceRef.current?.close();
        setTimeout(connect, 5000);
      };

      eventSourceRef.current.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.aircraft && Array.isArray(data.aircraft)) {
            setAircraft(prev => {
              const updated = { ...prev };
              data.aircraft.forEach(ac => {
                const normalized = normalizeAircraft(ac);
                if (normalized.hex) {
                  updated[normalized.hex] = { ...updated[normalized.hex], ...normalized };
                }
              });
              return updated;
            });
          }
        } catch (err) {
          // Ignore parse errors
        }
      };

      eventSourceRef.current.addEventListener('aircraft_new', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.aircraft && Array.isArray(data.aircraft)) {
            data.aircraft.forEach(ac => {
              const normalized = normalizeAircraft(ac);
              if (normalized.hex) {
                setAircraft(prev => ({ ...prev, [normalized.hex]: normalized }));
              }
            });
          } else {
            const normalized = normalizeAircraft(data);
            if (normalized.hex) {
              setAircraft(prev => ({ ...prev, [normalized.hex]: normalized }));
            }
          }
        } catch (err) {
          console.error('SSE aircraft_new parse error:', err);
        }
      });

      eventSourceRef.current.addEventListener('aircraft_update', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.aircraft && Array.isArray(data.aircraft)) {
            setAircraft(prev => {
              const updated = { ...prev };
              data.aircraft.forEach(ac => {
                const normalized = normalizeAircraft(ac);
                if (normalized.hex) {
                  updated[normalized.hex] = { ...updated[normalized.hex], ...normalized };
                }
              });
              return updated;
            });
          } else {
            const normalized = normalizeAircraft(data);
            if (normalized.hex) {
              setAircraft(prev => ({
                ...prev,
                [normalized.hex]: { ...prev[normalized.hex], ...normalized }
              }));
            }
          }
        } catch (err) {
          console.error('SSE aircraft_update parse error:', err);
        }
      });

      eventSourceRef.current.addEventListener('aircraft_remove', (e) => {
        try {
          const data = JSON.parse(e.data);
          setAircraft(prev => {
            const next = { ...prev };
            const hexList = data.icao_list || data.hex_list || (data.hex ? [data.hex] : []);
            hexList.forEach(hex => {
              if (hex) delete next[hex.toUpperCase()];
            });
            return next;
          });
        } catch (err) {
          console.error('SSE aircraft_remove parse error:', err);
        }
      });

      eventSourceRef.current.addEventListener('heartbeat', (e) => {
        try {
          const data = JSON.parse(e.data);
          setStats(prev => ({ 
            ...prev, 
            count: data.count ?? data.aircraft_count ?? prev.count, 
            timestamp: data.timestamp 
          }));
        } catch (err) {
          console.error('SSE heartbeat parse error:', err);
        }
      });

      eventSourceRef.current.addEventListener('alert', (e) => {
        try {
          const data = JSON.parse(e.data);
          handleAlertTriggered(data);
        } catch (err) {
          console.error('SSE alert parse error:', err);
        }
      });

      // Safety events (TCAS, proximity, extreme VS, etc.)
      eventSourceRef.current.addEventListener('safety_event', (e) => {
        try {
          const data = JSON.parse(e.data);
          console.log('SSE safety_event:', data);
          // Handle both single event and array format
          if (Array.isArray(data)) {
            setSafetyEvents(prev => {
              const newEvents = [...data, ...prev].slice(0, 50); // Keep last 50
              return newEvents;
            });
          } else {
            setSafetyEvents(prev => [data, ...prev].slice(0, 50));
          }
        } catch (err) {
          console.error('SSE safety_event parse error:', err);
        }
      });

      eventSourceRef.current.addEventListener('history_start', () => {
        console.log('SSE history replay starting');
      });

      eventSourceRef.current.addEventListener('history_end', () => {
        console.log('SSE history replay ended');
      });
    };

    connect();
    return () => {
      console.log('SSE disconnecting');
      eventSourceRef.current?.close();
    };
  }, [enabled, apiBase]);

  return {
    aircraft: Object.values(aircraft),
    connected,
    stats,
    safetyEvents
  };
}

export function useApi(endpoint, interval = null, apiBase = '') {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const baseUrl = apiBase || '';
      const res = await fetch(`${baseUrl}${endpoint}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [endpoint, apiBase]);

  useEffect(() => {
    fetchData();
    if (interval) {
      const id = setInterval(fetchData, interval);
      return () => clearInterval(id);
    }
  }, [fetchData, interval]);

  return { data, loading, error, refetch: fetchData };
}
