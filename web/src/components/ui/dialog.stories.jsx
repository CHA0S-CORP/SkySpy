import React from 'react';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from './dialog';

/**
 * The Dialog component is built on Radix UI primitives and provides a modal
 * overlay for focused user interactions. It supports multiple sizes, custom
 * content, and accessible keyboard navigation.
 *
 * ## Features
 * - **Multiple sizes**: sm, default, lg, xl, and full-screen variants
 * - **Accessible**: Full keyboard navigation and screen reader support
 * - **Animated**: Smooth open/close animations with backdrop blur
 * - **Flexible content**: Header, footer, and custom content areas
 * - **Optional close button**: Can be hidden for controlled dialogs
 */
export default {
  title: 'UI/Dialog',
  component: Dialog,
  subcomponents: {
    DialogTrigger,
    DialogContent,
    DialogHeader,
    DialogFooter,
    DialogTitle,
    DialogDescription,
    DialogClose,
  },
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'An accessible modal dialog component built on Radix UI primitives with smooth animations and multiple size variants.',
      },
    },
  },
  argTypes: {
    size: {
      control: 'select',
      options: ['sm', 'default', 'lg', 'xl', 'full'],
      description: 'The size variant of the dialog content',
      table: {
        defaultValue: { summary: 'default' },
      },
    },
    showCloseButton: {
      control: 'boolean',
      description: 'Whether to show the close button in the top-right corner',
      table: {
        defaultValue: { summary: 'true' },
      },
    },
    defaultOpen: {
      control: 'boolean',
      description: 'Whether the dialog is open by default (uncontrolled)',
      table: {
        defaultValue: { summary: 'false' },
      },
    },
  },
};

/**
 * The default dialog with a trigger button. Click the button to open the dialog.
 * The dialog includes a title, description, and close button.
 */
export const Default = {
  render: (args) => (
    <Dialog>
      <DialogTrigger asChild>
        <button className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors">
          Open Dialog
        </button>
      </DialogTrigger>
      <DialogContent size={args.size} showCloseButton={args.showCloseButton}>
        <DialogHeader>
          <DialogTitle>Aircraft Details</DialogTitle>
          <DialogDescription>
            View detailed information about the selected aircraft including registration, type, and
            current flight data.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 text-text-secondary">
          <p>
            This is the main content area of the dialog. You can place any content here including
            forms, lists, or other components.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  ),
  args: {
    size: 'default',
    showCloseButton: true,
  },
};

/**
 * Dialog size variants. The dialog supports sm, default, lg, xl, and full sizes
 * to accommodate different content needs.
 */
export const SizeSmall = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <button className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors">
          Small Dialog
        </button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Confirm Action</DialogTitle>
          <DialogDescription>Are you sure you want to proceed?</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <button className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors">
              Cancel
            </button>
          </DialogClose>
          <button className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors">
            Confirm
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Small (sm) dialog variant with max-width of 384px. Ideal for confirmation dialogs.',
      },
    },
  },
};

/**
 * Large dialog variant for more content-heavy use cases.
 */
export const SizeLarge = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <button className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors">
          Large Dialog
        </button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Flight History</DialogTitle>
          <DialogDescription>
            View the complete flight history for this aircraft over the past 30 days.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-bg-dark p-4 rounded-lg">
              <div className="text-2xl font-bold text-accent-cyan">156</div>
              <div className="text-xs text-text-dim">Total Flights</div>
            </div>
            <div className="bg-bg-dark p-4 rounded-lg">
              <div className="text-2xl font-bold text-accent-green">98.2%</div>
              <div className="text-xs text-text-dim">On-Time Rate</div>
            </div>
          </div>
          <div className="text-text-secondary">
            <p>
              This aircraft has been tracked across multiple routes including domestic and
              international flights. The data includes departure times, arrival times, and route
              information.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Large (lg) dialog variant with max-width of 672px. Good for data tables and lists.',
      },
    },
  },
};

/**
 * Extra-large dialog variant for complex content.
 */
