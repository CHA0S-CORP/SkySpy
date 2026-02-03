import React from 'react';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './tooltip';

/**
 * The Tooltip component is built on Radix UI primitives and provides contextual
 * information on hover. It supports multiple positioning options, customizable
 * delays, and smooth animations.
 *
 * ## Features
 * - **Multiple positions**: top, bottom, left, right placement
 * - **Configurable delay**: Customize open/close delays
 * - **Accessible**: Full keyboard navigation and screen reader support
 * - **Animated**: Smooth fade and slide animations based on position
 * - **Portal rendering**: Renders outside the DOM hierarchy for proper z-indexing
 */
export default {
  title: 'UI/Tooltip',
  component: Tooltip,
  subcomponents: {
    TooltipProvider,
    TooltipTrigger,
    TooltipContent,
  },
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'An accessible tooltip component built on Radix UI primitives with smooth animations and flexible positioning.',
      },
    },
  },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
  argTypes: {
    side: {
      control: 'select',
      options: ['top', 'bottom', 'left', 'right'],
      description: 'The preferred side of the trigger to render the tooltip',
      table: {
        defaultValue: { summary: 'top' },
      },
    },
    sideOffset: {
      control: { type: 'number', min: 0, max: 20 },
      description: 'The distance in pixels from the trigger',
      table: {
        defaultValue: { summary: '4' },
      },
    },
    delayDuration: {
      control: { type: 'number', min: 0, max: 1000, step: 50 },
      description: 'The duration in milliseconds before the tooltip opens',
      table: {
        defaultValue: { summary: '700' },
      },
    },
  },
};

/**
 * The default tooltip that appears on hover. Hover over the button to see the tooltip.
 */
export const Default = {
  render: (args) => (
    <Tooltip delayDuration={args.delayDuration}>
      <TooltipTrigger asChild>
        <button className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors">
          Hover me
        </button>
      </TooltipTrigger>
      <TooltipContent side={args.side} sideOffset={args.sideOffset}>
        This is a tooltip
      </TooltipContent>
    </Tooltip>
  ),
  args: {
    side: 'top',
    sideOffset: 4,
    delayDuration: 200,
  },
};

/**
 * Tooltip positioned above the trigger element. This is the default position.
 */
export const PositionTop = {
  render: () => (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors">
          Top
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">Tooltip on top</TooltipContent>
    </Tooltip>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Tooltip positioned above the trigger element using side="top".',
      },
    },
  },
};

/**
 * Tooltip positioned below the trigger element.
 */
export const PositionBottom = {
  render: () => (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors">
          Bottom
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Tooltip on bottom</TooltipContent>
    </Tooltip>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Tooltip positioned below the trigger element using side="bottom".',
      },
    },
  },
};

/**
 * Tooltip positioned to the left of the trigger element.
 */
export const PositionLeft = {
  render: () => (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors">
          Left
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">Tooltip on left</TooltipContent>
    </Tooltip>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Tooltip positioned to the left of the trigger element using side="left".',
      },
    },
  },
};

/**
 * Tooltip positioned to the right of the trigger element.
 */
export const PositionRight = {
  render: () => (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors">
          Right
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">Tooltip on right</TooltipContent>
    </Tooltip>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Tooltip positioned to the right of the trigger element using side="right".',
      },
    },
  },
};

/**
 * All tooltip positions displayed together for comparison.
 */
export const AllPositions = {
  render: () => (
    <div className="flex flex-col items-center gap-12 p-8">
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <button className="px-4 py-2 bg-bg-card border border-border rounded-lg text-text-primary hover:border-accent-cyan/50 transition-colors">
            Top
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Appears above</TooltipContent>
      </Tooltip>

      <div className="flex gap-24">
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <button className="px-4 py-2 bg-bg-card border border-border rounded-lg text-text-primary hover:border-accent-cyan/50 transition-colors">
              Left
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Appears left</TooltipContent>
        </Tooltip>

        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <button className="px-4 py-2 bg-bg-card border border-border rounded-lg text-text-primary hover:border-accent-cyan/50 transition-colors">
              Right
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Appears right</TooltipContent>
        </Tooltip>
      </div>

      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <button className="px-4 py-2 bg-bg-card border border-border rounded-lg text-text-primary hover:border-accent-cyan/50 transition-colors">
            Bottom
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Appears below</TooltipContent>
      </Tooltip>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All four tooltip positions shown together. Hover over each button to see the tooltip.',
      },
    },
  },
};

/**
 * Tooltip with a longer delay before appearing. Useful for preventing tooltips
 * from appearing during quick mouse movements.
 */
