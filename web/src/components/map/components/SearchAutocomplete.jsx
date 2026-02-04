import React, { useEffect, useRef } from 'react';
import { Search, Clock, X, ChevronRight, Plane, Hash, Radio, User } from 'lucide-react';

/**
 * Simple Levenshtein distance for fuzzy matching.
 * Returns edit distance between two strings.
 */
function levenshteinDistance(a, b) {
  if (!a || !b) return Math.max(a?.length || 0, b?.length || 0);

  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate fuzzy match score (0-1, higher is better).
 * Combines exact match, prefix match, contains match, and Levenshtein similarity.
 */
function fuzzyScore(query, target) {
  if (!query || !target) return 0;

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Exact match
  if (q === t) return 1;

  // Prefix match (very high score)
  if (t.startsWith(q)) return 0.9 + 0.1 * (q.length / t.length);

  // Contains match
  if (t.includes(q)) return 0.7 + 0.1 * (q.length / t.length);

  // Levenshtein similarity for typos
  // Only use if strings are similar length (avoid matching completely different strings)
  if (Math.abs(q.length - t.length) <= 3) {
    const maxLen = Math.max(q.length, t.length);
    const distance = levenshteinDistance(q, t);
    const similarity = 1 - distance / maxLen;

    // Only count if reasonably similar (> 50% match)
    if (similarity > 0.5) {
      return similarity * 0.6; // Scale down fuzzy matches
    }
  }

  return 0;
}

/**
 * Search aircraft with multi-field matching and fuzzy search.
 *
 * @param {string} query - Search query
 * @param {Array} aircraft - List of aircraft objects
 * @param {Object} aircraftInfo - Map of hex -> aircraft info
 * @param {number} limit - Max results to return
 * @returns {Array} Matching aircraft with match metadata
 */
export function searchAircraft(query, aircraft, aircraftInfo = {}, limit = 10) {
  if (!query || !aircraft || aircraft.length === 0) return [];

  const q = query.toLowerCase().trim();
  if (!q) return [];

  const results = [];

  for (const ac of aircraft) {
    const info = aircraftInfo[ac.hex?.toUpperCase()] || aircraftInfo[ac.hex] || {};
    let bestScore = 0;
    let matchType = null;
    let matchValue = null;

    // Match callsign
    if (ac.flight) {
      const callsign = ac.flight.trim();
      const score = fuzzyScore(q, callsign);
      if (score > bestScore) {
        bestScore = score;
        matchType = 'callsign';
        matchValue = callsign;
      }
    }

    // Match hex/ICAO
    if (ac.hex) {
      const score = fuzzyScore(q, ac.hex);
      if (score > bestScore) {
        bestScore = score;
        matchType = 'icao';
        matchValue = ac.hex.toUpperCase();
      }
    }

    // Match registration
    if (info.registration) {
      const score = fuzzyScore(q, info.registration);
      if (score > bestScore) {
        bestScore = score;
        matchType = 'registration';
        matchValue = info.registration;
      }
    }

    // Match aircraft type code
    if (ac.type) {
      const score = fuzzyScore(q, ac.type);
      if (score > bestScore) {
        bestScore = score;
        matchType = 'type';
        matchValue = ac.type;
      }
    }

    // Match aircraft type name
    if (info.type_name) {
      const score = fuzzyScore(q, info.type_name);
      if (score > bestScore) {
        bestScore = score;
        matchType = 'type_name';
        matchValue = info.type_name;
      }
    }

    // Match squawk (exact or prefix only)
    if (ac.squawk) {
      if (ac.squawk.startsWith(q) || ac.squawk === q) {
        const score = q.length === 4 ? 1 : 0.8;
        if (score > bestScore) {
          bestScore = score;
          matchType = 'squawk';
          matchValue = ac.squawk;
        }
      }
    }

    // Match operator
    if (info.operator) {
      const score = fuzzyScore(q, info.operator);
      if (score > bestScore) {
        bestScore = score;
        matchType = 'operator';
        matchValue = info.operator;
      }
    }

    // Include if score is high enough
    if (bestScore >= 0.3) {
      results.push({
        ...ac,
        _matchScore: bestScore,
        _matchType: matchType,
        _matchValue: matchValue,
        _info: info,
      });
    }
  }

  // Sort by score (descending), then by distance
  return results
    .sort((a, b) => {
      if (Math.abs(a._matchScore - b._matchScore) > 0.1) {
        return b._matchScore - a._matchScore;
      }
      return (a.distance_nm || 999) - (b.distance_nm || 999);
    })
    .slice(0, limit);
}

/**
 * Get icon for match type
 */
function MatchTypeIcon({ type }) {
  switch (type) {
    case 'callsign':
      return <Plane size={12} />;
    case 'registration':
      return <Hash size={12} />;
    case 'squawk':
      return <Radio size={12} />;
    case 'operator':
      return <User size={12} />;
    case 'icao':
      return <Hash size={12} />;
    default:
      return <Plane size={12} />;
  }
}

/**
 * Highlight matching portion of text
 */
function HighlightMatch({ text, query }) {
  if (!text || !query) return <span>{text}</span>;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);

  if (index === -1) return <span>{text}</span>;

  return (
    <span>
      {text.slice(0, index)}
      <mark className="search-highlight">{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </span>
  );
}

/**
 * SearchAutocomplete - Dropdown component for search results and history
 */
export function SearchAutocomplete({
  query,
  results,
  recentSearches,
  selectedIndex,
  onSelect,
  onSelectRecent,
  onRemoveRecent,
  onClearHistory,
  onClose,
  isOpen,
}) {
  const dropdownRef = useRef(null);
  const itemRefs = useRef([]);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && itemRefs.current[selectedIndex]) {
      itemRefs.current[selectedIndex].scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [selectedIndex]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        onClose?.();
      }
    };

    if (isOpen) {
      // Delay to avoid immediate close on focus
      const timeoutId = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 100);
      return () => {
        clearTimeout(timeoutId);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const showResults = query && query.trim().length > 0 && results.length > 0;
  const showRecent = (!query || query.trim().length === 0) && recentSearches.length > 0;
  const showEmpty = query && query.trim().length > 0 && results.length === 0;
  const showNoRecent = (!query || query.trim().length === 0) && recentSearches.length === 0;

  return (
    <div ref={dropdownRef} className="search-autocomplete" role="listbox">
      {/* Search Results */}
      {showResults && (
        <div className="search-section">
          <div className="search-section-header">
            <Search size={12} />
            <span>Results ({results.length})</span>
          </div>
          {results.map((ac, i) => (
            <div
              key={ac.hex}
              ref={(el) => (itemRefs.current[i] = el)}
              className={`search-result ${i === selectedIndex ? 'selected' : ''}`}
              onClick={() => onSelect(ac)}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(ac)}
              role="option"
              aria-selected={i === selectedIndex}
              tabIndex={-1}
            >
              <div className="result-primary">
                <span className="result-callsign">
                  {ac.flight?.trim() || ac.hex?.toUpperCase()}
                </span>
                {ac._matchType && ac._matchType !== 'callsign' && (
                  <span className="result-match-badge">
                    <MatchTypeIcon type={ac._matchType} />
                    <HighlightMatch text={ac._matchValue} query={query} />
                  </span>
                )}
              </div>
              <div className="result-secondary">
                <span className="result-type">{ac._info?.type_name || ac.type || 'Unknown'}</span>
                {ac.alt_baro && <span className="result-alt">{Math.round(ac.alt_baro)}ft</span>}
                {ac.distance_nm && (
                  <span className="result-dist">{ac.distance_nm.toFixed(1)}nm</span>
                )}
              </div>
              <ChevronRight size={14} className="result-arrow" />
            </div>
          ))}
        </div>
      )}

      {/* Recent Searches */}
      {showRecent && (
        <div className="search-section">
          <div className="search-section-header">
            <Clock size={12} />
            <span>Recent Searches</span>
            <button
              className="clear-history-btn"
              onClick={(e) => {
                e.stopPropagation();
                onClearHistory?.();
              }}
              title="Clear history"
            >
              Clear
            </button>
          </div>
          {recentSearches.map((item, i) => (
            <div
              key={item.query + item.timestamp}
              ref={(el) => (itemRefs.current[i] = el)}
              className={`search-recent ${i === selectedIndex ? 'selected' : ''}`}
              onClick={() => onSelectRecent(item.query)}
              onKeyDown={(e) => e.key === 'Enter' && onSelectRecent(item.query)}
              role="option"
              aria-selected={i === selectedIndex}
              tabIndex={-1}
            >
              <Clock size={14} className="recent-icon" />
              <span className="recent-query">{item.query}</span>
              {item.callsign && <span className="recent-callsign">{item.callsign}</span>}
              <button
                className="remove-recent-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveRecent(item.query);
                }}
                title="Remove from history"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Empty States */}
      {showEmpty && (
        <div className="search-empty">
          <Search size={24} />
          <span>No aircraft match &quot;{query}&quot;</span>
        </div>
      )}

      {showNoRecent && (
        <div className="search-empty recent">
          <Clock size={24} />
          <span>No recent searches</span>
          <span className="search-hint">
            Search by callsign, registration, squawk, type, or operator
          </span>
        </div>
      )}

      {/* Keyboard hint */}
      <div className="search-keyboard-hint">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> navigate
        </span>
        <span>
          <kbd>Enter</kbd> select
        </span>
        <span>
          <kbd>Esc</kbd> close
        </span>
      </div>
    </div>
  );
}

export default SearchAutocomplete;
