import React from 'react';

/**
 * Unified Tab Bar Component
 *
 * Features:
 * - Pill-style tabs with gradient active state
 * - Count badges (default, warning, info variants)
 * - Alert dot indicator for critical items
 * - Integrated time range selector with divider
 * - Mobile: horizontal scroll tabs, full-width time range below
 */
export function TabBar({
  tabs,
  activeTab,
  onTabChange,
  timeRanges,
  activeTimeRange,
  onTimeRangeChange,
  className = ''
}) {
  return (
    <div className={`tab-bar-unified ${className}`}>
      <div className="tab-bar-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tab-bar-tab ${activeTab === tab.id ? 'active' : ''} ${tab.variant || ''}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.icon && <span className="tab-bar-tab-icon">{tab.icon}</span>}
            <span className="tab-bar-tab-label">{tab.label}</span>
            {tab.count !== undefined && tab.count !== null && (
              <span className={`tab-bar-badge ${tab.badgeVariant || 'default'}`}>
                {tab.count}
              </span>
            )}
            {tab.alertDot && <span className="tab-bar-alert-dot" />}
          </button>
        ))}
      </div>

      {timeRanges && timeRanges.length > 0 && (
        <>
          <div className="tab-bar-divider" />
          <div className="tab-bar-time-range">
            {timeRanges.map((range) => (
              <button
                key={range}
                className={`tab-bar-time-btn ${activeTimeRange === range ? 'active' : ''}`}
                onClick={() => onTimeRangeChange(range)}
              >
                {range}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default TabBar;
