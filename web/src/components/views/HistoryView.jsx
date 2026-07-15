import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Map as MapIcon,
  MessageCircle,
  FileWarning,
  Shield,
  Cloud,
  Archive,
  Search,
  X,
  MapPin,
  Loader2,
  RefreshCw,
  Plane,
  Wind,
  Thermometer,
} from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import { useSocketApi, useSortState, useAcarsData, useReplayState } from '../../hooks';
import { useSocketIO } from '../../hooks/socket';
import { useSavedViews } from '../../hooks/useSavedViews';
import { useHistoryFilters } from '../../hooks/useHistoryFilters';
import { TabBar } from '../common/TabBar';
import { SafetyEventCard } from '../safety/SafetyEventCard';
import { SortControls } from '../common/SortControls';

// NOTAMs components
import { NotamCard, TfrCard, NotamStats, AirportSearch, NOTAM_TYPES } from '../notams';

// Archive components
import {
  ArchivedNotamCard,
  ArchivedPirepCard,
  ArchiveStats,
  NOTAM_TYPES as ARCHIVE_NOTAM_TYPES,
  DATE_RANGES,
  HAZARD_FILTERS,
  ALTITUDE_RANGES,
} from '../archive';

// Import history components
import {
  VALID_DATA_TYPES,
  TIME_RANGES,
  TIME_RANGE_HOURS,
  SESSION_SORT_CONFIG,
  SIGHTINGS_SORT_CONFIG,
  SAFETY_SORT_CONFIG,
  SAFETY_SORT_FIELDS,
  ACARS_SORT_CONFIG,
} from '../history/historyConstants';

import { SessionCard } from '../history/SessionCard';
import { SessionsFilters } from '../history/SessionsFilters';
import { CompactSessionRow } from '../history/CompactSessionRow';
import { HistoryDashboardHeader } from '../history/HistoryDashboardHeader';
import { FacetedFilterBar } from '../history/FacetedFilterBar';
import { DenseDataTable } from '../history/DenseDataTable';
import { SightingsTable } from '../history/SightingsTable';
import { SafetyEventMap } from '../history/SafetyEventMap';
import { SnapshotContainer } from '../history/SnapshotView';
import { AcarsFilters, AcarsQuickFilters } from '../history/AcarsFilters';
import { AcarsMessageItem } from '../history/AcarsMessageItem';

