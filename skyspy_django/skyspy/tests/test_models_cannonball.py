"""
Tests for new Cannonball models (Phase 1-4).

Tests for:
- LEDataSource
- PatternAnalytics
- RegistrationAnalysis
- RegistrationTransfer
- CommunitySubmission
- SubmitterReputation
"""

from datetime import timedelta

import pytest
from django.contrib.auth.models import User
from django.db import IntegrityError
from django.test import TestCase
from django.utils import timezone

from skyspy.models import (
    CannonballKnownAircraft,
    CommunitySubmission,
    LEDataSource,
    PatternAnalytics,
    RegistrationAnalysis,
    RegistrationTransfer,
    SubmitterReputation,
)


class LEDataSourceModelTests(TestCase):
    """Tests for LEDataSource model."""

    def tearDown(self):
        """Clean up test data."""
        LEDataSource.objects.all().delete()

    def test_create_basic(self):
        """Test creating a basic LEDataSource."""
        source = LEDataSource.objects.create(
            name="buzzfeed_spyplanes",
            source_type="buzzfeed",
            url="https://example.com/data.csv",
        )

        self.assertEqual(source.name, "buzzfeed_spyplanes")
        self.assertEqual(source.source_type, "buzzfeed")
        self.assertEqual(source.confidence_weight, 1.0)
        self.assertTrue(source.fetch_enabled)

    def test_unique_name_constraint(self):
        """Test that name must be unique."""
        LEDataSource.objects.create(name="test_source", source_type="foia")

        with self.assertRaises(IntegrityError):
            LEDataSource.objects.create(name="test_source", source_type="academic")

    def test_source_type_choices(self):
        """Test valid source type choices."""
        valid_types = ["buzzfeed", "academic", "community_project", "foia", "government", "news_investigation"]

        for source_type in valid_types:
            source = LEDataSource.objects.create(
                name=f"test_{source_type}",
                source_type=source_type,
            )
            self.assertEqual(source.source_type, source_type)

    def test_str_representation(self):
        """Test string representation."""
        source = LEDataSource.objects.create(
            name="buzzfeed_spyplanes",
            source_type="buzzfeed",
        )

        self.assertIn("buzzfeed_spyplanes", str(source))
        self.assertIn("BuzzFeed", str(source))

    def test_record_fetch_error(self):
        """Test recording fetch errors."""
        source = LEDataSource.objects.create(
            name="test_source",
            source_type="foia",
        )

        source.record_fetch_error("Connection timeout")

        source.refresh_from_db()
        self.assertEqual(len(source.fetch_errors), 1)
        self.assertIn("Connection timeout", source.fetch_errors[0]["error"])
        self.assertIsNotNone(source.last_fetched)

    def test_record_fetch_error_limits_history(self):
        """Test that fetch error history is limited to 10."""
        source = LEDataSource.objects.create(
            name="test_source",
            source_type="foia",
            fetch_errors=[{"error": f"Error {i}"} for i in range(10)],
        )

        source.record_fetch_error("New error")

        source.refresh_from_db()
        self.assertEqual(len(source.fetch_errors), 10)
        self.assertIn("New error", source.fetch_errors[-1]["error"])

    def test_record_successful_fetch(self):
        """Test recording successful fetch."""
        source = LEDataSource.objects.create(
            name="test_source",
            source_type="foia",
        )

        source.record_successful_fetch(100)

        source.refresh_from_db()
        self.assertEqual(source.record_count, 100)
        self.assertIsNotNone(source.last_fetched)
        self.assertIsNotNone(source.last_successful_fetch)

    def test_default_values(self):
        """Test default values."""
        source = LEDataSource.objects.create(
            name="test_source",
            source_type="foia",
        )

        self.assertEqual(source.record_count, 0)
        self.assertEqual(source.update_frequency_hours, 168)  # Weekly
        self.assertTrue(source.fetch_enabled)
        self.assertEqual(source.fetch_errors, [])


