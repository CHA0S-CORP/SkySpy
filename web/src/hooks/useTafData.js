import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

/**
 * TAF (Terminal Aerodrome Forecast) data hook
 * Fetches and parses TAF forecasts for airports in range
 *
 * TAF format includes:
 * - FM (From): New conditions starting at specified time
 * - TEMPO: Temporary fluctuations lasting less than 1 hour
 * - BECMG: Gradual change over specified period
 * - PROB: Probability of conditions (PROB30, PROB40)
 *
 * @param {Function} wsRequest - WebSocket request function
 * @param {boolean} wsConnected - WebSocket connection status
 * @param {number} feederLat - Feeder latitude
 * @param {number} feederLon - Feeder longitude
 * @param {number} radarRange - Radar range in nm
 * @param {boolean} enabled - Whether TAF overlay is enabled
 */
export function useTafData(wsRequest, wsConnected, feederLat, feederLon, radarRange, enabled = false) {
  const [tafs, setTafs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const lastFetchRef = useRef(0);
  const cacheRef = useRef(new Map()); // Cache individual station TAFs

  // Parse TAF change groups (FM, TEMPO, BECMG, PROB)
  const parseChangeGroups = useCallback((rawTaf) => {
    if (!rawTaf) return [];

    const groups = [];
    const lines = rawTaf.split(/\s+/);
    let currentGroup = null;
    let i = 0;

    while (i < lines.length) {
      const token = lines[i];

      // FM (From) - new conditions
      if (token.startsWith('FM')) {
        if (currentGroup) groups.push(currentGroup);
        const timeStr = token.slice(2);
        currentGroup = {
          type: 'FM',
          typeDesc: 'From',
          startTime: parseTafTime(timeStr),
          rawTime: timeStr,
          conditions: [],
        };
        i++;
        continue;
      }

      // TEMPO - temporary fluctuations
      if (token === 'TEMPO') {
        if (currentGroup) groups.push(currentGroup);
        // Next token should be time range
        const timeRange = lines[i + 1] || '';
        const [start, end] = parseTimeRange(timeRange);
        currentGroup = {
          type: 'TEMPO',
          typeDesc: 'Temporary',
          startTime: start,
          endTime: end,
          rawTime: timeRange,
          conditions: [],
        };
        i += 2;
        continue;
      }

      // BECMG - becoming
      if (token === 'BECMG') {
        if (currentGroup) groups.push(currentGroup);
        const timeRange = lines[i + 1] || '';
        const [start, end] = parseTimeRange(timeRange);
        currentGroup = {
          type: 'BECMG',
          typeDesc: 'Becoming',
          startTime: start,
          endTime: end,
          rawTime: timeRange,
          conditions: [],
        };
        i += 2;
        continue;
      }

      // PROB30/PROB40 - probability
      if (token.startsWith('PROB')) {
        if (currentGroup) groups.push(currentGroup);
        const prob = parseInt(token.slice(4), 10);
        // Check if next token is TEMPO
        let subType = '';
        let timeRange = lines[i + 1] || '';
        if (timeRange === 'TEMPO') {
          subType = 'TEMPO';
          timeRange = lines[i + 2] || '';
          i++;
        }
        const [start, end] = parseTimeRange(timeRange);
        currentGroup = {
          type: 'PROB',
          typeDesc: `${prob}% Probability${subType ? ' Temporary' : ''}`,
          probability: prob,
          subType,
          startTime: start,
          endTime: end,
          rawTime: timeRange,
          conditions: [],
        };
        i += 2;
        continue;
      }

      // Add conditions to current group
      if (currentGroup) {
        currentGroup.conditions.push(token);
      }
      i++;
    }

    if (currentGroup) groups.push(currentGroup);

    // Parse conditions in each group
    return groups.map((group) => ({
      ...group,
      ...parseConditions(group.conditions),
    }));
  }, []);

  // Parse TAF time format (DDHHmm or DDHH)
  const parseTafTime = (timeStr) => {
    if (!timeStr || timeStr.length < 4) return null;
    try {
      const now = new Date();
      const day = parseInt(timeStr.slice(0, 2), 10);
      const hour = parseInt(timeStr.slice(2, 4), 10);
      const min = timeStr.length >= 6 ? parseInt(timeStr.slice(4, 6), 10) : 0;

      // Create UTC date
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, hour, min));

      // Handle month rollover
      if (date < now && day > 20 && now.getUTCDate() < 10) {
        date.setUTCMonth(date.getUTCMonth() + 1);
      } else if (date > now && day < 10 && now.getUTCDate() > 20) {
        date.setUTCMonth(date.getUTCMonth() - 1);
      }

      return date.toISOString();
    } catch {
      return null;
    }
  };

  // Parse time range (DDHH/DDHH)
  const parseTimeRange = (rangeStr) => {
    if (!rangeStr || !rangeStr.includes('/')) return [null, null];
    const [start, end] = rangeStr.split('/');
    return [parseTafTime(start), parseTafTime(end)];
  };

  // Parse condition tokens into structured data
  const parseConditions = (tokens) => {
    const result = {
      wind: null,
      visibility: null,
      weather: [],
      clouds: [],
      ceiling: null,
      flightCategory: 'VFR',
    };

    const wxCodes = {
      RA: 'Rain',
      SN: 'Snow',
      DZ: 'Drizzle',
      SG: 'Snow Grains',
      IC: 'Ice Crystals',
      PL: 'Ice Pellets',
      GR: 'Hail',
      GS: 'Small Hail',
      UP: 'Unknown Precip',
      FG: 'Fog',
      BR: 'Mist',
      HZ: 'Haze',
      FU: 'Smoke',
      VA: 'Volcanic Ash',
      DU: 'Dust',
      SA: 'Sand',
      SQ: 'Squall',
      FC: 'Funnel Cloud',
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

    tokens.forEach((token) => {
      // Wind (e.g., 27015G25KT, VRB05KT)
      const windMatch = token.match(/^(VRB|\d{3})(\d{2,3})(G(\d{2,3}))?KT$/);
      if (windMatch) {
        result.wind = {
          direction: windMatch[1] === 'VRB' ? 'VRB' : parseInt(windMatch[1], 10),
          speed: parseInt(windMatch[2], 10),
          gust: windMatch[4] ? parseInt(windMatch[4], 10) : null,
          text: token,
        };
        return;
      }

      // Visibility (e.g., P6SM, 3SM, 1/2SM, 0SM)
      const visMatch = token.match(/^P?(\d+)?(?:\/(\d+))?SM$/);
      if (visMatch) {
        let vis;
        if (token.startsWith('P')) {
          vis = parseInt(token.slice(1).replace('SM', ''), 10) || 6;
        } else if (visMatch[2]) {
          // Fraction
          vis = parseInt(visMatch[1], 10) / parseInt(visMatch[2], 10);
        } else {
          vis = parseInt(visMatch[1], 10);
        }
        result.visibility = {
          value: vis,
          text: token,
          isGreaterThan: token.startsWith('P'),
        };
        return;
      }

      // Clouds (e.g., FEW020, SCT040, BKN080, OVC100, VV005)
      const cloudMatch = token.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?$/);
      if (cloudMatch) {
        const base = parseInt(cloudMatch[2], 10) * 100;
        const cover = cloudMatch[1];
        result.clouds.push({
          cover,
          base,
          type: cloudMatch[3] || null,
          text: token,
          isCeiling: cover === 'BKN' || cover === 'OVC' || cover === 'VV',
        });

        // Track lowest ceiling
        if ((cover === 'BKN' || cover === 'OVC' || cover === 'VV') &&
            (result.ceiling === null || base < result.ceiling)) {
          result.ceiling = base;
        }
        return;
      }

      // Weather phenomena (check against wxCodes)
      const intensity = token.startsWith('+') ? 'Heavy' : token.startsWith('-') ? 'Light' : '';
      const cleanToken = token.replace(/^[+-]/, '');
      let wxDesc = intensity ? intensity + ' ' : '';
      let hasWx = false;

      Object.entries(wxCodes).forEach(([code, desc]) => {
        if (cleanToken.includes(code)) {
          wxDesc += desc + ' ';
          hasWx = true;
        }
      });

      if (hasWx) {
        result.weather.push({
          code: token,
          description: wxDesc.trim(),
          isSignificant: token.includes('TS') || token.includes('FZ') || token.includes('GR'),
        });
      }
    });

    // Calculate flight category based on visibility and ceiling
    result.flightCategory = calculateFlightCategory(result.visibility?.value, result.ceiling);

    return result;
  };

  // Calculate flight category from visibility and ceiling
  const calculateFlightCategory = (visibility, ceiling) => {
    // LIFR: Ceiling < 500 OR visibility < 1
    if ((ceiling !== null && ceiling < 500) || (visibility !== null && visibility < 1)) {
      return 'LIFR';
    }
    // IFR: Ceiling 500-999 OR visibility 1-2
    if ((ceiling !== null && ceiling >= 500 && ceiling < 1000) ||
        (visibility !== null && visibility >= 1 && visibility < 3)) {
      return 'IFR';
    }
    // MVFR: Ceiling 1000-3000 OR visibility 3-5
    if ((ceiling !== null && ceiling >= 1000 && ceiling <= 3000) ||
        (visibility !== null && visibility >= 3 && visibility <= 5)) {
      return 'MVFR';
    }
    // VFR: Ceiling > 3000 AND visibility > 5
    return 'VFR';
  };

  // Decode a TAF into structured format
  const decodeTaf = useCallback((taf) => {
    if (!taf) return null;

    const rawText = taf.rawTaf || taf.rawOb || taf.raw_text || '';
    const stationId = taf.stationId || taf.icaoId || taf.station_id || '';

    // Parse issue time and validity period
    const issueMatch = rawText.match(/(\d{6})Z/);
    const validMatch = rawText.match(/(\d{4})\/(\d{4})/);

    let issueTime = null;
    let validFrom = null;
    let validTo = null;

    if (issueMatch) {
      issueTime = parseTafTime(issueMatch[1]);
    }

    if (validMatch) {
      validFrom = parseTafTime(validMatch[1]);
      validTo = parseTafTime(validMatch[2]);
    }

    // Extract the forecast portion (after the validity period)
    let forecastPortion = rawText;
    if (validMatch) {
      const validIdx = rawText.indexOf(validMatch[0]);
      forecastPortion = rawText.slice(validIdx + validMatch[0].length).trim();
    }

    // Parse base forecast (before first FM/TEMPO/BECMG/PROB)
    const changePattern = /\b(FM\d{6}|TEMPO|BECMG|PROB\d{2})\b/;
    const changeMatch = forecastPortion.match(changePattern);
    let baseForecast = forecastPortion;
    let changeGroups = [];

    if (changeMatch) {
      baseForecast = forecastPortion.slice(0, changeMatch.index).trim();
      const changePortion = forecastPortion.slice(changeMatch.index);
      changeGroups = parseChangeGroups(changePortion);
    }

    // Parse base conditions
    const baseConditions = parseConditions(baseForecast.split(/\s+/));

    // Determine current and forecast flight categories
    const currentCategory = baseConditions.flightCategory;
    const forecastCategories = changeGroups.map((g) => g.flightCategory).filter(Boolean);
    const hasIfrTransition = forecastCategories.some((c) => c === 'IFR' || c === 'LIFR');
    const hasMvfrTransition = forecastCategories.some((c) => c === 'MVFR');

    // Find significant weather
    const significantWeather = [
      ...baseConditions.weather.filter((w) => w.isSignificant),
      ...changeGroups.flatMap((g) => g.weather?.filter((w) => w.isSignificant) || []),
    ];

    return {
      stationId,
      raw: rawText,
      issueTime,
      validFrom,
      validTo,
      baseConditions,
      changeGroups,
      currentCategory,
      forecastCategories: [...new Set(forecastCategories)],
      hasIfrTransition,
      hasMvfrTransition,
      hasSignificantWeather: significantWeather.length > 0,
      significantWeather,
      // Location data
      lat: taf.lat,
      lon: taf.lon,
      name: taf.name,
      // Age tracking
      fetchTime: Date.now(),
    };
  }, [parseChangeGroups]);

  // Fetch TAFs for airports in range
  const fetchTafs = useCallback(async () => {
    if (!enabled || !feederLat || !feederLon) return;

    // Require WebSocket connection
    if (!wsRequest || !wsConnected) {
      setError('Socket not connected');
      return;
    }

    // Debounce - don't fetch more than once per 30 seconds
    const now = Date.now();
    if (now - lastFetchRef.current < 30000) return;
    lastFetchRef.current = now;

    setLoading(true);
    setError(null);

    try {
      const response = await wsRequest(
        'tafs',
        {
          lat: feederLat,
          lon: feederLon,
          radius: Math.round(radarRange * 1.2),
        },
        20000
      );

      // Extract data from response
      let tafData = [];
      if (Array.isArray(response)) {
        tafData = response;
      } else if (response?.data && Array.isArray(response.data)) {
        tafData = response.data;
      } else if (response?.tafs && Array.isArray(response.tafs)) {
        tafData = response.tafs;
      }

      // Decode and cache TAFs
      const decoded = tafData
        .map((taf) => decodeTaf(taf))
        .filter(Boolean);

      // Update cache
      decoded.forEach((taf) => {
        cacheRef.current.set(taf.stationId, taf);
      });

      setTafs(decoded);
    } catch (err) {
      console.error('TAF fetch error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [wsRequest, wsConnected, feederLat, feederLon, radarRange, enabled, decodeTaf]);

  // Fetch single TAF for a station
  const fetchTafForStation = useCallback(async (stationId) => {
    if (!wsRequest || !wsConnected) {
      return null;
    }

    // Check cache first (valid for 10 minutes)
    const cached = cacheRef.current.get(stationId);
    if (cached && Date.now() - cached.fetchTime < 600000) {
      return cached;
    }

    try {
      const response = await wsRequest('taf', { station: stationId }, 15000);
      if (response) {
        const decoded = decodeTaf(response);
        if (decoded) {
          cacheRef.current.set(stationId, decoded);
          return decoded;
        }
      }
    } catch (err) {
      console.error(`TAF fetch error for ${stationId}:`, err);
    }

    return null;
  }, [wsRequest, wsConnected, decodeTaf]);

  // Get TAF for a specific airport
  const getTafForAirport = useCallback((airport) => {
    if (!airport) return null;

    const airportIds = [airport.icao, airport.icaoId, airport.faaId, airport.id]
      .filter(Boolean)
      .map((id) => id.toUpperCase());

    for (const id of airportIds) {
      const taf = tafs.find(
        (t) => t.stationId.toUpperCase() === id
      );
      if (taf) return taf;

      // Check cache
      const cached = cacheRef.current.get(id);
      if (cached && Date.now() - cached.fetchTime < 600000) {
        return cached;
      }
    }

    return null;
  }, [tafs]);

  // Check if airport has TAF available
  const hasTafAvailable = useCallback((airport) => {
    return getTafForAirport(airport) !== null;
  }, [getTafForAirport]);

  // Get forecast category changes for an airport
  const getForecastChanges = useCallback((airport) => {
    const taf = getTafForAirport(airport);
    if (!taf) return null;

    const changes = [];
    let prevCategory = taf.currentCategory;

    taf.changeGroups.forEach((group) => {
      if (group.flightCategory && group.flightCategory !== prevCategory) {
        changes.push({
          from: prevCategory,
          to: group.flightCategory,
          time: group.startTime,
          type: group.type,
          typeDesc: group.typeDesc,
        });
        if (group.type === 'FM' || group.type === 'BECMG') {
          prevCategory = group.flightCategory;
        }
      }
    });

    return changes;
  }, [getTafForAirport]);

  // Fetch on mount and when enabled changes
  useEffect(() => {
    if (enabled && wsConnected) {
      fetchTafs();
    }
  }, [enabled, wsConnected, fetchTafs]);

  // Refresh every 15 minutes
  useEffect(() => {
    if (!enabled || !wsConnected) return;

    const interval = setInterval(() => {
      fetchTafs();
    }, 900000); // 15 minutes

    return () => clearInterval(interval);
  }, [enabled, wsConnected, fetchTafs]);

  // Memoized list of stations with TAFs
  const stationsWithTaf = useMemo(() => {
    return new Set(tafs.map((t) => t.stationId.toUpperCase()));
  }, [tafs]);

  return {
    tafs,
    loading,
    error,
    refresh: fetchTafs,
    fetchTafForStation,
    getTafForAirport,
    hasTafAvailable,
    getForecastChanges,
    stationsWithTaf,
    // Utility functions exposed
    decodeTaf,
  };
}

export default useTafData;
