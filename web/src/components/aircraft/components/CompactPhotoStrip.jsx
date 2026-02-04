import React from 'react';
import { Camera, Radar } from 'lucide-react';

/**
 * CompactPhotoStrip - Compact clickable photo thumbnail
 *
 * On desktop: appears in the left column as a thumbnail
 * On mobile: appears as a smaller strip
 * Click anywhere to expand to lightbox
 */
export function CompactPhotoStrip({
  hex,
  info,
  photoInfo,
  photoUrl,
  photoState,
  photoRetryCount,
  useThumbnail,
  onPhotoLoad,
  onPhotoError,
  onExpand,
}) {
  const handleClick = () => {
    if (photoState === 'loaded' && onExpand) {
      onExpand();
    }
  };

  const handleKeyDown = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && photoState === 'loaded' && onExpand) {
      e.preventDefault();
      onExpand();
    }
  };

  return (
    <div
      className={`detail-v2-photo ${photoState === 'loaded' ? 'clickable' : ''}`}
      role={photoState === 'loaded' ? 'button' : 'img'}
      tabIndex={photoState === 'loaded' ? 0 : -1}
      aria-label={
        photoState === 'loaded'
          ? `Photo of aircraft ${info?.registration || hex}. Click to expand.`
          : `Photo of aircraft ${info?.registration || hex}`
      }
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {/* Loading state */}
      {photoState === 'loading' && (
        <div className="detail-v2-photo-loading">
          <div className="photo-loading-radar">
            <Radar size={20} className="photo-radar-icon" aria-hidden="true" />
            <div className="photo-radar-sweep" />
          </div>
        </div>
      )}

      {/* Error state */}
      {photoState === 'error' && (
        <div className="detail-v2-photo-error">
          <Camera size={24} aria-hidden="true" />
          <span>No photo</span>
        </div>
      )}

      {/* Photo with overlay */}
      {photoUrl && (
        <>
          <img
            key={`${photoRetryCount}-${useThumbnail}-${photoUrl}`}
            src={photoUrl}
            alt={`Aircraft ${info?.registration || hex}`}
            onLoad={onPhotoLoad}
            onError={onPhotoError}
            style={{
              opacity: photoState === 'loaded' ? 1 : 0,
              position: photoState !== 'loaded' ? 'absolute' : 'relative',
              pointerEvents: 'none',
            }}
          />

          {/* Click hint overlay */}
          {photoState === 'loaded' && (
            <div className="detail-v2-photo-overlay">
              <div className="detail-v2-photo-info">
                {info?.type_name && <span className="detail-v2-photo-type">{info.type_name}</span>}
              </div>

              {/* Photo credit & click hint */}
              <div className="detail-v2-photo-meta">
                {photoInfo?.photographer && (
                  <span className="detail-v2-photo-credit">
                    <Camera size={10} aria-hidden="true" />
                    {photoInfo.photographer}
                  </span>
                )}
                <span className="detail-v2-photo-hint">Click to expand</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
