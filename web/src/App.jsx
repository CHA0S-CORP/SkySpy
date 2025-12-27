import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { io } from 'socket.io-client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Plane, Radio, MapPin, Activity, Clock, Filter, ChevronUp, ChevronDown,
  ChevronLeft, ChevronRight, X, Eye, EyeOff, Settings, Trash2, Plus, Shield, 
  Bell, Database, Zap, RefreshCw, TestTube2, AlertTriangle, BarChart3, History, 
  Map as MapIcon, Radar, Moon, Sun, BellRing, BellOff, Layers, ExternalLink,
  Ship, Radio as RadioIcon, LayoutDashboard, LineChart, MessageSquare, Anchor,
  Wind, Snowflake, CloudRain, Thermometer, Navigation, Info, HelpCircle, Compass,
  Volume2, VolumeX, Check, Menu, Search, Signal, Crosshair, BellPlus, TrendingUp,
  ArrowUpRight, LocateFixed, Maximize2, Minimize2, Pin, PinOff, MessageCircle,
  Camera, Calendar, Building2, Flag, Hash, Wifi, WifiOff
} from 'lucide-react';
import './App.css';

// ============================================================================
// Configuration helpers
// ============================================================================

const DEFAULT_CONFIG = {
  apiBaseUrl: '',
  mapMode: 'pro',  // 'radar', 'crt', 'pro', 'map'
  mapDarkMode: true,
  browserNotifications: false
};

const getConfig = () => {
  const stored = localStorage.getItem('adsb-dashboard-config');
  return stored ? { ...DEFAULT_CONFIG, ...JSON.parse(stored) } : DEFAULT_CONFIG;
};

const saveConfig = (config) => {
  localStorage.setItem('adsb-dashboard-config', JSON.stringify(config));
};

// Overlay preferences storage
const DEFAULT_OVERLAYS = {
  aircraft: true,
  vors: true,
  airports: true,
  airspace: true,
  metars: false,
  pireps: false,
};

const getOverlays = () => {
  const stored = localStorage.getItem('adsb-dashboard-overlays');
  return stored ? { ...DEFAULT_OVERLAYS, ...JSON.parse(stored) } : DEFAULT_OVERLAYS;
};

const saveOverlays = (overlays) => {
  localStorage.setItem('adsb-dashboard-overlays', JSON.stringify(overlays));
};

// Wind direction to cardinal helper
const windDirToCardinal = (deg) => {
  if (deg === null || deg === undefined || isNaN(deg)) return '';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(deg / 22.5) % 16;
  return dirs[index];
};

// PIREP type classification for coloring
const getPirepType = (pirep) => {
  const hasTurb = !!(pirep.turbulence || (pirep.rawOb && pirep.rawOb.includes('/TB')));
  const hasIce = !!(pirep.icing || (pirep.rawOb && pirep.rawOb.includes('/IC')));
  const hasWS = !!(pirep.rawOb && (pirep.rawOb.includes('/WS') || pirep.rawOb.includes('LLWS')));
  const isUrgent = pirep.pirepType === 'UUA' || (pirep.rawOb && pirep.rawOb.includes(' UUA '));
  
  if (isUrgent) return 'urgent';
  if (hasWS) return 'windshear';
  if (hasTurb && hasIce) return 'both';
  if (hasTurb) return 'turbulence';
  if (hasIce) return 'icing';
  return 'routine';
};

// ============================================================================
// ICAO Hex to Tail Number Conversion
// ============================================================================

// US N-number conversion (ICAO range: A00001 - AFFFFF)
const icaoToNNumber = (hex) => {
  const icao = parseInt(hex, 16);
  const base = 0xA00001;
  const end = 0xAFFFFF;
  
  if (icao < base || icao > end) return null;
  
  const offset = icao - base;
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // No I or O
  const digits = '0123456789';
  
  // Complex N-number encoding - simplified approximation
  // Real algorithm is more complex, this covers common cases
  if (offset < 0) return null;
  
  // Simplified decode - returns approximate N-number
  const n1 = Math.floor(offset / 101711);
  const rem1 = offset % 101711;
  const n2 = Math.floor(rem1 / 10111);
  const rem2 = rem1 % 10111;
  
  if (n1 > 9) return `N${n1}${n2}...`;
  
  let result = 'N' + (n1 + 1);
  if (n2 <= 9) {
    result += n2;
  }
  
  return result.length >= 2 ? result : null;
};

// Country prefixes for ICAO hex ranges
const getCountryFromIcao = (hex) => {
  const icao = parseInt(hex, 16);
  
  // Major country ranges (simplified)
  const ranges = [
    { start: 0xA00000, end: 0xAFFFFF, country: 'US', flag: '🇺🇸' },
    { start: 0xC00000, end: 0xC3FFFF, country: 'CA', flag: '🇨🇦' },
    { start: 0x400000, end: 0x43FFFF, country: 'UK', flag: '🇬🇧' },
    { start: 0x3C0000, end: 0x3FFFFF, country: 'DE', flag: '🇩🇪' },
    { start: 0x380000, end: 0x3BFFFF, country: 'FR', flag: '🇫🇷' },
    { start: 0x300000, end: 0x33FFFF, country: 'IT', flag: '🇮🇹' },
    { start: 0x340000, end: 0x37FFFF, country: 'ES', flag: '🇪🇸' },
    { start: 0x478000, end: 0x47FFFF, country: 'NO', flag: '🇳🇴' },
    { start: 0x4A0000, end: 0x4AFFFF, country: 'SE', flag: '🇸🇪' },
    { start: 0x460000, end: 0x467FFF, country: 'DK', flag: '🇩🇰' },
    { start: 0x480000, end: 0x487FFF, country: 'NL', flag: '🇳🇱' },
    { start: 0x500000, end: 0x5003FF, country: 'AU', flag: '🇦🇺' },
    { start: 0x780000, end: 0x7BFFFF, country: 'CN', flag: '🇨🇳' },
    { start: 0x840000, end: 0x87FFFF, country: 'JP', flag: '🇯🇵' },
    { start: 0x681000, end: 0x6817FF, country: 'KR', flag: '🇰🇷' },
    { start: 0xE00000, end: 0xE3FFFF, country: 'BR', flag: '🇧🇷' },
    { start: 0x0D0000, end: 0x0D7FFF, country: 'MX', flag: '🇲🇽' },
    { start: 0x710000, end: 0x717FFF, country: 'IN', flag: '🇮🇳' },
    { start: 0x700000, end: 0x700FFF, country: 'PK', flag: '🇵🇰' },
    { start: 0x600000, end: 0x6003FF, country: 'RU', flag: '🇷🇺' },
    { start: 0x440000, end: 0x447FFF, country: 'AT', flag: '🇦🇹' },
    { start: 0x4B0000, end: 0x4B7FFF, country: 'CH', flag: '🇨🇭' },
    { start: 0x484000, end: 0x487FFF, country: 'BE', flag: '🇧🇪' },
    { start: 0x4D0000, end: 0x4D03FF, country: 'IE', flag: '🇮🇪' },
    { start: 0x7C0000, end: 0x7FFFFF, country: 'AU', flag: '🇦🇺' },
    { start: 0xC80000, end: 0xC87FFF, country: 'NZ', flag: '🇳🇿' },
  ];
  
  for (const range of ranges) {
    if (icao >= range.start && icao <= range.end) {
      return range;
    }
  }
  return { country: '??', flag: '🏳️' };
};

// Get registration/tail number from ICAO (US only for now, others show country)
const getTailNumber = (hex, flight) => {
  if (!hex) return null;
  
  const country = getCountryFromIcao(hex);
  
  // For US aircraft, try to decode N-number
  if (country.country === 'US') {
    const nNumber = icaoToNNumber(hex);
    if (nNumber) return nNumber;
  }
  
  // For other countries, if flight looks like a registration, use it
  if (flight && flight.trim()) {
    const f = flight.trim();
    // Check if it looks like a registration (not an airline callsign)
    if (/^[A-Z]-[A-Z]{3,4}$/.test(f) || // European format: D-ABCD
        /^[A-Z]{2}-[A-Z]{3}$/.test(f) || // Some formats: VH-ABC
        /^N\d+[A-Z]*$/.test(f)) { // US format: N12345
      return f;
    }
  }
  
  return null;
};

// Combined tail info for popup display
const getTailInfo = (hex, flight) => {
  const country = getCountryFromIcao(hex);
  const tailNumber = getTailNumber(hex, flight);
  const callsign = flight?.trim() || hex?.toUpperCase() || '--';
  
  return {
    tailNumber,
    callsign,
    country: `${country.flag} ${country.country}`,
    countryCode: country.country,
    flag: country.flag
  };
};

// Translate ADS-B category codes to human readable
const getCategoryName = (category) => {
  const categories = {
    'A0': 'Unknown',
    'A1': 'Light',
    'A2': 'Small',
    'A3': 'Large',
    'A4': 'High Vortex',
    'A5': 'Heavy',
    'A6': 'High Perf',
    'A7': 'Rotorcraft',
    'B0': 'Unknown',
    'B1': 'Glider',
    'B2': 'Balloon',
    'B3': 'Parachute',
    'B4': 'Ultralight',
    'B5': 'Reserved',
    'B6': 'UAV',
    'B7': 'Space',
    'C0': 'Unknown',
    'C1': 'Emergency',
    'C2': 'Service',
    'C3': 'Ground Obs',
    'C4': 'Ground Obs',
    'C5': 'Ground Obs',
    'C6': 'Ground Obs',
    'C7': 'Ground Obs',
    'D0': 'Unknown',
    'D1': 'Reserved',
    'D2': 'Reserved',
    'D3': 'Reserved',
    'D4': 'Reserved',
    'D5': 'Reserved',
    'D6': 'Reserved',
    'D7': 'Reserved',
  };
  return categories[category] || category || 'Unknown';
};

// ============================================================================
// Time Conversion Helper
// ============================================================================

// Convert UTC/Zulu time to local browser time
const utcToLocal = (utcTime) => {
  if (!utcTime) return null;
  
  try {
    let date;
    
    // Handle various input formats
    if (typeof utcTime === 'number') {
      // Unix timestamp (milliseconds or seconds)
      date = new Date(utcTime > 1e12 ? utcTime : utcTime * 1000);
    } else if (typeof utcTime === 'string') {
      // Check for Zulu/Z suffix or explicit UTC
      if (utcTime.endsWith('Z') || utcTime.includes('UTC') || utcTime.includes('+00:00')) {
        date = new Date(utcTime);
      } else if (/^\d{6}Z?$/.test(utcTime)) {
        // Format: DDHHMMz (common in aviation)
        const now = new Date();
        const day = parseInt(utcTime.slice(0, 2), 10);
        const hour = parseInt(utcTime.slice(2, 4), 10);
        const min = parseInt(utcTime.slice(4, 6), 10);
        date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, hour, min));
      } else if (/^\d{4}-\d{2}-\d{2}/.test(utcTime)) {
        // ISO format without timezone - assume UTC
        date = new Date(utcTime + (utcTime.includes('T') ? 'Z' : 'T00:00:00Z'));
      } else {
        date = new Date(utcTime);
      }
    } else {
      return null;
    }
    
    // Validate the date
    if (isNaN(date.getTime()) || date.getTime() < 946684800000) { // Before Jan 1, 2000
      return null;
    }
    
    // Return formatted local time
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
const utcToLocalTime = (utcTime) => {
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

// ============================================================================
// METAR Decoder
// ============================================================================

const decodeMetar = (metar) => {
  if (!metar) return null;
  
  // Parse time - handle both ISO strings and timestamps
  let timeStr = '';
  if (metar.obsTime) {
    timeStr = utcToLocal(metar.obsTime) || metar.obsTime;
  }
  
  const decoded = {
    raw: metar.rawOb || '',
    station: metar.stationId || metar.icaoId || '',
    time: timeStr || 'Unknown',
    flightCategory: metar.fltCat || 'VFR',
    flightCategoryDesc: {
      'VFR': 'Visual Flight Rules - Good visibility (>5mi), ceiling >3000ft',
      'MVFR': 'Marginal VFR - Reduced visibility (3-5mi) or ceiling 1000-3000ft',
      'IFR': 'Instrument Flight Rules - Low visibility (1-3mi) or ceiling 500-1000ft',
      'LIFR': 'Low IFR - Very low visibility (<1mi) or ceiling <500ft'
    }[metar.fltCat] || 'Unknown conditions',
    wind: null,
    visibility: null,
    weather: [],
    clouds: [],
    temperature: null,
    dewpoint: null,
    altimeter: null,
    remarks: []
  };
  
  // Wind decoding - check for actual values
  if ((metar.wdir !== undefined && metar.wdir !== null) || 
      (metar.wspd !== undefined && metar.wspd !== null && !isNaN(metar.wspd))) {
    const dir = metar.wdir === 0 || metar.wdir === null ? 'Variable' : `${metar.wdir}°`;
    const spd = metar.wspd || 0;
    const gust = metar.wgst ? ` gusting ${metar.wgst}kt` : '';
    decoded.wind = {
      text: `${dir} at ${spd}kt${gust}`,
      direction: metar.wdir,
      speed: spd,
      gust: metar.wgst,
      description: spd === 0 ? 'Calm winds' : 
                   spd < 10 ? 'Light winds' :
                   spd < 20 ? 'Moderate winds' :
                   spd < 30 ? 'Strong winds' : 'High winds'
    };
  }
  
  // Visibility decoding
  if (metar.visib !== undefined) {
    decoded.visibility = {
      value: metar.visib,
      unit: 'SM',
      description: metar.visib >= 10 ? 'Unlimited visibility' :
                   metar.visib >= 5 ? 'Good visibility' :
                   metar.visib >= 3 ? 'Moderate visibility' :
                   metar.visib >= 1 ? 'Low visibility' : 'Very low visibility'
    };
  }
  
  // Weather phenomena decoding
  const wxCodes = {
    'RA': 'Rain', 'SN': 'Snow', 'DZ': 'Drizzle', 'SG': 'Snow grains',
    'IC': 'Ice crystals', 'PL': 'Ice pellets', 'GR': 'Hail', 'GS': 'Small hail',
    'UP': 'Unknown precip', 'FG': 'Fog', 'BR': 'Mist', 'HZ': 'Haze',
    'FU': 'Smoke', 'VA': 'Volcanic ash', 'DU': 'Dust', 'SA': 'Sand',
    'PY': 'Spray', 'SQ': 'Squall', 'FC': 'Funnel cloud', 'SS': 'Sandstorm',
    'DS': 'Duststorm', 'TS': 'Thunderstorm', 'SH': 'Showers',
    'FZ': 'Freezing', 'MI': 'Shallow', 'PR': 'Partial', 'BC': 'Patches',
    'DR': 'Drifting', 'BL': 'Blowing', 'VC': 'Vicinity'
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
      description: desc.trim() || wx
    });
  }
  
  // Cloud decoding
  const cloudCover = {
    'SKC': 'Clear sky',
    'CLR': 'Clear below 12,000ft',
    'FEW': 'Few clouds (1-2 oktas)',
    'SCT': 'Scattered clouds (3-4 oktas)',
    'BKN': 'Broken clouds (5-7 oktas)',
    'OVC': 'Overcast (8 oktas)',
    'VV': 'Vertical visibility (obscured)'
  };
  
  if (metar.clouds && metar.clouds.length > 0) {
    decoded.clouds = metar.clouds.map(c => ({
      cover: c.cover,
      coverDesc: cloudCover[c.cover] || c.cover,
      base: c.base,
      baseDesc: `${c.base?.toLocaleString() || '?'} ft AGL`
    }));
  }
  
  // Temperature - check for actual number
  if (metar.temp !== undefined && metar.temp !== null && !isNaN(metar.temp)) {
    decoded.temperature = {
      celsius: metar.temp,
      fahrenheit: Math.round(metar.temp * 9/5 + 32),
      description: metar.temp < 0 ? 'Below freezing' :
                   metar.temp < 10 ? 'Cold' :
                   metar.temp < 20 ? 'Cool' :
                   metar.temp < 30 ? 'Warm' : 'Hot'
    };
  }
  
  // Dewpoint - check for actual number
  if (metar.dewp !== undefined && metar.dewp !== null && !isNaN(metar.dewp)) {
    decoded.dewpoint = {
      celsius: metar.dewp,
      fahrenheit: Math.round(metar.dewp * 9/5 + 32)
    };
    // Calculate spread
    if (metar.temp !== undefined && metar.temp !== null && !isNaN(metar.temp)) {
      const spread = metar.temp - metar.dewp;
      decoded.dewpoint.spread = spread;
      decoded.dewpoint.fogRisk = spread <= 3 ? 'High fog/mist risk' :
                                  spread <= 5 ? 'Moderate fog risk' : 'Low fog risk';
    }
  }
  
  // Altimeter
  if (metar.altim !== undefined) {
    const inhg = (metar.altim / 100).toFixed(2);
    decoded.altimeter = {
      inhg: inhg,
      mb: Math.round(metar.altim * 0.338639),
      description: metar.altim > 3000 ? 'High pressure' :
                   metar.altim < 2970 ? 'Low pressure' : 'Normal pressure'
    };
  }
  
  return decoded;
};

// ============================================================================
// PIREP Decoder
// ============================================================================

const decodePirep = (pirep) => {
  if (!pirep) return null;
  
  const raw = pirep.rawOb || '';
  
  // Parse raw PIREP string to extract fields when API data is missing
  // Format: STATION TYPE /OV location /TM time /FL level /TP aircraft /SK sky /TB turb /IC ice /TA temp /WV wind /RM remarks
  const parseRawPirep = (rawStr) => {
    const parsed = {};
    
    // Extract time from /TM field (HHMM format)
    const tmMatch = rawStr.match(/\/TM\s*(\d{4})/);
    if (tmMatch) {
      const hh = tmMatch[1].substring(0, 2);
      const mm = tmMatch[1].substring(2, 4);
      parsed.timeStr = `${hh}:${mm}Z`;
    }
    
    // Extract location from /OV field
    const ovMatch = rawStr.match(/\/OV\s+([A-Z0-9]+)/);
    if (ovMatch) {
      parsed.location = ovMatch[1];
    }
    
    // Extract sky condition from /SK field
    const skMatch = rawStr.match(/\/SK\s+([^\/]+)/);
    if (skMatch) {
      parsed.sky = skMatch[1].trim();
    }
    
    // Extract turbulence from /TB field
    const tbMatch = rawStr.match(/\/TB\s+([^\/]+)/);
    if (tbMatch) {
      parsed.turbulence = tbMatch[1].trim();
    }
    
    // Extract icing from /IC field
    const icMatch = rawStr.match(/\/IC\s+([^\/]+)/);
    if (icMatch) {
      parsed.icing = icMatch[1].trim();
    }
    
    // Extract temperature from /TA field
    const taMatch = rawStr.match(/\/TA\s*(M?\d+)/);
    if (taMatch) {
      let temp = taMatch[1];
      if (temp.startsWith('M')) {
        parsed.temp = -parseInt(temp.substring(1), 10);
      } else {
        parsed.temp = parseInt(temp, 10);
      }
    }
    
    // Extract wind from /WV field
    const wvMatch = rawStr.match(/\/WV\s*(\d{3})[\s\/]?(\d{2,3})/);
    if (wvMatch) {
      parsed.wdir = parseInt(wvMatch[1], 10);
      parsed.wspd = parseInt(wvMatch[2], 10);
    }
    
    // Extract remarks from /RM field
    const rmMatch = rawStr.match(/\/RM\s+(.+?)(?:\/|$)/);
    if (rmMatch) {
      parsed.remarks = rmMatch[1].trim();
    }
    
    // Extract wind shear from /WS field (or from remarks/turbulence mentioning LLWS)
    const wsMatch = rawStr.match(/\/WS\s+([^\/]+)/);
    if (wsMatch) {
      parsed.windshear = wsMatch[1].trim();
    } else if (rawStr.includes('LLWS') || rawStr.includes('WSHFT')) {
      // Extract LLWS info from the raw string
      const llwsMatch = rawStr.match(/LLWS[^\/]*/i);
      if (llwsMatch) {
        parsed.windshear = llwsMatch[0].trim();
      }
    }
    
    return parsed;
  };
  
  const rawParsed = parseRawPirep(raw);
  
  // Parse time - try multiple sources and convert to local
  let timeStr = null;
  if (rawParsed.timeStr) {
    // Try to convert raw time string to local time
    timeStr = utcToLocalTime(rawParsed.timeStr) || rawParsed.timeStr;
  } else if (pirep.obsTime) {
    timeStr = utcToLocal(pirep.obsTime);
  }
  
  // Use API data first, fall back to parsed raw data
  const turbStr = pirep.turbulence || rawParsed.turbulence;
  const iceStr = pirep.icing || rawParsed.icing;
  const tempVal = (pirep.temp !== undefined && pirep.temp !== null && !isNaN(pirep.temp)) ? pirep.temp : rawParsed.temp;
  const wdirVal = (pirep.wdir !== undefined && pirep.wdir !== null && !isNaN(pirep.wdir)) ? pirep.wdir : rawParsed.wdir;
  const wspdVal = (pirep.wspd !== undefined && pirep.wspd !== null && !isNaN(pirep.wspd)) ? pirep.wspd : rawParsed.wspd;
  const windshearStr = rawParsed.windshear || (turbStr && turbStr.toUpperCase().includes('LLWS') ? turbStr : null);
  
  const decoded = {
    raw: raw,
    type: pirep.pirepType || (raw.includes(' UUA ') ? 'UUA' : 'UA'),
    typeDesc: (pirep.pirepType === 'UUA' || raw.includes(' UUA ')) ? 'URGENT Pilot Report' : 'Routine Pilot Report',
    time: timeStr,
    aircraft: pirep.acType || null,
    altitude: null,
    location: rawParsed.location || null,
    sky: null,
    turbulence: null,
    icing: null,
    windshear: null,
    weather: null,
    temperature: null,
    wind: null,
    remarks: rawParsed.remarks || null
  };
  
  // Altitude/Flight Level
  if (pirep.fltLvl !== undefined && pirep.fltLvl !== null && !isNaN(pirep.fltLvl)) {
    const altFt = pirep.fltLvl * 100;
    decoded.altitude = {
      flightLevel: pirep.fltLvl,
      feet: altFt,
      text: `FL${pirep.fltLvl} (${altFt.toLocaleString()}ft)`
    };
  }
  
  // Sky condition decoding
  const skyConditions = {
    'SKC': 'Sky clear', 'CLR': 'Clear', 'FEW': 'Few clouds', 'SCT': 'Scattered',
    'BKN': 'Broken', 'OVC': 'Overcast', 'TOP': 'Tops', 'TO': 'Tops at', 'P': 'FL'
  };
  
  const skyStr = rawParsed.sky;
  if (skyStr) {
    let skyDesc = skyStr;
    // Parse "TO P190" format (tops at FL190)
    const topsMatch = skyStr.match(/TO\s*P?(\d{3})/i);
    if (topsMatch) {
      const fl = parseInt(topsMatch[1], 10);
      skyDesc = `Cloud tops at FL${fl} (${(fl * 100).toLocaleString()}ft)`;
    }
    decoded.sky = { raw: skyStr, description: skyDesc };
  }
  
  // Turbulence decoding
  const turbIntensity = {
    'NEG': { level: 0, desc: 'None', detail: 'Smooth flight, no turbulence' },
    'SMTH': { level: 0, desc: 'Smooth', detail: 'Smooth flight, no turbulence' },
    'LGT': { level: 1, desc: 'Light', detail: 'Slight, erratic changes in altitude/attitude' },
    'LGT-MOD': { level: 2, desc: 'Light-Moderate', detail: 'Changes in altitude/attitude, aircraft remains in control' },
    'MOD': { level: 3, desc: 'Moderate', detail: 'Greater intensity, aircraft remains in positive control' },
    'MOD-SEV': { level: 4, desc: 'Moderate-Severe', detail: 'Large, abrupt changes, large airspeed variations' },
    'SEV': { level: 5, desc: 'Severe', detail: 'Aircraft may be momentarily out of control' },
    'EXTRM': { level: 6, desc: 'Extreme', detail: 'Aircraft violently tossed, practically impossible to control' }
  };
  
  const turbType = {
    'CAT': 'Clear Air Turbulence', 'CHOP': 'Chop', 'LLWS': 'Low Level Wind Shear', 'MWAVE': 'Mountain Wave'
  };
  
  if (turbStr) {
    const turb = turbStr.toUpperCase();
    let intensity = null;
    let type = null;
    
    // Check for combined intensities first (longer matches)
    ['LGT-MOD', 'MOD-SEV'].forEach(code => {
      if (turb.includes(code)) intensity = turbIntensity[code];
    });
    if (!intensity) {
      ['NEG', 'SMTH', 'LGT', 'MOD', 'SEV', 'EXTRM'].forEach(code => {
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
      warning: intensity?.level >= 4 ? '⚠️ HAZARDOUS - Avoid if possible' :
               intensity?.level >= 3 ? '⚡ Use caution' : ''
    };
  }
  
  // Icing decoding
  const iceIntensity = {
    'NEG': { level: 0, desc: 'None', detail: 'No icing observed' },
    'TRC': { level: 1, desc: 'Trace', detail: 'Ice becomes noticeable' },
    'LGT': { level: 2, desc: 'Light', detail: 'May create problem with prolonged exposure' },
    'MOD': { level: 3, desc: 'Moderate', detail: 'Short encounters potentially hazardous' },
    'SEV': { level: 4, desc: 'Severe', detail: 'De-icing/anti-icing fails to control hazard' }
  };
  
  const iceType = {
    'RIME': 'Rime ice', 'CLR': 'Clear ice', 'MXD': 'Mixed ice'
  };
  
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
      warning: intensity?.level >= 3 ? '⚠️ HAZARDOUS - Avoid if possible' :
               intensity?.level >= 2 ? '❄️ Use caution, check anti-ice' : ''
    };
  }
  
  // Wind Shear / LLWS decoding
  const wsIntensity = {
    'NEG': { level: 0, desc: 'None', detail: 'No wind shear observed' },
    'LGT': { level: 1, desc: 'Light', detail: 'Airspeed changes 15-25kt' },
    'MOD': { level: 2, desc: 'Moderate', detail: 'Airspeed changes 25-40kt' },
    'SEV': { level: 3, desc: 'Severe', detail: 'Airspeed changes >40kt, potential loss of control' }
  };
  
  if (windshearStr) {
    const ws = windshearStr.toUpperCase();
    let intensity = null;
    let gainLoss = null;
    
    Object.entries(wsIntensity).forEach(([code, info]) => {
      if (ws.includes(code) && !intensity) intensity = info;
    });
    
    // Check for gain/loss indicators
    if (ws.includes('+') || ws.includes('GAIN')) gainLoss = 'Gain';
    if (ws.includes('-') || ws.includes('LOSS')) gainLoss = 'Loss';
    
    // Extract altitude range if present (e.g., "LLWS 020-030")
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
      level: intensity?.level || 2, // Default to moderate if unspecified
      detail: intensity?.detail || 'Low Level Wind Shear reported',
      gainLoss: gainLoss,
      altRange: altRange,
      warning: intensity?.level >= 3 ? '⚠️ SEVERE - Avoid area' :
               intensity?.level >= 2 ? '💨 CAUTION - Wind shear reported' :
               '💨 Wind shear reported'
    };
  }
  
  // Weather conditions
  if (pirep.wxString) {
    decoded.weather = { raw: pirep.wxString, description: pirep.wxString };
  }
  
  // Temperature at altitude
  if (tempVal !== undefined && tempVal !== null && !isNaN(tempVal)) {
    decoded.temperature = {
      celsius: tempVal,
      fahrenheit: Math.round(tempVal * 9/5 + 32),
      isaDeviation: pirep.fltLvl ? Math.round(tempVal - (15 - (pirep.fltLvl * 100 * 0.00198))) : null
    };
  }
  
  // Wind at altitude
  if (wdirVal !== undefined && wdirVal !== null && !isNaN(wdirVal) &&
      wspdVal !== undefined && wspdVal !== null && !isNaN(wspdVal)) {
    decoded.wind = {
      direction: wdirVal,
      speed: wspdVal,
      text: `${wdirVal}° at ${wspdVal}kt`
    };
  }
  
  return decoded;
};

// ============================================================================
// Alert handling
// ============================================================================

const handleAlertTriggered = (alertData) => {
  const history = JSON.parse(localStorage.getItem('alert-history') || '[]');
  history.unshift({
    ...alertData,
    id: Date.now(),
    timestamp: new Date().toISOString()
  });
  localStorage.setItem('alert-history', JSON.stringify(history.slice(0, 100)));

  // Check if browser notifications are enabled in config
  const config = getConfig();
  if (Notification.permission === 'granted' && config.browserNotifications) {
    new Notification(alertData.rule_name || 'ADS-B Alert', {
      body: alertData.message || `Aircraft ${alertData.icao} triggered alert`,
      icon: '/static/favicon.svg',
      tag: `alert-${alertData.icao}`,
      requireInteraction: alertData.priority === 'emergency'
    });
  }
};

// ============================================================================
// Custom Hooks
// ============================================================================

// Normalize aircraft data to handle different API field names
const normalizeAircraft = (data) => {
  const hex = data.hex || data.icao || data.icao_hex || '';
  return {
    hex: hex.toUpperCase(),
    flight: data.flight || data.callsign || data.call || null,
    type: data.type || data.t || data.aircraft_type || null,
    alt: data.alt || data.altitude || data.alt_baro || data.alt_geom || null,
    gs: data.gs || data.ground_speed || data.speed || null,
    track: data.track || data.heading || data.trk || null,
    vr: data.vr || data.vertical_rate || data.baro_rate || data.geom_rate || null,
    lat: data.lat || data.latitude || null,
    lon: data.lon || data.longitude || data.lng || null,
    squawk: data.squawk || null,
    seen: data.seen || 0,
    distance_nm: data.distance_nm || data.distance || null,
    military: data.military || false,
    emergency: data.emergency || false
  };
};

// Socket.IO hook for all real-time data (aircraft, safety, alerts, etc.)
// Also supports request/response pattern for on-demand data fetching via emit with ack
function useWebSocket(enabled, apiBase, topics = 'all') {
  const [aircraft, setAircraft] = useState({});
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState({ count: 0 });
  const [safetyEvents, setSafetyEvents] = useState([]);
  const socketRef = useRef(null);
  const mountedRef = useRef(true);
  const pendingRequests = useRef(new Map());

  useEffect(() => {
    if (!enabled) return;

    mountedRef.current = true;

    // Build Socket.IO URL
    let socketUrl;
    if (apiBase) {
      try {
        const url = new URL(apiBase, window.location.origin);
        socketUrl = `${url.protocol}//${url.host}`;
      } catch (e) {
        socketUrl = window.location.origin;
      }
    } else {
      socketUrl = window.location.origin;
    }

    console.log('Socket.IO connecting to:', socketUrl);

    // Create Socket.IO connection
    const socket = io(socketUrl, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      timeout: 20000,
      query: { topics },
    });

    socketRef.current = socket;

    // Connection events
    socket.on('connect', () => {
      console.log('Socket.IO connected:', socket.id);
      setConnected(true);

      // Subscribe to topics
      socket.emit('subscribe', { topics: topics.split(',').map(t => t.trim()) });
    });

    socket.on('disconnect', (reason) => {
      console.log('Socket.IO disconnected:', reason);
      setConnected(false);
    });

    socket.on('connect_error', (error) => {
      console.error('Socket.IO connection error:', error);
    });

    // Aircraft events (Socket.IO uses colon-separated event names)
    socket.on('aircraft:snapshot', (data) => {
      console.log('Aircraft snapshot received:', data?.aircraft?.length || 0, 'aircraft');
      if (data?.aircraft && Array.isArray(data.aircraft)) {
        const newAircraft = {};
        data.aircraft.forEach(ac => {
          const normalized = normalizeAircraft(ac);
          if (normalized.hex) {
            newAircraft[normalized.hex] = normalized;
          }
        });
        setAircraft(newAircraft);
        setStats(prev => ({ ...prev, count: Object.keys(newAircraft).length }));
      }
    });

    socket.on('aircraft:update', (data) => {
      if (data?.aircraft && Array.isArray(data.aircraft)) {
        setAircraft(prev => {
          const updated = { ...prev };
          data.aircraft.forEach(ac => {
            const normalized = normalizeAircraft(ac);
            if (normalized.hex) {
              updated[normalized.hex] = { ...updated[normalized.hex], ...normalized };
            }
          });
          return updated;
        });
      } else if (data) {
        const normalized = normalizeAircraft(data);
        if (normalized.hex) {
          setAircraft(prev => ({
            ...prev,
            [normalized.hex]: { ...prev[normalized.hex], ...normalized }
          }));
        }
      }
    });

    socket.on('aircraft:new', (data) => {
      if (data?.aircraft && Array.isArray(data.aircraft)) {
        data.aircraft.forEach(ac => {
          const normalized = normalizeAircraft(ac);
          if (normalized.hex) {
            console.log('Socket.IO aircraft:new:', normalized.hex, normalized.flight);
            setAircraft(prev => ({ ...prev, [normalized.hex]: normalized }));
          }
        });
      } else if (data) {
        const normalized = normalizeAircraft(data);
        if (normalized.hex) {
          console.log('Socket.IO aircraft:new:', normalized.hex, normalized.flight);
          setAircraft(prev => ({ ...prev, [normalized.hex]: normalized }));
        }
      }
    });

    socket.on('aircraft:remove', (data) => {
      const icaos = data?.icaos || [];
      if (icaos.length > 0) {
        console.log('Socket.IO aircraft:remove:', icaos);
        setAircraft(prev => {
          const next = { ...prev };
          icaos.forEach(icao => {
            if (icao) delete next[icao.toUpperCase()];
          });
          return next;
        });
      }
    });

    // Heartbeat
    socket.on('aircraft:heartbeat', (data) => {
      setStats(prev => ({
        ...prev,
        count: data?.count ?? prev.count,
        timestamp: data?.timestamp
      }));
    });

    // Safety events
    socket.on('safety:event', (data) => {
      if (data) {
        console.log('Socket.IO safety:event:', data);
        setSafetyEvents(prev => [data, ...prev].slice(0, 100));
      }
    });

    // Alerts
    socket.on('alert:triggered', (data) => {
      if (data) {
        console.log('Socket.IO alert:triggered:', data);
        handleAlertTriggered(data);
      }
    });

    // ACARS
    socket.on('acars:message', (data) => {
      console.log('Socket.IO acars:message:', data);
    });

    // Airspace events
    socket.on('airspace:snapshot', (data) => {
      // Airspace data received on connect
    });

    socket.on('airspace:update', (data) => {
      // Airspace data updated
    });

    socket.on('airspace:advisory', (data) => {
      // Advisory update
    });

    socket.on('airspace:boundary', (data) => {
      // Boundary update
    });

    // Request/response events
    socket.on('response', (data) => {
      if (data.request_id && pendingRequests.current.has(data.request_id)) {
        const { resolve, timeout } = pendingRequests.current.get(data.request_id);
        clearTimeout(timeout);
        pendingRequests.current.delete(data.request_id);
        resolve(data.data);
      }
    });

    socket.on('error', (data) => {
      if (data.request_id && pendingRequests.current.has(data.request_id)) {
        const { reject, timeout } = pendingRequests.current.get(data.request_id);
        clearTimeout(timeout);
        pendingRequests.current.delete(data.request_id);
        reject(new Error(data.error || 'Request failed'));
      }
    });

    // Cleanup
    return () => {
      console.log('Socket.IO cleanup');
      mountedRef.current = false;
      if (socket) {
        socket.disconnect();
        socketRef.current = null;
      }
    };
  }, [enabled, apiBase, topics]);

  // Request function for on-demand data fetching via Socket.IO
  const request = useCallback((type, params = {}, timeoutMs = 10000) => {
    return new Promise((resolve, reject) => {
      if (!socketRef.current || !socketRef.current.connected) {
        reject(new Error('Socket.IO not connected'));
        return;
      }

      const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Set timeout for request
      const timeout = setTimeout(() => {
        if (pendingRequests.current.has(requestId)) {
          pendingRequests.current.delete(requestId);
          reject(new Error(`Request timeout: ${type}`));
        }
      }, timeoutMs);

      // Store pending request
      pendingRequests.current.set(requestId, { resolve, reject, timeout });

      // Emit request via Socket.IO
      socketRef.current.emit('request', {
        type,
        request_id: requestId,
        params,
      });
    });
  }, []);

  return {
    aircraft: Object.values(aircraft),
    connected,
    stats,
    safetyEvents,
    request, // Expose request function for on-demand data fetching
  };
}