class PatternAnalyticsModelTests(TestCase):
    """Tests for PatternAnalytics model."""

    def setUp(self):
        """Set up test fixtures."""
        self.user = User.objects.create_user(
            username="testuser",
            email="test@example.com",
            password="testpass123",
        )

    def tearDown(self):
        """Clean up test data."""
        PatternAnalytics.objects.all().delete()
        User.objects.all().delete()

    def test_create_basic(self):
        """Test creating a basic PatternAnalytics."""
        analytics = PatternAnalytics.objects.create(
            icao_hex="A12345",
            pattern_type="circling",
            confidence_score=0.85,
            duration_seconds=1200,
            center_lat=47.5,
            center_lon=-122.5,
        )

        self.assertEqual(analytics.icao_hex, "A12345")
        self.assertEqual(analytics.pattern_type, "circling")
        self.assertEqual(analytics.confidence_score, 0.85)
        self.assertIsNone(analytics.was_confirmed_le)
        self.assertFalse(analytics.false_positive_reported)

    def test_str_representation(self):
        """Test string representation."""
        analytics = PatternAnalytics.objects.create(
            icao_hex="A12345",
            pattern_type="stakeout",
            confidence_score=0.9,
            duration_seconds=3600,
            center_lat=47.5,
            center_lon=-122.5,
            was_confirmed_le=True,
        )

        str_rep = str(analytics)
        self.assertIn("A12345", str_rep)
        self.assertIn("stakeout", str_rep)
        self.assertIn("Confirmed", str_rep)

    def test_str_representation_false_positive(self):
        """Test string representation for false positive."""
        analytics = PatternAnalytics.objects.create(
            icao_hex="A12345",
            pattern_type="circling",
            confidence_score=0.7,
            duration_seconds=900,
            center_lat=47.5,
            center_lon=-122.5,
            false_positive_reported=True,
        )

        self.assertIn("FP", str(analytics))

    def test_record_feedback(self):
        """Test recording user feedback."""
        analytics = PatternAnalytics.objects.create(
            icao_hex="A12345",
            pattern_type="circling",
            confidence_score=0.8,
            duration_seconds=1200,
            center_lat=47.5,
            center_lon=-122.5,
        )

        analytics.record_feedback(self.user, is_confirmed_le=True, is_false_positive=False)

        analytics.refresh_from_db()
        self.assertTrue(analytics.was_confirmed_le)
        self.assertFalse(analytics.false_positive_reported)
        self.assertEqual(analytics.feedback_by, self.user)
        self.assertIsNotNone(analytics.feedback_at)

    def test_record_feedback_false_positive(self):
        """Test recording false positive feedback."""
        analytics = PatternAnalytics.objects.create(
            icao_hex="A12345",
            pattern_type="circling",
            confidence_score=0.8,
            duration_seconds=1200,
            center_lat=47.5,
            center_lon=-122.5,
        )

        analytics.record_feedback(self.user, is_confirmed_le=False, is_false_positive=True)

        analytics.refresh_from_db()
        self.assertFalse(analytics.was_confirmed_le)
        self.assertTrue(analytics.false_positive_reported)

    def test_pattern_metadata_default(self):
        """Test that pattern_metadata defaults to empty dict."""
        analytics = PatternAnalytics.objects.create(
            icao_hex="A12345",
            pattern_type="circling",
            confidence_score=0.8,
            duration_seconds=1200,
            center_lat=47.5,
            center_lon=-122.5,
        )

        self.assertEqual(analytics.pattern_metadata, {})

    def test_with_pattern_metadata(self):
        """Test creating with pattern metadata."""
        analytics = PatternAnalytics.objects.create(
            icao_hex="A12345",
            pattern_type="stakeout",
            confidence_score=0.9,
            duration_seconds=3600,
            center_lat=47.5,
            center_lon=-122.5,
            pattern_metadata={
                "radius_nm": 0.3,
                "altitude_consistency": 0.95,
                "speed_average": 50,
            },
        )

        self.assertEqual(analytics.pattern_metadata["radius_nm"], 0.3)