export const SizeExtraLarge = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <button className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors">
          Extra Large Dialog
        </button>
      </DialogTrigger>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Alert Configuration</DialogTitle>
          <DialogDescription>
            Configure advanced alert rules with multiple conditions and notification settings.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 grid grid-cols-2 gap-6">
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-text-primary">Trigger Conditions</h4>
            <div className="space-y-2 text-text-secondary text-sm">
              <p>Define when this alert should be triggered based on aircraft data.</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Altitude thresholds</li>
                <li>Speed limits</li>
                <li>Geographic boundaries</li>
                <li>Squawk codes</li>
              </ul>
            </div>
          </div>
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-text-primary">Notification Settings</h4>
            <div className="space-y-2 text-text-secondary text-sm">
              <p>Choose how you want to be notified when the alert triggers.</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Push notifications</li>
                <li>Email alerts</li>
                <li>Webhook integration</li>
                <li>In-app notifications</li>
              </ul>
            </div>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <button className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors">
              Cancel
            </button>
          </DialogClose>
          <button className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors">
            Save Configuration
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Extra-large (xl) dialog variant with max-width of 896px. Suitable for complex forms and multi-column layouts.',
      },
    },
  },
};

/**
 * Full-screen dialog variant for immersive experiences.
 */
export const SizeFull = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <button className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors">
          Full Screen Dialog
        </button>
      </DialogTrigger>
      <DialogContent size="full">
        <DialogHeader>
          <DialogTitle>Flight Map View</DialogTitle>
          <DialogDescription>
            Full-screen map view showing the aircraft trajectory and surrounding traffic.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 flex-1 min-h-[300px] bg-bg-dark rounded-lg flex items-center justify-center">
          <span className="text-text-dim">Map placeholder - full width content area</span>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <button className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors">
              Close Map
            </button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Full-screen (full) dialog variant that takes up nearly the entire viewport. Ideal for maps, media viewers, or complex workflows.',
      },
    },
  },
};

/**
 * Dialog with form content including input fields, selects, and validation.
 * Demonstrates how to build forms within dialogs.
 */
export const WithFormContent = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <button className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors">
          Create Alert Rule
        </button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Create Alert Rule</DialogTitle>
          <DialogDescription>
            Set up a new alert rule to be notified when specific conditions are met.
          </DialogDescription>
        </DialogHeader>
        <form className="py-4 space-y-4">
          <div className="space-y-2">
            <label htmlFor="rule-name" className="text-sm font-medium text-text-primary">
              Rule Name
            </label>
            <input
              id="rule-name"
              type="text"
              placeholder="Enter rule name"
              className="w-full px-3 py-2 bg-bg-dark border border-border rounded-lg text-text-primary placeholder:text-text-dim focus:outline-none focus:ring-2 focus:ring-accent-cyan/50"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="condition" className="text-sm font-medium text-text-primary">
                Condition Type
              </label>
              <select
                id="condition"
                className="w-full px-3 py-2 bg-bg-dark border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-cyan/50"
              >
                <option value="altitude">Altitude</option>
                <option value="speed">Speed</option>
                <option value="squawk">Squawk Code</option>
                <option value="distance">Distance</option>
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="threshold" className="text-sm font-medium text-text-primary">
                Threshold Value
              </label>
              <input
                id="threshold"
                type="number"
                placeholder="Enter value"
                className="w-full px-3 py-2 bg-bg-dark border border-border rounded-lg text-text-primary placeholder:text-text-dim focus:outline-none focus:ring-2 focus:ring-accent-cyan/50"
              />
            </div>
          </div>
          <div className="space-y-2">
            <span className="text-sm font-medium text-text-primary">Notification Methods</span>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-text-secondary">
                <input
                  type="checkbox"
                  defaultChecked
                  className="rounded border-border bg-bg-dark text-accent-cyan focus:ring-accent-cyan/50"
                />
                Push Notification
              </label>
              <label className="flex items-center gap-2 text-text-secondary">
                <input
                  type="checkbox"
                  className="rounded border-border bg-bg-dark text-accent-cyan focus:ring-accent-cyan/50"
                />
                Email
              </label>
            </div>
          </div>
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <button className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors">
              Cancel
            </button>
          </DialogClose>
          <button className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors">
            Create Rule
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Dialog containing a form with various input types. Forms in dialogs should have clear labels and appropriate spacing.',
      },
    },
  },
};

