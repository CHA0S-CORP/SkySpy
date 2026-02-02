import React from 'react';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { ConfigField } from './ConfigField';

/**
 * Renders a category section with its configuration fields.
 */
export function ConfigCategory({
  category,
  expanded = true,
  onToggle,
  getConfigValue,
  onConfigChange,
  onConfigReset,
  onReveal,
  hasChange,
  disabled = false,
}) {
  const { category: categoryKey, category_display, configs = [], has_changes } = category;

  // Count pending changes in this category
  const changedCount = configs.filter(c => hasChange(c.key)).length;

  return (
    <div className={`config-category ${expanded ? 'config-category-expanded' : ''}`}>
      <button
        type="button"
        className="config-category-header"
        onClick={() => onToggle(categoryKey)}
        aria-expanded={expanded}
      >
        <span className="config-category-toggle">
          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </span>
        <span className="config-category-title">{category_display}</span>
        {changedCount > 0 && (
          <span className="config-category-badge config-category-badge-changed">
            {changedCount} unsaved
          </span>
        )}
        {has_changes && (
          <span className="config-category-badge config-category-badge-restart" title="Contains settings that require restart">
            <AlertTriangle size={12} />
          </span>
        )}
        <span className="config-category-count">{configs.length} settings</span>
      </button>

      {expanded && (
        <div className="config-category-content">
          {configs.map((config) => (
            <ConfigField
              key={config.key}
              config={config}
              value={getConfigValue(config.key)}
              onChange={onConfigChange}
              onReset={onConfigReset}
              onReveal={onReveal}
              hasChange={hasChange(config.key)}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}
