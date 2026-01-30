/**
 * Demo/mock aircraft data for development when backend is unavailable
 */

export const DEMO_AIRCRAFT = [
  { hex: 'A12345', flight: 'UAL123', lat: 47.45, lon: -122.30, alt: 35000, gs: 450, track: 180, t: 'B738', squawk: '1200', military: false, category: 'A3' },
  { hex: 'A67890', flight: 'DAL456', lat: 47.50, lon: -122.20, alt: 28000, gs: 380, track: 90, t: 'A320', squawk: '2345', military: false, category: 'A3' },
  { hex: 'AE1234', flight: 'EVAC01', lat: 47.55, lon: -122.35, alt: 5000, gs: 120, track: 270, t: 'H60', squawk: '7700', military: true, emergency: true, category: 'A7' },
  { hex: 'A11111', flight: 'SWA789', lat: 47.40, lon: -122.40, alt: 15000, gs: 280, track: 45, t: 'B737', squawk: '3456', military: false, category: 'A3' },
  { hex: 'A22222', flight: 'AAL321', lat: 47.60, lon: -122.25, alt: 38000, gs: 480, track: 135, t: 'B789', squawk: '4567', military: false, category: 'A5' },
  { hex: 'AE5678', flight: 'RCH001', lat: 47.35, lon: -122.50, alt: 25000, gs: 420, track: 315, t: 'C17', squawk: '5678', military: true, category: 'A5' },
  { hex: 'A33333', flight: 'ASA555', lat: 47.48, lon: -122.15, alt: 12000, gs: 250, track: 200, t: 'E75L', squawk: '6789', military: false, category: 'A3' },
  { hex: 'A44444', flight: 'N12345', lat: 47.52, lon: -122.45, alt: 3500, gs: 95, track: 60, t: 'C172', squawk: '1200', military: false, category: 'A1' },
];

/**
 * Generate animated demo data
 */
export function generateDemoAircraft(baseAircraft, tick) {
  return baseAircraft.map(ac => {
    const moveSpeed = (ac.gs || 300) / 3600 / 60; // degrees per second approx
    const radians = (ac.track || 0) * Math.PI / 180;
    return {
      ...ac,
      lat: ac.lat + Math.sin(radians) * moveSpeed * tick * 0.1,
      lon: ac.lon + Math.cos(radians) * moveSpeed * tick * 0.1,
      seen: 0,
      distance_nm: Math.random() * 50 + 5,
    };
  });
}
