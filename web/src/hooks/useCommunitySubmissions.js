/**
 * useCommunitySubmissions - Hook for community aircraft submissions
 *
 * Provides:
 * - Submission creation
 * - User submissions list
 * - Admin review actions (approve/reject)
 * - Submission statistics
 */
import { useState, useCallback } from 'react';
import { useApi } from './useApi';

const SUBMISSIONS_ENDPOINT = '/api/v1/cannonball/submissions/';

/**
 * Community submissions hook
 *
 * @param {Object} options - Configuration options
 * @param {boolean} options.isAdmin - Whether user has admin privileges
 * @returns {Object} Submissions state and methods
 */
export function useCommunitySubmissions({ isAdmin = false } = {}) {
  const { get, authFetch } = useApi();

  const [submissions, setSubmissions] = useState([]);
  const [pendingSubmissions, setPendingSubmissions] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Create a new submission
   */
  const createSubmission = useCallback(
    async ({
      icaoHex,
      agencyName,
      evidenceType,
      evidenceDescription,
      registration = '',
      callsignObserved = '',
      agencyType = 'unknown',
      agencyState = '',
      agencyCity = '',
      evidenceUrl = '',
      additionalEvidence = [],
    }) => {
      setLoading(true);
      setError(null);

      try {
        const response = await authFetch(SUBMISSIONS_ENDPOINT, {
          method: 'POST',
          body: JSON.stringify({
            icao_hex: icaoHex,
            agency_name: agencyName,
            evidence_type: evidenceType,
            evidence_description: evidenceDescription,
            registration,
            callsign_observed: callsignObserved,
            agency_type: agencyType,
            agency_state: agencyState,
            agency_city: agencyCity,
            evidence_url: evidenceUrl,
            additional_evidence: additionalEvidence,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to create submission');
        }

        const submission = await response.json();
        setSubmissions((prev) => [submission, ...prev]);
        return { ok: true, submission };
      } catch (err) {
        setError(err.message);
        return { ok: false, error: err.message };
      } finally {
        setLoading(false);
      }
    },
    [authFetch]
  );

  /**
   * Fetch user's submissions
   */
  const fetchUserSubmissions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await get(SUBMISSIONS_ENDPOINT);
      setSubmissions(data?.submissions || []);
      return data;
    } catch (err) {
      setError(err.message);
      return { error: err.message };
    } finally {
      setLoading(false);
    }
  }, [get]);

  /**
   * Fetch pending submissions (admin only)
   */
  const fetchPendingSubmissions = useCallback(async () => {
    if (!isAdmin) {
      return { error: 'Admin access required' };
    }

    setLoading(true);
    setError(null);

    try {
      const data = await get(`${SUBMISSIONS_ENDPOINT}pending/`);
      setPendingSubmissions(data?.submissions || []);
      return data;
    } catch (err) {
      setError(err.message);
      return { error: err.message };
    } finally {
      setLoading(false);
    }
  }, [get, isAdmin]);

  /**
   * Approve a submission (admin only)
   */
  const approveSubmission = useCallback(
    async (submissionId, notes = '') => {
      if (!isAdmin) {
        return { ok: false, error: 'Admin access required' };
      }

      setLoading(true);
      setError(null);

      try {
        const response = await authFetch(`${SUBMISSIONS_ENDPOINT}${submissionId}/approve/`, {
          method: 'POST',
          body: JSON.stringify({ notes }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to approve submission');
        }

        const updated = await response.json();

        // Update local state
        setPendingSubmissions((prev) => prev.filter((s) => s.id !== submissionId));

        return { ok: true, submission: updated };
      } catch (err) {
        setError(err.message);
        return { ok: false, error: err.message };
      } finally {
        setLoading(false);
      }
    },
    [authFetch, isAdmin]
  );

  /**
   * Reject a submission (admin only)
   */
  const rejectSubmission = useCallback(
    async (submissionId, reason) => {
      if (!isAdmin) {
        return { ok: false, error: 'Admin access required' };
      }

      if (!reason) {
        return { ok: false, error: 'Rejection reason is required' };
      }

      setLoading(true);
      setError(null);

      try {
        const response = await authFetch(`${SUBMISSIONS_ENDPOINT}${submissionId}/reject/`, {
          method: 'POST',
          body: JSON.stringify({ reason }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to reject submission');
        }

        const updated = await response.json();

        // Update local state
        setPendingSubmissions((prev) => prev.filter((s) => s.id !== submissionId));

        return { ok: true, submission: updated };
      } catch (err) {
        setError(err.message);
        return { ok: false, error: err.message };
      } finally {
        setLoading(false);
      }
    },
    [authFetch, isAdmin]
  );

  /**
   * Mark submission as duplicate (admin only)
   */
  const markDuplicate = useCallback(
    async (submissionId) => {
      if (!isAdmin) {
        return { ok: false, error: 'Admin access required' };
      }

      setLoading(true);
      setError(null);

      try {
        const response = await authFetch(`${SUBMISSIONS_ENDPOINT}${submissionId}/mark_duplicate/`, {
          method: 'POST',
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to mark as duplicate');
        }

        const updated = await response.json();

        // Update local state
        setPendingSubmissions((prev) => prev.filter((s) => s.id !== submissionId));

        return { ok: true, submission: updated };
      } catch (err) {
        setError(err.message);
        return { ok: false, error: err.message };
      } finally {
        setLoading(false);
      }
    },
    [authFetch, isAdmin]
  );

  /**
   * Fetch submission statistics (admin only)
   */
  const fetchStats = useCallback(async () => {
    if (!isAdmin) {
      return { error: 'Admin access required' };
    }

    try {
      const data = await get(`${SUBMISSIONS_ENDPOINT}stats/`);
      setStats(data);
      return data;
    } catch (err) {
      setError(err.message);
      return { error: err.message };
    }
  }, [get, isAdmin]);

  /**
   * Get submission by ID
   */
  const getSubmission = useCallback(
    async (submissionId) => {
      try {
        const data = await get(`${SUBMISSIONS_ENDPOINT}${submissionId}/`);
        return data;
      } catch (err) {
        return { error: err.message };
      }
    },
    [get]
  );

  return {
    // State
    submissions,
    pendingSubmissions,
    stats,
    loading,
    error,

    // Methods
    createSubmission,
    fetchUserSubmissions,
    fetchPendingSubmissions,
    approveSubmission,
    rejectSubmission,
    markDuplicate,
    fetchStats,
    getSubmission,

    // Helpers
    clearError: () => setError(null),
  };
}

export default useCommunitySubmissions;
