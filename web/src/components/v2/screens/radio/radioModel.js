/**
 * Pure model for the v2 Radio screen. Maps AudioTransmission API records
 * (channel_name, frequency_mhz, duration_seconds, transcription_status,
 * transcript, s3_url, …) onto the design's row shape.
 */

const EMERGENCY_RE = /\b(mayday|pan[- ]pan|emergency|7500|7600|7700|souls on board)\b/i;

/** @param {object} t transmission */
export function isEmergency(t) {
  return EMERGENCY_RE.test(t.transcript || '') || t.metadata?.emergency === true;
}

/** Transcription status → display pill. */
export function statusOf(t) {
  const s = t.transcription_status;
  if (s === 'completed') return 'Transcribed';
  if (s === 'failed') return 'Failed';
  return 'Pending'; // pending | queued | processing
}

/** Extract a leading callsign from the transcript or identified airframes. */
export function callsignOf(t) {
  const identified = t.identified_airframes;
  if (Array.isArray(identified) && identified.length) {
    const first = identified[0];
    const cs = typeof first === 'string' ? first : first?.callsign || first?.flight;
    if (cs) return String(cs).trim().toUpperCase();
  }
  const m = (t.transcript || '').match(
    /^([A-Z][A-Za-z]{1,3}[- ]?\d{1,4}[A-Z]{0,2}|N\d{1,5}[A-Z]{0,2})\b/
  );
  return m ? m[1].replace(/[- ]/g, '').toUpperCase() : null;
}

/** Find the live aircraft matching a transmission callsign, if any. */
export function matchAircraft(cs, aircraft) {
  if (!cs) return null;
  return aircraft.find((a) => (a.flight || '').trim().toUpperCase() === cs) || null;
}

export function fmtFreq(mhz) {
  return typeof mhz === 'number' ? `${mhz.toFixed(3)} MHz` : '—';
}

export function fmtDur(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtSize(bytes) {
  if (typeof bytes !== 'number') return '—';
  return bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;
}

export function audioUrlOf(t) {
  // Default (non-S3) deployments store audio locally: s3_url is null and the
  // serializer carries only `filename`, served at /api/v1/audio/file/{name}
  if (t.s3_url) return t.s3_url;
  if (t.audio_url) return t.audio_url;
  if (t.filename) return `/api/v1/audio/file/${encodeURIComponent(t.filename)}`;
  return null;
}

/**
 * Deterministic waveform heights (mock waveArr) seeded per transmission
 * so bars are stable across re-renders.
 * @param {number} seed
 * @param {number} n
 */
export function waveHeights(seed, n) {
  const out = [];
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 9301 + 49297) % 233280;
    const r = x / 233280;
    out.push(Math.round(18 + Math.abs(Math.sin(i / 3 + seed)) * 60 * (0.5 + r * 0.5)));
  }
  return out;
}

/**
 * Filter + search the transmissions list (mock semantics).
 * @param {object[]} transmissions
 * @param {{query?: string, status?: string, channel?: string, emergency?: boolean}} f
 */
export function selectTransmissions(
  transmissions,
  { query = '', status = 'All Status', channel = 'All Channels', emergency = false } = {}
) {
  let list = transmissions.slice();
  const q = query.trim().toLowerCase();
  if (q) {
    list = list.filter((t) =>
      `${t.channel_name || ''} ${t.frequency_mhz || ''} ${t.transcript || ''}`
        .toLowerCase()
        .includes(q)
    );
  }
  if (status !== 'All Status') list = list.filter((t) => statusOf(t) === status);
  if (channel !== 'All Channels') list = list.filter((t) => t.channel_name === channel);
  if (emergency) list = list.filter(isEmergency);
  return list;
}

/** Stats for the top strip. */
export function radioStats(transmissions) {
  const total = transmissions.length;
  const transcribed = transmissions.filter((t) => statusOf(t) === 'Transcribed').length;
  const pending = transmissions.filter((t) => statusOf(t) === 'Pending').length;
  const seconds = transmissions.reduce((acc, t) => acc + (t.duration_seconds || 0), 0);
  const totalDur =
    seconds >= 3600 ? `${(seconds / 3600).toFixed(1)}h` : `${Math.round(seconds / 60)}m`;
  return { total, transcribed, pending, totalDur };
}
