/**
 * Navigation App Integration Utilities
 *
 * Provides integration with external mapping and navigation apps:
 * - Google Maps
 * - Apple Maps
 * - Waze
 * - Web Share API
 * - Clipboard
 */

/**
 * Escape XML special characters to prevent XML injection
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeXml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Detect if running on iOS
 */
export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

/**
 * Detect if running on Android
 */
export function isAndroid() {
  return /Android/.test(navigator.userAgent);
}

/**
 * Open location in Google Maps
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {string} label - Optional label for the location
 */
export function openInGoogleMaps(lat, lon, label = '') {
  const encodedLabel = encodeURIComponent(label);
  const url = label
    ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}&query_place_id=${encodedLabel}`
    : `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
  window.open(url, '_blank');
}

/**
 * Open location in Apple Maps (iOS only, falls back to web)
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {string} label - Optional label
 */
export function openInAppleMaps(lat, lon, label = '') {
  const encodedLabel = encodeURIComponent(label);
  const url = `https://maps.apple.com/?ll=${lat},${lon}&q=${encodedLabel || lat + ',' + lon}`;
  window.open(url, '_blank');
}

/**
 * Open location in Waze
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 */
export function openInWaze(lat, lon) {
  const url = `https://www.waze.com/ul?ll=${lat},${lon}&navigate=yes`;
  window.open(url, '_blank');
}

/**
 * Get best map app for current platform
 */
export function getPreferredMapApp() {
  if (isIOS()) return 'apple';
  return 'google';
}

/**
 * Open location in preferred/specified map app
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {string} app - App name: 'google', 'apple', 'waze'
 * @param {string} label - Optional label
 */
export function openInMaps(lat, lon, app = 'auto', label = '') {
  const targetApp = app === 'auto' ? getPreferredMapApp() : app;

  switch (targetApp) {
    case 'apple':
      openInAppleMaps(lat, lon, label);
      break;
    case 'waze':
      openInWaze(lat, lon);
      break;
    case 'google':
    default:
      openInGoogleMaps(lat, lon, label);
  }
}

/**
 * Copy coordinates to clipboard
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {string} format - Format: 'decimal', 'dms', 'both'
 */
export async function copyCoordinates(lat, lon, format = 'decimal') {
  let text;

  if (format === 'dms') {
    text = `${toDMS(lat, 'lat')}, ${toDMS(lon, 'lon')}`;
  } else if (format === 'both') {
    text = `${lat.toFixed(6)}, ${lon.toFixed(6)}\n${toDMS(lat, 'lat')}, ${toDMS(lon, 'lon')}`;
  } else {
    text = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Failed to copy:', err);
    return false;
  }
}

/**
 * Convert decimal degrees to DMS format
 * @param {number} decimal - Decimal degrees
 * @param {string} type - 'lat' or 'lon'
 */
function toDMS(decimal, type) {
  const absolute = Math.abs(decimal);
  const degrees = Math.floor(absolute);
  const minutesNotTruncated = (absolute - degrees) * 60;
  const minutes = Math.floor(minutesNotTruncated);
  const seconds = ((minutesNotTruncated - minutes) * 60).toFixed(2);

  let direction;
  if (type === 'lat') {
    direction = decimal >= 0 ? 'N' : 'S';
  } else {
    direction = decimal >= 0 ? 'E' : 'W';
  }

  return `${degrees}°${minutes}'${seconds}"${direction}`;
}

/**
 * Share threat location via Web Share API
 * @param {Object} threat - Threat object with lat, lon, callsign, etc.
 */
export async function shareThreatLocation(threat) {
  const title = `Aircraft Location: ${threat.callsign || threat.hex || 'Unknown'}`;
  const text = `${threat.category || 'Aircraft'} at ${threat.distance_nm?.toFixed(1) || '--'} nm
Position: ${threat.lat?.toFixed(4)}, ${threat.lon?.toFixed(4)}
Altitude: ${threat.altitude?.toLocaleString() || '--'} ft
Direction: ${threat.direction || '--'}`;

  const url = `https://www.google.com/maps/search/?api=1&query=${threat.lat},${threat.lon}`;

  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return true;
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Share failed:', err);
      }
      return false;
    }
  } else {
    // Fallback to clipboard
    await navigator.clipboard.writeText(`${title}\n${text}\n${url}`);
    return true;
  }
}

