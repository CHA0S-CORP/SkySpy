import React from 'react';
import {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
} from './select';

/**
 * The Select component is built on Radix UI primitives and provides a customizable
 * dropdown selection control. It supports groups, labels, separators, and full
 * keyboard navigation.
 *
 * ## Features
 * - **Accessible**: Full keyboard navigation and screen reader support
 * - **Animated**: Smooth open/close animations
 * - **Grouping**: Support for grouped options with labels
 * - **Customizable**: Flexible styling through className props
 * - **Controlled/Uncontrolled**: Works with or without external state management
 */
export default {
  title: 'UI/Select',
  component: Select,
  subcomponents: {
    SelectGroup,
    SelectValue,
    SelectTrigger,
    SelectContent,
    SelectLabel,
    SelectItem,
    SelectSeparator,
  },
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'An accessible select dropdown component built on Radix UI primitives with smooth animations and support for grouped options.',
      },
    },
  },
  argTypes: {
    disabled: {
      control: 'boolean',
      description: 'Whether the select is disabled',
      table: {
        defaultValue: { summary: 'false' },
      },
    },
    defaultValue: {
      control: 'text',
      description: 'The default selected value (uncontrolled)',
    },
    value: {
      control: 'text',
      description: 'The selected value (controlled)',
    },
    onValueChange: {
      action: 'valueChanged',
      description: 'Callback when the selected value changes',
    },
  },
};

/**
 * The default select with a list of options. Click to open the dropdown
 * and select an option.
 */
export const Default = {
  render: (args) => (
    <Select onValueChange={args.onValueChange}>
      <SelectTrigger className="w-[200px]">
        <SelectValue placeholder="Select an aircraft type" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="commercial">Commercial</SelectItem>
        <SelectItem value="private">Private</SelectItem>
        <SelectItem value="military">Military</SelectItem>
        <SelectItem value="cargo">Cargo</SelectItem>
        <SelectItem value="helicopter">Helicopter</SelectItem>
      </SelectContent>
    </Select>
  ),
};

/**
 * Select with a placeholder that displays when no value is selected.
 * The placeholder text appears in a muted style.
 */
export const WithPlaceholder = {
  render: () => (
    <Select>
      <SelectTrigger className="w-[280px]">
        <SelectValue placeholder="Choose your preferred alert type..." />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="altitude">Altitude Alert</SelectItem>
        <SelectItem value="speed">Speed Alert</SelectItem>
        <SelectItem value="squawk">Squawk Code Alert</SelectItem>
        <SelectItem value="distance">Distance Alert</SelectItem>
        <SelectItem value="emergency">Emergency Alert</SelectItem>
      </SelectContent>
    </Select>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Use the placeholder prop on SelectValue to show hint text when no option is selected.',
      },
    },
  },
};

/**
 * Select with grouped options and labels. Use SelectGroup and SelectLabel
 * to organize related options together.
 */
export const WithGroupsAndLabels = {
  render: () => (
    <Select>
      <SelectTrigger className="w-[280px]">
        <SelectValue placeholder="Select aircraft category" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Fixed Wing</SelectLabel>
          <SelectItem value="jet">Jet Aircraft</SelectItem>
          <SelectItem value="turboprop">Turboprop</SelectItem>
          <SelectItem value="piston">Piston Engine</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Rotorcraft</SelectLabel>
          <SelectItem value="helicopter">Helicopter</SelectItem>
          <SelectItem value="gyroplane">Gyroplane</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Other</SelectLabel>
          <SelectItem value="glider">Glider</SelectItem>
          <SelectItem value="balloon">Balloon</SelectItem>
          <SelectItem value="drone">Drone/UAV</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Group related options using SelectGroup with SelectLabel for category headers. Use SelectSeparator to visually divide groups.',
      },
    },
  },
};

/**
 * Disabled select state. The trigger cannot be clicked and shows
 * reduced opacity.
 */
