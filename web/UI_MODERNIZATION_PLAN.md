# SkySpy Frontend UI/UX Modernization Plan

## Executive Summary

This document provides detailed implementation plans for modernizing the SkySpy frontend across 6 phases. Each phase builds upon the previous, creating a progressively better developer experience and user interface.

**Current Stack:** React 18 + Tailwind 4.1 + CSS Variables + Framer Motion + CVA

---

## Phase 1: Design System Foundation

**Goal:** Establish a centralized, documented design system with Storybook.

### 1.1 Install Dependencies

```bash
cd web

# Storybook
npx storybook@latest init --type react

# Design token tooling
npm install -D @storybook/addon-a11y @storybook/test
```

### 1.2 Create Design Token JavaScript Module

**File:** `src/design-system/tokens.js`

```javascript
/**
 * Design tokens - single source of truth for all design values.
 * These mirror the CSS variables in base.css but provide JS access.
 */

export const colors = {
  background: {
    dark: '#0d1117',
    card: '#151b24',
    hover: '#1c2432',
  },
  border: {
    default: '#252d3a',
  },
  text: {
    primary: '#e6edf3',
    secondary: '#8b949e',
    dim: '#484f58',
  },
  accent: {
    cyan: '#00d4ff',
    green: '#4ade80',
    blue: '#5a7a9a',
    yellow: '#d29922',
    red: '#f85149',
    purple: '#a371f7',
  },
  brand: {
    navy: '#1a2035',
    blue: '#5a7a9a',
    green: '#4ade80',
  },
  glow: {
    cyan: 'rgba(0, 212, 255, 0.15)',
    green: 'rgba(74, 222, 128, 0.15)',
  },
};

export const zIndex = {
  base: 1,
  dropdown: 100,
  sticky: 500,
  fixed: 900,
  modalBackdrop: 1000,
  modal: 1100,
  popover: 1200,
  tooltip: 1300,
  cannonball: 8000,
  toast: 9000,
  skipLink: 9500,
};

export const spacing = {
  0: '0',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
};

export const borderRadius = {
  none: '0',
  sm: '4px',
  md: '6px',
  lg: '8px',
  xl: '12px',
  full: '9999px',
};

export const typography = {
  fontFamily: {
    sans: "'Outfit', sans-serif",
    mono: "'JetBrains Mono', monospace",
  },
  fontSize: {
    xs: '11px',
    sm: '12px',
    base: '14px',
    lg: '16px',
    xl: '18px',
    '2xl': '24px',
    '3xl': '30px',
  },
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
};

export const transitions = {
  fast: '0.15s ease',
  normal: '0.2s ease',
  slow: '0.3s ease',
};

export const shadows = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.3)',
  md: '0 4px 6px rgba(0, 0, 0, 0.3)',
  lg: '0 10px 15px rgba(0, 0, 0, 0.3)',
  glass: '0 8px 32px 0 rgba(0, 0, 0, 0.36)',
  glowCyan: '0 0 20px -5px rgba(0, 212, 255, 0.4)',
};
```

### 1.3 Create Motion System

**File:** `src/design-system/motion.js`

```javascript
/**
 * Framer Motion animation presets for consistent animations.
 */

export const easings = {
  smooth: [0.25, 0.46, 0.45, 0.94],
  spring: { type: 'spring', stiffness: 300, damping: 30 },
  bounce: { type: 'spring', stiffness: 400, damping: 10 },
};

export const durations = {
  fast: 0.15,
  normal: 0.25,
  slow: 0.4,
};

// Reusable animation variants
export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: durations.normal },
};

export const slideUp = {
  initial: { opacity: 0, y: 15 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 15 },
  transition: { duration: durations.slow, ease: easings.smooth },
};

export const scaleIn = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
  transition: { duration: durations.normal, ease: easings.smooth },
};

export const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.05,
    },
  },
};

export const staggerItem = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
};

// For reduced motion preference
export const reducedMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0 },
};
```

### 1.4 Configure Storybook

**File:** `.storybook/preview.js`

```javascript
import '../src/styles/base.css';
import '../src/styles/components.css';
import '../src/index.css';

export const parameters = {
  actions: { argTypesRegex: '^on[A-Z].*' },
  controls: {
    matchers: {
      color: /(background|color)$/i,
      date: /Date$/,
    },
  },
  backgrounds: {
    default: 'dark',
    values: [
      { name: 'dark', value: '#0d1117' },
      { name: 'card', value: '#151b24' },
    ],
  },
  a11y: {
    config: {
      rules: [
        { id: 'color-contrast', enabled: true },
      ],
    },
  },
};

export const decorators = [
  (Story) => (
    <div style={{ padding: '24px', background: '#0d1117', minHeight: '100vh' }}>
      <Story />
    </div>
  ),
];
```

### 1.5 Create Component Stories

**File:** `src/components/ui/badge.stories.jsx`

```jsx
import { Badge } from './badge';

export default {
  title: 'UI/Badge',
  component: Badge,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'military', 'success', 'warning', 'source'],
    },
    size: {
      control: 'select',
      options: ['sm', 'default', 'lg'],
    },
  },
};

export const Default = {
  args: {
    children: 'Default Badge',
    variant: 'default',
  },
};

export const Military = {
  args: {
    children: 'MILITARY',
    variant: 'military',
  },
};

export const AllVariants = {
  render: () => (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      <Badge variant="default">Default</Badge>
      <Badge variant="military">Military</Badge>
      <Badge variant="success">Success</Badge>
      <Badge variant="warning">Warning</Badge>
    </div>
  ),
};
```

**File:** `src/components/ui/metric-card.stories.jsx`

```jsx
import { MetricCard } from './metric-card';
import { Plane, Activity } from 'lucide-react';

export default {
  title: 'UI/MetricCard',
  component: MetricCard,
  tags: ['autodocs'],
};

export const Default = {
  args: {
    title: 'Aircraft Tracked',
    value: 42,
    icon: Plane,
  },
};

export const WithTrend = {
  args: {
    title: 'Messages/sec',
    value: 1250,
    icon: Activity,
    trend: { direction: 'up', value: '+12%' },
  },
};

export const Emergency = {
  args: {
    title: 'Emergency',
    value: 1,
    variant: 'emergency',
  },
};
```

### 1.6 Create Index Export

**File:** `src/design-system/index.js`

```javascript
export * from './tokens';
export * from './motion';
```

### 1.7 Add npm Scripts

**Update:** `package.json`

```json
{
  "scripts": {
    "storybook": "storybook dev -p 6006",
    "build-storybook": "storybook build"
  }
}
```

### 1.8 Files to Create/Modify

| Action | File |
|--------|------|
| Create | `src/design-system/tokens.js` |
| Create | `src/design-system/motion.js` |
| Create | `src/design-system/index.js` |
| Create | `.storybook/main.js` (auto-generated) |
| Create | `.storybook/preview.js` |
| Create | `src/components/ui/*.stories.jsx` (one per component) |
| Modify | `package.json` (add scripts) |

### 1.9 Deliverables Checklist

- [ ] Storybook runs with `npm run storybook`
- [ ] All `components/ui/` have stories
- [ ] Design tokens documented in Storybook
- [ ] Accessibility addon enabled and showing violations

---

## Phase 2: Radix UI Primitives

**Goal:** Replace custom implementations with accessible Radix primitives.

### 2.1 Install Dependencies

```bash
npm install @radix-ui/react-dialog \
  @radix-ui/react-dropdown-menu \
  @radix-ui/react-tooltip \
  @radix-ui/react-tabs \
  @radix-ui/react-select \
  @radix-ui/react-switch \
  @radix-ui/react-popover \
  @radix-ui/react-toast \
  @radix-ui/react-scroll-area
```

### 2.2 Create Dialog Component

**File:** `src/components/ui/dialog.jsx`

Replace `ConfirmModal` with Radix Dialog:

```jsx
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cva } from 'class-variance-authority';
import { cn } from './cn';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-[var(--z-modal-backdrop)] bg-black/70 backdrop-blur-sm',
      'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const dialogContentVariants = cva(
  [
    'fixed left-1/2 top-1/2 z-[var(--z-modal)]',
    '-translate-x-1/2 -translate-y-1/2',
    'bg-bg-card border border-border rounded-lg shadow-lg',
    'w-full max-w-md p-6',
    'data-[state=open]:animate-scale-in',
    'focus:outline-none',
  ],
  {
    variants: {
      size: {
        sm: 'max-w-sm',
        default: 'max-w-md',
        lg: 'max-w-lg',
        xl: 'max-w-2xl',
        full: 'max-w-[90vw] max-h-[85vh]',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
);

const DialogContent = React.forwardRef(
  ({ className, children, size, showClose = true, ...props }, ref) => (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(dialogContentVariants({ size }), className)}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close
            className={cn(
              'absolute right-4 top-4 rounded-sm opacity-70',
              'hover:opacity-100 focus:outline-none focus-visible:ring-2',
              'focus-visible:ring-accent-cyan focus-visible:ring-offset-2',
              'disabled:pointer-events-none text-text-secondary'
            )}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }) => (
  <div
    className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)}
    {...props}
  />
);

const DialogFooter = ({ className, ...props }) => (
  <div
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 mt-6', className)}
    {...props}
  />
);

const DialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold text-text-primary', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-text-secondary', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
```

