import React from 'react';
import { MetricCard, MetricsGrid } from './metric-card';
import { Plane, TrendingUp, TrendingDown, Gauge, Signal, Navigation, Activity } from 'lucide-react';

export default {
  title: 'UI/MetricCard',
  component: MetricCard,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A metric display card with animated value changes, trend indicators, and customizable styling. Used for displaying flight data like altitude, speed, and distance.',
      },
    },
  },
  argTypes: {
    label: {
      control: 'text',
      description: 'The label displayed above the value',
    },
    value: {
      control: 'text',
      description: 'The metric value to display',
    },
    unit: {
      control: 'text',
      description: 'Optional unit suffix (e.g., ft, kts, nm)',
    },
    icon: {
      control: false,
      description: 'Optional icon component displayed next to the label',
    },
    trend: {
      control: 'select',
      options: [undefined, 'increasing', 'decreasing', 'climbing', 'descending', 'stable'],
      description: 'Trend indicator for value direction',
    },
    trendIcon: {
      control: false,
      description: 'Optional trend icon component displayed next to the value',
    },
    variant: {
      control: 'select',
      options: ['default', 'primary', 'emergency', 'warning'],
      description: 'Visual variant of the card',
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
      description: 'Size variant affecting padding',
    },
    formatValue: {
      control: false,
      description: 'Optional function to format the displayed value',
    },
    className: {
      control: 'text',
      description: 'Additional CSS classes for the card container',
    },
    valueClassName: {
      control: 'text',
      description: 'Additional CSS classes for the value element',
    },
    ariaLabel: {
      control: 'text',
      description: 'Custom aria-label for accessibility',
    },
  },
  decorators: [
    (Story) => (
      <div style={{ width: '200px' }}>
        <Story />
      </div>
    ),
  ],
};

// Default story with simple value
export const Default = {
  args: {
    label: 'Altitude',
    value: '35,000',
    unit: 'ft',
  },
};

// With label icon
export const WithIcon = {
  args: {
    label: 'Speed',
    value: '450',
    unit: 'kts',
    icon: Gauge,
  },
};

// Climbing trend
export const TrendUp = {
  args: {
    label: 'Altitude',
    value: '36,500',
    unit: 'ft',
    trend: 'climbing',
    trendIcon: TrendingUp,
  },
};

// Descending trend
export const TrendDown = {
  args: {
    label: 'Altitude',
    value: '28,000',
    unit: 'ft',
    trend: 'descending',
    trendIcon: TrendingDown,
  },
};

// Emergency variant
export const Emergency = {
  args: {
    label: 'Squawk',
    value: '7700',
    variant: 'emergency',
    icon: Activity,
  },
  parameters: {
    docs: {
      description: {
        story: 'Emergency variant with red styling for critical alerts like squawk 7700.',
      },
    },
  },
};

// Warning variant
export const Warning = {
  args: {
    label: 'RSSI',
    value: '-28',
    unit: 'dB',
    variant: 'warning',
    icon: Signal,
  },
  parameters: {
    docs: {
      description: {
        story: 'Warning variant with yellow styling for cautionary metrics.',
      },
    },
  },
};

// Primary variant
export const Primary = {
  args: {
    label: 'Distance',
    value: '12.5',
    unit: 'nm',
    variant: 'primary',
    icon: Navigation,
  },
};

// Small size
export const SizeSmall = {
  args: {
    label: 'Track',
    value: '270',
    unit: '\u00B0',
    size: 'sm',
  },
};

// Medium size (default)
export const SizeMedium = {
  args: {
    label: 'Track',
    value: '270',
    unit: '\u00B0',
    size: 'md',
  },
};

// Large size
export const SizeLarge = {
  args: {
    label: 'Track',
    value: '270',
    unit: '\u00B0',
    size: 'lg',
  },
};

// With custom format function
export const WithFormatValue = {
  args: {
    label: 'V/S',
    value: 2500,
    unit: 'fpm',
    trend: 'climbing',
    formatValue: (val) => (val > 0 ? `+${val.toLocaleString()}` : val.toLocaleString()),
  },
  parameters: {
    docs: {
      description: {
        story: 'Using formatValue prop to add a plus sign for positive vertical speed values.',
      },
    },
  },
};

// With formatted large number
export const FormattedLargeNumber = {
  args: {
    label: 'Altitude',
    value: 41000,
    unit: 'ft',
    formatValue: (val) => val.toLocaleString(),
  },
};

// With no value (placeholder)
export const NoValue = {
  args: {
    label: 'Speed',
    value: '--',
    unit: 'kts',
  },
  parameters: {
    docs: {
      description: {
        story: 'Display when no data is available, showing placeholder dashes.',
      },
    },
  },
};

// With aircraft type icon
export const AircraftType = {
  args: {
    label: 'Type',
    value: 'B738',
    icon: Plane,
  },
};

// Grid of metrics
export const MetricsGridExample = {
  render: () => (
    <div style={{ width: '400px' }}>
      <MetricsGrid columns={2} gap={3}>
        <MetricCard label="Altitude" value="35,000" unit="ft" />
        <MetricCard label="Speed" value="450" unit="kts" />
        <MetricCard
          label="V/S"
          value="+1,500"
          unit="fpm"
          trend="climbing"
          trendIcon={TrendingUp}
        />
        <MetricCard label="Distance" value="8.2" unit="nm" />
      </MetricsGrid>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'MetricsGrid component displaying multiple MetricCards in a 2-column layout.',
      },
    },
  },
};

// All variants side by side
export const AllVariants = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '200px' }}>
      <MetricCard label="Default" value="35,000" unit="ft" variant="default" />
      <MetricCard label="Primary" value="35,000" unit="ft" variant="primary" />
      <MetricCard label="Warning" value="35,000" unit="ft" variant="warning" />
      <MetricCard label="Emergency" value="7700" variant="emergency" />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Comparison of all available visual variants.',
      },
    },
  },
};

// All sizes comparison
export const AllSizes = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '200px' }}>
      <MetricCard label="Small" value="270" unit="\u00B0" size="sm" />
      <MetricCard label="Medium" value="270" unit="\u00B0" size="md" />
      <MetricCard label="Large" value="270" unit="\u00B0" size="lg" />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Comparison of all available size variants.',
      },
    },
  },
};
