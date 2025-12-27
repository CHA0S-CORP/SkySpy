// ============================================================================
// Configuration Helpers
// ============================================================================

export const DEFAULT_CONFIG = {
  apiBaseUrl: '',
  mapMode: 'pro',  // 'radar', 'crt', 'pro', 'map'
  mapDarkMode: true,
  browserNotifications: false
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
};

export const getConfig = () => {
  const stored = localStorage.getItem('adsb-dashboard-config');
  return stored ? { ...DEFAULT_CONFIG, ...JSON.parse(stored) } : DEFAULT_CONFIG;
};

export const saveConfig = (config) => {
  localStorage.setItem('adsb-dashboard-config', JSON.stringify(config));
};

export const getOverlays = () => {
  const stored = localStorage.getItem('adsb-dashboard-overlays');
  return stored ? { ...DEFAULT_OVERLAYS, ...JSON.parse(stored) } : DEFAULT_OVERLAYS;
};

export const saveOverlays = (overlays) => {
  localStorage.setItem('adsb-dashboard-overlays', JSON.stringify(overlays));
};
