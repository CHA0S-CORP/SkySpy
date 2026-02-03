import React from 'react';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  AnimatedAccordionContent,
} from './accordion';

/**
 * The Accordion component is built on Radix UI primitives and provides an
 * expandable/collapsible content section. It supports single or multiple
 * expanded items and includes smooth animations.
 *
 * ## Features
 * - **Single mode**: Only one item can be expanded at a time
 * - **Multiple mode**: Multiple items can be expanded simultaneously
 * - **Collapsible**: In single mode, allows closing all items
 * - **Keyboard accessible**: Full keyboard navigation support
 * - **Animated**: Smooth expand/collapse animations
 */
export default {
  title: 'UI/Accordion',
  component: Accordion,
  subcomponents: { AccordionItem, AccordionTrigger, AccordionContent },
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'An accessible accordion component built on Radix UI primitives with smooth animations.',
      },
    },
  },
  argTypes: {
    type: {
      control: 'radio',
      options: ['single', 'multiple'],
      description: 'Whether one or multiple items can be expanded at once',
      table: {
        defaultValue: { summary: 'single' },
      },
    },
    collapsible: {
      control: 'boolean',
      description: 'When type is "single", allows closing all items',
      table: {
        defaultValue: { summary: 'false' },
      },
      if: { arg: 'type', eq: 'single' },
    },
    defaultValue: {
      control: 'text',
      description: 'The value of the item(s) to expand by default',
    },
    disabled: {
      control: 'boolean',
      description: 'Disable the entire accordion',
      table: {
        defaultValue: { summary: 'false' },
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ width: '400px', maxWidth: '100%' }}>
        <Story />
      </div>
    ),
  ],
};

// Sample content for stories
const faqItems = [
  {
    value: 'item-1',
    title: 'What is ADS-B tracking?',
    content:
      'ADS-B (Automatic Dependent Surveillance-Broadcast) is a surveillance technology where aircraft determine their position via satellite navigation and periodically broadcast it, enabling tracking.',
  },
  {
    value: 'item-2',
    title: 'How accurate is the position data?',
    content:
      'Position data is typically accurate within 30 meters when using GPS. The update rate depends on the aircraft\'s transponder, usually between 1-2 seconds.',
  },
  {
    value: 'item-3',
    title: 'Can I set up custom alerts?',
    content:
      'Yes! SkySpy supports custom alert rules based on aircraft type, altitude, distance, squawk codes, and more. You can receive push notifications when conditions are met.',
  },
];

/**
 * The default accordion with single item expansion. Only one item can be open at a time,
 * and opening a new item automatically closes the previous one.
 */
