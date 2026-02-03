import React from 'react';
import { Switch } from './switch';

/**
 * The Switch component is a toggle control built on Radix UI primitives. It provides
 * a visually distinct on/off toggle that can be used for binary settings and preferences.
 *
 * ## Features
 * - **Accessible**: Full keyboard navigation and screen reader support
 * - **Animated**: Smooth thumb transition between states
 * - **Controlled/Uncontrolled**: Works with or without external state management
 * - **Form Integration**: Supports name/value props for form submission
 */
export default {
  title: 'UI/Switch',
  component: Switch,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'An accessible toggle switch component built on Radix UI primitives with smooth animations and full keyboard support.',
      },
    },
  },
  argTypes: {
    checked: {
      control: 'boolean',
      description: 'The controlled checked state of the switch',
      table: {
        type: { summary: 'boolean' },
      },
    },
    defaultChecked: {
      control: 'boolean',
      description: 'The default checked state when uncontrolled',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
      },
    },
    disabled: {
      control: 'boolean',
      description: 'Whether the switch is disabled',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
      },
    },
    required: {
      control: 'boolean',
      description: 'Whether the switch is required in a form',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
      },
    },
    name: {
      control: 'text',
      description: 'The name of the switch for form submission',
      table: {
        type: { summary: 'string' },
      },
    },
    value: {
      control: 'text',
      description: 'The value of the switch for form submission',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: '"on"' },
      },
    },
    onCheckedChange: {
      action: 'checkedChange',
      description: 'Callback when the checked state changes',
      table: {
        type: { summary: '(checked: boolean) => void' },
      },
    },
  },
};

/**
 * The default switch in its unchecked state. Click or press Space/Enter
 * to toggle it on.
 */
export const Default = {
  render: (args) => <Switch {...args} />,
};

/**
 * Switch with defaultChecked set to true, showing the enabled state
 * with the cyan accent color.
 */
export const DefaultChecked = {
  render: () => <Switch defaultChecked />,
  parameters: {
    docs: {
      description: {
        story:
          'Use defaultChecked to set the initial state for uncontrolled switches. The switch displays the cyan accent color when checked.',
      },
    },
  },
};

/**
 * Disabled switches cannot be interacted with. They show reduced opacity
 * and the cursor changes to indicate the disabled state.
 */
export const Disabled = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Switch disabled />
        <span className="text-sm text-text-secondary">Disabled (unchecked)</span>
      </div>
      <div className="flex items-center gap-3">
        <Switch disabled defaultChecked />
        <span className="text-sm text-text-secondary">Disabled (checked)</span>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Disabled switches show reduced opacity and cannot be toggled. Use when a setting is not available based on other conditions.',
      },
    },
  },
};

/**
 * Switch paired with a label for better accessibility and usability.
 * Click the label or the switch to toggle the state.
 */
export const WithLabel = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Switch id="notifications" />
        <label htmlFor="notifications" className="text-sm text-text-primary cursor-pointer">
          Enable push notifications
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Switch id="sound" defaultChecked />
        <label htmlFor="sound" className="text-sm text-text-primary cursor-pointer">
          Play sound on alert
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Switch id="tracking" disabled />
        <label htmlFor="tracking" className="text-sm text-text-secondary cursor-not-allowed">
          Advanced tracking (Premium)
        </label>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Associate a label with the switch using matching id and htmlFor attributes. This improves accessibility and allows users to click the label to toggle.',
      },
    },
  },
};

/**
 * Controlled switch with React state. Use checked and onCheckedChange
 * props to manage the switch state programmatically.
 */
export const Controlled = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [isEnabled, setIsEnabled] = React.useState(false);

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
          <span className="text-sm text-text-primary">
            Real-time tracking is {isEnabled ? 'enabled' : 'disabled'}
          </span>
        </div>
        <p className="text-sm text-text-dim">Current state: {isEnabled ? 'ON' : 'OFF'}</p>
        <div className="flex gap-2">
          <button
            onClick={() => setIsEnabled(true)}
            className="px-3 py-1 text-xs bg-bg-dark border border-border rounded hover:border-border-hover transition-colors"
          >
            Turn On
          </button>
          <button
            onClick={() => setIsEnabled(false)}
            className="px-3 py-1 text-xs bg-bg-dark border border-border rounded hover:border-border-hover transition-colors"
          >
            Turn Off
          </button>
          <button
            onClick={() => setIsEnabled((prev) => !prev)}
            className="px-3 py-1 text-xs bg-bg-dark border border-border rounded hover:border-border-hover transition-colors"
          >
            Toggle
          </button>
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Controlled switch using React state. Use the checked and onCheckedChange props to manage the state programmatically.',
      },
    },
  },
};

