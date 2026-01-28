import React from 'react';
import { X, Share2, Check } from 'lucide-react';

export function AircraftHeader({
  hex,
  aircraft,
  info,
  tailInfo,
  shareSuccess,
  onShare,
  onClose
}) {
  return (
    <header className="detail-header" role="banner">
      <div className="detail-header-left">
        <span className="detail-flag" aria-label={`Flag: ${tailInfo.country || 'Unknown'}`}>
          {tailInfo.flag}
        </span>
        <div className="detail-titles">
          <h1 className="detail-callsign">
            {aircraft?.flight?.trim() || hex?.toUpperCase()}
          </h1>
          <div className="detail-subtitles">
            <span className="detail-hex">{hex?.toUpperCase()}</span>
            {tailInfo.tailNumber && (
              <span className="detail-tail">{tailInfo.tailNumber}</span>
            )}
            {info?.registration && (
              <span className="detail-reg">{info.registration}</span>
            )}
            {(info?.type_name || info?.model) && (
              <span className={`detail-model-tag ${info?.is_military ? 'military' : ''}`}>
                {info.type_name || info.model}
              </span>
            )}
            {info?.is_military && (
              <span className="detail-military-badge">MILITARY</span>
            )}
            {!info?.is_military && info?.operator && (
              <span className="detail-airline-badge" title={info.operator}>
                {info.operator}
              </span>
            )}
            {info && !info.is_military && !info.operator && (
              <span className="detail-civil-badge">CIVIL</span>
            )}
          </div>
        </div>
      </div>
      <div className="detail-header-actions">
        <button
          className={`detail-share ${shareSuccess ? 'success' : ''}`}
          onClick={onShare}
          title="Share link to this aircraft"
          aria-label={shareSuccess ? 'Link copied' : 'Share link to this aircraft'}
        >
          {shareSuccess ? <Check size={18} aria-hidden="true" /> : <Share2 size={18} aria-hidden="true" />}
        </button>
        <button
          className="detail-close"
          onClick={onClose}
          aria-label="Close aircraft details"
        >
          <X size={24} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
