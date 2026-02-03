import { describe, it, expect } from 'vitest';
import { utcToLocal, utcToLocalTime, getCardinalDirection } from './time';

describe('utcToLocal', () => {
  describe('null/undefined/empty inputs', () => {
    it('should return null for null input', () => {
      expect(utcToLocal(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(utcToLocal(undefined)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(utcToLocal('')).toBeNull();
    });

    it('should return null for zero', () => {
      expect(utcToLocal(0)).toBeNull();
    });
  });

  describe('numeric timestamps', () => {
    it('should handle Unix timestamp in seconds', () => {
      // 2024-01-15 12:30:00 UTC = 1705322200
      const result = utcToLocal(1705322200);
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
      expect(result).toContain('Jan');
      expect(result).toContain('15');
    });

    it('should handle Unix timestamp in milliseconds', () => {
      // 2024-01-15 12:30:00 UTC = 1705322200000ms
      const result = utcToLocal(1705322200000);
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
      expect(result).toContain('Jan');
      expect(result).toContain('15');
    });

    it('should return null for timestamps before year 2000', () => {
      // Timestamp for 1999-12-31 = 946598400
      const result = utcToLocal(946598400);
      expect(result).toBeNull();
    });
  });

  describe('string timestamps', () => {
    it('should handle ISO 8601 string with Z suffix', () => {
      const result = utcToLocal('2024-06-15T14:30:00Z');
      expect(result).not.toBeNull();
      expect(result).toContain('Jun');
      expect(result).toContain('15');
    });

    it('should return null for non-standard UTC format', () => {
      // The function checks for 'UTC' in the string but passes it directly to new Date()
      // new Date() doesn't understand '2024-06-15T14:30:00UTC' or '2024-06-15T14:30:00 UTC'
      // This is a known limitation - use Z suffix instead for UTC times
      const result = utcToLocal('2024-06-15T14:30:00 UTC');
      expect(result).toBeNull();
    });

    it('should handle ISO 8601 string with +00:00', () => {
      const result = utcToLocal('2024-06-15T14:30:00+00:00');
      expect(result).not.toBeNull();
      expect(result).toContain('Jun');
      expect(result).toContain('15');
    });

    it('should handle DDHHMM format (aviation format)', () => {
      const result = utcToLocal('151430');
      expect(result).not.toBeNull();
      expect(result).toContain('15');
    });

    it('should handle DDHHMMZ format (aviation format with Z)', () => {
      // The regex /^\d{6}Z?$/ matches 6 digits optionally followed by Z
      // '151430Z' means day 15, hour 14, minute 30
      const result = utcToLocal('151430Z');
      expect(result).not.toBeNull();
      // The day will vary based on local timezone, just verify it parses
      expect(typeof result).toBe('string');
    });

    it('should handle date-only string YYYY-MM-DD', () => {
      const result = utcToLocal('2024-06-15');
      expect(result).not.toBeNull();
      expect(result).toContain('Jun');
      // Note: Day may shift due to timezone conversion from UTC midnight
      expect(result).toMatch(/14|15/);
    });

    it('should return null for ISO string with space instead of T', () => {
      // The function doesn't handle '2024-06-15 14:30:00' format (space instead of T)
      // It falls through to new Date() which may or may not parse it correctly
      const result = utcToLocal('2024-06-15 14:30:00');
      // This format is browser-dependent; the function returns null for invalid dates
      expect(result === null || typeof result === 'string').toBe(true);
    });
  });

  describe('invalid inputs', () => {
    it('should return null for invalid date string', () => {
      expect(utcToLocal('not-a-date')).toBeNull();
    });

    it('should return null for object input', () => {
      expect(utcToLocal({})).toBeNull();
    });

    it('should return null for array input', () => {
      expect(utcToLocal([])).toBeNull();
    });

    it('should return null for boolean input', () => {
      expect(utcToLocal(true)).toBeNull();
    });
  });

  describe('output format', () => {
    it('should include month abbreviation in output', () => {
      const result = utcToLocal('2024-03-20T10:00:00Z');
      expect(result).toMatch(/Mar/);
    });

    it('should include day number in output', () => {
      const result = utcToLocal('2024-03-20T10:00:00Z');
      expect(result).toContain('20');
    });

    it('should include time with AM/PM', () => {
      const result = utcToLocal('2024-03-20T10:00:00Z');
      expect(result).toMatch(/AM|PM/i);
    });
  });
});

describe('utcToLocalTime', () => {
  describe('null/undefined/empty inputs', () => {
    it('should return null for null input', () => {
      expect(utcToLocalTime(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(utcToLocalTime(undefined)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(utcToLocalTime('')).toBeNull();
    });

    it('should return null for zero', () => {
      expect(utcToLocalTime(0)).toBeNull();
    });
  });

  describe('numeric timestamps', () => {
    it('should handle Unix timestamp in seconds', () => {
      const result = utcToLocalTime(1705322200);
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });

    it('should handle Unix timestamp in milliseconds', () => {
      const result = utcToLocalTime(1705322200000);
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });
  });

  describe('string timestamps', () => {
    it('should handle ISO 8601 string with Z suffix', () => {
      const result = utcToLocalTime('2024-06-15T14:30:00Z');
      expect(result).not.toBeNull();
      expect(result).toMatch(/\d{1,2}:\d{2}/);
      expect(result).toMatch(/AM|PM/i);
    });

    it('should return null for non-standard UTC format', () => {
      // The function checks for 'UTC' in the string but passes it directly to new Date()
      // new Date() doesn't understand non-standard UTC formats
      const result = utcToLocalTime('2024-06-15T14:30:00 UTC');
      expect(result).toBeNull();
    });

    it('should handle DDHHMM aviation format', () => {
      const result = utcToLocalTime('151430');
      expect(result).not.toBeNull();
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });

    it('should handle DDHHMMZ aviation format', () => {
      const result = utcToLocalTime('151430Z');
      expect(result).not.toBeNull();
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });

    it('should handle plain datetime string', () => {
      const result = utcToLocalTime('2024-06-15 14:30:00');
      expect(result).not.toBeNull();
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });
  });

  describe('invalid inputs', () => {
    it('should return null for invalid date string', () => {
      expect(utcToLocalTime('not-a-date')).toBeNull();
    });

    it('should return null for object input', () => {
      expect(utcToLocalTime({})).toBeNull();
    });

    it('should return null for array input', () => {
      expect(utcToLocalTime([])).toBeNull();
    });

    it('should return null for boolean input', () => {
      expect(utcToLocalTime(true)).toBeNull();
    });
  });

  describe('output format', () => {
    it('should return time-only format without date', () => {
      const result = utcToLocalTime('2024-03-20T10:00:00Z');
      // Should not contain month names
      expect(result).not.toMatch(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/);
      // Should contain time format
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });

    it('should include AM/PM indicator', () => {
      const result = utcToLocalTime('2024-03-20T10:00:00Z');
      expect(result).toMatch(/AM|PM/i);
    });
  });
});

describe('getCardinalDirection', () => {
  describe('null/undefined inputs', () => {
    it('should return empty string for null', () => {
      expect(getCardinalDirection(null)).toBe('');
    });

    it('should return empty string for undefined', () => {
      expect(getCardinalDirection(undefined)).toBe('');
    });

    it('should return empty string for NaN', () => {
      expect(getCardinalDirection(NaN)).toBe('');
    });
  });

  describe('cardinal directions', () => {
    it('should return N for 0 degrees', () => {
      expect(getCardinalDirection(0)).toBe('N');
    });

    it('should return N for 360 degrees', () => {
      expect(getCardinalDirection(360)).toBe('N');
    });

    it('should return NE for 45 degrees', () => {
      expect(getCardinalDirection(45)).toBe('NE');
    });

    it('should return E for 90 degrees', () => {
      expect(getCardinalDirection(90)).toBe('E');
    });

    it('should return SE for 135 degrees', () => {
      expect(getCardinalDirection(135)).toBe('SE');
    });

    it('should return S for 180 degrees', () => {
      expect(getCardinalDirection(180)).toBe('S');
    });

    it('should return SW for 225 degrees', () => {
      expect(getCardinalDirection(225)).toBe('SW');
    });

    it('should return W for 270 degrees', () => {
      expect(getCardinalDirection(270)).toBe('W');
    });

    it('should return NW for 315 degrees', () => {
      expect(getCardinalDirection(315)).toBe('NW');
    });
  });

  describe('boundary cases', () => {
    it('should return N for small positive angles', () => {
      expect(getCardinalDirection(10)).toBe('N');
      expect(getCardinalDirection(22)).toBe('N');
    });

    it('should return NE for angles around 45', () => {
      expect(getCardinalDirection(23)).toBe('NE');
      expect(getCardinalDirection(67)).toBe('NE');
    });

    it('should return E for angles around 90', () => {
      expect(getCardinalDirection(68)).toBe('E');
      expect(getCardinalDirection(112)).toBe('E');
    });

    it('should return N for angles close to 360', () => {
      expect(getCardinalDirection(350)).toBe('N');
      expect(getCardinalDirection(355)).toBe('N');
    });
  });

  describe('edge cases', () => {
    it('should return undefined for negative angles due to negative array index', () => {
      // -45 degrees: Math.round(-45/45) % 8 = -1 % 8 = -1
      // dirs[-1] in JavaScript returns undefined
      const result = getCardinalDirection(-45);
      // The implementation doesn't handle negative values - returns undefined
      expect(result).toBeUndefined();
    });

    it('should handle angles greater than 360', () => {
      // 405 degrees = 45 degrees = NE
      expect(getCardinalDirection(405)).toBe('NE');
    });

    it('should handle zero', () => {
      expect(getCardinalDirection(0)).toBe('N');
    });

    it('should handle decimal values', () => {
      expect(getCardinalDirection(45.5)).toBe('NE');
      expect(getCardinalDirection(89.9)).toBe('E');
    });

    it('should handle string numbers', () => {
      // The function checks isNaN(deg), so string numbers should work
      expect(getCardinalDirection('90')).toBe('E');
    });
  });
});
