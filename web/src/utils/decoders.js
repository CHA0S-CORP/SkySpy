// ============================================================================
// METAR and PIREP Decoders
// ============================================================================

import { utcToLocal, utcToLocalTime } from './time';

// METAR Decoder
export const decodeMetar = (metar) => {
  if (!metar) return null;

  let timeStr = '';
  if (metar.obsTime) {
    timeStr = utcToLocal(metar.obsTime) || metar.obsTime;
  }

  const decoded = {
    raw: metar.rawOb || '',
    station: metar.stationId || metar.icaoId || '',
    time: timeStr || 'Unknown',
    flightCategory: metar.fltCat || 'VFR',
    flightCategoryDesc:
      {
        VFR: 'Visual Flight Rules - Good visibility (>5mi), ceiling >3000ft',
        MVFR: 'Marginal VFR - Reduced visibility (3-5mi) or ceiling 1000-3000ft',
        IFR: 'Instrument Flight Rules - Low visibility (1-3mi) or ceiling 500-1000ft',
        LIFR: 'Low IFR - Very low visibility (<1mi) or ceiling <500ft',
      }[metar.fltCat] || 'Unknown conditions',
    wind: null,
    visibility: null,
    weather: [],
    clouds: [],
    temperature: null,
    dewpoint: null,
    altimeter: null,
    remarks: [],
  };

  // Wind decoding
  if (
    (metar.wdir !== undefined && metar.wdir !== null) ||
    (metar.wspd !== undefined && metar.wspd !== null && !isNaN(metar.wspd))
  ) {
    const dir = metar.wdir === 0 || metar.wdir === null ? 'Variable' : `${metar.wdir}°`;
    const spd = metar.wspd || 0;
    const gust = metar.wgst ? ` gusting ${metar.wgst}kt` : '';
    decoded.wind = {
      text: `${dir} at ${spd}kt${gust}`,
      direction: metar.wdir,
      speed: spd,
      gust: metar.wgst,
      description:
        spd === 0
          ? 'Calm winds'
          : spd < 10
            ? 'Light winds'
            : spd < 20
              ? 'Moderate winds'
              : spd < 30
                ? 'Strong winds'
                : 'High winds',
    };
  }

  // Visibility decoding
  if (metar.visib !== undefined) {
    decoded.visibility = {
      value: metar.visib,
      unit: 'SM',
      description:
        metar.visib >= 10
          ? 'Unlimited visibility'
          : metar.visib >= 5
            ? 'Good visibility'
            : metar.visib >= 3
              ? 'Moderate visibility'
              : metar.visib >= 1
                ? 'Low visibility'
                : 'Very low visibility',
    };
  }

  // Weather phenomena decoding
  const wxCodes = {
    RA: 'Rain',
    SN: 'Snow',
    DZ: 'Drizzle',
    SG: 'Snow grains',
    IC: 'Ice crystals',
    PL: 'Ice pellets',
    GR: 'Hail',
    GS: 'Small hail',
    UP: 'Unknown precip',
    FG: 'Fog',
    BR: 'Mist',
    HZ: 'Haze',
    FU: 'Smoke',
    VA: 'Volcanic ash',
    DU: 'Dust',
    SA: 'Sand',
    PY: 'Spray',
    SQ: 'Squall',
    FC: 'Funnel cloud',
    SS: 'Sandstorm',
    DS: 'Duststorm',
    TS: 'Thunderstorm',
    SH: 'Showers',
    FZ: 'Freezing',
    MI: 'Shallow',
    PR: 'Partial',
    BC: 'Patches',
    DR: 'Drifting',
    BL: 'Blowing',
    VC: 'Vicinity',
  };

  if (metar.wxString) {
    const wx = metar.wxString;
    const intensity = wx.startsWith('+') ? 'Heavy ' : wx.startsWith('-') ? 'Light ' : '';
    let desc = intensity;
    Object.entries(wxCodes).forEach(([code, meaning]) => {
      if (wx.includes(code)) desc += meaning + ' ';
    });
    decoded.weather.push({
      code: wx,
      description: desc.trim() || wx,
    });
  }

  // Cloud decoding
  const cloudCover = {
    SKC: 'Clear sky',
    CLR: 'Clear below 12,000ft',
    FEW: 'Few clouds (1-2 oktas)',
    SCT: 'Scattered clouds (3-4 oktas)',
    BKN: 'Broken clouds (5-7 oktas)',
    OVC: 'Overcast (8 oktas)',
    VV: 'Vertical visibility (obscured)',
  };

  if (metar.clouds && metar.clouds.length > 0) {
    decoded.clouds = metar.clouds.map((c) => ({
      cover: c.cover,
      coverDesc: cloudCover[c.cover] || c.cover,
      base: c.base,
      baseDesc: `${c.base?.toLocaleString() || '?'} ft AGL`,
    }));
  }

  // Temperature
  if (metar.temp !== undefined && metar.temp !== null && !isNaN(metar.temp)) {
    decoded.temperature = {
      celsius: metar.temp,
      fahrenheit: Math.round((metar.temp * 9) / 5 + 32),
      description:
        metar.temp < 0
          ? 'Below freezing'
          : metar.temp < 10
            ? 'Cold'
            : metar.temp < 20
              ? 'Cool'
              : metar.temp < 30
                ? 'Warm'
                : 'Hot',
    };
  }

  // Dewpoint
  if (metar.dewp !== undefined && metar.dewp !== null && !isNaN(metar.dewp)) {
    decoded.dewpoint = {
      celsius: metar.dewp,
      fahrenheit: Math.round((metar.dewp * 9) / 5 + 32),
    };
    if (metar.temp !== undefined && metar.temp !== null && !isNaN(metar.temp)) {
      const spread = metar.temp - metar.dewp;
      decoded.dewpoint.spread = spread;
      decoded.dewpoint.fogRisk =
        spread <= 3 ? 'High fog/mist risk' : spread <= 5 ? 'Moderate fog risk' : 'Low fog risk';
    }
  }

  // Altimeter
  if (metar.altim !== undefined) {
    const inhg = (metar.altim / 100).toFixed(2);
    decoded.altimeter = {
      inhg: inhg,
      mb: Math.round(metar.altim * 0.338639),
      description:
        metar.altim > 3000
          ? 'High pressure'
          : metar.altim < 2970
            ? 'Low pressure'
            : 'Normal pressure',
    };
  }

  return decoded;
};

