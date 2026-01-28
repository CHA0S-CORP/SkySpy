import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getTailInfo, callsignsMatch } from '../../../utils';
import { getGlobalAudioState, subscribeToAudioStateChanges, setAutoplay, setAutoplayFilter, clearAutoplayFilter } from '../../views/AudioView';

// Helper to safely parse JSON from fetch response
const safeJson = async (res) => {
  if (!res.ok) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try { return await res.json(); } catch { return null; }
};

const VALID_DETAIL_TABS = ['info', 'live', 'radio', 'acars', 'safety', 'history', 'track'];

// ACARS message label descriptions
const acarsLabelDescriptions = {
  '_d': 'Command/Response', 'H1': 'Departure Message', 'H2': 'Arrival Message',
  '5Z': 'Airline Designated', '80': 'Terminal Weather', '81': 'Terminal Weather',
  '83': 'Request Terminal Weather', 'B1': 'Request Departure Clearance',
  'B2': 'Departure Clearance', 'B3': 'Request Oceanic Clearance',
  'B4': 'Oceanic Clearance', 'B5': 'Departure Slot', 'B6': 'Expected Departure Clearance',
  'BA': 'Beacon Request', 'C1': 'Position Report', 'CA': 'CPDLC',
  'Q0': 'Link Test', 'Q1': 'Link Test', 'Q2': 'Link Test', 'QA': 'ACARS Test',
  'SA': 'System Report', 'SQ': 'Squawk Report',
  '10': 'OUT - Leaving Gate', '11': 'OFF - Takeoff', '12': 'ON - Landing',
  '13': 'IN - Arrived Gate', '14': 'ETA Report', '15': 'Flight Status',
  '16': 'Route Change', '17': 'Fuel Report', '20': 'Delay Report',
  '21': 'Delay Report', '22': 'Ground Delay', '23': 'Estimated Gate Arrival',
  '24': 'Crew Report', '25': 'Passenger Count', '26': 'Connecting Passengers',
  '27': 'Load Report', '28': 'Weight & Balance', '29': 'Cargo/Mail', '2Z': 'Progress Report',
  '30': 'Request Weather', '31': 'METAR', '32': 'TAF', '33': 'ATIS',
  '34': 'PIREP', '35': 'Wind Data', '36': 'SIGMET', '37': 'NOTAM',
  '38': 'Turbulence Report', '39': 'Weather Update', '3M': 'METAR Request', '3S': 'SIGMET Request',
  '40': 'Flight Plan', '41': 'Flight Plan Amendment', '42': 'Route Request',
  '43': 'Oceanic Report', '44': 'Position Report', '45': 'Flight Level Change',
  '46': 'Speed Change', '47': 'Waypoint Report', '48': 'ETA Update', '49': 'Fuel Status',
  '4A': 'Company Specific', '4M': 'Company Specific',
  '50': 'Maintenance Message', '51': 'Engine Report', '52': 'APU Report',
  '53': 'Fault Report', '54': 'System Status', '55': 'Configuration',
  '56': 'Performance Data', '57': 'Trend Data', '58': 'Oil Status',
  '59': 'Exceedance Report', '5A': 'Technical Log', '5U': 'Airline Specific',
  'AA': 'Free Text', 'AB': 'Free Text Reply', 'F3': 'Free Text', 'F5': 'Free Text',
  'F7': 'Departure Info', 'FA': 'Free Text', 'FF': 'Free Text',
  'AD': 'ADS-C Report', 'AE': 'ADS-C Emergency', 'AF': 'ADS-C Contract',
  'A0': 'FANS Application', 'A1': 'CPDLC Connect', 'A2': 'CPDLC Disconnect',
  'A3': 'CPDLC Uplink', 'A4': 'CPDLC Downlink', 'A5': 'CPDLC Cancel',
  'A6': 'CPDLC Status', 'A7': 'CPDLC Error', 'CR': 'CPDLC Request', 'CC': 'CPDLC Communication',
  'D1': 'Data Link', 'D2': 'Data Link', 'RA': 'ACARS Uplink', 'RF': 'Radio Frequency',
  'MA': 'Media Advisory', '00': 'Heartbeat', '7A': 'Telex', '8A': 'Company Specific',
  '8D': 'Telex Delivery', '8E': 'Telex Error',
};

