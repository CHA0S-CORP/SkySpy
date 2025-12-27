import React, { useState, useEffect } from 'react';
import {
  X, RefreshCw, Camera, Info, Radar, MessageCircle, History,
  Plane, Building2, Hash, ExternalLink, WifiOff, AlertTriangle
} from 'lucide-react';
import { getTailInfo, getCardinalDirection } from '../../utils';

export function AircraftDetailPage({ hex, apiUrl, onClose, aircraft, aircraftInfo, trackHistory }) {
  const [info, setInfo] = useState(aircraftInfo || null);
  const [photoInfo, setPhotoInfo] = useState(null);
  const [acarsMessages, setAcarsMessages] = useState([]);
  const [sightings, setSightings] = useState([]);
  const [safetyEvents, setSafetyEvents] = useState([]);
  const [safetyHours, setSafetyHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('info');
  const [photoState, setPhotoState] = useState('loading');
  const [photoRetryCount, setPhotoRetryCount] = useState(0);
  const [useThumbnail, setUseThumbnail] = useState(false);

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
        
        const acarsRes = await fetch(`${baseUrl}/api/v1/acars/messages/${hex}?hours=24&limit=50`);
        if (acarsRes.ok) {
          const data = await acarsRes.json();
          setAcarsMessages(data.messages || []);
        }
        
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
                    <span className="live-value">{aircraft.alt_baro?.toLocaleString() || '--'}</span>
                    <span className="live-unit">ft</span>
                  </div>
                  <div className="live-stat">
                    <span className="live-label">Ground Speed</span>
                    <span className="live-value">{aircraft.gs?.toFixed(0) || '--'}</span>
                    <span className="live-unit">kts</span>
                  </div>
                  <div className="live-stat">
                    <span className="live-label">Vertical Rate</span>
                    {(() => {
                      const vs = aircraft.vr ?? aircraft.baro_rate ?? aircraft.geom_rate ?? 0;
                      const isExtreme = Math.abs(vs) > 3000;
                      const vsClass = vs > 0 ? 'climbing' : vs < 0 ? 'descending' : '';
                      return (
                        <span className={`live-value ${vsClass} ${isExtreme ? 'extreme-vs' : ''}`}>
                          {vs}
                        </span>
                      );
                    })()}
                    <span className="live-unit">ft/min</span>
                  </div>
                  <div className="live-stat">
                    <span className="live-label">Track</span>
                    <span className="live-value">{aircraft.track?.toFixed(0) ?? '--'}°</span>
                    <span className="live-unit">{getCardinalDirection(aircraft.track)}</span>
                  </div>
                  <div className="live-stat">
                    <span className="live-label">Distance</span>
                    <span className="live-value">{aircraft.distance_nm?.toFixed(1) ?? '--'}</span>
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
                {acarsMessages.length === 0 ? (
                  <div className="detail-empty">
                    <MessageCircle size={48} />
                    <p>No ACARS messages</p>
                    <span>No messages received from this aircraft in the last 24 hours</span>
                  </div>
                ) : (
                  <div className="acars-list">
                    {acarsMessages.map((msg, i) => (
                      <div key={i} className="acars-item">
                        <div className="acars-item-header">
                          <span className="acars-item-time">{new Date(msg.timestamp).toLocaleString()}</span>
                          <span className="acars-item-label">{msg.label || '--'}</span>
                          <span className="acars-item-source">{msg.source}</span>
                          {msg.frequency && <span className="acars-item-freq">{msg.frequency} MHz</span>}
                        </div>
                        {msg.text && <pre className="acars-item-text">{msg.text}</pre>}
                      </div>
                    ))}
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
                    {safetyEvents.map((event, i) => (
                      <div key={event.id || i} className={`safety-event-item ${getSeverityClass(event.severity)}`}>
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
                            {event.icao_2 && <span>With: {event.callsign_2 || event.icao_2}</span>}
                          </div>
                        )}
                      </div>
                    ))}
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
                    <p>{sightings.length} position reports in the last 24 hours</p>
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
