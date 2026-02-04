"""
Comprehensive unit tests for all SkySpy Django models.

This module tests all 15 model modules covering:
- Field validation and constraints
- Model methods and properties
- String representations (__str__)
- Default values
- Required vs optional fields
- Relationships and foreign keys
- Custom managers and querysets
"""

import hashlib
import os
import re
import secrets
import uuid
from datetime import date, datetime, time, timedelta

import pytest


def unique_name(prefix: str = "test") -> str:
    """Generate a unique name to avoid constraint violations."""
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.db import IntegrityError
from django.utils import timezone

from skyspy.models import (
    # ACARS
    AcarsMessage,
    # Engagement
    AircraftFavorite,
    # Aircraft
    AircraftInfo,
    AircraftSession,
    AircraftSighting,
    AirframeSourceData,
    # Airspace
    AirspaceAdvisory,
    AirspaceBoundary,
    # Alerts
    AlertAggregate,
    AlertHistory,
    AlertRule,
    AlertSubscription,
    # Antenna
    AntennaAnalyticsSnapshot,
    # Auth
    APIKey,
    # Audio
    AudioTransmission,
    # NOTAMs
    CachedAircraftType,
    CachedAirline,
    # Aviation
    CachedAirport,
    CachedGeoJSON,
    CachedNavaid,
    CachedNotam,
    CachedPirep,
    # Cannonball
    CannonballAlert,
    CannonballKnownAircraft,
    CannonballPattern,
    CannonballSession,
    CannonballStats,
    # Config
    ConfigAuditLog,
    # Stats
    DailyStats,
    FeatureAccess,
    NotableCallsign,
    NotableRegistration,
    # Notifications
    NotificationChannel,
    NotificationConfig,
    NotificationLog,
    NotificationTemplate,
    OIDCClaimMapping,
    PersonalRecord,
    RareAircraftType,
    RareSighting,
    Role,
    # Safety
    SafetyEvent,
    SessionTrackingQuality,
    SightingStreak,
    SkyspyUser,
    SpottedAircraft,
    SpottedCount,
    SystemConfig,
    UserNotificationPreference,
    UserRole,
)
from skyspy.tests.factories import (
    AcarsMessageFactory,
    AircraftInfoFactory,
    AircraftSessionFactory,
    AircraftSightingFactory,
    AlertHistoryFactory,
    AlertRuleFactory,
    AudioTransmissionFactory,
    NotificationConfigFactory,
    NotificationLogFactory,
    SafetyEventFactory,
)

# =============================================================================
# Auth Models Tests (models/auth.py)
# =============================================================================


@pytest.mark.django_db
class TestSkyspyUser:
    """Tests for SkyspyUser model."""

    def test_create_skyspy_user(self):
        """Test creating a SkyspyUser with basic fields."""
        user = User.objects.create_user(username=unique_name("testuser"), password="testpass123")
        profile = SkyspyUser.objects.create(user=user, display_name="Test User", auth_provider="local")

        assert profile.user == user
        assert profile.display_name == "Test User"
        assert profile.auth_provider == "local"
        assert profile.preferences == {}

    def test_str_representation_with_display_name(self):
        """Test __str__ returns display_name when set."""
        user = User.objects.create_user(username=unique_name("testuser2"), password="testpass123")
        profile = SkyspyUser.objects.create(user=user, display_name="John Doe")

        assert str(profile) == "John Doe"

    def test_str_representation_without_display_name(self):
        """Test __str__ returns username when display_name is not set."""
        username = unique_name("testuser3")
        user = User.objects.create_user(username=username, password="testpass123")
        profile = SkyspyUser.objects.create(user=user)

        assert str(profile) == username

    def test_is_oidc_user_property(self):
        """Test is_oidc_user property."""
        user = User.objects.create_user(username=unique_name("oidcuser"), password="testpass123")
        profile = SkyspyUser.objects.create(user=user, auth_provider="oidc")

        assert profile.is_oidc_user is True

        profile.auth_provider = "local"
        assert profile.is_oidc_user is False

    def test_oidc_subject_unique_constraint(self):
        """Test that oidc_subject must be unique."""
        user1 = User.objects.create_user(username=unique_name("user1"), password="pass1")
        user2 = User.objects.create_user(username=unique_name("user2"), password="pass2")

        SkyspyUser.objects.create(user=user1, oidc_subject="unique_subject")

        with pytest.raises(IntegrityError):
            SkyspyUser.objects.create(user=user2, oidc_subject="unique_subject")

    def test_get_all_permissions(self):
        """Test get_all_permissions aggregates from all roles."""
        user = User.objects.create_user(username=unique_name("permuser"), password="testpass123")
        profile = SkyspyUser.objects.create(user=user)

        role1 = Role.objects.create(name=unique_name("role1"), display_name="Role 1", permissions=["perm1", "perm2"])
        role2 = Role.objects.create(name=unique_name("role2"), display_name="Role 2", permissions=["perm2", "perm3"])

        UserRole.objects.create(user=user, role=role1)
        UserRole.objects.create(user=user, role=role2)

        permissions = profile.get_all_permissions()
        assert set(permissions) == {"perm1", "perm2", "perm3"}

    def test_has_permission(self):
        """Test has_permission checks against aggregated permissions."""
        user = User.objects.create_user(username=unique_name("haspermuser"), password="testpass123")
        profile = SkyspyUser.objects.create(user=user)

        role = Role.objects.create(name=unique_name("testrole"), display_name="Test Role", permissions=["test.view"])
        UserRole.objects.create(user=user, role=role)

        assert profile.has_permission("test.view") is True
        assert profile.has_permission("test.edit") is False

    def test_superuser_has_all_permissions(self):
        """Test that superuser has all permissions."""
        user = User.objects.create_superuser(username=unique_name("superuser"), password="testpass123")
        profile = SkyspyUser.objects.create(user=user)

        assert profile.has_permission("any.permission") is True
        assert profile.has_any_permission(["foo", "bar"]) is True
        assert profile.has_all_permissions(["foo", "bar", "baz"]) is True

    def test_expired_role_excluded_from_permissions(self):
        """Test that expired roles are excluded from permissions."""
        user = User.objects.create_user(username=unique_name("expireduser"), password="testpass123")
        profile = SkyspyUser.objects.create(user=user)

        role = Role.objects.create(
            name=unique_name("expired_role"), display_name="Expired", permissions=["expired.perm"]
        )
        UserRole.objects.create(user=user, role=role, expires_at=timezone.now() - timedelta(days=1))

        assert profile.has_permission("expired.perm") is False


@pytest.mark.django_db
class TestRole:
    """Tests for Role model."""

    def test_create_role(self):
        """Test creating a role with basic fields."""
        role_name = unique_name("viewer")
        role = Role.objects.create(
            name=role_name,
            display_name="Viewer Role",
            description="Read-only access",
            permissions=["view.aircraft", "view.alerts"],
            priority=10,
        )

        assert role.name == role_name
        assert role.display_name == "Viewer Role"
        assert "view.aircraft" in role.permissions
        assert role.is_system is False

    def test_str_representation(self):
        """Test __str__ returns display_name."""
        role = Role.objects.create(name=unique_name("admin"), display_name="Administrator Test")
        assert str(role) == "Administrator Test"

    def test_unique_name_constraint(self):
        """Test that role names must be unique."""
        role_name = unique_name("unique_role")
        Role.objects.create(name=role_name, display_name="Unique Role")

        with pytest.raises(IntegrityError):
            Role.objects.create(name=role_name, display_name="Another Role")

    def test_default_permissions_is_empty_list(self):
        """Test that permissions defaults to empty list."""
        role = Role.objects.create(name=unique_name("empty_role"), display_name="Empty")
        assert role.permissions == []

    def test_role_ordering(self):
        """Test that roles are ordered by priority descending, then name."""
        # Clear existing roles to test ordering properly
        Role.objects.all().delete()

        Role.objects.create(name="aaa_low", display_name="Low", priority=10)
        Role.objects.create(name="aaa_high", display_name="High", priority=100)
        Role.objects.create(name="aaa_medium", display_name="Medium", priority=50)

        roles = list(Role.objects.all().values_list("name", flat=True))
        assert roles == ["aaa_high", "aaa_medium", "aaa_low"]


