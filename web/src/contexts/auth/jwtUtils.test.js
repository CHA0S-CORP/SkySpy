import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseJwt, isTokenExpired, getTokenExpirationMs } from './jwtUtils';

describe('jwtUtils', () => {
  // Helper to create a valid JWT token
  const createJwt = (payload) => {
    const header = { alg: 'HS256', typ: 'JWT' };
    const base64Header = btoa(JSON.stringify(header))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    const base64Payload = btoa(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    const signature = 'test-signature';
    return `${base64Header}.${base64Payload}.${signature}`;
  };

  describe('parseJwt', () => {
    it('should parse a valid JWT token', () => {
      const payload = {
        sub: '1234567890',
        name: 'Test User',
        exp: 1700000000,
        iat: 1699900000,
      };
      const token = createJwt(payload);

      const result = parseJwt(token);

      expect(result).toEqual(payload);
    });

    it('should return null for null token', () => {
      expect(parseJwt(null)).toBeNull();
    });

    it('should return null for undefined token', () => {
      expect(parseJwt(undefined)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parseJwt('')).toBeNull();
    });

    it('should return null for non-string token', () => {
      expect(parseJwt(123)).toBeNull();
      expect(parseJwt({})).toBeNull();
      expect(parseJwt([])).toBeNull();
    });

    it('should return null for malformed token (wrong number of parts)', () => {
      expect(parseJwt('only-one-part')).toBeNull();
      expect(parseJwt('two.parts')).toBeNull();
      expect(parseJwt('four.parts.here.now')).toBeNull();
    });

    it('should return null for token with invalid base64 payload', () => {
      expect(parseJwt('header.!!!invalid!!!.signature')).toBeNull();
    });

    it('should return null for token with non-JSON payload', () => {
      const invalidPayload = btoa('not-json-content');
      expect(parseJwt(`header.${invalidPayload}.signature`)).toBeNull();
    });

    it('should handle tokens with URL-safe base64 encoding', () => {
      const payload = { test: 'data with special chars: +/=' };
      const token = createJwt(payload);

      const result = parseJwt(token);

      expect(result).toEqual(payload);
    });

    it('should parse token with complex payload', () => {
      const payload = {
        user_id: 42,
        username: 'admin',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        permissions: ['read', 'write', 'admin'],
        roles: ['administrator'],
      };
      const token = createJwt(payload);

      const result = parseJwt(token);

      expect(result).toEqual(payload);
    });
  });

  describe('isTokenExpired', () => {
    let dateNowSpy;

    beforeEach(() => {
      // Mock Date.now() to a fixed time
      dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000); // Timestamp in ms
    });

    afterEach(() => {
      dateNowSpy.mockRestore();
    });

    it('should return true for null token', () => {
      expect(isTokenExpired(null)).toBe(true);
    });

    it('should return true for undefined token', () => {
      expect(isTokenExpired(undefined)).toBe(true);
    });

    it('should return true for empty string token', () => {
      expect(isTokenExpired('')).toBe(true);
    });

    it('should return true for token without exp claim', () => {
      const token = createJwt({ sub: 'user123' }); // No exp
      expect(isTokenExpired(token)).toBe(true);
    });

    it('should return true for expired token', () => {
      // Token expired 1 hour ago
      const token = createJwt({ exp: 1699996400 }); // exp is 3600 seconds before Date.now
      expect(isTokenExpired(token)).toBe(true);
    });

    it('should return true for token expiring within default buffer (30 seconds)', () => {
      // Token expires in 20 seconds (within 30s buffer)
      const token = createJwt({ exp: 1700000020 }); // 20 seconds from now
      expect(isTokenExpired(token)).toBe(true);
    });

    it('should return false for token expiring after buffer', () => {
      // Token expires in 1 hour
      const token = createJwt({ exp: 1700003600 }); // 3600 seconds from now
      expect(isTokenExpired(token)).toBe(false);
    });

    it('should return false for token expiring exactly at buffer edge (31 seconds)', () => {
      // Token expires in 31 seconds (just past 30s buffer)
      const token = createJwt({ exp: 1700000031 });
      expect(isTokenExpired(token)).toBe(false);
    });

    it('should respect custom buffer seconds', () => {
      // Token expires in 50 seconds
      const token = createJwt({ exp: 1700000050 });

      // With 30s buffer: not expired
      expect(isTokenExpired(token, 30)).toBe(false);

      // With 60s buffer: expired
      expect(isTokenExpired(token, 60)).toBe(true);
    });

    it('should return true for malformed token', () => {
      expect(isTokenExpired('invalid.token.here')).toBe(true);
    });

    it('should handle zero buffer', () => {
      // Token expires in 1 second
      const token = createJwt({ exp: 1700000001 });
      expect(isTokenExpired(token, 0)).toBe(false);
    });
  });

  describe('getTokenExpirationMs', () => {
    it('should return null for null token', () => {
      expect(getTokenExpirationMs(null)).toBeNull();
    });

    it('should return null for undefined token', () => {
      expect(getTokenExpirationMs(undefined)).toBeNull();
    });

    it('should return null for empty string token', () => {
      expect(getTokenExpirationMs('')).toBeNull();
    });

    it('should return null for token without exp claim', () => {
      const token = createJwt({ sub: 'user123' });
      expect(getTokenExpirationMs(token)).toBeNull();
    });

    it('should return expiration time in milliseconds', () => {
      const expSeconds = 1700000000;
      const token = createJwt({ exp: expSeconds });

      const result = getTokenExpirationMs(token);

      expect(result).toBe(expSeconds * 1000);
    });

    it('should return correct ms for various exp values', () => {
      const testCases = [
        // Note: exp: 0 would be falsy and return null based on implementation
        { exp: 1, expected: 1000 },
        { exp: 1234567890, expected: 1234567890000 },
        { exp: 2000000000, expected: 2000000000000 },
      ];

      testCases.forEach(({ exp, expected }) => {
        const token = createJwt({ exp });
        expect(getTokenExpirationMs(token)).toBe(expected);
      });
    });

    it('should return null for exp value of 0', () => {
      // Implementation returns null when exp is 0 (falsy value check)
      const token = createJwt({ exp: 0 });
      expect(getTokenExpirationMs(token)).toBeNull();
    });

    it('should return null for malformed token', () => {
      expect(getTokenExpirationMs('invalid.token.here')).toBeNull();
    });
  });
});