class RegistrationAnalysisModelTests(TestCase):
    """Tests for RegistrationAnalysis model."""

    def tearDown(self):
        """Clean up test data."""
        RegistrationAnalysis.objects.all().delete()

    def test_create_basic(self):
        """Test creating a basic RegistrationAnalysis."""
        analysis = RegistrationAnalysis.objects.create(
            icao_hex="A12345",
            registration="N12345",
            owner_name="ABC Aviation LLC",
        )

        self.assertEqual(analysis.icao_hex, "A12345")
        self.assertEqual(analysis.registration, "N12345")
        self.assertEqual(analysis.risk_level, "low")
        self.assertEqual(analysis.shell_company_score, 0.0)

    def test_unique_icao_hex_constraint(self):
        """Test that icao_hex must be unique."""
        RegistrationAnalysis.objects.create(
            icao_hex="A12345",
            registration="N12345",
            owner_name="Test Owner",
        )

        with self.assertRaises(IntegrityError):
            RegistrationAnalysis.objects.create(
                icao_hex="A12345",
                registration="N67890",
                owner_name="Another Owner",
            )

    def test_all_score_fields(self):
        """Test all shell company score fields."""
        analysis = RegistrationAnalysis.objects.create(
            icao_hex="A12345",
            registration="N12345",
            owner_name="Generic Aviation LLC",
            llc_no_web_presence=0.8,
            registered_agent_address=0.7,
            po_box_address=0.5,
            multiple_transfers=0.6,
            trust_ownership=0.3,
            generic_llc_name=0.9,
            shell_company_score=0.7,
            risk_level="high",
        )

        self.assertEqual(analysis.llc_no_web_presence, 0.8)
        self.assertEqual(analysis.registered_agent_address, 0.7)
        self.assertEqual(analysis.po_box_address, 0.5)
        self.assertEqual(analysis.multiple_transfers, 0.6)
        self.assertEqual(analysis.trust_ownership, 0.3)
        self.assertEqual(analysis.generic_llc_name, 0.9)
        self.assertEqual(analysis.shell_company_score, 0.7)
        self.assertEqual(analysis.risk_level, "high")

    def test_risk_level_choices(self):
        """Test valid risk level choices."""
        for risk_level in ["low", "medium", "high"]:
            analysis = RegistrationAnalysis.objects.create(
                icao_hex=f"A{risk_level}",
                registration=f"N{risk_level}",
                owner_name=f"Test {risk_level}",
                risk_level=risk_level,
            )
            self.assertEqual(analysis.risk_level, risk_level)

    def test_str_representation(self):
        """Test string representation."""
        analysis = RegistrationAnalysis.objects.create(
            icao_hex="A12345",
            registration="N12345",
            owner_name="Test LLC",
            risk_level="high",
        )

        str_rep = str(analysis)
        self.assertIn("N12345", str_rep)
        self.assertIn("high", str_rep.lower())


class RegistrationTransferModelTests(TestCase):
    """Tests for RegistrationTransfer model."""

    def tearDown(self):
        """Clean up test data."""
        RegistrationTransfer.objects.all().delete()

    def test_create_basic(self):
        """Test creating a basic RegistrationTransfer."""
        transfer = RegistrationTransfer.objects.create(
            registration="N12345",
            previous_owner="John Doe",
            new_owner="ABC Aviation LLC",
            transfer_date=timezone.now().date(),
        )

        self.assertEqual(transfer.registration, "N12345")
        self.assertEqual(transfer.previous_owner, "John Doe")
        self.assertEqual(transfer.new_owner, "ABC Aviation LLC")

    def test_with_owner_types(self):
        """Test with owner type classifications."""
        transfer = RegistrationTransfer.objects.create(
            registration="N12345",
            previous_owner="Individual Person",
            new_owner="Shell Aviation LLC",
            transfer_date=timezone.now().date(),
            previous_owner_type="individual",
            new_owner_type="llc",
            days_since_last_transfer=90,
        )

        self.assertEqual(transfer.previous_owner_type, "individual")
        self.assertEqual(transfer.new_owner_type, "llc")
        self.assertEqual(transfer.days_since_last_transfer, 90)

    def test_str_representation(self):
        """Test string representation."""
        transfer = RegistrationTransfer.objects.create(
            registration="N12345",
            previous_owner="Previous Owner Name",
            new_owner="New Owner Name",
            transfer_date=timezone.now().date(),
        )

        str_rep = str(transfer)
        self.assertIn("N12345", str_rep)
        self.assertIn("Previous Owner Name", str_rep)
        self.assertIn("New Owner Name", str_rep)

    def test_owner_type_choices(self):
        """Test valid owner type choices."""
        valid_types = ["individual", "corporation", "llc", "trust", "government", "unknown"]

        for owner_type in valid_types:
            transfer = RegistrationTransfer.objects.create(
                registration=f"N{owner_type[:5]}",
                previous_owner="Test",
                new_owner="Test",
                transfer_date=timezone.now().date(),
                previous_owner_type=owner_type,
                new_owner_type=owner_type,
            )
            self.assertEqual(transfer.previous_owner_type, owner_type)
            self.assertEqual(transfer.new_owner_type, owner_type)


