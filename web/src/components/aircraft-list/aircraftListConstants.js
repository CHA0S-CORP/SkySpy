import { AlertTriangle, Shield, ArrowUp, ArrowDown, Plane } from 'lucide-react';

// Row heights for virtual scrolling
export const ROW_HEIGHT_COMPACT = 32;
export const ROW_HEIGHT_COMFORTABLE = 44;
export const CARD_HEIGHT = 160;
export const CARD_HEIGHT_COMPACT = 100;

// Quick filter presets
export const QUICK_FILTERS = [
  { id: 'emergency', label: 'Emergency', icon: AlertTriangle, color: 'red', filter: { emergency: true } },
  { id: 'military', label: 'Military', icon: Shield, color: 'purple', filter: { military: true } },
  { id: 'climbing', label: 'Climbing', icon: ArrowUp, color: 'green', filter: { climbing: true } },
  { id: 'descending', label: 'Descending', icon: ArrowDown, color: 'orange', filter: { descending: true } },
  { id: 'ground', label: 'On Ground', icon: Plane, color: 'blue', filter: { onGround: true } },
];

// Default filter state
export const DEFAULT_FILTERS = {
  military: null,
  emergency: false,
  climbing: false,
  descending: false,
  onGround: false,
  minAltitude: '',
  maxAltitude: '',
  minDistance: '',
  maxDistance: '',
  minSpeed: '',
  maxSpeed: '',
};
