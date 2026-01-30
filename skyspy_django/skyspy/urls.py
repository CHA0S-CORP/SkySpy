"""
URL configuration for SkysPy project.

Maps all API endpoints to their respective ViewSets and views.
"""
from django.contrib import admin
from django.urls import path, include, re_path
from django.views.generic import TemplateView
from django.http import HttpResponse
from django.conf import settings
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)
from rest_framework.routers import DefaultRouter
import os


def serve_frontend(request):
    """Serve the frontend SPA index.html."""
    # Check locations in order of preference
    locations = [
        # STATICFILES_DIRS first (original unhashed files)
        *[os.path.join(d, 'index.html') for d in getattr(settings, 'STATICFILES_DIRS', [])],
        # Then STATIC_ROOT (after collectstatic)
        os.path.join(settings.STATIC_ROOT, 'index.html') if settings.STATIC_ROOT else None,
        # Fallback for Docker environment
        '/app/static/index.html',
    ]

    for index_path in locations:
        if index_path and os.path.exists(index_path):
            with open(index_path, 'r') as f:
                return HttpResponse(f.read(), content_type='text/html')

    return HttpResponse('Frontend not found. Checked: ' + ', '.join(str(p) for p in locations if p), status=404)

# Import ViewSets
from skyspy.api.aircraft import AircraftViewSet
from skyspy.api.history import HistoryViewSet, SightingViewSet, SessionViewSet
from skyspy.api.alerts import AlertRuleViewSet, AlertHistoryViewSet, AlertSubscriptionViewSet
from skyspy.api.safety import SafetyEventViewSet
from skyspy.api.notifications import NotificationViewSet, NotificationChannelViewSet
from skyspy.api.aviation import AviationViewSet
from skyspy.api.airframe import AirframeViewSet, PhotoServeView
from skyspy.api.acars import AcarsViewSet
from skyspy.api.audio import AudioViewSet
from skyspy.api.map import MapViewSet
from skyspy.api.antenna import AntennaAnalyticsViewSet
from skyspy.api.stats import TrackingQualityViewSet, EngagementViewSet, FavoritesViewSet
from skyspy.api.flight_pattern_stats import (
    FlightPatternStatsViewSet, GeographicStatsViewSet, CombinedStatsViewSet
)
from skyspy.api.notams import NotamViewSet
from skyspy.api.archive import ArchiveViewSet
from skyspy.api.mobile import MobileViewSet
from skyspy.api.cannonball import (
    CannonballThreatsView, CannonballLocationView, CannonballActivateView,
    CannonballSessionViewSet, CannonballPatternViewSet, CannonballAlertViewSet,
    CannonballKnownAircraftViewSet, CannonballStatsViewSet,
)
from skyspy.api.system import (
    HealthCheckView, StatusView, SystemInfoView, MetricsView,
    ExternalDatabaseStatsView, OpenSkyLookupView, AircraftLookupView,
    RouteLookupView, GeodataStatsView, WeatherCacheStatsView
)

# Import Auth views and ViewSets
from skyspy.auth.views import (
    AuthConfigView, LoginView, LogoutView, TokenRefreshViewCustom,
    ProfileView, PasswordChangeView, OIDCAuthorizeView, OIDCCallbackView,
    permissions_list, my_permissions,
)
from skyspy.api.auth import (
    UserViewSet, RoleViewSet, UserRoleViewSet, APIKeyViewSet,
    FeatureAccessViewSet, OIDCClaimMappingViewSet,
)

