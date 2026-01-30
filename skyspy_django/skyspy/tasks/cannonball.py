"""
Cannonball Mode Celery tasks for law enforcement aircraft detection.

Tasks for:
- Real-time pattern analysis
- LE aircraft identification
- Session management
- Alert generation
- Statistics aggregation
"""
import logging
from datetime import datetime, timedelta
from typing import Optional

from celery import shared_task
from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone
from channels.layers import get_channel_layer

from skyspy.models import (
    CannonballPattern, CannonballSession, CannonballAlert,
    CannonballKnownAircraft, CannonballStats,
)
from skyspy.services.cannonball import CannonballService
from skyspy.utils import sync_group_send

logger = logging.getLogger(__name__)

# Initialize the Cannonball service
_cannonball_service: Optional[CannonballService] = None


def get_cannonball_service() -> CannonballService:
    """Get or create the Cannonball service instance."""
    global _cannonball_service
    if _cannonball_service is None:
        _cannonball_service = CannonballService()
    return _cannonball_service


@shared_task(bind=True, max_retries=0)
def analyze_aircraft_patterns(self):
    """
    Analyze current aircraft for law enforcement patterns.

    This task runs periodically (every 5-10 seconds) to:
    1. Get current aircraft from cache
    2. Identify potential LE aircraft
    3. Detect suspicious patterns
    4. Update sessions and generate alerts
    """
    start_time = datetime.now()

    try:
        # Get current aircraft from cache
        aircraft_list = cache.get('current_aircraft', [])
        if not aircraft_list:
            logger.debug("No aircraft data in cache")
            return

        service = get_cannonball_service()

        # Get user location from cache (if Cannonball mode is active)
        user_lat = cache.get('cannonball_user_lat')
        user_lon = cache.get('cannonball_user_lon')

        # Skip analysis if no user location (Cannonball mode not active)
        if user_lat is None or user_lon is None:
            logger.debug("Cannonball mode not active (no user location)")
            return

        # Analyze all aircraft for threats
        threat_objects = service.analyze_aircraft(
            aircraft_list=aircraft_list,
            user_lat=user_lat,
            user_lon=user_lon,
        )

        # Convert threat objects to dicts and process
        threats = []
        for threat in threat_objects:
            threat_dict = threat.to_dict()
            threats.append(threat_dict)

            # Check for known LE aircraft in database
            known_aircraft = CannonballKnownAircraft.objects.filter(
                icao_hex=threat.hex
            ).first()

            if known_aircraft:
                known_aircraft.record_detection()
                threat_dict['known_le'] = True
                threat_dict['agency_name'] = known_aircraft.agency_name
                threat_dict['agency_type'] = known_aircraft.agency_type

            # Update or create session
            _update_cannonball_session(threat_dict, user_lat, user_lon)

        # Store threats in cache for API access
        if threats:
            # Sort by urgency
            threats.sort(key=lambda t: t.get('urgency_score', 0), reverse=True)
            cache.set('cannonball_threats', threats, timeout=30)
            cache.set('cannonball_threat_count', len(threats), timeout=30)

            # Broadcast to WebSocket
            _broadcast_threats(threats)

            logger.debug(f"Detected {len(threats)} potential LE aircraft")
        else:
            cache.set('cannonball_threats', [], timeout=30)
            cache.set('cannonball_threat_count', 0, timeout=30)

        elapsed = (datetime.now() - start_time).total_seconds()
        logger.debug(f"Cannonball analysis completed in {elapsed:.2f}s")

    except Exception as e:
        logger.exception(f"Error in analyze_aircraft_patterns: {e}")


