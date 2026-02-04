import React from 'react';
import { Building2, ChevronDown } from 'lucide-react';
import { SidebarInfoRow } from './SidebarInfoRow';

/**
 * OperatorSection - Collapsible section for operator/owner details
 *
 * Displays:
 * - Operator name, ICAO code
 * - Owner
 * - Country
 */
export function OperatorSection({ data, isExpanded, onToggle }) {
  if (!data) return null;

  const { operator, operator_icao, owner, country } = data;

  // Check if we have any data to show
  const hasData = operator || operator_icao || owner || country;
  if (!hasData) return null;

  return (
    <div className={`sidebar-section ${isExpanded ? 'expanded' : ''}`}>
      <button
        className="sidebar-section-header"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls="section-operator-content"
        type="button"
      >
        <div className="sidebar-section-header-left">
          <div className="sidebar-section-icon">
            <Building2 size={14} />
          </div>
          <span className="sidebar-section-title">Operator</span>
        </div>
        <div className="sidebar-section-chevron">
          <ChevronDown size={16} />
        </div>
      </button>

      {isExpanded && (
        <div id="section-operator-content" className="sidebar-section-content">
          <SidebarInfoRow label="Operator" value={operator} />
          <SidebarInfoRow label="ICAO" value={operator_icao} mono />
          <SidebarInfoRow label="Owner" value={owner} />
          <SidebarInfoRow label="Country" value={country} />
        </div>
      )}
    </div>
  );
}
