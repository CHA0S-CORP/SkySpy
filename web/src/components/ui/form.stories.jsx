import React from 'react';
import { FormField, FormLabel, FormInput, FormTextarea, FormError, FormDescription } from './form';

/**
 * The Form component suite provides accessible form elements with consistent
 * styling for the SkySpy application. These primitives handle labels, inputs,
 * textareas, error states, and helper text.
 *
 * ## Features
 * - **Accessible**: Full ARIA support with proper labeling and error announcements
 * - **Error states**: Visual and accessible error indication with live regions
 * - **Required indicators**: Visual asterisk with screen reader support
 * - **Consistent spacing**: FormField wrapper provides uniform field spacing
 * - **Dark theme optimized**: Styled for the SkySpy dark interface
 */
export default {
  title: 'UI/Form',
  component: FormField,
  subcomponents: {
    FormLabel,
    FormInput,
    FormTextarea,
    FormError,
    FormDescription,
  },
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A suite of accessible form components including fields, labels, inputs, textareas, error messages, and descriptions.',
      },
    },
  },
  argTypes: {
    hasError: {
      control: 'boolean',
      description: 'Toggles error styling on input/textarea components',
      table: {
        defaultValue: { summary: 'false' },
      },
    },
    required: {
      control: 'boolean',
      description: 'Shows required indicator on labels',
      table: {
        defaultValue: { summary: 'false' },
      },
    },
  },
};

/**
 * Basic form field with a label and text input. This is the most common
 * form pattern showing how FormField, FormLabel, and FormInput work together.
 */
export const Default = {
  render: () => (
    <FormField className="w-80">
      <FormLabel htmlFor="aircraft-id">Aircraft ID</FormLabel>
      <FormInput id="aircraft-id" placeholder="Enter aircraft ID (e.g., N12345)" />
    </FormField>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Basic form field with label and input. FormField provides consistent spacing between label and input.',
      },
    },
  },
};

/**
 * Form field with required indicator. The asterisk is purely visual,
 * with screen reader text announcing the field as required.
 */
export const WithRequiredIndicator = {
  render: () => (
    <FormField className="w-80">
      <FormLabel htmlFor="callsign" required>
        Callsign
      </FormLabel>
      <FormInput id="callsign" placeholder="Enter callsign" required />
    </FormField>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Required field with visual asterisk indicator. Screen readers announce "(required)" for accessibility.',
      },
    },
  },
};

/**
 * Form field showing error state with error message. The input shows
 * red border styling and the error message uses role="alert" for
 * screen reader announcements.
 */
export const WithErrorState = {
  render: () => (
    <FormField className="w-80">
      <FormLabel htmlFor="altitude" required>
        Altitude Threshold
      </FormLabel>
      <FormInput
        id="altitude"
        type="number"
        placeholder="Enter altitude in feet"
        hasError
        defaultValue="-500"
        aria-describedby="altitude-error"
      />
      <FormError id="altitude-error">Altitude must be a positive number</FormError>
    </FormField>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Error state with red border on input and error message below. The error message uses role="alert" and aria-live for accessibility.',
      },
    },
  },
};

/**
 * Form field with description text providing additional context
 * to help users understand what to enter.
 */
export const WithDescription = {
  render: () => (
    <FormField className="w-80">
      <FormLabel htmlFor="squawk">Squawk Code</FormLabel>
      <FormInput
        id="squawk"
        placeholder="e.g., 7700"
        maxLength={4}
        aria-describedby="squawk-desc"
      />
      <FormDescription id="squawk-desc">
        Enter a 4-digit octal code (0-7 only). Common codes: 7500 (hijack), 7600 (radio failure),
        7700 (emergency).
      </FormDescription>
    </FormField>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Helper text below the input providing additional context or instructions.',
      },
    },
  },
};

/**
 * Textarea example for longer text input. Supports the same error
 * states as the regular input component.
 */
export const TextareaExample = {
  render: () => (
    <FormField className="w-80">
      <FormLabel htmlFor="notes">Alert Notes</FormLabel>
      <FormTextarea
        id="notes"
        placeholder="Enter notes about this alert rule..."
        rows={4}
        aria-describedby="notes-desc"
      />
      <FormDescription id="notes-desc">
        Optional notes to help you remember why this alert was created.
      </FormDescription>
    </FormField>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Textarea for multi-line text input with description. Supports resize-y by default.',
      },
    },
  },
};

/**
 * Textarea with error state showing validation feedback.
 */
export const TextareaWithError = {
  render: () => (
    <FormField className="w-80">
      <FormLabel htmlFor="webhook-payload" required>
        Webhook Payload Template
      </FormLabel>
      <FormTextarea
        id="webhook-payload"
        placeholder='{"aircraft": "{{callsign}}", ...}'
        hasError
        defaultValue="{ invalid json"
        aria-describedby="payload-error"
      />
      <FormError id="payload-error">Invalid JSON format. Please check your syntax.</FormError>
    </FormField>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Textarea with error state showing red border and error message.',
      },
    },
  },
};

/**
 * Disabled input state for read-only or inactive fields.
 */
export const DisabledState = {
  render: () => (
    <div className="space-y-6 w-80">
      <FormField>
        <FormLabel htmlFor="disabled-input">Disabled Input</FormLabel>
        <FormInput id="disabled-input" placeholder="This field is disabled" disabled />
      </FormField>
      <FormField>
        <FormLabel htmlFor="disabled-textarea">Disabled Textarea</FormLabel>
        <FormTextarea id="disabled-textarea" placeholder="This field is disabled" disabled />
      </FormField>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Disabled state shows reduced opacity and not-allowed cursor. Use for fields that are temporarily unavailable.',
      },
    },
  },
};