export const Disabled = {
  render: () => (
    <Select disabled>
      <SelectTrigger className="w-[200px]">
        <SelectValue placeholder="Select option" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="option1">Option 1</SelectItem>
        <SelectItem value="option2">Option 2</SelectItem>
        <SelectItem value="option3">Option 3</SelectItem>
      </SelectContent>
    </Select>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Disabled selects show reduced opacity and cannot be interacted with. Use when the selection is not available based on other form state.',
      },
    },
  },
};

/**
 * Select with disabled individual options. Disabled items appear
 * faded and cannot be selected.
 */
export const WithDisabledOptions = {
  render: () => (
    <Select>
      <SelectTrigger className="w-[240px]">
        <SelectValue placeholder="Select notification method" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="push">Push Notification</SelectItem>
        <SelectItem value="email">Email</SelectItem>
        <SelectItem value="sms" disabled>
          SMS (Coming Soon)
        </SelectItem>
        <SelectItem value="webhook">Webhook</SelectItem>
        <SelectItem value="slack" disabled>
          Slack (Premium Only)
        </SelectItem>
      </SelectContent>
    </Select>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Individual options can be disabled while keeping the select interactive. Useful for showing unavailable options.',
      },
    },
  },
};

/**
 * Select with a default value pre-selected. Use defaultValue for
 * uncontrolled components that need an initial selection.
 */
export const WithDefaultValue = {
  render: () => (
    <Select defaultValue="nautical">
      <SelectTrigger className="w-[200px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="feet">Feet</SelectItem>
        <SelectItem value="meters">Meters</SelectItem>
        <SelectItem value="nautical">Nautical Miles</SelectItem>
        <SelectItem value="kilometers">Kilometers</SelectItem>
        <SelectItem value="statute">Statute Miles</SelectItem>
      </SelectContent>
    </Select>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Use defaultValue to set an initial selection for uncontrolled selects. The value must match one of the SelectItem values.',
      },
    },
  },
};

/**
 * Controlled select with React state. Use value and onValueChange
 * props to manage the selection programmatically.
 */
export const Controlled = {
  render: () => {
    const [value, setValue] = React.useState('medium');

    return (
      <div className="space-y-4">
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low Priority</SelectItem>
            <SelectItem value="medium">Medium Priority</SelectItem>
            <SelectItem value="high">High Priority</SelectItem>
            <SelectItem value="critical">Critical Priority</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-text-dim">Selected value: {value}</p>
        <div className="flex gap-2">
          <button
            onClick={() => setValue('low')}
            className="px-3 py-1 text-xs bg-bg-dark border border-border rounded hover:border-border-hover transition-colors"
          >
            Set Low
          </button>
          <button
            onClick={() => setValue('critical')}
            className="px-3 py-1 text-xs bg-bg-dark border border-border rounded hover:border-border-hover transition-colors"
          >
            Set Critical
          </button>
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Controlled select using React state. Use the value and onValueChange props to manage the selection programmatically.',
      },
    },
  },
};

/**
 * Example of Select integrated within a form. Shows proper labeling,
 * layout with other form elements, and form submission.
 */
