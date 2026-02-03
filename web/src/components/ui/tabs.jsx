import React, { forwardRef } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from './cn';

const Tabs = TabsPrimitive.Root;
Tabs.displayName = 'Tabs';

const TabsList = forwardRef(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center',
        'rounded-lg bg-bg-hover p-1',
        'gap-1',
        className
      )}
      {...props}
    />
  );
});
TabsList.displayName = 'TabsList';

const TabsTrigger = forwardRef(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap',
        'rounded-md px-3 py-1.5',
        'text-sm font-medium',
        'text-text-secondary',
        'transition-all duration-200',
        // Hover state
        'hover:text-text-primary hover:bg-white/[0.05]',
        // Focus state
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-dark',
        // Active state
        'data-[state=active]:bg-bg-card data-[state=active]:text-text-primary data-[state=active]:shadow-sm',
        // Disabled state
        'disabled:pointer-events-none disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
});
TabsTrigger.displayName = 'TabsTrigger';

const TabsContent = forwardRef(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn(
        'mt-2',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-dark',
        className
      )}
      {...props}
    />
  );
});
TabsContent.displayName = 'TabsContent';

export { Tabs, TabsList, TabsTrigger, TabsContent };
