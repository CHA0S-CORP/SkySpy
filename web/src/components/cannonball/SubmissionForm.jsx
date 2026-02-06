/**
 * SubmissionForm - Community aircraft submission form
 *
 * Allows users to submit aircraft they believe to be law enforcement
 * with supporting evidence.
 */
import React, { useState, useCallback } from 'react';
import PropTypes from 'prop-types';

const EVIDENCE_TYPES = [
  { value: 'flight_pattern', label: 'Observed Flight Pattern' },
  { value: 'callsign', label: 'LE Callsign Observed' },
  { value: 'news', label: 'News Report' },
  { value: 'foia', label: 'FOIA Document' },
  { value: 'registry', label: 'Registry Research' },
  { value: 'livery', label: 'Aircraft Livery/Markings' },
  { value: 'public_records', label: 'Public Records' },
  { value: 'other', label: 'Other' },
];

const AGENCY_TYPES = [
  { value: 'federal', label: 'Federal' },
  { value: 'state', label: 'State' },
  { value: 'local', label: 'Local' },
  { value: 'military', label: 'Military' },
  { value: 'unknown', label: 'Unknown' },
];

const US_STATES = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
  'DC',
];

/**
 * Validate ICAO hex format
 */
function validateIcaoHex(hex) {
  return /^[A-Fa-f0-9]{4,6}$/.test(hex);
}

/**
 * Validate registration format
 */
function validateRegistration(reg) {
  if (!reg) return true; // Optional
  return /^[A-Z0-9-]{2,10}$/i.test(reg);
}

/**
 * SubmissionForm component
 */
