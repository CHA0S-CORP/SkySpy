import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useCommunitySubmissions } from './useCommunitySubmissions';

// Mock useApi hook
vi.mock('./useApi', () => ({
  useApi: vi.fn(() => ({
    get: vi.fn(),
    authFetch: vi.fn(),
  })),
}));

import { useApi } from './useApi';

describe('useCommunitySubmissions', () => {
  let mockGet;
  let mockAuthFetch;

  beforeEach(() => {
    mockGet = vi.fn();
    mockAuthFetch = vi.fn();
    useApi.mockReturnValue({ get: mockGet, authFetch: mockAuthFetch });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have empty submissions array', () => {
      const { result } = renderHook(() => useCommunitySubmissions());

      expect(result.current.submissions).toEqual([]);
      expect(result.current.pendingSubmissions).toEqual([]);
      expect(result.current.stats).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should accept isAdmin option', () => {
      const { result } = renderHook(() => useCommunitySubmissions({ isAdmin: true }));

      expect(result.current.submissions).toEqual([]);
    });
  });

  describe('createSubmission', () => {
    it('should create a submission successfully', async () => {
      const mockSubmission = {
        id: 1,
        icao_hex: 'A12345',
        agency_name: 'FBI',
        status: 'pending',
      };

      mockAuthFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSubmission),
      });

      const { result } = renderHook(() => useCommunitySubmissions());

      let response;
      await act(async () => {
        response = await result.current.createSubmission({
          icaoHex: 'A12345',
          agencyName: 'FBI',
          evidenceType: 'flight_pattern',
          evidenceDescription: 'Observed circling pattern over residential area',
        });
      });

      expect(response.ok).toBe(true);
      expect(response.submission).toEqual(mockSubmission);
      expect(result.current.submissions).toContainEqual(mockSubmission);
    });

    it('should handle submission error', async () => {
      mockAuthFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Invalid ICAO hex' }),
      });

      const { result } = renderHook(() => useCommunitySubmissions());

      let response;
      await act(async () => {
        response = await result.current.createSubmission({
          icaoHex: 'INVALID',
          agencyName: 'FBI',
          evidenceType: 'news',
          evidenceDescription: 'Test submission',
        });
      });

      expect(response.ok).toBe(false);
      expect(response.error).toBe('Invalid ICAO hex');
      expect(result.current.error).toBe('Invalid ICAO hex');
    });

    it('should set loading state during submission', async () => {
      let resolvePromise;
      mockAuthFetch.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePromise = () =>
              resolve({
                ok: true,
                json: () => Promise.resolve({ id: 1 }),
              });
          })
      );

      const { result } = renderHook(() => useCommunitySubmissions());

      let promise;
      act(() => {
        promise = result.current.createSubmission({
          icaoHex: 'A12345',
          agencyName: 'FBI',
          evidenceType: 'news',
          evidenceDescription: 'Test',
        });
      });

      expect(result.current.loading).toBe(true);

      await act(async () => {
        resolvePromise();
        await promise;
      });

      expect(result.current.loading).toBe(false);
    });

    it('should send all fields in correct format', async () => {
      mockAuthFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      });

      const { result } = renderHook(() => useCommunitySubmissions());

      await act(async () => {
        await result.current.createSubmission({
          icaoHex: 'A12345',
          agencyName: 'LAPD',
          evidenceType: 'news',
          evidenceDescription: 'News article confirmed',
          registration: 'N12345',
          callsignObserved: 'LAPD1',
          agencyType: 'local',
          agencyState: 'CA',
          agencyCity: 'Los Angeles',
          evidenceUrl: 'https://example.com',
          additionalEvidence: [{ url: 'https://example.com/photo' }],
        });
      });

      expect(mockAuthFetch).toHaveBeenCalledWith(
        '/api/v1/cannonball/submissions/',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(String),
        })
      );

      const callBody = JSON.parse(mockAuthFetch.mock.calls[0][1].body);
      expect(callBody.icao_hex).toBe('A12345');
      expect(callBody.agency_name).toBe('LAPD');
      expect(callBody.evidence_type).toBe('news');
      expect(callBody.registration).toBe('N12345');
      expect(callBody.callsign_observed).toBe('LAPD1');
      expect(callBody.agency_type).toBe('local');
      expect(callBody.agency_state).toBe('CA');
      expect(callBody.agency_city).toBe('Los Angeles');
    });
  });

  describe('fetchUserSubmissions', () => {
    it('should fetch user submissions successfully', async () => {
      const mockSubmissions = {
        submissions: [
          { id: 1, icao_hex: 'A12345' },
          { id: 2, icao_hex: 'B67890' },
        ],
      };

      mockGet.mockResolvedValue(mockSubmissions);

      const { result } = renderHook(() => useCommunitySubmissions());

      await act(async () => {
        await result.current.fetchUserSubmissions();
      });

      expect(result.current.submissions).toEqual(mockSubmissions.submissions);
      expect(mockGet).toHaveBeenCalledWith('/api/v1/cannonball/submissions/');
    });

    it('should handle fetch error', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useCommunitySubmissions());

      await act(async () => {
        await result.current.fetchUserSubmissions();
      });

      expect(result.current.error).toBe('Network error');
    });
  });

  describe('fetchPendingSubmissions (admin only)', () => {
    it('should fetch pending submissions for admin', async () => {
      const mockPending = {
        submissions: [{ id: 1, icao_hex: 'A12345', status: 'pending' }],
      };

      mockGet.mockResolvedValue(mockPending);

      const { result } = renderHook(() => useCommunitySubmissions({ isAdmin: true }));

      await act(async () => {
        await result.current.fetchPendingSubmissions();
      });

      expect(result.current.pendingSubmissions).toEqual(mockPending.submissions);
      expect(mockGet).toHaveBeenCalledWith('/api/v1/cannonball/submissions/pending/');
    });

    it('should reject non-admin access', async () => {
      const { result } = renderHook(() => useCommunitySubmissions({ isAdmin: false }));

      let response;
      await act(async () => {
        response = await result.current.fetchPendingSubmissions();
      });

      expect(response.error).toBe('Admin access required');
      expect(mockGet).not.toHaveBeenCalled();
    });
  });

  describe('approveSubmission (admin only)', () => {
    it('should approve submission successfully', async () => {
      const mockUpdated = { id: 1, status: 'approved' };

      mockAuthFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockUpdated),
      });

      const { result } = renderHook(() => useCommunitySubmissions({ isAdmin: true }));

      // Set up initial pending submissions
      act(() => {
        result.current.pendingSubmissions.push({ id: 1, status: 'pending' });
      });

      let response;
      await act(async () => {
        response = await result.current.approveSubmission(1, 'Verified');
      });

      expect(response.ok).toBe(true);
      expect(mockAuthFetch).toHaveBeenCalledWith(
        '/api/v1/cannonball/submissions/1/approve/',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ notes: 'Verified' }),
        })
      );
    });

    it('should reject non-admin access', async () => {
      const { result } = renderHook(() => useCommunitySubmissions({ isAdmin: false }));

      let response;
      await act(async () => {
        response = await result.current.approveSubmission(1);
      });

      expect(response.ok).toBe(false);
      expect(response.error).toBe('Admin access required');
    });
  });

  describe('rejectSubmission (admin only)', () => {
    it('should reject submission successfully', async () => {
      const mockUpdated = { id: 1, status: 'rejected' };

      mockAuthFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockUpdated),
      });

      const { result } = renderHook(() => useCommunitySubmissions({ isAdmin: true }));

      let response;
      await act(async () => {
        response = await result.current.rejectSubmission(1, 'Insufficient evidence');
      });

      expect(response.ok).toBe(true);
      expect(mockAuthFetch).toHaveBeenCalledWith(
        '/api/v1/cannonball/submissions/1/reject/',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ reason: 'Insufficient evidence' }),
        })
      );
    });

    it('should require rejection reason', async () => {
      const { result } = renderHook(() => useCommunitySubmissions({ isAdmin: true }));

      let response;
      await act(async () => {
        response = await result.current.rejectSubmission(1, '');
      });

      expect(response.ok).toBe(false);
      expect(response.error).toBe('Rejection reason is required');
    });

    it('should reject non-admin access', async () => {
      const { result } = renderHook(() => useCommunitySubmissions({ isAdmin: false }));

      let response;
      await act(async () => {
        response = await result.current.rejectSubmission(1, 'Reason');
      });

      expect(response.ok).toBe(false);
      expect(response.error).toBe('Admin access required');
    });
  });

  describe('markDuplicate (admin only)', () => {
    it('should mark submission as duplicate', async () => {
      const mockUpdated = { id: 1, status: 'duplicate' };

      mockAuthFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockUpdated),
      });

      const { result } = renderHook(() => useCommunitySubmissions({ isAdmin: true }));

      let response;
      await act(async () => {
        response = await result.current.markDuplicate(1);
      });

      expect(response.ok).toBe(true);
      expect(mockAuthFetch).toHaveBeenCalledWith(
        '/api/v1/cannonball/submissions/1/mark_duplicate/',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should reject non-admin access', async () => {
      const { result } = renderHook(() => useCommunitySubmissions({ isAdmin: false }));

      let response;
      await act(async () => {
        response = await result.current.markDuplicate(1);
      });

      expect(response.ok).toBe(false);
      expect(response.error).toBe('Admin access required');
    });
  });

  describe('fetchStats (admin only)', () => {
    it('should fetch submission stats', async () => {
      const mockStats = {
        total: 100,
        pending: 10,
        approved: 80,
        rejected: 5,
        duplicate: 5,
      };

      mockGet.mockResolvedValue(mockStats);

      const { result } = renderHook(() => useCommunitySubmissions({ isAdmin: true }));

      await act(async () => {
        await result.current.fetchStats();
      });

      expect(result.current.stats).toEqual(mockStats);
      expect(mockGet).toHaveBeenCalledWith('/api/v1/cannonball/submissions/stats/');
    });

    it('should reject non-admin access', async () => {
      const { result } = renderHook(() => useCommunitySubmissions({ isAdmin: false }));

      let response;
      await act(async () => {
        response = await result.current.fetchStats();
      });

      expect(response.error).toBe('Admin access required');
    });
  });

  describe('getSubmission', () => {
    it('should fetch individual submission', async () => {
      const mockSubmission = { id: 1, icao_hex: 'A12345' };

      mockGet.mockResolvedValue(mockSubmission);

      const { result } = renderHook(() => useCommunitySubmissions());

      let response;
      await act(async () => {
        response = await result.current.getSubmission(1);
      });

      expect(response).toEqual(mockSubmission);
      expect(mockGet).toHaveBeenCalledWith('/api/v1/cannonball/submissions/1/');
    });

    it('should handle fetch error', async () => {
      mockGet.mockRejectedValue(new Error('Not found'));

      const { result } = renderHook(() => useCommunitySubmissions());

      let response;
      await act(async () => {
        response = await result.current.getSubmission(999);
      });

      expect(response.error).toBe('Not found');
    });
  });

  describe('clearError', () => {
    it('should clear error state', async () => {
      mockAuthFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Test error' }),
      });

      const { result } = renderHook(() => useCommunitySubmissions());

      await act(async () => {
        await result.current.createSubmission({
          icaoHex: 'A12345',
          agencyName: 'Test',
          evidenceType: 'news',
          evidenceDescription: 'Test',
        });
      });

      expect(result.current.error).toBe('Test error');

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });
  });
});
