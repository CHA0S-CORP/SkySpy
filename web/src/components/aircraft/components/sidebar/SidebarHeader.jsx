import React from 'react';
import { X, Share2, Check } from 'lucide-react';

/**
 * SidebarHeader - Compact header for aircraft sidebar
 *
 * Features:
 * - Close button (X)
 * - Callsign + registration
 * - Aircraft type tag
 * - Share button
 */
export function SidebarHeader({
  hex,
  aircraft,
  info,
  shareSuccess,
  onShare,
  onClose,
}) {
  const callsign = aircraft?.flight?.trim();
  const registration = info?.registration || info?.reg || info?.r;
  const typeCode = info?.type_code || info?.icao_type || info?.t;

  return (
    <header className="sidebar-header">
      <div className="sidebar-header-left">
        <button
          className="sidebar-close-btn"
          onClick={onClose}
          aria-label="Close sidebar"
          type="button"
        >
          <X size={16} />
        </button>

        <div className="sidebar-identity">
          <h2 className="sidebar-callsign">
            {callsign || registration || hex?.toUpperCase()}
          </h2>
          <div className="sidebar-subtitle">
            {callsign && registration && (
              <span>{registration}</span>
            )}
            {typeCode && (
              <span className="sidebar-type-tag">{typeCode}</span>
            )}
          </div>
        </div>
      </div>

      <div className="sidebar-header-actions">
        <button
          className={`sidebar-share-btn ${shareSuccess ? 'success' : ''}`}
          onClick={onShare}
          aria-label={shareSuccess ? 'Link copied' : 'Share aircraft'}
          title={shareSuccess ? 'Link copied!' : 'Share'}
          type="button"
        >
          {shareSuccess ? <Check size={14} /> : <Share2 size={14} />}
        </button>
      </div>
    </header>
  );
}
