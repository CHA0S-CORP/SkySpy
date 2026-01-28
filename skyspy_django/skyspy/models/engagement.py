"""
Engagement tracking models for user activity analytics.

Provides:
- AircraftFavorite: Track favorited/watched aircraft per user
- SessionAnalytics: Enhanced session tracking with quality metrics
"""
from django.db import models, transaction, IntegrityError
from django.contrib.auth.models import User


class AircraftFavorite(models.Model):
    """
    Track user favorites/watched aircraft for engagement analytics.

    Supports both authenticated users and anonymous sessions.
    """

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='favorite_aircraft',
        help_text='User who favorited this aircraft (null for anonymous)'
    )
    session_key = models.CharField(
        max_length=40,
        blank=True,
        null=True,
        db_index=True,
        help_text='Session key for anonymous users'
    )
    icao_hex = models.CharField(
        max_length=10,
        db_index=True,
        help_text='ICAO hex code of favorited aircraft'
    )
    registration = models.CharField(
        max_length=20,
        blank=True,
        null=True,
        help_text='Registration at time of favorite (if known)'
    )
    callsign = models.CharField(
        max_length=10,
        blank=True,
        null=True,
        help_text='Last seen callsign'
    )
    notes = models.TextField(
        blank=True,
        null=True,
        help_text='User notes about this aircraft'
    )

    # Engagement tracking
    times_seen = models.IntegerField(
        default=0,
        help_text='Number of times this aircraft was seen while favorited'
    )
    last_seen_at = models.DateTimeField(
        blank=True,
        null=True,
        help_text='Last time this aircraft was tracked'
    )
    total_tracking_minutes = models.FloatField(
        default=0.0,
        help_text='Total minutes this aircraft was tracked'
    )

    # Notification preferences
    notify_on_detection = models.BooleanField(
        default=True,
        help_text='Notify when this aircraft is detected'
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'aircraft_favorites'
        unique_together = [
            ['user', 'icao_hex'],
            ['session_key', 'icao_hex'],
        ]
        indexes = [
            models.Index(fields=['icao_hex', 'created_at'], name='idx_fav_icao_created'),
            models.Index(fields=['user', 'last_seen_at'], name='idx_fav_user_seen'),
        ]
        ordering = ['-updated_at']

    def __str__(self):
        owner = self.user.username if self.user else f"session:{self.session_key[:8] if self.session_key else 'anon'}"
        return f"{owner} -> {self.icao_hex}"

    @classmethod
    @transaction.atomic
    def toggle_favorite(cls, icao_hex, user=None, session_key=None, registration=None):
        """Toggle favorite status for an aircraft."""
        if not user and not session_key:
            raise ValueError("Either user or session_key is required")

        filters = {'icao_hex': icao_hex.upper()}
        if user:
            filters['user'] = user
            filters['session_key'] = None
        else:
            filters['session_key'] = session_key
            filters['user'] = None

        # Use select_for_update to prevent race conditions
        existing = cls.objects.select_for_update().filter(**filters).first()
        if existing:
            existing.delete()
            return None, False
        else:
            try:
                favorite = cls.objects.create(
                    icao_hex=icao_hex.upper(),
                    user=user,
                    session_key=session_key if not user else None,
                    registration=registration,
                )
                return favorite, True
            except IntegrityError:
                # Race condition: another request created it, so delete it
                existing = cls.objects.select_for_update().filter(**filters).first()
                if existing:
                    existing.delete()
                return None, False

    @classmethod
    def is_favorite(cls, icao_hex, user=None, session_key=None):
        """Check if an aircraft is favorited."""
        filters = {'icao_hex': icao_hex.upper()}
        if user:
            filters['user'] = user
        elif session_key:
            filters['session_key'] = session_key
        else:
            return False

        return cls.objects.filter(**filters).exists()


class SessionTrackingQuality(models.Model):
    """
    Extended session analytics with tracking quality metrics.

    Links to AircraftSession and provides detailed quality analysis.
    """

    session = models.OneToOneField(
        'skyspy.AircraftSession',
        on_delete=models.CASCADE,
        related_name='quality_metrics',
        help_text='Related aircraft session'
    )

    # Position update rate metrics
    expected_positions = models.IntegerField(
        default=0,
        help_text='Expected positions based on update interval'
    )
    actual_positions = models.IntegerField(
        default=0,
        help_text='Actual positions received'
    )
    completeness_score = models.FloatField(
        default=0.0,
        help_text='Percentage of expected positions received (0-100)'
    )
    avg_update_rate = models.FloatField(
        default=0.0,
        help_text='Average positions per minute during tracking'
    )

    # Coverage gap metrics
    total_gaps = models.IntegerField(
        default=0,
        help_text='Number of gaps exceeding threshold'
    )
    max_gap_seconds = models.IntegerField(
        default=0,
        help_text='Longest gap between positions (seconds)'
    )
    avg_gap_seconds = models.FloatField(
        default=0.0,
        help_text='Average gap between positions (seconds)'
    )
    gap_percentage = models.FloatField(
        default=0.0,
        help_text='Percentage of session time in gaps'
    )

    # Signal quality indicators
    avg_rssi = models.FloatField(
        blank=True,
        null=True,
        help_text='Average signal strength during session'
    )
    rssi_variance = models.FloatField(
        blank=True,
        null=True,
        help_text='Variance in signal strength'
    )

    # Quality classification
    QUALITY_EXCELLENT = 'excellent'
    QUALITY_GOOD = 'good'
    QUALITY_FAIR = 'fair'
    QUALITY_POOR = 'poor'

    QUALITY_CHOICES = [
        (QUALITY_EXCELLENT, 'Excellent'),
        (QUALITY_GOOD, 'Good'),
        (QUALITY_FAIR, 'Fair'),
        (QUALITY_POOR, 'Poor'),
    ]

    quality_grade = models.CharField(
        max_length=20,
        choices=QUALITY_CHOICES,
        default=QUALITY_FAIR,
        help_text='Overall quality grade'
    )

    calculated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'session_tracking_quality'
        indexes = [
            models.Index(fields=['quality_grade', 'completeness_score'], name='idx_quality_grade'),
        ]

    def __str__(self):
        return f"Quality for {self.session.icao_hex}: {self.quality_grade} ({self.completeness_score:.1f}%)"

    def calculate_quality_grade(self):
        """Calculate quality grade based on metrics."""
        score = self.completeness_score

        if score >= 90 and self.max_gap_seconds <= 30:
            self.quality_grade = self.QUALITY_EXCELLENT
        elif score >= 70 and self.max_gap_seconds <= 60:
            self.quality_grade = self.QUALITY_GOOD
        elif score >= 50:
            self.quality_grade = self.QUALITY_FAIR
        else:
            self.quality_grade = self.QUALITY_POOR

        return self.quality_grade