### 2.3 Create AlertDialog for Confirmations

**File:** `src/components/ui/alert-dialog.jsx`

```jsx
import * as React from 'react';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { cva } from 'class-variance-authority';
import { cn } from './cn';

const AlertDialog = AlertDialogPrimitive.Root;
const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
const AlertDialogPortal = AlertDialogPrimitive.Portal;

const AlertDialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-[var(--z-modal-backdrop)] bg-black/70 backdrop-blur-sm',
      'data-[state=open]:animate-fade-in',
      className
    )}
    {...props}
  />
));

const alertDialogContentVariants = cva(
  [
    'fixed left-1/2 top-1/2 z-[var(--z-modal)]',
    '-translate-x-1/2 -translate-y-1/2',
    'bg-bg-card border border-border rounded-lg shadow-lg',
    'w-full max-w-md p-6',
    'data-[state=open]:animate-scale-in',
  ],
  {
    variants: {
      variant: {
        default: 'border-border',
        danger: 'border-accent-red/50',
        warning: 'border-accent-yellow/50',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

const AlertDialogContent = React.forwardRef(
  ({ className, variant, ...props }, ref) => (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        ref={ref}
        className={cn(alertDialogContentVariants({ variant }), className)}
        {...props}
      />
    </AlertDialogPortal>
  )
);

const AlertDialogHeader = ({ className, ...props }) => (
  <div className={cn('flex flex-col space-y-2', className)} {...props} />
);

const AlertDialogFooter = ({ className, ...props }) => (
  <div
    className={cn('flex justify-end space-x-2 mt-6', className)}
    {...props}
  />
);

const AlertDialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold text-text-primary', className)}
    {...props}
  />
));

const AlertDialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-text-secondary', className)}
    {...props}
  />
));

const AlertDialogAction = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action
    ref={ref}
    className={cn('btn-primary', className)}
    {...props}
  />
));

const AlertDialogCancel = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn('btn-secondary', className)}
    {...props}
  />
));

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
```

### 2.4 Create Tooltip Component

**File:** `src/components/ui/tooltip.jsx`

```jsx
import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from './cn';

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef(
  ({ className, sideOffset = 4, ...props }, ref) => (
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-[var(--z-tooltip)] overflow-hidden rounded-md',
        'bg-bg-card border border-border px-3 py-1.5',
        'text-sm text-text-primary shadow-md',
        'animate-fade-in',
        className
      )}
      {...props}
    />
  )
);
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
```

### 2.5 Create Tabs Component

**File:** `src/components/ui/tabs.jsx`

```jsx
import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from './cn';

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center rounded-lg',
      'bg-bg-hover p-1 gap-1',
      className
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center whitespace-nowrap',
      'rounded-md px-3 py-1.5 text-sm font-medium',
      'text-text-secondary transition-all',
      'focus-visible:outline-none focus-visible:ring-2',
      'focus-visible:ring-accent-cyan focus-visible:ring-offset-2',
      'disabled:pointer-events-none disabled:opacity-50',
      'data-[state=active]:bg-bg-card data-[state=active]:text-text-primary',
      'data-[state=active]:shadow-sm',
      'hover:text-text-primary',
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-2 focus-visible:outline-none focus-visible:ring-2',
      'focus-visible:ring-accent-cyan focus-visible:ring-offset-2',
      className
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
```

### 2.6 Create Select Component

**File:** `src/components/ui/select.jsx`

```jsx
import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from './cn';

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef(
  ({ className, children, ...props }, ref) => (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        'flex h-10 w-full items-center justify-between rounded-md',
        'border border-border bg-bg-card px-3 py-2 text-sm',
        'text-text-primary placeholder:text-text-dim',
        'focus:outline-none focus:ring-2 focus:ring-accent-cyan focus:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        '[&>span]:line-clamp-1',
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-4 w-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
);

const SelectScrollUpButton = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn('flex cursor-default items-center justify-center py-1', className)}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
));

const SelectScrollDownButton = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn('flex cursor-default items-center justify-center py-1', className)}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
));

const SelectContent = React.forwardRef(
  ({ className, children, position = 'popper', ...props }, ref) => (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        className={cn(
          'relative z-[var(--z-dropdown)] max-h-96 min-w-[8rem] overflow-hidden',
          'rounded-md border border-border bg-bg-card text-text-primary shadow-md',
          'data-[state=open]:animate-fade-in',
          position === 'popper' &&
            'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
          className
        )}
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            'p-1',
            position === 'popper' &&
              'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]'
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
);

const SelectLabel = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn('py-1.5 pl-8 pr-2 text-sm font-semibold text-text-secondary', className)}
    {...props}
  />
));

const SelectItem = React.forwardRef(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-pointer select-none items-center',
      'rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none',
      'focus:bg-bg-hover focus:text-text-primary',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4 text-accent-cyan" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));

const SelectSeparator = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-border', className)}
    {...props}
  />
));

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};
```

### 2.7 Create Switch Component

**File:** `src/components/ui/switch.jsx`

```jsx
import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from './cn';

const Switch = React.forwardRef(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center',
      'rounded-full border-2 border-transparent transition-colors',
      'focus-visible:outline-none focus-visible:ring-2',
      'focus-visible:ring-accent-cyan focus-visible:ring-offset-2',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:bg-accent-cyan data-[state=unchecked]:bg-bg-hover',
      className
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'pointer-events-none block h-5 w-5 rounded-full',
        'bg-text-primary shadow-lg ring-0 transition-transform',
        'data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0'
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };
```

### 2.8 Migration Strategy for ConfirmModal

**Step 1:** Create compatibility wrapper

**File:** `src/components/common/ConfirmModal.jsx` (updated)

```jsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { Trash2, AlertTriangle, Info, AlertCircle } from 'lucide-react';

const VARIANT_ICONS = {
  danger: Trash2,
  warning: AlertTriangle,
  info: Info,
  default: AlertCircle,
};

const VARIANT_CLASSES = {
  danger: 'btn-danger',
  warning: 'btn-warning',
  info: 'btn-primary',
  default: 'btn-primary',
};

/**
 * Drop-in replacement for the legacy ConfirmModal.
 * Uses Radix AlertDialog under the hood.
 */
export function ConfirmModal({
  isOpen,
  onConfirm,
  onCancel,
  title = 'Confirm Action',
  message = 'Are you sure you want to proceed?',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default',
  loading = false,
  children,
}) {
  const Icon = VARIANT_ICONS[variant] || VARIANT_ICONS.default;

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onCancel?.()}>
      <AlertDialogContent variant={variant}>
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <Icon className="h-6 w-6" style={{ color: `var(--accent-${variant === 'danger' ? 'red' : variant === 'warning' ? 'yellow' : 'cyan'})` }} />
            <AlertDialogTitle>{title}</AlertDialogTitle>
          </div>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{cancelText}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={loading}
            className={VARIANT_CLASSES[variant]}
          >
            {loading ? 'Please wait...' : confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default ConfirmModal;
```

### 2.9 Update UI Index Export

**File:** `src/components/ui/index.js`

```javascript
export * from './accordion';
export * from './alert-dialog';
export * from './badge';
export * from './bento-card';
export * from './cn';
export * from './collapsible-section';
export * from './dialog';
export * from './metric-card';
export * from './select';
export * from './switch';
export * from './tabs';
export * from './tooltip';
```

### 2.10 Files to Create/Modify

| Action | File |
|--------|------|
| Create | `src/components/ui/dialog.jsx` |
| Create | `src/components/ui/alert-dialog.jsx` |
| Create | `src/components/ui/tooltip.jsx` |
| Create | `src/components/ui/tabs.jsx` |
| Create | `src/components/ui/select.jsx` |
| Create | `src/components/ui/switch.jsx` |
| Modify | `src/components/common/ConfirmModal.jsx` (use AlertDialog) |
| Modify | `src/components/common/TabBar.jsx` (use Tabs) |
| Modify | `src/components/ui/index.js` (add exports) |

### 2.11 Deliverables Checklist

- [ ] All Radix primitives installed
- [ ] Dialog, AlertDialog, Tooltip, Tabs, Select, Switch created
- [ ] ConfirmModal migrated to use AlertDialog
- [ ] TabBar migrated to use Radix Tabs
- [ ] Keyboard navigation verified in all components
- [ ] Stories created for new components

---

## Phase 3: TanStack Query Migration

**Goal:** Replace manual data fetching with React Query for caching, deduplication, and automatic refetching.

### 3.1 Install Dependencies

```bash
npm install @tanstack/react-query @tanstack/react-query-devtools
```

### 3.2 Create Query Client Provider

**File:** `src/providers/QueryProvider.jsx`

```jsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30 seconds
      gcTime: 1000 * 60 * 5, // 5 minutes (formerly cacheTime)
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
});

export function QueryProvider({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}

export { queryClient };
```

