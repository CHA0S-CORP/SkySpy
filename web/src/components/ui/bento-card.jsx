import React, { forwardRef } from 'react';
import { motion } from 'framer-motion';
import { cva } from 'class-variance-authority';
import { cn } from './cn';

const bentoCardVariants = cva(
  // Base styles - glassmorphism foundation
  [
    'relative rounded-2xl',
    'border transition-all duration-300',
    'overflow-hidden',
  ],
  {
    variants: {
      variant: {
        default: [
          'bg-white/[0.03] backdrop-blur-md',
          'border-white/[0.08]',
          'shadow-lg shadow-black/20',
        ],
        hero: [
          'bg-gradient-to-br from-accent-cyan/[0.08] to-transparent',
          'backdrop-blur-lg',
          'border-accent-cyan/20',
          'shadow-xl shadow-[rgba(0,212,255,0.1)]',
        ],
        expandable: [
          'bg-white/[0.02] backdrop-blur-sm',
          'border-white/[0.05]',
          'shadow-md shadow-black/10',
        ],
      },
      size: {
        default: 'p-4',
        lg: 'p-5',
        sm: 'p-3',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

// Motion variants for hover and entrance animations
const cardMotionVariants = {
  initial: {
    opacity: 0,
    y: 15,
    scale: 0.98
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.4,
      ease: [0.25, 0.46, 0.45, 0.94], // Custom easing
    }
  },
  hover: {
    scale: 1.02,
    boxShadow: '0 20px 40px -10px rgba(0, 212, 255, 0.2)',
    transition: {
      duration: 0.2,
      ease: 'easeOut',
    }
  },
};

/**
 * BentoCard - Glassmorphism card component with micro-interactions
 */
const BentoCard = forwardRef(function BentoCard(
  {
    children,
    className,
    variant = 'default',
    size = 'default',
    icon: Icon,
    title,
    animate = true,
    hoverable = true,
    colSpan,
    ...props
  },
  ref
) {
  const colSpanClass = colSpan === 2 ? 'md:col-span-2' : '';

  const CardWrapper = animate ? motion.div : 'div';
  const motionProps = animate ? {
    variants: cardMotionVariants,
    initial: 'initial',
    animate: 'animate',
    whileHover: hoverable ? 'hover' : undefined,
  } : {};

  return (
    <CardWrapper
      ref={ref}
      className={cn(bentoCardVariants({ variant, size }), colSpanClass, className)}
      {...motionProps}
      {...props}
    >
      {/* Glass gradient overlay */}
      <div
        className="pointer-events-none absolute inset-0 bg-glass-gradient opacity-50"
        aria-hidden="true"
      />

      {/* Card header with icon and title */}
      {(Icon || title) && (
        <div className="relative mb-3 flex items-center gap-2">
          {Icon && (
            <Icon
              size={16}
              className={cn(
                'flex-shrink-0',
                variant === 'hero' ? 'text-accent-cyan' : 'text-text-secondary'
              )}
              aria-hidden="true"
            />
          )}
          {title && (
            <h3 className={cn(
              'text-sm font-medium tracking-wide',
              variant === 'hero' ? 'text-accent-cyan' : 'text-text-secondary'
            )}>
              {title}
            </h3>
          )}
        </div>
      )}

      {/* Card content */}
      <div className="relative">
        {children}
      </div>
    </CardWrapper>
  );
});

export { BentoCard, bentoCardVariants };