export function SubmissionForm({
  onSubmit,
  onCancel,
  initialIcaoHex = '',
  initialRegistration = '',
  loading = false,
  error = null,
}) {
  const [formData, setFormData] = useState({
    icaoHex: initialIcaoHex,
    registration: initialRegistration,
    callsignObserved: '',
    agencyName: '',
    agencyType: 'unknown',
    agencyState: '',
    agencyCity: '',
    evidenceType: 'flight_pattern',
    evidenceDescription: '',
    evidenceUrl: '',
  });

  const [validationErrors, setValidationErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);

  const handleChange = useCallback(
    (e) => {
      const { name, value } = e.target;
      setFormData((prev) => ({ ...prev, [name]: value }));

      // Clear validation error for this field
      if (validationErrors[name]) {
        setValidationErrors((prev) => ({ ...prev, [name]: null }));
      }
    },
    [validationErrors]
  );

  const validate = useCallback(() => {
    const errors = {};

    // Required fields
    if (!formData.icaoHex) {
      errors.icaoHex = 'ICAO hex code is required';
    } else if (!validateIcaoHex(formData.icaoHex)) {
      errors.icaoHex = 'Invalid ICAO hex format (4-6 hex characters)';
    }

    if (!formData.agencyName.trim()) {
      errors.agencyName = 'Agency name is required';
    }

    if (!formData.evidenceDescription.trim()) {
      errors.evidenceDescription = 'Evidence description is required';
    } else if (formData.evidenceDescription.length < 50) {
      errors.evidenceDescription = 'Please provide more detail (at least 50 characters)';
    }

    // Optional field validation
    if (formData.registration && !validateRegistration(formData.registration)) {
      errors.registration = 'Invalid registration format';
    }

    if (formData.evidenceUrl && !formData.evidenceUrl.startsWith('http')) {
      errors.evidenceUrl = 'URL must start with http:// or https://';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }, [formData]);

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();

      if (!validate()) {
        return;
      }

      const result = await onSubmit({
        icaoHex: formData.icaoHex.toUpperCase(),
        registration: formData.registration.toUpperCase(),
        callsignObserved: formData.callsignObserved.toUpperCase(),
        agencyName: formData.agencyName,
        agencyType: formData.agencyType,
        agencyState: formData.agencyState,
        agencyCity: formData.agencyCity,
        evidenceType: formData.evidenceType,
        evidenceDescription: formData.evidenceDescription,
        evidenceUrl: formData.evidenceUrl,
      });

      if (result?.ok) {
        setSubmitted(true);
      }
    },
    [formData, onSubmit, validate]
  );

  if (submitted) {
    return (
      <div className="bg-green-900/30 border border-green-500/50 rounded-lg p-6 text-center">
        <div className="text-green-400 text-lg font-medium mb-2">Submission Received</div>
        <p className="text-gray-400 mb-4">
          Thank you for your submission. Our team will review it and you&apos;ll be notified of the
          outcome.
        </p>
        <button
          type="button"
          onClick={() => {
            setSubmitted(false);
            setFormData({
              icaoHex: '',
              registration: '',
              callsignObserved: '',
              agencyName: '',
              agencyType: 'unknown',
              agencyState: '',
              agencyCity: '',
              evidenceType: 'flight_pattern',
              evidenceDescription: '',
              evidenceUrl: '',
            });
          }}
          className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded"
        >
          Submit Another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-900/30 border border-red-500/50 rounded p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Aircraft Identification */}
      <fieldset className="border border-gray-700 rounded-lg p-4">
        <legend className="text-gray-400 px-2">Aircraft Identification</legend>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* ICAO Hex */}
          <div>
            <label htmlFor="icaoHex" className="block text-sm text-gray-400 mb-1">
              ICAO Hex Code *
            </label>
            <input
              type="text"
              id="icaoHex"
              name="icaoHex"
              value={formData.icaoHex}
              onChange={handleChange}
              placeholder="A12345"
              maxLength={6}
              className={`w-full bg-gray-800 border rounded px-3 py-2 text-white uppercase ${
                validationErrors.icaoHex ? 'border-red-500' : 'border-gray-600'
              }`}
            />
            {validationErrors.icaoHex && (
              <p className="text-red-400 text-xs mt-1">{validationErrors.icaoHex}</p>
            )}
          </div>

          {/* Registration */}
          <div>
            <label htmlFor="registration" className="block text-sm text-gray-400 mb-1">
              Registration (Optional)
            </label>
            <input
              type="text"
              id="registration"
              name="registration"
              value={formData.registration}
              onChange={handleChange}
              placeholder="N12345"
              maxLength={10}
              className={`w-full bg-gray-800 border rounded px-3 py-2 text-white uppercase ${
                validationErrors.registration ? 'border-red-500' : 'border-gray-600'
              }`}
            />
            {validationErrors.registration && (
              <p className="text-red-400 text-xs mt-1">{validationErrors.registration}</p>
            )}
          </div>

          {/* Callsign Observed */}
          <div>
            <label htmlFor="callsignObserved" className="block text-sm text-gray-400 mb-1">
              Callsign Observed (Optional)
            </label>
            <input
              type="text"
              id="callsignObserved"
              name="callsignObserved"
              value={formData.callsignObserved}
              onChange={handleChange}
              placeholder="COPTER1"
              maxLength={10}
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white uppercase"
            />
          </div>
        </div>
      </fieldset>

      {/* Agency Information */}
      <fieldset className="border border-gray-700 rounded-lg p-4">
        <legend className="text-gray-400 px-2">Agency Information</legend>

        <div className="space-y-4">
          {/* Agency Name */}
          <div>
            <label htmlFor="agencyName" className="block text-sm text-gray-400 mb-1">
              Agency Name *
            </label>
            <input
              type="text"
              id="agencyName"
              name="agencyName"
              value={formData.agencyName}
              onChange={handleChange}
              placeholder="e.g., Los Angeles Police Department"
              maxLength={200}
              className={`w-full bg-gray-800 border rounded px-3 py-2 text-white ${
                validationErrors.agencyName ? 'border-red-500' : 'border-gray-600'
              }`}
            />
            {validationErrors.agencyName && (
              <p className="text-red-400 text-xs mt-1">{validationErrors.agencyName}</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Agency Type */}
            <div>
              <label htmlFor="agencyType" className="block text-sm text-gray-400 mb-1">
                Agency Type
              </label>
              <select
                id="agencyType"
                name="agencyType"
                value={formData.agencyType}
                onChange={handleChange}
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
              >
                {AGENCY_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Agency State */}
            <div>
              <label htmlFor="agencyState" className="block text-sm text-gray-400 mb-1">
                State (Optional)
              </label>
              <select
                id="agencyState"
                name="agencyState"
                value={formData.agencyState}
                onChange={handleChange}
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
              >
                <option value="">Select State</option>
                {US_STATES.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            </div>

            {/* Agency City */}
            <div>
              <label htmlFor="agencyCity" className="block text-sm text-gray-400 mb-1">
                City (Optional)
              </label>
              <input
                type="text"
                id="agencyCity"
                name="agencyCity"
                value={formData.agencyCity}
                onChange={handleChange}
                placeholder="e.g., Los Angeles"
                maxLength={100}
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
              />
            </div>
          </div>
        </div>
      </fieldset>

      {/* Evidence */}
      <fieldset className="border border-gray-700 rounded-lg p-4">
        <legend className="text-gray-400 px-2">Evidence</legend>

        <div className="space-y-4">
          {/* Evidence Type */}
          <div>
            <label htmlFor="evidenceType" className="block text-sm text-gray-400 mb-1">
              Evidence Type *
            </label>
            <select
              id="evidenceType"
              name="evidenceType"
              value={formData.evidenceType}
              onChange={handleChange}
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
            >
              {EVIDENCE_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          {/* Evidence Description */}
          <div>
            <label htmlFor="evidenceDescription" className="block text-sm text-gray-400 mb-1">
              Evidence Description *
            </label>
            <textarea
              id="evidenceDescription"
              name="evidenceDescription"
              value={formData.evidenceDescription}
              onChange={handleChange}
              rows={4}
              placeholder="Describe the evidence that supports this aircraft being law enforcement. Be as specific as possible..."
              className={`w-full bg-gray-800 border rounded px-3 py-2 text-white resize-y ${
                validationErrors.evidenceDescription ? 'border-red-500' : 'border-gray-600'
              }`}
            />
            {validationErrors.evidenceDescription && (
              <p className="text-red-400 text-xs mt-1">{validationErrors.evidenceDescription}</p>
            )}
            <p className="text-gray-500 text-xs mt-1">
              {formData.evidenceDescription.length} / 50 characters minimum
            </p>
          </div>

          {/* Evidence URL */}
          <div>
            <label htmlFor="evidenceUrl" className="block text-sm text-gray-400 mb-1">
              Evidence URL (Optional)
            </label>
            <input
              type="url"
              id="evidenceUrl"
              name="evidenceUrl"
              value={formData.evidenceUrl}
              onChange={handleChange}
              placeholder="https://example.com/article"
              className={`w-full bg-gray-800 border rounded px-3 py-2 text-white ${
                validationErrors.evidenceUrl ? 'border-red-500' : 'border-gray-600'
              }`}
            />
            {validationErrors.evidenceUrl && (
              <p className="text-red-400 text-xs mt-1">{validationErrors.evidenceUrl}</p>
            )}
          </div>
        </div>
      </fieldset>

      {/* Submit Buttons */}
      <div className="flex justify-end gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded disabled:opacity-50"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50 flex items-center gap-2"
        >
          {loading ? (
            <>
              <span className="animate-spin">&#9696;</span>
              Submitting...
            </>
          ) : (
            'Submit for Review'
          )}
        </button>
      </div>

      <p className="text-gray-500 text-xs text-center">
        Submissions are reviewed by our team. Providing accurate, verifiable evidence helps build
        your reputation and speeds up the review process
      </p>
    </form>
  );
}

SubmissionForm.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func,
  initialIcaoHex: PropTypes.string,
  initialRegistration: PropTypes.string,
  loading: PropTypes.bool,
  error: PropTypes.string,
};

export default SubmissionForm;
