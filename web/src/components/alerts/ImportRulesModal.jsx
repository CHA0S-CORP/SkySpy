import React from 'react';
import { X, FileJson, AlertTriangle, CheckCircle } from 'lucide-react';
import { PRIORITY_CONFIG } from './alertConstants';

export function ImportRulesModal({
  importData,
  existingRules,
  importOption,
  onImportOptionChange,
  importing,
  onImport,
  onClose
}) {
  if (!importData) return null;

  const hasDuplicates = existingRules?.some(existing =>
    importData.rules.some(r => r.name.toLowerCase() === existing.name.toLowerCase())
  );

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal import-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-modal-title"
      >
        <div className="modal-header">
          <h3 id="import-modal-title">Import Alert Rules</h3>
          <button
            onClick={onClose}
            aria-label="Close import dialog"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="modal-content">
          <div className="import-file-info">
            <FileJson size={20} />
            <span>{importData.filename}</span>
          </div>

          {/* Validation Errors */}
          {importData.errors.length > 0 && (
            <div
              className={`import-validation ${importData.valid ? 'warnings' : 'errors'}`}
              role={importData.valid ? 'status' : 'alert'}
              aria-live="polite"
            >
              <div className="validation-header">
                <AlertTriangle size={16} aria-hidden="true" />
                <span>{importData.valid ? 'Warnings' : 'Validation Errors'}</span>
              </div>
              <ul className="validation-list" aria-label={importData.valid ? 'Import warnings' : 'Import errors'}>
                {importData.errors.slice(0, 10).map((error, i) => (
                  <li key={i}>{error}</li>
                ))}
                {importData.errors.length > 10 && (
                  <li className="more-errors" aria-label={`${importData.errors.length - 10} additional errors not shown`}>
                    ... and {importData.errors.length - 10} more
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* Rules Preview */}
          {importData.valid && importData.rules.length > 0 && (
            <>
              <div className="import-preview" aria-live="polite">
                <div className="preview-header">
                  <CheckCircle size={16} aria-hidden="true" />
                  <span>{importData.rules.length} rule{importData.rules.length !== 1 ? 's' : ''} ready to import</span>
                </div>
                <div className="preview-list" role="list" aria-label="Rules to import">
                  {importData.rules.map((rule, i) => {
                    const isDuplicate = existingRules?.some(
                      r => r.name.toLowerCase() === rule.name.toLowerCase()
                    );
                    const priority = rule.priority || 'info';
                    const priorityConfig = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.info;
                    const PriorityIcon = priorityConfig.Icon;

                    return (
                      <div
                        key={i}
                        className={`preview-rule ${isDuplicate ? 'duplicate' : ''}`}
                        role="listitem"
                        aria-label={`${rule.name}${isDuplicate ? ' (duplicate)' : ''}`}
                      >
                        <span className={`rule-priority ${priority}`}>
                          <PriorityIcon size={12} aria-hidden="true" className="priority-icon" />
                          {priority}
                        </span>
                        <span className="preview-rule-name">{rule.name}</span>
                        {isDuplicate && (
                          <span className="duplicate-badge" aria-label="This rule already exists">
                            Duplicate
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Duplicate handling options */}
              {hasDuplicates && (
                <fieldset className="import-options">
                  <legend className="import-option-label">Handle duplicates:</legend>
                  <div className="import-option-buttons" role="radiogroup" aria-label="Duplicate handling options">
                    <button
                      className={`import-option-btn ${importOption === 'skip' ? 'active' : ''}`}
                      onClick={() => onImportOptionChange('skip')}
                      role="radio"
                      aria-checked={importOption === 'skip'}
                    >
                      Skip duplicates
                    </button>
                    <button
                      className={`import-option-btn ${importOption === 'replace' ? 'active' : ''}`}
                      onClick={() => onImportOptionChange('replace')}
                      role="radio"
                      aria-checked={importOption === 'replace'}
                    >
                      Replace duplicates
                    </button>
                  </div>
                </fieldset>
              )}
            </>
          )}

          {/* Actions */}
          <div className="import-actions" role="group" aria-label="Import actions">
            <button
              className="btn-secondary"
              onClick={onClose}
              aria-label="Cancel import"
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={onImport}
              disabled={!importData.valid || importing}
              aria-busy={importing}
              aria-label={importing ? 'Importing rules, please wait' : `Import ${importData.rules.length} rules`}
            >
              {importing ? 'Importing...' : `Import ${importData.rules.length} Rule${importData.rules.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
