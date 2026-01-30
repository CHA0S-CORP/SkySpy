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

// Date range options
export const DATE_RANGES = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 'custom', label: 'Custom' },
];
