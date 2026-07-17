import React, { useState } from 'react';
import { AppHeader } from './AppHeader';
import { NavRail } from './NavRail';
import { Icon, ToastHost } from '../primitives';

// Views that own their full pane (no 24px content padding, no scroll chrome).
// Migrated v2 screens manage their own padding — add each tab here as it lands.
// Full-bleed screens own the whole pane (no scroll chrome, height 100%).
// Everything else scrolls in the pane (`.v2-content { overflow-y:auto }`).
// Screens that manage an internal scroll region (list/alerts/audio/history)
// set their own root to height:100% and still work under an auto pane.
const FLUSH_TABS = new Set(['map', 'cannonball']);

// Not-yet-migrated views that render inside the pane and depend on the legacy
// .content-area padding. (v2 screens supply their own padding.)
const LEGACY_PANE_TABS = new Set(['event', 'admin']);

/**
 * v2 application shell: header + nav rail + routed content pane.
 * The content pane also carries the legacy `content-area` class so
 * not-yet-migrated views keep their sizing during the incremental migration.
 *
 * @param {object} props
 * @param {string} props.activeTab
 * @param {(tab: string) => void} props.onNavigate
 * @param {boolean} props.connected
 * @param {number} props.aircraftCount
 * @param {{lat?: number, lon?: number}|null} props.location
 * @param {number} props.onlineUsers
 * @param {Function} props.onOpenSettings
 * @param {React.ReactNode} props.children
 */
export function AppShell({
  activeTab,
  onNavigate,
  connected,
  aircraftCount,
  location,
  onlineUsers,
  onOpenSettings,
  children,
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const flush = FLUSH_TABS.has(activeTab);

  const navigate = (tab) => {
    setMobileNavOpen(false);
    onNavigate(tab);
  };

  return (
    <div className={`v2-app v2-shell view-${activeTab}`} data-testid="v2-app">
      <AppHeader
        aircraftCount={aircraftCount}
        location={location}
        onlineUsers={onlineUsers}
        connected={connected}
        onOpenSettings={onOpenSettings}
        onOpenNotifications={() => navigate('alerts')}
        menuButton={
          <button
            type="button"
            className="v2-header__iconbtn v2-shell__menubtn"
            aria-label="Toggle navigation"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
          >
            <Icon name={mobileNavOpen ? 'x' : 'menu'} size={18} />
          </button>
        }
      />
      <div className="v2-body">
        <NavRail
          activeTab={activeTab}
          onNavigate={navigate}
          connected={connected}
          className={mobileNavOpen ? 'v2-nav--open' : ''}
        />
        {mobileNavOpen && (
          <button
            type="button"
            className="v2-nav-overlay"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
          />
        )}
        <main className="v2-main">
          <div
            className={[
              'v2-content',
              flush && 'v2-content--flush',
              // Legacy in-pane views (SafetyEventPage #event, AdminConfigView
              // #admin) still rely on .content-area padding; v2 screens own theirs.
              LEGACY_PANE_TABS.has(activeTab) && 'content-area',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {children}
          </div>
        </main>
      </div>
      <ToastHost />
    </div>
  );
}
