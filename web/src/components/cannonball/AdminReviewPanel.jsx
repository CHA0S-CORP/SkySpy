/**
 * AdminReviewPanel - Admin panel for reviewing community submissions
 *
 * Provides:
 * - List of pending submissions
 * - Approve/Reject/Mark Duplicate actions
 * - Submission statistics
 */
import React, { useState, useCallback } from 'react';
import PropTypes from 'prop-types';

const STATUS_COLORS = {
  pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50',
  approved: 'bg-green-500/20 text-green-400 border-green-500/50',
  rejected: 'bg-red-500/20 text-red-400 border-red-500/50',
  duplicate: 'bg-gray-500/20 text-gray-400 border-gray-500/50',
  needs_info: 'bg-blue-500/20 text-blue-400 border-blue-500/50',
};

const EVIDENCE_TYPE_LABELS = {
  flight_pattern: 'Flight Pattern',
  callsign: 'Callsign',
  news: 'News Report',
  foia: 'FOIA Document',
  registry: 'Registry Research',
  livery: 'Livery/Markings',
  public_records: 'Public Records',
  other: 'Other',
};

/**
 * SubmissionCard - Individual submission display
 */
function SubmissionCard({
  submission,
  onApprove,
  onReject,
  onMarkDuplicate,
  loading,
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);

  const handleApprove = useCallback(() => {
    onApprove(submission.id);
  }, [onApprove, submission.id]);

  const handleReject = useCallback(() => {
    if (rejectReason.trim()) {
      onReject(submission.id, rejectReason);
      setShowRejectForm(false);
      setRejectReason('');
    }
  }, [onReject, submission.id, rejectReason]);

  const handleMarkDuplicate = useCallback(() => {
    onMarkDuplicate(submission.id);
  }, [onMarkDuplicate, submission.id]);

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-4">
          <div>
            <span className="font-mono text-lg text-white">{submission.icao_hex}</span>
            {submission.registration && (
              <span className="ml-2 text-gray-400">({submission.registration})</span>
            )}
          </div>
          <span className={`px-2 py-0.5 text-xs rounded border ${STATUS_COLORS[submission.status]}`}>
            {submission.status}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowDetails(!showDetails)}
          className="text-gray-400 hover:text-white text-sm"
        >
          {showDetails ? 'Hide Details' : 'Show Details'}
        </button>
      </div>

      {/* Summary */}
      <div className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Agency:</span>
            <span className="ml-2 text-white">{submission.agency_name}</span>
          </div>
          <div>
            <span className="text-gray-500">Evidence:</span>
            <span className="ml-2 text-white">
              {EVIDENCE_TYPE_LABELS[submission.evidence_type] || submission.evidence_type}
            </span>
          </div>
          <div>
            <span className="text-gray-500">Confidence:</span>
            <span className="ml-2 text-white">{(submission.confidence_score * 100).toFixed(0)}%</span>
          </div>
          <div>
            <span className="text-gray-500">Submitted:</span>
            <span className="ml-2 text-white">
              {new Date(submission.submitted_at).toLocaleDateString()}
            </span>
          </div>
        </div>

        {submission.submitted_by_username && (
          <div className="mt-2 text-sm">
            <span className="text-gray-500">By:</span>
            <span className="ml-2 text-blue-400">{submission.submitted_by_username}</span>
          </div>
        )}
      </div>

      {/* Details (expandable) */}
      {showDetails && (
        <div className="px-4 pb-4 border-t border-gray-700 pt-4">
          <div className="space-y-3">
            <div>
              <h4 className="text-sm text-gray-500 mb-1">Evidence Description:</h4>
              <p className="text-gray-300 text-sm whitespace-pre-wrap">
                {submission.evidence_description}
              </p>
            </div>

            {submission.evidence_url && (
              <div>
                <h4 className="text-sm text-gray-500 mb-1">Evidence URL:</h4>
                <a
                  href={submission.evidence_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 text-sm break-all"
                >
                  {submission.evidence_url}
                </a>
              </div>
            )}

            {submission.callsign_observed && (
              <div>
                <span className="text-gray-500 text-sm">Callsign Observed:</span>
                <span className="ml-2 text-white font-mono">{submission.callsign_observed}</span>
              </div>
            )}

            <div className="flex gap-2 text-sm">
              {submission.agency_type && (
                <span className="px-2 py-0.5 bg-gray-700 rounded text-gray-300">
                  {submission.agency_type}
                </span>
              )}
              {submission.agency_state && (
                <span className="px-2 py-0.5 bg-gray-700 rounded text-gray-300">
                  {submission.agency_state}
                </span>
              )}
              {submission.agency_city && (
                <span className="px-2 py-0.5 bg-gray-700 rounded text-gray-300">
                  {submission.agency_city}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      {submission.status === 'pending' && (
        <div className="p-4 bg-gray-900/50 border-t border-gray-700">
          {showRejectForm ? (
            <div className="space-y-3">
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Enter rejection reason..."
                rows={2}
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={!rejectReason.trim() || loading}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded text-sm disabled:opacity-50"
                >
                  Confirm Reject
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowRejectForm(false);
                    setRejectReason('');
                  }}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleApprove}
                disabled={loading}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded text-sm disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => setShowRejectForm(true)}
                disabled={loading}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded text-sm disabled:opacity-50"
              >
                Reject
              </button>
              <button
                type="button"
                onClick={handleMarkDuplicate}
                disabled={loading}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded text-sm disabled:opacity-50"
              >
                Mark Duplicate
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

SubmissionCard.propTypes = {
  submission: PropTypes.object.isRequired,
  onApprove: PropTypes.func.isRequired,
  onReject: PropTypes.func.isRequired,
  onMarkDuplicate: PropTypes.func.isRequired,
  loading: PropTypes.bool,
};

/**
 * AdminReviewPanel component
 */
export function AdminReviewPanel({
  submissions,
  stats,
  loading,
  error,
  onApprove,
  onReject,
  onMarkDuplicate,
  onRefresh,
}) {
  return (
    <div className="space-y-6">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-gray-800 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-white">{stats.total}</div>
            <div className="text-sm text-gray-400">Total</div>
          </div>
          <div className="bg-yellow-900/30 border border-yellow-500/30 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-yellow-400">{stats.pending}</div>
            <div className="text-sm text-gray-400">Pending</div>
          </div>
          <div className="bg-green-900/30 border border-green-500/30 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-green-400">{stats.approved}</div>
            <div className="text-sm text-gray-400">Approved</div>
          </div>
          <div className="bg-red-900/30 border border-red-500/30 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-red-400">{stats.rejected}</div>
            <div className="text-sm text-gray-400">Rejected</div>
          </div>
          <div className="bg-gray-700/30 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-gray-400">{stats.duplicate}</div>
            <div className="text-sm text-gray-400">Duplicates</div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">
          Pending Submissions ({submissions.length})
        </h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded flex items-center gap-2 disabled:opacity-50"
        >
          {loading ? (
            <span className="animate-spin">&#9696;</span>
          ) : (
            <span>&#x21bb;</span>
          )}
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-900/30 border border-red-500/50 rounded p-3 text-red-400">
          {error}
        </div>
      )}

      {/* Submissions List */}
      {submissions.length === 0 ? (
        <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-400">
          {loading ? (
            <span className="animate-pulse">Loading submissions...</span>
          ) : (
            'No pending submissions'
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {submissions.map((submission) => (
            <SubmissionCard
              key={submission.id}
              submission={submission}
              onApprove={onApprove}
              onReject={onReject}
              onMarkDuplicate={onMarkDuplicate}
              loading={loading}
            />
          ))}
        </div>
      )}
    </div>
  );
}

AdminReviewPanel.propTypes = {
  submissions: PropTypes.array.isRequired,
  stats: PropTypes.object,
  loading: PropTypes.bool,
  error: PropTypes.string,
  onApprove: PropTypes.func.isRequired,
  onReject: PropTypes.func.isRequired,
  onMarkDuplicate: PropTypes.func.isRequired,
  onRefresh: PropTypes.func.isRequired,
};

export default AdminReviewPanel;
