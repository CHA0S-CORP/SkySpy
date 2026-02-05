import React, { useRef, useState, useCallback, useEffect, memo } from 'react';
import {
  Plane,
  AlertTriangle,
  Zap,
  X,
  ExternalLink,
  Crosshair,
  Pin,
  PinOff,
  Building2,
  Radar,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  BellPlus,
  ChevronDown,
  Image,
  LineChart,
  Loader2,
  Check,
} from 'lucide-react';
import { getTailInfo, getCategoryName, windDirToCardinal } from '../../../utils';
import { getSeverityClass, getEventTypeName } from './ConflictBanner';
import { CollapsibleSection } from '../../ui';
import { PrimaryMetrics, SecondaryMetrics } from '../../ui/metric-card';
import { ETASection } from './ETAOverlay';

/**
 * Create an alert rule for a specific aircraft via WebSocket
 */
async function createQuickAlertRule(wsRequest, type, value, displayName) {
  const payload = {
    name: `Alert for ${displayName}`,
    description: `Quick alert created for ${type === 'callsign' ? 'callsign' : 'registration'} ${value}`,
    priority: 'info',
    enabled: true,
    conditions: {
      logic: 'AND',
      groups: [
        {
          logic: 'AND',
          conditions: [
            {
              type,
              operator: 'eq',
              value,
            },
          ],
        },
      ],
    },
    cooldown: 300,
    starts_at: null,
    expires_at: null,
    notification_channel_ids: [],
    use_global_notifications: true,
    // Legacy fields for compatibility
    type,
    operator: 'eq',
    value,
  };

  const result = await wsRequest('alert-rule-create', payload);
  if (result?.error) {
    throw new Error(result.error);
  }
  return result;
}

// Helper to safely parse JSON from fetch response
const safeJson = async (res) => {
  if (!res.ok) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
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
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `https://skyspy-photos.s3.amazonaws.com${url.startsWith('/') ? '' : '/'}${url}`;
};

// Get trend icon based on distance trend
const getTrendIcon = (trend) => {
  switch (trend) {
    case 'approaching':
      return ArrowDownRight;
    case 'receding':
      return ArrowUpRight;
    default:
      return ArrowRight;
  }
};

// Module-level state to persist section collapse state across component unmounts
// This ensures sections stay open/closed when switching between aircraft
let persistedSectionsOpen = {
  secondaryMetrics: false,
  photo: false,
  graphs: false,
};

/**
 * PanelHeader - Title bar with action buttons
 */
