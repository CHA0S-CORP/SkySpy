// ============================================================================
// Configuration Helpers
// ============================================================================

export const DEFAULT_CONFIG = {
  apiBaseUrl: import.meta.env.VITE_API_TARGET || '',
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
