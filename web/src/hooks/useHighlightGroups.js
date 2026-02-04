/**
 * useHighlightGroups - Custom highlighting rules to visually group related aircraft
 *
 * Features:
 * - Define rules like "Highlight all Delta flights in blue"
 * - Group by operator, type, altitude band, etc.
 * - Named highlight groups with custom colors
 * - Toggle groups on/off independently
 * - Use for spotting same-type aircraft, airline traffic, etc.
 * - Persist to localStorage
 */
import { useState, useCallback, useEffect, useMemo } from 'react';

const STORAGE_KEY = 'pro-highlight-groups';

/**
 * Default highlight group presets
 */
export const DEFAULT_GROUPS = [
  {
    id: 'delta',
    name: 'Delta Airlines',
    color: '#0033A0',
    enabled: false,
    rule: { field: 'operator', operator: 'contains', value: 'Delta' },
  },
  {
    id: 'united',
    name: 'United Airlines',
    color: '#0066CC',
    enabled: false,
    rule: { field: 'operator', operator: 'contains', value: 'United' },
  },
  {
    id: 'american',
    name: 'American Airlines',
    color: '#B6252A',
    enabled: false,
    rule: { field: 'operator', operator: 'contains', value: 'American' },
  },
  {
    id: 'southwest',
    name: 'Southwest Airlines',
    color: '#F9B612',
    enabled: false,
    rule: { field: 'operator', operator: 'contains', value: 'Southwest' },
  },
  {
    id: 'military',
    name: 'Military',
    color: '#FF4444',
    enabled: false,
    rule: { field: 'military', operator: 'equals', value: true },
  },
  {
    id: 'heavies',
    name: 'Heavy Aircraft',
    color: '#FF8800',
    enabled: false,
    rule: { field: 'wake_category', operator: 'in', value: ['H', 'J'] },
  },
  {
    id: 'helicopters',
    name: 'Helicopters',
    color: '#00CED1',
    enabled: false,
    rule: { field: 'category', operator: 'equals', value: 'A7' },
  },
  {
    id: 'low-altitude',
    name: 'Low Altitude (<5000ft)',
    color: '#32CD32',
    enabled: false,
    rule: { field: 'alt', operator: 'lessThan', value: 5000 },
  },
  {
    id: 'high-altitude',
    name: 'High Altitude (>30000ft)',
    color: '#9370DB',
    enabled: false,
    rule: { field: 'alt', operator: 'greaterThan', value: 30000 },
  },
  {
    id: 'emergency',
    name: 'Emergency Squawk',
    color: '#FF0000',
    enabled: false,
    rule: { field: 'squawk', operator: 'in', value: ['7500', '7600', '7700'] },
  },
];

/**
 * Available fields for rule building
 */
export const RULE_FIELDS = [
  { value: 'operator', label: 'Operator', type: 'string' },
  { value: 'owner', label: 'Owner', type: 'string' },
  { value: 'type', label: 'Aircraft Type', type: 'string' },
  { value: 'type_name', label: 'Type Name', type: 'string' },
  { value: 'model', label: 'Model', type: 'string' },
  { value: 'registration', label: 'Registration', type: 'string' },
  { value: 'flight', label: 'Callsign', type: 'string' },
  { value: 'category', label: 'Category', type: 'string' },
  { value: 'wake_category', label: 'Wake Category', type: 'string' },
  { value: 'military', label: 'Military', type: 'boolean' },
  { value: 'alt', label: 'Altitude (ft)', type: 'number' },
  { value: 'gs', label: 'Ground Speed (kts)', type: 'number' },
  { value: 'squawk', label: 'Squawk Code', type: 'string' },
  { value: 'country', label: 'Country', type: 'string' },
];

/**
 * Available operators for rule building
 */
export const RULE_OPERATORS = {
  string: [
    { value: 'equals', label: 'Equals' },
    { value: 'contains', label: 'Contains' },
    { value: 'startsWith', label: 'Starts With' },
    { value: 'endsWith', label: 'Ends With' },
    { value: 'in', label: 'In List' },
  ],
  number: [
    { value: 'equals', label: 'Equals' },
    { value: 'greaterThan', label: 'Greater Than' },
    { value: 'lessThan', label: 'Less Than' },
    { value: 'between', label: 'Between' },
  ],
  boolean: [
    { value: 'equals', label: 'Is' },
  ],
};

