import React from 'react';
import { ChevronDown, ChevronUp, ExternalLink, Plane } from 'lucide-react';
import { getAcarsLabelDescription, getLabelCategory } from './historyConstants';

/**
 * Single ACARS message item component
 */
export function AcarsMessageItem({
  msg,
  index,
  callsignHexCache,
  regHexCache,
  labelReference,
  allMessagesExpanded,
  expandedMessages,
  toggleMessageExpansion,
  onSelectAircraft,
  onSelectByTail
}) {
  const timestamp = typeof msg.timestamp === 'number'
    ? new Date(msg.timestamp * 1000)
    : new Date(msg.timestamp);

  // Check cache for hex lookup
  const cachedHex = msg.callsign ? callsignHexCache[msg.callsign.trim().toUpperCase()] : null;
  const regCachedHex = msg.registration ? regHexCache[msg.registration.trim().toUpperCase()] : null;
  const linkHex = msg.icao_hex || cachedHex || regCachedHex;
  const canLink = !!linkHex;
  const isFromHistory = !msg.icao_hex && cachedHex;
  const labelDesc = getAcarsLabelDescription(msg.label, msg.label_info, labelReference);
  const category = getLabelCategory(msg.label);
  const msgId = `${msg.timestamp}-${index}`;
  const isExpanded = allMessagesExpanded || expandedMessages[msgId];
  const textContent = msg.formatted_text || msg.text || '';
  const isLongText = textContent.length > 100;

  return (
    <div
      className={`acars-history-item ${canLink ? 'clickable' : ''} ${category ? `category-${category}` : ''}`}
      onClick={(e) => {
        if (canLink && onSelectAircraft) {
          e.preventDefault();
          onSelectAircraft(linkHex);
        }
      }}
      title={canLink ? (isFromHistory ? 'Click to view aircraft (from sightings)' : 'Click to view aircraft details') : 'No ICAO hex available'}
    >
      <div className="acars-history-header">
        {msg.callsign && (
          <span
            className={`acars-history-callsign ${canLink ? 'clickable' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              if (canLink && onSelectAircraft) {
                onSelectAircraft(linkHex);
              }
            }}
          >
            {msg.callsign}
            {canLink && <ExternalLink size={10} />}
          </span>
        )}
        {msg.airline?.name && (
          <span className="acars-history-airline" title={`${msg.airline.icao || msg.airline.iata}`}>
            <Plane size={12} />
            {msg.airline.name}
          </span>
        )}
        {msg.registration && (
          <span
            className="acars-history-reg clickable"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              if (canLink && onSelectAircraft) {
                onSelectAircraft(linkHex);
              } else if (onSelectByTail) {
                onSelectByTail(msg.registration);
              }
            }}
          >
            {msg.registration}
            <ExternalLink size={10} />
          </span>
        )}
        <span className="acars-history-time">{timestamp.toLocaleString()}</span>
        {msg.label && (
          <span className={`acars-history-label ${category ? `category-${category}` : ''}`} title={msg.label_info?.description || labelDesc || msg.label}>
            {msg.label}
            {labelDesc && (
              <span className="acars-label-desc">{labelDesc}</span>
            )}
          </span>
        )}
        <span className={`acars-history-source ${msg.source}`}>{msg.source?.toUpperCase()}</span>
        {msg.frequency && <span className="acars-history-freq">{msg.frequency} MHz</span>}
        {/* Compact mode preview */}
        <span className="acars-compact-preview">
          {textContent.slice(0, 60)}{textContent.length > 60 ? '...' : ''}
        </span>
      </div>
      {(msg.icao_hex || cachedHex) && (
        <div className="acars-history-aircraft">
          <span
            className="acars-history-icao clickable"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              if (onSelectAircraft) {
                onSelectAircraft(linkHex);
              }
            }}
          >
            {msg.icao_hex || cachedHex}
            <ExternalLink size={10} />
          </span>
        </div>
      )}
      {/* Show decoded/formatted text if available, otherwise show raw text */}
      {msg.formatted_text ? (
        <div className="acars-formatted-text">
          <div className="acars-formatted-header">Decoded:</div>
          <pre className={`acars-formatted-content ${!isExpanded && isLongText ? 'collapsed' : ''}`}>{msg.formatted_text}</pre>
          {isLongText && (
            <button
              className="acars-text-toggle"
              onClick={(e) => { e.stopPropagation(); toggleMessageExpansion(msgId); }}
            >
              {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {isExpanded ? 'Show less' : 'Show more'}
            </button>
          )}
          {msg.text && (
            <details className="acars-raw-toggle">
              <summary>Raw Message</summary>
              <pre className="acars-history-text">{msg.text}</pre>
            </details>
          )}
        </div>
      ) : (
        msg.text && (
          <>
            <pre className={`acars-history-text ${!isExpanded && isLongText ? 'collapsed' : ''}`}>{msg.text}</pre>
            {isLongText && (
              <button
                className="acars-text-toggle"
                onClick={(e) => { e.stopPropagation(); toggleMessageExpansion(msgId); }}
              >
                {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {isExpanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </>
        )
      )}
      {msg.decoded_text && Object.keys(msg.decoded_text).length > 0 && !msg.formatted_text && (
        <div className="acars-decoded-info">
          {msg.decoded_text.message_type && (
            <span className="acars-decoded-type">{msg.decoded_text.message_type}</span>
          )}
          {msg.decoded_text.airports_mentioned && (
            <span className="acars-decoded-item" title="Airports mentioned">
              * {msg.decoded_text.airports_mentioned.join(', ')}
            </span>
          )}
          {msg.decoded_text.airports && (
            <span className="acars-decoded-item" title="Airports">
              * {msg.decoded_text.airports.join(', ')}
            </span>
          )}
          {msg.decoded_text.flight_levels && (
            <span className="acars-decoded-item" title="Flight levels">
              ^ {msg.decoded_text.flight_levels.join(', ')}
            </span>
          )}
          {msg.decoded_text.position && (
            <span className="acars-decoded-item" title="Position">
              @ {msg.decoded_text.position.lat.toFixed(3)}, {msg.decoded_text.position.lon.toFixed(3)}
            </span>
          )}
          {msg.decoded_text.ground_station && (
            <span className="acars-decoded-item" title="Ground Station">
              # {msg.decoded_text.ground_station}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
