import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon, LiveIndicator, Switch, toast } from '../../primitives';
import { useDetailData } from './useDetailData';
import {
  countryCodeToFlag,
  externalLinks,
  flightStatus,
  miniSeries,
  projectTrack,
  splitFlights,
  transponderLog,
  trendOf,
  trackDisplay,
} from './detailModel';
import { altitudeOf, EMERGENCY_SQUAWKS } from '../list/listModel';
import { DetailTrackMap } from './DetailTrackMap';
import { TurbulenceCard } from './TurbulenceCard';
import { FlightRoute, RouteSummary, parseRoute } from './FlightRoute';
import { AcarsActivityCard, RadioActivityCard } from './DetailActivity';
import { DetailDisclosure } from './DetailDisclosure';
import { FlightHistoryCard } from '../../../shared/FlightHistoryCard';
import { FavoriteButton } from '../../../shared/FavoriteButton';
import { AirframeModal } from '../airframes/AirframeModal';
import { AIRFRAMES } from '../airframes/airframesData';

const SPEEDS = [0.5, 1, 2, 4];
// Track-history window presets (hours) for the flight-playback picker.
const WINDOWS = [
  { hours: 24, label: '24h' },
  { hours: 72, label: '3d' },
  { hours: 168, label: '7d' },
];

function KVRow({ label, children, last }) {
  // Empty strings (blank fields from a partial airframe record) should read as
  // '--', not render an empty cell - nullish coalescing alone misses ''.
  const value = children == null || children === '' ? '--' : children;
  return (
    <div className={`v2-det__kv ${last ? 'v2-det__kv--last' : ''}`}>
      <span className="v2-det__kv-label">{label}</span>
      <span className="v2-det__kv-value">{value}</span>
    </div>
  );
}

function StatCell({ label, value, unit, sub, subColor, borderColor, valueColor }) {
  return (
    <div className="v2-det__stat" style={borderColor ? { borderColor } : undefined}>
      <div className="v2-det__stat-label">{label}</div>
      <div className="v2-det__stat-val">
        <span style={valueColor ? { color: valueColor } : undefined}>{value}</span>
        {unit && <span className="v2-det__stat-unit">{unit}</span>}
      </div>
      {sub && (
        <div className="v2-det__stat-sub" style={subColor ? { color: subColor } : undefined}>
          {sub}
        </div>
      )}
    </div>
  );
}

