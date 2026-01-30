import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ACARS_QUICK_FILTER_CATEGORIES,
  getAcarsLabelDescription,
  safeJson
} from '../components/history/historyConstants';

/**
 * Hook for managing ACARS data fetching, filtering, and state
 */
export function useAcarsData({
  apiBase,
  timeRange,
  wsRequest,
  wsConnected,
  viewType
}) {
  // ACARS filters
  const [acarsSearch, setAcarsSearch] = useState('');
  const [acarsSource, setAcarsSource] = useState('all');
  const [acarsHideEmpty, setAcarsHideEmpty] = useState(true);
  const [acarsMessages, setAcarsMessages] = useState([]);
  const [acarsSelectedLabels, setAcarsSelectedLabels] = useState([]);
  const [acarsAirlineFilter, setAcarsAirlineFilter] = useState('');
  const [showLabelDropdown, setShowLabelDropdown] = useState(false);
  const [callsignHexCache, setCallsignHexCache] = useState({});
  const [regHexCache, setRegHexCache] = useState({});
  const [labelReference, setLabelReference] = useState({});
  const labelDropdownRef = useRef(null);

  // UI states
  const [acarsCompactMode, setAcarsCompactMode] = useState(() => {
    const saved = localStorage.getItem('acars-compact-mode');
    return saved === 'true';
  });
  const [acarsQuickFilters, setAcarsQuickFilters] = useState(() => {
    const saved = localStorage.getItem('acars-quick-filters');
    return saved ? JSON.parse(saved) : [];
  });
  const [expandedMessages, setExpandedMessages] = useState({});
  const [allMessagesExpanded, setAllMessagesExpanded] = useState(false);
  const [visibleAcarsCount, setVisibleAcarsCount] = useState(50);
  const acarsListRef = useRef(null);

  const hours = { '1h': 1, '6h': 6, '24h': 24, '48h': 48, '7d': 168 };

  // Store ws functions in refs to avoid triggering re-fetches
  const wsRequestRef = useRef(wsRequest);
  const wsConnectedRef = useRef(wsConnected);
  useEffect(() => {
    wsRequestRef.current = wsRequest;
    wsConnectedRef.current = wsConnected;
  }, [wsRequest, wsConnected]);

  // Fetch label reference once on mount
  const labelsFetchedRef = useRef(false);
  useEffect(() => {
    if (labelsFetchedRef.current) return;

    const fetchLabels = async () => {
      try {
        const res = await fetch(`${apiBase}/api/v1/acars/labels`);
        const data = await safeJson(res);
        if (data) {
          setLabelReference(data.labels || {});
          labelsFetchedRef.current = true;
        }
      } catch (err) {
        console.log('Labels fetch error:', err.message);
      }
    };
    fetchLabels();
  }, [apiBase]);

  // Fetch ACARS messages when viewing ACARS tab
  useEffect(() => {
    if (viewType !== 'acars') return;

    const fetchAcars = async () => {
      try {
        const queryParams = {
          hours: hours[timeRange],
          limit: 200,
        };
        if (acarsSource !== 'all') queryParams.source = acarsSource;
        if (acarsAirlineFilter) queryParams.airline = acarsAirlineFilter;
        if (acarsSelectedLabels.length > 0) queryParams.label = acarsSelectedLabels.join(',');

        let result = null;

        // Prefer WebSocket
        if (wsRequestRef.current && wsConnectedRef.current) {
          try {
            result = await wsRequestRef.current('acars-messages', queryParams);
            if (result?.error) result = null;
          } catch (err) {
            console.debug('ACARS WS request failed:', err.message);
          }
        }

        // HTTP fallback
        if (!result) {
          const params = new URLSearchParams();
          params.set('hours', hours[timeRange]);
          params.set('limit', '200');
          if (acarsSource !== 'all') params.set('source', acarsSource);
          if (acarsAirlineFilter) params.set('airline', acarsAirlineFilter);
          if (acarsSelectedLabels.length > 0) params.set('label', acarsSelectedLabels.join(','));

          const res = await fetch(`${apiBase}/api/v1/acars?${params.toString()}`);
          result = await safeJson(res);
        }

        if (result) {
          setAcarsMessages(result.messages || result.results || result || []);
        }
      } catch (err) {
        console.log('ACARS fetch error:', err.message);
      }
    };
    fetchAcars();
  }, [viewType, timeRange, acarsSource, acarsAirlineFilter, acarsSelectedLabels, apiBase]);

  // Lookup hex values from sightings for ACARS messages with callsign but no icao_hex
  useEffect(() => {
    if (viewType !== 'acars' || acarsMessages.length === 0) return;

    const callsignsToLookup = new Set();
    for (const msg of acarsMessages) {
      if (msg.callsign && !msg.icao_hex) {
        const cs = msg.callsign.trim().toUpperCase();
        if (!(cs in callsignHexCache)) {
          callsignsToLookup.add(cs);
        }
      }
    }

    if (callsignsToLookup.size === 0) return;

    const lookupCallsigns = async () => {
      const lookups = Array.from(callsignsToLookup).slice(0, 10);

      for (const callsign of lookups) {
        try {
          let data;
          if (wsRequest && wsConnected) {
            const result = await wsRequest('sightings', { callsign: callsign, hours: 24, limit: 1 });
            if (result && (result.sightings || result.results)) {
              data = result;
            } else {
              throw new Error('Invalid sightings response');
            }
          } else {
            const res = await fetch(`${apiBase}/api/v1/sightings?callsign=${encodeURIComponent(callsign)}&hours=24&limit=1`);
            data = await safeJson(res);
            if (!data) throw new Error('HTTP request failed');
          }
          const sightings = data?.sightings || data?.results || [];
          if (sightings.length > 0 && sightings[0].icao_hex) {
            setCallsignHexCache(prev => ({
              ...prev,
              [callsign]: sightings[0].icao_hex
            }));
          } else {
            setCallsignHexCache(prev => ({ ...prev, [callsign]: null }));
          }
        } catch (err) {
          setCallsignHexCache(prev => ({ ...prev, [callsign]: null }));
        }
      }
    };

    lookupCallsigns();
  }, [viewType, acarsMessages.length, apiBase, wsRequest, wsConnected]);

  // Lookup ICAO hex from registration for ACARS messages
  useEffect(() => {
    if (viewType !== 'acars' || acarsMessages.length === 0) return;

    const regsToLookup = new Set();
    for (const msg of acarsMessages) {
      if (msg.registration && !msg.icao_hex) {
        const reg = msg.registration.trim().toUpperCase();
        if (!(reg in regHexCache)) {
          regsToLookup.add(reg);
        }
      }
    }

    if (regsToLookup.size === 0) return;

    const lookupRegs = async () => {
      const lookups = Array.from(regsToLookup).slice(0, 10);

      for (const reg of lookups) {
        try {
          let data;
          if (wsRequest && wsConnected) {
            const result = await wsRequest('sightings', { registration: reg, hours: 168, limit: 1 });
            if (result && (result.sightings || result.results)) {
              data = result;
            } else {
              throw new Error('Invalid sightings response');
            }
          } else {
            const res = await fetch(`${apiBase}/api/v1/sightings?registration=${encodeURIComponent(reg)}&hours=168&limit=1`);
            data = await safeJson(res);
            if (!data) throw new Error('HTTP request failed');
          }
          const sightings = data?.sightings || data?.results || [];
          if (sightings.length > 0 && sightings[0].icao_hex) {
            setRegHexCache(prev => ({
              ...prev,
              [reg]: sightings[0].icao_hex
            }));
          } else {
            setRegHexCache(prev => ({ ...prev, [reg]: null }));
          }
        } catch (err) {
          setRegHexCache(prev => ({ ...prev, [reg]: null }));
        }
      }
    };

    lookupRegs();
  }, [viewType, acarsMessages.length, apiBase, wsRequest, wsConnected]);

  // Close label dropdown when clicking outside
  useEffect(() => {
    if (!showLabelDropdown) return;

    const handleClickOutside = (e) => {
      if (labelDropdownRef.current && !labelDropdownRef.current.contains(e.target)) {
        setShowLabelDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showLabelDropdown]);

  // Persist compact mode to localStorage
  useEffect(() => {
    localStorage.setItem('acars-compact-mode', acarsCompactMode.toString());
  }, [acarsCompactMode]);

  // Persist quick filters to localStorage
  useEffect(() => {
    localStorage.setItem('acars-quick-filters', JSON.stringify(acarsQuickFilters));
  }, [acarsQuickFilters]);

  // Toggle quick filter
  const toggleQuickFilter = useCallback((category) => {
    setAcarsQuickFilters(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  }, []);

  // Clear all quick filters
  const clearQuickFilters = useCallback(() => {
    setAcarsQuickFilters([]);
  }, []);

  // Toggle message expansion
  const toggleMessageExpansion = useCallback((msgId) => {
    setExpandedMessages(prev => ({
      ...prev,
      [msgId]: !prev[msgId]
    }));
  }, []);

  // Toggle all messages expansion
  const toggleAllMessages = useCallback(() => {
    setAllMessagesExpanded(prev => !prev);
    setExpandedMessages({});
  }, []);

  // Reset visible count when filters change
  useEffect(() => {
    setVisibleAcarsCount(50);
  }, [acarsSearch, acarsQuickFilters, acarsHideEmpty, acarsSelectedLabels, acarsAirlineFilter, acarsSource]);

  // Lazy load more messages on scroll
  const handleAcarsScroll = useCallback((e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    if (scrollHeight - scrollTop - clientHeight < 200) {
      setVisibleAcarsCount(prev => prev + 50);
    }
  }, []);

  // Get available labels from ACARS messages for the filter dropdown
  const availableLabels = useMemo(() => {
    if (!acarsMessages.length) return [];

    const labelCounts = {};
    acarsMessages.forEach(msg => {
      if (msg.label) {
        const label = msg.label.toUpperCase();
        labelCounts[label] = (labelCounts[label] || 0) + 1;
      }
    });

    return Object.entries(labelCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({
        label,
        count,
        description: getAcarsLabelDescription(label, null, labelReference)
      }));
  }, [acarsMessages, labelReference]);

  // Filter ACARS messages
  const filteredAcarsMessages = useMemo(() => {
    if (!acarsMessages.length) return [];

    let filtered = acarsMessages;

    // Filter out empty messages if hideEmpty is enabled
    if (acarsHideEmpty) {
      filtered = filtered.filter(msg => msg.text && msg.text.trim().length > 0);
    }

    // Apply quick filter chips
    if (acarsQuickFilters.length > 0) {
      const allowedLabels = new Set();
      acarsQuickFilters.forEach(category => {
        const catData = ACARS_QUICK_FILTER_CATEGORIES[category];
        if (catData) {
          catData.labels.forEach(l => allowedLabels.add(l));
        }
      });
      filtered = filtered.filter(msg => {
        const label = msg.label?.toUpperCase();
        return label && allowedLabels.has(label);
      });
    }

    // Apply search filter (includes airline name search)
    if (acarsSearch) {
      const search = acarsSearch.toLowerCase();
      filtered = filtered.filter(msg =>
        msg.icao_hex?.toLowerCase().includes(search) ||
        msg.callsign?.toLowerCase().includes(search) ||
        msg.text?.toLowerCase().includes(search) ||
        msg.label?.toLowerCase().includes(search) ||
        msg.airline?.name?.toLowerCase().includes(search) ||
        msg.airline?.icao?.toLowerCase().includes(search) ||
        msg.airline?.iata?.toLowerCase().includes(search)
      );
    }

    return filtered;
  }, [acarsMessages, acarsSearch, acarsHideEmpty, acarsQuickFilters]);

  return {
    // State
    acarsSearch,
    setAcarsSearch,
    acarsSource,
    setAcarsSource,
    acarsHideEmpty,
    setAcarsHideEmpty,
    acarsMessages,
    acarsSelectedLabels,
    setAcarsSelectedLabels,
    acarsAirlineFilter,
    setAcarsAirlineFilter,
    showLabelDropdown,
    setShowLabelDropdown,
    labelDropdownRef,
    callsignHexCache,
    regHexCache,
    labelReference,

    // UI state
    acarsCompactMode,
    setAcarsCompactMode,
    acarsQuickFilters,
    expandedMessages,
    allMessagesExpanded,
    visibleAcarsCount,
    acarsListRef,

    // Computed
    availableLabels,
    filteredAcarsMessages,

    // Actions
    toggleQuickFilter,
    clearQuickFilters,
    toggleMessageExpansion,
    toggleAllMessages,
    handleAcarsScroll,
  };
}
