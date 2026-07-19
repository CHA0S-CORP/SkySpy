import { useMemo } from 'react';

import { useApi } from './useApi';

/**
 * Poll the backend turbulence assessment for a single point (lat/lon/alt).
 *
 * Backs both the airframe detail turbulence card (aircraft position) and the
 * weather screen's "sector" readout (receiver position). Returns the raw
 * assessment plus a couple of derived conveniences.
 *
 * @param {object} opts
 * @param {number|null} opts.lat
 * @param {number|null} opts.lon
 * @param {number|null} [opts.altitudeFt]
 * @param {boolean} [opts.enabled=true]
 * @param {number} [opts.interval=90000]
 * @param {string} [opts.apiBase='']
 * @returns {{ assessment: object|null, loading: boolean, error: (Error|null),
 *   level: string, score: number, gairmet: object[], pireps: object[], winds: object|null }}
 */
export function usePointTurbulence({
  lat,
  lon,
  altitudeFt = null,
  enabled = true,
  interval = 90000,
  apiBase = '',
  feederDefault = false,
} = {}) {
  const hasPoint = typeof lat === 'number' && typeof lon === 'number';
  // With no point and feederDefault, hit the param-less endpoint — the backend
  // assesses the receiver location (handy when the frontend feeder coords are
  // stripped, e.g. anonymous sessions).
  const endpoint = hasPoint
    ? `/api/v1/aviation/turbulence?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}` +
      (altitudeFt != null ? `&alt=${Math.round(altitudeFt)}` : '')
    : '/api/v1/aviation/turbulence';

  const shouldPoll = enabled && (hasPoint || feederDefault);
  const { data, loading, error } = useApi(endpoint, shouldPoll ? interval : null, apiBase);

  return useMemo(() => {
    const assessment = data && typeof data.score === 'number' ? data : null;
    const sources = assessment?.sources || {};
    return {
      assessment,
      loading,
      error,
      level: assessment?.level || 'none',
      score: assessment?.score ?? 0,
      gairmet: Array.isArray(sources.gairmet) ? sources.gairmet : [],
      pireps: Array.isArray(sources.pireps) ? sources.pireps : [],
      winds: sources.winds || null,
    };
  }, [data, loading, error]);
}

/** Shared colour + label vocabulary for a turbulence level. */
export const TURB_LEVEL_META = {
  none: { label: 'Smooth', color: 'var(--dim)', rank: 0 },
  light: { label: 'Light', color: 'var(--accent2)', rank: 1 },
  moderate: { label: 'Moderate', color: 'var(--warn)', rank: 2 },
  severe: { label: 'Severe', color: 'var(--danger)', rank: 3 },
};

export function turbLevelMeta(level) {
  return TURB_LEVEL_META[level] || TURB_LEVEL_META.none;
}