@pytest.mark.django_db
class TestUserRole:
    """Tests for UserRole model."""

    def test_create_user_role(self):
        """Test creating a user-role assignment."""
        user = User.objects.create_user(username=unique_name("roleuser"), password="pass")
        role = Role.objects.create(name=unique_name("test_role"), display_name="Test Role")

        user_role = UserRole.objects.create(user=user, role=role)

        assert user_role.user == user
        assert user_role.role == role
        assert user_role.expires_at is None

    def test_str_representation(self):
        """Test __str__ format."""
        username = unique_name("struser")
        role_name = unique_name("str_role")
        user = User.objects.create_user(username=username, password="pass")
        role = Role.objects.create(name=role_name, display_name="String Role")

        user_role = UserRole.objects.create(user=user, role=role)
        assert str(user_role) == f"{username} - {role_name}"

    def test_is_expired_property(self):
        """Test is_expired property."""
        user = User.objects.create_user(username=unique_name("expuser"), password="pass")
        role = Role.objects.create(name=unique_name("exp_role"), display_name="Expired Role")

        # Not expired (no expiration)
        user_role = UserRole.objects.create(user=user, role=role)
        assert user_role.is_expired is False

        # Not expired (future expiration)
        user_role.expires_at = timezone.now() + timedelta(days=1)
        assert user_role.is_expired is False

        # Expired (past expiration)
        user_role.expires_at = timezone.now() - timedelta(days=1)
        assert user_role.is_expired is True

    def test_unique_together_constraint(self):
        """Test that user-role combination must be unique."""
        user = User.objects.create_user(username=unique_name("uniquser"), password="pass")
        role = Role.objects.create(name=unique_name("uniq_role"), display_name="Unique Role")

        UserRole.objects.create(user=user, role=role)

        with pytest.raises(IntegrityError):
            UserRole.objects.create(user=user, role=role)


@pytest.mark.django_db
class TestAPIKey:
    """Tests for APIKey model."""

    def test_generate_key(self):
        """Test API key generation."""
        key, key_hash, key_prefix = APIKey.generate_key()

        assert key.startswith("sk_")
        assert len(key_hash) == 64  # SHA-256 hex
        assert key_prefix == key[:10]

    def test_hash_key(self):
        """Test key hashing."""
        key = "sk_test_key_12345"
        expected_hash = hashlib.sha256(key.encode()).hexdigest()

        assert APIKey.hash_key(key) == expected_hash

    def test_create_api_key(self):
        """Test creating an API key."""
        user = User.objects.create_user(username=unique_name("apiuser"), password="pass")
        key, key_hash, key_prefix = APIKey.generate_key()

        api_key = APIKey.objects.create(user=user, name="Test Key", key_hash=key_hash, key_prefix=key_prefix)

        assert api_key.name == "Test Key"
        assert api_key.is_active is True
        assert api_key.scopes == []

    def test_str_representation(self):
        """Test __str__ format."""
        user = User.objects.create_user(username=unique_name("strapi"), password="pass")
        api_key = APIKey.objects.create(user=user, name="My API Key", key_hash="abc123", key_prefix="sk_abc123")

        assert str(api_key) == "My API Key (sk_abc123...)"

    def test_is_valid_method(self):
        """Test is_valid checks active and not expired."""
        user = User.objects.create_user(username=unique_name("validapi"), password="pass")
        api_key = APIKey.objects.create(user=user, name="Valid Key", key_hash="hash1", key_prefix="sk_pref")

        # Active and not expired
        assert api_key.is_valid() is True

        # Inactive
        api_key.is_active = False
        assert api_key.is_valid() is False

        # Active but expired
        api_key.is_active = True
        api_key.expires_at = timezone.now() - timedelta(days=1)
        assert api_key.is_valid() is False


@pytest.mark.django_db
class TestFeatureAccess:
    """Tests for FeatureAccess model."""

    def test_create_feature_access(self):
        """Test creating feature access configuration."""
        feature = FeatureAccess.objects.create(
            feature="aircraft",
            read_access="public",
            write_access="permission",
            is_enabled=True,
        )

        assert feature.feature == "aircraft"
        assert feature.read_access == "public"
        assert feature.is_enabled is True

    def test_str_representation(self):
        """Test __str__ format."""
        feature = FeatureAccess.objects.create(feature="alerts", read_access="authenticated", write_access="permission")

        # get_feature_display() returns "Alert Rules" for "alerts"
        assert "Alert Rules" in str(feature)
        assert "authenticated" in str(feature)
        assert "permission" in str(feature)


@pytest.mark.django_db
class TestOIDCClaimMapping:
    """Tests for OIDCClaimMapping model."""

    def test_create_claim_mapping(self):
        """Test creating an OIDC claim mapping."""
        role = Role.objects.create(name=unique_name("mapped_role"), display_name="Mapped Role")
        mapping = OIDCClaimMapping.objects.create(
            name="Admin Group Mapping",
            claim_name="groups",
            match_type="exact",
            claim_value="admin",
            role=role,
        )

        assert mapping.claim_name == "groups"
        assert mapping.match_type == "exact"
        assert mapping.role == role

    def test_str_representation(self):
        """Test __str__ format."""
        role = Role.objects.create(name=unique_name("str_mapped"), display_name="String Mapped")
        mapping = OIDCClaimMapping.objects.create(
            name="Test Mapping",
            claim_name="groups",
            match_type="contains",
            claim_value="admin",
            role=role,
        )

        assert "Test Mapping" in str(mapping)
        assert "groups" in str(mapping)
        assert "admin" in str(mapping)

    def test_matches_exact(self):
        """Test exact match type."""
        role = Role.objects.create(name=unique_name("exact_role"), display_name="Exact Role")
        mapping = OIDCClaimMapping.objects.create(
            name="Exact",
            claim_name="role",
            match_type="exact",
            claim_value="admin",
            role=role,
        )

        assert mapping.matches({"role": "admin"}) is True
        assert mapping.matches({"role": "administrator"}) is False
        assert mapping.matches({"role": ["admin", "user"]}) is True
        assert mapping.matches({"other": "admin"}) is False

    def test_matches_contains(self):
        """Test contains match type."""
        role = Role.objects.create(name=unique_name("contains_role"), display_name="Contains Role")
        mapping = OIDCClaimMapping.objects.create(
            name="Contains",
            claim_name="email",
            match_type="contains",
            claim_value="@company.com",
            role=role,
        )

        assert mapping.matches({"email": "user@company.com"}) is True
        assert mapping.matches({"email": "user@other.com"}) is False

    def test_matches_regex(self):
        """Test regex match type."""
        role = Role.objects.create(name=unique_name("regex_role"), display_name="Regex Role")
        mapping = OIDCClaimMapping.objects.create(
            name="Regex",
            claim_name="groups",
            match_type="regex",
            claim_value=r"^admin-.*",
            role=role,
        )

        assert mapping.matches({"groups": "admin-team"}) is True
        assert mapping.matches({"groups": "user-team"}) is False


# =============================================================================
# Config Models Tests (models/config.py)
# =============================================================================


@pytest.mark.django_db
class TestSystemConfig:
    """Tests for SystemConfig model."""

    def test_create_system_config(self):
        """Test creating a system configuration."""
        config = SystemConfig.objects.create(
            key="test.setting",
            category="advanced",
            value="100",
            value_type="integer",
            display_name="Test Setting",
            default_value="50",
        )

        assert config.key == "test.setting"
        assert config.value == "100"
        assert config.value_type == "integer"

    def test_str_representation(self):
        """Test __str__ format."""
        config = SystemConfig.objects.create(
            key="display.test",
            category="display",
            display_name="Display Test Setting",
        )

        assert "Display Test Setting" in str(config)
        assert "display.test" in str(config)

    def test_get_typed_value_integer(self):
        """Test get_typed_value for integers."""
        config = SystemConfig.objects.create(
            key="int.setting",
            category="advanced",
            value="42",
            value_type="integer",
            display_name="Integer Setting",
        )

        assert config.get_typed_value() == 42
        assert isinstance(config.get_typed_value(), int)

    def test_get_typed_value_float(self):
        """Test get_typed_value for floats."""
        config = SystemConfig.objects.create(
            key="float.setting",
            category="advanced",
            value="3.14",
            value_type="float",
            display_name="Float Setting",
        )

        assert config.get_typed_value() == 3.14
        assert isinstance(config.get_typed_value(), float)

    def test_get_typed_value_boolean(self):
        """Test get_typed_value for booleans."""
        config = SystemConfig.objects.create(
            key="bool.setting",
            category="advanced",
            value="true",
            value_type="boolean",
            display_name="Boolean Setting",
        )

        assert config.get_typed_value() is True

        config.value = "false"
        config.save()
        assert config.get_typed_value() is False

    def test_get_typed_value_json(self):
        """Test get_typed_value for JSON."""
        config = SystemConfig.objects.create(
            key="json.setting",
            category="advanced",
            value='{"key": "value", "count": 10}',
            value_type="json",
            display_name="JSON Setting",
        )

        result = config.get_typed_value()
        assert result == {"key": "value", "count": 10}

    def test_validate_value_integer_range(self):
        """Test validation rules for integer range."""
        config = SystemConfig.objects.create(
            key="range.setting",
            category="advanced",
            value="50",
            value_type="integer",
            display_name="Range Setting",
            validation_rules={"min": 0, "max": 100},
        )

        # Valid value
        assert config.validate_value("50") == []

        # Below min
        errors = config.validate_value("-10")
        assert len(errors) > 0
        assert "at least" in errors[0].lower()

        # Above max
        errors = config.validate_value("150")
        assert len(errors) > 0
        assert "at most" in errors[0].lower()

    def test_validate_value_required(self):
        """Test validation for required fields."""
        config = SystemConfig.objects.create(
            key="required.setting",
            category="advanced",
            value="",
            value_type="string",
            display_name="Required Setting",
            validation_rules={"required": True},
        )

        errors = config.validate_value("")
        assert len(errors) > 0
        assert "required" in errors[0].lower()

    def test_get_masked_value(self):
        """Test masking sensitive values."""
        config = SystemConfig.objects.create(
            key="sensitive.setting",
            category="external_apis",
            value="secret_api_key_12345",
            value_type="secret",
            display_name="API Key",
            is_sensitive=True,
        )

        assert config.get_masked_value() == "****"

        config.is_sensitive = False
        assert config.get_masked_value() == "secret_api_key_12345"

    def test_class_method_get_value(self):
        """Test the get_value class method."""
        SystemConfig.objects.create(
            key="class.method.test",
            category="advanced",
            value="test_value",
            value_type="string",
            display_name="Class Method Test",
        )

        assert SystemConfig.get_value("class.method.test") == "test_value"
        assert SystemConfig.get_value("nonexistent.key", "default") == "default"


