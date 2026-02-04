import React from 'react';
import { Hash, ChevronDown } from 'lucide-react';
import { SidebarInfoRow } from './SidebarInfoRow';
import { Badge } from '../../../ui/badge';

/**
 * RegistrationSection - Collapsible section for registration/identification
 *
 * Displays:
 * - Registration
 * - ICAO hex code
 * - Military badge (if applicable)
 * - Category
 */
export function RegistrationSection({ data, hex, isExpanded, onToggle }) {
  const registration = data?.registration || data?.reg || data?.r;
  const is_military = data?.is_military ?? data?.military ?? data?.isMilitary;
  const category = data?.category || data?.aircraftCategory;

  return (
    <div className={`sidebar-section ${isExpanded ? 'expanded' : ''}`}>
      <button
        className="sidebar-section-header"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls="section-registration-content"
        type="button"
      >
        <div className="sidebar-section-header-left">
          <div className="sidebar-section-icon">
            <Hash size={14} />
          </div>
          <span className="sidebar-section-title">Registration</span>
        </div>
        <div className="sidebar-section-chevron">
          <ChevronDown size={16} />
        </div>
      </button>

      {isExpanded && (
        <div id="section-registration-content" className="sidebar-section-content">
          <SidebarInfoRow label="Registration" value={registration} mono />
          <SidebarInfoRow label="ICAO Hex" value={hex?.toUpperCase()} mono />
          {is_military && (
            <div className="sidebar-info-row">
              <span className="sidebar-info-label">Type</span>
              <Badge variant="military">Military</Badge>
            </div>
          )}
          <SidebarInfoRow label="Category" value={category} />
        </div>
      )}
    </div>
  );
}
