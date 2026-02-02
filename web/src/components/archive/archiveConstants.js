import { Info, AlertCircle, Shield, Navigation } from 'lucide-react';

// NOTAM type icons and colors (same as NotamsView)
export const NOTAM_TYPES = {
  D: { label: 'NOTAM D', color: '#60a5fa', icon: Info },
  FDC: { label: 'FDC NOTAM', color: '#f59e0b', icon: AlertCircle },
  TFR: { label: 'TFR', color: '#ef4444', icon: Shield },
  GPS: { label: 'GPS NOTAM', color: '#8b5cf6', icon: Navigation },
  MIL: { label: 'Military', color: '#10b981', icon: Shield },
  POINTER: { label: 'Pointer', color: '#6b7280', icon: Info },
};

// PIREP turbulence/icing severity colors
export const SEVERITY_COLORS = {
  NEG: '#4ade80',
  TRC: '#86efac',
  LGT: '#a3e635',
  'LGT-MOD': '#facc15',
  'TRC-LGT': '#d9f99d',
  MOD: '#fb923c',
  'MOD-SEV': '#f87171',
  SEV: '#ef4444',
  EXTRM: '#dc2626',
};

// PIREP severity levels (0-6 scale)
export const SEVERITY_LEVELS = {
  NEG: 0,
  SMTH: 0,
  TRC: 1,
  LGT: 1,
  'TRC-LGT': 1,
  'LGT-MOD': 2,
  MOD: 3,
  'MOD-SEV': 4,
  SEV: 5,
  EXTRM: 6,
};

// Altitude range filters
export const ALTITUDE_RANGES = {
  all: { label: 'All Altitudes', min: 0, max: 99999 },
  low: { label: 'Below FL180', min: 0, max: 18000 },
  mid: { label: 'FL180-FL350', min: 18000, max: 35000 },
  high: { label: 'Above FL350', min: 35000, max: 99999 },
};

// Hazard filter options for PIREPs
export const HAZARD_FILTERS = {
  all: { label: 'All Reports', filterFn: () => true },
  'turb-any': {
    label: 'Any Turbulence',
    filterFn: (p) => p.turbulence_type && p.turbulence_type !== 'NEG',
  },
  'turb-mod': {
    label: 'MOD+ Turbulence',
    filterFn: (p) => ['MOD', 'MOD-SEV', 'SEV', 'EXTRM'].includes(p.turbulence_type),
  },
  'turb-sev': {
    label: 'SEV+ Turbulence',
    filterFn: (p) => ['SEV', 'EXTRM'].includes(p.turbulence_type),
  },
  'ice-any': {
    label: 'Any Icing',
    filterFn: (p) => p.icing_type && p.icing_type !== 'NEG',
  },
  'ice-mod': {
    label: 'MOD+ Icing',
    filterFn: (p) => ['MOD', 'SEV'].includes(p.icing_type),
  },
  'ice-sev': {
    label: 'SEV Icing',
    filterFn: (p) => p.icing_type === 'SEV',
  },
  windshear: {
    label: 'Wind Shear',
    filterFn: (p) => p.raw_text && (p.raw_text.includes('/WS') || p.raw_text.includes('LLWS')),
  },
};

// Date range options
export const DATE_RANGES = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 'custom', label: 'Custom' },
];