export const WithDelay = {
  render: () => (
    <div className="flex gap-4">
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <button className="px-4 py-2 bg-bg-card border border-border rounded-lg text-text-primary hover:border-accent-cyan/50 transition-colors">
            No delay
          </button>
        </TooltipTrigger>
        <TooltipContent>Appears instantly</TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={500}>
        <TooltipTrigger asChild>
          <button className="px-4 py-2 bg-bg-card border border-border rounded-lg text-text-primary hover:border-accent-cyan/50 transition-colors">
            500ms delay
          </button>
        </TooltipTrigger>
        <TooltipContent>Appears after 500ms</TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={1000}>
        <TooltipTrigger asChild>
          <button className="px-4 py-2 bg-bg-card border border-border rounded-lg text-text-primary hover:border-accent-cyan/50 transition-colors">
            1s delay
          </button>
        </TooltipTrigger>
        <TooltipContent>Appears after 1 second</TooltipContent>
      </Tooltip>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Tooltips with different delay durations. The delayDuration prop controls how long to wait before showing the tooltip.',
      },
    },
  },
};

/**
 * Tooltip on a button trigger element. This is the most common use case.
 */
export const OnButton = {
  render: () => (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors">
          Save Changes
        </button>
      </TooltipTrigger>
      <TooltipContent>Save your current changes (Ctrl+S)</TooltipContent>
    </Tooltip>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Tooltip on a button element. Commonly used to show keyboard shortcuts or additional context.',
      },
    },
  },
};

/**
 * Tooltip on an icon button. Useful for icon-only buttons that need labels.
 */
export const OnIcon = {
  render: () => (
    <div className="flex gap-4">
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <button className="p-2 bg-bg-card border border-border rounded-lg text-text-primary hover:border-accent-cyan/50 hover:text-accent-cyan transition-colors">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent>Download</TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <button className="p-2 bg-bg-card border border-border rounded-lg text-text-primary hover:border-accent-cyan/50 hover:text-accent-cyan transition-colors">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent>Search</TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <button className="p-2 bg-bg-card border border-border rounded-lg text-text-primary hover:border-accent-cyan/50 hover:text-accent-cyan transition-colors">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent>Edit</TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <button className="p-2 bg-bg-card border border-border rounded-lg text-status-error hover:border-status-error/50 transition-colors">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent>Delete</TooltipContent>
      </Tooltip>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Tooltips on icon buttons. Essential for accessibility when buttons only contain icons without visible text labels.',
      },
    },
  },
};

/**
 * Tooltip on inline text. Useful for adding context to abbreviations or technical terms.
 */
export const OnText = {
  render: () => (
    <p className="text-text-secondary max-w-md">
      The aircraft is currently transmitting on{' '}
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <span className="text-accent-cyan underline decoration-dotted underline-offset-4 cursor-help">
            ADS-B
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Automatic Dependent Surveillance-Broadcast: A surveillance technology for tracking aircraft
        </TooltipContent>
      </Tooltip>{' '}
      at an altitude of{' '}
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <span className="text-accent-cyan underline decoration-dotted underline-offset-4 cursor-help">
            FL350
          </span>
        </TooltipTrigger>
        <TooltipContent>Flight Level 350: 35,000 feet pressure altitude</TooltipContent>
      </Tooltip>
      .
    </p>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Tooltips on inline text elements. Useful for explaining abbreviations or technical terms without disrupting the reading flow.',
      },
    },
  },
};

/**
 * Tooltip with rich content including multiple lines and formatting.
 */
export const WithRichContent = {
  render: () => (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button className="px-4 py-2 bg-bg-card border border-border rounded-lg text-text-primary hover:border-accent-cyan/50 transition-colors">
          Aircraft Info
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <div className="space-y-1">
          <div className="font-medium text-text-primary">Boeing 737-800</div>
          <div className="text-text-dim">Registration: N12345</div>
          <div className="text-text-dim">Operator: United Airlines</div>
        </div>
      </TooltipContent>
    </Tooltip>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Tooltip with rich content including multiple lines and formatting. The tooltip content can contain any JSX.',
      },
    },
  },
};

/**
 * Tooltip with custom offset from the trigger element.
 */
export const WithCustomOffset = {
  render: () => (
    <div className="flex gap-4">
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <button className="px-4 py-2 bg-bg-card border border-border rounded-lg text-text-primary hover:border-accent-cyan/50 transition-colors">
            Default offset (4px)
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={4}>4px from trigger</TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <button className="px-4 py-2 bg-bg-card border border-border rounded-lg text-text-primary hover:border-accent-cyan/50 transition-colors">
            Large offset (12px)
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={12}>12px from trigger</TooltipContent>
      </Tooltip>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Tooltips with different sideOffset values. The offset controls the distance between the tooltip and the trigger element.',
      },
    },
  },
};

/**
 * Tooltip on a disabled button. The tooltip still works when wrapping a disabled element.
 */
export const OnDisabledElement = {
  render: () => (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <span tabIndex={0}>
          <button
            disabled
            className="px-4 py-2 bg-bg-card border border-border rounded-lg text-text-dim cursor-not-allowed opacity-50"
          >
            Disabled Button
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent>This action is currently unavailable</TooltipContent>
    </Tooltip>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Tooltip on a disabled element. Wrap the disabled element in a span with tabIndex={0} to make the tooltip accessible.',
      },
    },
  },
};