class CommunitySubmissionModelTests(TestCase):
    """Tests for CommunitySubmission model."""

    def setUp(self):
        """Set up test fixtures."""
        self.user = User.objects.create_user(
            username="testuser",
            email="test@example.com",
            password="testpass123",
        )
        self.admin_user = User.objects.create_user(
            username="admin",
            email="admin@example.com",
            password="adminpass123",
            is_staff=True,
        )

    def tearDown(self):
        """Clean up test data."""
        CommunitySubmission.objects.all().delete()
        CannonballKnownAircraft.objects.all().delete()
        User.objects.all().delete()

    def test_create_basic(self):
        """Test creating a basic CommunitySubmission."""
        submission = CommunitySubmission.objects.create(
            icao_hex="A12345",
            agency_name="FBI",
            evidence_type="flight_pattern",
            evidence_description="Observed circling pattern",
            submitted_by=self.user,
        )

        self.assertEqual(submission.icao_hex, "A12345")
        self.assertEqual(submission.agency_name, "FBI")
        self.assertEqual(submission.status, "pending")

    def test_status_choices(self):
        """Test valid status choices."""
        valid_statuses = ["pending", "approved", "rejected", "duplicate", "needs_info"]

        for status in valid_statuses:
            submission = CommunitySubmission.objects.create(
                icao_hex=f"A{status[:4]}",
                agency_name="Test",
                evidence_type="news",
                evidence_description="Test",
                status=status,
            )
            self.assertEqual(submission.status, status)

    def test_agency_type_choices(self):
        """Test valid agency type choices."""
        valid_types = ["federal", "state", "local", "military", "unknown"]

        for agency_type in valid_types:
            submission = CommunitySubmission.objects.create(
                icao_hex=f"A{agency_type[:4]}",
                agency_name="Test",
                evidence_type="news",
                evidence_description="Test",
                agency_type=agency_type,
            )
            self.assertEqual(submission.agency_type, agency_type)

    def test_evidence_type_choices(self):
        """Test valid evidence type choices."""
        valid_types = ["flight_pattern", "callsign", "news", "foia", "registry", "livery", "public_records", "other"]

        for evidence_type in valid_types:
            submission = CommunitySubmission.objects.create(
                icao_hex=f"A{evidence_type[:4]}",
                agency_name="Test",
                evidence_type=evidence_type,
                evidence_description="Test",
            )
            self.assertEqual(submission.evidence_type, evidence_type)

    def test_str_representation(self):
        """Test string representation."""
        submission = CommunitySubmission.objects.create(
            icao_hex="A12345",
            agency_name="FBI",
            evidence_type="news",
            evidence_description="Test",
            status="pending",
        )

        str_rep = str(submission)
        self.assertIn("A12345", str_rep)
        self.assertIn("FBI", str_rep)
        self.assertIn("pending", str_rep.lower())

    def test_with_all_fields(self):
        """Test creating with all optional fields."""
        submission = CommunitySubmission.objects.create(
            icao_hex="A12345",
            registration="N12345",
            callsign_observed="LAPD1",
            agency_name="LAPD",
            agency_type="local",
            agency_state="CA",
            agency_city="Los Angeles",
            evidence_type="news",
            evidence_description="News article confirmed",
            evidence_url="https://example.com/article",
            additional_evidence=[{"type": "photo", "url": "https://example.com/photo.jpg"}],
            submitted_by=self.user,
            ip_hash="abcd1234",
            confidence_score=0.75,
        )

        self.assertEqual(submission.registration, "N12345")
        self.assertEqual(submission.callsign_observed, "LAPD1")
        self.assertEqual(submission.agency_state, "CA")
        self.assertEqual(len(submission.additional_evidence), 1)

    def test_created_aircraft_relationship(self):
        """Test relationship to created aircraft."""
        aircraft = CannonballKnownAircraft.objects.create(
            icao_hex="A12345",
            agency_name="FBI",
        )

        submission = CommunitySubmission.objects.create(
            icao_hex="A12345",
            agency_name="FBI",
            evidence_type="news",
            evidence_description="Test",
            status="approved",
            created_aircraft=aircraft,
        )

        self.assertEqual(submission.created_aircraft, aircraft)


