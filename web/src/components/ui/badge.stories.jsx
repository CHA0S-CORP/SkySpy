import React from 'react';
import { Badge } from './badge';

export default {
  title: 'UI/Badge',
  component: Badge,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'default',
        'military',
        'success',
        'warning',
        'source',
        'faa',
        'adsbx',
        'tar1090',
        'opensky',
        'hexdb',
        'adsblol',
        'planespotters',
      ],
      description: 'The visual style variant of the badge',
    },
    size: {
      control: 'select',
      options: ['sm', 'default', 'lg'],
      description: 'The size of the badge',
    },
    children: {
      control: 'text',
      description: 'The content to display inside the badge',
    },
  },
  args: {
    children: 'Badge',
  },
};

// Default variant
export const Default = {
  args: {
    variant: 'default',
    children: 'Default',
  },
};

// Military variant
export const Military = {
  args: {
    variant: 'military',
    children: 'Military',
  },
};

// Success variant
export const Success = {
  args: {
    variant: 'success',
    children: 'Success',
  },
};

// Warning variant
export const Warning = {
  args: {
    variant: 'warning',
    children: 'Warning',
  },
};

// Source-specific variants
export const FAA = {
  args: {
    variant: 'faa',
    children: 'FAA',
  },
};

export const ADSBx = {
  args: {
    variant: 'adsbx',
    children: 'ADSBx',
  },
};

export const TAR1090 = {
  args: {
    variant: 'tar1090',
    children: 'TAR1090',
  },
};

export const OpenSky = {
  args: {
    variant: 'opensky',
    children: 'OpenSky',
  },
};

export const HexDB = {
  args: {
    variant: 'hexdb',
    children: 'HexDB',
  },
};

export const ADSBLol = {
  args: {
    variant: 'adsblol',
    children: 'ADSB.lol',
  },
};

export const Planespotters = {
  args: {
    variant: 'planespotters',
    children: 'Planespotters',
  },
};

export const Source = {
  args: {
    variant: 'source',
    children: 'Source',
  },
};

// Size variants
export const SizeSmall = {
  args: {
    size: 'sm',
    children: 'Small',
  },
};

export const SizeDefault = {
  args: {
    size: 'default',
    children: 'Default Size',
  },
};

export const SizeLarge = {
  args: {
    size: 'lg',
    children: 'Large',
  },
};

// All variants together
export const AllVariants = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h3 style={{ color: '#8b949e', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
          Status Variants
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <Badge variant="default">Default</Badge>
          <Badge variant="military">Military</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="source">Source</Badge>
        </div>
      </div>
      <div>
        <h3 style={{ color: '#8b949e', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
          Source-Specific Variants
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <Badge variant="faa">FAA</Badge>
          <Badge variant="adsbx">ADSBx</Badge>
          <Badge variant="tar1090">TAR1090</Badge>
          <Badge variant="opensky">OpenSky</Badge>
          <Badge variant="hexdb">HexDB</Badge>
          <Badge variant="adsblol">ADSB.lol</Badge>
          <Badge variant="planespotters">Planespotters</Badge>
        </div>
      </div>
      <div>
        <h3 style={{ color: '#8b949e', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
          Size Variants
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
          <Badge size="sm">Small</Badge>
          <Badge size="default">Default</Badge>
          <Badge size="lg">Large</Badge>
        </div>
      </div>
    </div>
  ),
};
