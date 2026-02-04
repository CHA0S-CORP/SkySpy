import {
  AlertTriangle,
  Shield,
  ArrowUp,
  ArrowDown,
  Plane,
  Star,
  Signal,
  SignalLow,
  Mountain,
  TreePine,
} from 'lucide-react';

// Row heights for virtual scrolling
export const ROW_HEIGHT_COMPACT = 32;
export const ROW_HEIGHT_COMFORTABLE = 44;
export const CARD_HEIGHT = 160;
export const CARD_HEIGHT_COMPACT = 100;

// Quick filter presets
export const QUICK_FILTERS = [
  {
    id: 'emergency',
    label: 'Emergency',
    icon: AlertTriangle,
    color: 'red',
    filter: { emergency: true },
  },
  { id: 'military', label: 'Military', icon: Shield, color: 'purple', filter: { military: true } },
  { id: 'climbing', label: 'Climbing', icon: ArrowUp, color: 'green', filter: { climbing: true } },
  {
    id: 'descending',
    label: 'Descending',
    icon: ArrowDown,
    color: 'orange',
    filter: { descending: true },
  },
  { id: 'ground', label: 'On Ground', icon: Plane, color: 'blue', filter: { onGround: true } },
  {
    id: 'interesting',
    label: 'Interesting',
    icon: Star,
    color: 'yellow',
    filter: { interesting: true },
  },
  {
    id: 'highAltitude',
    label: 'High Alt',
    icon: Mountain,
    color: 'cyan',
    filter: { highAltitude: true },
    tooltip: 'Above FL350 (35,000 ft)',
  },
  {
    id: 'lowAltitude',
    label: 'Low Alt',
    icon: TreePine,
    color: 'teal',
    filter: { lowAltitude: true },
    tooltip: 'Below 5,000 ft',
  },
  {
    id: 'strongSignal',
    label: 'Strong Signal',
    icon: Signal,
    color: 'lime',
    filter: { strongSignal: true },
    tooltip: 'RSSI > -10 dB',
  },
  {
    id: 'weakSignal',
    label: 'Weak Signal',
    icon: SignalLow,
    color: 'gray',
    filter: { weakSignal: true },
    tooltip: 'RSSI < -25 dB',
  },
];

// Aircraft category definitions
export const AIRCRAFT_CATEGORIES = [
  { value: '', label: 'All Categories' },
  { value: 'A1', label: 'A1 - Light (< 15,500 lbs)' },
  { value: 'A2', label: 'A2 - Small (15,500-75,000 lbs)' },
  { value: 'A3', label: 'A3 - Large (75,000-300,000 lbs)' },
  { value: 'A4', label: 'A4 - High Vortex Large' },
  { value: 'A5', label: 'A5 - Heavy (> 300,000 lbs)' },
  { value: 'A6', label: 'A6 - High Performance' },
  { value: 'A7', label: 'A7 - Rotorcraft' },
  { value: 'B1', label: 'B1 - Glider/Sailplane' },
  { value: 'B2', label: 'B2 - Lighter-than-Air' },
  { value: 'B3', label: 'B3 - Parachutist' },
  { value: 'B4', label: 'B4 - Ultralight' },
  { value: 'B6', label: 'B6 - UAV/Drone' },
  { value: 'B7', label: 'B7 - Space Vehicle' },
  { value: 'C1', label: 'C1 - Emergency Vehicle' },
  { value: 'C2', label: 'C2 - Service Vehicle' },
  { value: 'C3', label: 'C3 - Fixed Obstacle' },
];

// Default filter state
export const DEFAULT_FILTERS = {
  military: null,
  emergency: false,
  climbing: false,
  descending: false,
  onGround: false,
  interesting: false,
  highAltitude: false,
  lowAltitude: false,
  strongSignal: false,
  weakSignal: false,
  minAltitude: '',
  maxAltitude: '',
  minDistance: '',
  maxDistance: '',
  minSpeed: '',
  maxSpeed: '',
  minHeading: '',
  maxHeading: '',
  minSignal: '',
  maxSignal: '',
  aircraftType: '',
  category: '',
  squawkCode: '',
};