export function HistoryView({
  apiBase,
  onSelectAircraft,
  onSelectByTail,
  onViewEvent,
  targetEventId,
  onEventViewed,
  hashParams = {},
  setHashParams,
  wsRequest,
  wsConnected,
  initialTab,
}) {
  // Sync viewType with URL hash params
  const [viewType, setViewTypeState] = useState(() => {
    if (hashParams.data && VALID_DATA_TYPES.includes(hashParams.data)) {
      return hashParams.data;
    }
    if (initialTab && VALID_DATA_TYPES.includes(initialTab)) {
      return initialTab;
    }
    return 'sessions';
  });

  // Wrapper to update both state and URL
  const setViewType = (type) => {
    setViewTypeState(type);
    if (setHashParams) {
      setHashParams({ data: type });
    }
  };

  // Sync with hash params changes (back/forward navigation)
  useEffect(() => {
    if (
      hashParams.data &&
      VALID_DATA_TYPES.includes(hashParams.data) &&
      hashParams.data !== viewType
    ) {
      setViewTypeState(hashParams.data);
    }
  }, [hashParams.data, viewType]);

  const [timeRange, setTimeRange] = useState('24h');
  const [expandedSnapshots, setExpandedSnapshots] = useState({});
  const eventRefs = useRef({});
  const scrollTimeoutRef = useRef(null);
  const highlightTimeoutRef = useRef(null);

  // Reset expandedSnapshots when tab changes to prevent stale state
  useEffect(() => {
    setExpandedSnapshots({});
  }, [viewType]);

  // View mode state (grid, list, table)
  const [viewMode, setViewMode] = useState('grid');

  // Real-time polling interval (30 seconds for sessions)
  const POLLING_INTERVAL = 30000;

  // Session filters (legacy - kept for backwards compatibility)
  const [sessionSearch, setSessionSearch] = useState('');
  const [showMilitaryOnly, setShowMilitaryOnly] = useState(false);

  // New faceted filters
  const { filters, setFilters, filterSessions, hasActiveFilters } = useHistoryFilters({
    hashParams,
    setHashParams,
  });

  // Saved views
  const { savedViews, saveView, deleteView } = useSavedViews('history');

  // Use replay state hook for safety event maps
  const replay = useReplayState({
    apiBase,
    wsRequest,
    wsConnected,
  });

  // Use ACARS data hook
  const acars = useAcarsData({
    apiBase,
    timeRange,
    wsRequest,
    wsConnected,
    viewType,
  });

  // ============================================================================
  // NOTAMs State & Logic
  // ============================================================================
  const [notams, setNotams] = useState([]);
  const [tfrs, setTfrs] = useState([]);
  const [notamStats, setNotamStats] = useState(null);
  const [notamsLoading, setNotamsLoading] = useState(true);
  const [notamsError, setNotamsError] = useState(null);
  const [notamExpandedId, setNotamExpandedId] = useState(null);
  const [notamSubTab, setNotamSubTab] = useState('all');
  const [notamSearchQuery, setNotamSearchQuery] = useState('');
  const [notamTypeFilter, setNotamTypeFilter] = useState('all');
  const [airportNotams, setAirportNotams] = useState(null);
  const [airportLoading, setAirportLoading] = useState(false);
  const [selectedAirport, setSelectedAirport] = useState(null);
  const [httpFallbackAttempted, setHttpFallbackAttempted] = useState(false);
  const notamRequestIdRef = useRef(0);
  const notamPendingRequestsRef = useRef(new Map());

  // HTTP fallback to fetch NOTAMs if WebSocket doesn't provide data
  const fetchNotamsHttp = useCallback(async () => {
    if (httpFallbackAttempted) return;
    setHttpFallbackAttempted(true);

    const base = (apiBase || '').replace(/\/$/, '');
    try {
      const [notamsRes, tfrsRes, statsRes] = await Promise.all([
        fetch(`${base}/api/v1/notams/?active_only=true&limit=100`),
        fetch(`${base}/api/v1/notams/tfrs/?active_only=true`),
        fetch(`${base}/api/v1/notams/stats/`),
      ]);

      const notamsData = notamsRes.ok ? await notamsRes.json() : null;
      const tfrsData = tfrsRes.ok ? await tfrsRes.json() : null;
      const statsData = statsRes.ok ? await statsRes.json() : null;

      if (notamsData?.notams) {
        const mappedNotams = notamsData.notams.map((n) => ({ ...n, type: n.notam_type }));
        setNotams(mappedNotams);
      }

      if (tfrsData?.tfrs) {
        const mappedTfrs = tfrsData.tfrs.map((t) => ({ ...t, type: 'TFR' }));
        setTfrs(mappedTfrs);
      }

      if (statsData) {
        setNotamStats({
          total_active: statsData.active_notams || 0,
          tfr_count: statsData.active_tfrs || 0,
          by_type: statsData.by_type || {},
          last_update: statsData.last_refresh,
        });
      }

      setNotamsLoading(false);
      setNotamsError(null);
    } catch (err) {
      console.error('HTTP fallback failed:', err);
      setNotamsError('Failed to load NOTAMs');
      setNotamsLoading(false);
    }
  }, [apiBase, httpFallbackAttempted]);

  // WebSocket message handler for NOTAMs
  const handleNotamMessage = useCallback((data) => {
    switch (data.type) {
      case 'notam:snapshot':
        setNotams(data.data?.notams || []);
        setTfrs(data.data?.tfrs || []);
        setNotamStats(data.data?.stats || null);
        setNotamsLoading(false);
        setNotamsError(null);
        break;
      case 'notam:new':
        setNotams((prev) => [data.data, ...prev]);
        if (data.data?.type === 'TFR') setTfrs((prev) => [data.data, ...prev]);
        break;
      case 'notam:update':
        setNotams((prev) =>
          prev.map((n) => (n.notam_id === data.data?.notam_id ? { ...n, ...data.data } : n))
        );
        if (data.data?.type === 'TFR') {
          setTfrs((prev) =>
            prev.map((t) => (t.notam_id === data.data?.notam_id ? { ...t, ...data.data } : t))
          );
        }
        break;
      case 'notam:expired':
      case 'notam:tfr_expired':
        setNotams((prev) => prev.filter((n) => n.notam_id !== data.data?.notam_id));
        setTfrs((prev) => prev.filter((t) => t.notam_id !== data.data?.notam_id));
        break;
      case 'notam:tfr_new':
        setTfrs((prev) => [data.data, ...prev]);
        setNotams((prev) => [data.data, ...prev]);
        break;
      case 'notam:stats':
        setNotamStats(data.data);
        break;
      case 'response': {
        const resolver = notamPendingRequestsRef.current.get(data.request_id);
        if (resolver) {
          if (resolver.timeoutId) {
            clearTimeout(resolver.timeoutId);
          }
          resolver.resolve(data.data);
          notamPendingRequestsRef.current.delete(data.request_id);
        }
        break;
      }
      case 'error':
        if (data.request_id) {
          const resolver = notamPendingRequestsRef.current.get(data.request_id);
          if (resolver) {
            if (resolver.timeoutId) {
              clearTimeout(resolver.timeoutId);
            }
            resolver.reject(new Error(data.message));
            notamPendingRequestsRef.current.delete(data.request_id);
          }
        } else {
          setNotamsError(data.message);
        }
        break;
      default:
        break;
    }
  }, []);

  // Socket.IO connection for NOTAMs (only connect when NOTAMs tab is active)
  const notamsEnabled = viewType === 'notams';
  const {
    connected: notamsConnected,
    emit: notamEmit,
    reconnect: notamReconnect,
    on: notamOn,
  } = useSocketIO({
    enabled: notamsEnabled,
    apiBase,
    namespace: '/',
    path: '/socket.io',
    onConnect: () => {
      setNotamsLoading(true);
      setNotamsError(null);
      notamEmit('subscribe', { topics: ['notams'] });
    },
    onDisconnect: () => {
      if (notams.length === 0 && !httpFallbackAttempted) fetchNotamsHttp();
    },
    onError: (err) => {
      setNotamsError(err.message || 'Connection error');
      if (!httpFallbackAttempted) fetchNotamsHttp();
    },
  });

  // Set up NOTAM message event listeners
  useEffect(() => {
    if (!notamsConnected || !notamsEnabled || !notamOn) return;

    const eventTypes = [
      'notam:snapshot',
      'notam:new',
      'notam:update',
      'notam:expired',
      'notam:tfr_expired',
      'notam:tfr_new',
      'notam:stats',
      'response',
      'error',
    ];

    const unsubscribers = eventTypes.map((eventType) => {
      const unsub = notamOn(eventType, (data) => {
        handleNotamMessage({ type: eventType, data });
      });
      return unsub;
    });

    return () => {
      unsubscribers.forEach((unsub) => {
        if (unsub && typeof unsub === 'function') {
          unsub();
        }
      });
    };
  }, [notamsConnected, notamsEnabled, notamOn, handleNotamMessage]);

  // If NOTAM WebSocket connected but no data after 5 seconds, try HTTP fallback
  useEffect(() => {
    if (notamsEnabled && notamsConnected && notamsLoading && notams.length === 0) {
      let cancelled = false;
      const timeout = setTimeout(() => {
        if (!cancelled && notams.length === 0 && !httpFallbackAttempted) {
          fetchNotamsHttp();
        }
      }, 5000);
      return () => {
        cancelled = true;
        clearTimeout(timeout);
      };
    }
  }, [
    notamsEnabled,
    notamsConnected,
    notamsLoading,
    notams.length,
    httpFallbackAttempted,
    fetchNotamsHttp,
  ]);

  // NOTAM request helper
  const notamRequest = useCallback(
    async (type, params = {}) => {
      return new Promise((resolve, reject) => {
        const requestId = `req_${++notamRequestIdRef.current}`;
        const timeoutId = setTimeout(() => {
          if (notamPendingRequestsRef.current.has(requestId)) {
            notamPendingRequestsRef.current.delete(requestId);
            reject(new Error('Request timeout'));
          }
        }, 30000);

        notamPendingRequestsRef.current.set(requestId, { resolve, reject, timeoutId });
        notamEmit('request', { type, request_id: requestId, params });
      });
    },
    [notamEmit]
  );

  // Cleanup NOTAM pending requests on unmount
  useEffect(() => {
    return () => {
      notamPendingRequestsRef.current.forEach(({ timeoutId }) => {
        clearTimeout(timeoutId);
      });
      notamPendingRequestsRef.current.clear();
    };
  }, []);

  // Search for airport NOTAMs
  const handleAirportSearch = useCallback(
    async (icao) => {
      setAirportLoading(true);
      setSelectedAirport(icao);
      const base = (apiBase || '').replace(/\/$/, '');

      try {
        let data = null;
        if (notamsConnected) {
          try {
            data = await notamRequest('airport', { icao });
          } catch (wsErr) {
            console.debug('WebSocket airport request failed, trying HTTP');
          }
        }

        if (!data) {
          const res = await fetch(`${base}/api/v1/notams/airport/${icao.toUpperCase()}/`);
          if (res.ok) {
            const json = await res.json();
            data = (json.notams || []).map((n) => ({ ...n, type: n.notam_type }));
          }
        }

        setAirportNotams(data || []);
        setNotamSubTab('airport');
      } catch (err) {
        setNotamsError(`Failed to load NOTAMs for ${icao}: ${err.message}`);
      } finally {
        setAirportLoading(false);
      }
    },
    [apiBase, notamsConnected, notamRequest]
  );

  // Refresh NOTAMs
  const handleNotamRefresh = useCallback(async () => {
    const base = (apiBase || '').replace(/\/$/, '');
    try {
      if (notamsConnected) {
        try {
          await notamRequest('refresh');
        } catch (wsErr) {
          console.debug('WebSocket refresh failed, trying HTTP');
        }
      }
      await fetch(`${base}/api/v1/notams/refresh/`, { method: 'POST' });
      setHttpFallbackAttempted(false);
      setTimeout(() => fetchNotamsHttp(), 2000);
    } catch (err) {
      console.error('Refresh failed:', err);
    }
  }, [apiBase, notamsConnected, notamRequest, fetchNotamsHttp]);

  // Filter notams based on search and type
  const filteredNotams = useMemo(() => {
    let list = notamSubTab === 'tfrs' ? tfrs : notams;
    if (notamTypeFilter !== 'all') list = list.filter((n) => n.type === notamTypeFilter);
    if (notamSearchQuery) {
      const query = notamSearchQuery.toLowerCase();
      list = list.filter(
        (n) =>
          n.location?.toLowerCase().includes(query) ||
          n.notam_id?.toLowerCase().includes(query) ||
          n.text?.toLowerCase().includes(query) ||
          n.reason?.toLowerCase().includes(query)
      );
    }
    return list;
  }, [notamSubTab, notams, tfrs, notamTypeFilter, notamSearchQuery]);

  const notamDisplayList = notamSubTab === 'airport' ? airportNotams || [] : filteredNotams;

  // ============================================================================
  // Archive State & Logic (PIREPs and Archived NOTAMs)
  // ============================================================================
  const [archiveDateRange, setArchiveDateRange] = useState(30);
  const [archiveSearchQuery, setArchiveSearchQuery] = useState('');
  const [archiveTypeFilter, setArchiveTypeFilter] = useState('all');
  const [archiveIcaoFilter, setArchiveIcaoFilter] = useState('');
  const [archiveHazardFilter, setArchiveHazardFilter] = useState('all');
  const [archiveAltitudeFilter, setArchiveAltitudeFilter] = useState('all');
  const [archiveExpandedId, setArchiveExpandedId] = useState(null);
  const [archiveLoading, setArchiveLoading] = useState(true);
  const [archiveError, setArchiveError] = useState(null);
  const [archivedNotams, setArchivedNotams] = useState([]);
  const [archivedNotamsTotalCount, setArchivedNotamsTotalCount] = useState(0);
  const [archivedPireps, setArchivedPireps] = useState([]);
  const [archivedPirepsTotalCount, setArchivedPirepsTotalCount] = useState(0);
  const [archiveStats, setArchiveStats] = useState(null);
  const [archiveStatsLoading, setArchiveStatsLoading] = useState(true);
  const [archiveOffset, setArchiveOffset] = useState(0);
  const archiveLimit = 50;

  // Fetch archive stats on mount
  useEffect(() => {
    const fetchArchiveStats = async () => {
      try {
        const res = await fetch(`${apiBase}/api/v1/archive/stats/`);
        if (!res.ok) {
          setArchiveStats({
            notams: { total_archived: 0, by_type: {} },
            pireps: { total_archived: 0, by_type: {} },
          });
          return;
        }
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          setArchiveStats({
            notams: { total_archived: 0, by_type: {} },
            pireps: { total_archived: 0, by_type: {} },
          });
          return;
        }
        const data = await res.json();
        setArchiveStats(data);
      } catch (err) {
        console.error('Failed to fetch archive stats:', err);
        setArchiveStats({
          notams: { total_archived: 0, by_type: {} },
          pireps: { total_archived: 0, by_type: {} },
        });
      } finally {
        setArchiveStatsLoading(false);
      }
    };
    if (viewType === 'archive' || viewType === 'pireps') {
      fetchArchiveStats();
    }
  }, [apiBase, viewType]);

  // Fetch archive data based on active tab
  useEffect(() => {
    if (viewType !== 'archive' && viewType !== 'pireps') return;

    const fetchArchiveData = async () => {
      setArchiveLoading(true);
      setArchiveError(null);

      try {
        const params = new URLSearchParams();
        params.set('days', archiveDateRange.toString());
        params.set('limit', archiveLimit.toString());
        params.set('offset', archiveOffset.toString());

        if (archiveSearchQuery) params.set('search', archiveSearchQuery);
        if (archiveIcaoFilter) params.set('icao', archiveIcaoFilter.toUpperCase());

        if (viewType === 'archive') {
          if (archiveTypeFilter !== 'all') params.set('type', archiveTypeFilter);

          const res = await fetch(`${apiBase}/api/v1/archive/notams/?${params.toString()}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const contentType = res.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Invalid response format');
          }
          const data = await res.json();
          setArchivedNotams(data.notams || []);
          setArchivedNotamsTotalCount(data.total_count || 0);
        } else if (viewType === 'pireps') {
          if (archiveTypeFilter !== 'all') params.set('report_type', archiveTypeFilter);

          const res = await fetch(`${apiBase}/api/v1/archive/pireps/?${params.toString()}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const contentType = res.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Invalid response format');
          }
          const data = await res.json();
          setArchivedPireps(data.pireps || []);
          setArchivedPirepsTotalCount(data.total_count || 0);
        }
      } catch (err) {
        setArchiveError(err.message);
      } finally {
        setArchiveLoading(false);
      }
    };

    fetchArchiveData();
  }, [
    apiBase,
    viewType,
    archiveDateRange,
    archiveSearchQuery,
    archiveTypeFilter,
    archiveIcaoFilter,
    archiveOffset,
  ]);

  // Reset archive offset when filters change
  // Note: archiveHazardFilter and archiveAltitudeFilter are client-side filters,
  // so they should not trigger an offset reset (which would refetch from server)
  useEffect(() => {
    setArchiveOffset(0);
  }, [archiveSearchQuery, archiveTypeFilter, archiveIcaoFilter, archiveDateRange]);

  // Apply client-side hazard and altitude filters to PIREPs
  const filteredArchivedPireps = useMemo(() => {
    if (viewType !== 'pireps') return archivedPireps;

    let filtered = archivedPireps;

    if (archiveHazardFilter !== 'all' && HAZARD_FILTERS[archiveHazardFilter]) {
      const filterFn = HAZARD_FILTERS[archiveHazardFilter].filterFn;
      filtered = filtered.filter(filterFn);
    }

    if (archiveAltitudeFilter !== 'all' && ALTITUDE_RANGES[archiveAltitudeFilter]) {
      const range = ALTITUDE_RANGES[archiveAltitudeFilter];
      filtered = filtered.filter((p) => {
        const alt = p.altitude_ft || (p.flight_level ? p.flight_level * 100 : null);
        if (alt === null) return true;
        return alt >= range.min && alt < range.max;
      });
    }

    return filtered;
  }, [archivedPireps, viewType, archiveHazardFilter, archiveAltitudeFilter]);

  const archiveCurrentData = viewType === 'archive' ? archivedNotams : filteredArchivedPireps;
  const archiveTotalCount =
    viewType === 'archive' ? archivedNotamsTotalCount : filteredArchivedPireps.length;
  const archiveHasMore = archiveOffset + archiveLimit < archiveTotalCount;
  const archiveHasPrev = archiveOffset > 0;

  // Toggle snapshot expansion
  const toggleSnapshot = (eventId) => {
    setExpandedSnapshots((prev) => ({
      ...prev,
      [eventId]: !prev[eventId],
    }));
  };

  // Build API endpoint based on view type (trailing slash required for Django)
  const endpoint =
    viewType === 'sessions'
      ? `/api/v1/sessions/?hours=${TIME_RANGE_HOURS[timeRange]}`
      : viewType === 'sightings'
        ? `/api/v1/sightings/?hours=${TIME_RANGE_HOURS[timeRange]}&limit=100`
        : viewType === 'acars'
          ? `/api/v1/acars/?hours=${TIME_RANGE_HOURS[timeRange]}&limit=200`
          : `/api/v1/safety/events/?hours=${TIME_RANGE_HOURS[timeRange]}&limit=100`;

  // Use Socket.IO for data fetching with polling for real-time updates
  // Sessions poll every 30s, other views poll every 60s
  const pollingInterval = viewType === 'sessions' ? POLLING_INTERVAL : 60000;
  const { data, loading, refetch } = useSocketApi(endpoint, pollingInterval, apiBase, {
    wsRequest,
    wsConnected,
  });

  // Handle navigation to a specific safety event
  useEffect(() => {
    if (!targetEventId || !data?.events) return;

    setViewType('safety');

    const eventIndex = data.events.findIndex(
      (e) => e.id === targetEventId || e.id === String(targetEventId)
    );
    if (eventIndex === -1) return;

    const event = data.events[eventIndex];
    const eventKey = event.id || eventIndex;

    if (!replay.expandedMaps[eventKey]) {
      replay.toggleMap(eventKey, event);
    }

    scrollTimeoutRef.current = setTimeout(() => {
      const eventEl = eventRefs.current[eventKey];
      if (eventEl) {
        eventEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        eventEl.classList.add('highlight-event');
        highlightTimeoutRef.current = setTimeout(() => {
          eventEl.classList.remove('highlight-event');
        }, 2000);
      }
    }, 100);

    onEventViewed?.();
  }, [targetEventId, data?.events, replay.expandedMaps, replay.toggleMap, onEventViewed]);

  // Cleanup scroll/highlight timeouts on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    };
  }, []);

  // Filter sessions using new faceted filters (with fallback to legacy filters)
  const filteredSessionsUnsorted = useMemo(() => {
    if (!data?.sessions) return [];

    // First apply new faceted filters
    let filtered = filterSessions(data.sessions);

    // Then apply legacy filters for backwards compatibility
    if (sessionSearch) {
      const search = sessionSearch.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.icao_hex?.toLowerCase().includes(search) ||
          s.callsign?.toLowerCase().includes(search) ||
          s.type?.toLowerCase().includes(search)
      );
    }

    if (showMilitaryOnly) {
      filtered = filtered.filter((s) => s.is_military);
    }

    return filtered;
  }, [data?.sessions, sessionSearch, showMilitaryOnly, filterSessions]);

  // Sort sessions
  const {
    sortField: sessionSortField,
    sortDirection: sessionSortDirection,
    handleSort: handleSessionSort,
    sortedData: filteredSessions,
  } = useSortState({
    viewKey: 'history-sessions',
    defaultField: 'last_seen',
    defaultDirection: 'desc',
    data: filteredSessionsUnsorted,
    sortConfig: SESSION_SORT_CONFIG,
  });

  // Sort sightings
  const {
    sortField: sightingsSortField,
    sortDirection: sightingsSortDirection,
    handleSort: handleSightingsSort,
    sortedData: sortedSightings,
  } = useSortState({
    viewKey: 'history-sightings',
    defaultField: 'timestamp',
    defaultDirection: 'desc',
    data: data?.sightings || data?.results || [],
    sortConfig: SIGHTINGS_SORT_CONFIG,
  });

  // Sort safety events
  const {
    sortField: safetySortField,
    sortDirection: safetySortDirection,
    handleSort: handleSafetySort,
    sortedData: sortedSafetyEvents,
  } = useSortState({
    viewKey: 'history-safety',
    defaultField: 'timestamp',
    defaultDirection: 'desc',
    data: data?.events || [],
    sortConfig: SAFETY_SORT_CONFIG,
  });

  // Sort ACARS
  const {
    sortField: acarsSortField,
    sortDirection: acarsSortDirection,
    handleSort: handleAcarsSort,
    sortedData: sortedAcarsMessages,
  } = useSortState({
    viewKey: 'history-acars',
    defaultField: 'timestamp',
    defaultDirection: 'desc',
    data: acars.filteredAcarsMessages,
    sortConfig: ACARS_SORT_CONFIG,
  });

  // Calculate counts for tab badges
  const sessionCount = data?.sessions?.length || 0;
  const acarsCount = acars.acarsMessages?.length || 0;
  const safetyCount = data?.events?.length || 0;
  const hasCriticalSafety = data?.events?.some((e) => e.severity === 'critical');

  // Tab configuration
  const tabs = [
    { id: 'sessions', label: 'Sessions', count: sessionCount > 0 ? sessionCount : null },
    { id: 'sightings', label: 'Sightings' },
    {
      id: 'acars',
      label: 'ACARS',
      icon: <MessageCircle size={14} />,
      count: acarsCount > 0 ? acarsCount : null,
      badgeVariant: 'info',
    },
    {
      id: 'safety',
      label: 'Safety',
      icon: <AlertTriangle size={14} />,
      count: safetyCount > 0 ? safetyCount : null,
      badgeVariant: safetyCount > 0 ? 'warning' : 'default',
      alertDot: hasCriticalSafety,
    },
    {
      id: 'notams',
      label: 'NOTAMs',
      icon: <FileWarning size={14} />,
      count: notams.length > 0 ? notams.length : null,
    },
    {
      id: 'pireps',
      label: 'PIREPs',
      icon: <Cloud size={14} />,
      count: archivedPirepsTotalCount > 0 ? archivedPirepsTotalCount : null,
    },
    {
      id: 'archive',
      label: 'Archive',
      icon: <Archive size={14} />,
    },
  ];

  // Table columns for sessions table view
  const sessionTableColumns = useMemo(
    () => [
      { field: 'callsign', label: 'Callsign', width: '100px', mono: true, highlight: true },
      { field: 'icao_hex', label: 'ICAO', width: '80px', mono: true },
      { field: 'type', label: 'Type', width: '70px' },
      {
        field: 'duration_min',
        label: 'Duration',
        width: '70px',
        type: 'number',
        align: 'right',
        format: (v) => `${Math.round(v || 0)}m`,
      },
      {
        field: 'min_distance_nm',
        label: 'Dist',
        width: '70px',
        type: 'number',
        align: 'right',
        format: (v) => v?.toFixed(1) || '--',
        unit: 'nm',
      },
      {
        field: 'max_alt',
        label: 'Max Alt',
        width: '80px',
        type: 'number',
        align: 'right',
        colorScale: 'altitude',
        format: (v) => (v ? `${(v / 1000).toFixed(0)}k` : '--'),
      },
      {
        field: 'max_rssi',
        label: 'Signal',
        width: '60px',
        type: 'number',
        align: 'right',
        colorScale: 'signal',
        format: (v) => v?.toFixed(0) || '--',
      },
      { field: 'first_seen', label: 'First Seen', width: '90px', type: 'time' },
      { field: 'last_seen', label: 'Last Seen', width: '90px', type: 'time' },
    ],
    []
  );

  // Handle saved view loading
  const handleLoadView = (view) => {
    if (view.filters) {
      setFilters(view.filters);
    }
  };

  return (
    <div className="history-container">
      {/* Dashboard Header with KPIs */}
      {viewType === 'sessions' && (
        <HistoryDashboardHeader
          sessions={data?.sessions || []}
          sightings={data?.sightings || data?.results || []}
          safetyEvents={data?.events || []}
          timeRange={TIME_RANGE_HOURS[timeRange]}
          onTimeRangeChange={(hours) => {
            const range =
              Object.entries(TIME_RANGE_HOURS).find(([, h]) => h === hours)?.[0] || '24h';
            setTimeRange(range);
          }}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          loading={loading}
          onRefresh={refetch}
        />
      )}

      <TabBar
        tabs={tabs}
        activeTab={viewType}
        onTabChange={setViewType}
        timeRanges={viewType !== 'sessions' ? TIME_RANGES : undefined}
        activeTimeRange={viewType !== 'sessions' ? timeRange : undefined}
        onTimeRangeChange={viewType !== 'sessions' ? setTimeRange : undefined}
      />

      {viewType === 'sessions' && (
        <>
          {/* Faceted Filter Bar */}
          <FacetedFilterBar
            filters={filters}
            onFiltersChange={setFilters}
            sessions={data?.sessions || []}
            showSavedViews
            savedViews={savedViews}
            onSaveView={saveView}
            onLoadView={handleLoadView}
            onDeleteView={deleteView}
          />

          {/* Legacy filters - kept for backwards compatibility but hidden if new filters active */}
          {!hasActiveFilters && (
            <SessionsFilters
              sessionSearch={sessionSearch}
              setSessionSearch={setSessionSearch}
              showMilitaryOnly={showMilitaryOnly}
              setShowMilitaryOnly={setShowMilitaryOnly}
              sessionSortField={sessionSortField}
              sessionSortDirection={sessionSortDirection}
              handleSessionSort={handleSessionSort}
              filteredCount={filteredSessions.length}
              totalCount={data?.sessions?.length || 0}
            />
          )}

          {/* Grid View */}
          {viewMode === 'grid' && (
            <div className="sessions-grid sessions-grid--cards">
              {filteredSessions.map((session, i) => (
                <SessionCard
                  key={session.icao_hex + session.first_seen || i}
                  session={session}
                  onSelectAircraft={onSelectAircraft}
                  showSparkline
                />
              ))}
            </div>
          )}

          {/* List View (compact rows) */}
          {viewMode === 'list' && (
            <div className="sessions-grid sessions-grid--dense">
              {filteredSessions.map((session, i) => (
                <CompactSessionRow
                  key={session.icao_hex + session.first_seen || i}
                  session={session}
                  onClick={() => onSelectAircraft?.(session.icao_hex)}
                  onSelectByTail={onSelectByTail}
                  showSparkline
                />
              ))}
            </div>
          )}

          {/* Table View */}
          {viewMode === 'table' && (
            <DenseDataTable
              data={filteredSessions}
              columns={sessionTableColumns}
              onRowClick={(row) => onSelectAircraft?.(row.icao_hex)}
              onSort={handleSessionSort}
              sortField={sessionSortField}
              sortDirection={sessionSortDirection}
              maxHeight={600}
              emptyMessage="No sessions found"
            />
          )}
        </>
      )}

      {viewType === 'sightings' && (
        <SightingsTable
          sightings={sortedSightings}
          sortField={sightingsSortField}
          sortDirection={sightingsSortDirection}
          onSort={handleSightingsSort}
          onSelectAircraft={onSelectAircraft}
        />
      )}

      {viewType === 'safety' && (
        <>
          <div className="safety-events-header">
            <SortControls
              fields={SAFETY_SORT_FIELDS}
              activeField={safetySortField}
              direction={safetySortDirection}
              onSort={handleSafetySort}
            />
            <div className="safety-events-count">
              {sortedSafetyEvents.length} event{sortedSafetyEvents.length !== 1 ? 's' : ''}
            </div>
          </div>
          <div className="safety-events-grid">
            {sortedSafetyEvents.length === 0 && (
              <div className="no-events-message">
                <AlertTriangle size={32} />
                <p>No safety events in the selected time range</p>
              </div>
            )}
            {sortedSafetyEvents.map((event, i) => {
              const eventKey = event.id || i;
              const hasSnapshot = event.aircraft_snapshot || event.aircraft_snapshot_2;
              const isExpanded = expandedSnapshots[eventKey];
              const hasMap = event.aircraft_snapshot?.lat || event.aircraft_snapshot_2?.lat;

              return (
                <div
                  key={eventKey}
                  ref={(el) => (eventRefs.current[eventKey] = el)}
                  className="safety-event-wrapper"
                >
                  <SafetyEventCard
                    event={event}
                    onSelectAircraft={onSelectAircraft}
                    onViewEvent={onViewEvent}
                  />

                  <div className="safety-event-expand-actions">
                    {hasSnapshot && (
                      <button className="snapshot-toggle" onClick={() => toggleSnapshot(eventKey)}>
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        {isExpanded ? 'Hide' : 'Show'} Telemetry
                      </button>
                    )}

                    {hasMap && (
                      <button
                        className="snapshot-toggle map-toggle"
                        onClick={() => replay.toggleMap(eventKey, event)}
                      >
                        <MapIcon size={14} />
                        {replay.expandedMaps[eventKey] ? 'Hide' : 'Show'} Map
                      </button>
                    )}
                  </div>

                  {isExpanded && (
                    <SnapshotContainer event={event} onSelectAircraft={onSelectAircraft} />
                  )}

                  {replay.expandedMaps[eventKey] && (
                    <SafetyEventMap
                      eventKey={eventKey}
                      event={event}
                      trackData={replay.trackData}
                      replayState={replay.replayState}
                      graphZoomState={replay.graphZoomState}
                      onInitializeMap={replay.initializeMap}
                      onReplayChange={replay.handleReplayChange}
                      onTogglePlay={replay.togglePlay}
                      onSkipToStart={replay.skipToStart}
                      onSkipToEnd={replay.skipToEnd}
                      onSpeedChange={replay.handleSpeedChange}
                      onJumpToEvent={replay.jumpToEvent}
                      onGraphWheel={replay.handleGraphWheel}
                      onGraphDragStart={replay.handleGraphDragStart}
                      onGraphDragMove={replay.handleGraphDragMove}
                      onGraphDragEnd={replay.handleGraphDragEnd}
                      onResetGraphZoom={replay.resetGraphZoom}
                      getReplayTimestamp={replay.getReplayTimestamp}
                      onSelectAircraft={onSelectAircraft}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {viewType === 'acars' && (
        <>
          <AcarsFilters
            acarsSearch={acars.acarsSearch}
            setAcarsSearch={acars.setAcarsSearch}
            acarsAirlineFilter={acars.acarsAirlineFilter}
            setAcarsAirlineFilter={acars.setAcarsAirlineFilter}
            acarsSource={acars.acarsSource}
            setAcarsSource={acars.setAcarsSource}
            acarsSelectedLabels={acars.acarsSelectedLabels}
            setAcarsSelectedLabels={acars.setAcarsSelectedLabels}
            showLabelDropdown={acars.showLabelDropdown}
            setShowLabelDropdown={acars.setShowLabelDropdown}
            labelDropdownRef={acars.labelDropdownRef}
            availableLabels={acars.availableLabels}
            acarsHideEmpty={acars.acarsHideEmpty}
            setAcarsHideEmpty={acars.setAcarsHideEmpty}
            acarsCompactMode={acars.acarsCompactMode}
            setAcarsCompactMode={acars.setAcarsCompactMode}
            allMessagesExpanded={acars.allMessagesExpanded}
            toggleAllMessages={acars.toggleAllMessages}
            acarsSortField={acarsSortField}
            acarsSortDirection={acarsSortDirection}
            handleAcarsSort={handleAcarsSort}
            filteredCount={sortedAcarsMessages.length}
            totalCount={acars.acarsMessages.length}
          />
          <AcarsQuickFilters
            acarsQuickFilters={acars.acarsQuickFilters}
            toggleQuickFilter={acars.toggleQuickFilter}
            clearQuickFilters={acars.clearQuickFilters}
          />
          <div
            ref={acars.acarsListRef}
            className={`acars-history-list ${acars.acarsCompactMode ? 'compact' : ''}`}
            onScroll={acars.handleAcarsScroll}
          >
            {sortedAcarsMessages.length === 0 ? (
              <div className="no-events-message">
                <MessageCircle size={32} />
                <p>No ACARS messages in the selected time range</p>
              </div>
            ) : (
              sortedAcarsMessages
                .slice(0, acars.visibleAcarsCount)
                .map((msg, i) => (
                  <AcarsMessageItem
                    key={i}
                    msg={msg}
                    index={i}
                    callsignHexCache={acars.callsignHexCache}
                    regHexCache={acars.regHexCache}
                    labelReference={acars.labelReference}
                    allMessagesExpanded={acars.allMessagesExpanded}
                    expandedMessages={acars.expandedMessages}
                    toggleMessageExpansion={acars.toggleMessageExpansion}
                    onSelectAircraft={onSelectAircraft}
                    onSelectByTail={onSelectByTail}
                  />
                ))
            )}
            {acars.visibleAcarsCount < sortedAcarsMessages.length && (
              <div className="acars-load-more">
                Showing {acars.visibleAcarsCount} of {sortedAcarsMessages.length} - scroll for more
              </div>
            )}
          </div>
        </>
      )}

      {/* NOTAMs Tab Content */}
      {viewType === 'notams' && (
        <div className="notams-view">
          <div className="notams-header">
            <div className="header-title">
              <FileWarning size={24} />
              <h2>NOTAMs & TFRs</h2>
              <div
                className={`connection-indicator ${notamsConnected ? 'connected' : 'disconnected'}`}
              >
                {notamsConnected ? 'Live' : 'Offline'}
              </div>
            </div>
            <div className="header-actions">
              <button
                className="refresh-btn"
                onClick={handleNotamRefresh}
                disabled={!notamsConnected}
                title="Refresh NOTAMs"
              >
                <RefreshCw size={16} />
              </button>
              {!notamsConnected && (
                <button className="reconnect-btn" onClick={notamReconnect}>
                  Reconnect
                </button>
              )}
            </div>
          </div>

          <NotamStats stats={notamStats} />

          <div className="notams-toolbar">
            <div className="tab-buttons">
              <button
                className={notamSubTab === 'all' ? 'active' : ''}
                onClick={() => setNotamSubTab('all')}
              >
                <FileWarning size={16} /> All NOTAMs <span className="count">{notams.length}</span>
              </button>
              <button
                className={notamSubTab === 'tfrs' ? 'active' : ''}
                onClick={() => setNotamSubTab('tfrs')}
              >
                <Shield size={16} /> TFRs <span className="count">{tfrs.length}</span>
              </button>
              {selectedAirport && (
                <button
                  className={notamSubTab === 'airport' ? 'active' : ''}
                  onClick={() => setNotamSubTab('airport')}
                >
                  <Plane size={16} /> {selectedAirport}
                  <span className="count">{airportNotams?.length || 0}</span>
                  <X
                    size={14}
                    className="close-tab"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedAirport(null);
                      setAirportNotams(null);
                      if (notamSubTab === 'airport') setNotamSubTab('all');
                    }}
                  />
                </button>
              )}
            </div>
            <div className="filter-controls">
              <div className="search-box">
                <Search size={16} />
                <input
                  type="text"
                  value={notamSearchQuery}
                  onChange={(e) => setNotamSearchQuery(e.target.value)}
                  placeholder="Search NOTAMs..."
                />
                {notamSearchQuery && (
                  <button className="clear-search" onClick={() => setNotamSearchQuery('')}>
                    <X size={14} />
                  </button>
                )}
              </div>
              {notamSubTab === 'all' && (
                <select
                  value={notamTypeFilter}
                  onChange={(e) => setNotamTypeFilter(e.target.value)}
                  className="type-filter"
                >
                  <option value="all">All Types</option>
                  {Object.entries(NOTAM_TYPES).map(([key, { label }]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <AirportSearch onSearch={handleAirportSearch} loading={airportLoading} />

          <div className="notams-content">
            {notamsLoading && !notams.length ? (
              <div className="loading-state">
                <Loader2 size={32} className="spin" />
                <p>Loading NOTAMs...</p>
              </div>
            ) : notamsError && !notams.length ? (
              <div className="error-state">
                <AlertTriangle size={32} />
                <p>{notamsError}</p>
                <button onClick={notamReconnect}>Retry Connection</button>
              </div>
            ) : notamDisplayList.length === 0 ? (
              <div className="empty-state">
                <FileWarning size={48} />
                <p>No NOTAMs found</p>
                {notamSearchQuery && <span>Try adjusting your search criteria</span>}
              </div>
            ) : (
              <div className="notams-list">
                {notamSubTab === 'tfrs' ? (
                  <div className="tfr-grid">
                    {notamDisplayList.map((tfr) => (
                      <TfrCard
                        key={tfr.notam_id}
                        tfr={tfr}
                        onViewDetails={() =>
                          setNotamExpandedId(notamExpandedId === tfr.notam_id ? null : tfr.notam_id)
                        }
                      />
                    ))}
                  </div>
                ) : (
                  notamDisplayList.map((notam) => (
                    <NotamCard
                      key={notam.notam_id}
                      notam={notam}
                      expanded={notamExpandedId === notam.notam_id}
                      onToggle={() =>
                        setNotamExpandedId(
                          notamExpandedId === notam.notam_id ? null : notam.notam_id
                        )
                      }
                    />
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* PIREPs Tab Content */}
      {viewType === 'pireps' && (
        <div className="archive-view">
          <div className="archive-header">
            <div className="header-title">
              <Cloud size={24} />
              <h2>Historical PIREPs</h2>
            </div>
          </div>

          <ArchiveStats stats={archiveStats} loading={archiveStatsLoading} />

          <div className="archive-toolbar">
            <div className="filter-controls">
              <div className="search-box">
                <Search size={16} />
                <input
                  type="text"
                  value={archiveSearchQuery}
                  onChange={(e) => setArchiveSearchQuery(e.target.value)}
                  placeholder="Search PIREPs..."
                />
                {archiveSearchQuery && (
                  <button className="clear-search" onClick={() => setArchiveSearchQuery('')}>
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className="icao-filter">
                <MapPin size={14} />
                <input
                  type="text"
                  value={archiveIcaoFilter}
                  onChange={(e) => setArchiveIcaoFilter(e.target.value.toUpperCase())}
                  placeholder="ICAO"
                  maxLength={4}
                />
              </div>

              <select
                value={archiveTypeFilter}
                onChange={(e) => setArchiveTypeFilter(e.target.value)}
                className="type-filter"
              >
                <option value="all">All Types</option>
                <option value="UA">Routine (UA)</option>
                <option value="UUA">Urgent (UUA)</option>
              </select>

              <div className="hazard-filter-wrapper">
                <Wind size={14} />
                <select
                  value={archiveHazardFilter}
                  onChange={(e) => setArchiveHazardFilter(e.target.value)}
                  className="hazard-filter"
                >
                  {Object.entries(HAZARD_FILTERS).map(([key, { label }]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="altitude-filter-wrapper">
                <Thermometer size={14} />
                <select
                  value={archiveAltitudeFilter}
                  onChange={(e) => setArchiveAltitudeFilter(e.target.value)}
                  className="altitude-filter"
                >
                  {Object.entries(ALTITUDE_RANGES).map(([key, { label }]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <select
                value={archiveDateRange}
                onChange={(e) => setArchiveDateRange(parseInt(e.target.value) || 30)}
                className="date-filter"
              >
                {DATE_RANGES.filter((r) => r.value !== 'custom').map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="archive-content">
            {archiveLoading ? (
              <div className="loading-state">
                <Loader2 size={32} className="spin" />
                <p>Loading PIREPs...</p>
              </div>
            ) : archiveError ? (
              <div className="error-state">
                <AlertTriangle size={32} />
                <p>{archiveError}</p>
                <button onClick={() => setArchiveOffset(0)}>Retry</button>
              </div>
            ) : archiveCurrentData.length === 0 ? (
              <div className="empty-state">
                <Cloud size={48} />
                <p>No PIREPs found</p>
                {(archiveSearchQuery || archiveIcaoFilter || archiveTypeFilter !== 'all') && (
                  <span>Try adjusting your filters</span>
                )}
              </div>
            ) : (
              <>
                <div className="archive-list">
                  {filteredArchivedPireps.map((pirep) => (
                    <ArchivedPirepCard
                      key={pirep.pirep_id}
                      pirep={pirep}
                      expanded={archiveExpandedId === pirep.pirep_id}
                      onToggle={() =>
                        setArchiveExpandedId(
                          archiveExpandedId === pirep.pirep_id ? null : pirep.pirep_id
                        )
                      }
                    />
                  ))}
                </div>

                <div className="archive-pagination">
                  <button
                    disabled={!archiveHasPrev}
                    onClick={() => setArchiveOffset(Math.max(0, archiveOffset - archiveLimit))}
                  >
                    Previous
                  </button>
                  <span className="pagination-info">
                    Showing {archiveOffset + 1}-
                    {Math.min(archiveOffset + archiveLimit, archiveTotalCount)} of{' '}
                    {archiveTotalCount}
                  </span>
                  <button
                    disabled={!archiveHasMore}
                    onClick={() => setArchiveOffset(archiveOffset + archiveLimit)}
                  >
                    Next
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Archive Tab Content (Expired NOTAMs) */}
      {viewType === 'archive' && (
        <div className="archive-view">
          <div className="archive-header">
            <div className="header-title">
              <Archive size={24} />
              <h2>Expired NOTAMs Archive</h2>
            </div>
          </div>

          <ArchiveStats stats={archiveStats} loading={archiveStatsLoading} />

          <div className="archive-toolbar">
            <div className="filter-controls">
              <div className="search-box">
                <Search size={16} />
                <input
                  type="text"
                  value={archiveSearchQuery}
                  onChange={(e) => setArchiveSearchQuery(e.target.value)}
                  placeholder="Search archived NOTAMs..."
                />
                {archiveSearchQuery && (
                  <button className="clear-search" onClick={() => setArchiveSearchQuery('')}>
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className="icao-filter">
                <MapPin size={14} />
                <input
                  type="text"
                  value={archiveIcaoFilter}
                  onChange={(e) => setArchiveIcaoFilter(e.target.value.toUpperCase())}
                  placeholder="ICAO"
                  maxLength={4}
                />
              </div>

              <select
                value={archiveTypeFilter}
                onChange={(e) => setArchiveTypeFilter(e.target.value)}
                className="type-filter"
              >
                <option value="all">All Types</option>
                {Object.entries(ARCHIVE_NOTAM_TYPES).map(([key, { label }]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>

              <select
                value={archiveDateRange}
                onChange={(e) => setArchiveDateRange(parseInt(e.target.value) || 30)}
                className="date-filter"
              >
                {DATE_RANGES.filter((r) => r.value !== 'custom').map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="archive-content">
            {archiveLoading ? (
              <div className="loading-state">
                <Loader2 size={32} className="spin" />
                <p>Loading archived NOTAMs...</p>
              </div>
            ) : archiveError ? (
              <div className="error-state">
                <AlertTriangle size={32} />
                <p>{archiveError}</p>
                <button onClick={() => setArchiveOffset(0)}>Retry</button>
              </div>
            ) : archiveCurrentData.length === 0 ? (
              <div className="empty-state">
                <Archive size={48} />
                <p>No archived NOTAMs found</p>
                {(archiveSearchQuery || archiveIcaoFilter || archiveTypeFilter !== 'all') && (
                  <span>Try adjusting your filters</span>
                )}
              </div>
            ) : (
              <>
                <div className="archive-list">
                  {archivedNotams.map((notam) => (
                    <ArchivedNotamCard
                      key={notam.notam_id}
                      notam={notam}
                      expanded={archiveExpandedId === notam.notam_id}
                      onToggle={() =>
                        setArchiveExpandedId(
                          archiveExpandedId === notam.notam_id ? null : notam.notam_id
                        )
                      }
                    />
                  ))}
                </div>

                <div className="archive-pagination">
                  <button
                    disabled={!archiveHasPrev}
                    onClick={() => setArchiveOffset(Math.max(0, archiveOffset - archiveLimit))}
                  >
                    Previous
                  </button>
                  <span className="pagination-info">
                    Showing {archiveOffset + 1}-
                    {Math.min(archiveOffset + archiveLimit, archiveTotalCount)} of{' '}
                    {archiveTotalCount}
                  </span>
                  <button
                    disabled={!archiveHasMore}
                    onClick={() => setArchiveOffset(archiveOffset + archiveLimit)}
                  >
                    Next
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
