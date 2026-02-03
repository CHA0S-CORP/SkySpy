import React from 'react';
import { Plane, Bell, MapPin, Activity, Shield, Wifi } from 'lucide-react';

import { BentoCard } from './bento-card';

export default {
  title: 'UI/BentoCard',
  component: BentoCard,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'hero', 'expandable'],
      description: 'Visual style variant of the card',
    },
    size: {
      control: 'select',
      options: ['sm', 'default', 'lg'],
      description: 'Padding size of the card',
    },
    title: {
      control: 'text',
      description: 'Title displayed in the card header',
    },
    animate: {
      control: 'boolean',
      description: 'Enable entrance and hover animations',
    },
    hoverable: {
      control: 'boolean',
      description: 'Enable hover scale effect (requires animate=true)',
    },
    colSpan: {
      control: 'select',
      options: [1, 2],
      description: 'Column span in grid layout (2 applies md:col-span-2)',
    },
    icon: {
      control: false,
      description: 'Lucide icon component to display in header',
    },
    children: {
      control: false,
      description: 'Card content',
    },
  },
};

// Default card with minimal props
export const Default = {
  args: {
    children: <p className="text-text-primary">Basic card content</p>,
  },
};

// Card with title and description
export const WithTitleAndDescription = {
  args: {
    title: 'Aircraft Tracked',
    children: (
      <div>
        <p className="text-3xl font-bold text-text-primary">247</p>
        <p className="text-sm text-text-secondary">Currently in range</p>
      </div>
    ),
  },
};

// Card with icon in header
export const WithIcon = {
  args: {
    icon: Plane,
    title: 'Live Tracking',
    children: (
      <div>
        <p className="text-2xl font-semibold text-text-primary">Active</p>
        <p className="text-xs text-text-secondary">Receiving ADS-B signals</p>
      </div>
    ),
  },
};

// Hero variant - featured/highlighted card
export const HeroVariant = {
  args: {
    variant: 'hero',
    icon: Shield,
    title: 'Safety Status',
    children: (
      <div>
        <p className="text-4xl font-bold text-accent-cyan">All Clear</p>
        <p className="text-sm text-text-secondary">No active safety alerts</p>
      </div>
    ),
  },
};

// Expandable variant - subtle styling
export const ExpandableVariant = {
  args: {
    variant: 'expandable',
    icon: Activity,
    title: 'Signal Strength',
    children: (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-text-secondary">1090 MHz</span>
          <span className="text-green-400">Strong</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-secondary">978 MHz</span>
          <span className="text-yellow-400">Moderate</span>
        </div>
      </div>
    ),
  },
};

// Small size
export const SmallSize = {
  args: {
    size: 'sm',
    icon: Bell,
    title: 'Alerts',
    children: <p className="text-lg font-medium text-text-primary">3 new</p>,
  },
};

// Large size
export const LargeSize = {
  args: {
    size: 'lg',
    icon: MapPin,
    title: 'Coverage Area',
    children: (
      <div>
        <p className="text-3xl font-bold text-text-primary">250 nm</p>
        <p className="text-sm text-text-secondary">Maximum detection range</p>
      </div>
    ),
  },
};

// Without animations
export const NoAnimation = {
  args: {
    animate: false,
    icon: Wifi,
    title: 'Connection',
    children: <p className="text-text-primary">Static card (no animations)</p>,
  },
};

// Hoverable disabled
export const NoHover = {
  args: {
    animate: true,
    hoverable: false,
    icon: Activity,
    title: 'Metrics',
    children: <p className="text-text-primary">Hover effect disabled</p>,
  },
};

// Grid layout showcase with colSpan
export const GridLayout = {
  render: () => (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2" style={{ width: '600px' }}>
      <BentoCard icon={Plane} title="Aircraft">
        <p className="text-2xl font-bold text-text-primary">127</p>
      </BentoCard>
      <BentoCard icon={Bell} title="Alerts">
        <p className="text-2xl font-bold text-text-primary">5</p>
      </BentoCard>
      <BentoCard icon={MapPin} title="Wide Card" colSpan={2} variant="hero">
        <p className="text-text-primary">
          This card spans two columns using colSpan=2
        </p>
      </BentoCard>
    </div>
  ),
  parameters: {
    layout: 'padded',
  },
};

// Interactive playground
export const Playground = {
  args: {
    variant: 'default',
    size: 'default',
    icon: Plane,
    title: 'Interactive Card',
    animate: true,
    hoverable: true,
    children: (
      <div>
        <p className="text-xl font-semibold text-text-primary">Customize me!</p>
        <p className="text-sm text-text-secondary">
          Use the controls panel to adjust properties
        </p>
      </div>
    ),
  },
};
