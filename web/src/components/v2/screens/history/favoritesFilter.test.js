import { describe, it, expect } from 'vitest';
import { selectSessions } from './historyModel';

const sessions = [
  { id: 1, icao_hex: 'abc123', callsign: 'AAL1', last_seen: '2024-01-01T10:00:00Z' },
  { id: 2, icao_hex: 'def456', callsign: 'UAL2', last_seen: '2024-01-01T11:00:00Z' },
  { id: 3, icao_hex: 'ghi789', callsign: 'DAL3', last_seen: '2024-01-01T12:00:00Z' },
];

describe('selectSessions — favorites filter', () => {
  it('returns all sessions when fav is off', () => {
    const out = selectSessions(sessions, { fav: false }, undefined, new Set(['ABC123']));
    expect(out).toHaveLength(3);
  });

  it('keeps only favorited hexes when fav is on (case-insensitive)', () => {
    const favs = new Set(['ABC123', 'GHI789']);
    const out = selectSessions(sessions, { fav: true }, undefined, favs);
    expect(out.map((s) => s.icao_hex).sort()).toEqual(['abc123', 'ghi789']);
  });

  it('returns nothing when fav is on but there are no favorites', () => {
    const out = selectSessions(sessions, { fav: true }, undefined, new Set());
    expect(out).toHaveLength(0);
  });

  it('is a no-op when fav is on but favoriteHexes is missing (safe default)', () => {
    const out = selectSessions(sessions, { fav: true }, undefined, undefined);
    expect(out).toHaveLength(3);
  });
});