def _update_cannonball_session(threat: dict, user_lat: float = None, user_lon: float = None):
    """Update or create a Cannonball session for a detected threat."""
    try:
        icao = threat.get('icao_hex')
        if not icao:
            return

        # Find active session or create new one
        session, created = CannonballSession.objects.get_or_create(
            icao_hex=icao,
            is_active=True,
            defaults={
                'callsign': threat.get('callsign'),
                'identification_method': threat.get('identification_method', 'pattern'),
                'identification_reason': threat.get('identification_reason'),
                'operator_name': threat.get('operator_name'),
                'operator_icao': threat.get('operator_icao'),
                'aircraft_type': threat.get('aircraft_type'),
                'threat_level': threat.get('threat_level', 'info'),
                'urgency_score': threat.get('urgency_score', 0),
                'last_lat': threat.get('lat'),
                'last_lon': threat.get('lon'),
                'last_altitude': threat.get('altitude'),
                'last_ground_speed': threat.get('ground_speed'),
                'last_track': threat.get('track'),
                'distance_nm': threat.get('distance_nm'),
                'bearing': threat.get('bearing'),
                'closing_speed_kts': threat.get('closing_speed'),
            }
        )

        if not created:
            # Update existing session
            session.callsign = threat.get('callsign') or session.callsign
            session.threat_level = threat.get('threat_level', session.threat_level)
            session.urgency_score = threat.get('urgency_score', session.urgency_score)
            session.last_lat = threat.get('lat')
            session.last_lon = threat.get('lon')
            session.last_altitude = threat.get('altitude')
            session.last_ground_speed = threat.get('ground_speed')
            session.last_track = threat.get('track')
            session.distance_nm = threat.get('distance_nm')
            session.bearing = threat.get('bearing')
            session.closing_speed_kts = threat.get('closing_speed')
            session.position_count += 1
            session.save()

        # Check for pattern detections
        patterns = threat.get('patterns', [])
        for pattern in patterns:
            _record_pattern(session, pattern, threat)

        # Generate alerts if needed
        _check_and_generate_alerts(session, threat)

    except Exception as e:
        logger.exception(f"Error updating Cannonball session: {e}")


def _record_pattern(session: CannonballSession, pattern: dict, threat: dict):
    """Record a detected pattern."""
    try:
        pattern_type = pattern.get('type')
        confidence = pattern.get('confidence', 0.5)

        # Determine confidence level
        if confidence >= 0.8:
            confidence_level = 'high'
        elif confidence >= 0.5:
            confidence_level = 'medium'
        else:
            confidence_level = 'low'

        # Check if we already have this pattern type active for this aircraft
        existing = CannonballPattern.objects.filter(
            session=session,
            pattern_type=pattern_type,
            ended_at__isnull=True,
        ).first()

        if existing:
            # Update existing pattern
            existing.confidence_score = confidence
            existing.confidence = confidence_level
            existing.pattern_data = pattern.get('data', {})
            existing.save()
        else:
            # Create new pattern
            CannonballPattern.objects.create(
                icao_hex=threat.get('icao_hex'),
                callsign=threat.get('callsign'),
                pattern_type=pattern_type,
                confidence=confidence_level,
                confidence_score=confidence,
                center_lat=pattern.get('center_lat', threat.get('lat', 0)),
                center_lon=pattern.get('center_lon', threat.get('lon', 0)),
                radius_nm=pattern.get('radius_nm'),
                pattern_data=pattern.get('data', {}),
                started_at=timezone.now(),
                session=session,
            )

            # Increment session pattern count
            session.increment_pattern_count()

    except Exception as e:
        logger.exception(f"Error recording pattern: {e}")


