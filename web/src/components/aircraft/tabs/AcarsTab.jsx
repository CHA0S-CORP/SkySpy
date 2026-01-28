import React from 'react';
import { MessageCircle, LayoutGrid, List, ChevronDown, ChevronUp, X, Plane } from 'lucide-react';
import { getAcarsLabelDescription, getLabelCategory, quickFilterCategories } from '../hooks/useAircraftDetail';

export function AcarsTab({
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
  setAllMessagesExpanded
}) {
  // Filter messages based on quick filters
  const filteredMessages = acarsQuickFilters.length > 0
    ? acarsMessages.filter(msg => {
        const label = msg.label?.toUpperCase();
        if (!label) return false;
        return acarsQuickFilters.some(category =>
          quickFilterCategories[category]?.labels.includes(label)
        );
      })
    : acarsMessages;

  return (
    <div
      className="detail-acars"
      id="panel-acars"
      role="tabpanel"
      aria-labelledby="tab-acars"
    >
      {/* Filter Toolbar */}
      <div className="acars-filter">
        <label htmlFor="acars-time-range">Time Range:</label>
        <select
          id="acars-time-range"
          value={acarsHours}
          onChange={(e) => setAcarsHours(Number(e.target.value))}
        >
          <option value={1}>Last 1 hour</option>
          <option value={6}>Last 6 hours</option>
          <option value={12}>Last 12 hours</option>
          <option value={24}>Last 24 hours</option>
          <option value={48}>Last 48 hours</option>
          <option value={72}>Last 72 hours</option>
          <option value={168}>Last 7 days</option>
        </select>

        <div className="acars-view-toggle" role="group" aria-label="View mode">
          <button
            className={`acars-view-btn ${!acarsCompactMode ? 'active' : ''}`}
            onClick={() => setAcarsCompactMode(false)}
            title="Expanded view"
            aria-label="Expanded view"
            aria-pressed={!acarsCompactMode}
          >
            <LayoutGrid size={14} aria-hidden="true" />
          </button>
          <button
            className={`acars-view-btn ${acarsCompactMode ? 'active' : ''}`}
            onClick={() => setAcarsCompactMode(true)}
            title="Compact view"
            aria-label="Compact view"
            aria-pressed={acarsCompactMode}
          >
            <List size={14} aria-hidden="true" />
          </button>
        </div>

        <button
          className="acars-expand-all-btn"
          onClick={() => {
            setAllMessagesExpanded(prev => !prev);
            setExpandedMessages({});
          }}
          title={allMessagesExpanded ? 'Collapse all messages' : 'Expand all messages'}
          aria-expanded={allMessagesExpanded}
        >
          {allMessagesExpanded ? (
            <ChevronUp size={14} aria-hidden="true" />
          ) : (
            <ChevronDown size={14} aria-hidden="true" />
          )}
          {allMessagesExpanded ? 'Collapse' : 'Expand'}
        </button>

        <span className="acars-count" aria-live="polite">
          {filteredMessages.length === acarsMessages.length
            ? `${acarsMessages.length} message${acarsMessages.length !== 1 ? 's' : ''}`
            : `${filteredMessages.length} of ${acarsMessages.length}`}
        </span>
      </div>

      {/* Quick Filter Chips */}
      <div className="acars-quick-filter-chips" role="group" aria-label="Message type filters">
        {Object.entries(quickFilterCategories).map(([key, { name }]) => (
          <button
            key={key}
            className={`acars-filter-chip chip-${key} ${acarsQuickFilters.includes(key) ? 'active' : ''}`}
            onClick={() => setAcarsQuickFilters(prev =>
              prev.includes(key) ? prev.filter(c => c !== key) : [...prev, key]
            )}
            aria-pressed={acarsQuickFilters.includes(key)}
          >
            <span className="chip-dot" aria-hidden="true" />
            {name}
          </button>
        ))}
        {acarsQuickFilters.length > 0 && (
          <button
            className="acars-chips-clear"
            onClick={() => setAcarsQuickFilters([])}
            aria-label="Clear all filters"
          >
            <X size={12} aria-hidden="true" /> Clear
          </button>
        )}
      </div>

      {/* Empty State */}
      {filteredMessages.length === 0 ? (
        <div className="detail-empty" role="status">
          <MessageCircle size={48} aria-hidden="true" />
          <p>No ACARS messages</p>
          <span>
            {acarsQuickFilters.length > 0
              ? 'No messages match the selected filters'
              : 'No messages received from this aircraft in the selected time range'}
          </span>
        </div>
      ) : (
        <ul
          className={`acars-list ${acarsCompactMode ? 'compact' : ''}`}
          role="list"
          aria-label="ACARS messages"
        >
          {filteredMessages.map((msg, i) => {
            const timestamp = typeof msg.timestamp === 'number'
              ? new Date(msg.timestamp * 1000)
              : new Date(msg.timestamp);
            const labelDesc = getAcarsLabelDescription(msg.label, msg.label_info);
            const labelCategory = getLabelCategory(msg.label);
            const msgId = `${msg.timestamp}-${i}`;
            const isExpanded = allMessagesExpanded || expandedMessages[msgId];
            const textContent = msg.formatted_text || msg.text || '';
            const isLongText = textContent.length > 100;

            return (
              <li
                key={i}
                className={`acars-item${labelCategory ? ` category-${labelCategory}` : ''}`}
              >
                <div className="acars-item-header">
                  {msg.callsign && (
                    <span className="acars-item-callsign">{msg.callsign}</span>
                  )}
                  {msg.airline?.name && (
                    <span
                      className="acars-item-airline"
                      title={msg.airline.icao || msg.airline.iata}
                    >
                      <Plane size={12} aria-hidden="true" />
                      {msg.airline.name}
                    </span>
                  )}
                  <span className="acars-item-time">
                    <time dateTime={timestamp.toISOString()}>
                      {timestamp.toLocaleString()}
                    </time>
                  </span>
                  <span
                    className={`acars-item-label${labelCategory ? ` category-${labelCategory}` : ''}`}
                    title={msg.label_info?.description || labelDesc || msg.label}
                  >
                    {msg.label || '--'}
                    {labelDesc && (
                      <span className="acars-label-desc">{labelDesc}</span>
                    )}
                  </span>
                  <span className="acars-item-source">{msg.source}</span>
                  {msg.frequency && (
                    <span className="acars-item-freq">{msg.frequency} MHz</span>
                  )}
                  <span className="acars-compact-preview">
                    {textContent.slice(0, 60)}{textContent.length > 60 ? '...' : ''}
                  </span>
                </div>

                {msg.icao_hex && (
                  <div className="acars-item-aircraft">
                    <span className="acars-item-icao">{msg.icao_hex}</span>
                  </div>
                )}

                {/* Message Text */}
                {msg.formatted_text ? (
                  <div className="acars-formatted-text">
                    <div className="acars-formatted-header">Decoded:</div>
                    <pre className={`acars-item-text ${!isExpanded && isLongText ? 'collapsed' : ''}`}>
                      {msg.formatted_text}
                    </pre>
                    {isLongText && (
                      <button
                        className="acars-text-toggle"
                        onClick={() => setExpandedMessages(prev => ({
                          ...prev,
                          [msgId]: !prev[msgId]
                        }))}
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? (
                          <ChevronUp size={12} aria-hidden="true" />
                        ) : (
                          <ChevronDown size={12} aria-hidden="true" />
                        )}
                        {isExpanded ? 'Show less' : 'Show more'}
                      </button>
                    )}
                    {msg.text && (
                      <details className="acars-raw-toggle">
                        <summary>Raw Message</summary>
                        <pre className="acars-item-text">{msg.text}</pre>
                      </details>
                    )}
                  </div>
                ) : (
                  msg.text && (
                    <>
                      <pre className={`acars-item-text ${!isExpanded && isLongText ? 'collapsed' : ''}`}>
                        {msg.text}
                      </pre>
                      {isLongText && (
                        <button
                          className="acars-text-toggle"
                          onClick={() => setExpandedMessages(prev => ({
                            ...prev,
                            [msgId]: !prev[msgId]
                          }))}
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? (
                            <ChevronUp size={12} aria-hidden="true" />
                          ) : (
                            <ChevronDown size={12} aria-hidden="true" />
                          )}
                          {isExpanded ? 'Show less' : 'Show more'}
                        </button>
                      )}
                    </>
                  )
                )}

                {/* Decoded data tags */}
                {msg.decoded_text && Object.keys(msg.decoded_text).length > 0 && !msg.formatted_text && (
                  <div className="acars-item-decoded">
                    {msg.decoded_text.airports_mentioned && (
                      <span className="decoded-tag" title="Airports mentioned">
                        ✈ {msg.decoded_text.airports_mentioned.join(', ')}
                      </span>
                    )}
                    {msg.decoded_text.flight_levels && (
                      <span className="decoded-tag" title="Flight levels">
                        ⬆ FL{msg.decoded_text.flight_levels.join(', FL')}
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