export const FormIntegration = {
  render: () => {
    const [formData, setFormData] = React.useState({
      ruleName: '',
      conditionType: '',
      operator: '',
      priority: '',
    });

    const handleSubmit = (e) => {
      e.preventDefault();
      // eslint-disable-next-line no-alert
      alert(`Form submitted:\n${JSON.stringify(formData, null, 2)}`);
    };

    return (
      <form onSubmit={handleSubmit} className="w-[400px] space-y-4">
        <div className="space-y-2">
          <label htmlFor="rule-name" className="text-sm font-medium text-text-primary">
            Rule Name
          </label>
          <input
            id="rule-name"
            type="text"
            value={formData.ruleName}
            onChange={(e) => setFormData({ ...formData, ruleName: e.target.value })}
            placeholder="Enter rule name"
            className="w-full px-3 py-2 bg-bg-card border border-border rounded-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent-cyan/50 focus:ring-offset-2 focus:ring-offset-bg-dark"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-text-primary">Condition Type</label>
            <Select
              value={formData.conditionType}
              onValueChange={(value) => setFormData({ ...formData, conditionType: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="altitude">Altitude</SelectItem>
                <SelectItem value="speed">Speed</SelectItem>
                <SelectItem value="distance">Distance</SelectItem>
                <SelectItem value="squawk">Squawk Code</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-text-primary">Operator</label>
            <Select
              value={formData.operator}
              onValueChange={(value) => setFormData({ ...formData, operator: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select operator" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gt">Greater than</SelectItem>
                <SelectItem value="lt">Less than</SelectItem>
                <SelectItem value="eq">Equal to</SelectItem>
                <SelectItem value="between">Between</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-text-primary">Priority Level</label>
          <Select
            value={formData.priority}
            onValueChange={(value) => setFormData({ ...formData, priority: value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select priority level" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Standard</SelectLabel>
                <SelectItem value="low">Low - Informational only</SelectItem>
                <SelectItem value="medium">Medium - Standard notification</SelectItem>
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Urgent</SelectLabel>
                <SelectItem value="high">High - Immediate attention</SelectItem>
                <SelectItem value="critical">Critical - Emergency response</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
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
            Create Rule
          </button>
        </div>
      </form>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Complete form example showing Select components alongside other form elements. Demonstrates proper labeling, controlled state, and form submission.',
      },
    },
  },
};

/**
 * Select with many options demonstrating scroll behavior.
 * The dropdown includes scroll buttons when content overflows.
 */
export const WithManyOptions = {
  render: () => (
    <Select>
      <SelectTrigger className="w-[240px]">
        <SelectValue placeholder="Select airline" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="AAL">American Airlines</SelectItem>
        <SelectItem value="DAL">Delta Air Lines</SelectItem>
        <SelectItem value="UAL">United Airlines</SelectItem>
        <SelectItem value="SWA">Southwest Airlines</SelectItem>
        <SelectItem value="AAR">Asiana Airlines</SelectItem>
        <SelectItem value="ACA">Air Canada</SelectItem>
        <SelectItem value="AFR">Air France</SelectItem>
        <SelectItem value="BAW">British Airways</SelectItem>
        <SelectItem value="CPA">Cathay Pacific</SelectItem>
        <SelectItem value="DLH">Lufthansa</SelectItem>
        <SelectItem value="EIN">Aer Lingus</SelectItem>
        <SelectItem value="EVA">EVA Air</SelectItem>
        <SelectItem value="JAL">Japan Airlines</SelectItem>
        <SelectItem value="KAL">Korean Air</SelectItem>
        <SelectItem value="QFA">Qantas</SelectItem>
        <SelectItem value="SIA">Singapore Airlines</SelectItem>
        <SelectItem value="THY">Turkish Airlines</SelectItem>
        <SelectItem value="UAE">Emirates</SelectItem>
      </SelectContent>
    </Select>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'When the select has many options, scroll buttons appear at the top and bottom of the dropdown to navigate through the list.',
      },
    },
  },
};

/**
 * Different width variations of the Select component.
 */
export const WidthVariations = {
  render: () => (
    <div className="space-y-4">
      <div className="space-y-1">
        <span className="text-xs text-text-dim">Small (150px)</span>
        <Select>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Option 1</SelectItem>
            <SelectItem value="2">Option 2</SelectItem>
            <SelectItem value="3">Option 3</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <span className="text-xs text-text-dim">Medium (250px)</span>
        <Select>
          <SelectTrigger className="w-[250px]">
            <SelectValue placeholder="Select an option" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Option 1</SelectItem>
            <SelectItem value="2">Option 2</SelectItem>
            <SelectItem value="3">Option 3</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <span className="text-xs text-text-dim">Full width</span>
        <Select>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select an option from this full-width dropdown" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Option 1 - This is a longer option text</SelectItem>
            <SelectItem value="2">Option 2 - Another longer option text</SelectItem>
            <SelectItem value="3">Option 3 - Yet another option with more text</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The Select trigger width can be customized via className. The dropdown content will match the trigger width by default.',
      },
    },
  },
};
