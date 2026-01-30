import React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from './cn';

const badgeVariants = cva(
  [
    'inline-flex items-center justify-center',
    'rounded-full px-2.5 py-0.5',
    'text-xs font-medium',
    'transition-colors duration-200',
  ],
  {
    variants: {
      variant: {
        default: [
          'bg-accent-cyan/10 text-accent-cyan',
          'border border-accent-cyan/20',
        ],
        military: [
          'bg-accent-red/10 text-accent-red',
          'border border-accent-red/20',
        ],
        success: [
          'bg-accent-green/10 text-accent-green',
          'border border-accent-green/20',
        ],
        warning: [
          'bg-accent-yellow/10 text-accent-yellow',
          'border border-accent-yellow/20',
        ],
        source: [
          'bg-white/5 text-text-secondary',
          'border border-white/10',
        ],
        // Source-specific variants
        faa: [
          'bg-blue-500/10 text-blue-400',
          'border border-blue-500/20',
        ],
        adsbx: [
          'bg-purple-500/10 text-purple-400',
          'border border-purple-500/20',
        ],
        tar1090: [
          'bg-green-500/10 text-green-400',
          'border border-green-500/20',
        ],
        opensky: [
          'bg-orange-500/10 text-orange-400',
          'border border-orange-500/20',
        ],
        hexdb: [
          'bg-pink-500/10 text-pink-400',
          'border border-pink-500/20',
        ],
        adsblol: [
          'bg-teal-500/10 text-teal-400',
          'border border-teal-500/20',
        ],
        planespotters: [
          'bg-yellow-500/10 text-yellow-400',
          'border border-yellow-500/20',
        ],
      },
      size: {
        default: 'text-xs px-2.5 py-0.5',
        sm: 'text-[10px] px-2 py-0.5',
        lg: 'text-sm px-3 py-1',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

function Badge({ className, variant, size, children, ...props }) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
