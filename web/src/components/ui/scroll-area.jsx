import React, { forwardRef } from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { cn } from './cn';

const ScrollArea = forwardRef(function ScrollArea({ className, children, ...props }, ref) {
  return (
    <ScrollAreaPrimitive.Root
      ref={ref}
      className={cn('relative overflow-hidden', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
});
ScrollArea.displayName = 'ScrollArea';

const ScrollAreaViewport = forwardRef(function ScrollAreaViewport({ className, ...props }, ref) {
  return (
    <ScrollAreaPrimitive.Viewport
      ref={ref}
      className={cn('h-full w-full rounded-[inherit]', className)}
      {...props}
    />
  );
});
ScrollAreaViewport.displayName = 'ScrollAreaViewport';

const ScrollBar = forwardRef(function ScrollBar(
  { className, orientation = 'vertical', ...props },
  ref
) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      ref={ref}
      orientation={orientation}
      className={cn(
        'flex touch-none select-none transition-colors duration-200',
        orientation === 'vertical' && 'h-full w-2.5 border-l border-l-transparent p-[1px]',
        orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent p-[1px]',
        className
      )}
      {...props}
    >
      <ScrollAreaThumb />
    </ScrollAreaPrimitive.Scrollbar>
  );
});
ScrollBar.displayName = 'ScrollBar';

const ScrollAreaThumb = forwardRef(function ScrollAreaThumb({ className, ...props }, ref) {
  return (
    <ScrollAreaPrimitive.Thumb
      ref={ref}
      className={cn(
        'relative flex-1 rounded-full',
        'bg-white/20 hover:bg-white/30',
        'transition-colors duration-200',
        className
      )}
      {...props}
    />
  );
});
ScrollAreaThumb.displayName = 'ScrollAreaThumb';

export { ScrollArea, ScrollAreaViewport, ScrollBar, ScrollAreaThumb };
