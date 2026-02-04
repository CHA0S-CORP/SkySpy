import React, { useEffect, useCallback } from 'react';
import { X, Camera, ExternalLink } from 'lucide-react';

/**
 * PhotoLightbox - Full-screen photo modal
 */
export function PhotoLightbox({ isOpen, photoUrl, photoInfo, info, hex, onClose }) {
  // Close on escape key
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.body.style.overflow = '';
      };
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen || !photoUrl) return null;

  const handleOverlayKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      onClose();
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="photo-lightbox-overlay"
      onClick={onClose}
      onKeyDown={handleOverlayKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Aircraft photo"
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="photo-lightbox-content" onClick={(e) => e.stopPropagation()}>
        <button className="photo-lightbox-close" onClick={onClose} aria-label="Close photo">
          <X size={24} />
        </button>

        <img
          src={photoUrl}
          alt={`Aircraft ${info?.registration || hex}`}
          className="photo-lightbox-image"
        />

        <div className="photo-lightbox-info">
          <div className="photo-lightbox-details">
            {info?.type_name && <span className="photo-lightbox-type">{info.type_name}</span>}
            {info?.registration && <span className="photo-lightbox-reg">{info.registration}</span>}
            {info?.operator && <span className="photo-lightbox-operator">{info.operator}</span>}
          </div>

          {photoInfo?.photographer && (
            <div className="photo-lightbox-credit">
              <Camera size={12} />
              <span>{photoInfo.photographer}</span>
            </div>
          )}

          {photoInfo?.source_url && (
            <a
              href={photoInfo.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="photo-lightbox-source"
            >
              <ExternalLink size={12} />
              View on {photoInfo.source || 'source'}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
