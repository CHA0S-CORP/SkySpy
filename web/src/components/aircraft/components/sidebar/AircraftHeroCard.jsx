import React from 'react';
import { Camera, RefreshCw, Radar } from 'lucide-react';

/**
 * AircraftHeroCard - Hero photo display for sidebar
 *
 * Features:
 * - 16:9 aspect ratio photo
 * - Loading/error states with radar animation
 * - Glass overlay with identity info
 * - Photo credit attribution
 */
export function AircraftHeroCard({
  hex,
  info,
  photoInfo,
  photoUrl,
  photoState,
  photoRetryCount,
  useThumbnail,
  onPhotoLoad,
  onPhotoError,
  onRetry,
}) {
  const registration = info?.registration || info?.reg || info?.r;
  const typeCode = info?.type_code || info?.icao_type || info?.t;
  const operator = info?.operator || info?.operatorName;

  return (
    <div
      className="sidebar-hero"
      role="img"
      aria-label={`Photo of aircraft ${registration || hex}`}
    >
      {/* Loading state */}
      {photoState === 'loading' && (
        <div className="sidebar-hero-loading">
          <div className="sidebar-loading-radar">
            <Radar size={24} aria-hidden="true" />
            <div className="sidebar-loading-sweep" />
          </div>
          <span>Loading photo...</span>
        </div>
      )}

      {/* Error state */}
      {photoState === 'error' && (
        <div className="sidebar-hero-error">
          <Camera size={32} aria-hidden="true" />
          <span>No photo available</span>
          <button
            className="photo-retry-btn"
            onClick={onRetry}
            aria-label="Retry loading photo"
            type="button"
            style={{ marginTop: '4px', padding: '6px 12px', fontSize: '11px' }}
          >
            <RefreshCw size={12} aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {/* Photo with overlay */}
      {photoUrl && (
        <>
          <img
            key={`${photoRetryCount}-${useThumbnail}-${photoUrl}`}
            src={photoUrl}
            alt={`Aircraft ${registration || hex}`}
            onLoad={onPhotoLoad}
            onError={onPhotoError}
            style={{
              opacity: photoState === 'loaded' ? 1 : 0,
              position: photoState !== 'loaded' ? 'absolute' : 'relative',
              pointerEvents: photoState !== 'loaded' ? 'none' : 'auto',
            }}
          />

          {/* Glass overlay with info */}
          {photoState === 'loaded' && (
            <div className="sidebar-hero-overlay">
              <div className="sidebar-hero-info">
                {registration && <span>{registration}</span>}
                {typeCode && <span>{typeCode}</span>}
                {operator && <span>{operator}</span>}
              </div>
            </div>
          )}
        </>
      )}

      {/* Photo credit */}
      {photoState === 'loaded' && photoInfo?.photographer && (
        <span className="sidebar-hero-credit">
          <Camera size={10} aria-hidden="true" />
          {photoInfo.photographer}
        </span>
      )}

      {/* Refresh button */}
      {photoState === 'loaded' && (
        <button
          className="sidebar-hero-refresh"
          onClick={onRetry}
          title="Refresh photo"
          aria-label="Refresh photo"
          type="button"
        >
          <RefreshCw size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
