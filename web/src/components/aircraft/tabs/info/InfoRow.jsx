import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../../ui/cn';

/**
 * InfoRow - Reusable label-value row with hover effects
 */
function InfoRow({
  label,
  value,
  className,
  valueClassName,
  animate = true,
  mono = false,
}) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const Row = animate ? motion.div : 'div';
  const motionProps = animate ? {
    whileHover: {
      x: 2,
      backgroundColor: 'rgba(255, 255, 255, 0.02)',
    },
    transition: {
      duration: 0.15,
    },
  } : {};

  return (
    <Row
      className={cn(
        'group flex items-center justify-between gap-4',
        'py-2 px-2 -mx-2 rounded-lg',
        'transition-colors duration-150',
        className
      )}
      {...motionProps}
    >
      <span className="text-sm text-text-dim flex-shrink-0">
        {label}
      </span>
      <span
        className={cn(
          'text-sm text-text-primary text-right',
          'transition-colors duration-150',
          'group-hover:text-accent-cyan',
          mono && 'font-mono tracking-wide',
          valueClassName
        )}
      >
        {value}
      </span>
    </Row>
  );
}

export { InfoRow };
