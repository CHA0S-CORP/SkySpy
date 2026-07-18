import React from 'react';
import { Icon } from './Icon';

/**
 * Centered empty state (design spec: icon + message + optional action — never a blank pane).
 *
 * @param {object} props
 * @param {string} props.icon - icon name from the v2 registry
 * @param {React.ReactNode} props.message
 * @param {React.ReactNode} [props.action]
 */
export function EmptyState({ icon, message, action }) {
  return (
    <div className="v2-empty">
      <Icon name={icon} size={34} className="v2-empty__icon" />
      <div className="v2-empty__msg">{message}</div>
      {action}
    </div>
  );
}
