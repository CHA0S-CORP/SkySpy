import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, RefreshCw, Camera, Info, Radar, MessageCircle, History,
  Plane, Building2, Hash, ExternalLink, WifiOff, AlertTriangle, ChevronDown, ChevronUp,
  Map as MapIcon, Play, Pause, SkipBack, SkipForward, CircleDot, Radio
} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getTailInfo, getCardinalDirection, callsignsMatch } from '../../utils';

export function AircraftDetailPage({ hex, apiUrl, onClose, onSelectAircraft, onViewHistoryEvent, onViewEvent, aircraft, aircraftInfo, trackHistory, feederLocation }) {
  const [info, setInfo] = useState(aircraftInfo || null);

  // Calculate distance from feeder if not provided
  const calculateDistance = (ac) => {
    if (!ac?.lat || !ac?.lon) return null;
    if (ac.distance_nm !== undefined) return ac.distance_nm;
    if (ac.r_dst !== undefined) return ac.r_dst;

    // Calculate from feeder location if available
    const feederLat = feederLocation?.lat;
    const feederLon = feederLocation?.lon;
    if (!feederLat || !feederLon) return null;

    const dLat = (ac.lat - feederLat) * 60; // degrees to nm (approximate)
    const dLon = (ac.lon - feederLon) * 60 * Math.cos(feederLat * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLon * dLon);
  };
  const [photoInfo, setPhotoInfo] = useState(null);
  const [acarsMessages, setAcarsMessages] = useState([]);
  const [acarsHours, setAcarsHours] = useState(24);

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
  const getAcarsLabelDescription = (label) => {
    if (!label) return null;
    return acarsLabelDescriptions[label.toUpperCase()] || acarsLabelDescriptions[label] || null;
  };
  const [sightings, setSightings] = useState([]);
  const [safetyEvents, setSafetyEvents] = useState([]);
  const [safetyHours, setSafetyHours] = useState(24);
  const [expandedSnapshots, setExpandedSnapshots] = useState({});
  const [expandedSafetyMaps, setExpandedSafetyMaps] = useState({});
  const [safetyTrackData, setSafetyTrackData] = useState({});
  const [safetyReplayState, setSafetyReplayState] = useState({});
  const safetyMapRefs = useRef({});
  const safetyMarkersRef = useRef({});
  const safetyTracksRef = useRef({});
  const safetyAnimationRef = useRef({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('info');
  const [photoState, setPhotoState] = useState('loading');
  const [photoRetryCount, setPhotoRetryCount] = useState(0);
  const [useThumbnail, setUseThumbnail] = useState(false);
  const [showTrackMap, setShowTrackMap] = useState(false);
  const [replayPosition, setReplayPosition] = useState(100);
  const [isPlaying, setIsPlaying] = useState(false);
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const replayMarkerRef = useRef(null);
  const animationRef = useRef(null);

  // Track tab specific refs
  const trackMapRef = useRef(null);
  const trackMarkerRef = useRef(null);
  const trackAnimationRef = useRef(null);
  const trackPlayingRef = useRef(false); // Ref to control animation loop
  const trackPolylineRef = useRef(null);
  const trackPointsLayerRef = useRef(null);
  const [trackReplayPosition, setTrackReplayPosition] = useState(100);
  const [trackIsPlaying, setTrackIsPlaying] = useState(false);
  const [trackReplaySpeed, setTrackReplaySpeed] = useState(1); // 0.25x, 0.5x, 1x, 2x, 4x
  const [showTrackPoints, setShowTrackPoints] = useState(false);
  const [trackLiveMode, setTrackLiveMode] = useState(true); // Follow live position
  const [showTelemOverlay, setShowTelemOverlay] = useState(true); // Telemetry overlay collapsed/expanded

  // Graph zoom/scroll state (synced across all graphs)
  const [graphZoom, setGraphZoom] = useState(1); // 1 = 100%, 2 = 200%, etc
  const [graphScrollOffset, setGraphScrollOffset] = useState(0); // 0-100 percentage offset
  const graphDragRef = useRef({ isDragging: false, startX: 0, startOffset: 0 });

  const baseUrl = apiUrl || '';
  const photoUrl = useThumbnail
    ? `${baseUrl}/api/v1/aircraft/${hex}/photo/download?thumbnail=true${photoRetryCount > 0 ? `&t=${photoRetryCount}` : ''}`
    : `${baseUrl}/api/v1/aircraft/${hex}/photo/download${photoRetryCount > 0 ? `?t=${photoRetryCount}` : ''}`;

  useEffect(() => {
    setPhotoState('loading');
    setPhotoRetryCount(0);
    setUseThumbnail(false);
  }, [hex]);

  const handlePhotoError = () => {
    if (!useThumbnail) {
      // Try thumbnail as fallback
      setUseThumbnail(true);
      setPhotoState('loading');
    } else {
      // Both failed, show error
      setPhotoState('error');
    }
  };

  const retryPhoto = () => {
    setPhotoState('loading');
    setUseThumbnail(false);
    setPhotoRetryCount(c => c + 1);
  };
  
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      
      try {
        if (!info) {
          const infoRes = await fetch(`${baseUrl}/api/v1/aircraft/${hex}/info`);
          if (infoRes.ok) {
            const data = await infoRes.json();
            setInfo(data);
          }
        }
        
        const photoMetaRes = await fetch(`${baseUrl}/api/v1/aircraft/${hex}/photo`);
        if (photoMetaRes.ok) {
          const data = await photoMetaRes.json();
          setPhotoInfo(data);
        }
        
        // Try database query first by ICAO hex, then by callsign, then fall back to recent buffer
        let acarsFound = [];
        const callsign = aircraft?.flight?.trim();

        // Query by ICAO hex
        const acarsRes = await fetch(`${baseUrl}/api/v1/acars/messages?icao_hex=${hex}&hours=24&limit=50`);
        if (acarsRes.ok) {
          const data = await acarsRes.json();
          acarsFound = data.messages || [];
        }

        // If no results by hex, try by callsign (ACARS often has callsign but not hex)
        if (acarsFound.length === 0 && callsign) {
          const callsignRes = await fetch(`${baseUrl}/api/v1/acars/messages?callsign=${encodeURIComponent(callsign)}&hours=24&limit=50`);
          if (callsignRes.ok) {
            const data = await callsignRes.json();
            acarsFound = data.messages || [];
          }
        }

        // If still no messages found, try recent messages buffer and filter client-side
        if (acarsFound.length === 0) {
          const recentRes = await fetch(`${baseUrl}/api/v1/acars/messages/recent?limit=100`);
          if (recentRes.ok) {
            const data = await recentRes.json();
            const allRecent = data.messages || [];
            // Filter by icao_hex or callsign (handles IATA/ICAO conversion)
            acarsFound = allRecent.filter(msg =>
              (msg.icao_hex && msg.icao_hex.toUpperCase() === hex.toUpperCase()) ||
              callsignsMatch(msg.callsign, callsign)
            );
          }
        }
        setAcarsMessages(acarsFound);
        
        const sightingsRes = await fetch(`${baseUrl}/api/v1/history/sightings/${hex}?hours=24&limit=100`);
        if (sightingsRes.ok) {
          const data = await sightingsRes.json();
          setSightings(data.sightings || []);
        }

        const safetyRes = await fetch(`${baseUrl}/api/v1/safety/events?icao_hex=${hex}&hours=24&limit=100`);
        if (safetyRes.ok) {
          const data = await safetyRes.json();
          setSafetyEvents(data.events || []);
        }
      } catch (err) {
        console.log('Aircraft detail fetch error:', err.message);
      }
      
      setLoading(false);
    };
    
    fetchData();
  }, [hex, baseUrl, info]);

  // Refetch ACARS messages when hours filter changes
  useEffect(() => {
    const fetchAcarsMessages = async () => {
      try {
        let acarsFound = [];
        const callsign = aircraft?.flight?.trim();

        // Query by ICAO hex
        const acarsRes = await fetch(`${baseUrl}/api/v1/acars/messages?icao_hex=${hex}&hours=${acarsHours}&limit=100`);
        if (acarsRes.ok) {
          const data = await acarsRes.json();
          acarsFound = data.messages || [];
        }

        // If no results by hex, try by callsign
        if (acarsFound.length === 0 && callsign) {
          const callsignRes = await fetch(`${baseUrl}/api/v1/acars/messages?callsign=${encodeURIComponent(callsign)}&hours=${acarsHours}&limit=100`);
          if (callsignRes.ok) {
            const data = await callsignRes.json();
            acarsFound = data.messages || [];
          }
        }

        // If still no messages found, try recent messages buffer and filter client-side
        if (acarsFound.length === 0) {
          const recentRes = await fetch(`${baseUrl}/api/v1/acars/messages/recent?limit=100`);
          if (recentRes.ok) {
            const data = await recentRes.json();
            const allRecent = data.messages || [];
            const cutoffTime = Date.now() - (acarsHours * 60 * 60 * 1000);
            acarsFound = allRecent.filter(msg => {
              const msgTime = typeof msg.timestamp === 'number'
                ? msg.timestamp * 1000
                : new Date(msg.timestamp).getTime();
              const matchesAircraft = (msg.icao_hex && msg.icao_hex.toUpperCase() === hex.toUpperCase()) ||
                callsignsMatch(msg.callsign, callsign);
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
  }, [hex, baseUrl, acarsHours, aircraft]);

  // Refetch safety events when hours filter changes
  useEffect(() => {
    const fetchSafetyEvents = async () => {
      try {
        const safetyRes = await fetch(`${baseUrl}/api/v1/safety/events?icao_hex=${hex}&hours=${safetyHours}&limit=100`);
        if (safetyRes.ok) {
          const data = await safetyRes.json();
          setSafetyEvents(data.events || []);
        }
      } catch (err) {
        console.log('Safety events fetch error:', err.message);
      }
    };
    fetchSafetyEvents();
  }, [hex, baseUrl, safetyHours]);

  // Periodically refresh sightings when in live mode on Track tab
  useEffect(() => {
    if (activeTab !== 'track' || !trackLiveMode) return;

    const refreshSightings = async () => {
      try {
        const res = await fetch(`${baseUrl}/api/v1/history/sightings/${hex}?hours=24&limit=100`);
        if (res.ok) {
          const data = await res.json();
          setSightings(data.sightings || []);
        }
      } catch (err) {
        console.log('Sightings refresh error:', err.message);
      }
    };

    // Refresh every 5 seconds when in live mode
    const interval = setInterval(refreshSightings, 5000);
    return () => clearInterval(interval);
  }, [activeTab, trackLiveMode, hex, baseUrl]);

  const tailInfo = getTailInfo(hex, aircraft?.flight);

  // Helper to get severity class
  const getSeverityClass = (severity) => {
    switch (severity) {
      case 'critical': return 'severity-critical';
      case 'warning': return 'severity-warning';
      case 'low': return 'severity-low';
      default: return '';
    }
  };

  // Helper to format event type
  const formatEventType = (type) => {
    const types = {
      'tcas_ra': 'TCAS RA',
      'tcas_ta': 'TCAS TA',
      'extreme_vs': 'Extreme VS',
      'vs_reversal': 'VS Reversal',
      'proximity_conflict': 'Proximity',
      'squawk_hijack': 'Squawk 7500',
      'squawk_radio_failure': 'Squawk 7600',
      'squawk_emergency': 'Squawk 7700'
    };
    return types[type] || type;
  };

  // Toggle snapshot expansion
  const toggleSnapshot = (eventId) => {
    setExpandedSnapshots(prev => ({
      ...prev,
      [eventId]: !prev[eventId]
    }));
  };

  // Create aircraft icon for map
  const createAircraftIcon = useCallback((track, color) => {
    const rotation = track || 0;
    return L.divIcon({
      className: 'safety-aircraft-marker',
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

  // Get smoothly interpolated position along track
  const getInterpolatedPosition = useCallback((positions, percentage) => {
    if (!positions || positions.length === 0) return null;
    if (positions.length === 1) return positions[0];

    // Positions are newest first, reverse for timeline order
    const ordered = [...positions].reverse();

    // Calculate exact position between points
    const exactIndex = (percentage / 100) * (ordered.length - 1);
    const lowerIndex = Math.floor(exactIndex);
    const upperIndex = Math.min(lowerIndex + 1, ordered.length - 1);
    const fraction = exactIndex - lowerIndex;

    // If we're exactly on a point or at the end, return that point
    if (lowerIndex === upperIndex || fraction === 0) {
      return ordered[lowerIndex];
    }

    const p1 = ordered[lowerIndex];
    const p2 = ordered[upperIndex];

    // Helper to interpolate angles (handles 359° -> 1° wraparound)
    const lerpAngle = (a1, a2, t) => {
      if (a1 === null || a1 === undefined || a2 === null || a2 === undefined) return a1;
      let diff = a2 - a1;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      return ((a1 + diff * t) + 360) % 360;
    };

    // Linear interpolation helper
    const lerp = (v1, v2, t) => {
      if (v1 === null || v1 === undefined) return v2;
      if (v2 === null || v2 === undefined) return v1;
      return v1 + (v2 - v1) * t;
    };

    // Interpolate all values
    return {
      ...p1,
      lat: lerp(p1.lat, p2.lat, fraction),
      lon: lerp(p1.lon, p2.lon, fraction),
      altitude: Math.round(lerp(p1.altitude, p2.altitude, fraction)),
      gs: lerp(p1.gs, p2.gs, fraction),
      vr: Math.round(lerp(p1.vr, p2.vr, fraction)),
      baro_rate: Math.round(lerp(p1.baro_rate, p2.baro_rate, fraction)),
      geom_rate: Math.round(lerp(p1.geom_rate, p2.geom_rate, fraction)),
      track: lerpAngle(p1.track, p2.track, fraction),
      // Keep timestamp from lower point for display
      timestamp: p1.timestamp
    };
  }, []);

  // Initialize map when shown
  const initializeMap = useCallback((containerEl) => {
    if (!containerEl || mapRef.current) return;
    if (!sightings || sightings.length === 0) return;

    // Get bounds from sightings
    const validSightings = sightings.filter(s => s.lat && s.lon);
    if (validSightings.length === 0) return;

    // Center on most recent position
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

    // Add track polyline (oldest to newest for proper line drawing)
    const trackCoords = [...validSightings].reverse().map(s => [s.lat, s.lon]);
    if (trackCoords.length > 1) {
      L.polyline(trackCoords, {
        color: '#00ff88',
        weight: 3,
        opacity: 0.7
      }).addTo(map);
    }

    // Add position markers along track (every few points)
    const step = Math.max(1, Math.floor(validSightings.length / 20));
    validSightings.forEach((s, i) => {
      if (i % step === 0 || i === 0 || i === validSightings.length - 1) {
        const isFirst = i === validSightings.length - 1; // Oldest (after reverse)
        const isLast = i === 0; // Newest

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

    // Add feeder location if available
    if (feederLocation?.lat && feederLocation?.lon) {
      L.circleMarker([feederLocation.lat, feederLocation.lon], {
        radius: 8,
        color: '#ff4444',
        fillColor: '#ff4444',
        fillOpacity: 0.3,
        weight: 2
      }).addTo(map).bindPopup('<b>Feeder Location</b>');
    }

    // Add replay marker
    const pos = getInterpolatedPosition(validSightings, replayPosition);
    if (pos) {
      const icon = createAircraftIcon(pos.track, '#00ff88');
      replayMarkerRef.current = L.marker([pos.lat, pos.lon], { icon }).addTo(map);
    }

    // Fit bounds to track
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
  }, [updateReplayMarker]);

  // Toggle play/pause
  const togglePlay = useCallback(() => {
    setIsPlaying(prev => {
      if (!prev) {
        // Start playing
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
        // Stop playing
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
        return false;
      }
    });
  }, [replayPosition, updateReplayMarker]);

  // Skip to start/end
  const skipToStart = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    setIsPlaying(false);
    setReplayPosition(0);
    updateReplayMarker(0);
  }, [updateReplayMarker]);

  const skipToEnd = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    setIsPlaying(false);
    setReplayPosition(100);
    updateReplayMarker(100);
  }, [updateReplayMarker]);

  // Get timestamp for replay position
  const getReplayTimestamp = useCallback(() => {
    if (!sightings || sightings.length === 0) return null;
    const validSightings = sightings.filter(s => s.lat && s.lon);
    const pos = getInterpolatedPosition(validSightings, replayPosition);
    if (!pos?.timestamp) return null;
    return new Date(pos.timestamp).toLocaleTimeString();
  }, [sightings, replayPosition, getInterpolatedPosition]);

  // Handle graph wheel zoom (synced)
  const handleGraphWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.25 : 0.25;
    setGraphZoom(prev => {
      const newZoom = Math.max(1, Math.min(8, prev + delta));
      // Adjust scroll offset when zooming to keep centered
      if (newZoom < prev) {
        // Zooming out - clamp offset
        const maxOffset = Math.max(0, 100 - (100 / newZoom));
        setGraphScrollOffset(off => Math.min(off, maxOffset));
      }
      return newZoom;
    });
  }, []);

  // Handle graph drag start
  const handleGraphDragStart = useCallback((e) => {
    if (graphZoom <= 1) return;
    graphDragRef.current = {
      isDragging: true,
      startX: e.clientX || e.touches?.[0]?.clientX || 0,
      startOffset: graphScrollOffset
    };
  }, [graphZoom, graphScrollOffset]);

  // Handle graph drag move
  const handleGraphDragMove = useCallback((e) => {
    if (!graphDragRef.current.isDragging) return;
    const currentX = e.clientX || e.touches?.[0]?.clientX || 0;
    const deltaX = graphDragRef.current.startX - currentX;
    const graphWidth = 200; // matches width in renderMiniGraph
    const visiblePercent = 100 / graphZoom;
    const maxOffset = 100 - visiblePercent;
    // Convert pixel delta to percentage
    const percentDelta = (deltaX / graphWidth) * visiblePercent;
    const newOffset = Math.max(0, Math.min(maxOffset, graphDragRef.current.startOffset + percentDelta));
    setGraphScrollOffset(newOffset);
  }, [graphZoom]);

  // Handle graph drag end
  const handleGraphDragEnd = useCallback(() => {
    graphDragRef.current.isDragging = false;
  }, []);

  // Reset graph zoom
  const resetGraphZoom = useCallback(() => {
    setGraphZoom(1);
    setGraphScrollOffset(0);
  }, []);

  // Render mini graph with zoom/scroll and optional position indicator
  const renderMiniGraph = useCallback((dataKey, color, label, unit, formatFn, positionPercent = null) => {
    if (!sightings || sightings.length < 2) return null;

    const ordered = [...sightings].reverse();
    const values = ordered.map(p => p[dataKey]).filter(v => v != null);
    if (values.length < 2) return null;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const width = 200;
    const height = 40;
    const padding = 2;

    const isZoomed = graphZoom > 1;
    let visiblePoints, visibleMin, visibleMax, startPercent, endPercent, visiblePercent;

    if (isZoomed) {
      // Calculate visible window based on zoom and scroll
      visiblePercent = 100 / graphZoom;
      startPercent = graphScrollOffset;
      endPercent = startPercent + visiblePercent;

      // Filter and map points within visible range
      visiblePoints = values.map((v, i) => {
        const dataPercent = (i / (values.length - 1)) * 100;
        if (dataPercent < startPercent || dataPercent > endPercent) return null;
        // Map to visible window coordinates
        const normalizedPercent = (dataPercent - startPercent) / visiblePercent;
        const x = padding + normalizedPercent * (width - padding * 2);
        const y = height - padding - ((v - min) / range) * (height - padding * 2);
        return { x, y, value: v, dataPercent };
      }).filter(Boolean);

      const visibleVals = visiblePoints.map(p => p.value);
      visibleMin = visibleVals.length > 0 ? Math.min(...visibleVals) : min;
      visibleMax = visibleVals.length > 0 ? Math.max(...visibleVals) : max;
    } else {
      // Not zoomed - use all values, map directly to full width
      startPercent = 0;
      endPercent = 100;
      visiblePercent = 100;
      visiblePoints = values.map((v, i) => {
        const x = padding + (i / (values.length - 1)) * (width - padding * 2);
        const y = height - padding - ((v - min) / range) * (height - padding * 2);
        return { x, y, value: v, dataPercent: (i / (values.length - 1)) * 100 };
      });
      visibleMin = min;
      visibleMax = max;
    }

    const points = visiblePoints.map(p => `${p.x},${p.y}`).join(' ');

    const format = formatFn || (v => v?.toLocaleString());

    // Calculate position indicator X coordinate (accounting for zoom/scroll)
    let indicatorX = null;
    let indicatorY = null;
    let currentValue = null;
    if (positionPercent !== null) {
      // Check if position is within visible range
      if (positionPercent >= startPercent && positionPercent <= endPercent) {
        const normalizedPercent = (positionPercent - startPercent) / visiblePercent;
        indicatorX = padding + normalizedPercent * (width - padding * 2);
        const idx = Math.floor((positionPercent / 100) * (values.length - 1));
        currentValue = values[Math.max(0, Math.min(idx, values.length - 1))];
        indicatorY = height - padding - ((currentValue - min) / range) * (height - padding * 2);
      } else {
        // Position is outside visible range - still show current value
        const idx = Math.floor((positionPercent / 100) * (values.length - 1));
        currentValue = values[Math.max(0, Math.min(idx, values.length - 1))];
      }
    }

    return (
      <div
        className={`mini-graph ${graphZoom > 1 ? 'zoomable' : ''}`}
        onWheel={handleGraphWheel}
        onMouseDown={handleGraphDragStart}
        onMouseMove={handleGraphDragMove}
        onMouseUp={handleGraphDragEnd}
        onMouseLeave={handleGraphDragEnd}
        onTouchStart={handleGraphDragStart}
        onTouchMove={handleGraphDragMove}
        onTouchEnd={handleGraphDragEnd}
      >
        <div className="mini-graph-header">
          <span className="mini-graph-label">{label}</span>
          {graphZoom > 1 && (
            <span className="mini-graph-zoom" onClick={resetGraphZoom} title="Reset zoom">
              {graphZoom.toFixed(1)}x
            </span>
          )}
          {currentValue !== null && (
            <span className="mini-graph-current" style={{ color }}>
              {format(currentValue)} {unit}
            </span>
          )}
        </div>
        <svg width={width} height={height} className="mini-graph-svg">
          {visiblePoints.length > 1 && (
            <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" opacity="0.6" />
          )}
          {indicatorX !== null && indicatorY !== null && (
            <>
              <line
                x1={indicatorX}
                y1={0}
                x2={indicatorX}
                y2={height}
                stroke={color}
                strokeWidth="2"
                opacity="0.9"
              />
              <circle
                cx={indicatorX}
                cy={indicatorY}
                r="4"
                fill={color}
                stroke="#000"
                strokeWidth="1"
              />
            </>
          )}
        </svg>
        <div className="mini-graph-range">
          <span>{format(visibleMin)} {unit}</span>
          <span>{format(visibleMax)} {unit}</span>
        </div>
      </div>
    );
  }, [sightings, graphZoom, graphScrollOffset, handleGraphWheel, handleGraphDragStart, handleGraphDragMove, handleGraphDragEnd, resetGraphZoom]);

  // Cleanup map on unmount or when hiding
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

  // Cleanup map when hiding or changing aircraft
  useEffect(() => {
    if (!showTrackMap && mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
      replayMarkerRef.current = null;
    }
  }, [showTrackMap]);

  // Reset map when aircraft changes
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
      replayMarkerRef.current = null;
    }
    if (trackMapRef.current) {
      trackMapRef.current.remove();
      trackMapRef.current = null;
      trackMarkerRef.current = null;
    }
    setShowTrackMap(false);
    setReplayPosition(100);
    setIsPlaying(false);
    setTrackReplayPosition(100);
    setTrackIsPlaying(false);
    setGraphZoom(1);
    setGraphScrollOffset(0);
  }, [hex]);

  // Cleanup track map when switching tabs
  useEffect(() => {
    if (activeTab !== 'track' && trackMapRef.current) {
      trackMapRef.current.remove();
      trackMapRef.current = null;
      trackMarkerRef.current = null;
    }
    if (trackAnimationRef.current) {
      cancelAnimationFrame(trackAnimationRef.current);
    }
  }, [activeTab]);

  // Initialize track tab map
  const initializeTrackMap = useCallback((containerEl) => {
    if (!containerEl || trackMapRef.current) return;
    if (!sightings || sightings.length === 0) return;

    const validSightings = sightings.filter(s => s.lat && s.lon);
    if (validSightings.length === 0) return;

    const latest = validSightings[0];

    const map = L.map(containerEl, {
      center: [latest.lat, latest.lon],
      zoom: 10,
      zoomControl: false,
      attributionControl: false
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(map);

    // Add track polyline (store reference for live updates)
    const trackCoords = [...validSightings].reverse().map(s => [s.lat, s.lon]);
    if (trackCoords.length > 1) {
      trackPolylineRef.current = L.polyline(trackCoords, {
        color: '#00ff88',
        weight: 3,
        opacity: 0.7
      }).addTo(map);
    }

    // Create layer group for track points (store reference for toggling)
    trackPointsLayerRef.current = L.layerGroup().addTo(map);

    // Add position markers along track
    const step = Math.max(1, Math.floor(validSightings.length / 20));
    validSightings.forEach((s, i) => {
      if (i % step === 0 || i === 0 || i === validSightings.length - 1) {
        const isFirst = i === validSightings.length - 1;
        const isLast = i === 0;

        // Start/end markers always visible, intermediate ones in layer group
        const marker = L.circleMarker([s.lat, s.lon], {
          radius: isFirst || isLast ? 6 : 3,
          color: isLast ? '#00ff88' : isFirst ? '#ff8844' : '#5a7a9a',
          fillColor: isLast ? '#00ff88' : isFirst ? '#ff8844' : '#5a7a9a',
          fillOpacity: 0.8,
          weight: 1
        });

        if (isFirst || isLast) {
          marker.addTo(map);
        } else if (showTrackPoints) {
          marker.addTo(trackPointsLayerRef.current);
        }
      }
    });

    // Add feeder location
    if (feederLocation?.lat && feederLocation?.lon) {
      L.circleMarker([feederLocation.lat, feederLocation.lon], {
        radius: 8,
        color: '#ff4444',
        fillColor: '#ff4444',
        fillOpacity: 0.3,
        weight: 2
      }).addTo(map);
    }

    // Add replay marker at current position
    const pos = getInterpolatedPosition(validSightings, trackReplayPosition);
    if (pos) {
      const icon = createAircraftIcon(pos.track, '#00ff88');
      trackMarkerRef.current = L.marker([pos.lat, pos.lon], { icon }).addTo(map);
    }

    // Fit bounds
    if (trackCoords.length > 1) {
      const bounds = L.latLngBounds(trackCoords);
      map.fitBounds(bounds.pad(0.1));
    }

    trackMapRef.current = map;
  }, [sightings, feederLocation, trackReplayPosition, getInterpolatedPosition, createAircraftIcon, showTrackPoints]);

  // Live update track map when sightings change
  useEffect(() => {
    if (!trackMapRef.current || !sightings || sightings.length === 0) return;

    const validSightings = sightings.filter(s => s.lat && s.lon);
    if (validSightings.length === 0) return;

    // Update polyline with new coordinates
    const trackCoords = [...validSightings].reverse().map(s => [s.lat, s.lon]);
    if (trackPolylineRef.current) {
      trackPolylineRef.current.setLatLngs(trackCoords);
    }

    // If in live mode, keep position at 100% and update marker to latest position
    if (trackLiveMode && !trackIsPlaying) {
      setTrackReplayPosition(100);
      // Update marker to current position
      const latest = validSightings[0];
      if (latest && trackMarkerRef.current) {
        trackMapRef.current.removeLayer(trackMarkerRef.current);
        const icon = createAircraftIcon(latest.track, '#00ff88');
        trackMarkerRef.current = L.marker([latest.lat, latest.lon], { icon }).addTo(trackMapRef.current);
        // Pan to follow
        trackMapRef.current.panTo([latest.lat, latest.lon], { animate: true, duration: 0.3 });
      }
    }
  }, [sightings, trackLiveMode, trackIsPlaying, createAircraftIcon]);

  // Also update live position from aircraft prop (more frequent updates)
  useEffect(() => {
    if (!trackMapRef.current || !trackLiveMode || trackIsPlaying) return;
    if (!aircraft?.lat || !aircraft?.lon) return;

    // Update marker to current aircraft position
    if (trackMarkerRef.current) {
      trackMapRef.current.removeLayer(trackMarkerRef.current);
    }
    const icon = createAircraftIcon(aircraft.track, '#00ff88');
    trackMarkerRef.current = L.marker([aircraft.lat, aircraft.lon], { icon }).addTo(trackMapRef.current);
    // Pan to follow
    trackMapRef.current.panTo([aircraft.lat, aircraft.lon], { animate: true, duration: 0.3 });
  }, [aircraft?.lat, aircraft?.lon, aircraft?.track, trackLiveMode, trackIsPlaying, createAircraftIcon]);

  // Toggle track points visibility
  useEffect(() => {
    if (!trackMapRef.current || !trackPointsLayerRef.current) return;

    trackPointsLayerRef.current.clearLayers();

    if (showTrackPoints && sightings && sightings.length > 0) {
      const validSightings = sightings.filter(s => s.lat && s.lon);
      const step = Math.max(1, Math.floor(validSightings.length / 20));

      validSightings.forEach((s, i) => {
        // Skip first and last (they're added directly to map)
        if (i !== 0 && i !== validSightings.length - 1 && i % step === 0) {
          L.circleMarker([s.lat, s.lon], {
            radius: 3,
            color: '#5a7a9a',
            fillColor: '#5a7a9a',
            fillOpacity: 0.8,
            weight: 1
          }).addTo(trackPointsLayerRef.current);
        }
      });
    }
  }, [showTrackPoints, sightings]);

  // Update track marker position and follow aircraft
  const updateTrackMarker = useCallback((position, follow = true) => {
    if (!trackMapRef.current || !sightings || sightings.length === 0) return;

    const validSightings = sightings.filter(s => s.lat && s.lon);
    const pos = getInterpolatedPosition(validSightings, position);
    if (!pos) return;

    if (trackMarkerRef.current) {
      trackMapRef.current.removeLayer(trackMarkerRef.current);
    }

    const icon = createAircraftIcon(pos.track, '#00ff88');
    trackMarkerRef.current = L.marker([pos.lat, pos.lon], { icon }).addTo(trackMapRef.current);

    // Pan map to follow the aircraft smoothly
    if (follow) {
      trackMapRef.current.panTo([pos.lat, pos.lon], { animate: true, duration: 0.15 });
    }
  }, [sightings, getInterpolatedPosition, createAircraftIcon]);

  // Handle track replay slider change
  const handleTrackReplayChange = useCallback((newPosition) => {
    // Disable live mode when user manually scrubs
    if (newPosition < 100) {
      setTrackLiveMode(false);
    }
    setTrackReplayPosition(newPosition);
    updateTrackMarker(newPosition);
  }, [updateTrackMarker]);

  // Toggle track play/pause
  const toggleTrackPlay = useCallback(() => {
    if (trackPlayingRef.current) {
      // Pause
      trackPlayingRef.current = false;
      if (trackAnimationRef.current) {
        cancelAnimationFrame(trackAnimationRef.current);
        trackAnimationRef.current = null;
      }
      setTrackIsPlaying(false);
    } else {
      // Play
      trackPlayingRef.current = true;
      setTrackLiveMode(false);
      setTrackIsPlaying(true);

      let pos = trackReplayPosition <= 0 ? 0 : trackReplayPosition;
      let lastTime = performance.now();

      const animate = (currentTime) => {
        if (!trackPlayingRef.current) return; // Stop if paused

        const deltaTime = currentTime - lastTime;
        lastTime = currentTime;
        // Base speed: 100% in ~20 seconds at 1x, adjusted by trackReplaySpeed
        const increment = (deltaTime / 200) * trackReplaySpeed;
        pos += increment;

        if (pos >= 100) {
          trackPlayingRef.current = false;
          setTrackReplayPosition(100);
          updateTrackMarker(100);
          setTrackIsPlaying(false);
          setTrackLiveMode(true);
          return;
        }

        setTrackReplayPosition(pos);
        updateTrackMarker(pos);
        trackAnimationRef.current = requestAnimationFrame(animate);
      };

      trackAnimationRef.current = requestAnimationFrame(animate);
    }
  }, [trackReplayPosition, updateTrackMarker, trackReplaySpeed]);

  // Skip to start/end for track tab
  const skipTrackToStart = useCallback(() => {
    trackPlayingRef.current = false;
    if (trackAnimationRef.current) cancelAnimationFrame(trackAnimationRef.current);
    setTrackIsPlaying(false);
    setTrackLiveMode(false); // Disable live mode when going to start
    setTrackReplayPosition(0);
    updateTrackMarker(0);
  }, [updateTrackMarker]);

  const skipTrackToEnd = useCallback(() => {
    trackPlayingRef.current = false;
    if (trackAnimationRef.current) cancelAnimationFrame(trackAnimationRef.current);
    setTrackIsPlaying(false);
    setTrackLiveMode(true); // Enable live mode when going to end
    setTrackReplayPosition(100);
    updateTrackMarker(100);
  }, [updateTrackMarker]);

  // Get current telemetry for track replay position (or live aircraft data)
  const getTrackTelemetry = useCallback(() => {
    // In live mode, return current aircraft data
    if (trackLiveMode && aircraft) {
      return {
        lat: aircraft.lat,
        lon: aircraft.lon,
        altitude: aircraft.alt_baro !== 'ground' ? aircraft.alt_baro : aircraft.alt_geom,
        gs: aircraft.gs,
        vr: aircraft.baro_rate ?? aircraft.geom_rate,
        baro_rate: aircraft.baro_rate,
        geom_rate: aircraft.geom_rate,
        track: aircraft.track,
        timestamp: new Date().toISOString()
      };
    }
    if (!sightings || sightings.length === 0) return null;
    const validSightings = sightings.filter(s => s.lat && s.lon);
    return getInterpolatedPosition(validSightings, trackReplayPosition);
  }, [sightings, trackReplayPosition, getInterpolatedPosition, trackLiveMode, aircraft]);

  // Toggle safety event map
  const toggleSafetyMap = useCallback(async (eventId, event) => {
    const isExpanding = !expandedSafetyMaps[eventId];
    setExpandedSafetyMaps(prev => ({ ...prev, [eventId]: isExpanding }));

    if (isExpanding && !safetyTrackData[eventId]) {
      // Fetch track data for both aircraft around the event time
      const eventTime = new Date(event.timestamp);
      const startTime = new Date(eventTime.getTime() - 5 * 60 * 1000); // 5 min before
      const endTime = new Date(eventTime.getTime() + 5 * 60 * 1000); // 5 min after

      try {
        const fetchTracks = async (icao) => {
          if (!icao) return [];
          const res = await fetch(`${baseUrl}/api/v1/history/sightings/${icao}?hours=1&limit=500`);
          if (!res.ok) return [];
          const data = await res.json();
          // Filter to time window around event
          return (data.sightings || []).filter(s => {
            const t = new Date(s.timestamp);
            return t >= startTime && t <= endTime && s.lat && s.lon;
          });
        };

        const [track1, track2] = await Promise.all([
          fetchTracks(event.icao),
          fetchTracks(event.icao_2)
        ]);

        setSafetyTrackData(prev => ({
          ...prev,
          [eventId]: { track1, track2, event }
        }));

        // Initialize replay state
        setSafetyReplayState(prev => ({
          ...prev,
          [eventId]: { position: 50, isPlaying: false, speed: 1 } // Start at 50% (event time)
        }));
      } catch (err) {
        console.error('Error fetching safety track data:', err);
      }
    }
  }, [expandedSafetyMaps, safetyTrackData, baseUrl]);

  // Get interpolated position for safety replay
  const getSafetyInterpolatedPosition = useCallback((positions, percentage) => {
    if (!positions || positions.length === 0) return null;
    if (positions.length === 1) return positions[0];

    const ordered = [...positions].reverse();
    const exactIndex = (percentage / 100) * (ordered.length - 1);
    const lowerIndex = Math.floor(exactIndex);
    const upperIndex = Math.min(lowerIndex + 1, ordered.length - 1);
    const fraction = exactIndex - lowerIndex;

    if (lowerIndex === upperIndex || fraction === 0) {
      return ordered[lowerIndex];
    }

    const p1 = ordered[lowerIndex];
    const p2 = ordered[upperIndex];

    const lerp = (v1, v2, t) => {
      if (v1 == null) return v2;
      if (v2 == null) return v1;
      return v1 + (v2 - v1) * t;
    };

    const lerpAngle = (a1, a2, t) => {
      if (a1 == null || a2 == null) return a1;
      let diff = a2 - a1;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      return ((a1 + diff * t) + 360) % 360;
    };

    return {
      ...p1,
      lat: lerp(p1.lat, p2.lat, fraction),
      lon: lerp(p1.lon, p2.lon, fraction),
      altitude: Math.round(lerp(p1.altitude, p2.altitude, fraction)),
      gs: lerp(p1.gs, p2.gs, fraction),
      vr: Math.round(lerp(p1.vr, p2.vr, fraction)),
      track: lerpAngle(p1.track, p2.track, fraction),
    };
  }, []);

  // Update safety replay markers and animated tracks
  const updateSafetyReplayMarkers = useCallback((eventId, position) => {
    const map = safetyMapRefs.current[eventId];
    const data = safetyTrackData[eventId];
    if (!map || !data) return;

    // Update aircraft 1 marker and track
    if (data.track1?.length > 0) {
      const pos = getSafetyInterpolatedPosition(data.track1, position);
      if (pos) {
        if (safetyMarkersRef.current[`${eventId}_1`]) {
          map.removeLayer(safetyMarkersRef.current[`${eventId}_1`]);
        }
        const icon = createAircraftIcon(pos.track, '#00ff88');
        safetyMarkersRef.current[`${eventId}_1`] = L.marker([pos.lat, pos.lon], { icon }).addTo(map);

        // Animated track polyline
        const ordered = [...data.track1].reverse();
        const numPoints = Math.floor((position / 100) * ordered.length);
        const trackCoords = ordered.slice(0, Math.max(1, numPoints)).map(s => [s.lat, s.lon]);
        if (safetyTracksRef.current[`${eventId}_1`]) {
          map.removeLayer(safetyTracksRef.current[`${eventId}_1`]);
        }
        if (trackCoords.length > 1) {
          safetyTracksRef.current[`${eventId}_1`] = L.polyline(trackCoords, {
            color: '#00ff88',
            weight: 3,
            opacity: 0.9
          }).addTo(map);
        }
      }
    }

    // Update aircraft 2 marker and track
    if (data.track2?.length > 0) {
      const pos = getSafetyInterpolatedPosition(data.track2, position);
      if (pos) {
        if (safetyMarkersRef.current[`${eventId}_2`]) {
          map.removeLayer(safetyMarkersRef.current[`${eventId}_2`]);
        }
        const icon = createAircraftIcon(pos.track, '#ff4444');
        safetyMarkersRef.current[`${eventId}_2`] = L.marker([pos.lat, pos.lon], { icon }).addTo(map);

        // Animated track polyline
        const ordered = [...data.track2].reverse();
        const numPoints = Math.floor((position / 100) * ordered.length);
        const trackCoords = ordered.slice(0, Math.max(1, numPoints)).map(s => [s.lat, s.lon]);
        if (safetyTracksRef.current[`${eventId}_2`]) {
          map.removeLayer(safetyTracksRef.current[`${eventId}_2`]);
        }
        if (trackCoords.length > 1) {
          safetyTracksRef.current[`${eventId}_2`] = L.polyline(trackCoords, {
            color: '#ff4444',
            weight: 3,
            opacity: 0.9
          }).addTo(map);
        }
      }
    }
  }, [safetyTrackData, getSafetyInterpolatedPosition, createAircraftIcon]);

  // Handle safety replay slider change
  const handleSafetyReplayChange = useCallback((eventId, newPosition) => {
    setSafetyReplayState(prev => ({
      ...prev,
      [eventId]: { ...prev[eventId], position: newPosition }
    }));
    updateSafetyReplayMarkers(eventId, newPosition);
  }, [updateSafetyReplayMarkers]);

  // Toggle safety play/pause
  const toggleSafetyPlay = useCallback((eventId) => {
    setSafetyReplayState(prev => {
      const current = prev[eventId] || { position: 0, isPlaying: false, speed: 1 };
      if (!current.isPlaying) {
        let pos = current.position <= 0 ? 0 : current.position;
        let lastTime = performance.now();
        const speed = current.speed;
        const animate = (currentTime) => {
          const deltaTime = currentTime - lastTime;
          lastTime = currentTime;
          const increment = (deltaTime / 200) * speed;
          pos += increment;
          if (pos >= 100) {
            setSafetyReplayState(p => ({ ...p, [eventId]: { ...p[eventId], position: 100, isPlaying: false } }));
            updateSafetyReplayMarkers(eventId, 100);
            return;
          }
          setSafetyReplayState(p => ({ ...p, [eventId]: { ...p[eventId], position: pos } }));
          updateSafetyReplayMarkers(eventId, pos);
          safetyAnimationRef.current[eventId] = requestAnimationFrame(animate);
        };
        safetyAnimationRef.current[eventId] = requestAnimationFrame(animate);
        return { ...prev, [eventId]: { ...current, isPlaying: true } };
      } else {
        if (safetyAnimationRef.current[eventId]) {
          cancelAnimationFrame(safetyAnimationRef.current[eventId]);
        }
        return { ...prev, [eventId]: { ...current, isPlaying: false } };
      }
    });
  }, [updateSafetyReplayMarkers]);

  // Skip safety to start/end
  const skipSafetyToStart = useCallback((eventId) => {
    if (safetyAnimationRef.current[eventId]) cancelAnimationFrame(safetyAnimationRef.current[eventId]);
    const current = safetyReplayState[eventId] || { speed: 1 };
    setSafetyReplayState(prev => ({ ...prev, [eventId]: { position: 0, isPlaying: false, speed: current.speed } }));
    updateSafetyReplayMarkers(eventId, 0);
  }, [safetyReplayState, updateSafetyReplayMarkers]);

  const skipSafetyToEnd = useCallback((eventId) => {
    if (safetyAnimationRef.current[eventId]) cancelAnimationFrame(safetyAnimationRef.current[eventId]);
    const current = safetyReplayState[eventId] || { speed: 1 };
    setSafetyReplayState(prev => ({ ...prev, [eventId]: { position: 100, isPlaying: false, speed: current.speed } }));
    updateSafetyReplayMarkers(eventId, 100);
  }, [safetyReplayState, updateSafetyReplayMarkers]);

  // Jump to event (50% position - middle of the time window around the event)
  const jumpToSafetyEvent = useCallback((eventId) => {
    if (safetyAnimationRef.current[eventId]) cancelAnimationFrame(safetyAnimationRef.current[eventId]);
    const current = safetyReplayState[eventId] || { speed: 1 };
    setSafetyReplayState(prev => ({ ...prev, [eventId]: { position: 50, isPlaying: false, speed: current.speed } }));
    updateSafetyReplayMarkers(eventId, 50);
  }, [safetyReplayState, updateSafetyReplayMarkers]);

  // Handle safety speed change
  const handleSafetySpeedChange = useCallback((eventId, newSpeed) => {
    setSafetyReplayState(prev => ({
      ...prev,
      [eventId]: { ...prev[eventId], speed: newSpeed }
    }));
  }, []);

  // Initialize safety event map
  const initializeSafetyMap = useCallback((containerEl, eventId) => {
    if (!containerEl || safetyMapRefs.current[eventId]) return;
    const data = safetyTrackData[eventId];
    if (!data) return;

    const { track1, track2, event } = data;
    const allPoints = [...(track1 || []), ...(track2 || [])];
    if (allPoints.length === 0) return;

    // Center on event location or first point
    const centerLat = event.lat || allPoints[0]?.lat;
    const centerLon = event.lon || allPoints[0]?.lon;

    const map = L.map(containerEl, {
      center: [centerLat, centerLon],
      zoom: 11,
      zoomControl: false,
      attributionControl: false
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(map);

    // Add event marker
    if (event.lat && event.lon) {
      L.circleMarker([event.lat, event.lon], {
        radius: 10,
        color: '#ffaa00',
        fillColor: '#ffaa00',
        fillOpacity: 0.3,
        weight: 2
      }).addTo(map).bindPopup(`<b>Safety Event</b><br>${event.message || formatEventType(event.event_type)}`);
    }

    // Add faint background tracks (full path for context)
    if (track1?.length > 1) {
      const coords = [...track1].reverse().map(s => [s.lat, s.lon]);
      L.polyline(coords, { color: '#00ff88', weight: 2, opacity: 0.2 }).addTo(map);
    }
    if (track2?.length > 1) {
      const coords = [...track2].reverse().map(s => [s.lat, s.lon]);
      L.polyline(coords, { color: '#ff4444', weight: 2, opacity: 0.2 }).addTo(map);
    }

    // Fit bounds
    if (allPoints.length > 0) {
      const bounds = L.latLngBounds(allPoints.map(p => [p.lat, p.lon]));
      map.fitBounds(bounds.pad(0.1));
    }

    safetyMapRefs.current[eventId] = map;

    // Initialize markers at current replay position
    const replayState = safetyReplayState[eventId] || { position: 50 };
    setTimeout(() => updateSafetyReplayMarkers(eventId, replayState.position), 100);
  }, [safetyTrackData, safetyReplayState, updateSafetyReplayMarkers, formatEventType]);

  // Get timestamp for safety replay position
  const getSafetyReplayTimestamp = useCallback((eventId) => {
    const data = safetyTrackData[eventId];
    const state = safetyReplayState[eventId];
    if (!data || !state) return null;

    const track = data.track1?.length > 0 ? data.track1 : data.track2;
    if (!track || track.length === 0) return null;

    const pos = getSafetyInterpolatedPosition(track, state.position);
    if (!pos?.timestamp) return null;
    return new Date(pos.timestamp).toLocaleTimeString();
  }, [safetyTrackData, safetyReplayState, getSafetyInterpolatedPosition]);

  // Render safety mini graph with position indicator
  const renderSafetyMiniGraph = useCallback((track, dataKey, color, label, unit, formatFn, positionPercent) => {
    if (!track || track.length < 2) return null;

    const ordered = [...track].reverse();
    const values = ordered.map(p => p[dataKey]).filter(v => v != null);
    if (values.length < 2) return null;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const width = 180;
    const height = 35;
    const padding = 2;

    const points = values.map((v, i) => {
      const x = padding + (i / (values.length - 1)) * (width - padding * 2);
      const y = height - padding - ((v - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    }).join(' ');

    const format = formatFn || (v => v?.toLocaleString());
    const indicatorX = positionPercent !== null ? padding + (positionPercent / 100) * (width - padding * 2) : null;

    let currentValue = null;
    if (positionPercent !== null && values.length > 0) {
      const idx = Math.floor((positionPercent / 100) * (values.length - 1));
      currentValue = values[Math.max(0, Math.min(idx, values.length - 1))];
    }

    return (
      <div className="mini-graph safety-mini-graph">
        <div className="mini-graph-header">
          <span className="mini-graph-label">{label}</span>
          {currentValue !== null && (
            <span className="mini-graph-current" style={{ color }}>
              {format(currentValue)} {unit}
            </span>
          )}
        </div>
        <svg width={width} height={height} className="mini-graph-svg">
          <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" opacity="0.6" />
          {indicatorX !== null && (
            <>
              <line x1={indicatorX} y1={0} x2={indicatorX} y2={height} stroke={color} strokeWidth="2" opacity="0.9" />
              <circle
                cx={indicatorX}
                cy={(() => {
                  if (values.length === 0) return height / 2;
                  const idx = Math.floor((positionPercent / 100) * (values.length - 1));
                  const val = values[Math.max(0, Math.min(idx, values.length - 1))];
                  return height - padding - ((val - min) / range) * (height - padding * 2);
                })()}
                r="3"
                fill={color}
                stroke="#000"
                strokeWidth="1"
              />
            </>
          )}
        </svg>
      </div>
    );
  }, []);

  // Cleanup safety maps when collapsing or switching tabs
  useEffect(() => {
    if (activeTab !== 'safety') {
      Object.keys(safetyMapRefs.current).forEach(eventId => {
        if (safetyMapRefs.current[eventId]) {
          safetyMapRefs.current[eventId].remove();
          delete safetyMapRefs.current[eventId];
        }
        if (safetyAnimationRef.current[eventId]) {
          cancelAnimationFrame(safetyAnimationRef.current[eventId]);
        }
      });
      safetyMarkersRef.current = {};
      safetyTracksRef.current = {};
    }
  }, [activeTab]);

  // Cleanup safety maps when map is collapsed
  useEffect(() => {
    Object.keys(expandedSafetyMaps).forEach(eventId => {
      if (!expandedSafetyMaps[eventId] && safetyMapRefs.current[eventId]) {
        safetyMapRefs.current[eventId].remove();
        delete safetyMapRefs.current[eventId];
        delete safetyMarkersRef.current[`${eventId}_1`];
        delete safetyMarkersRef.current[`${eventId}_2`];
        delete safetyTracksRef.current[`${eventId}_1`];
        delete safetyTracksRef.current[`${eventId}_2`];
        if (safetyAnimationRef.current[eventId]) {
          cancelAnimationFrame(safetyAnimationRef.current[eventId]);
        }
      }
    });
  }, [expandedSafetyMaps]);

  // Render aircraft snapshot data
  const renderSnapshot = (snapshot, label) => {
    if (!snapshot) return null;
    return (
      <div className="snapshot-section">
        {label && <div className="snapshot-label">{label}</div>}
        <div className="snapshot-grid">
          {snapshot.flight && <div className="snapshot-item"><span>Callsign</span><span>{snapshot.flight}</span></div>}
          {snapshot.hex && <div className="snapshot-item"><span>ICAO</span>{snapshot.hex?.toLowerCase() !== hex?.toLowerCase() ? (<span className="icao-link" onClick={() => onSelectAircraft?.(snapshot.hex)}>{snapshot.hex}</span>) : (<span>{snapshot.hex}</span>)}</div>}
          {snapshot.lat && <div className="snapshot-item"><span>Lat</span><span>{snapshot.lat?.toFixed(5)}</span></div>}
          {snapshot.lon && <div className="snapshot-item"><span>Lon</span><span>{snapshot.lon?.toFixed(5)}</span></div>}
          {snapshot.alt_baro && <div className="snapshot-item"><span>Alt (baro)</span><span>{snapshot.alt_baro?.toLocaleString()} ft</span></div>}
          {snapshot.alt_geom && <div className="snapshot-item"><span>Alt (geom)</span><span>{snapshot.alt_geom?.toLocaleString()} ft</span></div>}
          {snapshot.gs && <div className="snapshot-item"><span>Ground Speed</span><span>{snapshot.gs?.toFixed(0)} kts</span></div>}
          {snapshot.track !== undefined && snapshot.track !== null && <div className="snapshot-item"><span>Track</span><span>{snapshot.track?.toFixed(0)}°</span></div>}
          {snapshot.baro_rate && <div className="snapshot-item"><span>Baro Rate</span><span>{snapshot.baro_rate > 0 ? '+' : ''}{snapshot.baro_rate} fpm</span></div>}
          {snapshot.geom_rate && <div className="snapshot-item"><span>Geom Rate</span><span>{snapshot.geom_rate > 0 ? '+' : ''}{snapshot.geom_rate} fpm</span></div>}
          {snapshot.squawk && <div className="snapshot-item"><span>Squawk</span><span>{snapshot.squawk}</span></div>}
          {snapshot.category && <div className="snapshot-item"><span>Category</span><span>{snapshot.category}</span></div>}
          {snapshot.nav_altitude_mcp && <div className="snapshot-item"><span>MCP Alt</span><span>{snapshot.nav_altitude_mcp?.toLocaleString()} ft</span></div>}
          {snapshot.nav_heading !== undefined && snapshot.nav_heading !== null && <div className="snapshot-item"><span>Nav Heading</span><span>{snapshot.nav_heading?.toFixed(0)}°</span></div>}
          {snapshot.emergency && <div className="snapshot-item"><span>Emergency</span><span>{snapshot.emergency}</span></div>}
        </div>
      </div>
    );
  };
  
  return (
    <div className="aircraft-detail-page">
      <div className="detail-header">
        <div className="detail-header-left">
          <span className="detail-flag">{tailInfo.flag}</span>
          <div className="detail-titles">
            <h1 className="detail-callsign">{aircraft?.flight?.trim() || hex?.toUpperCase()}</h1>
            <div className="detail-subtitles">
              <span className="detail-hex">{hex?.toUpperCase()}</span>
              {tailInfo.tailNumber && <span className="detail-tail">{tailInfo.tailNumber}</span>}
              {info?.registration && <span className="detail-reg">{info.registration}</span>}
              {(info?.type_name || info?.model) && <span className={`detail-model-tag ${info?.is_military ? 'military' : ''}`}>{info.type_name || info.model}</span>}
            </div>
          </div>
        </div>
        <button className="detail-close" onClick={onClose}>
          <X size={24} />
        </button>
      </div>
      
      <div className="detail-photo">
        {photoState === 'loading' && (
          <div className="photo-loading">
            <RefreshCw size={32} className="spin" />
            <span>Loading photo...</span>
          </div>
        )}
        {photoState === 'error' && (
          <div className="photo-error">
            <Camera size={48} />
            <span>No photo available</span>
            <button className="photo-retry-btn" onClick={retryPhoto}>
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        )}
        <img
          key={`${photoRetryCount}-${useThumbnail}`}
          src={photoUrl}
          alt={info?.registration || hex}
          onLoad={() => setPhotoState('loaded')}
          onError={handlePhotoError}
          style={{
            opacity: photoState === 'loaded' ? 1 : 0,
            position: photoState !== 'loaded' ? 'absolute' : 'relative',
            pointerEvents: photoState !== 'loaded' ? 'none' : 'auto'
          }}
        />
        {photoState === 'loaded' && photoInfo?.photographer && (
          <span className="photo-credit">📷 {photoInfo.photographer} via {photoInfo.source || 'planespotters.net'}</span>
        )}
      </div>
      
      <div className="detail-tabs">
        <button className={`detail-tab ${activeTab === 'info' ? 'active' : ''}`} onClick={() => setActiveTab('info')}>
          <Info size={16} /> Aircraft Info
        </button>
        <button className={`detail-tab ${activeTab === 'live' ? 'active' : ''}`} onClick={() => setActiveTab('live')}>
          <Radar size={16} /> Live Status
        </button>
        <button className={`detail-tab ${activeTab === 'acars' ? 'active' : ''}`} onClick={() => setActiveTab('acars')}>
          <MessageCircle size={16} /> ACARS ({acarsMessages.length})
        </button>
        <button className={`detail-tab ${activeTab === 'safety' ? 'active' : ''}`} onClick={() => setActiveTab('safety')}>
          <AlertTriangle size={16} /> Safety ({safetyEvents.length})
        </button>
        <button className={`detail-tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
          <History size={16} /> History
        </button>
        <button className={`detail-tab ${activeTab === 'track' ? 'active' : ''}`} onClick={() => setActiveTab('track')}>
          <MapIcon size={16} /> Track
        </button>
      </div>
      
      <div className="detail-content">
        {loading ? (
          <div className="detail-loading">
            <RefreshCw size={32} className="spin" />
            <span>Loading aircraft data...</span>
          </div>
        ) : (
          <>
            {activeTab === 'info' && info && (
              <div className="detail-info-grid">
                <div className="info-section">
                  <h3><Plane size={16} /> Airframe</h3>
                  <div className="info-rows">
                    {info.type_name && <div className="info-row"><span>Type</span><span>{info.type_name}</span></div>}
                    {info.type_code && <div className="info-row"><span>ICAO Code</span><span>{info.type_code}</span></div>}
                    {info.manufacturer && <div className="info-row"><span>Manufacturer</span><span>{info.manufacturer}</span></div>}
                    {info.model && <div className="info-row"><span>Model</span><span>{info.model}</span></div>}
                    {info.serial_number && <div className="info-row"><span>Serial #</span><span>{info.serial_number}</span></div>}
                    {info.year_built && <div className="info-row"><span>Year Built</span><span>{info.year_built}</span></div>}
                    {info.age_years && <div className="info-row"><span>Age</span><span>{info.age_years} years</span></div>}
                  </div>
                </div>
                
                <div className="info-section">
                  <h3><Building2 size={16} /> Operator</h3>
                  <div className="info-rows">
                    {info.operator && <div className="info-row"><span>Operator</span><span>{info.operator}</span></div>}
                    {info.operator_icao && <div className="info-row"><span>ICAO</span><span>{info.operator_icao}</span></div>}
                    {info.owner && <div className="info-row"><span>Owner</span><span>{info.owner}</span></div>}
                    {info.country && <div className="info-row"><span>Country</span><span>{info.country}</span></div>}
                  </div>
                </div>
                
                <div className="info-section">
                  <h3><Hash size={16} /> Registration</h3>
                  <div className="info-rows">
                    {info.registration && <div className="info-row"><span>Registration</span><span>{info.registration}</span></div>}
                    <div className="info-row"><span>ICAO Hex</span><span>{hex?.toUpperCase()}</span></div>
                    {info.is_military && <div className="info-row"><span>Type</span><span className="badge-military">Military</span></div>}
                    {info.category && <div className="info-row"><span>Category</span><span>{info.category}</span></div>}
                  </div>
                </div>
                
                {photoInfo && (
                  <div className="info-section">
                    <h3><Camera size={16} /> Photo</h3>
                    <div className="info-rows">
                      {photoInfo.photographer && <div className="info-row"><span>Photographer</span><span>{photoInfo.photographer}</span></div>}
                      {photoInfo.source && <div className="info-row"><span>Source</span><span>{photoInfo.source}</span></div>}
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {activeTab === 'info' && !info && (
              <div className="detail-empty">
                <Info size={48} />
                <p>No aircraft information available</p>
                <span>Data may not be available for this aircraft</span>
              </div>
            )}
            
            {activeTab === 'live' && aircraft && (
              <div className="detail-live">
                <div className="live-stats-grid">
                  <div className="live-stat">
                    <span className="live-label">Altitude</span>
                    <span className="live-value">
                      {(aircraft.alt_baro !== 'ground' && aircraft.alt_baro)
                        ? aircraft.alt_baro.toLocaleString()
                        : (aircraft.alt_geom?.toLocaleString() || aircraft.alt?.toLocaleString() || '--')}
                    </span>
                    <span className="live-unit">ft</span>
                  </div>
                  <div className="live-stat">
                    <span className="live-label">Ground Speed</span>
                    <span className="live-value">{aircraft.gs?.toFixed(0) || aircraft.tas?.toFixed(0) || aircraft.ias?.toFixed(0) || '--'}</span>
                    <span className="live-unit">kts</span>
                  </div>
                  <div className="live-stat">
                    <span className="live-label">Vertical Rate</span>
                    {(() => {
                      const vs = aircraft.vr ?? aircraft.baro_rate ?? aircraft.geom_rate ?? null;
                      if (vs === null) return <span className="live-value">--</span>;
                      const isExtreme = Math.abs(vs) > 3000;
                      const vsClass = vs > 0 ? 'climbing' : vs < 0 ? 'descending' : '';
                      return (
                        <span className={`live-value ${vsClass} ${isExtreme ? 'extreme-vs' : ''}`}>
                          {vs > 0 ? '+' : ''}{vs}
                        </span>
                      );
                    })()}
                    <span className="live-unit">ft/min</span>
                  </div>
                  <div className="live-stat">
                    <span className="live-label">Track</span>
                    <span className="live-value">
                      {(aircraft.track ?? aircraft.true_heading ?? aircraft.mag_heading) !== undefined
                        ? `${(aircraft.track ?? aircraft.true_heading ?? aircraft.mag_heading).toFixed(0)}°`
                        : '--'}
                    </span>
                    <span className="live-unit">{getCardinalDirection(aircraft.track ?? aircraft.true_heading ?? aircraft.mag_heading)}</span>
                  </div>
                  <div className="live-stat">
                    <span className="live-label">Distance</span>
                    <span className="live-value">{calculateDistance(aircraft)?.toFixed(1) ?? '--'}</span>
                    <span className="live-unit">nm</span>
                  </div>
                  <div className="live-stat">
                    <span className="live-label">Track History</span>
                    <span className="live-value">{trackHistory?.length || 0}</span>
                    <span className="live-unit">points</span>
                  </div>
                  <div className="live-stat">
                    <span className="live-label">Squawk</span>
                    <span className="live-value">{aircraft.squawk || '----'}</span>
                    <span className="live-unit"></span>
                  </div>
                </div>

                <div className="live-position">
                  <h4>Position</h4>
                  <div className="position-coords">
                    <span>Lat: {aircraft.lat?.toFixed(5) || '--'}</span>
                    <span>Lon: {aircraft.lon?.toFixed(5) || '--'}</span>
                  </div>
                </div>
              </div>
            )}
            
            {activeTab === 'live' && !aircraft && (
              <div className="detail-empty">
                <WifiOff size={48} />
                <p>Aircraft not currently tracked</p>
                <span>This aircraft is not in range of the receiver</span>
              </div>
            )}
            
            {activeTab === 'acars' && (
              <div className="detail-acars">
                <div className="acars-filter">
                  <label>Time Range:</label>
                  <select value={acarsHours} onChange={(e) => setAcarsHours(Number(e.target.value))}>
                    <option value={1}>Last 1 hour</option>
                    <option value={6}>Last 6 hours</option>
                    <option value={12}>Last 12 hours</option>
                    <option value={24}>Last 24 hours</option>
                    <option value={48}>Last 48 hours</option>
                    <option value={72}>Last 72 hours</option>
                    <option value={168}>Last 7 days</option>
                  </select>
                </div>
                {acarsMessages.length === 0 ? (
                  <div className="detail-empty">
                    <MessageCircle size={48} />
                    <p>No ACARS messages</p>
                    <span>No messages received from this aircraft in the selected time range</span>
                  </div>
                ) : (
                  <div className="acars-list">
                    <p className="acars-count">{acarsMessages.length} message{acarsMessages.length !== 1 ? 's' : ''} in the last {acarsHours} hour{acarsHours !== 1 ? 's' : ''}</p>
                    {acarsMessages.map((msg, i) => {
                      // Handle both Unix timestamp (number) and ISO string formats
                      const timestamp = typeof msg.timestamp === 'number'
                        ? new Date(msg.timestamp * 1000)
                        : new Date(msg.timestamp);

                      return (
                        <div key={i} className="acars-item">
                          <div className="acars-item-header">
                            <span className="acars-item-time">{timestamp.toLocaleString()}</span>
                            <span className="acars-item-label" title={getAcarsLabelDescription(msg.label) || msg.label}>
                              {msg.label || '--'}
                              {getAcarsLabelDescription(msg.label) && (
                                <span className="acars-label-desc">{getAcarsLabelDescription(msg.label)}</span>
                              )}
                            </span>
                            <span className="acars-item-source">{msg.source}</span>
                            {msg.frequency && <span className="acars-item-freq">{msg.frequency} MHz</span>}
                          </div>
                          {msg.callsign && <div className="acars-item-callsign">Callsign: {msg.callsign}</div>}
                          {msg.icao_hex && <div className="acars-item-icao">ICAO: {msg.icao_hex}</div>}
                          {msg.text && <pre className="acars-item-text">{msg.text}</pre>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            
            {activeTab === 'safety' && (
              <div className="detail-safety">
                <div className="safety-filter">
                  <label>Time Range:</label>
                  <select value={safetyHours} onChange={(e) => setSafetyHours(Number(e.target.value))}>
                    <option value={1}>Last 1 hour</option>
                    <option value={6}>Last 6 hours</option>
                    <option value={12}>Last 12 hours</option>
                    <option value={24}>Last 24 hours</option>
                    <option value={48}>Last 48 hours</option>
                    <option value={72}>Last 72 hours</option>
                    <option value={168}>Last 7 days</option>
                  </select>
                </div>
                {safetyEvents.length === 0 ? (
                  <div className="detail-empty">
                    <AlertTriangle size={48} />
                    <p>No safety events</p>
                    <span>No safety events recorded for this aircraft in the selected time range</span>
                  </div>
                ) : (
                  <div className="safety-events-list">
                    <p className="safety-count">{safetyEvents.length} safety event{safetyEvents.length !== 1 ? 's' : ''} in the last {safetyHours} hour{safetyHours !== 1 ? 's' : ''}</p>
                    {safetyEvents.map((event, i) => {
                      const eventKey = event.id || i;
                      const hasSnapshot = event.aircraft_snapshot || event.aircraft_snapshot_2;
                      const isExpanded = expandedSnapshots[eventKey];

                      return (
                        <div key={eventKey} className={`safety-event-item ${getSeverityClass(event.severity)}`}>
                          <div className="safety-event-header">
                            <span className={`safety-severity-badge ${getSeverityClass(event.severity)}`}>
                              {event.severity?.toUpperCase()}
                            </span>
                            <span className="safety-event-type">{formatEventType(event.event_type)}</span>
                            <span className="safety-event-time">{new Date(event.timestamp).toLocaleString()}</span>
                          </div>
                          <div className="safety-event-message">{event.message}</div>
                          {event.details && (
                            <div className="safety-event-details">
                              {event.details.altitude && <span>Alt: {event.details.altitude?.toLocaleString()}ft</span>}
                              {event.details.vertical_rate && <span>VS: {event.details.vertical_rate > 0 ? '+' : ''}{event.details.vertical_rate}fpm</span>}
                              {event.details.distance_nm && <span>Dist: {event.details.distance_nm}nm</span>}
                              {event.details.altitude_diff_ft && <span>ΔAlt: {event.details.altitude_diff_ft}ft</span>}
                              {(() => {
                                // Determine which aircraft is the "other" one
                                const currentHex = hex?.toLowerCase();
                                const isCurrentPrimary = event.icao?.toLowerCase() === currentHex;
                                const otherIcao = isCurrentPrimary ? event.icao_2 : event.icao;
                                const otherCallsign = isCurrentPrimary ? event.callsign_2 : event.callsign;

                                if (!otherIcao) return null;

                                return (
                                  <span className="safety-other-aircraft">
                                    With:{' '}
                                    {onSelectAircraft ? (
                                      <button
                                        className="safety-aircraft-link"
                                        onClick={() => onSelectAircraft(otherIcao)}
                                        title={`View ${otherIcao}`}
                                      >
                                        {otherCallsign || otherIcao}
                                      </button>
                                    ) : (
                                      <span>{otherCallsign || otherIcao}</span>
                                    )}
                                  </span>
                                );
                              })()}
                            </div>
                          )}
                          <div className="safety-event-actions">
                            {hasSnapshot && (
                              <button
                                className="snapshot-toggle"
                                onClick={() => toggleSnapshot(eventKey)}
                              >
                                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                {isExpanded ? 'Hide' : 'Show'} Telemetry
                              </button>
                            )}
                            <button
                              className={`map-toggle-btn small ${expandedSafetyMaps[eventKey] ? 'active' : ''}`}
                              onClick={() => toggleSafetyMap(eventKey, event)}
                            >
                              <MapIcon size={14} />
                              {expandedSafetyMaps[eventKey] ? 'Hide Map' : 'Show Map'}
                            </button>
                            {onViewHistoryEvent && (
                              <button
                                className="history-link-btn small"
                                onClick={() => onViewHistoryEvent(event.id || eventKey)}
                                title="View in History with expanded map"
                              >
                                <History size={14} />
                                View in History
                              </button>
                            )}
                            {onViewEvent && event.id && (
                              <button
                                className="view-details-btn small"
                                onClick={() => onViewEvent(event.id)}
                                title="View full event details page"
                              >
                                <ExternalLink size={14} />
                                View Details
                              </button>
                            )}
                          </div>
                          {isExpanded && hasSnapshot && (
                            <div className="snapshot-container">
                              {event.aircraft_snapshot && renderSnapshot(
                                event.aircraft_snapshot,
                                event.aircraft_snapshot_2 ? (event.aircraft_snapshot.flight || event.icao) : null
                              )}
                              {event.aircraft_snapshot_2 && renderSnapshot(
                                event.aircraft_snapshot_2,
                                event.aircraft_snapshot_2.flight || event.icao_2
                              )}
                            </div>
                          )}
                          {expandedSafetyMaps[eventKey] && safetyTrackData[eventKey] && (
                            <div className="safety-map-container">
                              <div
                                className="safety-event-map"
                                ref={(el) => {
                                  if (el && expandedSafetyMaps[eventKey] && !safetyMapRefs.current[eventKey]) {
                                    setTimeout(() => initializeSafetyMap(el, eventKey), 50);
                                  }
                                }}
                              />

                              {/* Flight graphs */}
                              <div className="safety-graphs">
                                <div className="safety-graphs-row">
                                  <div className="safety-graph-column">
                                    <span className="graph-aircraft-label" style={{ color: '#00ff88' }}>
                                      {event.callsign || event.icao}
                                    </span>
                                    {renderSafetyMiniGraph(safetyTrackData[eventKey]?.track1, 'altitude', '#00ff88', 'Alt', 'ft', null, safetyReplayState[eventKey]?.position)}
                                    {renderSafetyMiniGraph(safetyTrackData[eventKey]?.track1, 'vr', '#00ff88', 'VS', 'fpm', v => (v > 0 ? '+' : '') + v, safetyReplayState[eventKey]?.position)}
                                  </div>
                                  {safetyTrackData[eventKey]?.track2?.length > 0 && (
                                    <div className="safety-graph-column">
                                      <span
                                        className="graph-aircraft-label clickable"
                                        style={{ color: '#ff4444' }}
                                        onClick={() => onSelectAircraft?.(event.icao_2)}
                                      >
                                        {event.callsign_2 || event.icao_2}
                                      </span>
                                      {renderSafetyMiniGraph(safetyTrackData[eventKey]?.track2, 'altitude', '#ff4444', 'Alt', 'ft', null, safetyReplayState[eventKey]?.position)}
                                      {renderSafetyMiniGraph(safetyTrackData[eventKey]?.track2, 'vr', '#ff4444', 'VS', 'fpm', v => (v > 0 ? '+' : '') + v, safetyReplayState[eventKey]?.position)}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Replay controls */}
                              <div className="safety-replay-controls">
                                <div className="replay-buttons">
                                  <button className="replay-btn" onClick={() => skipSafetyToStart(eventKey)} title="Skip to start">
                                    <SkipBack size={14} />
                                  </button>
                                  <button className="replay-btn play-btn" onClick={() => toggleSafetyPlay(eventKey)} title={safetyReplayState[eventKey]?.isPlaying ? 'Pause' : 'Play'}>
                                    {safetyReplayState[eventKey]?.isPlaying ? <Pause size={16} /> : <Play size={16} />}
                                  </button>
                                  <button className="replay-btn" onClick={() => skipSafetyToEnd(eventKey)} title="Skip to end">
                                    <SkipForward size={14} />
                                  </button>
                                  <button className="replay-btn event-btn" onClick={() => jumpToSafetyEvent(eventKey)} title="Jump to event">
                                    <AlertTriangle size={14} />
                                  </button>
                                  <select
                                    className="speed-select small"
                                    value={safetyReplayState[eventKey]?.speed || 1}
                                    onChange={(e) => handleSafetySpeedChange(eventKey, parseFloat(e.target.value))}
                                    title="Playback speed"
                                  >
                                    <option value={0.25}>0.25x</option>
                                    <option value={0.5}>0.5x</option>
                                    <option value={1}>1x</option>
                                    <option value={2}>2x</option>
                                    <option value={4}>4x</option>
                                  </select>
                                </div>
                                <div className="replay-slider-container">
                                  <input
                                    type="range"
                                    className="replay-slider"
                                    min="0"
                                    max="100"
                                    value={safetyReplayState[eventKey]?.position || 50}
                                    onChange={(e) => handleSafetyReplayChange(eventKey, parseFloat(e.target.value))}
                                  />
                                  <div className="replay-time">
                                    {getSafetyReplayTimestamp(eventKey) || '--:--'}
                                  </div>
                                </div>
                              </div>

                              {/* Legend */}
                              <div className="safety-map-legend">
                                <div
                                  className="legend-item clickable"
                                  onClick={() => onSelectAircraft?.(event.icao)}
                                >
                                  <span className="legend-marker ac1-marker"></span>
                                  <span className="legend-callsign">{event.callsign || event.icao}</span>
                                </div>
                                {event.icao_2 && (
                                  <div
                                    className="legend-item clickable"
                                    onClick={() => onSelectAircraft?.(event.icao_2)}
                                  >
                                    <span className="legend-marker ac2-marker"></span>
                                    <span className="legend-callsign">{event.callsign_2 || event.icao_2}</span>
                                  </div>
                                )}
                                <div className="legend-item">
                                  <span className="legend-marker event-marker"></span>
                                  <span>Event Location</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'history' && (
              <div className="detail-history">
                {sightings.length === 0 ? (
                  <div className="detail-empty">
                    <History size={48} />
                    <p>No sighting history</p>
                    <span>No position reports recorded in the last 24 hours</span>
                  </div>
                ) : (
                  <div className="history-stats">
                    <div className="history-header">
                      <p>{sightings.length} position reports in the last 24 hours</p>
                      <button
                        className={`map-toggle-btn ${showTrackMap ? 'active' : ''}`}
                        onClick={() => setShowTrackMap(!showTrackMap)}
                      >
                        <MapIcon size={16} />
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
                        />

                        {/* Flight data graphs */}
                        <div className="flight-graphs">
                          <div className="graphs-row">
                            {renderMiniGraph('altitude', '#00ff88', 'Altitude', 'ft')}
                            {renderMiniGraph('gs', '#44aaff', 'Speed', 'kts', v => v?.toFixed(0))}
                            {renderMiniGraph('vr', '#ffaa44', 'V/S', 'fpm', v => (v > 0 ? '+' : '') + v)}
                          </div>
                        </div>

                        {/* Replay controls */}
                        <div className="replay-controls">
                          <div className="replay-buttons">
                            <button className="replay-btn" onClick={skipToStart} title="Skip to start">
                              <SkipBack size={16} />
                            </button>
                            <button className="replay-btn play-btn" onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'}>
                              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                            </button>
                            <button className="replay-btn" onClick={skipToEnd} title="Skip to end">
                              <SkipForward size={16} />
                            </button>
                          </div>
                          <div className="replay-slider-container">
                            <input
                              type="range"
                              className="replay-slider"
                              min="0"
                              max="100"
                              value={replayPosition}
                              onChange={(e) => handleReplayChange(parseFloat(e.target.value))}
                            />
                            <div className="replay-time">
                              {getReplayTimestamp() || '--:--'}
                            </div>
                          </div>
                        </div>

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

                    <div className="history-table">
                      <div className="history-row header">
                        <span>Time</span>
                        <span>Alt (ft)</span>
                        <span>Speed (kts)</span>
                        <span>Dist (nm)</span>
                      </div>
                      {sightings.slice(0, 50).map((s, i) => (
                        <div key={i} className="history-row">
                          <span>{new Date(s.timestamp).toLocaleTimeString()}</span>
                          <span>{s.altitude?.toLocaleString() || '--'}</span>
                          <span>{s.gs?.toFixed(0) || '--'}</span>
                          <span>{s.distance_nm?.toFixed(1) || '--'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'track' && (
              <div className="detail-track">
                {sightings.length === 0 || !sightings.some(s => s.lat && s.lon) ? (
                  <div className="detail-empty">
                    <MapIcon size={48} />
                    <p>No track data available</p>
                    <span>No position reports with coordinates in the last 24 hours</span>
                  </div>
                ) : (
                  <div className="track-replay-container">
                    {/* Telemetry overlay */}
                    {(() => {
                      const telem = getTrackTelemetry();
                      if (!telem) return null;
                      const vs = telem.vr ?? telem.baro_rate ?? telem.geom_rate ?? null;
                      const vsClass = vs > 0 ? 'climbing' : vs < 0 ? 'descending' : '';
                      return (
                        <div className={`track-telemetry-overlay ${showTelemOverlay ? '' : 'collapsed'}`}>
                          <button
                            className="telem-toggle"
                            onClick={() => setShowTelemOverlay(!showTelemOverlay)}
                            title={showTelemOverlay ? 'Collapse' : 'Expand'}
                          >
                            {showTelemOverlay ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                          {showTelemOverlay && (
                            <>
                              <div className="telem-row">
                                <div className="telem-item">
                                  <span className="telem-label">ALT</span>
                                  <span className="telem-value">{telem.altitude?.toLocaleString() || '--'}</span>
                                  <span className="telem-unit">ft</span>
                                </div>
                                <div className="telem-item">
                                  <span className="telem-label">GS</span>
                                  <span className="telem-value">{telem.gs?.toFixed(0) || '--'}</span>
                                  <span className="telem-unit">kts</span>
                                </div>
                                <div className="telem-item">
                                  <span className="telem-label">VS</span>
                                  <span className={`telem-value ${vsClass}`}>
                                    {vs !== null ? (vs > 0 ? '+' : '') + vs : '--'}
                                  </span>
                                  <span className="telem-unit">fpm</span>
                                </div>
                                <div className="telem-item">
                                  <span className="telem-label">HDG</span>
                                  <span className="telem-value">{telem.track?.toFixed(0) || '--'}</span>
                                  <span className="telem-unit">°</span>
                                </div>
                              </div>
                              <div className="telem-time">
                                {telem.timestamp ? new Date(telem.timestamp).toLocaleTimeString() : '--:--'}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })()}

                    {/* Map */}
                    <div
                      className="track-map"
                      ref={(el) => {
                        if (el && activeTab === 'track' && !trackMapRef.current) {
                          setTimeout(() => initializeTrackMap(el), 50);
                        }
                      }}
                    />

                    {/* Flight data graphs with position indicator */}
                    <div className="track-graphs">
                      <div className="graphs-row">
                        {renderMiniGraph('altitude', '#00ff88', 'Altitude', 'ft', null, trackLiveMode ? null : trackReplayPosition)}
                        {renderMiniGraph('gs', '#44aaff', 'Speed', 'kts', v => v?.toFixed(0), trackLiveMode ? null : trackReplayPosition)}
                        {renderMiniGraph('vr', '#ffaa44', 'V/S', 'fpm', v => (v > 0 ? '+' : '') + v, trackLiveMode ? null : trackReplayPosition)}
                      </div>
                    </div>

                    {/* Replay controls at bottom */}
                    <div className="track-controls">
                      <div className="replay-buttons">
                        <button className="replay-btn" onClick={skipTrackToStart} title="Skip to start">
                          <SkipBack size={16} />
                        </button>
                        <button className="replay-btn play-btn" onClick={toggleTrackPlay} title={trackIsPlaying ? 'Pause' : 'Play'}>
                          {trackIsPlaying ? <Pause size={18} /> : <Play size={18} />}
                        </button>
                        <button className="replay-btn" onClick={skipTrackToEnd} title="Skip to end">
                          <SkipForward size={16} />
                        </button>
                        <select
                          className="speed-select"
                          value={trackReplaySpeed}
                          onChange={(e) => setTrackReplaySpeed(parseFloat(e.target.value))}
                          title="Playback speed"
                        >
                          <option value={0.25}>0.25x</option>
                          <option value={0.5}>0.5x</option>
                          <option value={1}>1x</option>
                          <option value={2}>2x</option>
                          <option value={4}>4x</option>
                        </select>
                        <button
                          className={`replay-btn ${showTrackPoints ? 'active' : ''}`}
                          onClick={() => setShowTrackPoints(!showTrackPoints)}
                          title={showTrackPoints ? 'Hide track points' : 'Show track points'}
                        >
                          <CircleDot size={16} />
                        </button>
                        <button
                          className={`replay-btn live-btn ${trackLiveMode ? 'active' : ''}`}
                          onClick={() => {
                            if (!trackLiveMode) {
                              trackPlayingRef.current = false;
                              setTrackLiveMode(true);
                              setTrackReplayPosition(100);
                              if (trackAnimationRef.current) {
                                cancelAnimationFrame(trackAnimationRef.current);
                              }
                              setTrackIsPlaying(false);
                            } else {
                              setTrackLiveMode(false);
                            }
                          }}
                          title={trackLiveMode ? 'Live tracking ON' : 'Enable live tracking'}
                        >
                          <Radio size={16} />
                        </button>
                      </div>
                      <div className="replay-slider-container">
                        <input
                          type="range"
                          className="replay-slider"
                          min="0"
                          max="100"
                          value={trackReplayPosition}
                          onChange={(e) => handleTrackReplayChange(parseFloat(e.target.value))}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="detail-links">
        <a href={`https://flightaware.com/live/flight/${aircraft?.flight?.trim() || hex}`} target="_blank" rel="noopener noreferrer">
          FlightAware <ExternalLink size={12} />
        </a>
        <a href={`https://globe.adsbexchange.com/?icao=${hex}`} target="_blank" rel="noopener noreferrer">
          ADSBexchange <ExternalLink size={12} />
        </a>
        <a href={`https://www.flightradar24.com/${hex}`} target="_blank" rel="noopener noreferrer">
          Flightradar24 <ExternalLink size={12} />
        </a>
        <a href={`https://planespotters.net/hex/${hex}`} target="_blank" rel="noopener noreferrer">
          Planespotters <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}
