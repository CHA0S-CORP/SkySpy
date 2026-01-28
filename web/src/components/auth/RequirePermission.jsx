/**
 * RequirePermission Component
 *
 * Conditionally renders content based on user permissions.
 * Does not redirect - simply hides content if permission is missing.
 */
import { useAuth } from '../../contexts/AuthContext';

/**
 * Render children only if user has the required permission(s)
 *
 * @param {Object} props
 * @param {string|string[]} props.permission - Required permission(s)
 * @param {boolean} props.requireAll - If true, require all permissions (default: true)
 * @param {React.ReactNode} props.children - Content to render if permitted
 * @param {React.ReactNode} props.fallback - Optional fallback content if not permitted
 */
export default function RequirePermission({
  permission,
  requireAll = true,
  children,
  fallback = null
}) {
  const { config, hasPermission, hasAnyPermission, hasAllPermissions } = useAuth();

  // If auth is disabled or public mode, show content
  if (!config.authEnabled || config.publicMode) {
    return children;
  }

  // Normalize permission to array
  const permissions = Array.isArray(permission) ? permission : [permission];

  // Check permissions
  const hasAccess = permissions.length === 1
    ? hasPermission(permissions[0])
    : requireAll
      ? hasAllPermissions(permissions)
      : hasAnyPermission(permissions);

  return hasAccess ? children : fallback;
}

/**
 * Hook for checking permissions in components
 */
export function usePermission(permission) {
  const { config, hasPermission } = useAuth();

  if (!config.authEnabled || config.publicMode) {
    return true;
  }

  return hasPermission(permission);
}

/**
 * Hook for checking feature access
 */
export function useFeatureAccess(feature, action = 'read') {
  const { canAccessFeature } = useAuth();
  return canAccessFeature(feature, action);
}
