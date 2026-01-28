import { useState, useCallback, useMemo, useEffect } from 'react';

/**
 * Reusable hook for managing sort state with localStorage persistence
 *
 * @param {Object} options
 * @param {string} options.viewKey - localStorage key for persistence (e.g., 'history-sightings')
 * @param {string} options.defaultField - Default field to sort by
 * @param {string} options.defaultDirection - Default sort direction ('asc' or 'desc')
 * @param {Array} options.data - Array of data to sort
 * @param {Object} options.sortConfig - Configuration for each sortable field
 *   @param {string} sortConfig[field].type - 'string', 'number', 'date', or 'custom'
 *   @param {string} [sortConfig[field].defaultDirection] - Override default direction for this field
 *   @param {Function} [sortConfig[field].comparator] - Custom comparator for 'custom' type
 *   @param {string} [sortConfig[field].path] - Dot-notation path for nested fields (e.g., 'details.horizontal_nm')
 *
 * @returns {Object} Sort state and utilities
 */
export function useSortState({
  viewKey,
  defaultField,
  defaultDirection = 'desc',
  data = [],
  sortConfig = {}
}) {
  // Load initial state from localStorage
  const [sortField, setSortField] = useState(() => {
    if (viewKey) {
      const saved = localStorage.getItem(`sort-${viewKey}-field`);
      if (saved && sortConfig[saved]) return saved;
    }
    return defaultField;
  });

  const [sortDirection, setSortDirection] = useState(() => {
    if (viewKey) {
      const saved = localStorage.getItem(`sort-${viewKey}-direction`);
      if (saved === 'asc' || saved === 'desc') return saved;
    }
    return defaultDirection;
  });

  // Persist to localStorage when sort changes
  useEffect(() => {
    if (viewKey) {
      localStorage.setItem(`sort-${viewKey}-field`, sortField);
      localStorage.setItem(`sort-${viewKey}-direction`, sortDirection);
    }
  }, [viewKey, sortField, sortDirection]);

  // Get nested value using dot notation path
  const getNestedValue = useCallback((obj, path) => {
    if (!path) return obj;
    return path.split('.').reduce((acc, part) => acc?.[part], obj);
  }, []);

  // Handle sort field change
  const handleSort = useCallback((field) => {
    if (field === sortField) {
      // Toggle direction
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      // New field - use its default direction or the global default
      const fieldConfig = sortConfig[field] || {};
      const newDirection = fieldConfig.defaultDirection || defaultDirection;
      setSortField(field);
      setSortDirection(newDirection);
    }
  }, [sortField, sortConfig, defaultDirection]);

  // Sort the data
  const sortedData = useMemo(() => {
    if (!data || data.length === 0) return data;
    if (!sortField) return data;

    const fieldConfig = sortConfig[sortField] || {};
    const { type = 'string', comparator, path } = fieldConfig;

    return [...data].sort((a, b) => {
      const aVal = getNestedValue(a, path || sortField);
      const bVal = getNestedValue(b, path || sortField);

      let result = 0;

      // Handle custom comparator
      if (type === 'custom' && comparator) {
        result = comparator(aVal, bVal, a, b);
      }
      // Handle date type
      else if (type === 'date') {
        const aTime = aVal ? new Date(aVal).getTime() : 0;
        const bTime = bVal ? new Date(bVal).getTime() : 0;
        result = aTime - bTime;
      }
      // Handle number type
      else if (type === 'number') {
        const aNum = aVal ?? (sortDirection === 'asc' ? Infinity : -Infinity);
        const bNum = bVal ?? (sortDirection === 'asc' ? Infinity : -Infinity);
        result = aNum - bNum;
      }
      // Handle string type (default)
      else {
        const aStr = (aVal ?? '').toString().toLowerCase();
        const bStr = (bVal ?? '').toString().toLowerCase();
        result = aStr.localeCompare(bStr);
      }

      return sortDirection === 'asc' ? result : -result;
    });
  }, [data, sortField, sortDirection, sortConfig, getNestedValue]);

  // Reset to defaults
  const resetSort = useCallback(() => {
    setSortField(defaultField);
    setSortDirection(defaultDirection);
    if (viewKey) {
      localStorage.removeItem(`sort-${viewKey}-field`);
      localStorage.removeItem(`sort-${viewKey}-direction`);
    }
  }, [defaultField, defaultDirection, viewKey]);

  return {
    sortField,
    sortDirection,
    handleSort,
    sortedData,
    resetSort,
    // Expose setters for advanced use cases
    setSortField,
    setSortDirection
  };
}

export default useSortState;