### 3.3 Create API Layer

**File:** `src/lib/api.js`

```javascript
/**
 * API client with standardized error handling for Django REST Framework.
 */

const API_BASE = '';

class ApiError extends Error {
  constructor(message, status, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Parse Django REST Framework error responses.
 */
function parseDRFError(data) {
  if (!data) return 'Unknown error';
  if (typeof data === 'string') return data;

  if (data.detail) {
    return typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
  }

  if (data.non_field_errors) {
    return Array.isArray(data.non_field_errors)
      ? data.non_field_errors.join(', ')
      : data.non_field_errors;
  }

  const fieldErrors = [];
  for (const [field, errors] of Object.entries(data)) {
    if (Array.isArray(errors)) {
      fieldErrors.push(`${field}: ${errors.join(', ')}`);
    } else if (typeof errors === 'string') {
      fieldErrors.push(`${field}: ${errors}`);
    }
  }

  return fieldErrors.length > 0 ? fieldErrors.join('; ') : JSON.stringify(data);
}

/**
 * Make an API request with standardized error handling.
 */
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;

  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };

  const response = await fetch(url, config);

  const contentType = response.headers.get('content-type');
  let data = null;

  if (contentType?.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      // Empty response
    }
  }

  if (!response.ok) {
    const errorMessage = data ? parseDRFError(data) : `HTTP ${response.status}`;
    throw new ApiError(errorMessage, response.status, data);
  }

  return data;
}

// API endpoints
export const api = {
  // Aircraft
  getAircraft: () => apiRequest('/api/v1/aircraft/'),
  getAircraftDetail: (hex) => apiRequest(`/api/v1/aircraft/${hex}/`),
  getAircraftHistory: (hex) => apiRequest(`/api/v1/aircraft/${hex}/history/`),

  // Stats
  getStats: () => apiRequest('/api/v1/stats/'),
  getStatsSession: () => apiRequest('/api/v1/stats/session/'),
  getStatsRecords: () => apiRequest('/api/v1/stats/records/'),

  // Alerts
  getAlertRules: () => apiRequest('/api/v1/alerts/rules/'),
  createAlertRule: (data) => apiRequest('/api/v1/alerts/rules/', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateAlertRule: (id, data) => apiRequest(`/api/v1/alerts/rules/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),
  deleteAlertRule: (id) => apiRequest(`/api/v1/alerts/rules/${id}/`, {
    method: 'DELETE',
  }),
  getAlertHistory: () => apiRequest('/api/v1/alerts/history/'),

  // History
  getHistoryFlights: (params = {}) => {
    const searchParams = new URLSearchParams(params);
    return apiRequest(`/api/v1/history/flights/?${searchParams}`);
  },

  // ACARS
  getAcarsMessages: () => apiRequest('/api/v1/acars/messages/'),
  getAcarsStats: () => apiRequest('/api/v1/acars/stats/'),

  // Safety
  getSafetyEvents: () => apiRequest('/api/v1/safety/events/'),

  // NOTAMs
  getNotams: () => apiRequest('/api/v1/notams/'),

  // System
  getSystemStatus: () => apiRequest('/api/v1/system/status/'),
};

export { ApiError, parseDRFError };
```

### 3.4 Create Query Hooks

**File:** `src/hooks/queries/useAircraftQueries.js`

```javascript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

// Query key factory
export const aircraftKeys = {
  all: ['aircraft'],
  lists: () => [...aircraftKeys.all, 'list'],
  list: (filters) => [...aircraftKeys.lists(), filters],
  details: () => [...aircraftKeys.all, 'detail'],
  detail: (hex) => [...aircraftKeys.details(), hex],
  history: (hex) => [...aircraftKeys.detail(hex), 'history'],
};

/**
 * Fetch all tracked aircraft.
 */
export function useAircraft(options = {}) {
  return useQuery({
    queryKey: aircraftKeys.lists(),
    queryFn: () => api.getAircraft(),
    staleTime: 1000 * 5, // 5 seconds - aircraft data is frequently updated
    ...options,
  });
}

/**
 * Fetch single aircraft details.
 */
export function useAircraftDetail(hex, options = {}) {
  return useQuery({
    queryKey: aircraftKeys.detail(hex),
    queryFn: () => api.getAircraftDetail(hex),
    enabled: !!hex,
    staleTime: 1000 * 10,
    ...options,
  });
}

/**
 * Fetch aircraft position history.
 */
export function useAircraftHistory(hex, options = {}) {
  return useQuery({
    queryKey: aircraftKeys.history(hex),
    queryFn: () => api.getAircraftHistory(hex),
    enabled: !!hex,
    staleTime: 1000 * 30,
    ...options,
  });
}
```

**File:** `src/hooks/queries/useStatsQueries.js`

```javascript
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

export const statsKeys = {
  all: ['stats'],
  current: () => [...statsKeys.all, 'current'],
  session: () => [...statsKeys.all, 'session'],
  records: () => [...statsKeys.all, 'records'],
};

/**
 * Fetch current stats with auto-refresh.
 */
export function useStats(options = {}) {
  return useQuery({
    queryKey: statsKeys.current(),
    queryFn: () => api.getStats(),
    staleTime: 1000 * 5,
    refetchInterval: 1000 * 10, // Auto-refresh every 10 seconds
    ...options,
  });
}

/**
 * Fetch session stats.
 */
export function useSessionStats(options = {}) {
  return useQuery({
    queryKey: statsKeys.session(),
    queryFn: () => api.getStatsSession(),
    staleTime: 1000 * 30,
    ...options,
  });
}

/**
 * Fetch record stats.
 */
export function useRecordStats(options = {}) {
  return useQuery({
    queryKey: statsKeys.records(),
    queryFn: () => api.getStatsRecords(),
    staleTime: 1000 * 60,
    ...options,
  });
}
```

**File:** `src/hooks/queries/useAlertQueries.js`

```javascript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

export const alertKeys = {
  all: ['alerts'],
  rules: () => [...alertKeys.all, 'rules'],
  history: () => [...alertKeys.all, 'history'],
};

/**
 * Fetch alert rules.
 */
export function useAlertRules(options = {}) {
  return useQuery({
    queryKey: alertKeys.rules(),
    queryFn: () => api.getAlertRules(),
    staleTime: 1000 * 60,
    ...options,
  });
}

/**
 * Create a new alert rule.
 */
export function useCreateAlertRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => api.createAlertRule(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: alertKeys.rules() });
    },
  });
}

/**
 * Update an existing alert rule.
 */
export function useUpdateAlertRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => api.updateAlertRule(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: alertKeys.rules() });
    },
  });
}

/**
 * Delete an alert rule.
 */
export function useDeleteAlertRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => api.deleteAlertRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: alertKeys.rules() });
    },
  });
}

/**
 * Fetch alert history.
 */
export function useAlertHistory(options = {}) {
  return useQuery({
    queryKey: alertKeys.history(),
    queryFn: () => api.getAlertHistory(),
    staleTime: 1000 * 30,
    ...options,
  });
}
```

### 3.5 Create Query Hooks Index

**File:** `src/hooks/queries/index.js`

```javascript
export * from './useAircraftQueries';
export * from './useStatsQueries';
export * from './useAlertQueries';
```

### 3.6 Update App Entry Point

**File:** `src/main.jsx` (update)

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { QueryProvider } from './providers/QueryProvider';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider } from './context/AuthContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryProvider>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </QueryProvider>
  </React.StrictMode>
);
```

### 3.7 Migration Example: useAlertRules

**Before (current `src/hooks/useAlertRules.js`):**

```javascript
// Current implementation with useState/useEffect
export function useAlertRules() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchRules = useCallback(async () => {
    // ... fetch logic
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  // ... CRUD operations

  return { rules, loading, error, createRule, updateRule, deleteRule, refetch: fetchRules };
}
```

**After (using TanStack Query):**

```javascript
import { useAlertRules as useAlertRulesQuery, useCreateAlertRule, useUpdateAlertRule, useDeleteAlertRule } from './queries/useAlertQueries';
import { useToastContext } from '../context/ToastContext';

/**
 * Drop-in replacement for legacy useAlertRules.
 * Uses TanStack Query under the hood.
 */
export function useAlertRules() {
  const { addToast } = useToastContext();

  const { data: rules = [], isLoading: loading, error, refetch } = useAlertRulesQuery();

  const createMutation = useCreateAlertRule();
  const updateMutation = useUpdateAlertRule();
  const deleteMutation = useDeleteAlertRule();

  const createRule = async (ruleData) => {
    try {
      await createMutation.mutateAsync(ruleData);
      addToast({ type: 'success', message: 'Alert rule created' });
    } catch (err) {
      addToast({ type: 'error', message: err.message });
      throw err;
    }
  };

  const updateRule = async (id, ruleData) => {
    try {
      await updateMutation.mutateAsync({ id, data: ruleData });
      addToast({ type: 'success', message: 'Alert rule updated' });
    } catch (err) {
      addToast({ type: 'error', message: err.message });
      throw err;
    }
  };

  const deleteRule = async (id) => {
    try {
      await deleteMutation.mutateAsync(id);
      addToast({ type: 'success', message: 'Alert rule deleted' });
    } catch (err) {
      addToast({ type: 'error', message: err.message });
      throw err;
    }
  };

  return {
    rules,
    loading,
    error: error?.message ?? null,
    createRule,
    updateRule,
    deleteRule,
    refetch,
  };
}
```