/**
 * Complete form example showing multiple fields with various states.
 * Demonstrates how all form components work together in a real-world scenario.
 */
export const CompleteFormExample = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [errors, setErrors] = React.useState({
      name: '',
      altitude: 'Altitude must be between 0 and 60,000 feet',
    });

    return (
      <form className="w-96 space-y-6 p-6 bg-bg-card rounded-lg border border-border">
        <div className="text-lg font-semibold text-text-primary mb-4">Create Alert Rule</div>

        <FormField>
          <FormLabel htmlFor="rule-name" required>
            Rule Name
          </FormLabel>
          <FormInput
            id="rule-name"
            placeholder="e.g., Low Altitude Warning"
            hasError={!!errors.name}
            aria-describedby={errors.name ? 'rule-name-error' : undefined}
          />
          {errors.name && <FormError id="rule-name-error">{errors.name}</FormError>}
        </FormField>

        <FormField>
          <FormLabel htmlFor="rule-description">Description</FormLabel>
          <FormTextarea
            id="rule-description"
            placeholder="Describe what this alert monitors..."
            rows={3}
          />
          <FormDescription>
            A brief description to help you identify this rule later.
          </FormDescription>
        </FormField>

        <div className="grid grid-cols-2 gap-4">
          <FormField>
            <FormLabel htmlFor="altitude-threshold" required>
              Altitude (ft)
            </FormLabel>
            <FormInput
              id="altitude-threshold"
              type="number"
              placeholder="10000"
              defaultValue="75000"
              hasError={!!errors.altitude}
              aria-describedby={errors.altitude ? 'altitude-error' : 'altitude-desc'}
            />
            {errors.altitude ? (
              <FormError id="altitude-error">{errors.altitude}</FormError>
            ) : (
              <FormDescription id="altitude-desc">Trigger below this altitude</FormDescription>
            )}
          </FormField>

          <FormField>
            <FormLabel htmlFor="speed-threshold">Speed (kts)</FormLabel>
            <FormInput id="speed-threshold" type="number" placeholder="250" />
            <FormDescription>Optional speed filter</FormDescription>
          </FormField>
        </div>

        <FormField>
          <FormLabel htmlFor="aircraft-type">Aircraft Type Filter</FormLabel>
          <FormInput
            id="aircraft-type"
            placeholder="e.g., B737, A320"
            aria-describedby="aircraft-type-desc"
          />
          <FormDescription id="aircraft-type-desc">
            Comma-separated list of ICAO type codes. Leave empty for all aircraft.
          </FormDescription>
        </FormField>

        <FormField>
          <FormLabel htmlFor="notes">Additional Notes</FormLabel>
          <FormTextarea id="notes" placeholder="Any additional context..." rows={2} disabled />
          <FormDescription>Notes are disabled in the demo.</FormDescription>
        </FormField>

        <div className="flex justify-end gap-3 pt-4 border-t border-border">
          <button
            type="button"
            className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 bg-accent-cyan text-bg-dark rounded-lg font-medium hover:bg-accent-cyan/90 transition-colors"
            onClick={(e) => e.preventDefault()}
          >
            Create Rule
          </button>
        </div>
      </form>
    );
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        story:
          'Complete form demonstrating all form components working together: required fields, error states, descriptions, disabled fields, and various input types.',
      },
    },
  },
};

/**
 * All form components displayed together for visual reference.
 */
export const AllComponents = {
  render: () => (
    <div className="w-96 space-y-8">
      <div>
        <h3 className="text-sm font-medium text-text-dim mb-4">
          FormField + FormLabel + FormInput
        </h3>
        <FormField>
          <FormLabel htmlFor="demo-1">Standard Label</FormLabel>
          <FormInput id="demo-1" placeholder="Standard input" />
        </FormField>
      </div>

      <div>
        <h3 className="text-sm font-medium text-text-dim mb-4">FormLabel with required</h3>
        <FormField>
          <FormLabel htmlFor="demo-2" required>
            Required Label
          </FormLabel>
          <FormInput id="demo-2" placeholder="Required input" />
        </FormField>
      </div>

      <div>
        <h3 className="text-sm font-medium text-text-dim mb-4">FormInput with hasError</h3>
        <FormField>
          <FormLabel htmlFor="demo-3">Error State</FormLabel>
          <FormInput id="demo-3" hasError defaultValue="Invalid value" />
          <FormError>This field has an error</FormError>
        </FormField>
      </div>

      <div>
        <h3 className="text-sm font-medium text-text-dim mb-4">FormDescription</h3>
        <FormField>
          <FormLabel htmlFor="demo-4">With Description</FormLabel>
          <FormInput id="demo-4" placeholder="Enter value" />
          <FormDescription>Helper text appears below the input</FormDescription>
        </FormField>
      </div>

      <div>
        <h3 className="text-sm font-medium text-text-dim mb-4">FormTextarea</h3>
        <FormField>
          <FormLabel htmlFor="demo-5">Textarea</FormLabel>
          <FormTextarea id="demo-5" placeholder="Multi-line input..." rows={3} />
        </FormField>
      </div>

      <div>
        <h3 className="text-sm font-medium text-text-dim mb-4">FormTextarea with hasError</h3>
        <FormField>
          <FormLabel htmlFor="demo-6">Textarea Error State</FormLabel>
          <FormTextarea id="demo-6" hasError defaultValue="Invalid content" />
          <FormError>Textarea error message</FormError>
        </FormField>
      </div>
    </div>
  ),
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        story: 'Visual reference showing all form components and their variants side by side.',
      },
    },
  },
};