function MiniGraph({ title, series, color, valueLabel, posPct }) {
  return (
    <div className="v2-det__mini">
      <div className="v2-det__mini-head">
        <span>{title}</span>
        <span style={{ color }}>{valueLabel}</span>
      </div>
      <div className="v2-det__mini-plot">
        {series ? (
          <svg width="100%" height="46" viewBox="0 0 160 46" preserveAspectRatio="none">
            <polyline
              points={series.points}
              fill="none"
              stroke={color}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : (
          <div className="v2-det__mini-empty">no samples</div>
        )}
        {posPct != null && <div className="v2-det__mini-cursor" style={{ left: `${posPct}%` }} />}
      </div>
      {series && (
        <div className="v2-det__mini-foot">
          <span>{series.min.toLocaleString('en-US')}</span>
          <span>{series.max.toLocaleString('en-US')}</span>
        </div>
      )}
    </div>
  );
}

// Human-readable label for the AircraftInfo.owner_type enum. Falls back to a
// title-cased version of any unrecognized value so new backend types still show.
const OWNER_TYPE_LABELS = {
  llc: 'LLC',
  trust: 'Trust',
  corporation: 'Corporation',
  corp: 'Corporation',
  individual: 'Individual',
  partnership: 'Partnership',
  government: 'Government',
};
function ownerTypeLabel(t) {
  if (t == null || t === '') return null;
  const key = String(t).toLowerCase();
  if (OWNER_TYPE_LABELS[key]) return OWNER_TYPE_LABELS[key];
  return key.charAt(0).toUpperCase() + key.slice(1);
}

// Human labels for the shell-company evidence signals emitted by
// registration_analysis.py (both weighted `factors` keys and boolean `details`).
const OWNERSHIP_FACTOR_LABELS = {
  llc_no_web_presence: 'LLC — no web presence',
  no_web_presence: 'No web presence',
  registered_agent_address: 'Registered-agent address',
  registered_agent_owner: 'Registered-agent owner',
  registered_agent_detected: 'Registered agent detected',
  po_box_address: 'PO box address',
  po_box_detected: 'PO box detected',
  multiple_transfers: 'Multiple ownership transfers',
  rapid_transfers_detected: 'Rapid ownership transfers',
  trust_ownership: 'Trust ownership',
  trust_ownership_detected: 'Trust ownership detected',
  generic_llc_name: 'Generic LLC name',
  generic_llc_match: 'Generic LLC name matched',
};

function factorLabel(key) {
  if (OWNERSHIP_FACTOR_LABELS[key]) return OWNERSHIP_FACTOR_LABELS[key];
  const s = String(key).replaceAll('_', ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Normalize the free-form `ownership_flags` into structured shell-company
 * evidence. The backend (registration_analysis.py) sends
 * `{ risk_level, factors: {key: weight}, details: {key: bool} }`, but older/other
 * shapes (a bare array of factors, or `factors` as a string[]/object[]) are also
 * tolerated. Returns weighted factors (sorted by contribution) + detected detail
 * signals, so the UI can show the evidence behind the score.
 *
 * @param {*} flags
 * @returns {{riskLevel: string|null, factors: {key:string,label:string,weight:number|null}[], details: {key:string,label:string}[]}}
 */
function ownershipEvidence(flags) {
  if (flags == null) return { riskLevel: null, factors: [], details: [] };
  const riskLevel = typeof flags.risk_level === 'string' ? flags.risk_level : null;

  const src = Array.isArray(flags) ? flags : flags.factors;
  let factors = [];
  if (Array.isArray(src)) {
    factors = src
      .map((f) => {
        if (f == null) return null;
        if (typeof f === 'string') return { key: f, label: factorLabel(f), weight: null };
        if (typeof f === 'object') {
          const key = f.label || f.name || f.reason || f.factor;
          return key
            ? {
                key,
                label: factorLabel(key),
                weight: typeof f.weight === 'number' ? f.weight : null,
              }
            : null;
        }
        return null;
      })
      .filter(Boolean);
  } else if (src && typeof src === 'object') {
    factors = Object.entries(src)
      .filter(([, w]) => w)
      .map(([key, w]) => ({
        key,
        label: factorLabel(key),
        weight: typeof w === 'number' ? w : null,
      }))
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  }

  let details = [];
  const d = flags.details;
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    details = Object.entries(d)
      .filter(([, v]) => v === true || (typeof v === 'number' && v) || (typeof v === 'string' && v))
      .map(([key]) => ({ key, label: factorLabel(key) }));
  }
  return { riskLevel, factors, details };
}

/**
 * v2 Aircraft Detail (designs/Aircraft Detail.dc.html): identity bar, 6-up
 * stat strip, photo hero + lightbox, airframe info, route card, schematic
 * track panel with playback, reception, transponder log, sighting history,
 * safety status/events, external links.
 *
 * @param {object} props
 * @param {string} props.apiBase
 * @param {string} props.hex
 * @param {object|undefined} props.live - live socket aircraft entry (if in view)
 * @param {string} [props.call] - callsign from the route (used when not live)
 * @param {(hex: string) => void} props.onClose
 * @param {(eventId: string|number) => void} props.onViewEvent
 */
export function DetailScreen({
  apiBase,
  hex,
  live,
  call,
  connected = false,
  onClose,
  onViewEvent,
  layout,
}) {
  // Opt-in 3-zone "ops console" layout (gated by #airframe?...&layout=console).
  // Default (undefined) keeps the original 2-column layout untouched.
  const consoleLayout = layout === 'console';
  const [photoOpen, setPhotoOpen] = useState(false);
  const [photoFetching, setPhotoFetching] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [pos, setPos] = useState(100);
  const [liveOn, setLiveOn] = useState(true);
  const [dossierOpen, setDossierOpen] = useState(false);
  const [trackHours, setTrackHours] = useState(24);
  // Selected flight leg index; null = newest (auto-follows the latest leg).
  const [activeFlight, setActiveFlight] = useState(null);

  // The aircraft is streaming a usable position right now (in coverage).
  const liveAvailable = typeof live?.lat === 'number' && typeof live?.lon === 'number';
  // Live tracking is actually running: toggled on, socket up, position flowing.
  const liveActive = liveOn && connected && liveAvailable;
  const livePoint = liveActive ? { lat: live.lat, lon: live.lon, track: live.track } : null;

  // Prefer the live callsign; fall back to the one passed in the route (e.g.
  // opened from the radio screen for an aircraft no longer in view) so the
  // route lookup and callsign row still populate.
  const callsign = (live?.flight || call || '').trim();
  const { info, track, safety, sessions, route, acars } = useDetailData(
    apiBase,
    hex,
    callsign,
    liveActive,
    trackHours
  );
  const airframe = info.data || {};
  const points = track.data || [];
  const safetyEvents = safety.data || [];

  // Split the fetched history into distinct flights (on-ground/coverage gaps or
  // callsign change). The picker scopes the map, graphs and playback to one leg.
  const flights = useMemo(() => splitFlights(points), [points]);
  // Resolve the active leg: explicit selection, else the newest (last) leg.
  const flightIdx = activeFlight == null ? flights.length - 1 : activeFlight;
  const activeLeg = flights[flightIdx] || null;
  // Every downstream derivation reads these points, not the merged `points`.
  const activePoints = activeLeg ? activeLeg.points : points;

  // ICAO type designator + its matching reference-library airframe (if indexed),
  // so the header type badge can open the technical dossier.
  const rawType = airframe.type_code || airframe.aircraft_type || airframe.type || live?.t || '';
  const dossierFrame = useMemo(() => {
    const t = String(rawType).toUpperCase();
    return t ? AIRFRAMES.find((a) => a.id === t) || null : null;
  }, [rawType]);

  // playback timer (local advance between socket ticks, mock cadence)
  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => {
      setPos((p) => {
        const next = p + speed * 1.5;
        if (next >= 100) {
          setPlaying(false);
          return 100;
        }
        return next;
      });
    }, 250);
    return () => clearInterval(id);
  }, [playing, speed]);

  // Restart the scrubber whenever the selected flight changes (picking another
  // leg, or a new window re-splitting the history). Keyed on the leg id, which is
  // stable while live positions extend the current leg — so live tracking doesn't
  // yank playback back to the start on every refetch.
  const activeLegId = activeLeg?.id;
  useEffect(() => {
    setPos(100);
    setPlaying(false);
  }, [activeLegId]);

  // Widening/narrowing the window re-splits the history; drop back to following
  // the newest leg so a stale index doesn't point past the new leg list.
  useEffect(() => {
    setActiveFlight(null);
  }, [trackHours]);

  // Close the photo lightbox on Escape from anywhere - the overlay is not
  // auto-focused, so a listener scoped to the div alone never fires.
  useEffect(() => {
    if (!photoOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setPhotoOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [photoOpen]);

  const status = flightStatus(live);
  const alt = live ? altitudeOf(live) : null;
  const vr = live?.vr;
  const altTrend = trendOf(points, 'altitude', {
    upLabel: 'climbing',
    downLabel: 'descending',
    flatLabel: 'level',
  });
  const spdTrend = trendOf(points, 'gs', {
    upLabel: 'accelerating',
    downLabel: 'slowing',
    flatLabel: 'steady',
  });
  const trk = trackDisplay(live?.track);
  const emerg = live && EMERGENCY_SQUAWKS.includes(live.squawk);

  // Every playback derivation is scoped to the selected flight leg (activePoints),
  // so the map, graphs, log and clock cover one flight instead of the merged 24h+
  // blob. Per-leg point arrays (dimmed on the map) come from `flights`.
  const projection = useMemo(() => projectTrack(activePoints), [activePoints]);
  const flightLegPoints = useMemo(() => flights.map((f) => f.points), [flights]);

  // Playback marker position in real coords - drives the replay marker on the
  // geographic map. `pos` is 0-100 over the selected flight's track window.
  const validTrackPoints = useMemo(
    () => activePoints.filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number'),
    [activePoints]
  );
  const replayPoint = useMemo(() => {
    if (validTrackPoints.length < 2) return null;
    const idx = Math.min(
      validTrackPoints.length - 1,
      Math.max(0, Math.round((pos / 100) * (validTrackPoints.length - 1)))
    );
    const p = validTrackPoints[idx];
    return p ? { lat: p.lat, lon: p.lon, track: p.track } : null;
  }, [validTrackPoints, pos]);
  const altSeries = useMemo(() => miniSeries(activePoints, 'altitude'), [activePoints]);
  const spdSeries = useMemo(() => miniSeries(activePoints, 'gs'), [activePoints]);
  const vsSeries = useMemo(() => miniSeries(activePoints, 'vr'), [activePoints]);
  const log = useMemo(() => transponderLog(activePoints), [activePoints]);
  const links = externalLinks({ hex, callsign, registration: airframe.registration || live?.r });

  // playback clock over the selected flight's track window
  const clock = useMemo(() => {
    if (activePoints.length < 2) return '--:-- / --:--';
    const t0 = new Date(activePoints[0].timestamp || 0).getTime();
    const t1 = new Date(activePoints[activePoints.length - 1].timestamp || 0).getTime();
    const totalSec = Math.max(0, Math.round((t1 - t0) / 1000));
    const cur = Math.round((totalSec * pos) / 100);
    const fmt = (s) =>
      `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    return `${fmt(cur)} / ${fmt(totalSec)}`;
  }, [activePoints, pos]);

  const routeInfo = parseRoute(route.data);
  const { origin, destination } = routeInfo;

  const photoUrl = airframe.photo_url;
  const registration = airframe.registration || live?.r || '';
  const displayName = callsign || registration || (hex || '').toUpperCase();
  const num = (v) => (typeof v === 'number' ? Math.round(v).toLocaleString('en-US') : '--');

  // Country-flag emoji next to the registration. `country_code` is ISO 3166-1
  // alpha-2 (may be null); countryCodeToFlag returns '' for absent/invalid.
  const countryName = airframe.country || airframe.registered_country || '';
  const regFlag = countryCodeToFlag(airframe.country_code);

  // Privacy/flag badges. The AircraftInfo serializer surfaces these flags only
  // inside per-source `source_data` rows (not as top-level fields), so OR them
  // across every source that reported the airframe.
  const sourceData = Array.isArray(airframe.source_data) ? airframe.source_data : [];
  const flags = useMemo(() => {
    const any = (key) => sourceData.some((s) => s?.[key]);
    return {
      ladd: any('is_ladd'),
      pia: any('is_pia'),
      interesting: any('is_interesting'),
    };
    // sourceData is derived fresh each render from airframe; length+identity is
    // a stable-enough dep for this cheap reduction.
  }, [sourceData]);

  // Radio transmissions matched to this airframe's callsign (transcript, freq,
  // duration, extraction confidence). Absent on most records - guard the card.
  const radioCalls = Array.isArray(airframe.matched_radio_calls)
    ? airframe.matched_radio_calls
    : [];

  // ACARS/VDL2 datalink messages for this airframe (own 24h query).
  const acarsMessages = Array.isArray(acars.data) ? acars.data : [];

  // Ownership analysis (shell-company heuristics) + dossier prose. All optional
  // — the cards below render only when their fields are actually present.
  const dossierText =
    typeof airframe.dossier_text === 'string' && airframe.dossier_text.trim()
      ? airframe.dossier_text.trim()
      : null;
  const ownerTypeText = ownerTypeLabel(airframe.owner_type);
  // Law-enforcement / public-safety classification from the backend ownership
  // analysis (law_enforcement_db.identify_law_enforcement). Present as a nested
  // object on ownership_flags: {category, description, confidence, identifiers}.
  const leInfo =
    airframe.ownership_flags && typeof airframe.ownership_flags === 'object'
      ? airframe.ownership_flags.law_enforcement
      : null;
  const shellSuspected = airframe.is_shell_suspected === true;
  const shellScore = typeof airframe.shell_score === 'number' ? airframe.shell_score : null;
  const shellPct =
    shellScore != null ? Math.round(Math.max(0, Math.min(1, shellScore)) * 100) : null;
  const ownership = useMemo(
    () => ownershipEvidence(airframe.ownership_flags),
    [airframe.ownership_flags]
  );
  // Prefer the weighted factors; fall back to the boolean detail signals so we
  // never show an empty Evidence section when only one shape is present.
  const ownEvidence =
    ownership.factors.length > 0
      ? ownership.factors
      : ownership.details.map((d) => ({ ...d, weight: null }));
  const hasOwnership =
    airframe.is_shell_suspected != null ||
    shellScore != null ||
    ownerTypeText != null ||
    ownEvidence.length > 0;

  const cachedAt = airframe.cached_at;
  const fetchFailed = airframe.fetch_failed === true;

  // Clicking the empty photo hero triggers a priority (force) photo fetch on the
  // backend, then polls the airframe record until the photo_url appears.
  const queryClient = useQueryClient();
  const photoPollRef = useRef(null);

  const stopPhotoPoll = useCallback(() => {
    if (photoPollRef.current) {
      clearInterval(photoPollRef.current);
      photoPollRef.current = null;
    }
  }, []);

  const requestPhoto = useCallback(async () => {
    if (photoUrl || photoFetching || !hex) return;
    const hexUC = (hex || '').toUpperCase();
    setPhotoFetching(true);
    toast('Fetching photo…');
    try {
      await fetch(`${apiBase}/api/v1/airframes/${hexUC}/photos/fetch/?force=true`, {
        method: 'POST',
      });
    } catch {
      // Network hiccup on the trigger - poll anyway; the task may still have run.
    }
    let attempts = 0;
    stopPhotoPoll();
    photoPollRef.current = setInterval(() => {
      attempts += 1;
      if (attempts > 8) {
        stopPhotoPoll();
        setPhotoFetching(false);
        toast('No photo found');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['v2-detail-info', apiBase, hexUC] });
    }, 3000);
  }, [photoUrl, photoFetching, hex, apiBase, queryClient, stopPhotoPoll]);

  // Force-refresh the whole airframe record (re-fetch external sources) and nudge
  // the flight-history card to append any new activity.
  const [airframeRefreshing, setAirframeRefreshing] = useState(false);
  const [fhRefreshKey, setFhRefreshKey] = useState(0);
  const refreshAirframe = useCallback(async () => {
    if (!hex || airframeRefreshing) return;
    const hexUC = (hex || '').toUpperCase();
    setAirframeRefreshing(true);
    toast('Refreshing airframe data…');
    try {
      await fetch(`${apiBase}/api/v1/airframes/${hexUC}/refresh/`, { method: 'POST' });
    } catch {
      // Trigger may still have run server-side; re-poll regardless.
    }
    // Re-poll the record (useDetailData keeps polling while it's unpopulated) and
    // force the flight-history card to re-check for new sessions.
    queryClient.invalidateQueries({ queryKey: ['v2-detail-info', apiBase, hexUC] });
    queryClient.invalidateQueries({ queryKey: ['v2-detail-track', apiBase, hexUC] });
    setFhRefreshKey((k) => k + 1);
    setTimeout(() => setAirframeRefreshing(false), 4000);
  }, [hex, apiBase, airframeRefreshing, queryClient]);

  // Stop polling once the photo lands, and clean up on hex change / unmount.
  useEffect(() => {
    if (photoUrl && photoPollRef.current) {
      stopPhotoPoll();
      setPhotoFetching(false);
      toast('Photo loaded');
    }
  }, [photoUrl, stopPhotoPoll]);

  useEffect(() => {
    setPhotoFetching(false);
    stopPhotoPoll();
    return stopPhotoPoll;
  }, [hex, stopPhotoPoll]);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast('Link copied to clipboard');
    } catch {
      toast('Copy failed');
    }
  };

  const sevColor = (sev) => {
    const s = (sev || '').toLowerCase();
    if (s === 'critical' || s === 'emergency' || s === 'high') return 'var(--danger)';
    if (s === 'warning' || s === 'medium' || s === 'caution') return 'var(--warn)';
    return 'var(--accent2)';
  };

  // ---- content blocks (shared by both layout arrangements) ----
  const identityBar = (
    <div className="v2-det__identity">
      <div className="v2-det__titles">
        <div className="v2-det__title-row">
          <span className="v2-det__callsign">{displayName}</span>
          <span
            className="v2-det__status"
            style={{
              color: status.color,
              background: `color-mix(in srgb, ${status.color} 14%, transparent)`,
            }}
          >
            <span className="v2-det__status-dot" style={{ background: status.color }} />
            {status.label}
          </span>
          <FavoriteButton hex={hex} size={18} />
        </div>
        <div className="v2-det__id-chips">
          <span className="v2-det__modes">Mode-S {(hex || '').toUpperCase()}</span>
          {registration && (
            <span className="v2-det__reg-chip">
              {regFlag && (
                <span
                  className="v2-det__reg-flag"
                  data-testid="v2-detail-reg-flag"
                  role="img"
                  aria-label={countryName ? `${countryName} flag` : 'Country flag'}
                  title={countryName || undefined}
                >
                  {regFlag}
                </span>
              )}
              {registration}
            </span>
          )}
          {rawType &&
            (dossierFrame ? (
              <button
                type="button"
                className="v2-det__type-chip v2-det__type-chip--link"
                onClick={() => setDossierOpen(true)}
                title={`View ${dossierFrame.name} technical dossier`}
              >
                {rawType}
                <Icon name="layers" size={11} strokeWidth={1.9} />
              </button>
            ) : (
              <span className="v2-det__type-chip">{rawType}</span>
            ))}
          {(airframe.operator || airframe.owner) && (
            <span className="v2-det__op-chip">{airframe.operator || airframe.owner}</span>
          )}
          {flags.ladd && (
            <span
              className="v2-det__flag v2-det__flag--ladd"
              title="FAA Limiting Aircraft Data Displayed"
            >
              <Icon name="eye" size={11} strokeWidth={1.9} />
              LADD
            </span>
          )}
          {flags.pia && (
            <span className="v2-det__flag v2-det__flag--pia" title="Privacy ICAO Address">
              <Icon name="shield-check" size={11} strokeWidth={1.9} />
              PIA
            </span>
          )}
          {flags.interesting && (
            <span className="v2-det__flag v2-det__flag--interesting" title="Flagged as interesting">
              <Icon name="star" size={11} strokeWidth={1.9} />
              INTERESTING
            </span>
          )}
          {leInfo && (
            <span
              className="v2-det__flag v2-det__flag--le"
              title={
                [leInfo.category, leInfo.description].filter(Boolean).join(' — ') ||
                'Law enforcement / public-safety aircraft'
              }
            >
              <Icon name="shield" size={11} strokeWidth={1.9} />
              {leInfo.category || 'LAW ENFORCEMENT'}
            </span>
          )}
          <RouteSummary origin={origin} destination={destination} />
        </div>
      </div>
      <div className="v2-det__spacer" />
      <div className="v2-det__actions">
        <button
          type="button"
          className="v2-btn"
          onClick={refreshAirframe}
          disabled={airframeRefreshing}
          title="Refresh airframe data"
          data-testid="v2-detail-refresh"
        >
          <Icon
            name="refresh-cw"
            size={15}
            strokeWidth={1.7}
            className={airframeRefreshing ? 'v2-spin' : undefined}
          />
        </button>
        <button type="button" className="v2-btn" onClick={share} title="Share">
          <Icon name="share" size={15} strokeWidth={1.7} />
        </button>
        <button
          type="button"
          className="v2-btn"
          onClick={onClose}
          title="Close"
          data-testid="v2-detail-close"
        >
          <Icon name="x" size={15} strokeWidth={1.9} />
        </button>
      </div>
    </div>
  );

  const statStrip = (
    <div className="v2-det__strip">
      <StatCell
        label="ALTITUDE"
        value={alt != null ? alt.toLocaleString('en-US') : '--'}
        unit="ft"
        sub={altTrend.label}
        subColor={
          altTrend.dir < 0 ? 'var(--danger)' : altTrend.dir > 0 ? 'var(--accent)' : 'var(--dim2)'
        }
      />
      <StatCell
        label="GROUND SPD"
        value={num(live?.gs)}
        unit="kts"
        sub={spdTrend.label}
        subColor={
          spdTrend.dir < 0 ? 'var(--danger)' : spdTrend.dir > 0 ? 'var(--accent)' : 'var(--dim2)'
        }
      />
      <StatCell
        label="VERT SPEED"
        value={vr != null ? Math.round(vr).toLocaleString('en-US') : '--'}
        unit="fpm"
        valueColor={vr < 0 ? 'var(--warn)' : vr > 0 ? 'var(--accent)' : undefined}
        borderColor={vr < -800 ? 'color-mix(in srgb, var(--warn) 28%, var(--bord))' : undefined}
        sub={vr == null ? '—' : vr < 0 ? 'descending' : vr > 0 ? 'climbing' : 'level'}
      />
      <StatCell label="TRACK" value={trk.deg} unit="°" sub={trk.dir ? `heading ${trk.dir}` : '—'} />
      <StatCell
        label="DISTANCE"
        value={typeof live?.distance_nm === 'number' ? live.distance_nm.toFixed(1) : '--'}
        unit="nm"
        sub="from station"
      />
      <StatCell
        label="SQUAWK"
        value={live?.squawk || '--'}
        valueColor={emerg ? 'var(--danger)' : undefined}
        sub={emerg ? 'EMERGENCY' : 'normal'}
        subColor={emerg ? 'var(--danger)' : 'var(--accent)'}
        borderColor={emerg ? 'var(--danger)' : undefined}
      />
    </div>
  );

  const photoHero = (
    <button
      type="button"
      className="v2-det__photo"
      onClick={() => (photoUrl ? setPhotoOpen(true) : requestPhoto())}
      disabled={photoFetching}
      style={photoUrl ? { backgroundImage: `url(${photoUrl})` } : undefined}
      aria-label={photoUrl ? 'Enlarge aircraft photo' : 'Fetch aircraft photo'}
    >
      {!photoUrl && (
        <span className="v2-det__photo-placeholder">
          {photoFetching
            ? 'Fetching photo…'
            : `${(
                airframe.type_code ||
                airframe.aircraft_type ||
                live?.t ||
                'aircraft'
              ).toString()} · no photo — click to fetch`}
        </span>
      )}
      <div className="v2-det__photo-scrim" />
      <div className="v2-det__photo-id">
        <div className="v2-det__photo-reg">{airframe.registration || live?.r || ''}</div>
        <div className="v2-det__photo-model">
          {airframe.model ||
            airframe.type_name ||
            airframe.type_code ||
            airframe.aircraft_type ||
            ''}
        </div>
      </div>
      {airframe.photo_source && (
        <div className="v2-det__photo-credit">© {String(airframe.photo_source).toUpperCase()}</div>
      )}
      {photoUrl && (
        <div className="v2-det__photo-enlarge">
          <Icon name="maximize" size={12} strokeWidth={1.9} />
          Enlarge
        </div>
      )}
    </button>
  );

  const summaryCard = dossierText ? (
    <div className="v2-det__card" data-testid="v2-detail-summary">
      <div className="v2-det__card-head">
        <Icon name="file" size={15} strokeWidth={1.7} style={{ color: 'var(--accent)' }} />
        <span>Summary</span>
      </div>
      <div className="v2-det__card-body">
        <p className="v2-det__summary-text" data-testid="v2-detail-summary-text">
          {dossierText}
        </p>
      </div>
    </div>
  ) : null;

  const routeCard = (
    <FlightRoute
      origin={origin}
      destination={destination}
      position={live}
      flightNumber={routeInfo.flightNumber}
      airline={routeInfo.airline}
      callsign={callsign}
    />
  );

  const turbCard = <TurbulenceCard live={live} apiBase={apiBase} />;

  const aircraftInfoCard = (
    <div className="v2-det__card">
      <div className="v2-det__card-head">
        <Icon name="send" size={15} strokeWidth={1.7} style={{ color: 'var(--accent)' }} />
        <span>Aircraft Info</span>
      </div>
      <div className="v2-det__card-body">
        <div className="v2-det__section-label">AIRFRAME</div>
        <KVRow label="ICAO Type">
          {airframe.type_code || airframe.aircraft_type || airframe.type || live?.t}
        </KVRow>
        <KVRow label="Manufacturer">{airframe.manufacturer}</KVRow>
        <KVRow label="Model">{airframe.model}</KVRow>
        <KVRow label="Serial (MSN)">{airframe.serial_number || airframe.msn}</KVRow>
        <KVRow label="Built" last={airframe.age_years == null && !airframe.airframe_hours}>
          {airframe.year_built || airframe.built}
        </KVRow>
        {airframe.age_years != null && (
          <KVRow label="Age" last={!airframe.airframe_hours}>
            {`${airframe.age_years} yr${airframe.age_years === 1 ? '' : 's'}`}
          </KVRow>
        )}
        {airframe.airframe_hours != null && airframe.airframe_hours !== '' && (
          <KVRow label="Airframe Hours" last>
            {typeof airframe.airframe_hours === 'number'
              ? `${Math.round(airframe.airframe_hours).toLocaleString('en-US')} h`
              : airframe.airframe_hours}
          </KVRow>
        )}
        {(airframe.first_flight_date || airframe.delivery_date) && (
          <>
            <div className="v2-det__section-label">HISTORY</div>
            {airframe.first_flight_date && (
              <KVRow label="First Flight" last={!airframe.delivery_date}>
                {new Date(airframe.first_flight_date).toLocaleDateString()}
              </KVRow>
            )}
            {airframe.delivery_date && (
              <KVRow label="Delivered" last>
                {new Date(airframe.delivery_date).toLocaleDateString()}
              </KVRow>
            )}
          </>
        )}
        <div className="v2-det__section-label">OPERATOR &amp; REGISTRATION</div>
        <KVRow label="Operator">{airframe.operator || airframe.owner}</KVRow>
        <KVRow label="Callsign">{callsign || '--'}</KVRow>
        <KVRow label="Registration">{airframe.registration || live?.r}</KVRow>
        <KVRow label="ICAO 24-bit">{(hex || '').toUpperCase()}</KVRow>
        <KVRow label="Country" last>
          {airframe.country || airframe.registered_country}
        </KVRow>
        {(cachedAt || fetchFailed) && (
          <div className="v2-det__freshness">
            {fetchFailed && (
              <span className="v2-det__freshness-warn" title="Last external lookup failed">
                <Icon name="alert-triangle" size={11} strokeWidth={1.9} />
                lookup failed
              </span>
            )}
            {cachedAt && (
              <span className="v2-det__freshness-cached">
                <Icon name="clock" size={11} strokeWidth={1.7} />
                cached {new Date(cachedAt).toLocaleString()}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const ownershipCard = hasOwnership ? (
    <div className="v2-det__card" data-testid="v2-detail-ownership">
      <div className="v2-det__card-head">
        <Icon
          name="shield"
          size={15}
          strokeWidth={1.7}
          style={{ color: shellSuspected ? 'var(--warn)' : 'var(--accent)' }}
        />
        <span>Ownership Analysis</span>
        {ownerTypeText && (
          <span className="v2-det__card-aside" data-testid="v2-detail-ownership-type">
            {ownerTypeText}
          </span>
        )}
      </div>
      <div className="v2-det__card-body">
        {airframe.is_shell_suspected != null && (
          <div
            className={`v2-det__own-flag ${shellSuspected ? 'v2-det__own-flag--on' : ''}`}
            data-testid="v2-detail-shell-flag"
          >
            <Icon
              name={shellSuspected ? 'alert-triangle' : 'shield-check'}
              size={14}
              strokeWidth={1.9}
            />
            <span>
              {shellSuspected ? 'Shell company suspected' : 'No shell-company indicators'}
            </span>
          </div>
        )}
        {shellPct != null && (
          <div className="v2-det__own-score" data-testid="v2-detail-shell-score">
            <div className="v2-det__own-score-head">
              <span className="v2-det__section-label">SHELL LIKELIHOOD</span>
              <span className="v2-det__own-score-pct">{shellPct}%</span>
            </div>
            <div className="v2-det__own-bar">
              <div
                className="v2-det__own-bar-fill"
                style={{
                  width: `${shellPct}%`,
                  background: shellSuspected ? 'var(--warn)' : 'var(--accent2)',
                }}
              />
            </div>
          </div>
        )}
        {ownership.riskLevel && (
          <div
            className={`v2-det__own-risk v2-det__own-risk--${ownership.riskLevel.toLowerCase()}`}
            data-testid="v2-detail-ownership-risk"
          >
            <span className="v2-det__section-label">RISK LEVEL</span>
            <span className="v2-det__own-risk-pill">{ownership.riskLevel.toUpperCase()}</span>
          </div>
        )}
        {ownEvidence.length > 0 && (
          <div className="v2-det__own-factors" data-testid="v2-detail-ownership-factors">
            <div className="v2-det__section-label">EVIDENCE</div>
            {ownEvidence.map((f, i) => (
              <div key={`${f.key}-${i}`} className="v2-det__own-factor">
                <span className="v2-det__own-factor-dot" />
                <span className="v2-det__own-factor-label">{f.label}</span>
                {f.weight != null && (
                  <span
                    className="v2-det__own-factor-weight"
                    title="Contribution to shell-likelihood score"
                  >
                    +{Math.round(f.weight * 100)}%
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  ) : null;

  const sightingAside = `seen ${(sessions.data || []).length}× here`;
  const sightingBody =
    (sessions.data || []).length === 0 ? (
      <div className="v2-det__map-empty">First time this station has seen this airframe</div>
    ) : (
      (sessions.data || []).map((s, i) => (
        <div key={s.id ?? i} className="v2-det__timeline-row">
          <div className="v2-det__timeline-rail">
            <span
              className="v2-det__timeline-dot"
              style={{ background: i === 0 ? 'var(--accent)' : 'var(--dim)' }}
            />
            <span className="v2-det__timeline-line" />
          </div>
          <div className="v2-det__timeline-body">
            <div className="v2-det__timeline-head">
              <span>{(s.callsign || '').trim() || (s.icao_hex || '').toUpperCase()}</span>
              <span className="v2-det__timeline-when">
                {s.last_seen ? new Date(s.last_seen).toLocaleDateString() : ''}
              </span>
            </div>
            <div className="v2-det__timeline-note">
              {typeof s.max_rssi === 'number' ? `peak ${Math.round(s.max_rssi)} dB · ` : ''}
              {s.duration_min != null ? `${Math.round(s.duration_min)} min tracked` : ''}
              {typeof s.min_distance_nm === 'number'
                ? ` · closest ${s.min_distance_nm.toFixed(1)} nm`
                : ''}
            </div>
          </div>
        </div>
      ))
    );

  const sightingCard = (
    <div className="v2-det__card">
      <div className="v2-det__card-head">
        <Icon name="crosshair" size={15} strokeWidth={1.7} style={{ color: 'var(--accent)' }} />
        <span>Sighting History</span>
        <span className="v2-det__card-aside">{sightingAside}</span>
      </div>
      <div className="v2-det__card-body">{sightingBody}</div>
    </div>
  );

  const safetyCard = (
    <div className="v2-det__card">
      <div className="v2-det__card-head">
        <Icon name="alert-triangle" size={15} strokeWidth={1.7} style={{ color: 'var(--warn)' }} />
        <span>Safety Events</span>
        <span className="v2-det__card-aside">{safetyEvents.length} in 24h</span>
      </div>
      <div className="v2-det__card-body">
        {safetyEvents.length === 0 ? (
          <div className="v2-det__allclear">
            <Icon
              name="shield-check"
              size={16}
              strokeWidth={1.8}
              style={{ color: 'var(--accent)' }}
            />
            <span>ALL CLEAR — no safety events for this aircraft</span>
          </div>
        ) : (
          safetyEvents.map((e, i) => {
            const c = sevColor(e.severity);
            return (
              <button
                key={e.id ?? i}
                type="button"
                className="v2-det__safety-row"
                onClick={() => (e.id != null ? onViewEvent(e.id) : null)}
              >
                <span
                  className="v2-det__safety-icon"
                  style={{
                    color: c,
                    background: `color-mix(in srgb, ${c} 15%, transparent)`,
                  }}
                >
                  <Icon name="alert-triangle" size={15} strokeWidth={1.9} />
                </span>
                <div className="v2-det__safety-body">
                  <div className="v2-det__safety-title">
                    {(e.event_type || e.type || 'Safety event').replaceAll('_', ' ')}
                  </div>
                  <div className="v2-det__safety-detail">{e.description || e.message || ''}</div>
                </div>
                <span
                  className="v2-det__safety-sev"
                  style={{
                    color: c,
                    background: `color-mix(in srgb, ${c} 15%, transparent)`,
                  }}
                >
                  {(e.severity || 'info').toUpperCase()}
                </span>
                <span className="v2-det__safety-time">
                  {e.timestamp || e.created_at
                    ? new Date(e.timestamp || e.created_at).toLocaleTimeString('en-US', {
                        hour12: false,
                      })
                    : ''}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  const dataSourcesAside = `${sourceData.length} reporting`;
  const dataSourcesBody = sourceData.map((s, i) => (
    <div key={s.source ?? i} className="v2-det__source-row">
      <span className="v2-det__source-name">
        {(s.source || 'unknown').toString().toUpperCase()}
      </span>
      <div className="v2-det__source-flags">
        {s.is_ladd && <span className="v2-det__source-tag">LADD</span>}
        {s.is_pia && <span className="v2-det__source-tag">PIA</span>}
        {s.is_military && <span className="v2-det__source-tag">MIL</span>}
      </div>
      <span className="v2-det__source-when">
        {s.fetched_at ? new Date(s.fetched_at).toLocaleDateString() : ''}
      </span>
    </div>
  ));
  const dataSourcesCard =
    sourceData.length > 0 ? (
      <div className="v2-det__card">
        <div className="v2-det__card-head">
          <Icon name="database" size={15} strokeWidth={1.7} style={{ color: 'var(--accent)' }} />
          <span>Data Sources</span>
          <span className="v2-det__card-aside">{dataSourcesAside}</span>
        </div>
        <div className="v2-det__card-body">{dataSourcesBody}</div>
      </div>
    ) : null;

  const trackCard = (
    <div className="v2-det__card">
      <div className="v2-det__card-head">
        <Icon name="map-pin" size={15} strokeWidth={1.7} style={{ color: 'var(--accent)' }} />
        <span>Track &amp; Position</span>
        <div className="v2-det__map-ctl">
          <span className="v2-det__card-aside">
            {liveAvailable
              ? `${live.lat.toFixed(4)}° · ${live.lon.toFixed(4)}°`
              : 'no live position'}
          </span>
          <LiveIndicator
            connected={liveActive}
            liveLabel="LIVE"
            offlineLabel={liveOn ? 'OFFLINE' : 'PAUSED'}
          />
          <Switch
            checked={liveOn}
            onCheckedChange={setLiveOn}
            label="Live tracking"
            disabled={!liveAvailable}
          />
        </div>
      </div>

      {/* history window + flight picker (split playback per flight) */}
      <div className="v2-det__flights">
        <div className="v2-det__speeds v2-det__windows">
          {WINDOWS.map((w) => (
            <button
              key={w.hours}
              type="button"
              className={`v2-det__speed ${trackHours === w.hours ? 'v2-det__speed--on' : ''}`}
              onClick={() => setTrackHours(w.hours)}
              title={`Show the last ${w.label} of flights`}
            >
              {w.label}
            </button>
          ))}
        </div>
        {flights.length > 1 && (
          <div className="v2-det__flight-chips">
            {flights.map((f, i) => {
              const on = flightIdx === i;
              const t0 = f.start ? new Date(f.start) : null;
              const t1 = f.end ? new Date(f.end) : null;
              const hm = (d) =>
                d
                  ? d.toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })
                  : '--:--';
              return (
                <button
                  key={f.id}
                  type="button"
                  className={`v2-det__flight-chip ${on ? 'v2-det__flight-chip--on' : ''}`}
                  onClick={() => setActiveFlight(i)}
                  title={`${Math.round(f.durationMin)} min · ${f.count} positions`}
                >
                  <span className="v2-det__flight-chip-cs">
                    {f.callsign || (hex || '').toUpperCase()}
                  </span>
                  <span className="v2-det__flight-chip-when">
                    {t0 ? t0.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}{' '}
                    {hm(t0)}–{hm(t1)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="v2-det__map">
        {projection ? (
          <DetailTrackMap
            points={validTrackPoints}
            flights={flightLegPoints}
            activeIndex={flightIdx}
            replayPoint={replayPoint}
            livePoint={livePoint}
          />
        ) : (
          <div className="v2-det__map-empty">
            No recorded track in the last{' '}
            {(WINDOWS.find((w) => w.hours === trackHours) || WINDOWS[0]).label}
          </div>
        )}
      </div>

      {/* mini graphs */}
      <div className="v2-det__minis">
        <MiniGraph
          title="ALTITUDE"
          series={altSeries}
          color="var(--accent)"
          valueLabel={alt != null ? `${alt.toLocaleString('en-US')} ft` : '--'}
          posPct={pos}
        />
        <MiniGraph
          title="SPEED"
          series={spdSeries}
          color="var(--accent2)"
          valueLabel={live?.gs != null ? `${Math.round(live.gs)} kts` : '--'}
          posPct={pos}
        />
        <MiniGraph
          title="V/S"
          series={vsSeries}
          color="var(--warn)"
          valueLabel={vr != null ? `${Math.round(vr).toLocaleString('en-US')} fpm` : '--'}
          posPct={pos}
        />
      </div>

      {/* playback */}
      <div className="v2-det__playback">
        <div className="v2-det__transport">
          <button
            type="button"
            className="v2-iconbtn v2-det__tbtn"
            title="Restart"
            onClick={() => {
              setPos(0);
              setPlaying(false);
            }}
          >
            <Icon name="play" size={15} style={{ transform: 'rotate(180deg)' }} />
          </button>
          <button
            type="button"
            className="v2-det__playbtn"
            onClick={() => setPlaying(!playing)}
            aria-label={playing ? 'Pause playback' : 'Play playback'}
          >
            <Icon name={playing ? 'pause' : 'play'} size={17} />
          </button>
          <button
            type="button"
            className="v2-iconbtn v2-det__tbtn"
            title="Skip to live"
            onClick={() => {
              setPos(100);
              setPlaying(false);
            }}
          >
            <Icon name="play" size={15} />
          </button>
        </div>
        <div className="v2-det__speeds">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              className={`v2-det__speed ${speed === s ? 'v2-det__speed--on' : ''}`}
              onClick={() => setSpeed(s)}
            >
              {s}x
            </button>
          ))}
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={pos}
          onChange={(e) => setPos(Number(e.target.value))}
          aria-label="Playback position"
          className="v2-det__scrub"
        />
        <span className="v2-det__clock">{clock}</span>
      </div>
    </div>
  );

  const receptionCard = (
    <div className="v2-det__card">
      <div className="v2-det__card-head">
        <Icon name="signal" size={15} strokeWidth={1.7} style={{ color: 'var(--accent)' }} />
        <span>Reception</span>
      </div>
      <div className="v2-det__card-body">
        <div className="v2-det__rx">
          <span
            className="v2-det__rx-dot"
            style={{ background: live ? 'var(--accent)' : 'var(--dim2)' }}
          />
          <span className="v2-det__rx-name">This station</span>
          <div className="v2-det__rx-bar">
            <div
              style={{
                width: `${live?.rssi != null ? Math.max(6, Math.min(100, (1 + live.rssi / 35) * 100)) : 0}%`,
                background: 'var(--accent)',
                height: 5,
                borderRadius: 3,
              }}
            />
          </div>
          <span className="v2-det__rx-rssi">
            {live?.rssi != null ? `${live.rssi.toFixed(1)} dB` : '—'}
          </span>
        </div>
        <div className="v2-det__rx-foot">
          <span>{points.length} recorded positions</span>
          <span>
            {live?.seen != null ? `last seen ${Math.round(live.seen)}s ago` : 'not in view'}
          </span>
        </div>
      </div>
    </div>
  );

  const transponderBody =
    log.length === 0 ? (
      <div className="v2-det__map-empty">No transponder reports recorded</div>
    ) : (
      log.map((c, i) => (
        <div key={i} className="v2-det__log-row">
          <span className="v2-det__log-t">{c.t}</span>
          <span className="v2-det__log-msg">{c.msg}</span>
        </div>
      ))
    );

  const transponderCard = (
    <div className="v2-det__card">
      <div className="v2-det__card-head">
        <Icon name="wave" size={15} strokeWidth={1.7} style={{ color: 'var(--accent)' }} />
        <span>Transponder Log</span>
      </div>
      <div className="v2-det__card-body">{transponderBody}</div>
    </div>
  );

  const receptionTransponderRow = (
    <div className="v2-det__two-col">
      {receptionCard}
      {transponderCard}
    </div>
  );

  const flightHistoryCard = (
    <FlightHistoryCard apiBase={apiBase} hex={hex} variant="v2" refreshKey={fhRefreshKey} />
  );

  const acarsCard = <AcarsActivityCard messages={acarsMessages} apiBase={apiBase} />;
  const radioCard = <RadioActivityCard calls={radioCalls} />;

  const externalCard = (
    <div className="v2-det__external">
      <span className="v2-det__section-label">EXTERNAL</span>
      {links.map((l) => (
        <a
          key={l.label}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          className="v2-det__ext-link"
        >
          {l.label}
          <Icon name="external-link" size={11} strokeWidth={1.9} />
        </a>
      ))}
    </div>
  );

  const overlays = (
    <>
      {/* photo lightbox */}
      {photoOpen && photoUrl && (
        <div
          className="v2-det__lightbox"
          role="button"
          tabIndex={0}
          onClick={() => setPhotoOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Enter') setPhotoOpen(false);
          }}
        >
          <img src={photoUrl} alt={`${displayName} aircraft`} className="v2-det__lightbox-img" />
          <button
            type="button"
            className="v2-det__lightbox-close"
            aria-label="Close photo"
            onClick={() => setPhotoOpen(false)}
          >
            <Icon name="x" size={18} strokeWidth={1.9} />
          </button>
        </div>
      )}

      {/* Technical dossier for this aircraft's type, opened from the type badge. */}
      <AirframeModal frame={dossierFrame} open={dossierOpen} onOpenChange={setDossierOpen} />
    </>
  );

  // ---- 3-zone "ops console" arrangement (opt-in via layout=console) ----
  if (consoleLayout) {
    return (
      <div className="v2-det v2-det--console" data-testid="v2-detail">
        {/* sticky command bar: identity + live telemetry */}
        <div className="v2-det__command">
          {identityBar}
          {statStrip}
        </div>

        <div className="v2-det__grid">
          {/* IDENTITY zone — who / where-going */}
          <div className="v2-det__zone v2-det__zone--identity">
            {photoHero}
            {summaryCard}
            {routeCard}
            {turbCard}
            {flightHistoryCard}
          </div>

          {/* CENTER stage — track map (full-width hero) over a 2-col sub-grid
              of everything else, so the stage doesn't run single-file long. */}
          <div className="v2-det__zone v2-det__zone--stage">
            {trackCard}
            <div className="v2-det__stage-grid">
              {receptionCard}
              <DetailDisclosure id="transponder" title="Transponder Log" icon="wave">
                {transponderBody}
              </DetailDisclosure>
              {acarsCard}
              {radioCard}
              {sourceData.length > 0 && (
                <DetailDisclosure
                  id="sources"
                  title="Data Sources"
                  icon="database"
                  aside={dataSourcesAside}
                >
                  {dataSourcesBody}
                </DetailDisclosure>
              )}
            </div>
            {externalCard}
          </div>

          {/* META zone — reference metadata */}
          <div className="v2-det__zone v2-det__zone--meta">
            {safetyCard}
            {aircraftInfoCard}
            {ownershipCard}
            <DetailDisclosure
              id="sightings"
              title="Sighting History"
              icon="crosshair"
              aside={sightingAside}
            >
              {sightingBody}
            </DetailDisclosure>
          </div>
        </div>

        {overlays}
      </div>
    );
  }

  // ---- default 2-column arrangement (unchanged DOM) ----
  return (
    <div className="v2-det" data-testid="v2-detail">
      {identityBar}
      {statStrip}
      <div className="v2-det__grid">
        <div className="v2-det__col">
          {photoHero}
          {summaryCard}
          {routeCard}
          {turbCard}
          {aircraftInfoCard}
          {ownershipCard}
          {sightingCard}
          {safetyCard}
          {dataSourcesCard}
        </div>
        <div className="v2-det__col">
          {trackCard}
          {receptionTransponderRow}
          {flightHistoryCard}
          {acarsCard}
          {radioCard}
          {externalCard}
        </div>
      </div>
      {overlays}
    </div>
  );
}
