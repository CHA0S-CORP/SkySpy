import React, { useMemo } from 'react';
import { Icon, Sparkline } from '../../v2/primitives';
import { useDetailData } from '../../v2/screens/detail/useDetailData';
import { countryCodeToFlag, flightStatus } from '../../v2/screens/detail/detailModel';
import { FlightRoute, hasRoute, parseRoute } from '../../v2/screens/detail/FlightRoute';
import {
  altitudeOf,
  CATEGORY_COLORS,
  categoryOf,
  compassDir,
  EMERGENCY_SQUAWKS,
} from '../../v2/screens/list/listModel';

// Turbulence level → accent color + fill fraction (0..1) for the live risk bar.
const TURB_META = {
  light: { color: 'var(--accent2)', frac: 0.33, label: 'LIGHT' },
  moderate: { color: 'var(--warn)', frac: 0.66, label: 'MODERATE' },
  severe: { color: 'var(--danger)', frac: 1, label: 'SEVERE' },
  extreme: { color: 'var(--danger)', frac: 1, label: 'EXTREME' },
};

/**
 * 392px collapsible Live Map detail panel (design SkySpy.dc.html right pane):
 * photo banner, identity + threat/privacy badge rail, live turbulence bar, ID
 * chips, primary stat grid, secondary telemetry micro-grid, airframe facts,
 * activity counters, performance sparklines, external links.
 *
 * The banner + primary telemetry come straight off the live socket entry (no
 * fetch wait); airframe facts / badges / counters hydrate from useDetailData as
 * the REST lookups land, and every enriched block is gated on its data so a
 * sparse GA target still renders cleanly.
 *
 * @param {object} props
 * @param {string} props.apiBase
 * @param {object|null} props.aircraft - the selected live aircraft entry
 * @param {Array} [props.track] - recent track samples (for sparklines)
 * @param {() => void} props.onClose
 * @param {(hex: string) => void} [props.onOpenFull]
 */
