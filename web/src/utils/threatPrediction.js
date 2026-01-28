/**
 * Threat Prediction Utilities
 *
 * Calculates:
 * - Estimated time to closest approach (ETA)
 * - Closing speed (relative velocity)
 * - Predicted positions
 * - Intercept warnings
 * - Circling/surveillance behavior detection
 */

/**
 * Calculate closing speed between user and aircraft
 * @param {Object} userPos - User position {lat, lon}
 * @param {Object} userPrevPos - Previous user position
 * @param {Object} threat - Threat with lat, lon, ground_speed, bearing
 * @param {number} timeDeltaSeconds - Time between position updates
 * @returns {number} Closing speed in knots (positive = approaching)
 */
export function calculateClosingSpeed(userPos, userPrevPos, threat, threatPrev, timeDeltaSeconds = 3) {
  if (!userPrevPos || !threatPrev || timeDeltaSeconds === 0) {
    return null;
  }

  // Calculate previous and current distances
  const prevDistance = calculateDistanceNm(
    userPrevPos.lat, userPrevPos.lon,
    threatPrev.lat, threatPrev.lon
  );
  const currentDistance = calculateDistanceNm(
    userPos.lat, userPos.lon,
    threat.lat, threat.lon
  );

  // Distance change per second, convert to per hour (knots)
  const distanceChange = prevDistance - currentDistance; // Positive if closing
  const closingSpeedKnots = (distanceChange / timeDeltaSeconds) * 3600;

  return Math.round(closingSpeedKnots);
}

/**
 * Calculate estimated time to closest point of approach (CPA)
 * @param {Object} threat - Threat with distance_nm, ground_speed, bearing, trend
 * @param {number} closingSpeed - Closing speed in knots
 * @returns {Object} {eta: seconds, cpaDistance: nm, willIntercept: boolean}
 */
export function calculateETA(threat, closingSpeed) {
  // If not approaching, no ETA
  if (!closingSpeed || closingSpeed <= 0 || threat.trend !== 'approaching') {
    return {
      eta: null,
      cpaDistance: threat.distance_nm,
      willIntercept: false,
    };
  }

  // Simple ETA based on closing speed
  // ETA (hours) = distance (nm) / closing speed (knots)
  const etaHours = threat.distance_nm / closingSpeed;
  const etaSeconds = Math.round(etaHours * 3600);

  // Limit to reasonable values (max 30 minutes)
  if (etaSeconds > 1800 || etaSeconds < 0) {
    return {
      eta: null,
      cpaDistance: threat.distance_nm,
      willIntercept: false,
    };
  }

  // Estimate closest point of approach
  // This is a simplified calculation - assumes linear motion
  const cpaDistance = Math.max(0, threat.distance_nm - (closingSpeed * (etaSeconds / 3600)));

  return {
    eta: etaSeconds,
    cpaDistance: Math.round(cpaDistance * 10) / 10,
    willIntercept: cpaDistance < 1, // Within 1nm is considered intercept
  };
}

/**
 * Format ETA for display
 * @param {number} seconds - ETA in seconds
 * @returns {string} Formatted string (e.g., "2:30" or "45s")
 */
