import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import {
  StickyNote,
  Bell,
  Eye,
  EyeOff,
  ExternalLink,
  History,
  Navigation,
  Copy,
  Star,
  StarOff,
  RotateCcw,
} from 'lucide-react';

/**
 * Context menu for aircraft right-click actions.
 *
 * Provides quick actions:
 * - Add/Edit Note
 * - Track aircraft
 * - Create alert for aircraft
 * - Copy hex/callsign
 * - Open external links
 *
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether menu is visible
 * @param {Object} props.position - Menu position { x, y }
 * @param {Object} props.aircraft - Aircraft data
 * @param {Function} props.onClose - Close handler
 * @param {Function} props.onAddNote - Add/edit note handler
 * @param {Function} props.onTrack - Track aircraft handler
 * @param {Function} props.onCreateAlert - Create alert handler
 * @param {Function} props.onViewHistory - View history handler
 * @param {boolean} props.hasNote - Whether aircraft has a note
 * @param {boolean} props.isTracking - Whether aircraft is being tracked
 * @param {boolean} props.isFavorite - Whether aircraft is favorited
 * @param {Function} props.onToggleFavorite - Toggle favorite handler
 * @param {boolean} props.hasCustomDataBlockPosition - Whether aircraft has custom data block position
 * @param {Function} props.onResetDataBlockPosition - Reset data block position handler
 */
