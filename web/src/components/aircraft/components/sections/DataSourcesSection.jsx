import React from 'react';
import { Database, ChevronDown } from 'lucide-react';
import { Badge } from '../../../ui/badge';

/**
 * DataSourcesSection - Collapsible section showing data sources
 *
 * Displays badges for each data source that contributed information
 */
export function DataSourcesSection({ sourceData, isExpanded, onToggle }) {
  if (!sourceData || sourceData.length === 0) return null;

  // Get source variant for badge styling
  const getSourceVariant = (source) => {
    const sourceMap = {
      faa: 'faa',
      adsbx: 'adsbx',
      tar1090: 'tar1090',
      opensky: 'opensky',
      hexdb: 'hexdb',
      adsblol: 'adsblol',
      planespotters: 'planespotters',
    };
    return sourceMap[source?.toLowerCase()] || 'source';
  };

  // Format source name for display
  const formatSourceName = (source) => {
    const nameMap = {
      faa: 'FAA',
      adsbx: 'ADS-B Exchange',
      tar1090: 'tar1090',
      opensky: 'OpenSky',
      hexdb: 'HexDB',
      adsblol: 'adsb.lol',
      planespotters: 'Planespotters',
    };
    return nameMap[source?.toLowerCase()] || source;
  };

  return (
    <div className={`sidebar-section ${isExpanded ? 'expanded' : ''}`}>
      <button
        className="sidebar-section-header"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls="section-sources-content"
        type="button"
      >
        <div className="sidebar-section-header-left">
          <div className="sidebar-section-icon">
            <Database size={14} />
          </div>
          <span className="sidebar-section-title">Data Sources ({sourceData.length})</span>
        </div>
        <div className="sidebar-section-chevron">
          <ChevronDown size={16} />
        </div>
      </button>

      {isExpanded && (
        <div id="section-sources-content" className="sidebar-section-content">
          <div className="sidebar-sources-badges">
            {sourceData.map((source, idx) => (
              <Badge key={source.source || idx} variant={getSourceVariant(source.source)} size="sm">
                {formatSourceName(source.source)}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
