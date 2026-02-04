import React from 'react';
import { Plane, ChevronDown } from 'lucide-react';
import { SidebarInfoRow } from './SidebarInfoRow';

/**
 * AircraftSection - Collapsible section for aircraft/airframe details
 *
 * Displays:
 * - Type name, ICAO code
 * - Manufacturer, model
 * - Serial number
 * - Year built, age
 */
export function AircraftSection({ data, isExpanded, onToggle }) {
  if (!data) return null;

  const {
    type_name,
    type_code,
    manufacturer,
    model,
    serial_number,
    year_built,
    age_years,
  } = data;

  // Check if we have any data to show
  const hasData = type_name || type_code || manufacturer || model || serial_number || year_built;
  if (!hasData) return null;

  return (
    <div className={`sidebar-section ${isExpanded ? 'expanded' : ''}`}>
      <button
        className="sidebar-section-header"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls="section-aircraft-content"
        type="button"
      >
        <div className="sidebar-section-header-left">
          <div className="sidebar-section-icon">
            <Plane size={14} />
          </div>
          <span className="sidebar-section-title">Aircraft</span>
        </div>
        <div className="sidebar-section-chevron">
          <ChevronDown size={16} />
        </div>
      </button>

      {isExpanded && (
        <div id="section-aircraft-content" className="sidebar-section-content">
          <SidebarInfoRow label="Type" value={type_name} />
          <SidebarInfoRow label="ICAO Code" value={type_code} mono />
          <SidebarInfoRow label="Manufacturer" value={manufacturer} />
          <SidebarInfoRow label="Model" value={model} />
          <SidebarInfoRow label="Serial #" value={serial_number} mono />
          <SidebarInfoRow label="Year Built" value={year_built} />
          {age_years !== null && age_years !== undefined && (
            <SidebarInfoRow label="Age" value={`${age_years} years`} />
          )}
        </div>
      )}
    </div>
  );
}