export function AircraftContextMenu({
  isOpen,
  position,
  aircraft,
  onClose,
  onAddNote,
  onTrack,
  onCreateAlert,
  onViewHistory,
  hasNote = false,
  isTracking = false,
  isFavorite = false,
  onToggleFavorite,
  hasCustomDataBlockPosition = false,
  onResetDataBlockPosition,
}) {
  const menuRef = useRef(null);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    // Add listeners with small delay to prevent immediate close
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }, 10);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  // Adjust position to keep menu on screen
  useEffect(() => {
    if (!isOpen || !menuRef.current) return;

    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const padding = 8;

    let adjustedX = position.x;
    let adjustedY = position.y;

    // Keep within viewport
    if (rect.right > window.innerWidth - padding) {
      adjustedX = window.innerWidth - rect.width - padding;
    }
    if (rect.bottom > window.innerHeight - padding) {
      adjustedY = window.innerHeight - rect.height - padding;
    }
    if (adjustedX < padding) adjustedX = padding;
    if (adjustedY < padding) adjustedY = padding;

    menu.style.left = `${adjustedX}px`;
    menu.style.top = `${adjustedY}px`;
  }, [isOpen, position]);

  if (!isOpen || !aircraft) return null;

  const displayId = aircraft.flight?.trim() || aircraft.hex;

  const handleAction = (action) => (e) => {
    e.stopPropagation();
    action();
    onClose();
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).catch(() => {
      console.warn('Failed to copy to clipboard');
    });
  };

  const MenuItem = ({ icon: Icon, label, onClick, variant = 'default', disabled = false }) => (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={onClick}
      disabled={disabled}
      className={`
        flex items-center gap-2 w-full px-3 py-2
        text-sm text-left
        transition-colors duration-150
        disabled:opacity-50 disabled:cursor-not-allowed
        ${
          variant === 'highlight'
            ? 'text-accent-yellow hover:bg-accent-yellow/10'
            : variant === 'accent'
              ? 'text-accent-cyan hover:bg-accent-cyan/10'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
        }
      `}
    >
      <Icon size={14} className="flex-shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );

  const Separator = () => <div className="my-1 border-t border-border" />;

  return (
    <div
      ref={menuRef}
      className="
        fixed z-[1500]
        min-w-[200px] max-w-[280px]
        bg-bg-card border border-border
        rounded-lg shadow-lg shadow-black/30
        py-1 overflow-hidden
        animate-in fade-in-0 zoom-in-95 duration-100
      "
      style={{
        left: position.x,
        top: position.y,
      }}
      role="menu"
      aria-label="Aircraft context menu"
      onKeyDown={(e) => {
        const items = menuRef.current?.querySelectorAll('[role="menuitem"]');
        if (!items?.length) return;

        const currentIndex = Array.from(items).indexOf(document.activeElement);

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const nextIndex = (currentIndex + 1) % items.length;
          items[nextIndex]?.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prevIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
          items[prevIndex]?.focus();
        }
      }}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-border bg-bg-elevated/50">
        <div className="font-mono font-medium text-text-primary truncate">{displayId}</div>
        {aircraft.flight?.trim() && (
          <div className="text-xs text-text-muted font-mono">{aircraft.hex?.toUpperCase()}</div>
        )}
      </div>

      {/* Menu Items */}
      <div className="py-1">
        {/* Note action - highlighted */}
        <MenuItem
          icon={StickyNote}
          label={hasNote ? 'Edit Note' : 'Add Note'}
          onClick={handleAction(onAddNote)}
          variant="highlight"
        />

        <Separator />

        {/* Tracking/Selection actions */}
        <MenuItem
          icon={isTracking ? EyeOff : Eye}
          label={isTracking ? 'Stop Tracking' : 'Track Aircraft'}
          onClick={handleAction(onTrack)}
        />

        {onToggleFavorite && (
          <MenuItem
            icon={isFavorite ? StarOff : Star}
            label={isFavorite ? 'Remove Favorite' : 'Add to Favorites'}
            onClick={handleAction(onToggleFavorite)}
          />
        )}

        {onViewHistory && (
          <MenuItem icon={History} label="View History" onClick={handleAction(onViewHistory)} />
        )}

        {/* Phase 14.3: Reset data block position */}
        {hasCustomDataBlockPosition && onResetDataBlockPosition && (
          <MenuItem
            icon={RotateCcw}
            label="Reset Data Block Position"
            onClick={handleAction(onResetDataBlockPosition)}
          />
        )}

        <Separator />

        {/* Alert action */}
        {onCreateAlert && (
          <MenuItem
            icon={Bell}
            label="Create Alert Rule"
            onClick={handleAction(onCreateAlert)}
            variant="accent"
          />
        )}

        <Separator />

        {/* Copy actions */}
        <MenuItem
          icon={Copy}
          label={`Copy Hex: ${aircraft.hex?.toUpperCase()}`}
          onClick={handleAction(() => copyToClipboard(aircraft.hex?.toUpperCase() || ''))}
        />

        {aircraft.flight?.trim() && (
          <MenuItem
            icon={Copy}
            label={`Copy Callsign: ${aircraft.flight.trim()}`}
            onClick={handleAction(() => copyToClipboard(aircraft.flight.trim()))}
          />
        )}

        <Separator />

        {/* External links */}
        <MenuItem
          icon={ExternalLink}
          label="View on FlightAware"
          onClick={handleAction(() => {
            const url = aircraft.flight?.trim()
              ? `https://flightaware.com/live/flight/${aircraft.flight.trim()}`
              : `https://flightaware.com/live/modes/${aircraft.hex}`;
            window.open(url, '_blank', 'noopener,noreferrer');
          })}
        />

        <MenuItem
          icon={ExternalLink}
          label="View on ADSBx"
          onClick={handleAction(() => {
            const url = `https://globe.adsbexchange.com/?icao=${aircraft.hex}`;
            window.open(url, '_blank', 'noopener,noreferrer');
          })}
        />

        {aircraft.r && (
          <MenuItem
            icon={Navigation}
            label={`Lookup ${aircraft.r}`}
            onClick={handleAction(() => {
              window.open(
                `https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=${aircraft.r}`,
                '_blank',
                'noopener,noreferrer'
              );
            })}
          />
        )}
      </div>
    </div>
  );
}

AircraftContextMenu.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  position: PropTypes.shape({
    x: PropTypes.number.isRequired,
    y: PropTypes.number.isRequired,
  }),
  aircraft: PropTypes.shape({
    hex: PropTypes.string,
    flight: PropTypes.string,
    r: PropTypes.string,
  }),
  onClose: PropTypes.func.isRequired,
  onAddNote: PropTypes.func.isRequired,
  onTrack: PropTypes.func,
  onCreateAlert: PropTypes.func,
  onViewHistory: PropTypes.func,
  hasNote: PropTypes.bool,
  isTracking: PropTypes.bool,
  isFavorite: PropTypes.bool,
  onToggleFavorite: PropTypes.func,
  hasCustomDataBlockPosition: PropTypes.bool,
  onResetDataBlockPosition: PropTypes.func,
};

export default AircraftContextMenu;
