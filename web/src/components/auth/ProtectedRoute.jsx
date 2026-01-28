/**
 * Protected Route Component
 *
 * Wraps content that requires authentication.
 * Redirects to login if user is not authenticated.
 */
import { useAuth } from '../../contexts/AuthContext';
import LoginPage from './LoginPage';

export default function ProtectedRoute({ children, requiredPermissions = [], requireAll = true }) {
  const { status, config, hasPermission, hasAnyPermission, hasAllPermissions } = useAuth();

  // If auth is disabled or public mode, show content
  if (!config.authEnabled || config.publicMode) {
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
          <p>You don't have permission to access this feature.</p>
        </div>
      );
    }
  }

  return children;
}