def _check_and_generate_alerts(session: CannonballSession, threat: dict):
    """Check if alerts should be generated for this session."""
    try:
        # Check for critical threat level
        if threat.get('threat_level') == 'critical':
            # Check cooldown (don't alert more than once per minute)
            recent_alert = CannonballAlert.objects.filter(
                session=session,
                alert_type='threat_escalated',
                created_at__gte=timezone.now() - timedelta(minutes=1),
            ).exists()

            if not recent_alert:
                _create_alert(
                    session=session,
                    alert_type='threat_escalated',
                    priority='critical',
                    title=f"Critical: {threat.get('callsign') or threat.get('icao_hex')}",
                    message=f"Law enforcement aircraft at {threat.get('distance_nm', '?')}nm, "
                            f"bearing {threat.get('bearing', '?')}°",
                    threat=threat,
                )

        # Check for closing fast
        closing_speed = threat.get('closing_speed', 0)
        if closing_speed and closing_speed > 50:  # More than 50 kts closing
            recent_alert = CannonballAlert.objects.filter(
                session=session,
                alert_type='closing_fast',
                created_at__gte=timezone.now() - timedelta(minutes=2),
            ).exists()

            if not recent_alert:
                _create_alert(
                    session=session,
                    alert_type='closing_fast',
                    priority='warning',
                    title=f"Closing: {threat.get('callsign') or threat.get('icao_hex')}",
                    message=f"Aircraft closing at {closing_speed:.0f} kts",
                    threat=threat,
                )

        # Check for overhead (within 1nm)
        distance = threat.get('distance_nm', 999)
        if distance < 1:
            recent_alert = CannonballAlert.objects.filter(
                session=session,
                alert_type='overhead',
                created_at__gte=timezone.now() - timedelta(minutes=5),
            ).exists()

            if not recent_alert:
                _create_alert(
                    session=session,
                    alert_type='overhead',
                    priority='critical',
                    title=f"Overhead: {threat.get('callsign') or threat.get('icao_hex')}",
                    message=f"Aircraft is directly overhead at {threat.get('altitude', '?')}ft",
                    threat=threat,
                )

    except Exception as e:
        logger.exception(f"Error checking alerts: {e}")


def _create_alert(session: CannonballSession, alert_type: str, priority: str,
                  title: str, message: str, threat: dict, pattern: CannonballPattern = None):
    """Create a Cannonball alert."""
    try:
        alert = CannonballAlert.objects.create(
            session=session,
            alert_type=alert_type,
            priority=priority,
            title=title,
            message=message,
            aircraft_lat=threat.get('lat'),
            aircraft_lon=threat.get('lon'),
            aircraft_altitude=threat.get('altitude'),
            distance_nm=threat.get('distance_nm'),
            bearing=threat.get('bearing'),
            pattern=pattern,
            user=session.user,
        )

        session.increment_alert_count()

        # Broadcast alert
        _broadcast_alert(alert, threat)

        logger.info(f"Created Cannonball alert: {alert_type} - {title}")

    except Exception as e:
        logger.exception(f"Error creating alert: {e}")


def _broadcast_threats(threats: list):
    """Broadcast threat updates via WebSocket."""
    try:
        channel_layer = get_channel_layer()
        timestamp = timezone.now().isoformat().replace('+00:00', 'Z')

        sync_group_send(
            channel_layer,
            'cannonball_threats',
            {
                'type': 'threats_update',
                'data': {
                    'threats': threats,
                    'count': len(threats),
                    'timestamp': timestamp,
                }
            }
        )
    except Exception as e:
        logger.debug(f"Failed to broadcast threats: {e}")


def _broadcast_alert(alert: CannonballAlert, threat: dict):
    """Broadcast a new alert via WebSocket."""
    try:
        channel_layer = get_channel_layer()

        sync_group_send(
            channel_layer,
            'cannonball_alerts',
            {
                'type': 'new_alert',
                'data': {
                    'id': alert.id,
                    'alert_type': alert.alert_type,
                    'priority': alert.priority,
                    'title': alert.title,
                    'message': alert.message,
                    'icao_hex': alert.session.icao_hex,
                    'callsign': alert.session.callsign,
                    'distance_nm': alert.distance_nm,
                    'bearing': alert.bearing,
                    'timestamp': alert.created_at.isoformat().replace('+00:00', 'Z'),
                    'threat': threat,
                }
            }
        )
    except Exception as e:
        logger.debug(f"Failed to broadcast alert: {e}")


@shared_task
def cleanup_cannonball_sessions():
    """
    Clean up stale Cannonball sessions.

    Mark sessions as inactive when aircraft haven't been seen
    for the configured timeout period.
    """
    timeout_minutes = getattr(settings, 'CANNONBALL_SESSION_TIMEOUT_MINUTES', 15)
    cutoff = timezone.now() - timedelta(minutes=timeout_minutes)

    # Find and deactivate stale sessions
    stale_sessions = CannonballSession.objects.filter(
        is_active=True,
        last_seen__lt=cutoff,
    )

    count = stale_sessions.count()
    if count > 0:
        for session in stale_sessions:
            session.end_session()

            # End any active patterns
            CannonballPattern.objects.filter(
                session=session,
                ended_at__isnull=True,
            ).update(ended_at=timezone.now())

        logger.info(f"Deactivated {count} stale Cannonball sessions")


