import React, { useRef, useEffect } from 'react';
import {
  Plane, AlertTriangle, Zap, X, ExternalLink, Crosshair, Pin, PinOff,
  Navigation, Radio, TrendingUp, MapPin, Signal, Building2, Radar, RefreshCw,
  ArrowUpRight, ArrowDownRight, ArrowRight, LocateFixed, BellPlus
} from 'lucide-react';
import { getTailInfo, getCategoryName, windDirToCardinal } from '../../../utils';
import { getSeverityClass, getEventTypeName } from './ConflictBanner';

// Helper to safely parse JSON from fetch response
const safeJson = async (res) => {
  if (!res.ok) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try { return await res.json(); } catch { return null; }
};

// Get altitude color class
const getAltitudeColorClass = (alt) => {
  if (alt <= 0) return 'alt-ground';
  if (alt < 5000) return 'alt-low';
  if (alt < 18000) return 'alt-medium';
  if (alt < 35000) return 'alt-high';
  return 'alt-very-high';
};

// Get speed color class
const getSpeedColorClass = (speed, altitude) => {
  if (!speed) return '';
  // Adjust expected speeds based on altitude
  if (altitude < 10000) {
    if (speed < 150) return 'speed-slow';
    if (speed < 250) return 'speed-normal';
    return 'speed-fast';
  } else {
    if (speed < 200) return 'speed-slow';
    if (speed < 400) return 'speed-normal';
    return 'speed-fast';
  }
};

// Get signal strength class
const getSignalStrengthClass = (rssi) => {
  if (rssi >= -10) return 'strong';
  if (rssi >= -15) return 'good';
  if (rssi >= -20) return 'moderate';
  return 'weak';
};

// Resolve photo URL
const resolvePhotoUrl = (url) => {
  if (!url) return null;
  // If it's already an absolute URL, use it
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  // Otherwise prepend S3 URL
  return `https://skyspy-photos.s3.amazonaws.com${url.startsWith('/') ? '' : '/'}${url}`;
};

/**
 * ProDetailsPanel component - the detailed aircraft info panel for Pro mode
 */