@pytest.mark.django_db
class TestConfigAuditLog:
    """Tests for ConfigAuditLog model."""

    def test_create_audit_log(self):
        """Test creating a configuration audit log."""
        user = User.objects.create_user(username=unique_name("auditor"), password="pass")
        log = ConfigAuditLog.objects.create(
            config_key="test.key",
            old_value="old",
            new_value="new",
            changed_by=user,
        )

        assert log.config_key == "test.key"
        assert log.old_value == "old"
        assert log.new_value == "new"
        assert log.changed_by == user

    def test_str_representation(self):
        """Test __str__ format."""
        user = User.objects.create_user(username=unique_name("loguser"), password="pass")
        log = ConfigAuditLog.objects.create(config_key="log.key", old_value="a", new_value="b", changed_by=user)

        assert "log.key" in str(log)
        assert "loguser" in str(log)

    def test_str_without_user(self):
        """Test __str__ when no user (system change)."""
        log = ConfigAuditLog.objects.create(config_key="system.key", old_value="x", new_value="y")

        assert "system.key" in str(log)
        assert "system" in str(log).lower()


# =============================================================================
# Stats Models Tests (models/stats.py)
# =============================================================================


@pytest.mark.django_db
class TestPersonalRecord:
    """Tests for PersonalRecord model."""

    def test_create_personal_record(self):
        """Test creating a personal record."""
        record = PersonalRecord.objects.create(
            record_type="max_distance",
            icao_hex="A12345",
            callsign="UAL123",
            value=250.5,
            achieved_at=timezone.now(),
        )

        assert record.record_type == "max_distance"
        assert record.icao_hex == "A12345"
        assert record.value == 250.5

    def test_str_representation(self):
        """Test __str__ format."""
        record = PersonalRecord.objects.create(
            record_type="max_altitude",
            icao_hex="A67890",
            value=45000,
            achieved_at=timezone.now(),
        )

        assert "Highest Altitude Aircraft" in str(record)
        assert "45000" in str(record)
        assert "A67890" in str(record)

    def test_unique_record_type(self):
        """Test that record_type is unique."""
        PersonalRecord.objects.create(
            record_type="max_speed",
            icao_hex="A11111",
            value=600,
            achieved_at=timezone.now(),
        )

        with pytest.raises(IntegrityError):
            PersonalRecord.objects.create(
                record_type="max_speed",
                icao_hex="A22222",
                value=650,
                achieved_at=timezone.now(),
            )


@pytest.mark.django_db
class TestRareSighting:
    """Tests for RareSighting model."""

    def test_create_rare_sighting(self):
        """Test creating a rare sighting."""
        sighting = RareSighting.objects.create(
            rarity_type="military",
            icao_hex="AE1234",
            registration="12-0345",
            sighted_at=timezone.now(),
            rarity_score=8,
        )

        assert sighting.rarity_type == "military"
        assert sighting.rarity_score == 8
        assert sighting.times_seen == 1

    def test_str_representation(self):
        """Test __str__ format."""
        sighting = RareSighting.objects.create(
            rarity_type="government",
            icao_hex="A00001",
            registration="N1",
            sighted_at=timezone.now(),
        )

        assert "Government/State Aircraft" in str(sighting)
        assert "A00001" in str(sighting)


@pytest.mark.django_db
class TestSpottedCount:
    """Tests for SpottedCount model."""

    def test_create_spotted_count(self):
        """Test creating a spotted count."""
        count = SpottedCount.objects.create(
            count_type="operator",
            identifier="UAL",
            display_name="United Airlines",
            unique_aircraft=150,
            total_sightings=5000,
        )

        assert count.count_type == "operator"
        assert count.identifier == "UAL"
        assert count.unique_aircraft == 150

    def test_str_representation(self):
        """Test __str__ format."""
        count = SpottedCount.objects.create(
            count_type="aircraft_type",
            identifier="B738",
            display_name="Boeing 737-800",
            unique_aircraft=75,
        )

        assert "By Aircraft Type" in str(count)
        assert "Boeing 737-800" in str(count)
        assert "75" in str(count)


@pytest.mark.django_db
class TestSpottedAircraft:
    """Tests for SpottedAircraft model."""

    def test_create_spotted_aircraft(self):
        """Test creating a spotted aircraft record."""
        now = timezone.now()
        aircraft = SpottedAircraft.objects.create(
            icao_hex="A12345",
            registration="N12345",
            aircraft_type="B738",
            first_seen=now,
            last_seen=now,
            times_seen=5,
        )

        assert aircraft.icao_hex == "A12345"
        assert aircraft.times_seen == 5
        assert aircraft.is_military is False

    def test_str_representation(self):
        """Test __str__ format."""
        now = timezone.now()
        aircraft = SpottedAircraft.objects.create(
            icao_hex="A99999",
            registration="N99999",
            first_seen=now,
            last_seen=now,
            times_seen=10,
        )

        assert "A99999" in str(aircraft)
        assert "N99999" in str(aircraft)
        assert "10x" in str(aircraft)


@pytest.mark.django_db
class TestSightingStreak:
    """Tests for SightingStreak model."""

    def test_create_sighting_streak(self):
        """Test creating a sighting streak."""
        streak = SightingStreak.objects.create(
            streak_type="any_sighting",
            current_streak_days=7,
            current_streak_start=date.today() - timedelta(days=7),
            best_streak_days=14,
        )

        assert streak.streak_type == "any_sighting"
        assert streak.current_streak_days == 7
        assert streak.best_streak_days == 14

    def test_str_representation(self):
        """Test __str__ format."""
        streak = SightingStreak.objects.create(
            streak_type="military",
            current_streak_days=3,
            best_streak_days=10,
        )

        assert "Military Aircraft Sighting" in str(streak)
        assert "3" in str(streak)
        assert "10" in str(streak)


@pytest.mark.django_db
class TestDailyStats:
    """Tests for DailyStats model."""

    def test_create_daily_stats(self):
        """Test creating daily statistics."""
        stats = DailyStats.objects.create(
            date=date.today(),
            unique_aircraft=250,
            new_aircraft=15,
            total_sessions=300,
            military_count=5,
        )

        assert stats.unique_aircraft == 250
        assert stats.new_aircraft == 15
        assert stats.aircraft_types == {}

    def test_str_representation(self):
        """Test __str__ format."""
        stats = DailyStats.objects.create(date=date.today(), unique_aircraft=100)

        assert str(date.today()) in str(stats)
        assert "100" in str(stats)


@pytest.mark.django_db
class TestNotableRegistration:
    """Tests for NotableRegistration model."""

    def test_create_notable_registration(self):
        """Test creating a notable registration pattern."""
        pattern = NotableRegistration.objects.create(
            name="Air Force One",
            pattern_type="exact",
            pattern="N28000",
            category="government",
            rarity_score=10,
        )

        assert pattern.name == "Air Force One"
        assert pattern.pattern_type == "exact"
        assert pattern.is_active is True

    def test_str_representation(self):
        """Test __str__ format."""
        pattern = NotableRegistration.objects.create(
            name="Test Pattern",
            pattern_type="prefix",
            pattern="N1",
            category="test",
        )

        assert "Test Pattern" in str(pattern)
        assert "prefix" in str(pattern)
        assert "N1" in str(pattern)


