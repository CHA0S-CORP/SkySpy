import React from 'react';

/**
 * SidebarInfoRow - Simple label-value row for sidebar sections
 *
 * Simplified version of InfoRow without animations for better performance
 */
export function SidebarInfoRow({ label, value, mono = false }) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  return (
    <div className="sidebar-info-row">
      <span className="sidebar-info-label">{label}</span>
      <span className={`sidebar-info-value ${mono ? 'mono' : ''}`}>
        {value}
      </span>
    </div>
  );
}
