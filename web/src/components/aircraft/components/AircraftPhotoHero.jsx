import React from 'react';
import { Camera, RefreshCw, Radar } from 'lucide-react';

export function AircraftPhotoHero({
  hex,
  info,
  photoInfo,
  photoUrl,
  photoState,
  photoRetryCount,
  useThumbnail,
  photoStatus,
  onPhotoLoad,
  onPhotoError,
  onRetry
}) {
  return (
    <div className="detail-photo" role="img" aria-label={`Photo of aircraft ${info?.registration || hex}`}>
      {/* Loading state with aircraft silhouette watermark */}
      {photoState === 'loading' && (
        <div className="photo-loading">
          <div className="photo-loading-radar">
            <Radar size={32} className="photo-radar-icon" aria-hidden="true" />
            <div className="photo-radar-sweep" />
          </div>
          <span>Loading photo...</span>
          <div className="photo-silhouette-watermark" aria-hidden="true">
            <svg viewBox="0 0 100 40" className="aircraft-silhouette">
              <path
                d="M50 5 L55 15 L85 20 L55 25 L55 35 L50 30 L45 35 L45 25 L15 20 L45 15 Z"
                fill="currentColor"
              />
            </svg>
          </div>
        </div>
      )}

      {/* Error state */}
      {photoState === 'error' && (
        <div className="photo-error">
          <Camera size={48} aria-hidden="true" />
          <span>No photo available</span>
          <button
            className="photo-retry-btn"
            onClick={onRetry}
            aria-label="Retry loading photo"
          >
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {/* Photo with gradient overlay */}
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
              pointerEvents: photoState !== 'loaded' ? 'none' : 'auto'
            }}
          />
          {/* Glass-morphism overlay card at bottom */}
          {photoState === 'loaded' && (
            <div className="photo-overlay-card">
              <div className="photo-overlay-stats">
                {info?.type_name && (
                  <span className="photo-stat-type">{info.type_name}</span>
                )}
                {info?.operator && (
                  <span className="photo-stat-operator">{info.operator}</span>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Photo credit - moved to top-left for loaded state */}
      {photoState === 'loaded' && photoInfo?.photographer && (
        <span className="photo-credit">
          <Camera size={10} aria-hidden="true" /> {photoInfo.photographer} via {photoInfo.source || 'planespotters.net'}
        </span>
      )}

      {/* Refresh button */}
      {photoState === 'loaded' && (
        <button
          className="photo-refresh-btn"
          onClick={onRetry}
          title="Refresh photo"
          aria-label="Refresh photo"
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      )}

      {/* Status message */}
      {photoStatus && (
        <div
          className={`photo-status photo-status-${photoStatus.type}`}
          role="status"
          aria-live="polite"
        >
          {photoStatus.message}
        </div>
      )}
    </div>
  );
}
