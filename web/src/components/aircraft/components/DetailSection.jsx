import React, { useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Loader2 } from 'lucide-react';

/**
 * DetailSection - Collapsible section wrapper for aircraft detail V2
 *
 * Props:
 * - id: Section identifier
 * - title: Section title
 * - icon: Lucide icon component
 * - badge: Badge count to display (optional)
 * - isExpanded: Whether section is expanded
 * - onToggle: Callback when section header is clicked
 * - isLoading: Show loading state in section content
 * - isEmpty: Show empty state
 * - emptyIcon: Icon for empty state
 * - emptyText: Text for empty state
 * - hasAlert: Style badge as alert (red)
 * - children: Section content
 */
export function DetailSection({
  id,
  title,
  icon: Icon,
  badge,
  isExpanded = false,
  onToggle,
  isLoading = false,
  isEmpty = false,
  emptyIcon: EmptyIcon,
  emptyText = 'No data available',
  hasAlert = false,
  children,
}) {
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle?.();
      }
    },
    [onToggle]
  );

  const hasBadge = badge !== undefined && badge !== null;
  const hasData = hasBadge && badge > 0;

  const sectionClasses = [
    'detail-section',
    isExpanded && 'expanded',
    hasData && 'has-data',
    hasAlert && 'has-alert',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section id={`section-${id}`} className={sectionClasses} aria-labelledby={`section-header-${id}`}>
      <div
        className="detail-section-header"
        id={`section-header-${id}`}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-controls={`section-content-${id}`}
        onClick={onToggle}
        onKeyDown={handleKeyDown}
      >
        <div className="detail-section-header-left">
          {Icon && (
            <div className="detail-section-icon" aria-hidden="true">
              <Icon size={16} />
            </div>
          )}
          <h3 className="detail-section-title">{title}</h3>
          {hasBadge && (
            <span className="detail-section-badge" aria-label={`${badge} items`}>
              {badge}
            </span>
          )}
        </div>
        <div className="detail-section-chevron" aria-hidden="true">
          <ChevronDown size={18} />
        </div>
      </div>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            id={`section-content-${id}`}
            className="detail-section-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className="detail-section-inner">
              {isLoading ? (
                <div className="detail-section-loading" role="status" aria-busy="true">
                  <Loader2 size={20} className="animate-spin" aria-hidden="true" />
                  <span>Loading...</span>
                </div>
              ) : isEmpty ? (
                <div className="detail-section-empty" role="status">
                  {EmptyIcon && <EmptyIcon size={32} aria-hidden="true" />}
                  <span className="detail-section-empty-text">{emptyText}</span>
                </div>
              ) : (
                children
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
