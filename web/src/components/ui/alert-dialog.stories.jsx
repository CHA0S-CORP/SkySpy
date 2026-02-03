import React from 'react';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from './alert-dialog';

/**
 * AlertDialog is a modal dialog component that interrupts the user to confirm
 * an important action. Built on Radix UI primitives, it provides accessible
 * keyboard navigation and focus management.
 *
 * ## Features
 * - **Variants**: default, danger, and warning styles for different contexts
 * - **Accessible**: Focus trapping, keyboard navigation, and screen reader support
 * - **Animated**: Smooth open/close animations with backdrop blur
 * - **Composable**: Header, footer, title, description, and action components
 *
 * ## Usage
 * Use AlertDialog for confirmations that require explicit user acknowledgment,
 * such as delete operations or irreversible actions.
 */
export default {
  title: 'UI/AlertDialog',
  component: AlertDialog,
  subcomponents: {
    AlertDialogTrigger,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogFooter,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogAction,
    AlertDialogCancel,
  },
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'An accessible alert dialog component built on Radix UI primitives for confirmation dialogs and important actions that require user acknowledgment.',
      },
    },
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'danger', 'warning'],
      description: 'The visual variant of the alert dialog content',
      table: {
        defaultValue: { summary: 'default' },
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
 * The default confirmation dialog with a trigger button. Click the button to open.
 * Includes title, description, and action buttons for confirm/cancel.
 */
export const Default = {
  render: (args) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors">
          Open Alert Dialog
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent variant={args.variant}>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm Action</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to proceed with this action? This will update your alert
            configuration settings.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction>Continue</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
  args: {
    variant: 'default',
  },
};

/**
 * Danger variant for destructive actions like deletions. The red border and
 * styling indicate that this is an irreversible or high-impact action.
 */
export const DangerVariant = {
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button className="px-4 py-2 bg-accent-red text-white rounded-lg font-medium hover:bg-accent-red/90 transition-colors">
          Delete Alert Rule
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent variant="danger">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Alert Rule</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete this alert rule? This action cannot be undone and you
            will stop receiving notifications for matching aircraft.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep Rule</AlertDialogCancel>
          <AlertDialogAction className="bg-accent-red hover:bg-accent-red/90">
            Delete Rule
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Use the danger variant for destructive actions that cannot be undone, such as deletions. The red border and focus ring indicate the severity of the action.',
      },
    },
  },
};

/**
 * Warning variant for actions that may have significant consequences but are
 * not necessarily destructive. The yellow/amber styling indicates caution.
 */
export const WarningVariant = {
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button className="px-4 py-2 bg-accent-yellow text-bg-dark rounded-lg font-medium hover:bg-accent-yellow/90 transition-colors">
          Disable Notifications
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent variant="warning">
        <AlertDialogHeader>
          <AlertDialogTitle>Disable All Notifications</AlertDialogTitle>
          <AlertDialogDescription>
            You are about to disable all push notifications. You will no longer receive real-time
            alerts for tracked aircraft until you re-enable notifications.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep Enabled</AlertDialogCancel>
          <AlertDialogAction className="bg-accent-yellow text-bg-dark hover:bg-accent-yellow/90">
            Disable Notifications
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Use the warning variant for actions that require caution but are not destructive. Examples include disabling features, changing important settings, or actions with significant side effects.',
      },
    },
  },
};

/**
 * Alert dialog with custom content area between the header and footer.
 * Useful for displaying additional information, summaries, or form fields.
 */
export const WithCustomContent = {
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors">
          Clear Flight History
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent variant="danger">
        <AlertDialogHeader>
          <AlertDialogTitle>Clear Flight History</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete your saved flight history data.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="py-4 space-y-4">
          <div className="bg-accent-red/10 border border-accent-red/30 rounded-lg p-4">
            <h4 className="text-sm font-medium text-accent-red mb-2">Data to be deleted:</h4>
            <ul className="text-sm text-text-secondary space-y-1 list-disc list-inside">
              <li>1,247 tracked flights</li>
              <li>156 saved aircraft</li>
              <li>All historical route data</li>
            </ul>
          </div>
          <div className="flex items-center gap-2 text-sm text-text-dim">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>This action cannot be undone</span>
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep History</AlertDialogCancel>
          <AlertDialogAction className="bg-accent-red hover:bg-accent-red/90">
            Clear All Data
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Add custom content between the header and footer to provide additional context, warnings, or summaries. This is useful for showing what will be affected by the action.',
      },
    },
  },
};

/**
 * Controlled alert dialog example showing how to manage open state programmatically.
 * Use this pattern when you need to open the dialog from external actions or
 * control the dialog state based on async operations.
 */
export const Controlled = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [open, setOpen] = React.useState(false);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [isProcessing, setIsProcessing] = React.useState(false);

    const handleConfirm = async () => {
      setIsProcessing(true);
      // Simulate async operation
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setIsProcessing(false);
      setOpen(false);
    };

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

        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Controlled Alert Dialog</AlertDialogTitle>
              <AlertDialogDescription>
                This dialog&apos;s open state is controlled by React state. The confirm action
                simulates an async operation before closing.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isProcessing}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirm} disabled={isProcessing}>
                {isProcessing ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Processing...
                  </span>
                ) : (
                  'Confirm'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Controlled dialog using React state. Use the `open` and `onOpenChange` props to manage the dialog state programmatically. This example also demonstrates handling async operations with loading states.',
      },
    },
  },
};

/**
 * All variant styles displayed together for comparison.
 */
export const AllVariants = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <span className="text-sm text-text-dim w-20">Default:</span>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors">
              Default Variant
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent variant="default">
            <AlertDialogHeader>
              <AlertDialogTitle>Default Alert</AlertDialogTitle>
              <AlertDialogDescription>
                This is the default alert dialog variant with cyan accent styling.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction>Continue</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-sm text-text-dim w-20">Danger:</span>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button className="px-4 py-2 bg-accent-red text-white rounded-lg font-medium hover:bg-accent-red/90 transition-colors">
              Danger Variant
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent variant="danger">
            <AlertDialogHeader>
              <AlertDialogTitle>Danger Alert</AlertDialogTitle>
              <AlertDialogDescription>
                This is the danger variant with red accent styling for destructive actions.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className="bg-accent-red hover:bg-accent-red/90">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-sm text-text-dim w-20">Warning:</span>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button className="px-4 py-2 bg-accent-yellow text-bg-dark rounded-lg font-medium hover:bg-accent-yellow/90 transition-colors">
              Warning Variant
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent variant="warning">
            <AlertDialogHeader>
              <AlertDialogTitle>Warning Alert</AlertDialogTitle>
              <AlertDialogDescription>
                This is the warning variant with yellow accent styling for cautionary actions.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className="bg-accent-yellow text-bg-dark hover:bg-accent-yellow/90">
                Proceed
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'All three variants displayed together for comparison. Choose the appropriate variant based on the severity and nature of the action being confirmed.',
      },
    },
  },
};
