import { describe, it, expect } from 'vitest';
import {
  formatTafTime,
  formatTafValidity,
  formatTafWind,
  formatTafVisibility,
  formatTafCeiling,
  formatCloudLayer,
  getWorstForecastCategory,
  isTafImproving,
  isTafDeteriorating,
  getTafSummary,
  getCategoryTransition,
  getTafIndicatorColor,
  findTafForAirport,
  isTafStale,
  getTafRemainingHours,
} from './tafUtils';

describe('tafUtils', () => {
  describe('formatTafTime', () => {
    it('should format ISO time correctly', () => {
      const time = '2024-01-15T14:00:00.000Z';
      const result = formatTafTime(time);
      expect(result).not.toBe('--');
    });

    it('should return -- for null input', () => {
      expect(formatTafTime(null)).toBe('--');
      expect(formatTafTime(undefined)).toBe('--');
    });

    it('should include date when requested', () => {
      const time = '2024-01-15T14:00:00.000Z';
      const result = formatTafTime(time, true);
      expect(result).toContain('Jan');
    });
  });

  describe('formatTafValidity', () => {
    it('should format validity period', () => {
      const from = '2024-01-15T12:00:00.000Z';
      const to = '2024-01-16T12:00:00.000Z';
      const result = formatTafValidity(from, to);
      expect(result).toContain('-');
    });

    it('should handle missing times', () => {
      const result = formatTafValidity(null, null);
      expect(result).toBe('Unknown validity');
    });
  });

  describe('formatTafWind', () => {
    it('should format wind correctly', () => {
      const wind = { direction: 270, speed: 15, gust: 25 };
      const result = formatTafWind(wind);
      expect(result).toBe('270@15kt G25');
    });

    it('should handle calm winds', () => {
      const wind = { direction: 0, speed: 0, gust: null };
      const result = formatTafWind(wind);
      expect(result).toBe('Calm');
    });

    it('should handle variable winds', () => {
      const wind = { direction: 'VRB', speed: 5, gust: null };
      const result = formatTafWind(wind);
      expect(result).toBe('VRB@5kt');
    });

    it('should return null for missing wind', () => {
      expect(formatTafWind(null)).toBeNull();
    });
  });

  describe('formatTafVisibility', () => {
    it('should format visibility in statute miles', () => {
      const visibility = { value: 3, isGreaterThan: false };
      const result = formatTafVisibility(visibility);
      expect(result).toBe('3SM');
    });

    it('should handle greater than visibility', () => {
      const visibility = { value: 6, isGreaterThan: true };
      const result = formatTafVisibility(visibility);
      expect(result).toBe('P6SM');
    });

    it('should handle fractional visibility', () => {
      const visibility = { value: 0.5, isGreaterThan: false };
      const result = formatTafVisibility(visibility);
      expect(result).toBe('1/2SM');
    });
  });

  describe('formatTafCeiling', () => {
    it('should format ceiling height', () => {
      const result = formatTafCeiling(3000);
      expect(result).toBe('3,000 ft AGL');
    });

    it('should return Unlimited for null ceiling', () => {
      expect(formatTafCeiling(null)).toBe('Unlimited');
      expect(formatTafCeiling(undefined)).toBe('Unlimited');
    });
  });

  describe('formatCloudLayer', () => {
    it('should format cloud layer correctly', () => {
      const cloud = { cover: 'BKN', base: 2500, type: null };
      const result = formatCloudLayer(cloud);
      expect(result).toBe('Broken @ 2,500ft');
    });

    it('should include cloud type if present', () => {
      const cloud = { cover: 'OVC', base: 5000, type: 'CB' };
      const result = formatCloudLayer(cloud);
      expect(result).toContain('CB');
    });
  });

  describe('getWorstForecastCategory', () => {
    it('should return current category if no changes', () => {
      const taf = { currentCategory: 'MVFR', forecastCategories: [] };
      const result = getWorstForecastCategory(taf);
      expect(result).toBe('MVFR');
    });

    it('should return worst forecast category', () => {
      const taf = { currentCategory: 'VFR', forecastCategories: ['MVFR', 'IFR', 'VFR'] };
      const result = getWorstForecastCategory(taf);
      expect(result).toBe('IFR');
    });

    it('should handle LIFR as worst', () => {
      const taf = { currentCategory: 'VFR', forecastCategories: ['LIFR'] };
      const result = getWorstForecastCategory(taf);
      expect(result).toBe('LIFR');
    });
  });

  describe('isTafImproving', () => {
    it('should return true for improving conditions', () => {
      const taf = {
        currentCategory: 'IFR',
        changeGroups: [
          { type: 'FM', flightCategory: 'MVFR' },
          { type: 'BECMG', flightCategory: 'VFR' },
        ],
      };
      const result = isTafImproving(taf);
      expect(result).toBe(true);
    });

    it('should return false for deteriorating conditions', () => {
      const taf = {
        currentCategory: 'VFR',
        changeGroups: [{ type: 'FM', flightCategory: 'IFR' }],
      };
      const result = isTafImproving(taf);
      expect(result).toBe(false);
    });
  });

  describe('isTafDeteriorating', () => {
    it('should return true for deteriorating conditions', () => {
      const taf = {
        currentCategory: 'VFR',
        changeGroups: [{ type: 'FM', flightCategory: 'IFR' }],
      };
      const result = isTafDeteriorating(taf);
      expect(result).toBe(true);
    });

    it('should return false for improving conditions', () => {
      const taf = {
        currentCategory: 'IFR',
        changeGroups: [{ type: 'FM', flightCategory: 'VFR' }],
      };
      const result = isTafDeteriorating(taf);
      expect(result).toBe(false);
    });
  });

  describe('getTafSummary', () => {
    it('should return summary with current category', () => {
      const taf = {
        currentCategory: 'VFR',
        changeGroups: [],
        hasSignificantWeather: false,
      };
      const result = getTafSummary(taf);
      expect(result).toContain('VFR');
    });

    it('should show transition in summary', () => {
      const taf = {
        currentCategory: 'VFR',
        changeGroups: [{ type: 'FM', flightCategory: 'IFR' }],
        forecastCategories: ['IFR'],
        hasSignificantWeather: false,
      };
      const result = getTafSummary(taf);
      expect(result).toContain('VFR');
      expect(result).toContain('IFR');
    });
  });

  describe('getCategoryTransition', () => {
    it('should return null if no transitions', () => {
      const taf = { currentCategory: 'VFR', changeGroups: [] };
      const result = getCategoryTransition(taf);
      expect(result).toBeNull();
    });

    it('should return transition info', () => {
      const taf = {
        currentCategory: 'VFR',
        changeGroups: [
          { type: 'FM', flightCategory: 'MVFR', startTime: '2024-01-15T18:00:00Z' },
        ],
      };
      const result = getCategoryTransition(taf);
      expect(result).not.toBeNull();
      expect(result.current).toBe('VFR');
      expect(result.transitions.length).toBe(1);
      expect(result.transitions[0].from).toBe('VFR');
      expect(result.transitions[0].to).toBe('MVFR');
    });
  });

  describe('getTafIndicatorColor', () => {
    it('should return VFR color for VFR forecast', () => {
      const taf = { currentCategory: 'VFR', forecastCategories: [] };
      const result = getTafIndicatorColor(taf);
      expect(result).toContain('0, 200, 0'); // Green
    });

    it('should return worst category color', () => {
      const taf = { currentCategory: 'VFR', forecastCategories: ['IFR'] };
      const result = getTafIndicatorColor(taf);
      expect(result).toContain('255'); // Red component
    });
  });

  describe('findTafForAirport', () => {
    const mockTafs = [
      { stationId: 'KSEA', currentCategory: 'VFR' },
      { stationId: 'KPAE', currentCategory: 'MVFR' },
    ];

    it('should find TAF by ICAO code', () => {
      const airport = { icao: 'KSEA' };
      const result = findTafForAirport(airport, mockTafs);
      expect(result).not.toBeNull();
      expect(result.stationId).toBe('KSEA');
    });

    it('should return null if no matching TAF', () => {
      const airport = { icao: 'KORD' };
      const result = findTafForAirport(airport, mockTafs);
      expect(result).toBeNull();
    });

    it('should handle case insensitivity', () => {
      const airport = { icao: 'ksea' };
      const result = findTafForAirport(airport, mockTafs);
      expect(result).not.toBeNull();
    });
  });

  describe('isTafStale', () => {
    it('should return true for null TAF', () => {
      expect(isTafStale(null)).toBe(true);
    });

    it('should return true for expired TAF', () => {
      const taf = { validTo: '2020-01-01T00:00:00Z' };
      expect(isTafStale(taf)).toBe(true);
    });

    it('should return false for valid TAF', () => {
      const futureDate = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
      const taf = { validTo: futureDate, fetchTime: Date.now() };
      expect(isTafStale(taf)).toBe(false);
    });
  });

  describe('getTafRemainingHours', () => {
    it('should return -1 for null TAF', () => {
      expect(getTafRemainingHours(null)).toBe(-1);
    });

    it('should return 0 for expired TAF', () => {
      const taf = { validTo: '2020-01-01T00:00:00Z' };
      expect(getTafRemainingHours(taf)).toBe(0);
    });

    it('should return remaining hours', () => {
      const futureDate = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
      const taf = { validTo: futureDate };
      const result = getTafRemainingHours(taf);
      expect(result).toBeGreaterThanOrEqual(2);
      expect(result).toBeLessThanOrEqual(3);
    });
  });
});