/**
 * Predefined color palette for highlight groups
 */
export const COLOR_PALETTE = [
  '#FF4444', // Red
  '#FF8800', // Orange
  '#F9B612', // Yellow
  '#32CD32', // Green
  '#00CED1', // Cyan
  '#0066CC', // Blue
  '#0033A0', // Dark Blue
  '#9370DB', // Purple
  '#FF69B4', // Pink
  '#8B4513', // Brown
  '#708090', // Slate
  '#FFD700', // Gold
];

/**
 * Check if an aircraft matches a rule
 */
export function matchesRule(aircraft, info, rule) {
  if (!rule || !rule.field) return false;

  // Get value from aircraft or enriched info
  let value = aircraft?.[rule.field];

  // Also check in enriched info if not found in aircraft
  if (value === undefined || value === null) {
    value = info?.[rule.field];
  }

  // Special handling for certain fields
  if (rule.field === 'flight' && aircraft?.flight) {
    value = aircraft.flight.trim();
  }

  // Handle undefined/null values
  if (value === undefined || value === null) {
    return false;
  }

  switch (rule.operator) {
    case 'equals':
      if (typeof rule.value === 'boolean') {
        return value === rule.value;
      }
      if (typeof value === 'string' && typeof rule.value === 'string') {
        return value.toLowerCase() === rule.value.toLowerCase();
      }
      return value === rule.value;

    case 'contains':
      if (typeof value !== 'string') return false;
      return value.toLowerCase().includes(String(rule.value).toLowerCase());

    case 'startsWith':
      if (typeof value !== 'string') return false;
      return value.toLowerCase().startsWith(String(rule.value).toLowerCase());

    case 'endsWith':
      if (typeof value !== 'string') return false;
      return value.toLowerCase().endsWith(String(rule.value).toLowerCase());

    case 'in':
      if (!Array.isArray(rule.value)) return false;
      if (typeof value === 'string') {
        return rule.value.some(v =>
          String(v).toLowerCase() === value.toLowerCase()
        );
      }
      return rule.value.includes(value);

    case 'greaterThan':
      return typeof value === 'number' && value > rule.value;

    case 'lessThan':
      return typeof value === 'number' && value < rule.value;

    case 'between':
      if (!Array.isArray(rule.value) || rule.value.length !== 2) return false;
      return typeof value === 'number' && value >= rule.value[0] && value <= rule.value[1];

    default:
      return false;
  }
}

/**
 * Parse a comma-separated string into an array for 'in' operator
 */
export function parseInValue(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  return value.split(',').map(v => v.trim()).filter(Boolean);
}

/**
 * Format an 'in' value array back to comma-separated string
 */
export function formatInValue(value) {
  if (!Array.isArray(value)) return String(value || '');
  return value.join(', ');
}

/**
 * Hook for managing aircraft highlight groups
 *
 * @param {Object} aircraftInfo - Map of hex -> enriched aircraft info
 * @returns {Object} Highlight group state and methods
 */
