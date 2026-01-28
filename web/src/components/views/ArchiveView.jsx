import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Archive, FileWarning, Cloud, ChevronDown, ChevronUp, Search, Filter,
  Calendar, Clock, MapPin, AlertTriangle, Plane, RefreshCw, X,
  Navigation, Info, AlertCircle, Shield, Loader2, ThermometerSnowflake,
  Wind, CloudRain
} from 'lucide-react';

// NOTAM type icons and colors (same as NotamsView)
const NOTAM_TYPES = {
  D: { label: 'NOTAM D', color: '#60a5fa', icon: Info },
  FDC: { label: 'FDC NOTAM', color: '#f59e0b', icon: AlertCircle },
  TFR: { label: 'TFR', color: '#ef4444', icon: Shield },
  GPS: { label: 'GPS NOTAM', color: '#8b5cf6', icon: Navigation },
  MIL: { label: 'Military', color: '#10b981', icon: Shield },
  POINTER: { label: 'Pointer', color: '#6b7280', icon: Info },
};

// PIREP turbulence/icing severity colors
const SEVERITY_COLORS = {
  NEG: '#4ade80',
  TRC: '#86efac',
  LGT: '#a3e635',
  'LGT-MOD': '#facc15',
  'TRC-LGT': '#d9f99d',
  MOD: '#fb923c',
  'MOD-SEV': '#f87171',
  SEV: '#ef4444',
  EXTRM: '#dc2626',
};

// Date range options
const DATE_RANGES = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 'custom', label: 'Custom' },
];

// Format date for display
function formatDate(isoString) {
  if (!isoString) return 'N/A';
  const date = new Date(isoString);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Format relative time
function formatRelativeTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays > 1) return `${diffDays} days ago`;
  if (diffHours > 1) return `${diffHours} hours ago`;
  return 'recently';
}

