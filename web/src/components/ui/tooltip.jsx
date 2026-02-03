import React, { forwardRef } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from './cn';

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = forwardRef(function TooltipContent(
  { className, sideOffset = 4, ...props },
  ref
) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'overflow-hidden rounded-md px-3 py-1.5',
          'bg-bg-card border border-border',
          'text-xs text-text-primary',
          'shadow-lg shadow-black/20',
          'animate-in fade-in-0 zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          'data-[side=bottom]:slide-in-from-top-2',
          'data-[side=left]:slide-in-from-right-2',
          'data-[side=right]:slide-in-from-left-2',
          'data-[side=top]:slide-in-from-bottom-2',
          className
        )}
        style={{ zIndex: 'var(--z-tooltip, 1300)' }}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});

TooltipProvider.displayName = TooltipPrimitive.Provider.displayName;
Tooltip.displayName = TooltipPrimitive.Root.displayName;
TooltipTrigger.displayName = TooltipPrimitive.Trigger.displayName;
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent };
