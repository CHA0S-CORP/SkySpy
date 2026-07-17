import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../primitives';
import { bearingTo,
  THREAT_CONFIG,
  blipPosition,
  displaySpeed,
  fmtElapsed,
  nearestThreat,
  speedDash,
  threatLevelOf,
} from './cannonballModel';
import { EMERGENCY_SQUAWKS } from '../list/listModel';

const UNITS_KEY = 'skyspy-cannonball-units';
const SCOPE_RANGE_NM = 15;

/**
 * Lightweight overhead-threat detection over the live aircraft array when the
 * backend cannonball namespace isn't wired: low-altitude rotorcraft / LE ops.
 */
function localThreats(aircraft, origin) {
  return (aircraft || [])
    .filter((a) => {
      const alt = a.alt ?? a.alt_baro ?? 0;
      const isRotor =
        ['A7', 'H60', 'EC35', 'AS50', 'B407'].includes(a.category) ||
        /(?:H60|EC35|AS50|B06|B407|R44)/.test(a.t || '');
      const le = /police|sheriff|patrol|marshal/i.test(a.ownOp || a.op || '');
      const emerg = EMERGENCY_SQUAWKS.includes(a.squawk);
      return (isRotor && alt > 0 && alt < 5000) || le || emerg;
    })
    .map((a) => ({
      callsign: (a.flight || '').trim(),
      icao_hex: a.hex,
      distance_nm: a.distance_nm,
      altitude: a.alt ?? a.alt_baro,
      // aircraft entries never carry a bearing - derive it from our position
      // (GPS fix, else feeder location) or the Sky Scope stays empty
      bearing:
        typeof a.bearing === 'number'
          ? a.bearing
          : origin && typeof a.lat === 'number' && typeof a.lon === 'number'
            ? bearingTo(origin, { lat: a.lat, lon: a.lon })
            : undefined,
      trend: a.vr < -200 ? 'closing' : a.vr > 200 ? 'departing' : 'holding',
      threat_level: /police|sheriff|patrol/i.test(a.ownOp || a.op || '') ? 'critical' : 'medium',
      is_law_enforcement: /police|sheriff|patrol/i.test(a.ownOp || a.op || ''),
    }))
    .sort((x, y) => (x.distance_nm ?? Infinity) - (y.distance_nm ?? Infinity));
}

/**
 * v2 Cannonball screen (designs/Cannonball.dc.html): full car-headunit mode
 * with threat strip, trip stats, speedometer, sky scope, nearest-air-unit
 * panel, 76px touch controls, and a driving-safe focus mode.
 *
 * @param {object} props
 * @param {object[]} props.aircraft - live aircraft array
 * @param {object[]} [props.threats] - backend cannonball threats (preferred if present)
 * @param {() => void} props.onExit
 */
