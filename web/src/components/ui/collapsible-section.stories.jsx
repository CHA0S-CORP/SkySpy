import React, { useState } from 'react';
import { CollapsibleSection, CollapsibleHeader } from './collapsible-section';
import { Plane, Filter, Settings, Bell, Info, AlertTriangle } from 'lucide-react';

/**
 * CollapsibleSection is a reusable collapsible panel built on Radix UI primitives
 * with smooth framer-motion animations. It supports both controlled and uncontrolled
 * modes, lazy loading of content, and customizable styling.
 *
 * ## Features
 * - **Smooth animations**: Height and opacity transitions via framer-motion
 * - **Lazy loading**: Children only render after first open (optional)
 * - **Controlled/Uncontrolled**: Supports both usage patterns
 * - **Accessible**: Full keyboard navigation and ARIA support
 * - **Customizable**: Trigger, content, and wrapper styling via className props
 */
export default {
  title: 'UI/CollapsibleSection',
  component: CollapsibleSection,
  subcomponents: { CollapsibleHeader },
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A collapsible panel component with smooth animations, lazy loading support, and accessible keyboard navigation.',
      },
    },
  },
  argTypes: {
    title: {
      control: 'text',
      description: 'The title displayed in the trigger header',
    },
    icon: {
      control: false,
      description: 'Optional Lucide icon component to display before the title',
    },
    defaultOpen: {
      control: 'boolean',
      description: 'Whether the section is initially open (uncontrolled mode)',
      table: {
        defaultValue: { summary: 'false' },
      },
    },
    open: {
      control: 'boolean',
      description: 'Controlled open state (makes component controlled when defined)',
    },
    onOpenChange: {
      action: 'onOpenChange',
      description: 'Callback fired when the open state changes',
    },
    lazy: {
      control: 'boolean',
      description: 'When true, children only render after the section has been opened once',
      table: {
        defaultValue: { summary: 'false' },
      },
    },
    badge: {
      control: 'text',
      description: 'Optional badge content displayed next to the title',
    },
    className: {
      control: 'text',
      description: 'Additional CSS classes for the root element',
    },
    triggerClassName: {
      control: 'text',
      description: 'Additional CSS classes for the trigger button',
    },
    contentClassName: {
      control: 'text',
      description: 'Additional CSS classes for the content wrapper',
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

/**
 * The default collapsed state. Click the header to expand and reveal content.
 */
export const Default = {
  render: (args) => (
    <CollapsibleSection {...args}>
      <div className="space-y-2 text-text-secondary text-sm">
        <p>This is the collapsible content that appears when the section is expanded.</p>
        <p>It supports any React content including text, lists, and nested components.</p>
      </div>
    </CollapsibleSection>
  ),
  args: {
    title: 'Section Title',
    defaultOpen: false,
  },
};

/**
 * The section starts in an expanded state using the defaultOpen prop.
 */
export const DefaultExpanded = {
  render: (args) => (
    <CollapsibleSection {...args}>
      <div className="space-y-2 text-text-secondary text-sm">
        <p>This section is expanded by default.</p>
        <p>The user can click the header to collapse it.</p>
      </div>
    </CollapsibleSection>
  ),
  args: {
    title: 'Expanded Section',
    defaultOpen: true,
  },
};

/**
 * Sections can include an icon before the title for visual identification.
 */
export const WithIcon = {
  render: (args) => (
    <CollapsibleSection {...args}>
      <div className="space-y-2 text-text-secondary text-sm">
        <p>
          <strong className="text-text-primary">Active:</strong> 42 aircraft
        </p>
        <p>
          <strong className="text-text-primary">In Range:</strong> 28 aircraft
        </p>
        <p>
          <strong className="text-text-primary">Military:</strong> 3 aircraft
        </p>
      </div>
    </CollapsibleSection>
  ),
  args: {
    title: 'Aircraft Summary',
    icon: Plane,
    defaultOpen: true,
  },
};

/**
 * A badge can be displayed next to the title to show counts or status.
 */
export const WithBadge = {
  render: (args) => (
    <CollapsibleSection {...args}>
      <div className="space-y-2 text-text-secondary text-sm">
        <div className="flex items-center justify-between py-1">
          <span>Military aircraft nearby</span>
          <span className="text-status-warning">Active</span>
        </div>
        <div className="flex items-center justify-between py-1">
          <span>Low altitude alert</span>
          <span className="text-status-error">Triggered</span>
        </div>
        <div className="flex items-center justify-between py-1">
          <span>Emergency squawk watch</span>
          <span className="text-accent-green">Monitoring</span>
        </div>
      </div>
    </CollapsibleSection>
  ),
  args: {
    title: 'Active Alerts',
    icon: Bell,
    badge: 3,
    defaultOpen: true,
  },
};

/**
 * Multiple sections can be stacked together to create an accordion-like interface.
 */
export const MultipleSections = {
  render: () => (
    <div className="space-y-1">
      <CollapsibleSection title="Filters" icon={Filter} defaultOpen={true}>
        <div className="space-y-2 text-text-secondary text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="rounded" defaultChecked />
            <span>Show military aircraft</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="rounded" defaultChecked />
            <span>Show helicopters</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="rounded" />
            <span>Show ground vehicles</span>
          </label>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Display Settings" icon={Settings}>
        <div className="space-y-2 text-text-secondary text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="rounded" defaultChecked />
            <span>Show flight trails</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="rounded" defaultChecked />
            <span>Show labels</span>
          </label>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="About" icon={Info}>
        <p className="text-text-secondary text-sm">
          SkySpy provides real-time aircraft tracking using ADS-B technology.
        </p>
      </CollapsibleSection>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Multiple CollapsibleSection components can be stacked to create a sidebar or settings panel.',
      },
    },
  },
};

