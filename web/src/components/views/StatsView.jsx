import React, { useMemo, useState, useEffect } from 'react';
import { AlertTriangle, TrendingUp, Radio, Plane, Activity, Hash, Building2, Factory, Filter, Clock, Shield, ChevronDown, Award, BarChart3, Zap, Target, MapPin } from 'lucide-react';
import { useApi } from '../../hooks';

export function StatsView({ apiBase, onSelectAircraft }) {
  // Filter state
  const [timeRange, setTimeRange] = useState('24h');
  const [showMilitaryOnly, setShowMilitaryOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [minAltitude, setMinAltitude] = useState('');
  const [maxAltitude, setMaxAltitude] = useState('');
  const [minDistance, setMinDistance] = useState('');
  const [maxDistance, setMaxDistance] = useState('');
  const [aircraftType, setAircraftType] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [activeAnalyticsTab, setActiveAnalyticsTab] = useState('trends');
  const [topPerformersTab, setTopPerformersTab] = useState('longest');

  // Convert time range to hours
  const hours = { '1h': 1, '6h': 6, '24h': 24, '48h': 48, '7d': 168 };
  const selectedHours = hours[timeRange] || 24;

  // Build filter query params
  const buildFilterParams = () => {
    const params = new URLSearchParams();
    params.append('hours', selectedHours);
    if (showMilitaryOnly) params.append('military_only', 'true');
    if (categoryFilter) params.append('category', categoryFilter);
    if (minAltitude) params.append('min_altitude', minAltitude);
    if (maxAltitude) params.append('max_altitude', maxAltitude);
    if (minDistance) params.append('min_distance', minDistance);
    if (maxDistance) params.append('max_distance', maxDistance);
    if (aircraftType) params.append('aircraft_type', aircraftType);
    return params.toString();
  };

  const filterParams = buildFilterParams();

  // Core stats with filters
  const { data: stats } = useApi(`/api/v1/aircraft/stats?${filterParams}`, 5000, apiBase);
  const { data: top } = useApi('/api/v1/aircraft/top', 5000, apiBase);
  const { data: histStats } = useApi(`/api/v1/history/stats?${filterParams}`, 60000, apiBase);
  const { data: acarsStats } = useApi(`/api/v1/acars/stats?hours=${selectedHours}`, 30000, apiBase);
  const { data: safetyStats } = useApi(`/api/v1/safety/stats?hours=${selectedHours}`, 30000, apiBase);
  const { data: aircraftData } = useApi('/api/v1/aircraft', 5000, apiBase);
  const { data: sessionsData } = useApi(`/api/v1/history/sessions?hours=${selectedHours}&limit=500${showMilitaryOnly ? '&military_only=true' : ''}`, 60000, apiBase);

  // New analytics endpoints
  const { data: trendsData } = useApi(`/api/v1/history/trends?${filterParams}&interval=hour`, 60000, apiBase);
  const { data: topPerformersData } = useApi(`/api/v1/history/top?${filterParams}&limit=10`, 60000, apiBase);
  const { data: distanceAnalytics } = useApi(`/api/v1/history/analytics/distance?${filterParams}`, 60000, apiBase);
  const { data: speedAnalytics } = useApi(`/api/v1/history/analytics/speed?${filterParams}`, 60000, apiBase);
  const { data: correlationData } = useApi(`/api/v1/history/analytics/correlation?${filterParams}`, 60000, apiBase);

  // Throughput history for graphs
  const [throughputHistory, setThroughputHistory] = useState([]);
  const [aircraftHistory, setAircraftHistory] = useState([]);
  const [lastMessageCount, setLastMessageCount] = useState(null);
  const [messageRate, setMessageRate] = useState(0);

  // Track throughput over time and calculate message rate
  useEffect(() => {
    if (!stats) return;

    const now = Date.now();
    const currentMessages = stats.messages || 0;

    // Calculate message rate (messages per second)
    let rate = 0;
    if (lastMessageCount !== null && throughputHistory.length > 0) {
      const lastPoint = throughputHistory[throughputHistory.length - 1];
      const timeDiff = (now - lastPoint.time) / 1000; // seconds
      if (timeDiff > 0) {
        rate = (currentMessages - lastMessageCount) / timeDiff;
        if (rate < 0) rate = 0; // Handle counter reset
      }
    }
    setLastMessageCount(currentMessages);
    setMessageRate(rate);

    const newPoint = {
      time: now,
      messages: rate,
      aircraft: stats.total || 0,
      withPosition: stats.with_position || 0
    };

    setThroughputHistory(prev => {
      const updated = [...prev, newPoint];
      // Keep last 60 data points (5 minutes at 5s intervals)
      return updated.slice(-60);
    });

    setAircraftHistory(prev => {
      const updated = [...prev, { time: now, count: stats.total || 0 }];
      return updated.slice(-60);
    });
  }, [stats]);

  const emergencyAircraft = stats?.emergency_squawks || [];

  // Squawk code analysis
  const squawkData = useMemo(() => {
    // Handle both array and { aircraft: [...] } response formats
    const aircraft = Array.isArray(aircraftData) ? aircraftData : aircraftData?.aircraft;
    if (!aircraft || !Array.isArray(aircraft)) return { categories: [], heatmap: [], total: 0 };

    const squawks = aircraft
      .filter(ac => ac.squawk && ac.squawk !== '0000')
      .map(ac => ac.squawk);

    // Categorize squawks
    const categories = {
      vfr: 0,        // 1200 (US VFR)
      emergency: 0,  // 7500, 7600, 7700
      special: 0,    // 7000-7777 range special codes
      discrete: 0    // Assigned IFR codes
    };

    // Heatmap: count occurrences of each unique squawk
    const squawkCounts = {};

    squawks.forEach(sq => {
      const code = parseInt(sq, 10);
      squawkCounts[sq] = (squawkCounts[sq] || 0) + 1;

      if (sq === '1200' || sq === '7000') {
        categories.vfr++;
      } else if (sq === '7500' || sq === '7600' || sq === '7700') {
        categories.emergency++;
      } else if (code >= 7000 && code <= 7777) {
        categories.special++;
      } else {
        categories.discrete++;
      }
    });

    // Build heatmap data - top squawk codes sorted by frequency
    const heatmapData = Object.entries(squawkCounts)
      .map(([code, count]) => ({
        code,
        count,
        isEmergency: ['7500', '7600', '7700'].includes(code),
        isVfr: code === '1200' || code === '7000',
        isSpecial: parseInt(code, 10) >= 7000 && parseInt(code, 10) <= 7777
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    const total = squawks.length;
    const categoryData = [
      { label: 'VFR', value: categories.vfr, pct: total > 0 ? (categories.vfr / total) * 100 : 0, color: '#00c8ff' },
      { label: 'Discrete', value: categories.discrete, pct: total > 0 ? (categories.discrete / total) * 100 : 0, color: '#00ff88' },
      { label: 'Special', value: categories.special, pct: total > 0 ? (categories.special / total) * 100 : 0, color: '#f7d794' },
      { label: 'Emergency', value: categories.emergency, pct: total > 0 ? (categories.emergency / total) * 100 : 0, color: '#ff4757' }
    ];

    return { categories: categoryData, heatmap: heatmapData, total };
  }, [aircraftData]);

  const altitudeData = useMemo(() => {
    // API returns 'altitude' not 'altitude_distribution'
    const dist = stats?.altitude || stats?.altitude_distribution;
    if (!dist) return [];
    const total = Object.values(dist).reduce((a, b) => a + (b || 0), 0) || 1;
    return [
      { label: 'Ground', value: dist.ground || 0, pct: ((dist.ground || 0) / total) * 100 },
      { label: '< 10k ft', value: dist.low || 0, pct: ((dist.low || 0) / total) * 100 },
      { label: '10-30k ft', value: dist.medium || 0, pct: ((dist.medium || 0) / total) * 100 },
      { label: '> 30k ft', value: dist.high || 0, pct: ((dist.high || 0) / total) * 100 }
    ];
  }, [stats]);

  // Calculate most seen aircraft from session data
  const mostSeenAircraft = useMemo(() => {
    const sessions = sessionsData?.sessions;
    if (!sessions || !Array.isArray(sessions)) return [];

    // Group sessions by ICAO hex and aggregate stats
    const aircraftMap = {};
    sessions.forEach(session => {
      const hex = session.icao_hex;
      if (!hex) return;

      if (!aircraftMap[hex]) {
        aircraftMap[hex] = {
          hex,
          callsign: session.callsign,
          type: session.type,
          registration: session.registration,
          sessionCount: 0,
          totalMessages: 0,
          totalDuration: 0,
          isMilitary: session.is_military
        };
      }

      aircraftMap[hex].sessionCount++;
      aircraftMap[hex].totalMessages += session.message_count || 0;
      aircraftMap[hex].totalDuration += session.duration_min || 0;
      // Update callsign/type if we have a newer one
      if (session.callsign) aircraftMap[hex].callsign = session.callsign;
      if (session.type) aircraftMap[hex].type = session.type;
    });

    // Sort by session count (most sightings) then by total messages
    return Object.values(aircraftMap)
      .sort((a, b) => {
        if (b.sessionCount !== a.sessionCount) return b.sessionCount - a.sessionCount;
        return b.totalMessages - a.totalMessages;
      })
      .slice(0, 5);
  }, [sessionsData]);

  // Fleet breakdown analysis from session data
  const fleetBreakdown = useMemo(() => {
    let sessions = sessionsData?.sessions;
    if (!sessions || !Array.isArray(sessions)) return null;

    // Apply military filter
    if (showMilitaryOnly) {
      sessions = sessions.filter(s => s.is_military);
    }

    // Track unique aircraft by hex to avoid counting duplicates
    const seenHex = new Set();
    const typeCount = {};
    const manufacturerCount = {};
    const categoryCount = {};
    const countryCount = {};

    // ICAO hex address ranges to country mapping (Mode S address allocations)
    // These are the ICAO allocated address blocks for each country
    const getCountryFromIcaoHex = (hex) => {
      if (!hex) return null;
      const addr = parseInt(hex.replace('~', ''), 16);

      // Major allocations (sorted by range start)
      if (addr >= 0xA00000 && addr <= 0xAFFFFF) return { code: 'US', name: 'United States', flag: '🇺🇸' };
      if (addr >= 0xC00000 && addr <= 0xC3FFFF) return { code: 'CA', name: 'Canada', flag: '🇨🇦' };
      if (addr >= 0x400000 && addr <= 0x43FFFF) return { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' };
      if (addr >= 0x380000 && addr <= 0x3BFFFF) return { code: 'FR', name: 'France', flag: '🇫🇷' };
      if (addr >= 0x3C0000 && addr <= 0x3FFFFF) return { code: 'DE', name: 'Germany', flag: '🇩🇪' };
      if (addr >= 0x300000 && addr <= 0x33FFFF) return { code: 'IT', name: 'Italy', flag: '🇮🇹' };
      if (addr >= 0x340000 && addr <= 0x37FFFF) return { code: 'ES', name: 'Spain', flag: '🇪🇸' };
      if (addr >= 0x480000 && addr <= 0x487FFF) return { code: 'NL', name: 'Netherlands', flag: '🇳🇱' };
      if (addr >= 0x448000 && addr <= 0x44FFFF) return { code: 'BE', name: 'Belgium', flag: '🇧🇪' };
      if (addr >= 0x4B0000 && addr <= 0x4B7FFF) return { code: 'CH', name: 'Switzerland', flag: '🇨🇭' };
      if (addr >= 0x440000 && addr <= 0x447FFF) return { code: 'AT', name: 'Austria', flag: '🇦🇹' };
      if (addr >= 0x4A0000 && addr <= 0x4A7FFF) return { code: 'SE', name: 'Sweden', flag: '🇸🇪' };
      if (addr >= 0x478000 && addr <= 0x47FFFF) return { code: 'NO', name: 'Norway', flag: '🇳🇴' };
      if (addr >= 0x460000 && addr <= 0x467FFF) return { code: 'FI', name: 'Finland', flag: '🇫🇮' };
      if (addr >= 0x458000 && addr <= 0x45FFFF) return { code: 'DK', name: 'Denmark', flag: '🇩🇰' };
      if (addr >= 0x4C0000 && addr <= 0x4C7FFF) return { code: 'IE', name: 'Ireland', flag: '🇮🇪' };
      if (addr >= 0x490000 && addr <= 0x497FFF) return { code: 'PT', name: 'Portugal', flag: '🇵🇹' };
      if (addr >= 0x468000 && addr <= 0x46FFFF) return { code: 'GR', name: 'Greece', flag: '🇬🇷' };
      if (addr >= 0x4B8000 && addr <= 0x4BFFFF) return { code: 'TR', name: 'Turkey', flag: '🇹🇷' };
      if (addr >= 0x488000 && addr <= 0x48FFFF) return { code: 'PL', name: 'Poland', flag: '🇵🇱' };
      if (addr >= 0x498000 && addr <= 0x49FFFF) return { code: 'CZ', name: 'Czechia', flag: '🇨🇿' };
      if (addr >= 0x470000 && addr <= 0x477FFF) return { code: 'HU', name: 'Hungary', flag: '🇭🇺' };
      if (addr >= 0x100000 && addr <= 0x1FFFFF) return { code: 'RU', name: 'Russia', flag: '🇷🇺' };
      if (addr >= 0x508000 && addr <= 0x50FFFF) return { code: 'UA', name: 'Ukraine', flag: '🇺🇦' };
      if (addr >= 0x840000 && addr <= 0x87FFFF) return { code: 'JP', name: 'Japan', flag: '🇯🇵' };
      if (addr >= 0x718000 && addr <= 0x71FFFF) return { code: 'KR', name: 'South Korea', flag: '🇰🇷' };
      if (addr >= 0x780000 && addr <= 0x7BFFFF) return { code: 'CN', name: 'China', flag: '🇨🇳' };
      if (addr >= 0x7C0000 && addr <= 0x7FFFFF) return { code: 'AU', name: 'Australia', flag: '🇦🇺' };
      if (addr >= 0xC80000 && addr <= 0xC87FFF) return { code: 'NZ', name: 'New Zealand', flag: '🇳🇿' };
      if (addr >= 0x800000 && addr <= 0x83FFFF) return { code: 'IN', name: 'India', flag: '🇮🇳' };
      if (addr >= 0x880000 && addr <= 0x887FFF) return { code: 'TH', name: 'Thailand', flag: '🇹🇭' };
      if (addr >= 0x768000 && addr <= 0x76FFFF) return { code: 'SG', name: 'Singapore', flag: '🇸🇬' };
      if (addr >= 0x750000 && addr <= 0x757FFF) return { code: 'MY', name: 'Malaysia', flag: '🇲🇾' };
      if (addr >= 0x8A0000 && addr <= 0x8A7FFF) return { code: 'ID', name: 'Indonesia', flag: '🇮🇩' };
      if (addr >= 0x758000 && addr <= 0x75FFFF) return { code: 'PH', name: 'Philippines', flag: '🇵🇭' };
      if (addr >= 0x896000 && addr <= 0x896FFF) return { code: 'AE', name: 'UAE', flag: '🇦🇪' };
      if (addr >= 0x06A000 && addr <= 0x06AFFF) return { code: 'QA', name: 'Qatar', flag: '🇶🇦' };
      if (addr >= 0x710000 && addr <= 0x717FFF) return { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦' };
      if (addr >= 0x738000 && addr <= 0x73FFFF) return { code: 'IL', name: 'Israel', flag: '🇮🇱' };
      if (addr >= 0x010000 && addr <= 0x017FFF) return { code: 'EG', name: 'Egypt', flag: '🇪🇬' };
      if (addr >= 0x008000 && addr <= 0x00FFFF) return { code: 'ZA', name: 'South Africa', flag: '🇿🇦' };
      if (addr >= 0xE40000 && addr <= 0xE7FFFF) return { code: 'BR', name: 'Brazil', flag: '🇧🇷' };
      if (addr >= 0xE00000 && addr <= 0xE3FFFF) return { code: 'AR', name: 'Argentina', flag: '🇦🇷' };
      if (addr >= 0xE80000 && addr <= 0xE80FFF) return { code: 'CL', name: 'Chile', flag: '🇨🇱' };
      if (addr >= 0x0D0000 && addr <= 0x0D7FFF) return { code: 'MX', name: 'Mexico', flag: '🇲🇽' };

      return null;
    };

    // Registration prefix to country mapping
    const regPrefixToCountry = {
      'N': { code: 'US', name: 'United States', flag: '🇺🇸' },
      'C-': { code: 'CA', name: 'Canada', flag: '🇨🇦' },
      'G-': { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
      'F-': { code: 'FR', name: 'France', flag: '🇫🇷' },
      'D-': { code: 'DE', name: 'Germany', flag: '🇩🇪' },
      'I-': { code: 'IT', name: 'Italy', flag: '🇮🇹' },
      'EC-': { code: 'ES', name: 'Spain', flag: '🇪🇸' },
      'PH-': { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
      'OO-': { code: 'BE', name: 'Belgium', flag: '🇧🇪' },
      'HB-': { code: 'CH', name: 'Switzerland', flag: '🇨🇭' },
      'OE-': { code: 'AT', name: 'Austria', flag: '🇦🇹' },
      'SE-': { code: 'SE', name: 'Sweden', flag: '🇸🇪' },
      'LN-': { code: 'NO', name: 'Norway', flag: '🇳🇴' },
      'OH-': { code: 'FI', name: 'Finland', flag: '🇫🇮' },
      'OY-': { code: 'DK', name: 'Denmark', flag: '🇩🇰' },
      'EI-': { code: 'IE', name: 'Ireland', flag: '🇮🇪' },
      'CS-': { code: 'PT', name: 'Portugal', flag: '🇵🇹' },
      'SX-': { code: 'GR', name: 'Greece', flag: '🇬🇷' },
      'TC-': { code: 'TR', name: 'Turkey', flag: '🇹🇷' },
      'SP-': { code: 'PL', name: 'Poland', flag: '🇵🇱' },
      'OK-': { code: 'CZ', name: 'Czechia', flag: '🇨🇿' },
      'HA-': { code: 'HU', name: 'Hungary', flag: '🇭🇺' },
      'RA-': { code: 'RU', name: 'Russia', flag: '🇷🇺' },
      'UR-': { code: 'UA', name: 'Ukraine', flag: '🇺🇦' },
      'JA': { code: 'JP', name: 'Japan', flag: '🇯🇵' },
      'HL': { code: 'KR', name: 'South Korea', flag: '🇰🇷' },
      'B-': { code: 'CN', name: 'China', flag: '🇨🇳' },
      'VH-': { code: 'AU', name: 'Australia', flag: '🇦🇺' },
      'ZK-': { code: 'NZ', name: 'New Zealand', flag: '🇳🇿' },
      'VT-': { code: 'IN', name: 'India', flag: '🇮🇳' },
      'HS-': { code: 'TH', name: 'Thailand', flag: '🇹🇭' },
      '9V-': { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
      '9M-': { code: 'MY', name: 'Malaysia', flag: '🇲🇾' },
      'PK-': { code: 'ID', name: 'Indonesia', flag: '🇮🇩' },
      'RP-': { code: 'PH', name: 'Philippines', flag: '🇵🇭' },
      'A6-': { code: 'AE', name: 'UAE', flag: '🇦🇪' },
      'A7-': { code: 'QA', name: 'Qatar', flag: '🇶🇦' },
      'A9C-': { code: 'BH', name: 'Bahrain', flag: '🇧🇭' },
      'HZ-': { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦' },
      '4X-': { code: 'IL', name: 'Israel', flag: '🇮🇱' },
      'SU-': { code: 'EG', name: 'Egypt', flag: '🇪🇬' },
      'ZS-': { code: 'ZA', name: 'South Africa', flag: '🇿🇦' },
      'PT-': { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
      'PP-': { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
      'PR-': { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
      'LV-': { code: 'AR', name: 'Argentina', flag: '🇦🇷' },
      'CC-': { code: 'CL', name: 'Chile', flag: '🇨🇱' },
      'XA-': { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
      'XB-': { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
      'XC-': { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
      'VP-B': { code: 'BM', name: 'Bermuda', flag: '🇧🇲' },
      'VP-C': { code: 'KY', name: 'Cayman Islands', flag: '🇰🇾' },
      'VQ-B': { code: 'BM', name: 'Bermuda', flag: '🇧🇲' },
      'P4-': { code: 'AW', name: 'Aruba', flag: '🇦🇼' },
      '9H-': { code: 'MT', name: 'Malta', flag: '🇲🇹' },
      'M-': { code: 'IM', name: 'Isle of Man', flag: '🇮🇲' },
      '2-': { code: 'GG', name: 'Guernsey', flag: '🇬🇬' },
      'OB-': { code: 'PE', name: 'Peru', flag: '🇵🇪' },
      'HC-': { code: 'EC', name: 'Ecuador', flag: '🇪🇨' },
      'HK-': { code: 'CO', name: 'Colombia', flag: '🇨🇴' },
      'YV': { code: 'VE', name: 'Venezuela', flag: '🇻🇪' }
    };

    // Function to get country from registration
    const getCountryFromReg = (reg) => {
      if (!reg) return null;
      const upperReg = reg.toUpperCase();

      // Check longer prefixes first (3-char, then 2-char, then 1-char)
      for (const prefix of Object.keys(regPrefixToCountry).sort((a, b) => b.length - a.length)) {
        if (upperReg.startsWith(prefix)) {
          return regPrefixToCountry[prefix];
        }
      }
      return null;
    };

    // Country code to country info mapping (for API-provided country codes)
    const countryCodeToInfo = {
      'United States': { code: 'US', name: 'United States', flag: '🇺🇸' },
      'Canada': { code: 'CA', name: 'Canada', flag: '🇨🇦' },
      'United Kingdom': { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
      'France': { code: 'FR', name: 'France', flag: '🇫🇷' },
      'Germany': { code: 'DE', name: 'Germany', flag: '🇩🇪' },
      'Italy': { code: 'IT', name: 'Italy', flag: '🇮🇹' },
      'Spain': { code: 'ES', name: 'Spain', flag: '🇪🇸' },
      'Netherlands': { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
      'Belgium': { code: 'BE', name: 'Belgium', flag: '🇧🇪' },
      'Switzerland': { code: 'CH', name: 'Switzerland', flag: '🇨🇭' },
      'Austria': { code: 'AT', name: 'Austria', flag: '🇦🇹' },
      'Sweden': { code: 'SE', name: 'Sweden', flag: '🇸🇪' },
      'Norway': { code: 'NO', name: 'Norway', flag: '🇳🇴' },
      'Finland': { code: 'FI', name: 'Finland', flag: '🇫🇮' },
      'Denmark': { code: 'DK', name: 'Denmark', flag: '🇩🇰' },
      'Ireland': { code: 'IE', name: 'Ireland', flag: '🇮🇪' },
      'Portugal': { code: 'PT', name: 'Portugal', flag: '🇵🇹' },
      'Greece': { code: 'GR', name: 'Greece', flag: '🇬🇷' },
      'Turkey': { code: 'TR', name: 'Turkey', flag: '🇹🇷' },
      'Poland': { code: 'PL', name: 'Poland', flag: '🇵🇱' },
      'Czechia': { code: 'CZ', name: 'Czechia', flag: '🇨🇿' },
      'Czech Republic': { code: 'CZ', name: 'Czechia', flag: '🇨🇿' },
      'Hungary': { code: 'HU', name: 'Hungary', flag: '🇭🇺' },
      'Russia': { code: 'RU', name: 'Russia', flag: '🇷🇺' },
      'Ukraine': { code: 'UA', name: 'Ukraine', flag: '🇺🇦' },
      'Japan': { code: 'JP', name: 'Japan', flag: '🇯🇵' },
      'South Korea': { code: 'KR', name: 'South Korea', flag: '🇰🇷' },
      'China': { code: 'CN', name: 'China', flag: '🇨🇳' },
      'China/Taiwan': { code: 'CN', name: 'China/Taiwan', flag: '🇨🇳' },
      'Taiwan': { code: 'TW', name: 'Taiwan', flag: '🇹🇼' },
      'Australia': { code: 'AU', name: 'Australia', flag: '🇦🇺' },
      'New Zealand': { code: 'NZ', name: 'New Zealand', flag: '🇳🇿' },
      'India': { code: 'IN', name: 'India', flag: '🇮🇳' },
      'Thailand': { code: 'TH', name: 'Thailand', flag: '🇹🇭' },
      'Singapore': { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
      'Malaysia': { code: 'MY', name: 'Malaysia', flag: '🇲🇾' },
      'Indonesia': { code: 'ID', name: 'Indonesia', flag: '🇮🇩' },
      'Philippines': { code: 'PH', name: 'Philippines', flag: '🇵🇭' },
      'UAE': { code: 'AE', name: 'UAE', flag: '🇦🇪' },
      'United Arab Emirates': { code: 'AE', name: 'UAE', flag: '🇦🇪' },
      'Qatar': { code: 'QA', name: 'Qatar', flag: '🇶🇦' },
      'Saudi Arabia': { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦' },
      'Israel': { code: 'IL', name: 'Israel', flag: '🇮🇱' },
      'Egypt': { code: 'EG', name: 'Egypt', flag: '🇪🇬' },
      'South Africa': { code: 'ZA', name: 'South Africa', flag: '🇿🇦' },
      'Brazil': { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
      'Argentina': { code: 'AR', name: 'Argentina', flag: '🇦🇷' },
      'Chile': { code: 'CL', name: 'Chile', flag: '🇨🇱' },
      'Mexico': { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
      'Bermuda': { code: 'BM', name: 'Bermuda', flag: '🇧🇲' },
      'Cayman Islands': { code: 'KY', name: 'Cayman Islands', flag: '🇰🇾' },
      'Malta': { code: 'MT', name: 'Malta', flag: '🇲🇹' },
      'Isle of Man': { code: 'IM', name: 'Isle of Man', flag: '🇮🇲' },
      'Guernsey': { code: 'GG', name: 'Guernsey', flag: '🇬🇬' },
      'Peru': { code: 'PE', name: 'Peru', flag: '🇵🇪' },
      'Ecuador': { code: 'EC', name: 'Ecuador', flag: '🇪🇨' },
      'Colombia': { code: 'CO', name: 'Colombia', flag: '🇨🇴' },
      'Venezuela': { code: 'VE', name: 'Venezuela', flag: '🇻🇪' }
    };

    // Function to get country info from country name (from API)
    const getCountryFromCode = (countryName) => {
      if (!countryName) return null;
      return countryCodeToInfo[countryName] || { code: countryName.slice(0, 2).toUpperCase(), name: countryName, flag: '🏳️' };
    };

    // Aircraft type to manufacturer mapping
    const typeToManufacturer = {
      // Boeing
      'B737': 'Boeing', 'B738': 'Boeing', 'B739': 'Boeing', 'B77W': 'Boeing', 'B772': 'Boeing', 'B773': 'Boeing',
      'B744': 'Boeing', 'B748': 'Boeing', 'B752': 'Boeing', 'B753': 'Boeing', 'B763': 'Boeing', 'B764': 'Boeing',
      'B77L': 'Boeing', 'B788': 'Boeing', 'B789': 'Boeing', 'B78X': 'Boeing', 'B712': 'Boeing', 'B703': 'Boeing',
      'B190': 'Beechcraft', 'B350': 'Beechcraft', 'BE40': 'Beechcraft', 'BE20': 'Beechcraft', 'BE9L': 'Beechcraft',
      // Airbus
      'A319': 'Airbus', 'A320': 'Airbus', 'A321': 'Airbus', 'A318': 'Airbus', 'A20N': 'Airbus', 'A21N': 'Airbus',
      'A332': 'Airbus', 'A333': 'Airbus', 'A339': 'Airbus', 'A342': 'Airbus', 'A343': 'Airbus', 'A346': 'Airbus',
      'A359': 'Airbus', 'A35K': 'Airbus', 'A380': 'Airbus', 'A388': 'Airbus', 'A310': 'Airbus', 'A306': 'Airbus',
      // Embraer
      'E170': 'Embraer', 'E175': 'Embraer', 'E190': 'Embraer', 'E195': 'Embraer', 'E75L': 'Embraer', 'E75S': 'Embraer',
      'E290': 'Embraer', 'E295': 'Embraer', 'E135': 'Embraer', 'E145': 'Embraer', 'E45X': 'Embraer', 'E35L': 'Embraer',
      'E55P': 'Embraer', 'E50P': 'Embraer', 'E545': 'Embraer', 'E550': 'Embraer',
      // Bombardier
      'CRJ2': 'Bombardier', 'CRJ7': 'Bombardier', 'CRJ9': 'Bombardier', 'CRJX': 'Bombardier', 'CL60': 'Bombardier',
      'CL30': 'Bombardier', 'CL35': 'Bombardier', 'GL5T': 'Bombardier', 'GL7T': 'Bombardier', 'GLEX': 'Bombardier',
      'DH8A': 'De Havilland', 'DH8B': 'De Havilland', 'DH8C': 'De Havilland', 'DH8D': 'De Havilland',
      // Cessna
      'C172': 'Cessna', 'C182': 'Cessna', 'C208': 'Cessna', 'C210': 'Cessna', 'C25A': 'Cessna', 'C25B': 'Cessna',
      'C25C': 'Cessna', 'C25M': 'Cessna', 'C510': 'Cessna', 'C525': 'Cessna', 'C550': 'Cessna', 'C560': 'Cessna',
      'C56X': 'Cessna', 'C680': 'Cessna', 'C68A': 'Cessna', 'C700': 'Cessna', 'C750': 'Cessna',
      // Piper
      'P28A': 'Piper', 'P28B': 'Piper', 'PA24': 'Piper', 'PA27': 'Piper', 'PA28': 'Piper', 'PA31': 'Piper',
      'PA32': 'Piper', 'PA34': 'Piper', 'PA44': 'Piper', 'PA46': 'Piper', 'PAY1': 'Piper', 'PAY2': 'Piper',
      // Gulfstream
      'G280': 'Gulfstream', 'G150': 'Gulfstream', 'G200': 'Gulfstream', 'G450': 'Gulfstream', 'G550': 'Gulfstream',
      'G650': 'Gulfstream', 'GLF4': 'Gulfstream', 'GLF5': 'Gulfstream', 'GLF6': 'Gulfstream', 'GALX': 'Gulfstream',
      // Dassault
      'F2TH': 'Dassault', 'F900': 'Dassault', 'FA50': 'Dassault', 'FA7X': 'Dassault', 'FA8X': 'Dassault',
      'F9EX': 'Dassault', 'F10X': 'Dassault',
      // ATR
      'AT43': 'ATR', 'AT45': 'ATR', 'AT72': 'ATR', 'AT75': 'ATR', 'AT76': 'ATR',
      // Helicopters
      'EC35': 'Airbus Helicopters', 'EC45': 'Airbus Helicopters', 'EC55': 'Airbus Helicopters', 'EC75': 'Airbus Helicopters',
      'AS50': 'Airbus Helicopters', 'AS55': 'Airbus Helicopters', 'AS65': 'Airbus Helicopters', 'H160': 'Airbus Helicopters',
      'R22': 'Robinson', 'R44': 'Robinson', 'R66': 'Robinson',
      'B06': 'Bell', 'B206': 'Bell', 'B407': 'Bell', 'B412': 'Bell', 'B429': 'Bell', 'B505': 'Bell',
      'S76': 'Sikorsky', 'S92': 'Sikorsky', 'S70': 'Sikorsky',
      // Military
      'F16': 'Lockheed Martin', 'F35': 'Lockheed Martin', 'C130': 'Lockheed Martin', 'C5': 'Lockheed Martin',
      'F15': 'Boeing', 'F18': 'Boeing', 'C17': 'Boeing', 'KC46': 'Boeing', 'KC135': 'Boeing',
      'F22': 'Lockheed Martin', 'B1': 'Rockwell', 'B2': 'Northrop Grumman', 'B52': 'Boeing',
      'E3': 'Boeing', 'E8': 'Northrop Grumman', 'P8': 'Boeing', 'V22': 'Bell/Boeing',
      // Other
      'PC12': 'Pilatus', 'PC24': 'Pilatus', 'LJ35': 'Learjet', 'LJ45': 'Learjet', 'LJ60': 'Learjet', 'LJ75': 'Learjet',
      'C17': 'Boeing', 'MD11': 'McDonnell Douglas', 'MD80': 'McDonnell Douglas', 'MD82': 'McDonnell Douglas',
      'MD83': 'McDonnell Douglas', 'MD87': 'McDonnell Douglas', 'MD88': 'McDonnell Douglas', 'MD90': 'McDonnell Douglas',
      'SF34': 'Saab', 'SB20': 'Saab', 'S340': 'Saab'
    };

    // Aircraft type categories
    const typeToCategory = {
      // Narrowbody airliners
      'B737': 'Airliner', 'B738': 'Airliner', 'B739': 'Airliner', 'B752': 'Airliner', 'B753': 'Airliner',
      'A319': 'Airliner', 'A320': 'Airliner', 'A321': 'Airliner', 'A318': 'Airliner', 'A20N': 'Airliner', 'A21N': 'Airliner',
      'E170': 'Regional', 'E175': 'Regional', 'E190': 'Regional', 'E195': 'Regional', 'E75L': 'Regional', 'E75S': 'Regional',
      'CRJ2': 'Regional', 'CRJ7': 'Regional', 'CRJ9': 'Regional', 'CRJX': 'Regional',
      // Widebody
      'B77W': 'Widebody', 'B772': 'Widebody', 'B773': 'Widebody', 'B744': 'Widebody', 'B748': 'Widebody',
      'B763': 'Widebody', 'B764': 'Widebody', 'B77L': 'Widebody', 'B788': 'Widebody', 'B789': 'Widebody', 'B78X': 'Widebody',
      'A332': 'Widebody', 'A333': 'Widebody', 'A339': 'Widebody', 'A342': 'Widebody', 'A343': 'Widebody', 'A346': 'Widebody',
      'A359': 'Widebody', 'A35K': 'Widebody', 'A380': 'Widebody', 'A388': 'Widebody',
      // Turboprops
      'DH8A': 'Turboprop', 'DH8B': 'Turboprop', 'DH8C': 'Turboprop', 'DH8D': 'Turboprop',
      'AT43': 'Turboprop', 'AT45': 'Turboprop', 'AT72': 'Turboprop', 'AT75': 'Turboprop', 'AT76': 'Turboprop',
      'C208': 'Turboprop', 'PC12': 'Turboprop', 'B350': 'Turboprop', 'B190': 'Turboprop',
      'SF34': 'Turboprop', 'SB20': 'Turboprop', 'S340': 'Turboprop',
      // Business Jets
      'C25A': 'Business Jet', 'C25B': 'Business Jet', 'C25C': 'Business Jet', 'C25M': 'Business Jet',
      'C510': 'Business Jet', 'C525': 'Business Jet', 'C550': 'Business Jet', 'C560': 'Business Jet',
      'C56X': 'Business Jet', 'C680': 'Business Jet', 'C68A': 'Business Jet', 'C700': 'Business Jet', 'C750': 'Business Jet',
      'G280': 'Business Jet', 'G150': 'Business Jet', 'G200': 'Business Jet', 'G450': 'Business Jet', 'G550': 'Business Jet',
      'G650': 'Business Jet', 'GLF4': 'Business Jet', 'GLF5': 'Business Jet', 'GLF6': 'Business Jet', 'GALX': 'Business Jet',
      'CL60': 'Business Jet', 'CL30': 'Business Jet', 'CL35': 'Business Jet', 'GL5T': 'Business Jet', 'GL7T': 'Business Jet', 'GLEX': 'Business Jet',
      'F2TH': 'Business Jet', 'F900': 'Business Jet', 'FA50': 'Business Jet', 'FA7X': 'Business Jet', 'FA8X': 'Business Jet',
      'LJ35': 'Business Jet', 'LJ45': 'Business Jet', 'LJ60': 'Business Jet', 'LJ75': 'Business Jet',
      'E35L': 'Business Jet', 'E55P': 'Business Jet', 'E50P': 'Business Jet', 'E545': 'Business Jet', 'E550': 'Business Jet',
      'PC24': 'Business Jet',
      // GA Piston
      'C172': 'GA Piston', 'C182': 'GA Piston', 'C210': 'GA Piston',
      'P28A': 'GA Piston', 'P28B': 'GA Piston', 'PA24': 'GA Piston', 'PA28': 'GA Piston', 'PA32': 'GA Piston', 'PA34': 'GA Piston', 'PA44': 'GA Piston',
      // Helicopters
      'EC35': 'Helicopter', 'EC45': 'Helicopter', 'EC55': 'Helicopter', 'EC75': 'Helicopter',
      'AS50': 'Helicopter', 'AS55': 'Helicopter', 'AS65': 'Helicopter', 'H160': 'Helicopter',
      'R22': 'Helicopter', 'R44': 'Helicopter', 'R66': 'Helicopter',
      'B06': 'Helicopter', 'B206': 'Helicopter', 'B407': 'Helicopter', 'B412': 'Helicopter', 'B429': 'Helicopter', 'B505': 'Helicopter',
      'S76': 'Helicopter', 'S92': 'Helicopter', 'S70': 'Helicopter',
      // Military
      'F16': 'Military', 'F35': 'Military', 'F15': 'Military', 'F18': 'Military', 'F22': 'Military',
      'C130': 'Military', 'C5': 'Military', 'C17': 'Military', 'KC46': 'Military', 'KC135': 'Military',
      'B1': 'Military', 'B2': 'Military', 'B52': 'Military', 'E3': 'Military', 'E8': 'Military', 'P8': 'Military', 'V22': 'Military'
    };

    sessions.forEach(session => {
      const hex = session.icao_hex;
      if (!hex || seenHex.has(hex)) return;
      seenHex.add(hex);

      const type = session.type?.toUpperCase();
      if (type) {
        typeCount[type] = (typeCount[type] || 0) + 1;

        // Get manufacturer
        const manufacturer = typeToManufacturer[type];
        if (manufacturer) {
          manufacturerCount[manufacturer] = (manufacturerCount[manufacturer] || 0) + 1;
        } else {
          manufacturerCount['Other'] = (manufacturerCount['Other'] || 0) + 1;
        }

        // Get category
        const category = typeToCategory[type];
        if (category) {
          categoryCount[category] = (categoryCount[category] || 0) + 1;
        } else if (session.is_military) {
          categoryCount['Military'] = (categoryCount['Military'] || 0) + 1;
        } else {
          categoryCount['Other'] = (categoryCount['Other'] || 0) + 1;
        }
      }

      // Get country - prefer API-provided country, fall back to registration, then ICAO hex
      let country = null;
      if (session.country) {
        // Use country from API (from OpenSky database)
        country = getCountryFromCode(session.country);
      }
      if (!country && session.registration) {
        // Fall back to registration prefix parsing
        country = getCountryFromReg(session.registration);
      }
      if (!country && session.icao_hex) {
        // Fall back to ICAO hex address range
        country = getCountryFromIcaoHex(session.icao_hex);
      }
      if (country) {
        const key = country.code;
        if (!countryCount[key]) {
          countryCount[key] = { ...country, count: 0 };
        }
        countryCount[key].count++;
      }
    });

    const totalWithType = Object.values(typeCount).reduce((a, b) => a + b, 0);
    const totalWithCountry = Object.values(countryCount).reduce((sum, c) => sum + c.count, 0);

    // Type colors for pie chart
    const typeColors = ['#00c8ff', '#00ff88', '#f7d794', '#ff9f43', '#a371f7', '#ff6b6b', '#5a7a9a', '#6b7280', '#e879f9', '#4ade80'];

    // Sort and take top items
    const topTypes = Object.entries(typeCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([type, count], i) => ({ type, count, pct: totalWithType > 0 ? (count / totalWithType) * 100 : 0, color: typeColors[i % typeColors.length] }));

    const topManufacturers = Object.entries(manufacturerCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count, pct: totalWithType > 0 ? (count / totalWithType) * 100 : 0 }));

    const categoryBreakdown = Object.entries(categoryCount)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count, pct: totalWithType > 0 ? (count / totalWithType) * 100 : 0 }));

    // Country colors for pie chart
    const countryColors = ['#00c8ff', '#00ff88', '#f7d794', '#ff9f43', '#a371f7', '#ff6b6b', '#5a7a9a', '#6b7280'];

    // Top countries
    const topCountries = Object.values(countryCount)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map((c, i) => ({ ...c, pct: totalWithCountry > 0 ? (c.count / totalWithCountry) * 100 : 0, color: countryColors[i % countryColors.length] }));

    // Category colors
    const categoryColors = {
      'Airliner': '#00c8ff',
      'Widebody': '#5a7a9a',
      'Regional': '#a371f7',
      'Business Jet': '#00ff88',
      'Turboprop': '#f7d794',
      'GA Piston': '#ff9f43',
      'Helicopter': '#ff6b6b',
      'Military': '#a371f7',
      'Other': '#6b7280'
    };

    return {
      totalUnique: seenHex.size,
      totalWithType,
      totalWithCountry,
      topTypes,
      topManufacturers,
      topCountries,
      categoryBreakdown: categoryBreakdown.map(c => ({ ...c, color: categoryColors[c.name] || '#6b7280' }))
    };
  }, [sessionsData, showMilitaryOnly]);

  // Render a sparkline graph
  const renderSparkline = (data, valueKey, color, height = 60, showArea = true) => {
    if (!data || data.length < 2) return null;

    const width = 400; // viewBox width
    const padding = 4;
    const values = data.map(d => d[valueKey] || 0);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const points = values.map((v, i) => {
      const x = padding + (i / (values.length - 1)) * (width - padding * 2);
      const y = height - padding - ((v - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    }).join(' ');

    const areaPoints = `${padding},${height - padding} ${points} ${width - padding},${height - padding}`;

    return (
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="sparkline-svg" style={{ width: '100%', height: height }}>
        {showArea && (
          <polygon
            points={areaPoints}
            fill={color}
            opacity="0.15"
          />
        )}
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* Current value dot */}
        {values.length > 0 && (
          <circle
            cx={width - padding}
            cy={height - padding - ((values[values.length - 1] - min) / range) * (height - padding * 2)}
            r="4"
            fill={color}
          />
        )}
      </svg>
    );
  };

  // ACARS label descriptions for human-readable display
  const acarsLabelDescriptions = {
    '_d': 'Command/Response', 'H1': 'Departure', 'H2': 'Arrival',
    '10': 'OUT - Gate', '11': 'OFF - Takeoff', '12': 'ON - Landing', '13': 'IN - Gate',
    '14': 'ETA Report', '15': 'Flight Status', '16': 'Route Change', '17': 'Fuel Report',
    '20': 'Delay', '21': 'Delay', '22': 'Ground Delay', '23': 'Gate ETA',
    '30': 'Weather Req', '31': 'METAR', '32': 'TAF', '33': 'ATIS', '34': 'PIREP',
    '35': 'Wind Data', '36': 'SIGMET', '37': 'NOTAM', '38': 'Turbulence',
    '40': 'Flight Plan', '44': 'Position', '45': 'FL Change', '48': 'ETA Update',
    '50': 'Maintenance', '51': 'Engine', '52': 'APU', '53': 'Fault',
    'AA': 'Free Text', 'Q0': 'Link Test', 'Q1': 'Link Test', 'QA': 'Test',
    'SA': 'System', 'SQ': 'Squawk', 'C1': 'Position', 'CA': 'CPDLC',
    'B1': 'Dep Clearance Req', 'B2': 'Dep Clearance', 'BA': 'Beacon',
    'AD': 'ADS-C', 'A1': 'CPDLC Connect', 'A2': 'CPDLC Disconnect',
    '5Z': 'Airline', '80': 'Weather', '81': 'Weather', '00': 'Heartbeat'
  };

  const getAcarsLabelDescription = (label) => {
    if (!label) return label;
    return acarsLabelDescriptions[label.toUpperCase()] || acarsLabelDescriptions[label] || label;
  };

  // Render a pie chart - uses viewBox for scaling, actual size controlled by CSS
  const renderPieChart = (data, size = 100, className = '') => {
    if (!data || data.length === 0) return null;

    const total = data.reduce((sum, d) => sum + d.value, 0);
    if (total === 0) return null;

    const viewBoxSize = 100; // Fixed viewBox for consistent rendering
    const cx = viewBoxSize / 2;
    const cy = viewBoxSize / 2;
    const radius = viewBoxSize / 2 - 2;

    let currentAngle = -90; // Start from top
    const paths = data.map((item, i) => {
      const angle = (item.value / total) * 360;
      const startAngle = currentAngle;
      const endAngle = currentAngle + angle;
      currentAngle = endAngle;

      // Convert to radians
      const startRad = (startAngle * Math.PI) / 180;
      const endRad = (endAngle * Math.PI) / 180;

      // Calculate arc points
      const x1 = cx + radius * Math.cos(startRad);
      const y1 = cy + radius * Math.sin(startRad);
      const x2 = cx + radius * Math.cos(endRad);
      const y2 = cy + radius * Math.sin(endRad);

      const largeArc = angle > 180 ? 1 : 0;

      const pathData = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;

      return (
        <path
          key={i}
          d={pathData}
          fill={item.color}
          stroke="var(--bg-card)"
          strokeWidth="1.5"
        />
      );
    });

    return (
      <svg
        className={`pie-chart-svg ${className}`}
        viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
        style={{ width: size, height: size }}
      >
        {paths}
      </svg>
    );
  };

  // Render a bar chart for throughput
  const renderThroughputBars = (data, valueKey, color, height = 50) => {
    if (!data || data.length < 2) return null;

    const width = 400; // viewBox width
    const barWidth = Math.max(2, (width / data.length) - 1);
    const values = data.map(d => d[valueKey] || 0);
    const max = Math.max(...values) || 1;

    return (
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="throughput-bars-svg" style={{ width: '100%', height: height }}>
        {values.map((v, i) => {
          const barHeight = (v / max) * (height - 4);
          const x = i * (barWidth + 1);
          return (
            <rect
              key={i}
              x={x}
              y={height - barHeight - 2}
              width={barWidth}
              height={barHeight}
              fill={color}
              opacity={0.6 + (i / values.length) * 0.4}
              rx="1"
            />
          );
        })}
      </svg>
    );
  };

  return (
    <div className="stats-container">
      {emergencyAircraft.length > 0 && (
        <div className="emergency-banner">
          <AlertTriangle size={24} />
          <div>
            <strong>Emergency Squawk Detected</strong>
            <div>
              {emergencyAircraft.map((a, i) => (
                <span key={a.hex}>
                  {i > 0 && ', '}
                  {onSelectAircraft ? (
                    <button className="emergency-aircraft-link" onClick={() => onSelectAircraft(a.hex)}>
                      {a.hex} ({a.squawk})
                    </button>
                  ) : (
                    `${a.hex} (${a.squawk})`
                  )}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Filter Controls */}
      <div className="stats-filters">
        <div className="filter-group">
          <Clock size={14} />
          <span className="filter-label">Time Range</span>
          <div className="time-range-buttons">
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
        <div className="filter-divider" />
        <div
          className={`filter-toggle ${showMilitaryOnly ? 'active' : ''}`}
          onClick={() => setShowMilitaryOnly(!showMilitaryOnly)}
        >
          <span className="toggle-indicator" />
          <span>Military Only</span>
        </div>
        <div className="filter-divider" />
        <button
          className={`advanced-filter-btn ${showAdvancedFilters ? 'active' : ''}`}
          onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
        >
          <Filter size={14} />
          <span>Filters</span>
          <ChevronDown size={14} className={`chevron ${showAdvancedFilters ? 'open' : ''}`} />
        </button>
      </div>

      {/* Advanced Filters Panel */}
      {showAdvancedFilters && (
        <div className="advanced-filters-panel">
          <div className="filter-row">
            <div className="filter-field">
              <label>Category</label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="">All Categories</option>
                <option value="A0">A0 - No ADS-B</option>
                <option value="A1">A1 - Light</option>
                <option value="A2">A2 - Small</option>
                <option value="A3">A3 - Large</option>
                <option value="A4">A4 - High Vortex</option>
                <option value="A5">A5 - Heavy</option>
                <option value="A6">A6 - High Performance</option>
                <option value="A7">A7 - Rotorcraft</option>
                <option value="B1,B2">B - Glider/Balloon</option>
                <option value="C1,C2,C3">C - UAV/Drone</option>
              </select>
            </div>
            <div className="filter-field">
              <label>Aircraft Type</label>
              <input
                type="text"
                placeholder="e.g. B738, A320"
                value={aircraftType}
                onChange={(e) => setAircraftType(e.target.value.toUpperCase())}
              />
            </div>
          </div>
          <div className="filter-row">
            <div className="filter-field">
              <label>Min Altitude (ft)</label>
              <input
                type="number"
                placeholder="0"
                value={minAltitude}
                onChange={(e) => setMinAltitude(e.target.value)}
              />
            </div>
            <div className="filter-field">
              <label>Max Altitude (ft)</label>
              <input
                type="number"
                placeholder="60000"
                value={maxAltitude}
                onChange={(e) => setMaxAltitude(e.target.value)}
              />
            </div>
            <div className="filter-field">
              <label>Min Distance (nm)</label>
              <input
                type="number"
                placeholder="0"
                value={minDistance}
                onChange={(e) => setMinDistance(e.target.value)}
              />
            </div>
            <div className="filter-field">
              <label>Max Distance (nm)</label>
              <input
                type="number"
                placeholder="250"
                value={maxDistance}
                onChange={(e) => setMaxDistance(e.target.value)}
              />
            </div>
          </div>
          <div className="filter-actions">
            <button
              className="clear-filters-btn"
              onClick={() => {
                setCategoryFilter('');
                setAircraftType('');
                setMinAltitude('');
                setMaxAltitude('');
                setMinDistance('');
                setMaxDistance('');
              }}
            >
              Clear Filters
            </button>
            {stats?.filters_applied && Object.keys(stats.filters_applied).length > 0 && (
              <span className="active-filters-count">
                {Object.keys(stats.filters_applied).length} filter(s) active
              </span>
            )}
          </div>
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-icon"><Plane size={20} /></div>
          <div className="stat-card-content">
            <div className="stat-card-label">Current Aircraft</div>
            <div className="stat-card-value">{stats?.total || 0}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon"><Radio size={20} /></div>
          <div className="stat-card-content">
            <div className="stat-card-label">With Position</div>
            <div className="stat-card-value">{stats?.with_position || 0}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon military"><Activity size={20} /></div>
          <div className="stat-card-content">
            <div className="stat-card-label">Military</div>
            <div className="stat-card-value purple">{stats?.military || 0}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon"><TrendingUp size={20} /></div>
          <div className="stat-card-content">
            <div className="stat-card-label">24h Unique</div>
            <div className="stat-card-value">{histStats?.unique_aircraft || '--'}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon acars"><Radio size={20} /></div>
          <div className="stat-card-content">
            <div className="stat-card-label">ACARS Messages</div>
            <div className="stat-card-value cyan">{acarsStats?.last_24h || '--'}</div>
            <div className="stat-card-subtext">Last hour: {acarsStats?.last_hour || '--'}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon"><Activity size={20} /></div>
          <div className="stat-card-content">
            <div className="stat-card-label">Message Rate</div>
            <div className="stat-card-value">{messageRate > 0 ? messageRate.toFixed(0) : '--'}</div>
            <div className="stat-card-subtext">msg/sec</div>
          </div>
        </div>
      </div>

      {/* Live Graphs Section */}
      <div className="stats-graphs-section">
        <div className="graph-card">
          <div className="graph-header">
            <div className="graph-title">
              <Plane size={16} />
              Aircraft Count
            </div>
            <div className="graph-value">{stats?.total || 0}</div>
          </div>
          <div className="graph-container">
            {renderSparkline(aircraftHistory, 'count', '#00c8ff', 80)}
          </div>
          <div className="graph-footer">
            <span>Last 5 minutes</span>
            <span>Peak: {Math.max(...aircraftHistory.map(d => d.count || 0)) || '--'}</span>
          </div>
        </div>

        <div className="graph-card">
          <div className="graph-header">
            <div className="graph-title">
              <Activity size={16} />
              Message Throughput
            </div>
            <div className="graph-value">{messageRate > 0 ? messageRate.toFixed(0) : 0} <span className="graph-unit">msg/s</span></div>
          </div>
          <div className="graph-container">
            {renderThroughputBars(throughputHistory, 'messages', '#00ff88', 80)}
          </div>
          <div className="graph-footer">
            <span>Last 5 minutes</span>
            <span>Peak: {Math.max(...throughputHistory.map(d => d.messages || 0)).toFixed(0) || '--'} msg/s</span>
          </div>
        </div>

        <div className="graph-card">
          <div className="graph-header">
            <div className="graph-title">
              <Radio size={16} />
              Position Reports
            </div>
            <div className="graph-value">{stats?.with_position || 0}</div>
          </div>
          <div className="graph-container">
            {renderSparkline(throughputHistory, 'withPosition', '#f7d794', 80)}
          </div>
          <div className="graph-footer">
            <span>Last 5 minutes</span>
            <span>Avg: {throughputHistory.length > 0 ? Math.round(throughputHistory.reduce((a, d) => a + (d.withPosition || 0), 0) / throughputHistory.length) : '--'}</span>
          </div>
        </div>
      </div>

      <div className="distribution-row">
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

        <div className="distribution-card squawk-card">
          <div className="card-title">
            <Hash size={16} />
            Squawk Codes
            <span className="squawk-total">{squawkData.total} active</span>
          </div>

          {/* Squawk Categories */}
          <div className="squawk-categories">
            {squawkData.categories.map((cat, i) => (
              <div key={i} className="squawk-category">
                <div className="squawk-cat-header">
                  <span className="squawk-cat-label">{cat.label}</span>
                  <span className="squawk-cat-value">{cat.value}</span>
                </div>
                <div className="squawk-cat-bar">
                  <div
                    className="squawk-cat-fill"
                    style={{ width: `${cat.pct}%`, backgroundColor: cat.color }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Squawk Heatmap */}
          {squawkData.heatmap.length > 0 && (
            <div className="squawk-heatmap">
              <div className="heatmap-title">Top Squawk Codes</div>
              <div className="heatmap-grid">
                {squawkData.heatmap.map((sq, i) => (
                  <div
                    key={sq.code}
                    className={`heatmap-cell ${sq.isEmergency ? 'emergency' : ''} ${sq.isVfr ? 'vfr' : ''}`}
                    title={`${sq.code}: ${sq.count} aircraft`}
                    style={{
                      opacity: 0.4 + (sq.count / squawkData.heatmap[0].count) * 0.6
                    }}
                  >
                    <span className="heatmap-code">{sq.code}</span>
                    <span className="heatmap-count">{sq.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ACARS Stats */}
      {acarsStats && (
        <div className="acars-stats-card">
          <div className="card-title">ACARS/VDL2 Statistics</div>
          <div className="acars-stats-content single-column">
            {/* Stats grid */}
            <div className="acars-stats-grid">
              <div className="acars-stat-item">
                <span className="acars-stat-label">Total Messages</span>
                <span className="acars-stat-value">{acarsStats.total_messages?.toLocaleString() || '--'}</span>
              </div>
              <div className="acars-stat-item">
                <span className="acars-stat-label">Last 24h</span>
                <span className="acars-stat-value">{acarsStats.last_24h?.toLocaleString() || '--'}</span>
              </div>
              <div className="acars-stat-item">
                <span className="acars-stat-label">Last Hour</span>
                <span className="acars-stat-value">{acarsStats.last_hour?.toLocaleString() || '--'}</span>
              </div>
              <div className="acars-stat-item">
                <span className="acars-stat-label">Service Status</span>
                <span className={`acars-stat-value ${acarsStats.service_stats?.running ? 'running' : 'stopped'}`}>
                  {acarsStats.service_stats?.running ? 'Running' : 'Stopped'}
                </span>
              </div>
            </div>

            {/* Charts Row */}
            <div className="acars-charts-row">
              {/* Source Pie Chart */}
              {acarsStats.by_source && ((acarsStats.by_source.acars || 0) + (acarsStats.by_source.vdlm2 || 0) > 0) && (
                <div className="acars-source-chart">
                  <div className="source-chart-title">Messages by Source</div>
                  <div className="source-chart-container">
                    <div className="pie-chart-wrapper">
                      {renderPieChart([
                        { value: acarsStats.by_source?.acars || 0, color: '#00c8ff', label: 'ACARS' },
                        { value: acarsStats.by_source?.vdlm2 || 0, color: '#00ff88', label: 'VDL2' }
                      ])}
                    </div>
                    <div className="source-legend">
                      <div className="legend-item">
                        <span className="legend-dot acars"></span>
                        <span className="legend-label">ACARS</span>
                        <span className="legend-value">{acarsStats.by_source?.acars?.toLocaleString() || 0}</span>
                        <span className="legend-pct">
                          {acarsStats.by_source?.acars && acarsStats.last_24h
                            ? `${Math.round((acarsStats.by_source.acars / acarsStats.last_24h) * 100)}%`
                            : ''}
                        </span>
                      </div>
                      <div className="legend-item">
                        <span className="legend-dot vdlm2"></span>
                        <span className="legend-label">VDL Mode 2</span>
                        <span className="legend-value">{acarsStats.by_source?.vdlm2?.toLocaleString() || 0}</span>
                        <span className="legend-pct">
                          {acarsStats.by_source?.vdlm2 && acarsStats.last_24h
                            ? `${Math.round((acarsStats.by_source.vdlm2 / acarsStats.last_24h) * 100)}%`
                            : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Top Labels Pie Chart */}
              {acarsStats.top_labels?.length > 0 && (() => {
                const labelColors = ['#00c8ff', '#00ff88', '#f7d794', '#ff9f43', '#a371f7', '#ff6b6b', '#5a7a9a', '#6b7280'];
                const topLabels = acarsStats.top_labels.slice(0, 8);
                const totalLabels = topLabels.reduce((sum, item) => sum + (item.count || 0), 0);
                return (
                  <div className="acars-top-labels">
                    <div className="top-labels-title">Top Message Types (24h)</div>
                    <div className="top-labels-chart-container">
                      <div className="pie-chart-wrapper">
                        {renderPieChart(
                          topLabels.map((item, i) => ({
                            value: item.count || 0,
                            color: labelColors[i % labelColors.length],
                            label: item.label || '--'
                          }))
                        )}
                      </div>
                      <div className="top-labels-legend">
                        {topLabels.map((item, i) => (
                          <div key={i} className="label-legend-item">
                            <span className="label-legend-dot" style={{ backgroundColor: labelColors[i % labelColors.length] }}></span>
                            <span className="label-legend-code" title={item.label}>{item.label || '--'}</span>
                            <span className="label-legend-desc">{getAcarsLabelDescription(item.label)}</span>
                            <span className="label-legend-count">{item.count?.toLocaleString()}</span>
                            <span className="label-legend-pct">
                              {totalLabels > 0 ? `${Math.round((item.count / totalLabels) * 100)}%` : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Safety Events Stats */}
      {safetyStats && (
        <div className="safety-stats-card">
          <div className="card-title">
            <Shield size={16} />
            Safety Events ({timeRange})
            {safetyStats.total_events > 0 && (
              <span className="safety-total">{safetyStats.total_events} events</span>
            )}
          </div>
          <div className="safety-stats-content">
            {/* Stats grid - expanded with new metrics */}
            <div className="safety-stats-grid">
              <div className="safety-stat-item">
                <span className="safety-stat-label">Total Events</span>
                <span className="safety-stat-value">{safetyStats.total_events || 0}</span>
              </div>
              <div className="safety-stat-item critical">
                <span className="safety-stat-label">Critical</span>
                <span className="safety-stat-value">{safetyStats.events_by_severity?.critical || 0}</span>
              </div>
              <div className="safety-stat-item warning">
                <span className="safety-stat-label">Warning</span>
                <span className="safety-stat-value">{safetyStats.events_by_severity?.warning || 0}</span>
              </div>
              <div className="safety-stat-item info">
                <span className="safety-stat-label">Info</span>
                <span className="safety-stat-value">{safetyStats.events_by_severity?.low || 0}</span>
              </div>
              <div className="safety-stat-item">
                <span className="safety-stat-label">Aircraft Involved</span>
                <span className="safety-stat-value">{safetyStats.unique_aircraft || 0}</span>
              </div>
              <div className="safety-stat-item">
                <span className="safety-stat-label">Events/Hour</span>
                <span className="safety-stat-value">{safetyStats.event_rate_per_hour?.toFixed(1) || '0.0'}</span>
              </div>
            </div>

            {/* Event types breakdown */}
            {safetyStats.total_events > 0 && (
              <div className="safety-charts-row">
                {/* Events by Type */}
                <div className="safety-type-chart">
                  <div className="safety-chart-title">Events by Type</div>
                  <div className="safety-type-bars">
                    {Object.entries(safetyStats.events_by_type || {})
                      .sort((a, b) => b[1] - a[1])
                      .map(([type, count]) => {
                        const typeLabels = {
                          tcas_ra: 'TCAS RA',
                          tcas_ta: 'TCAS TA',
                          extreme_vs: 'Extreme V/S',
                          vs_reversal: 'VS Reversal',
                          proximity_conflict: 'Proximity',
                          squawk_emergency: 'Emergency',
                          squawk_hijack: 'Hijack',
                          squawk_radio_failure: 'Radio Fail'
                        };
                        const typeColors = {
                          tcas_ra: '#ff4757',
                          tcas_ta: '#ff9f43',
                          extreme_vs: '#f7d794',
                          vs_reversal: '#f7d794',
                          proximity_conflict: '#a371f7',
                          squawk_emergency: '#ff4757',
                          squawk_hijack: '#ff4757',
                          squawk_radio_failure: '#ff9f43'
                        };
                        const pct = safetyStats.total_events > 0 ? (count / safetyStats.total_events) * 100 : 0;
                        return (
                          <div key={type} className="safety-type-row">
                            <span className="safety-type-name">{typeLabels[type] || type}</span>
                            <div className="safety-type-bar-container">
                              <div
                                className="safety-type-bar-fill"
                                style={{ width: `${pct}%`, backgroundColor: typeColors[type] || '#00c8ff' }}
                              />
                            </div>
                            <span className="safety-type-count">{count}</span>
                          </div>
                        );
                      })}
                  </div>
                </div>

                {/* Events by Severity Pie Chart */}
                <div className="safety-severity-chart">
                  <div className="safety-chart-title">Events by Severity</div>
                  <div className="safety-chart-container">
                    <div className="pie-chart-wrapper">
                      {renderPieChart([
                        { value: safetyStats.events_by_severity?.critical || 0, color: '#ff4757', label: 'Critical' },
                        { value: safetyStats.events_by_severity?.warning || 0, color: '#ff9f43', label: 'Warning' },
                        { value: safetyStats.events_by_severity?.low || 0, color: '#00c8ff', label: 'Info' }
                      ].filter(d => d.value > 0))}
                    </div>
                    <div className="safety-legend">
                      {safetyStats.events_by_severity?.critical > 0 && (
                        <div className="safety-legend-item">
                          <span className="safety-legend-dot critical"></span>
                          <span className="safety-legend-label">Critical</span>
                          <span className="safety-legend-value">{safetyStats.events_by_severity.critical}</span>
                        </div>
                      )}
                      {safetyStats.events_by_severity?.warning > 0 && (
                        <div className="safety-legend-item">
                          <span className="safety-legend-dot warning"></span>
                          <span className="safety-legend-label">Warning</span>
                          <span className="safety-legend-value">{safetyStats.events_by_severity.warning}</span>
                        </div>
                      )}
                      {safetyStats.events_by_severity?.low > 0 && (
                        <div className="safety-legend-item">
                          <span className="safety-legend-dot info"></span>
                          <span className="safety-legend-label">Info</span>
                          <span className="safety-legend-value">{safetyStats.events_by_severity.low}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Hourly Event Timeline */}
            {safetyStats.events_by_hour?.length > 0 && (
              <div className="safety-timeline-section">
                <div className="safety-chart-title">Event Timeline</div>
                <div className="safety-timeline-chart">
                  {renderThroughputBars(
                    safetyStats.events_by_hour.map(h => ({ ...h, value: h.count })),
                    'count',
                    '#ff9f43',
                    60
                  )}
                </div>
                <div className="safety-timeline-footer">
                  <span>Hourly distribution over {timeRange}</span>
                  <span>Peak: {Math.max(...safetyStats.events_by_hour.map(h => h.count))} events/hr</span>
                </div>
              </div>
            )}

            {/* Top Aircraft with Events */}
            {safetyStats.top_aircraft?.length > 0 && (
              <div className="safety-top-aircraft">
                <div className="safety-chart-title">Top Aircraft by Events</div>
                <div className="safety-aircraft-list">
                  {safetyStats.top_aircraft.slice(0, 5).map((ac, i) => {
                    const severityColors = { critical: '#ff4757', warning: '#ff9f43', low: '#00c8ff' };
                    return (
                      <div
                        key={ac.icao}
                        className={`safety-aircraft-item ${onSelectAircraft ? 'clickable' : ''}`}
                        onClick={() => onSelectAircraft?.(ac.icao)}
                      >
                        <span className="safety-aircraft-rank">{i + 1}</span>
                        <div className="safety-aircraft-info">
                          <span className="safety-aircraft-callsign">{ac.callsign || ac.icao}</span>
                          <span className="safety-aircraft-icao">{ac.icao}</span>
                        </div>
                        <span
                          className="safety-aircraft-severity"
                          style={{ color: severityColors[ac.worst_severity] || '#6b7280' }}
                        >
                          {ac.worst_severity}
                        </span>
                        <span className="safety-aircraft-count">{ac.count} events</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {safetyStats.total_events === 0 && (
              <div className="safety-no-events">
                <Shield size={24} />
                <span>No safety events in the selected time range</span>
              </div>
            )}

            {/* Monitor Status */}
            <div className="safety-monitor-status">
              <span className={`monitor-indicator ${safetyStats.monitoring_enabled ? 'active' : 'inactive'}`}></span>
              <span className="monitor-label">
                Safety Monitor: {safetyStats.monitoring_enabled ? 'Active' : 'Inactive'}
              </span>
              {safetyStats.monitor_state?.tracked_aircraft && (
                <span className="monitor-tracking">
                  Tracking {safetyStats.monitor_state.tracked_aircraft} aircraft
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Fleet Breakdown */}
      {fleetBreakdown && fleetBreakdown.totalWithType > 0 && (
        <div className="fleet-breakdown-card">
          <div className="card-title">
            <Plane size={16} />
            Fleet Breakdown ({timeRange}){showMilitaryOnly && ' - Military'}
            <span className="fleet-total">{fleetBreakdown.totalWithType} aircraft with type</span>
          </div>

          <div className="fleet-breakdown-content">
            {/* Row 1: Categories and Manufacturers (2 columns) */}
            <div className="fleet-row fleet-row-top">
              {/* Category Pie Chart */}
              <div className="fleet-category-section">
                <div className="fleet-section-title">Aircraft Categories</div>
                <div className="fleet-chart-container">
                  <div className="pie-chart-wrapper">
                    {renderPieChart(
                      fleetBreakdown.categoryBreakdown.map(c => ({ value: c.count, color: c.color, label: c.name }))
                    )}
                  </div>
                  <div className="fleet-legend">
                    {fleetBreakdown.categoryBreakdown.map((cat, i) => (
                      <div key={i} className="fleet-legend-item">
                        <span className="fleet-legend-dot" style={{ backgroundColor: cat.color }}></span>
                        <span className="fleet-legend-label">{cat.name}</span>
                        <span className="fleet-legend-value">{cat.count}</span>
                        <span className="fleet-legend-pct">{cat.pct.toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Manufacturer Breakdown */}
              <div className="fleet-manufacturer-section">
                <div className="fleet-section-title">
                  <Factory size={14} />
                  Top Manufacturers
                </div>
                <div className="manufacturer-bars">
                  {fleetBreakdown.topManufacturers.map((mfr, i) => (
                    <div key={i} className="manufacturer-row">
                      <span className="manufacturer-name">{mfr.name}</span>
                      <div className="manufacturer-bar-container">
                        <div
                          className="manufacturer-bar-fill"
                          style={{ width: `${mfr.pct}%` }}
                        />
                      </div>
                      <span className="manufacturer-count">{mfr.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Row 2: Aircraft Types and Origin Countries (2 columns) */}
            <div className="fleet-row fleet-row-bottom">
              {/* Top Aircraft Types as Pie Chart */}
              <div className="fleet-types-section">
                <div className="fleet-section-title">
                  <Plane size={14} />
                  Top Aircraft Types
                </div>
                <div className="fleet-chart-container">
                  <div className="pie-chart-wrapper">
                    {renderPieChart(
                      fleetBreakdown.topTypes.map(t => ({ value: t.count, color: t.color, label: t.type }))
                    )}
                  </div>
                  <div className="fleet-legend">
                    {fleetBreakdown.topTypes.map((t, i) => (
                      <div key={i} className="fleet-legend-item">
                        <span className="fleet-legend-dot" style={{ backgroundColor: t.color }}></span>
                        <span className="fleet-legend-label type-label">{t.type}</span>
                        <span className="fleet-legend-value">{t.count}</span>
                        <span className="fleet-legend-pct">{t.pct.toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Origin Countries */}
              <div className="fleet-countries-section">
                <div className="fleet-section-title">
                  Origin Countries
                  {fleetBreakdown.totalWithCountry > 0 && (
                    <span className="fleet-section-subtitle">{fleetBreakdown.totalWithCountry} with registration</span>
                  )}
                </div>
                {fleetBreakdown.topCountries?.length > 0 ? (
                  <div className="country-bars">
                    {fleetBreakdown.topCountries.map((country, i) => (
                      <div key={i} className="country-row">
                        <span className="country-flag">{country.flag}</span>
                        <span className="country-name">{country.name}</span>
                        <div className="country-bar-container">
                          <div
                            className="country-bar-fill"
                            style={{ width: `${country.pct}%` }}
                          />
                        </div>
                        <span className="country-count">{country.count}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="fleet-no-data">
                    No registration data available
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="top-lists">
        <div className="top-list-card">
          <div className="card-title">Closest Aircraft</div>
          <div className="top-list">
            {top?.closest?.slice(0, 5).map((ac, i) => (
              <div
                key={ac.hex}
                className={`top-item ${onSelectAircraft ? 'clickable' : ''}`}
                onClick={() => onSelectAircraft?.(ac.hex)}
              >
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
              <div
                key={ac.hex}
                className={`top-item ${onSelectAircraft ? 'clickable' : ''}`}
                onClick={() => onSelectAircraft?.(ac.hex)}
              >
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
              <div
                key={ac.hex}
                className={`top-item ${onSelectAircraft ? 'clickable' : ''}`}
                onClick={() => onSelectAircraft?.(ac.hex)}
              >
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

        <div className="top-list-card most-seen-card">
          <div className="card-title">Most Seen (24h)</div>
          <div className="top-list">
            {mostSeenAircraft.length === 0 ? (
              <div className="top-item empty">No session data available</div>
            ) : (
              mostSeenAircraft.map((ac, i) => (
                <div
                  key={ac.hex}
                  className={`top-item ${onSelectAircraft ? 'clickable' : ''} ${ac.isMilitary ? 'military' : ''}`}
                  onClick={() => onSelectAircraft?.(ac.hex)}
                >
                  <span className="top-rank">{i + 1}</span>
                  <div className="top-info">
                    <div className="top-callsign">
                      {ac.callsign || ac.hex}
                      {ac.isMilitary && <span className="mil-badge">MIL</span>}
                    </div>
                    <div className="top-icao">
                      {ac.hex}
                      {ac.type && <span className="top-type">{ac.type}</span>}
                    </div>
                  </div>
                  <div className="top-stats">
                    <span className="top-value">{ac.sessionCount} visits</span>
                    <span className="top-subvalue">{ac.totalMessages.toLocaleString()} msgs</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Analytics Section with Tabs */}
      <div className="analytics-section">
        <div className="analytics-header">
          <div className="analytics-title">
            <BarChart3 size={18} />
            Historical Analytics
          </div>
          <div className="analytics-tabs">
            {[
              { key: 'trends', label: 'Trends', icon: TrendingUp },
              { key: 'top', label: 'Top Performers', icon: Award },
              { key: 'distance', label: 'Distance', icon: Target },
              { key: 'speed', label: 'Speed', icon: Zap },
              { key: 'patterns', label: 'Patterns', icon: Activity }
            ].map(tab => (
              <button
                key={tab.key}
                className={`analytics-tab ${activeAnalyticsTab === tab.key ? 'active' : ''}`}
                onClick={() => setActiveAnalyticsTab(tab.key)}
              >
                <tab.icon size={14} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Trends Tab */}
        {activeAnalyticsTab === 'trends' && trendsData && (
          <div className="analytics-content">
            <div className="trends-summary">
              <div className="trend-stat">
                <span className="trend-label">Total Unique Aircraft</span>
                <span className="trend-value">{trendsData.summary?.total_unique_aircraft || 0}</span>
              </div>
              <div className="trend-stat">
                <span className="trend-label">Peak Concurrent</span>
                <span className="trend-value">{trendsData.summary?.peak_concurrent || 0}</span>
              </div>
              <div className="trend-stat">
                <span className="trend-label">Intervals</span>
                <span className="trend-value">{trendsData.summary?.total_intervals || 0}</span>
              </div>
            </div>
            <div className="trends-chart">
              {trendsData.intervals?.length > 0 && (
                <div className="trend-bars">
                  {trendsData.intervals.map((interval, i) => {
                    const maxCount = Math.max(...trendsData.intervals.map(i => i.unique_aircraft || 0));
                    const height = maxCount > 0 ? ((interval.unique_aircraft || 0) / maxCount) * 100 : 0;
                    return (
                      <div
                        key={i}
                        className="trend-bar"
                        style={{ height: `${height}%` }}
                        title={`${new Date(interval.timestamp).toLocaleTimeString()}: ${interval.unique_aircraft} aircraft`}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Top Performers Tab */}
        {activeAnalyticsTab === 'top' && topPerformersData && (
          <div className="analytics-content">
            <div className="top-performers-tabs">
              {[
                { key: 'longest', label: 'Longest Tracked' },
                { key: 'furthest', label: 'Furthest Distance' },
                { key: 'highest', label: 'Highest Altitude' },
                { key: 'closest', label: 'Closest Approach' }
              ].map(tab => (
                <button
                  key={tab.key}
                  className={`top-tab ${topPerformersTab === tab.key ? 'active' : ''}`}
                  onClick={() => setTopPerformersTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="top-performers-list">
              {(topPerformersData[topPerformersTab === 'longest' ? 'longest_tracked' :
                topPerformersTab === 'furthest' ? 'furthest_distance' :
                topPerformersTab === 'highest' ? 'highest_altitude' : 'closest_approach'] || [])
                .slice(0, 8).map((ac, i) => (
                  <div
                    key={ac.icao_hex}
                    className={`performer-item ${onSelectAircraft ? 'clickable' : ''} ${ac.is_military ? 'military' : ''}`}
                    onClick={() => onSelectAircraft?.(ac.icao_hex)}
                  >
                    <span className="performer-rank">{i + 1}</span>
                    <div className="performer-info">
                      <div className="performer-callsign">
                        {ac.callsign || ac.icao_hex}
                        {ac.is_military && <span className="mil-badge">MIL</span>}
                      </div>
                      <div className="performer-type">{ac.aircraft_type || 'Unknown'}</div>
                    </div>
                    <div className="performer-value">
                      {topPerformersTab === 'longest' && `${ac.duration_min?.toFixed(0)} min`}
                      {topPerformersTab === 'furthest' && `${ac.max_distance_nm?.toFixed(1)} nm`}
                      {topPerformersTab === 'highest' && `${ac.max_altitude?.toLocaleString()} ft`}
                      {topPerformersTab === 'closest' && `${ac.min_distance_nm?.toFixed(1)} nm`}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Distance Analytics Tab */}
        {activeAnalyticsTab === 'distance' && distanceAnalytics && (
          <div className="analytics-content">
            <div className="distance-stats">
              <div className="stat-box">
                <span className="stat-label">Mean Distance</span>
                <span className="stat-value">{distanceAnalytics.statistics?.mean_nm?.toFixed(1) || '--'} nm</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">Max Distance</span>
                <span className="stat-value">{distanceAnalytics.statistics?.max_nm?.toFixed(1) || '--'} nm</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">Median</span>
                <span className="stat-value">{distanceAnalytics.statistics?.median_nm?.toFixed(1) || '--'} nm</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">90th Percentile</span>
                <span className="stat-value">{distanceAnalytics.statistics?.percentile_90?.toFixed(1) || '--'} nm</span>
              </div>
            </div>
            <div className="distribution-chart">
              <div className="distribution-title">Distance Distribution</div>
              {distanceAnalytics.distribution && (
                <div className="dist-bars">
                  {Object.entries(distanceAnalytics.distribution).map(([band, count]) => {
                    const maxCount = Math.max(...Object.values(distanceAnalytics.distribution));
                    const width = maxCount > 0 ? (count / maxCount) * 100 : 0;
                    return (
                      <div key={band} className="dist-bar-row">
                        <span className="dist-label">{band}</span>
                        <div className="dist-bar-container">
                          <div className="dist-bar-fill" style={{ width: `${width}%` }} />
                        </div>
                        <span className="dist-count">{count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Speed Analytics Tab */}
        {activeAnalyticsTab === 'speed' && speedAnalytics && (
          <div className="analytics-content">
            <div className="speed-stats">
              <div className="stat-box">
                <span className="stat-label">Mean Speed</span>
                <span className="stat-value">{speedAnalytics.statistics?.mean_kt || '--'} kt</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">Max Speed</span>
                <span className="stat-value">{speedAnalytics.statistics?.max_kt || '--'} kt</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">90th Percentile</span>
                <span className="stat-value">{speedAnalytics.statistics?.percentile_90 || '--'} kt</span>
              </div>
            </div>
            <div className="fastest-aircraft">
              <div className="fastest-title">Fastest Aircraft</div>
              {speedAnalytics.fastest_sessions?.slice(0, 5).map((ac, i) => (
                <div
                  key={ac.icao_hex}
                  className={`fastest-item ${onSelectAircraft ? 'clickable' : ''}`}
                  onClick={() => onSelectAircraft?.(ac.icao_hex)}
                >
                  <span className="fastest-rank">{i + 1}</span>
                  <span className="fastest-callsign">{ac.callsign || ac.icao_hex}</span>
                  <span className="fastest-speed">{ac.max_speed} kt</span>
                </div>
              ))}
            </div>
            {speedAnalytics.by_type?.length > 0 && (
              <div className="speed-by-type">
                <div className="speed-type-title">Speed by Aircraft Type</div>
                {speedAnalytics.by_type.slice(0, 6).map((type, i) => (
                  <div key={type.type} className="speed-type-row">
                    <span className="speed-type-name">{type.type}</span>
                    <span className="speed-type-value">{type.peak_speed} kt peak</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Patterns Tab */}
        {activeAnalyticsTab === 'patterns' && correlationData && (
          <div className="analytics-content">
            <div className="patterns-grid">
              <div className="pattern-card">
                <div className="pattern-title">Altitude vs Speed</div>
                {correlationData.altitude_vs_speed?.map((band, i) => (
                  <div key={band.altitude_band} className="pattern-row">
                    <span className="pattern-label">{band.altitude_band}</span>
                    <span className="pattern-value">{band.avg_speed || '--'} kt avg</span>
                  </div>
                ))}
              </div>
              <div className="pattern-card">
                <div className="pattern-title">Time of Day Activity</div>
                <div className="time-pattern-info">
                  <div className="peak-hour">
                    Peak Hour: {correlationData.time_of_day_patterns?.peak_hour !== undefined ?
                      `${correlationData.time_of_day_patterns.peak_hour}:00` : '--'}
                  </div>
                  <div className="peak-count">
                    {correlationData.time_of_day_patterns?.peak_aircraft_count || 0} aircraft
                  </div>
                </div>
                <div className="hourly-bars">
                  {correlationData.time_of_day_patterns?.hourly_counts?.slice(0, 12).map((hour, i) => {
                    const maxCount = Math.max(...(correlationData.time_of_day_patterns?.hourly_counts?.map(h => h.unique_aircraft) || [1]));
                    const height = maxCount > 0 ? (hour.unique_aircraft / maxCount) * 40 : 0;
                    return (
                      <div
                        key={i}
                        className="hourly-bar"
                        style={{ height: `${height}px` }}
                        title={`${hour.hour}:00 - ${hour.unique_aircraft} aircraft`}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