# Create router and register viewsets
router = DefaultRouter()
router.register(r'aircraft', AircraftViewSet, basename='aircraft')
router.register(r'sightings', SightingViewSet, basename='sightings')
router.register(r'sessions', SessionViewSet, basename='sessions')
router.register(r'history', HistoryViewSet, basename='history')
router.register(r'alerts/rules', AlertRuleViewSet, basename='alert-rules')
router.register(r'alerts/history', AlertHistoryViewSet, basename='alert-history')
router.register(r'alerts/subscriptions', AlertSubscriptionViewSet, basename='alert-subscriptions')
router.register(r'safety/events', SafetyEventViewSet, basename='safety-events')
router.register(r'notifications', NotificationViewSet, basename='notifications')
router.register(r'notifications/channels', NotificationChannelViewSet, basename='notification-channels')
router.register(r'aviation', AviationViewSet, basename='aviation')
router.register(r'airframes', AirframeViewSet, basename='airframes')
router.register(r'acars', AcarsViewSet, basename='acars')
router.register(r'audio', AudioViewSet, basename='audio')
router.register(r'map', MapViewSet, basename='map')
router.register(r'antenna', AntennaAnalyticsViewSet, basename='antenna')
router.register(r'stats/tracking-quality', TrackingQualityViewSet, basename='tracking-quality')
router.register(r'stats/engagement', EngagementViewSet, basename='engagement')
router.register(r'stats/favorites', FavoritesViewSet, basename='favorites')
router.register(r'stats/flight-patterns', FlightPatternStatsViewSet, basename='flight-patterns')
router.register(r'stats/geographic', GeographicStatsViewSet, basename='geographic')
router.register(r'stats/combined', CombinedStatsViewSet, basename='combined-stats')
router.register(r'notams', NotamViewSet, basename='notams')
router.register(r'archive', ArchiveViewSet, basename='archive')
router.register(r'mobile', MobileViewSet, basename='mobile')
router.register(r'cannonball/sessions', CannonballSessionViewSet, basename='cannonball-sessions')
router.register(r'cannonball/patterns', CannonballPatternViewSet, basename='cannonball-patterns')
router.register(r'cannonball/alerts', CannonballAlertViewSet, basename='cannonball-alerts')
router.register(r'cannonball/known-aircraft', CannonballKnownAircraftViewSet, basename='cannonball-known-aircraft')
router.register(r'cannonball/stats', CannonballStatsViewSet, basename='cannonball-stats')

# Admin management router
admin_router = DefaultRouter()
admin_router.register(r'users', UserViewSet, basename='admin-users')
admin_router.register(r'roles', RoleViewSet, basename='admin-roles')
admin_router.register(r'user-roles', UserRoleViewSet, basename='admin-user-roles')
admin_router.register(r'api-keys', APIKeyViewSet, basename='admin-api-keys')
admin_router.register(r'feature-access', FeatureAccessViewSet, basename='admin-feature-access')
admin_router.register(r'oidc-mappings', OIDCClaimMappingViewSet, basename='admin-oidc-mappings')

