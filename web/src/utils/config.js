// ============================================================================
// Configuration Helpers
// ============================================================================

// API base URL - defaults to relative URLs (same origin) which works with Vite proxy in dev
// and with Django serving static files in production
// Strip trailing slash to prevent double slashes in URL construction
export const API_BASE_URL = (import.meta.env.VITE_API_TARGET || '').replace(/\/$/, '');

// API v1 prefix for Django REST Framework
export const API_V1_PREFIX = '/api/v1';

// Helper to build API URLs
export const apiUrl = (path) => {
  // If path already starts with /api/v1, don't add the prefix again
  if (path.startsWith('/api/v1')) {
    return `${API_BASE_URL}${path}`;
  }
  // If path starts with /, just prepend base URL
  if (path.startsWith('/')) {
    return `${API_BASE_URL}${path}`;
  }
  // Otherwise, add the v1 prefix
  return `${API_BASE_URL}${API_V1_PREFIX}/${path}`;
};

export const DEFAULT_CONFIG = {
  apiBaseUrl: API_BASE_URL,
  mapMode: 'pro',  // 'radar', 'crt', 'pro', 'map'
  mapDarkMode: true,
  browserNotifications: false,
  shortTrackLength: 15,  // Number of positions to show in short track trails (5-50)
};

export const DEFAULT_OVERLAYS = {
  aircraft: true,
  vors: true,
  airports: true,
  airspace: true,
  metars: false,
  pireps: false,
  // Terrain overlays (pro mode only)
  water: false,
  counties: false,
  states: false,
  countries: false,
  // Aviation overlays (pro mode only) - tar1090 GeoJSON
  usArtcc: false,        // US ARTCC boundaries
  usRefueling: false,    // US A2A refueling tracks
  ukMilZones: false,     // UK military zones (AWACS, AAR, RC)
  euMilAwacs: false,     // EU military AWACS orbits (DE, NL, PL)
  trainingAreas: false,  // IFT/USAFA training areas
};

export const getConfig = () => {
  try {
    const stored = localStorage.getItem('adsb-dashboard-config');
    const config = stored ? { ...DEFAULT_CONFIG, ...JSON.parse(stored) } : DEFAULT_CONFIG;
    // Always normalize apiBaseUrl to prevent double slashes
    if (config.apiBaseUrl) {
      config.apiBaseUrl = config.apiBaseUrl.replace(/\/$/, '');
    }
    return config;
  } catch (e) {
    // localStorage may not be available in private browsing mode
    console.warn('Failed to read config from localStorage:', e.message);
    return DEFAULT_CONFIG;
  }
};

export const saveConfig = (config) => {
  try {
    localStorage.setItem('adsb-dashboard-config', JSON.stringify(config));
  } catch (e) {
    // localStorage may not be available in private browsing mode
    console.warn('Failed to save config to localStorage:', e.message);
  }
};

export const getOverlays = () => {
  try {
    const stored = localStorage.getItem('adsb-dashboard-overlays');
    return stored ? { ...DEFAULT_OVERLAYS, ...JSON.parse(stored) } : DEFAULT_OVERLAYS;
  } catch (e) {
    console.warn('Failed to read overlays from localStorage:', e.message);
    return DEFAULT_OVERLAYS;
  }
};

export const saveOverlays = (overlays) => {
  try {
    localStorage.setItem('adsb-dashboard-overlays', JSON.stringify(overlays));
  } catch (e) {
    console.warn('Failed to save overlays to localStorage:', e.message);
  }
};

// Default layer opacities (0.0 - 1.0)
export const DEFAULT_LAYER_OPACITIES = {
  usArtcc: 1.0,
  usRefueling: 1.0,
  ukMilZones: 1.0,
  euMilAwacs: 1.0,
  trainingAreas: 1.0,
  water: 1.0,
  countries: 1.0,
  states: 1.0,
  counties: 1.0,
};

export const getLayerOpacities = () => {
  try {
    const stored = localStorage.getItem('adsb-layer-opacities');
    return stored ? { ...DEFAULT_LAYER_OPACITIES, ...JSON.parse(stored) } : DEFAULT_LAYER_OPACITIES;
  } catch (e) {
    console.warn('Failed to read layer opacities from localStorage:', e.message);
    return DEFAULT_LAYER_OPACITIES;
  }
};

export const saveLayerOpacities = (opacities) => {
  try {
    localStorage.setItem('adsb-layer-opacities', JSON.stringify(opacities));
  } catch (e) {
    console.warn('Failed to save layer opacities to localStorage:', e.message);
  }
};
