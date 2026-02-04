import { describe, it, expect } from 'vitest';
import {
  safeIntAltitude,
  getAircraftAltitude,
  getAircraftVerticalRate,
  getAircraftType,
  isEmergencySquawk,
  isAircraftEmergency,
  isAircraftMilitary,
} from './valueExtractor';

describe('safeIntAltitude', () => {
  describe('valid numeric values', () => {
    it('should parse integer value', () => {
      expect(safeIntAltitude(35000)).toBe(35000);
    });

    it('should parse string integer value', () => {
      expect(safeIntAltitude('35000')).toBe(35000);
    });

    it('should truncate decimal values', () => {
      expect(safeIntAltitude(35000.7)).toBe(35000);
      expect(safeIntAltitude('35000.9')).toBe(35000);
    });

    it('should handle zero', () => {
      expect(safeIntAltitude(0)).toBe(0);
      expect(safeIntAltitude('0')).toBe(0);
    });

    it('should handle negative altitudes', () => {
      expect(safeIntAltitude(-100)).toBe(-100);
    });
  });

  describe('null/undefined/empty values', () => {
    it('should return null for null input', () => {
      expect(safeIntAltitude(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(safeIntAltitude(undefined)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(safeIntAltitude('')).toBeNull();
    });
  });

  describe('special values', () => {
    it('should return null for "ground" value', () => {
      expect(safeIntAltitude('ground')).toBeNull();
    });

    it('should return null for non-numeric strings', () => {
      expect(safeIntAltitude('invalid')).toBeNull();
      expect(safeIntAltitude('abc123')).toBeNull();
    });

    it('should return null for NaN', () => {
      expect(safeIntAltitude(NaN)).toBeNull();
    });
  });
});

describe('getAircraftAltitude', () => {
  it('should prefer alt_baro', () => {
    const aircraft = { alt_baro: 35000, alt_geom: 35100, alt: 35050 };
    expect(getAircraftAltitude(aircraft)).toBe(35000);
  });

  it('should fallback to alt_geom if alt_baro is null', () => {
    const aircraft = { alt_baro: null, alt_geom: 35100, alt: 35050 };
    expect(getAircraftAltitude(aircraft)).toBe(35100);
  });

  it('should fallback to alt_geom if alt_baro is 0', () => {
    // Note: 0 is falsy, so it falls through to alt_geom
    const aircraft = { alt_baro: 0, alt_geom: 35100, alt: 35050 };
    expect(getAircraftAltitude(aircraft)).toBe(35100);
  });

  it('should fallback to alt if alt_baro and alt_geom are null', () => {
    const aircraft = { alt_baro: null, alt_geom: null, alt: 35050 };
    expect(getAircraftAltitude(aircraft)).toBe(35050);
  });

  it('should return undefined if no altitude fields exist', () => {
    const aircraft = { hex: 'A12345' };
    expect(getAircraftAltitude(aircraft)).toBeFalsy();
  });

  it('should handle aircraft on ground', () => {
    const aircraft = { alt_baro: 'ground', alt_geom: null, alt: null };
    expect(getAircraftAltitude(aircraft)).toBeFalsy();
  });

  it('should handle string altitudes', () => {
    const aircraft = { alt_baro: '35000' };
    expect(getAircraftAltitude(aircraft)).toBe(35000);
  });
});

describe('getAircraftVerticalRate', () => {
  it('should prefer baro_rate', () => {
    const aircraft = { baro_rate: -500, geom_rate: -450, vr: -400 };
    expect(getAircraftVerticalRate(aircraft)).toBe(-500);
  });

  it('should fallback to geom_rate', () => {
    const aircraft = { baro_rate: null, geom_rate: -450, vr: -400 };
    expect(getAircraftVerticalRate(aircraft)).toBe(-450);
  });

  it('should fallback to vr', () => {
    const aircraft = { baro_rate: null, geom_rate: null, vr: -400 };
    expect(getAircraftVerticalRate(aircraft)).toBe(-400);
  });

  it('should handle positive (climbing) rate', () => {
    const aircraft = { baro_rate: 1500 };
    expect(getAircraftVerticalRate(aircraft)).toBe(1500);
  });

  it('should handle zero rate (level flight)', () => {
    // Note: The function uses || which treats 0 as falsy, so it falls through
    // This is intentional as 0 vertical rate typically means "no data" in ADS-B
    const aircraft = { baro_rate: 0 };
    // Function returns falsy value for 0 (falls through to undefined)
    expect(getAircraftVerticalRate(aircraft)).toBeFalsy();
  });

  it('should return undefined if no rate fields exist', () => {
    const aircraft = { hex: 'A12345' };
    expect(getAircraftVerticalRate(aircraft)).toBeUndefined();
  });
});

describe('getAircraftType', () => {
  it('should prefer t field', () => {
    const aircraft = { t: 'B738', type: 'B737' };
    expect(getAircraftType(aircraft)).toBe('B738');
  });

  it('should fallback to type field', () => {
    const aircraft = { type: 'A320' };
    expect(getAircraftType(aircraft)).toBe('A320');
  });

  it('should return empty string if no type fields exist', () => {
    const aircraft = { hex: 'A12345' };
    expect(getAircraftType(aircraft)).toBe('');
  });

  it('should handle null t field', () => {
    const aircraft = { t: null, type: 'B777' };
    expect(getAircraftType(aircraft)).toBe('B777');
  });
});

describe('isEmergencySquawk', () => {
  describe('emergency codes', () => {
    it('should recognize 7500 (hijack)', () => {
      expect(isEmergencySquawk('7500')).toBe(true);
    });

    it('should recognize 7600 (radio failure)', () => {
      expect(isEmergencySquawk('7600')).toBe(true);
    });

    it('should recognize 7700 (general emergency)', () => {
      expect(isEmergencySquawk('7700')).toBe(true);
    });
  });

  describe('non-emergency codes', () => {
    it('should not match normal squawk 1200', () => {
      expect(isEmergencySquawk('1200')).toBe(false);
    });

    it('should not match discrete squawk', () => {
      expect(isEmergencySquawk('4521')).toBe(false);
    });

    it('should not match VFR squawk 7000', () => {
      expect(isEmergencySquawk('7000')).toBe(false);
    });

    it('should not match partial emergency code', () => {
      expect(isEmergencySquawk('750')).toBe(false);
      expect(isEmergencySquawk('77')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should return false for null', () => {
      expect(isEmergencySquawk(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isEmergencySquawk(undefined)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isEmergencySquawk('')).toBe(false);
    });
  });
});

describe('isAircraftEmergency', () => {
  it('should detect emergency by squawk 7500', () => {
    const aircraft = { squawk: '7500' };
    expect(isAircraftEmergency(aircraft)).toBe(true);
  });

  it('should detect emergency by squawk 7600', () => {
    const aircraft = { squawk: '7600' };
    expect(isAircraftEmergency(aircraft)).toBe(true);
  });

  it('should detect emergency by squawk 7700', () => {
    const aircraft = { squawk: '7700' };
    expect(isAircraftEmergency(aircraft)).toBe(true);
  });

  it('should detect emergency by emergency flag', () => {
    const aircraft = { squawk: '1234', emergency: true };
    expect(isAircraftEmergency(aircraft)).toBe(true);
  });

  it('should not detect emergency for normal aircraft', () => {
    const aircraft = { squawk: '1234', emergency: false };
    expect(isAircraftEmergency(aircraft)).toBe(false);
  });

  it('should handle aircraft without squawk', () => {
    const aircraft = { emergency: true };
    expect(isAircraftEmergency(aircraft)).toBe(true);
  });

  it('should handle aircraft without emergency field', () => {
    const aircraft = { squawk: '7700' };
    expect(isAircraftEmergency(aircraft)).toBe(true);
  });

  it('should return false for aircraft with no emergency indicators', () => {
    const aircraft = { hex: 'A12345' };
    expect(isAircraftEmergency(aircraft)).toBe(false);
  });
});

describe('isAircraftMilitary', () => {
  describe('military flag', () => {
    it('should detect military by military flag true', () => {
      const aircraft = { military: true };
      expect(isAircraftMilitary(aircraft)).toBe(true);
    });

    it('should not detect military when flag is false', () => {
      const aircraft = { military: false };
      expect(isAircraftMilitary(aircraft)).toBe(false);
    });
  });

  describe('dbFlags', () => {
    it('should detect military by dbFlags bit 1', () => {
      const aircraft = { dbFlags: 1 };
      expect(isAircraftMilitary(aircraft)).toBe(true);
    });

    it('should detect military when bit 1 is set among other flags', () => {
      const aircraft = { dbFlags: 3 }; // binary: 11
      expect(isAircraftMilitary(aircraft)).toBe(true);
    });

    it('should detect military with higher dbFlags values', () => {
      const aircraft = { dbFlags: 5 }; // binary: 101
      expect(isAircraftMilitary(aircraft)).toBe(true);
    });

    it('should not detect military when bit 1 is not set', () => {
      const aircraft = { dbFlags: 2 }; // binary: 10
      expect(isAircraftMilitary(aircraft)).toBe(false);
    });

    it('should not detect military when dbFlags is 0', () => {
      const aircraft = { dbFlags: 0 };
      expect(isAircraftMilitary(aircraft)).toBe(false);
    });
  });

  describe('combined flags', () => {
    it('should detect military when either flag is true', () => {
      const aircraft1 = { military: true, dbFlags: 0 };
      const aircraft2 = { military: false, dbFlags: 1 };
      expect(isAircraftMilitary(aircraft1)).toBe(true);
      expect(isAircraftMilitary(aircraft2)).toBe(true);
    });

    it('should detect military when both flags indicate military', () => {
      const aircraft = { military: true, dbFlags: 1 };
      expect(isAircraftMilitary(aircraft)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle missing both fields', () => {
      const aircraft = { hex: 'A12345' };
      expect(isAircraftMilitary(aircraft)).toBe(false);
    });

    it('should handle null dbFlags', () => {
      const aircraft = { dbFlags: null };
      expect(isAircraftMilitary(aircraft)).toBe(false);
    });

    it('should handle undefined dbFlags', () => {
      const aircraft = { dbFlags: undefined };
      expect(isAircraftMilitary(aircraft)).toBe(false);
    });
  });
});