@pytest.mark.django_db
class TestNotableCallsign:
    """Tests for NotableCallsign model."""

    def test_create_notable_callsign(self):
        """Test creating a notable callsign pattern."""
        pattern = NotableCallsign.objects.create(
            name="REACH Flights",
            pattern_type="prefix",
            pattern="RCH",
            category="military",
            rarity_score=7,
        )

        assert pattern.name == "REACH Flights"
        assert pattern.pattern == "RCH"

    def test_str_representation(self):
        """Test __str__ format."""
        pattern = NotableCallsign.objects.create(
            name="Test Callsign",
            pattern_type="regex",
            pattern=r"^RCH\d+",
            category="military",
        )

        assert "Test Callsign" in str(pattern)
        assert "regex" in str(pattern)


@pytest.mark.django_db
class TestRareAircraftType:
    """Tests for RareAircraftType model."""

    def test_create_rare_aircraft_type(self):
        """Test creating a rare aircraft type."""
        type_code = unique_name("AN225")[:10]  # type_code has max length 10
        rare_type = RareAircraftType.objects.create(
            type_code=type_code,
            type_name="Antonov An-225 Mriya",
            manufacturer="Antonov",
            category="rare",
            rarity_score=10,
            total_produced=1,
        )

        assert rare_type.type_code == type_code
        assert rare_type.total_produced == 1

    def test_str_representation(self):
        """Test __str__ format."""
        type_code = unique_name("CONC")[:10]
        rare_type = RareAircraftType.objects.create(
            type_code=type_code,
            type_name="Concorde",
            rarity_score=9,
        )

        assert type_code in str(rare_type)
        assert "Concorde" in str(rare_type)
        assert "9" in str(rare_type)


# =============================================================================
# Notifications Models Tests (models/notifications.py)
# =============================================================================


@pytest.mark.django_db
class TestNotificationConfig:
    """Tests for NotificationConfig model (singleton)."""

    def test_singleton_behavior(self):
        """Test that only one config instance can exist."""
        config1 = NotificationConfig.objects.create(cooldown_seconds=300)
        config1.save()

        config2 = NotificationConfig(cooldown_seconds=600)
        config2.save()

        # Should only be one record
        assert NotificationConfig.objects.count() == 1
        # pk should always be 1
        assert NotificationConfig.objects.first().pk == 1

    def test_str_representation(self):
        """Test __str__ format."""
        config = NotificationConfig.get_config()
        assert "enabled=" in str(config)

    def test_get_config_creates_if_not_exists(self):
        """Test get_config creates instance if none exists."""
        NotificationConfig.objects.all().delete()
        assert NotificationConfig.objects.count() == 0

        config = NotificationConfig.get_config()
        assert config is not None
        assert config.pk == 1


@pytest.mark.django_db
class TestNotificationChannel:
    """Tests for NotificationChannel model."""

    def test_create_notification_channel(self):
        """Test creating a notification channel."""
        channel = NotificationChannel.objects.create(
            name="Discord Alerts",
            channel_type="discord",
            apprise_url="discord://webhook_id/webhook_token",
            is_global=True,
        )

        assert channel.name == "Discord Alerts"
        assert channel.channel_type == "discord"
        assert channel.enabled is True

    def test_str_representation(self):
        """Test __str__ format."""
        channel = NotificationChannel.objects.create(
            name="Slack Notifications",
            channel_type="slack",
            apprise_url="slack://token",
        )

        assert "Slack Notifications" in str(channel)
        assert "slack" in str(channel)


@pytest.mark.django_db
class TestNotificationTemplate:
    """Tests for NotificationTemplate model."""

    def test_create_notification_template(self):
        """Test creating a notification template."""
        template = NotificationTemplate.objects.create(
            name="alert_default",
            title_template="Alert: {rule_name}",
            body_template="{callsign} triggered {rule_name} at {altitude}ft",
            is_default=True,
        )

        assert template.name == "alert_default"
        assert "{rule_name}" in template.title_template

    def test_str_representation(self):
        """Test __str__ returns name."""
        template = NotificationTemplate.objects.create(
            name="test_template",
            title_template="Test",
            body_template="Body",
        )

        assert str(template) == "test_template"

    def test_get_template_for_exact_match(self):
        """Test template selection with exact match."""
        NotificationTemplate.objects.create(
            name="exact_match",
            event_type="alert",
            priority="critical",
            title_template="Critical Alert",
            body_template="Body",
        )

        template = NotificationTemplate.get_template_for("alert", "critical")
        assert template is not None
        assert template.name == "exact_match"


@pytest.mark.django_db
class TestNotificationLog:
    """Tests for NotificationLog model."""

    def test_create_notification_log(self):
        """Test creating a notification log entry."""
        log = NotificationLogFactory()

        assert log.notification_type in ["alert", "safety", "military", "emergency", "proximity", "tcas"]
        assert log.status == "pending"

    def test_can_retry(self):
        """Test can_retry method."""
        log = NotificationLog.objects.create(
            notification_type="alert",
            status="failed",
            retry_count=1,
            max_retries=3,
        )

        assert log.can_retry() is True

        log.retry_count = 3
        assert log.can_retry() is False

        log.status = "sent"
        log.retry_count = 0
        assert log.can_retry() is False

    def test_mark_sent(self):
        """Test mark_sent method."""
        log = NotificationLog.objects.create(
            notification_type="alert",
            status="pending",
        )

        log.mark_sent(duration_ms=150)

        assert log.status == "sent"
        assert log.sent_at is not None
        assert log.duration_ms == 150

    def test_mark_failed_with_retry(self):
        """Test mark_failed schedules retry."""
        # Status must be "failed" or "retrying" for can_retry() to return True
        log = NotificationLog.objects.create(
            notification_type="alert",
            status="failed",  # Must be failed or retrying for retry logic
            retry_count=0,
            max_retries=3,
        )

        log.mark_failed("Connection error")

        assert log.status == "retrying"
        assert log.retry_count == 1
        assert log.next_retry_at is not None
        assert log.last_error == "Connection error"


@pytest.mark.django_db
class TestUserNotificationPreference:
    """Tests for UserNotificationPreference model."""

    def test_create_user_preference(self):
        """Test creating user notification preference."""
        user = User.objects.create_user(username=unique_name("prefuser"), password="pass")
        channel = NotificationChannel.objects.create(
            name="Test Channel",
            channel_type="discord",
            apprise_url="discord://test",
        )

        pref = UserNotificationPreference.objects.create(
            user=user,
            channel=channel,
            min_priority="warning",
        )

        assert pref.min_priority == "warning"
        assert pref.enabled is True

    def test_should_receive_priority_filter(self):
        """Test should_receive filters by priority."""
        user = User.objects.create_user(username=unique_name("priouser"), password="pass")
        channel = NotificationChannel.objects.create(
            name="Priority Channel",
            channel_type="email",
            apprise_url="mailto://test@test.com",
        )

        pref = UserNotificationPreference.objects.create(
            user=user,
            channel=channel,
            min_priority="warning",
        )

        assert pref.should_receive("critical", "alert") is True
        assert pref.should_receive("warning", "alert") is True
        assert pref.should_receive("info", "alert") is False

    def test_should_receive_event_type_filter(self):
        """Test should_receive filters by event type."""
        user = User.objects.create_user(username=unique_name("evtuser"), password="pass")
        channel = NotificationChannel.objects.create(
            name="Event Channel",
            channel_type="webhook",
            apprise_url="https://example.com/webhook",
        )

        pref = UserNotificationPreference.objects.create(
            user=user,
            channel=channel,
            event_types=["alert", "safety"],
        )

        assert pref.should_receive("warning", "alert") is True
        assert pref.should_receive("warning", "safety") is True
        assert pref.should_receive("warning", "military") is False


# =============================================================================
# Cannonball Models Tests (models/cannonball.py)
# =============================================================================


@pytest.mark.django_db
class TestCannonballPattern:
    """Tests for CannonballPattern model."""

    def test_create_cannonball_pattern(self):
        """Test creating a cannonball pattern."""
        pattern = CannonballPattern.objects.create(
            icao_hex="A12345",
            pattern_type="circling",
            confidence="high",
            confidence_score=0.85,
            center_lat=47.5,
            center_lon=-122.3,
            radius_nm=2.5,
            started_at=timezone.now() - timedelta(hours=1),
        )

        assert pattern.pattern_type == "circling"
        assert pattern.confidence == "high"
        assert pattern.is_active is True

    def test_str_representation(self):
        """Test __str__ format."""
        pattern = CannonballPattern.objects.create(
            icao_hex="A67890",
            pattern_type="loitering",
            confidence="medium",
            center_lat=47.0,
            center_lon=-122.0,
            started_at=timezone.now(),
        )

        assert "A67890" in str(pattern)
        assert "loitering" in str(pattern)
        assert "medium" in str(pattern)

    def test_is_active_property(self):
        """Test is_active property."""
        pattern = CannonballPattern.objects.create(
            icao_hex="A11111",
            pattern_type="surveillance",
            center_lat=47.0,
            center_lon=-122.0,
            started_at=timezone.now(),
        )

        assert pattern.is_active is True

        pattern.ended_at = timezone.now()
        assert pattern.is_active is False

    def test_end_pattern_method(self):
        """Test end_pattern method calculates duration."""
        start_time = timezone.now() - timedelta(minutes=30)
        pattern = CannonballPattern.objects.create(
            icao_hex="A22222",
            pattern_type="grid_search",
            center_lat=47.0,
            center_lon=-122.0,
            started_at=start_time,
        )

        pattern.end_pattern()

        assert pattern.ended_at is not None
        assert pattern.duration_seconds >= 30 * 60 - 5  # Allow 5 second tolerance


