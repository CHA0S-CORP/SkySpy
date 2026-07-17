import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, toast } from '../../primitives';
import { useDetailData } from './useDetailData';
import {
  externalLinks,
  flightStatus,
  miniSeries,
  projectTrack,
  transponderLog,
  trendOf,
  trackDisplay,
} from './detailModel';
import { altitudeOf, EMERGENCY_SQUAWKS } from '../list/listModel';

const SPEEDS = [0.5, 1, 2, 4];

function KVRow({ label, children, last }) {
  return (
    <div className={`v2-det__kv ${last ? 'v2-det__kv--last' : ''}`}>
      <span className="v2-det__kv-label">{label}</span>
      <span className="v2-det__kv-value">{children ?? '--'}</span>
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
 * @param {(hex: string) => void} props.onClose
 * @param {(eventId: string|number) => void} props.onViewEvent
 */
export function DetailScreen({ apiBase, hex, live, onClose, onViewEvent }) {
  const [photoOpen, setPhotoOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [pos, setPos] = useState(100);

  const callsign = (live?.flight || '').trim();
  const { info, track, safety, sessions, route } = useDetailData(apiBase, hex, callsign);
  const airframe = info.data || {};
  const points = track.data || [];
  const safetyEvents = safety.data || [];

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

  const projection = useMemo(() => projectTrack(points), [points]);
  const marker = projection?.at(pos / 100);
  const altSeries = useMemo(() => miniSeries(points, 'altitude'), [points]);
  const spdSeries = useMemo(() => miniSeries(points, 'gs'), [points]);
  const vsSeries = useMemo(() => miniSeries(points, 'vr'), [points]);
  const log = useMemo(() => transponderLog(points), [points]);
  const links = externalLinks({ hex, callsign, registration: airframe.registration || live?.r });

  // playback clock over the fetched track window
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

  const routeData = route.data;
  const origin = routeData?.origin || routeData?.route?.origin;
  const destination = routeData?.destination || routeData?.route?.destination;

  const photoUrl = airframe.photo_url;
  const displayName = callsign || airframe.registration || (hex || '').toUpperCase();
  const num = (v) => (typeof v === 'number' ? Math.round(v).toLocaleString('en-US') : '--');

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

  return (
    <div className="v2-det" data-testid="v2-detail">
      {/* identity bar */}
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
          </div>
          <div className="v2-det__id-chips">
            <span className="v2-det__modes">Mode-S {(hex || '').toUpperCase()}</span>
            {(airframe.type_code || airframe.aircraft_type || airframe.type || live?.t) && (
              <span className="v2-det__type-chip">
                {airframe.type_code || airframe.aircraft_type || airframe.type || live?.t}
              </span>
            )}
            {(airframe.operator || airframe.owner) && (
              <span className="v2-det__op-chip">{airframe.operator || airframe.owner}</span>
            )}
          </div>
        </div>
        <div className="v2-det__spacer" />
        <div className="v2-det__actions">
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

      {/* stat strip */}
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
          value={vr != null ? vr : '--'}
          unit="fpm"
          valueColor={vr < 0 ? 'var(--warn)' : vr > 0 ? 'var(--accent)' : undefined}
          borderColor={vr < -800 ? 'color-mix(in srgb, var(--warn) 28%, var(--bord))' : undefined}
          sub={vr < 0 ? 'descending' : vr > 0 ? 'climbing' : 'level'}
        />
        <StatCell
          label="TRACK"
          value={trk.deg}
          unit="°"
          sub={trk.dir ? `heading ${trk.dir}` : '—'}
        />
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

      {/* content grid */}
      <div className="v2-det__grid">
        {/* LEFT */}
        <div className="v2-det__col">
          {/* photo hero */}
          <button
            type="button"
            className="v2-det__photo"
            onClick={() => photoUrl && setPhotoOpen(true)}
            style={photoUrl ? { backgroundImage: `url(${photoUrl})` } : undefined}
            aria-label="Enlarge aircraft photo"
          >
            {!photoUrl && (
              <span className="v2-det__photo-placeholder">
                {(airframe.type_code || airframe.aircraft_type || live?.t || 'aircraft').toString()} · no photo available
              </span>
            )}
            <div className="v2-det__photo-scrim" />
            <div className="v2-det__photo-id">
              <div className="v2-det__photo-reg">{airframe.registration || live?.r || ''}</div>
              <div className="v2-det__photo-model">
                {airframe.model || airframe.type_name || airframe.type_code || airframe.aircraft_type || ''}
              </div>
            </div>
            {airframe.photo_source && (
              <div className="v2-det__photo-credit">
                © {String(airframe.photo_source).toUpperCase()}
              </div>
            )}
            {photoUrl && (
              <div className="v2-det__photo-enlarge">
                <Icon name="maximize" size={12} strokeWidth={1.9} />
                Enlarge
              </div>
            )}
          </button>

          {/* aircraft info */}
          <div className="v2-det__card">
            <div className="v2-det__card-head">
              <Icon name="send" size={15} strokeWidth={1.7} style={{ color: 'var(--accent)' }} />
              <span>Aircraft Info</span>
            </div>
            <div className="v2-det__card-body">
              <div className="v2-det__section-label">AIRFRAME</div>
              <KVRow label="ICAO Type">{airframe.type_code || airframe.aircraft_type || airframe.type || live?.t}</KVRow>
              <KVRow label="Manufacturer">{airframe.manufacturer}</KVRow>
              <KVRow label="Model">{airframe.model}</KVRow>
              <KVRow label="Serial (MSN)">{airframe.serial_number || airframe.msn}</KVRow>
              <KVRow label="Built" last>
                {airframe.year_built || airframe.built}
              </KVRow>
              <div className="v2-det__section-label">OPERATOR &amp; REGISTRATION</div>
              <KVRow label="Operator">{airframe.operator || airframe.owner}</KVRow>
              <KVRow label="Callsign">{callsign || '--'}</KVRow>
              <KVRow label="Registration">{airframe.registration || live?.r}</KVRow>
              <KVRow label="ICAO 24-bit">{(hex || '').toUpperCase()}</KVRow>
              <KVRow label="Country" last>
                {airframe.country || airframe.registered_country}
              </KVRow>
            </div>
          </div>

          {/* flight route */}
          {origin && destination && (
            <div className="v2-det__card v2-det__card--pad">
              <div className="v2-det__card-head v2-det__card-head--bare">
                <Icon
                  name="map-pin"
                  size={15}
                  strokeWidth={1.7}
                  style={{ color: 'var(--accent)' }}
                />
                <span>Flight Route</span>
              </div>
              <div className="v2-det__route">
                <div>
                  <div className="v2-det__route-code">{origin.iata || origin.icao || origin}</div>
                  <div className="v2-det__route-city">{origin.city || origin.name || ''}</div>
                </div>
                <div className="v2-det__route-line">
                  <span />
                  <Icon name="send" size={16} style={{ color: 'var(--accent)' }} />
                  <span />
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="v2-det__route-code">
                    {destination.iata || destination.icao || destination}
                  </div>
                  <div className="v2-det__route-city">
                    {destination.city || destination.name || ''}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT */}
        <div className="v2-det__col">
          {/* track & position */}
          <div className="v2-det__card">
            <div className="v2-det__card-head">
              <Icon name="map-pin" size={15} strokeWidth={1.7} style={{ color: 'var(--accent)' }} />
              <span>Track &amp; Position</span>
              <span className="v2-det__card-aside">
                {live?.lat != null && live?.lon != null
                  ? `${live.lat.toFixed(4)}° · ${live.lon.toFixed(4)}°`
                  : 'no live position'}
              </span>
            </div>

            <div className="v2-det__map">
              {projection ? (
                <>
                  <svg
                    className="v2-det__map-track"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                  >
                    <polyline
                      points={projection.points}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      opacity="0.95"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                  {marker && (
                    <div
                      className="v2-det__map-marker"
                      style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
                    >
                      <div className="v2-det__map-ring" />
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        style={{ transform: `rotate(${marker.deg}deg)` }}
                      >
                        <path d="M12 2 19 21 12 16 5 21z" fill="var(--accent)" />
                      </svg>
                    </div>
                  )}
                </>
              ) : (
                <div className="v2-det__map-empty">No recorded track in the last 24h</div>
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
                valueLabel={vr != null ? `${vr} fpm` : '--'}
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

          {/* reception + transponder log */}
          <div className="v2-det__two-col">
            <div className="v2-det__card">
              <div className="v2-det__card-head">
                <Icon
                  name="signal"
                  size={15}
                  strokeWidth={1.7}
                  style={{ color: 'var(--accent)' }}
                />
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
                  <span>{live?.seen != null ? `last seen ${live.seen}s ago` : 'not in view'}</span>
                </div>
              </div>
            </div>
            <div className="v2-det__card">
              <div className="v2-det__card-head">
                <Icon name="wave" size={15} strokeWidth={1.7} style={{ color: 'var(--accent)' }} />
                <span>Transponder Log</span>
              </div>
              <div className="v2-det__card-body">
                {log.length === 0 ? (
                  <div className="v2-det__map-empty">No transponder reports recorded</div>
                ) : (
                  log.map((c, i) => (
                    <div key={i} className="v2-det__log-row">
                      <span className="v2-det__log-t">{c.t}</span>
                      <span className="v2-det__log-msg">{c.msg}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* sighting history */}
          <div className="v2-det__card">
            <div className="v2-det__card-head">
              <Icon
                name="crosshair"
                size={15}
                strokeWidth={1.7}
                style={{ color: 'var(--accent)' }}
              />
              <span>Sighting History</span>
              <span className="v2-det__card-aside">seen {(sessions.data || []).length}× here</span>
            </div>
            <div className="v2-det__card-body">
              {(sessions.data || []).length === 0 ? (
                <div className="v2-det__map-empty">
                  First time this station has seen this airframe
                </div>
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
                        {typeof s.max_rssi === 'number'
                          ? `peak ${Math.round(s.max_rssi)} dB · `
                          : ''}
                        {s.duration_min != null ? `${Math.round(s.duration_min)} min tracked` : ''}
                        {typeof s.min_distance_nm === 'number'
                          ? ` · closest ${s.min_distance_nm.toFixed(1)} nm`
                          : ''}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* safety events */}
          <div className="v2-det__card">
            <div className="v2-det__card-head">
              <Icon
                name="alert-triangle"
                size={15}
                strokeWidth={1.7}
                style={{ color: 'var(--warn)' }}
              />
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
                        <div className="v2-det__safety-detail">
                          {e.description || e.message || ''}
                        </div>
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

          {/* external links */}
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
        </div>
      </div>

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
    </div>
  );
}