### 3.8 Files to Create/Modify

| Action | File |
|--------|------|
| Create | `src/providers/QueryProvider.jsx` |
| Create | `src/lib/api.js` |
| Create | `src/hooks/queries/useAircraftQueries.js` |
| Create | `src/hooks/queries/useStatsQueries.js` |
| Create | `src/hooks/queries/useAlertQueries.js` |
| Create | `src/hooks/queries/index.js` |
| Modify | `src/main.jsx` (add QueryProvider) |
| Modify | `src/hooks/useAlertRules.js` (use Query internally) |
| Modify | `src/hooks/useApi.js` (deprecate, keep for backward compat) |
| Modify | `src/hooks/useStats.js` (use Query internally) |

### 3.9 Migration Order

1. Install dependencies, create QueryProvider
2. Create `src/lib/api.js` with all endpoints
3. Create query hooks starting with simpler endpoints (stats)
4. Migrate one hook at a time, testing thoroughly
5. Add React Query DevTools for debugging
6. Remove old polling logic once Query is stable

### 3.10 Deliverables Checklist

- [ ] TanStack Query installed and provider configured
- [ ] API layer created with all endpoints
- [ ] Query hooks created for aircraft, stats, alerts
- [ ] DevTools working in development
- [ ] At least 3 existing hooks migrated
- [ ] Polling replaced with Query's refetchInterval
- [ ] Error handling standardized

---

## Phase 4: Accessibility Audit & Fixes

**Goal:** Ensure WCAG 2.1 AA compliance across all components.

### 4.1 Install Accessibility Tooling

```bash
npm install -D eslint-plugin-jsx-a11y @axe-core/react
```

### 4.2 Configure ESLint for Accessibility

**Update:** `.eslintrc.cjs`

```javascript
module.exports = {
  // ... existing config
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:jsx-a11y/recommended', // Add this
  ],
  plugins: ['react', 'react-hooks', 'jsx-a11y'], // Add jsx-a11y
  rules: {
    // ... existing rules

    // Accessibility rules - strict mode
    'jsx-a11y/alt-text': 'error',
    'jsx-a11y/anchor-has-content': 'error',
    'jsx-a11y/anchor-is-valid': 'error',
    'jsx-a11y/aria-props': 'error',
    'jsx-a11y/aria-proptypes': 'error',
    'jsx-a11y/aria-role': 'error',
    'jsx-a11y/aria-unsupported-elements': 'error',
    'jsx-a11y/click-events-have-key-events': 'error',
    'jsx-a11y/heading-has-content': 'error',
    'jsx-a11y/html-has-lang': 'error',
    'jsx-a11y/img-redundant-alt': 'error',
    'jsx-a11y/interactive-supports-focus': 'error',
    'jsx-a11y/label-has-associated-control': 'error',
    'jsx-a11y/no-access-key': 'error',
    'jsx-a11y/no-autofocus': 'warn',
    'jsx-a11y/no-distracting-elements': 'error',
    'jsx-a11y/no-noninteractive-element-interactions': 'warn',
    'jsx-a11y/no-noninteractive-tabindex': 'warn',
    'jsx-a11y/no-redundant-roles': 'error',
    'jsx-a11y/no-static-element-interactions': 'warn',
    'jsx-a11y/role-has-required-aria-props': 'error',
    'jsx-a11y/role-supports-aria-props': 'error',
    'jsx-a11y/tabindex-no-positive': 'error',
  },
};
```

### 4.3 Add Runtime A11y Checking (Dev Only)

**File:** `src/utils/a11y.js`

```javascript
/**
 * Initialize accessibility checking in development.
 */
export async function initA11y() {
  if (import.meta.env.DEV) {
    const axe = await import('@axe-core/react');
    const React = await import('react');
    const ReactDOM = await import('react-dom');

    axe.default(React.default, ReactDOM.default, 1000, {
      rules: [
        { id: 'color-contrast', enabled: true },
        { id: 'label', enabled: true },
        { id: 'button-name', enabled: true },
        { id: 'image-alt', enabled: true },
      ],
    });
  }
}
```

**Update:** `src/main.jsx`

```javascript
import { initA11y } from './utils/a11y';

// Initialize accessibility checking
initA11y();
```

### 4.4 Create Accessible Form Components

**File:** `src/components/ui/form.jsx`

```jsx
import * as React from 'react';
import { cn } from './cn';

const FormField = React.forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn('space-y-2', className)} {...props}>
    {children}
  </div>
));
FormField.displayName = 'FormField';

const FormLabel = React.forwardRef(({ className, required, children, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      'text-sm font-medium text-text-primary',
      'peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
      className
    )}
    {...props}
  >
    {children}
    {required && <span className="text-accent-red ml-1" aria-hidden="true">*</span>}
    {required && <span className="sr-only">(required)</span>}
  </label>
));
FormLabel.displayName = 'FormLabel';

const FormInput = React.forwardRef(
  ({ className, type = 'text', hasError, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-md border bg-bg-card px-3 py-2',
        'text-sm text-text-primary placeholder:text-text-dim',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        hasError
          ? 'border-accent-red focus-visible:ring-accent-red'
          : 'border-border focus-visible:ring-accent-cyan',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      aria-invalid={hasError ? 'true' : undefined}
      {...props}
    />
  )
);
FormInput.displayName = 'FormInput';

const FormTextarea = React.forwardRef(
  ({ className, hasError, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-md border bg-bg-card px-3 py-2',
        'text-sm text-text-primary placeholder:text-text-dim',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        hasError
          ? 'border-accent-red focus-visible:ring-accent-red'
          : 'border-border focus-visible:ring-accent-cyan',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      aria-invalid={hasError ? 'true' : undefined}
      {...props}
    />
  )
);
FormTextarea.displayName = 'FormTextarea';

const FormError = React.forwardRef(({ className, children, id, ...props }, ref) => (
  <p
    ref={ref}
    id={id}
    role="alert"
    aria-live="polite"
    className={cn('text-sm text-accent-red', className)}
    {...props}
  >
    {children}
  </p>
));
FormError.displayName = 'FormError';

const FormDescription = React.forwardRef(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-sm text-text-secondary', className)}
    {...props}
  />
));
FormDescription.displayName = 'FormDescription';

export {
  FormField,
  FormLabel,
  FormInput,
  FormTextarea,
  FormError,
  FormDescription,
};
```

### 4.5 Add Reduced Motion Support

**File:** `src/hooks/useReducedMotion.js`

```javascript
import { useState, useEffect } from 'react';

/**
 * Hook to detect user's reduced motion preference.
 */
export function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    // Set initial value
    setReducedMotion(mediaQuery.matches);

    // Listen for changes
    const handler = (event) => setReducedMotion(event.matches);
    mediaQuery.addEventListener('change', handler);

    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  return reducedMotion;
}
```

**Update:** `src/design-system/motion.js`

```javascript
// Add reduced motion variants
export const getMotionProps = (reducedMotion) => {
  if (reducedMotion) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0 },
    };
  }
  return slideUp;
};
```

### 4.6 Add CSS Reduced Motion Support

**Update:** `src/styles/base.css`

```css
/* Respect user's motion preferences */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

### 4.7 Accessibility Fixes Checklist

| Component | Issue | Fix |
|-----------|-------|-----|
| All buttons | Missing accessible names | Add `aria-label` for icon-only buttons |
| Tables | Missing captions | Add `<caption>` or `aria-label` |
| Forms | Labels not associated | Use `htmlFor` matching input `id` |
| Modals | Focus not trapped | Already fixed in Radix migration |
| Images | Missing alt text | Add descriptive `alt` attributes |
| Color indicators | Color-only meaning | Add text/icon alternatives |
| Loading states | Not announced | Add `aria-live` regions |
| Errors | Not announced | Add `role="alert"` |
| Skip link | Already exists | Verify works on all pages |

### 4.8 Create Focus Trap Utility

**File:** `src/hooks/useFocusTrap.js`

```javascript
import { useEffect, useRef } from 'react';

/**
 * Trap focus within a container element.
 * Use for modals, dialogs, and other overlay components.
 */
export function useFocusTrap(isActive = true) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    const container = containerRef.current;
    const focusableSelector = [
      'button:not([disabled])',
      'a[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const focusableElements = container.querySelectorAll(focusableSelector);
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleKeyDown = (e) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);

    // Focus first element
    firstElement?.focus();

    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [isActive]);

  return containerRef;
}
```

### 4.9 Files to Create/Modify

| Action | File |
|--------|------|
| Modify | `.eslintrc.cjs` (add jsx-a11y) |
| Create | `src/utils/a11y.js` |
| Create | `src/components/ui/form.jsx` |
| Create | `src/hooks/useReducedMotion.js` |
| Create | `src/hooks/useFocusTrap.js` |
| Modify | `src/styles/base.css` (reduced motion) |
| Modify | `src/design-system/motion.js` (reduced motion variants) |
| Modify | All icon-only buttons (add aria-label) |
| Modify | All form inputs (associate labels) |
| Modify | `src/main.jsx` (initialize axe) |

### 4.10 Testing Accessibility

```bash
# Run ESLint a11y checks
npm run lint