@pytest.mark.django_db
class TestCannonballSession:
    """Tests for CannonballSession model."""

    def test_create_cannonball_session(self):
        """Test creating a cannonball session."""
        session = CannonballSession.objects.create(
            icao_hex="A12345",
            identification_method="callsign",
            identification_reason="COPTER callsign pattern",
            threat_level="warning",
        )

        assert session.icao_hex == "A12345"
        assert session.is_active is True
        assert session.position_count == 0

    def test_str_representation(self):
        """Test __str__ format."""
        session = CannonballSession.objects.create(
            icao_hex="A99999",
            threat_level="critical",
        )

        assert "A99999" in str(session)
        assert "critical" in str(session)
        assert "Active" in str(session)

    def test_update_position(self):
        """Test update_position method."""
        session = CannonballSession.objects.create(icao_hex="A33333")

        session.update_position(lat=47.5, lon=-122.3, altitude=5000, ground_speed=120)

        assert session.last_lat == 47.5
        assert session.last_lon == -122.3
        assert session.last_altitude == 5000
        assert session.position_count == 1

    def test_end_session(self):
        """Test end_session method."""
        session = CannonballSession.objects.create(icao_hex="A44444")
        assert session.is_active is True

        session.end_session()

        assert session.is_active is False


@pytest.mark.django_db
class TestCannonballAlert:
    """Tests for CannonballAlert model."""

    def test_create_cannonball_alert(self):
        """Test creating a cannonball alert."""
        session = CannonballSession.objects.create(icao_hex="A55555")
        alert = CannonballAlert.objects.create(
            session=session,
            alert_type="le_detected",
            priority="warning",
            title="Law Enforcement Detected",
            message="Potential LE aircraft detected nearby",
        )

        assert alert.alert_type == "le_detected"
        assert alert.notified is False
        assert alert.acknowledged is False

    def test_str_representation(self):
        """Test __str__ format."""
        session = CannonballSession.objects.create(icao_hex="A66666")
        alert = CannonballAlert.objects.create(
            session=session,
            alert_type="closing_fast",
            priority="critical",
            title="Aircraft Closing",
            message="LE aircraft closing fast",
        )

        assert "closing_fast" in str(alert)
        assert "Aircraft Closing" in str(alert)

    def test_acknowledge_method(self):
        """Test acknowledge method."""
        session = CannonballSession.objects.create(icao_hex="A77777")
        alert = CannonballAlert.objects.create(
            session=session,
            alert_type="overhead",
            priority="info",
            title="Overhead",
            message="Aircraft overhead",
        )

        alert.acknowledge()

        assert alert.acknowledged is True
        assert alert.acknowledged_at is not None


@pytest.mark.django_db
class TestCannonballKnownAircraft:
    """Tests for CannonballKnownAircraft model."""

    def test_create_known_aircraft(self):
        """Test creating a known LE aircraft entry."""
        aircraft = CannonballKnownAircraft.objects.create(
            icao_hex="A88888",
            registration="N123PD",
            agency_name="Local Police Department",
            agency_type="local",
            source="manual",
        )

        assert aircraft.icao_hex == "A88888"
        assert aircraft.agency_type == "local"
        assert aircraft.verified is False

    def test_str_representation(self):
        """Test __str__ format."""
        aircraft = CannonballKnownAircraft.objects.create(
            icao_hex="A99999",
            registration="N456FBI",
            agency_name="Federal Bureau of Investigation",
            agency_type="federal",
        )

        assert "N456FBI" in str(aircraft)
        assert "Federal Bureau of Investigation" in str(aircraft)

    def test_record_detection(self):
        """Test record_detection method."""
        aircraft = CannonballKnownAircraft.objects.create(
            icao_hex="AAAAAA",
            agency_name="Test Agency",
        )

        assert aircraft.times_detected == 0
        assert aircraft.last_detected is None

        aircraft.record_detection()

        assert aircraft.times_detected == 1
        assert aircraft.last_detected is not None


@pytest.mark.django_db
class TestCannonballStats:
    """Tests for CannonballStats model."""

    def test_create_cannonball_stats(self):
        """Test creating cannonball statistics."""
        now = timezone.now()
        stats = CannonballStats.objects.create(
            period_type="daily",
            period_start=now - timedelta(days=1),
            period_end=now,
            total_detections=25,
            unique_aircraft=10,
            critical_alerts=3,
        )

        assert stats.period_type == "daily"
        assert stats.total_detections == 25

    def test_str_representation(self):
        """Test __str__ format."""
        now = timezone.now()
        stats = CannonballStats.objects.create(
            period_type="hourly",
            period_start=now - timedelta(hours=1),
            period_end=now,
        )

        assert "hourly" in str(stats)
        assert "global" in str(stats)


# =============================================================================
# Alerts Models Tests (models/alerts.py)
# =============================================================================


@pytest.mark.django_db
class TestAlertRule:
    """Tests for AlertRule model."""

    def test_create_alert_rule(self):
        """Test creating an alert rule."""
        rule = AlertRuleFactory()

        assert rule.name is not None
        assert rule.enabled is True
        assert rule.cooldown_minutes >= 1

    def test_str_representation(self):
        """Test __str__ format."""
        rule = AlertRule.objects.create(
            name="Military Alert",
            rule_type="military",
            value="true",
        )

        assert "Military Alert" in str(rule)
        assert "military" in str(rule)

    def test_clean_validation_expires_after_starts(self):
        """Test that expires_at must be after starts_at."""
        now = timezone.now()
        rule = AlertRule(
            name="Invalid Rule",
            rule_type="test",
            starts_at=now,
            expires_at=now - timedelta(hours=1),
        )

        with pytest.raises(ValidationError) as exc_info:
            rule.clean()

        assert "expires_at" in exc_info.value.message_dict

    def test_is_in_suppression_window(self):
        """Test suppression window checking."""
        # Create rule with suppression window for current time
        now = datetime.now()
        current_day = now.strftime("%A").lower()
        now.strftime("%H:%M")

        # Create a window that includes now
        start_time = (now - timedelta(hours=1)).strftime("%H:%M")
        end_time = (now + timedelta(hours=1)).strftime("%H:%M")

        rule = AlertRule.objects.create(
            name="Suppressed Rule",
            rule_type="test",
            suppression_windows=[{"day": current_day, "start": start_time, "end": end_time}],
        )

        assert rule.is_in_suppression_window() is True

    def test_can_be_edited_by_owner(self):
        """Test can_be_edited_by for owner."""
        owner = User.objects.create_user(username=unique_name("owner"), password="pass")
        other = User.objects.create_user(username=unique_name("other"), password="pass")

        rule = AlertRule.objects.create(
            name="Owner Rule",
            rule_type="test",
            owner=owner,
        )

        assert rule.can_be_edited_by(owner) is True
        assert rule.can_be_edited_by(other) is False

    def test_can_be_deleted_by_system_rule(self):
        """Test system rules can only be deleted by superuser."""
        user = User.objects.create_user(username=unique_name("normaluser"), password="pass")
        superuser = User.objects.create_superuser(username=unique_name("superuserx"), password="pass")

        rule = AlertRule.objects.create(
            name="System Rule",
            rule_type="test",
            is_system=True,
        )

        assert rule.can_be_deleted_by(user) is False
        assert rule.can_be_deleted_by(superuser) is True


@pytest.mark.django_db
class TestAlertHistory:
    """Tests for AlertHistory model."""

    def test_create_alert_history(self):
        """Test creating alert history."""
        history = AlertHistoryFactory()

        assert history.icao_hex is not None
        assert history.triggered_at is not None

    def test_str_representation(self):
        """Test __str__ format."""
        history = AlertHistory.objects.create(
            rule_name="Test Rule",
            icao_hex="A12345",
            callsign="UAL123",
        )

        assert "Test Rule" in str(history)
        assert "A12345" in str(history)

    def test_acknowledge_method(self):
        """Test acknowledge method."""
        user = User.objects.create_user(username=unique_name("ackuser"), password="pass")
        history = AlertHistory.objects.create(
            rule_name="Ack Test",
            icao_hex="A99999",
        )

        history.acknowledge(user)

        assert history.acknowledged is True
        assert history.acknowledged_by == user
        assert history.acknowledged_at is not None


