import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  USER_KEY,
  getStoredTokens,
  storeTokens,
  clearTokens,
  getStoredUser,
  storeUser,
} from './tokenStorage';

describe('tokenStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.getItem.mockReturnValue(null);
  });

  describe('constants', () => {
    it('should export correct storage keys', () => {
      expect(ACCESS_TOKEN_KEY).toBe('skyspy_access_token');
      expect(REFRESH_TOKEN_KEY).toBe('skyspy_refresh_token');
      expect(USER_KEY).toBe('skyspy_user');
    });
  });

  describe('getStoredTokens', () => {
    it('should return null tokens when nothing is stored', () => {
      localStorage.getItem.mockReturnValue(null);

      const result = getStoredTokens();

      expect(result).toEqual({
        accessToken: null,
        refreshToken: null,
      });
      expect(localStorage.getItem).toHaveBeenCalledWith(ACCESS_TOKEN_KEY);
      expect(localStorage.getItem).toHaveBeenCalledWith(REFRESH_TOKEN_KEY);
    });

    it('should return stored tokens', () => {
      localStorage.getItem.mockImplementation((key) => {
        if (key === ACCESS_TOKEN_KEY) return 'access-token-123';
        if (key === REFRESH_TOKEN_KEY) return 'refresh-token-456';
        return null;
      });

      const result = getStoredTokens();

      expect(result).toEqual({
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-456',
      });
    });

    it('should return partial tokens when only access token exists', () => {
      localStorage.getItem.mockImplementation((key) => {
        if (key === ACCESS_TOKEN_KEY) return 'access-token-only';
        return null;
      });

      const result = getStoredTokens();

      expect(result).toEqual({
        accessToken: 'access-token-only',
        refreshToken: null,
      });
    });

    it('should return partial tokens when only refresh token exists', () => {
      localStorage.getItem.mockImplementation((key) => {
        if (key === REFRESH_TOKEN_KEY) return 'refresh-token-only';
        return null;
      });

      const result = getStoredTokens();

      expect(result).toEqual({
        accessToken: null,
        refreshToken: 'refresh-token-only',
      });
    });
  });

  describe('storeTokens', () => {
    it('should store both tokens', () => {
      storeTokens('new-access-token', 'new-refresh-token');

      expect(localStorage.setItem).toHaveBeenCalledWith(ACCESS_TOKEN_KEY, 'new-access-token');
      expect(localStorage.setItem).toHaveBeenCalledWith(REFRESH_TOKEN_KEY, 'new-refresh-token');
    });

    it('should only store access token when refresh token is null', () => {
      storeTokens('access-only', null);

      expect(localStorage.setItem).toHaveBeenCalledTimes(1);
      expect(localStorage.setItem).toHaveBeenCalledWith(ACCESS_TOKEN_KEY, 'access-only');
    });

    it('should only store refresh token when access token is null', () => {
      storeTokens(null, 'refresh-only');

      expect(localStorage.setItem).toHaveBeenCalledTimes(1);
      expect(localStorage.setItem).toHaveBeenCalledWith(REFRESH_TOKEN_KEY, 'refresh-only');
    });

    it('should not store anything when both tokens are null', () => {
      storeTokens(null, null);

      expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it('should not store anything when both tokens are undefined', () => {
      storeTokens(undefined, undefined);

      expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it('should store empty string tokens', () => {
      storeTokens('', '');

      // Empty strings are falsy, so they won't be stored
      expect(localStorage.setItem).not.toHaveBeenCalled();
    });
  });

  describe('clearTokens', () => {
    it('should remove all auth-related items from localStorage', () => {
      clearTokens();

      expect(localStorage.removeItem).toHaveBeenCalledWith(ACCESS_TOKEN_KEY);
      expect(localStorage.removeItem).toHaveBeenCalledWith(REFRESH_TOKEN_KEY);
      expect(localStorage.removeItem).toHaveBeenCalledWith(USER_KEY);
    });
  });

  describe('getStoredUser', () => {
    it('should return null when no user is stored', () => {
      localStorage.getItem.mockReturnValue(null);

      const result = getStoredUser();

      expect(result).toBeNull();
      expect(localStorage.getItem).toHaveBeenCalledWith(USER_KEY);
    });

    it('should return parsed user object', () => {
      const userData = {
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        displayName: 'Test User',
        permissions: ['view_alerts'],
        roles: ['user'],
      };
      localStorage.getItem.mockReturnValue(JSON.stringify(userData));

      const result = getStoredUser();

      expect(result).toEqual(userData);
    });

    it('should return null on JSON parse error', () => {
      localStorage.getItem.mockReturnValue('invalid-json{');

      const result = getStoredUser();

      expect(result).toBeNull();
    });

    it('should handle empty string stored value', () => {
      localStorage.getItem.mockReturnValue('');

      const result = getStoredUser();

      // Empty string is falsy, returns null without parsing
      expect(result).toBeNull();
    });
  });

  describe('storeUser', () => {
    it('should store user as JSON string', () => {
      const userData = {
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
      };

      storeUser(userData);

      expect(localStorage.setItem).toHaveBeenCalledWith(USER_KEY, JSON.stringify(userData));
    });

    it('should not store null user', () => {
      storeUser(null);

      expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it('should not store undefined user', () => {
      storeUser(undefined);

      expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it('should store user with complex nested data', () => {
      const userData = {
        id: 1,
        username: 'admin',
        permissions: ['view_alerts', 'edit_alerts', 'admin'],
        roles: ['admin', 'user'],
        settings: {
          theme: 'dark',
          notifications: true,
        },
      };

      storeUser(userData);

      expect(localStorage.setItem).toHaveBeenCalledWith(USER_KEY, JSON.stringify(userData));
    });
  });
});
