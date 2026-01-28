import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

/**
 * Collapsible Section Component
 *
 * Features:
 * - Expandable/collapsible content sections
 * - Animated chevron icon
 * - Optional default expanded state
 * - Customizable header with icon support
 * - Touch-friendly 44px touch targets
 */
export function CollapsibleSection({
  title,
  icon,
  children,
  defaultExpanded = false,
  className = '',
  headerClassName = '',
  contentClassName = ''
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className={`collapsible-section ${isExpanded ? 'expanded' : 'collapsed'} ${className}`}>
      <button
        className={`collapsible-header ${headerClassName}`}
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        {icon && <span className="collapsible-icon">{icon}</span>}
        <span className="collapsible-title">{title}</span>
        <span className="collapsible-chevron">
          {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </span>
      </button>
      {isExpanded && (
        <div className={`collapsible-content ${contentClassName}`}>
          {children}
        </div>
      )}
    </div>
  );
}

export default CollapsibleSection;