# Manual testing checklist:
# 1. Navigate with keyboard only (Tab, Shift+Tab, Enter, Escape)
# 2. Use screen reader (VoiceOver on Mac, NVDA on Windows)
# 3. Check color contrast with browser DevTools
# 4. Test with 200% zoom
# 5. Test with reduced motion enabled
```

### 4.11 Deliverables Checklist

- [ ] eslint-plugin-jsx-a11y installed and configured
- [ ] All lint errors fixed
- [ ] @axe-core/react logging violations in dev console
- [ ] Reduced motion CSS and JS support added
- [ ] All icon-only buttons have aria-labels
- [ ] All form inputs have associated labels
- [ ] Skip link verified working
- [ ] Focus indicators visible on all interactive elements

---

## Phase 5: TypeScript Migration

**Goal:** Add type safety incrementally, starting with UI components.

### 5.1 Install TypeScript

```bash
npm install -D typescript @types/react @types/react-dom
```

### 5.2 Create TypeScript Configuration

**File:** `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",

    /* Linting */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,

    /* Allow JS files during migration */
    "allowJs": true,
    "checkJs": false,

    /* Path aliases */
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@/components/*": ["src/components/*"],
      "@/hooks/*": ["src/hooks/*"],
      "@/lib/*": ["src/lib/*"],
      "@/design-system/*": ["src/design-system/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

**File:** `tsconfig.node.json`

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts", "tailwind.config.ts"]
}
```

### 5.3 Update Vite Config

**Rename:** `vite.config.js` → `vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

### 5.4 Create Type Definitions

**File:** `src/types/index.ts`

```typescript
// Aircraft types
export interface Aircraft {
  hex: string;
  flight?: string;
  registration?: string;
  type?: string;
  squawk?: string;
  lat?: number;
  lon?: number;
  altitude?: number;
  speed?: number;
  track?: number;
  vertical_rate?: number;
  seen?: number;
  rssi?: number;
  messages?: number;
  category?: string;
  emergency?: string;
  military?: boolean;
  interesting?: boolean;
}

export interface AircraftPosition {
  lat: number;
  lon: number;
  altitude?: number;
  timestamp: number;
}

// Alert types
export interface AlertRule {
  id: number;
  name: string;
  description?: string;
  conditions: AlertCondition[];
  actions: AlertAction[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AlertCondition {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'regex';
  value: string | number | boolean;
}

export interface AlertAction {
  type: 'notification' | 'sound' | 'webhook';
  config: Record<string, unknown>;
}

export interface AlertEvent {
  id: number;
  rule_id: number;
  rule_name: string;
  aircraft_hex: string;
  triggered_at: string;
  message: string;
}

// Stats types
export interface Stats {
  aircraft_count: number;
  aircraft_with_position: number;
  messages_per_second: number;
  total_messages: number;
  unique_aircraft_today: number;
  max_range_nm?: number;
  max_altitude_ft?: number;
}

export interface SessionStats {
  session_start: string;
  aircraft_seen: number;
  flights_tracked: number;
  messages_received: number;
  peak_aircraft: number;
  peak_time: string;
}

// ACARS types
export interface AcarsMessage {
  id: number;
  flight?: string;
  registration?: string;
  message_type: string;
  label: string;
  text: string;
  received_at: string;
}

// Safety types
export interface SafetyEvent {
  id: number;
  event_type: 'squawk_7500' | 'squawk_7600' | 'squawk_7700' | 'tcas_ra' | 'emergency';
  aircraft_hex: string;
  aircraft_flight?: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  created_at: string;
}

// Component prop types
export type Variant = 'default' | 'primary' | 'secondary' | 'danger' | 'warning';
export type Size = 'sm' | 'md' | 'lg';
```

### 5.5 Convert Design System to TypeScript

**Rename:** `src/design-system/tokens.js` → `src/design-system/tokens.ts`

```typescript
export const colors = {
  background: {
    dark: '#0d1117',
    card: '#151b24',
    hover: '#1c2432',
  },
  // ... rest of tokens
} as const;

export type ColorToken = typeof colors;
export type BackgroundColor = keyof typeof colors.background;
export type AccentColor = keyof typeof colors.accent;
```

### 5.6 Convert UI Components to TypeScript

**Rename:** `src/components/ui/badge.jsx` → `src/components/ui/badge.tsx`

```tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn';

const badgeVariants = cva(
  'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
  {
    variants: {
      variant: {
        default: 'bg-bg-hover text-text-secondary ring-border',
        military: 'bg-accent-red/10 text-accent-red ring-accent-red/30',
        success: 'bg-accent-green/10 text-accent-green ring-accent-green/30',
        warning: 'bg-accent-yellow/10 text-accent-yellow ring-accent-yellow/30',
        source: 'bg-accent-blue/10 text-accent-blue ring-accent-blue/30',
      },
      size: {
        sm: 'text-[10px] px-1.5 py-0',
        default: 'text-xs px-2 py-0.5',
        lg: 'text-sm px-2.5 py-1',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props} />
  );
}
```

**Rename:** `src/components/ui/cn.js` → `src/components/ui/cn.ts`

```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### 5.7 Migration Order

1. **Week 1:** Setup TypeScript, create type definitions
2. **Week 2:** Convert `design-system/` and `lib/`
3. **Week 3:** Convert `components/ui/`
4. **Week 4:** Convert `hooks/queries/`
5. **Week 5:** Convert `components/common/`
6. **Week 6+:** Convert remaining components and hooks

### 5.8 Files to Create/Modify

| Action | File |
|--------|------|
| Create | `tsconfig.json` |
| Create | `tsconfig.node.json` |
| Create | `src/types/index.ts` |
| Rename | `vite.config.js` → `vite.config.ts` |
| Rename | `src/design-system/*.js` → `*.ts` |
| Rename | `src/components/ui/*.jsx` → `*.tsx` |
| Rename | `src/lib/api.js` → `src/lib/api.ts` |
| Modify | `package.json` (add type-check script) |

### 5.9 Add Type Check Script

**Update:** `package.json`

```json
{
  "scripts": {
    "type-check": "tsc --noEmit",
    "type-check:watch": "tsc --noEmit --watch"
  }
}
```

### 5.10 Deliverables Checklist

- [ ] TypeScript configured with strict mode
- [ ] Path aliases working
- [ ] Type definitions created for all domain entities
- [ ] `design-system/` fully typed
- [ ] `components/ui/` fully typed
- [ ] `lib/api.ts` fully typed
- [ ] `hooks/queries/` fully typed
- [ ] No TypeScript errors in converted files
- [ ] `npm run type-check` passes

---

## Phase 6: Performance Optimization

**Goal:** Improve bundle size, rendering performance, and perceived speed.

### 6.1 Install Analysis Tools

```bash
npm install -D rollup-plugin-visualizer
```

### 6.2 Configure Bundle Analyzer

**Update:** `vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    visualizer({
      filename: 'dist/stats.html',
      open: true,
      gzipSize: true,
      brotliSize: true,
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-radix': [
            '@radix-ui/react-accordion',
            '@radix-ui/react-dialog',
            '@radix-ui/react-tooltip',
            '@radix-ui/react-tabs',
            '@radix-ui/react-select',
          ],
          'vendor-motion': ['framer-motion'],
          'vendor-map': ['leaflet'],
          'vendor-query': ['@tanstack/react-query'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

### 6.3 Optimize Lucide Icons

**File:** `src/components/icons/index.tsx`

```tsx
/**
 * Re-export only the icons we use to enable tree-shaking.
 * Import from this file instead of 'lucide-react' directly.
 */

