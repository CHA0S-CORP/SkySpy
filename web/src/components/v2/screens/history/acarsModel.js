/**
 * ACARS message classification for the History → ACARS tab.
 *
 * The backend AcarsMessage serializer gives us { label, text, decoded, callsign,
 * airline{icao,iata,name}, label_info{name,description} } but no "group". We
 * derive the display group (color stripe + badge) and a human label tooltip
 * here, matching the handoff prototype (History.dc.html GMETA/LABELDEC).
 */

/** Group → display metadata (name + CSS color). */
export const ACARS_GROUPS = {
  position: { name: 'Position', color: 'var(--accent2)' },
  weather: { name: 'Weather', color: 'var(--warn)' },
  performance: { name: 'Performance', color: 'var(--accent)' },
  engine: { name: 'Engine', color: 'var(--mil)' },
  ops: { name: 'Ops / OOOI', color: 'color-mix(in srgb, var(--accent2) 45%, var(--mil))' },
  text: { name: 'Free text', color: 'var(--dim)' },
  data: { name: 'Data', color: 'var(--dim2)' },
};

export const ACARS_GROUP_ORDER = [
  'position',
  'weather',
  'performance',
  'engine',
  'ops',
  'text',
  'data',
];

/** Raw ACARS label → plain-English meaning (tooltip). */
const LABEL_DECODE = {
  H1: 'Free text (flight deck)',
  10: 'Progress report',
  11: 'Progress report',
  12: 'ATIS service',
  13: 'Free text / telex',
  14: 'Telex',
  20: 'Position report',
  21: 'Position report',
  44: 'Weather (METAR/TAF)',
  80: 'Miscellaneous / performance',
  81: 'Miscellaneous / performance',
  82: 'Engine report',
  83: 'DFDR data',
  '5Z': 'Airline downlink (company)',
  B6: 'Departure (OOOI)',
  B9: 'Arrival (OOOI)',
  SA: 'Media advisory (link mgmt)',
  Q0: 'Link test',
  _d: 'No message text',
};

/** Callsign ICAO prefix → airline name (fallback when the API omits it). */
const AIRLINES = {
  UAE: 'Emirates',
  UAL: 'United',
  NKS: 'Spirit',
  AFR: 'Air France',
  AAL: 'American',
  ANA: 'All Nippon',
  SIA: 'Singapore',
  ASA: 'Alaska',
  ACA: 'Air Canada',
  QFA: 'Qantas',
  DAL: 'Delta',
  BAW: 'British Airways',
  KLM: 'KLM',
  SWA: 'Southwest',
  UPS: 'UPS',
  JBU: 'JetBlue',
  FDX: 'FedEx',
  DLH: 'Lufthansa',
  SWR: 'Swiss',
  RYR: 'Ryanair',
  EZY: 'easyJet',
  WJA: 'WestJet',
  JZA: 'Jazz',
  AAY: 'Allegiant',
  FFT: 'Frontier',
  SKW: 'SkyWest',
};

/** Default group per label when the body gives no stronger signal. */
const LABEL_GROUP = {
  H1: ['text', 'TXT'],
  10: ['position', 'PROG'],
  11: ['position', 'PROG'],
  12: ['weather', 'ATIS'],
  13: ['text', 'TXT'],
  14: ['text', 'TXT'],
  20: ['position', 'POS'],
  21: ['position', 'POS'],
  44: ['weather', 'WX'],
  80: ['engine', 'ENG'],
  81: ['performance', 'PERF'],
  82: ['engine', 'EGT'],
  83: ['data', 'DFDR'],
  '5Z': ['ops', 'OPS'],
  B6: ['ops', 'OUT'],
  B9: ['ops', 'IN'],
  SA: ['data', 'LINK'],
  Q0: ['data', 'LINK'],
  _d: ['data', 'LINK'],
};

const OOOI_BADGE = { OUT: 'OUT', OFF: 'OFF', ON: 'ON', IN: 'IN' };

/**
 * Classify one ACARS message into a display group + badge.
 * Body keywords win over the label so a label-44 SPECI reads "SPECI", not "WX".
 */