export function CannonballScreen({ aircraft, threats: backendThreats, feederLocation, onExit }) {
  const [units, setUnits] = useState(() => {
    try {
      return localStorage.getItem(UNITS_KEY) === 'kmh' ? 'kmh' : 'mph';
    } catch {
      return 'mph';
    }
  });
  const [focus, setFocus] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(0);
  const [gpsPos, setGpsPos] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  // trip timer
  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // GPS speed via browser Geolocation
  useEffect(() => {
    const geo = navigator.geolocation;
    if (!geo) return undefined;
    const id = geo.watchPosition(
      (p) => {
        setSpeed(displaySpeed(p.coords.speed, units));
        setGpsPos({ lat: p.coords.latitude, lon: p.coords.longitude });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 1000 }
    );
    return () => geo.clearWatch?.(id);
  }, [units]);

  const fireToast = (msg) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const origin = gpsPos || (feederLocation?.lat != null ? feederLocation : null);
  const threats = useMemo(
    () => (backendThreats && backendThreats.length ? backendThreats : localThreats(aircraft, origin)),
    [backendThreats, aircraft, origin]
  );
  const level = threatLevelOf(threats);
  const conf = THREAT_CONFIG[level];
  const nearest = useMemo(() => nearestThreat(threats), [threats]);
  const blips = useMemo(
    () => threats.map((t) => ({ pos: blipPosition(t, SCOPE_RANGE_NM), t })).filter((b) => b.pos),
    [threats]
  );

  const limit = units === 'kmh' ? '110' : '70';
  const unitLabel = units === 'kmh' ? 'KM/H' : 'MPH';
  const hrs = Math.floor(elapsed / 3600);
  const mins = Math.floor((elapsed % 3600) / 60);

  const toggleUnits = () => {
    const next = units === 'mph' ? 'kmh' : 'mph';
    setUnits(next);
    try {
      localStorage.setItem(UNITS_KEY, next);
    } catch {
      // best-effort persistence
    }
  };

  const stats = [
    { label: 'ELAPSED', value: `${hrs}:${String(mins).padStart(2, '0')}`, unit: 'hrs' },
    { label: 'AVG SPEED', value: '--', unit: unitLabel.toLowerCase() },
    { label: 'OVERHEAD', value: String(threats.length), unit: 'ac' },
    { label: 'UNITS', value: unitLabel, unit: '' },
  ];

  // shared threat-color CSS var for tinting
  const rootStyle = { '--cb-thr': conf.color };

  if (focus) {
    return (
      <button
        type="button"
        className="v2-cb v2-cb--focus"
        style={rootStyle}
        onClick={() => setFocus(false)}
        data-testid="v2-cannonball-focus"
      >
        <div className="v2-cb__focus-bar" />
        <div className="v2-cb__focus-threat">
          <span className="v2-cb__ping">
            <span className="v2-cb__ping-dot" />
            <span className="v2-cb__ping-wave" />
          </span>
          <span className="v2-cb__focus-title">{conf.title}</span>
          {level !== 'clear' && nearest && (
            <span className="v2-cb__focus-dist">
              {nearest.dist} · {nearest.alt}
            </span>
          )}
        </div>
        <div className="v2-cb__focus-speed">
          <div className="v2-cb__focus-num">{speed}</div>
          <div className="v2-cb__focus-unit">{unitLabel}</div>
        </div>
        <div className="v2-cb__focus-hint">
          <Icon name="log-out" size={20} strokeWidth={1.8} />
          TAP ANYWHERE TO EXIT FOCUS
        </div>
      </button>
    );
  }

  return (
    <div className="v2-cb" style={rootStyle} data-testid="v2-cannonball">
      {/* top bar */}
      <div className="v2-cb__top">
        <div className="v2-cb__brand">
          <div className="v2-cb__logo">
            <Icon name="target" size={19} strokeWidth={1.9} style={{ color: 'var(--cb-alert)' }} />
          </div>
          <div className="v2-cb__wordmark">CANNONBALL</div>
        </div>
        <div className="v2-cb__spacer" />
        <div className="v2-cb__clock">
          <Icon name="clock" size={16} strokeWidth={1.7} />
          {fmtElapsed(elapsed)}
        </div>
        <div className="v2-cb__divider" />
        <div className="v2-cb__link">
          <span className="v2-cb__link-dot" />
          GPS
        </div>
        <div className="v2-cb__link">
          <Icon name="signal" size={16} strokeWidth={1.7} style={{ color: 'var(--cb-clear)' }} />
          SKY LINK
        </div>
        <button type="button" className="v2-cb__exit" onClick={onExit} title="Exit Cannonball">
          <Icon name="x" size={18} strokeWidth={1.9} />
        </button>
      </div>

      {/* threat strip */}
      <div className="v2-cb__strip">
        <span className="v2-cb__ping">
          <span className="v2-cb__ping-dot" />
          <span className="v2-cb__ping-wave" />
        </span>
        <div className="v2-cb__strip-text">
          <div className="v2-cb__strip-title">{conf.title}</div>
          <div className="v2-cb__strip-sub">{conf.sub}</div>
        </div>
        <div className="v2-cb__strip-count">{threats.length} AIRCRAFT OVERHEAD</div>
      </div>

      {/* main grid */}
      <div className="v2-cb__main">
        {/* trip stats */}
        <div className="v2-cb__stats">
          {stats.map((s) => (
            <div key={s.label} className="v2-cb__stat">
              <div className="v2-cb__stat-label">{s.label}</div>
              <div className="v2-cb__stat-val">
                <span>{s.value}</span>
                {s.unit && <span className="v2-cb__stat-unit">{s.unit}</span>}
              </div>
            </div>
          ))}
        </div>

        {/* speedometer */}
        <div className="v2-cb__speedo">
          <svg viewBox="0 0 300 300" className="v2-cb__gauge">
            <circle
              cx="150"
              cy="150"
              r="130"
              fill="none"
              stroke="var(--cb-bord)"
              strokeWidth="14"
              pathLength="100"
              strokeDasharray="75 100"
              strokeLinecap="round"
              transform="rotate(135 150 150)"
            />
            <circle
              cx="150"
              cy="150"
              r="130"
              fill="none"
              stroke="var(--cb-thr)"
              strokeWidth="14"
              pathLength="100"
              strokeDasharray={`${speedDash(speed, units)} 100`}
              strokeLinecap="round"
              transform="rotate(135 150 150)"
            />
          </svg>
          <div className="v2-cb__speed-center">
            <div className="v2-cb__speed-num" data-testid="v2-cannonball-speed">
              {speed}
            </div>
            <div className="v2-cb__speed-unit">{unitLabel}</div>
          </div>
          <div className="v2-cb__limit">
            <span>LIMIT</span>
            <span className="v2-cb__limit-val">{limit}</span>
          </div>
        </div>

        {/* sky scope + nearest */}
        <div className="v2-cb__right">
          <div className="v2-cb__scope-card">
            <div className="v2-cb__scope-head">
              <span>SKY SCOPE</span>
              <span>{SCOPE_RANGE_NM} nm</span>
            </div>
            <div className="v2-cb__scope">
              <div className="v2-cb__scope-ring v2-cb__scope-ring--outer" />
              <div className="v2-cb__scope-ring v2-cb__scope-ring--inner" />
              <div className="v2-cb__scope-sweep" />
              <span className="v2-cb__scope-center" />
              {blips.map((b, i) => (
                <div
                  key={b.t.icao_hex ?? i}
                  className="v2-cb__blip"
                  style={{ left: `${b.pos.x}%`, top: `${b.pos.y}%` }}
                >
                  <span
                    style={{
                      width: i === 0 && level !== 'clear' ? 13 : 8,
                      height: i === 0 && level !== 'clear' ? 13 : 8,
                      background: i === 0 && level !== 'clear' ? conf.color : 'var(--cb-dim2)',
                      boxShadow: `0 0 8px ${i === 0 && level !== 'clear' ? conf.color : 'var(--cb-dim2)'}`,
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="v2-cb__nearest">
            <div className="v2-cb__nearest-label">NEAREST AIR UNIT</div>
            {nearest ? (
              <>
                <div className="v2-cb__nearest-head">
                  <span className="v2-cb__nearest-cs" style={{ color: conf.color }}>
                    {nearest.cs}
                  </span>
                  <span
                    className="v2-cb__nearest-tag"
                    style={{
                      color: conf.color,
                      background: `color-mix(in srgb, ${conf.color} 18%, transparent)`,
                    }}
                  >
                    {nearest.tag}
                  </span>
                </div>
                <div className="v2-cb__nearest-metrics">
                  <div>
                    <div className="v2-cb__nearest-mlabel">DISTANCE</div>
                    <div className="v2-cb__nearest-mval">{nearest.dist}</div>
                  </div>
                  <div>
                    <div className="v2-cb__nearest-mlabel">ALT</div>
                    <div className="v2-cb__nearest-mval">{nearest.alt}</div>
                  </div>
                  <div>
                    <div className="v2-cb__nearest-mlabel">TREND</div>
                    <div
                      className="v2-cb__nearest-mval"
                      style={{ color: nearest.closing ? 'var(--cb-alert)' : 'var(--cb-caution)' }}
                    >
                      {nearest.trend}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="v2-cb__nearest-clear">— sky clear —</div>
            )}
          </div>
        </div>
      </div>

      {/* touch controls */}
      <div className="v2-cb__controls">
        <button
          type="button"
          className="v2-cb__btn v2-cb__btn--primary"
          onClick={() => setFocus(true)}
        >
          <Icon name="maximize" size={26} strokeWidth={2} />
          DRIVE FOCUS
        </button>
        <button
          type="button"
          className={`v2-cb__btn v2-cb__btn--tall ${muted ? 'v2-cb__btn--muted' : ''}`}
          onClick={() => {
            setMuted(!muted);
            fireToast(muted ? 'Audio alerts on' : 'Audio alerts muted');
          }}
        >
          <Icon name={muted ? 'volume-x' : 'volume'} size={26} strokeWidth={1.8} />
          {muted ? 'MUTED' : 'ALERTS'}
        </button>
        <button
          type="button"
          className="v2-cb__btn v2-cb__btn--tall"
          onClick={() => fireToast('Waypoint marked')}
        >
          <Icon name="star" size={26} strokeWidth={1.8} />
          MARK
        </button>
        <button
          type="button"
          className="v2-cb__btn v2-cb__btn--tall"
          onClick={() => fireToast('Scanning sky…')}
        >
          <Icon name="refresh" size={26} strokeWidth={1.8} />
          SCAN
        </button>
      </div>

      {toast && <div className="v2-cb__toast">{toast}</div>}
    </div>
  );
}