export {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Filter,
  Globe,
  Info,
  Loader2,
  MapPin,
  Menu,
  Pause,
  Plane,
  Play,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';

// Type re-exports
export type { LucideIcon, LucideProps } from 'lucide-react';
```

### 6.4 Implement Code Splitting for Views

**File:** `src/views/index.tsx`

```tsx
import { lazy, Suspense } from 'react';
import { Skeleton } from '@/components/common/Skeleton';

// Lazy load all view components
const MapView = lazy(() => import('./MapView'));
const AircraftListView = lazy(() => import('./AircraftListView'));
const HistoryView = lazy(() => import('./HistoryView'));
const AlertsView = lazy(() => import('./AlertsView'));
const StatsView = lazy(() => import('./StatsView'));
const AcarsView = lazy(() => import('./AcarsView'));
const SafetyView = lazy(() => import('./SafetyView'));
const SettingsView = lazy(() => import('./SettingsView'));
const SystemView = lazy(() => import('./SystemView'));

// Loading fallback
function ViewSkeleton() {
  return (
    <div className="p-6 space-y-4">
      <Skeleton variant="text" className="h-8 w-48" />
      <Skeleton variant="card" className="h-64" />
      <Skeleton variant="card" className="h-64" />
    </div>
  );
}

// Wrapper with Suspense
function SuspenseView({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<ViewSkeleton />}>{children}</Suspense>;
}

export const views = {
  map: () => <SuspenseView><MapView /></SuspenseView>,
  list: () => <SuspenseView><AircraftListView /></SuspenseView>,
  history: () => <SuspenseView><HistoryView /></SuspenseView>,
  alerts: () => <SuspenseView><AlertsView /></SuspenseView>,
  stats: () => <SuspenseView><StatsView /></SuspenseView>,
  acars: () => <SuspenseView><AcarsView /></SuspenseView>,
  safety: () => <SuspenseView><SafetyView /></SuspenseView>,
  settings: () => <SuspenseView><SettingsView /></SuspenseView>,
  system: () => <SuspenseView><SystemView /></SuspenseView>,
};
```

### 6.5 Add Image Optimization Utilities

**File:** `src/utils/images.ts`

```typescript
/**
 * Lazy load images with native loading attribute.
 */
export interface OptimizedImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  loading?: 'lazy' | 'eager';
}

export function getImageProps({
  src,
  alt,
  width,
  height,
  loading = 'lazy',
}: OptimizedImageProps): React.ImgHTMLAttributes<HTMLImageElement> {
  return {
    src,
    alt,
    width,
    height,
    loading,
    decoding: 'async',
  };
}
```

### 6.6 Optimize List Rendering

**File:** `src/components/common/VirtualList.tsx`

```tsx
import { useRef, useState, useEffect, useCallback } from 'react';

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  containerHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  overscan?: number;
  className?: string;
}

export function VirtualList<T>({
  items,
  itemHeight,
  containerHeight,
  renderItem,
  overscan = 3,
  className,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const totalHeight = items.length * itemHeight;
  const visibleCount = Math.ceil(containerHeight / itemHeight);
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(items.length, startIndex + visibleCount + overscan * 2);

  const visibleItems = items.slice(startIndex, endIndex);
  const offsetY = startIndex * itemHeight;

  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      setScrollTop(containerRef.current.scrollTop);
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true });
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ height: containerHeight, overflow: 'auto' }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {visibleItems.map((item, index) => (
            <div key={startIndex + index} style={{ height: itemHeight }}>
              {renderItem(item, startIndex + index)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

### 6.7 Add Performance Monitoring

**File:** `src/utils/performance.ts`

```typescript
/**
 * Performance monitoring utilities.
 */

export function measureRender(componentName: string) {
  if (import.meta.env.DEV) {
    const start = performance.now();
    return () => {
      const duration = performance.now() - start;
      if (duration > 16) {
        console.warn(`[Perf] ${componentName} render took ${duration.toFixed(2)}ms`);
      }
    };
  }
  return () => {};
}

export function reportWebVitals() {
  if (import.meta.env.PROD) {
    import('web-vitals').then(({ onCLS, onFID, onFCP, onLCP, onTTFB }) => {
      onCLS(console.log);
      onFID(console.log);
      onFCP(console.log);
      onLCP(console.log);
      onTTFB(console.log);
    });
  }
}
```

### 6.8 Memoization Guidelines

```tsx
// DO: Memoize expensive computations
const sortedAircraft = useMemo(
  () => aircraft.sort((a, b) => b.altitude - a.altitude),
  [aircraft]
);

// DO: Memoize callbacks passed to children
const handleSelect = useCallback(
  (hex: string) => setSelectedAircraft(hex),
  []
);

// DO: Use React.memo for pure components
const AircraftRow = React.memo(function AircraftRow({ aircraft, onSelect }) {
  // ...
});

// DON'T: Memoize everything blindly
// Only memoize when there's a measurable benefit
```

### 6.9 Files to Create/Modify

| Action | File |
|--------|------|
| Modify | `vite.config.ts` (add visualizer, manual chunks) |
| Create | `src/components/icons/index.tsx` |
| Create | `src/views/index.tsx` (lazy loading) |
| Create | `src/utils/images.ts` |
| Create | `src/utils/performance.ts` |
| Modify | `src/components/common/VirtualList.tsx` (TypeScript) |
| Modify | Components using icons (import from local index) |

### 6.10 Performance Targets

| Metric | Target |
|--------|--------|
| Initial JS bundle | < 150KB gzipped |
| Largest Contentful Paint | < 2.5s |
| First Input Delay | < 100ms |
| Cumulative Layout Shift | < 0.1 |
| Time to Interactive | < 3.5s |

### 6.11 Deliverables Checklist

- [ ] Bundle analyzer configured and producing stats
- [ ] Vendor chunks split appropriately
- [ ] Icons tree-shaken (only used icons in bundle)
- [ ] All views lazy-loaded with Suspense
- [ ] VirtualList used for long lists
- [ ] Image loading optimized
- [ ] React.memo applied to appropriate components
- [ ] No layout shifts in core UI
- [ ] Web Vitals within targets

---

## Phase 7: Admin Settings Page

**Goal:** Build a comprehensive admin settings UI with category navigation, real-time validation, pending changes tracking, and audit log viewing.

### 7.1 Overview

The Admin Settings page provides administrators with a web interface to manage ~70 runtime-editable system configurations across 12 categories. This phase implements the frontend for the `/api/v1/admin/config/` endpoints.

**Key Features:**
- Category-based navigation with setting counts
- Pending changes tracking with bulk save
- Real-time validation feedback
- Restart requirement warnings
- Sensitive value masking with reveal
- Audit log viewer
- Export/Import functionality

### 7.2 Create Admin Settings View

**File:** `src/views/AdminSettingsView.tsx`

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AdminConfigCategory } from '@/components/admin/AdminConfigCategory';
import { AdminAuditLog } from '@/components/admin/AdminAuditLog';
import { AdminConfigExport } from '@/components/admin/AdminConfigExport';
import { api } from '@/lib/api';
import { Settings, History, Download } from '@/components/icons';

export default function AdminSettingsView() {
  const [activeTab, setActiveTab] = useState('settings');
  const [pendingChanges, setPendingChanges] = useState<Record<string, string>>({});

  const { data: configData, isLoading } = useQuery({
    queryKey: ['admin', 'config'],
    queryFn: () => api.getAdminConfig(),
  });

  const hasPendingChanges = Object.keys(pendingChanges).length > 0;

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">System Configuration</h1>
          <p className="text-text-secondary mt-1">
            Manage runtime settings across {configData?.total_count ?? 0} configurations
          </p>
        </div>
        {hasPendingChanges && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-accent-yellow">
              {Object.keys(pendingChanges).length} unsaved changes
            </span>
            <button className="btn-primary">Save All</button>
          </div>
        )}
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="settings">
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </TabsTrigger>
          <TabsTrigger value="audit">
            <History className="w-4 h-4 mr-2" />
            Audit Log
          </TabsTrigger>
          <TabsTrigger value="export">
            <Download className="w-4 h-4 mr-2" />
            Export/Import
          </TabsTrigger>
        </TabsList>

        <TabsContent value="settings">
          <AdminConfigSettings
            categories={configData?.categories ?? []}
            isLoading={isLoading}
            pendingChanges={pendingChanges}
            onPendingChange={(key, value) =>
              setPendingChanges((prev) => ({ ...prev, [key]: value }))
            }
          />
        </TabsContent>

        <TabsContent value="audit">
          <AdminAuditLog />
        </TabsContent>

        <TabsContent value="export">
          <AdminConfigExport />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

### 7.3 Create Category Navigation Component

**File:** `src/components/admin/AdminConfigSettings.tsx`

```tsx
import { useState } from 'react';
import { cn } from '@/components/ui/cn';
import { AdminConfigForm } from './AdminConfigForm';
import type { ConfigCategory } from '@/types/admin';

interface AdminConfigSettingsProps {
  categories: ConfigCategory[];
  isLoading: boolean;
  pendingChanges: Record<string, string>;
  onPendingChange: (key: string, value: string) => void;
}

const CATEGORY_ICONS: Record<string, React.ComponentType> = {
  adsb_sources: Radio,
  location: MapPin,
  safety: AlertTriangle,
  alerts: Bell,
  acars: MessageSquare,
  storage: Database,
  transcription: Mic,
  external_apis: Globe,
  monitoring: Activity,
  notifications: Send,
  aircraft_data: Plane,
  display: Monitor,
};

export function AdminConfigSettings({
  categories,
  isLoading,
  pendingChanges,
  onPendingChange,
}: AdminConfigSettingsProps) {
  const [activeCategory, setActiveCategory] = useState(categories[0]?.category ?? '');

  if (isLoading) {
    return <AdminConfigSkeleton />;
  }

  const activeConfig = categories.find((c) => c.category === activeCategory);

  return (
    <div className="flex gap-6 mt-4">
      {/* Category Navigation */}
      <nav className="w-64 shrink-0 space-y-1">
        {categories.map((cat) => {
          const Icon = CATEGORY_ICONS[cat.category] ?? Settings;
          const hasChanges = cat.configs.some((c) => c.key in pendingChanges);

          return (
            <button
              key={cat.category}
              onClick={() => setActiveCategory(cat.category)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-md text-left',
                'transition-colors',
                activeCategory === cat.category
                  ? 'bg-bg-hover text-text-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover/50'
              )}
            >
              <Icon className="w-4 h-4" />
              <span className="flex-1 truncate">{cat.category_display}</span>
              <span className="text-xs text-text-dim">{cat.configs.length}</span>
              {hasChanges && (
                <span className="w-2 h-2 rounded-full bg-accent-yellow" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Configuration Form */}
      <div className="flex-1 min-w-0">
        {activeConfig && (
          <AdminConfigForm
            category={activeConfig}
            pendingChanges={pendingChanges}
            onPendingChange={onPendingChange}
          />
        )}
      </div>
    </div>
  );
}
```

### 7.4 Create Configuration Form Component

**File:** `src/components/admin/AdminConfigForm.tsx`

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormField, FormLabel, FormInput, FormError, FormDescription } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { AlertTriangle, Eye, EyeOff, RefreshCw } from '@/components/icons';
import { api } from '@/lib/api';
import type { ConfigCategory, ConfigItem } from '@/types/admin';

interface AdminConfigFormProps {
  category: ConfigCategory;
  pendingChanges: Record<string, string>;
  onPendingChange: (key: string, value: string) => void;
}

export function AdminConfigForm({
  category,
  pendingChanges,
  onPendingChange,
}: AdminConfigFormProps) {
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      api.updateAdminConfig(key, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'config'] });
    },
  });

  return (
    <div className="space-y-6">
      <header className="pb-4 border-b border-border">
        <h2 className="text-lg font-medium text-text-primary">
          {category.category_display}
        </h2>
        <p className="text-sm text-text-secondary mt-1">
          {category.configs.length} configuration{category.configs.length !== 1 ? 's' : ''}
        </p>
      </header>

      <div className="space-y-6">
        {category.configs.map((config) => (
          <ConfigField
            key={config.key}
            config={config}
            pendingValue={pendingChanges[config.key]}
            onValueChange={(value) => onPendingChange(config.key, value)}
            onSave={(value) => updateMutation.mutate({ key: config.key, value })}
            isSaving={updateMutation.isPending}
          />
        ))}
      </div>
    </div>
  );
}