@pytest.mark.django_db
class TestAlertSubscription:
    """Tests for AlertSubscription model."""

    def test_create_subscription(self):
        """Test creating an alert subscription."""
        user = User.objects.create_user(username=unique_name("subuser"), password="pass")
        rule = AlertRule.objects.create(name="Shared Rule", rule_type="test")

        sub = AlertSubscription.objects.create(user=user, rule=rule)

        assert sub.user == user
        assert sub.rule == rule
        assert sub.notify_on_trigger is True

    def test_str_representation(self):
        """Test __str__ format."""
        user = User.objects.create_user(username=unique_name("strsubuser"), password="pass")
        rule = AlertRule.objects.create(name="Sub Rule", rule_type="test")

        sub = AlertSubscription.objects.create(user=user, rule=rule)

        assert "strsubuser" in str(sub)
        assert "Sub Rule" in str(sub)

    def test_subscribe_class_method(self):
        """Test subscribe class method."""
        user = User.objects.create_user(username=unique_name("subscribeuser"), password="pass")
        rule = AlertRule.objects.create(name="Subscribe Rule", rule_type="test")

        sub, created = AlertSubscription.subscribe(rule, user=user)

        assert created is True
        assert sub.user == user

        # Re-subscribe should update, not create
        sub2, created2 = AlertSubscription.subscribe(rule, user=user, notify=False)

        assert created2 is False
        assert sub2.notify_on_trigger is False

    def test_unsubscribe_class_method(self):
        """Test unsubscribe class method."""
        user = User.objects.create_user(username=unique_name("unsubuser"), password="pass")
        rule = AlertRule.objects.create(name="Unsub Rule", rule_type="test")

        AlertSubscription.objects.create(user=user, rule=rule)

        deleted = AlertSubscription.unsubscribe(rule, user=user)

        assert deleted == 1
        assert not AlertSubscription.objects.filter(user=user, rule=rule).exists()


@pytest.mark.django_db
class TestAlertAggregate:
    """Tests for AlertAggregate model."""

    def test_create_alert_aggregate(self):
        """Test creating an alert aggregate."""
        rule = AlertRule.objects.create(name="Agg Rule", rule_type="test")
        now = timezone.now()

        agg = AlertAggregate.objects.create(
            rule=rule,
            window_start=now - timedelta(hours=1),
            window_end=now,
            trigger_count=10,
            unique_aircraft=5,
        )

        assert agg.trigger_count == 10
        assert agg.sample_aircraft == []

    def test_str_representation(self):
        """Test __str__ format."""
        rule = AlertRule.objects.create(name="Str Agg Rule", rule_type="test")
        now = timezone.now()

        agg = AlertAggregate.objects.create(
            rule=rule,
            window_start=now - timedelta(hours=1),
            window_end=now,
            trigger_count=25,
        )

        assert "Str Agg Rule" in str(agg)
        assert "25" in str(agg)


# =============================================================================
# Aviation Models Tests (models/aviation.py)
# =============================================================================


@pytest.mark.django_db
class TestCachedAirport:
    """Tests for CachedAirport model."""

    def test_create_cached_airport(self):
        """Test creating a cached airport."""
        airport = CachedAirport.objects.create(
            icao_id="KSEA",
            name="Seattle-Tacoma International Airport",
            latitude=47.4502,
            longitude=-122.3088,
            elevation_ft=433,
            airport_type="large_airport",
            country="United States",
        )

        assert airport.icao_id == "KSEA"
        assert airport.elevation_ft == 433

    def test_str_representation(self):
        """Test __str__ format."""
        airport = CachedAirport.objects.create(
            icao_id="KLAX",
            name="Los Angeles International Airport",
            latitude=33.9425,
            longitude=-118.4081,
        )

        assert "KLAX" in str(airport)
        assert "Los Angeles" in str(airport)


@pytest.mark.django_db
class TestCachedNavaid:
    """Tests for CachedNavaid model."""

    def test_create_cached_navaid(self):
        """Test creating a cached navaid."""
        navaid = CachedNavaid.objects.create(
            ident="SEA",
            name="Seattle VORTAC",
            navaid_type="VORTAC",
            latitude=47.4352,
            longitude=-122.3098,
            frequency=116.8,
        )

        assert navaid.ident == "SEA"
        assert navaid.navaid_type == "VORTAC"

    def test_str_representation(self):
        """Test __str__ format."""
        navaid = CachedNavaid.objects.create(
            ident="LAX",
            name="Los Angeles VOR",
            navaid_type="VOR",
            latitude=33.9,
            longitude=-118.4,
        )

        assert "LAX" in str(navaid)
        assert "VOR" in str(navaid)


@pytest.mark.django_db
class TestCachedGeoJSON:
    """Tests for CachedGeoJSON model."""

    def test_create_cached_geojson(self):
        """Test creating a cached GeoJSON entry."""
        geojson = CachedGeoJSON.objects.create(
            data_type="states",
            name="Washington",
            code="WA",
            geometry={
                "type": "Polygon",
                "coordinates": [[[-124.7, 45.5], [-116.9, 45.5], [-116.9, 49.0], [-124.7, 49.0], [-124.7, 45.5]]],
            },
        )

        assert geojson.data_type == "states"
        assert geojson.code == "WA"

    def test_str_representation(self):
        """Test __str__ format."""
        geojson = CachedGeoJSON.objects.create(
            data_type="countries",
            name="Canada",
            geometry={"type": "Polygon", "coordinates": []},
        )

        assert "countries" in str(geojson)
        assert "Canada" in str(geojson)


@pytest.mark.django_db
class TestCachedPirep:
    """Tests for CachedPirep model."""

    def test_create_cached_pirep(self):
        """Test creating a cached PIREP."""
        pirep = CachedPirep.objects.create(
            pirep_id="PIREP_001",
            report_type="UUA",
            latitude=47.5,
            longitude=-122.3,
            flight_level=350,
            turbulence_type="MOD",
            observation_time=timezone.now(),
        )

        assert pirep.pirep_id == "PIREP_001"
        assert pirep.report_type == "UUA"
        assert pirep.turbulence_type == "MOD"

    def test_str_representation(self):
        """Test __str__ format."""
        pirep = CachedPirep.objects.create(
            pirep_id="PIREP_002",
            report_type="UA",
            latitude=40.0,
            longitude=-100.0,
        )

        assert "UA" in str(pirep)
        assert "PIREP_002" in str(pirep)


# =============================================================================
# Aircraft Models Tests (models/aircraft.py)
# =============================================================================


@pytest.mark.django_db
class TestAircraftSighting:
    """Tests for AircraftSighting model."""

    def test_create_aircraft_sighting(self):
        """Test creating an aircraft sighting."""
        sighting = AircraftSightingFactory()

        assert sighting.icao_hex is not None
        assert sighting.timestamp is not None

    def test_str_representation(self):
        """Test __str__ format."""
        sighting = AircraftSighting.objects.create(icao_hex="A12345")

        assert "A12345" in str(sighting)

    def test_emergency_sighting_trait(self):
        """Test emergency sighting factory trait."""
        sighting = AircraftSightingFactory(emergency=True)

        assert sighting.is_emergency is True
        assert sighting.squawk in ("7500", "7600", "7700")


@pytest.mark.django_db
class TestAircraftSession:
    """Tests for AircraftSession model."""

    def test_create_aircraft_session(self):
        """Test creating an aircraft session."""
        session = AircraftSessionFactory()

        assert session.icao_hex is not None
        assert session.total_positions > 0

    def test_str_representation(self):
        """Test __str__ format."""
        session = AircraftSession.objects.create(icao_hex="A67890")

        assert "A67890" in str(session)
        assert "session" in str(session)


@pytest.mark.django_db
class TestAircraftInfo:
    """Tests for AircraftInfo model."""

    def test_create_aircraft_info(self):
        """Test creating aircraft info."""
        info = AircraftInfoFactory()

        assert info.icao_hex is not None
        assert info.registration is not None

    def test_str_representation(self):
        """Test __str__ format."""
        info = AircraftInfo.objects.create(
            icao_hex="A11111",
            registration="N11111",
        )

        assert "A11111" in str(info)
        assert "N11111" in str(info)

    def test_military_trait(self):
        """Test military aircraft factory trait."""
        info = AircraftInfoFactory(military=True)

        assert info.is_military is True
        assert "Air Force" in info.operator or info.operator_icao == "AIO"

    def test_unique_icao_hex(self):
        """Test that icao_hex must be unique."""
        AircraftInfo.objects.create(icao_hex="UNIQUE1")

        with pytest.raises(IntegrityError):
            AircraftInfo.objects.create(icao_hex="UNIQUE1")


