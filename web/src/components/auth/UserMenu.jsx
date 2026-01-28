/**
 * User Menu Component
 *
 * Displays current user info and provides logout functionality.
 * Shows in the header when authenticated.
 */
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { User, LogOut, Settings, ChevronDown, Shield } from 'lucide-react';

export default function UserMenu() {
  const { user, status, config, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    function handleEscape(event) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  // Don't show if auth is disabled
  if (!config.authEnabled) {
    return null;
  }

  // Show login button if not authenticated
  if (status !== 'authenticated') {
    return (
      <button
        className="user-menu-login"
        onClick={() => window.location.hash = '#login'}
      >
        <User size={16} />
        <span>Sign In</span>
      </button>
    );
  }

  const displayName = user?.displayName || user?.username || 'User';
  const initials = displayName.charAt(0).toUpperCase();

  const handleLogout = async () => {
    setIsOpen(false);
    await logout();
  };

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        className="user-menu-trigger"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <div className="user-avatar">
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt={displayName} />
          ) : (
            <span>{initials}</span>
          )}
        </div>
        <span className="user-name">{displayName}</span>
        <ChevronDown size={14} className={isOpen ? 'rotate' : ''} />
      </button>

      {isOpen && (
        <div className="user-menu-dropdown">
          <div className="user-menu-header">
            <div className="user-avatar large">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt={displayName} />
              ) : (
                <span>{initials}</span>
              )}
            </div>
            <div className="user-info">
              <strong>{displayName}</strong>
              {user?.email && <span className="user-email">{user.email}</span>}
            </div>
          </div>

          {user?.roles && user.roles.length > 0 && (
            <div className="user-menu-roles">
              <Shield size={14} />
              <span>{user.roles.join(', ')}</span>
            </div>
          )}

          <div className="user-menu-divider" />

          <button
            className="user-menu-item"
            onClick={() => {
              setIsOpen(false);
              window.location.hash = '#settings';
            }}
          >
            <Settings size={16} />
            <span>Settings</span>
          </button>

          <button className="user-menu-item logout" onClick={handleLogout}>
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>
      )}
    </div>
  );
}