interface ConfigFieldProps {
  config: ConfigItem;
  pendingValue?: string;
  onValueChange: (value: string) => void;
  onSave: (value: string) => void;
  isSaving: boolean;
}

function ConfigField({
  config,
  pendingValue,
  onValueChange,
  onSave,
  isSaving,
}: ConfigFieldProps) {
  const [showSensitive, setShowSensitive] = useState(false);
  const currentValue = pendingValue ?? config.value;
  const hasChanged = pendingValue !== undefined && pendingValue !== config.value;

  return (
    <FormField>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <FormLabel htmlFor={config.key} className="flex items-center gap-2">
            {config.display_name}
            {config.requires_restart && (
              <span
                className="text-accent-yellow"
                title="Requires service restart"
              >
                <RefreshCw className="w-3 h-3" />
              </span>
            )}
            {config.has_env_override && (
              <span className="text-xs bg-bg-hover px-1.5 py-0.5 rounded">
                ENV override
              </span>
            )}
          </FormLabel>
          <FormDescription>{config.description}</FormDescription>
        </div>

        {hasChanged && (
          <button
            onClick={() => onSave(pendingValue!)}
            disabled={isSaving}
            className="btn-primary btn-sm"
          >
            Save
          </button>
        )}
      </div>

      {config.value_type === 'boolean' ? (
        <Switch
          id={config.key}
          checked={currentValue === 'true'}
          onCheckedChange={(checked) => onValueChange(checked ? 'true' : 'false')}
          disabled={config.is_readonly}
        />
      ) : config.is_sensitive ? (
        <div className="relative">
          <FormInput
            id={config.key}
            type={showSensitive ? 'text' : 'password'}
            value={currentValue}
            onChange={(e) => onValueChange(e.target.value)}
            disabled={config.is_readonly}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowSensitive(!showSensitive)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
          >
            {showSensitive ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      ) : (
        <FormInput
          id={config.key}
          type={config.value_type === 'integer' || config.value_type === 'float' ? 'number' : 'text'}
          value={currentValue}
          onChange={(e) => onValueChange(e.target.value)}
          disabled={config.is_readonly}
          min={config.validation_rules?.min}
          max={config.validation_rules?.max}
        />
      )}

      {config.is_readonly && (
        <p className="text-xs text-text-dim">
          This setting is read-only and can only be changed via environment variables.
        </p>
      )}
    </FormField>
  );
}
```

### 7.5 Create Audit Log Component

**File:** `src/components/admin/AdminAuditLog.tsx`

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { FormInput } from '@/components/ui/form';
import { api } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';

export function AdminAuditLog() {
  const [configKey, setConfigKey] = useState('');
  const [hours, setHours] = useState<number | undefined>(24);

  const { data: auditData, isLoading } = useQuery({
    queryKey: ['admin', 'config', 'audit', { configKey, hours }],
    queryFn: () => api.getAdminConfigAuditLog({ config_key: configKey || undefined, hours }),
  });

  return (
    <div className="space-y-4 mt-4">
      {/* Filters */}
      <div className="flex gap-4">
        <FormInput
          placeholder="Filter by config key..."
          value={configKey}
          onChange={(e) => setConfigKey(e.target.value)}
          className="w-64"
        />
        <Select value={String(hours ?? '')} onValueChange={(v) => setHours(v ? Number(v) : undefined)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Time range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Last hour</SelectItem>
            <SelectItem value="24">Last 24 hours</SelectItem>
            <SelectItem value="168">Last 7 days</SelectItem>
            <SelectItem value="">All time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Audit Log Table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-bg-hover">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Configuration</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Old Value</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">New Value</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Changed By</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {auditData?.audit_log.map((entry) => (
              <tr key={entry.id} className="hover:bg-bg-hover/50">
                <td className="px-4 py-3">
                  <div className="text-sm text-text-primary">{entry.config_display_name}</div>
                  <div className="text-xs text-text-dim font-mono">{entry.config_key}</div>
                </td>
                <td className="px-4 py-3">
                  <code className="text-sm text-text-secondary bg-bg-hover px-1.5 py-0.5 rounded">
                    {entry.old_value || '(empty)'}
                  </code>
                </td>
                <td className="px-4 py-3">
                  <code className="text-sm text-accent-cyan bg-bg-hover px-1.5 py-0.5 rounded">
                    {entry.new_value}
                  </code>
                </td>
                <td className="px-4 py-3 text-sm text-text-secondary">
                  {entry.changed_by_username}
                </td>
                <td className="px-4 py-3 text-sm text-text-secondary">
                  {formatDistanceToNow(new Date(entry.changed_at), { addSuffix: true })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {auditData?.audit_log.length === 0 && (
          <div className="px-4 py-8 text-center text-text-secondary">
            No configuration changes found for the selected filters.
          </div>
        )}
      </div>
    </div>
  );
}
```

### 7.6 Create Export/Import Component

**File:** `src/components/admin/AdminConfigExport.tsx`

```tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Switch } from '@/components/ui/switch';
import { FormLabel } from '@/components/ui/form';
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { Download, Upload, AlertTriangle } from '@/components/icons';
import { api } from '@/lib/api';

export function AdminConfigExport() {
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const queryClient = useQueryClient();

  const exportMutation = useMutation({
    mutationFn: () => api.exportAdminConfig({ include_sensitive: includeSensitive }),
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `skyspy-config-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const content = await file.text();
      const configs = JSON.parse(content);
      return api.importAdminConfig({ configs: configs.configs, dry_run: dryRun });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'config'] });
      setImportFile(null);
    },
  });

  return (
    <div className="grid md:grid-cols-2 gap-6 mt-4">
      {/* Export Section */}
      <div className="p-6 bg-bg-card border border-border rounded-lg space-y-4">
        <h3 className="text-lg font-medium text-text-primary flex items-center gap-2">
          <Download className="w-5 h-5" />
          Export Configuration
        </h3>
        <p className="text-sm text-text-secondary">
          Download all configuration settings as a JSON file for backup or transfer.
        </p>

        <div className="flex items-center justify-between">
          <FormLabel htmlFor="include-sensitive" className="flex items-center gap-2">
            Include sensitive values
            <AlertTriangle className="w-4 h-4 text-accent-yellow" />
          </FormLabel>
          <Switch
            id="include-sensitive"
            checked={includeSensitive}
            onCheckedChange={setIncludeSensitive}
          />
        </div>

        {includeSensitive && (
          <p className="text-xs text-accent-yellow">
            Warning: Export will contain API keys and secrets in plain text.
          </p>
        )}

        <button
          onClick={() => exportMutation.mutate()}
          disabled={exportMutation.isPending}
          className="btn-primary w-full"
        >
          {exportMutation.isPending ? 'Exporting...' : 'Export Configuration'}
        </button>
      </div>

      {/* Import Section */}
      <div className="p-6 bg-bg-card border border-border rounded-lg space-y-4">
        <h3 className="text-lg font-medium text-text-primary flex items-center gap-2">
          <Upload className="w-5 h-5" />
          Import Configuration
        </h3>
        <p className="text-sm text-text-secondary">
          Restore configuration from a previously exported JSON file.
        </p>

        <input
          type="file"
          accept=".json"
          onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-text-secondary file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-bg-hover file:text-text-primary hover:file:bg-bg-hover/80"
        />

        <div className="flex items-center justify-between">
          <FormLabel htmlFor="dry-run">
            Dry run (validate without applying)
          </FormLabel>
          <Switch
            id="dry-run"
            checked={dryRun}
            onCheckedChange={setDryRun}
          />
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              disabled={!importFile || importMutation.isPending}
              className="btn-secondary w-full"
            >
              {importMutation.isPending ? 'Importing...' : dryRun ? 'Validate Import' : 'Import Configuration'}
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {dryRun ? 'Validate Configuration Import' : 'Confirm Configuration Import'}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {dryRun
                  ? 'This will validate the configuration file without making any changes.'
                  : 'This will overwrite current configuration values. Are you sure you want to proceed?'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => importFile && importMutation.mutate(importFile)}>
                {dryRun ? 'Validate' : 'Import'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
```

### 7.7 Add Admin Types

**File:** `src/types/admin.ts`

```typescript
export interface ConfigItem {
  key: string;
  category: string;
  value: string;
  value_type: 'string' | 'integer' | 'float' | 'boolean' | 'json' | 'secret';
  display_name: string;
  description: string;
  validation_rules: {
    required?: boolean;
    min?: number;
    max?: number;
    pattern?: string;
    choices?: string[];
  };
  env_var: string;
  default_value: string;
  requires_restart: boolean;
  is_sensitive: boolean;
  is_readonly: boolean;
  sort_order: number;
  has_env_override: boolean;
  updated_at: string;
  updated_by_username: string;
}

export interface ConfigCategory {
  category: string;
  category_display: string;
  has_changes: boolean;
  configs: ConfigItem[];
}

export interface ConfigResponse {
  categories: ConfigCategory[];
  total_count: number;
}

export interface AuditLogEntry {
  id: number;
  config_key: string;
  config_display_name: string;
  old_value: string;
  new_value: string;
  changed_by: number;
  changed_by_username: string;
  changed_at: string;
  ip_address: string;
}

export interface AuditLogResponse {
  audit_log: AuditLogEntry[];
  count: number;
}

export interface ConfigExport {
  configs: Record<string, { value: string; category: string; value_type: string }>;
  exported_at: string;
  version: string;
  include_sensitive: boolean;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: Record<string, string>;
  dry_run: boolean;
}
```

### 7.8 Add API Endpoints

**Update:** `src/lib/api.ts`

```typescript
// Add to existing api object
export const api = {
  // ... existing endpoints

  // Admin Config
  getAdminConfig: (category?: string) =>
    apiRequest(`/api/v1/admin/config/${category ? `?category=${category}` : ''}`),

  getAdminConfigByKey: (key: string, reveal = false) =>
    apiRequest(`/api/v1/admin/config/${key}/${reveal ? '?reveal=true' : ''}`),

  updateAdminConfig: (key: string, value: string) =>
    apiRequest(`/api/v1/admin/config/${key}/`, {
      method: 'PATCH',
      body: JSON.stringify({ value }),
    }),

  bulkUpdateAdminConfig: (updates: Record<string, string>) =>
    apiRequest('/api/v1/admin/config/bulk_update/', {
      method: 'POST',
      body: JSON.stringify({ updates }),
    }),

  resetAdminConfigToDefault: (keys: string[]) =>
    apiRequest('/api/v1/admin/config/reset_to_default/', {
      method: 'POST',
      body: JSON.stringify({ keys }),
    }),

  getAdminConfigAuditLog: (params: { config_key?: string; hours?: number; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params.config_key) searchParams.set('config_key', params.config_key);
    if (params.hours) searchParams.set('hours', String(params.hours));
    if (params.limit) searchParams.set('limit', String(params.limit));
    return apiRequest(`/api/v1/admin/config/audit_log/?${searchParams}`);
  },

  exportAdminConfig: (params: { include_sensitive?: boolean }) =>
    apiRequest(`/api/v1/admin/config/export/${params.include_sensitive ? '?include_sensitive=true' : ''}`),

  importAdminConfig: (data: { configs: Record<string, unknown>; dry_run?: boolean; skip_readonly?: boolean }) =>
    apiRequest('/api/v1/admin/config/import_config/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  validateAdminConfig: (key: string, value: string) =>
    apiRequest('/api/v1/admin/config/validate/', {
      method: 'POST',
      body: JSON.stringify({ key, value }),
    }),

  revealAdminConfigValue: (key: string) =>
    apiRequest(`/api/v1/admin/config/${key}/reveal/`, { method: 'POST' }),
};
```

### 7.9 Files to Create/Modify

| Action | File |
|--------|------|
| Create | `src/views/AdminSettingsView.tsx` |
| Create | `src/components/admin/AdminConfigSettings.tsx` |
| Create | `src/components/admin/AdminConfigForm.tsx` |
| Create | `src/components/admin/AdminAuditLog.tsx` |
| Create | `src/components/admin/AdminConfigExport.tsx` |
| Create | `src/types/admin.ts` |
| Modify | `src/lib/api.ts` (add admin config endpoints) |
| Modify | `src/views/index.tsx` (add lazy-loaded AdminSettingsView) |
| Create | `src/components/admin/AdminConfigSettings.stories.tsx` |
| Create | `src/components/admin/AdminConfigForm.stories.tsx` |

### 7.10 Deliverables Checklist

- [ ] Admin Settings view with category navigation
- [ ] Real-time validation on form inputs
- [ ] Pending changes tracking with bulk save
- [ ] Restart requirement warnings displayed
- [ ] Sensitive value masking with reveal toggle
- [ ] Environment override indicators
- [ ] Audit log viewer with filtering
- [ ] Export functionality with sensitive value option
- [ ] Import with dry-run validation
- [ ] Reset to default functionality
- [ ] TypeScript types for all admin config entities
- [ ] Storybook stories for admin components
- [ ] Proper error handling and loading states
- [ ] Role-based access control (admin/superadmin only)

---

## Summary & Dependencies

### Phase Dependencies

```
Phase 1 (Design System) ──┬──> Phase 2 (Radix UI)
                          │
                          └──> Phase 3 (TanStack Query)
                                     │
                                     v
                          Phase 4 (Accessibility) ──> Phase 5 (TypeScript)
                                                              │
                                                              v
                                                    Phase 6 (Performance)
                                                              │
                                                              v
                                                    Phase 7 (Admin Settings)
```

> **Note:** Phase 7 (Admin Settings) depends on Phases 2 (Radix UI), 3 (TanStack Query), 4 (Accessibility), and 5 (TypeScript) for form components, data fetching, accessible controls, and type safety.

### New Dependencies Summary

```json
{
  "dependencies": {
    "@radix-ui/react-alert-dialog": "^1.x",
    "@radix-ui/react-dialog": "^1.x",
    "@radix-ui/react-dropdown-menu": "^1.x",
    "@radix-ui/react-popover": "^1.x",
    "@radix-ui/react-scroll-area": "^1.x",
    "@radix-ui/react-select": "^1.x",
    "@radix-ui/react-switch": "^1.x",
    "@radix-ui/react-tabs": "^1.x",
    "@radix-ui/react-toast": "^1.x",
    "@radix-ui/react-tooltip": "^1.x",
    "@tanstack/react-query": "^5.x",
    "@tanstack/react-query-devtools": "^5.x"
  },
  "devDependencies": {
    "@axe-core/react": "^4.x",
    "@storybook/addon-a11y": "^8.x",
    "@storybook/react-vite": "^8.x",
    "@types/react": "^18.x",
    "@types/react-dom": "^18.x",
    "eslint-plugin-jsx-a11y": "^6.x",
    "rollup-plugin-visualizer": "^5.x",
    "storybook": "^8.x",
    "typescript": "^5.x",
    "web-vitals": "^3.x"
  }
}
```

### Total Estimated Files

| Phase | New Files | Modified Files |
|-------|-----------|----------------|
| Phase 1 | ~15 | ~5 |
| Phase 2 | ~8 | ~5 |
| Phase 3 | ~8 | ~10 |
| Phase 4 | ~5 | ~20 |
| Phase 5 | ~5 | ~30 |
| Phase 6 | ~5 | ~10 |
| Phase 7 | ~8 | ~3 |
| **Total** | **~54** | **~83** |

---

This plan provides a systematic approach to modernizing the SkySpy frontend while maintaining backward compatibility throughout the migration.