// Quick filter categories with their associated labels
const quickFilterCategories = {
  position: { name: 'Position', labels: ['C1', 'SQ', '47', '2Z', 'AD', 'AE'] },
  weather: { name: 'Weather', labels: ['15', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '44', '80', '81', '83', '3M', '3S'] },
  oooi: { name: 'OOOI', labels: ['10', '11', '12', '13', '14', '16', '17'] },
  operational: { name: 'Operational', labels: ['H1', 'H2', '5Z', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', 'B1', 'B2', 'B9'] },
  freetext: { name: 'Free Text', labels: ['AA', 'AB', 'FA', 'FF', 'F3', 'F5', 'F7'] },
  maintenance: { name: 'Maintenance', labels: ['50', '51', '52', '53', '54', '55', '56', '57', '58', '59', '5A', '5U'] },
};

export function getAcarsLabelDescription(label, msgLabelInfo = null) {
  if (!label) return null;
  if (msgLabelInfo?.name) return msgLabelInfo.name;
  return acarsLabelDescriptions[label.toUpperCase()] || acarsLabelDescriptions[label] || null;
}

export function getLabelCategory(label) {
  if (!label) return null;
  const upperLabel = label.toUpperCase();
  if (['C1', 'SQ', '47', '2Z', 'AD', 'AE'].includes(upperLabel)) return 'position';
  if (['15', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '44', '80', '81', '83', '3M', '3S'].includes(upperLabel)) return 'weather';
  if (['10', '11', '12', '13', '14', '16', '17'].includes(upperLabel)) return 'oooi';
  if (['H1', 'H2', '5Z', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', 'B1', 'B2', 'B9'].includes(upperLabel)) return 'operational';
  if (['AA', 'AB', 'FA', 'FF', 'F3', 'F5', 'F7'].includes(upperLabel)) return 'freetext';
  if (['50', '51', '52', '53', '54', '55', '56', '57', '58', '59', '5A', '5U'].includes(upperLabel)) return 'maintenance';
  if (['CA', 'CR', 'CC', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'AF', 'D1', 'D2'].includes(upperLabel)) return 'cpdlc';
  return null;
}

export { quickFilterCategories, VALID_DETAIL_TABS };

export function useAircraftDetail({
  hex,
  apiUrl,
  aircraft,
  aircraftInfo,
  feederLocation,
  wsRequest,
  wsConnected,
  initialTab,
  onTabChange
}) {
  const baseUrl = (apiUrl || '').replace(/\/$/, ''); // Strip trailing slash

  // Core state
  const [info, setInfo] = useState(aircraftInfo || null);
  const [loading, setLoading] = useState(true);
  const [loadedTabs, setLoadedTabs] = useState({});
  const [shareSuccess, setShareSuccess] = useState(false);
  const [activeTab, setActiveTabState] = useState(() =>
    VALID_DETAIL_TABS.includes(initialTab) ? initialTab : 'info'
  );

  // Photo state
  const [photoInfo, setPhotoInfo] = useState(null);
  const [photoState, setPhotoState] = useState('loading');
  const [photoRetryCount, setPhotoRetryCount] = useState(0);
  const [useThumbnail, setUseThumbnail] = useState(false);
  const [photoStatus, setPhotoStatus] = useState(null);
  const retryPhotoRef = useRef(null);

  // ACARS state
  const [acarsMessages, setAcarsMessages] = useState([]);
  const [acarsHours, setAcarsHours] = useState(24);
  const [acarsCompactMode, setAcarsCompactMode] = useState(false);
  const [acarsQuickFilters, setAcarsQuickFilters] = useState([]);
  const [expandedMessages, setExpandedMessages] = useState({});
  const [allMessagesExpanded, setAllMessagesExpanded] = useState(false);

  // Safety state
  const [safetyEvents, setSafetyEvents] = useState([]);
  const [safetyHours, setSafetyHours] = useState(24);
  const [expandedSnapshots, setExpandedSnapshots] = useState({});
  const [expandedSafetyMaps, setExpandedSafetyMaps] = useState({});
  const [safetyTrackData, setSafetyTrackData] = useState({});
  const [safetyReplayState, setSafetyReplayState] = useState({});

  // Radio state
  const [radioTransmissions, setRadioTransmissions] = useState([]);
  const [radioHours, setRadioHours] = useState(24);
  const [radioLoading, setRadioLoading] = useState(false);
  const [radioSearchQuery, setRadioSearchQuery] = useState('');
  const [radioStatusFilter, setRadioStatusFilter] = useState('all');
  const [radioPlayingId, setRadioPlayingId] = useState(null);
  const [radioAudioProgress, setRadioAudioProgress] = useState({});
  const [radioAudioDurations, setRadioAudioDurations] = useState({});
  const [radioExpandedTranscript, setRadioExpandedTranscript] = useState({});
  const [radioAutoplay, setRadioAutoplay] = useState(false);

  // History/sightings state
  const [sightings, setSightings] = useState([]);
  const [showTrackMap, setShowTrackMap] = useState(false);
  const [replayPosition, setReplayPosition] = useState(100);
  const [isPlaying, setIsPlaying] = useState(false);

  // Track tab state
  const [trackReplayPosition, setTrackReplayPosition] = useState(100);
  const [trackIsPlaying, setTrackIsPlaying] = useState(false);
  const [trackReplaySpeed, setTrackReplaySpeed] = useState(1);
  const [showTrackPoints, setShowTrackPoints] = useState(false);
  const [trackLiveMode, setTrackLiveMode] = useState(true);
  const [showTelemOverlay, setShowTelemOverlay] = useState(true);

  // Graph zoom state
  const [graphZoom, setGraphZoom] = useState(1);
  const [graphScrollOffset, setGraphScrollOffset] = useState(0);

  // Derived values
  const tailInfo = getTailInfo(hex, aircraft?.flight);

  // Helper to ensure photo URLs are absolute (handles relative API paths)
  const resolvePhotoUrl = (url) => {
    if (!url) return null;
    // If URL starts with /api/, prefix with baseUrl to handle cross-origin dev setups
    if (url.startsWith('/api/')) {
      return `${baseUrl}${url}`;
    }
    // Already absolute URL (http:// or https://)
    return url;
  };

  const photoUrl = photoInfo
    ? resolvePhotoUrl(useThumbnail
        ? (photoInfo.thumbnail_url || photoInfo.photo_url)
        : (photoInfo.photo_url || photoInfo.thumbnail_url))
    : null;

  // Tab management
  const setActiveTab = useCallback((tab) => {
    setActiveTabState(tab);
    if (onTabChange) onTabChange(tab);
  }, [onTabChange]);

  // Sync with initialTab prop changes
  useEffect(() => {
    if (initialTab && VALID_DETAIL_TABS.includes(initialTab) && initialTab !== activeTab) {
      setActiveTabState(initialTab);
    }
  }, [initialTab, activeTab]);

  // Reset loaded tabs when aircraft changes
  useEffect(() => {
    setLoadedTabs({});
  }, [hex]);

  // Share URL functionality
  const handleShare = useCallback(async () => {
    const url = `${window.location.origin}${window.location.pathname}#airframe?icao=${hex}${activeTab !== 'info' ? `&tab=${activeTab}` : ''}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `Aircraft ${aircraft?.flight?.trim() || hex}`,
          text: `View aircraft ${aircraft?.flight?.trim() || hex} details`,
          url: url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        setShareSuccess(true);
        setTimeout(() => setShareSuccess(false), 2000);
      }
    } catch (err) {
      try {
        await navigator.clipboard.writeText(url);
        setShareSuccess(true);
        setTimeout(() => setShareSuccess(false), 2000);
      } catch (clipErr) {
        console.error('Failed to share:', clipErr);
      }
    }
  }, [hex, activeTab, aircraft?.flight]);

  // Calculate distance from feeder
  const calculateDistance = useCallback((ac) => {
    if (!ac?.lat || !ac?.lon) return null;
    if (ac.distance_nm !== undefined) return ac.distance_nm;
    if (ac.r_dst !== undefined) return ac.r_dst;
    const feederLat = feederLocation?.lat;
    const feederLon = feederLocation?.lon;
    if (!feederLat || !feederLon) return null;
    const dLat = (ac.lat - feederLat) * 60;
    const dLon = (ac.lon - feederLon) * 60 * Math.cos(feederLat * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLon * dLon);
  }, [feederLocation]);

  // Photo handling
  useEffect(() => {
    setPhotoState('loading');
    setPhotoRetryCount(0);
    setUseThumbnail(false);
  }, [hex]);

  const handlePhotoError = useCallback(() => {
    if (!useThumbnail) {
      setUseThumbnail(true);
      setPhotoState('loading');
      setPhotoStatus({ message: 'High quality failed, trying thumbnail...', type: 'info' });
    } else {
      setPhotoState('error');
      setPhotoStatus({ message: 'No photo available', type: 'error' });
    }
  }, [useThumbnail]);

  const handlePhotoLoad = useCallback(() => {
    setPhotoState('loaded');
    if (useThumbnail) {
      setPhotoStatus({ message: 'Showing thumbnail (high quality unavailable)', type: 'info' });
    } else {
      setPhotoStatus({ message: 'High quality photo loaded', type: 'success' });
    }
    setTimeout(() => setPhotoStatus(null), 3000);
  }, [useThumbnail]);

  const retryPhoto = useCallback(async () => {
    if (retryPhotoRef.current) {
      clearInterval(retryPhotoRef.current);
      retryPhotoRef.current = null;
    }
    setPhotoState('loading');
    setUseThumbnail(false);
    setPhotoRetryCount(c => c + 1);
    setPhotoStatus({ message: 'Fetching photo...', type: 'info' });

    // Trigger photo fetch with force=true to re-fetch from sources
    try {
      await fetch(`${baseUrl}/api/v1/airframes/${hex}/photos/fetch/?force=true`, { method: 'POST' });
    } catch {}

    // Poll for result using main airframes endpoint (has consistent field names)
    let attempts = 0;
    retryPhotoRef.current = setInterval(async () => {
      attempts++;
      if (attempts > 10) {
        clearInterval(retryPhotoRef.current);
        retryPhotoRef.current = null;
        setPhotoState('error');
        setPhotoStatus({ message: 'Photo not available', type: 'error' });
        return;
      }
      setPhotoStatus({ message: `Fetching photo... (${30 - attempts * 3}s)`, type: 'info' });
      try {
        const res = await fetch(`${baseUrl}/api/v1/airframes/${hex}/`);
        const data = await safeJson(res);
        if (data?.photo_url) {
          clearInterval(retryPhotoRef.current);
          retryPhotoRef.current = null;
          setPhotoInfo({
            photo_url: data.photo_url,
            thumbnail_url: data.photo_thumbnail_url,
            photographer: data.photo_photographer,
            source: data.photo_source,
          });
          setPhotoState('loaded');
          setPhotoStatus(null);
        }
      } catch {}
    }, 3000);
  }, [hex, baseUrl]);

  // Cleanup retry interval
  useEffect(() => {
    return () => {
      if (retryPhotoRef.current) {
        clearInterval(retryPhotoRef.current);
        retryPhotoRef.current = null;
      }
    };
  }, [hex]);

  // Load info and photo on mount
  useEffect(() => {
    const fetchInfoAndPhoto = async () => {
      setLoading(true);
      try {
        if (!info) {
          let infoData = null;
          // Try airframes endpoint first (includes photo data)
          let infoRes = await fetch(`${baseUrl}/api/v1/airframes/${hex}/`);
          infoData = await safeJson(infoRes);

          // If airframes not found, try lookup endpoint
          if (!infoData || infoData.error || infoRes.status === 404) {
            infoRes = await fetch(`${baseUrl}/api/v1/lookup/aircraft/${hex}`);
            infoData = await safeJson(infoRes);
          }

          // Also try OpenSky lookup for additional data
          if (!infoData || !infoData.registration) {
            try {
              const openskRes = await fetch(`${baseUrl}/api/v1/lookup/opensky/${hex}`);
              const openskyData = await safeJson(openskRes);
              if (openskyData && !openskyData.error) {
                infoData = { ...openskyData, ...infoData };
              }
            } catch (e) {
              // OpenSky lookup failed, continue with what we have
            }
          }

          if (infoData && !infoData.error) {
            setInfo(infoData);
            // Extract photo info from the response
            if (infoData.photo_url || infoData.photo_thumbnail_url) {
              setPhotoInfo({
                photo_url: infoData.photo_url,
                thumbnail_url: infoData.photo_thumbnail_url,
                photographer: infoData.photo_photographer,
                source: infoData.photo_source,
              });
              setPhotoState('loaded');
            } else {
              // No photo - trigger fetch in background
              setPhotoState('loading');
              fetch(`${baseUrl}/api/v1/airframes/${hex}/photos/fetch/`, { method: 'POST' }).catch(() => {});
              // Poll for photo
              let attempts = 0;
              const pollInterval = setInterval(async () => {
                attempts++;
                if (attempts > 5) {
                  clearInterval(pollInterval);
                  setPhotoState('error');
                  return;
                }
                try {
                  const retryRes = await fetch(`${baseUrl}/api/v1/airframes/${hex}/`);
                  const retryData = await safeJson(retryRes);
                  if (retryData?.photo_url) {
                    clearInterval(pollInterval);
                    setPhotoInfo({
                      photo_url: retryData.photo_url,
                      thumbnail_url: retryData.photo_thumbnail_url,
                    });
                    setPhotoState('loaded');
                  }
                } catch {}
              }, 3000);
            }
          } else {
            setPhotoState('error');
          }
        }
      } catch (err) {
        console.log('Aircraft detail fetch error:', err.message);
      }
      setLoading(false);
      setLoadedTabs(prev => ({ ...prev, info: true }));
    };
    fetchInfoAndPhoto();
  }, [hex, baseUrl, info, wsRequest, wsConnected]);

  // Lazy load ACARS data
  const prevAcarsHoursRef = useRef(acarsHours);
  useEffect(() => {
    if (activeTab !== 'acars' || loadedTabs.acars) return;
    const fetchAcarsData = async () => {
      try {
        let acarsFound = [];
        const callsign = aircraft?.flight?.trim();
        if (wsRequest && wsConnected) {
          try {
            let result = await wsRequest('acars-messages', { icao_hex: hex, hours: acarsHours, limit: 50 });
            if (result && !result.error) acarsFound = result.messages || [];
            if (acarsFound.length === 0 && callsign) {
              result = await wsRequest('acars-messages', { callsign, hours: acarsHours, limit: 50 });
              if (result && !result.error) acarsFound = result.messages || [];
            }
          } catch (err) {
            console.debug('ACARS WS request failed:', err.message);
          }
        }
        // Django API uses /api/v1/acars (was /api/v1/acars/messages)
        if (acarsFound.length === 0) {
          const acarsRes = await fetch(`${baseUrl}/api/v1/acars?icao_hex=${hex}&hours=${acarsHours}&limit=50`);
          const acarsData = await safeJson(acarsRes);
          if (acarsData) acarsFound = acarsData.messages || acarsData.results || (Array.isArray(acarsData) ? acarsData : []);
          if (acarsFound.length === 0 && callsign) {
            const callsignRes = await fetch(`${baseUrl}/api/v1/acars?callsign=${encodeURIComponent(callsign)}&hours=${acarsHours}&limit=50`);
            const callsignData = await safeJson(callsignRes);
            if (callsignData) acarsFound = callsignData.messages || callsignData.results || (Array.isArray(callsignData) ? callsignData : []);
          }
          if (acarsFound.length === 0) {
            const recentRes = await fetch(`${baseUrl}/api/v1/acars?limit=100`);
            const recentData = await safeJson(recentRes);
            const allRecent = recentData?.messages || recentData?.results || (Array.isArray(recentData) ? recentData : []);
            acarsFound = allRecent.filter(msg =>
              (msg.icao_hex && msg.icao_hex.toUpperCase() === hex.toUpperCase()) ||
              callsignsMatch(msg.callsign, callsign)
            );
          }
        }
        setAcarsMessages(acarsFound);
        setLoadedTabs(prev => ({ ...prev, acars: true }));
      } catch (err) {
        console.log('ACARS fetch error:', err.message);
      }
    };
    fetchAcarsData();
  }, [activeTab, loadedTabs.acars, hex, baseUrl, acarsHours, aircraft?.flight, wsRequest, wsConnected]);

  // Refetch ACARS when hours change
  useEffect(() => {
    if (prevAcarsHoursRef.current === acarsHours || !loadedTabs.acars) {
      prevAcarsHoursRef.current = acarsHours;
      return;
    }
    prevAcarsHoursRef.current = acarsHours;
    const fetchAcarsMessages = async () => {
      try {
        let acarsFound = [];
        const callsign = aircraft?.flight?.trim();
        if (wsRequest && wsConnected) {
          try {
            let result = await wsRequest('acars-messages', { icao_hex: hex, hours: acarsHours, limit: 100 });
            if (result && !result.error) acarsFound = result.messages || [];
            if (acarsFound.length === 0 && callsign) {
              result = await wsRequest('acars-messages', { callsign, hours: acarsHours, limit: 100 });
              if (result && !result.error) acarsFound = result.messages || [];
            }
          } catch (err) {
            console.debug('ACARS WS request failed:', err.message);
          }
        }
        // Django API uses /api/v1/acars (was /api/v1/acars/messages)
        if (acarsFound.length === 0) {
          const acarsRes = await fetch(`${baseUrl}/api/v1/acars?icao_hex=${hex}&hours=${acarsHours}&limit=100`);
          const acarsData = await safeJson(acarsRes);
          if (acarsData) acarsFound = acarsData.messages || acarsData.results || (Array.isArray(acarsData) ? acarsData : []);
          if (acarsFound.length === 0 && callsign) {
            const callsignRes = await fetch(`${baseUrl}/api/v1/acars?callsign=${encodeURIComponent(callsign)}&hours=${acarsHours}&limit=100`);
            const callsignData = await safeJson(callsignRes);
            if (callsignData) acarsFound = callsignData.messages || callsignData.results || (Array.isArray(callsignData) ? callsignData : []);
          }
          if (acarsFound.length === 0) {
            const recentRes = await fetch(`${baseUrl}/api/v1/acars?limit=100`);
            const recentData = await safeJson(recentRes);
            const allRecent = recentData?.messages || recentData?.results || (Array.isArray(recentData) ? recentData : []);
            const cutoffTime = Date.now() - (acarsHours * 60 * 60 * 1000);
            acarsFound = allRecent.filter(msg => {
              const msgTime = typeof msg.timestamp === 'number' ? msg.timestamp * 1000 : new Date(msg.timestamp).getTime();
              const matchesAircraft = (msg.icao_hex && msg.icao_hex.toUpperCase() === hex.toUpperCase()) || callsignsMatch(msg.callsign, callsign);
              return matchesAircraft && msgTime >= cutoffTime;
            });
          }
        }
        setAcarsMessages(acarsFound);
      } catch (err) {
        console.log('ACARS messages fetch error:', err.message);
      }
    };
    fetchAcarsMessages();
  }, [acarsHours, loadedTabs.acars, hex, baseUrl, aircraft?.flight, wsRequest, wsConnected]);

  // Lazy load sightings
  useEffect(() => {
    if ((activeTab !== 'track' && activeTab !== 'history') || loadedTabs.sightings) return;
    const fetchSightingsData = async () => {
      try {
        let sightingsData;
        if (wsRequest && wsConnected) {
          try {
            const result = await wsRequest('sightings', { icao_hex: hex, hours: 24, limit: 100 });
            if (result && (result.sightings || result.results)) sightingsData = result;
          } catch (err) {
            console.debug('Sightings WS request failed:', err.message);
          }
        }
        // Django API uses /api/v1/sightings with query params (was /api/v1/history/sightings/{hex})
        if (!sightingsData) {
          const sightingsRes = await fetch(`${baseUrl}/api/v1/sightings?icao_hex=${hex}&hours=24&limit=100`);
          sightingsData = await safeJson(sightingsRes);
        }
        if (sightingsData) setSightings(sightingsData.sightings || sightingsData.results || []);
        setLoadedTabs(prev => ({ ...prev, sightings: true }));
      } catch (err) {
        console.log('Sightings fetch error:', err.message);
      }
    };
    fetchSightingsData();
  }, [activeTab, loadedTabs.sightings, hex, baseUrl, wsRequest, wsConnected]);

  // Lazy load safety events
  const prevSafetyHoursRef = useRef(safetyHours);
  useEffect(() => {
    if (activeTab !== 'safety' || loadedTabs.safety) return;
    const fetchSafetyData = async () => {
      try {
        let safetyData = null;
        if (wsRequest && wsConnected) {
          try {
            safetyData = await wsRequest('safety-events', { icao_hex: hex, hours: safetyHours, limit: 100 });
            if (safetyData?.error) safetyData = null;
          } catch (err) {
            console.debug('Safety events WS request failed:', err.message);
          }
        }
        if (!safetyData) {
          const safetyRes = await fetch(`${baseUrl}/api/v1/safety/events?icao_hex=${hex}&hours=${safetyHours}&limit=100`);
          safetyData = await safeJson(safetyRes);
        }
        if (safetyData) setSafetyEvents(safetyData.events || []);
        setLoadedTabs(prev => ({ ...prev, safety: true }));
      } catch (err) {
        console.log('Safety events fetch error:', err.message);
      }
    };
    fetchSafetyData();
  }, [activeTab, loadedTabs.safety, hex, baseUrl, safetyHours, wsRequest, wsConnected]);

  // Refetch safety events when hours change
  useEffect(() => {
    if (prevSafetyHoursRef.current === safetyHours || !loadedTabs.safety) {
      prevSafetyHoursRef.current = safetyHours;
      return;
    }
    prevSafetyHoursRef.current = safetyHours;
    const fetchSafetyEvents = async () => {
      try {
        let safetyData = null;
        if (wsRequest && wsConnected) {
          try {
            safetyData = await wsRequest('safety-events', { icao_hex: hex, hours: safetyHours, limit: 100 });
            if (safetyData?.error) safetyData = null;
          } catch (err) {
            console.debug('Safety events WS request failed:', err.message);
          }
        }
        if (!safetyData) {
          const safetyRes = await fetch(`${baseUrl}/api/v1/safety/events?icao_hex=${hex}&hours=${safetyHours}&limit=100`);
          safetyData = await safeJson(safetyRes);
        }
        if (safetyData) setSafetyEvents(safetyData.events || []);
      } catch (err) {
        console.log('Safety events fetch error:', err.message);
      }
    };
    fetchSafetyEvents();
  }, [safetyHours, loadedTabs.safety, hex, baseUrl, wsRequest, wsConnected]);

  // Lazy load radio transmissions
  const prevRadioHoursRef = useRef(radioHours);
  useEffect(() => {
    if (activeTab !== 'radio' || loadedTabs.radio) return;
    const fetchRadioTransmissions = async () => {
      setRadioLoading(true);
      try {
        const callsign = aircraft?.flight?.trim();
        let radioData = null;
        if (wsRequest && wsConnected) {
          try {
            const params = { icao: hex, include_radio_calls: true, radio_hours: radioHours, radio_limit: 50 };
            if (callsign) params.callsign = callsign;
            radioData = await wsRequest('aircraft-info', params);
            if (radioData?.error) radioData = null;
          } catch (err) {
            console.debug('Radio transmissions WS request failed:', err.message);
          }
        }
        if (!radioData) {
          const params = new URLSearchParams({
            include_radio_calls: 'true',
            radio_hours: radioHours.toString(),
            radio_limit: '50',
          });
          if (callsign) params.append('callsign', callsign);
          const res = await fetch(`${baseUrl}/api/v1/audio/matched/?${params}`);
          radioData = await safeJson(res);
        }
        if (radioData) setRadioTransmissions(radioData.matched_calls || []);
        setLoadedTabs(prev => ({ ...prev, radio: true }));
      } catch (err) {
        console.log('Radio transmissions fetch error:', err.message);
      }
      setRadioLoading(false);
    };
    fetchRadioTransmissions();
  }, [activeTab, loadedTabs.radio, hex, baseUrl, radioHours, aircraft?.flight, wsRequest, wsConnected]);

  // Refetch radio transmissions when hours change
  useEffect(() => {
    if (prevRadioHoursRef.current === radioHours || !loadedTabs.radio) {
      prevRadioHoursRef.current = radioHours;
      return;
    }
    prevRadioHoursRef.current = radioHours;
    const fetchRadioTransmissions = async () => {
      setRadioLoading(true);
      try {
        const callsign = aircraft?.flight?.trim();
        let radioData = null;
        if (wsRequest && wsConnected) {
          try {
            const params = { icao: hex, include_radio_calls: true, radio_hours: radioHours, radio_limit: 50 };
            if (callsign) params.callsign = callsign;
            radioData = await wsRequest('aircraft-info', params);
            if (radioData?.error) radioData = null;
          } catch (err) {
            console.debug('Radio transmissions WS request failed:', err.message);
          }
        }
        if (!radioData) {
          const params = new URLSearchParams({
            include_radio_calls: 'true',
            radio_hours: radioHours.toString(),
            radio_limit: '50',
          });
          if (callsign) params.append('callsign', callsign);
          const res = await fetch(`${baseUrl}/api/v1/audio/matched/?${params}`);
          radioData = await safeJson(res);
        }
        if (radioData) setRadioTransmissions(radioData.matched_calls || []);
      } catch (err) {
        console.log('Radio transmissions fetch error:', err.message);
      }
      setRadioLoading(false);
    };
    fetchRadioTransmissions();
  }, [radioHours, loadedTabs.radio, hex, baseUrl, aircraft?.flight, wsRequest, wsConnected]);

  // Subscribe to global audio state
  useEffect(() => {
    const unsubscribe = subscribeToAudioStateChanges((updates) => {
      if ('playingId' in updates) setRadioPlayingId(updates.playingId);
      if ('audioProgress' in updates) setRadioAudioProgress(updates.audioProgress);
      if ('audioDurations' in updates) setRadioAudioDurations(updates.audioDurations);
      if ('autoplay' in updates) setRadioAutoplay(updates.autoplay);
    });
    const audioState = getGlobalAudioState();
    setRadioPlayingId(audioState.playingId);
    setRadioAudioProgress(audioState.audioProgress);
    setRadioAudioDurations(audioState.audioDurations);
    setRadioAutoplay(audioState.autoplay);
    return unsubscribe;
  }, []);

  // Periodically refresh sightings in live mode on Track tab
  useEffect(() => {
    if (activeTab !== 'track' || !trackLiveMode) return;
    const refreshSightings = async () => {
      try {
        let data;
        if (wsRequest && wsConnected) {
          const result = await wsRequest('sightings', { icao_hex: hex, hours: 24, limit: 100 });
          if (result && (result.sightings || result.results)) data = result;
          else throw new Error('Invalid sightings response');
        } else {
          // Django API uses /api/v1/sightings with query params (was /api/v1/history/sightings/{hex})
          const res = await fetch(`${baseUrl}/api/v1/sightings?icao_hex=${hex}&hours=24&limit=100`);
          data = await safeJson(res);
          if (!data) throw new Error('HTTP request failed');
        }
        if (data) setSightings(data.sightings || data.results || []);
      } catch (err) {
        console.log('Sightings refresh error:', err.message);
      }
    };
    const interval = setInterval(refreshSightings, 30000);
    return () => clearInterval(interval);
  }, [activeTab, trackLiveMode, hex, baseUrl, wsRequest, wsConnected]);

  // Filter radio transmissions
  const filteredRadioTransmissions = useMemo(() => {
    if (!radioTransmissions.length) return [];
    return radioTransmissions.filter(t => {
      if (radioSearchQuery) {
        const query = radioSearchQuery.toLowerCase();
        const matchesSearch =
          t.channel_name?.toLowerCase().includes(query) ||
          t.transcript?.toLowerCase().includes(query) ||
          t.matched_callsign?.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }
      if (radioStatusFilter === 'transcribed' && !t.transcript) return false;
      if (radioStatusFilter === 'no_transcript' && t.transcript) return false;
      return true;
    });
  }, [radioTransmissions, radioSearchQuery, radioStatusFilter]);

  // Radio audio handlers
  const handleRadioPlay = useCallback((transmission) => {
    const globalState = getGlobalAudioState();
    const id = transmission.id;

    if (globalState.playingId && globalState.playingId !== id) {
      const prevAudio = globalState.audioRefs[globalState.playingId];
      if (prevAudio) {
        prevAudio.pause();
        prevAudio.currentTime = 0;
      }
    }

    let audio = globalState.audioRefs[id];
    if (!audio) {
      audio = new Audio(transmission.audio_url);
      globalState.audioRefs[id] = audio;

      audio.addEventListener('loadedmetadata', () => {
        globalState.audioDurations[id] = audio.duration;
        setRadioAudioDurations(prev => ({ ...prev, [id]: audio.duration }));
      });

      audio.addEventListener('ended', () => {
        globalState.playingId = null;
        globalState.audioProgress[id] = 0;
        setRadioPlayingId(null);
        setRadioAudioProgress(prev => ({ ...prev, [id]: 0 }));

        if (globalState.autoplay && globalState.autoplayFilter?.hex === hex) {
          const filteredList = filteredRadioTransmissions;
          const currentIndex = filteredList.findIndex(t => t.id === id);
          if (currentIndex !== -1 && currentIndex < filteredList.length - 1) {
            const nextTransmission = filteredList[currentIndex + 1];
            if (nextTransmission?.audio_url) {
              setTimeout(() => handleRadioPlay(nextTransmission), 100);
            }
          }
        }
      });

      audio.addEventListener('error', (e) => {
        console.error('Radio audio playback error:', e);
        globalState.playingId = null;
        setRadioPlayingId(null);
      });
    }

    if (globalState.playingId === id) {
      audio.pause();
      globalState.playingId = null;
      setRadioPlayingId(null);
      if (globalState.progressIntervalRef) clearInterval(globalState.progressIntervalRef);
    } else {
      audio.play().catch(err => console.error('Failed to play radio audio:', err));
      globalState.playingId = id;
      setRadioPlayingId(id);

      globalState.progressIntervalRef = setInterval(() => {
        if (audio && !audio.paused) {
          const progress = (audio.currentTime / audio.duration) * 100 || 0;
          globalState.audioProgress[id] = progress;
          setRadioAudioProgress(prev => ({ ...prev, [id]: progress }));
        }
      }, 100);
    }
  }, [hex, filteredRadioTransmissions]);

  const handleRadioSeek = useCallback((id, e) => {
    const globalState = getGlobalAudioState();
    const audio = globalState.audioRefs[id];
    if (!audio) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    audio.currentTime = percent * audio.duration;
    globalState.audioProgress[id] = percent * 100;
    setRadioAudioProgress(prev => ({ ...prev, [id]: percent * 100 }));
  }, []);

  const toggleRadioAutoplay = useCallback(() => {
    const globalState = getGlobalAudioState();
    const callsign = aircraft?.flight?.trim();
    if (radioAutoplay && globalState.autoplayFilter?.hex === hex) {
      setAutoplay(false);
      clearAutoplayFilter();
      setRadioAutoplay(false);
    } else {
      setAutoplay(true);
      setAutoplayFilter({ type: 'airframe', callsign, hex });
      setRadioAutoplay(true);
      if (!globalState.playingId && filteredRadioTransmissions.length > 0) {
        const first = filteredRadioTransmissions[0];
        if (first?.audio_url) handleRadioPlay(first);
      }
    }
  }, [hex, aircraft?.flight, radioAutoplay, handleRadioPlay, filteredRadioTransmissions]);

  return {
    // Core
    hex,
    info,
    loading,
    loadedTabs,
    activeTab,
    setActiveTab,
    tailInfo,
    baseUrl,
    shareSuccess,
    handleShare,
    calculateDistance,

    // Photo
    photoInfo,
    photoUrl,
    photoState,
    photoRetryCount,
    useThumbnail,
    photoStatus,
    handlePhotoError,
    handlePhotoLoad,
    retryPhoto,

    // ACARS
    acarsMessages,
    acarsHours,
    setAcarsHours,
    acarsCompactMode,
    setAcarsCompactMode,
    acarsQuickFilters,
    setAcarsQuickFilters,
    expandedMessages,
    setExpandedMessages,
    allMessagesExpanded,
    setAllMessagesExpanded,

    // Safety
    safetyEvents,
    safetyHours,
    setSafetyHours,
    expandedSnapshots,
    setExpandedSnapshots,
    expandedSafetyMaps,
    setExpandedSafetyMaps,
    safetyTrackData,
    setSafetyTrackData,
    safetyReplayState,
    setSafetyReplayState,

    // Radio
    radioTransmissions,
    radioHours,
    setRadioHours,
    radioLoading,
    radioSearchQuery,
    setRadioSearchQuery,
    radioStatusFilter,
    setRadioStatusFilter,
    radioPlayingId,
    radioAudioProgress,
    radioAudioDurations,
    radioExpandedTranscript,
    setRadioExpandedTranscript,
    radioAutoplay,
    filteredRadioTransmissions,
    handleRadioPlay,
    handleRadioSeek,
    toggleRadioAutoplay,

    // History/sightings
    sightings,
    setSightings,
    showTrackMap,
    setShowTrackMap,
    replayPosition,
    setReplayPosition,
    isPlaying,
    setIsPlaying,

    // Track tab
    trackReplayPosition,
    setTrackReplayPosition,
    trackIsPlaying,
    setTrackIsPlaying,
    trackReplaySpeed,
    setTrackReplaySpeed,
    showTrackPoints,
    setShowTrackPoints,
    trackLiveMode,
    setTrackLiveMode,
    showTelemOverlay,
    setShowTelemOverlay,

    // Graphs
    graphZoom,
    setGraphZoom,
    graphScrollOffset,
    setGraphScrollOffset,
  };
}