class SubmitterReputationModelTests(TestCase):
    """Tests for SubmitterReputation model."""

    def setUp(self):
        """Set up test fixtures."""
        self.user = User.objects.create_user(
            username="testuser",
            email="test@example.com",
            password="testpass123",
        )

    def tearDown(self):
        """Clean up test data."""
        SubmitterReputation.objects.all().delete()
        User.objects.all().delete()

    def test_create_basic(self):
        """Test creating a basic SubmitterReputation."""
        reputation = SubmitterReputation.objects.create(user=self.user)

        self.assertEqual(reputation.user, self.user)
        self.assertEqual(reputation.total_submissions, 0)
        self.assertEqual(reputation.reputation_score, 0.5)
        self.assertFalse(reputation.is_trusted)
        self.assertFalse(reputation.is_banned)

    def test_unique_user_constraint(self):
        """Test that each user can only have one reputation."""
        SubmitterReputation.objects.create(user=self.user)

        with self.assertRaises(IntegrityError):
            SubmitterReputation.objects.create(user=self.user)

    def test_str_representation(self):
        """Test string representation."""
        reputation = SubmitterReputation.objects.create(
            user=self.user,
            reputation_score=0.85,
            is_trusted=True,
        )

        str_rep = str(reputation)
        self.assertIn("testuser", str_rep)
        self.assertIn("0.85", str_rep)
        self.assertIn("Trusted", str_rep)

    def test_str_representation_banned(self):
        """Test string representation for banned user."""
        reputation = SubmitterReputation.objects.create(
            user=self.user,
            is_banned=True,
        )

        self.assertIn("Banned", str(reputation))

    def test_calculate_reputation_no_submissions(self):
        """Test reputation calculation with no submissions."""
        reputation = SubmitterReputation.objects.create(user=self.user)

        score = reputation.calculate_reputation()

        self.assertEqual(score, 0.5)

    def test_calculate_reputation_all_approved(self):
        """Test reputation calculation with all approvals."""
        reputation = SubmitterReputation.objects.create(
            user=self.user,
            total_submissions=10,
            approved_submissions=10,
            rejected_submissions=0,
        )

        score = reputation.calculate_reputation()

        # Should be high: 0.3 + (1.0 * 0.5) + min(0.2, 10 * 0.02) - 0 = 0.3 + 0.5 + 0.2 = 1.0
        self.assertGreater(score, 0.8)

    def test_calculate_reputation_all_rejected(self):
        """Test reputation calculation with all rejections."""
        reputation = SubmitterReputation.objects.create(
            user=self.user,
            total_submissions=10,
            approved_submissions=0,
            rejected_submissions=10,
        )

        score = reputation.calculate_reputation()

        # Should be low due to rejections: 0.3 + 0 + 0 - (10 * 0.05) = 0.3 - 0.5 = 0.1 (min)
        self.assertLessEqual(score, 0.3)

    def test_calculate_reputation_mixed(self):
        """Test reputation calculation with mixed results."""
        reputation = SubmitterReputation.objects.create(
            user=self.user,
            total_submissions=10,
            approved_submissions=7,
            rejected_submissions=3,
        )

        score = reputation.calculate_reputation()

        # Should be moderate
        self.assertGreater(score, 0.4)
        self.assertLess(score, 0.9)

    def test_calculate_reputation_capped(self):
        """Test that reputation is capped at 0.1-1.0."""
        # Test minimum cap
        reputation = SubmitterReputation.objects.create(
            user=self.user,
            total_submissions=20,
            approved_submissions=0,
            rejected_submissions=20,
        )

        score = reputation.calculate_reputation()
        self.assertGreaterEqual(score, 0.1)

    def test_record_submission_result_approved(self):
        """Test recording an approved submission result."""
        reputation = SubmitterReputation.objects.create(user=self.user)

        reputation.record_submission_result(was_approved=True)

        self.assertEqual(reputation.total_submissions, 1)
        self.assertEqual(reputation.approved_submissions, 1)
        self.assertIsNotNone(reputation.last_approved_at)

    def test_record_submission_result_rejected(self):
        """Test recording a rejected submission result."""
        reputation = SubmitterReputation.objects.create(user=self.user)

        reputation.record_submission_result(was_approved=False)

        self.assertEqual(reputation.total_submissions, 1)
        self.assertEqual(reputation.rejected_submissions, 1)
        self.assertIsNone(reputation.last_approved_at)

    def test_ban_fields(self):
        """Test ban-related fields."""
        reputation = SubmitterReputation.objects.create(
            user=self.user,
            is_banned=True,
            ban_reason="Spam submissions",
            ban_expires_at=timezone.now() + timedelta(days=7),
        )

        self.assertTrue(reputation.is_banned)
        self.assertEqual(reputation.ban_reason, "Spam submissions")
        self.assertIsNotNone(reputation.ban_expires_at)
