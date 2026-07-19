import React, { useEffect, useMemo, useState } from 'react';
import { Icon, Modal } from '../../primitives';
import { DetailTrackMap } from '../detail/DetailTrackMap';
import { externalLinks } from '../detail/detailModel';
import { useDetailData } from '../detail/useDetailData';
import { deriveTypeBadges, priorityConfig } from './alertsModel';

const SPEEDS = [0.5, 1, 2, 4];

function Stat({ icon, label, value }) {
  return (
    <div className="v2-alerts__detail-stat">
      <Icon name={icon} size={14} strokeWidth={1.7} />
      <span className="v2-alerts__detail-stat-val v2-mono">{value}</span>
      <span className="v2-alerts__detail-stat-label">{label}</span>
    </div>
  );
}

// Airframe-info key/value row. Empty strings read as '--' (blank fields from a
// partial record shouldn't render an empty cell).
function KVRow({ label, children }) {
  const value = children == null || children === '' ? '--' : children;
  return (
    <div className="v2-det__kv">
      <span className="v2-det__kv-label">{label}</span>
      <span className="v2-det__kv-value">{value}</span>
    </div>
  );
}

const num = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : null);

/**
 * Rich alert detail modal — reshaped to match the Safety Event layout: an
 * identity header with role/classification badges, a live stat strip, a large
 * geographic map of the aircraft's full 24h track history with playback
 * scrubbing, an airframe-details card, external tracker links, and
 * jump-to-map / full-detail actions.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {(open: boolean) => void} props.onOpenChange
 * @param {object|null} props.alert - fired alert (history row or live payload)
 * @param {string} props.apiBase
 * @param {(hex: string, callsign?: string) => void} props.onOpenMap
 * @param {(hex: string, callsign?: string) => void} props.onFullDetail
 */