/**
 * Share session summary
 * @param {Object} stats - Session statistics
 * @param {Array} history - Encounter history
 */
export async function shareSessionSummary(stats, history = []) {
  const title = 'Cannonball Session Summary';
  const text = `Session Summary:
• ${stats.totalEncounters || 0} total encounters
• ${stats.lawEnforcementCount || 0} law enforcement
• ${stats.helicopterCount || 0} helicopters
• Closest approach: ${stats.closestApproach?.distance?.toFixed(1) || '--'} nm

Top encounters:
${history.slice(0, 5).map(e =>
  `- ${e.category || 'Aircraft'}${e.callsign ? ` (${e.callsign})` : ''}: ${e.closest_distance?.toFixed(1) || e.distance_nm?.toFixed(1)} nm`
).join('\n')}`;

  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return true;
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Share failed:', err);
      }
      return false;
    }
  } else {
    await navigator.clipboard.writeText(`${title}\n${text}`);
    return true;
  }
}

/**
 * Export session data as GPX (GPS Exchange Format)
 * @param {Array} history - Encounter history with lat/lon
 * @param {string} sessionName - Session name
 */
export function exportToGPX(history, sessionName = 'Cannonball Session') {
  const waypoints = history
    .filter(e => e.lat && e.lon)
    .map(e => {
      const time = new Date(e.first_seen || e.timestamp).toISOString();
      const name = escapeXml(e.callsign || e.hex || 'Unknown');
      const category = escapeXml(e.category || 'Aircraft');
      const distance = e.closest_distance?.toFixed(1) || e.distance_nm?.toFixed(1) || 'N/A';
      return `  <wpt lat="${e.lat}" lon="${e.lon}">
    <time>${time}</time>
    <name>${name}</name>
    <desc>${category} - ${distance} nm</desc>
  </wpt>`;
    })
    .join('\n');

  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="SkySpy Cannonball Mode"
  xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(sessionName)}</name>
    <time>${new Date().toISOString()}</time>
  </metadata>
${waypoints}
</gpx>`;

  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cannonball-${new Date().toISOString().split('T')[0]}.gpx`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Export session data as KML (for Google Earth)
 * @param {Array} history - Encounter history
 * @param {string} sessionName - Session name
 */
export function exportToKML(history, sessionName = 'Cannonball Session') {
  const placemarks = history
    .filter(e => e.lat && e.lon)
    .map(e => {
      const color = e.threat_level === 'critical' ? 'ff0000ff' :
                    e.threat_level === 'warning' ? 'ff00a5ff' : 'ff00ff00';
      const name = escapeXml(e.callsign || e.hex || 'Unknown');
      const category = escapeXml(e.category || 'Aircraft');
      const distance = e.closest_distance?.toFixed(1) || e.distance_nm?.toFixed(1) || 'N/A';
      return `    <Placemark>
      <name>${name}</name>
      <description>${category} - ${distance} nm</description>
      <Style>
        <IconStyle><color>${color}</color></IconStyle>
      </Style>
      <Point>
        <coordinates>${e.lon},${e.lat},${e.altitude || 0}</coordinates>
      </Point>
    </Placemark>`;
    })
    .join('\n');

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(sessionName)}</name>
${placemarks}
  </Document>
</kml>`;

  const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cannonball-${new Date().toISOString().split('T')[0]}.kml`;
  a.click();
  URL.revokeObjectURL(url);
}

export default {
  isIOS,
  isAndroid,
  openInGoogleMaps,
  openInAppleMaps,
  openInWaze,
  openInMaps,
  copyCoordinates,
  shareThreatLocation,
  shareSessionSummary,
  exportToGPX,
  exportToKML,
};
