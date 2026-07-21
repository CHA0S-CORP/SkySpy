import React, { memo, useEffect, useRef, useState } from 'react';
import { Icon } from '../primitives';
import { useTheme, V2_THEMES } from '../../../providers/ThemeProvider';
import { useAuth } from '../../../contexts/AuthContext';
import { navigate } from '../../../lib/hashRoute';

/** Initials for the avatar chip (max two letters). */
function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Header identity menu: shows the current user, with a dropdown to reach the
 * admin console (admins only) and sign out. Anonymous visitors get a Sign in
 * button instead. Admin access mirrors the backend: superuser, the system.manage
 * permission, or an admin/superadmin role.
 */
function UserMenu() {
  const { status, user, isAuthenticated, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (status === 'loading') return null;

  // Anonymous: a direct sign-in affordance.
  if (!isAuthenticated) {
    return (
      <button
        type="button"
        className="v2-usermenu__signin"
        onClick={() => navigate('login')}
        data-testid="v2-header-signin"
      >
        <Icon name="log-in" size={15} strokeWidth={2} />
        Sign in
      </button>
    );
  }

  const roles = user?.roles || [];
  const isAdmin =
    !!user?.isSuperuser ||
    (user?.permissions || []).includes('system.manage') ||
    roles.some((r) => r === 'admin' || r === 'superadmin');
  const name = user?.displayName || user?.username || 'Account';
  const roleLabel = user?.isSuperuser ? 'Superuser' : roles[0] || 'User';

  const go = (tab) => {
    setOpen(false);
    navigate(tab);
  };

  return (
    <div className="v2-usermenu" ref={ref} data-testid="v2-usermenu">
      <button
        type="button"
        className={`v2-usermenu__trigger ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={name}
        data-testid="v2-usermenu-trigger"
      >
        <span className="v2-usermenu__avatar">{initials(name)}</span>
        <span className="v2-usermenu__name">{name}</span>
        <Icon name="chevron-down" size={13} strokeWidth={2} className="v2-usermenu__chev" />
      </button>

      {open && (
        <div className="v2-usermenu__pop" role="menu">
          <div className="v2-usermenu__id">
            <span className="v2-usermenu__avatar v2-usermenu__avatar--lg">{initials(name)}</span>
            <div className="v2-usermenu__idtext">
              <div className="v2-usermenu__idname">{name}</div>
              <div className="v2-usermenu__idrole">{roleLabel}</div>
            </div>
          </div>

          <div className="v2-usermenu__sep" />

          {isAdmin && (
            <button
              type="button"
              className="v2-usermenu__item"
              role="menuitem"
              onClick={() => go('admin')}
            >
              <Icon name="sliders" size={15} strokeWidth={1.9} />
              Admin Console
            </button>
          )}

          <button
            type="button"
            className="v2-usermenu__item v2-usermenu__item--danger"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              logout();
            }}
            data-testid="v2-usermenu-logout"
          >
            <Icon name="log-out" size={15} strokeWidth={1.9} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** Theme dot colors shown in the switcher (each theme's --accent). */
const THEME_DOTS = { radar: '#3ddc84', slate: '#4cc9f0', amber: '#f5b544' };

const UtcClock = memo(function UtcClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="v2-header__clock">
      <Icon name="clock" size={14} strokeWidth={1.6} />
      <span className="v2-header__clock-time">{now.toISOString().slice(11, 19)}</span>
      <span className="v2-header__clock-utc">UTC</span>
    </div>
  );
});

function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="v2-themeswitch" data-testid="v2-theme-switcher">
      {V2_THEMES.map((t) => (
        <button
          key={t}
          type="button"
          title={`${t.charAt(0).toUpperCase()}${t.slice(1)} theme`}
          className={`v2-themeswitch__btn ${theme === t ? 'v2-themeswitch__btn--active' : ''}`}
          style={{ '--v2-theme-dot': THEME_DOTS[t] }}
          onClick={() => setTheme(t)}
        >
          <span className="v2-themeswitch__dot" />
          {theme === t ? t : ''}
        </button>
      ))}
    </div>
  );
}

/**
 * 60px global header (design: logo | live stat cluster | theme dots,
 * notifications + settings, UTC mono clock).
 *
 * @param {object} props
 * @param {number} props.aircraftCount
 * @param {{lat?: number, lon?: number}|null} props.location
 * @param {number} props.onlineUsers
 * @param {boolean} props.connected
 * @param {Function} props.onOpenSettings
 * @param {Function} props.onOpenNotifications
 * @param {React.ReactNode} [props.menuButton]
 */
export function AppHeader({
  aircraftCount,
  location,
  onlineUsers,
  connected,
  onOpenSettings,
  onOpenNotifications,
  menuButton,
}) {
  const fmt = (v, digits = 1) => (typeof v === 'number' ? v.toFixed(digits) : '—');
  return (
    <header className="v2-header" data-testid="v2-header">
      {menuButton}
      <div className="v2-header__brand">
        <div className="v2-header__glyph">
          <Icon name="radar" size={17} strokeWidth={1.9} />
        </div>
        <div className="v2-header__wordmark">
          Sky<em>Spy</em>
        </div>
      </div>

      <div className="v2-header__stats">
        <div className="v2-header__stat">
          <Icon name="send" size={15} style={{ color: 'var(--accent)' }} />
          <span
            className="v2-header__stat-value v2-header__stat-value--count"
            data-testid="v2-aircraft-count"
          >
            {aircraftCount}
          </span>
          <span className="v2-header__stat-label">AIRCRAFT</span>
        </div>
        <div className="v2-header__divider" />
        <div className="v2-header__stat">
          <Icon name="map-pin" size={14} style={{ color: 'var(--accent2)' }} />
          <span className="v2-header__stat-value v2-header__stat-value--coord">
            {fmt(location?.lat)}
          </span>
          <span className="v2-header__stat-label">LAT</span>
        </div>
        <div className="v2-header__stat">
          <Icon name="map-pin" size={14} style={{ color: 'var(--accent2)' }} />
          <span className="v2-header__stat-value v2-header__stat-value--coord">
            {fmt(location?.lon)}
          </span>
          <span className="v2-header__stat-label">LON</span>
        </div>
        <div className="v2-header__divider" />
        <div className="v2-header__stat">
          <Icon
            name="users"
            size={15}
            style={{ color: connected ? 'var(--dim)' : 'var(--danger)' }}
          />
          <span className="v2-header__stat-value">{onlineUsers}</span>
          <span className="v2-header__stat-label">ONLINE</span>
        </div>
      </div>

      <div className="v2-header__spacer" />
      <ThemeSwitcher />

      <div className="v2-header__actions">
        <button
          type="button"
          className="v2-header__iconbtn"
          title="Notifications"
          onClick={onOpenNotifications}
        >
          <Icon name="bell" size={17} />
        </button>
        <button
          type="button"
          className="v2-header__iconbtn"
          title="Settings"
          onClick={onOpenSettings}
          data-testid="v2-settings-btn"
        >
          <Icon name="sun" size={17} />
        </button>
        <UtcClock />
        <div className="v2-header__divider" />
        <UserMenu />
      </div>
    </header>
  );
}
