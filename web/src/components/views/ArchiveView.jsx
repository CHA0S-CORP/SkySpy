import React, { useState, useEffect } from 'react';
import {
  Archive, FileWarning, Cloud, Search, MapPin, AlertTriangle, Loader2, X
} from 'lucide-react';
import {
  ArchivedNotamCard, ArchivedPirepCard, ArchiveStats,
  NOTAM_TYPES, DATE_RANGES
} from '../archive';

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
    if (setHashParams) setHashParams({ tab });
  };

  // Fetch stats on mount
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(`${apiBase}/api/v1/archive/stats/`);
        if (!res.ok) {
          setStats({ notams: { total_archived: 0, by_type: {} }, pireps: { total_archived: 0, by_type: {} } });
          return;
        }
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          setStats({ notams: { total_archived: 0, by_type: {} }, pireps: { total_archived: 0, by_type: {} } });
          return;
        }
        const data = await res.json();
        setStats(data);
      } catch (err) {
        console.error('Failed to fetch archive stats:', err);
        setStats({ notams: { total_archived: 0, by_type: {} }, pireps: { total_archived: 0, by_type: {} } });
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
          <button className={activeTab === 'notams' ? 'active' : ''} onClick={() => handleTabChange('notams')}>
            <FileWarning size={16} /> Expired NOTAMs
            {notamsTotalCount > 0 && <span className="count">{notamsTotalCount}</span>}
          </button>
          <button className={activeTab === 'pireps' ? 'active' : ''} onClick={() => handleTabChange('pireps')}>
            <Cloud size={16} /> Historical PIREPs
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

          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="type-filter">
            <option value="all">All Types</option>
            {activeTab === 'notams' ? (
              Object.entries(NOTAM_TYPES).map(([key, { label }]) => (
                <option key={key} value={key}>{label}</option>
              ))
            ) : (
              <>
                <option value="UA">Routine (UA)</option>
                <option value="UUA">Urgent (UUA)</option>
              </>
            )}
          </select>

          <select value={dateRange} onChange={(e) => setDateRange(parseInt(e.target.value) || 30)} className="date-filter">
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
              <button disabled={!hasPrev} onClick={() => setOffset(Math.max(0, offset - limit))}>
                Previous
              </button>
              <span className="pagination-info">
                Showing {offset + 1}-{Math.min(offset + limit, totalCount)} of {totalCount}
              </span>
              <button disabled={!hasMore} onClick={() => setOffset(offset + limit)}>
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