function useApi(endpoint, interval = null, apiBase = '') {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const baseUrl = apiBase || '';
      const res = await fetch(`${baseUrl}${endpoint}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [endpoint, apiBase]);

  useEffect(() => {
    fetchData();
    if (interval) {
      const id = setInterval(fetchData, interval);
      return () => clearInterval(id);
    }
  }, [fetchData, interval]);

  return { data, loading, error, refetch: fetchData };
}

// ============================================================================
// Components
// ============================================================================

function Sidebar({ activeTab, setActiveTab, connected, collapsed, setCollapsed }) {
  const [servicesExpanded, setServicesExpanded] = useState(false);
  
  const tabs = [
    { id: 'map', icon: Radar, label: 'Live Map' },
    { id: 'aircraft', icon: Plane, label: 'Aircraft List' },
    { id: 'stats', icon: BarChart3, label: 'Statistics' },
    { id: 'history', icon: History, label: 'History' },
    { id: 'alerts', icon: Bell, label: 'Alerts' },
    { id: 'system', icon: Activity, label: 'System' }
  ];

  const externalServices = [
    { id: 'tar1090', icon: MapIcon, label: 'tar1090', path: '/tar1090/', desc: 'ADS-B Map' },
    { id: 'graphs', icon: LineChart, label: 'Graphs1090', path: '/graphs1090/', desc: 'Statistics' },
    { id: 'piaware', icon: Plane, label: 'PiAware', path: '/piaware/', desc: 'FlightAware' },
    { id: 'uat', icon: Radio, label: 'UAT 978', path: '/uat/', desc: 'UAT Receiver' },
    { id: 'acars', icon: MessageSquare, label: 'ACARS', path: '/acars/', desc: 'ACARS Hub' },
    { id: 'ais', icon: Ship, label: 'AIS', path: '/ais/', desc: 'Ship Tracking' },
    { id: 'grafana', icon: LayoutDashboard, label: 'Grafana', path: '/grafana/', desc: 'Dashboards' },
    { id: 'prometheus', icon: Database, label: 'Prometheus', path: '/prometheus/', desc: 'Metrics' },
  ];

  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="logo">
          <img src="/static/logo.png" alt="SkySpy" className="logo-image" />
          {!collapsed && (
            <span className="logo-text">
              <span className="logo-sky">Sky</span>
              <span className="logo-spy">Spy</span>
            </span>
          )}
        </div>
      </div>

      <button 
        className="sidebar-toggle"
        onClick={() => setCollapsed(!collapsed)}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>

      <nav className="sidebar-nav">
        {tabs.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            className={`nav-item ${activeTab === id ? 'active' : ''}`}
            onClick={() => setActiveTab(id)}
            title={collapsed ? label : undefined}
          >
            <Icon size={18} />
            {!collapsed && <span>{label}</span>}
          </button>
        ))}

        {/* External Services Section */}
        <div className="nav-divider" />
        
        <button
          className={`nav-item services-toggle ${servicesExpanded ? 'expanded' : ''}`}
          onClick={() => setServicesExpanded(!servicesExpanded)}
          title={collapsed ? 'External Services' : undefined}
        >
          <Layers size={18} />
          {!collapsed && (
            <>
              <span>Services</span>
              <ChevronDown size={14} className={`toggle-icon ${servicesExpanded ? 'rotated' : ''}`} />
            </>
          )}
        </button>

        {(servicesExpanded || collapsed) && (
          <div className={`services-list ${collapsed ? 'collapsed-services' : ''}`}>
            {externalServices.map(({ id, icon: Icon, label, path, desc }) => (
              <a
                key={id}
                href={path}
                target="_blank"
                rel="noopener noreferrer"
                className="nav-item service-link"
                title={collapsed ? `${label} - ${desc}` : desc}
              >
                <Icon size={16} />
                {!collapsed && <span>{label}</span>}
                {!collapsed && <ExternalLink size={12} className="external-icon" />}
              </a>
            ))}
          </div>
        )}
      </nav>

      <div className="sidebar-footer">
        {!collapsed ? (
          <>
            <div className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
              <span className="status-dot" />
              <span>{connected ? 'LIVE' : 'OFFLINE'}</span>
            </div>
            <div className="footer-info">
              <div className="version">v2.5.0</div>
              <div className="copyright">© CHAOS.CORP</div>
            </div>
          </>
        ) : (
          <>
            <div className={`connection-dot ${connected ? 'connected' : 'disconnected'}`} title={connected ? 'Connected' : 'Disconnected'}>
              <span className="status-dot" />
            </div>
            <div className="version-mini">2.5</div>
          </>
        )}
      </div>
    </div>
  );
}

function Header({ stats, location, config, setConfig, setShowSettings }) {
  const [time, setTime] = useState(new Date());
  const [notifPermission, setNotifPermission] = useState(
    'Notification' in window ? Notification.permission : 'denied'
  );

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const handleNotifToggle = async () => {
    if (notifPermission === 'granted') {
      const newConfig = { ...config, browserNotifications: !config.browserNotifications };
      setConfig(newConfig);
      saveConfig(newConfig);
    } else if (notifPermission === 'default') {
      const permission = await Notification.requestPermission();
      setNotifPermission(permission);
      if (permission === 'granted') {
        const newConfig = { ...config, browserNotifications: true };
        setConfig(newConfig);
        saveConfig(newConfig);
      }
    }
  };

  return (
    <header className="header">
      <div className="header-stats">
        <div className="stat-item">
          <Plane size={16} />
          <span className="stat-value">{stats.count || 0}</span>
          <span className="stat-label">Aircraft</span>
        </div>
        <div className="stat-item">
          <MapPin size={16} />
          <span className="stat-value">{location?.lat?.toFixed(4) || '--'}</span>
          <span className="stat-label">Lat</span>
        </div>
        <div className="stat-item">
          <MapPin size={16} />
          <span className="stat-value">{location?.lon?.toFixed(4) || '--'}</span>
          <span className="stat-label">Lon</span>
        </div>
      </div>
      <div className="header-actions">
        <button
          className={`header-btn ${notifPermission === 'granted' && config.browserNotifications ? 'notifications-granted' : ''}`}
          onClick={handleNotifToggle}
          title={notifPermission === 'granted' ? 'Browser notifications enabled' : 'Enable browser notifications'}
        >
          {notifPermission === 'granted' && config.browserNotifications ? <BellRing size={16} /> : <BellOff size={16} />}
        </button>
        <button className="header-btn" onClick={() => setShowSettings(true)}>
          <Settings size={16} />
        </button>
        <div className="header-time">
          <Clock size={14} />
          <span>{time.toUTCString().slice(17, 25)} UTC</span>
        </div>
      </div>
    </header>
  );
}

function SettingsModal({ config, setConfig, onClose }) {
  const [form, setForm] = useState(config);

  const handleSave = () => {
    setConfig(form);
    saveConfig(form);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Settings</h3>
          <button onClick={onClose}><X size={20} /></button>
        </div>
        <div className="modal-content">
          <div className="settings-grid">
            <div className="settings-section">
              <h4>API Configuration</h4>
              <div className="form-group">
                <label>API Base URL</label>
                <input
                  type="text"
                  value={form.apiBaseUrl}
                  onChange={e => setForm({ ...form, apiBaseUrl: e.target.value })}
                  placeholder="Leave empty for same origin"
                />
              </div>
            </div>

            <div className="settings-section">
              <h4>Map Display</h4>
              <div className="form-row">
                <div className="form-group">
                  <label>Map Mode</label>
                  <select
                    value={form.mapMode}
                    onChange={e => setForm({ ...form, mapMode: e.target.value })}
                  >
                    <option value="pro">Pro View</option>
                    <option value="radar">Radar View</option>
                    <option value="crt">ATC Radar (CRT)</option>
                    <option value="map">Map View</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Map Theme</label>
                  <select
                    value={form.mapDarkMode ? 'dark' : 'light'}
                    onChange={e => setForm({ ...form, mapDarkMode: e.target.value === 'dark' })}
                  >
                    <option value="dark">Dark Mode</option>
                    <option value="light">Light Mode</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={handleSave}>Save Settings</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Aircraft Detail Page Component
// ============================================================================

function AircraftDetailPage({ hex, apiUrl, onClose, aircraft, aircraftInfo }) {
  const [info, setInfo] = useState(aircraftInfo || null);
  const [photoInfo, setPhotoInfo] = useState(null);
  const [acarsMessages, setAcarsMessages] = useState([]);
  const [sightings, setSightings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('info');
  const [photoState, setPhotoState] = useState('loading'); // 'loading', 'loaded', 'error'
  const [photoRetryCount, setPhotoRetryCount] = useState(0);
  
  const baseUrl = apiUrl || '';
  const photoUrl = `${baseUrl}/api/v1/aircraft/${hex}/photo/download${photoRetryCount > 0 ? `?t=${photoRetryCount}` : ''}`;
  
  // Reset photo state when hex changes
  useEffect(() => {
    setPhotoState('loading');
    setPhotoRetryCount(0);
  }, [hex]);
  
  const retryPhoto = () => {
    setPhotoState('loading');
    setPhotoRetryCount(c => c + 1);
  };
  
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      
      try {
        // Fetch aircraft info if not provided
        if (!info) {
          const infoRes = await fetch(`${baseUrl}/api/v1/aircraft/${hex}/info`);
          if (infoRes.ok) {
            const data = await infoRes.json();
            setInfo(data);
          }
        }
        
        // Fetch photo metadata for photographer credit
        const photoMetaRes = await fetch(`${baseUrl}/api/v1/aircraft/${hex}/photo`);
        if (photoMetaRes.ok) {
          const data = await photoMetaRes.json();
          setPhotoInfo(data);
        }
        
        // Fetch ACARS messages for this aircraft
        const acarsRes = await fetch(`${baseUrl}/api/v1/acars/messages/${hex}?hours=24&limit=50`);
        if (acarsRes.ok) {
          const data = await acarsRes.json();
          setAcarsMessages(data.messages || []);
        }
        
        // Fetch sighting history
        const sightingsRes = await fetch(`${baseUrl}/api/v1/history/sightings/${hex}?hours=24&limit=100`);
        if (sightingsRes.ok) {
          const data = await sightingsRes.json();
          setSightings(data.sightings || []);
        }
      } catch (err) {
        console.log('Aircraft detail fetch error:', err.message);
      }
      
      setLoading(false);
    };
    
    fetchData();
  }, [hex, baseUrl, info]);
  
  const tailInfo = getTailInfo(hex, aircraft?.flight);
  
  return (
    <div className="aircraft-detail-page">
      <div className="detail-header">
        <div className="detail-header-left">
          <span className="detail-flag">{tailInfo.flag}</span>
          <div className="detail-titles">
            <h1 className="detail-callsign">{aircraft?.flight?.trim() || hex?.toUpperCase()}</h1>
            <div className="detail-subtitles">
              <span className="detail-hex">{hex?.toUpperCase()}</span>
              {tailInfo.tailNumber && <span className="detail-tail">{tailInfo.tailNumber}</span>}
              {info?.registration && <span className="detail-reg">{info.registration}</span>}
            </div>
          </div>
        </div>
        <button className="detail-close" onClick={onClose}>
          <X size={24} />
        </button>
      </div>
      
      {/* Photo Banner - Using cached photo API */}
      <div className="detail-photo">
        {photoState === 'loading' && (
          <div className="photo-loading">
            <RefreshCw size={32} className="spin" />
            <span>Loading photo...</span>
          </div>
        )}
        {photoState === 'error' && (
          <div className="photo-error">
            <Camera size={48} />
            <span>No photo available</span>
            <button className="photo-retry-btn" onClick={retryPhoto}>
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        )}
        {photoState !== 'error' && (
          <img 
            src={photoUrl} 
            alt={info?.registration || hex} 
            onLoad={() => setPhotoState('loaded')}
            onError={() => setPhotoState('error')}
            style={{ 
              opacity: photoState === 'loaded' ? 1 : 0,
              position: photoState === 'loading' ? 'absolute' : 'relative'
            }}
          />
        )}
        {photoState === 'loaded' && photoInfo?.photographer && (
          <span className="photo-credit">📷 {photoInfo.photographer} via {photoInfo.source || 'planespotters.net'}</span>
        )}
      </div>
      
      {/* Tab Navigation */}
      <div className="detail-tabs">
        <button 
          className={`detail-tab ${activeTab === 'info' ? 'active' : ''}`}
          onClick={() => setActiveTab('info')}
        >
          <Info size={16} /> Aircraft Info
        </button>
        <button 
          className={`detail-tab ${activeTab === 'live' ? 'active' : ''}`}
          onClick={() => setActiveTab('live')}
        >
          <Radar size={16} /> Live Status
        </button>
        <button 
          className={`detail-tab ${activeTab === 'acars' ? 'active' : ''}`}
          onClick={() => setActiveTab('acars')}
        >
          <MessageCircle size={16} /> ACARS ({acarsMessages.length})
        </button>
        <button 
          className={`detail-tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <History size={16} /> History
        </button>
      </div>
      
      <div className="detail-content">
        {loading ? (
          <div className="detail-loading">
            <RefreshCw size={32} className="spin" />
            <span>Loading aircraft data...</span>
          </div>
        ) : (
          <>
            {/* Aircraft Info Tab */}
            {activeTab === 'info' && info && (
              <div className="detail-info-grid">
                <div className="info-section">
                  <h3><Plane size={16} /> Airframe</h3>
                  <div className="info-rows">
                    {info.type_name && <div className="info-row"><span>Type</span><span>{info.type_name}</span></div>}
                    {info.type_code && <div className="info-row"><span>ICAO Code</span><span>{info.type_code}</span></div>}
                    {info.manufacturer && <div className="info-row"><span>Manufacturer</span><span>{info.manufacturer}</span></div>}
                    {info.model && <div className="info-row"><span>Model</span><span>{info.model}</span></div>}
                    {info.serial_number && <div className="info-row"><span>Serial #</span><span>{info.serial_number}</span></div>}
                    {info.year_built && <div className="info-row"><span>Year Built</span><span>{info.year_built}</span></div>}
                    {info.age_years && <div className="info-row"><span>Age</span><span>{info.age_years} years</span></div>}
                  </div>
                </div>
                
                <div className="info-section">
                  <h3><Building2 size={16} /> Operator</h3>
                  <div className="info-rows">
                    {info.operator && <div className="info-row"><span>Operator</span><span>{info.operator}</span></div>}
                    {info.operator_icao && <div className="info-row"><span>ICAO</span><span>{info.operator_icao}</span></div>}
                    {info.owner && <div className="info-row"><span>Owner</span><span>{info.owner}</span></div>}
                    {info.country && <div className="info-row"><span>Country</span><span>{info.country}</span></div>}
                  </div>
                </div>
                
                <div className="info-section">
                  <h3><Hash size={16} /> Registration</h3>
                  <div className="info-rows">
                    {info.registration && <div className="info-row"><span>Registration</span><span>{info.registration}</span></div>}
                    <div className="info-row"><span>ICAO Hex</span><span>{hex?.toUpperCase()}</span></div>
                    {info.is_military && <div className="info-row"><span>Type</span><span className="badge-military">Military</span></div>}
                    {info.category && <div className="info-row"><span>Category</span><span>{info.category}</span></div>}
                  </div>
                </div>
                
                {photoInfo && (
                  <div className="info-section">
                    <h3><Camera size={16} /> Photo</h3>
                    <div className="info-rows">
                      {photoInfo.photographer && <div className="info-row"><span>Photographer</span><span>{photoInfo.photographer}</span></div>}
                      {photoInfo.source && <div className="info-row"><span>Source</span><span>{photoInfo.source}</span></div>}
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {activeTab === 'info' && !info && (
              <div className="detail-empty">
                <Info size={48} />
                <p>No aircraft information available</p>
                <span>Data may not be available for this aircraft</span>
              </div>
            )}
            
            {/* Live Status Tab */}
            {activeTab === 'live' && aircraft && (
              <div className="detail-live">
                <div className="live-stats-grid">
                  <div className="live-stat">
                    <span className="live-label">Altitude</span>
                    <span className="live-value">{aircraft.alt_baro?.toLocaleString() || '--'}</span>
                    <span className="live-unit">ft</span>
                  </div>
                  <div className="live-stat">
                    <span className="live-label">Ground Speed</span>
                    <span className="live-value">{aircraft.gs?.toFixed(0) || '--'}</span>
                    <span className="live-unit">kts</span>
                  </div>
                  <div className="live-stat">
                    <span className="live-label">Vertical Rate</span>
                    <span className={`live-value ${(aircraft.baro_rate || 0) > 0 ? 'climbing' : (aircraft.baro_rate || 0) < 0 ? 'descending' : ''}`}>
                      {aircraft.baro_rate || '--'}
                    </span>
                    <span className="live-unit">ft/min</span>
                  </div>
                  <div className="live-stat">
                    <span className="live-label">Track</span>
                    <span className="live-value">{aircraft.track?.toFixed(0) || '--'}°</span>
                    <span className="live-unit">{getCardinalDirection(aircraft.track)}</span>
                  </div>
                  <div className="live-stat">
                    <span className="live-label">Distance</span>
                    <span className="live-value">{aircraft.distance_nm?.toFixed(1) || '--'}</span>
                    <span className="live-unit">nm</span>
                  </div>
                  <div className="live-stat">
                    <span className="live-label">Squawk</span>
                    <span className="live-value">{aircraft.squawk || '----'}</span>
                    <span className="live-unit"></span>
                  </div>
                </div>
                
                <div className="live-position">
                  <h4>Position</h4>
                  <div className="position-coords">
                    <span>Lat: {aircraft.lat?.toFixed(5) || '--'}</span>
                    <span>Lon: {aircraft.lon?.toFixed(5) || '--'}</span>
                  </div>
                </div>
              </div>
            )}
            
            {activeTab === 'live' && !aircraft && (
              <div className="detail-empty">
                <WifiOff size={48} />
                <p>Aircraft not currently tracked</p>
                <span>This aircraft is not in range of the receiver</span>
              </div>
            )}
            
            {/* ACARS Tab */}
            {activeTab === 'acars' && (
              <div className="detail-acars">
                {acarsMessages.length === 0 ? (
                  <div className="detail-empty">
                    <MessageCircle size={48} />
                    <p>No ACARS messages</p>
                    <span>No messages received from this aircraft in the last 24 hours</span>
                  </div>
                ) : (
                  <div className="acars-list">
                    {acarsMessages.map((msg, i) => (
                      <div key={i} className="acars-item">
                        <div className="acars-item-header">
                          <span className="acars-item-time">
                            {new Date(msg.timestamp).toLocaleString()}
                          </span>
                          <span className="acars-item-label">{msg.label || '--'}</span>
                          <span className="acars-item-source">{msg.source}</span>
                          {msg.frequency && <span className="acars-item-freq">{msg.frequency} MHz</span>}
                        </div>
                        {msg.text && <pre className="acars-item-text">{msg.text}</pre>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {/* History Tab */}
            {activeTab === 'history' && (
              <div className="detail-history">
                {sightings.length === 0 ? (
                  <div className="detail-empty">
                    <History size={48} />
                    <p>No sighting history</p>
                    <span>No position reports recorded in the last 24 hours</span>
                  </div>
                ) : (
                  <div className="history-stats">
                    <p>{sightings.length} position reports in the last 24 hours</p>
                    <div className="history-table">
                      <div className="history-row header">
                        <span>Time</span>
                        <span>Alt (ft)</span>
                        <span>Speed (kts)</span>
                        <span>Dist (nm)</span>
                      </div>
                      {sightings.slice(0, 50).map((s, i) => (
                        <div key={i} className="history-row">
                          <span>{new Date(s.timestamp).toLocaleTimeString()}</span>
                          <span>{s.altitude?.toLocaleString() || '--'}</span>
                          <span>{s.gs?.toFixed(0) || '--'}</span>
                          <span>{s.distance_nm?.toFixed(1) || '--'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      
      {/* External Links */}
      <div className="detail-links">
        <a href={`https://flightaware.com/live/flight/${aircraft?.flight?.trim() || hex}`} target="_blank" rel="noopener noreferrer">
          FlightAware <ExternalLink size={12} />
        </a>
        <a href={`https://globe.adsbexchange.com/?icao=${hex}`} target="_blank" rel="noopener noreferrer">
          ADSBexchange <ExternalLink size={12} />
        </a>
        <a href={`https://www.flightradar24.com/${hex}`} target="_blank" rel="noopener noreferrer">
          Flightradar24 <ExternalLink size={12} />
        </a>
        <a href={`https://planespotters.net/hex/${hex}`} target="_blank" rel="noopener noreferrer">
          Planespotters <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}

// Helper for cardinal direction
function getCardinalDirection(deg) {
  if (deg === null || deg === undefined) return '';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

function MapView({ aircraft, config, setConfig, feederLocation, safetyEvents: wsSafetyEvents, wsRequest, wsConnected }) {
  const [selectedAircraft, setSelectedAircraft] = useState(null);
  const [selectedMetar, setSelectedMetar] = useState(null);
  const [selectedPirep, setSelectedPirep] = useState(null);
  const [selectedNavaid, setSelectedNavaid] = useState(null);
  const [selectedAirport, setSelectedAirport] = useState(null);
  const [radarRange, setRadarRange] = useState(50); // nm
  const [showOverlayMenu, setShowOverlayMenu] = useState(false);
  const [safetyEvents, setSafetyEvents] = useState([]); // Safety events from API/WebSocket
  const [acknowledgedEvents, setAcknowledgedEvents] = useState(new Set()); // Acknowledged event IDs
  const [showAircraftList, setShowAircraftList] = useState(() => {
    const saved = localStorage.getItem('adsb-show-aircraft-list');
    return saved === null ? false : saved === 'true';
  });
  const [listExpanded, setListExpanded] = useState(() => {
    const saved = localStorage.getItem('adsb-list-expanded');
    return saved === null ? true : saved === 'true';
  });
  const [showLegend, setShowLegend] = useState(false); // Legend panel visibility
  const [legendCollapsed, setLegendCollapsed] = useState(false); // Legend content collapsed
  const [listDisplayCount, setListDisplayCount] = useState(20); // Lazy load count for aircraft list
  const [showRangeControl, setShowRangeControl] = useState(false); // Show range control when cursor near
  const [soundMuted, setSoundMuted] = useState(() => localStorage.getItem('adsb-sound-muted') === 'true');
  const [searchQuery, setSearchQuery] = useState(''); // Search filter
  const [trackHistory, setTrackHistory] = useState({}); // Per-aircraft position history for trails
  
  // New feature states
  const [isFullscreen, setIsFullscreen] = useState(false); // Fullscreen mode
  const [panelPinned, setPanelPinned] = useState(false); // Pin pro details panel
  const [showAcarsPanel, setShowAcarsPanel] = useState(false); // ACARS messages panel
  const [acarsMessages, setAcarsMessages] = useState([]); // Live ACARS messages
  const [acarsStatus, setAcarsStatus] = useState(null); // ACARS service status
  const [acarsFilters, setAcarsFilters] = useState(() => {
    const saved = localStorage.getItem('adsb-acars-filters');
    return saved ? JSON.parse(saved) : {
      hideEmpty: true,
      sourceFilter: 'all', // 'all', 'acars', 'vdlm2'
      labelFilter: '',
      callsignFilter: '',
    };
  });
  const [aircraftDetailHex, setAircraftDetailHex] = useState(null); // Aircraft for detail page
  const [aircraftInfo, setAircraftInfo] = useState({}); // Cached aircraft info
  
  // Traffic filters state
  const [trafficFilters, setTrafficFilters] = useState(() => {
    const saved = localStorage.getItem('adsb-traffic-filters');
    return saved ? JSON.parse(saved) : {
      showMilitary: true,
      showCivil: true,
      showGround: false, // Hide ground aircraft by default
      showAirborne: true,
      minAltitude: 0,
      maxAltitude: 60000,
      showWithSquawk: true,
      showWithoutSquawk: true,
    };
  });
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [proPhotoError, setProPhotoError] = useState(false); // Track photo loading errors for Pro panel
  const [proPhotoRetry, setProPhotoRetry] = useState(0); // Retry counter for pro panel photo
  
  // Aviation overlay states - load from localStorage
  const [overlays, setOverlays] = useState(getOverlays);
  
  // Popup drag state
  const [popupPosition, setPopupPosition] = useState({ x: 16, y: 16 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, startX: 0, startY: 0 });
  
  // Legend drag state
  const [legendPosition, setLegendPosition] = useState({ x: null, y: null }); // null means use default CSS position
  const [isLegendDragging, setIsLegendDragging] = useState(false);
  const legendDragStartRef = useRef({ x: 0, y: 0, startX: 0, startY: 0 });
  
  // Aircraft list drag state
  const [aircraftListPosition, setAircraftListPosition] = useState({ x: null, y: null });
  const [isListDragging, setIsListDragging] = useState(false);
  const listDragStartRef = useRef({ x: 0, y: 0, startX: 0, startY: 0 });
  
  // Aviation data from REST endpoints
  const [aviationData, setAviationData] = useState({
    navaids: [],
    airports: [],
    airspaces: [],      // G-AIRMET advisories from /api/v1/aviation/airspaces
    boundaries: [],     // Static airspace boundaries from /api/v1/aviation/airspace-boundaries
    metars: [],
    pireps: [],
  });

  // Map viewport center for dynamic data loading (updated on pan/zoom)
  const [viewportCenter, setViewportCenter] = useState({ lat: null, lon: null });
  const viewportUpdateTimeoutRef = useRef(null);

  const mapRef = useRef(null);
  const leafletMapRef = useRef(null);
  const markersRef = useRef({});
  const feederMarkerRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const animationRef = useRef(null);
  const sweepAngleRef = useRef(0);
  const historyRef = useRef({}); // Store position history for trails
  const conflictsRef = useRef([]); // Track conflicts for banner
  const preConflictSelectionRef = useRef(null); // Store selection before conflict auto-select
  
  // Pro panel canvas refs
  const trackCanvasRef = useRef(null);
  const altProfileCanvasRef = useRef(null);
  const speedProfileCanvasRef = useRef(null);
  const vsProfileCanvasRef = useRef(null);
  const distProfileCanvasRef = useRef(null);
  
  // Notification tracking refs
  const notifiedConflictsRef = useRef(new Set()); // Track notified conflict pairs
  const notifiedEmergenciesRef = useRef(new Set()); // Track notified emergency aircraft
  const focusedSafetyEventsRef = useRef(new Set()); // Track events we've already focused on
  const alarmAudioRef = useRef(null); // Audio element for conflict alarm
  const alarmPlayingRef = useRef(false); // Track if alarm is currently playing
  const alarmIntervalRef = useRef(null); // Interval for looping alarm

  // Use feeder location or default
  const feederLat = feederLocation?.lat || 47.9377;
  const feederLon = feederLocation?.lon || -121.9687;
  
  // Send browser notification helper
  const sendNotification = useCallback((title, body, tag, urgent = false) => {
    // Always log to console for debugging/testing
    console.log(`[SkySpy Notification] ${title}: ${body}`);

    if (typeof Notification === 'undefined') {
      console.warn('Notifications not supported in this browser');
      return;
    }

    if (Notification.permission !== 'granted') {
      console.warn('Notification permission not granted');
      return;
    }

    if (!config.browserNotifications) {
      console.log('Browser notifications disabled in settings');
      return;
    }

    try {
      const notif = new Notification(title, {
        body,
        icon: '/static/favicon.svg',
        tag,
        requireInteraction: urgent,
        silent: false
      });
      
      // Auto-close non-urgent notifications after 10 seconds
      if (!urgent) {
        setTimeout(() => notif.close(), 10000);
      }
    } catch (e) {
      console.warn('Notification failed:', e);
    }
  }, [config.browserNotifications]);
  
  // Audio context ref - created on first user interaction
  const audioContextRef = useRef(null);
  
  // Initialize audio context on user interaction
  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume if suspended (browser autoplay policy)
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);
  
  // Play Stage 1 alarm - double ding (low severity) - yellow
  const playAlarmStage1 = useCallback(() => {
    if (soundMuted || alarmPlayingRef.current) return;
    
    try {
      const audioCtx = initAudioContext();
      if (!audioCtx) return;
      
      const now = audioCtx.currentTime;
      
      const playDing = (startTime) => {
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        osc1.frequency.value = 2200;
        osc1.type = 'sine';
        
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.frequency.value = 3300;
        osc2.type = 'sine';
        
        const osc3 = audioCtx.createOscillator();
        const gain3 = audioCtx.createGain();
        osc3.connect(gain3);
        gain3.connect(audioCtx.destination);
        osc3.frequency.value = 1100;
        osc3.type = 'sine';
        
        const peakTime = startTime + 0.01;
        const endTime = startTime + 0.4;
        
        gain1.gain.setValueAtTime(0, startTime);
        gain1.gain.linearRampToValueAtTime(0.25, peakTime);
        gain1.gain.exponentialRampToValueAtTime(0.001, endTime);
        
        gain2.gain.setValueAtTime(0, startTime);
        gain2.gain.linearRampToValueAtTime(0.1, peakTime);
        gain2.gain.exponentialRampToValueAtTime(0.001, startTime + 0.2);
        
        gain3.gain.setValueAtTime(0, startTime);
        gain3.gain.linearRampToValueAtTime(0.08, peakTime);
        gain3.gain.exponentialRampToValueAtTime(0.001, endTime);
        
        osc1.start(startTime);
        osc1.stop(endTime);
        osc2.start(startTime);
        osc2.stop(startTime + 0.2);
        osc3.start(startTime);
        osc3.stop(endTime);
      };
      
      // Play two dings
      playDing(now);
      playDing(now + 0.5);
      
      alarmPlayingRef.current = true;
      setTimeout(() => {
        alarmPlayingRef.current = false;
      }, 1200);
    } catch (e) {
      console.warn('Could not play alarm sound:', e);
    }
  }, [soundMuted, initAudioContext]);
  
  // Play Stage 2 alarm - rapid triple ding (warning severity) - orange
  const playAlarmStage2 = useCallback(() => {
    if (soundMuted || alarmPlayingRef.current) return;
    
    try {
      const audioCtx = initAudioContext();
      if (!audioCtx) return;
      
      const now = audioCtx.currentTime;
      
      const playDing = (startTime) => {
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        osc1.frequency.value = 2200;
        osc1.type = 'sine';
        
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.frequency.value = 3300;
        osc2.type = 'sine';
        
        const osc3 = audioCtx.createOscillator();
        const gain3 = audioCtx.createGain();
        osc3.connect(gain3);
        gain3.connect(audioCtx.destination);
        osc3.frequency.value = 1100;
        osc3.type = 'sine';
        
        const peakTime = startTime + 0.008;
        const endTime = startTime + 0.25;
        
        gain1.gain.setValueAtTime(0, startTime);
        gain1.gain.linearRampToValueAtTime(0.3, peakTime);
        gain1.gain.exponentialRampToValueAtTime(0.001, endTime);
        
        gain2.gain.setValueAtTime(0, startTime);
        gain2.gain.linearRampToValueAtTime(0.12, peakTime);
        gain2.gain.exponentialRampToValueAtTime(0.001, startTime + 0.12);
        
        gain3.gain.setValueAtTime(0, startTime);
        gain3.gain.linearRampToValueAtTime(0.1, peakTime);
        gain3.gain.exponentialRampToValueAtTime(0.001, endTime);
        
        osc1.start(startTime);
        osc1.stop(endTime);
        osc2.start(startTime);
        osc2.stop(startTime + 0.12);
        osc3.start(startTime);
        osc3.stop(endTime);
      };
      
      // Play three rapid dings
      playDing(now);
      playDing(now + 0.2);
      playDing(now + 0.4);
      
      alarmPlayingRef.current = true;
      setTimeout(() => {
        alarmPlayingRef.current = false;
      }, 800);
    } catch (e) {
      console.warn('Could not play alarm sound:', e);
    }
  }, [soundMuted, initAudioContext]);
  
  // Play Stage 3 alarm - high-low siren (critical severity) - pink
  const playAlarmStage3 = useCallback(() => {
    if (soundMuted || alarmPlayingRef.current) return;
    
    try {
      const audioCtx = initAudioContext();
      if (!audioCtx) return;
      
      const now = audioCtx.currentTime;
      
      const playTone = (startTime, freq, duration) => {
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        osc1.frequency.value = freq;
        osc1.type = 'sine';
        
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.frequency.value = freq * 1.5;
        osc2.type = 'sine';
        
        const peakTime = startTime + 0.02;
        const endTime = startTime + duration;
        
        gain1.gain.setValueAtTime(0, startTime);
        gain1.gain.linearRampToValueAtTime(0.35, peakTime);
        gain1.gain.setValueAtTime(0.35, endTime - 0.05);
        gain1.gain.linearRampToValueAtTime(0, endTime);
        
        gain2.gain.setValueAtTime(0, startTime);
        gain2.gain.linearRampToValueAtTime(0.15, peakTime);
        gain2.gain.setValueAtTime(0.15, endTime - 0.05);
        gain2.gain.linearRampToValueAtTime(0, endTime);
        
        osc1.start(startTime);
        osc1.stop(endTime);
        osc2.start(startTime);
        osc2.stop(endTime);
      };
      
      // High-low-high-low pattern
      playTone(now, 1800, 0.25);        // High
      playTone(now + 0.25, 1200, 0.25); // Low
      playTone(now + 0.5, 1800, 0.25);  // High
      playTone(now + 0.75, 1200, 0.25); // Low
      
      alarmPlayingRef.current = true;
      setTimeout(() => {
        alarmPlayingRef.current = false;
      }, 1200);
    } catch (e) {
      console.warn('Could not play alarm sound:', e);
    }
  }, [soundMuted, initAudioContext]);
  
  // Play alarm based on severity
  const playConflictAlarm = useCallback((severity = 'low') => {
    switch (severity) {
      case 'critical':
        playAlarmStage3();
        break;
      case 'warning':
        playAlarmStage2();
        break;
      default:
        playAlarmStage1();
    }
  }, [playAlarmStage1, playAlarmStage2, playAlarmStage3]);
  
  // Get highest severity from active events
  const getHighestSeverity = useCallback((events) => {
    if (events.some(e => e.severity === 'critical')) return 'critical';
    if (events.some(e => e.severity === 'warning')) return 'warning';
    return 'low';
  }, []);
  
  // Start looping alarm for unacknowledged events
  const startAlarmLoop = useCallback((severity = 'low') => {
    if (alarmIntervalRef.current || soundMuted) return;
    
    playConflictAlarm(severity);
    
    // Determine loop interval based on severity
    const interval = severity === 'critical' ? 1500 : severity === 'warning' ? 2500 : 3000;
    
    alarmIntervalRef.current = setInterval(() => {
      playConflictAlarm(severity);
    }, interval);
  }, [playConflictAlarm, soundMuted]);
  
  // Stop the alarm loop
  const stopAlarmLoop = useCallback(() => {
    if (alarmIntervalRef.current) {
      clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
  }, []);
  
  // Acknowledge a safety event via API and update local state
  const acknowledgeEvent = useCallback(async (eventId) => {
    const baseUrl = config.apiBaseUrl || '';
    try {
      await fetch(`${baseUrl}/api/v1/safety/active/${encodeURIComponent(eventId)}/acknowledge`, {
        method: 'POST'
      });
      // Also update local state for immediate UI feedback
      setAcknowledgedEvents(prev => new Set([...prev, eventId]));
    } catch (err) {
      console.error('Failed to acknowledge event:', err);
      // Still update local state for UI feedback even if API fails
      setAcknowledgedEvents(prev => new Set([...prev, eventId]));
    }
  }, [config.apiBaseUrl]);

  // Save sound muted preference and stop alarm if muted
  useEffect(() => {
    localStorage.setItem('adsb-sound-muted', soundMuted.toString());
    if (soundMuted) {
      stopAlarmLoop();
    }
  }, [soundMuted, stopAlarmLoop]);
  
  // Save aircraft list visibility preference
  useEffect(() => {
    localStorage.setItem('adsb-show-aircraft-list', showAircraftList.toString());
  }, [showAircraftList]);
  
  // Save aircraft list expanded preference
  useEffect(() => {
    localStorage.setItem('adsb-list-expanded', listExpanded.toString());
  }, [listExpanded]);
  
  // Reset photo error state when selected aircraft changes
  useEffect(() => {
    setProPhotoError(false);
    setProPhotoRetry(0);
  }, [selectedAircraft?.hex]);
  
  // Merge WebSocket safety events with local state
  useEffect(() => {
    if (wsSafetyEvents && wsSafetyEvents.length > 0) {
      setSafetyEvents(prev => {
        const existingIds = new Set(prev.map(e => e.id));
        const newEvents = wsSafetyEvents.filter(e => !existingIds.has(e.id));
        if (newEvents.length === 0) return prev;
        return [...newEvents, ...prev].slice(0, 50);
      });
    }
  }, [wsSafetyEvents]);

  // Fetch safety events via WebSocket on connect
  useEffect(() => {
    if (!wsRequest || !wsConnected) return;

    const fetchSafetyEvents = async () => {
      try {
        const data = await wsRequest('safety-events', { limit: 20 });
        const events = Array.isArray(data) ? data : (data?.data || data?.events || []);
        if (events.length > 0) {
          setSafetyEvents(prev => {
            const existingIds = new Set(prev.map(e => e.id));
            const newEvents = events.filter(e => !existingIds.has(e.id));
            if (newEvents.length === 0) return prev;
            return [...newEvents, ...prev].slice(0, 50);
          });
        }
      } catch (err) {
        // Silent fail - real-time push is primary
        console.warn('Safety events fetch failed:', err.message);
      }
    };

    fetchSafetyEvents();
    // Refresh every 30 seconds (less frequent since we have real-time push)
    const interval = setInterval(fetchSafetyEvents, 30000);
    return () => clearInterval(interval);
  }, [wsRequest, wsConnected]);
  
  // Convert safety events to conflict format for display with LIVE separation data
  const activeConflicts = useMemo(() => {
    // Get unacknowledged safety events (last 60 seconds)
    const cutoff = Date.now() - 60000;
    return safetyEvents.filter(event => {
      if (acknowledgedEvents.has(event.id)) return false;
      const eventTime = new Date(event.timestamp).getTime();
      return eventTime > cutoff;
    }).map(event => {
      // Try to calculate live separation if both aircraft are available
      let horizontalNm = event.details?.horizontal_nm?.toFixed(1) || '--';
      let verticalFt = event.details?.vertical_ft || event.details?.altitude || '--';
      
      // For two-aircraft events (like proximity_conflict, tcas_ra), calculate live values
      if (event.icao && event.icao_2) {
        const ac1 = aircraft.find(a => a.hex?.toLowerCase() === event.icao?.toLowerCase());
        const ac2 = aircraft.find(a => a.hex?.toLowerCase() === event.icao_2?.toLowerCase());
        
        if (ac1?.lat && ac1?.lon && ac2?.lat && ac2?.lon) {
          // Calculate horizontal distance between aircraft
          const dLat = (ac2.lat - ac1.lat) * 60; // nm
          const dLon = (ac2.lon - ac1.lon) * 60 * Math.cos(ac1.lat * Math.PI / 180); // nm
          horizontalNm = Math.sqrt(dLat * dLat + dLon * dLon).toFixed(1);
        }
        
        if (ac1?.alt && ac2?.alt) {
          verticalFt = Math.round(Math.abs(ac2.alt - ac1.alt));
        }
      }
      // For single-aircraft events (extreme_vs, rapid_descent, etc.), show current altitude/vs
      else if (event.icao) {
        const ac = aircraft.find(a => a.hex?.toLowerCase() === event.icao?.toLowerCase());
        if (ac?.alt) {
          verticalFt = Math.round(ac.alt);
        }
        // For V/S events, show current vertical rate
        if (event.event_type?.includes('vs') || event.event_type?.includes('descent') || event.event_type?.includes('climb')) {
          const vs = ac?.baro_rate || ac?.geom_rate;
          if (vs !== undefined) {
            verticalFt = `${vs > 0 ? '+' : ''}${Math.round(vs)} fpm`;
          }
        }
      }
      
      return {
        ...event,
        ac1: event.callsign || event.icao,
        ac2: event.callsign_2 || event.icao_2 || null,
        hex1: event.icao,
        hex2: event.icao_2,
        horizontalNm,
        verticalFt,
      };
    });
  }, [safetyEvents, acknowledgedEvents, aircraft]);
  
  // Monitor for new safety events and trigger alarms/notifications
  useEffect(() => {
    // Get unacknowledged events
    const unacknowledged = activeConflicts.filter(event => !acknowledgedEvents.has(event.id));
    
    if (unacknowledged.length > 0) {
      const severity = getHighestSeverity(unacknowledged);
      
      // For low severity, play alarm twice then auto-acknowledge
      if (severity === 'low') {
        // Play alarm, then auto-acknowledge after 4 seconds
        stopAlarmLoop();
        playConflictAlarm('low');
        setTimeout(() => {
          playConflictAlarm('low');
        }, 1500);
        
        // Auto-acknowledge low severity events after 5 seconds
        setTimeout(() => {
          unacknowledged.forEach(e => {
            if (e.severity === 'low') acknowledgeEvent(e.id);
          });
        }, 5000);
      } else {
        // For warning/critical, loop until acknowledged
        startAlarmLoop(severity);
      }
    } else {
      stopAlarmLoop();
    }
    
    // Send browser notifications for NEW events and auto-focus on critical/warning
    activeConflicts.forEach(event => {
      const eventKey = `safety-${event.id}`;

      if (!notifiedConflictsRef.current.has(eventKey)) {
        notifiedConflictsRef.current.add(eventKey);

        const severityEmoji = event.severity === 'critical' ? '🚨' :
                             event.severity === 'warning' ? '⚠️' : '🔔';
        const title = `${severityEmoji} ${event.event_type.replace(/_/g, ' ').toUpperCase()}`;

        sendNotification(
          title,
          event.message || `${event.callsign} - ${event.event_type}`,
          eventKey,
          event.severity === 'critical'
        );

        // Auto-focus on new critical or warning events (not low severity)
        if ((event.severity === 'critical' || event.severity === 'warning') &&
            !focusedSafetyEventsRef.current.has(eventKey)) {
          focusedSafetyEventsRef.current.add(eventKey);

          // Find the aircraft and auto-select it
          const ac = aircraft.find(a => a.hex?.toUpperCase() === event.icao?.toUpperCase());
          if (ac) {
            // Clear other selections and select this aircraft
            setSelectedMetar(null);
            setSelectedPirep(null);
            setSelectedNavaid(null);
            setSelectedAirport(null);
            setPopupPosition({ x: 16, y: 16 });
            setSelectedAircraft(ac);

            // Pan the map to the aircraft if we have valid coordinates
            if (ac.lat && ac.lon && leafletMapRef.current) {
              leafletMapRef.current.flyTo([ac.lat, ac.lon], 10, {
                duration: 1.5,
                easeLinearity: 0.25
              });
            }
          }
        }
      }
    });
    
    // Cleanup on unmount
    return () => {
      stopAlarmLoop();
    };
  }, [activeConflicts, acknowledgedEvents, acknowledgeEvent, getHighestSeverity, playConflictAlarm, sendNotification, startAlarmLoop, stopAlarmLoop, aircraft]);
  
  
  // Monitor for emergency squawks and send notifications
  useEffect(() => {
    const emergencySquawks = { '7500': 'HIJACK', '7600': 'RADIO FAILURE', '7700': 'EMERGENCY' };
    
    aircraft.forEach(ac => {
      const isEmergency = ac.emergency || emergencySquawks[ac.squawk];
      if (!isEmergency) return;
      
      const emergencyKey = `${ac.hex}-${ac.squawk}`;
      if (!notifiedEmergenciesRef.current.has(emergencyKey)) {
        notifiedEmergenciesRef.current.add(emergencyKey);
        
        const callsign = ac.flight?.trim() || ac.hex;
        const meaning = emergencySquawks[ac.squawk] || 'EMERGENCY';
        
        sendNotification(
          `🚨 ${meaning}`,
          `${callsign} squawking ${ac.squawk || 'emergency'}\nAlt: ${ac.alt?.toLocaleString() || '?'}ft`,
          `emergency-${emergencyKey}`,
          true
        );
      }
    });
    
    // Clean up old emergencies after aircraft no longer in emergency state
    const currentEmergencyHexes = new Set(
      aircraft.filter(ac => ac.emergency || emergencySquawks[ac.squawk]).map(ac => ac.hex)
    );
    notifiedEmergenciesRef.current.forEach(key => {
      const hex = key.split('-')[0];
      if (!currentEmergencyHexes.has(hex)) {
        // Allow re-notification after 10 min
        setTimeout(() => notifiedEmergenciesRef.current.delete(key), 600000);
      }
    });
  }, [aircraft, sendNotification]);

  // Save overlays to localStorage when changed
  useEffect(() => {
    saveOverlays(overlays);
  }, [overlays]);

  // Save traffic filters to localStorage when changed
  useEffect(() => {
    localStorage.setItem('adsb-traffic-filters', JSON.stringify(trafficFilters));
  }, [trafficFilters]);

  // Save ACARS filters to localStorage when changed
  useEffect(() => {
    localStorage.setItem('adsb-acars-filters', JSON.stringify(acarsFilters));
  }, [acarsFilters]);

  // Fullscreen toggle handler
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  }, []);

  // Listen for fullscreen change
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Fetch ACARS messages and status
  useEffect(() => {
    if (!showAcarsPanel) return;
    
    const fetchAcars = async () => {
      const baseUrl = config.apiBaseUrl || '';
      try {
        // Fetch recent messages
        const msgRes = await fetch(`${baseUrl}/api/v1/acars/messages/recent?limit=50`);
        if (msgRes.ok) {
          const data = await msgRes.json();
          setAcarsMessages(data.messages || []);
        }
        
        // Fetch status
        const statusRes = await fetch(`${baseUrl}/api/v1/acars/status`);
        if (statusRes.ok) {
          const data = await statusRes.json();
          setAcarsStatus(data);
        }
      } catch (err) {
        console.log('ACARS fetch error:', err.message);
      }
    };
    
    fetchAcars();
    const interval = setInterval(fetchAcars, 5000);
    return () => clearInterval(interval);
  }, [showAcarsPanel, config.apiBaseUrl]);

  // Fetch aircraft info when selecting aircraft
  useEffect(() => {
    if (!selectedAircraft?.hex) return;
    if (aircraftInfo[selectedAircraft.hex]) return; // Already cached

    const fetchInfo = async () => {
      // Prefer Socket.IO request if available
      if (wsRequest && wsConnected) {
        try {
          const data = await wsRequest('aircraft-info', { icao: selectedAircraft.hex });
          if (data && !data.error) {
            setAircraftInfo(prev => ({ ...prev, [selectedAircraft.hex]: data }));
          }
        } catch (err) {
          console.log('Aircraft info WS request error:', err.message);
        }
      } else {
        // Fallback to HTTP
        const baseUrl = config.apiBaseUrl || '';
        try {
          const res = await fetch(`${baseUrl}/api/v1/aircraft/${selectedAircraft.hex}/info`);
          if (res.ok) {
            const data = await res.json();
            setAircraftInfo(prev => ({ ...prev, [selectedAircraft.hex]: data }));
          }
        } catch (err) {
          console.log('Aircraft info fetch error:', err.message);
        }
      }
    };

    fetchInfo();
  }, [selectedAircraft?.hex, config.apiBaseUrl, aircraftInfo, wsRequest, wsConnected]);

  // Popup drag handlers
  const handlePopupMouseDown = (e) => {
    if (e.target.closest('.popup-close') || e.target.closest('a') || e.target.closest('button')) return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startX: popupPosition.x,
      startY: popupPosition.y
    };
    e.preventDefault();
  };

  const handlePopupMouseMove = useCallback((e) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPopupPosition({
      x: Math.max(0, dragStartRef.current.startX + dx),
      y: Math.max(0, dragStartRef.current.startY + dy)
    });
  }, [isDragging]);

  const handlePopupMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Add global mouse handlers for dragging
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handlePopupMouseMove);
      window.addEventListener('mouseup', handlePopupMouseUp);
      return () => {
        window.removeEventListener('mousemove', handlePopupMouseMove);
        window.removeEventListener('mouseup', handlePopupMouseUp);
      };
    }
  }, [isDragging, handlePopupMouseMove, handlePopupMouseUp]);

  // Legend drag handlers
  const handleLegendMouseDown = (e) => {
    if (e.target.closest('button')) return;
    setIsLegendDragging(true);
    const rect = e.currentTarget.getBoundingClientRect();
    legendDragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startX: legendPosition.x ?? rect.left,
      startY: legendPosition.y ?? rect.top
    };
    e.preventDefault();
  };

  const handleLegendMouseMove = useCallback((e) => {
    if (!isLegendDragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const dx = clientX - legendDragStartRef.current.x;
    const dy = clientY - legendDragStartRef.current.y;
    setLegendPosition({
      x: Math.max(0, legendDragStartRef.current.startX + dx),
      y: Math.max(0, legendDragStartRef.current.startY + dy)
    });
  }, [isLegendDragging]);

  const handleLegendMouseUp = useCallback(() => {
    setIsLegendDragging(false);
  }, []);

  // Add global mouse/touch handlers for legend dragging
  useEffect(() => {
    if (isLegendDragging) {
      window.addEventListener('mousemove', handleLegendMouseMove);
      window.addEventListener('mouseup', handleLegendMouseUp);
      window.addEventListener('touchmove', handleLegendMouseMove);
      window.addEventListener('touchend', handleLegendMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleLegendMouseMove);
        window.removeEventListener('mouseup', handleLegendMouseUp);
        window.removeEventListener('touchmove', handleLegendMouseMove);
        window.removeEventListener('touchend', handleLegendMouseUp);
      };
    }
  }, [isLegendDragging, handleLegendMouseMove, handleLegendMouseUp]);

  // Aircraft list drag handlers
  const handleListMouseDown = (e) => {
    if (e.target.closest('button') || e.target.closest('.aircraft-list-item')) return;
    setIsListDragging(true);
    const rect = e.currentTarget.getBoundingClientRect();
    listDragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startX: aircraftListPosition.x ?? rect.left,
      startY: aircraftListPosition.y ?? rect.top
    };
    e.preventDefault();
  };

  const handleListMouseMove = useCallback((e) => {
    if (!isListDragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const dx = clientX - listDragStartRef.current.x;
    const dy = clientY - listDragStartRef.current.y;
    setAircraftListPosition({
      x: Math.max(0, listDragStartRef.current.startX + dx),
      y: Math.max(0, listDragStartRef.current.startY + dy)
    });
  }, [isListDragging]);

  const handleListMouseUp = useCallback(() => {
    setIsListDragging(false);
  }, []);

  // Add global mouse/touch handlers for list dragging
  useEffect(() => {
    if (isListDragging) {
      window.addEventListener('mousemove', handleListMouseMove);
      window.addEventListener('mouseup', handleListMouseUp);
      window.addEventListener('touchmove', handleListMouseMove);
      window.addEventListener('touchend', handleListMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleListMouseMove);
        window.removeEventListener('mouseup', handleListMouseUp);
        window.removeEventListener('touchmove', handleListMouseMove);
        window.removeEventListener('touchend', handleListMouseUp);
      };
    }
  }, [isListDragging, handleListMouseMove, handleListMouseUp]);



  // Handle mouse move on radar container to show/hide range control
  const handleContainerMouseMove = useCallback((e) => {
    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const containerHeight = rect.height;
    
    // Show range control when mouse is in bottom 15% of container
    const showThreshold = containerHeight * 0.85;
    setShowRangeControl(mouseY > showThreshold);
  }, []);

  const handleContainerMouseLeave = useCallback(() => {
    setShowRangeControl(false);
  }, []);

  // Track aircraft position history for trails and profile charts
  useEffect(() => {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes of history
    
    setTrackHistory(prev => {
      const updated = { ...prev };
      
      // Add new positions for each aircraft
      aircraft.forEach(ac => {
        if (ac.lat && ac.lon && ac.hex) {
          if (!updated[ac.hex]) {
            updated[ac.hex] = [];
          }
          
          // Calculate distance from feeder
          const dLat = ac.lat - feederLat;
          const dLon = ac.lon - feederLon;
          const latNm = dLat * 60;
          const lonNm = dLon * 60 * Math.cos(feederLat * Math.PI / 180);
          const dist = Math.sqrt(latNm * latNm + lonNm * lonNm);
          
          // Only add if position has changed or enough time has passed
          const lastPos = updated[ac.hex][updated[ac.hex].length - 1];
          if (!lastPos || 
              now - lastPos.time > 3000 || // At least 3 seconds between points
              Math.abs(lastPos.lat - ac.lat) > 0.001 || 
              Math.abs(lastPos.lon - ac.lon) > 0.001) {
            updated[ac.hex].push({
              lat: ac.lat,
              lon: ac.lon,
              alt: ac.alt_baro || ac.alt_geom || ac.alt,
              spd: ac.gs || ac.tas || ac.ias,
              vs: ac.vr ?? ac.baro_rate ?? ac.geom_rate ?? 0,
              trk: ac.track || ac.true_heading || ac.mag_heading,
              dist: dist,
              time: now
            });
          }
          
          // Remove old positions
          updated[ac.hex] = updated[ac.hex].filter(p => now - p.time < maxAge);
        }
      });
      
      // Clean up aircraft that are no longer present
      const activeHexes = new Set(aircraft.map(ac => ac.hex));
      Object.keys(updated).forEach(hex => {
        if (!activeHexes.has(hex)) {
          // Keep for a bit after aircraft disappears, then remove
          if (updated[hex].length > 0 && now - updated[hex][updated[hex].length - 1].time > 60000) {
            delete updated[hex];
          }
        }
      });
      
      return updated;
    });
  }, [aircraft, feederLat, feederLon]);

  // Draw track history canvas when selected aircraft or history changes
  useEffect(() => {
    if (!trackCanvasRef.current || !selectedAircraft || !trackHistory[selectedAircraft.hex]) return;

    const canvas = trackCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const history = trackHistory[selectedAircraft.hex];
    
    ctx.clearRect(0, 0, 280, 80);
    
    if (history.length < 2) return;
    
    // Find bounds
    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;
    history.forEach(p => {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLon = Math.min(minLon, p.lon);
      maxLon = Math.max(maxLon, p.lon);
    });
    
    const padding = 10;
    const width = 280 - padding * 2;
    const height = 80 - padding * 2;
    const latRange = maxLat - minLat || 0.01;
    const lonRange = maxLon - minLon || 0.01;
    
    // Draw track
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    
    history.forEach((p, i) => {
      const x = padding + ((p.lon - minLon) / lonRange) * width;
      const y = padding + height - ((p.lat - minLat) / latRange) * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    
    // Draw current position marker (airplane shape)
    const last = history[history.length - 1];
    const lastX = padding + ((last.lon - minLon) / lonRange) * width;
    const lastY = padding + height - ((last.lat - minLat) / latRange) * height;
    
    ctx.fillStyle = 'rgba(0, 212, 255, 1)';
    ctx.beginPath();
    ctx.moveTo(lastX, lastY - 6);
    ctx.lineTo(lastX - 4, lastY + 4);
    ctx.lineTo(lastX + 4, lastY + 4);
    ctx.closePath();
    ctx.fill();
  }, [selectedAircraft, trackHistory]);

  // Animation frame counter for loading spinners
  const [canvasAnimFrame, setCanvasAnimFrame] = useState(0);

  // Auto-refresh canvas animation when waiting for data
  useEffect(() => {
    if (!selectedAircraft) return;

    const history = trackHistory[selectedAircraft.hex];
    const needsAnimation = !history || history.length < 2;

    if (needsAnimation) {
      const interval = setInterval(() => {
        setCanvasAnimFrame(f => (f + 1) % 12);
      }, 150);
      return () => clearInterval(interval);
    }
  }, [selectedAircraft, trackHistory]);

  // Helper to draw animated "waiting for data" spinner on canvas
  const drawWaitingSpinner = (ctx, width, height, color = 'rgba(138, 148, 158, 0.4)', frame = 0) => {
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = 12;
    const dotCount = 8;

    // Draw spinning dots
    for (let i = 0; i < dotCount; i++) {
      const angle = (i / dotCount) * Math.PI * 2 - Math.PI / 2;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      const opacity = ((i + frame) % dotCount) / dotCount;

      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fillStyle = color.replace('0.4', opacity.toFixed(2));
      ctx.fill();
    }

    // Draw text below spinner
    ctx.fillStyle = color;
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Loading...', centerX, centerY + 24);
  };

  // Draw altitude profile canvas
  useEffect(() => {
    if (!altProfileCanvasRef.current || !selectedAircraft) return;

    const canvas = altProfileCanvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 280, 60);

    const history = trackHistory[selectedAircraft.hex];
    if (!history || history.length === 0) {
      drawWaitingMessage(ctx, 280, 60, 'rgba(0, 212, 255, 0.4)');
      return;
    }

    const alts = history.map(p => p.alt || 0);
    const validAlts = alts.filter(a => a > 0);

    // If only one point or no valid alts, draw a horizontal line at center
    if (validAlts.length === 0) {
      drawWaitingMessage(ctx, 280, 60, 'rgba(0, 212, 255, 0.4)');
      return;
    }

    const minAlt = Math.min(...validAlts);
    const maxAlt = Math.max(...validAlts);
    const range = Math.max(maxAlt - minAlt, 100);
    const pad = 5;

    const getY = (alt) => {
      const normalized = Math.max(0, Math.min(1, (alt - minAlt) / range));
      return 60 - pad - (normalized * (60 - pad * 2));
    };

    // Draw gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 60);
    gradient.addColorStop(0, 'rgba(0, 212, 255, 0.3)');
    gradient.addColorStop(1, 'rgba(0, 212, 255, 0.05)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, 60 - pad);

    const xStep = history.length > 1 ? 280 / (history.length - 1) : 280;
    history.forEach((p, i) => {
      const x = history.length > 1 ? i * xStep : 140;
      ctx.lineTo(x, getY(p.alt || minAlt));
    });

    // If single point, extend to full width
    if (history.length === 1) {
      ctx.lineTo(280, getY(history[0].alt || minAlt));
    }

    ctx.lineTo(280, 60 - pad);
    ctx.closePath();
    ctx.fill();

    // Draw line
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();

    history.forEach((p, i) => {
      const x = history.length > 1 ? i * xStep : 0;
      const y = getY(p.alt || minAlt);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    // If single point, draw horizontal line
    if (history.length === 1) {
      ctx.lineTo(280, getY(history[0].alt || minAlt));
    }

    ctx.stroke();
  }, [selectedAircraft, trackHistory]);

  // Draw speed profile canvas
  useEffect(() => {
    if (!speedProfileCanvasRef.current || !selectedAircraft) return;

    const canvas = speedProfileCanvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 280, 60);

    const history = trackHistory[selectedAircraft.hex];
    if (!history || history.length === 0) {
      drawWaitingMessage(ctx, 280, 60, 'rgba(74, 222, 128, 0.4)');
      return;
    }

    const speeds = history.map(p => p.spd || 0);
    const validSpeeds = speeds.filter(s => s > 0);

    if (validSpeeds.length === 0) {
      drawWaitingMessage(ctx, 280, 60, 'rgba(74, 222, 128, 0.4)');
      return;
    }

    const minSpd = Math.min(...validSpeeds);
    const maxSpd = Math.max(...validSpeeds);
    const range = Math.max(maxSpd - minSpd, 20);
    const pad = 5;

    const getY = (spd) => {
      const normalized = Math.max(0, Math.min(1, (spd - minSpd) / range));
      return 60 - pad - (normalized * (60 - pad * 2));
    };

    // Draw gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 60);
    gradient.addColorStop(0, 'rgba(74, 222, 128, 0.3)');
    gradient.addColorStop(1, 'rgba(74, 222, 128, 0.05)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, 60 - pad);

    const xStep = history.length > 1 ? 280 / (history.length - 1) : 280;
    history.forEach((p, i) => {
      const x = history.length > 1 ? i * xStep : 140;
      ctx.lineTo(x, getY(p.spd || minSpd));
    });

    if (history.length === 1) {
      ctx.lineTo(280, getY(history[0].spd || minSpd));
    }

    ctx.lineTo(280, 60 - pad);
    ctx.closePath();
    ctx.fill();

    // Draw line
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();

    history.forEach((p, i) => {
      const x = history.length > 1 ? i * xStep : 0;
      const y = getY(p.spd || minSpd);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    if (history.length === 1) {
      ctx.lineTo(280, getY(history[0].spd || minSpd));
    }

    ctx.stroke();
  }, [selectedAircraft, trackHistory]);

  // Draw vertical speed profile canvas
  useEffect(() => {
    if (!vsProfileCanvasRef.current || !selectedAircraft) return;

    const canvas = vsProfileCanvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 280, 60);

    const history = trackHistory[selectedAircraft.hex];
    const pad = 5;
    const centerY = 30;
    const halfHeight = centerY - pad;

    // Always draw zero line
    ctx.strokeStyle = 'rgba(138, 148, 158, 0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(280, centerY);
    ctx.stroke();
    ctx.setLineDash([]);

    if (!history || history.length === 0) {
      drawWaitingMessage(ctx, 280, 60, 'rgba(138, 148, 158, 0.4)');
      return;
    }

    const vsValues = history.map(p => p.vs || 0);
    const maxAbsVs = Math.max(Math.abs(Math.min(...vsValues)), Math.abs(Math.max(...vsValues)), 500);

    const getY = (vs) => {
      const normalized = Math.max(-1, Math.min(1, vs / maxAbsVs));
      return centerY - (normalized * halfHeight);
    };

    // Draw gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 60);
    gradient.addColorStop(0, 'rgba(34, 197, 94, 0.2)');
    gradient.addColorStop(0.5, 'rgba(138, 148, 158, 0.05)');
    gradient.addColorStop(1, 'rgba(249, 115, 22, 0.2)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, centerY);

    const xStep = history.length > 1 ? 280 / (history.length - 1) : 280;
    history.forEach((p, i) => {
      const x = history.length > 1 ? i * xStep : 140;
      ctx.lineTo(x, getY(p.vs || 0));
    });

    if (history.length === 1) {
      ctx.lineTo(280, getY(history[0].vs || 0));
    }

    ctx.lineTo(280, centerY);
    ctx.closePath();
    ctx.fill();

    // Draw line - use green for climbing, orange for descending
    const latestVs = history.length > 0 ? (history[history.length - 1].vs || 0) : 0;
    ctx.strokeStyle = latestVs > 0 ? 'rgba(34, 197, 94, 0.9)' : latestVs < 0 ? 'rgba(249, 115, 22, 0.9)' : 'rgba(138, 148, 158, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();

    history.forEach((p, i) => {
      const x = history.length > 1 ? i * xStep : 0;
      const y = getY(p.vs || 0);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    if (history.length === 1) {
      ctx.lineTo(280, getY(history[0].vs || 0));
    }

    ctx.stroke();
  }, [selectedAircraft, trackHistory]);

  // Draw distance profile canvas
  useEffect(() => {
    if (!distProfileCanvasRef.current || !selectedAircraft) return;

    const canvas = distProfileCanvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 280, 60);

    const history = trackHistory[selectedAircraft.hex];
    if (!history || history.length === 0) {
      drawWaitingMessage(ctx, 280, 60, 'rgba(163, 113, 247, 0.4)');
      return;
    }

    const dists = history.map(p => p.dist || 0).filter(d => d > 0);

    if (dists.length === 0) {
      drawWaitingMessage(ctx, 280, 60, 'rgba(163, 113, 247, 0.4)');
      return;
    }

    const minDist = Math.min(...dists);
    const maxDist = Math.max(...dists);
    const range = maxDist - minDist || 10;
    const pad = 5;

    // Helper to clamp Y values within canvas bounds
    const getY = (dist) => {
      const normalized = Math.max(0, Math.min(1, (dist - minDist) / range));
      return 60 - pad - (normalized * (60 - pad * 2));
    };

    // Draw gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 60);
    gradient.addColorStop(0, 'rgba(163, 113, 247, 0.3)');
    gradient.addColorStop(1, 'rgba(163, 113, 247, 0.05)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, 60 - pad);

    const xStep = history.length > 1 ? 280 / (history.length - 1) : 280;
    history.forEach((p, i) => {
      const x = history.length > 1 ? i * xStep : 140;
      ctx.lineTo(x, getY(p.dist || minDist));
    });

    if (history.length === 1) {
      ctx.lineTo(280, getY(history[0].dist || minDist));
    }

    ctx.lineTo(280, 60 - pad);
    ctx.closePath();
    ctx.fill();

    // Draw line
    ctx.strokeStyle = 'rgba(163, 113, 247, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();

    history.forEach((p, i) => {
      const x = history.length > 1 ? i * xStep : 0;
      const y = getY(p.dist || minDist);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    if (history.length === 1) {
      ctx.lineTo(280, getY(history[0].dist || minDist));
    }

    ctx.stroke();
  }, [selectedAircraft, trackHistory]);

  // Fetch aviation data via WebSocket - uses viewport center for dynamic loading
  useEffect(() => {
    if (!wsRequest || !wsConnected) return;

    // Use viewport center if available, otherwise fall back to feeder location
    const centerLat = viewportCenter.lat ?? feederLat;
    const centerLon = viewportCenter.lon ?? feederLon;

    const extractData = (response) => {
      if (!response) return [];
      if (Array.isArray(response)) return response;
      if (response.data && Array.isArray(response.data)) return response.data;
      if (response.features) {
        return response.features.map(f => ({
          ...f.properties,
          lat: f.geometry?.coordinates?.[1],
          lon: f.geometry?.coordinates?.[0]
        }));
      }
      return [];
    };

    const normalizeAirport = (apt) => ({
      ...apt,
      icao: apt.icao || apt.icaoId || apt.faaId || apt.id || 'UNK',
      id: apt.id || apt.icaoId || apt.faaId || 'UNK',
      name: apt.name || apt.site || null,
      city: apt.city || apt.assocCity || null,
      state: apt.state || apt.stateProv || null,
      elev: apt.elev ?? apt.elev_ft ?? apt.elevation ?? null,
      class: apt.class || apt.airspaceClass || null,
    });

    const fetchAviationData = async () => {
      const baseParams = { lat: centerLat, lon: centerLon };

      try {
        // Fetch all data in parallel via WebSocket requests
        const promises = [];

        // NAVAIDs
        promises.push(
          wsRequest('navaids', { ...baseParams, radius: Math.round(radarRange * 1.5) })
            .then(data => ({ type: 'navaids', data: extractData(data) }))
            .catch(err => ({ type: 'navaids', error: err.message }))
        );

        // Airports
        promises.push(
          wsRequest('airports', { ...baseParams, radius: Math.round(radarRange * 1.2), limit: 50 })
            .then(data => ({ type: 'airports', data: extractData(data).map(normalizeAirport) }))
            .catch(err => ({ type: 'airports', error: err.message }))
        );

        // Airspace (if enabled)
        if (overlays.airspace) {
          // G-AIRMET advisories
          promises.push(
            wsRequest('airspaces', baseParams)
              .then(data => {
                const advisories = (data?.advisories || extractData(data)).map(adv => ({
                  ...adv,
                  isAdvisory: true,
                  type: adv.type || 'GAIRMET',
                }));
                return { type: 'airspaces', data: advisories };
              })
              .catch(err => ({ type: 'airspaces', error: err.message }))
          );

          // Static boundaries
          promises.push(
            wsRequest('airspace-boundaries', { ...baseParams, radius: Math.round(radarRange * 1.5) })
              .then(data => {
                // Response has { boundaries: [...], count, source, ... }
                const rawBoundaries = data?.boundaries || extractData(data);
                const boundaries = rawBoundaries.map(b => ({
                  ...b,
                  isBoundary: true,
                  type: b.class ? `CLASS_${b.class}` : b.type,
                }));
                return { type: 'boundaries', data: boundaries };
              })
              .catch(err => ({ type: 'boundaries', error: err.message }))
          );
        }

        // METARs (if enabled)
        if (overlays.metars) {
          promises.push(
            wsRequest('metars', { ...baseParams, radius: Math.round(radarRange) })
              .then(data => ({ type: 'metars', data: extractData(data) }))
              .catch(err => ({ type: 'metars', error: err.message }))
          );
        }

        // PIREPs (if enabled)
        if (overlays.pireps) {
          promises.push(
            wsRequest('pireps', { ...baseParams, radius: Math.round(radarRange * 1.5), hours: 3 })
              .then(data => ({ type: 'pireps', data: extractData(data) }))
              .catch(err => ({ type: 'pireps', error: err.message }))
          );
        }

        const results = await Promise.all(promises);

        // Update state with results
        setAviationData(prev => {
          const updated = { ...prev };
          results.forEach(result => {
            if (!result.error && result.data) {
              updated[result.type] = result.data;
            }
          });
          return updated;
        });

        const errors = results.filter(r => r.error);
        if (errors.length > 0) {
          console.warn('Some aviation data requests failed:', errors);
        }
      } catch (err) {
        console.log('Aviation data fetch error:', err.message);
      }
    };

    fetchAviationData();
    // Refresh every 5 minutes
    const interval = setInterval(fetchAviationData, 300000);
    return () => clearInterval(interval);
  }, [wsRequest, wsConnected, viewportCenter.lat, viewportCenter.lon, feederLat, feederLon, radarRange, overlays.metars, overlays.pireps, overlays.airspace]);

  const sortedAircraft = useMemo(() => {
    let filtered = [...aircraft].filter(a => a.lat && a.lon);
    
    // Apply traffic filters
    filtered = filtered.filter(ac => {
      // Military/Civil filter
      if (ac.military && !trafficFilters.showMilitary) return false;
      if (!ac.military && !trafficFilters.showCivil) return false;
      
      // Ground/Airborne filter
      const isGround = ac.alt_baro === 'ground' || ac.on_ground || (ac.alt && ac.alt < 100);
      if (isGround && !trafficFilters.showGround) return false;
      if (!isGround && !trafficFilters.showAirborne) return false;
      
      // Altitude filter (only for airborne)
      if (!isGround && ac.alt) {
        if (ac.alt < trafficFilters.minAltitude) return false;
        if (ac.alt > trafficFilters.maxAltitude) return false;
      }
      
      // Squawk filter
      const hasSquawk = ac.squawk && ac.squawk !== '0000';
      if (hasSquawk && !trafficFilters.showWithSquawk) return false;
      if (!hasSquawk && !trafficFilters.showWithoutSquawk) return false;
      
      return true;
    });
    
    // Apply search filter if in Pro mode and search query exists
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(ac => {
        const callsign = (ac.flight || '').toLowerCase().trim();
        const hex = (ac.hex || '').toLowerCase();
        const squawk = (ac.squawk || '').toLowerCase();
        const tail = getTailInfo(ac.hex, ac.flight).tailNumber?.toLowerCase() || '';
        return callsign.includes(query) || 
               hex.includes(query) || 
               squawk.includes(query) || 
               tail.includes(query);
      });
    }
    
    return filtered.sort((a, b) => (a.distance_nm || 999) - (b.distance_nm || 999));
  }, [aircraft, searchQuery, trafficFilters]);

  // Live aircraft data for selected aircraft (updates in real-time)
  const liveAircraft = useMemo(() => {
    if (!selectedAircraft) return null;
    return sortedAircraft.find(a => a.hex === selectedAircraft.hex) || selectedAircraft;
  }, [selectedAircraft, sortedAircraft]);

  // Calculate bounds for simple radar mode (include feeder location)
  const bounds = useMemo(() => {
    const allLats = [...sortedAircraft.map(a => a.lat), feederLat];
    const allLons = [...sortedAircraft.map(a => a.lon), feederLon];
    
    if (sortedAircraft.length === 0) {
      return {
        minLat: feederLat - 1,
        maxLat: feederLat + 1,
        minLon: feederLon - 1.5,
        maxLon: feederLon + 1.5
      };
    }
    
    const latPad = Math.max(0.3, (Math.max(...allLats) - Math.min(...allLats)) * 0.15);
    const lonPad = Math.max(0.4, (Math.max(...allLons) - Math.min(...allLons)) * 0.15);
    
    return {
      minLat: Math.min(...allLats) - latPad,
      maxLat: Math.max(...allLats) + latPad,
      minLon: Math.min(...allLons) - lonPad,
      maxLon: Math.max(...allLons) + lonPad
    };
  }, [sortedAircraft, feederLat, feederLon]);

  // Get screen position for lat/lon (simple radar mode)
  const getPosition = (lat, lon) => {
    const x = ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * 90 + 5;
    const y = (1 - (lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 90 + 5;
    return { x: Math.max(2, Math.min(98, x)), y: Math.max(2, Math.min(98, y)) };
  };

  // Calculate distance from feeder in nm
  const getDistanceNm = (lat, lon) => {
    const dLat = lat - feederLat;
    const dLon = lon - feederLon;
    const latNm = dLat * 60;
    const lonNm = dLon * 60 * Math.cos(feederLat * Math.PI / 180);
    return Math.sqrt(latNm * latNm + lonNm * lonNm);
  };

  // Calculate bearing from feeder
  const getBearing = (lat, lon) => {
    const dLat = lat - feederLat;
    const dLon = lon - feederLon;
    const latNm = dLat * 60;
    const lonNm = dLon * 60 * Math.cos(feederLat * Math.PI / 180);
    return (Math.atan2(lonNm, latNm) * 180 / Math.PI + 360) % 360;
  };

  // Update aircraft history for trails
  useEffect(() => {
    if (config.mapMode !== 'crt') return;
    
    const now = Date.now();
    sortedAircraft.forEach(ac => {
      if (!ac.hex) return;
      if (!historyRef.current[ac.hex]) {
        historyRef.current[ac.hex] = [];
      }
      const history = historyRef.current[ac.hex];
      // Add position if moved significantly or first position
      if (history.length === 0 || 
          Math.abs(history[history.length - 1].lat - ac.lat) > 0.001 ||
          Math.abs(history[history.length - 1].lon - ac.lon) > 0.001) {
        history.push({ lat: ac.lat, lon: ac.lon, time: now });
      }
      // Keep only last 60 seconds of history (about 6 positions at 10s intervals)
      while (history.length > 0 && now - history[0].time > 60000) {
        history.shift();
      }
    });
    
    // Clean up old aircraft
    const activeHexes = new Set(sortedAircraft.map(a => a.hex));
    Object.keys(historyRef.current).forEach(hex => {
      if (!activeHexes.has(hex)) {
        delete historyRef.current[hex];
      }
    });
  }, [sortedAircraft, config.mapMode]);

  // CRT Radar Canvas Drawing (also handles Pro mode)
  useEffect(() => {
    if (config.mapMode !== 'crt' && config.mapMode !== 'pro') return;
    if (!canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    const ctx = canvas.getContext('2d');
    
    // Set canvas size to match container
    const resize = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener('resize', resize);

    // Scroll to zoom - smooth increments
    const handleWheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 1.1 : 0.9; // 10% zoom per scroll
      const newRange = Math.round(radarRange * delta);
      const clampedRange = Math.max(5, Math.min(500, newRange));
      if (clampedRange !== radarRange) {
        setRadarRange(clampedRange);
      }
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    // Use fetched aviation data or fallback to static
    const navAids = aviationData.navaids.length > 0 ? aviationData.navaids : [
      { id: 'SEA', name: 'Seattle VORTAC', lat: 47.435, lon: -122.309, type: 'VORTAC' },
      { id: 'PAE', name: 'Paine Field', lat: 47.906, lon: -122.283, type: 'VOR/DME' },
      { id: 'BFI', name: 'Boeing Field', lat: 47.529, lon: -122.302, type: 'VOR/DME' },
      { id: 'TCM', name: 'McChord', lat: 47.136, lon: -122.476, type: 'TACAN' },
      { id: 'OLM', name: 'Olympia', lat: 46.969, lon: -122.902, type: 'VOR/DME' },
      { id: 'EPH', name: 'Ephrata', lat: 47.385, lon: -119.515, type: 'VOR/DME' },
      { id: 'ELN', name: 'Ellensburg', lat: 47.033, lon: -120.530, type: 'VOR/DME' },
      { id: 'YYJ', name: 'Victoria', lat: 48.647, lon: -123.426, type: 'VOR/DME' },
      { id: 'CV', name: 'Coupeville', lat: 48.188, lon: -122.688, type: 'NDB' },
      { id: 'BTG', name: 'Battleground', lat: 45.816, lon: -122.531, type: 'VOR/DME' },
      { id: 'UBG', name: 'Bellingham', lat: 48.795, lon: -122.538, type: 'VOR/DME' },
      { id: 'GEG', name: 'Spokane', lat: 47.625, lon: -117.539, type: 'VORTAC' },
    ];

    const airports = aviationData.airports.length > 0 ? aviationData.airports : [
      { icao: 'KSEA', name: 'Seattle-Tacoma', lat: 47.449, lon: -122.309, class: 'B' },
      { icao: 'KBFI', name: 'Boeing Field', lat: 47.529, lon: -122.302, class: 'D' },
      { icao: 'KPAE', name: 'Paine Field', lat: 47.906, lon: -122.283, class: 'D' },
      { icao: 'KPDX', name: 'Portland Intl', lat: 45.589, lon: -122.597, class: 'C' },
      { icao: 'KGEG', name: 'Spokane', lat: 47.620, lon: -117.534, class: 'C' },
    ];

    // Combine airspace advisories and boundaries from API, or use static fallback
    const airspaceData = (aviationData.airspaces.length > 0 || aviationData.boundaries.length > 0)
      ? [...aviationData.airspaces, ...aviationData.boundaries]
      : [
        {
          name: 'Seattle Class B',
          type: 'CLASS_B',
          class: 'B',
          isBoundary: true,
          center: { lat: 47.449, lon: -122.309 },
          rings: [
            { radius_nm: 10, floor_ft: 0, ceiling_ft: 10000 },
            { radius_nm: 20, floor_ft: 3000, ceiling_ft: 10000 },
            { radius_nm: 30, floor_ft: 6000, ceiling_ft: 10000 },
          ]
        }
      ];

    // Animation loop
    const isPro = config.mapMode === 'pro';
    let frameCount = 0;
    const draw = () => {
      frameCount++;
      const width = canvas.width / window.devicePixelRatio;
      const height = canvas.height / window.devicePixelRatio;
      const centerX = width / 2;
      const centerY = height / 2;
      // For Pro mode: use full rectangular area
      // For CRT mode: use circular area that fills more of the canvas
      const maxRadius = isPro 
        ? Math.max(width, height) * 0.5  // Pro: allow overflow for rectangular
        : Math.min(width, height) * 0.48; // CRT: fill more of the circle

      // Clear with dark background
      ctx.fillStyle = isPro ? '#0a0d12' : '#0a0f0a';
      ctx.fillRect(0, 0, width, height);

      // For Pro mode, calculate scale to show full area (no circular limit)
      // nmPerPixel tells us how many nm one pixel represents
      const nmPerPixel = isPro ? radarRange / (Math.min(width, height) * 0.45) : radarRange / maxRadius;
      
      // Helper to convert lat/lon to screen coordinates
      const latLonToScreen = (lat, lon) => {
        const dLat = lat - feederLat;
        const dLon = lon - feederLon;
        const nmY = dLat * 60; // North is up
        const nmX = dLon * 60 * Math.cos(feederLat * Math.PI / 180);
        
        if (isPro) {
          // Pro mode: linear mapping, no circular constraint
          const pixelsPerNm = (Math.min(width, height) * 0.45) / radarRange;
          return {
            x: centerX + nmX * pixelsPerNm,
            y: centerY - nmY * pixelsPerNm // Flip Y for screen coords
          };
        } else {
          // CRT mode: polar mapping with circular constraint
          const dist = Math.sqrt(nmX * nmX + nmY * nmY);
          const bearing = Math.atan2(nmX, nmY) * 180 / Math.PI;
          const radius = (dist / radarRange) * maxRadius;
          const rad = (bearing - 90) * Math.PI / 180;
          return {
            x: centerX + Math.cos(rad) * radius,
            y: centerY + Math.sin(rad) * radius
          };
        }
      };

      if (!isPro) {
        // Add subtle noise/texture (CRT only)
        ctx.fillStyle = 'rgba(0, 40, 0, 0.03)';
        for (let i = 0; i < 50; i++) {
          const x = Math.random() * width;
          const y = Math.random() * height;
          ctx.fillRect(x, y, 2, 2);
        }
      }

      if (isPro) {
        // PRO MODE: Draw lat/lon grid
        const gridColor = 'rgba(40, 80, 120, 0.3)';
        const gridLabelColor = 'rgba(80, 140, 180, 0.7)';
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.font = '12px "JetBrains Mono", monospace';
        ctx.fillStyle = gridLabelColor;
        
        // Calculate grid spacing based on range
        const degPerNm = 1/60;
        let gridSpacingDeg = radarRange <= 30 ? 0.25 : radarRange <= 75 ? 0.5 : radarRange <= 150 ? 1 : 2;
        
        // Latitude lines (horizontal)
        const minGridLat = Math.floor((feederLat - radarRange * degPerNm) / gridSpacingDeg) * gridSpacingDeg;
        const maxGridLat = Math.ceil((feederLat + radarRange * degPerNm) / gridSpacingDeg) * gridSpacingDeg;
        
        for (let lat = minGridLat; lat <= maxGridLat; lat += gridSpacingDeg) {
          const p1 = latLonToScreen(lat, feederLon - radarRange * degPerNm * 1.5);
          const p2 = latLonToScreen(lat, feederLon + radarRange * degPerNm * 1.5);
          if (p1.y > 0 && p1.y < height) {
            ctx.beginPath();
            ctx.moveTo(0, p1.y);
            ctx.lineTo(width, p1.y);
            ctx.stroke();
            ctx.textAlign = 'left';
            ctx.fillText(`${lat.toFixed(2)}°`, 8, p1.y - 5);
          }
        }
        
        // Longitude lines (vertical)
        const lonScale = Math.cos(feederLat * Math.PI / 180);
        const minGridLon = Math.floor((feederLon - radarRange * degPerNm / lonScale) / gridSpacingDeg) * gridSpacingDeg;
        const maxGridLon = Math.ceil((feederLon + radarRange * degPerNm / lonScale) / gridSpacingDeg) * gridSpacingDeg;
        
        for (let lon = minGridLon; lon <= maxGridLon; lon += gridSpacingDeg) {
          const p1 = latLonToScreen(feederLat, lon);
          if (p1.x > 0 && p1.x < width) {
            ctx.beginPath();
            ctx.moveTo(p1.x, 0);
            ctx.lineTo(p1.x, height);
            ctx.stroke();
            ctx.textAlign = 'center';
            ctx.fillText(`${Math.abs(lon).toFixed(2)}°W`, p1.x, height - 8);
          }
        }
        
        // Scale bar
        const scaleBarNm = radarRange <= 30 ? 10 : radarRange <= 75 ? 25 : radarRange <= 150 ? 50 : 100;
        const scaleBarPx = (scaleBarNm / radarRange) * (Math.min(width, height) * 0.45);
        const scaleBarY = height - 20;
        
        // Draw text clearly above the line
        ctx.fillStyle = 'rgba(100, 180, 255, 0.8)';
        ctx.textAlign = 'center';
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.fillText(`${scaleBarNm} nm`, width - 20 - scaleBarPx/2, scaleBarY - 10);
        
        // Draw the scale bar line below text
        ctx.strokeStyle = 'rgba(100, 180, 255, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(width - 20 - scaleBarPx, scaleBarY);
        ctx.lineTo(width - 20, scaleBarY);
        // End caps (shorter)
        ctx.moveTo(width - 20 - scaleBarPx, scaleBarY - 3);
        ctx.lineTo(width - 20 - scaleBarPx, scaleBarY + 3);
        ctx.moveTo(width - 20, scaleBarY - 3);
        ctx.lineTo(width - 20, scaleBarY + 3);
        ctx.stroke();
        
        // PRO MODE: Add range rings (subtle, dashed)
        const proRingDistances = radarRange <= 30 ? [10, 20, 30] : 
                                 radarRange <= 75 ? [25, 50, 75] : 
                                 radarRange <= 150 ? [50, 100, 150] :
                                 [100, 200, 300];
        
        const proPixelsPerNm = (Math.min(width, height) * 0.45) / radarRange;
        ctx.strokeStyle = 'rgba(60, 100, 140, 0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([8, 8]);
        
        proRingDistances.forEach(dist => {
          if (dist > radarRange * 1.2) return;
          const radius = dist * proPixelsPerNm;
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
          ctx.stroke();
          
          // Range label (top of ring)
          ctx.fillStyle = 'rgba(80, 130, 170, 0.6)';
          ctx.font = '11px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`${dist}nm`, centerX, centerY - radius - 4);
        });
        ctx.setLineDash([]);
        
      } else {
        // CRT MODE: Draw range rings
        const ringDistances = radarRange <= 50 ? [10, 20, 30, 40, 50] : 
                              radarRange <= 100 ? [25, 50, 75, 100] : 
                              [50, 100, 150];
        
        ctx.strokeStyle = 'rgba(0, 180, 80, 0.4)';
        ctx.lineWidth = 1;
        
        ringDistances.forEach(dist => {
          if (dist > radarRange) return;
          const radius = (dist / radarRange) * maxRadius;
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
          ctx.stroke();
          
          // Range label
          ctx.fillStyle = 'rgba(0, 180, 80, 0.7)';
          ctx.font = '13px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`${dist}`, centerX, centerY - radius - 6);
        });

        // Draw compass lines and labels
        const compassPoints = [
          { angle: 0, label: 'N' },
          { angle: 90, label: 'E' },
          { angle: 180, label: 'S' },
          { angle: 270, label: 'W' }
        ];
        
        ctx.strokeStyle = 'rgba(0, 180, 80, 0.25)';
        ctx.lineWidth = 1;
        
        compassPoints.forEach(({ angle, label }) => {
          const rad = (angle - 90) * Math.PI / 180;
          ctx.beginPath();
          ctx.moveTo(centerX, centerY);
          ctx.lineTo(centerX + Math.cos(rad) * maxRadius, centerY + Math.sin(rad) * maxRadius);
          ctx.stroke();
          
          // Label
          ctx.fillStyle = 'rgba(0, 200, 100, 0.8)';
          ctx.font = 'bold 18px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const labelRadius = maxRadius + 22;
          ctx.fillText(label, centerX + Math.cos(rad) * labelRadius, centerY + Math.sin(rad) * labelRadius);
        });

        // Draw 30-degree lines
        ctx.strokeStyle = 'rgba(0, 180, 80, 0.15)';
        for (let angle = 30; angle < 360; angle += 30) {
          if (angle % 90 === 0) continue;
          const rad = (angle - 90) * Math.PI / 180;
          ctx.beginPath();
          ctx.moveTo(centerX + Math.cos(rad) * 20, centerY + Math.sin(rad) * 20);
          ctx.lineTo(centerX + Math.cos(rad) * maxRadius, centerY + Math.sin(rad) * maxRadius);
          ctx.stroke();
        }
      }

      // Draw center marker (feeder location)
      ctx.fillStyle = isPro ? 'rgba(100, 200, 255, 0.9)' : 'rgba(0, 255, 100, 0.8)';
      ctx.beginPath();
      ctx.arc(centerX, centerY, isPro ? 5 : 4, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.strokeStyle = isPro ? 'rgba(100, 200, 255, 0.5)' : 'rgba(0, 255, 100, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(centerX - 10, centerY);
      ctx.lineTo(centerX + 10, centerY);
      ctx.moveTo(centerX, centerY - 10);
      ctx.lineTo(centerX, centerY + 10);
      ctx.stroke();

      // Draw VORs and Navaids (if overlay enabled)
      if (overlays.vors) {
        navAids.forEach(nav => {
          const dist = getDistanceNm(nav.lat, nav.lon);
          if (!isPro && dist > radarRange * 1.1) return;
          if (isPro && dist > radarRange * 1.5) return;
          
          const pos = latLonToScreen(nav.lat, nav.lon);
          const x = pos.x;
          const y = pos.y;
          
          // Skip if outside canvas
          if (x < 0 || x > width || y < 0 || y > height) return;
          
          // Check if selected
          const isSelected = selectedNavaid && 
            selectedNavaid.lat === nav.lat && 
            selectedNavaid.lon === nav.lon;
          
          // Draw selection indicator
          if (isSelected) {
            ctx.save();
            ctx.strokeStyle = 'rgba(100, 220, 255, 0.9)';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.arc(x, y, 16, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
          }
          
          // Draw VOR symbol (hexagon)
          const vorSize = isPro ? 9 : 8;
          ctx.save();
          ctx.translate(x, y);
          
          const navType = nav.type || '';
          const baseColor = isSelected ? 1.0 : 0.7;
          if (navType.includes('VORTAC') || navType.includes('VOR')) {
            // Hexagon for VOR
            ctx.strokeStyle = isPro ? `rgba(80, 140, 220, ${baseColor + 0.1})` : `rgba(100, 150, 255, ${baseColor})`;
            ctx.lineWidth = isSelected ? 2 : 1.5;
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
              const angle = (i * 60 - 30) * Math.PI / 180;
              const px = Math.cos(angle) * vorSize;
              const py = Math.sin(angle) * vorSize;
              if (i === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.stroke();
            
            // Center dot
            ctx.fillStyle = isPro ? `rgba(80, 140, 220, ${baseColor + 0.2})` : `rgba(100, 150, 255, ${baseColor + 0.1})`;
            ctx.beginPath();
            ctx.arc(0, 0, 2, 0, Math.PI * 2);
            ctx.fill();
          } else if (navType.includes('TACAN')) {
            // Triangle for TACAN
            ctx.strokeStyle = `rgba(255, 150, 100, ${baseColor})`;
            ctx.lineWidth = isSelected ? 2 : 1.5;
            ctx.beginPath();
            ctx.moveTo(0, -vorSize);
            ctx.lineTo(vorSize * 0.866, vorSize * 0.5);
            ctx.lineTo(-vorSize * 0.866, vorSize * 0.5);
            ctx.closePath();
            ctx.stroke();
          } else if (navType.includes('NDB')) {
            // Circle with dots for NDB
            ctx.strokeStyle = `rgba(200, 100, 255, ${baseColor - 0.1})`;
            ctx.lineWidth = isSelected ? 1.5 : 1;
            ctx.beginPath();
            ctx.arc(0, 0, vorSize, 0, Math.PI * 2);
            ctx.stroke();
          }
          
          ctx.restore();
          
          // Label with background
          ctx.font = isSelected ? 'bold 12px "JetBrains Mono", monospace' : '12px "JetBrains Mono", monospace';
          const navLabelWidth = ctx.measureText(nav.id).width + 6;
          ctx.fillStyle = isPro ? 'rgba(10, 13, 18, 0.8)' : 'rgba(10, 15, 10, 0.75)';
          ctx.fillRect(x + 7, y - 6, navLabelWidth, 16);
          ctx.fillStyle = isPro ? `rgba(80, 140, 220, ${baseColor + 0.1})` : `rgba(100, 150, 255, ${baseColor})`;
          ctx.textAlign = 'left';
          ctx.fillText(nav.id, x + 10, y + 4);
        });
      }

      // Draw airports (if overlay enabled)
      if (overlays.airports) {
        airports.forEach(apt => {
          const dist = getDistanceNm(apt.lat, apt.lon);
          if (!isPro && dist > radarRange * 1.1) return;
          if (isPro && dist > radarRange * 1.5) return;
          
          const pos = latLonToScreen(apt.lat, apt.lon);
          const x = pos.x;
          const y = pos.y;
          
          if (x < 0 || x > width || y < 0 || y > height) return;
          
          // Check if selected
          const isSelected = selectedAirport && 
            selectedAirport.lat === apt.lat && 
            selectedAirport.lon === apt.lon;
          
          // Draw selection indicator
          if (isSelected) {
            ctx.save();
            ctx.strokeStyle = 'rgba(100, 220, 255, 0.9)';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.arc(x, y, 18, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
          }
          
          // Airport symbol based on class
          ctx.save();
          ctx.translate(x, y);
          
          const aptClass = apt.class || 'E';
          let color = 'rgba(180, 180, 180, 0.6)';
          if (aptClass === 'B') color = 'rgba(100, 150, 255, 0.7)';
          else if (aptClass === 'C') color = 'rgba(200, 100, 200, 0.7)';
          else if (aptClass === 'D') color = 'rgba(100, 200, 100, 0.7)';
          
          // Brighten if selected
          if (isSelected) {
            color = color.replace(/[\d.]+\)$/, '1)');
          }
          
          ctx.strokeStyle = color;
          ctx.lineWidth = isSelected ? 1.5 : 1;
          
          // Draw runway symbol (circle with lines)
          ctx.beginPath();
          ctx.arc(0, 0, isSelected ? 5 : 4, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(isSelected ? -10 : -8, 0);
          ctx.lineTo(isSelected ? 10 : 8, 0);
          ctx.stroke();
          
          ctx.restore();
          
          // Label with background
          const aptId = apt.icao || apt.icaoId || apt.faaId || apt.id || 'APT';
          ctx.font = isSelected ? 'bold 11px "JetBrains Mono", monospace' : '11px "JetBrains Mono", monospace';
          const aptLabelWidth = ctx.measureText(aptId).width + 6;
          ctx.fillStyle = isPro ? 'rgba(10, 13, 18, 0.8)' : 'rgba(10, 15, 10, 0.75)';
          ctx.fillRect(x + 7, y - 6, aptLabelWidth, 15);
          ctx.fillStyle = color;
          ctx.textAlign = 'left';
          ctx.fillText(aptId, x + 10, y + 4);
        });
      }

      // Draw airspace (if overlay enabled)
      if (overlays.airspace) {
        // Helper to get airspace color based on type/class
        const getAirspaceColor = (as) => {
          const asClass = as.class || as.type?.replace('CLASS_', '');
          if (asClass === 'B' || as.type === 'CLASS_B') return 'rgba(80, 120, 200, 0.35)';
          if (asClass === 'C' || as.type === 'CLASS_C') return 'rgba(180, 80, 180, 0.35)';
          if (asClass === 'D' || as.type === 'CLASS_D') return 'rgba(80, 180, 180, 0.35)';
          if (as.type === 'RESTRICTED' || as.type === 'R') return 'rgba(200, 80, 80, 0.4)';
          if (as.type === 'MOA') return 'rgba(200, 150, 80, 0.3)';
          if (as.type === 'TFR') return 'rgba(255, 80, 80, 0.5)';
          return 'rgba(100, 100, 200, 0.3)';
        };

        airspaceData.forEach(as => {
          const asColor = getAirspaceColor(as);

          // Draw polygon boundaries (from API)
          if (as.polygon && Array.isArray(as.polygon) && as.polygon.length >= 3) {
            ctx.strokeStyle = asColor;
            ctx.fillStyle = asColor.replace(/[\d.]+\)$/, '0.1)'); // Lighter fill
            ctx.lineWidth = isPro ? 2 : 1.5;
            ctx.setLineDash([8, 4]);

            ctx.beginPath();
            as.polygon.forEach((coord, idx) => {
              // Polygon coords are [lon, lat] format
              const lon = Array.isArray(coord) ? coord[0] : coord.lon;
              const lat = Array.isArray(coord) ? coord[1] : coord.lat;
              const screenPos = latLonToScreen(lat, lon);

              if (idx === 0) {
                ctx.moveTo(screenPos.x, screenPos.y);
              } else {
                ctx.lineTo(screenPos.x, screenPos.y);
              }
            });
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw label at center
            if (as.name) {
              const asCenter = as.center || { lat: as.lat, lon: as.lon };
              if (asCenter?.lat && asCenter?.lon) {
                const labelPos = latLonToScreen(asCenter.lat, asCenter.lon);
                ctx.fillStyle = asColor.replace(/[\d.]+\)$/, '0.8)');
                ctx.font = isPro ? 'bold 12px "JetBrains Mono", monospace' : '11px "JetBrains Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText(as.name, labelPos.x, labelPos.y);
                if (as.floor_ft !== undefined && as.ceiling_ft !== undefined) {
                  ctx.font = isPro ? '10px "JetBrains Mono", monospace' : '9px "JetBrains Mono", monospace';
                  ctx.fillText(`${as.floor_ft}-${as.ceiling_ft}ft`, labelPos.x, labelPos.y + 12);
                }
              }
            }
          }
          // Draw circular rings (fallback for simple boundaries)
          else if (as.rings) {
            const asCenter = as.center || { lat: as.lat, lon: as.lon };
            const pos = latLonToScreen(asCenter.lat, asCenter.lon);

            as.rings.forEach((ring, idx) => {
              const radiusNm = ring.radius_nm || ring.radius;
              // Use same scaling as latLonToScreen for consistency
              const pixelsPerNm = isPro
                ? (Math.min(width, height) * 0.45) / radarRange
                : maxRadius / radarRange;
              const radiusPx = radiusNm * pixelsPerNm;

              if (radiusPx > 5) {
                ctx.strokeStyle = asColor;
                ctx.lineWidth = isPro ? 1.5 : 1;
                ctx.setLineDash([6, 4]);
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, radiusPx, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);

                if (idx === 0 && as.name) {
                  ctx.fillStyle = asColor.replace(/[\d.]+\)$/, '0.7)');
                  ctx.font = '11px "JetBrains Mono", monospace';
                  ctx.textAlign = 'center';
                  ctx.fillText(as.name, pos.x, pos.y - radiusPx - 6);
                }
              }
            });
          }
          // Draw simple radius circle (when only radius_nm is provided)
          else if (as.radius_nm && as.center) {
            const pos = latLonToScreen(as.center.lat, as.center.lon);
            const pixelsPerNm = isPro
              ? (Math.min(width, height) * 0.45) / radarRange
              : maxRadius / radarRange;
            const radiusPx = as.radius_nm * pixelsPerNm;

            if (radiusPx > 5) {
              ctx.strokeStyle = asColor;
              ctx.lineWidth = isPro ? 1.5 : 1;
              ctx.setLineDash([6, 4]);
              ctx.beginPath();
              ctx.arc(pos.x, pos.y, radiusPx, 0, Math.PI * 2);
              ctx.stroke();
              ctx.setLineDash([]);

              if (as.name) {
                ctx.fillStyle = asColor.replace(/[\d.]+\)$/, '0.7)');
                ctx.font = '11px "JetBrains Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText(as.name, pos.x, pos.y - radiusPx - 6);
              }
            }
          }
        });
      }

      // Draw PIREPs if enabled (Pro mode primarily)
      if (overlays.pireps && aviationData.pireps.length > 0) {
        aviationData.pireps.forEach(pirep => {
          if (!pirep.lat || !pirep.lon) return;
          const pos = latLonToScreen(pirep.lat, pirep.lon);
          if (pos.x < 0 || pos.x > width || pos.y < 0 || pos.y > height) return;
          
          ctx.save();
          ctx.translate(pos.x, pos.y);
          
          // Check if this PIREP is selected
          const isSelected = selectedPirep && 
            selectedPirep.lat === pirep.lat && 
            selectedPirep.lon === pirep.lon;
          
          // Draw selection indicator
          if (isSelected) {
            const selFlash = Math.floor(frameCount / 10) % 2 === 0;
            const selAlpha = selFlash ? 0.9 : 0.4;
            const selSize = selFlash ? 18 : 16;
            
            ctx.strokeStyle = `rgba(100, 220, 255, ${selAlpha})`;
            ctx.lineWidth = 2;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.arc(0, 0, selSize, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Corner brackets
            const bSize = 12;
            const bLen = 5;
            ctx.strokeStyle = `rgba(100, 220, 255, ${selAlpha})`;
            ctx.lineWidth = 2;
            // Top-left
            ctx.beginPath();
            ctx.moveTo(-bSize, -bSize + bLen);
            ctx.lineTo(-bSize, -bSize);
            ctx.lineTo(-bSize + bLen, -bSize);
            ctx.stroke();
            // Top-right
            ctx.beginPath();
            ctx.moveTo(bSize - bLen, -bSize);
            ctx.lineTo(bSize, -bSize);
            ctx.lineTo(bSize, -bSize + bLen);
            ctx.stroke();
            // Bottom-left
            ctx.beginPath();
            ctx.moveTo(-bSize, bSize - bLen);
            ctx.lineTo(-bSize, bSize);
            ctx.lineTo(-bSize + bLen, bSize);
            ctx.stroke();
            // Bottom-right
            ctx.beginPath();
            ctx.moveTo(bSize - bLen, bSize);
            ctx.lineTo(bSize, bSize);
            ctx.lineTo(bSize, bSize - bLen);
            ctx.stroke();
          }
          
          // PIREP color based on type
          const pirepType = getPirepType(pirep);
          let color, fillColor;
          switch (pirepType) {
            case 'urgent':
              color = 'rgba(255, 50, 50, 0.9)';  // Red for urgent
              fillColor = 'rgba(255, 50, 50, 0.3)';
              break;
            case 'turbulence':
              color = 'rgba(255, 150, 50, 0.85)';  // Orange for turbulence
              fillColor = 'rgba(255, 150, 50, 0.25)';
              break;
            case 'icing':
              color = 'rgba(100, 180, 255, 0.85)';  // Blue for icing
              fillColor = 'rgba(100, 180, 255, 0.25)';
              break;
            case 'both':
              color = 'rgba(200, 100, 255, 0.85)';  // Purple for both
              fillColor = 'rgba(200, 100, 255, 0.25)';
              break;
            case 'windshear':
              color = 'rgba(255, 100, 200, 0.85)';  // Magenta for wind shear
              fillColor = 'rgba(255, 100, 200, 0.25)';
              break;
            default:
              color = 'rgba(255, 220, 100, 0.7)';  // Yellow for routine
              fillColor = 'rgba(255, 220, 100, 0.15)';
          }
          
          // Make selected PIREPs brighter
          if (isSelected) {
            color = color.replace(/0\.\d+\)/, '1)');
          }
          
          // Draw diamond symbol
          ctx.strokeStyle = color;
          ctx.lineWidth = isSelected ? 2.5 : 1.5;
          ctx.beginPath();
          ctx.moveTo(0, -7);
          ctx.lineTo(6, 0);
          ctx.lineTo(0, 7);
          ctx.lineTo(-6, 0);
          ctx.closePath();
          ctx.stroke();
          
          // Fill based on type (always fill slightly, more if selected)
          ctx.fillStyle = isSelected ? color.replace(/[\d.]+\)$/, '0.4)') : fillColor;
          ctx.fill();
          
          // Add inner symbol for turb/ice
          if (pirepType === 'turbulence' || pirepType === 'both') {
            // Wavy line for turbulence
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(-3, 0);
            ctx.quadraticCurveTo(-1.5, -2, 0, 0);
            ctx.quadraticCurveTo(1.5, 2, 3, 0);
            ctx.stroke();
          }
          if (pirepType === 'icing') {
            // Snowflake-ish symbol for icing
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, -3);
            ctx.lineTo(0, 3);
            ctx.moveTo(-2.5, -1.5);
            ctx.lineTo(2.5, 1.5);
            ctx.moveTo(-2.5, 1.5);
            ctx.lineTo(2.5, -1.5);
            ctx.stroke();
          }
          if (pirepType === 'windshear') {
            // Arrow-like symbol for wind shear
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(-3, 1);
            ctx.lineTo(0, -2);
            ctx.lineTo(3, 1);
            ctx.stroke();
          }
          
          ctx.restore();
        });
      }

      // Draw METARs if enabled
      if (overlays.metars && aviationData.metars.length > 0) {
        aviationData.metars.forEach(metar => {
          if (!metar.lat || !metar.lon) return;
          const pos = latLonToScreen(metar.lat, metar.lon);
          if (pos.x < 0 || pos.x > width || pos.y < 0 || pos.y > height) return;
          
          // Check if this METAR is selected
          const isSelected = selectedMetar && 
            selectedMetar.lat === metar.lat && 
            selectedMetar.lon === metar.lon;
          
          // Draw selection indicator
          if (isSelected) {
            const selFlash = Math.floor(frameCount / 10) % 2 === 0;
            const selAlpha = selFlash ? 0.9 : 0.4;
            const selSize = selFlash ? 18 : 16;
            
            ctx.save();
            ctx.strokeStyle = `rgba(100, 220, 255, ${selAlpha})`;
            ctx.lineWidth = 2;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, selSize, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Corner brackets
            const bSize = 12;
            const bLen = 5;
            ctx.strokeStyle = `rgba(100, 220, 255, ${selAlpha})`;
            ctx.lineWidth = 2;
            // Top-left
            ctx.beginPath();
            ctx.moveTo(pos.x - bSize, pos.y - bSize + bLen);
            ctx.lineTo(pos.x - bSize, pos.y - bSize);
            ctx.lineTo(pos.x - bSize + bLen, pos.y - bSize);
            ctx.stroke();
            // Top-right
            ctx.beginPath();
            ctx.moveTo(pos.x + bSize - bLen, pos.y - bSize);
            ctx.lineTo(pos.x + bSize, pos.y - bSize);
            ctx.lineTo(pos.x + bSize, pos.y - bSize + bLen);
            ctx.stroke();
            // Bottom-left
            ctx.beginPath();
            ctx.moveTo(pos.x - bSize, pos.y + bSize - bLen);
            ctx.lineTo(pos.x - bSize, pos.y + bSize);
            ctx.lineTo(pos.x - bSize + bLen, pos.y + bSize);
            ctx.stroke();
            // Bottom-right
            ctx.beginPath();
            ctx.moveTo(pos.x + bSize - bLen, pos.y + bSize);
            ctx.lineTo(pos.x + bSize, pos.y + bSize);
            ctx.lineTo(pos.x + bSize, pos.y + bSize - bLen);
            ctx.stroke();
            ctx.restore();
          }
          
          // Flight category color
          let color = 'rgba(0, 255, 0, 0.7)'; // VFR
          if (metar.fltCat === 'MVFR') color = 'rgba(100, 150, 255, 0.8)';
          else if (metar.fltCat === 'IFR') color = 'rgba(255, 100, 100, 0.8)';
          else if (metar.fltCat === 'LIFR') color = 'rgba(255, 50, 200, 0.8)';
          
          // Make selected METARs brighter
          if (isSelected) {
            color = color.replace('0.7', '1').replace('0.8', '1');
          }
          
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, isSelected ? 7 : 5, 0, Math.PI * 2);
          ctx.fill();
          
          // Add outline if selected
          if (isSelected) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 2;
            ctx.stroke();
          }
          
          // Wind barb if significant wind
          if (metar.wspd && metar.wspd > 10) {
            const windDir = (metar.wdir || 0) * Math.PI / 180;
            ctx.strokeStyle = color;
            ctx.lineWidth = isSelected ? 2 : 1.5;
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            ctx.lineTo(pos.x + Math.sin(windDir) * 15, pos.y - Math.cos(windDir) * 15);
            ctx.stroke();
          }
        });
      }

      // Sweep line - CRT mode only
      if (!isPro) {
        sweepAngleRef.current = (sweepAngleRef.current + 1.5) % 360;
        const sweepRad = (sweepAngleRef.current - 90) * Math.PI / 180;
        
        // Draw sweep as gradient arc
        const sweepSpan = 45;
        ctx.save();
        ctx.translate(centerX, centerY);
        
        for (let i = 0; i < sweepSpan; i += 3) {
          const angle1 = (sweepAngleRef.current - i - 90) * Math.PI / 180;
          const angle2 = (sweepAngleRef.current - i - 3 - 90) * Math.PI / 180;
          const alpha = 0.4 * (1 - i / sweepSpan);
          
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, maxRadius, angle2, angle1);
          ctx.closePath();
          ctx.fillStyle = `rgba(0, 255, 100, ${alpha * 0.15})`;
          ctx.fill();
        }
        
        // Main sweep line
        ctx.strokeStyle = 'rgba(0, 255, 100, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(sweepRad) * maxRadius, Math.sin(sweepRad) * maxRadius);
        ctx.stroke();
        
        ctx.restore();
      }

      // Build conflict aircraft set from backend safety events (activeConflicts)
      // No longer doing local proximity calculations - backend handles this
      const conflictAircraft = new Set();
      activeConflicts.forEach(event => {
        if (event.icao) conflictAircraft.add(event.icao.toUpperCase());
        if (event.icao_2) conflictAircraft.add(event.icao_2.toUpperCase());
      });

      // Draw aircraft (if overlay enabled)
      if (overlays.aircraft) {
        sortedAircraft.forEach(ac => {
        const dist = ac.distance_nm || getDistanceNm(ac.lat, ac.lon);
        if (!isPro && dist > radarRange) return;
        if (isPro && dist > radarRange * 1.5) return;
        
        // Use latLonToScreen for positioning
        const pos = latLonToScreen(ac.lat, ac.lon);
        const x = pos.x;
        const y = pos.y;
        
        // Skip if outside canvas (Pro mode)
        if (isPro && (x < 0 || x > width || y < 0 || y > height)) return;

        // Calculate blip brightness based on sweep position (CRT) or constant (Pro)
        const bearing = getBearing(ac.lat, ac.lon);
        let brightness = 1;
        if (!isPro) {
          let sweepDiff = (sweepAngleRef.current - bearing + 360) % 360;
          if (sweepDiff > 180) sweepDiff = 360 - sweepDiff;
          brightness = Math.max(0.3, 1 - sweepDiff / 180);
        }

        // Determine colors - Pro mode uses brighter colors
        const isEmergency = ac.emergency || ['7500', '7600', '7700'].includes(ac.squawk);
        const isMilitary = ac.military;
        const isProximityConflict = conflictAircraft.has(ac.hex);
        
        // Check for safety events (from API)
        const safetyEvent = activeConflicts.find(e => 
          e.icao?.toUpperCase() === ac.hex?.toUpperCase() ||
          e.icao_2?.toUpperCase() === ac.hex?.toUpperCase()
        );
        const hasSafetyAlert = !!safetyEvent || isProximityConflict;
        const alertSeverity = safetyEvent?.severity || (isProximityConflict ? 'warning' : null);
        
        // Emergency flash effect
        const flashOn = isEmergency ? (Math.floor(frameCount / 15) % 2 === 0) : true;
        const flashBrightness = flashOn ? 1 : 0.3;
        
        // Proximity conflict flash speed based on severity
        const flashDivisor = alertSeverity === 'critical' ? 4 : alertSeverity === 'warning' ? 8 : 12;
        const proximityFlashOn = hasSafetyAlert ? (Math.floor(frameCount / flashDivisor) % 2 === 0) : false;
        
        // Severity-based colors
        const getSeverityColors = (severity, flashOn) => {
          const intensity = flashOn ? 1 : 0.6;
          switch (severity) {
            case 'critical':
              return {
                primary: `rgba(255, 80, 150, ${intensity})`,
                text: `rgba(255, 120, 180, ${intensity})`,
                ring: `rgba(255, 80, 150, ${flashOn ? 0.9 : 0.5})`,
                ringInner: `rgba(255, 50, 120, ${(flashOn ? 0.9 : 0.5) * 0.6})`
              };
            case 'warning':
              return {
                primary: `rgba(255, 140, 0, ${intensity})`,
                text: `rgba(255, 180, 80, ${intensity})`,
                ring: `rgba(255, 140, 0, ${flashOn ? 0.9 : 0.5})`,
                ringInner: `rgba(255, 100, 0, ${(flashOn ? 0.9 : 0.5) * 0.6})`
              };
            default: // low
              return {
                primary: `rgba(255, 220, 0, ${intensity})`,
                text: `rgba(255, 240, 100, ${intensity})`,
                ring: `rgba(255, 220, 0, ${flashOn ? 0.9 : 0.5})`,
                ringInner: `rgba(255, 180, 0, ${(flashOn ? 0.9 : 0.5) * 0.6})`
              };
          }
        };
        
        let primaryColor, textColor;
        if (hasSafetyAlert) {
          const sevColors = getSeverityColors(alertSeverity, proximityFlashOn);
          primaryColor = sevColors.primary;
          textColor = sevColors.text;
        } else if (isEmergency) {
          const r = flashOn ? 255 : 180;
          const intensity = brightness * flashBrightness;
          primaryColor = `rgba(${r}, 50, 50, ${Math.max(0.5, intensity)})`;
          textColor = `rgba(255, 100, 100, ${Math.max(0.6, intensity)})`;
        } else if (isMilitary) {
          // Purple for military
          primaryColor = isPro ? `rgba(200, 100, 255, 0.9)` : `rgba(180, 80, 255, ${brightness})`;
          textColor = isPro ? 'rgba(220, 150, 255, 0.9)' : `rgba(200, 150, 255, ${brightness})`;
        } else {
          // Green for civilian
          primaryColor = isPro ? 'rgba(0, 255, 150, 0.9)' : `rgba(0, 255, 150, ${brightness})`;
          textColor = isPro ? 'rgba(150, 255, 200, 0.9)' : `rgba(150, 255, 200, ${brightness})`;
        }

        // Draw safety alert warning ring (severity-based colors)
        if (hasSafetyAlert) {
          ctx.save();
          const sevColors = getSeverityColors(alertSeverity, proximityFlashOn);
          const ringSize = proximityFlashOn ? 24 : 20;
          
          // Outer warning ring
          ctx.beginPath();
          ctx.arc(x, y, ringSize, 0, Math.PI * 2);
          ctx.strokeStyle = sevColors.ring;
          ctx.lineWidth = alertSeverity === 'critical' ? 4 : 3;
          ctx.stroke();
          
          // Inner ring
          ctx.beginPath();
          ctx.arc(x, y, ringSize - 6, 0, Math.PI * 2);
          ctx.strokeStyle = sevColors.ringInner;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          
          ctx.restore();
        }

        // Draw emergency glow ring
        if (isEmergency && flashOn && !hasSafetyAlert) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(x, y, 18 + Math.sin(frameCount * 0.2) * 3, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255, 0, 0, ${0.4 + Math.sin(frameCount * 0.15) * 0.2})`;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }

        // Draw selection highlight (flashing green outline)
        const isSelected = selectedAircraft && selectedAircraft.hex === ac.hex;
        if (isSelected) {
          const selFlash = Math.floor(frameCount / 10) % 2 === 0;
          const selAlpha = selFlash ? 0.9 : 0.4;
          const selSize = selFlash ? 22 : 20;
          
          ctx.save();
          ctx.strokeStyle = `rgba(100, 220, 255, ${selAlpha})`;
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(x, y, selSize, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          
          // Corner brackets
          ctx.strokeStyle = `rgba(100, 220, 255, ${selAlpha})`;
          ctx.lineWidth = 2;
          const bSize = 15;
          const bLen = 6;
          // Top-left
          ctx.beginPath();
          ctx.moveTo(x - bSize, y - bSize + bLen);
          ctx.lineTo(x - bSize, y - bSize);
          ctx.lineTo(x - bSize + bLen, y - bSize);
          ctx.stroke();
          // Top-right
          ctx.beginPath();
          ctx.moveTo(x + bSize - bLen, y - bSize);
          ctx.lineTo(x + bSize, y - bSize);
          ctx.lineTo(x + bSize, y - bSize + bLen);
          ctx.stroke();
          // Bottom-left
          ctx.beginPath();
          ctx.moveTo(x - bSize, y + bSize - bLen);
          ctx.lineTo(x - bSize, y + bSize);
          ctx.lineTo(x - bSize + bLen, y + bSize);
          ctx.stroke();
          // Bottom-right
          ctx.beginPath();
          ctx.moveTo(x + bSize - bLen, y + bSize);
          ctx.lineTo(x + bSize, y + bSize);
          ctx.lineTo(x + bSize, y + bSize - bLen);
          ctx.stroke();
          
          ctx.restore();
        }

        // Draw aircraft symbol (chevron pointing in direction of travel)
        const track = (ac.track || 0) * Math.PI / 180;
        const symSize = isPro ? 10 : 9;
        
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(track);
        
        // Main symbol - filled chevron
        ctx.fillStyle = primaryColor;
        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -symSize);
        ctx.lineTo(-symSize * 0.6, symSize * 0.5);
        ctx.lineTo(0, symSize * 0.2);
        ctx.lineTo(symSize * 0.6, symSize * 0.5);
        ctx.closePath();
        ctx.fill();
        
        // Velocity vector line - shorter, proportional
        if (ac.gs > 50) {
          const vecLen = Math.min(20, ac.gs / 25); // Much shorter vector
          ctx.strokeStyle = isPro ? `rgba(100, 200, 255, 0.6)` : `rgba(0, 220, 255, ${brightness * 0.5})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, -symSize);
          ctx.lineTo(0, -symSize - vecLen);
          ctx.stroke();
        }
        
        ctx.restore();

        // Draw data block (callsign, speed, altitude)
        const callsign = ac.flight?.trim() || ac.hex;
        const speed = ac.gs ? `${Math.round(ac.gs)}` : '---';
        const altitude = ac.alt ? `${Math.round(ac.alt / 100)}` : '---';
        
        // Position data block to avoid overlap
        const blockX = x + 14;
        const blockY = y - 10;
        
        ctx.font = '13px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        
        // Draw background for label readability
        const labelWidth = Math.max(
          ctx.measureText(callsign).width,
          ctx.measureText(`${speed}kts ${altitude}`).width
        ) + 8;
        const labelHeight = 32;
        ctx.fillStyle = isPro ? 'rgba(10, 13, 18, 0.85)' : 'rgba(10, 15, 10, 0.8)';
        ctx.fillRect(blockX - 4, blockY - 2, labelWidth, labelHeight);
        
        // Callsign
        ctx.fillStyle = textColor;
        ctx.fillText(callsign, blockX, blockY);
        
        // Speed and altitude on second line
        ctx.fillStyle = isPro ? `rgba(100, 200, 180, 0.85)` : `rgba(0, 200, 100, ${brightness * 0.85})`;
        ctx.font = '12px "JetBrains Mono", monospace';
        ctx.fillText(`${speed}kts ${altitude}`, blockX, blockY + 15);
        
        // Emergency squawk meaning label (Pro mode) - slow fade
        if (isEmergency && isPro) {
          const squawkMeanings = {
            '7500': 'HIJACK',
            '7600': 'RADIO FAIL',
            '7700': 'EMERGENCY'
          };
          const meaning = squawkMeanings[ac.squawk] || 'EMERGENCY';
          
          // Slow fade effect (cycle over ~3 seconds at 60fps)
          const fadeAlpha = 0.5 + Math.sin(frameCount * 0.035) * 0.5;
          
          ctx.save();
          ctx.font = 'bold 14px "JetBrains Mono", monospace';
          ctx.textAlign = 'left';
          
          // Draw background box for visibility
          const labelText = `⚠ ${meaning}`;
          const textWidth = ctx.measureText(labelText).width;
          ctx.fillStyle = `rgba(120, 0, 0, 0.85)`;
          ctx.fillRect(blockX - 3, blockY + 30, textWidth + 8, 20);
          
          // Draw border
          ctx.strokeStyle = `rgba(255, 60, 60, 0.9)`;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(blockX - 3, blockY + 30, textWidth + 8, 20);
          
          // Draw white text with slow fade
          ctx.fillStyle = `rgba(255, 255, 255, ${fadeAlpha})`;
          ctx.fillText(labelText, blockX + 1, blockY + 34);
          ctx.restore();
        }
        
        // Safety event / Proximity conflict warning label (Pro mode)
        if (hasSafetyAlert && isPro && !isEmergency) {
          const fadeAlpha = 0.5 + Math.sin(frameCount * 0.05) * 0.5;
          const sevColors = getSeverityColors(alertSeverity, proximityFlashOn);
          
          // Get event type name for label
          const eventNames = {
            'tcas_ra': 'TCAS RA',
            'extreme_vs': 'EXTREME V/S',
            'vs_reversal': 'V/S REVERSAL',
            'proximity_conflict': 'PROXIMITY',
            'rapid_descent': 'RAPID DESCENT',
            'rapid_climb': 'RAPID CLIMB',
          };
          const alertLabel = safetyEvent ? 
            (eventNames[safetyEvent.event_type] || safetyEvent.event_type?.replace(/_/g, ' ').toUpperCase() || 'ALERT') :
            'PROXIMITY';
          
          ctx.save();
          ctx.font = 'bold 14px "JetBrains Mono", monospace';
          ctx.textAlign = 'left';
          
          const labelText = `⚠ ${alertLabel}`;
          const textWidth = ctx.measureText(labelText).width;
          
          // Background color based on severity
          const bgColor = alertSeverity === 'critical' ? 'rgba(100, 30, 60, 0.85)' :
                          alertSeverity === 'warning' ? 'rgba(100, 60, 0, 0.85)' :
                          'rgba(100, 80, 0, 0.85)';
          ctx.fillStyle = bgColor;
          ctx.fillRect(blockX - 3, blockY + 30, textWidth + 8, 20);
          
          // Border color based on severity
          ctx.strokeStyle = sevColors.ring;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(blockX - 3, blockY + 30, textWidth + 8, 20);
          
          // White text with fade
          ctx.fillStyle = `rgba(255, 255, 255, ${fadeAlpha})`;
          ctx.fillText(labelText, blockX + 1, blockY + 34);
          ctx.restore();
        }
      });
      }

      // Add scanlines effect - CRT mode only
      if (!isPro) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.03)';
        for (let y = 0; y < height; y += 2) {
          ctx.fillRect(0, y, width, 1);
        }

        // Subtle vignette - CRT mode only
        const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.max(width, height) * 0.7);
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('wheel', handleWheel);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [config.mapMode, sortedAircraft, radarRange, feederLat, feederLon, selectedAircraft, selectedMetar, selectedPirep, selectedNavaid, selectedAirport, overlays, aviationData]);

  // Leaflet map setup
  useEffect(() => {
    if (config.mapMode !== 'map' || !mapRef.current) return;

    if (!leafletMapRef.current) {
      const center = [feederLat, feederLon];
      leafletMapRef.current = L.map(mapRef.current, {
        center,
        zoom: 8,
        zoomControl: true
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(leafletMapRef.current);
      
      // Add feeder marker
      const feederIcon = L.divIcon({
        className: 'feeder-marker',
        html: `<div style="width: 12px; height: 12px; background: #00ff88; border: 2px solid #004422; border-radius: 50%; box-shadow: 0 0 10px #00ff88;"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6]
      });
      feederMarkerRef.current = L.marker(center, { icon: feederIcon })
        .addTo(leafletMapRef.current)
        .bindTooltip('Feeder Location', { permanent: false });

      // Update viewport center on map move/zoom for dynamic aviation data loading
      const handleViewportChange = () => {
        // Debounce viewport updates to avoid excessive API calls
        if (viewportUpdateTimeoutRef.current) {
          clearTimeout(viewportUpdateTimeoutRef.current);
        }
        viewportUpdateTimeoutRef.current = setTimeout(() => {
          const mapCenter = leafletMapRef.current?.getCenter();
          if (mapCenter) {
            setViewportCenter({ lat: mapCenter.lat, lon: mapCenter.lng });
          }
        }, 500); // 500ms debounce
      };

      leafletMapRef.current.on('moveend', handleViewportChange);
      leafletMapRef.current.on('zoomend', handleViewportChange);

      setTimeout(() => {
        leafletMapRef.current?.invalidateSize();
      }, 100);
    }

    const tilePane = leafletMapRef.current.getPane('tilePane');
    if (tilePane) {
      if (config.mapDarkMode) {
        tilePane.classList.add('dark-tiles');
      } else {
        tilePane.classList.remove('dark-tiles');
      }
    }

    return () => {
      // Clean up viewport update timeout
      if (viewportUpdateTimeoutRef.current) {
        clearTimeout(viewportUpdateTimeoutRef.current);
      }
      if (config.mapMode !== 'map' && leafletMapRef.current) {
        leafletMapRef.current.off('moveend');
        leafletMapRef.current.off('zoomend');
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
        markersRef.current = {};
        feederMarkerRef.current = null;
      }
    };
  }, [config.mapMode, config.mapDarkMode, feederLat, feederLon]);

  // Leaflet marker updates
  useEffect(() => {
    if (config.mapMode !== 'map' || !leafletMapRef.current) return;
    
    console.log('Updating markers:', sortedAircraft.length, 'aircraft with position');

    const currentHexes = new Set(sortedAircraft.map(a => a.hex));

    Object.keys(markersRef.current).forEach(hex => {
      if (!currentHexes.has(hex)) {
        markersRef.current[hex].remove();
        delete markersRef.current[hex];
      }
    });

    sortedAircraft.slice(0, 150).forEach(ac => {
      if (!ac.lat || !ac.lon) return;
      
      const color = ac.emergency ? '#f85149' : ac.military ? '#a371f7' : '#00d4ff';
      const rotation = ac.track || 0;

      const icon = L.divIcon({
        className: 'aircraft-marker',
        html: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="transform: rotate(${rotation}deg); filter: drop-shadow(0 0 4px ${color});">
          <path d="M12 2L4 12l8 2 8-2-8-10z" fill="${color}" stroke="${color}" stroke-width="1"/>
          <path d="M12 14v8M8 18l4 2 4-2" stroke="${color}" stroke-width="1.5"/>
        </svg>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      if (markersRef.current[ac.hex]) {
        markersRef.current[ac.hex].setLatLng([ac.lat, ac.lon]);
        markersRef.current[ac.hex].setIcon(icon);
      } else {
        const marker = L.marker([ac.lat, ac.lon], { icon })
          .addTo(leafletMapRef.current)
          .on('click', () => setSelectedAircraft(ac));
        marker.bindTooltip(`${ac.flight || ac.hex}<br>${ac.alt || '?'}ft`, {
          permanent: false,
          direction: 'top'
        });
        markersRef.current[ac.hex] = marker;
      }
    });
  }, [sortedAircraft, config.mapMode]);

  const cycleMapMode = () => {
    const modes = ['radar', 'crt', 'pro', 'map'];
    const currentIndex = modes.indexOf(config.mapMode);
    const nextMode = modes[(currentIndex + 1) % modes.length];
    const newConfig = { ...config, mapMode: nextMode };
    setConfig(newConfig);
    saveConfig(newConfig);
  };

  const toggleDarkMode = () => {
    const newConfig = { ...config, mapDarkMode: !config.mapDarkMode };
    setConfig(newConfig);
    saveConfig(newConfig);
  };

  // Get feeder position for simple radar
  const feederPos = getPosition(feederLat, feederLon);

  // Count aircraft in range for CRT mode
  const inRangeCount = sortedAircraft.filter(ac => {
    const dist = ac.distance_nm || getDistanceNm(ac.lat, ac.lon);
    return dist <= radarRange;
  }).length;

  // Get severity color class
  const getSeverityClass = (severity) => {
    switch (severity) {
      case 'critical': return 'severity-critical';
      case 'warning': return 'severity-warning';
      default: return 'severity-low';
    }
  };

  // Get event type display name
  const getEventTypeName = (eventType) => {
    const names = {
      'tcas_ra': 'TCAS RA',
      'extreme_vs': 'EXTREME V/S',
      'vs_reversal': 'V/S REVERSAL',
      'proximity_conflict': 'PROXIMITY',
      'rapid_descent': 'RAPID DESCENT',
      'rapid_climb': 'RAPID CLIMB',
      'squawk_hijack': 'SQUAWK 7500',
      'squawk_radio_failure': 'SQUAWK 7600',
      'squawk_emergency': 'SQUAWK 7700',
    };
    return names[eventType] || eventType?.replace(/_/g, ' ').toUpperCase() || 'ALERT';
  };

  // Render event-specific banner content based on event type
  const renderEventBannerContent = (event) => {
    const eventType = event.event_type;
    const details = event.details || {};

    // Emergency squawks - show squawk code prominently
    if (eventType?.startsWith('squawk_')) {
      const squawkMeanings = {
        'squawk_hijack': 'HIJACK',
        'squawk_radio_failure': 'RADIO FAILURE',
        'squawk_emergency': 'EMERGENCY'
      };
      return (
        <>
          <div className="banner-main-info">
            <span className="banner-squawk-code">{details.squawk || event.squawk}</span>
            <span className="banner-squawk-meaning">{squawkMeanings[eventType] || 'EMERGENCY'}</span>
          </div>
          <div className="banner-aircraft">
            <span className="banner-callsign">{event.callsign || event.icao}</span>
            {details.altitude && <span className="banner-altitude">{details.altitude.toLocaleString()}ft</span>}
          </div>
        </>
      );
    }

    // Proximity conflict - show separation info
    if (eventType === 'proximity_conflict') {
      return (
        <>
          <div className="banner-main-info">
            <span className="banner-separation-horiz">{details.horizontal_nm || details.distance_nm}nm</span>
            <span className="banner-separation-divider">/</span>
            <span className="banner-separation-vert">{details.vertical_ft || details.altitude_diff_ft}ft</span>
          </div>
          <div className="banner-aircraft">
            <span className="banner-callsign">{event.callsign || event.icao}</span>
            <span className="banner-vs-aircraft">↔</span>
            <span className="banner-callsign">{event.callsign_2 || event.icao_2}</span>
          </div>
        </>
      );
    }

    // TCAS RA - show VS change
    if (eventType === 'tcas_ra') {
      return (
        <>
          <div className="banner-main-info">
            <span className="banner-vs-change">
              {details.previous_vs > 0 ? '+' : ''}{details.previous_vs} → {details.current_vs > 0 ? '+' : ''}{details.current_vs}
            </span>
            <span className="banner-vs-unit">fpm</span>
          </div>
          <div className="banner-aircraft">
            <span className="banner-callsign">{event.callsign || event.icao}</span>
            {details.altitude && <span className="banner-altitude">{details.altitude.toLocaleString()}ft</span>}
          </div>
        </>
      );
    }

    // VS Reversal - show VS change
    if (eventType === 'vs_reversal') {
      return (
        <>
          <div className="banner-main-info">
            <span className="banner-vs-change">
              {details.previous_vs > 0 ? '+' : ''}{details.previous_vs} → {details.current_vs > 0 ? '+' : ''}{details.current_vs}
            </span>
            <span className="banner-vs-unit">fpm</span>
          </div>
          <div className="banner-aircraft">
            <span className="banner-callsign">{event.callsign || event.icao}</span>
            {details.altitude && <span className="banner-altitude">{details.altitude.toLocaleString()}ft</span>}
          </div>
        </>
      );
    }

    // Extreme VS - show current VS
    if (eventType === 'extreme_vs') {
      const vs = details.vertical_rate;
      return (
        <>
          <div className="banner-main-info">
            <span className="banner-vs-value">{vs > 0 ? '+' : ''}{vs}</span>
            <span className="banner-vs-unit">fpm</span>
          </div>
          <div className="banner-aircraft">
            <span className="banner-callsign">{event.callsign || event.icao}</span>
            {details.altitude && <span className="banner-altitude">{details.altitude.toLocaleString()}ft</span>}
          </div>
        </>
      );
    }

    // Default fallback
    return (
      <>
        <div className="banner-main-info">
          <span className="banner-callsign">{event.callsign || event.icao}</span>
          {event.callsign_2 && <span className="banner-callsign-2">↔ {event.callsign_2}</span>}
        </div>
        {event.message && <div className="banner-message">{event.message}</div>}
      </>
    );
  };

  return (
    <div className="map-container" onClick={initAudioContext}>
      {/* Safety Event Banner - Shows highest priority event (not in pro mode which has its own) */}
      {activeConflicts.length > 0 && config.mapMode !== 'pro' && (
        <div className="conflict-banners-container">
          {activeConflicts
            .filter(event => !acknowledgedEvents.has(event.id))
            .slice(0, 1)
            .map((event, idx) => (
            <div
              key={event.id || `conflict-${event.icao}-${idx}`}
              className={`conflict-banner ${getSeverityClass(event.severity)} event-type-${event.event_type}`}
              onClick={() => {
                // Find and select the aircraft
                const ac = aircraft.find(a => a.hex?.toUpperCase() === event.icao?.toUpperCase());
                if (ac) {
                  setSelectedMetar(null);
                  setSelectedPirep(null);
                  setSelectedNavaid(null);
                  setSelectedAirport(null);
                  setPopupPosition({ x: 16, y: 16 });
                  setSelectedAircraft(ac);
                }
              }}
              style={{ cursor: 'pointer' }}
            >
              <AlertTriangle size={28} />
              <div className="conflict-banner-content">
                <strong className="banner-event-type">{getEventTypeName(event.event_type)}</strong>
                {renderEventBannerContent(event)}
              </div>
              <button
                className="conflict-ack-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  acknowledgeEvent(event.id);
                }}
                title="Acknowledge and dismiss"
              >
                <Check size={20} />
              </button>
            </div>
          ))}
        </div>
      )}
      

      {/* Simple Radar Mode */}
      {config.mapMode === 'radar' && (
        <div className="map-overlay">
          <div className="radar-grid">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="radar-ring"
                style={{ width: `${(i + 1) * 20}%`, height: `${(i + 1) * 20}%` }}
              />
            ))}
            <div className="radar-crosshair" />
          </div>

          {/* Feeder location marker */}
          <div
            className="feeder-marker-radar"
            style={{
              left: `${feederPos.x}%`,
              top: `${feederPos.y}%`,
            }}
            title="Feeder Location"
          >
            <Radio size={16} />
          </div>

          <div className="aircraft-blips">
            {sortedAircraft.slice(0, 100).map(ac => {
              const pos = getPosition(ac.lat, ac.lon);
              return (
                <div
                  key={ac.hex}
                  className={`aircraft-blip ${ac.military ? 'military' : ''} ${ac.emergency ? 'emergency' : ''}`}
                  style={{
                    left: `${pos.x}%`,
                    top: `${pos.y}%`,
                    transform: `translate(-50%, -50%) rotate(${ac.track || 0}deg)`
                  }}
                  onClick={() => setSelectedAircraft(ac)}
                  title={`${ac.flight || ac.hex} - ${ac.alt || '?'}ft`}
                >
                  <Plane size={16} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* CRT ATC Radar Mode & Pro Mode - Canvas Based */}
      {(config.mapMode === 'crt' || config.mapMode === 'pro') && (
        <div 
          className={`crt-radar-container ${config.mapMode === 'pro' ? 'pro-mode' : ''}`} 
          ref={containerRef}
          onMouseMove={handleContainerMouseMove}
          onMouseLeave={handleContainerMouseLeave}
        >
          <canvas ref={canvasRef} className="crt-radar-canvas" onClick={(e) => {
            const rect = canvasRef.current.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            const maxRadius = Math.min(rect.width, rect.height) * 0.45;
            const pixelsPerNm = maxRadius / radarRange;
            
            // Helper to convert lat/lon to screen position
            const getScreenPos = (lat, lon) => {
              const dLat = lat - feederLat;
              const dLon = lon - feederLon;
              const nmY = dLat * 60;
              const nmX = dLon * 60 * Math.cos(feederLat * Math.PI / 180);
              
              if (config.mapMode === 'pro') {
                return { x: centerX + nmX * pixelsPerNm, y: centerY - nmY * pixelsPerNm };
              } else {
                const dist = Math.sqrt(nmX * nmX + nmY * nmY);
                const bearing = getBearing(lat, lon);
                const radius = (dist / radarRange) * maxRadius;
                const rad = (bearing - 90) * Math.PI / 180;
                return { x: centerX + Math.cos(rad) * radius, y: centerY + Math.sin(rad) * radius };
              }
            };
            
            let closest = null;
            let closestDist = 30;
            let closestType = null; // 'aircraft', 'metar', 'pirep', 'navaid', 'airport'
            
            // Check aircraft (if overlay enabled)
            if (overlays.aircraft) {
              sortedAircraft.forEach(ac => {
                const dist = ac.distance_nm || getDistanceNm(ac.lat, ac.lon);
                if (config.mapMode === 'crt' && dist > radarRange) return;
                if (config.mapMode === 'pro' && dist > radarRange * 1.5) return;
                
                const pos = getScreenPos(ac.lat, ac.lon);
                const clickDist = Math.sqrt((clickX - pos.x) ** 2 + (clickY - pos.y) ** 2);
                if (clickDist < closestDist) {
                  closestDist = clickDist;
                  closest = ac;
                  closestType = 'aircraft';
                }
              });
            }
            
            // Check METARs if enabled
            if (overlays.metars && aviationData.metars.length > 0) {
              aviationData.metars.forEach(metar => {
                if (!metar.lat || !metar.lon) return;
                const pos = getScreenPos(metar.lat, metar.lon);
                if (pos.x < 0 || pos.x > rect.width || pos.y < 0 || pos.y > rect.height) return;
                
                const clickDist = Math.sqrt((clickX - pos.x) ** 2 + (clickY - pos.y) ** 2);
                if (clickDist < closestDist) {
                  closestDist = clickDist;
                  closest = metar;
                  closestType = 'metar';
                }
              });
            }
            
            // Check PIREPs if enabled
            if (overlays.pireps && aviationData.pireps.length > 0) {
              aviationData.pireps.forEach(pirep => {
                if (!pirep.lat || !pirep.lon) return;
                const pos = getScreenPos(pirep.lat, pirep.lon);
                if (pos.x < 0 || pos.x > rect.width || pos.y < 0 || pos.y > rect.height) return;
                
                const clickDist = Math.sqrt((clickX - pos.x) ** 2 + (clickY - pos.y) ** 2);
                if (clickDist < closestDist) {
                  closestDist = clickDist;
                  closest = pirep;
                  closestType = 'pirep';
                }
              });
            }
            
            // Check Navaids if enabled (use fallback data if API data empty)
            if (overlays.vors) {
              const navAidsToCheck = aviationData.navaids.length > 0 ? aviationData.navaids : [
                { id: 'SEA', name: 'Seattle VORTAC', lat: 47.435, lon: -122.309, type: 'VORTAC' },
                { id: 'PAE', name: 'Paine Field', lat: 47.906, lon: -122.283, type: 'VOR/DME' },
                { id: 'BFI', name: 'Boeing Field', lat: 47.529, lon: -122.302, type: 'VOR/DME' },
                { id: 'TCM', name: 'McChord', lat: 47.136, lon: -122.476, type: 'TACAN' },
                { id: 'OLM', name: 'Olympia', lat: 46.969, lon: -122.902, type: 'VOR/DME' },
                { id: 'EPH', name: 'Ephrata', lat: 47.385, lon: -119.515, type: 'VOR/DME' },
                { id: 'ELN', name: 'Ellensburg', lat: 47.033, lon: -120.530, type: 'VOR/DME' },
                { id: 'YYJ', name: 'Victoria', lat: 48.647, lon: -123.426, type: 'VOR/DME' },
                { id: 'CV', name: 'Coupeville', lat: 48.188, lon: -122.688, type: 'NDB' },
                { id: 'BTG', name: 'Battleground', lat: 45.816, lon: -122.531, type: 'VOR/DME' },
                { id: 'UBG', name: 'Bellingham', lat: 48.795, lon: -122.538, type: 'VOR/DME' },
                { id: 'GEG', name: 'Spokane', lat: 47.625, lon: -117.539, type: 'VORTAC' },
              ];
              navAidsToCheck.forEach(nav => {
                if (!nav.lat || !nav.lon) return;
                const pos = getScreenPos(nav.lat, nav.lon);
                if (pos.x < 0 || pos.x > rect.width || pos.y < 0 || pos.y > rect.height) return;
                
                const clickDist = Math.sqrt((clickX - pos.x) ** 2 + (clickY - pos.y) ** 2);
                if (clickDist < closestDist) {
                  closestDist = clickDist;
                  closest = nav;
                  closestType = 'navaid';
                }
              });
            }
            
            // Check Airports if enabled (use fallback data if API data empty)
            if (overlays.airports) {
              const airportsToCheck = aviationData.airports.length > 0 ? aviationData.airports : [
                { icao: 'KSEA', name: 'Seattle-Tacoma', lat: 47.449, lon: -122.309, class: 'B' },
                { icao: 'KBFI', name: 'Boeing Field', lat: 47.529, lon: -122.302, class: 'D' },
                { icao: 'KPAE', name: 'Paine Field', lat: 47.906, lon: -122.283, class: 'D' },
                { icao: 'KPDX', name: 'Portland Intl', lat: 45.589, lon: -122.597, class: 'C' },
                { icao: 'KGEG', name: 'Spokane', lat: 47.620, lon: -117.534, class: 'C' },
              ];
              airportsToCheck.forEach(apt => {
                if (!apt.lat || !apt.lon) return;
                const pos = getScreenPos(apt.lat, apt.lon);
                if (pos.x < 0 || pos.x > rect.width || pos.y < 0 || pos.y > rect.height) return;
                
                const clickDist = Math.sqrt((clickX - pos.x) ** 2 + (clickY - pos.y) ** 2);
                if (clickDist < closestDist) {
                  closestDist = clickDist;
                  closest = apt;
                  closestType = 'airport';
                }
              });
            }
            
            // Handle click based on type
            if (closest) {
              setSelectedAircraft(null);
              setSelectedMetar(null);
              setSelectedPirep(null);
              setSelectedNavaid(null);
              setSelectedAirport(null);
              
              if (closestType === 'aircraft') {
                setSelectedAircraft(closest);
              } else if (closestType === 'metar') {
                setSelectedMetar(closest);
              } else if (closestType === 'pirep') {
                setSelectedPirep(closest);
              } else if (closestType === 'navaid') {
                setSelectedNavaid(closest);
              } else if (closestType === 'airport') {
                setSelectedAirport(closest);
              }
            } else {
              // Clicked on empty area - clear all selections
              setSelectedAircraft(null);
              setSelectedMetar(null);
              setSelectedPirep(null);
              setSelectedNavaid(null);
              setSelectedAirport(null);
            }
          }} />
          
          {/* CRT overlay effects (CRT mode only) */}
          {config.mapMode === 'crt' && (
            <div className="crt-effects">
              <div className="crt-scanlines" />
            </div>
          )}
          
          {/* Range control */}
          <div className={`crt-range-control ${config.mapMode === 'pro' ? 'pro-style' : ''} ${showRangeControl ? 'visible' : ''}`}>
            <span className="crt-range-label">RNG</span>
            {[10, 25, 50, 100, 200].map(r => (
              <button
                key={r}
                className={`crt-range-btn ${radarRange === r ? 'active' : ''}`}
                onClick={() => setRadarRange(r)}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Scope info */}
          <div className={`crt-scope-info ${config.mapMode === 'pro' ? 'pro-style' : ''}`}>
            <div className="crt-info-row">
              <span className="crt-label">TGT</span>
              <span className="crt-value">{inRangeCount}</span>
            </div>
            <div className="crt-info-row">
              <span className="crt-label">RNG</span>
              <span className="crt-value">{radarRange}NM</span>
            </div>
            <div className="crt-info-row">
              <span className="crt-label">CTR</span>
              <span className="crt-value">{feederLat.toFixed(2)}°N</span>
            </div>
            <div className="crt-info-row">
              <span className="crt-label"></span>
              <span className="crt-value">{Math.abs(feederLon).toFixed(2)}°W</span>
            </div>
          </div>
        </div>
      )}

      {/* Leaflet Map Mode */}
      {config.mapMode === 'map' && (
        <div ref={mapRef} className="leaflet-map" />
      )}

      {/* Map Controls */}
      <div className="map-controls">
        {config.mapMode === 'map' && (
          <button className={`map-control-btn ${config.mapDarkMode ? 'active' : ''}`} onClick={toggleDarkMode}>
            {config.mapDarkMode ? <Moon size={16} /> : <Sun size={16} />}
            <span>{config.mapDarkMode ? 'Dark' : 'Light'}</span>
          </button>
        )}
        {(config.mapMode === 'crt' || config.mapMode === 'pro') && (
          <>
            <button 
              className={`map-control-btn ${showFilterMenu ? 'active' : ''}`} 
              onClick={() => { setShowFilterMenu(!showFilterMenu); setShowOverlayMenu(false); }}
            >
              <Filter size={16} />
              <span>Filter</span>
            </button>
            <button 
              className={`map-control-btn ${showOverlayMenu ? 'active' : ''}`} 
              onClick={() => { setShowOverlayMenu(!showOverlayMenu); setShowFilterMenu(false); }}
            >
              <Layers size={16} />
              <span>Layers</span>
            </button>
          </>
        )}
        <button 
          className={`map-control-btn sound-mute-btn ${soundMuted ? 'muted' : ''}`}
          onClick={() => setSoundMuted(!soundMuted)}
          title={soundMuted ? 'Unmute alerts' : 'Mute alerts'}
        >
          {soundMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <button 
          className="map-control-btn"
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>

      {/* Overlay Menu */}
      {showOverlayMenu && (config.mapMode === 'crt' || config.mapMode === 'pro') && (
        <div className="overlay-menu">
          <div className="overlay-menu-header">
            <span>Map Layers</span>
            <button onClick={() => setShowOverlayMenu(false)}><X size={14} /></button>
          </div>
          <label className="overlay-toggle">
            <input 
              type="checkbox" 
              checked={overlays.aircraft} 
              onChange={() => setOverlays(prev => ({ ...prev, aircraft: !prev.aircraft }))}
            />
            <span className="toggle-label">Aircraft</span>
          </label>
          <div className="overlay-divider" />
          <label className="overlay-toggle">
            <input 
              type="checkbox" 
              checked={overlays.vors} 
              onChange={() => setOverlays(prev => ({ ...prev, vors: !prev.vors }))}
            />
            <span className="toggle-label">VORs & NAVAIDs</span>
          </label>
          <label className="overlay-toggle">
            <input 
              type="checkbox" 
              checked={overlays.airports} 
              onChange={() => setOverlays(prev => ({ ...prev, airports: !prev.airports }))}
            />
            <span className="toggle-label">Airports</span>
          </label>
          <label className="overlay-toggle">
            <input 
              type="checkbox" 
              checked={overlays.airspace} 
              onChange={() => setOverlays(prev => ({ ...prev, airspace: !prev.airspace }))}
            />
            <span className="toggle-label">Airspace</span>
          </label>
          <label className="overlay-toggle">
            <input 
              type="checkbox" 
              checked={overlays.metars} 
              onChange={() => setOverlays(prev => ({ ...prev, metars: !prev.metars }))}
            />
            <span className="toggle-label">METARs (Weather)</span>
          </label>
          <label className="overlay-toggle">
            <input 
              type="checkbox" 
              checked={overlays.pireps} 
              onChange={() => setOverlays(prev => ({ ...prev, pireps: !prev.pireps }))}
            />
            <span className="toggle-label">PIREPs</span>
          </label>
          <div className="overlay-divider" />
          <button 
            className="legend-toggle-btn"
            onClick={() => { setShowLegend(!showLegend); setShowOverlayMenu(false); }}
          >
            <HelpCircle size={14} />
            <span>Symbol Legend</span>
          </button>
          <div className="overlay-note">
            Weather data from aviationweather.gov
          </div>
        </div>
      )}

      {/* Traffic Filter Menu */}
      {showFilterMenu && (config.mapMode === 'crt' || config.mapMode === 'pro') && (
        <div className="overlay-menu filter-menu">
          <div className="overlay-menu-header">
            <span>Traffic Filters</span>
            <button onClick={() => setShowFilterMenu(false)}><X size={14} /></button>
          </div>
          
          <div className="filter-section">
            <div className="filter-section-title">Type</div>
            <label className="overlay-toggle">
              <input 
                type="checkbox" 
                checked={trafficFilters.showMilitary} 
                onChange={() => setTrafficFilters(prev => ({ ...prev, showMilitary: !prev.showMilitary }))}
              />
              <span className="toggle-label"><Shield size={12} /> Military</span>
            </label>
            <label className="overlay-toggle">
              <input 
                type="checkbox" 
                checked={trafficFilters.showCivil} 
                onChange={() => setTrafficFilters(prev => ({ ...prev, showCivil: !prev.showCivil }))}
              />
              <span className="toggle-label"><Plane size={12} /> Civil</span>
            </label>
          </div>
          
          <div className="filter-section">
            <div className="filter-section-title">Status</div>
            <label className="overlay-toggle">
              <input 
                type="checkbox" 
                checked={trafficFilters.showAirborne} 
                onChange={() => setTrafficFilters(prev => ({ ...prev, showAirborne: !prev.showAirborne }))}
              />
              <span className="toggle-label">Airborne</span>
            </label>
            <label className="overlay-toggle">
              <input 
                type="checkbox" 
                checked={trafficFilters.showGround} 
                onChange={() => setTrafficFilters(prev => ({ ...prev, showGround: !prev.showGround }))}
              />
              <span className="toggle-label">On Ground</span>
            </label>
          </div>
          
          <div className="filter-section">
            <div className="filter-section-title">Transponder</div>
            <label className="overlay-toggle">
              <input 
                type="checkbox" 
                checked={trafficFilters.showWithSquawk} 
                onChange={() => setTrafficFilters(prev => ({ ...prev, showWithSquawk: !prev.showWithSquawk }))}
              />
              <span className="toggle-label">With Squawk</span>
            </label>
            <label className="overlay-toggle">
              <input 
                type="checkbox" 
                checked={trafficFilters.showWithoutSquawk} 
                onChange={() => setTrafficFilters(prev => ({ ...prev, showWithoutSquawk: !prev.showWithoutSquawk }))}
              />
              <span className="toggle-label">No Squawk (ADS-B)</span>
            </label>
          </div>
          
          <div className="filter-section">
            <div className="filter-section-title">Altitude (ft)</div>
            <div className="filter-range-row">
              <input 
                type="number" 
                className="filter-range-input"
                value={trafficFilters.minAltitude}
                onChange={(e) => setTrafficFilters(prev => ({ 
                  ...prev, 
                  minAltitude: Math.max(0, parseInt(e.target.value) || 0)
                }))}
                min="0"
                max="60000"
                step="1000"
                placeholder="Min"
              />
              <span className="filter-range-sep">to</span>
              <input 
                type="number" 
                className="filter-range-input"
                value={trafficFilters.maxAltitude}
                onChange={(e) => setTrafficFilters(prev => ({ 
                  ...prev, 
                  maxAltitude: Math.min(60000, parseInt(e.target.value) || 60000)
                }))}
                min="0"
                max="60000"
                step="1000"
                placeholder="Max"
              />
            </div>
          </div>
          
          <div className="overlay-divider" />
          <button 
            className="filter-reset-btn"
            onClick={() => setTrafficFilters({
              showMilitary: true,
              showCivil: true,
              showGround: false, // Hide ground aircraft by default
              showAirborne: true,
              minAltitude: 0,
              maxAltitude: 60000,
              showWithSquawk: true,
              showWithoutSquawk: true,
            })}
          >
            <RefreshCw size={14} />
            <span>Reset Filters</span>
          </button>
        </div>
      )}

      {/* Symbol Legend Panel */}
      {showLegend && (config.mapMode === 'crt' || config.mapMode === 'pro') && (
        <div 
          className={`legend-panel ${config.mapMode === 'pro' ? 'pro-style' : ''} ${isLegendDragging ? 'dragging' : ''} ${legendCollapsed ? 'collapsed' : ''}`}
          style={legendPosition.x !== null ? { 
            left: legendPosition.x, 
            top: legendPosition.y,
            right: 'auto',
            bottom: 'auto'
          } : {}}
          onMouseDown={handleLegendMouseDown}
          onTouchStart={(e) => {
            if (e.target.closest('button')) return;
            const touch = e.touches[0];
            setIsLegendDragging(true);
            const rect = e.currentTarget.getBoundingClientRect();
            legendDragStartRef.current = {
              x: touch.clientX,
              y: touch.clientY,
              startX: legendPosition.x ?? rect.left,
              startY: legendPosition.y ?? rect.top
            };
          }}
        >
          <div className="legend-header">
            <span>Symbol Legend</span>
            <div className="legend-header-buttons">
              <button onClick={() => setLegendCollapsed(!legendCollapsed)} title={legendCollapsed ? 'Expand' : 'Collapse'}>
                {legendCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>
              <button onClick={() => setShowLegend(false)} title="Close"><X size={14} /></button>
            </div>
          </div>
          
          {!legendCollapsed && (
            <>
              <div className="legend-section">
                <div className="legend-section-title">Flight Categories (METAR)</div>
                <div className="legend-item">
                  <span className="legend-symbol metar-vfr">●</span>
                  <span>VFR - Visual (good visibility)</span>
                </div>
                <div className="legend-item">
                  <span className="legend-symbol metar-mvfr">●</span>
                  <span>MVFR - Marginal Visual</span>
                </div>
                <div className="legend-item">
                  <span className="legend-symbol metar-ifr">●</span>
                  <span>IFR - Instrument Required</span>
                </div>
                <div className="legend-item">
                  <span className="legend-symbol metar-lifr">●</span>
                  <span>LIFR - Low Instrument</span>
                </div>
              </div>
              
              <div className="legend-section">
                <div className="legend-section-title">PIREP Types</div>
                <div className="legend-item">
                  <span className="legend-symbol pirep-routine">◆</span>
                  <span>Routine Report</span>
                </div>
                <div className="legend-item">
                  <span className="legend-symbol pirep-turb">◆</span>
                  <span>Turbulence</span>
                </div>
                <div className="legend-item">
                  <span className="legend-symbol pirep-ice">◆</span>
                  <span>Icing</span>
                </div>
                <div className="legend-item">
                  <span className="legend-symbol pirep-both">◆</span>
                  <span>Turbulence + Icing</span>
                </div>
                <div className="legend-item">
                  <span className="legend-symbol pirep-ws">◆</span>
                  <span>Wind Shear</span>
                </div>
                <div className="legend-item">
                  <span className="legend-symbol pirep-urgent">◆</span>
                  <span>Urgent (UUA)</span>
                </div>
              </div>
              
              <div className="legend-section">
                <div className="legend-section-title">Aircraft</div>
                <div className="legend-item">
                  <span className="legend-symbol aircraft-normal">▲</span>
                  <span>Normal Traffic</span>
                </div>
                <div className="legend-item">
                  <span className="legend-symbol aircraft-military">▲</span>
                  <span>Military</span>
                </div>
                <div className="legend-item">
                  <span className="legend-symbol aircraft-emergency">▲</span>
                  <span>Emergency (7500/7600/7700)</span>
                </div>
                <div className="legend-item">
                  <span className="legend-symbol aircraft-conflict">▲</span>
                  <span>Traffic Conflict</span>
                </div>
              </div>
              
              <div className="legend-section">
                <div className="legend-section-title">Navigation</div>
                <div className="legend-item">
                  <span className="legend-symbol nav-vor">⬡</span>
                  <span>VOR/DME</span>
                </div>
                <div className="legend-item">
                  <span className="legend-symbol nav-airport">✈</span>
                  <span>Airport</span>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Show Aircraft List Button (when hidden) */}
      {(config.mapMode === 'crt' || config.mapMode === 'pro') && !showAircraftList && (
        <button 
          className={`aircraft-list-show-btn ${config.mapMode === 'pro' ? 'pro-style' : ''}`}
          onClick={() => setShowAircraftList(true)}
        >
          <Plane size={14} />
          <span>{inRangeCount}</span>
          <ChevronLeft size={14} />
        </button>
      )}

      {/* Collapsible Aircraft List Panel */}
      {(config.mapMode === 'crt' || config.mapMode === 'pro') && showAircraftList && (
        <div 
          className={`radar-aircraft-list expanded ${config.mapMode === 'pro' ? 'pro-style' : ''} ${isListDragging ? 'dragging' : ''}`}
          style={aircraftListPosition.x !== null ? { 
            left: aircraftListPosition.x, 
            top: aircraftListPosition.y,
            right: 'auto',
            bottom: 'auto'
          } : {}}
        >
          <div 
            className="aircraft-list-header"
            onMouseDown={handleListMouseDown}
            onTouchStart={(e) => {
              const touch = e.touches[0];
              handleListMouseDown({ clientX: touch.clientX, clientY: touch.clientY, currentTarget: e.currentTarget.parentElement, preventDefault: () => {} });
            }}
          >
            <button 
              className="aircraft-list-toggle"
              onClick={() => setListExpanded(!listExpanded)}
            >
              <Plane size={14} />
              <span>Aircraft ({inRangeCount})</span>
              {listExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
            <button 
              className="aircraft-list-close"
              onClick={() => setShowAircraftList(false)}
              title="Hide aircraft list"
            >
              <X size={14} />
            </button>
          </div>
          
          {listExpanded && (
            <div className="aircraft-list-content">
              {(() => {
                // Filter aircraft in range
                const inRangeAircraft = sortedAircraft.filter(ac => {
                  const dist = ac.distance_nm || 0;
                  return config.mapMode === 'pro' ? dist <= radarRange * 1.5 : dist <= radarRange;
                });
                
                // Sort: emergencies first, then conflicts (from backend), then by distance
                const prioritySorted = [...inRangeAircraft].sort((a, b) => {
                  const aEmergency = a.emergency || ['7500', '7600', '7700'].includes(a.squawk);
                  const bEmergency = b.emergency || ['7500', '7600', '7700'].includes(b.squawk);
                  const aConflict = activeConflicts.some(e =>
                    e.icao?.toUpperCase() === a.hex?.toUpperCase() ||
                    e.icao_2?.toUpperCase() === a.hex?.toUpperCase()
                  );
                  const bConflict = activeConflicts.some(e =>
                    e.icao?.toUpperCase() === b.hex?.toUpperCase() ||
                    e.icao_2?.toUpperCase() === b.hex?.toUpperCase()
                  );

                  // Emergency first
                  if (aEmergency && !bEmergency) return -1;
                  if (!aEmergency && bEmergency) return 1;
                  // Then conflicts
                  if (aConflict && !bConflict) return -1;
                  if (!aConflict && bConflict) return 1;
                  // Then by distance
                  return (a.distance_nm || 999) - (b.distance_nm || 999);
                });
                
                // Lazy load - show initial batch plus loaded items
                const displayCount = Math.min(listDisplayCount, prioritySorted.length);
                const displayAircraft = prioritySorted.slice(0, displayCount);
                const hasMore = prioritySorted.length > displayCount;
                
                return (
                  <>
                    {displayAircraft.map(ac => {
                      const tailInfo = getTailInfo(ac.hex, ac.flight);
                      const isEmergency = ac.emergency || ['7500', '7600', '7700'].includes(ac.squawk);
                      const safetyEvent = activeConflicts.find(e =>
                        e.icao?.toUpperCase() === ac.hex?.toUpperCase() ||
                        e.icao_2?.toUpperCase() === ac.hex?.toUpperCase()
                      );
                      const isConflict = !!safetyEvent;
                      const conflictSeverity = safetyEvent?.severity || null;
                      
                      return (
                        <div 
                          key={ac.hex}
                          className={`aircraft-list-item ${selectedAircraft?.hex === ac.hex ? 'selected' : ''} ${isEmergency ? 'emergency flash-emergency' : ''} ${isConflict ? `conflict flash-conflict ${getSeverityClass(conflictSeverity)}` : ''} ${ac.military ? 'military' : ''}`}
                          onClick={() => setSelectedAircraft(ac)}
                          title={safetyEvent ? `${getEventTypeName(safetyEvent.event_type)}: ${safetyEvent.message}` : ''}
                        >
                          <div className="aircraft-list-primary">
                            <span className="aircraft-flag">{tailInfo.flag}</span>
                            <span className="aircraft-callsign">{ac.flight?.trim() || ac.hex}</span>
                            {tailInfo.tailNumber && <span className="aircraft-tail">({tailInfo.tailNumber})</span>}
                            {ac.military && <Shield size={10} className="mil-icon" />}
                            {isEmergency && <AlertTriangle size={10} className="emerg-icon" />}
                            {isConflict && <Zap size={10} className={`conflict-icon ${getSeverityClass(conflictSeverity)}`} />}
                          </div>
                          <div className="aircraft-list-secondary">
                            <span className="aircraft-alt">{ac.alt ? `${(ac.alt/1000).toFixed(1)}k` : '--'}</span>
                            <span className="aircraft-speed">{ac.gs ? `${Math.round(ac.gs)}kt` : '--'}</span>
                            <span className="aircraft-dist">{ac.distance_nm?.toFixed(1) || '--'}nm</span>
                            <button 
                              className="aircraft-detail-link"
                              onClick={(e) => { e.stopPropagation(); setAircraftDetailHex(ac.hex); }}
                              title="View full details"
                            >
                              <ExternalLink size={10} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {hasMore && (
                      <button 
                        className="aircraft-list-load-more"
                        onClick={(e) => {
                          e.stopPropagation();
                          setListDisplayCount(prev => prev + 20);
                        }}
                      >
                        Load more ({prioritySorted.length - displayCount} remaining)
                      </button>
                    )}
                    {prioritySorted.length === 0 && (
                      <div className="aircraft-list-empty">No aircraft in range</div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Legend (hidden in CRT/Pro mode) */}
      {config.mapMode !== 'crt' && config.mapMode !== 'pro' && (
        <div className="map-legend">
          <div className="legend-item"><span className="dot civilian" /> Civilian ({sortedAircraft.filter(a => !a.military && !a.emergency).length})</div>
          <div className="legend-item"><span className="dot military" /> Military ({sortedAircraft.filter(a => a.military).length})</div>
          <div className="legend-item"><span className="dot emergency" /> Emergency ({sortedAircraft.filter(a => a.emergency).length})</div>
          <div className="legend-item" style={{ borderTop: '1px solid var(--border)', paddingTop: '8px', marginTop: '4px' }}>
            <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>
              {sortedAircraft.length} with position / {aircraft.length} total
            </span>
          </div>
        </div>
      )}

      {/* Selected Aircraft Popup */}
      {selectedAircraft && (() => {
        const isEmergency = selectedAircraft.emergency || ['7500', '7600', '7700'].includes(selectedAircraft.squawk);
        const squawkMeanings = { '7500': 'HIJACK', '7600': 'RADIO', '7700': 'EMERG' };
        const squawkLabel = squawkMeanings[selectedAircraft.squawk];
        
        // Check if this aircraft has a safety event
        const safetyEvent = activeConflicts.find(e =>
          e.icao?.toUpperCase() === selectedAircraft.hex?.toUpperCase() ||
          e.icao_2?.toUpperCase() === selectedAircraft.hex?.toUpperCase()
        );

        const isConflict = !!safetyEvent;
        const conflictSeverity = safetyEvent?.severity || null;
        const conflictTitle = safetyEvent ? getEventTypeName(safetyEvent.event_type) : null;

        // Get the other aircraft in a two-aircraft conflict from safety event
        const otherAircraftHex = safetyEvent?.icao_2
          ? (safetyEvent.icao?.toUpperCase() === selectedAircraft.hex?.toUpperCase()
              ? safetyEvent.icao_2
              : safetyEvent.icao)
          : null;
        const otherAircraft = otherAircraftHex
          ? aircraft.find(ac => ac.hex?.toUpperCase() === otherAircraftHex?.toUpperCase())
          : null;

        // Build conflictInfo for display
        const conflictInfo = safetyEvent?.icao_2 ? {
          hex1: safetyEvent.icao,
          hex2: safetyEvent.icao_2,
          horizontalNm: safetyEvent.horizontalNm || safetyEvent.details?.horizontal_nm?.toFixed(1) || '--',
          verticalFt: safetyEvent.verticalFt || safetyEvent.details?.altitude_diff_ft || '--'
        } : null;
        
        // Vertical rate arrows - chevron style like ATC displays
        const vr = selectedAircraft.vr || 0;
        const absVr = Math.abs(vr);
        const vrArrows = absVr > 2000 ? 3 : absVr > 1000 ? 2 : absVr > 300 ? 1 : 0;
        // Use chevron characters that look like the image
        const vrChevron = vr > 0 ? '▲' : vr < 0 ? '▼' : '';
        
        // Other aircraft vertical rate
        const otherVr = otherAircraft?.vr || 0;
        const otherAbsVr = Math.abs(otherVr);
        const otherVrArrows = otherAbsVr > 2000 ? 3 : otherAbsVr > 1000 ? 2 : otherAbsVr > 300 ? 1 : 0;
        const otherVrChevron = otherVr > 0 ? '▲' : otherVr < 0 ? '▼' : '';
        
        return (
        <div 
          className={`aircraft-popup-container ${isConflict ? 'with-conflict' : ''}`}
          style={{ left: popupPosition.x, top: popupPosition.y }}
        >
          {/* Main Aircraft Panel */}
          <div 
            className={`aircraft-popup ${config.mapMode === 'crt' ? 'crt-popup' : ''} ${config.mapMode === 'pro' ? 'pro-popup' : ''} ${isEmergency ? 'emergency-popup' : ''} ${isConflict ? `conflict-popup ${getSeverityClass(conflictSeverity)}` : ''} ${isDragging ? 'dragging' : ''}`}
            onMouseDown={handlePopupMouseDown}
          >
            <button className="popup-close" onClick={() => setSelectedAircraft(null)}>
              <X size={16} />
            </button>
            <div className={`popup-header ${isEmergency ? 'emergency-header' : ''} ${isConflict ? `conflict-header ${getSeverityClass(conflictSeverity)}` : ''}`}>
              <Plane size={20} />
              <span className="popup-callsign">{selectedAircraft.flight || selectedAircraft.hex}</span>
              {isConflict && <span className={`popup-conflict-tag ${getSeverityClass(conflictSeverity)}`}>⚠️ {conflictTitle}</span>}
              {isEmergency && squawkLabel && <span className="popup-squawk-tag">{squawkLabel}</span>}
              {selectedAircraft.military && <Shield size={14} className="military-badge" />}
            </div>
          
            <div className="popup-details">
              <div className="detail-row"><span>ICAO</span><span>{selectedAircraft.hex}</span></div>
              {(() => {
                const tailInfo = getTailInfo(selectedAircraft.hex, selectedAircraft.flight);
                return (
                  <>
                    <div className="detail-row">
                      <span>Tail #</span>
                      <span className={tailInfo.tailNumber ? 'tail-number' : 'tail-unknown'}>
                        {tailInfo.tailNumber || '--'}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span>Country</span>
                      <span>{tailInfo.country || '--'}</span>
                    </div>
                  </>
                );
              })()}
            <div className="detail-row"><span>Type</span><span>{selectedAircraft.type || '--'}</span></div>
            <div className="detail-row"><span>Altitude</span><span>{selectedAircraft.alt?.toLocaleString() || '--'} ft</span></div>
            <div className="detail-row"><span>Speed</span><span>{selectedAircraft.gs?.toFixed(0) || '--'} kts</span></div>
            <div className="detail-row"><span>Distance</span><span>{selectedAircraft.distance_nm?.toFixed(1) || '--'} nm</span></div>
            <div className="detail-row"><span>Track</span><span>{selectedAircraft.track?.toFixed(0) || '--'}°</span></div>
            <div className="detail-row">
              <span>V/S</span>
              <span className={`vs-value ${vr > 0 ? 'climbing' : vr < 0 ? 'descending' : ''}`}>
                {vrArrows > 0 && (
                  <span className={`vs-chevrons chevrons-${vrArrows}`}>
                    {Array(vrArrows).fill(vrChevron).map((c, i) => (
                      <span key={i} className="vs-chevron">{c}</span>
                    ))}
                  </span>
                )}
                {selectedAircraft.vr || '--'} fpm
              </span>
            </div>
            <div className="detail-row">
              <span>Squawk</span>
              <span className={selectedAircraft.squawk?.match(/^7[567]00$/) ? 'emergency-squawk' : ''}>
                {selectedAircraft.squawk || '--'}
              </span>
            </div>
          </div>
          
          {/* External Lookup Links */}
          <div className="popup-links">
            <span className="links-label">Lookup:</span>
            <div className="links-row">
              {selectedAircraft.flight && (
                <a 
                  href={`https://flightaware.com/live/flight/${selectedAircraft.flight.trim()}`}
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="lookup-link"
                  title="FlightAware"
                >
                  <ExternalLink size={12} /> FA
                </a>
              )}
              <a 
                href={`https://globe.adsbexchange.com/?icao=${selectedAircraft.hex}`}
                target="_blank" 
                rel="noopener noreferrer"
                className="lookup-link"
                title="ADS-B Exchange"
              >
                <ExternalLink size={12} /> ADSBx
              </a>
              <a 
                href={`https://www.planespotters.net/hex/${selectedAircraft.hex.toUpperCase()}`}
                target="_blank" 
                rel="noopener noreferrer"
                className="lookup-link"
                title="Planespotters"
              >
                <ExternalLink size={12} /> PS
              </a>
              <a 
                href={`https://www.jetphotos.com/registration/${selectedAircraft.hex.toUpperCase()}`}
                target="_blank" 
                rel="noopener noreferrer"
                className="lookup-link"
                title="JetPhotos"
              >
                <ExternalLink size={12} /> JP
              </a>
              <a 
                href={`https://opensky-network.org/aircraft-profile?icao24=${selectedAircraft.hex.toLowerCase()}`}
                target="_blank" 
                rel="noopener noreferrer"
                className="lookup-link"
                title="OpenSky Network"
              >
                <ExternalLink size={12} /> OSN
              </a>
              {selectedAircraft.flight && (
                <a 
                  href={`https://www.flightradar24.com/${selectedAircraft.flight.trim()}`}
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="lookup-link"
                  title="Flightradar24"
                >
                  <ExternalLink size={12} /> FR24
                </a>
              )}
            </div>
          </div>
          
          {/* Create Alert Button */}
          <button 
            className="popup-create-alert"
            onClick={() => {
              // Store selected aircraft for alert creation
              window.dispatchEvent(new CustomEvent('createAlertFromAircraft', { 
                detail: selectedAircraft 
              }));
              setSelectedAircraft(null);
            }}
          >
            <Bell size={14} />
            Create Alert for this Aircraft
          </button>
        </div>
        
        {/* Conflict Side Panel - Shows other aircraft */}
        {isConflict && otherAircraft && (
          <div className={`conflict-side-panel ${config.mapMode === 'pro' ? 'pro-style' : ''} ${getSeverityClass(conflictSeverity)}`}>
            <div className={`conflict-separation-header ${getSeverityClass(conflictSeverity)}`}>
              <AlertTriangle size={16} />
              <span>{conflictTitle}</span>
            </div>
            <div className="conflict-separation-info">
              <div className="separation-value">{conflictInfo?.horizontalNm || '--'}<span>nm</span></div>
              <div className="separation-value">{conflictInfo?.verticalFt || '--'}<span>ft</span></div>
            </div>
            {safetyEvent && (
              <div className="conflict-message-row">
                <span className="conflict-event-message">{safetyEvent.message}</span>
              </div>
            )}
            <div className="conflict-other-header">
              <Plane size={16} />
              <span>{otherAircraft.flight?.trim() || otherAircraft.hex}</span>
            </div>
            <div className="conflict-other-details">
              <div className="conflict-detail">
                <span>Alt</span>
                <span>{otherAircraft.alt?.toLocaleString() || '--'} ft</span>
              </div>
              <div className="conflict-detail">
                <span>Spd</span>
                <span>{otherAircraft.gs?.toFixed(0) || '--'} kts</span>
              </div>
              <div className="conflict-detail">
                <span>V/S</span>
                <span className={`vs-value ${otherVr > 0 ? 'climbing' : otherVr < 0 ? 'descending' : ''}`}>
                  {otherVrArrows > 0 && (
                    <span className={`vs-chevrons chevrons-${otherVrArrows}`}>
                      {Array(otherVrArrows).fill(otherVrChevron).join('')}
                    </span>
                  )}
                  {' '}{otherAircraft.vr || '--'}
                </span>
              </div>
              <div className="conflict-detail">
                <span>Trk</span>
                <span>{otherAircraft.track?.toFixed(0) || '--'}°</span>
              </div>
              <div className="conflict-detail">
                <span>Type</span>
                <span>{otherAircraft.type || '--'}</span>
              </div>
            </div>
            <button 
              className={`conflict-select-btn ${getSeverityClass(conflictSeverity)}`}
              onClick={() => setSelectedAircraft(otherAircraft)}
            >
              Select {otherAircraft.flight?.trim() || otherAircraft.hex}
            </button>
          </div>
        )}
        </div>
        );
      })()}

      {/* METAR Popup */}
      {selectedMetar && (() => {
        const decoded = decodeMetar(selectedMetar);
        return (
        <div 
          className={`weather-popup ${config.mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${isDragging ? 'dragging' : ''}`}
          style={{ left: popupPosition.x, top: popupPosition.y }}
          onMouseDown={handlePopupMouseDown}
        >
          <button className="popup-close" onClick={() => setSelectedMetar(null)}>
            <X size={16} />
          </button>
          <div className="popup-header">
            <MapPin size={20} />
            <span className="popup-callsign">{selectedMetar.stationId || selectedMetar.icaoId || 'METAR'}</span>
            <span className={`flt-cat-badge ${(selectedMetar.fltCat || 'VFR').toLowerCase()}`}>
              {selectedMetar.fltCat || 'VFR'}
            </span>
          </div>
          <div className="popup-details">
            {selectedMetar.name && (
              <div className="detail-row"><span>Name</span><span>{selectedMetar.name}</span></div>
            )}
            
            {/* Flight Category with explanation */}
            <div className="detail-row decoded-section">
              <span>Conditions</span>
              <div className="decoded-value">
                <strong>{decoded?.flightCategory || 'VFR'}</strong>
                <span className="decoded-desc">{decoded?.flightCategoryDesc}</span>
              </div>
            </div>
            
            {/* Temperature with description */}
            {decoded?.temperature && (
              <div className="detail-row decoded-section">
                <span>Temperature</span>
                <div className="decoded-value">
                  <strong>{decoded.temperature.celsius}°C / {decoded.temperature.fahrenheit}°F</strong>
                  <span className="decoded-desc">{decoded.temperature.description}</span>
                </div>
              </div>
            )}
            
            {/* Dewpoint with fog risk */}
            {decoded?.dewpoint && (
              <div className="detail-row decoded-section">
                <span>Dewpoint</span>
                <div className="decoded-value">
                  <strong>{decoded.dewpoint.celsius}°C</strong>
                  {decoded.dewpoint.spread !== undefined && (
                    <span className="decoded-desc">
                      Spread: {decoded.dewpoint.spread}°C • {decoded.dewpoint.fogRisk}
                    </span>
                  )}
                </div>
              </div>
            )}
            
            {/* Wind with description */}
            {decoded?.wind && (
              <div className="detail-row decoded-section">
                <span className="section-icon"><Navigation size={14} /> Wind</span>
                <div className="decoded-value">
                  <strong>{windDirToCardinal(decoded.wind.direction)} {decoded.wind.text}</strong>
                  <span className="decoded-desc">{decoded.wind.description}</span>
                </div>
              </div>
            )}
            
            {/* Visibility with description */}
            {decoded?.visibility && (
              <div className="detail-row decoded-section">
                <span>Visibility</span>
                <div className="decoded-value">
                  <strong>{decoded.visibility.value} {decoded.visibility.unit}</strong>
                  <span className="decoded-desc">{decoded.visibility.description}</span>
                </div>
              </div>
            )}
            
            {/* Altimeter with description */}
            {decoded?.altimeter && (
              <div className="detail-row decoded-section">
                <span>Altimeter</span>
                <div className="decoded-value">
                  <strong>{decoded.altimeter.inhg}" Hg</strong>
                  <span className="decoded-desc">{decoded.altimeter.description}</span>
                </div>
              </div>
            )}
            
            {/* Clouds with decoded descriptions */}
            {decoded?.clouds && decoded.clouds.length > 0 && (
              <div className="detail-row decoded-section">
                <span>Clouds</span>
                <div className="decoded-value cloud-layers">
                  {decoded.clouds.map((c, i) => (
                    <div key={i} className="cloud-layer">
                      <strong>{c.cover} @ {c.baseDesc}</strong>
                      <span className="decoded-desc">{c.coverDesc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Weather phenomena */}
            {decoded?.weather && decoded.weather.length > 0 && (
              <div className="detail-row decoded-section wx-section">
                <span>Weather</span>
                <div className="decoded-value">
                  {decoded.weather.map((w, i) => (
                    <div key={i} className="wx-item">
                      <strong>{w.code}</strong>
                      <span className="decoded-desc">{w.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Raw METAR */}
            {selectedMetar.rawOb && (
              <div className="detail-row raw-section">
                <span>Raw METAR</span>
                <span className="mono raw-text">{selectedMetar.rawOb}</span>
              </div>
            )}
            
            <div className="detail-row">
              <span>Observed</span>
              <span>{decoded?.time || '--'}</span>
            </div>
          </div>
        </div>
        );
      })()}

      {/* PIREP Popup */}
      {selectedPirep && (() => {
        const decoded = decodePirep(selectedPirep);
        return (
        <div 
          className={`weather-popup pirep-popup ${config.mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${decoded?.type === 'UUA' ? 'urgent-pirep' : ''} ${isDragging ? 'dragging' : ''}`}
          style={{ left: popupPosition.x, top: popupPosition.y }}
          onMouseDown={handlePopupMouseDown}
        >
          <button className="popup-close" onClick={() => setSelectedPirep(null)}>
            <X size={16} />
          </button>
          <div className="popup-header">
            <AlertTriangle size={20} />
            <span className="popup-callsign">PIREP</span>
            <span className={`pirep-type-badge ${decoded?.type === 'UUA' ? 'urgent' : ''}`}>
              {decoded?.type || 'UA'}
            </span>
          </div>
          
          {/* Urgent warning banner */}
          {decoded?.type === 'UUA' && (
            <div className="urgent-banner">
              ⚠️ URGENT PILOT REPORT - Significant weather hazard
            </div>
          )}
          
          <div className="popup-details">
            {/* Location */}
            {decoded?.location && (
              <div className="detail-row">
                <span>Location</span>
                <span>{decoded.location}</span>
              </div>
            )}
            
            {/* Aircraft */}
            {decoded?.aircraft && (
              <div className="detail-row">
                <span>Aircraft</span>
                <span>{decoded.aircraft}</span>
              </div>
            )}
            
            {/* Altitude/Flight Level */}
            {decoded?.altitude && (
              <div className="detail-row decoded-section">
                <span>Altitude</span>
                <div className="decoded-value">
                  <strong>{decoded.altitude.text}</strong>
                </div>
              </div>
            )}
            
            {/* Sky Condition */}
            {decoded?.sky && (
              <div className="detail-row decoded-section">
                <span>Sky</span>
                <div className="decoded-value">
                  <strong>{decoded.sky.description}</strong>
                </div>
              </div>
            )}
            
            {/* Turbulence with full decoding */}
            {decoded?.turbulence && (
              <div className={`detail-row decoded-section turb-section level-${decoded.turbulence.level}`}>
                <span className="section-icon"><Wind size={14} /> Turbulence</span>
                <div className="decoded-value">
                  <strong className="turb-intensity">{decoded.turbulence.intensity}</strong>
                  {decoded.turbulence.type && (
                    <span className="turb-type">{decoded.turbulence.type}</span>
                  )}
                  {decoded.turbulence.detail && (
                    <span className="decoded-desc">{decoded.turbulence.detail}</span>
                  )}
                  {decoded.turbulence.warning && (
                    <span className="hazard-warning">{decoded.turbulence.warning}</span>
                  )}
                </div>
              </div>
            )}
            
            {/* Icing with full decoding */}
            {decoded?.icing && (
              <div className={`detail-row decoded-section icing-section level-${decoded.icing.level}`}>
                <span className="section-icon"><Snowflake size={14} /> Icing</span>
                <div className="decoded-value">
                  <strong className="icing-intensity">{decoded.icing.intensity}</strong>
                  {decoded.icing.type && (
                    <span className="icing-type">{decoded.icing.type}</span>
                  )}
                  {decoded.icing.detail && (
                    <span className="decoded-desc">{decoded.icing.detail}</span>
                  )}
                  {decoded.icing.warning && (
                    <span className="hazard-warning">{decoded.icing.warning}</span>
                  )}
                </div>
              </div>
            )}
            
            {/* Wind Shear / LLWS with full decoding */}
            {decoded?.windshear && (
              <div className={`detail-row decoded-section ws-section level-${decoded.windshear.level}`}>
                <span className="section-icon"><Wind size={14} /> Wind Shear</span>
                <div className="decoded-value">
                  <strong className="ws-intensity">{decoded.windshear.intensity}</strong>
                  {decoded.windshear.gainLoss && (
                    <span className="ws-type">{decoded.windshear.gainLoss}</span>
                  )}
                  {decoded.windshear.altRange && (
                    <span className="ws-type">at {decoded.windshear.altRange}</span>
                  )}
                  {decoded.windshear.detail && (
                    <span className="decoded-desc">{decoded.windshear.detail}</span>
                  )}
                  {decoded.windshear.warning && (
                    <span className="hazard-warning">{decoded.windshear.warning}</span>
                  )}
                </div>
              </div>
            )}
            
            {/* Weather */}
            {decoded?.weather && (
              <div className="detail-row">
                <span>Weather</span>
                <span>{decoded.weather.description}</span>
              </div>
            )}
            
            {/* Temperature at altitude */}
            {decoded?.temperature && (
              <div className="detail-row decoded-section">
                <span className="section-icon"><Thermometer size={14} /> Temp</span>
                <div className="decoded-value">
                  <strong>{decoded.temperature.celsius}°C / {decoded.temperature.fahrenheit}°F</strong>
                  {decoded.temperature.isaDeviation !== null && (
                    <span className="decoded-desc">
                      ISA deviation: {decoded.temperature.isaDeviation > 0 ? '+' : ''}{decoded.temperature.isaDeviation}°C
                    </span>
                  )}
                </div>
              </div>
            )}
            
            {/* Wind at altitude */}
            {decoded?.wind && (
              <div className="detail-row">
                <span className="section-icon"><Navigation size={14} /> Wind</span>
                <span>{windDirToCardinal(decoded.wind.direction)} ({decoded.wind.direction}°) at {decoded.wind.speed}kt</span>
              </div>
            )}
            
            {/* Remarks */}
            {decoded?.remarks && (
              <div className="detail-row">
                <span>Remarks</span>
                <span>{decoded.remarks}</span>
              </div>
            )}
            
            {/* Raw PIREP */}
            {selectedPirep.rawOb && (
              <div className="detail-row raw-section">
                <span>Raw PIREP</span>
                <span className="mono raw-text">{selectedPirep.rawOb}</span>
              </div>
            )}
            
            {/* Reported time - only show if valid */}
            {decoded?.time && (
              <div className="detail-row">
                <span>Reported</span>
                <span>{decoded.time}</span>
              </div>
            )}
          </div>
        </div>
        );
      })()}

      {/* Navaid Popup */}
      {selectedNavaid && (
        <div 
          className={`weather-popup navaid-popup ${config.mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${isDragging ? 'dragging' : ''}`}
          style={{ left: popupPosition.x, top: popupPosition.y }}
          onMouseDown={handlePopupMouseDown}
        >
          <button className="popup-close" onClick={() => setSelectedNavaid(null)}>
            <X size={16} />
          </button>
          <div className="popup-header">
            <Radio size={20} />
            <span className="popup-callsign">{selectedNavaid.id}</span>
            <span className="navaid-type-badge">{selectedNavaid.type || 'NAV'}</span>
          </div>
          
          <div className="popup-details">
            <div className="detail-row">
              <span>Type</span>
              <span>{selectedNavaid.type || 'Unknown'}</span>
            </div>
            
            {selectedNavaid.name && (
              <div className="detail-row">
                <span>Name</span>
                <span>{selectedNavaid.name}</span>
              </div>
            )}
            
            {selectedNavaid.freq && (
              <div className="detail-row">
                <span>Frequency</span>
                <span>{selectedNavaid.freq} MHz</span>
              </div>
            )}
            
            {selectedNavaid.channel && (
              <div className="detail-row">
                <span>Channel</span>
                <span>{selectedNavaid.channel}</span>
              </div>
            )}
            
            <div className="detail-row">
              <span>Position</span>
              <span>{selectedNavaid.lat?.toFixed(4)}°, {selectedNavaid.lon?.toFixed(4)}°</span>
            </div>
            
            {selectedNavaid.elev && (
              <div className="detail-row">
                <span>Elevation</span>
                <span>{selectedNavaid.elev.toLocaleString()} ft</span>
              </div>
            )}
            
            <div className="detail-row">
              <span>Distance</span>
              <span>{getDistanceNm(selectedNavaid.lat, selectedNavaid.lon).toFixed(1)} nm</span>
            </div>
            
            <div className="detail-row">
              <span>Bearing</span>
              <span>{Math.round(getBearing(selectedNavaid.lat, selectedNavaid.lon))}°</span>
            </div>
          </div>
        </div>
      )}

      {/* Airport Popup */}
      {selectedAirport && (
        <div 
          className={`weather-popup airport-popup ${config.mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${isDragging ? 'dragging' : ''}`}
          style={{ left: popupPosition.x, top: popupPosition.y }}
          onMouseDown={handlePopupMouseDown}
        >
          <button className="popup-close" onClick={() => setSelectedAirport(null)}>
            <X size={16} />
          </button>
          <div className="popup-header">
            <Plane size={20} />
            <span className="popup-callsign">{selectedAirport.icao || selectedAirport.icaoId || selectedAirport.faaId || selectedAirport.id || 'APT'}</span>
            {selectedAirport.class && (
              <span className={`airport-class-badge class-${selectedAirport.class.toLowerCase()}`}>
                Class {selectedAirport.class}
              </span>
            )}
          </div>
          
          <div className="popup-details">
            {(selectedAirport.name || selectedAirport.site) && (
              <div className="detail-row">
                <span>Name</span>
                <span>{selectedAirport.name || selectedAirport.site}</span>
              </div>
            )}
            
            {(selectedAirport.city || selectedAirport.assocCity) && (
              <div className="detail-row">
                <span>City</span>
                <span>{selectedAirport.city || selectedAirport.assocCity}</span>
              </div>
            )}
            
            {(selectedAirport.state || selectedAirport.stateProv) && (
              <div className="detail-row">
                <span>State</span>
                <span>{selectedAirport.state || selectedAirport.stateProv}</span>
              </div>
            )}
            
            <div className="detail-row">
              <span>Position</span>
              <span>{selectedAirport.lat?.toFixed(4)}°, {selectedAirport.lon?.toFixed(4)}°</span>
            </div>
            
            {(selectedAirport.elev !== undefined && selectedAirport.elev !== null) || selectedAirport.elev_ft ? (
              <div className="detail-row">
                <span>Elevation</span>
                <span>{(selectedAirport.elev ?? selectedAirport.elev_ft).toLocaleString()} ft</span>
              </div>
            ) : null}
            
            {selectedAirport.rwy_length && (
              <div className="detail-row">
                <span>Longest Runway</span>
                <span>{selectedAirport.rwy_length.toLocaleString()} ft</span>
              </div>
            )}
            
            <div className="detail-row">
              <span>Distance</span>
              <span>{getDistanceNm(selectedAirport.lat, selectedAirport.lon).toFixed(1)} nm</span>
            </div>
            
            <div className="detail-row">
              <span>Bearing</span>
              <span>{Math.round(getBearing(selectedAirport.lat, selectedAirport.lon))}°</span>
            </div>
            
            {/* External links */}
            <div className="detail-row lookup-section">
              <span>LOOKUP:</span>
              <div className="lookup-links">
                <a href={`https://www.airnav.com/airport/${selectedAirport.icao || selectedAirport.icaoId || selectedAirport.faaId || selectedAirport.id}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={12} /> AirNav
                </a>
                <a href={`https://skyvector.com/airport/${selectedAirport.icao || selectedAirport.icaoId || selectedAirport.faaId || selectedAirport.id}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={12} /> SkyVector
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pro Mode Search Bar */}
      {config.mapMode === 'pro' && (
        <div className="pro-search-bar">
          <Search size={18} className="search-icon" />
          <input 
            type="text" 
            placeholder="Search callsign, squawk, or ICAO..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          <div className="pro-header-right">
            <div className="pro-time">
              <Clock size={14} />
              <span>{new Date().toISOString().slice(11, 19)} Z</span>
            </div>
            {acarsStatus && (
              <div className={`acars-status-badge ${acarsStatus.running ? 'running' : 'stopped'}`} title={`ACARS: ${acarsStatus.running ? 'Running' : 'Stopped'}`}>
                <MessageCircle size={12} />
                <span>{acarsStatus.buffer_size || 0}</span>
              </div>
            )}
            <button 
              className={`pro-header-btn ${soundMuted ? 'muted' : ''}`}
              onClick={() => setSoundMuted(!soundMuted)}
              title={soundMuted ? 'Unmute' : 'Mute'}
            >
              {soundMuted ? <VolumeX size={18} /> : <Bell size={18} />}
            </button>
            <button 
              className={`pro-header-btn ${showAcarsPanel ? 'active' : ''}`}
              onClick={() => setShowAcarsPanel(!showAcarsPanel)}
              title="ACARS Messages"
            >
              <MessageCircle size={18} />
            </button>
            <button 
              className={`pro-header-btn ${showFilterMenu ? 'active' : ''}`} 
              onClick={() => { setShowFilterMenu(!showFilterMenu); setShowOverlayMenu(false); }}
              title="Traffic Filters"
            >
              <Filter size={18} />
            </button>
            <button 
              className={`pro-header-btn ${showOverlayMenu ? 'active' : ''}`} 
              onClick={() => { setShowOverlayMenu(!showOverlayMenu); setShowFilterMenu(false); }}
              title="Map Layers"
            >
              <Layers size={18} />
            </button>
            <button 
              className="pro-header-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
          </div>
        </div>
      )}

      {/* Pro Mode Safety Event Alert - Shows highest priority event */}
      {config.mapMode === 'pro' && activeConflicts.length > 0 && (
        <div className="pro-conflict-alerts">
          {activeConflicts
            .filter(event => !acknowledgedEvents.has(event.id))
            .slice(0, 1)
            .map((event, idx) => (
            <div
              key={event.id || `pro-conflict-${event.icao}-${idx}`}
              className={`pro-conflict-alert ${getSeverityClass(event.severity)}`}
              onClick={() => {
                const ac = aircraft.find(a => a.hex?.toUpperCase() === event.icao?.toUpperCase());
                if (ac) {
                  setSelectedMetar(null);
                  setSelectedPirep(null);
                  setSelectedNavaid(null);
                  setSelectedAirport(null);
                  setSelectedAircraft(ac);
                }
              }}
            >
              <div className="pro-conflict-icon">
                <AlertTriangle size={20} />
              </div>
              <div className="pro-conflict-content">
                <div className="pro-conflict-title">{getEventTypeName(event.event_type)}</div>
                <div className="pro-conflict-aircraft">
                  {event.callsign || event.icao}
                  {event.callsign_2 ? ` ↔ ${event.callsign_2}` : ''}
                </div>
                {event.hex2 && (
                  <div className="pro-conflict-sep">{event.horizontalNm}nm / {event.verticalFt}ft</div>
                )}
                {!event.hex2 && event.verticalFt && (
                  <div className="pro-conflict-sep">{event.verticalFt}</div>
                )}
              </div>
              <button
                className="pro-conflict-ack"
                onClick={(e) => {
                  e.stopPropagation();
                  acknowledgeEvent(event.id);
                }}
                title="Acknowledge"
              >
                <Check size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      

      {/* Pro Mode Details Panel */}
      {config.mapMode === 'pro' && liveAircraft && (() => {
        // liveAircraft is already memoized above for live updates
        const isEmergency = ['7500', '7600', '7700'].includes(liveAircraft.squawk);
        const emergencyType = liveAircraft.squawk === '7500' ? 'HIJACK' :
                             liveAircraft.squawk === '7600' ? 'RADIO FAILURE' :
                             liveAircraft.squawk === '7700' ? 'EMERGENCY' : null;

        // Check for safety event from backend
        const safetyEvent = activeConflicts.find(e =>
          e.icao?.toUpperCase() === liveAircraft.hex?.toUpperCase() ||
          e.icao_2?.toUpperCase() === liveAircraft.hex?.toUpperCase()
        );

        const isInConflict = !!safetyEvent;
        const conflictSeverity = safetyEvent?.severity || null;
        const conflictTitle = safetyEvent ? getEventTypeName(safetyEvent.event_type) : null;
        
        return (
        <div className={`pro-details-panel ${isEmergency ? 'emergency' : ''} ${isInConflict ? `conflict ${getSeverityClass(conflictSeverity)}` : ''} ${panelPinned ? 'pinned' : ''}`}>
          <div className="pro-panel-title-bar">
            <span className="pro-panel-title">TARGET DETAILS</span>
            <div className="pro-panel-actions">
              <button 
                className={`pro-panel-btn ${panelPinned ? 'active' : ''}`} 
                onClick={() => setPanelPinned(!panelPinned)}
                title={panelPinned ? 'Unpin panel' : 'Pin panel open'}
              >
                {panelPinned ? <PinOff size={14} /> : <Pin size={14} />}
              </button>
              <button
                className="pro-panel-btn"
                onClick={() => setAircraftDetailHex(liveAircraft.hex)}
                title="View full aircraft details"
              >
                <ExternalLink size={14} />
              </button>
              <button className="pro-panel-close" onClick={() => !panelPinned && setSelectedAircraft(null)}>
                <X size={18} />
              </button>
            </div>
          </div>
          
          {/* Emergency Banner */}
          {isEmergency && (
            <div className={`pro-emergency-banner squawk-${liveAircraft.squawk}`}>
              <AlertTriangle size={18} />
              <span className="emergency-type">{emergencyType}</span>
              <span className="emergency-squawk">SQUAWK {liveAircraft.squawk}</span>
            </div>
          )}

          {/* Safety Event / Conflict Banner */}
          {isInConflict && safetyEvent && (
            <div className={`pro-conflict-banner ${getSeverityClass(conflictSeverity)}`}>
              <Zap size={18} />
              <div className="conflict-info">
                <span className="conflict-label">{conflictTitle}</span>
                <span className="conflict-message">{safetyEvent.message}</span>
              </div>
              {safetyEvent.hex2 && (
                <div className="conflict-separation">
                  <span>{safetyEvent.horizontalNm}nm</span>
                  <span>{safetyEvent.verticalFt}ft</span>
                </div>
              )}
            </div>
          )}
          
          <div className="pro-panel-header">
            <div className="pro-callsign-row">
              <span className="pro-flag">{getTailInfo(liveAircraft.hex, liveAircraft.flight).flag}</span>
              <h2 className="pro-callsign">{liveAircraft.flight?.trim() || liveAircraft.hex?.toUpperCase()}</h2>
            </div>
            <div className="pro-badges">
              <span className="pro-badge hex">{liveAircraft.hex?.toUpperCase()}</span>
              <span className="pro-badge category" title={liveAircraft.category || 'A3'}>{getCategoryName(liveAircraft.category)}</span>
              {isEmergency && <span className="pro-badge emergency">EMG</span>}
            </div>
            {/* Quick Alert Actions */}
            <div className="pro-quick-alerts">
              {liveAircraft.flight?.trim() && (
                <button
                  className="pro-alert-btn"
                  onClick={() => {
                    // Add callsign alert - this would integrate with your alerts system
                    console.log('Add alert for callsign:', liveAircraft.flight?.trim());
                    alert(`Alert added for callsign: ${liveAircraft.flight?.trim()}`);
                  }}
                  title={`Add alert for ${liveAircraft.flight?.trim()}`}
                >
                  <BellPlus size={12} />
                  <span>Alert {liveAircraft.flight?.trim()}</span>
                </button>
              )}
              {getTailInfo(liveAircraft.hex, liveAircraft.flight).tailNumber && (
                <button
                  className="pro-alert-btn"
                  onClick={() => {
                    const tail = getTailInfo(liveAircraft.hex, liveAircraft.flight).tailNumber;
                    console.log('Add alert for tail:', tail);
                    alert(`Alert added for tail: ${tail}`);
                  }}
                  title={`Add alert for ${getTailInfo(liveAircraft.hex, liveAircraft.flight).tailNumber}`}
                >
                  <BellPlus size={12} />
                  <span>Alert {getTailInfo(liveAircraft.hex, liveAircraft.flight).tailNumber}</span>
                </button>
              )}
            </div>
          </div>

          {/* Aircraft Thumbnail - Using cached photo API */}
          <div className="pro-aircraft-photo">
            {!proPhotoError ? (
              <img
                key={`${liveAircraft.hex}-${proPhotoRetry}`}
                src={`${config.apiBaseUrl || ''}/api/v1/aircraft/${liveAircraft.hex}/photo/download?thumbnail=true${proPhotoRetry > 0 ? `&t=${proPhotoRetry}` : ''}`}
                alt={liveAircraft.flight?.trim() || liveAircraft.hex}
                onError={() => setProPhotoError(true)}
                loading="lazy"
              />
            ) : (
              <div className="pro-photo-placeholder">
                <Plane size={48} />
                <span>No Photo Available</span>
                <button
                  className="pro-photo-retry"
                  onClick={() => {
                    setProPhotoError(false);
                    setProPhotoRetry(c => c + 1);
                  }}
                >
                  <RefreshCw size={14} /> Retry
                </button>
              </div>
            )}
          </div>

          {/* Operator & Airframe Info */}
          {aircraftInfo[liveAircraft.hex] && (
            <div className="pro-aircraft-info">
              {(aircraftInfo[liveAircraft.hex].operator || aircraftInfo[liveAircraft.hex].owner) && (
                <div className="pro-info-row">
                  <span className="pro-info-label">Operator</span>
                  <span className="pro-info-value">{aircraftInfo[liveAircraft.hex].operator || aircraftInfo[liveAircraft.hex].owner}</span>
                </div>
              )}
              {aircraftInfo[liveAircraft.hex].type_name && (
                <div className="pro-info-row">
                  <span className="pro-info-label">Aircraft</span>
                  <span className="pro-info-value">{aircraftInfo[liveAircraft.hex].type_name}</span>
                </div>
              )}
              {aircraftInfo[liveAircraft.hex].registration && (
                <div className="pro-info-row">
                  <span className="pro-info-label">Reg</span>
                  <span className="pro-info-value">{aircraftInfo[liveAircraft.hex].registration}</span>
                </div>
              )}
              {aircraftInfo[liveAircraft.hex].year_built && (
                <div className="pro-info-row">
                  <span className="pro-info-label">Built</span>
                  <span className="pro-info-value">
                    {aircraftInfo[liveAircraft.hex].year_built}
                    {aircraftInfo[liveAircraft.hex].age_years && ` (${aircraftInfo[liveAircraft.hex].age_years}y)`}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="pro-stats-grid">
            <div className="pro-stat">
              <div className="pro-stat-label"><Crosshair size={14} /> ALTITUDE</div>
              <div className="pro-stat-value">{(liveAircraft.alt_baro || liveAircraft.alt_geom || liveAircraft.alt || 0).toLocaleString()} <span className="unit">ft</span></div>
            </div>
            <div className="pro-stat">
              <div className="pro-stat-label"><Navigation size={14} /> SPEED</div>
              <div className="pro-stat-value">{liveAircraft.gs || liveAircraft.tas || '--'} <span className="unit">kts</span></div>
            </div>
            <div className="pro-stat">
              <div className="pro-stat-label"><Plane size={14} /> TYPE</div>
              <div className="pro-stat-value">{liveAircraft.t || liveAircraft.type || '--'}</div>
            </div>
            <div className="pro-stat">
              <div className="pro-stat-label"><Radio size={14} /> SQUAWK</div>
              <div className="pro-stat-value">{liveAircraft.squawk || '1200'}</div>
            </div>
            <div className="pro-stat">
              <div className="pro-stat-label"><TrendingUp size={14} /> V/S</div>
              {(() => {
                const vs = liveAircraft.vr ?? liveAircraft.baro_rate ?? liveAircraft.geom_rate ?? 0;
                const isExtreme = Math.abs(vs) > 3000;
                const vsClass = vs > 0 ? 'climbing' : vs < 0 ? 'descending' : '';
                return (
                  <div className={`pro-stat-value ${vsClass} ${isExtreme ? 'extreme-vs' : ''}`}>
                    {vs > 0 ? '+' : ''}{vs} <span className="unit">fpm</span>
                  </div>
                );
              })()}
            </div>
            <div className="pro-stat">
              <div className="pro-stat-label"><LocateFixed size={14} /> TRACK</div>
              <div className="pro-stat-value">
                {Math.round(liveAircraft.track || liveAircraft.true_heading || 0)}°
                <span className="unit cardinal">{windDirToCardinal(liveAircraft.track || liveAircraft.true_heading)}</span>
              </div>
            </div>
            <div className="pro-stat">
              <div className="pro-stat-label"><MapPin size={14} /> DISTANCE</div>
              <div className="pro-stat-value">{(liveAircraft.distance_nm || getDistanceNm(liveAircraft.lat, liveAircraft.lon)).toFixed(1)} <span className="unit">nm</span></div>
            </div>
            <div className="pro-stat">
              <div className="pro-stat-label"><Signal size={14} /> RSSI</div>
              <div className="pro-stat-value">{liveAircraft.rssi?.toFixed(1) || '--'} <span className="unit">dBFS</span></div>
            </div>
          </div>

          <div className="pro-profile-chart">
            <div className="pro-section-header">
              ALTITUDE PROFILE
              <span className="profile-value cyan">{(liveAircraft.alt_baro || liveAircraft.alt_geom || liveAircraft.alt || 0).toLocaleString()}</span>
            </div>
            <canvas
              className="profile-canvas"
              width={280}
              height={60}
              ref={altProfileCanvasRef}
            />
          </div>

          <div className="pro-profile-chart">
            <div className="pro-section-header">
              SPEED PROFILE
              <span className="profile-value green">{liveAircraft.gs || liveAircraft.tas || '--'}</span>
            </div>
            <canvas
              className="profile-canvas"
              width={280}
              height={60}
              ref={speedProfileCanvasRef}
            />
          </div>

          <div className="pro-profile-chart">
            <div className="pro-section-header">
              VERTICAL SPEED
              <span className={`profile-value ${(liveAircraft.vr ?? liveAircraft.baro_rate ?? 0) > 0 ? 'cyan' : (liveAircraft.vr ?? liveAircraft.baro_rate ?? 0) < 0 ? 'red' : ''}`}>
                {(liveAircraft.vr ?? liveAircraft.baro_rate ?? liveAircraft.geom_rate ?? 0) > 0 ? '+' : ''}{liveAircraft.vr ?? liveAircraft.baro_rate ?? liveAircraft.geom_rate ?? 0}
              </span>
            </div>
            <canvas
              className="profile-canvas"
              width={280}
              height={60}
              ref={vsProfileCanvasRef}
            />
          </div>

          <div className="pro-profile-chart">
            <div className="pro-section-header">
              DISTANCE
              <span className="profile-value purple">{(liveAircraft.distance_nm || getDistanceNm(liveAircraft.lat, liveAircraft.lon)).toFixed(1)}</span>
            </div>
            <canvas
              className="profile-canvas"
              width={280}
              height={60}
              ref={distProfileCanvasRef}
            />
          </div>

          <div className="pro-track-history">
            <div className="pro-section-header">TRACK HISTORY</div>
            <canvas
              className="track-history-canvas"
              width={280}
              height={80}
              ref={trackCanvasRef}
            />
          </div>

          <div className="pro-external-links">
            <div className="pro-section-header">EXTERNAL</div>
            <div className="pro-links">
              <a href={`https://flightaware.com/live/flight/${liveAircraft.flight?.trim() || liveAircraft.hex}`} target="_blank" rel="noopener noreferrer" className="pro-link">
                FlightAware <ExternalLink size={12} />
              </a>
              <a href={`https://globe.adsbexchange.com/?icao=${liveAircraft.hex}`} target="_blank" rel="noopener noreferrer" className="pro-link">
                ADSBx <ExternalLink size={12} />
              </a>
            </div>
          </div>
        </div>
        );
      })()}

      {/* ACARS Messages Panel */}
      {showAcarsPanel && (
        <div className="acars-panel">
          <div className="acars-panel-header">
            <div className="acars-panel-title">
              <MessageCircle size={18} />
              <span>ACARS Messages</span>
              {acarsStatus && (
                <span className={`acars-status-dot ${acarsStatus.running ? 'active' : ''}`} />
              )}
            </div>
            <button className="acars-close" onClick={() => setShowAcarsPanel(false)}>
              <X size={16} />
            </button>
          </div>
          {acarsStatus && (
            <div className="acars-stats">
              <div className="acars-stat">
                <span>Buffer</span>
                <span>{acarsStatus.buffer_size || 0}</span>
              </div>
              <div className="acars-stat">
                <span>ACARS</span>
                <span>{acarsStatus.acars?.total_received || 0}</span>
              </div>
              <div className="acars-stat">
                <span>VDL2</span>
                <span>{acarsStatus.vdlm2?.total_received || 0}</span>
              </div>
            </div>
          )}
          {/* ACARS Filters */}
          <div className="acars-filters">
            <label className="acars-filter-toggle">
              <input 
                type="checkbox" 
                checked={acarsFilters.hideEmpty}
                onChange={(e) => setAcarsFilters({...acarsFilters, hideEmpty: e.target.checked})}
              />
              <span>Hide empty</span>
            </label>
            <select 
              className="acars-source-filter"
              value={acarsFilters.sourceFilter}
              onChange={(e) => setAcarsFilters({...acarsFilters, sourceFilter: e.target.value})}
            >
              <option value="all">All Sources</option>
              <option value="acars">ACARS Only</option>
              <option value="vdlm2">VDL2 Only</option>
            </select>
            <input 
              type="text"
              className="acars-callsign-filter"
              placeholder="Callsign..."
              value={acarsFilters.callsignFilter}
              onChange={(e) => setAcarsFilters({...acarsFilters, callsignFilter: e.target.value})}
            />
          </div>
          <div className="acars-messages">
            {(() => {
              // Filter messages
              let filtered = acarsMessages;
              
              // Hide empty messages
              if (acarsFilters.hideEmpty) {
                filtered = filtered.filter(msg => msg.text && msg.text.trim().length > 0);
              }
              
              // Source filter
              if (acarsFilters.sourceFilter !== 'all') {
                filtered = filtered.filter(msg => msg.source === acarsFilters.sourceFilter);
              }
              
              // Callsign filter
              if (acarsFilters.callsignFilter) {
                const cf = acarsFilters.callsignFilter.toLowerCase();
                filtered = filtered.filter(msg => 
                  (msg.callsign && msg.callsign.toLowerCase().includes(cf)) ||
                  (msg.icao_hex && msg.icao_hex.toLowerCase().includes(cf))
                );
              }
              
              if (filtered.length === 0) {
                return <div className="acars-empty">No messages match filters</div>;
              }
              
              return filtered.slice(0, 50).map((msg, i) => (
                <div key={i} className="acars-message">
                  <div className="acars-msg-header">
                    <span className="acars-callsign">{msg.callsign || msg.icao_hex || 'Unknown'}</span>
                    <span className="acars-label">{msg.label || '--'}</span>
                    <span className={`acars-source-badge ${msg.source}`}>{msg.source}</span>
                    <span className="acars-time">
                      {msg.timestamp ? new Date(msg.timestamp * 1000).toLocaleTimeString() : '--'}
                    </span>
                  </div>
                  {msg.text && <div className="acars-text">{msg.text}</div>}
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* Aircraft Detail Modal */}
      {aircraftDetailHex && (
        <div className="aircraft-detail-overlay" onClick={() => setAircraftDetailHex(null)}>
          <div className="aircraft-detail-modal" onClick={e => e.stopPropagation()}>
            <AircraftDetailPage 
              hex={aircraftDetailHex} 
              apiUrl={config.apiBaseUrl}
              onClose={() => setAircraftDetailHex(null)}
              aircraft={aircraft.find(a => a.hex === aircraftDetailHex)}
              aircraftInfo={aircraftInfo[aircraftDetailHex]}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function AircraftList({ aircraft }) {
  const [sortField, setSortField] = useState('distance_nm');
  const [sortAsc, setSortAsc] = useState(true);
  const [filter, setFilter] = useState('');
  const [showMilitary, setShowMilitary] = useState(true);

  const filteredAircraft = useMemo(() => {
    let filtered = [...aircraft];

    if (filter) {
      const f = filter.toLowerCase();
      filtered = filtered.filter(ac =>
        ac.hex?.toLowerCase().includes(f) ||
        ac.flight?.toLowerCase().includes(f) ||
        ac.type?.toLowerCase().includes(f)
      );
    }

    if (!showMilitary) {
      filtered = filtered.filter(ac => !ac.military);
    }

    filtered.sort((a, b) => {
      const aVal = a[sortField] ?? 999999;
      const bVal = b[sortField] ?? 999999;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortAsc ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
    });

    return filtered;
  }, [aircraft, filter, showMilitary, sortField, sortAsc]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const SortIcon = ({ field }) => (
    sortField === field ? (sortAsc ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : null
  );

  return (
    <div className="aircraft-list-container">
      <div className="list-toolbar">
        <div className="search-box">
          <Filter size={16} />
          <input
            type="text"
            placeholder="Filter by ICAO, callsign, type..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>
        <button
          className={`toggle-btn ${showMilitary ? 'active' : ''}`}
          onClick={() => setShowMilitary(!showMilitary)}
        >
          <Shield size={16} />
          Military
        </button>
      </div>

      <div className="aircraft-table-wrapper">
        <table className="aircraft-table">
          <thead>
            <tr>
              <th onClick={() => handleSort('hex')}>ICAO <SortIcon field="hex" /></th>
              <th onClick={() => handleSort('flight')}>Callsign <SortIcon field="flight" /></th>
              <th onClick={() => handleSort('type')}>Type <SortIcon field="type" /></th>
              <th onClick={() => handleSort('alt')}>Altitude <SortIcon field="alt" /></th>
              <th onClick={() => handleSort('gs')}>Speed <SortIcon field="gs" /></th>
              <th onClick={() => handleSort('vr')}>V/S <SortIcon field="vr" /></th>
              <th onClick={() => handleSort('distance_nm')}>Distance <SortIcon field="distance_nm" /></th>
              <th>Squawk</th>
            </tr>
          </thead>
          <tbody>
            {filteredAircraft.map((ac, index) => (
              <tr key={ac.hex || `aircraft-${index}`} className={`${ac.military ? 'military' : ''} ${ac.emergency ? 'emergency' : ''}`}>
                <td className="mono">{ac.hex}</td>
                <td>{ac.flight || '--'}</td>
                <td className="mono">{ac.type || '--'}</td>
                <td className="mono">{ac.alt?.toLocaleString() || '--'}</td>
                <td className="mono">{ac.gs?.toFixed(0) || '--'}</td>
                <td className={`mono ${(ac.vr || 0) > 500 ? 'vr-positive' : (ac.vr || 0) < -500 ? 'vr-negative' : ''}`}>
                  {ac.vr || '--'}
                </td>
                <td className="mono">{ac.distance_nm?.toFixed(1) || '--'}</td>
                <td className={`mono ${ac.squawk?.match(/^7[567]00$/) ? 'emergency-squawk' : ''}`}>
                  {ac.squawk || '--'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="list-footer">
        Showing {filteredAircraft.length} of {aircraft.length} aircraft
      </div>
    </div>
  );
}

function StatsView({ apiBase }) {
  const { data: stats } = useApi('/api/v1/aircraft/stats', 5000, apiBase);
  const { data: top } = useApi('/api/v1/aircraft/top', 5000, apiBase);
  const { data: histStats } = useApi('/api/v1/history/stats?hours=24', 60000, apiBase);

  const emergencyAircraft = stats?.emergency_squawks || [];

  const altitudeData = useMemo(() => {
    if (!stats?.altitude_distribution) return [];
    const dist = stats.altitude_distribution;
    const total = Object.values(dist).reduce((a, b) => a + (b || 0), 0) || 1;
    return [
      { label: 'Ground', value: dist.ground || 0, pct: ((dist.ground || 0) / total) * 100 },
      { label: '< 10k ft', value: dist.low || 0, pct: ((dist.low || 0) / total) * 100 },
      { label: '10-30k ft', value: dist.medium || 0, pct: ((dist.medium || 0) / total) * 100 },
      { label: '> 30k ft', value: dist.high || 0, pct: ((dist.high || 0) / total) * 100 }
    ];
  }, [stats]);

  return (
    <div className="stats-container">
      {emergencyAircraft.length > 0 && (
        <div className="emergency-banner">
          <AlertTriangle size={24} />
          <div>
            <strong>Emergency Squawk Detected</strong>
            <div>{emergencyAircraft.map(a => `${a.hex} (${a.squawk})`).join(', ')}</div>
          </div>
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-label">Current Aircraft</div>
          <div className="stat-card-value">{stats?.total || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">With Position</div>
          <div className="stat-card-value">{stats?.with_position || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Military</div>
          <div className="stat-card-value purple">{stats?.military || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">24h Unique</div>
          <div className="stat-card-value">{histStats?.unique_aircraft || '--'}</div>
        </div>
      </div>

      <div className="distribution-card">
        <div className="card-title">Altitude Distribution</div>
        <div className="bar-chart">
          {altitudeData.map((item, i) => (
            <div key={i} className="bar-row">
              <span className="bar-label">{item.label}</span>
              <div className="bar-container">
                <div className="bar-fill" style={{ width: `${item.pct}%` }} />
              </div>
              <span className="bar-value">{item.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="top-lists">
        <div className="top-list-card">
          <div className="card-title">Closest Aircraft</div>
          <div className="top-list">
            {top?.closest?.slice(0, 5).map((ac, i) => (
              <div key={ac.hex} className="top-item">
                <span className="top-rank">{i + 1}</span>
                <div className="top-info">
                  <div className="top-callsign">{ac.flight || ac.hex}</div>
                  <div className="top-icao">{ac.hex}</div>
                </div>
                <span className="top-value">{ac.distance_nm?.toFixed(1)} nm</span>
              </div>
            ))}
          </div>
        </div>

        <div className="top-list-card">
          <div className="card-title">Highest Aircraft</div>
          <div className="top-list">
            {top?.highest?.slice(0, 5).map((ac, i) => (
              <div key={ac.hex} className="top-item">
                <span className="top-rank">{i + 1}</span>
                <div className="top-info">
                  <div className="top-callsign">{ac.flight || ac.hex}</div>
                  <div className="top-icao">{ac.hex}</div>
                </div>
                <span className="top-value">{ac.alt?.toLocaleString()} ft</span>
              </div>
            ))}
          </div>
        </div>

        <div className="top-list-card">
          <div className="card-title">Fastest Aircraft</div>
          <div className="top-list">
            {top?.fastest?.slice(0, 5).map((ac, i) => (
              <div key={ac.hex} className="top-item">
                <span className="top-rank">{i + 1}</span>
                <div className="top-info">
                  <div className="top-callsign">{ac.flight || ac.hex}</div>
                  <div className="top-icao">{ac.hex}</div>
                </div>
                <span className="top-value">{ac.gs?.toFixed(0)} kts</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function HistoryView({ apiBase }) {
  const [viewType, setViewType] = useState('sessions');
  const [timeRange, setTimeRange] = useState('24h');

  const hours = { '1h': 1, '6h': 6, '24h': 24, '48h': 48, '7d': 168 };
  const endpoint = viewType === 'sessions'
    ? `/api/v1/history/sessions?hours=${hours[timeRange]}`
    : `/api/v1/history/sightings?hours=${hours[timeRange]}&limit=100`;

  const { data, refetch } = useApi(endpoint, null, apiBase);

  useEffect(() => { refetch(); }, [timeRange, viewType, refetch]);

  return (
    <div className="history-container">
      <div className="history-toolbar">
        <div className="view-toggle">
          <button className={`time-btn ${viewType === 'sessions' ? 'active' : ''}`} onClick={() => setViewType('sessions')}>
            Sessions
          </button>
          <button className={`time-btn ${viewType === 'sightings' ? 'active' : ''}`} onClick={() => setViewType('sightings')}>
            Sightings
          </button>
        </div>

        <div className="time-range-selector">
          {['1h', '6h', '24h', '48h', '7d'].map(range => (
            <button
              key={range}
              className={`time-btn ${timeRange === range ? 'active' : ''}`}
              onClick={() => setTimeRange(range)}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {viewType === 'sessions' ? (
        <div className="sessions-grid">
          {data?.sessions?.map((session, i) => (
            <div key={i} className={`session-card ${session.military ? 'military' : ''}`}>
              <div className="session-header">
                <div>
                  <div className="session-callsign">{session.callsign || session.icao_hex}</div>
                  <div className="session-icao">{session.icao_hex}</div>
                </div>
                <div className="session-duration">{Math.round((session.duration_seconds || 0) / 60)}m</div>
              </div>
              <div className="session-stats">
                <div className="session-stat">
                  <span className="session-stat-label">Distance</span>
                  <span className="session-stat-value">{session.min_distance?.toFixed(1) || '--'} nm</span>
                </div>
                <div className="session-stat">
                  <span className="session-stat-label">Altitude</span>
                  <span className="session-stat-value">{session.min_altitude?.toLocaleString() || '--'} - {session.max_altitude?.toLocaleString() || '--'}</span>
                </div>
                <div className="session-stat">
                  <span className="session-stat-label">First Seen</span>
                  <span className="session-stat-value">{new Date(session.first_seen).toLocaleTimeString()}</span>
                </div>
                <div className="session-stat">
                  <span className="session-stat-label">Last Seen</span>
                  <span className="session-stat-value">{new Date(session.last_seen).toLocaleTimeString()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="sightings-table-wrapper">
          <table className="sightings-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>ICAO</th>
                <th>Callsign</th>
                <th>Altitude</th>
                <th>Speed</th>
                <th>Distance</th>
              </tr>
            </thead>
            <tbody>
              {data?.sightings?.map((s, i) => (
                <tr key={i}>
                  <td>{new Date(s.timestamp).toLocaleTimeString()}</td>
                  <td className="mono">{s.icao_hex}</td>
                  <td>{s.callsign || '--'}</td>
                  <td className="mono">{s.altitude?.toLocaleString() || '--'}</td>
                  <td className="mono">{s.gs?.toFixed(0) || '--'}</td>
                  <td className="mono">{s.distance_nm?.toFixed(1) || '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AlertsView({ apiBase }) {
  const [activeTab, setActiveTab] = useState('rules');
  const { data, refetch } = useApi('/api/v1/alerts/rules', null, apiBase);
  const [showForm, setShowForm] = useState(false);
  const [editRule, setEditRule] = useState(null);
  const [prefillAircraft, setPrefillAircraft] = useState(null);

  // Listen for create alert from aircraft popup
  useEffect(() => {
    const handleCreateAlert = (e) => {
      const aircraft = e.detail;
      setPrefillAircraft(aircraft);
      setEditRule(null);
      setShowForm(true);
    };
    window.addEventListener('createAlertFromAircraft', handleCreateAlert);
    return () => window.removeEventListener('createAlertFromAircraft', handleCreateAlert);
  }, []);

  const handleDelete = async (id) => {
    if (!confirm('Delete this rule?')) return;
    await fetch(`${apiBase}/api/v1/alerts/rules/${id}`, { method: 'DELETE' });
    refetch();
  };

  const handleToggle = async (rule) => {
    await fetch(`${apiBase}/api/v1/alerts/rules/${rule.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !rule.enabled })
    });
    refetch();
  };

  return (
    <div className="alerts-container">
      <div className="alerts-header">
        <div className="alerts-tabs">
          <button className={`alert-tab ${activeTab === 'rules' ? 'active' : ''}`} onClick={() => setActiveTab('rules')}>
            Rules
          </button>
          <button className={`alert-tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
            History
          </button>
        </div>
        {activeTab === 'rules' && (
          <button className="btn-primary" onClick={() => { setEditRule(null); setShowForm(true); }}>
            <Plus size={16} /> New Rule
          </button>
        )}
      </div>

      {activeTab === 'rules' ? (
        <div className="rules-list">
          {data?.rules?.map(rule => (
            <div key={rule.id} className={`rule-card ${rule.enabled ? '' : 'disabled'}`}>
              <div className="rule-header">
                <span className={`rule-priority ${rule.priority}`}>{rule.priority}</span>
                <span className="rule-name">{rule.name}</span>
                <div className="rule-actions">
                  <button onClick={() => handleToggle(rule)}>
                    {rule.enabled ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                  <button onClick={() => { setEditRule(rule); setShowForm(true); }}>
                    <Settings size={16} />
                  </button>
                  <button onClick={() => handleDelete(rule.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {rule.conditions ? (
                <div className="rule-conditions-summary">
                  {rule.conditions.groups?.map((group, gi) => (
                    <span key={gi}>
                      {gi > 0 && <strong className="logic-operator">{rule.conditions.logic || 'AND'}</strong>}
                      ({group.conditions?.map((c, ci) => (
                        <span key={ci}>
                          {ci > 0 && <span className="condition-logic">{group.logic || 'AND'}</span>}
                          <code>{c.type} {c.operator} {c.value}</code>
                        </span>
                      ))})
                    </span>
                  ))}
                </div>
              ) : (
                <div className="rule-details">
                  <span className="rule-type">{rule.type}</span>
                  <span className="rule-condition">{rule.operator} {rule.value}</span>
                </div>
              )}

              {rule.description && <div className="rule-description">{rule.description}</div>}

              {(rule.starts_at || rule.expires_at) && (
                <div className="rule-schedule">
                  {rule.starts_at && <span>Starts: {new Date(rule.starts_at).toLocaleString()}</span>}
                  {rule.expires_at && <span>Expires: {new Date(rule.expires_at).toLocaleString()}</span>}
                </div>
              )}

              {rule.api_url && (
                <div className="rule-schedule">
                  <span>API URL: <code>{rule.api_url}</code></span>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <AlertHistory />
      )}

      {showForm && (
        <RuleForm
          rule={editRule}
          prefillAircraft={prefillAircraft}
          apiBase={apiBase}
          onClose={() => { setShowForm(false); setPrefillAircraft(null); }}
          onSave={() => { setShowForm(false); setPrefillAircraft(null); refetch(); }}
        />
      )}
    </div>
  );
}

function AlertHistory() {
  const [history, setHistory] = useState([]);

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem('alert-history') || '[]');
    setHistory(stored);
  }, []);

  const clearHistory = () => {
    localStorage.setItem('alert-history', '[]');
    setHistory([]);
  };

  return (
    <div className="alert-history-container">
      {history.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <button className="btn-secondary" onClick={clearHistory}>
            <Trash2 size={14} /> Clear History
          </button>
        </div>
      )}

      {history.length === 0 ? (
        <div className="empty-state">
          No alert history yet. Alerts will appear here when triggered.
        </div>
      ) : (
        history.map(alert => (
          <div key={alert.id} className="alert-history-item">
            <div className={`alert-history-icon ${alert.priority || 'info'}`}>
              <Bell size={20} />
            </div>
            <div className="alert-history-content">
              <div className="alert-history-title">{alert.rule_name || 'Alert Triggered'}</div>
              <div className="alert-history-message">
                {alert.message || `Aircraft ${alert.icao} matched rule conditions`}
              </div>
            </div>
            <div className="alert-history-time">
              {new Date(alert.timestamp).toLocaleString()}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function RuleForm({ rule, prefillAircraft, apiBase, onClose, onSave }) {
  const defaultCondition = { type: 'icao', operator: 'eq', value: '' };
  const defaultGroup = { logic: 'AND', conditions: [{ ...defaultCondition }] };

  const [form, setForm] = useState(() => {
    if (rule) {
      return {
        ...rule,
        conditions: rule.conditions || {
          logic: 'AND',
          groups: [{ logic: 'AND', conditions: [{ type: rule.type || 'icao', operator: rule.operator || 'eq', value: rule.value || '' }] }]
        }
      };
    }
    // Pre-fill from aircraft if provided
    if (prefillAircraft) {
      const aircraftName = prefillAircraft.flight?.trim() || prefillAircraft.hex;
      return {
        name: `Track ${aircraftName}`,
        description: `Alert when ${aircraftName} (${prefillAircraft.hex}) is detected`,
        priority: 'info',
        enabled: true,
        starts_at: '',
        expires_at: '',
        api_url: '',
        conditions: {
          logic: 'AND',
          groups: [{
            logic: 'OR',
            conditions: [
              { type: 'icao', operator: 'eq', value: prefillAircraft.hex },
              ...(prefillAircraft.flight ? [{ type: 'callsign', operator: 'contains', value: prefillAircraft.flight.trim() }] : [])
            ]
          }]
        }
      };
    }
    return {
      name: '',
      description: '',
      priority: 'info',
      enabled: true,
      starts_at: '',
      expires_at: '',
      api_url: '',
      conditions: {
        logic: 'AND',
        groups: [{ ...defaultGroup }]
      }
    };
  });

  const handleSubmit = async (e) => {
    e.preventDefault();

    const firstCond = form.conditions?.groups?.[0]?.conditions?.[0];
    const payload = {
      name: form.name,
      description: form.description,
      priority: form.priority,
      enabled: form.enabled,
      conditions: form.conditions,
      starts_at: form.starts_at || null,
      expires_at: form.expires_at || null,
      api_url: form.api_url || null,
      type: firstCond?.type,
      operator: firstCond?.operator,
      value: firstCond?.value
    };

    const url = rule ? `${apiBase}/api/v1/alerts/rules/${rule.id}` : `${apiBase}/api/v1/alerts/rules`;
    await fetch(url, {
      method: rule ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    onSave();
  };

  const updateGroupLogic = (groupIndex, logic) => {
    const newGroups = [...(form.conditions?.groups || [])];
    newGroups[groupIndex] = { ...newGroups[groupIndex], logic };
    setForm({ ...form, conditions: { ...form.conditions, groups: newGroups } });
  };

  const updateCondition = (groupIndex, condIndex, field, value) => {
    const newGroups = [...(form.conditions?.groups || [])];
    const newConditions = [...newGroups[groupIndex].conditions];
    newConditions[condIndex] = { ...newConditions[condIndex], [field]: value };
    newGroups[groupIndex] = { ...newGroups[groupIndex], conditions: newConditions };
    setForm({ ...form, conditions: { ...form.conditions, groups: newGroups } });
  };

  const addCondition = (groupIndex) => {
    const newGroups = [...(form.conditions?.groups || [])];
    newGroups[groupIndex] = {
      ...newGroups[groupIndex],
      conditions: [...newGroups[groupIndex].conditions, { ...defaultCondition }]
    };
    setForm({ ...form, conditions: { ...form.conditions, groups: newGroups } });
  };

  const removeCondition = (groupIndex, condIndex) => {
    let newGroups = [...(form.conditions?.groups || [])];
    newGroups[groupIndex] = {
      ...newGroups[groupIndex],
      conditions: newGroups[groupIndex].conditions.filter((_, i) => i !== condIndex)
    };
    if (newGroups[groupIndex].conditions.length === 0) {
      newGroups = newGroups.filter((_, i) => i !== groupIndex);
    }
    if (newGroups.length === 0) {
      newGroups = [{ ...defaultGroup }];
    }
    setForm({ ...form, conditions: { ...form.conditions, groups: newGroups } });
  };

  const addGroup = () => {
    setForm({
      ...form,
      conditions: {
        ...form.conditions,
        groups: [...(form.conditions?.groups || []), { ...defaultGroup }]
      }
    });
  };

  const conditionTypes = [
    { value: 'icao', label: 'ICAO' },
    { value: 'callsign', label: 'Callsign' },
    { value: 'squawk', label: 'Squawk' },
    { value: 'altitude', label: 'Altitude' },
    { value: 'vertical_rate', label: 'Vertical Rate' },
    { value: 'proximity', label: 'Proximity (nm)' },
    { value: 'speed', label: 'Speed (kts)' },
    { value: 'military', label: 'Military' },
    { value: 'emergency', label: 'Emergency' },
    { value: 'aircraft_type', label: 'Aircraft Type' }
  ];

  const operators = [
    { value: 'eq', label: '=' },
    { value: 'neq', label: '≠' },
    { value: 'contains', label: 'contains' },
    { value: 'lt', label: '<' },
    { value: 'gt', label: '>' },
    { value: 'lte', label: '≤' },
    { value: 'gte', label: '≥' }
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-large" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{rule ? 'Edit Rule' : 'New Alert Rule'}</h3>
          <button onClick={onClose}><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-content">
          <div className="form-group">
            <label>Rule Name</label>
            <input
              type="text"
              value={form.name || ''}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="e.g., Military Aircraft Alert"
              required
            />
          </div>

          <div className="form-group">
            <label>Conditions</label>
            <div className="conditions-builder">
              <div className="condition-groups">
                {form.conditions?.groups?.map((group, gi) => (
                  <div key={gi} className="condition-group">
                    <div className="condition-group-header">
                      {gi > 0 && (
                        <select
                          className="logic-select"
                          value={form.conditions?.logic || 'AND'}
                          onChange={e => setForm({ ...form, conditions: { ...form.conditions, logic: e.target.value } })}
                        >
                          <option value="AND">AND</option>
                          <option value="OR">OR</option>
                        </select>
                      )}
                      <span className="group-label">Group {gi + 1}</span>
                      {group.conditions.length > 1 && (
                        <select
                          className="logic-select"
                          value={group.logic}
                          onChange={e => updateGroupLogic(gi, e.target.value)}
                        >
                          <option value="AND">Match ALL</option>
                          <option value="OR">Match ANY</option>
                        </select>
                      )}
                    </div>

                    <div className="condition-rows">
                      {group.conditions.map((cond, ci) => (
                        <div key={ci} className="condition-row">
                          <select
                            value={cond.type}
                            onChange={e => updateCondition(gi, ci, 'type', e.target.value)}
                          >
                            {conditionTypes.map(t => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                          <select
                            value={cond.operator}
                            onChange={e => updateCondition(gi, ci, 'operator', e.target.value)}
                          >
                            {operators.map(o => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={cond.value}
                            onChange={e => updateCondition(gi, ci, 'value', e.target.value)}
                            placeholder="Value"
                          />
                          <button
                            type="button"
                            className="remove-condition-btn"
                            onClick={() => removeCondition(gi, ci)}
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ))}
                    </div>

                    <button type="button" className="add-condition-btn" onClick={() => addCondition(gi)}>
                      <Plus size={14} /> Add Condition
                    </button>
                  </div>
                ))}
              </div>

              <button type="button" className="add-group-btn" onClick={addGroup}>
                <Plus size={14} /> Add Condition Group (OR)
              </button>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Priority</label>
              <select value={form.priority || 'info'} onChange={e => setForm({ ...form, priority: e.target.value })}>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="emergency">Emergency</option>
              </select>
            </div>
            <div className="form-group">
              <label>API URL Override</label>
              <input
                type="text"
                value={form.api_url || ''}
                onChange={e => setForm({ ...form, api_url: e.target.value })}
                placeholder="Optional: custom notification URL"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Starts At (Optional)</label>
              <input
                type="datetime-local"
                value={form.starts_at ? form.starts_at.slice(0, 16) : ''}
                onChange={e => setForm({ ...form, starts_at: e.target.value ? new Date(e.target.value).toISOString() : '' })}
              />
            </div>
            <div className="form-group">
              <label>Expires At (Optional)</label>
              <input
                type="datetime-local"
                value={form.expires_at ? form.expires_at.slice(0, 16) : ''}
                onChange={e => setForm({ ...form, expires_at: e.target.value ? new Date(e.target.value).toISOString() : '' })}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Description</label>
            <textarea
              value={form.description || ''}
              onChange={e => setForm({ ...form, description: e.target.value })}
              rows={2}
              placeholder="Optional description"
            />
          </div>

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary">Save Rule</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SystemView({ apiBase, wsRequest, wsConnected }) {
  const [status, setStatus] = useState(null);
  const [health, setHealth] = useState(null);
  const { data: notifConfig } = useApi('/api/v1/notifications/config', null, apiBase);
  const [testResult, setTestResult] = useState(null);

  // Fetch status and health via Socket.IO or fallback to HTTP
  const fetchStatusData = useCallback(async () => {
    if (wsRequest && wsConnected) {
      try {
        const [statusData, healthData] = await Promise.all([
          wsRequest('status', {}),
          wsRequest('health', {})
        ]);
        if (statusData && !statusData.error) setStatus(statusData);
        if (healthData && !healthData.error) setHealth(healthData);
      } catch (err) {
        console.log('Status WS request error:', err.message);
      }
    } else {
      // Fallback to HTTP
      try {
        const [statusRes, healthRes] = await Promise.all([
          fetch(`${apiBase}/api/v1/status`),
          fetch(`${apiBase}/api/v1/health`)
        ]);
        if (statusRes.ok) setStatus(await statusRes.json());
        if (healthRes.ok) setHealth(await healthRes.json());
      } catch (err) {
        console.log('Status HTTP fetch error:', err.message);
      }
    }
  }, [wsRequest, wsConnected, apiBase]);

  useEffect(() => {
    fetchStatusData();
    const interval = setInterval(fetchStatusData, 10000);
    return () => clearInterval(interval);
  }, [fetchStatusData]);

  const refetchStatus = () => fetchStatusData();

  const handleTestNotification = async () => {
    setTestResult('Sending...');
    try {
      const res = await fetch(`${apiBase}/api/v1/notifications/test`, { method: 'POST' });
      const data = await res.json();
      setTestResult(data.success ? 'Sent successfully!' : 'Failed to send');
    } catch {
      setTestResult('Error sending test');
    }
    setTimeout(() => setTestResult(null), 3000);
  };

  return (
    <div className="system-container">
      <div className="system-grid">
        <div className="system-card">
          <div className="card-header"><Activity size={20} /><span>Services</span></div>
          <div className="status-list">
            <div className="status-item">
              <span>ADS-B Receiver</span>
              <span className={`status-badge ${status?.adsb_online ? 'online' : 'offline'}`}>
                {status?.adsb_online ? 'Online' : 'Offline'}
              </span>
            </div>
            <div className="status-item">
              <span>Database</span>
              <span className={`status-badge ${health?.services?.database ? 'online' : 'offline'}`}>
                {health?.services?.database ? 'Connected' : 'Error'}
              </span>
            </div>
            <div className="status-item">
              <span>Socket.IO</span>
              <span className={`status-badge ${health?.services?.socketio?.status === 'up' ? 'online' : 'warning'}`}>
                {health?.services?.socketio?.status === 'up' ? health?.services?.socketio?.mode || 'Connected' : 'Offline'}
              </span>
            </div>
            <div className="status-item">
              <span>Scheduler</span>
              <span className={`status-badge ${status?.scheduler_running ? 'online' : 'offline'}`}>
                {status?.scheduler_running ? 'Running' : 'Stopped'}
              </span>
            </div>
          </div>
        </div>

        <div className="system-card">
          <div className="card-header"><Database size={20} /><span>Database Stats</span></div>
          <div className="stats-list">
            <div className="stat-row"><span>Total Sightings</span><span className="mono">{status?.total_sightings?.toLocaleString() || '--'}</span></div>
            <div className="stat-row"><span>Total Sessions</span><span className="mono">{status?.total_sessions?.toLocaleString() || '--'}</span></div>
            <div className="stat-row"><span>Active Rules</span><span className="mono">{status?.active_rules || 0}</span></div>
          </div>
        </div>

        <div className="system-card">
          <div className="card-header"><Zap size={20} /><span>Real-time</span></div>
          <div className="stats-list">
            <div className="stat-row"><span>Socket.IO Clients</span><span className="mono">{status?.socketio_connections || 0}</span></div>
            <div className="stat-row"><span>Tracked Aircraft</span><span className="mono">{status?.aircraft_count || 0}</span></div>
            <div className="stat-row"><span>Poll Interval</span><span className="mono">{status?.polling_interval_seconds || '--'}s</span></div>
            {health?.services?.socketio?.mode === 'redis' && (
              <div className="stat-row"><span>Redis Pub/Sub</span><span className="mono">Active</span></div>
            )}
          </div>
        </div>

        <div className="system-card">
          <div className="card-header"><Bell size={20} /><span>Notifications</span></div>
          <div className="stats-list">
            <div className="stat-row">
              <span>Status</span>
              <span className={`status-badge ${notifConfig?.enabled ? 'online' : 'offline'}`}>
                {notifConfig?.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div className="stat-row"><span>Servers</span><span className="mono">{notifConfig?.server_count || 0}</span></div>
            <div className="stat-row"><span>Cooldown</span><span className="mono">{notifConfig?.cooldown_seconds || 300}s</span></div>
            <div className="stat-row">
              <span>Browser</span>
              <span className={`status-badge ${typeof Notification !== 'undefined' && Notification.permission === 'granted' ? 'online' : 'warning'}`}>
                {typeof Notification !== 'undefined' ? (Notification.permission === 'granted' ? 'Enabled' : Notification.permission === 'denied' ? 'Blocked' : 'Not Set') : 'N/A'}
              </span>
            </div>
          </div>
          <button className="btn-secondary test-btn" onClick={handleTestNotification}>
            <TestTube2 size={16} /> Test Notification
          </button>
          {testResult && <div className="test-result">{testResult}</div>}
        </div>

        <div className="system-card wide">
          <div className="card-header"><MapPin size={20} /><span>Feeder Location</span></div>
          <div className="location-info">
            <div className="coord">
              <span className="coord-label">Latitude</span>
              <span className="coord-value">{status?.location?.lat?.toFixed(6) || '--'}</span>
            </div>
            <div className="coord">
              <span className="coord-label">Longitude</span>
              <span className="coord-value">{status?.location?.lon?.toFixed(6) || '--'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="system-footer">
        <span>API Version: {status?.version || '--'}</span>
        <span>Worker PID: {status?.worker_pid || '--'}</span>
        <button className="btn-icon" onClick={() => refetchStatus()}><RefreshCw size={16} /></button>
      </div>
    </div>
  );
}

// ============================================================================
// Main App
// ============================================================================

export default function App() {
  const [activeTab, setActiveTab] = useState('map');
  const [config, setConfig] = useState(getConfig);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [status, setStatus] = useState(null);

  const { aircraft, connected, stats, safetyEvents, request: wsRequest } = useWebSocket(true, config.apiBaseUrl, 'all');

  // Fetch status via Socket.IO or fallback to HTTP
  useEffect(() => {
    const fetchStatus = async () => {
      if (wsRequest && connected) {
        try {
          const data = await wsRequest('status', {});
          if (data && !data.error) setStatus(data);
        } catch (err) {
          console.log('App status WS request error:', err.message);
        }
      } else {
        try {
          const res = await fetch(`${config.apiBaseUrl}/api/v1/status`);
          if (res.ok) setStatus(await res.json());
        } catch (err) {
          console.log('App status HTTP fetch error:', err.message);
        }
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [wsRequest, connected, config.apiBaseUrl]);

  return (
    <div className={`app ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${mobileMenuOpen ? 'mobile-menu-open' : ''}`}>
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={(tab) => { setActiveTab(tab); setMobileMenuOpen(false); }} 
        connected={connected}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
      />
      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div className="mobile-menu-overlay" onClick={() => setMobileMenuOpen(false)} />
      )}
      {/* Mobile menu toggle */}
      <button 
        className="mobile-menu-toggle"
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        aria-label="Toggle menu"
      >
        {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
      </button>
      <div className="main-content">
        <Header
          stats={stats}
          location={status?.location}
          config={config}
          setConfig={setConfig}
          setShowSettings={setShowSettings}
        />
        <div className="content-area">
          {activeTab === 'map' && (
            <MapView
              aircraft={aircraft}
              config={config}
              setConfig={setConfig}
              feederLocation={status?.location}
              safetyEvents={safetyEvents}
              wsRequest={wsRequest}
              wsConnected={connected}
            />
          )}
          {activeTab === 'aircraft' && <AircraftList aircraft={aircraft} />}
          {activeTab === 'stats' && <StatsView apiBase={config.apiBaseUrl} />}
          {activeTab === 'history' && <HistoryView apiBase={config.apiBaseUrl} />}
          {activeTab === 'alerts' && <AlertsView apiBase={config.apiBaseUrl} />}
          {activeTab === 'system' && <SystemView apiBase={config.apiBaseUrl} wsRequest={wsRequest} wsConnected={connected} />}
        </div>
      </div>

      {showSettings && (
        <SettingsModal
          config={config}
          setConfig={setConfig}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
