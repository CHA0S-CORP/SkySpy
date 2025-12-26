// ============================================================================
// MapView Component - Fully Refactored
// Modular map view with sub-components and custom hooks
// ============================================================================

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Hooks
import { useAviationData } from '../../hooks/useAviationData';

// Sub-components
import { MapControls } from './MapControls';
import { AircraftPopup } from './AircraftPopup';
import { AircraftListPanel } from './AircraftListPanel';
import { LegendPanel } from './LegendPanel';
import { FilterMenu } from './FilterMenu';
import { OverlayMenu } from './OverlayMenu';
import { AcarsPanel } from './AcarsPanel';
import { SafetyEventsPanel } from './SafetyEventsPanel';
import { ConflictBanner } from './ConflictBanner';
import { MetarPopup, PirepPopup, NavaidPopup, AirportPopup } from './WeatherPopups';
import { AircraftDetailPage } from '../aircraft/AircraftDetailPage';

// ============================================================================
// Overlay Storage Helpers
// ============================================================================

const getOverlays = () => {
  const stored = localStorage.getItem('adsb-dashboard-overlays');
  if (stored) return JSON.parse(stored);
  return { 
    aircraft: true, 
    vors: false, 
    airports: true, 
    airspace: false, 
    metars: false, 
    pireps: false,
    rangeRings: true,
    trails: true,
    labels: true,
    waypoints: false,
    tfrs: false,
    radar: false
  };
};

const saveOverlays = (overlays) => {
  localStorage.setItem('adsb-dashboard-overlays', JSON.stringify(overlays));
};

// ============================================================================
// MapView Component
// ============================================================================

