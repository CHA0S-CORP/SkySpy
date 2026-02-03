import React, { lazy, Suspense, ComponentType } from 'react';

/**
 * Loading fallback component displayed while lazy-loaded views are loading
 */
const LoadingFallback: React.FC = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      minHeight: '200px',
    }}
  >
    <div
      style={{
        width: '40px',
        height: '40px',
        border: '3px solid rgba(255, 255, 255, 0.1)',
        borderTopColor: 'var(--color-primary, #3b82f6)',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
      }}
    />
    <style>{`
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `}</style>
  </div>
);

/**
 * Helper function to create a lazy-loaded component with Suspense wrapper
 */
function withLazyLoad<P extends object>(
  importFn: () => Promise<{ default: ComponentType<P> } | { [key: string]: ComponentType<P> }>,
  componentName?: string
): React.FC<P> {
  const LazyComponent = lazy(async () => {
    const module = await importFn();
    if ('default' in module) {
      return module as { default: ComponentType<P> };
    }
    // Handle named exports
    if (componentName && componentName in module) {
      return { default: module[componentName] as ComponentType<P> };
    }
    // Try to find the first exported component
    const keys = Object.keys(module);
    if (keys.length > 0) {
      return { default: module[keys[0]] as ComponentType<P> };
    }
    throw new Error('No component found in module');
  });

  const WrappedComponent: React.FC<P> = (props) => (
    <Suspense fallback={<LoadingFallback />}>
      <LazyComponent {...props} />
    </Suspense>
  );

  WrappedComponent.displayName = `Lazy${componentName || 'Component'}`;

  return WrappedComponent;
}

// ============================================================================
// Lazy-loaded View Components
// ============================================================================

/**
 * Map view - Main aircraft tracking map
 */
const MapView = lazy(() =>
  import('../components/map/MapView').then((m) => ({ default: m.MapView }))
);
export const LazyMapView: React.FC<any> = (props) => (
  <Suspense fallback={<LoadingFallback />}>
    <MapView {...props} />
  </Suspense>
);
LazyMapView.displayName = 'LazyMapView';

/**
 * Aircraft list view - Tabular list of tracked aircraft
 */
const AircraftList = lazy(() =>
  import('../components/views/AircraftList').then((m) => ({ default: m.AircraftList }))
);
export const LazyAircraftList: React.FC<any> = (props) => (
  <Suspense fallback={<LoadingFallback />}>
    <AircraftList {...props} />
  </Suspense>
);
LazyAircraftList.displayName = 'LazyAircraftList';

/**
 * Stats view - Statistics and analytics dashboard
 */
const StatsView = lazy(() =>
  import('../components/views/StatsView').then((m) => ({ default: m.StatsView }))
);
export const LazyStatsView: React.FC<any> = (props) => (
  <Suspense fallback={<LoadingFallback />}>
    <StatsView {...props} />
  </Suspense>
);
LazyStatsView.displayName = 'LazyStatsView';

/**
 * History view - Historical sightings and safety events
 */
const HistoryView = lazy(() =>
  import('../components/views/HistoryView').then((m) => ({ default: m.HistoryView }))
);
export const LazyHistoryView: React.FC<any> = (props) => (
  <Suspense fallback={<LoadingFallback />}>
    <HistoryView {...props} />
  </Suspense>
);
LazyHistoryView.displayName = 'LazyHistoryView';

/**
 * Audio view - ACARS and audio message decoding
 */
const AudioView = lazy(() =>
  import('../components/views/AudioView').then((m) => ({ default: m.AudioView }))
);
export const LazyAudioView: React.FC<any> = (props) => (
  <Suspense fallback={<LoadingFallback />}>
    <AudioView {...props} />
  </Suspense>
);
LazyAudioView.displayName = 'LazyAudioView';

/**
 * Alerts view - Custom alert rules management
 */
const AlertsView = lazy(() =>
  import('../components/views/AlertsView').then((m) => ({ default: m.AlertsView }))
);
export const LazyAlertsView: React.FC<any> = (props) => (
  <Suspense fallback={<LoadingFallback />}>
    <AlertsView {...props} />
  </Suspense>
);
LazyAlertsView.displayName = 'LazyAlertsView';

/**
 * System view - System status and monitoring
 */
const SystemView = lazy(() =>
  import('../components/views/SystemView').then((m) => ({ default: m.SystemView }))
);
export const LazySystemView: React.FC<any> = (props) => (
  <Suspense fallback={<LoadingFallback />}>
    <SystemView {...props} />
  </Suspense>
);
LazySystemView.displayName = 'LazySystemView';

/**
 * Safety event page - Detailed view of a safety event
 */
const SafetyEventPage = lazy(() =>
  import('../components/views/SafetyEventPage').then((m) => ({ default: m.SafetyEventPage }))
);
export const LazySafetyEventPage: React.FC<any> = (props) => (
  <Suspense fallback={<LoadingFallback />}>
    <SafetyEventPage {...props} />
  </Suspense>
);
LazySafetyEventPage.displayName = 'LazySafetyEventPage';

/**
 * NOTAMs view - Notice to Air Missions display
 */
const NotamsView = lazy(() =>
  import('../components/views/NotamsView').then((m) => ({ default: m.NotamsView }))
);
export const LazyNotamsView: React.FC<any> = (props) => (
  <Suspense fallback={<LoadingFallback />}>
    <NotamsView {...props} />
  </Suspense>
);
LazyNotamsView.displayName = 'LazyNotamsView';

/**
 * Archive view - Archived data and recordings
 */
const ArchiveView = lazy(() =>
  import('../components/views/ArchiveView').then((m) => ({ default: m.ArchiveView }))
);
export const LazyArchiveView: React.FC<any> = (props) => (
  <Suspense fallback={<LoadingFallback />}>
    <ArchiveView {...props} />
  </Suspense>
);
LazyArchiveView.displayName = 'LazyArchiveView';

/**
 * Cannonball mode - Gamified tracking mode
 */
const CannonballMode = lazy(() =>
  import('../components/views/CannonballMode').then((m) => ({ default: m.CannonballMode }))
);
export const LazyCannonballMode: React.FC<any> = (props) => (
  <Suspense fallback={<LoadingFallback />}>
    <CannonballMode {...props} />
  </Suspense>
);
LazyCannonballMode.displayName = 'LazyCannonballMode';

/**
 * Admin config view - Administrative configuration panel
 */
const AdminConfigView = lazy(() =>
  import('../components/views/AdminConfigView').then((m) => ({ default: m.AdminConfigView }))
);
export const LazyAdminConfigView: React.FC<any> = (props) => (
  <Suspense fallback={<LoadingFallback />}>
    <AdminConfigView {...props} />
  </Suspense>
);
LazyAdminConfigView.displayName = 'LazyAdminConfigView';

// ============================================================================
// Re-export LoadingFallback for custom use
// ============================================================================
export { LoadingFallback };

// ============================================================================
// Export withLazyLoad helper for custom lazy loading
// ============================================================================
export { withLazyLoad };
