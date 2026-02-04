/**
 * Tests for Wake Turbulence Categories utility
 * Phase 8.4: Wake Turbulence Categories for Pro Mode
 */
import { describe, it, expect } from 'vitest';
import {
  WAKE_CATEGORIES,
  WAKE_CATEGORY_INFO,
  getWakeCategory,
  getWakeCategoryColor,
  getWakeCategoryInfo,
  getWakeCategoryFromAdsbCategory,
  determineWakeCategory,
} from './wakeCategories';

describe('wakeCategories', () => {
  describe('WAKE_CATEGORIES lookup table', () => {
    it('should contain Super category aircraft', () => {
      expect(WAKE_CATEGORIES['A380']).toBe('J');
      expect(WAKE_CATEGORIES['A388']).toBe('J');
      expect(WAKE_CATEGORIES['A225']).toBe('J');
    });

    it('should contain Heavy category aircraft', () => {
      expect(WAKE_CATEGORIES['B747']).toBe('H');
      expect(WAKE_CATEGORIES['B777']).toBe('H');
      expect(WAKE_CATEGORIES['B787']).toBe('H');
      expect(WAKE_CATEGORIES['A330']).toBe('H');
      expect(WAKE_CATEGORIES['A340']).toBe('H');
      expect(WAKE_CATEGORIES['A350']).toBe('H');
    });

    it('should contain Medium category aircraft', () => {
      expect(WAKE_CATEGORIES['B737']).toBe('M');
      expect(WAKE_CATEGORIES['B738']).toBe('M');
      expect(WAKE_CATEGORIES['A320']).toBe('M');
      expect(WAKE_CATEGORIES['B757']).toBe('M');
      expect(WAKE_CATEGORIES['E175']).toBe('M');
      expect(WAKE_CATEGORIES['CRJ9']).toBe('M');
    });

    it('should contain Light category aircraft', () => {
      expect(WAKE_CATEGORIES['C172']).toBe('L');
      expect(WAKE_CATEGORIES['PA28']).toBe('L');
      expect(WAKE_CATEGORIES['SR22']).toBe('L');
      expect(WAKE_CATEGORIES['DA40']).toBe('L');
    });
  });

  describe('WAKE_CATEGORY_INFO', () => {
    it('should have correct info for Super (J) category', () => {
      const info = WAKE_CATEGORY_INFO['J'];
      expect(info.name).toBe('Super');
      expect(info.color).toBe('#ff4444');
      expect(info.shortName).toBe('J');
    });

    it('should have correct info for Heavy (H) category', () => {
      const info = WAKE_CATEGORY_INFO['H'];
      expect(info.name).toBe('Heavy');
      expect(info.color).toBe('#ff8800');
    });

    it('should have correct info for Medium (M) category', () => {
      const info = WAKE_CATEGORY_INFO['M'];
      expect(info.name).toBe('Medium');
      expect(info.color).toBe('#ffff00');
    });

    it('should have correct info for Light (L) category', () => {
      const info = WAKE_CATEGORY_INFO['L'];
      expect(info.name).toBe('Light');
      expect(info.color).toBe('#44ff44');
    });
  });

  describe('getWakeCategory', () => {
    it('should return correct category for known types', () => {
      expect(getWakeCategory('B738')).toBe('M');
      expect(getWakeCategory('A380')).toBe('J');
      expect(getWakeCategory('B772')).toBe('H');
      expect(getWakeCategory('C172')).toBe('L');
    });

    it('should handle case insensitivity', () => {
      expect(getWakeCategory('b738')).toBe('M');
      expect(getWakeCategory('a380')).toBe('J');
    });

    it('should handle whitespace', () => {
      expect(getWakeCategory('  B738  ')).toBe('M');
    });

    it('should return null for unknown types', () => {
      expect(getWakeCategory('UNKNOWN')).toBeNull();
      expect(getWakeCategory('XYZ123')).toBeNull();
    });

    it('should return null for null/undefined input', () => {
      expect(getWakeCategory(null)).toBeNull();
      expect(getWakeCategory(undefined)).toBeNull();
      expect(getWakeCategory('')).toBeNull();
    });
  });

  describe('getWakeCategoryColor', () => {
    it('should return correct color for each category', () => {
      expect(getWakeCategoryColor('J')).toBe('#ff4444');
      expect(getWakeCategoryColor('H')).toBe('#ff8800');
      expect(getWakeCategoryColor('M')).toBe('#ffff00');
      expect(getWakeCategoryColor('L')).toBe('#44ff44');
    });

    it('should handle lowercase', () => {
      expect(getWakeCategoryColor('j')).toBe('#ff4444');
      expect(getWakeCategoryColor('h')).toBe('#ff8800');
    });

    it('should return gray for unknown/null category', () => {
      expect(getWakeCategoryColor(null)).toBe('#888888');
      expect(getWakeCategoryColor(undefined)).toBe('#888888');
      expect(getWakeCategoryColor('X')).toBe('#888888');
    });
  });

  describe('getWakeCategoryInfo', () => {
    it('should return full info object for valid category', () => {
      const info = getWakeCategoryInfo('H');
      expect(info).not.toBeNull();
      expect(info.name).toBe('Heavy');
      expect(info.color).toBe('#ff8800');
      expect(info.description).toContain('300,000');
    });

    it('should return null for invalid category', () => {
      expect(getWakeCategoryInfo('X')).toBeNull();
      expect(getWakeCategoryInfo(null)).toBeNull();
    });
  });

  describe('getWakeCategoryFromAdsbCategory', () => {
    it('should map ADS-B categories correctly', () => {
      expect(getWakeCategoryFromAdsbCategory('A1')).toBe('L'); // Light
      expect(getWakeCategoryFromAdsbCategory('A2')).toBe('M'); // Small
      expect(getWakeCategoryFromAdsbCategory('A3')).toBe('M'); // Large
      expect(getWakeCategoryFromAdsbCategory('A4')).toBe('M'); // High Vortex (B757)
      expect(getWakeCategoryFromAdsbCategory('A5')).toBe('H'); // Heavy
      expect(getWakeCategoryFromAdsbCategory('A7')).toBe('L'); // Rotorcraft
    });

    it('should return null for unknown ADS-B categories', () => {
      expect(getWakeCategoryFromAdsbCategory('B1')).toBeNull();
      expect(getWakeCategoryFromAdsbCategory('C1')).toBeNull();
      expect(getWakeCategoryFromAdsbCategory(null)).toBeNull();
    });
  });

  describe('determineWakeCategory', () => {
    it('should use type code from aircraft info first', () => {
      const aircraft = { hex: 'ABC123', t: 'B738' };
      const aircraftInfo = { type_code: 'A380' }; // Info takes priority

      const result = determineWakeCategory(aircraft, aircraftInfo);
      expect(result).toBe('J'); // Should use A380 from info
    });

    it('should fall back to aircraft type field', () => {
      const aircraft = { hex: 'ABC123', t: 'B738' };
      const aircraftInfo = {};

      const result = determineWakeCategory(aircraft, aircraftInfo);
      expect(result).toBe('M'); // Should use B738 from aircraft
    });

    it('should fall back to ADS-B category if no type available', () => {
      const aircraft = { hex: 'ABC123', category: 'A5' };
      const aircraftInfo = {};

      const result = determineWakeCategory(aircraft, aircraftInfo);
      expect(result).toBe('H'); // A5 = Heavy
    });

    it('should return null if no data available', () => {
      const aircraft = { hex: 'ABC123' };
      const aircraftInfo = {};

      const result = determineWakeCategory(aircraft, aircraftInfo);
      expect(result).toBeNull();
    });
  });
});