/**
 * Example of Switch components integrated within a settings form.
 * Shows proper labeling, layout with descriptions, and form submission.
 */
export const FormIntegration = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [settings, setSettings] = React.useState({
      pushNotifications: true,
      emailAlerts: false,
      soundEnabled: true,
      autoRefresh: true,
      darkMode: true,
    });

    const handleSubmit = (e) => {
      e.preventDefault();
      alert(`Settings saved:\n${JSON.stringify(settings, null, 2)}`);
    };

    const updateSetting = (key) => (checked) => {
      setSettings((prev) => ({ ...prev, [key]: checked }));
    };

    return (
      <form onSubmit={handleSubmit} className="w-[400px] space-y-6">
        <h3 className="text-lg font-semibold text-text-primary">Notification Settings</h3>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label htmlFor="push" className="text-sm font-medium text-text-primary cursor-pointer">
                Push Notifications
              </label>
              <p className="text-xs text-text-secondary">
                Receive alerts directly on your device
              </p>
            </div>
            <Switch
              id="push"
              name="pushNotifications"
              checked={settings.pushNotifications}
              onCheckedChange={updateSetting('pushNotifications')}
            />
          </div>

          <div className="h-px bg-border" />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label htmlFor="email" className="text-sm font-medium text-text-primary cursor-pointer">
                Email Alerts
              </label>
              <p className="text-xs text-text-secondary">
                Get notified via email for important events
              </p>
            </div>
            <Switch
              id="email"
              name="emailAlerts"
              checked={settings.emailAlerts}
              onCheckedChange={updateSetting('emailAlerts')}
            />
          </div>

          <div className="h-px bg-border" />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label htmlFor="sound" className="text-sm font-medium text-text-primary cursor-pointer">
                Sound Effects
              </label>
              <p className="text-xs text-text-secondary">
                Play audio when alerts trigger
              </p>
            </div>
            <Switch
              id="sound"
              name="soundEnabled"
              checked={settings.soundEnabled}
              onCheckedChange={updateSetting('soundEnabled')}
            />
          </div>

          <div className="h-px bg-border" />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label htmlFor="refresh" className="text-sm font-medium text-text-primary cursor-pointer">
                Auto Refresh
              </label>
              <p className="text-xs text-text-secondary">
                Automatically update aircraft positions
              </p>
            </div>
            <Switch
              id="refresh"
              name="autoRefresh"
              checked={settings.autoRefresh}
              onCheckedChange={updateSetting('autoRefresh')}
            />
          </div>

          <div className="h-px bg-border" />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label htmlFor="dark" className="text-sm font-medium text-text-primary cursor-pointer">
                Dark Mode
              </label>
              <p className="text-xs text-text-secondary">
                Use dark theme for the interface
              </p>
            </div>
            <Switch
              id="dark"
              name="darkMode"
              checked={settings.darkMode}
              onCheckedChange={updateSetting('darkMode')}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <button
            type="button"
            className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors"
          >
            Save Settings
          </button>
        </div>
      </form>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Complete settings form example showing multiple Switch components with labels and descriptions. Demonstrates proper form integration with controlled state.',
      },
    },
  },
};

/**
 * Various layout patterns for switch components with labels,
 * showing different alignment and spacing options.
 */
export const LayoutVariations = {
  render: () => (
    <div className="space-y-8 w-[350px]">
      <div className="space-y-2">
        <span className="text-xs text-text-dim font-medium">Inline (label after)</span>
        <div className="flex items-center gap-3">
          <Switch id="inline-after" />
          <label htmlFor="inline-after" className="text-sm text-text-primary cursor-pointer">
            Enable feature
          </label>
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-xs text-text-dim font-medium">Inline (label before)</span>
        <div className="flex items-center gap-3">
          <label htmlFor="inline-before" className="text-sm text-text-primary cursor-pointer">
            Enable feature
          </label>
          <Switch id="inline-before" />
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-xs text-text-dim font-medium">Justified with description</span>
        <div className="flex items-center justify-between p-3 bg-bg-card border border-border rounded-lg">
          <div className="space-y-0.5">
            <label htmlFor="justified" className="text-sm font-medium text-text-primary cursor-pointer">
              Advanced Mode
            </label>
            <p className="text-xs text-text-secondary">Show additional controls</p>
          </div>
          <Switch id="justified" />
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-xs text-text-dim font-medium">Card style</span>
        <div className="p-4 bg-bg-card border border-border rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-text-primary">Experimental Features</span>
            <Switch id="card" defaultChecked />
          </div>
          <p className="text-xs text-text-secondary">
            Enable beta features that are still in development. Some features may be unstable.
          </p>
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Different layout patterns for positioning switch components with labels and descriptions. Choose the pattern that best fits your UI needs.',
      },
    },
  },
};