@pytest.mark.django_db
class TestAirframeSourceData:
    """Tests for AirframeSourceData model."""

    def test_create_airframe_source_data(self):
        """Test creating airframe source data."""
        info = AircraftInfo.objects.create(icao_hex="A22222")
        source_data = AirframeSourceData.objects.create(
            aircraft_info=info,
            source="faa",
            raw_data={"registration": "N22222", "owner": "Test Owner"},
            registration="N22222",
        )

        assert source_data.source == "faa"
        assert source_data.raw_data["owner"] == "Test Owner"

    def test_str_representation(self):
        """Test __str__ format."""
        info = AircraftInfo.objects.create(icao_hex="A33333")
        source_data = AirframeSourceData.objects.create(
            aircraft_info=info,
            source="opensky",
            raw_data={},
        )

        assert "A33333" in str(source_data)
        assert "opensky" in str(source_data)

    def test_unique_together_constraint(self):
        """Test that aircraft_info + source must be unique."""
        info = AircraftInfo.objects.create(icao_hex="A44444")
        AirframeSourceData.objects.create(
            aircraft_info=info,
            source="hexdb",
            raw_data={},
        )

        with pytest.raises(IntegrityError):
            AirframeSourceData.objects.create(
                aircraft_info=info,
                source="hexdb",
                raw_data={},
            )


# =============================================================================
# Engagement Models Tests (models/engagement.py)
# =============================================================================


@pytest.mark.django_db
class TestAircraftFavorite:
    """Tests for AircraftFavorite model."""

    def test_create_aircraft_favorite(self):
        """Test creating an aircraft favorite."""
        user = User.objects.create_user(username=unique_name("favuser"), password="pass")
        favorite = AircraftFavorite.objects.create(
            user=user,
            icao_hex="A12345",
            registration="N12345",
        )

        assert favorite.icao_hex == "A12345"
        assert favorite.times_seen == 0
        assert favorite.notify_on_detection is True

    def test_str_representation(self):
        """Test __str__ format."""
        user = User.objects.create_user(username=unique_name("strfavuser"), password="pass")
        favorite = AircraftFavorite.objects.create(
            user=user,
            icao_hex="A67890",
        )

        assert "strfavuser" in str(favorite)
        assert "A67890" in str(favorite)

    def test_toggle_favorite_add(self):
        """Test toggle_favorite adds favorite."""
        user = User.objects.create_user(username=unique_name("toggleuser"), password="pass")

        favorite, is_favorited = AircraftFavorite.toggle_favorite(
            icao_hex="a11111",  # lowercase to test normalization
            user=user,
        )

        assert favorite is not None
        assert is_favorited is True
        assert favorite.icao_hex == "A11111"  # Should be uppercase

    def test_toggle_favorite_remove(self):
        """Test toggle_favorite removes existing favorite."""
        user = User.objects.create_user(username=unique_name("removeuser"), password="pass")

        # First add
        AircraftFavorite.toggle_favorite(icao_hex="A22222", user=user)

        # Then toggle (remove)
        favorite, is_favorited = AircraftFavorite.toggle_favorite(
            icao_hex="A22222",
            user=user,
        )

        assert favorite is None
        assert is_favorited is False

    def test_is_favorite_method(self):
        """Test is_favorite class method."""
        user = User.objects.create_user(username=unique_name("isfavuser"), password="pass")
        AircraftFavorite.objects.create(user=user, icao_hex="A33333")

        assert AircraftFavorite.is_favorite("A33333", user=user) is True
        assert AircraftFavorite.is_favorite("A44444", user=user) is False


@pytest.mark.django_db
class TestSessionTrackingQuality:
    """Tests for SessionTrackingQuality model."""

    def test_create_session_tracking_quality(self):
        """Test creating session tracking quality metrics."""
        session = AircraftSession.objects.create(icao_hex="A55555")
        quality = SessionTrackingQuality.objects.create(
            session=session,
            expected_positions=100,
            actual_positions=95,
            completeness_score=95.0,
            total_gaps=2,
            max_gap_seconds=15,
        )

        assert quality.completeness_score == 95.0
        assert quality.quality_grade == "fair"

    def test_str_representation(self):
        """Test __str__ format."""
        session = AircraftSession.objects.create(icao_hex="A66666")
        quality = SessionTrackingQuality.objects.create(
            session=session,
            completeness_score=85.0,
            quality_grade="good",
        )

        assert "A66666" in str(quality)
        assert "good" in str(quality)
        assert "85.0" in str(quality)

    def test_calculate_quality_grade(self):
        """Test calculate_quality_grade method."""
        session = AircraftSession.objects.create(icao_hex="A77777")
        quality = SessionTrackingQuality.objects.create(
            session=session,
            completeness_score=95.0,
            max_gap_seconds=20,
        )

        grade = quality.calculate_quality_grade()
        assert grade == "excellent"

        quality.completeness_score = 75.0
        quality.max_gap_seconds = 45
        grade = quality.calculate_quality_grade()
        assert grade == "good"

        quality.completeness_score = 55.0
        grade = quality.calculate_quality_grade()
        assert grade == "fair"

        quality.completeness_score = 30.0
        grade = quality.calculate_quality_grade()
        assert grade == "poor"


# =============================================================================
# Airspace Models Tests (models/airspace.py)
# =============================================================================


@pytest.mark.django_db
class TestAirspaceAdvisory:
    """Tests for AirspaceAdvisory model."""

    def test_create_airspace_advisory(self):
        """Test creating an airspace advisory."""
        advisory = AirspaceAdvisory.objects.create(
            advisory_id="GAIRMET_001",
            advisory_type="GAIRMET",
            hazard="TURB",
            valid_from=timezone.now(),
            valid_to=timezone.now() + timedelta(hours=6),
            lower_alt_ft=10000,
            upper_alt_ft=35000,
        )

        assert advisory.advisory_type == "GAIRMET"
        assert advisory.hazard == "TURB"

    def test_str_representation(self):
        """Test __str__ format."""
        advisory = AirspaceAdvisory.objects.create(
            advisory_id="SIGMET_002",
            advisory_type="SIGMET",
            hazard="ICE",
        )

        assert "SIGMET" in str(advisory)
        assert "ICE" in str(advisory)

    def test_clean_validation_altitude_range(self):
        """Test that upper_alt must be >= lower_alt."""
        advisory = AirspaceAdvisory(
            advisory_id="INVALID_001",
            advisory_type="GAIRMET",
            lower_alt_ft=30000,
            upper_alt_ft=10000,
        )

        with pytest.raises(ValidationError) as exc_info:
            advisory.clean()

        assert "upper_alt_ft" in exc_info.value.message_dict


@pytest.mark.django_db
class TestAirspaceBoundary:
    """Tests for AirspaceBoundary model."""

    def test_create_airspace_boundary(self):
        """Test creating an airspace boundary."""
        boundary = AirspaceBoundary.objects.create(
            name="Seattle Class B",
            icao="KSEA",
            airspace_class="B",
            floor_ft=0,
            ceiling_ft=10000,
            center_lat=47.45,
            center_lon=-122.31,
        )

        assert boundary.airspace_class == "B"
        assert boundary.ceiling_ft == 10000

    def test_str_representation(self):
        """Test __str__ format."""
        boundary = AirspaceBoundary.objects.create(
            name="Portland Class C",
            airspace_class="C",
            center_lat=45.59,
            center_lon=-122.60,
        )

        assert "C" in str(boundary)
        assert "Portland" in str(boundary)

    def test_clean_validation_ceiling_floor(self):
        """Test that ceiling must be >= floor."""
        boundary = AirspaceBoundary(
            name="Invalid Boundary",
            airspace_class="D",
            floor_ft=5000,
            ceiling_ft=2500,
            center_lat=40.0,
            center_lon=-100.0,
        )

        with pytest.raises(ValidationError) as exc_info:
            boundary.clean()

        assert "ceiling_ft" in exc_info.value.message_dict


# =============================================================================
# NOTAMs Models Tests (models/notams.py)
# =============================================================================