const PanelHeader = memo(function PanelHeader({
  isFollowing,
  isPinned,
  onFollow,
  onPin,
  onOpenDetail,
  onClose,
}) {
  return (
    <div className="pro-panel-title-bar" role="banner">
      <span className="pro-panel-title">AIRCRAFT DETAILS</span>
      <div className="pro-panel-actions" role="toolbar" aria-label="Panel actions">
        <button
          className={`pro-panel-btn ${isFollowing ? 'active' : ''}`}
          onClick={onFollow}
          title={isFollowing ? 'Stop following' : 'Follow aircraft'}
          aria-pressed={isFollowing}
          aria-label={isFollowing ? 'Stop following aircraft' : 'Follow aircraft'}
        >
          <Crosshair size={16} aria-hidden="true" />
        </button>
        <button
          className={`pro-panel-btn ${isPinned ? 'active' : ''}`}
          onClick={onPin}
          title={isPinned ? 'Unpin panel' : 'Pin panel open'}
          aria-pressed={isPinned}
          aria-label={isPinned ? 'Unpin panel' : 'Pin panel open'}
        >
          {isPinned ? (
            <PinOff size={16} aria-hidden="true" />
          ) : (
            <Pin size={16} aria-hidden="true" />
          )}
        </button>
        <button
          className="pro-panel-btn"
          onClick={onOpenDetail}
          title="View full aircraft details"
          aria-label="View full aircraft details"
        >
          <ExternalLink size={16} aria-hidden="true" />
        </button>
        <button className="pro-panel-close" onClick={onClose} aria-label="Close panel">
          <X size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
});

/**
 * AlertBanners - Emergency and Conflict banners
 */
const AlertBanners = memo(function AlertBanners({
  isEmergency,
  emergencyType,
  squawk,
  isInConflict,
  safetyEvent,
  conflictSeverity,
  conflictTitle,
  onViewHistoryEvent,
}) {
  return (
    <>
      {/* Emergency Banner */}
      {isEmergency && (
        <div className={`pro-emergency-banner squawk-${squawk}`} role="alert" aria-live="assertive">
          <AlertTriangle size={18} aria-hidden="true" />
          <span className="emergency-type">{emergencyType}</span>
          <span className="emergency-squawk">SQUAWK {squawk}</span>
        </div>
      )}

      {/* Safety Event / Conflict Banner */}
      {isInConflict && safetyEvent && (
        <div
          className={`pro-conflict-banner ${getSeverityClass(conflictSeverity)} clickable`}
          onClick={() => onViewHistoryEvent?.(safetyEvent.id)}
          title="View in History"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onViewHistoryEvent?.(safetyEvent.id)}
          aria-label={`${conflictTitle}: ${safetyEvent.message}. Click to view in history.`}
        >
          <Zap size={18} aria-hidden="true" />
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
    </>
  );
});

/**
 * AircraftIdentity - Callsign, badges, operator, quick alerts
 */
const AircraftIdentity = memo(function AircraftIdentity({
  aircraft,
  aircraftInfo,
  tailInfo,
  isEmergency,
  error,
  onClearError,
  wsRequest,
  wsConnected,
  onToast,
}) {
  const info = aircraftInfo[aircraft.hex];
  const [creatingAlert, setCreatingAlert] = useState(null); // 'callsign' | 'registration' | null
  const [createdAlerts, setCreatedAlerts] = useState({}); // Track which alerts were created
  const prevAircraftHexRef = useRef(aircraft.hex);

  // Reset createdAlerts state when aircraft changes to prevent stale UI
  if (prevAircraftHexRef.current !== aircraft.hex) {
    prevAircraftHexRef.current = aircraft.hex;
    // Note: This is intentionally not in useEffect to reset synchronously
    // before the render to avoid showing stale "Alert Set" indicators
    setCreatedAlerts({});
  }

  const handleCreateAlert = useCallback(
    async (type, value, displayName) => {
      if (!wsRequest || !wsConnected) {
        onToast?.('Not connected to server', 'error');
        return;
      }

      // Check if already created
      const key = `${type}:${value}`;
      if (createdAlerts[key]) {
        onToast?.(`Alert for ${displayName} already exists`, 'info');
        return;
      }

      setCreatingAlert(type);
      try {
        await createQuickAlertRule(wsRequest, type, value, displayName);
        setCreatedAlerts((prev) => ({ ...prev, [key]: true }));
        onToast?.(`Alert created for ${displayName}`, 'success');
      } catch (err) {
        console.error('Failed to create alert:', err);
        onToast?.(err.message || 'Failed to create alert', 'error');
      } finally {
        setCreatingAlert(null);
      }
    },
    [wsRequest, wsConnected, onToast, createdAlerts]
  );

  const callsign = aircraft.flight?.trim();
  const registration = tailInfo.tailNumber;
  const callsignKey = `callsign:${callsign}`;
  const registrationKey = `registration:${registration}`;

  return (
    <div className="pro-panel-header" role="region" aria-label="Aircraft identification">
      <div className="pro-callsign-row">
        <span className="pro-flag" aria-hidden="true">
          {tailInfo.flag}
        </span>
        <h2 className="pro-callsign">{aircraft.flight?.trim() || aircraft.hex?.toUpperCase()}</h2>
      </div>
      <div className="pro-badges" role="list" aria-label="Aircraft tags">
        <span className="pro-badge hex" role="listitem">
          {aircraft.hex?.toUpperCase()}
        </span>
        {(info?.type_name || info?.model || aircraft.type) && (
          <span
            className={`pro-badge model ${aircraft.military ? 'military' : ''}`}
            role="listitem"
          >
            {info?.type_name || info?.model || aircraft.type}
          </span>
        )}
        <span className="pro-badge category" title={aircraft.category || 'A3'} role="listitem">
          {getCategoryName(aircraft.category)}
        </span>
        {info?.registration && (
          <span className="pro-badge reg" role="listitem">
            {info.registration}
          </span>
        )}
        {info?.year_built && (
          <span className="pro-badge built" role="listitem">
            {info.year_built}
            {info.age_years && ` (${info.age_years}y)`}
          </span>
        )}
        {isEmergency && (
          <span className="pro-badge emergency" role="listitem">
            EMG
          </span>
        )}
      </div>

      {/* Operator Label */}
      {info && (info.operator || info.owner) && (
        <div className="pro-operator-label">
          <Building2 size={14} aria-hidden="true" />
          <span>{info.operator || info.owner}</span>
        </div>
      )}

      {/* Airframe Lookup Error */}
      {error && (
        <div className="pro-airframe-error" title={error.error_message} role="alert">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>Info lookup failed ({error.source})</span>
          <button
            className="pro-error-dismiss"
            onClick={onClearError}
            title="Dismiss"
            aria-label="Dismiss error"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Quick Alert Actions */}
      <div className="pro-quick-alerts">
        {callsign && (
          <button
            className={`pro-alert-btn ${createdAlerts[callsignKey] ? 'created' : ''}`}
            onClick={() => handleCreateAlert('callsign', callsign, callsign)}
            disabled={creatingAlert !== null || createdAlerts[callsignKey]}
            title={
              createdAlerts[callsignKey]
                ? `Alert exists for ${callsign}`
                : `Add alert for ${callsign}`
            }
          >
            {creatingAlert === 'callsign' ? (
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            ) : createdAlerts[callsignKey] ? (
              <Check size={14} aria-hidden="true" />
            ) : (
              <BellPlus size={14} aria-hidden="true" />
            )}
            <span>{createdAlerts[callsignKey] ? 'Alert Set' : `Alert ${callsign}`}</span>
          </button>
        )}
        {registration && (
          <button
            className={`pro-alert-btn ${createdAlerts[registrationKey] ? 'created' : ''}`}
            onClick={() => handleCreateAlert('registration', registration, registration)}
            disabled={creatingAlert !== null || createdAlerts[registrationKey]}
            title={
              createdAlerts[registrationKey]
                ? `Alert exists for ${registration}`
                : `Add alert for ${registration}`
            }
          >
            {creatingAlert === 'registration' ? (
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            ) : createdAlerts[registrationKey] ? (
              <Check size={14} aria-hidden="true" />
            ) : (
              <BellPlus size={14} aria-hidden="true" />
            )}
            <span>{createdAlerts[registrationKey] ? 'Alert Set' : `Alert ${registration}`}</span>
          </button>
        )}
      </div>
    </div>
  );
});

/**
 * PhotoSection - Collapsible aircraft photo with lazy loading
 */
const PhotoSection = memo(function PhotoSection({
  aircraft,
  photoUrl,
  photoLoading,
  photoError,
  photoRetry,
  photoStatus,
  photoRetryRef,
  setPhotoUrl,
  setPhotoLoading,
  setPhotoError,
  setPhotoRetry,
  setPhotoStatus,
  config,
  wsRequest,
  wsConnected,
}) {
  // Cleanup retry interval on unmount or aircraft change
  useEffect(() => {
    const currentRef = photoRetryRef;
    return () => {
      if (currentRef.current) {
        clearInterval(currentRef.current);
        currentRef.current = null;
      }
    };
  }, [aircraft.hex, photoRetryRef]);

  const handleRetry = useCallback(() => {
    if (photoRetryRef.current) {
      clearInterval(photoRetryRef.current);
      photoRetryRef.current = null;
    }

    setPhotoError(false);
    setPhotoLoading(true);
    setPhotoRetry((c) => c + 1);

    const startTime = Date.now();
    const retryDuration = 30000;
    const retryInterval = 3000;
    const aircraftHex = aircraft.hex;

    const attemptFetch = async () => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.ceil((retryDuration - elapsed) / 1000);
      setPhotoStatus({ message: `Fetching photo... (${remaining}s)` });

      try {
        let data = null;
        if (wsRequest && wsConnected) {
          data = await wsRequest('photo-cache', { icao: aircraftHex });
          if (data?.error) data = null;
        } else {
          const res = await fetch(
            `${config.apiBaseUrl || ''}/api/v1/airframes/${aircraftHex}/photos`
          );
          data = await safeJson(res);
        }

        if (data?.photo_url || data?.photo_thumbnail_url || data?.thumbnail_url) {
          setPhotoUrl(
            resolvePhotoUrl(data.photo_url || data.photo_thumbnail_url || data.thumbnail_url)
          );
          if (photoRetryRef.current) {
            clearInterval(photoRetryRef.current);
            photoRetryRef.current = null;
          }
          return true;
        }
      } catch {
        // Continue retrying
      }
      return false;
    };

    attemptFetch().then((success) => {
      if (success) return;

      photoRetryRef.current = setInterval(async () => {
        const elapsed = Date.now() - startTime;
        if (elapsed >= retryDuration) {
          clearInterval(photoRetryRef.current);
          photoRetryRef.current = null;
          setPhotoError(true);
          setPhotoLoading(false);
          setPhotoStatus({ message: 'Photo fetch timed out' });
          return;
        }
        await attemptFetch();
      }, retryInterval);
    });
  }, [
    aircraft.hex,
    config.apiBaseUrl,
    photoRetryRef,
    setPhotoError,
    setPhotoLoading,
    setPhotoRetry,
    setPhotoStatus,
    setPhotoUrl,
    wsConnected,
    wsRequest,
  ]);

  return (
    <div className="pro-aircraft-photo">
      {photoLoading && !photoError && (
        <div className="pro-photo-loading">
          <div className="pro-photo-loading-radar">
            <Radar size={32} className="pro-photo-radar-icon" aria-hidden="true" />
            <div className="pro-photo-radar-sweep" />
          </div>
          <span>{photoStatus?.message || 'Loading photo...'}</span>
        </div>
      )}
      {!photoError && photoUrl && (
        <img
          key={`${aircraft.hex}-${photoRetry}-${photoUrl}`}
          src={photoUrl}
          alt={aircraft.flight?.trim() || aircraft.hex}
          onLoad={() => {
            setPhotoLoading(false);
            setPhotoStatus(null);
          }}
          onError={() => {
            setPhotoError(true);
            setPhotoLoading(false);
            setPhotoStatus(null);
          }}
          style={{ opacity: photoLoading ? 0 : 1 }}
          loading="lazy"
        />
      )}
      {photoError && !photoLoading && (
        <div className="pro-photo-placeholder">
          <Plane size={48} aria-hidden="true" />
          <span>{photoStatus?.message || 'No Photo Available'}</span>
          <button className="pro-photo-retry" onClick={handleRetry}>
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        </div>
      )}
    </div>
  );
});

/**
 * GraphsSection - Performance graphs in collapsible accordion
 */
const GraphsSection = memo(function GraphsSection({
  altitude,
  speed,
  verticalSpeed,
  distance,
  altProfileCanvasRef,
  speedProfileCanvasRef,
  vsProfileCanvasRef,
  distProfileCanvasRef,
  trackCanvasRef,
}) {
  // Format V/S value with sign
  const vsValue = verticalSpeed ?? 0;
  const vsClass = vsValue > 0 ? 'cyan' : vsValue < 0 ? 'red' : '';

  return (
    <div className="pro-graphs-container">
      <div className="pro-profile-chart">
        <div className="pro-section-header">
          ALTITUDE PROFILE
          <span className="profile-value cyan">{altitude.toLocaleString()}</span>
        </div>
        <canvas className="profile-canvas" width={280} height={60} ref={altProfileCanvasRef} />
      </div>

      <div className="pro-profile-chart">
        <div className="pro-section-header">
          SPEED PROFILE
          <span className="profile-value green">{speed || '--'}</span>
        </div>
        <canvas className="profile-canvas" width={280} height={60} ref={speedProfileCanvasRef} />
      </div>

      <div className="pro-profile-chart">
        <div className="pro-section-header">
          VERTICAL SPEED
          <span className={`profile-value ${vsClass}`}>
            {vsValue > 0 ? '+' : ''}
            {vsValue}
          </span>
        </div>
        <canvas className="profile-canvas" width={280} height={60} ref={vsProfileCanvasRef} />
      </div>

      <div className="pro-profile-chart">
        <div className="pro-section-header">
          DISTANCE
          <span className="profile-value purple">{distance.toFixed(1)}</span>
        </div>
        <canvas className="profile-canvas" width={280} height={60} ref={distProfileCanvasRef} />
      </div>

      <div className="pro-track-history">
        <div className="pro-section-header">TRACK HISTORY</div>
        <canvas className="track-history-canvas" width={280} height={80} ref={trackCanvasRef} />
      </div>
    </div>
  );
});

/**
 * ExternalLinks - Links to FlightAware, ADSBx
 */
const ExternalLinks = memo(function ExternalLinks({ callsign, hex }) {
  return (
    <div className="pro-external-links">
      <div className="pro-section-header">EXTERNAL</div>
      <div className="pro-links">
        <a
          href={`https://flightaware.com/live/flight/${callsign || hex}`}
          target="_blank"
          rel="noopener noreferrer"
          className="pro-link"
        >
          FlightAware <ExternalLink size={12} aria-hidden="true" />
        </a>
        <a
          href={`https://globe.adsbexchange.com/?icao=${hex}`}
          target="_blank"
          rel="noopener noreferrer"
          className="pro-link"
        >
          ADSBx <ExternalLink size={12} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
});

/**
 * ProDetailsPanel - Main component with new hierarchy
 *
 * Layout:
 * 1. PanelHeader - Close/Pin/Follow/Expand buttons
 * 2. AlertBanners - Emergency/Conflict alerts
 * 3. AircraftIdentity - Callsign, badges, operator
 * 4. PrimaryMetrics - 2x2 grid (Altitude, Speed, V/S, Distance) - always visible
 * 5. SecondaryMetrics - Collapsible (Track, Squawk, RSSI, Type) - default collapsed
 * 6. PhotoSection - Collapsible, lazy-loaded - default collapsed
 * 7. GraphsSection - Collapsible graphs - default collapsed
 * 8. ExternalLinks - FlightAware, ADSBx links
 */
export function ProDetailsPanel({
  config,
  liveAircraft,
  selectAircraft,
  activeConflicts,
  aircraftInfo,
  followingAircraft,
  setFollowingAircraft,
  panelPinned,
  setPanelPinned,
  openAircraftDetail,
  onViewHistoryEvent,
  getDistanceNm,
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
  getAircraftError,
  clearAircraftError,
  wsRequest,
  wsConnected,
  onToast,
  altProfileCanvasRef,
  speedProfileCanvasRef,
  vsProfileCanvasRef,
  distProfileCanvasRef,
  trackCanvasRef,
  // ETA props
  etaTarget,
  setEtaTarget,
  airports,
  setSelectedAirport,
}) {
  // Section collapse state - initialized from persisted module-level state
  const [sectionsOpen, setSectionsOpen] = useState(() => persistedSectionsOpen);

  // Sync state changes back to module-level persistence
  const handleSectionChange = useCallback((section, open) => {
    setSectionsOpen((prev) => {
      const next = { ...prev, [section]: open };
      persistedSectionsOpen = next; // Persist to module level
      return next;
    });
  }, []);

  // Distance trend tracking - hooks must be called before any conditional returns
  const proPrevDistanceRef = useRef(null);
  const proDistanceTrendRef = useRef(null);
  const proTrackedAircraftRef = useRef(null);

  // Don't render if not in pro mode or no aircraft selected
  if (config.mapMode !== 'pro' || !liveAircraft) return null;

  // Emergency state
  const isEmergency = ['7500', '7600', '7700'].includes(liveAircraft.squawk);
  const emergencyType =
    liveAircraft.squawk === '7500'
      ? 'HIJACK'
      : liveAircraft.squawk === '7600'
        ? 'RADIO FAILURE'
        : liveAircraft.squawk === '7700'
          ? 'EMERGENCY'
          : null;

  // Conflict/safety event state
  const safetyEvent = activeConflicts.find(
    (e) =>
      e.icao?.toUpperCase() === liveAircraft.hex?.toUpperCase() ||
      e.icao_2?.toUpperCase() === liveAircraft.hex?.toUpperCase()
  );
  const isInConflict = !!safetyEvent;
  const conflictSeverity = safetyEvent?.severity || null;
  const conflictTitle = safetyEvent ? getEventTypeName(safetyEvent.event_type) : null;

  // Calculate flight data values
  const proAltitude = liveAircraft.alt_baro || liveAircraft.alt_geom || liveAircraft.alt || 0;
  const proSpeed = liveAircraft.gs || liveAircraft.tas;
  const proVerticalSpeed = liveAircraft.vr ?? liveAircraft.baro_rate ?? liveAircraft.geom_rate ?? 0;
  const proAltClass = getAltitudeColorClass(proAltitude);
  const proSpeedClass = getSpeedColorClass(proSpeed, proAltitude);

  // Track distance trend
  const proDistanceNm =
    liveAircraft.distance_nm || getDistanceNm(liveAircraft.lat, liveAircraft.lon);
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

  // Secondary metrics values
  const proTrack = liveAircraft.track || liveAircraft.true_heading || 0;
  const proRssi = liveAircraft.rssi;
  const proSignalClass = proRssi !== undefined ? getSignalStrengthClass(proRssi) : 'weak';

  const tailInfo = getTailInfo(liveAircraft.hex, liveAircraft.flight);

  // Panel class names
  const panelClassName = [
    'pro-details-panel',
    isEmergency && 'emergency',
    isInConflict && `conflict ${getSeverityClass(conflictSeverity)}`,
    panelPinned && 'pinned',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={panelClassName}
      role="dialog"
      aria-label={`Aircraft details for ${liveAircraft.flight?.trim() || liveAircraft.hex}`}
    >
      {/* Header with action buttons */}
      <PanelHeader
        isFollowing={followingAircraft === liveAircraft.hex}
        isPinned={panelPinned}
        onFollow={() => {
          if (!liveAircraft.lat || !liveAircraft.lon) return;
          setFollowingAircraft(followingAircraft === liveAircraft.hex ? null : liveAircraft.hex);
        }}
        onPin={() => setPanelPinned(!panelPinned)}
        onOpenDetail={() => openAircraftDetail(liveAircraft.hex)}
        onClose={() => !panelPinned && selectAircraft(null)}
      />

      {/* Alert banners */}
      <AlertBanners
        isEmergency={isEmergency}
        emergencyType={emergencyType}
        squawk={liveAircraft.squawk}
        isInConflict={isInConflict}
        safetyEvent={safetyEvent}
        conflictSeverity={conflictSeverity}
        conflictTitle={conflictTitle}
        onViewHistoryEvent={onViewHistoryEvent}
      />

      {/* Aircraft identity section */}
      <AircraftIdentity
        aircraft={liveAircraft}
        aircraftInfo={aircraftInfo}
        tailInfo={tailInfo}
        isEmergency={isEmergency}
        error={getAircraftError(liveAircraft.hex)}
        onClearError={() => clearAircraftError(liveAircraft.hex)}
        wsRequest={wsRequest}
        wsConnected={wsConnected}
        onToast={onToast}
      />

      {/* Primary Metrics - Always visible */}
      <div className="pro-primary-metrics" role="region" aria-label="Primary flight metrics">
        <PrimaryMetrics
          altitude={proAltitude}
          speed={proSpeed}
          verticalSpeed={proVerticalSpeed}
          distance={proDistanceNm}
          altitudeClass={proAltClass}
          speedClass={proSpeedClass}
          distanceTrend={proDistTrend}
          TrendIcon={getTrendIcon(proDistTrend)}
        />
      </div>

      {/* Secondary Metrics - Collapsible */}
      <CollapsibleSection
        title="More Details"
        icon={ChevronDown}
        defaultOpen={sectionsOpen.secondaryMetrics}
        onOpenChange={(open) => setSectionsOpen((s) => ({ ...s, secondaryMetrics: open }))}
      >
        <SecondaryMetrics
          track={proTrack}
          trackCardinal={windDirToCardinal(proTrack)}
          squawk={liveAircraft.squawk}
          rssi={proRssi}
          signalClass={proSignalClass}
          type={liveAircraft.type}
        />
      </CollapsibleSection>

      {/* Photo Section - Collapsible with lazy loading */}
      <CollapsibleSection
        title="Photo"
        icon={Image}
        defaultOpen={sectionsOpen.photo}
        onOpenChange={(open) => setSectionsOpen((s) => ({ ...s, photo: open }))}
        lazy
      >
        <PhotoSection
          aircraft={liveAircraft}
          photoUrl={proPhotoUrl}
          photoLoading={proPhotoLoading}
          photoError={proPhotoError}
          photoRetry={proPhotoRetry}
          photoStatus={proPhotoStatus}
          photoRetryRef={proPhotoRetryRef}
          setPhotoUrl={setProPhotoUrl}
          setPhotoLoading={setProPhotoLoading}
          setPhotoError={setProPhotoError}
          setPhotoRetry={setProPhotoRetry}
          setPhotoStatus={setProPhotoStatus}
          config={config}
          wsRequest={wsRequest}
          wsConnected={wsConnected}
        />
      </CollapsibleSection>

      {/* Graphs Section - Collapsible */}
      <CollapsibleSection
        title="Performance Graphs"
        icon={LineChart}
        defaultOpen={sectionsOpen.graphs}
        onOpenChange={(open) => setSectionsOpen((s) => ({ ...s, graphs: open }))}
      >
        <GraphsSection
          altitude={proAltitude}
          speed={proSpeed}
          verticalSpeed={proVerticalSpeed}
          distance={proDistanceNm}
          altProfileCanvasRef={altProfileCanvasRef}
          speedProfileCanvasRef={speedProfileCanvasRef}
          vsProfileCanvasRef={vsProfileCanvasRef}
          distProfileCanvasRef={distProfileCanvasRef}
          trackCanvasRef={trackCanvasRef}
        />
      </CollapsibleSection>

      {/* ETA Section */}
      {etaTarget != null && (
        <ETASection
          aircraft={liveAircraft}
          etaTarget={etaTarget}
          airports={airports}
          onClearTarget={() => setEtaTarget?.(null)}
          onSelectAirport={(apt) => {
            setSelectedAirport?.(apt);
            setEtaTarget?.({ lat: apt.lat, lon: apt.lon });
          }}
        />
      )}

      {/* External Links */}
      <ExternalLinks callsign={liveAircraft.flight?.trim()} hex={liveAircraft.hex} />
    </div>
  );
}