export function formatETA(seconds) {
  if (seconds === null || seconds === undefined) {
    return '--:--';
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${mins.toString().padStart(2, '0')}`;
  }

  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Predict aircraft position at future time
 * @param {Object} threat - Current threat position
 * @param {number} secondsAhead - Time in future to predict
 * @returns {Object} Predicted {lat, lon}
 */
export function predictPosition(threat, secondsAhead) {
  if (!threat.ground_speed || !threat.lat || !threat.lon) {
    return { lat: threat.lat, lon: threat.lon };
  }

  // Use aircraft's track/heading (bearing it's traveling)
  // Note: threat.bearing is bearing FROM user TO aircraft, NOT the aircraft's heading
  // We should NOT use it as a fallback for aircraft heading
  const aircraftTrack = threat.track ?? threat.heading;

  // If no valid track/heading available, can't predict movement
  if (aircraftTrack == null || typeof aircraftTrack !== 'number' || isNaN(aircraftTrack)) {
    return { lat: threat.lat, lon: threat.lon };
  }

  // Convert speed from knots to nm/second
  const speedNmPerSec = threat.ground_speed / 3600;

  // Distance aircraft will travel
  const distanceNm = speedNmPerSec * secondsAhead;

  // Calculate new position
  const newPos = calculateDestination(
    threat.lat,
    threat.lon,
    aircraftTrack,
    distanceNm
  );

  return newPos;
}

/**
 * Calculate destination point given start, bearing, and distance
 * @param {number} lat - Start latitude
 * @param {number} lon - Start longitude
 * @param {number} bearing - Bearing in degrees
 * @param {number} distanceNm - Distance in nautical miles
 * @returns {Object} {lat, lon}
 */
export function calculateDestination(lat, lon, bearing, distanceNm) {
  const R = 3440.065; // Earth radius in nm
  const d = distanceNm / R;
  const brng = bearing * Math.PI / 180;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lon * Math.PI / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) +
    Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
  );

  const lon2 = lon1 + Math.atan2(
    Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
  );

  return {
    lat: lat2 * 180 / Math.PI,
    lon: lon2 * 180 / Math.PI,
  };
}

/**
 * Detect circling/orbiting behavior (potential surveillance)
 * @param {Array} positionHistory - Array of {lat, lon, timestamp}
 * @param {number} minPositions - Minimum positions to analyze
 * @returns {Object} {isCircling, center, radius, confidence}
 */
export function detectCirclingBehavior(positionHistory, minPositions = 10) {
  if (!positionHistory || positionHistory.length < minPositions) {
    return { isCircling: false, confidence: 0 };
  }

  // Get last N positions
  const positions = positionHistory.slice(-minPositions);

  // Calculate centroid
  const centroid = {
    lat: positions.reduce((sum, p) => sum + p.lat, 0) / positions.length,
    lon: positions.reduce((sum, p) => sum + p.lon, 0) / positions.length,
  };

  // Calculate distances from centroid
  const distances = positions.map(p =>
    calculateDistanceNm(centroid.lat, centroid.lon, p.lat, p.lon)
  );

  // Calculate average and standard deviation
  const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
  const variance = distances.reduce((sum, d) => sum + Math.pow(d - avgDistance, 2), 0) / distances.length;
  const stdDev = Math.sqrt(variance);

  // Low standard deviation relative to average distance indicates circular pattern
  const coefficient = avgDistance > 0 ? stdDev / avgDistance : 1;

  // Threshold for circling detection (lower = tighter circle)
  const isCircling = coefficient < 0.3 && avgDistance > 0.5 && avgDistance < 5;

  // Calculate heading changes to confirm circling
  let totalHeadingChange = 0;
  for (let i = 1; i < positions.length; i++) {
    const bearing1 = calculateBearing(centroid.lat, centroid.lon, positions[i - 1].lat, positions[i - 1].lon);
    const bearing2 = calculateBearing(centroid.lat, centroid.lon, positions[i].lat, positions[i].lon);
    let change = bearing2 - bearing1;
    if (change > 180) change -= 360;
    if (change < -180) change += 360;
    totalHeadingChange += Math.abs(change);
  }

  // Full circle would be ~360 degrees
  const circleCompletion = totalHeadingChange / 360;

  return {
    isCircling: isCircling && circleCompletion > 0.5,
    center: centroid,
    radius: avgDistance,
    confidence: Math.min(1, (1 - coefficient) * circleCompletion),
    circleCompletion,
  };
}

/**
 * Detect if aircraft is loitering (staying in area for extended time)
 * @param {Object} threat - Current threat
 * @param {Object} firstSeen - When first detected {timestamp, distance_nm}
 * @param {number} loiterThresholdMinutes - Minutes to consider loitering
 * @returns {Object} {isLoitering, duration, maxDistance}
 */
export function detectLoitering(threat, firstSeen, loiterThresholdMinutes = 10) {
  if (!firstSeen || !firstSeen.timestamp) {
    return { isLoitering: false, duration: 0 };
  }

  const now = Date.now();
  const durationMs = now - new Date(firstSeen.timestamp).getTime();
  const durationMinutes = durationMs / 60000;

  // Consider loitering if aircraft has been nearby for threshold time
  // and hasn't moved significantly away
  const isLoitering = durationMinutes >= loiterThresholdMinutes &&
    threat.distance_nm < firstSeen.distance_nm * 1.5;

  return {
    isLoitering,
    duration: Math.round(durationMinutes),
    maxDistance: Math.max(threat.distance_nm, firstSeen.distance_nm),
  };
}

/**
 * Calculate threat urgency score (0-100)
 * Combines multiple factors for overall threat assessment
 * @param {Object} threat - Threat data
 * @param {Object} prediction - ETA prediction data
 * @param {Object} behavior - Circling/loitering detection
 * @returns {number} Urgency score 0-100
 */
export function calculateUrgencyScore(threat, prediction = {}, behavior = {}) {
  let score = 0;

  // Distance factor (closer = higher score)
  if (threat.distance_nm < 1) score += 40;
  else if (threat.distance_nm < 2) score += 30;
  else if (threat.distance_nm < 5) score += 20;
  else if (threat.distance_nm < 10) score += 10;

  // Law enforcement factor
  if (threat.is_law_enforcement) score += 25;

  // Approaching factor
  if (threat.trend === 'approaching') score += 15;

  // ETA factor
  if (prediction.eta !== null) {
    if (prediction.eta < 60) score += 15;
    else if (prediction.eta < 180) score += 10;
    else if (prediction.eta < 300) score += 5;
  }

  // Intercept warning
  if (prediction.willIntercept) score += 10;

  // Surveillance behavior
  if (behavior.isCircling) score += 15;
  if (behavior.isLoitering) score += 10;

  // Threat level factor
  if (threat.threat_level === 'critical') score += 10;
  else if (threat.threat_level === 'warning') score += 5;

  return Math.min(100, score);
}

// Import from lawEnforcement.js or duplicate minimal versions
function calculateDistanceNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateBearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  let bearing = Math.atan2(y, x) * 180 / Math.PI;
  return (bearing + 360) % 360;
}

export default {
  calculateClosingSpeed,
  calculateETA,
  formatETA,
  predictPosition,
  calculateDestination,
  detectCirclingBehavior,
  detectLoitering,
  calculateUrgencyScore,
};
