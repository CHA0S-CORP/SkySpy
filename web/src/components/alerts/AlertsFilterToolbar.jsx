import React from 'react';
import {
  Search, Filter, ChevronDown, ArrowUpAZ, ArrowDownAZ, Calendar, Activity, AlertCircle
} from 'lucide-react';

export function AlertsFilterToolbar({
  searchQuery,
  onSearchChange,
  priorityFilter,
  onPriorityFilterChange,
  statusFilter,
  onStatusFilterChange,
  sortBy,
  onSortChange,
  ruleCount
}) {
  return (
    <div className="rules-toolbar">
      <div className="rules-search">
        <Search size={16} aria-hidden="true" />
        <input
          type="text"
          placeholder="Search rules..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Search rules by name or description"
        />
      </div>

      <div className="rules-filters">
        <div className="filter-select">
          <Filter size={14} aria-hidden="true" />
          <select
            value={priorityFilter}
            onChange={(e) => onPriorityFilterChange(e.target.value)}
            aria-label="Filter by priority"
          >
            <option value="all">All Priorities</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
            <option value="emergency">Emergency</option>
          </select>
          <ChevronDown size={14} className="select-arrow" aria-hidden="true" />
        </div>

        <div className="filter-select">
          <Activity size={14} aria-hidden="true" />
          <select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="all">All Status</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
          <ChevronDown size={14} className="select-arrow" aria-hidden="true" />
        </div>

        <div className="filter-select">
          {sortBy === 'name-asc' ? <ArrowUpAZ size={14} aria-hidden="true" /> :
           sortBy === 'name-desc' ? <ArrowDownAZ size={14} aria-hidden="true" /> :
           sortBy === 'priority' ? <AlertCircle size={14} aria-hidden="true" /> :
           <Calendar size={14} aria-hidden="true" />}
          <select
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value)}
            aria-label="Sort rules"
          >
            <option value="name-asc">Name A-Z</option>
            <option value="name-desc">Name Z-A</option>
            <option value="priority">Priority</option>
            <option value="created">Created Date</option>
          </select>
          <ChevronDown size={14} className="select-arrow" aria-hidden="true" />
        </div>
      </div>

      <div className="rules-count" aria-live="polite">
        {ruleCount} rule{ruleCount !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