// PIREP Decoder
export const decodePirep = (pirep) => {
  if (!pirep) return null;

  // Normalize field names (backend uses snake_case, legacy uses camelCase)
  const raw = pirep.raw_text || pirep.rawOb || '';

  // Parse raw PIREP string
  const parseRawPirep = (rawStr) => {
    const parsed = {};

    const tmMatch = rawStr.match(/\/TM\s*(\d{4})/);
    if (tmMatch) {
      const hh = tmMatch[1].substring(0, 2);
      const mm = tmMatch[1].substring(2, 4);
      parsed.timeStr = `${hh}:${mm}Z`;
    }

    const ovMatch = rawStr.match(/\/OV\s+([A-Z0-9]+)/);
    if (ovMatch) parsed.location = ovMatch[1];

    const skMatch = rawStr.match(/\/SK\s+([^/]+)/);
    if (skMatch) parsed.sky = skMatch[1].trim();

    const tbMatch = rawStr.match(/\/TB\s+([^/]+)/);
    if (tbMatch) parsed.turbulence = tbMatch[1].trim();

    const icMatch = rawStr.match(/\/IC\s+([^/]+)/);
    if (icMatch) parsed.icing = icMatch[1].trim();

    const taMatch = rawStr.match(/\/TA\s*(M?\d+)/);
    if (taMatch) {
      const temp = taMatch[1];
      parsed.temp = temp.startsWith('M') ? -parseInt(temp.substring(1), 10) : parseInt(temp, 10);
    }

    const wvMatch = rawStr.match(/\/WV\s*(\d{3})[\s/]?(\d{2,3})/);
    if (wvMatch) {
      parsed.wdir = parseInt(wvMatch[1], 10);
      parsed.wspd = parseInt(wvMatch[2], 10);
    }

    const rmMatch = rawStr.match(/\/RM\s+(.+?)(?:\/|$)/);
    if (rmMatch) parsed.remarks = rmMatch[1].trim();

    const wsMatch = rawStr.match(/\/WS\s+([^/]+)/);
    if (wsMatch) {
      parsed.windshear = wsMatch[1].trim();
    } else if (rawStr.includes('LLWS') || rawStr.includes('WSHFT')) {
      const llwsMatch = rawStr.match(/LLWS[^/]*/i);
      if (llwsMatch) parsed.windshear = llwsMatch[0].trim();
    }

    return parsed;
  };

  const rawParsed = parseRawPirep(raw);

  let timeStr = null;
  if (rawParsed.timeStr) {
    timeStr = utcToLocalTime(rawParsed.timeStr) || rawParsed.timeStr;
  } else if (pirep.observation_time || pirep.obsTime) {
    timeStr = utcToLocal(pirep.observation_time || pirep.obsTime);
  }

  // Normalize field values (backend uses snake_case, legacy uses camelCase)
  const turbStr = pirep.turbulence_type || pirep.turbulence || rawParsed.turbulence;
  const iceStr = pirep.icing_type || pirep.icing || rawParsed.icing;
  const tempVal = pirep.temperature_c ?? pirep.temp ?? rawParsed.temp;
  const wdirVal = pirep.wind_dir ?? pirep.wdir ?? rawParsed.wdir;
  const wspdVal = pirep.wind_speed_kt ?? pirep.wspd ?? rawParsed.wspd;
  const windshearStr =
    rawParsed.windshear || (turbStr && turbStr.toUpperCase().includes('LLWS') ? turbStr : null);
  const reportType = pirep.report_type || pirep.pirepType || (raw.includes(' UUA ') ? 'UUA' : 'UA');
  const aircraftType = pirep.aircraft_type || pirep.acType || null;

  const decoded = {
    raw: raw,
    type: reportType,
    typeDesc:
      reportType === 'UUA' || raw.includes(' UUA ')
        ? 'URGENT Pilot Report'
        : 'Routine Pilot Report',
    time: timeStr,
    aircraft: aircraftType,
    altitude: null,
    location: rawParsed.location || null,
    sky: null,
    turbulence: null,
    icing: null,
    windshear: null,
    weather: null,
    temperature: null,
    wind: null,
    remarks: rawParsed.remarks || null,
  };

  // Altitude/Flight Level (backend uses flight_level/altitude_ft, legacy uses fltLvl)
  const flightLevel = pirep.flight_level ?? pirep.fltLvl;
  const altitudeFt = pirep.altitude_ft;
  if (flightLevel != null && !isNaN(flightLevel)) {
    const altFt = altitudeFt ?? flightLevel * 100;
    decoded.altitude = {
      flightLevel: flightLevel,
      feet: altFt,
      text: `FL${flightLevel} (${altFt.toLocaleString()}ft)`,
    };
  } else if (altitudeFt != null && !isNaN(altitudeFt)) {
    decoded.altitude = {
      flightLevel: Math.round(altitudeFt / 100),
      feet: altitudeFt,
      text: `${altitudeFt.toLocaleString()}ft`,
    };
  }

  // Sky condition
  if (rawParsed.sky) {
    let skyDesc = rawParsed.sky;
    const topsMatch = rawParsed.sky.match(/TO\s*P?(\d{3})/i);
    if (topsMatch) {
      const fl = parseInt(topsMatch[1], 10);
      skyDesc = `Cloud tops at FL${fl} (${(fl * 100).toLocaleString()}ft)`;
    }
    decoded.sky = { raw: rawParsed.sky, description: skyDesc };
  }

  // Turbulence decoding
  const turbIntensity = {
    NEG: { level: 0, desc: 'None', detail: 'Smooth flight, no turbulence' },
    SMTH: { level: 0, desc: 'Smooth', detail: 'Smooth flight, no turbulence' },
    LGT: { level: 1, desc: 'Light', detail: 'Slight, erratic changes in altitude/attitude' },
    'LGT-MOD': {
      level: 2,
      desc: 'Light-Moderate',
      detail: 'Changes in altitude/attitude, aircraft remains in control',
    },
    MOD: {
      level: 3,
      desc: 'Moderate',
      detail: 'Greater intensity, aircraft remains in positive control',
    },
    'MOD-SEV': {
      level: 4,
      desc: 'Moderate-Severe',
      detail: 'Large, abrupt changes, large airspeed variations',
    },
    SEV: { level: 5, desc: 'Severe', detail: 'Aircraft may be momentarily out of control' },
    EXTRM: {
      level: 6,
      desc: 'Extreme',
      detail: 'Aircraft violently tossed, practically impossible to control',
    },
  };

  const turbType = {
    CAT: 'Clear Air Turbulence',
    CHOP: 'Chop',
    LLWS: 'Low Level Wind Shear',
    MWAVE: 'Mountain Wave',
  };

  if (turbStr) {
    const turb = turbStr.toUpperCase();
    let intensity = null;
    let type = null;

    ['LGT-MOD', 'MOD-SEV'].forEach((code) => {
      if (turb.includes(code)) intensity = turbIntensity[code];
    });
    if (!intensity) {
      ['NEG', 'SMTH', 'LGT', 'MOD', 'SEV', 'EXTRM'].forEach((code) => {
        if (turb.includes(code) && !intensity) intensity = turbIntensity[code];
      });
    }
    Object.entries(turbType).forEach(([code, desc]) => {
      if (turb.includes(code)) type = desc;
    });

    decoded.turbulence = {
      raw: turbStr,
      intensity: intensity?.desc || turbStr,
      level: intensity?.level || 0,
      detail: intensity?.detail || '',
      type: type || '',
      warning:
        intensity?.level >= 4
          ? '⚠️ HAZARDOUS - Avoid if possible'
          : intensity?.level >= 3
            ? '⚡ Use caution'
            : '',
    };
  }

  // Icing decoding
  const iceIntensity = {
    NEG: { level: 0, desc: 'None', detail: 'No icing observed' },
    TRC: { level: 1, desc: 'Trace', detail: 'Ice becomes noticeable' },
    LGT: { level: 2, desc: 'Light', detail: 'May create problem with prolonged exposure' },
    MOD: { level: 3, desc: 'Moderate', detail: 'Short encounters potentially hazardous' },
    SEV: { level: 4, desc: 'Severe', detail: 'De-icing/anti-icing fails to control hazard' },
  };

  const iceType = { RIME: 'Rime ice', CLR: 'Clear ice', MXD: 'Mixed ice' };

  if (iceStr) {
    const ice = iceStr.toUpperCase();
    let intensity = null;
    let type = null;

    Object.entries(iceIntensity).forEach(([code, info]) => {
      if (ice.includes(code) && !intensity) intensity = info;
    });
    Object.entries(iceType).forEach(([code, desc]) => {
      if (ice.includes(code)) type = desc;
    });

    decoded.icing = {
      raw: iceStr,
      intensity: intensity?.desc || iceStr,
      level: intensity?.level || 0,
      detail: intensity?.detail || '',
      type: type || '',
      warning:
        intensity?.level >= 3
          ? '⚠️ HAZARDOUS - Avoid if possible'
          : intensity?.level >= 2
            ? '❄️ Use caution, check anti-ice'
            : '',
    };
  }

  // Wind Shear / LLWS
  const wsIntensity = {
    NEG: { level: 0, desc: 'None', detail: 'No wind shear observed' },
    LGT: { level: 1, desc: 'Light', detail: 'Airspeed changes 15-25kt' },
    MOD: { level: 2, desc: 'Moderate', detail: 'Airspeed changes 25-40kt' },
    SEV: { level: 3, desc: 'Severe', detail: 'Airspeed changes >40kt, potential loss of control' },
  };

  if (windshearStr) {
    const ws = windshearStr.toUpperCase();
    let intensity = null;
    let gainLoss = null;

    Object.entries(wsIntensity).forEach(([code, info]) => {
      if (ws.includes(code) && !intensity) intensity = info;
    });

    if (ws.includes('+') || ws.includes('GAIN')) gainLoss = 'Gain';
    if (ws.includes('-') || ws.includes('LOSS')) gainLoss = 'Loss';

    const altMatch = ws.match(/(\d{3})-(\d{3})/);
    let altRange = null;
    if (altMatch) {
      const low = parseInt(altMatch[1], 10) * 100;
      const high = parseInt(altMatch[2], 10) * 100;
      altRange = `${low.toLocaleString()}-${high.toLocaleString()}ft`;
    }

    decoded.windshear = {
      raw: windshearStr,
      intensity: intensity?.desc || 'Reported',
      level: intensity?.level || 2,
      detail: intensity?.detail || 'Low Level Wind Shear reported',
      gainLoss: gainLoss,
      altRange: altRange,
      warning:
        intensity?.level >= 3
          ? '⚠️ SEVERE - Avoid area'
          : intensity?.level >= 2
            ? '💨 CAUTION - Wind shear reported'
            : '💨 Wind shear reported',
    };
  }

  // Weather conditions
  const wxStr = pirep.weather || pirep.wxString;
  if (wxStr) {
    decoded.weather = { raw: wxStr, description: wxStr };
  }

  // Temperature at altitude
  if (tempVal !== undefined && tempVal !== null && !isNaN(tempVal)) {
    decoded.temperature = {
      celsius: tempVal,
      fahrenheit: Math.round((tempVal * 9) / 5 + 32),
      isaDeviation: flightLevel ? Math.round(tempVal - (15 - flightLevel * 100 * 0.00198)) : null,
    };
  }

  // Wind at altitude
  if (
    wdirVal !== undefined &&
    wdirVal !== null &&
    !isNaN(wdirVal) &&
    wspdVal !== undefined &&
    wspdVal !== null &&
    !isNaN(wspdVal)
  ) {
    decoded.wind = {
      direction: wdirVal,
      speed: wspdVal,
      text: `${wdirVal}° at ${wspdVal}kt`,
    };
  }

  return decoded;
};

