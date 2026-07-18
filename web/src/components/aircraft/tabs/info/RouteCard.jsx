import React from 'react';
// lucide-react 0.263.1 has no `Route` icon; Milestone is the closest route/signpost glyph.
import { Milestone as Route, ArrowRight } from 'lucide-react';
import { BentoCard } from '../../../ui/bento-card';
import { InfoRow } from './InfoRow';

/**
 * Format an airport object into a short "CODE — Name" style label.
 */
function airportLabel(ap) {
  if (!ap) return null;
  const code = ap.iata || ap.icao;
  const place = ap.name || ap.city;
  if (code && place) return `${place} (${code})`;
  return place || code || null;
}

/**
 * RouteCard - Origin → destination airports for the aircraft's current flight.
 * Data is resolved server-side from the callsign (adsb.im / adsbdb / hexdb) and
 * stored on AircraftInfo, arriving here as the `route` object.
 */
function RouteCard({ data }) {
  const route = data?.route;
  const origin = route?.origin;
  const destination = route?.destination;

  // Need at least both endpoint codes to show a meaningful route.
  const originCode = origin?.iata || origin?.icao;
  const destCode = destination?.iata || destination?.icao;
  if (!originCode || !destCode) return null;

  const flightNo = route.flight_number || route.callsign;

  return (
    <BentoCard icon={Route} title="Route" aria-labelledby="route-heading">
      <div className="flex items-center justify-center gap-3 py-2 text-lg font-semibold tracking-tight">
        <span className="font-mono">{originCode}</span>
        <ArrowRight className="h-4 w-4 opacity-60" aria-hidden="true" />
        <span className="font-mono">{destCode}</span>
      </div>
      <div className="space-y-1">
        <InfoRow label="From" value={airportLabel(origin)} />
        <InfoRow label="To" value={airportLabel(destination)} />
        {route.airline_code && <InfoRow label="Airline" value={route.airline_code} mono />}
        {flightNo && <InfoRow label="Flight" value={flightNo} mono />}
      </div>
    </BentoCard>
  );
}

export { RouteCard };
