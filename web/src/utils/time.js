// ============================================================================
// Time Conversion Helpers
// ============================================================================

// Convert UTC/Zulu time to local browser time
export const utcToLocal = (utcTime) => {
  if (!utcTime) return null;
  
  try {
    let date;
    
    if (typeof utcTime === 'number') {
      date = new Date(utcTime > 1e12 ? utcTime : utcTime * 1000);
    } else if (typeof utcTime === 'string') {
      if (utcTime.endsWith('Z') || utcTime.includes('UTC') || utcTime.includes('+00:00')) {
        date = new Date(utcTime);
      } else if (/^\d{6}Z?$/.test(utcTime)) {
        const now = new Date();
        const day = parseInt(utcTime.slice(0, 2), 10);
        const hour = parseInt(utcTime.slice(2, 4), 10);
        const min = parseInt(utcTime.slice(4, 6), 10);
        date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, hour, min));
      } else if (/^\d{4}-\d{2}-\d{2}/.test(utcTime)) {
        date = new Date(utcTime + (utcTime.includes('T') ? 'Z' : 'T00:00:00Z'));
      } else {
        date = new Date(utcTime);
      }
    } else {
      return null;
    }
    
    if (isNaN(date.getTime()) || date.getTime() < 946684800000) {
      return null;
    }
    
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch (e) {
    return null;
  }
};

// Format just the time portion in local timezone
export const utcToLocalTime = (utcTime) => {
  if (!utcTime) return null;
  
  try {
    let date;
    
    if (typeof utcTime === 'number') {
      date = new Date(utcTime > 1e12 ? utcTime : utcTime * 1000);
    } else if (typeof utcTime === 'string') {
      if (utcTime.endsWith('Z') || utcTime.includes('UTC')) {
        date = new Date(utcTime);
      } else if (/^\d{6}Z?$/.test(utcTime)) {
        const now = new Date();
        const day = parseInt(utcTime.slice(0, 2), 10);
        const hour = parseInt(utcTime.slice(2, 4), 10);
        const min = parseInt(utcTime.slice(4, 6), 10);
        date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, hour, min));
      } else {
        date = new Date(utcTime + 'Z');
      }
    } else {
      return null;
    }
    
    if (isNaN(date.getTime())) return null;
    
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch (e) {
    return null;
  }
};

// Get cardinal direction from degrees
export const getCardinalDirection = (deg) => {
  if (deg === null || deg === undefined || isNaN(deg)) return '';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(deg / 45) % 8;
  return dirs[index];
};
