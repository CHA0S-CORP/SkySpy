import React, { forwardRef } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cva } from 'class-variance-authority';
import { cn } from './cn';

const Dialog = DialogPrimitive.Root;
Dialog.displayName = 'Dialog';

const DialogTrigger = DialogPrimitive.Trigger;
DialogTrigger.displayName = 'DialogTrigger';

const DialogPortal = DialogPrimitive.Portal;
DialogPortal.displayName = 'DialogPortal';

const DialogClose = DialogPrimitive.Close;
DialogClose.displayName = 'DialogClose';

const DialogOverlay = forwardRef(function DialogOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
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
DialogOverlay.displayName = 'DialogOverlay';

const dialogContentVariants = cva(
  [
    'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
    'z-[var(--z-modal)]',
    'w-full',
    'bg-bg-card border border-border rounded-lg shadow-glass',
    'p-6',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-dark',
    // Open/Close animations using CSS transitions
    'transition-all duration-200 ease-out',
    'data-[state=open]:opacity-100 data-[state=open]:scale-100',
    'data-[state=closed]:opacity-0 data-[state=closed]:scale-95',
  ],
  {
    variants: {
      size: {
        sm: 'max-w-sm',
        default: 'max-w-lg',
        lg: 'max-w-2xl',
        xl: 'max-w-4xl',
        full: 'max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)]',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
);

const DialogContent = forwardRef(function DialogContent(
  { className, size, children, showCloseButton = true, ...props },
  ref
) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(dialogContentVariants({ size }), className)}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            className={cn(
              'absolute right-4 top-4',
              'rounded-sm p-1',
              'text-text-secondary hover:text-text-primary',
              'transition-colors duration-200',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50',
              'disabled:pointer-events-none'
            )}
            aria-label="Close"
          >
            <X size={16} aria-hidden="true" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = 'DialogContent';

const DialogHeader = forwardRef(function DialogHeader({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)}
      {...props}
    />
  );
});
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = forwardRef(function DialogFooter({ className, ...props }, ref) {
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
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = forwardRef(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn('text-lg font-semibold text-text-primary leading-none tracking-tight', className)}
      {...props}
    />
  );
});
DialogTitle.displayName = 'DialogTitle';

const DialogDescription = forwardRef(function DialogDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn('text-sm text-text-secondary', className)}
      {...props}
    />
  );
});
DialogDescription.displayName = 'DialogDescription';

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  dialogContentVariants,
};