// ============================================================================
// PIREP Utility Functions
// ============================================================================

/**
 * Get the maximum severity level from a PIREP
 * Returns an object with level (0-6), type ('turbulence', 'icing', 'windshear', 'both'),
 * and description
 */
export const getPirepMaxSeverity = (pirep) => {
  if (!pirep) return { level: 0, type: 'routine', description: 'Routine' };

  const decoded = typeof pirep.decoded === 'object' ? pirep.decoded : decodePirep(pirep);
  if (!decoded) return { level: 0, type: 'routine', description: 'Routine' };

  // Check for UUA (Urgent)
  const isUrgent =
    decoded.type === 'UUA' || (pirep.raw_text || pirep.rawOb || '').includes(' UUA ');

  const turbLevel = decoded.turbulence?.level || 0;
  const iceLevel = decoded.icing?.level || 0;
  const wsLevel = decoded.windshear?.level || 0;

  // Determine max level and type
  let maxLevel = Math.max(turbLevel, iceLevel, wsLevel);
  let type = 'routine';
  let description = 'Routine';

  if (isUrgent) {
    maxLevel = Math.max(maxLevel, 5); // UUA is at least severe
  }

  if (turbLevel > 0 && iceLevel > 0) {
    type = 'both';
  } else if (turbLevel >= iceLevel && turbLevel >= wsLevel && turbLevel > 0) {
    type = 'turbulence';
  } else if (iceLevel >= turbLevel && iceLevel >= wsLevel && iceLevel > 0) {
    type = 'icing';
  } else if (wsLevel > 0) {
    type = 'windshear';
  }

  // Generate description based on level
  const levelDescriptions = {
    0: 'Routine',
    1: 'Light',
    2: 'Light-Moderate',
    3: 'Moderate',
    4: 'Moderate-Severe',
    5: 'Severe',
    6: 'Extreme',
  };
  description = levelDescriptions[maxLevel] || 'Routine';

  return {
    level: maxLevel,
    type: isUrgent ? 'urgent' : type,
    description,
    turbLevel,
    iceLevel,
    wsLevel,
    isUrgent,
  };
};

