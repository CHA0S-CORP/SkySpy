import React, { forwardRef } from 'react';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { cn } from './cn';

const Accordion = AccordionPrimitive.Root;

const AccordionItem = forwardRef(function AccordionItem(
  { className, ...props },
  ref
) {
  return (
    <AccordionPrimitive.Item
      ref={ref}
      className={cn(
        'border-b border-white/[0.05] last:border-b-0',
        className
      )}
      {...props}
    />
  );
});

const AccordionTrigger = forwardRef(function AccordionTrigger(
  { className, children, ...props },
  ref
) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        ref={ref}
        className={cn(
          'group flex flex-1 items-center justify-between py-3 text-sm font-medium',
          'text-text-secondary hover:text-text-primary',
          'transition-colors duration-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-dark',
          '[&[data-state=open]>svg]:rotate-180',
          className
        )}
        {...props}
      >
        {children}
        <ChevronDown
          size={16}
          className="flex-shrink-0 text-text-dim transition-transform duration-300"
          aria-hidden="true"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
});

const AccordionContent = forwardRef(function AccordionContent(
  { className, children, ...props },
  ref
) {
  return (
    <AccordionPrimitive.Content
      ref={ref}
      className={cn(
        'overflow-hidden text-sm',
        'data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down',
        className
      )}
      {...props}
    >
      <div className="pb-4 pt-0">{children}</div>
    </AccordionPrimitive.Content>
  );
});

// Motion wrapper for animated accordion content
function AnimatedAccordionContent({ children, isOpen, className }) {
  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{
            height: 'auto',
            opacity: 1,
            transition: {
              height: { duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] },
              opacity: { duration: 0.25, delay: 0.05 },
            },
          }}
          exit={{
            height: 0,
            opacity: 0,
            transition: {
              height: { duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] },
              opacity: { duration: 0.15 },
            },
          }}
          className={cn('overflow-hidden', className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  AnimatedAccordionContent,
};