export const Default = {
  render: (args) => (
    <Accordion {...args}>
      {faqItems.map((item) => (
        <AccordionItem key={item.value} value={item.value}>
          <AccordionTrigger>{item.title}</AccordionTrigger>
          <AccordionContent>
            <p className="text-text-secondary">{item.content}</p>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  ),
  args: {
    type: 'single',
    collapsible: true,
  },
};

/**
 * A single item accordion, useful for expandable sections or "show more" patterns.
 */
export const SingleItem = {
  render: (args) => (
    <Accordion {...args}>
      <AccordionItem value="details">
        <AccordionTrigger>Aircraft Details</AccordionTrigger>
        <AccordionContent>
          <div className="space-y-2 text-text-secondary">
            <p>
              <strong className="text-text-primary">Registration:</strong> N12345
            </p>
            <p>
              <strong className="text-text-primary">Type:</strong> Boeing 737-800
            </p>
            <p>
              <strong className="text-text-primary">Operator:</strong> United Airlines
            </p>
            <p>
              <strong className="text-text-primary">Age:</strong> 12 years
            </p>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
  args: {
    type: 'single',
    collapsible: true,
  },
};

/**
 * Multiple items can be expanded simultaneously. Useful when users need to
 * compare content across sections.
 */
export const MultipleOpen = {
  render: (args) => (
    <Accordion {...args}>
      {faqItems.map((item) => (
        <AccordionItem key={item.value} value={item.value}>
          <AccordionTrigger>{item.title}</AccordionTrigger>
          <AccordionContent>
            <p className="text-text-secondary">{item.content}</p>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  ),
  args: {
    type: 'multiple',
    defaultValue: ['item-1', 'item-2'],
  },
};

/**
 * When collapsible is false (the default for single type), one item must always
 * remain open. The first item cannot be closed once opened.
 */
export const NonCollapsible = {
  render: (args) => (
    <Accordion {...args}>
      {faqItems.map((item) => (
        <AccordionItem key={item.value} value={item.value}>
          <AccordionTrigger>{item.title}</AccordionTrigger>
          <AccordionContent>
            <p className="text-text-secondary">{item.content}</p>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  ),
  args: {
    type: 'single',
    collapsible: false,
    defaultValue: 'item-1',
  },
};

/**
 * An item can be expanded by default using the defaultValue prop.
 */
export const DefaultOpen = {
  render: (args) => (
    <Accordion {...args}>
      {faqItems.map((item) => (
        <AccordionItem key={item.value} value={item.value}>
          <AccordionTrigger>{item.title}</AccordionTrigger>
          <AccordionContent>
            <p className="text-text-secondary">{item.content}</p>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  ),
  args: {
    type: 'single',
    collapsible: true,
    defaultValue: 'item-2',
  },
};

/**
 * Accordion items can contain rich content including lists, code blocks,
 * and nested components.
 */
export const RichContent = {
  render: (args) => (
    <Accordion {...args}>
      <AccordionItem value="features">
        <AccordionTrigger>Feature List</AccordionTrigger>
        <AccordionContent>
          <ul className="list-disc list-inside space-y-1 text-text-secondary">
            <li>Real-time aircraft tracking</li>
            <li>Custom alert rules</li>
            <li>Push notifications</li>
            <li>Historical flight data</li>
            <li>ACARS message decoding</li>
          </ul>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="code">
        <AccordionTrigger>API Example</AccordionTrigger>
        <AccordionContent>
          <pre className="bg-bg-card p-3 rounded-lg text-xs text-accent-cyan overflow-x-auto">
            <code>{`fetch('/api/v1/aircraft')
  .then(res => res.json())
  .then(data => {
    console.log(data);
  });`}</code>
          </pre>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="nested">
        <AccordionTrigger>Statistics</AccordionTrigger>
        <AccordionContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-bg-card p-3 rounded-lg">
              <div className="text-2xl font-bold text-accent-cyan">1,234</div>
              <div className="text-xs text-text-dim">Aircraft Tracked</div>
            </div>
            <div className="bg-bg-card p-3 rounded-lg">
              <div className="text-2xl font-bold text-accent-green">98.5%</div>
              <div className="text-xs text-text-dim">Uptime</div>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
  args: {
    type: 'single',
    collapsible: true,
  },
};

/**
 * The entire accordion can be disabled, preventing user interaction
 * with all items.
 */
export const Disabled = {
  render: (args) => (
    <Accordion {...args}>
      {faqItems.map((item) => (
        <AccordionItem key={item.value} value={item.value}>
          <AccordionTrigger>{item.title}</AccordionTrigger>
          <AccordionContent>
            <p className="text-text-secondary">{item.content}</p>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  ),
  args: {
    type: 'single',
    collapsible: true,
    disabled: true,
  },
};

/**
 * Individual items can be disabled while others remain interactive.
 */
export const DisabledItem = {
  render: (args) => (
    <Accordion {...args}>
      <AccordionItem value="item-1">
        <AccordionTrigger>Available Section</AccordionTrigger>
        <AccordionContent>
          <p className="text-text-secondary">This section is available for expansion.</p>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2" disabled>
        <AccordionTrigger>Disabled Section</AccordionTrigger>
        <AccordionContent>
          <p className="text-text-secondary">This content is not accessible.</p>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3">
        <AccordionTrigger>Another Available Section</AccordionTrigger>
        <AccordionContent>
          <p className="text-text-secondary">This section is also available.</p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
  args: {
    type: 'single',
    collapsible: true,
  },
};

/**
 * Custom styling can be applied to individual accordion items, triggers,
 * and content sections.
 */
export const CustomStyling = {
  render: (args) => (
    <Accordion {...args}>
      <AccordionItem value="warning" className="border-status-warning/30">
        <AccordionTrigger className="text-status-warning hover:text-status-warning/80">
          Warning Alert
        </AccordionTrigger>
        <AccordionContent>
          <p className="text-text-secondary">
            This is a warning message with custom styling applied to the accordion.
          </p>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="error" className="border-status-error/30">
        <AccordionTrigger className="text-status-error hover:text-status-error/80">
          Error Alert
        </AccordionTrigger>
        <AccordionContent>
          <p className="text-text-secondary">
            This is an error message with custom styling applied to the accordion.
          </p>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="success" className="border-accent-green/30">
        <AccordionTrigger className="text-accent-green hover:text-accent-green/80">
          Success Alert
        </AccordionTrigger>
        <AccordionContent>
          <p className="text-text-secondary">
            This is a success message with custom styling applied to the accordion.
          </p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
  args: {
    type: 'single',
    collapsible: true,
  },
};

/**
 * The AnimatedAccordionContent component provides a motion-based animation
 * alternative using framer-motion for more complex animation needs.
 */
export const WithAnimatedContent = {
  render: () => {
    const [openItem, setOpenItem] = React.useState(null);

    return (
      <div className="space-y-2">
        {faqItems.map((item) => (
          <div key={item.value} className="border-b border-white/[0.05] last:border-b-0">
            <button
              onClick={() => setOpenItem(openItem === item.value ? null : item.value)}
              className="flex w-full items-center justify-between py-3 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
            >
              {item.title}
              <svg
                className={`h-4 w-4 transition-transform duration-300 ${
                  openItem === item.value ? 'rotate-180' : ''
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <AnimatedAccordionContent isOpen={openItem === item.value}>
              <div className="pb-4">
                <p className="text-text-secondary">{item.content}</p>
              </div>
            </AnimatedAccordionContent>
          </div>
        ))}
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'The AnimatedAccordionContent component uses framer-motion for smooth height and opacity animations. It can be used independently of the Radix accordion primitives.',
      },
    },
  },
};
