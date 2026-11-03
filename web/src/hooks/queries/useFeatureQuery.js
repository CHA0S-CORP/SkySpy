import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';

/** Protected queries wait for auth and use the token-refreshing request helper. */
export function useFeatureQuery(feature, options) {
  const auth = useAuth();
  const allowed = !auth.isLoading && auth.canAccessFeature(feature);
  const query = useQuery({
    ...options,
    queryKey: [...options.queryKey, auth.user?.id ?? 'anonymous', auth.status],
    enabled: allowed && options.enabled !== false,
    retry: options.retry ?? false,
    queryFn: (context) => options.queryFn({ ...context, fetch: auth.authFetch }),
  });
  // Disabled queries can retain cached results; don't expose those after logout
  // or a permission change.
  return allowed ? query : { ...query, data: undefined };
}
