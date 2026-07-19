import React, { useCallback, useState } from 'react';
import { Icon } from '../../primitives';

const STORAGE_PREFIX = 'skyspy:det:disc:';

/**
 * Collapsible card used by the console (`layout=console`) DetailScreen layout to
 * fold low-priority sections (data sources, transponder log, sighting history)
 * into expandable disclosures so the single-scroll page stays scannable. The
 * open/closed state persists per-section in localStorage.
 *
 * @param {object} props
 * @param {string} props.id - stable storage-key suffix (skyspy:det:disc:<id>)
 * @param {string} props.title
 * @param {string} [props.icon] - leading Icon name
 * @param {string} [props.iconColor]
 * @param {React.ReactNode} [props.aside] - right-aligned head meta (count, etc.)
 * @param {boolean} [props.defaultOpen]
 * @param {React.ReactNode} props.children - body, rendered only while open
 */
export function DetailDisclosure({
  id,
  title,
  icon,
  iconColor = 'var(--accent)',
  aside,
  defaultOpen = false,
  children,
}) {
  const storageKey = STORAGE_PREFIX + id;
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(storageKey);
      return v == null ? defaultOpen : v === '1';
    } catch {
      // broad: localStorage may be unavailable (private mode) — fall back to default
      return defaultOpen;
    }
  });

  const toggle = useCallback(() => {
    setOpen((o) => {
      const next = !o;
      try {
        localStorage.setItem(storageKey, next ? '1' : '0');
      } catch {
        // broad: persistence is best-effort — ignore quota/availability errors
      }
      return next;
    });
  }, [storageKey]);

  return (
    <div
      className={`v2-det__card v2-det__card--muted v2-det__disc ${open ? 'v2-det__disc--open' : ''}`}
    >
      <button
        type="button"
        className="v2-det__card-head v2-det__disc-head"
        onClick={toggle}
        aria-expanded={open}
      >
        {icon && <Icon name={icon} size={15} strokeWidth={1.7} style={{ color: iconColor }} />}
        <span>{title}</span>
        <span className="v2-det__card-aside">{aside}</span>
        <Icon
          name="chevron-down"
          size={16}
          strokeWidth={2}
          className={`v2-det__disc-chevron ${open ? 'v2-det__disc-chevron--open' : ''}`}
        />
      </button>
      {open && <div className="v2-det__card-body">{children}</div>}
    </div>
  );
}
