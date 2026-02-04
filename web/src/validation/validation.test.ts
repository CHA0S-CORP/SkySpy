import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateAircraft,
  validateAircraftInfo,
  validateSafetyEvent,
  validateTrafficFilters,
  validateFeederLocation,
  readValidatedStorage,
  writeValidatedStorage,
  validateApiResponse,
  parseWithDefault,
  AircraftSchema,
  TrafficFiltersSchema,
} from './index';

describe('Validation Schemas', () => {
  describe('validateAircraft', () => {
    it('should validate valid aircraft data', () => {
      const aircraft = {
        hex: 'ABC123',
        flight: 'UAL123',
        lat: 47.5,
        lon: -122.3,
        altitude: 35000,
        speed: 450,
      };

      const result = validateAircraft(aircraft);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hex).toBe('ABC123');
        expect(result.data.flight).toBe('UAL123');
      }
    });

    it('should accept minimal aircraft data', () => {
      const aircraft = { hex: 'ABC123' };
      const result = validateAircraft(aircraft);
      expect(result.success).toBe(true);
    });

    it('should reject aircraft without hex', () => {
      const aircraft = { flight: 'UAL123' };
      const result = validateAircraft(aircraft);
      expect(result.success).toBe(false);
    });

    it('should reject invalid types', () => {
      const aircraft = {
        hex: 'ABC123',
        altitude: 'high', // should be number
      };
      const result = validateAircraft(aircraft);
      expect(result.success).toBe(false);
    });
  });

  describe('validateAircraftInfo', () => {
    it('should validate valid aircraft info', () => {
      const info = {
        icao_hex: 'ABC123',
        registration: 'N12345',
        type_code: 'B738',
        manufacturer: 'Boeing',
        model: '737-800',
        year_built: 2015,
        operator: 'United Airlines',
      };

      const result = validateAircraftInfo(info);
      expect(result.success).toBe(true);
    });

    it('should handle not-found response', () => {
      const info = {
        icao_hex: 'ABC123',
        found: false,
      };
      const result = validateAircraftInfo(info);
      expect(result.success).toBe(true);
    });

    it('should reject without icao_hex', () => {
      const info = { registration: 'N12345' };
      const result = validateAircraftInfo(info);
      expect(result.success).toBe(false);
    });
  });

  describe('validateSafetyEvent', () => {
    it('should validate valid safety event', () => {
      const event = {
        id: 'event-123',
        event_type: 'tcas_resolution',
        severity: 'warning',
        icao: 'ABC123',
        description: 'TCAS RA detected',
        timestamp: '2024-01-01T00:00:00Z',
      };

      const result = validateSafetyEvent(event);
      expect(result.success).toBe(true);
    });

    it('should reject invalid severity', () => {
      const event = {
        id: 'event-123',
        event_type: 'tcas_resolution',
        severity: 'unknown', // invalid
        description: 'TCAS RA detected',
        timestamp: '2024-01-01T00:00:00Z',
      };

      const result = validateSafetyEvent(event);
      expect(result.success).toBe(false);
    });
  });

  describe('validateTrafficFilters', () => {
    it('should validate complete traffic filters', () => {
      const filters = {
        showMilitary: true,
        showCivil: true,
        showGround: false,
        showAirborne: true,
        minAltitude: 0,
        maxAltitude: 60000,
        showWithSquawk: true,
        showWithoutSquawk: true,
        safetyEventsOnly: false,
        showGA: true,
        showAirliners: true,
      };

      const result = validateTrafficFilters(filters);
      expect(result.success).toBe(true);
    });

    it('should reject incomplete filters', () => {
      const filters = {
        showMilitary: true,
        // missing other required fields
      };

      const result = validateTrafficFilters(filters);
      expect(result.success).toBe(false);
    });
  });

  describe('validateFeederLocation', () => {
    it('should validate valid location', () => {
      const location = {
        lat: 47.5,
        lon: -122.3,
        name: 'Home',
      };

      const result = validateFeederLocation(location);
      expect(result.success).toBe(true);
    });

    it('should reject out-of-range latitude', () => {
      const location = {
        lat: 100, // invalid
        lon: -122.3,
      };

      const result = validateFeederLocation(location);
      expect(result.success).toBe(false);
    });

    it('should reject out-of-range longitude', () => {
      const location = {
        lat: 47.5,
        lon: 200, // invalid
      };

      const result = validateFeederLocation(location);
      expect(result.success).toBe(false);
    });
  });
});

