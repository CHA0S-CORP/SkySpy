import {
  Target, Zap, Clock, Flame, Crown, Plane, Globe, Radio, Star, Award
} from 'lucide-react';

// Time range options
export const TIME_RANGES = {
  '24h': 24,
  '7d': 168,
  '30d': 720,
  '90d': 2160,
  'all': 8760
};

// Icon mapping for records
export const RECORD_ICONS = {
  furthest_distance: Target,
  highest_altitude: Zap,
  longest_tracking: Clock,
  fastest_aircraft: Flame,
  most_aircraft_hour: Crown,
  most_types_day: Plane,
  most_countries: Globe,
  most_acars: Radio,
  earliest_morning: Star,
  latest_night: Star,
  default: Award
};

// Rarity colors
export const RARITY_COLORS = {
  legendary: '#ffd700',
  epic: '#a371f7',
  rare: '#00c8ff',
  uncommon: '#00ff88',
  common: '#6b7280'
};

// Rarity labels
export const RARITY_LABELS = {
  legendary: 'Legendary',
  epic: 'Epic',
  rare: 'Rare',
  uncommon: 'Uncommon',
  common: 'Common'
};
