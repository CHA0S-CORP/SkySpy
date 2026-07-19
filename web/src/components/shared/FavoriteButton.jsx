import React from 'react';
import { Icon } from '../v2/primitives';
import { useFavorites, useToggleFavorite } from '../../hooks/queries/useFavoritesQueries';

/**
 * Star toggle for favoriting an individual aircraft (airframe) by ICAO hex.
 * Reflects/updates the shared favorites list, so the History "Favorites" filter
 * and this star always agree. Stops click propagation so it can sit on a
 * clickable card/row without triggering the row's own onClick.
 *
 * @param {object} props
 * @param {string} props.hex - ICAO hex of the aircraft
 * @param {number} [props.size] - icon size
 * @param {string} [props.className]
 */
export function FavoriteButton({ hex, size = 18, className = '' }) {
  const { hexSet } = useFavorites();
  const toggle = useToggleFavorite();
  if (!hex) return null;

  const isFav = hexSet.has(hex.toUpperCase());
  return (
    <button
      type="button"
      className={`fav-btn ${isFav ? 'fav-btn--on' : ''} ${className}`}
      onClick={(e) => {
        e.stopPropagation();
        toggle.mutate(hex);
      }}
      title={isFav ? 'Remove from favorites' : 'Add to favorites'}
      aria-pressed={isFav}
      aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
    >
      <Icon name="star" size={size} strokeWidth={1.8} />
    </button>
  );
}

export default FavoriteButton;
