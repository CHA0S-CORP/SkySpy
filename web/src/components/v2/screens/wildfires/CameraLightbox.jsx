import React, { useEffect, useCallback } from 'react';
import { Icon } from '../../primitives';

/**
 * Full-screen lightbox for Watch Duty wildfire camera stills. Click a camera
 * thumbnail (or the panel hero) to expand it here. Esc / backdrop / the close
 * button dismiss; ←/→ (and the on-screen arrows) page through the fire's
 * cameras. Shared by the Live Map WildfirePanel and the Wildfires screen.
 *
 * @param {object} props
 * @param {Array<{id:string,name?:string,image_url:string,distance_km?:number}>} props.cameras
 * @param {number} props.index - index into `cameras` of the shown still
 * @param {(next:number) => void} props.onIndex - request a different index
 * @param {() => void} props.onClose
 */
export function CameraLightbox({ cameras, index, onIndex, onClose }) {
  const cam = cameras?.[index] || null;
  const many = (cameras?.length || 0) > 1;

  const go = useCallback(
    (delta) => {
      if (!many) return;
      const n = cameras.length;
      onIndex((((index + delta) % n) + n) % n);
    },
    [cameras, index, many, onIndex]
  );

  const onKey = useCallback(
    (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    },
    [onClose, go]
  );

  useEffect(() => {
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onKey]);

  if (!cam) return null;

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="lm-camlb"
      role="dialog"
      aria-modal="true"
      aria-label="Wildfire camera"
      onClick={onClose}
    >
      <button className="lm-camlb__close" onClick={onClose} aria-label="Close camera">
        <Icon name="x" size={22} strokeWidth={2} />
      </button>

      {many && (
        <button
          type="button"
          className="lm-camlb__nav lm-camlb__nav--prev"
          onClick={(e) => {
            e.stopPropagation();
            go(-1);
          }}
          aria-label="Previous camera"
        >
          <Icon
            name="chevron-right"
            size={28}
            strokeWidth={2}
            style={{ transform: 'rotate(180deg)' }}
          />
        </button>
      )}

      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */}
      <figure className="lm-camlb__figure" onClick={(e) => e.stopPropagation()}>
        <img className="lm-camlb__img" src={cam.image_url} alt={cam.name || 'wildfire camera'} />
        <figcaption className="lm-camlb__cap">
          <span className="lm-camlb__name">{cam.name || 'Camera'}</span>
          {typeof cam.distance_km === 'number' && (
            <span className="lm-camlb__dist">{cam.distance_km.toFixed(1)} km</span>
          )}
          {many && (
            <span className="lm-camlb__count">
              {index + 1} / {cameras.length}
            </span>
          )}
        </figcaption>
      </figure>

      {many && (
        <button
          type="button"
          className="lm-camlb__nav lm-camlb__nav--next"
          onClick={(e) => {
            e.stopPropagation();
            go(1);
          }}
          aria-label="Next camera"
        >
          <Icon name="chevron-right" size={28} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
