import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  Search,
  MessageCircle,
  Bell,
  VolumeX,
  Filter,
  Layers,
  Navigation,
  Activity,
  Crosshair,
  Maximize2,
  Minimize2,
  AlertTriangle,
  FileWarning,
  X,
} from 'lucide-react';
import { SearchAutocomplete, searchAircraft } from './SearchAutocomplete';
import { ZuluClock } from './ZuluClock';
import { useSearchHistory } from '../../../hooks/useSearchHistory';

/**
 * ProSearchBar component - Enhanced search bar with autocomplete for Pro mode
 */
export function ProSearchBar({
  config,
  setConfig,
  searchQuery,
  setSearchQuery,
  soundMuted,
  setSoundMuted,
  showAcarsPanel,
  setShowAcarsPanel,
  showAdvisoryPanel,
  setShowAdvisoryPanel,
  advisoryCount,
  showNotamPanel,
  setShowNotamPanel,
  notamCount,
  showFilterMenu,
  setShowFilterMenu,
  showOverlayMenu,
  setShowOverlayMenu,
  showShortTracks,
  setShowShortTracks,
  showSelectedTrack,
  setShowSelectedTrack,
  selectedAircraft,
  proPanOffset,
  setProPanOffset,
  followingAircraft,
  setFollowingAircraft,
  setHashParams,
  isFullscreen,
  toggleFullscreen,
  acarsStatus,
  // New props for enhanced search
  aircraft = [],
  aircraftInfo = {},
  onSelectAircraft,
  setHighlightedHexes,
}) {
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  // Search history hook
  const { recentSearches, addSearch, removeSearch, clearHistory } = useSearchHistory();

  // Search results
  const searchResults = useMemo(() => {
    if (!searchQuery || !searchQuery.trim() || !aircraft) return [];
    return searchAircraft(searchQuery, aircraft, aircraftInfo, 10);
  }, [searchQuery, aircraft, aircraftInfo]);

  // Combined items for keyboard navigation
  const navigationItems = useMemo(() => {
    if (searchQuery && searchQuery.trim()) {
      return searchResults;
    }
    return recentSearches;
  }, [searchQuery, searchResults, recentSearches]);

  // Update highlighted aircraft based on search
  useEffect(() => {
    if (setHighlightedHexes) {
      if (searchQuery && searchQuery.trim() && searchResults.length > 0) {
        const hexes = searchResults.map((ac) => ac.hex).filter(Boolean);
        setHighlightedHexes(hexes);
      } else {
        setHighlightedHexes([]);
      }
    }
  }, [searchResults, searchQuery, setHighlightedHexes]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e) => {
      if (!isDropdownOpen) {
        if (e.key === 'ArrowDown' || e.key === 'Enter') {
          setIsDropdownOpen(true);
          setSelectedIndex(0);
          e.preventDefault();
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev < navigationItems.length - 1 ? prev + 1 : 0));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : navigationItems.length - 1));
          break;
        case 'Enter':
          e.preventDefault();
          if (selectedIndex >= 0 && selectedIndex < navigationItems.length) {
            const item = navigationItems[selectedIndex];
            if (searchQuery && searchQuery.trim()) {
              // Select search result
              onSelectAircraft?.(item);
              addSearch(searchQuery, item);
              setSearchQuery('');
              setIsDropdownOpen(false);
              setSelectedIndex(-1);
            } else {
              // Select from history
              setSearchQuery(item.query);
              setSelectedIndex(-1);
            }
          }
          break;
        case 'Escape':
          e.preventDefault();
          setIsDropdownOpen(false);
          setSelectedIndex(-1);
          inputRef.current?.blur();
          break;
        case 'Tab':
          setIsDropdownOpen(false);
          setSelectedIndex(-1);
          break;
        default:
          break;
      }
    },
    [
      isDropdownOpen,
      navigationItems,
      selectedIndex,
      searchQuery,
      onSelectAircraft,
      addSearch,
      setSearchQuery,
    ]
  );

  // Handle selecting a search result
  const handleSelectResult = useCallback(
    (ac) => {
      if (!ac) return;

      // Add to search history
      addSearch(searchQuery, ac);

      // Notify parent to select aircraft
      if (onSelectAircraft) {
        onSelectAircraft(ac);
      }

      // Clear search and close dropdown
      setSearchQuery('');
      setIsDropdownOpen(false);
      setSelectedIndex(-1);
    },
    [searchQuery, addSearch, onSelectAircraft, setSearchQuery]
  );

  // Handle selecting from recent searches
  const handleSelectRecent = useCallback(
    (query) => {
      setSearchQuery(query);
      setSelectedIndex(-1);
      // Keep dropdown open to show results
    },
    [setSearchQuery]
  );

  // Handle input focus
  const handleFocus = useCallback(() => {
    setIsDropdownOpen(true);
    setSelectedIndex(-1);
  }, []);

  // Handle input change
  const handleChange = useCallback(
    (e) => {
      setSearchQuery(e.target.value);
      setSelectedIndex(-1);
      if (!isDropdownOpen) {
        setIsDropdownOpen(true);
      }
    },
    [setSearchQuery, isDropdownOpen]
  );

  // Handle closing dropdown
  const handleCloseDropdown = useCallback(() => {
    setIsDropdownOpen(false);
    setSelectedIndex(-1);
  }, []);

  // Clear search
  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    setHighlightedHexes?.([]);
    inputRef.current?.focus();
  }, [setSearchQuery, setHighlightedHexes]);

  if (config.mapMode !== 'pro') return null;

  return (
    <div className="pro-search-bar" ref={containerRef}>
      <div className="pro-search-container">
        <Search size={18} className="search-icon" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search callsign, registration, squawk, type, operator..."
          value={searchQuery}
          onChange={handleChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          className="search-input"
          role="combobox"
          aria-expanded={isDropdownOpen}
          aria-haspopup="listbox"
          aria-controls="search-autocomplete"
          aria-autocomplete="list"
        />
        {searchQuery && (
          <button
            className="search-clear-btn"
            onClick={handleClearSearch}
            title="Clear search"
            type="button"
          >
            <X size={14} />
          </button>
        )}
        {searchQuery.startsWith('/') && (
          <span
            style={{
              fontSize: 9,
              color: '#0ff',
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              fontFamily: 'monospace',
              opacity: 0.7,
              pointerEvents: 'none',
              zIndex: 2,
            }}
          >
            REGEX
          </span>
        )}
        <SearchAutocomplete
          query={searchQuery}
          results={searchResults}
          recentSearches={recentSearches}
          selectedIndex={selectedIndex}
          onSelect={handleSelectResult}
          onSelectRecent={handleSelectRecent}
          onRemoveRecent={removeSearch}
          onClearHistory={clearHistory}
          onClose={handleCloseDropdown}
          isOpen={isDropdownOpen}
        />
      </div>

      <div className="pro-header-right">
        <ZuluClock />
        {acarsStatus && (
          <div
            className={`acars-status-badge ${acarsStatus.running ? 'running' : 'stopped'}`}
            title={`ACARS: ${acarsStatus.running ? 'Running' : 'Stopped'}`}
          >
            <MessageCircle size={12} />
            <span>{acarsStatus.buffer_size || 0}</span>
          </div>
        )}
        <button
          className={`pro-header-btn ${soundMuted ? 'muted' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setSoundMuted(!soundMuted);
          }}
          title={soundMuted ? 'Unmute' : 'Mute'}
          type="button"
        >
          {soundMuted ? <VolumeX size={18} /> : <Bell size={18} />}
        </button>
        <button
          className={`pro-header-btn ${showAcarsPanel ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setShowAcarsPanel(!showAcarsPanel);
          }}
          title="ACARS Messages"
          type="button"
        >
          <MessageCircle size={18} />
        </button>
        <button
          className={`pro-header-btn ${showAdvisoryPanel ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setShowAdvisoryPanel?.(!showAdvisoryPanel);
          }}
          title="Airspace Advisories"
          type="button"
        >
          <AlertTriangle size={18} />
          {advisoryCount > 0 && <span className="advisory-badge">{advisoryCount}</span>}
        </button>
        {setShowNotamPanel && (
          <button
            className={`pro-header-btn ${showNotamPanel ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setShowNotamPanel(!showNotamPanel);
            }}
            title="NOTAMs"
            type="button"
          >
            <FileWarning size={18} />
            {notamCount > 0 && <span className="notam-badge">{notamCount}</span>}
          </button>
        )}
        <button
          className={`pro-header-btn ${showFilterMenu ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setShowFilterMenu(!showFilterMenu);
            setShowOverlayMenu(false);
          }}
          title="Traffic Filters"
          type="button"
        >
          <Filter size={18} />
        </button>
        <button
          className={`pro-header-btn ${showOverlayMenu ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setShowOverlayMenu(!showOverlayMenu);
            setShowFilterMenu(false);
          }}
          title="Map Layers"
          type="button"
        >
          <Layers size={18} />
        </button>
        <button
          className={`pro-header-btn ${showShortTracks ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setShowShortTracks(!showShortTracks);
          }}
          title={
            showShortTracks ? 'Hide short tracks (ATC trails)' : 'Show short tracks (ATC trails)'
          }
          type="button"
        >
          <Navigation size={18} />
        </button>
        {showShortTracks && (
          /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */
          <fieldset
            className="pro-track-length-slider"
            onClick={(e) => e.stopPropagation()}
            aria-label="Track length slider"
          >
            <input
              type="range"
              min="5"
              max="60"
              step="5"
              value={config.shortTrackLength || 15}
              onChange={(e) => setConfig({ ...config, shortTrackLength: parseInt(e.target.value) })}
              title={`Trail length: ${config.shortTrackLength || 15} positions`}
            />
            <span className="track-length-value">{config.shortTrackLength || 15}</span>
          </fieldset>
        )}
        <button
          className={`pro-header-btn ${showSelectedTrack ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setShowSelectedTrack(!showSelectedTrack);
          }}
          title={showSelectedTrack ? 'Hide flight track' : 'Show flight track'}
          disabled={!selectedAircraft}
          type="button"
        >
          <Activity size={18} />
        </button>
        <button
          className={`pro-header-btn ${proPanOffset.x !== 0 || proPanOffset.y !== 0 || followingAircraft ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setProPanOffset({ x: 0, y: 0 });
            setFollowingAircraft(null);
            if (setHashParams) {
              setHashParams({ panX: undefined, panY: undefined });
            }
          }}
          title="Re-center view (middle-click + drag to pan)"
          type="button"
        >
          <Crosshair size={18} />
        </button>
        <button
          className="pro-header-btn"
          onClick={(e) => {
            e.stopPropagation();
            toggleFullscreen();
          }}
          title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          type="button"
        >
          {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      </div>
    </div>
  );
}