export function useHighlightGroups(aircraftInfo = {}) {
  // Load groups from localStorage or use defaults
  const [groups, setGroups] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (error) {
      console.error('[HighlightGroups] Failed to load from localStorage:', error);
    }
    return DEFAULT_GROUPS;
  });

  // Panel visibility state
  const [panelVisible, setPanelVisible] = useState(() => {
    try {
      const saved = localStorage.getItem('pro-highlight-panel-visible');
      return saved === 'true';
    } catch {
      return false;
    }
  });

  // Panel expanded state
  const [panelExpanded, setPanelExpanded] = useState(true);

  // Save to localStorage when groups change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
    } catch (error) {
      console.error('[HighlightGroups] Failed to save to localStorage:', error);
    }
  }, [groups]);

  // Save panel visibility
  useEffect(() => {
    try {
      localStorage.setItem('pro-highlight-panel-visible', String(panelVisible));
    } catch {
      // Ignore storage errors
    }
  }, [panelVisible]);

  /**
   * Toggle a group on/off
   */
  const toggleGroup = useCallback((id) => {
    setGroups(prev => prev.map(g =>
      g.id === id ? { ...g, enabled: !g.enabled } : g
    ));
  }, []);

  /**
   * Enable a specific group
   */
  const enableGroup = useCallback((id) => {
    setGroups(prev => prev.map(g =>
      g.id === id ? { ...g, enabled: true } : g
    ));
  }, []);

  /**
   * Disable a specific group
   */
  const disableGroup = useCallback((id) => {
    setGroups(prev => prev.map(g =>
      g.id === id ? { ...g, enabled: false } : g
    ));
  }, []);

  /**
   * Add a new highlight group
   */
  const addGroup = useCallback((group) => {
    const newGroup = {
      ...group,
      id: group.id || `custom-${Date.now()}`,
      enabled: group.enabled !== undefined ? group.enabled : true,
    };
    setGroups(prev => [...prev, newGroup]);
    return newGroup.id;
  }, []);

  /**
   * Remove a highlight group
   */
  const removeGroup = useCallback((id) => {
    setGroups(prev => prev.filter(g => g.id !== id));
  }, []);

  /**
   * Update an existing group
   */
  const updateGroup = useCallback((id, updates) => {
    setGroups(prev => prev.map(g =>
      g.id === id ? { ...g, ...updates } : g
    ));
  }, []);

  /**
   * Reorder groups (for drag-and-drop)
   */
  const reorderGroups = useCallback((fromIndex, toIndex) => {
    setGroups(prev => {
      const newGroups = [...prev];
      const [moved] = newGroups.splice(fromIndex, 1);
      newGroups.splice(toIndex, 0, moved);
      return newGroups;
    });
  }, []);

  /**
   * Reset to default groups
   */
  const resetToDefaults = useCallback(() => {
    setGroups(DEFAULT_GROUPS);
  }, []);

  /**
   * Disable all groups
   */
  const disableAll = useCallback(() => {
    setGroups(prev => prev.map(g => ({ ...g, enabled: false })));
  }, []);

  /**
   * Get the highlight color for an aircraft (first matching enabled group)
   */
  const getAircraftHighlight = useCallback((aircraft) => {
    if (!aircraft) return null;

    const info = aircraftInfo?.[aircraft.hex] || {};

    // Check each enabled group in order (first match wins)
    for (const group of groups) {
      if (!group.enabled) continue;
      if (matchesRule(aircraft, info, group.rule)) {
        return {
          color: group.color,
          groupId: group.id,
          groupName: group.name,
        };
      }
    }
    return null;
  }, [groups, aircraftInfo]);

  /**
   * Get all matching groups for an aircraft
   */
  const getMatchingGroups = useCallback((aircraft) => {
    if (!aircraft) return [];

    const info = aircraftInfo?.[aircraft.hex] || {};
    const matches = [];

    for (const group of groups) {
      if (matchesRule(aircraft, info, group.rule)) {
        matches.push(group);
      }
    }
    return matches;
  }, [groups, aircraftInfo]);

  /**
   * Count aircraft matching each group
   */
  const getGroupCounts = useCallback((aircraftList) => {
    if (!Array.isArray(aircraftList)) return {};

    const counts = {};
    for (const group of groups) {
      counts[group.id] = 0;
      for (const aircraft of aircraftList) {
        const info = aircraftInfo?.[aircraft.hex] || {};
        if (matchesRule(aircraft, info, group.rule)) {
          counts[group.id]++;
        }
      }
    }
    return counts;
  }, [groups, aircraftInfo]);

  /**
   * Get enabled groups count
   */
  const enabledCount = useMemo(() =>
    groups.filter(g => g.enabled).length,
    [groups]
  );

  /**
   * Check if any groups are enabled
   */
  const hasEnabledGroups = enabledCount > 0;

  /**
   * Toggle panel visibility
   */
  const togglePanel = useCallback(() => {
    setPanelVisible(prev => !prev);
  }, []);

  /**
   * Toggle panel expanded state
   */
  const togglePanelExpanded = useCallback(() => {
    setPanelExpanded(prev => !prev);
  }, []);

  return {
    // State
    groups,
    panelVisible,
    panelExpanded,
    enabledCount,
    hasEnabledGroups,

    // Group actions
    toggleGroup,
    enableGroup,
    disableGroup,
    addGroup,
    removeGroup,
    updateGroup,
    reorderGroups,
    resetToDefaults,
    disableAll,

    // Aircraft matching
    getAircraftHighlight,
    getMatchingGroups,
    getGroupCounts,

    // Panel actions
    togglePanel,
    togglePanelExpanded,
    setPanelVisible,
    setPanelExpanded,
  };
}

export default useHighlightGroups;