// Archived NOTAM Card
function ArchivedNotamCard({ notam, expanded, onToggle }) {
  const typeInfo = NOTAM_TYPES[notam.notam_type] || NOTAM_TYPES.D;
  const TypeIcon = typeInfo.icon;

  return (
    <div
      className={`archive-card notam-card ${notam.notam_type?.toLowerCase()} ${expanded ? 'expanded' : ''}`}
      onClick={onToggle}
    >
      <div className="archive-card-header">
        <div className="archive-type-badge" style={{ backgroundColor: typeInfo.color }}>
          <TypeIcon size={14} />
          <span>{typeInfo.label}</span>
        </div>
        <div className="archive-location">
          <MapPin size={14} />
          <span>{notam.location || 'Unknown'}</span>
        </div>
        <div className="archive-id">{notam.notam_id}</div>
        <div className="archive-archived-badge">
          <Archive size={12} />
          <span>{formatRelativeTime(notam.archived_at)}</span>
        </div>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </div>

      <div className="archive-card-summary">
        <p className="archive-text-preview">
          {notam.text?.slice(0, 150)}{notam.text?.length > 150 ? '...' : ''}
        </p>
      </div>

      <div className="archive-card-meta">
        <div className="archive-time">
          <Clock size={12} />
          <span>Effective: {formatDate(notam.effective_start)}</span>
        </div>
        {notam.effective_end && !notam.is_permanent && (
          <div className="archive-time expired">
            <Calendar size={12} />
            <span>Expired: {formatDate(notam.effective_end)}</span>
          </div>
        )}
        {notam.is_permanent && (
          <div className="archive-permanent">
            <AlertTriangle size={12} />
            <span>Permanent</span>
          </div>
        )}
      </div>

      {expanded && (
        <div className="archive-card-details">
          <div className="archive-full-text">
            <h4>Full Text</h4>
            <pre>{notam.text}</pre>
          </div>

          {(notam.floor_ft != null || notam.ceiling_ft != null) && (
            <div className="archive-altitude">
              <h4>Altitude Restrictions</h4>
              <div className="altitude-range">
                {notam.floor_ft != null && <span>Floor: {notam.floor_ft} ft</span>}
                {notam.ceiling_ft != null && <span>Ceiling: {notam.ceiling_ft} ft</span>}
              </div>
            </div>
          )}

          {notam.radius_nm && (
            <div className="archive-radius">
              <h4>Radius</h4>
              <span>{notam.radius_nm} NM</span>
            </div>
          )}

          {(notam.latitude && notam.longitude) && (
            <div className="archive-coords">
              <h4>Coordinates</h4>
              <span>{notam.latitude.toFixed(4)}, {notam.longitude.toFixed(4)}</span>
            </div>
          )}

          <div className="archive-info">
            <h4>Archive Info</h4>
            <div className="archive-info-grid">
              <span>Archived: {formatDate(notam.archived_at)}</span>
              <span>Reason: {notam.archive_reason || 'expired'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Archived PIREP Card
function ArchivedPirepCard({ pirep, expanded, onToggle }) {
  const isUrgent = pirep.report_type === 'UUA';
  const hasTurbulence = pirep.turbulence_type && pirep.turbulence_type !== 'NEG';
  const hasIcing = pirep.icing_type && pirep.icing_type !== 'NEG';

  return (
    <div
      className={`archive-card pirep-card ${isUrgent ? 'urgent' : ''} ${expanded ? 'expanded' : ''}`}
      onClick={onToggle}
    >
      <div className="archive-card-header">
        <div className={`archive-type-badge pirep ${isUrgent ? 'urgent' : 'routine'}`}>
          <Cloud size={14} />
          <span>{isUrgent ? 'URGENT' : 'Routine'}</span>
        </div>
        <div className="archive-location">
          <MapPin size={14} />
          <span>{pirep.location || 'Unknown'}</span>
        </div>
        {pirep.aircraft_type && (
          <div className="archive-aircraft">
            <Plane size={12} />
            <span>{pirep.aircraft_type}</span>
          </div>
        )}
        <div className="archive-archived-badge">
          <Archive size={12} />
          <span>{formatRelativeTime(pirep.observation_time)}</span>
        </div>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </div>

      <div className="archive-card-conditions">
        {hasTurbulence && (
          <div
            className="condition-badge turbulence"
            style={{ borderColor: SEVERITY_COLORS[pirep.turbulence_type] }}
          >
            <Wind size={14} />
            <span>Turb: {pirep.turbulence_type}</span>
          </div>
        )}
        {hasIcing && (
          <div
            className="condition-badge icing"
            style={{ borderColor: SEVERITY_COLORS[pirep.icing_type] }}
          >
            <ThermometerSnowflake size={14} />
            <span>Ice: {pirep.icing_type}</span>
          </div>
        )}
        {pirep.flight_level && (
          <div className="condition-badge altitude">
            FL{pirep.flight_level}
          </div>
        )}
      </div>

      <div className="archive-card-meta">
        <div className="archive-time">
          <Clock size={12} />
          <span>Observed: {formatDate(pirep.observation_time)}</span>
        </div>
      </div>

      {expanded && (
        <div className="archive-card-details">
          {pirep.raw_text && (
            <div className="archive-full-text">
              <h4>Raw Report</h4>
              <pre>{pirep.raw_text}</pre>
            </div>
          )}

          <div className="pirep-details-grid">
            {pirep.altitude_ft && (
              <div className="pirep-detail">
                <span className="label">Altitude</span>
                <span className="value">{pirep.altitude_ft.toLocaleString()} ft</span>
              </div>
            )}
            {pirep.temperature_c != null && (
              <div className="pirep-detail">
                <span className="label">Temperature</span>
                <span className="value">{pirep.temperature_c}°C</span>
              </div>
            )}
            {pirep.wind_dir != null && pirep.wind_speed_kt != null && (
              <div className="pirep-detail">
                <span className="label">Wind</span>
                <span className="value">{pirep.wind_dir}° / {pirep.wind_speed_kt} kt</span>
              </div>
            )}
            {pirep.visibility_sm != null && (
              <div className="pirep-detail">
                <span className="label">Visibility</span>
                <span className="value">{pirep.visibility_sm} SM</span>
              </div>
            )}
            {pirep.sky_cover && (
              <div className="pirep-detail">
                <span className="label">Sky Cover</span>
                <span className="value">{pirep.sky_cover}</span>
              </div>
            )}
            {pirep.weather && (
              <div className="pirep-detail">
                <span className="label">Weather</span>
                <span className="value">{pirep.weather}</span>
              </div>
            )}
          </div>

          {hasTurbulence && (pirep.turbulence_base_ft || pirep.turbulence_top_ft) && (
            <div className="condition-details">
              <h4>Turbulence Details</h4>
              <div className="condition-range">
                {pirep.turbulence_base_ft && <span>Base: {pirep.turbulence_base_ft} ft</span>}
                {pirep.turbulence_top_ft && <span>Top: {pirep.turbulence_top_ft} ft</span>}
                {pirep.turbulence_freq && <span>Freq: {pirep.turbulence_freq}</span>}
              </div>
            </div>
          )}

          {hasIcing && (pirep.icing_base_ft || pirep.icing_top_ft) && (
            <div className="condition-details">
              <h4>Icing Details</h4>
              <div className="condition-range">
                {pirep.icing_base_ft && <span>Base: {pirep.icing_base_ft} ft</span>}
                {pirep.icing_top_ft && <span>Top: {pirep.icing_top_ft} ft</span>}
                {pirep.icing_intensity && <span>Intensity: {pirep.icing_intensity}</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Archive Stats Summary
function ArchiveStats({ stats, loading }) {
  if (loading || !stats) {
    return (
      <div className="archive-stats loading">
        <Loader2 size={20} className="spin" />
        <span>Loading statistics...</span>
      </div>
    );
  }

  return (
    <div className="archive-stats">
      <div className="stat-group">
        <h4>
          <FileWarning size={16} />
          NOTAMs
        </h4>
        <div className="stat-item">
          <span className="stat-value">{stats.notams?.total_archived || 0}</span>
          <span className="stat-label">Total Archived</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{stats.notams?.archived_last_30_days || 0}</span>
          <span className="stat-label">Last 30 Days</span>
        </div>
      </div>
      <div className="stat-group">
        <h4>
          <Cloud size={16} />
          PIREPs
        </h4>
        <div className="stat-item">
          <span className="stat-value">{stats.pireps?.total_archived || 0}</span>
          <span className="stat-label">Total Archived</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{stats.pireps?.total_records || 0}</span>
          <span className="stat-label">Total Records</span>
        </div>
      </div>
    </div>
  );
}

// Main ArchiveView component
export function ArchiveView({ apiBase, hashParams = {}, setHashParams }) {
  const [activeTab, setActiveTab] = useState(hashParams.tab || 'notams');
  const [dateRange, setDateRange] = useState(30);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [icaoFilter, setIcaoFilter] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Data states
  const [notams, setNotams] = useState([]);
  const [notamsTotalCount, setNotamsTotalCount] = useState(0);
  const [pireps, setPireps] = useState([]);
  const [pirepsTotalCount, setPirepsTotalCount] = useState(0);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Pagination
  const [offset, setOffset] = useState(0);
  const limit = 50;

  // Sync tab with URL
  useEffect(() => {
    if (hashParams.tab && hashParams.tab !== activeTab) {
      setActiveTab(hashParams.tab);
    }
  }, [hashParams.tab]);

  // Update URL when tab changes
  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setOffset(0);
    setExpandedId(null);
    if (setHashParams) {
      setHashParams({ tab });
    }
  };

  // Fetch stats on mount
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(`${apiBase}/api/v1/archive/stats/`);
        if (!res.ok) {
          // Endpoint may not exist - provide default stats
          setStats({
            notams: { total_archived: 0, by_type: {} },
            pireps: { total_archived: 0, by_type: {} },
          });
          return;
        }
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          // Non-JSON response - endpoint not available
          setStats({
            notams: { total_archived: 0, by_type: {} },
            pireps: { total_archived: 0, by_type: {} },
          });
          return;
        }
        const data = await res.json();
        setStats(data);
      } catch (err) {
        console.error('Failed to fetch archive stats:', err);
        // Provide default stats on error
        setStats({
          notams: { total_archived: 0, by_type: {} },
          pireps: { total_archived: 0, by_type: {} },
        });
      } finally {
        setStatsLoading(false);
      }
    };
    fetchStats();
  }, [apiBase]);

  // Fetch data based on active tab
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set('days', dateRange.toString());
        params.set('limit', limit.toString());
        params.set('offset', offset.toString());

        if (searchQuery) params.set('search', searchQuery);
        if (icaoFilter) params.set('icao', icaoFilter.toUpperCase());

        if (activeTab === 'notams') {
          if (typeFilter !== 'all') params.set('type', typeFilter);

          const res = await fetch(`${apiBase}/api/v1/archive/notams/?${params.toString()}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const contentType = res.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Invalid response format');
          }
          const data = await res.json();
          setNotams(data.notams || []);
          setNotamsTotalCount(data.total_count || 0);
        } else if (activeTab === 'pireps') {
          if (typeFilter !== 'all') params.set('report_type', typeFilter);

          const res = await fetch(`${apiBase}/api/v1/archive/pireps/?${params.toString()}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const contentType = res.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Invalid response format');
          }
          const data = await res.json();
          setPireps(data.pireps || []);
          setPirepsTotalCount(data.total_count || 0);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [apiBase, activeTab, dateRange, searchQuery, typeFilter, icaoFilter, offset]);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [searchQuery, typeFilter, icaoFilter, dateRange]);

  // Get current data and count based on tab
  const currentData = activeTab === 'notams' ? notams : pireps;
  const totalCount = activeTab === 'notams' ? notamsTotalCount : pirepsTotalCount;
  const hasMore = offset + limit < totalCount;
  const hasPrev = offset > 0;

  return (
    <div className="archive-view">
      <div className="archive-header">
        <div className="header-title">
          <Archive size={24} />
          <h2>Historical Archive</h2>
        </div>
      </div>

      <ArchiveStats stats={stats} loading={statsLoading} />

      <div className="archive-toolbar">
        <div className="tab-buttons">
          <button
            className={activeTab === 'notams' ? 'active' : ''}
            onClick={() => handleTabChange('notams')}
          >
            <FileWarning size={16} />
            Expired NOTAMs
            {notamsTotalCount > 0 && <span className="count">{notamsTotalCount}</span>}
          </button>
          <button
            className={activeTab === 'pireps' ? 'active' : ''}
            onClick={() => handleTabChange('pireps')}
          >
            <Cloud size={16} />
            Historical PIREPs
            {pirepsTotalCount > 0 && <span className="count">{pirepsTotalCount}</span>}
          </button>
        </div>

        <div className="filter-controls">
          <div className="search-box">
            <Search size={16} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={activeTab === 'notams' ? 'Search NOTAMs...' : 'Search PIREPs...'}
            />
            {searchQuery && (
              <button className="clear-search" onClick={() => setSearchQuery('')}>
                <X size={14} />
              </button>
            )}
          </div>

          <div className="icao-filter">
            <MapPin size={14} />
            <input
              type="text"
              value={icaoFilter}
              onChange={(e) => setIcaoFilter(e.target.value.toUpperCase())}
              placeholder="ICAO"
              maxLength={4}
            />
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="type-filter"
          >
            <option value="all">All Types</option>
            {activeTab === 'notams' ? (
              <>
                {Object.entries(NOTAM_TYPES).map(([key, { label }]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </>
            ) : (
              <>
                <option value="UA">Routine (UA)</option>
                <option value="UUA">Urgent (UUA)</option>
              </>
            )}
          </select>

          <select
            value={dateRange}
            onChange={(e) => setDateRange(parseInt(e.target.value) || 30)}
            className="date-filter"
          >
            {DATE_RANGES.filter(r => r.value !== 'custom').map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="archive-content">
        {loading ? (
          <div className="loading-state">
            <Loader2 size={32} className="spin" />
            <p>Loading archived data...</p>
          </div>
        ) : error ? (
          <div className="error-state">
            <AlertTriangle size={32} />
            <p>{error}</p>
            <button onClick={() => setOffset(0)}>Retry</button>
          </div>
        ) : currentData.length === 0 ? (
          <div className="empty-state">
            <Archive size={48} />
            <p>No archived {activeTab === 'notams' ? 'NOTAMs' : 'PIREPs'} found</p>
            {(searchQuery || icaoFilter || typeFilter !== 'all') && (
              <span>Try adjusting your filters</span>
            )}
          </div>
        ) : (
          <>
            <div className="archive-list">
              {activeTab === 'notams' ? (
                notams.map(notam => (
                  <ArchivedNotamCard
                    key={notam.notam_id}
                    notam={notam}
                    expanded={expandedId === notam.notam_id}
                    onToggle={() => setExpandedId(expandedId === notam.notam_id ? null : notam.notam_id)}
                  />
                ))
              ) : (
                pireps.map(pirep => (
                  <ArchivedPirepCard
                    key={pirep.pirep_id}
                    pirep={pirep}
                    expanded={expandedId === pirep.pirep_id}
                    onToggle={() => setExpandedId(expandedId === pirep.pirep_id ? null : pirep.pirep_id)}
                  />
                ))
              )}
            </div>

            <div className="archive-pagination">
              <button
                disabled={!hasPrev}
                onClick={() => setOffset(Math.max(0, offset - limit))}
              >
                Previous
              </button>
              <span className="pagination-info">
                Showing {offset + 1}-{Math.min(offset + limit, totalCount)} of {totalCount}
              </span>
              <button
                disabled={!hasMore}
                onClick={() => setOffset(offset + limit)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ArchiveView;
