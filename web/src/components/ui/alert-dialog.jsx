import React, { forwardRef } from 'react';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { cva } from 'class-variance-authority';
import { cn } from './cn';

const AlertDialog = AlertDialogPrimitive.Root;
AlertDialog.displayName = 'AlertDialog';

const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
AlertDialogTrigger.displayName = 'AlertDialogTrigger';

const AlertDialogPortal = AlertDialogPrimitive.Portal;
AlertDialogPortal.displayName = 'AlertDialogPortal';

const AlertDialogOverlay = forwardRef(function AlertDialogOverlay({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Overlay
      ref={ref}
      className={cn(
        'fixed inset-0',
        'z-[var(--z-modal-backdrop)]',
        'bg-black/60 backdrop-blur-sm',
        // Open/Close animations using CSS transitions
        'transition-opacity duration-200',
        'data-[state=open]:opacity-100',
        'data-[state=closed]:opacity-0',
        className
      )}
      {...props}
    />
  );
});
AlertDialogOverlay.displayName = 'AlertDialogOverlay';

const alertDialogContentVariants = cva(
  [
    'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
    'z-[var(--z-modal)]',
    'w-full max-w-lg',
    'bg-bg-card border rounded-lg shadow-glass',
    'p-6',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-dark',
    // Open/Close animations using CSS transitions
    'transition-all duration-200 ease-out',
    'data-[state=open]:opacity-100 data-[state=open]:scale-100',
    'data-[state=closed]:opacity-0 data-[state=closed]:scale-95',
  ],
  {
    variants: {
      variant: {
        default: ['border-border', 'focus-visible:ring-accent-cyan/50'],
        danger: ['border-accent-red/30', 'focus-visible:ring-accent-red/50'],
        warning: ['border-accent-yellow/30', 'focus-visible:ring-accent-yellow/50'],
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

const AlertDialogContent = forwardRef(function AlertDialogContent(
  { className, variant, children, ...props },
  ref
) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        ref={ref}
        className={cn(alertDialogContentVariants({ variant }), className)}
        {...props}
      >
        {children}
      </AlertDialogPrimitive.Content>
    </AlertDialogPortal>
  );
});
AlertDialogContent.displayName = 'AlertDialogContent';

const AlertDialogHeader = forwardRef(function AlertDialogHeader({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn('flex flex-col space-y-2 text-center sm:text-left', className)}
      {...props}
    />
  );
});
AlertDialogHeader.displayName = 'AlertDialogHeader';

const AlertDialogFooter = forwardRef(function AlertDialogFooter({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2',
        'mt-6 pt-4 border-t border-border',
        className
      )}
      {...props}
    />
  );
});
AlertDialogFooter.displayName = 'AlertDialogFooter';

const AlertDialogTitle = forwardRef(function AlertDialogTitle({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Title
      ref={ref}
      className={cn(
        'text-lg font-semibold text-text-primary leading-none tracking-tight',
        className
      )}
      {...props}
    />
  );
});
AlertDialogTitle.displayName = 'AlertDialogTitle';

const AlertDialogDescription = forwardRef(function AlertDialogDescription(
  { className, ...props },
  ref
) {
  return (
    <AlertDialogPrimitive.Description
      ref={ref}
      className={cn('text-sm text-text-secondary', className)}
      {...props}
    />
  );
});
AlertDialogDescription.displayName = 'AlertDialogDescription';

const AlertDialogAction = forwardRef(function AlertDialogAction({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Action
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center',
        'rounded-md px-4 py-2',
        'text-sm font-medium',
        'bg-accent-cyan text-white',
        'hover:bg-accent-cyan/90',
        'transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-dark',
        'disabled:pointer-events-none disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
});
AlertDialogAction.displayName = 'AlertDialogAction';

const AlertDialogCancel = forwardRef(function AlertDialogCancel({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Cancel
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center',
        'rounded-md px-4 py-2',
        'text-sm font-medium',
        'bg-transparent text-text-secondary',
        'border border-border',
        'hover:bg-white/5 hover:text-text-primary',
        'transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-dark',
        'disabled:pointer-events-none disabled:opacity-50',
        'mt-2 sm:mt-0',
        className
      )}
      {...props}
    />
  );
});
AlertDialogCancel.displayName = 'AlertDialogCancel';

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
  alertDialogContentVariants,
};