@shared_task
def cleanup_old_patterns():
    """
    Clean up old pattern records.

    Delete patterns older than the retention period.
    """
    retention_days = getattr(settings, 'CANNONBALL_PATTERN_RETENTION_DAYS', 30)
    cutoff = timezone.now() - timedelta(days=retention_days)

    deleted, _ = CannonballPattern.objects.filter(
        detected_at__lt=cutoff
    ).delete()

    if deleted:
        logger.info(f"Deleted {deleted} old Cannonball patterns")


@shared_task
def aggregate_cannonball_stats():
    """
    Aggregate Cannonball statistics for the past hour.

    Creates hourly stats records for trending and analysis.
    """
    now = timezone.now()
    hour_start = now.replace(minute=0, second=0, microsecond=0)
    hour_end = hour_start + timedelta(hours=1)

    # Check if we already have stats for this hour
    existing = CannonballStats.objects.filter(
        period_type='hourly',
        period_start=hour_start,
        user__isnull=True,  # Global stats
    ).exists()

    if existing:
        return

    # Get sessions active during this hour
    sessions = CannonballSession.objects.filter(
        first_seen__lt=hour_end,
        last_seen__gte=hour_start,
    )

    # Get alerts during this hour
    alerts = CannonballAlert.objects.filter(
        created_at__gte=hour_start,
        created_at__lt=hour_end,
    )

    # Get patterns during this hour
    patterns = CannonballPattern.objects.filter(
        detected_at__gte=hour_start,
        detected_at__lt=hour_end,
    )

    # Calculate stats
    unique_aircraft = sessions.values('icao_hex').distinct().count()

    # Create stats record
    CannonballStats.objects.create(
        period_type='hourly',
        period_start=hour_start,
        period_end=hour_end,
        total_detections=sessions.count(),
        unique_aircraft=unique_aircraft,
        critical_alerts=alerts.filter(priority='critical').count(),
        warning_alerts=alerts.filter(priority='warning').count(),
        info_alerts=alerts.filter(priority='info').count(),
        circling_patterns=patterns.filter(pattern_type='circling').count(),
        loitering_patterns=patterns.filter(pattern_type='loitering').count(),
        grid_search_patterns=patterns.filter(pattern_type='grid_search').count(),
        speed_trap_patterns=patterns.filter(pattern_type='speed_trap').count(),
        top_aircraft=list(
            sessions.values('icao_hex', 'callsign', 'operator_name')
            .annotate(count=models.Count('id'))
            .order_by('-count')[:10]
        ),
    )

    logger.info(f"Created hourly Cannonball stats for {hour_start}")


@shared_task
def update_user_location(user_id: int, lat: float, lon: float):
    """
    Update user location for Cannonball tracking.

    Called when a user in Cannonball mode sends their GPS location.
    """
    cache_key = f'cannonball_user_{user_id}_location'
    cache.set(cache_key, {'lat': lat, 'lon': lon, 'timestamp': timezone.now().isoformat()}, timeout=300)

    # Also update global user location if this is the active Cannonball user
    active_user = cache.get('cannonball_active_user')
    if active_user == user_id:
        cache.set('cannonball_user_lat', lat, timeout=60)
        cache.set('cannonball_user_lon', lon, timeout=60)


@shared_task
def set_active_cannonball_user(user_id: int):
    """Set the active Cannonball mode user for threat calculations."""
    cache.set('cannonball_active_user', user_id, timeout=3600)
    logger.info(f"Set active Cannonball user: {user_id}")


@shared_task
def clear_active_cannonball_user(user_id: int):
    """Clear the active Cannonball mode user."""
    active_user = cache.get('cannonball_active_user')
    if active_user == user_id:
        cache.delete('cannonball_active_user')
        cache.delete('cannonball_user_lat')
        cache.delete('cannonball_user_lon')
        logger.info(f"Cleared active Cannonball user: {user_id}")


# Import models for aggregation query
from django.db import models