export function classifyAcars(msg) {
  const label = (msg.label || '').toUpperCase();
  const text = (msg.text || msg.decoded_text || '').toString();
  const up = text.toUpperCase();
  const empty = !text.trim();

  if (empty) return { group: 'data', badge: LABEL_GROUP[label]?.[1] || 'LINK' };

  // Weather uplinks
  if (/\bSPECI\b/.test(up)) return { group: 'weather', badge: 'SPECI' };
  if (/\bMETAR\b/.test(up)) return { group: 'weather', badge: 'METAR' };
  if (/\bTAF\b/.test(up)) return { group: 'weather', badge: 'TAF' };
  if (/\bATIS\b/.test(up)) return { group: 'weather', badge: 'ATIS' };

  // OOOI events — match a leading state word (OUT WSSS…, OFF KLAS…)
  const firstWord = up.split(/[\s/]+/)[0];
  if (OOOI_BADGE[firstWord]) return { group: 'ops', badge: OOOI_BADGE[firstWord] };
  if (/\bGATE\b|\bBLOCK/.test(up) && /\b(ARR|DEP|OUT|IN)\b/.test(up))
    return { group: 'ops', badge: 'OOOI' };

  // Performance / engine
  if (/\bPERF\//.test(up) || /\bGW\d|\bCG\d/.test(up))
    return { group: 'performance', badge: 'PERF' };
  if (/\bEGT\b|\bOIL\b|\bVIB\b/.test(up)) return { group: 'engine', badge: 'EGT' };
  if (/\bENG\b|\bN1\b|\bN2\b|\bFF\b/.test(up)) return { group: 'engine', badge: 'ENG' };
  if (/\bDFDR\b/.test(up)) return { group: 'data', badge: 'DFDR' };

  // Position / progress
  if (/\bPROGRESS\b|\bETA\b.*\bFOB\b|\bNEXT WPT\b/.test(up))
    return { group: 'position', badge: 'PROG' };
  if (/\bLAT\b\s*[NS]?[\d.]|\bPOS\b|\bPOSITION\b|N\d{2,}.*W\d{2,}/.test(up))
    return { group: 'position', badge: 'POS' };

  // Free text
  if (/(FROM|TO)\s+CREW|RIDE REPORT|\bTURB\b|\bREQ\b/.test(up))
    return { group: 'text', badge: 'TXT' };

  const [group, badge] = LABEL_GROUP[label] || ['data', 'DATA'];
  return { group, badge };
}

/** Human meaning of a raw label for the hover tooltip. */
export function decodeLabel(label) {
  const l = (label || '').toUpperCase();
  return LABEL_DECODE[l] || 'ACARS label';
}

/** Airline name for a message — prefer the API value, fall back to prefix map. */
export function acarsAirline(msg) {
  const apiName = msg.airline?.name;
  if (apiName) return apiName;
  const cs = (msg.callsign || '').trim().toUpperCase();
  return AIRLINES[cs.slice(0, 3)] || 'Unknown';
}

/** Display callsign / identifier for a message. */
export function acarsCallsign(msg) {
  return (msg.callsign || msg.registration || msg.icao_hex || 'ACARS').toString().trim();
}

/** Best raw body text for a message. */
export function acarsText(msg) {
  return (msg.text || msg.formatted_text || msg.decoded_text || '').toString().trim();
}

/**
 * Build the filter-chip descriptors (All + one per group) with live counts.
 * @param {object[]} messages classified rows (must carry `.group`)
 * @param {string} active current group key or 'all'
 */
export function acarsChips(messages, active) {
  const counts = {};
  for (const m of messages) counts[m.group] = (counts[m.group] || 0) + 1;
  const chips = [{ key: 'all', label: 'All', count: messages.length, color: 'var(--accent2)' }];
  for (const key of ACARS_GROUP_ORDER) {
    chips.push({
      key,
      label: ACARS_GROUPS[key].name,
      count: counts[key] || 0,
      color: ACARS_GROUPS[key].color,
    });
  }
  return chips.map((c) => ({ ...c, on: c.key === active }));
}