function MapView({ aircraft, config, setConfig, feederLocation, safetyEvents: sseSafetyEvents }) {
  // ============================================================================
  // State
  // ============================================================================
  
  // Selection state
  const [selectedAircraft, setSelectedAircraft] = useState(null);
  const [selectedMetar, setSelectedMetar] = useState(null);
  const [selectedPirep, setSelectedPirep] = useState(null);
  const [selectedNavaid, setSelectedNavaid] = useState(null);
  const [selectedAirport, setSelectedAirport] = useState(null);
  const [aircraftDetailHex, setAircraftDetailHex] = useState(null);
  
  // Map state
  const [radarRange, setRadarRange] = useState(50);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showRangeControl, setShowRangeControl] = useState(false);
  
  // Panel visibility
  const [showOverlayMenu, setShowOverlayMenu] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showAircraftList, setShowAircraftList] = useState(() => {
    const saved = localStorage.getItem('adsb-show-aircraft-list');
    return saved === null ? false : saved === 'true';
  });
  const [listExpanded, setListExpanded] = useState(() => {
    const saved = localStorage.getItem('adsb-list-expanded');
    return saved === null ? true : saved === 'true';
  });
  const [showLegend, setShowLegend] = useState(false);
  const [legendCollapsed, setLegendCollapsed] = useState(false);
  const [showAcarsPanel, setShowAcarsPanel] = useState(false);
  
  // Display settings
  const [listDisplayCount, setListDisplayCount] = useState(20);
  const [soundMuted, setSoundMuted] = useState(() => localStorage.getItem('adsb-sound-muted') === 'true');
  
  // Overlays & filters
  const [overlays, setOverlays] = useState(getOverlays);
  const [trafficFilters, setTrafficFilters] = useState(() => {
    const saved = localStorage.getItem('adsb-traffic-filters');
    return saved ? JSON.parse(saved) : {
      showMilitary: true,
      showCivil: true,
      showGround: true,
      showAirborne: true,
      minAltitude: 0,
      maxAltitude: 60000,
      showWithSquawk: true,
      showWithoutSquawk: true,
    };
  });
  
  // Safety events
  const [safetyEvents, setSafetyEvents] = useState([]);
  const [acknowledgedEvents, setAcknowledgedEvents] = useState(new Set());
  
  // Track history
  const [trackHistory, setTrackHistory] = useState({});
  
  // Aircraft info cache
  const [aircraftInfo, setAircraftInfo] = useState({});
  
  // ============================================================================
  // Refs
  // ============================================================================
  
  const mapRef = useRef(null);
  const leafletMapRef = useRef(null);
  const markersRef = useRef({});
  const feederMarkerRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const notifiedEmergenciesRef = useRef(new Set());
  
  // ============================================================================
  // Derived values
  // ============================================================================
  
  const feederLat = feederLocation?.lat || 47.9377;
  const feederLon = feederLocation?.lon || -121.9687;
  
  // ============================================================================
  // Custom Hooks
  // ============================================================================

  // Aviation data (navaids, airports, airspace, METARs, PIREPs)
  const { aviationData } = useAviationData(config, feederLat, feederLon, radarRange, overlays);
  
  // Send notification helper
  const sendNotification = useCallback((title, body, tag, urgent = false) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, {
        body,
        tag,
        requireInteraction: urgent,
        icon: '/favicon.ico'
      });
    }
  }, []);

  // ============================================================================
  // Distance/Bearing Helpers
  // ============================================================================
  
  const getDistanceNm = useCallback((lat, lon) => {
    if (!lat || !lon) return 0;
    const R = 3440.065;
    const lat1 = feederLat * Math.PI / 180;
    const lat2 = lat * Math.PI / 180;
    const dLat = (lat - feederLat) * Math.PI / 180;
    const dLon = (lon - feederLon) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }, [feederLat, feederLon]);
  
  const getBearing = useCallback((lat, lon) => {
    if (!lat || !lon) return 0;
    const lat1 = feederLat * Math.PI / 180;
    const lat2 = lat * Math.PI / 180;
    const dLon = (lon - feederLon) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360;
  }, [feederLat, feederLon]);
  
  // ============================================================================
  // Filter Aircraft
  // ============================================================================
  
  const filteredAircraft = useMemo(() => {
    return aircraft.filter(ac => {
      if (ac.military && !trafficFilters.showMilitary) return false;
      if (!ac.military && !trafficFilters.showCivil) return false;
      
      const alt = ac.alt || ac.baro_alt || 0;
      if (alt < 100 && !trafficFilters.showGround) return false;
      if (alt >= 100 && !trafficFilters.showAirborne) return false;
      
      if (alt < trafficFilters.minAltitude || alt > trafficFilters.maxAltitude) return false;
      
      if (ac.squawk && !trafficFilters.showWithSquawk) return false;
      if (!ac.squawk && !trafficFilters.showWithoutSquawk) return false;
      
      return true;
    });
  }, [aircraft, trafficFilters]);
  
  // Sort by distance
  const sortedAircraft = useMemo(() => {
    return [...filteredAircraft].map(ac => ({
      ...ac,
      distance_nm: getDistanceNm(ac.lat, ac.lon)
    })).sort((a, b) => (a.distance_nm || 999) - (b.distance_nm || 999));
  }, [filteredAircraft, getDistanceNm]);
  
  // ============================================================================
  // Effects - Persistence
  // ============================================================================
  
  useEffect(() => {
    localStorage.setItem('adsb-sound-muted', soundMuted.toString());
  }, [soundMuted]);
  
  useEffect(() => {
    localStorage.setItem('adsb-show-aircraft-list', showAircraftList.toString());
  }, [showAircraftList]);
  
  useEffect(() => {
    localStorage.setItem('adsb-list-expanded', listExpanded.toString());
  }, [listExpanded]);
  
  useEffect(() => {
    saveOverlays(overlays);
  }, [overlays]);
  
  useEffect(() => {
    localStorage.setItem('adsb-traffic-filters', JSON.stringify(trafficFilters));
  }, [trafficFilters]);
  
  // ============================================================================
  // Effects - Safety Events
  // ============================================================================
  
  useEffect(() => {
    if (sseSafetyEvents && sseSafetyEvents.length > 0) {
      setSafetyEvents(prev => {
        const existing = new Set(prev.map(e => e.id));
        const newEvents = sseSafetyEvents.filter(e => !existing.has(e.id));
        return [...newEvents, ...prev].slice(0, 100);
      });
    }
  }, [sseSafetyEvents]);
  
  useEffect(() => {
    const emergencySquawks = { '7500': 'HIJACK', '7600': 'RADIO FAILURE', '7700': 'EMERGENCY' };
    
    aircraft.forEach(ac => {
      const isEmergency = ac.emergency || emergencySquawks[ac.squawk];
      if (!isEmergency) return;
      
      const emergencyKey = `${ac.hex}-${ac.squawk}`;
      if (!notifiedEmergenciesRef.current.has(emergencyKey)) {
        notifiedEmergenciesRef.current.add(emergencyKey);
        
        const callsign = ac.flight?.trim() || ac.hex;
        const meaning = emergencySquawks[ac.squawk] || 'EMERGENCY';
        
        sendNotification(
          `🚨 ${meaning}`,
          `${callsign} squawking ${ac.squawk || 'emergency'}\nAlt: ${ac.alt?.toLocaleString() || '?'}ft`,
          `emergency-${emergencyKey}`,
          true
        );
      }
    });
  }, [aircraft, sendNotification]);
  
  // ============================================================================
  // Effects - Fullscreen
  // ============================================================================
  
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  }, []);
  
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);
  
  // ============================================================================
  // Effects - Aircraft Info
  // ============================================================================
  
  useEffect(() => {
    if (!selectedAircraft?.hex) return;
    if (aircraftInfo[selectedAircraft.hex]) return;
    
    const fetchInfo = async () => {
      const baseUrl = config.apiUrl || '';
      try {
        const res = await fetch(`${baseUrl}/api/v1/aircraft/${selectedAircraft.hex}/info`);
        if (res.ok) {
          const data = await res.json();
          setAircraftInfo(prev => ({ ...prev, [selectedAircraft.hex]: data }));
        }
      } catch (err) {
        console.log('Aircraft info fetch error:', err.message);
      }
    };
    
    fetchInfo();
  }, [selectedAircraft?.hex, config.apiUrl, aircraftInfo]);
  
  // ============================================================================
  // Effects - Track History
  // ============================================================================
  
  useEffect(() => {
    const now = Date.now();
    const maxAge = 300000;
    const maxPoints = 120;
    
    setTrackHistory(prev => {
      const next = { ...prev };
      
      sortedAircraft.forEach(ac => {
        if (!ac.lat || !ac.lon) return;
        
        const point = {
          lat: ac.lat,
          lon: ac.lon,
          alt: ac.alt || ac.baro_alt || 0,
          spd: ac.gs || 0,
          vs: ac.baro_rate || ac.geom_rate || 0,
          dist: ac.distance_nm,
          ts: now
        };
        
        if (!next[ac.hex]) {
          next[ac.hex] = [point];
        } else {
          const last = next[ac.hex][next[ac.hex].length - 1];
          if (last.lat !== point.lat || last.lon !== point.lon) {
            next[ac.hex] = [...next[ac.hex], point];
          }
          
          next[ac.hex] = next[ac.hex]
            .filter(p => now - p.ts < maxAge)
            .slice(-maxPoints);
        }
      });
      
      return next;
    });
  }, [sortedAircraft]);
  
  // ============================================================================
  // Effects - Leaflet Map
  // ============================================================================
  
  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return;
    
    const map = L.map(mapRef.current, {
      center: [feederLat, feederLon],
      zoom: 8,
      zoomControl: false,
    });
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OSM &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(map);
    
    leafletMapRef.current = map;
    
    feederMarkerRef.current = L.circleMarker([feederLat, feederLon], {
      radius: 8,
      fillColor: '#00d4ff',
      color: '#fff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.8
    }).addTo(map);
    
    return () => {
      map.remove();
      leafletMapRef.current = null;
    };
  }, [feederLat, feederLon]);
  
  // Update aircraft markers
  useEffect(() => {
    if (!leafletMapRef.current) return;
    
    const map = leafletMapRef.current;
    const currentHexes = new Set(sortedAircraft.map(ac => ac.hex));
    
    Object.keys(markersRef.current).forEach(hex => {
      if (!currentHexes.has(hex)) {
        markersRef.current[hex].remove();
        delete markersRef.current[hex];
      }
    });
    
    sortedAircraft.forEach(ac => {
      if (!ac.lat || !ac.lon) return;
      
      const isSelected = selectedAircraft?.hex === ac.hex;
      const isEmergency = ac.emergency || ['7500', '7600', '7700'].includes(ac.squawk);
      
      const alt = ac.alt || ac.baro_alt || 0;
      let color = '#8a949e';
      if (alt > 35000) color = '#00d4ff';
      else if (alt > 18000) color = '#4ade80';
      else if (alt > 100) color = '#facc15';
      
      if (isEmergency) color = '#ef4444';
      if (ac.military) color = '#a371f7';
      if (isSelected) color = '#fff';
      
      if (markersRef.current[ac.hex]) {
        markersRef.current[ac.hex].setLatLng([ac.lat, ac.lon]);
        markersRef.current[ac.hex].setStyle({ color, fillColor: color });
      } else {
        const marker = L.circleMarker([ac.lat, ac.lon], {
          radius: isSelected ? 8 : 6,
          fillColor: color,
          color: color,
          weight: isSelected ? 3 : 1,
          opacity: 1,
          fillOpacity: 0.8
        }).addTo(map);
        
        marker.on('click', () => {
          setSelectedAircraft(ac);
        });
        
        markersRef.current[ac.hex] = marker;
      }
    });
  }, [sortedAircraft, selectedAircraft]);
  
  // ============================================================================
  // Handlers
  // ============================================================================
  
  const handleContainerMouseMove = useCallback((e) => {
    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const containerHeight = rect.height;
    setShowRangeControl(mouseY > containerHeight * 0.85);
  }, []);
  
  const handleContainerMouseLeave = useCallback(() => {
    setShowRangeControl(false);
  }, []);
  
  const handleZoomIn = useCallback(() => {
    leafletMapRef.current?.zoomIn();
  }, []);
  
  const handleZoomOut = useCallback(() => {
    leafletMapRef.current?.zoomOut();
  }, []);
  
  const handleCenterOnFeeder = useCallback(() => {
    leafletMapRef.current?.setView([feederLat, feederLon], 9);
  }, [feederLat, feederLon]);
  
  const handleSelectAircraftByHex = useCallback((hex) => {
    const ac = sortedAircraft.find(a => a.hex === hex);
    if (ac) setSelectedAircraft(ac);
  }, [sortedAircraft]);
  
  const handleAcknowledgeEvent = useCallback((eventId) => {
    setAcknowledgedEvents(prev => {
      const next = new Set(prev);
      next.add(eventId);
      return next;
    });
  }, []);
  
  // ============================================================================
  // Render
  // ============================================================================
  
  return (
    <div 
      ref={containerRef}
      className={`map-view ${config.mapMode || 'crt'} ${isFullscreen ? 'fullscreen' : ''}`}
      onMouseMove={handleContainerMouseMove}
      onMouseLeave={handleContainerMouseLeave}
    >
      {/* Leaflet Map */}
      <div ref={mapRef} className="leaflet-container" style={{ height: '100%', width: '100%' }} />
      
      {/* Radar Canvas Overlay (for CRT mode) */}
      {config.mapMode === 'crt' && (
        <canvas ref={canvasRef} className="radar-overlay" />
      )}
      
      {/* Map Controls */}
      <MapControls
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onToggleFullscreen={toggleFullscreen}
        isFullscreen={isFullscreen}
        onToggleOverlays={() => setShowOverlayMenu(!showOverlayMenu)}
        showOverlays={showOverlayMenu}
        onToggleFilters={() => setShowFilterMenu(!showFilterMenu)}
        showFilters={showFilterMenu}
        onToggleAircraftList={() => setShowAircraftList(!showAircraftList)}
        showAircraftList={showAircraftList}
        onToggleLegend={() => setShowLegend(!showLegend)}
        showLegend={showLegend}
        onToggleAcars={() => setShowAcarsPanel(!showAcarsPanel)}
        showAcars={showAcarsPanel}
        onToggleMute={() => setSoundMuted(!soundMuted)}
        soundMuted={soundMuted}
        onCenterOnFeeder={handleCenterOnFeeder}
        radarRange={radarRange}
        onRangeChange={setRadarRange}
        showRangeControl={showRangeControl}
        mapMode={config.mapMode}
      />
      
      {/* Conflict Banner - Shows proximity conflicts from API */}
      <ConflictBanner
        safetyEvents={safetyEvents}
        acknowledgedEvents={acknowledgedEvents}
        onAcknowledge={handleAcknowledgeEvent}
        onSelectAircraft={handleSelectAircraftByHex}
        soundMuted={soundMuted}
        onToggleMute={() => setSoundMuted(!soundMuted)}
      />

      {/* Safety Events Panel - Shows non-conflict safety events */}
      {safetyEvents.filter(e => e.event_type !== 'proximity_conflict').length > 0 && (
        <SafetyEventsPanel
          events={safetyEvents.filter(e => e.event_type !== 'proximity_conflict')}
          acknowledgedEvents={acknowledgedEvents}
          onAcknowledge={handleAcknowledgeEvent}
          onSelectAircraft={handleSelectAircraftByHex}
        />
      )}
      
      {/* Overlay Menu */}
      <OverlayMenu
        show={showOverlayMenu}
        overlays={overlays}
        onOverlaysChange={setOverlays}
        onClose={() => setShowOverlayMenu(false)}
      />
      
      {/* Filter Menu */}
      <FilterMenu
        show={showFilterMenu}
        filters={trafficFilters}
        onFiltersChange={setTrafficFilters}
        onClose={() => setShowFilterMenu(false)}
      />
      
      {/* Aircraft List Panel */}
      <AircraftListPanel
        aircraft={sortedAircraft}
        selectedHex={selectedAircraft?.hex}
        onSelectAircraft={handleSelectAircraftByHex}
        show={showAircraftList}
        onClose={() => setShowAircraftList(false)}
        expanded={listExpanded}
        onToggleExpanded={() => setListExpanded(!listExpanded)}
        displayCount={listDisplayCount}
        onLoadMore={() => setListDisplayCount(prev => prev + 20)}
      />
      
      {/* Legend Panel */}
      <LegendPanel
        show={showLegend}
        onClose={() => setShowLegend(false)}
        collapsed={legendCollapsed}
        onToggleCollapsed={() => setLegendCollapsed(!legendCollapsed)}
        mapMode={config.mapMode}
      />
      
      {/* ACARS Panel */}
      {showAcarsPanel && (
        <AcarsPanel
          apiUrl={config.apiUrl}
          onClose={() => setShowAcarsPanel(false)}
          onSelectAircraft={handleSelectAircraftByHex}
        />
      )}
      
      {/* Aircraft Popup */}
      {selectedAircraft && (
        <AircraftPopup
          aircraft={selectedAircraft}
          aircraftInfo={aircraftInfo[selectedAircraft.hex]}
          onClose={() => setSelectedAircraft(null)}
          onShowDetails={(hex) => setAircraftDetailHex(hex)}
          mapMode={config.mapMode}
          getDistanceNm={getDistanceNm}
          getBearing={getBearing}
        />
      )}
      
      {/* Weather Popups */}
      {selectedMetar && (
        <MetarPopup
          metar={selectedMetar}
          onClose={() => setSelectedMetar(null)}
          mapMode={config.mapMode}
          getDistanceNm={getDistanceNm}
          getBearing={getBearing}
        />
      )}
      
      {selectedPirep && (
        <PirepPopup
          pirep={selectedPirep}
          onClose={() => setSelectedPirep(null)}
          mapMode={config.mapMode}
          getDistanceNm={getDistanceNm}
          getBearing={getBearing}
        />
      )}
      
      {selectedNavaid && (
        <NavaidPopup
          navaid={selectedNavaid}
          onClose={() => setSelectedNavaid(null)}
          mapMode={config.mapMode}
          getDistanceNm={getDistanceNm}
          getBearing={getBearing}
        />
      )}
      
      {selectedAirport && (
        <AirportPopup
          airport={selectedAirport}
          onClose={() => setSelectedAirport(null)}
          mapMode={config.mapMode}
          getDistanceNm={getDistanceNm}
          getBearing={getBearing}
        />
      )}
      
      {/* Aircraft Detail Modal */}
      {aircraftDetailHex && (
        <div className="aircraft-detail-overlay" onClick={() => setAircraftDetailHex(null)}>
          <div className="aircraft-detail-modal" onClick={e => e.stopPropagation()}>
            <AircraftDetailPage 
              hex={aircraftDetailHex} 
              apiUrl={config.apiUrl}
              onClose={() => setAircraftDetailHex(null)}
              aircraft={sortedAircraft.find(a => a.hex === aircraftDetailHex)}
              aircraftInfo={aircraftInfo[aircraftDetailHex]}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export { MapView };
