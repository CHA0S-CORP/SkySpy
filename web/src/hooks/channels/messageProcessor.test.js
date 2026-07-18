import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  processAircraftSnapshot,
  processAircraftUpdate,
  unregisterAircraftBatch,
} from './messageProcessor';

describe('messageProcessor', () => {
  let aircraft;
  let setAircraft;
  let setStats;

  beforeEach(() => {
    vi.useFakeTimers();
    aircraft = {};
    setAircraft = vi.fn((updater) => {
      aircraft = typeof updater === 'function' ? updater(aircraft) : updater;
    });
    setStats = vi.fn();
  });

  afterEach(() => {
    // Reset module-level batch state between tests
    unregisterAircraftBatch();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('processAircraftUpdate delta merging', () => {
    it('should not clobber military/emergency/dbFlags on a position-only delta', () => {
      // Full snapshot: military aircraft squawking 7700
      processAircraftSnapshot(
        {
          data: {
            aircraft: [
              {
                hex: 'ae1234',
                lat: 40.0,
                lon: -74.0,
                track: 90,
                gs: 450,
                alt_baro: 30000,
                dbFlags: 1,
                squawk: '7700',
                emergency: 'general',
                on_ground: false,
              },
            ],
          },
        },
        setAircraft,
        setStats
      );

      expect(aircraft.AE1234.military).toBe(true);
      expect(aircraft.AE1234.emergency).toBe(true);
      expect(aircraft.AE1234.dbFlags).toBe(1);

      // Backend delta 'updated' entries contain only the CHANGED fields
      processAircraftUpdate(
        {
          data: {
            type: 'delta',
            updated: [{ hex: 'ae1234', lat: 40.1, lon: -74.1, track: 92 }],
          },
        },
        setAircraft
      );
      vi.advanceTimersByTime(50); // flush the batch

      expect(aircraft.AE1234.lat).toBe(40.1);
      expect(aircraft.AE1234.lon).toBe(-74.1);
      expect(aircraft.AE1234.track).toBe(92);
      // Previously-known status fields must survive the partial update
      expect(aircraft.AE1234.military).toBe(true);
      expect(aircraft.AE1234.emergency).toBe(true);
      expect(aircraft.AE1234.dbFlags).toBe(1);
      expect(aircraft.AE1234.gs).toBe(450);
      expect(aircraft.AE1234.alt_baro).toBe(30000);
    });

    it('should derive emergency from an emergency squawk in a delta', () => {
      processAircraftSnapshot(
        { data: { aircraft: [{ hex: 'abc123', lat: 40, lon: -74, squawk: '1200' }] } },
        setAircraft,
        setStats
      );
      expect(aircraft.ABC123.emergency).toBe(false);

      processAircraftUpdate(
        { data: { type: 'delta', updated: [{ hex: 'abc123', squawk: '7700' }] } },
        setAircraft
      );
      vi.advanceTimersByTime(50);

      expect(aircraft.ABC123.emergency).toBe(true);
    });

    it('should clear emergency when a delta carries a normal squawk', () => {
      processAircraftSnapshot(
        { data: { aircraft: [{ hex: 'abc123', lat: 40, lon: -74, squawk: '7700' }] } },
        setAircraft,
        setStats
      );
      expect(aircraft.ABC123.emergency).toBe(true);

      processAircraftUpdate(
        { data: { type: 'delta', updated: [{ hex: 'abc123', squawk: '1200' }] } },
        setAircraft
      );
      vi.advanceTimersByTime(50);

      expect(aircraft.ABC123.emergency).toBe(false);
    });

    it('should normalize added entries with full-record defaults', () => {
      processAircraftUpdate(
        { data: { type: 'delta', added: [{ hex: 'def456', lat: 41, lon: -73 }] } },
        setAircraft
      );
      vi.advanceTimersByTime(50);

      // 'added' entries are complete records: absent flags mean not set
      expect(aircraft.DEF456.military).toBe(false);
      expect(aircraft.DEF456.emergency).toBe(false);
      expect(aircraft.DEF456.dbFlags).toBe(0);
      expect(aircraft.DEF456.on_ground).toBe(false);
    });
  });
});