@pytest.mark.django_db
class TestCachedNotam:
    """Tests for CachedNotam model."""

    def test_create_cached_notam(self):
        """Test creating a cached NOTAM."""
        notam = CachedNotam.objects.create(
            notam_id="1/2345",
            notam_type="TFR",
            location="KSEA",
            effective_start=timezone.now(),
            effective_end=timezone.now() + timedelta(hours=12),
            text="Temporary flight restriction for VIP movement",
            latitude=47.45,
            longitude=-122.31,
            radius_nm=3.0,
        )

        assert notam.notam_type == "TFR"
        assert notam.radius_nm == 3.0

    def test_str_representation(self):
        """Test __str__ format."""
        notam = CachedNotam.objects.create(
            notam_id="FDC 4/5678",
            notam_type="FDC",
            location="KLAX",
            effective_start=timezone.now(),
            text="FDC NOTAM",
        )

        assert "FDC" in str(notam)
        assert "FDC 4/5678" in str(notam)
        assert "KLAX" in str(notam)

    def test_is_active_property(self):
        """Test is_active property."""
        now = timezone.now()

        # Active NOTAM (current)
        notam = CachedNotam.objects.create(
            notam_id="ACTIVE_001",
            notam_type="D",
            location="KORD",
            effective_start=now - timedelta(hours=1),
            effective_end=now + timedelta(hours=1),
            text="Active NOTAM",
        )
        assert notam.is_active is True

        # Expired NOTAM
        notam.effective_end = now - timedelta(minutes=30)
        notam.save()
        assert notam.is_active is False

        # Future NOTAM
        notam.effective_start = now + timedelta(hours=1)
        notam.effective_end = now + timedelta(hours=2)
        notam.save()
        assert notam.is_active is False

    def test_is_tfr_property(self):
        """Test is_tfr property."""
        notam1 = CachedNotam.objects.create(
            notam_id="TFR_001",
            notam_type="TFR",
            location="KJFK",
            effective_start=timezone.now(),
            text="TFR NOTAM",
        )
        assert notam1.is_tfr is True

        notam2 = CachedNotam.objects.create(
            notam_id="D_001",
            notam_type="D",
            location="KJFK",
            effective_start=timezone.now(),
            text="D NOTAM",
            geometry={"type": "Polygon", "coordinates": []},
        )
        assert notam2.is_tfr is True

        notam3 = CachedNotam.objects.create(
            notam_id="D_002",
            notam_type="D",
            location="KJFK",
            effective_start=timezone.now(),
            text="Regular D NOTAM",
        )
        assert notam3.is_tfr is False


@pytest.mark.django_db
class TestCachedAirline:
    """Tests for CachedAirline model."""

    def test_create_cached_airline(self):
        """Test creating a cached airline."""
        airline = CachedAirline.objects.create(
            icao_code="UAL",
            iata_code="UA",
            name="United Airlines",
            callsign="UNITED",
            country="United States",
        )

        assert airline.icao_code == "UAL"
        assert airline.callsign == "UNITED"

    def test_str_representation(self):
        """Test __str__ format."""
        airline = CachedAirline.objects.create(
            icao_code="DAL",
            name="Delta Air Lines",
        )

        assert "DAL" in str(airline)
        assert "Delta" in str(airline)


@pytest.mark.django_db
class TestCachedAircraftType:
    """Tests for CachedAircraftType model."""

    def test_create_cached_aircraft_type(self):
        """Test creating a cached aircraft type."""
        actype = CachedAircraftType.objects.create(
            icao_code="B738",
            iata_code="738",
            name="Boeing 737-800",
            manufacturer="Boeing",
        )

        assert actype.icao_code == "B738"
        assert actype.manufacturer == "Boeing"

    def test_str_representation(self):
        """Test __str__ format."""
        actype = CachedAircraftType.objects.create(
            icao_code="A320",
            name="Airbus A320",
        )

        assert "A320" in str(actype)
        assert "Airbus" in str(actype)


# =============================================================================
# Antenna Models Tests (models/antenna.py)
# =============================================================================


@pytest.mark.django_db
class TestAntennaAnalyticsSnapshot:
    """Tests for AntennaAnalyticsSnapshot model."""

    def test_create_antenna_snapshot(self):
        """Test creating an antenna analytics snapshot."""
        snapshot = AntennaAnalyticsSnapshot.objects.create(
            timestamp=timezone.now(),
            snapshot_type="scheduled",
            max_range_nm=250.0,
            avg_range_nm=75.0,
            total_positions=5000,
            unique_aircraft=150,
        )

        assert snapshot.max_range_nm == 250.0
        assert snapshot.total_positions == 5000

    def test_str_representation(self):
        """Test __str__ format."""
        snapshot = AntennaAnalyticsSnapshot.objects.create(
            timestamp=timezone.now(),
            snapshot_type="hourly",
        )

        assert "hourly" in str(snapshot)

    def test_get_latest_method(self):
        """Test get_latest class method."""
        now = timezone.now()
        AntennaAnalyticsSnapshot.objects.create(
            timestamp=now - timedelta(hours=2),
            snapshot_type="scheduled",
        )
        AntennaAnalyticsSnapshot.objects.create(
            timestamp=now - timedelta(hours=1),
            snapshot_type="scheduled",
        )
        latest = AntennaAnalyticsSnapshot.objects.create(
            timestamp=now,
            snapshot_type="scheduled",
        )

        result = AntennaAnalyticsSnapshot.get_latest()
        assert result.pk == latest.pk

    def test_to_dict_method(self):
        """Test to_dict method."""
        snapshot = AntennaAnalyticsSnapshot.objects.create(
            timestamp=timezone.now(),
            snapshot_type="daily",
            max_range_nm=200.0,
            avg_range_nm=50.0,
            best_rssi=-15.0,
            total_positions=1000,
        )

        data = snapshot.to_dict()

        assert "timestamp" in data
        assert data["range"]["max_nm"] == 200.0
        assert data["signal"]["best_rssi"] == -15.0
        assert data["coverage"]["total_positions"] == 1000


# =============================================================================
# Audio Models Tests (models/audio.py)
# =============================================================================


@pytest.mark.django_db
class TestAudioTransmission:
    """Tests for AudioTransmission model."""

    def test_create_audio_transmission(self):
        """Test creating an audio transmission."""
        transmission = AudioTransmissionFactory()

        assert transmission.filename is not None
        assert transmission.transcription_status == "pending"

    def test_str_representation(self):
        """Test __str__ format."""
        transmission = AudioTransmission.objects.create(
            filename="test_audio.mp3",
            transcription_status="completed",
        )

        assert "test_audio.mp3" in str(transmission)
        assert "completed" in str(transmission)

    def test_transcription_workflow(self):
        """Test transcription status workflow."""
        transmission = AudioTransmission.objects.create(
            filename="workflow_test.mp3",
        )

        assert transmission.transcription_status == "pending"

        transmission.transcription_status = "queued"
        transmission.transcription_queued_at = timezone.now()
        transmission.save()

        transmission.transcription_status = "processing"
        transmission.transcription_started_at = timezone.now()
        transmission.save()

        transmission.transcription_status = "completed"
        transmission.transcription_completed_at = timezone.now()
        transmission.transcript = "Tower, cleared for takeoff."
        transmission.save()

        assert transmission.transcription_status == "completed"
        assert transmission.transcript is not None


# =============================================================================
# ACARS Models Tests (models/acars.py)
# =============================================================================


@pytest.mark.django_db
class TestAcarsMessage:
    """Tests for AcarsMessage model."""

    def test_create_acars_message(self):
        """Test creating an ACARS message."""
        message = AcarsMessageFactory()

        assert message.source in ("acars", "vdlm2")
        assert message.timestamp is not None

    def test_str_representation(self):
        """Test __str__ format."""
        message = AcarsMessage.objects.create(
            source="acars",
            label="Q0",
            icao_hex="A12345",
        )

        assert "ACARS" in str(message)
        assert "Q0" in str(message)
        assert "A12345" in str(message)

    def test_position_message_trait(self):
        """Test position message factory trait."""
        message = AcarsMessageFactory(position=True)

        assert message.label == "Q0"
        assert "POS" in message.text


# =============================================================================
# Safety Models Tests (models/safety.py)
# =============================================================================


@pytest.mark.django_db
class TestSafetyEvent:
    """Tests for SafetyEvent model."""

    def test_create_safety_event(self):
        """Test creating a safety event."""
        event = SafetyEventFactory()

        assert event.event_type is not None
        assert event.icao_hex is not None

    def test_str_representation(self):
        """Test __str__ format."""
        event = SafetyEvent.objects.create(
            event_type="tcas_ra",
            icao_hex="A99999",
            severity="critical",
        )

        assert "tcas_ra" in str(event)
        assert "A99999" in str(event)

    def test_emergency_squawk_events(self):
        """Test emergency squawk event types."""
        for squawk in ("7500", "7600", "7700"):
            event = SafetyEvent.objects.create(
                event_type=squawk,
                icao_hex="A" + squawk + "0",
                severity="critical",
            )

            assert event.event_type == squawk

    def test_proximity_conflict_event(self):
        """Test proximity conflict with two aircraft."""
        event = SafetyEventFactory(proximity=True)

        assert event.event_type == "proximity_conflict"
        assert event.icao_hex_2 is not None
        assert event.callsign_2 is not None

    def test_tcas_event(self):
        """Test TCAS event factory trait."""
        event = SafetyEventFactory(tcas=True)

        assert event.event_type == "tcas_ra"
        assert event.severity == "critical"
        assert "TCAS" in event.message

    def test_acknowledged_event(self):
        """Test acknowledged event factory trait."""
        event = SafetyEventFactory(acknowledged_event=True)

        assert event.acknowledged is True
        assert event.acknowledged_at is not None