/**
 * Get a short hazard summary text for a PIREP
 * Returns string like "SEVERE TURBULENCE | MODERATE ICING"
 */
export const getHazardSummary = (decoded) => {
  if (!decoded) return null;

  const hazards = [];

  if (decoded.turbulence && decoded.turbulence.level > 0) {
    hazards.push(`${decoded.turbulence.intensity.toUpperCase()} TURBULENCE`);
  }

  if (decoded.icing && decoded.icing.level > 0) {
    hazards.push(`${decoded.icing.intensity.toUpperCase()} ICING`);
  }

  if (decoded.windshear && decoded.windshear.level > 0) {
    hazards.push(`${decoded.windshear.intensity.toUpperCase()} WIND SHEAR`);
  }

  if (hazards.length === 0) {
    if (decoded.type === 'UUA') {
      return 'URGENT PILOT REPORT';
    }
    return 'ROUTINE REPORT';
  }

  return hazards.join(' | ');
};

/**
 * Get the age of a PIREP in minutes
 * @param {Object} pirep - PIREP object with observation_time or obsTime
 * @returns {number} Age in minutes, or -1 if unable to determine
 */
export const getPirepAgeMinutes = (pirep) => {
  if (!pirep) return -1;

  const obsTime = pirep.observation_time || pirep.obsTime;
  if (!obsTime) return -1;

  try {
    const obsDate = new Date(obsTime);
    const now = new Date();
    const diffMs = now - obsDate;
    return Math.floor(diffMs / 60000); // Convert ms to minutes
  } catch {
    return -1;
  }
};

