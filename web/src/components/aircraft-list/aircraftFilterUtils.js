/**
 * Filter aircraft based on filters and search query
 */
export function filterAircraft(aircraft, searchFilter, filters) {
  let filtered = [...aircraft];

  // Text search
  if (searchFilter) {
    const f = searchFilter.toLowerCase();
    filtered = filtered.filter(ac =>
      ac.hex?.toLowerCase().includes(f) ||
      ac.flight?.toLowerCase().includes(f) ||
      ac.type?.toLowerCase().includes(f) ||
      ac.squawk?.includes(f)
    );
  }

  // Military filter
  if (filters.military === true) {
    filtered = filtered.filter(ac => ac.military);
  } else if (filters.military === false) {
    filtered = filtered.filter(ac => !ac.military);
  }

  // Emergency filter
  if (filters.emergency) {
    filtered = filtered.filter(ac => ac.emergency || ac.squawk?.match(/^7[567]00$/));
  }

  // Climbing filter (> 500 fpm)
  if (filters.climbing) {
    filtered = filtered.filter(ac => (ac.vr || 0) > 500);
  }

  // Descending filter (< -500 fpm)
  if (filters.descending) {
    filtered = filtered.filter(ac => (ac.vr || 0) < -500);
  }

  // On ground filter
  if (filters.onGround) {
    filtered = filtered.filter(ac => ac.alt === 0 || ac.alt === null || ac.alt === 'ground');
  }

  // Altitude range
  if (filters.minAltitude) {
    const min = parseInt(filters.minAltitude, 10);
    if (!isNaN(min)) {
      filtered = filtered.filter(ac => (ac.alt || 0) >= min);
    }
  }
  if (filters.maxAltitude) {
    const max = parseInt(filters.maxAltitude, 10);
    if (!isNaN(max)) {
      filtered = filtered.filter(ac => (ac.alt || 0) <= max);
    }
  }

  // Distance range
  if (filters.minDistance) {
    const min = parseFloat(filters.minDistance);
    if (!isNaN(min)) {
      filtered = filtered.filter(ac => (ac.distance_nm || 0) >= min);
    }
  }
  if (filters.maxDistance) {
    const max = parseFloat(filters.maxDistance);
    if (!isNaN(max)) {
      filtered = filtered.filter(ac => (ac.distance_nm || 999999) <= max);
    }
  }

  // Speed range
  if (filters.minSpeed) {
    const min = parseInt(filters.minSpeed, 10);
    if (!isNaN(min)) {
      filtered = filtered.filter(ac => (ac.gs || 0) >= min);
    }
  }
  if (filters.maxSpeed) {
    const max = parseInt(filters.maxSpeed, 10);
    if (!isNaN(max)) {
      filtered = filtered.filter(ac => (ac.gs || 0) <= max);
    }
  }

  return filtered;
}

/**
 * Sort aircraft by field
 */
export function sortAircraft(aircraft, sortField, sortAsc) {
  return aircraft.sort((a, b) => {
    const aVal = a[sortField] ?? 999999;
    const bVal = b[sortField] ?? 999999;
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return sortAsc ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
  });
}

/**
 * Calculate stats for aircraft list
 */
export function calculateStats(aircraft) {
  return {
    total: aircraft.length,
    military: aircraft.filter(ac => ac.military).length,
    emergency: aircraft.filter(ac => ac.emergency || ac.squawk?.match(/^7[567]00$/)).length,
    climbing: aircraft.filter(ac => (ac.vr || 0) > 500).length,
    descending: aircraft.filter(ac => (ac.vr || 0) < -500).length,
  };
}

/**
 * Check if any filters are active
 */
export function hasActiveFilters(searchFilter, filters) {
  return searchFilter ||
    filters.military !== null ||
    filters.emergency ||
    filters.climbing ||
    filters.descending ||
    filters.onGround ||
    filters.minAltitude ||
    filters.maxAltitude ||
    filters.minDistance ||
    filters.maxDistance ||
    filters.minSpeed ||
    filters.maxSpeed;
}
