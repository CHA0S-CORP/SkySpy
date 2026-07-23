/**
 * Protected Route Component
 *
 * Wraps content that requires authentication.
 * Redirects to login if user is not authenticated.
 */
import { useAuth } from '../../contexts/AuthContext';
import LoginPage from './LoginPage';

export default function ProtectedRoute({ children, requiredPermissions = [], requireAll = true }) {
  const { status, config, hasAnyPermission, hasAllPermissions } = useAuth();

  // Render the app for anyone in public OR hybrid mode. Hybrid = per-feature
  // access: anonymous visitors should reach the shell and see whatever features
  // are marked "Public (anonymous)"; NavRail's canAccessFeature (and each
  // screen) gate the rest. Only `private` mode requires a global sign-in — so a
  // feature set to Public no longer gets blocked by a blanket login wall.
  //
  // Exception: in hybrid mode where NOTHING is public (no enabled feature is
  // anonymously readable), the shell would be empty for anon visitors — so treat
  // it like private and route straight to login.
  const nothingPublic =
    config.authEnabled &&
    !Object.values(config.features || {}).some((f) => f?.is_enabled && f?.read_access === 'public');
  const globalLoginRequired =
    config.authEnabled && (config.authMode === 'private' || nothingPublic);
  if (!globalLoginRequired) {
    return children;
  }

  // Loading state
  if (status === 'loading') {
    return (
      <div className="auth-loading">
        <div className="spinner" />
        <span>Loading...</span>
      </div>
    );
  }

  // Not authenticated - show login
  if (status !== 'authenticated') {
    return <LoginPage />;
  }

  // Check permissions if specified
  if (requiredPermissions.length > 0) {
    const hasAccess = requireAll
      ? hasAllPermissions(requiredPermissions)
      : hasAnyPermission(requiredPermissions);

    if (!hasAccess) {
      return (
        <div className="auth-forbidden">
          <h2>Access Denied</h2>
          <p>You don&apos;t have permission to access this feature.</p>
        </div>
      );
    }
  }

  return children;
}
