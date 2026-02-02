import React, { forwardRef, useState, useCallback } from 'react';
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { cn } from './cn';

/**
 * CollapsibleSection - A reusable collapsible panel with animation
 *
 * Features:
 * - Smooth height animation via framer-motion
 * - Lazy loading support (children only render when opened)
 * - Accessible keyboard navigation
 * - Customizable trigger styling
 */
const CollapsibleSection = forwardRef(function CollapsibleSection(
  {
    title,
    icon: Icon,
    defaultOpen = false,
    open: controlledOpen,
    onOpenChange,
    lazy = false,
    badge,
    children,
    className,
    triggerClassName,
    contentClassName,
    ...props
  },
  ref
) {
  // Support both controlled and uncontrolled modes
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  // Track if section has ever been opened (for lazy loading)
  const [hasOpened, setHasOpened] = useState(defaultOpen);

  const handleOpenChange = useCallback((open) => {
    if (!isControlled) {
      setInternalOpen(open);
    }
    if (open && !hasOpened) {
      setHasOpened(true);
    }
    onOpenChange?.(open);
  }, [isControlled, hasOpened, onOpenChange]);

  // For lazy loading, only render children after first open
  const shouldRenderChildren = lazy ? hasOpened : true;

  return (
    <CollapsiblePrimitive.Root
      ref={ref}
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn('collapsible-section', className)}
      {...props}
    >
      <CollapsiblePrimitive.Trigger
        className={cn(
          'collapsible-trigger',
          'group flex w-full items-center justify-between',
          'py-2.5 px-3',
          'text-sm font-medium text-text-secondary',
          'hover:text-text-primary hover:bg-white/[0.03]',
          'rounded-lg transition-colors duration-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50',
          'min-h-[44px]', // Accessibility: 44px touch target
          triggerClassName
        )}
        aria-expanded={isOpen}
      >
        <span className="flex items-center gap-2">
          {Icon && (
            <Icon
              size={16}
              className="flex-shrink-0 text-text-dim"
              aria-hidden="true"
            />
          )}
          <span className="collapsible-title">{title}</span>
          {badge !== undefined && badge !== null && (
            <span className="collapsible-badge ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-accent-cyan/20 text-accent-cyan">
              {badge}
            </span>
          )}
        </span>
        <ChevronDown
          size={16}
          className={cn(
            'flex-shrink-0 text-text-dim transition-transform duration-300',
            isOpen && 'rotate-180'
          )}
          aria-hidden="true"
        />
      </CollapsiblePrimitive.Trigger>

      <AnimatePresence initial={false}>
        {isOpen && (
          <CollapsiblePrimitive.Content forceMount asChild>
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{
                height: 'auto',
                opacity: 1,
                transition: {
                  height: { duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] },
                  opacity: { duration: 0.2, delay: 0.05 },
                },
              }}
              exit={{
                height: 0,
                opacity: 0,
                transition: {
                  height: { duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] },
                  opacity: { duration: 0.15 },
                },
              }}
              className={cn('overflow-hidden', contentClassName)}
            >
              <div className="collapsible-content pb-2">
                {shouldRenderChildren && children}
              </div>
            </motion.div>
          </CollapsiblePrimitive.Content>
        )}
      </AnimatePresence>
    </CollapsiblePrimitive.Root>
  );
});

/**
 * CollapsibleHeader - Standalone header for custom layouts
 */
const CollapsibleHeader = forwardRef(function CollapsibleHeader(
  { className, children, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        'collapsible-header',
        'flex items-center justify-between',
        'py-2 px-3',
        'text-xs font-semibold text-text-dim uppercase tracking-wider',
        'border-b border-white/[0.05]',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
});

export { CollapsibleSection, CollapsibleHeader };