export function DetailPanel({ apiBase, aircraft, track = [], onClose, onOpenFull }) {
  const hex = aircraft?.hex;
  const callsign = (aircraft?.flight || '').trim();
  const { info, route, safety, sessions, acars } = useDetailData(apiBase, hex, callsign);
  const airframe = info.data || {};
  const routeInfo = parseRoute(route.data);
  const { origin, destination } = routeInfo;

  const status = flightStatus(aircraft);
  const cat = aircraft ? categoryOf(aircraft) : 'commercial';
  const catColor = CATEGORY_COLORS[cat];
  const alt = aircraft ? altitudeOf(aircraft) : 0;

  const altSeries = useMemo(
    () => track.map((p) => p.alt ?? p.altitude ?? 0).filter((v) => typeof v === 'number'),
    [track]
  );
  const spdSeries = useMemo(
    () => track.map((p) => p.spd ?? p.gs ?? 0).filter((v) => typeof v === 'number'),
    [track]
  );

  // Privacy / interest flags live only inside per-source rows; OR them across
  // every source that reported the airframe (mirrors DetailScreen).
  const sourceData = Array.isArray(airframe.source_data) ? airframe.source_data : [];
  const flags = useMemo(() => {
    const any = (key) => sourceData.some((s) => s?.[key]);
    return {
      ladd: any('is_ladd'),
      pia: any('is_pia'),
      interesting: any('is_interesting'),
      military: any('is_military') || aircraft?.military === true,
    };
  }, [sourceData, aircraft?.military]);

  const leInfo =
    airframe.ownership_flags && typeof airframe.ownership_flags === 'object'
      ? airframe.ownership_flags.law_enforcement
      : null;
  const shellSuspected = airframe.is_shell_suspected === true;

  const emerg =
    aircraft?.emergency === true || EMERGENCY_SQUAWKS.includes(String(aircraft?.squawk ?? ''));

  // Threat / classification badges, most-urgent first. Each entry renders only
  // when its condition fired, so the rail is empty for an unremarkable target.
  const badges = useMemo(() => {
    const b = [];
    if (emerg) b.push({ key: 'emerg', label: 'EMERGENCY', color: 'var(--danger)', icon: 'zap' });
    if (leInfo)
      b.push({
        key: 'le',
        label: leInfo.category || 'LAW ENFORCEMENT',
        color: 'var(--warn)',
        icon: 'shield',
      });
    if (flags.military)
      b.push({ key: 'mil', label: 'MILITARY', color: 'var(--mil, var(--warn))', icon: 'shield' });
    if (flags.ladd) b.push({ key: 'ladd', label: 'LADD', color: 'var(--dim)', icon: 'eye-off' });
    if (flags.pia) b.push({ key: 'pia', label: 'PIA', color: 'var(--dim)', icon: 'shield-check' });
    if (shellSuspected)
      b.push({ key: 'shell', label: 'SHELL?', color: 'var(--warn)', icon: 'alert-triangle' });
    if (flags.interesting)
      b.push({ key: 'int', label: 'INTERESTING', color: 'var(--accent)', icon: 'star' });
    return b;
  }, [emerg, leInfo, flags, shellSuspected]);

  const turbLevel = String(aircraft?.turbulenceLevel || '').toLowerCase();
  const turb = TURB_META[turbLevel];
  const turbRisk = typeof aircraft?.turbulenceRisk === 'number' ? aircraft.turbulenceRisk : null;

  if (!aircraft) {
    return (
      <aside className="lm-panel lm-panel--empty" data-testid="lm-detail-panel">
        <Icon name="send" size={34} strokeWidth={1.4} style={{ color: 'var(--dim2)' }} />
        <span>Select an aircraft to view details</span>
      </aside>
    );
  }

  const chip = (label, value, extra) => (
    <div className="lm-panel__chip">
      <span className="lm-panel__chip-label">{label}</span>
      <span className="lm-panel__chip-val">
        {extra}
        {value}
      </span>
    </div>
  );

  const num = (v, digits = 0) => (typeof v === 'number' ? v.toFixed(digits) : '--');

  // Full airframe descriptor for the banner subtitle: prefer the human-readable
  // manufacturer + model, fall back to the live stream's `desc`, then type name.
  const subtitle =
    [airframe.manufacturer, airframe.model].filter(Boolean).join(' ') ||
    aircraft.desc ||
    airframe.type_name ||
    '';

  const regFlag = countryCodeToFlag(airframe.country_code);
  const registration = airframe.registration || aircraft.r || '';

  // Airspeed readout — pick the richest available (Mach at altitude, else true /
  // indicated airspeed). Only rendered when the stream carries one.
  const airspeed =
    typeof aircraft.mach === 'number'
      ? { label: 'MACH', val: aircraft.mach.toFixed(2) }
      : typeof aircraft.tas === 'number'
        ? { label: 'TAS', val: `${Math.round(aircraft.tas)}` }
        : typeof aircraft.ias === 'number'
          ? { label: 'IAS', val: `${Math.round(aircraft.ias)}` }
          : null;

  // Secondary telemetry — compact 3-up micro cells, present values only.
  const micro = [
    aircraft.track != null && {
      label: 'HEADING',
      val: `${Math.round(aircraft.track)}°`,
      sub: compassDir(aircraft.track),
    },
    aircraft.bearing != null && {
      label: 'BEARING',
      val: `${Math.round(aircraft.bearing)}°`,
      sub: compassDir(aircraft.bearing),
    },
    airspeed && { label: airspeed.label, val: airspeed.val },
    { label: 'SQUAWK', val: aircraft.squawk || '--', danger: emerg },
    aircraft.rssi != null && { label: 'RSSI', val: `${aircraft.rssi.toFixed(1)}` },
    aircraft.category && { label: 'CAT', val: String(aircraft.category).toUpperCase() },
    aircraft.seen != null && { label: 'AGE', val: `${Math.round(aircraft.seen)}s` },
  ].filter(Boolean);

  // Airframe reference facts (hydrate from the info lookup).
  const builtVal = airframe.year_built || airframe.built || aircraft.year || null;
  const facts = [
    airframe.manufacturer && { label: 'Manufacturer', val: airframe.manufacturer },
    airframe.model && { label: 'Model', val: airframe.model },
    (airframe.serial_number || airframe.msn) && {
      label: 'Serial',
      val: airframe.serial_number || airframe.msn,
    },
    builtVal && {
      label: 'Built',
      val:
        airframe.age_years != null
          ? `${builtVal} · ${airframe.age_years} yr${airframe.age_years === 1 ? '' : 's'}`
          : String(builtVal),
    },
    (airframe.country || airframe.registered_country) && {
      label: 'Country',
      val: airframe.country || airframe.registered_country,
    },
  ].filter(Boolean);

  // Activity counters — free from useDetailData's parallel queries.
  const sightingCount = (sessions.data || []).length;
  const safetyCount = (safety.data || []).length;
  const acarsCount = (acars.data || []).length;
  const counters = [
    { key: 'seen', label: 'SIGHTINGS', val: sightingCount, icon: 'crosshair' },
    {
      key: 'safety',
      label: 'SAFETY 24H',
      val: safetyCount,
      icon: 'alert-triangle',
      color: safetyCount > 0 ? 'var(--warn)' : undefined,
    },
    { key: 'acars', label: 'ACARS', val: acarsCount, icon: 'radio' },
  ];

  return (
    <aside className="lm-panel" data-testid="lm-detail-panel">
      <div
        className="lm-panel__banner"
        style={airframe.photo_url ? { backgroundImage: `url(${airframe.photo_url})` } : undefined}
      >
        <div className="lm-panel__banner-scrim" />
        {emerg && <div className="lm-panel__banner-alarm" aria-hidden="true" />}
        <button
          type="button"
          className="lm-panel__close"
          onClick={onClose}
          aria-label="Close panel"
        >
          <Icon name="x" size={16} strokeWidth={1.9} />
        </button>
        <div className="lm-panel__banner-id">
          <div className="lm-panel__banner-titles">
            <span className="lm-panel__cs">{callsign || (hex || '').toUpperCase()}</span>
            {subtitle && <span className="lm-panel__subtitle">{subtitle}</span>}
          </div>
          <span
            className="lm-panel__cat"
            style={{
              color: catColor,
              background: `color-mix(in srgb, ${catColor} 16%, transparent)`,
            }}
          >
            {cat.toUpperCase()}
          </span>
        </div>
      </div>

      <div className="lm-panel__body">
        <div className="lm-panel__status" style={{ color: status.color }}>
          <span className="lm-panel__status-dot" style={{ background: status.color }} />
          {status.label}
          {aircraft.seen != null && (
            <span className="lm-panel__status-age">· {Math.round(aircraft.seen)}s ago</span>
          )}
        </div>

        {badges.length > 0 && (
          <div className="lm-panel__badges" data-testid="lm-panel-badges">
            {badges.map((b) => (
              <span
                key={b.key}
                className="lm-panel__badge"
                title={b.key === 'le' && leInfo?.description ? leInfo.description : b.label}
                style={{
                  color: b.color,
                  background: `color-mix(in srgb, ${b.color} 15%, transparent)`,
                  borderColor: `color-mix(in srgb, ${b.color} 40%, transparent)`,
                }}
              >
                <Icon name={b.icon} size={11} strokeWidth={1.9} />
                {b.label}
              </span>
            ))}
          </div>
        )}

        {aircraft.ghost && (
          <div
            className="lm-panel__ghost"
            style={{ color: 'var(--dim)' }}
            data-testid="lm-panel-ghost"
          >
            <Icon name="alert-triangle" size={13} strokeWidth={1.7} />
            <span>
              Ghost — non-ICAO (TIS-B/ADS-R) duplicate
              {aircraft.ghost_of ? ` of ${aircraft.ghost_of.toUpperCase()}` : ''}
            </span>
          </div>
        )}

        {turb && (
          <div className="lm-panel__turb" data-testid="lm-panel-turb">
            <div className="lm-panel__turb-head">
              <span className="lm-panel__turb-label">
                <Icon name="wind" size={12} strokeWidth={1.8} style={{ color: turb.color }} />
                TURBULENCE
              </span>
              <span className="lm-panel__turb-level" style={{ color: turb.color }}>
                {turb.label}
                {turbRisk != null ? ` · ${Math.round(turbRisk)}` : ''}
              </span>
            </div>
            <div className="lm-panel__turb-track">
              <div
                className="lm-panel__turb-fill"
                style={{
                  width: `${Math.round((turbRisk != null ? turbRisk / 100 : turb.frac) * 100)}%`,
                  background: turb.color,
                }}
              />
            </div>
          </div>
        )}

        <div className="lm-panel__chips">
          {chip('HEX', (hex || '').toUpperCase())}
          {chip('TYPE', airframe.type_code || airframe.aircraft_type || aircraft.t || '--')}
          {chip('SIZE', airframe.size || '--')}
          {chip(
            'REG',
            registration || '--',
            regFlag ? <span className="lm-panel__reg-flag">{regFlag}</span> : null
          )}
        </div>

        {(airframe.operator || airframe.owner || aircraft.ownOp) && (
          <span className="lm-panel__airline-badge" data-testid="lm-panel-airline">
            {airframe.operator || airframe.owner || aircraft.ownOp}
          </span>
        )}

        {hasRoute(origin, destination) && (
          <>
            <div className="lm-panel__eyebrow">ROUTE</div>
            <FlightRoute
              origin={origin}
              destination={destination}
              position={aircraft}
              flightNumber={routeInfo.flightNumber}
              airline={routeInfo.airline}
              callsign={callsign}
            />
          </>
        )}

        <div className="lm-panel__stats">
          <div className="lm-panel__stat">
            <div className="lm-panel__stat-label">ALTITUDE</div>
            <div className="lm-panel__stat-val">
              {alt.toLocaleString('en-US')}
              <span> ft</span>
            </div>
          </div>
          <div className="lm-panel__stat">
            <div className="lm-panel__stat-label">GROUND SPD</div>
            <div className="lm-panel__stat-val">
              {num(aircraft.gs)}
              <span> kts</span>
            </div>
          </div>
          <div className="lm-panel__stat">
            <div className="lm-panel__stat-label">VERT SPEED</div>
            <div
              className="lm-panel__stat-val"
              style={{
                color:
                  aircraft.vr < 0 ? 'var(--warn)' : aircraft.vr > 0 ? 'var(--accent)' : undefined,
              }}
            >
              {aircraft.vr ?? '--'}
              <span> fpm</span>
            </div>
          </div>
          <div className="lm-panel__stat">
            <div className="lm-panel__stat-label">DISTANCE</div>
            <div className="lm-panel__stat-val">
              {num(aircraft.distance_nm, 1)}
              <span> nm</span>
            </div>
          </div>
        </div>

        {micro.length > 0 && (
          <>
            <div className="lm-panel__eyebrow">TELEMETRY</div>
            <div className="lm-panel__micro">
              {micro.map((m) => (
                <div className="lm-panel__micro-cell" key={m.label}>
                  <span className="lm-panel__micro-label">{m.label}</span>
                  <span
                    className="lm-panel__micro-val"
                    style={m.danger ? { color: 'var(--danger)' } : undefined}
                  >
                    {m.val}
                  </span>
                  {m.sub && <span className="lm-panel__micro-sub">{m.sub}</span>}
                </div>
              ))}
            </div>
          </>
        )}

        {facts.length > 0 && (
          <>
            <div className="lm-panel__eyebrow">AIRFRAME</div>
            <div className="lm-panel__facts">
              {facts.map((f) => (
                <div className="lm-panel__kv" key={f.label}>
                  <span>{f.label}</span>
                  <span className="v2-mono">{f.val}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <button
          type="button"
          className="lm-panel__activity"
          onClick={() => onOpenFull?.(hex)}
          data-testid="lm-panel-activity"
          title="Open full detail"
        >
          {counters.map((c) => (
            <span className="lm-panel__act-cell" key={c.key}>
              <Icon
                name={c.icon}
                size={13}
                strokeWidth={1.8}
                style={{ color: c.color || 'var(--dim2)' }}
              />
              <span className="lm-panel__act-val" style={c.color ? { color: c.color } : undefined}>
                {c.val}
              </span>
              <span className="lm-panel__act-label">{c.label}</span>
            </span>
          ))}
        </button>

        {(altSeries.length > 1 || spdSeries.length > 1) && (
          <>
            <div className="lm-panel__eyebrow">PERFORMANCE</div>
            <div className="lm-panel__spark-grid">
              {altSeries.length > 1 && (
                <div className="lm-panel__spark">
                  <span>Altitude</span>
                  <Sparkline data={altSeries} width={150} height={34} color="var(--accent)" area />
                </div>
              )}
              {spdSeries.length > 1 && (
                <div className="lm-panel__spark">
                  <span>Speed</span>
                  <Sparkline data={spdSeries} width={150} height={34} color="var(--accent2)" area />
                </div>
              )}
            </div>
          </>
        )}

        <button type="button" className="v2-btn lm-panel__full" onClick={() => onOpenFull?.(hex)}>
          <Icon name="external-link" size={14} strokeWidth={1.7} />
          Open full detail
        </button>
      </div>
    </aside>
  );
}