/**
 * With lazy loading enabled, children are only rendered after the section
 * has been opened at least once. This is useful for expensive content.
 */
export const LazyLoaded = {
  render: (args) => {
    const [renderCount, setRenderCount] = useState(0);

    // This content simulates expensive rendering
    const ExpensiveContent = () => {
      React.useEffect(() => {
        setRenderCount((c) => c + 1);
      }, []);

      return (
        <div className="space-y-2 text-text-secondary text-sm">
          <p>This content is lazily loaded.</p>
          <p>
            <strong className="text-text-primary">Render count:</strong>{' '}
            <span className="text-accent-cyan">{renderCount}</span>
          </p>
          <p className="text-text-dim text-xs">
            Open and close the section - the render count only increments once because the content persists after
            first render.
          </p>
        </div>
      );
    };

    return (
      <div className="space-y-4">
        <CollapsibleSection {...args}>
          <ExpensiveContent />
        </CollapsibleSection>
        <p className="text-text-dim text-xs">
          Tip: The content above only mounts after first open, then stays mounted.
        </p>
      </div>
    );
  },
  args: {
    title: 'Lazy Loaded Content',
    lazy: true,
    defaultOpen: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          'When `lazy={true}`, children are not rendered until the section is opened for the first time. After that, they remain mounted even when collapsed.',
      },
    },
  },
};

/**
 * Controlled mode allows parent components to manage the open state externally.
 * This is useful for programmatic control or syncing state with other UI elements.
 */
export const Controlled = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);

    return (
      <div className="space-y-4">
        <div className="flex gap-2">
          <button
            onClick={() => setIsOpen(true)}
            className="px-3 py-1.5 text-sm bg-accent-cyan/20 text-accent-cyan rounded-lg hover:bg-accent-cyan/30 transition-colors"
          >
            Open
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="px-3 py-1.5 text-sm bg-white/10 text-text-secondary rounded-lg hover:bg-white/20 transition-colors"
          >
            Close
          </button>
          <button
            onClick={() => setIsOpen((prev) => !prev)}
            className="px-3 py-1.5 text-sm bg-white/10 text-text-secondary rounded-lg hover:bg-white/20 transition-colors"
          >
            Toggle
          </button>
        </div>

        <CollapsibleSection
          title="Controlled Section"
          icon={Settings}
          open={isOpen}
          onOpenChange={setIsOpen}
        >
          <p className="text-text-secondary text-sm">
            This section&apos;s state is controlled by the parent component. Use the buttons above or click the
            header to toggle.
          </p>
        </CollapsibleSection>

        <p className="text-text-dim text-xs">
          Current state: <span className="text-accent-cyan">{isOpen ? 'open' : 'closed'}</span>
        </p>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Use the `open` and `onOpenChange` props for controlled mode. This allows external components to control the expanded state.',
      },
    },
  },
};

/**
 * The uncontrolled mode uses internal state and only reports changes via onOpenChange.
 * This is the simpler pattern when you don\'t need external control.
 */
