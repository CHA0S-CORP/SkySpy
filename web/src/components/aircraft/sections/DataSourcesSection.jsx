import React from 'react';
import { Database, CheckCircle, XCircle, Clock } from 'lucide-react';

/**
 * DataSourcesSection - Show data sources that contributed to aircraft info
 */
export function DataSourcesSection({ sourceData = [] }) {
  if (sourceData.length === 0) {
    return (
      <div className="data-sources-empty">
        <p>No data source information available</p>
      </div>
    );
  }

  return (
    <div className="data-sources-section">
      <div className="data-sources-grid">
        {sourceData.map((source, index) => {
          const hasData = source.has_data ?? source.hasData ?? true;
          const lastUpdated = source.last_updated ?? source.lastUpdated;
          const sourceName = source.source ?? source.name ?? `Source ${index + 1}`;
          const fieldCount = source.fields_count ?? source.fieldsCount ?? 0;

          return (
            <div
              key={source.id || index}
              className={`data-source-card ${hasData ? 'has-data' : 'no-data'}`}
            >
              <div className="data-source-header">
                <Database size={14} className="data-source-icon" />
                <span className="data-source-name">{sourceName}</span>
                {hasData ? (
                  <CheckCircle size={12} className="data-source-status success" />
                ) : (
                  <XCircle size={12} className="data-source-status error" />
                )}
              </div>

              {hasData && (
                <div className="data-source-meta">
                  {fieldCount > 0 && (
                    <span className="data-source-fields">{fieldCount} fields</span>
                  )}
                  {lastUpdated && (
                    <span className="data-source-updated">
                      <Clock size={10} />
                      {formatRelativeTime(lastUpdated)}
                    </span>
                  )}
                </div>
              )}

              {/* Show which fields came from this source */}
              {source.fields && source.fields.length > 0 && (
                <div className="data-source-fields-list">
                  {source.fields.slice(0, 5).map((field, i) => (
                    <span key={i} className="data-source-field-tag">
                      {field}
                    </span>
                  ))}
                  {source.fields.length > 5 && (
                    <span className="data-source-field-more">
                      +{source.fields.length - 5} more
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Helper to format relative time
function formatRelativeTime(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