export function AlertDetailModal({ open, onOpenChange, alert, apiBase, onOpenMap, onFullDetail }) {
  // Aircraft telemetry rides under three different keys depending on the source:
  // REST history rows use `aircraft_data`, the socket alert snapshot uses `data`
  // (socketio/namespaces/mixins/alerts.py), and live `alert:triggered` events use
  // `aircraft`. A merged inbox item can hold several, so layer the stored snapshot
  // as the base and overlay only the non-null live fields — picking one blindly
  // loses the populated one and blanks the stat strip.
  const ac = useMemo(() => {
    const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
    const snapshot = isObj(alert?.aircraft_data)
      ? alert.aircraft_data
      : isObj(alert?.data)
        ? alert.data
        : {};
    const live = isObj(alert?.aircraft) ? alert.aircraft : {};
    return {
      ...snapshot,
      ...Object.fromEntries(Object.entries(live).filter(([, v]) => v != null)),
    };
  }, [alert?.aircraft, alert?.aircraft_data, alert?.data]);
  const hex = (alert?.icao || alert?.icao_hex || ac.hex || '').toString();
  const callsign = (alert?.callsign || ac.flight || '').toString().trim();

  const { info, track } = useDetailData(apiBase, hex, callsign, false);
  const airframe = info?.data || {};
  const registration = airframe.registration || ac.r || '';

  // Full track history (24h sightings, chronological) — the same source the
  // Aircraft Detail screen renders.
  const points = useMemo(
    () => (track?.data || []).filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number'),
    [track?.data]
  );
  const livePoint = useMemo(() => {
    const lat = num(ac.lat);
    const lon = num(ac.lon);
    return lat != null && lon != null ? { lat, lon, track: num(ac.track) } : null;
  }, [ac.lat, ac.lon, ac.track]);

  // Playback across the track window (0-100 over the sorted points).
  const [pos, setPos] = useState(100);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  // Reset playback whenever the modal targets a different aircraft.
  useEffect(() => {
    setPos(100);
    setPlaying(false);
    setSpeed(1);
  }, [hex]);

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

  const replayPoint = useMemo(() => {
    if (points.length < 2) return null;
    const idx = Math.min(
      points.length - 1,
      Math.max(0, Math.round((pos / 100) * (points.length - 1)))
    );
    const p = points[idx];
    return p ? { lat: p.lat, lon: p.lon, track: p.track } : null;
  }, [points, pos]);

  const clock = useMemo(() => {
    if (points.length < 2) return '--:-- / --:--';
    const t0 = new Date(points[0].timestamp || 0).getTime();
    const t1 = new Date(points[points.length - 1].timestamp || 0).getTime();
    const totalSec = Math.max(0, Math.round((t1 - t0) / 1000));
    const cur = Math.round((totalSec * pos) / 100);
    const fmt = (s) =>
      `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    return `${fmt(cur)} / ${fmt(totalSec)}`;
  }, [points, pos]);

  const badges = useMemo(() => deriveTypeBadges(airframe, ac), [airframe, ac]);

  const links = useMemo(
    () => externalLinks({ hex, callsign, registration }),
    [hex, callsign, registration]
  );

  if (!alert) return null;

  const pc = priorityConfig(alert.priority || 'info');
  const ts = alert.timestamp || alert.triggered_at || alert.created_at;
  const alt = num(ac.alt) ?? num(ac.alt_baro);
  const typeLabel = airframe.type_name || airframe.model || airframe.type_code || ac.t || '—';
  const operator = airframe.operator || airframe.owner || ac.ownOp || '';

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Alert Detail" width="min(880px, 96vw)">
      <div className="v2-alerts__detail">
        {/* Header */}
        <div className="v2-alerts__detail-head" style={{ borderLeftColor: pc.color }}>
          <div className="v2-alerts__detail-titles">
            <div className="v2-alerts__detail-rule">
              {alert.rule_name || alert.ruleName || 'Alert'}
            </div>
            <div className="v2-alerts__detail-sub">
              {ts ? new Date(ts).toLocaleString('en-US', { hour12: false }) : '—'}
              {alert.message ? ` · ${alert.message}` : ''}
            </div>
          </div>
          <span
            className="v2-alerts__rule-pri"
            style={{
              color: pc.color,
              background: `color-mix(in srgb, ${pc.color} 15%, transparent)`,
            }}
          >
            {pc.label}
          </span>
        </div>

        {/* Identity + classification badges */}
        <div className="v2-alerts__detail-identity">
          {airframe.photo_url && (
            <img
              className="v2-alerts__detail-photo"
              src={airframe.photo_url}
              alt={callsign || hex}
              loading="lazy"
            />
          )}
          <div className="v2-alerts__detail-id">
            <div className="v2-alerts__detail-cs">{callsign || hex || '—'}</div>
            <div className="v2-alerts__detail-meta v2-mono">
              {[hex && hex.toUpperCase(), registration, typeLabel].filter(Boolean).join(' · ')}
            </div>
            {operator && <div className="v2-alerts__detail-op">{operator}</div>}
            {badges.length > 0 && (
              <div className="v2-alerts__detail-badges">
                {badges.map((b) => (
                  <span
                    key={b.key}
                    className="v2-alerts__detail-badge"
                    title={b.title}
                    style={{
                      color: b.color,
                      borderColor: `color-mix(in srgb, ${b.color} 45%, transparent)`,
                      background: `color-mix(in srgb, ${b.color} 14%, transparent)`,
                    }}
                  >
                    {b.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Stat strip */}
        <div className="v2-alerts__detail-stats">
          <Stat
            icon="arrow-up"
            label="alt ft"
            value={alt != null ? alt.toLocaleString('en-US') : '—'}
          />
          <Stat icon="zap" label="kts" value={num(ac.gs) != null ? Math.round(ac.gs) : '—'} />
          <Stat
            icon={num(ac.vr) != null && ac.vr < 0 ? 'arrow-down' : 'arrow-up'}
            label="fpm"
            value={num(ac.vr) != null ? Math.round(ac.vr) : '—'}
          />
          <Stat
            icon="compass"
            label="track"
            value={num(ac.track) != null ? `${Math.round(ac.track)}°` : '—'}
          />
          <Stat
            icon="map-pin"
            label="nm"
            value={num(ac.distance_nm) != null ? ac.distance_nm.toFixed(1) : '—'}
          />
          <Stat icon="radio" label="squawk" value={ac.squawk || '—'} />
        </div>

        {/* Full track history map + playback */}
        {(points.length > 1 || livePoint) && (
          <div className="v2-alerts__detail-track">
            <div className="v2-alerts__detail-track-head">
              <Icon name="map-pin" size={14} strokeWidth={1.7} style={{ color: 'var(--accent)' }} />
              <span>Track History</span>
              <span className="v2-alerts__detail-track-aside">{points.length} positions · 24h</span>
            </div>
            <div className="v2-alerts__detail-map">
              <DetailTrackMap points={points} replayPoint={replayPoint} livePoint={livePoint} />
            </div>
            {points.length > 1 && (
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
                    title="Skip to end"
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
            )}
          </div>
        )}

        {/* Airframe details */}
        <div className="v2-det__card v2-alerts__detail-card">
          <div className="v2-det__card-head">
            <Icon name="send" size={15} strokeWidth={1.7} style={{ color: 'var(--accent)' }} />
            <span>Airframe Details</span>
          </div>
          <div className="v2-det__card-body">
            <KVRow label="ICAO Type">
              {airframe.type_code || airframe.aircraft_type || airframe.type || ac.t}
            </KVRow>
            <KVRow label="Manufacturer">{airframe.manufacturer}</KVRow>
            <KVRow label="Model">{airframe.model || airframe.type_name}</KVRow>
            <KVRow label="Serial (MSN)">{airframe.serial_number || airframe.msn}</KVRow>
            <KVRow label="Built">{airframe.year_built || airframe.built}</KVRow>
            <KVRow label="Operator">{operator}</KVRow>
            <KVRow label="Registration">{registration}</KVRow>
            <KVRow label="ICAO 24-bit">{(hex || '').toUpperCase()}</KVRow>
            <KVRow label="Country">{airframe.country || airframe.registered_country}</KVRow>
          </div>
        </div>

        {/* External links */}
        {links.length > 0 && (
          <div className="v2-alerts__detail-links">
            {links.map((l) => (
              <a
                key={l.label}
                className="v2-btn v2-alerts__detail-link"
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="external-link" size={13} strokeWidth={1.9} />
                {l.label}
              </a>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="v2-alerts__modal-actions">
          {hex && (
            <button type="button" className="v2-btn" onClick={() => onFullDetail?.(hex, callsign)}>
              <Icon name="plane" size={14} strokeWidth={1.9} />
              Full Detail
            </button>
          )}
          {hex && (
            <button
              type="button"
              className="v2-alerts__create"
              onClick={() => onOpenMap?.(hex, callsign)}
            >
              <Icon name="map" size={14} strokeWidth={1.9} />
              Open on Map
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
