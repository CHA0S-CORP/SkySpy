import { useMemo } from 'react';
import { useTrackHistory } from '../../../hooks/useTrackHistory';
import { useAviationData } from '../../../hooks/useAviationData';
import { useNotams } from '../../../hooks/useNotams';

/**
 * Assembles Live Map overlay data (trails, navaids, airports, airspace, NOTAMs)
 * from the existing data hooks, gated by the overlay toggles so disabled layers
 * don't fetch/compute. Weather radar is a Leaflet WMS tile layer handled in the
 * view (see LiveMapView), not here.
 *
 * @param {object} args
 * @param {Function} args.wsRequest
 * @param {boolean} args.wsConnected
 * @param {{lat:number, lon:number}|null} args.feeder
 * @param {object[]} args.aircraft
 * @param {object} args.overlays
 * @param {number} [args.radarRange]
 */
export function useMapOverlayData({ wsRequest, wsConnected, feeder, aircraft, overlays, radarRange = 150 }) {
  const lat = feeder?.lat ?? 0;
  const lon = feeder?.lon ?? 0;

  // Trails are pure client-side (no backend); only accumulate when enabled.
  const { trackHistory } = useTrackHistory(overlays.trails ? aircraft : [], lat, lon);

  // useAviationData internally only fetches the enabled overlay layers.
  const { aviationData } = useAviationData(wsRequest, wsConnected, lat, lon, radarRange, overlays);

  // useNotams already merges TFRs into its returned list (tagged type 'TFR');
  // only fetch while the overlay is actually on.
  const { notams } = useNotams(wsRequest, wsConnected, {
    lat,
    lon,
    radius: radarRange,
    enabled: !!overlays.notams,
  });

  return useMemo(
    () => ({
      trails: overlays.trails ? trackHistory : {},
      navaids: overlays.navaids ? aviationData.navaids || [] : [],
      airports: overlays.airports ? aviationData.airports || [] : [],
      airspaces: overlays.airspace ? aviationData.airspace || [] : [],
      notams: overlays.notams ? notams || [] : [],
    }),
    [overlays, trackHistory, aviationData, notams]
  );
}