/**
 * Dialog without the close button. Useful for controlled dialogs or when
 * you want to force users to make a choice via footer actions.
 */
export const WithoutCloseButton = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <button className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors">
          Open Required Action Dialog
        </button>
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Session Expired</DialogTitle>
          <DialogDescription>
            Your session has expired due to inactivity. Please choose how to proceed.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 text-text-secondary">
          <p>
            For security reasons, you have been logged out. You can either log back in to continue
            where you left off, or return to the home page.
          </p>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <button className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors">
              Go to Home
            </button>
          </DialogClose>
          <button className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors">
            Log In Again
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Dialog with showCloseButton set to false. Users must interact with the footer actions to close the dialog. Note: users can still close via Escape key or clicking the overlay.',
      },
    },
  },
};

/**
 * Dialog with custom footer actions including destructive action styling.
 */
export const WithCustomFooterActions = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <button className="px-4 py-2 bg-status-error text-white rounded-lg font-medium hover:bg-status-error/90 transition-colors">
          Delete Alert Rule
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Alert Rule</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this alert rule? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <div className="bg-status-error/10 border border-status-error/30 rounded-lg p-4">
            <h4 className="text-sm font-medium text-status-error mb-1">Warning</h4>
            <p className="text-sm text-text-secondary">
              Deleting this rule will stop all future notifications. Historical data will be
              preserved.
            </p>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <button className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors">
              Keep Rule
            </button>
          </DialogClose>
          <DialogClose asChild>
            <button className="px-4 py-2 bg-status-error text-white rounded-lg font-medium hover:bg-status-error/90 transition-colors">
              Delete Rule
            </button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Dialog with destructive action styling in the footer. Use red/error colors for irreversible actions.',
      },
    },
  },
};

/**
 * Dialog with multiple footer actions for complex workflows.
 */
export const WithMultipleActions = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <button className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors">
          Review Changes
        </button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Review Alert Changes</DialogTitle>
          <DialogDescription>
            You have made changes to this alert rule. Please review before saving.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-text-dim">Altitude Threshold</span>
            <span>
              <span className="text-status-error line-through mr-2">10,000 ft</span>
              <span className="text-accent-green">15,000 ft</span>
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-dim">Notification Method</span>
            <span>
              <span className="text-status-error line-through mr-2">Email Only</span>
              <span className="text-accent-green">Push + Email</span>
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-dim">Active Status</span>
            <span className="text-text-secondary">No change</span>
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          <DialogClose asChild>
            <button className="px-4 py-2 text-status-error hover:text-status-error/80 transition-colors">
              Discard Changes
            </button>
          </DialogClose>
          <div className="flex gap-2">
            <DialogClose asChild>
              <button className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors">
                Save as Draft
              </button>
            </DialogClose>
            <button className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors">
              Save & Activate
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Dialog with multiple footer actions. The footer can be customized to show actions on both sides using flex utilities.',
      },
    },
  },
};

/**
 * Controlled dialog example showing how to manage open state programmatically.
 */
export const Controlled = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [open, setOpen] = React.useState(false);

    return (
      <div className="space-y-4">
        <div className="flex gap-2">
          <button
            onClick={() => setOpen(true)}
            className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors"
          >
            Open via State
          </button>
          <button
            onClick={() => setOpen(false)}
            className="px-4 py-2 border border-border text-text-secondary rounded-lg hover:text-text-primary transition-colors"
          >
            Close via State
          </button>
        </div>
        <p className="text-sm text-text-dim">Dialog is {open ? 'open' : 'closed'}</p>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Controlled Dialog</DialogTitle>
              <DialogDescription>
                This dialog&apos;s open state is controlled by React state.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 text-text-secondary">
              <p>
                Use controlled dialogs when you need to manage the open state programmatically, such
                as opening from a different component or based on async operations.
              </p>
            </div>
            <DialogFooter>
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors"
              >
                Close
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Controlled dialog using React state. Use the `open` and `onOpenChange` props to manage the dialog state programmatically.',
      },
    },
  },
};