export function ProDetailsPanel({
  config,
  liveAircraft,
  selectedAircraft,
  selectAircraft,
  activeConflicts,
  aircraftInfo,
  followingAircraft,
  setFollowingAircraft,
  panelPinned,
  setPanelPinned,
  openAircraftDetail,
  onViewHistoryEvent,
  // Distance helpers
  getDistanceNm,
  // Photo state
  proPhotoUrl,
  setProPhotoUrl,
  proPhotoLoading,
  setProPhotoLoading,
  proPhotoError,
  setProPhotoError,
  proPhotoRetry,
  setProPhotoRetry,
  proPhotoStatus,
  setProPhotoStatus,
  proPhotoRetryRef,
  // Error handling
  getAircraftError,
  clearAircraftError,
  // WebSocket
  wsRequest,
  wsConnected,
  // Canvas refs for graphs
  altProfileCanvasRef,
  speedProfileCanvasRef,
  vsProfileCanvasRef,
  distProfileCanvasRef,
  trackCanvasRef,
}) {
  if (config.mapMode !== 'pro' || !liveAircraft) return null;

  const isEmergency = ['7500', '7600', '7700'].includes(liveAircraft.squawk);
  const emergencyType = liveAircraft.squawk === '7500' ? 'HIJACK' :
                       liveAircraft.squawk === '7600' ? 'RADIO FAILURE' :
                       liveAircraft.squawk === '7700' ? 'EMERGENCY' : null;

  // Check for safety event from backend
  const safetyEvent = activeConflicts.find(e =>
    e.icao?.toUpperCase() === liveAircraft.hex?.toUpperCase() ||
    e.icao_2?.toUpperCase() === liveAircraft.hex?.toUpperCase()
  );

  const isInConflict = !!safetyEvent;
  const conflictSeverity = safetyEvent?.severity || null;
  const conflictTitle = safetyEvent ? getEventTypeName(safetyEvent.event_type) : null;

  // Distance trend tracking refs
  const proPrevDistanceRef = useRef(null);
  const proDistanceTrendRef = useRef(null);
  const proTrackedAircraftRef = useRef(null);

  // Calculate values for color coding
  const proAltitude = liveAircraft.alt_baro || liveAircraft.alt_geom || liveAircraft.alt || 0;
  const proSpeed = liveAircraft.gs || liveAircraft.tas;
  const proAltClass = getAltitudeColorClass(proAltitude);
  const proSpeedClass = getSpeedColorClass(proSpeed, proAltitude);

  // Track distance trend
  const proDistanceNm = liveAircraft.distance_nm || getDistanceNm(liveAircraft.lat, liveAircraft.lon);
  if (proTrackedAircraftRef.current !== liveAircraft.hex) {
    proTrackedAircraftRef.current = liveAircraft.hex;
    proPrevDistanceRef.current = proDistanceNm;
    proDistanceTrendRef.current = null;
  } else if (proPrevDistanceRef.current !== null) {
    const delta = proDistanceNm - proPrevDistanceRef.current;
    if (delta < -0.01) {
      proDistanceTrendRef.current = 'approaching';
    } else if (delta > 0.01) {
      proDistanceTrendRef.current = 'receding';
    }
    proPrevDistanceRef.current = proDistanceNm;
  }
  const proDistTrend = proDistanceTrendRef.current;

  // RSSI signal strength
  const proRssi = liveAircraft.rssi;
  const proSignalClass = proRssi !== undefined ? getSignalStrengthClass(proRssi) : 'weak';

  const tailInfo = getTailInfo(liveAircraft.hex, liveAircraft.flight);

  return (
    <div className={`pro-details-panel ${isEmergency ? 'emergency' : ''} ${isInConflict ? `conflict ${getSeverityClass(conflictSeverity)}` : ''} ${panelPinned ? 'pinned' : ''}`}>
      <div className="pro-panel-title-bar">
        <span className="pro-panel-title">TARGET DETAILS</span>
        <div className="pro-panel-actions">
          <button
            className={`pro-panel-btn ${followingAircraft === liveAircraft.hex ? 'active' : ''}`}
            onClick={() => {
              if (!liveAircraft.lat || !liveAircraft.lon) return;
              if (followingAircraft === liveAircraft.hex) {
                setFollowingAircraft(null);
              } else {
                setFollowingAircraft(liveAircraft.hex);
              }
            }}
            title={followingAircraft === liveAircraft.hex ? 'Stop following' : 'Follow aircraft'}
          >
            <Crosshair size={14} />
          </button>
          <button
            className={`pro-panel-btn ${panelPinned ? 'active' : ''}`}
            onClick={() => setPanelPinned(!panelPinned)}
            title={panelPinned ? 'Unpin panel' : 'Pin panel open'}
          >
            {panelPinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <button
            className="pro-panel-btn"
            onClick={() => openAircraftDetail(liveAircraft.hex)}
            title="View full aircraft details"
          >
            <ExternalLink size={14} />
          </button>
          <button className="pro-panel-close" onClick={() => !panelPinned && selectAircraft(null)}>
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Emergency Banner */}
      {isEmergency && (
        <div className={`pro-emergency-banner squawk-${liveAircraft.squawk}`}>
          <AlertTriangle size={18} />
          <span className="emergency-type">{emergencyType}</span>
          <span className="emergency-squawk">SQUAWK {liveAircraft.squawk}</span>
        </div>
      )}

      {/* Safety Event / Conflict Banner */}
      {isInConflict && safetyEvent && (
        <div
          className={`pro-conflict-banner ${getSeverityClass(conflictSeverity)} clickable`}
          onClick={() => onViewHistoryEvent?.(safetyEvent.id)}
          title="View in History"
        >
          <Zap size={18} />
          <div className="conflict-info">
            <span className="conflict-label">{conflictTitle}</span>
            <span className="conflict-message">{safetyEvent.message}</span>
          </div>
          {safetyEvent.hex2 && (
            <div className="conflict-separation">
              <span>{safetyEvent.horizontalNm}nm</span>
              <span>{safetyEvent.verticalFt}ft</span>
            </div>
          )}
        </div>
      )}

      <div className="pro-panel-header">
        <div className="pro-callsign-row">
          <span className="pro-flag">{tailInfo.flag}</span>
          <h2 className="pro-callsign">{liveAircraft.flight?.trim() || liveAircraft.hex?.toUpperCase()}</h2>
        </div>
        <div className="pro-badges">
          <span className="pro-badge hex">{liveAircraft.hex?.toUpperCase()}</span>
          {(aircraftInfo[liveAircraft.hex]?.type_name || aircraftInfo[liveAircraft.hex]?.model || liveAircraft.type) && (
            <span className={`pro-badge model ${liveAircraft.military ? 'military' : ''}`}>
              {aircraftInfo[liveAircraft.hex]?.type_name || aircraftInfo[liveAircraft.hex]?.model || liveAircraft.type}
            </span>
          )}
          <span className="pro-badge category" title={liveAircraft.category || 'A3'}>{getCategoryName(liveAircraft.category)}</span>
          {aircraftInfo[liveAircraft.hex]?.registration && (
            <span className="pro-badge reg">{aircraftInfo[liveAircraft.hex].registration}</span>
          )}
          {aircraftInfo[liveAircraft.hex]?.year_built && (
            <span className="pro-badge built">
              {aircraftInfo[liveAircraft.hex].year_built}
              {aircraftInfo[liveAircraft.hex].age_years && ` (${aircraftInfo[liveAircraft.hex].age_years}y)`}
            </span>
          )}
          {isEmergency && <span className="pro-badge emergency">EMG</span>}
        </div>

        {/* Quick Alert Actions */}
        <div className="pro-quick-alerts">
          {liveAircraft.flight?.trim() && (
            <button
              className="pro-alert-btn"
              onClick={() => {
                console.log('Add alert for callsign:', liveAircraft.flight?.trim());
                alert(`Alert added for callsign: ${liveAircraft.flight?.trim()}`);
              }}
              title={`Add alert for ${liveAircraft.flight?.trim()}`}
            >
              <BellPlus size={12} />
              <span>Alert {liveAircraft.flight?.trim()}</span>
            </button>
          )}
          {tailInfo.tailNumber && (
            <button
              className="pro-alert-btn"
              onClick={() => {
                console.log('Add alert for tail:', tailInfo.tailNumber);
                alert(`Alert added for tail: ${tailInfo.tailNumber}`);
              }}
              title={`Add alert for ${tailInfo.tailNumber}`}
            >
              <BellPlus size={12} />
              <span>Alert {tailInfo.tailNumber}</span>
            </button>
          )}
        </div>
      </div>

      {/* Aircraft Thumbnail */}
      <div className="pro-aircraft-photo">
        {proPhotoLoading && !proPhotoError && (
          <div className="pro-photo-loading">
            <div className="pro-photo-loading-radar">
              <Radar size={32} className="pro-photo-radar-icon" />
              <div className="pro-photo-radar-sweep" />
            </div>
            <span>{proPhotoStatus?.message || 'Loading photo...'}</span>
          </div>
        )}
        {!proPhotoError && proPhotoUrl && (
          <img
            key={`${liveAircraft.hex}-${proPhotoRetry}-${proPhotoUrl}`}
            src={proPhotoUrl}
            alt={liveAircraft.flight?.trim() || liveAircraft.hex}
            onLoad={() => { setProPhotoLoading(false); setProPhotoStatus(null); }}
            onError={() => { setProPhotoError(true); setProPhotoLoading(false); setProPhotoStatus(null); }}
            style={{ opacity: proPhotoLoading ? 0 : 1 }}
            loading="lazy"
          />
        )}
        {proPhotoError && !proPhotoLoading && (
          <div className="pro-photo-placeholder">
            <Plane size={48} />
            <span>{proPhotoStatus?.message || 'No Photo Available'}</span>
            <button
              className="pro-photo-retry"
              onClick={() => {
                if (proPhotoRetryRef.current) {
                  clearInterval(proPhotoRetryRef.current);
                  proPhotoRetryRef.current = null;
                }

                setProPhotoError(false);
                setProPhotoLoading(true);
                setProPhotoRetry(c => c + 1);

                const startTime = Date.now();
                const retryDuration = 30000;
                const retryInterval = 3000;
                const aircraftHex = liveAircraft.hex;

                const attemptFetch = async () => {
                  const elapsed = Date.now() - startTime;
                  const remaining = Math.ceil((retryDuration - elapsed) / 1000);
                  setProPhotoStatus({ message: `Fetching photo... (${remaining}s)` });

                  try {
                    let data = null;
                    if (wsRequest && wsConnected) {
                      data = await wsRequest('photo-cache', { icao: aircraftHex });
                      if (data?.error) data = null;
                    } else {
                      const res = await fetch(`${config.apiBaseUrl || ''}/api/v1/aircraft/${aircraftHex}/photo/cache`, {
                        method: 'POST'
                      });
                      data = await safeJson(res);
                    }

                    if (data?.photo_url || data?.photo_thumbnail_url || data?.thumbnail_url) {
                      setProPhotoUrl(resolvePhotoUrl(data.photo_url || data.photo_thumbnail_url || data.thumbnail_url));
                      if (proPhotoRetryRef.current) {
                        clearInterval(proPhotoRetryRef.current);
                        proPhotoRetryRef.current = null;
                      }
                      return true;
                    }
                  } catch {
                    // Continue retrying
                  }
                  return false;
                };

                attemptFetch().then(success => {
                  if (success) return;

                  proPhotoRetryRef.current = setInterval(async () => {
                    const elapsed = Date.now() - startTime;
                    if (elapsed >= retryDuration) {
                      clearInterval(proPhotoRetryRef.current);
                      proPhotoRetryRef.current = null;
                      setProPhotoError(true);
                      setProPhotoLoading(false);
                      setProPhotoStatus({ message: 'Photo fetch timed out' });
                      return;
                    }
                    await attemptFetch();
                  }, retryInterval);
                });
              }}
            >
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        )}
      </div>

      {/* Operator Label */}
      {aircraftInfo[liveAircraft.hex] && (aircraftInfo[liveAircraft.hex].operator || aircraftInfo[liveAircraft.hex].owner) && (
        <div className="pro-operator-label">
          <Building2 size={14} />
          <span>{aircraftInfo[liveAircraft.hex].operator || aircraftInfo[liveAircraft.hex].owner}</span>
        </div>
      )}

      {/* Airframe Lookup Error */}
      {getAircraftError(liveAircraft.hex) && (
        <div className="pro-airframe-error" title={getAircraftError(liveAircraft.hex).error_message}>
          <AlertTriangle size={14} />
          <span>
            Info lookup failed ({getAircraftError(liveAircraft.hex).source})
          </span>
          <button
            className="pro-error-dismiss"
            onClick={() => clearAircraftError(liveAircraft.hex)}
            title="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div className="pro-stats-grid">
        <div className="pro-stat">
          <div className="pro-stat-label"><Crosshair size={14} /> ALTITUDE</div>
          <div className={`pro-stat-value ${proAltClass}`}>{proAltitude.toLocaleString()} <span className="unit">ft</span></div>
        </div>
        <div className="pro-stat">
          <div className="pro-stat-label"><Navigation size={14} /> SPEED</div>
          <div className={`pro-stat-value ${proSpeedClass}`}>{proSpeed || '--'} <span className="unit">kts</span></div>
        </div>
        <div className="pro-stat">
          <div className="pro-stat-label"><Plane size={14} /> TYPE</div>
          <div className="pro-stat-value">{liveAircraft.type || '--'}</div>
        </div>
        <div className="pro-stat">
          <div className="pro-stat-label"><Radio size={14} /> SQUAWK</div>
          <div className="pro-stat-value">{liveAircraft.squawk || '1200'}</div>
        </div>
        <div className="pro-stat">
          <div className="pro-stat-label"><TrendingUp size={14} /> V/S</div>
          {(() => {
            const vs = liveAircraft.vr ?? liveAircraft.baro_rate ?? liveAircraft.geom_rate ?? 0;
            const isExtreme = Math.abs(vs) > 3000;
            const vsClass = vs > 0 ? 'climbing' : vs < 0 ? 'descending' : '';
            return (
              <div className={`pro-stat-value ${vsClass} ${isExtreme ? 'extreme-vs' : ''}`}>
                {vs > 0 ? '+' : ''}{vs} <span className="unit">fpm</span>
              </div>
            );
          })()}
        </div>
        <div className="pro-stat">
          <div className="pro-stat-label"><LocateFixed size={14} /> TRACK</div>
          <div className="pro-stat-value">
            {Math.round(liveAircraft.track || liveAircraft.true_heading || 0)}°
            <span className="unit cardinal">{windDirToCardinal(liveAircraft.track || liveAircraft.true_heading)}</span>
          </div>
        </div>
        <div className="pro-stat">
          <div className="pro-stat-label"><MapPin size={14} /> DISTANCE</div>
          <div className={`pro-stat-value distance-value ${proDistTrend || ''}`}>
            {proDistTrend === 'approaching' ? (
              <ArrowDownRight size={14} className="trend-icon approaching" />
            ) : proDistTrend === 'receding' ? (
              <ArrowUpRight size={14} className="trend-icon receding" />
            ) : (
              <ArrowRight size={14} className="trend-icon stable" />
            )}
            {proDistanceNm.toFixed(1)} <span className="unit">nm</span>
          </div>
        </div>
        <div className="pro-stat">
          <div className="pro-stat-label"><Signal size={14} /> RSSI</div>
          <div className="pro-stat-value rssi-stat">
            {proRssi !== undefined ? (
              <>
                <span className={`signal-bars ${proSignalClass}`}>
                  <span className="bar bar-1"></span>
                  <span className="bar bar-2"></span>
                  <span className="bar bar-3"></span>
                  <span className="bar bar-4"></span>
                </span>
                <span>{proRssi.toFixed(0)}</span>
                <span className="unit">dB</span>
              </>
            ) : (
              <>-- <span className="unit">dB</span></>
            )}
          </div>
        </div>
      </div>

      <div className="pro-graphs-container">
        <div className="pro-profile-chart">
          <div className="pro-section-header">
            ALTITUDE PROFILE
            <span className="profile-value cyan">{proAltitude.toLocaleString()}</span>
          </div>
          <canvas
            className="profile-canvas"
            width={280}
            height={60}
            ref={altProfileCanvasRef}
          />
        </div>

        <div className="pro-profile-chart">
          <div className="pro-section-header">
            SPEED PROFILE
            <span className="profile-value green">{liveAircraft.gs || liveAircraft.tas || '--'}</span>
          </div>
          <canvas
            className="profile-canvas"
            width={280}
            height={60}
            ref={speedProfileCanvasRef}
          />
        </div>

        <div className="pro-profile-chart">
          <div className="pro-section-header">
            VERTICAL SPEED
            <span className={`profile-value ${(liveAircraft.vr ?? liveAircraft.baro_rate ?? 0) > 0 ? 'cyan' : (liveAircraft.vr ?? liveAircraft.baro_rate ?? 0) < 0 ? 'red' : ''}`}>
              {(liveAircraft.vr ?? liveAircraft.baro_rate ?? liveAircraft.geom_rate ?? 0) > 0 ? '+' : ''}{liveAircraft.vr ?? liveAircraft.baro_rate ?? liveAircraft.geom_rate ?? 0}
            </span>
          </div>
          <canvas
            className="profile-canvas"
            width={280}
            height={60}
            ref={vsProfileCanvasRef}
          />
        </div>

        <div className="pro-profile-chart">
          <div className="pro-section-header">
            DISTANCE
            <span className="profile-value purple">{proDistanceNm.toFixed(1)}</span>
          </div>
          <canvas
            className="profile-canvas"
            width={280}
            height={60}
            ref={distProfileCanvasRef}
          />
        </div>

        <div className="pro-track-history">
          <div className="pro-section-header">TRACK HISTORY</div>
          <canvas
            className="track-history-canvas"
            width={280}
            height={80}
            ref={trackCanvasRef}
          />
        </div>
      </div>

      <div className="pro-external-links">
        <div className="pro-section-header">EXTERNAL</div>
        <div className="pro-links">
          <a href={`https://flightaware.com/live/flight/${liveAircraft.flight?.trim() || liveAircraft.hex}`} target="_blank" rel="noopener noreferrer" className="pro-link">
            FlightAware <ExternalLink size={12} />
          </a>
          <a href={`https://globe.adsbexchange.com/?icao=${liveAircraft.hex}`} target="_blank" rel="noopener noreferrer" className="pro-link">
            ADSBx <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </div>
  );
}
