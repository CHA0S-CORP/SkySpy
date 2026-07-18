import { useMemo } from 'react';
import { useTrackHistory } from '../../../hooks/useTrackHistory';
import { useAviationData } from '../../../hooks/useAviationData';
import { useNotams } from '../../../hooks/useNotams';

/**
 * Assembles Live Map overlay data (trails, navaids, airports, airspace, NOTAMs,
 * TFRs, PIREPs) from the existing data hooks, gated by the overlay toggles so
 * disabled layers don't fetch/compute. Weather radar is a Leaflet WMS tile layer
 * handled in the view (see LiveMapView), not here.
 *
 * @param {object} args
 * @param {Function} args.wsRequest
 * @param {boolean} args.wsConnected
 * @param {{lat:number, lon:number}|null} args.feeder
 * @param {object[]} args.aircraft
 * @param {object} args.overlays
 * @param {number} [args.radarRange]
 */
export function useMapOverlayData({
  wsRequest,
  wsConnected,
  feeder,
  aircraft,
  overlays,
  radarRange = 150,
}) {
  const lat = feeder?.lat ?? 0;
  const lon = feeder?.lon ?? 0;

  // Trails are pure client-side (no backend); only accumulate when enabled.
  // Length is user-configurable (seconds → ms) via the Layers panel.
  const trailMaxAge = (overlays.trailSeconds || 300) * 1000;
  const { trackHistory } = useTrackHistory(overlays.trails ? aircraft : [], lat, lon, trailMaxAge);

  // useAviationData internally only fetches the enabled overlay layers.
  const { aviationData } = useAviationData(wsRequest, wsConnected, lat, lon, radarRange, overlays);

  // useNotams already merges TFRs into its returned list (tagged type 'TFR');
  // only fetch while the overlay is actually on. TFRs and plain NOTAMs share the
  // one "NOTAMs / TFRs" toggle, so gate both on `overlays.notams`.
  const { notams } = useNotams(wsRequest, wsConnected, {
    lat,
    lon,
    radius: radarRange,
    enabled: !!overlays.notams,
  });

  return useMemo(() => {
    // Split the merged NOTAM list so TFRs render with their own (distinct)
    // symbology on the canvas while plain NOTAMs keep the amber marker.
    const allNotams = overlays.notams ? notams || [] : [];
    const tfrs = allNotams.filter((n) => (n?.type || '').toUpperCase() === 'TFR');
    const plainNotams = allNotams.filter((n) => (n?.type || '').toUpperCase() !== 'TFR');
    return {
      trails: overlays.trails ? trackHistory : {},
      navaids: overlays.navaids ? aviationData.navaids || [] : [],
      airports: overlays.airports ? aviationData.airports || [] : [],
      airspaces: overlays.airspace ? aviationData.airspace || [] : [],
      notams: plainNotams,
      tfrs,
      pireps: overlays.pireps ? aviationData.pireps || [] : [],
    };
  }, [overlays, trackHistory, aviationData, notams]);
}