/**
 * Get a freshness CSS class based on age in minutes
 * @param {number} minutes - Age in minutes
 * @returns {string} CSS class name
 */
export const getAgeFreshnessClass = (minutes) => {
  if (minutes < 0) return 'unknown';
  if (minutes <= 30) return 'fresh'; // Green
  if (minutes <= 60) return 'recent'; // Yellow
  if (minutes <= 120) return 'aging'; // Orange
  return 'stale'; // Gray
};

/**
 * Get opacity value based on PIREP age
 * @param {number} minutes - Age in minutes
 * @returns {number} Opacity value 0-1
 */
export const getAgeOpacity = (minutes) => {
  if (minutes < 0) return 1.0;
  if (minutes <= 30) return 1.0;
  if (minutes <= 60) return 0.85;
  if (minutes <= 120) return 0.7;
  if (minutes <= 240) return 0.55;
  return 0.4;
};

/**
 * Format altitude for display (e.g., "FL350" or "12k")
 * @param {Object} pirep - PIREP object
 * @returns {string|null} Formatted altitude string
 */
export const formatPirepAltitude = (pirep) => {
  if (!pirep) return null;

  const flightLevel = pirep.flight_level ?? pirep.fltLvl;
  const altitudeFt = pirep.altitude_ft;

  if (flightLevel != null && flightLevel >= 180) {
    return `FL${flightLevel}`;
  } else if (flightLevel != null) {
    return `${Math.round((flightLevel * 100) / 1000)}k`;
  } else if (altitudeFt != null) {
    if (altitudeFt >= 18000) {
      return `FL${Math.round(altitudeFt / 100)}`;
    }
    return `${Math.round(altitudeFt / 1000)}k`;
  }

  return null;
};
