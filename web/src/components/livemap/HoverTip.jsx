import React from 'react';
import {
  airspaceColor,
  airspaceDescription,
  airspaceLabel,
  normAirspaceClass,
} from './render/symbology';

/**
 * Lightweight hover tooltip for non-aircraft canvas markers (PIREPs, NOTAMs/
 * TFRs, airports, airspaces). Positioned at the hovered marker's container-
 * point; kept on-screen by clamping. The canvas layer feeds `{kind, data, x, y}`
 * via LiveMapView hover callbacks.
 *
 * @param {object} props
 * @param {{kind:'pirep'|'notam'|'airport'|'airspace', data:object, x:number, y:number}|null} props.tip
 */
export function HoverTip({ tip }) {
  if (!tip) return null;
  const style = {
    left: Math.max(8, tip.x + 14),
    top: Math.max(8, tip.y + 14),
  };
  const body = {
    pirep: <PirepBody p={tip.data} />,
    notam: <NotamBody n={tip.data} />,
    airport: <AirportBody a={tip.data} />,
    airspace: <AirspaceBody a={tip.data} />,
  }[tip.kind];
  return (
    <div className="lm__tip" style={style} role="tooltip">
      {body}
    </div>
  );
}

function PirepBody({ p }) {
  const raw = p.raw_text || p.rawOb || p.raw || '';
  const fl = p.flight_level ?? p.fltLvl;
  const altFt = p.altitude_ft;
  const alt =
    fl != null && !isNaN(fl)
      ? `FL${fl}`
      : altFt != null && !isNaN(altFt)
        ? `${Number(altFt).toLocaleString()}ft`
        : null;
  const type = p.aircraft_ref || p.acType || p.aircraft_type || null;
  const hazards = [];
  if (p.turbulence) hazards.push(`TURB ${String(p.turbulence).toUpperCase()}`);
  if (p.icing) hazards.push(`ICE ${String(p.icing).toUpperCase()}`);
  const urgent = (p.report_type || '').toUpperCase() === 'UUA';
  return (
    <>
      <div className="lm__tip-head">
        <span className="lm__tip-badge">{urgent ? 'URGENT PIREP' : 'PIREP'}</span>
        {alt && <span className="lm__tip-alt">{alt}</span>}
      </div>
      {type && <div className="lm__tip-sub">{type}</div>}
      {hazards.length > 0 && <div className="lm__tip-haz">{hazards.join(' · ')}</div>}
      {raw && <div className="lm__tip-raw">{raw}</div>}
    </>
  );
}

function NotamBody({ n }) {
  const isTfr = (n.type || '').toUpperCase() === 'TFR';
  const text = n.text || n.summary || n.description || '';
  return (
    <>
      <div className="lm__tip-head">
        <span className={`lm__tip-badge${isTfr ? ' lm__tip-badge--tfr' : ''}`}>
          {isTfr ? 'TFR' : `NOTAM ${n.type || ''}`.trim()}
        </span>
        {n.notam_id && <span className="lm__tip-alt">{n.notam_id}</span>}
      </div>
      {n.name && <div className="lm__tip-sub">{n.name}</div>}
      {text && (
        <div className="lm__tip-raw">{text.length > 240 ? `${text.slice(0, 240)}…` : text}</div>
      )}
    </>
  );
}

function AirportBody({ a }) {
  const ident = a.icao || a.ident || a.iata || a.id || '';
  const elev = a.elev ?? a.elev_ft ?? a.elevation ?? a.elevation_ft;
  const type = a.airspaceClass || a.class || a.type || null;
  return (
    <>
      <div className="lm__tip-head">
        <span className="lm__tip-badge">{ident || 'AIRPORT'}</span>
        {elev != null && <span className="lm__tip-alt">{Number(elev).toLocaleString()} ft</span>}
      </div>
      {a.name && <div className="lm__tip-sub">{a.name}</div>}
      {(a.city || a.state) && (
        <div className="lm__tip-raw">{[a.city, a.state].filter(Boolean).join(', ')}</div>
      )}
      {type && <div className="lm__tip-raw">{type}</div>}
    </>
  );
}

function AirspaceBody({ a }) {
  const cls = normAirspaceClass(a.class ?? a.airspace_class);
  const floor = a.floor ?? a.floor_ft;
  const ceil = a.ceiling ?? a.ceiling_ft;
  const fmt = (v) => (v == null ? null : v <= 0 ? 'SFC' : `${Number(v).toLocaleString()} ft`);
  const band = floor != null || ceil != null ? `${fmt(floor) ?? '—'} → ${fmt(ceil) ?? '—'}` : null;
  const ident = a.icao || a.ident || null;
  const agency = a.controlling_agency || a.controllingAgency || null;
  const schedule = a.schedule || a.hours || null;
  const desc = airspaceDescription(cls);
  const subline = [a.name, ident && ident !== a.name ? ident : null].filter(Boolean).join(' · ');
  return (
    <>
      <div className="lm__tip-head">
        <span className="lm__tip-badge" style={{ color: airspaceColor(cls) }}>
          {airspaceLabel(cls)}
        </span>
        {band && <span className="lm__tip-alt">{band}</span>}
      </div>
      {subline && <div className="lm__tip-sub">{subline}</div>}
      {desc && <div className="lm__tip-raw">{desc}</div>}
      {agency && <div className="lm__tip-raw">Controlled by {agency}</div>}
      {schedule && <div className="lm__tip-raw">Active {schedule}</div>}
    </>
  );
}

export default HoverTip;
