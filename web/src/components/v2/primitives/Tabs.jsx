import React from 'react';

/**
 * Underlined tab row (mock: active = --accent text + 2px underline).
 *
 * @param {object} props
 * @param {Array<{value: string, label: React.ReactNode, badge?: React.ReactNode}>} props.tabs
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange
 * @param {string} [props.className]
 */
export function Tabs({ tabs, value, onChange, className = '', ...rest }) {
  const onKeyDown = (e) => {
    const idx = tabs.findIndex((t) => t.value === value);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(tabs[(idx + 1) % tabs.length].value);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(tabs[(idx - 1 + tabs.length) % tabs.length].value);
    }
  };
  return (
    <div className={`v2-tabs ${className}`} role="tablist" {...rest}>
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className="v2-tabs__tab"
            onClick={() => onChange(tab.value)}
            onKeyDown={onKeyDown}
          >
            {tab.label}
            {tab.badge}
          </button>
        );
      })}
    </div>
  );
}
