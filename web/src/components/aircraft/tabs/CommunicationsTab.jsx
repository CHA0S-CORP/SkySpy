import React, { useState, useMemo } from 'react';
import { Radio, MessageCircle, Search, Radar } from 'lucide-react';
import { RadioTab } from './RadioTab';
import { AcarsTab } from './AcarsTab';

/**
 * SubTabButton - Tab button for sub-navigation
 */
function SubTabButton({ id, label, icon: Icon, count, isActive, onClick }) {
  return (
    <button
      id={`subtab-${id}`}
      role="tab"
      aria-selected={isActive}
      aria-controls={`subpanel-${id}`}
      tabIndex={isActive ? 0 : -1}
      className={`comm-subtab ${isActive ? 'active' : ''}`}
      onClick={onClick}
    >
      <Icon size={14} aria-hidden="true" />
      <span>{label}</span>
      {count > 0 && (
        <span className="comm-subtab-badge" aria-label={`${count} items`}>
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * UnifiedSearchBar - Shared search across Radio and ACARS
 */
function UnifiedSearchBar({ searchQuery, setSearchQuery, timeRange, setTimeRange }) {
  return (
    <div className="comm-unified-toolbar">
      <div className="comm-search-box">
        <Search size={14} aria-hidden="true" />
        <input
          type="text"
          placeholder="Search all communications..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search radio and ACARS messages"
        />
      </div>
      <select
        className="comm-time-select"
        value={timeRange}
        onChange={(e) => setTimeRange(Number(e.target.value))}
        aria-label="Select time range"
      >
        <option value={1}>Last 1h</option>
        <option value={6}>Last 6h</option>
        <option value={12}>Last 12h</option>
        <option value={24}>Last 24h</option>
        <option value={48}>Last 48h</option>
        <option value={168}>Last 7d</option>
      </select>
    </div>
  );
}

/**
 * CommunicationsTab - Combined Radio + ACARS tab with sub-tabs
 *
 * Layout:
 * - Unified toolbar with search and time range (shared)
 * - Sub-tabs: Radio, ACARS
 * - Content area for selected sub-tab
 */
export function CommunicationsTab({
  hex,
  // Radio props
  radioLoading,
  radioTransmissions,
  filteredRadioTransmissions,
  radioHours,
  setRadioHours,
  radioSearchQuery,
  setRadioSearchQuery,
  radioStatusFilter,
  setRadioStatusFilter,
  radioPlayingId,
  radioAudioProgress,
  radioAudioDurations,
  radioExpandedTranscript,
  setRadioExpandedTranscript,
  radioAutoplay,
  handleRadioPlay,
  handleRadioSeek,
  toggleRadioAutoplay,
  // ACARS props
  acarsMessages,
  acarsHours,
  setAcarsHours,
  acarsCompactMode,
  setAcarsCompactMode,
  acarsQuickFilters,
  setAcarsQuickFilters,
  expandedMessages,
  setExpandedMessages,
  allMessagesExpanded,
  setAllMessagesExpanded,
}) {
  // Active sub-tab state
  const [activeSubTab, setActiveSubTab] = useState('radio');

  // Unified search and time range
  const [unifiedSearch, setUnifiedSearch] = useState('');
  const [unifiedTimeRange, setUnifiedTimeRange] = useState(24);

  // Sync unified controls with individual tab controls
  const handleUnifiedSearchChange = (query) => {
    setUnifiedSearch(query);
    setRadioSearchQuery(query);
    // ACARS doesn't have a search query prop in the current implementation
  };

  const handleUnifiedTimeRangeChange = (hours) => {
    setUnifiedTimeRange(hours);
    setRadioHours(hours);
    setAcarsHours(hours);
  };

  // Calculate total counts
  const radioCount = filteredRadioTransmissions?.length || radioTransmissions?.length || 0;
  const acarsCount = acarsMessages?.length || 0;

  // Loading state
  const isLoading = radioLoading;

  if (isLoading) {
    return (
      <div className="detail-loading" role="status" aria-busy="true">
        <div className="detail-loading-radar">
          <Radar size={32} className="detail-radar-icon" aria-hidden="true" />
          <div className="detail-radar-sweep" />
        </div>
        <span>Loading communications...</span>
      </div>
    );
  }

  return (
    <div
      className="communications-tab"
      id="panel-communications"
      role="tabpanel"
      aria-labelledby="tab-communications"
    >
      {/* Unified Search Bar */}
      <UnifiedSearchBar
        searchQuery={unifiedSearch}
        setSearchQuery={handleUnifiedSearchChange}
        timeRange={unifiedTimeRange}
        setTimeRange={handleUnifiedTimeRangeChange}
      />

      {/* Sub-Tab Navigation */}
      <nav className="comm-subtabs" role="tablist" aria-label="Communication types">
        <SubTabButton
          id="radio"
          label="Radio"
          icon={Radio}
          count={radioCount}
          isActive={activeSubTab === 'radio'}
          onClick={() => setActiveSubTab('radio')}
        />
        <SubTabButton
          id="acars"
          label="ACARS"
          icon={MessageCircle}
          count={acarsCount}
          isActive={activeSubTab === 'acars'}
          onClick={() => setActiveSubTab('acars')}
        />
      </nav>

      {/* Sub-Tab Content */}
      <div className="comm-content">
        {activeSubTab === 'radio' && (
          <div id="subpanel-radio" role="tabpanel" aria-labelledby="subtab-radio">
            <RadioTab
              hex={hex}
              radioLoading={false} // Already handled above
              radioTransmissions={radioTransmissions}
              filteredRadioTransmissions={filteredRadioTransmissions}
              radioHours={radioHours}
              setRadioHours={setRadioHours}
              radioSearchQuery={radioSearchQuery}
              setRadioSearchQuery={setRadioSearchQuery}
              radioStatusFilter={radioStatusFilter}
              setRadioStatusFilter={setRadioStatusFilter}
              radioPlayingId={radioPlayingId}
              radioAudioProgress={radioAudioProgress}
              radioAudioDurations={radioAudioDurations}
              radioExpandedTranscript={radioExpandedTranscript}
              setRadioExpandedTranscript={setRadioExpandedTranscript}
              radioAutoplay={radioAutoplay}
              handleRadioPlay={handleRadioPlay}
              handleRadioSeek={handleRadioSeek}
              toggleRadioAutoplay={toggleRadioAutoplay}
            />
          </div>
        )}

        {activeSubTab === 'acars' && (
          <div id="subpanel-acars" role="tabpanel" aria-labelledby="subtab-acars">
            <AcarsTab
              acarsMessages={acarsMessages}
              acarsHours={acarsHours}
              setAcarsHours={setAcarsHours}
              acarsCompactMode={acarsCompactMode}
              setAcarsCompactMode={setAcarsCompactMode}
              acarsQuickFilters={acarsQuickFilters}
              setAcarsQuickFilters={setAcarsQuickFilters}
              expandedMessages={expandedMessages}
              setExpandedMessages={setExpandedMessages}
              allMessagesExpanded={allMessagesExpanded}
              setAllMessagesExpanded={setAllMessagesExpanded}
            />
          </div>
        )}
      </div>
    </div>
  );
}
