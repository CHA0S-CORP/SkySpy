import React from 'react';
import { Icon } from '../../primitives';

/**
 * Extract origin/destination + flight identity from a /lookup/route response
 * (flat or nested under `.route`).
 */
export function parseRoute(routeData) {
  const inner =
    routeData?.route && typeof routeData.route === 'object' ? routeData.route : routeData || {};
  return {
    origin: inner.origin || routeData?.origin,
    destination: inner.destination || routeData?.destination,
    flightNumber: inner.flight_number || inner.number || null,
    airline: inner.airline_code || null,
    callsign: routeData?.callsign || inner.callsign || null,
  };
}

const codeOf = (a) => a?.iata || a?.icao || (typeof a === 'string' ? a : '') || '--';
const cityOf = (a) => a?.city || a?.name || '';
const normCode = (a) =>
  (a?.iata || a?.icao || (typeof a === 'string' ? a : '') || '').toUpperCase().trim();

/**
 * True only for a usable route: both ends present AND different airports.
 * Lookups often return the same field for origin/destination on local/orbiting
 * flights (SEA → SEA), which reads as broken — treat those as "no route".
 */
export function hasRoute(origin, destination) {
  const o = normCode(origin);
  const d = normCode(destination);
  return Boolean(o && d && o !== d);
}

/** FlightAware airport page for an airport brief (ICAO preferred). */
function airportUrl(a) {
  const c = a?.icao || a?.iata;
  return c ? `https://www.flightaware.com/live/airport/${c}` : null;
}

function distanceNm(a, b) {
  const R = 3440.065; // nautical miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Great-circle progress of `position` along origin → destination.
 * @returns {{pct:number, remainingNm:number, totalNm:number}|null}
 */
export function routeProgress(origin, destination, position) {
  const pts = [origin, destination, position];
  if (pts.some((p) => !p || typeof p.lat !== 'number' || typeof p.lon !== 'number')) return null;
  const total = distanceNm(origin, destination);
  if (total <= 0) return null;
  const flown = distanceNm(origin, position);
  const pct = Math.max(0, Math.min(100, (flown / total) * 100));
  return { pct, remainingNm: Math.max(0, total - flown), totalNm: total };
}

/** Airport code — a link to the airport page when a code is known. */
function AirportCode({ airport }) {
  const code = codeOf(airport);
  const url = airportUrl(airport);
  if (!url) return <div className="v2-det__route-code">{code}</div>;
  return (
    <a
      className="v2-det__route-code v2-det__route-code--link"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`${airport.name || code} — open airport`}
    >
      {code}
    </a>
  );
}

/** Origin → destination row: linked codes + cities + progress/connector line. */
export function RouteRow({ origin, destination, position }) {
  const prog = routeProgress(origin, destination, position);
  return (
    <div className="v2-det__route">
      <div>
        <AirportCode airport={origin} />
        <div className="v2-det__route-city">{cityOf(origin)}</div>
      </div>
      <div className="v2-det__route-line">
        {prog ? (
          <div className="v2-det__route-prog" aria-label={`${Math.round(prog.pct)}% complete`}>
            <div className="v2-det__route-prog-fill" style={{ width: `${prog.pct}%` }} />
            <span className="v2-det__route-prog-plane" style={{ left: `${prog.pct}%` }}>
              <Icon name="route-marker" size={14} style={{ color: 'var(--accent)' }} />
            </span>
          </div>
        ) : (
          <>
            <span />
            <Icon name="route-marker" size={15} style={{ color: 'var(--accent)' }} />
            <span />
          </>
        )}
      </div>
      <div style={{ textAlign: 'right' }}>
        <AirportCode airport={destination} />
        <div className="v2-det__route-city">{cityOf(destination)}</div>
      </div>
    </div>
  );
}

/**
 * Full Flight Route card: flight number, linked origin/destination airports,
 * and live progress toward the destination.
 *
 * @param {object} props
 * @param {object} props.origin - origin airport brief (iata/icao/city/lat/lon)
 * @param {object} props.destination - destination airport brief
 * @param {{lat:number, lon:number}} [props.position] - current aircraft position (for progress)
 * @param {string} [props.flightNumber]
 * @param {string} [props.airline] - airline ICAO code
 * @param {string} [props.callsign] - fallback flight label
 */
export function FlightRoute({ origin, destination, position, flightNumber, airline, callsign }) {
  if (!hasRoute(origin, destination)) return null;
  const prog = routeProgress(origin, destination, position);
  const flightLabel = [airline, flightNumber].filter(Boolean).join(' ') || callsign || '';
  return (
    <div className="v2-det__card v2-det__card--pad">
      <div className="v2-det__card-head v2-det__card-head--bare">
        <Icon name="map-pin" size={15} strokeWidth={1.7} style={{ color: 'var(--accent)' }} />
        <span>Flight Route</span>
        {flightLabel && <span className="v2-det__route-flight">{flightLabel}</span>}
      </div>
      <RouteRow origin={origin} destination={destination} position={position} />
      {prog && (
        <div className="v2-det__route-meta">
          <span>{Math.round(prog.pct)}% complete</span>
          <span>{Math.round(prog.remainingNm).toLocaleString('en-US')} nm to go</span>
        </div>
      )}
    </div>
  );
}

/** Compact one-line route summary (LAX → PHX) for headers / tight spaces. */
export function RouteSummary({ origin, destination }) {
  if (!hasRoute(origin, destination)) return null;
  return (
    <span className="v2-det__route-mini" title={`${cityOf(origin)} → ${cityOf(destination)}`}>
      <span className="v2-det__route-mini-code">{codeOf(origin)}</span>
      <Icon name="send" size={12} strokeWidth={1.8} style={{ color: 'var(--accent)' }} />
      <span className="v2-det__route-mini-code">{codeOf(destination)}</span>
    </span>
  );
}
