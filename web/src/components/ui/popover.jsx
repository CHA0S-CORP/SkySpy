import React, { forwardRef } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { X } from 'lucide-react';
import { cn } from './cn';

const Popover = PopoverPrimitive.Root;
Popover.displayName = 'Popover';

const PopoverTrigger = PopoverPrimitive.Trigger;
PopoverTrigger.displayName = 'PopoverTrigger';

const PopoverAnchor = PopoverPrimitive.Anchor;
PopoverAnchor.displayName = 'PopoverAnchor';

const PopoverPortal = PopoverPrimitive.Portal;
PopoverPortal.displayName = 'PopoverPortal';

const PopoverContent = forwardRef(function PopoverContent(
  { className, align = 'center', sideOffset = 4, ...props },
  ref
) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'w-72 rounded-md p-4',
          'bg-bg-card border border-border',
          'text-text-primary',
          'shadow-lg shadow-black/20',
          'outline-none',
          'animate-in fade-in-0 zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          'data-[side=bottom]:slide-in-from-top-2',
          'data-[side=left]:slide-in-from-right-2',
          'data-[side=right]:slide-in-from-left-2',
          'data-[side=top]:slide-in-from-bottom-2',
          className
        )}
        style={{ zIndex: 'var(--z-popover, 1200)' }}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});
PopoverContent.displayName = 'PopoverContent';

const PopoverClose = forwardRef(function PopoverClose(
  { className, children, ...props },
  ref
) {
  return (
    <PopoverPrimitive.Close
      ref={ref}
      className={cn(
        'absolute right-2 top-2',
        'rounded-sm p-1',
        'text-text-secondary hover:text-text-primary',
        'transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50',
        'disabled:pointer-events-none',
        className
      )}
      aria-label="Close"
      {...props}
    >
      {children ?? <X size={16} aria-hidden="true" />}
    </PopoverPrimitive.Close>
  );
});
PopoverClose.displayName = 'PopoverClose';

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  PopoverPortal,
  PopoverClose,
};
