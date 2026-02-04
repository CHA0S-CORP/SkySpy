import { describe, it, expect } from 'vitest';
import {
  getCeiling,
  getFlightCategory,
  getFlightCategoryInfo,
  getFlightCategoryColor,
  formatMetarWind,
  formatMetarVisibility,
  formatMetarCeiling,
  formatMetarTempDew,
  formatMetar,
  findMetarForAirport,
  getAirportColor,
  isMetarStale,
  getMetarAgeMinutes,
  FLIGHT_CATEGORIES,
} from './metarUtils';

describe('metarUtils', () => {
  describe('getCeiling', () => {
    it('returns null for empty or no clouds', () => {
      expect(getCeiling(null)).toBeNull();
      expect(getCeiling([])).toBeNull();
      expect(getCeiling(undefined)).toBeNull();
    });

    it('returns null when no ceiling layers exist', () => {
      const clouds = [
        { cover: 'FEW', base: 5000 },
        { cover: 'SCT', base: 8000 },
      ];
      expect(getCeiling(clouds)).toBeNull();
    });

    it('returns ceiling for BKN layer', () => {
      const clouds = [
        { cover: 'FEW', base: 2000 },
        { cover: 'BKN', base: 5000 },
      ];
      expect(getCeiling(clouds)).toBe(5000);
    });

    it('returns ceiling for OVC layer', () => {
      const clouds = [{ cover: 'OVC', base: 3500 }];
      expect(getCeiling(clouds)).toBe(3500);
    });

    it('returns lowest ceiling when multiple exist', () => {
      const clouds = [
        { cover: 'BKN', base: 8000 },
        { cover: 'OVC', base: 4000 },
        { cover: 'BKN', base: 6000 },
      ];
      expect(getCeiling(clouds)).toBe(4000);
    });
  });

  describe('getFlightCategory', () => {
    it('returns fltCat from metar if present', () => {
      expect(getFlightCategory({ fltCat: 'IFR' })).toBe('IFR');
      expect(getFlightCategory({ fltCat: 'MVFR' })).toBe('MVFR');
    });

    it('returns VFR for null/undefined metar', () => {
      expect(getFlightCategory(null)).toBe('VFR');
      expect(getFlightCategory(undefined)).toBe('VFR');
    });

    it('returns LIFR for visibility < 1', () => {
      expect(getFlightCategory({ visib: 0.5 })).toBe('LIFR');
    });

    it('returns LIFR for ceiling < 500', () => {
      expect(getFlightCategory({ clouds: [{ cover: 'OVC', base: 300 }] })).toBe('LIFR');
    });

    it('returns IFR for visibility 1-3', () => {
      expect(getFlightCategory({ visib: 2 })).toBe('IFR');
    });

    it('returns IFR for ceiling 500-1000', () => {
      expect(getFlightCategory({ clouds: [{ cover: 'BKN', base: 800 }] })).toBe('IFR');
    });

    it('returns MVFR for visibility 3-5', () => {
      expect(getFlightCategory({ visib: 4 })).toBe('MVFR');
    });

    it('returns MVFR for ceiling 1000-3000', () => {
      expect(getFlightCategory({ clouds: [{ cover: 'OVC', base: 2000 }] })).toBe('MVFR');
    });

    it('returns VFR for good conditions', () => {
      expect(getFlightCategory({ visib: 10, clouds: [{ cover: 'SCT', base: 5000 }] })).toBe('VFR');
    });
  });

  describe('getFlightCategoryInfo', () => {
    it('returns info object for category string', () => {
      const info = getFlightCategoryInfo('IFR');
      expect(info.code).toBe('IFR');
      expect(info.name).toBe('Instrument Flight Rules');
      expect(info.color).toBeDefined();
    });

    it('returns info for METAR object', () => {
      const info = getFlightCategoryInfo({ fltCat: 'MVFR' });
      expect(info.code).toBe('MVFR');
    });
  });

  describe('getFlightCategoryColor', () => {
    it('returns color for category string', () => {
      const color = getFlightCategoryColor('VFR');
      expect(color).toContain('rgba');
      expect(color).toContain('0,');
    });

    it('returns map color when forMap is true', () => {
      const uiColor = getFlightCategoryColor('VFR', false);
      const mapColor = getFlightCategoryColor('VFR', true);
      expect(uiColor).not.toBe(mapColor);
    });
  });

  describe('formatMetarWind', () => {
    it('returns null for missing data', () => {
      expect(formatMetarWind(null)).toBeNull();
      expect(formatMetarWind({})).toBeNull();
    });

    it('formats calm wind', () => {
      expect(formatMetarWind({ wdir: 0, wspd: 0 })).toBe('Calm');
    });

    it('formats wind with direction and speed', () => {
      expect(formatMetarWind({ wdir: 270, wspd: 15 })).toBe('270\u00B0 @ 15kt');
    });

    it('includes gusts when present', () => {
      expect(formatMetarWind({ wdir: 180, wspd: 20, wgst: 30 })).toBe('180\u00B0 @ 20kt G30kt');
    });

    it('shows VRB for variable winds', () => {
      expect(formatMetarWind({ wspd: 5 })).toBe('VRB @ 5kt');
    });
  });

  describe('formatMetarVisibility', () => {
    it('returns null for missing visibility', () => {
      expect(formatMetarVisibility(null)).toBeNull();
      expect(formatMetarVisibility({})).toBeNull();
    });

    it('formats unlimited visibility', () => {
      expect(formatMetarVisibility({ visib: 10 })).toBe('10+ SM');
    });

    it('formats normal visibility', () => {
      expect(formatMetarVisibility({ visib: 5 })).toBe('5 SM');
    });

    it('formats low visibility as fraction', () => {
      expect(formatMetarVisibility({ visib: 0.5 })).toBe('1/2 SM');
      expect(formatMetarVisibility({ visib: 0.25 })).toBe('1/4 SM');
    });
  });

  describe('formatMetarCeiling', () => {
    it('returns Clear for no clouds', () => {
      expect(formatMetarCeiling(null)).toBe('Clear');
      expect(formatMetarCeiling({})).toBe('Clear');
      expect(formatMetarCeiling({ clouds: [] })).toBe('Clear');
    });

    it('formats ceiling height', () => {
      const result = formatMetarCeiling({ clouds: [{ cover: 'OVC', base: 2500 }] });
      expect(result).toContain('OVC');
      expect(result).toContain('2,500');
    });

    it('shows lowest cloud when no ceiling', () => {
      const result = formatMetarCeiling({ clouds: [{ cover: 'SCT', base: 3000 }] });
      expect(result).toContain('SCT');
    });
  });

  describe('formatMetarTempDew', () => {
    it('returns null for missing temp', () => {
      expect(formatMetarTempDew(null)).toBeNull();
      expect(formatMetarTempDew({})).toBeNull();
    });

    it('formats temperature only', () => {
      expect(formatMetarTempDew({ temp: 20 })).toBe('20\u00B0C');
    });

    it('formats temp and dewpoint', () => {
      expect(formatMetarTempDew({ temp: 25, dewp: 15 })).toBe('25\u00B0C / 15\u00B0C');
    });
  });

  describe('formatMetar', () => {
    it('returns null for null input', () => {
      expect(formatMetar(null)).toBeNull();
    });

    it('returns formatted summary object', () => {
      const metar = {
        stationId: 'KJFK',
        fltCat: 'VFR',
        visib: 10,
        temp: 22,
        dewp: 15,
        wspd: 10,
        wdir: 270,
      };
      const result = formatMetar(metar);
      expect(result.stationId).toBe('KJFK');
      expect(result.flightCategory).toBe('VFR');
      expect(result.wind).toBeDefined();
      expect(result.visibility).toBeDefined();
    });
  });

  describe('findMetarForAirport', () => {
    it('returns null for missing data', () => {
      expect(findMetarForAirport(null, [])).toBeNull();
      expect(findMetarForAirport({}, null)).toBeNull();
      expect(findMetarForAirport({}, [])).toBeNull();
    });

    it('matches by icao', () => {
      const airport = { icao: 'KJFK' };
      const metars = [
        { stationId: 'KLGA', fltCat: 'VFR' },
        { stationId: 'KJFK', fltCat: 'MVFR' },
      ];
      const result = findMetarForAirport(airport, metars);
      expect(result.stationId).toBe('KJFK');
    });

    it('matches by faaId', () => {
      const airport = { faaId: 'LAX' };
      const metars = [{ stationId: 'LAX', fltCat: 'VFR' }];
      const result = findMetarForAirport(airport, metars);
      expect(result).toBeDefined();
    });

    it('is case insensitive', () => {
      const airport = { icao: 'kjfk' };
      const metars = [{ stationId: 'KJFK', fltCat: 'IFR' }];
      const result = findMetarForAirport(airport, metars);
      expect(result).toBeDefined();
    });
  });

  describe('getAirportColor', () => {
    it('returns flight category color when METAR available', () => {
      const airport = { icao: 'KJFK' };
      const metars = [{ stationId: 'KJFK', fltCat: 'IFR' }];
      const color = getAirportColor(airport, metars, true);
      expect(color).toContain('255');
      expect(color).toContain('80');
    });

    it('falls back to class color without METAR', () => {
      const airport = { icao: 'KXYZ', class: 'B' };
      const metars = [{ stationId: 'KJFK', fltCat: 'VFR' }];
      const color = getAirportColor(airport, metars, true);
      expect(color).toContain('100, 150, 255');
    });

    it('uses class color when flight category disabled', () => {
      const airport = { icao: 'KJFK', class: 'C' };
      const metars = [{ stationId: 'KJFK', fltCat: 'IFR' }];
      const color = getAirportColor(airport, metars, false);
      expect(color).toContain('200, 100, 200');
    });
  });

  describe('isMetarStale', () => {
    it('returns true for null metar', () => {
      expect(isMetarStale(null)).toBe(true);
    });

    it('returns true for missing obsTime', () => {
      expect(isMetarStale({})).toBe(true);
    });

    it('returns false for fresh metar', () => {
      const metar = { obsTime: new Date().toISOString() };
      expect(isMetarStale(metar)).toBe(false);
    });

    it('returns true for old metar', () => {
      const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000).toISOString();
      const metar = { obsTime: twoHoursAgo };
      expect(isMetarStale(metar)).toBe(true);
    });
  });

  describe('getMetarAgeMinutes', () => {
    it('returns -1 for null metar', () => {
      expect(getMetarAgeMinutes(null)).toBe(-1);
    });

    it('returns -1 for missing obsTime', () => {
      expect(getMetarAgeMinutes({})).toBe(-1);
    });

    it('returns correct age in minutes', () => {
      const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const metar = { obsTime: thirtyMinsAgo };
      const age = getMetarAgeMinutes(metar);
      expect(age).toBeGreaterThanOrEqual(29);
      expect(age).toBeLessThanOrEqual(31);
    });
  });

  describe('FLIGHT_CATEGORIES constant', () => {
    it('has all four categories', () => {
      expect(FLIGHT_CATEGORIES.VFR).toBeDefined();
      expect(FLIGHT_CATEGORIES.MVFR).toBeDefined();
      expect(FLIGHT_CATEGORIES.IFR).toBeDefined();
      expect(FLIGHT_CATEGORIES.LIFR).toBeDefined();
    });

    it('each category has required properties', () => {
      Object.values(FLIGHT_CATEGORIES).forEach((cat) => {
        expect(cat.code).toBeDefined();
        expect(cat.name).toBeDefined();
        expect(cat.description).toBeDefined();
        expect(cat.color).toBeDefined();
        expect(cat.mapColor).toBeDefined();
        expect(cat.cssClass).toBeDefined();
      });
    });
  });
});