urlpatterns = [
    # Admin
    path('admin/', admin.site.urls),

    # Health check (root level)
    path('health', HealthCheckView.as_view(), name='health'),
    path('health/', HealthCheckView.as_view(), name='health-slash'),

    # Metrics (Prometheus)
    path('metrics', MetricsView.as_view(), name='metrics'),
    path('metrics/', MetricsView.as_view(), name='metrics-slash'),

    # API v1
    path('api/v1/', include([
        # Router-based endpoints
        path('', include(router.urls)),

        # Authentication endpoints
        path('auth/config', AuthConfigView.as_view(), name='auth-config'),
        path('auth/config/', AuthConfigView.as_view(), name='auth-config-slash'),
        path('auth/login', LoginView.as_view(), name='auth-login'),
        path('auth/login/', LoginView.as_view(), name='auth-login-slash'),
        path('auth/logout', LogoutView.as_view(), name='auth-logout'),
        path('auth/logout/', LogoutView.as_view(), name='auth-logout-slash'),
        path('auth/refresh', TokenRefreshViewCustom.as_view(), name='auth-refresh'),
        path('auth/refresh/', TokenRefreshViewCustom.as_view(), name='auth-refresh-slash'),
        path('auth/profile', ProfileView.as_view(), name='auth-profile'),
        path('auth/profile/', ProfileView.as_view(), name='auth-profile-slash'),
        path('auth/password', PasswordChangeView.as_view(), name='auth-password'),
        path('auth/password/', PasswordChangeView.as_view(), name='auth-password-slash'),
        path('auth/permissions', permissions_list, name='auth-permissions'),
        path('auth/permissions/', permissions_list, name='auth-permissions-slash'),
        path('auth/my-permissions', my_permissions, name='auth-my-permissions'),
        path('auth/my-permissions/', my_permissions, name='auth-my-permissions-slash'),

        # OIDC endpoints
        path('auth/oidc/authorize', OIDCAuthorizeView.as_view(), name='oidc-authorize'),
        path('auth/oidc/authorize/', OIDCAuthorizeView.as_view(), name='oidc-authorize-slash'),
        path('auth/oidc/callback', OIDCCallbackView.as_view(), name='oidc-callback'),
        path('auth/oidc/callback/', OIDCCallbackView.as_view(), name='oidc-callback-slash'),

        # Admin management endpoints
        path('admin/', include(admin_router.urls)),

        # System endpoints
        path('system/status', StatusView.as_view(), name='system-status'),
        path('system/status/', StatusView.as_view(), name='system-status-slash'),
        path('system/health', HealthCheckView.as_view(), name='system-health'),
        path('system/health/', HealthCheckView.as_view(), name='system-health-slash'),
        path('system/info', SystemInfoView.as_view(), name='system-info'),
        path('system/info/', SystemInfoView.as_view(), name='system-info-slash'),

        # External database endpoints
        path('system/databases', ExternalDatabaseStatsView.as_view(), name='database-stats'),
        path('system/databases/', ExternalDatabaseStatsView.as_view(), name='database-stats-slash'),
        path('system/geodata', GeodataStatsView.as_view(), name='geodata-stats'),
        path('system/geodata/', GeodataStatsView.as_view(), name='geodata-stats-slash'),
        path('system/weather', WeatherCacheStatsView.as_view(), name='weather-stats'),
        path('system/weather/', WeatherCacheStatsView.as_view(), name='weather-stats-slash'),

        # Aircraft and route lookup endpoints
        path('lookup/aircraft/<str:icao_hex>', AircraftLookupView.as_view(), name='aircraft-lookup'),
        path('lookup/aircraft/<str:icao_hex>/', AircraftLookupView.as_view(), name='aircraft-lookup-slash'),
        path('lookup/opensky/<str:icao_hex>', OpenSkyLookupView.as_view(), name='opensky-lookup'),
        path('lookup/opensky/<str:icao_hex>/', OpenSkyLookupView.as_view(), name='opensky-lookup-slash'),
        path('lookup/route/<str:callsign>', RouteLookupView.as_view(), name='route-lookup'),
        path('lookup/route/<str:callsign>/', RouteLookupView.as_view(), name='route-lookup-slash'),

        # UAT aircraft (separate endpoint)
        path('uat/aircraft', AircraftViewSet.as_view({'get': 'uat_list'}), name='uat-aircraft'),
        path('uat/aircraft/', AircraftViewSet.as_view({'get': 'uat_list'}), name='uat-aircraft-slash'),

        # Cannonball Mode endpoints
        path('cannonball/threats', CannonballThreatsView.as_view(), name='cannonball-threats'),
        path('cannonball/threats/', CannonballThreatsView.as_view(), name='cannonball-threats-slash'),
        path('cannonball/location', CannonballLocationView.as_view(), name='cannonball-location'),
        path('cannonball/location/', CannonballLocationView.as_view(), name='cannonball-location-slash'),
        path('cannonball/activate', CannonballActivateView.as_view(), name='cannonball-activate'),
        path('cannonball/activate/', CannonballActivateView.as_view(), name='cannonball-activate-slash'),

        # Photo serving endpoints
        path('photos/<str:icao_hex>', PhotoServeView.as_view(), name='photo-serve'),
        path('photos/<str:icao_hex>/', PhotoServeView.as_view(), name='photo-serve-slash'),
        path('photos/<str:icao_hex>/<str:photo_type>', PhotoServeView.as_view(), name='photo-serve-type'),
        path('photos/<str:icao_hex>/<str:photo_type>/', PhotoServeView.as_view(), name='photo-serve-type-slash'),
    ])),

    # OpenAPI Schema
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    path('api/redoc/', SpectacularRedocView.as_view(url_name='schema'), name='redoc'),

    # SSE endpoints (django-eventstream)
    path('events/', include('django_eventstream.urls'), {'channels': ['aircraft', 'safety', 'alerts']}),

    # Frontend SPA - serve index.html for root and all unmatched routes
    path('', serve_frontend, name='frontend-root'),
    path('cannonball', serve_frontend, name='cannonball'),
    path('cannonball/', serve_frontend, name='cannonball-slash'),
    re_path(r'^(?!api/|admin/|health|metrics|events/|static/).*$', serve_frontend, name='frontend-catchall'),
]