export const Uncontrolled = {
  render: (args) => {
    const [lastChange, setLastChange] = useState(null);

    return (
      <div className="space-y-4">
        <CollapsibleSection {...args} onOpenChange={(open) => setLastChange(open ? 'opened' : 'closed')}>
          <p className="text-text-secondary text-sm">
            This section manages its own state internally. The parent is notified of changes via onOpenChange.
          </p>
        </CollapsibleSection>

        {lastChange && (
          <p className="text-text-dim text-xs">
            Last change: <span className="text-accent-cyan">{lastChange}</span>
          </p>
        )}
      </div>
    );
  },
  args: {
    title: 'Uncontrolled Section',
    defaultOpen: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          'In uncontrolled mode, use `defaultOpen` to set the initial state. The component manages its own state internally.',
      },
    },
  },
};

/**
 * Custom styling can be applied via className props for the root, trigger, and content.
 */
export const CustomStyling = {
  render: () => (
    <div className="space-y-4">
      <CollapsibleSection
        title="Warning Section"
        icon={AlertTriangle}
        triggerClassName="bg-status-warning/10 text-status-warning hover:bg-status-warning/20"
        contentClassName="bg-status-warning/5 rounded-b-lg"
        defaultOpen={true}
      >
        <p className="text-text-secondary text-sm px-2">
          This section has custom warning styling applied to both the trigger and content areas.
        </p>
      </CollapsibleSection>

      <CollapsibleSection
        title="Success Section"
        triggerClassName="bg-accent-green/10 text-accent-green hover:bg-accent-green/20"
        contentClassName="bg-accent-green/5 rounded-b-lg"
        defaultOpen={true}
      >
        <p className="text-text-secondary text-sm px-2">
          Custom success styling with green accents on the trigger and content background.
        </p>
      </CollapsibleSection>

      <CollapsibleSection
        title="Bordered Section"
        className="border border-white/10 rounded-lg"
        triggerClassName="rounded-t-lg"
        contentClassName="border-t border-white/10"
        defaultOpen={true}
      >
        <p className="text-text-secondary text-sm px-2">
          A bordered variant with custom styling on the root, trigger, and content.
        </p>
      </CollapsibleSection>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Use `className`, `triggerClassName`, and `contentClassName` to customize the appearance of different parts of the component.',
      },
    },
  },
};

/**
 * Rich content including lists, code blocks, and nested layouts.
 */
export const RichContent = {
  render: (args) => (
    <CollapsibleSection {...args}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-bg-card p-3 rounded-lg">
            <div className="text-2xl font-bold text-accent-cyan">1,234</div>
            <div className="text-xs text-text-dim">Aircraft Tracked</div>
          </div>
          <div className="bg-bg-card p-3 rounded-lg">
            <div className="text-2xl font-bold text-accent-green">98.5%</div>
            <div className="text-xs text-text-dim">Uptime</div>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-text-primary mb-2">Top Aircraft Types</h4>
          <ul className="space-y-1 text-text-secondary text-sm">
            <li className="flex justify-between">
              <span>Boeing 737</span>
              <span className="text-text-dim">324</span>
            </li>
            <li className="flex justify-between">
              <span>Airbus A320</span>
              <span className="text-text-dim">289</span>
            </li>
            <li className="flex justify-between">
              <span>Cessna 172</span>
              <span className="text-text-dim">156</span>
            </li>
          </ul>
        </div>

        <pre className="bg-bg-card p-3 rounded-lg text-xs text-accent-cyan overflow-x-auto">
          <code>{`{
  "aircraft_count": 1234,
  "message_rate": 450,
  "coverage_nm": 250
}`}</code>
        </pre>
      </div>
    </CollapsibleSection>
  ),
  args: {
    title: 'Statistics',
    icon: Info,
    badge: 'Live',
    defaultOpen: true,
  },
};

/**
 * The CollapsibleHeader component provides a standalone header for custom layouts.
 */
export const StandaloneHeader = {
  render: () => (
    <div className="space-y-2 border border-white/10 rounded-lg overflow-hidden">
      <CollapsibleHeader>
        <span>Aircraft List</span>
        <span className="text-accent-cyan">42 results</span>
      </CollapsibleHeader>

      <div className="px-3 pb-3">
        <div className="space-y-2">
          {['N12345 - Boeing 737', 'N67890 - Airbus A320', 'N11111 - Cessna 172'].map((item) => (
            <div key={item} className="flex justify-between text-sm py-1.5 border-b border-white/[0.05] last:border-0">
              <span className="text-text-primary">{item}</span>
              <span className="text-text-dim">In range</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'CollapsibleHeader is a standalone component for creating section headers without the collapsible behavior. Useful for static headers in custom layouts.',
      },
    },
  },
};
