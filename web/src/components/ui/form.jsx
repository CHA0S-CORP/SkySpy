import React, { forwardRef } from 'react';
import { cn } from './cn';

/**
 * FormField - wrapper div with consistent spacing for form fields
 */
const FormField = forwardRef(function FormField({ className, children, ...props }, ref) {
  return (
    <div ref={ref} className={cn('space-y-2', className)} {...props}>
      {children}
    </div>
  );
});
FormField.displayName = 'FormField';

/**
 * FormLabel - accessible label with optional required indicator
 * @param {boolean} required - shows visual asterisk and sr-only "required" text
 */
const FormLabel = forwardRef(function FormLabel(
  { className, children, required, htmlFor, ...props },
  ref
) {
  return (
    <label
      ref={ref}
      htmlFor={htmlFor}
      className={cn('block text-sm font-medium text-text-primary', className)}
      {...props}
    >
      {children}
      {required && (
        <>
          <span className="ml-0.5 text-accent-red" aria-hidden="true">
            *
          </span>
          <span className="sr-only"> (required)</span>
        </>
      )}
    </label>
  );
});
FormLabel.displayName = 'FormLabel';

/**
 * FormInput - accessible input with error state support
 * @param {boolean} hasError - toggles error styling and aria-invalid
 */
const FormInput = forwardRef(function FormInput(
  { className, hasError, type = 'text', ...props },
  ref
) {
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={hasError ? 'true' : undefined}
      className={cn(
        'flex h-10 w-full',
        'rounded-md border bg-bg-card px-3 py-2',
        'text-sm text-text-primary',
        'placeholder:text-text-secondary',
        'transition-colors duration-200',
        // Default border
        'border-border',
        // Hover state
        'hover:border-border-hover',
        // Focus state
        'focus:outline-none focus:ring-2 focus:ring-accent-cyan/50 focus:ring-offset-2 focus:ring-offset-bg-dark',
        // Disabled state
        'disabled:cursor-not-allowed disabled:opacity-50',
        // Error state
        hasError && [
          'border-accent-red',
          'hover:border-accent-red',
          'focus:ring-accent-red/50',
        ],
        className
      )}
      {...props}
    />
  );
});
FormInput.displayName = 'FormInput';

/**
 * FormTextarea - accessible textarea with error state support
 * @param {boolean} hasError - toggles error styling and aria-invalid
 */
const FormTextarea = forwardRef(function FormTextarea(
  { className, hasError, ...props },
  ref
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={hasError ? 'true' : undefined}
      className={cn(
        'flex min-h-[80px] w-full',
        'rounded-md border bg-bg-card px-3 py-2',
        'text-sm text-text-primary',
        'placeholder:text-text-secondary',
        'transition-colors duration-200',
        // Default border
        'border-border',
        // Hover state
        'hover:border-border-hover',
        // Focus state
        'focus:outline-none focus:ring-2 focus:ring-accent-cyan/50 focus:ring-offset-2 focus:ring-offset-bg-dark',
        // Disabled state
        'disabled:cursor-not-allowed disabled:opacity-50',
        // Resize behavior
        'resize-y',
        // Error state
        hasError && [
          'border-accent-red',
          'hover:border-accent-red',
          'focus:ring-accent-red/50',
        ],
        className
      )}
      {...props}
    />
  );
});
FormTextarea.displayName = 'FormTextarea';

/**
 * FormError - accessible error message with live region
 * Automatically announces to screen readers when content changes
 */
const FormError = forwardRef(function FormError({ className, children, ...props }, ref) {
  if (!children) {
    return null;
  }

  return (
    <p
      ref={ref}
      role="alert"
      aria-live="polite"
      className={cn('text-sm text-accent-red', className)}
      {...props}
    >
      {children}
    </p>
  );
});
FormError.displayName = 'FormError';

/**
 * FormDescription - helper text with secondary styling
 */
const FormDescription = forwardRef(function FormDescription(
  { className, children, ...props },
  ref
) {
  return (
    <p
      ref={ref}
      className={cn('text-sm text-text-secondary', className)}
      {...props}
    >
      {children}
    </p>
  );
});
FormDescription.displayName = 'FormDescription';

export {
  FormField,
  FormLabel,
  FormInput,
  FormTextarea,
  FormError,
  FormDescription,
};