describe('Validation Utilities', () => {
  describe('parseWithDefault', () => {
    it('should return parsed data on success', () => {
      const data = { hex: 'ABC123' };
      const result = parseWithDefault(AircraftSchema, data, { hex: 'DEFAULT' });
      expect(result.hex).toBe('ABC123');
    });

    it('should return default on failure', () => {
      const data = { invalid: true };
      const result = parseWithDefault(AircraftSchema, data, { hex: 'DEFAULT' });
      expect(result.hex).toBe('DEFAULT');
    });
  });

  describe('validateApiResponse', () => {
    it('should return validated data on success', () => {
      const response = { hex: 'ABC123', flight: 'UAL123' };
      const result = validateApiResponse(AircraftSchema, response, '/api/test');
      expect(result).not.toBeNull();
      expect(result?.hex).toBe('ABC123');
    });

    it('should return null on validation failure', () => {
      const response = { invalid: true };
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = validateApiResponse(AircraftSchema, response, '/api/test');
      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});

describe('LocalStorage Helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('readValidatedStorage', () => {
    it('should return parsed and validated data', () => {
      const filters = {
        showMilitary: true,
        showCivil: true,
        showGround: false,
        showAirborne: true,
        minAltitude: 0,
        maxAltitude: 60000,
        showWithSquawk: true,
        showWithoutSquawk: true,
        safetyEventsOnly: false,
        showGA: true,
        showAirliners: true,
      };

      localStorage.setItem('test-filters', JSON.stringify(filters));

      const result = readValidatedStorage('test-filters', TrafficFiltersSchema, {
        showMilitary: false,
        showCivil: false,
        showGround: false,
        showAirborne: false,
        minAltitude: 0,
        maxAltitude: 0,
        showWithSquawk: false,
        showWithoutSquawk: false,
        safetyEventsOnly: false,
        showGA: false,
        showAirliners: false,
      });

      expect(result.showMilitary).toBe(true);
    });

    it('should return default for missing key', () => {
      const defaultValue = {
        showMilitary: false,
        showCivil: false,
        showGround: false,
        showAirborne: false,
        minAltitude: 0,
        maxAltitude: 0,
        showWithSquawk: false,
        showWithoutSquawk: false,
        safetyEventsOnly: false,
        showGA: false,
        showAirliners: false,
      };

      const result = readValidatedStorage('nonexistent', TrafficFiltersSchema, defaultValue);
      expect(result).toEqual(defaultValue);
    });

    it('should return default for invalid JSON', () => {
      localStorage.setItem('invalid-json', 'not json');

      const defaultValue = {
        showMilitary: false,
        showCivil: false,
        showGround: false,
        showAirborne: false,
        minAltitude: 0,
        maxAltitude: 0,
        showWithSquawk: false,
        showWithoutSquawk: false,
        safetyEventsOnly: false,
        showGA: false,
        showAirliners: false,
      };

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = readValidatedStorage('invalid-json', TrafficFiltersSchema, defaultValue);

      expect(result).toEqual(defaultValue);
      consoleSpy.mockRestore();
    });

    it('should return default for invalid data', () => {
      localStorage.setItem('invalid-data', JSON.stringify({ incomplete: true }));

      const defaultValue = {
        showMilitary: false,
        showCivil: false,
        showGround: false,
        showAirborne: false,
        minAltitude: 0,
        maxAltitude: 0,
        showWithSquawk: false,
        showWithoutSquawk: false,
        safetyEventsOnly: false,
        showGA: false,
        showAirliners: false,
      };

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = readValidatedStorage('invalid-data', TrafficFiltersSchema, defaultValue);

      expect(result).toEqual(defaultValue);
      consoleSpy.mockRestore();
    });
  });

  describe('writeValidatedStorage', () => {
    it('should write valid data', () => {
      const filters = {
        showMilitary: true,
        showCivil: true,
        showGround: false,
        showAirborne: true,
        minAltitude: 0,
        maxAltitude: 60000,
        showWithSquawk: true,
        showWithoutSquawk: true,
        safetyEventsOnly: false,
        showGA: true,
        showAirliners: true,
      };

      const result = writeValidatedStorage('test-filters', TrafficFiltersSchema, filters);
      expect(result).toBe(true);

      const stored = localStorage.getItem('test-filters');
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual(filters);
    });

    it('should reject invalid data', () => {
      const invalidFilters = { incomplete: true } as any;

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = writeValidatedStorage('test-filters', TrafficFiltersSchema, invalidFilters);

      expect(result).toBe(false);
      expect(localStorage.getItem('test-filters')).toBeNull();
      consoleSpy.mockRestore();
    });
  });
});
