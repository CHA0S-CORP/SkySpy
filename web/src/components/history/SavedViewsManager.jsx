import { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';

/**
 * SavedViewsManager - Save/load filter combinations
 */
export function SavedViewsManager({
  savedViews = [],
  currentFilters,
  onSave,
  onLoad,
  onDelete,
  className = '',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isNaming, setIsNaming] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        setIsNaming(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus input when naming
  useEffect(() => {
    if (isNaming && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isNaming]);

  const handleSave = () => {
    if (newViewName.trim()) {
      onSave?.({
        id: Date.now().toString(),
        name: newViewName.trim(),
        filters: currentFilters,
        createdAt: new Date().toISOString(),
      });
      setNewViewName('');
      setIsNaming(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setIsNaming(false);
      setNewViewName('');
    }
  };

  return (
    <div ref={containerRef} className={`saved-views-manager ${className}`}>
      <button
        className="saved-views-manager__trigger"
        onClick={() => setIsOpen(!isOpen)}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="2" y="2" width="10" height="10" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5 6L7 8L9 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Views</span>
        {savedViews.length > 0 && (
          <span
            style={{
              background: 'var(--accent-cyan)',
              color: 'var(--bg-dark)',
              padding: '1px 5px',
              borderRadius: '10px',
              fontSize: '9px',
              fontWeight: 600,
            }}
          >
            {savedViews.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="saved-views-manager__dropdown">
          {/* Saved views list */}
          {savedViews.length === 0 ? (
            <div
              style={{
                padding: '12px',
                textAlign: 'center',
                color: 'var(--text-dim)',
                fontSize: '12px',
              }}
            >
              No saved views yet
            </div>
          ) : (
            savedViews.map((view) => (
              <div
                key={view.id}
                className="saved-views-manager__item"
                onClick={() => {
                  onLoad?.(view);
                  setIsOpen(false);
                }}
              >
                <span className="saved-views-manager__item-name">{view.name}</span>
                <button
                  className="saved-views-manager__item-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete?.(view.id);
                  }}
                  title="Delete view"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M3 3L9 9M9 3L3 9"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            ))
          )}

          {/* Add new view */}
          {isNaming ? (
            <div
              style={{
                display: 'flex',
                gap: '8px',
                padding: '8px 12px',
                borderTop: '1px solid var(--border)',
              }}
            >
              <input
                ref={inputRef}
                type="text"
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="View name..."
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  background: 'var(--bg-hover)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  color: 'var(--text-primary)',
                  fontSize: '12px',
                  outline: 'none',
                }}
              />
              <button
                onClick={handleSave}
                disabled={!newViewName.trim()}
                style={{
                  padding: '4px 10px',
                  background: newViewName.trim() ? 'var(--accent-cyan)' : 'var(--bg-hover)',
                  border: 'none',
                  borderRadius: '4px',
                  color: newViewName.trim() ? 'var(--bg-dark)' : 'var(--text-dim)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: newViewName.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                Save
              </button>
            </div>
          ) : (
            <div
              className="saved-views-manager__add"
              onClick={() => setIsNaming(true)}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M6 2V10M2 6H10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <span>Save current view</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

SavedViewsManager.propTypes = {
  savedViews: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      name: PropTypes.string.isRequired,
      filters: PropTypes.object,
      createdAt: PropTypes.string,
    })
  ),
  currentFilters: PropTypes.object,
  onSave: PropTypes.func,
  onLoad: PropTypes.func,
  onDelete: PropTypes.func,
  className: PropTypes.string,
};

export default SavedViewsManager;
