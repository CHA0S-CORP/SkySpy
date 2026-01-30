import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database, ChevronDown, ChevronRight } from 'lucide-react';
import { BentoCard } from '../../../ui/bento-card';
import { Badge } from '../../../ui/badge';
import { AnimatedAccordionContent } from '../../../ui/accordion';
import { cn } from '../../../ui/cn';

// Human-readable source names
const SOURCE_LABELS = {
  faa: 'FAA Registry',
  adsbx: 'ADS-B Exchange',
  tar1090: 'tar1090-db',
  opensky: 'OpenSky Network',
  hexdb: 'HexDB',
  adsblol: 'adsb.lol',
  planespotters: 'Planespotters',
};

// Fields to display in source comparison
const COMPARISON_FIELDS = [
  { key: 'registration', label: 'Registration' },
  { key: 'type_code', label: 'Type Code' },
  { key: 'type_name', label: 'Type Name' },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'model', label: 'Model' },
  { key: 'serial_number', label: 'Serial #' },
  { key: 'year_built', label: 'Year Built' },
  { key: 'operator', label: 'Operator' },
  { key: 'operator_icao', label: 'Operator ICAO' },
  { key: 'owner', label: 'Owner' },
  { key: 'country', label: 'Country' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
];

// Safe date formatting
const formatDate = (dateString, options = {}) => {
  if (!dateString) return 'Unknown';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Unknown';
    return options.dateOnly
      ? date.toLocaleDateString()
      : date.toLocaleString();
  } catch {
    return 'Unknown';
  }
};

// Safe JSON stringify
const safeJsonStringify = (obj, indent = 2) => {
  try {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular Reference]';
        }
        seen.add(value);
      }
      return value;
    }, indent);
  } catch {
    return '[Unable to display data]';
  }
};

/**
 * DataSourcesAccordion - Expandable section showing data sources and comparison
 */
function DataSourcesAccordion({ sourceData = [] }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedSources, setExpandedSources] = useState({});

  if (!sourceData.length) return null;

  const toggleSource = (source) => {
    setExpandedSources(prev => ({
      ...prev,
      [source]: !prev[source],
    }));
  };

  return (
    <BentoCard
      variant="expandable"
      size="sm"
      colSpan={2}
      hoverable={false}
      aria-labelledby="sources-heading"
    >
      {/* Expandable header */}
      <button
        className={cn(
          'flex w-full items-center gap-2 -m-3 p-3 rounded-xl',
          'text-left transition-colors duration-200',
          'hover:bg-white/[0.02]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50'
        )}
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <Database size={16} className="text-text-secondary flex-shrink-0" aria-hidden="true" />
        <span className="text-sm font-medium text-text-secondary">
          Data Sources ({sourceData.length})
        </span>
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="ml-auto"
        >
          <ChevronDown size={16} className="text-text-dim" />
        </motion.div>
      </button>

      {/* Expandable content */}
      <AnimatedAccordionContent isOpen={isExpanded}>
        <div className="mt-4 space-y-4">
          {/* Source badges */}
          <div className="flex flex-wrap gap-2">
            {sourceData.map((src, index) => (
              <Badge
                key={src.source || `source-${index}`}
                variant={src.source || 'source'}
                title={`Last updated: ${formatDate(src.updated_at)}`}
              >
                {SOURCE_LABELS[src.source] || src.source}
              </Badge>
            ))}
          </div>

          {/* Comparison table */}
          <div className="overflow-x-auto rounded-lg border border-white/[0.05]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.05] bg-white/[0.02]">
                  <th className="px-3 py-2 text-left font-medium text-text-dim">Field</th>
                  {sourceData.map((src, index) => (
                    <th
                      key={src.source || `source-header-${index}`}
                      className="px-3 py-2 text-left font-medium text-text-dim"
                    >
                      {SOURCE_LABELS[src.source] || src.source}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON_FIELDS.map(field => {
                  const values = sourceData.map(src => src[field.key] || src.raw_data?.[field.key]);
                  const hasAnyValue = values.some(v => v != null && v !== '');
                  const allSame = values.every(v => v === values[0]);

                  if (!hasAnyValue) return null;

                  return (
                    <tr
                      key={field.key}
                      className={cn(
                        'border-b border-white/[0.03] last:border-b-0',
                        'transition-colors hover:bg-white/[0.02]',
                        !allSame && 'bg-accent-yellow/[0.03]'
                      )}
                    >
                      <td className="px-3 py-2 text-text-dim">{field.label}</td>
                      {sourceData.map((src, index) => {
                        const value = src[field.key] || src.raw_data?.[field.key];
                        return (
                          <td
                            key={src.source || `source-cell-${index}`}
                            className={cn(
                              'px-3 py-2',
                              value ? 'text-text-primary' : 'text-text-dim'
                            )}
                          >
                            {value ?? '—'}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Individual source details */}
          <div className="space-y-2">
            {sourceData.map((src, index) => (
              <div
                key={src.source || `source-detail-${index}`}
                className="rounded-lg border border-white/[0.05] overflow-hidden"
              >
                <button
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2',
                    'text-left transition-colors duration-200',
                    'hover:bg-white/[0.02]',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50'
                  )}
                  onClick={() => toggleSource(src.source)}
                  aria-expanded={expandedSources[src.source]}
                  aria-label={`Toggle ${SOURCE_LABELS[src.source] || src.source} details`}
                >
                  {expandedSources[src.source] ? (
                    <ChevronDown size={14} className="text-text-dim" />
                  ) : (
                    <ChevronRight size={14} className="text-text-dim" />
                  )}
                  <Badge variant={src.source || 'source'} size="sm">
                    {SOURCE_LABELS[src.source] || src.source}
                  </Badge>
                  <span className="ml-auto text-[10px] text-text-dim">
                    {src.updated_at && `Updated ${formatDate(src.updated_at, { dateOnly: true })}`}
                  </span>
                </button>

                <AnimatedAccordionContent isOpen={expandedSources[src.source]}>
                  <div className="border-t border-white/[0.05] bg-black/20 px-3 py-2">
                    <pre className="text-[10px] text-text-dim font-mono overflow-x-auto whitespace-pre-wrap break-words">
                      {safeJsonStringify(src.raw_data || src)}
                    </pre>
                  </div>
                </AnimatedAccordionContent>
              </div>
            ))}
          </div>
        </div>
      </AnimatedAccordionContent>
    </BentoCard>
  );
}

export { DataSourcesAccordion };
