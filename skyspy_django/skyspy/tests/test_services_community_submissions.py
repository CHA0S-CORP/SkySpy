"""
Tests for the Community Submissions Service.

Tests submission creation, validation, review workflow, and reputation management.
"""

from datetime import timedelta
from unittest.mock import patch

import pytest
from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone

from skyspy.models import (
    CannonballKnownAircraft,
    CommunitySubmission,
    SubmitterReputation,
)
from skyspy.services.community_submissions import (
    CommunitySubmissionService,
    ValidationError,
    get_submission_service,
)


class CommunitySubmissionServiceTests(TestCase):
    """Tests for CommunitySubmissionService."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = CommunitySubmissionService()
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
        """Clean up after tests."""
        CommunitySubmission.objects.all().delete()
        SubmitterReputation.objects.all().delete()
        CannonballKnownAircraft.objects.all().delete()
        User.objects.all().delete()

    # =========================================================================
    # ICAO Hex Validation Tests
    # =========================================================================

    def test_validate_icao_hex_valid_4_chars(self):
        """Test valid 4-character ICAO hex."""
        self.assertTrue(self.service.validate_icao_hex("A123"))

    def test_validate_icao_hex_valid_6_chars(self):
        """Test valid 6-character ICAO hex."""
        self.assertTrue(self.service.validate_icao_hex("A12345"))

    def test_validate_icao_hex_valid_lowercase(self):
        """Test valid lowercase ICAO hex."""
        self.assertTrue(self.service.validate_icao_hex("abcdef"))

    def test_validate_icao_hex_invalid_too_short(self):
        """Test invalid ICAO hex (too short)."""
        self.assertFalse(self.service.validate_icao_hex("A12"))

    def test_validate_icao_hex_invalid_too_long(self):
        """Test invalid ICAO hex (too long)."""
        self.assertFalse(self.service.validate_icao_hex("A123456"))

    def test_validate_icao_hex_invalid_non_hex(self):
        """Test invalid ICAO hex (non-hex characters)."""
        self.assertFalse(self.service.validate_icao_hex("A12G45"))

    def test_validate_icao_hex_empty(self):
        """Test empty ICAO hex."""
        self.assertFalse(self.service.validate_icao_hex(""))

    # =========================================================================
    # Registration Validation Tests
    # =========================================================================

    def test_validate_registration_us_n_number(self):
        """Test valid US N-number registration."""
        self.assertTrue(self.service._validate_registration("N12345"))
        self.assertTrue(self.service._validate_registration("N1234A"))
        self.assertTrue(self.service._validate_registration("N123AB"))

    def test_validate_registration_international(self):
        """Test valid international registration formats."""
        self.assertTrue(self.service._validate_registration("G-ABCD"))
        self.assertTrue(self.service._validate_registration("C-FABC"))

    def test_validate_registration_invalid(self):
        """Test invalid registration formats."""
        self.assertFalse(self.service._validate_registration("INVALID123456"))
        self.assertFalse(self.service._validate_registration("123"))

    # =========================================================================
    # Submission Creation Tests
    # =========================================================================

    def test_create_submission_basic(self):
        """Test creating a basic submission."""
        submission = self.service.create_submission(
            user=self.user,
            icao_hex="A12345",
            agency_name="FBI",
            evidence_type="flight_pattern",
            evidence_description="Observed circling pattern over residential area for 2 hours during daytime",
        )

        self.assertIsNotNone(submission)
        self.assertEqual(submission.icao_hex, "A12345")
        self.assertEqual(submission.agency_name, "FBI")
        self.assertEqual(submission.status, "pending")
        self.assertEqual(submission.submitted_by, self.user)

    def test_create_submission_normalizes_icao_hex(self):
        """Test that ICAO hex is normalized to uppercase."""
        submission = self.service.create_submission(
            user=self.user,
            icao_hex="a12345",
            agency_name="FBI",
            evidence_type="flight_pattern",
            evidence_description="Observed circling pattern over residential area",
        )

        self.assertEqual(submission.icao_hex, "A12345")

    def test_create_submission_with_all_fields(self):
        """Test creating submission with all optional fields."""
        submission = self.service.create_submission(
            user=self.user,
            icao_hex="A12345",
            agency_name="Los Angeles Police Department",
            evidence_type="news",
            evidence_description="News article documented this aircraft as LAPD surveillance",
            registration="N12345",
            callsign_observed="LAPD1",
            agency_type="local",
            agency_state="CA",
            agency_city="Los Angeles",
            evidence_url="https://example.com/article",
            additional_evidence=[{"type": "photo", "url": "https://example.com/photo.jpg"}],
            ip_address="192.168.1.1",
        )

        self.assertEqual(submission.registration, "N12345")
        self.assertEqual(submission.callsign_observed, "LAPD1")
        self.assertEqual(submission.agency_type, "local")
        self.assertEqual(submission.agency_state, "CA")
        self.assertEqual(submission.agency_city, "Los Angeles")
        self.assertEqual(submission.evidence_url, "https://example.com/article")
        self.assertIsNotNone(submission.ip_hash)

    def test_create_submission_anonymous(self):
        """Test creating anonymous submission."""
        submission = self.service.create_submission(
            user=None,
            icao_hex="A12345",
            agency_name="FBI",
            evidence_type="flight_pattern",
            evidence_description="Observed circling pattern over residential area",
        )

        self.assertIsNone(submission.submitted_by)
        self.assertEqual(submission.confidence_score, 0.5)

    def test_create_submission_invalid_icao_hex(self):
        """Test that invalid ICAO hex raises ValidationError."""
        with self.assertRaises(ValidationError) as ctx:
            self.service.create_submission(
                user=self.user,
                icao_hex="INVALID",
                agency_name="FBI",
                evidence_type="flight_pattern",
                evidence_description="Test description",
            )

        self.assertIn("Invalid ICAO hex", str(ctx.exception))

    def test_create_submission_invalid_registration(self):
        """Test that invalid registration raises ValidationError."""
        with self.assertRaises(ValidationError) as ctx:
            self.service.create_submission(
                user=self.user,
                icao_hex="A12345",
                agency_name="FBI",
                evidence_type="flight_pattern",
                evidence_description="Test description",
                registration="INVALID123456789",
            )

        self.assertIn("Invalid registration", str(ctx.exception))

    def test_create_submission_updates_reputation_stats(self):
        """Test that creating submission updates reputation stats."""
        self.service.create_submission(
            user=self.user,
            icao_hex="A12345",
            agency_name="FBI",
            evidence_type="flight_pattern",
            evidence_description="Observed circling pattern",
        )

        reputation = SubmitterReputation.objects.get(user=self.user)
        self.assertEqual(reputation.pending_submissions, 1)
        self.assertIsNotNone(reputation.first_submission_at)
        self.assertIsNotNone(reputation.last_submission_at)

    # =========================================================================
    # Duplicate Detection Tests
    # =========================================================================

    def test_check_duplicate_no_existing(self):
        """Test duplicate check when no existing submission."""
        result = self.service.check_duplicate("A12345")
        self.assertIsNone(result)

    def test_check_duplicate_existing_pending(self):
        """Test duplicate check with existing pending submission."""
        CommunitySubmission.objects.create(
            icao_hex="A12345",
            agency_name="FBI",
            evidence_type="flight_pattern",
            evidence_description="Test",
            status="pending",
        )

        result = self.service.check_duplicate("A12345")
        self.assertIsNotNone(result)
        self.assertEqual(result.status, "pending")

    def test_check_duplicate_existing_approved(self):
        """Test duplicate check with existing approved submission."""
        CommunitySubmission.objects.create(
            icao_hex="A12345",
            agency_name="FBI",
            evidence_type="flight_pattern",
            evidence_description="Test",
            status="approved",
        )

        result = self.service.check_duplicate("A12345")
        self.assertIsNotNone(result)
        self.assertEqual(result.status, "approved")

    def test_check_duplicate_existing_rejected_allows_new(self):
        """Test that rejected submissions allow new submissions."""
        CommunitySubmission.objects.create(
            icao_hex="A12345",
            agency_name="FBI",
            evidence_type="flight_pattern",
            evidence_description="Test",
            status="rejected",
        )

        result = self.service.check_duplicate("A12345")
        self.assertIsNone(result)

    def test_check_duplicate_in_known_aircraft(self):
        """Test duplicate check against known aircraft database."""
        CannonballKnownAircraft.objects.create(
            icao_hex="A12345",
            agency_name="FBI",
        )

        result = self.service.check_duplicate("A12345")
        self.assertIsNotNone(result)
        self.assertEqual(result.status, "approved")

    def test_create_submission_blocks_duplicate_pending(self):
        """Test that duplicate pending submission is blocked."""
        CommunitySubmission.objects.create(
            icao_hex="A12345",
            agency_name="FBI",
            evidence_type="flight_pattern",
            evidence_description="Test",
            status="pending",
        )

        with self.assertRaises(ValidationError) as ctx:
            self.service.create_submission(
                user=self.user,
                icao_hex="A12345",
                agency_name="FBI",
                evidence_type="flight_pattern",
                evidence_description="Test duplicate",
            )

        self.assertIn("already pending", str(ctx.exception))

    def test_create_submission_blocks_duplicate_approved(self):
        """Test that duplicate approved submission is blocked."""
        CommunitySubmission.objects.create(
            icao_hex="A12345",
            agency_name="FBI",
            evidence_type="flight_pattern",
            evidence_description="Test",
            status="approved",
        )

        with self.assertRaises(ValidationError) as ctx:
            self.service.create_submission(
                user=self.user,
                icao_hex="A12345",
                agency_name="FBI",
                evidence_type="flight_pattern",
                evidence_description="Test duplicate",
            )

        self.assertIn("already in the database", str(ctx.exception))

    # =========================================================================
    # Approval Workflow Tests
    # =========================================================================

    def test_approve_submission_success(self):
        """Test successfully approving a submission."""
        submission = CommunitySubmission.objects.create(
            icao_hex="A12345",
            agency_name="FBI",
            evidence_type="news",
            evidence_description="News article confirmed this as FBI surveillance aircraft",
            submitted_by=self.user,
            status="pending",
        )

        aircraft = self.service.approve_submission(
            submission=submission,
            reviewer=self.admin_user,
            notes="Verified against news sources",
        )

        self.assertIsNotNone(aircraft)
        self.assertEqual(aircraft.icao_hex, "A12345")
        self.assertEqual(aircraft.agency_name, "FBI")
        self.assertEqual(aircraft.source, "community")

        submission.refresh_from_db()
        self.assertEqual(submission.status, "approved")
        self.assertEqual(submission.reviewed_by, self.admin_user)
        self.assertIsNotNone(submission.reviewed_at)

    def test_approve_submission_updates_reputation(self):
        """Test that approval updates submitter reputation."""
        SubmitterReputation.objects.create(user=self.user)

        submission = CommunitySubmission.objects.create(
            icao_hex="A12345",
            agency_name="FBI",
            evidence_type="news",
            evidence_description="Test description",
            submitted_by=self.user,
            status="pending",
        )

        self.service.approve_submission(submission, self.admin_user)

        reputation = SubmitterReputation.objects.get(user=self.user)
        self.assertEqual(reputation.approved_submissions, 1)
        self.assertGreater(reputation.reputation_score, 0.5)

    def test_approve_submission_invalid_status(self):
        """Test that approving already processed submission fails."""
        submission = CommunitySubmission.objects.create(
            icao_hex="A12345",
            agency_name="FBI",
            evidence_type="news",
            evidence_description="Test",
            status="rejected",
        )

        with self.assertRaises(ValidationError) as ctx:
            self.service.approve_submission(submission, self.admin_user)

        self.assertIn("Cannot approve", str(ctx.exception))

    def test_approve_needs_info_submission(self):
        """Test approving a submission that was marked needs_info."""
        submission = CommunitySubmission.objects.create(
            icao_hex="A12345",
            agency_name="FBI",
            evidence_type="news",
            evidence_description="Updated evidence after request",
            status="needs_info",
        )

        aircraft = self.service.approve_submission(submission, self.admin_user)
        self.assertIsNotNone(aircraft)

    # =========================================================================
    # Rejection Workflow Tests
    # =========================================================================

    def test_reject_submission_success(self):
        """Test successfully rejecting a submission."""
        submission = CommunitySubmission.objects.create(
            icao_hex="A12345",
            agency_name="FBI",
            evidence_type="flight_pattern",
            evidence_description="Test",
            submitted_by=self.user,
            status="pending",
        )

        result = self.service.reject_submission(
            submission=submission,
            reviewer=self.admin_user,
            reason="Insufficient evidence - flight pattern alone not conclusive",
        )

        self.assertEqual(result.status, "rejected")
        self.assertEqual(result.reviewed_by, self.admin_user)
        self.assertIn("Insufficient evidence", result.review_notes)

    def test_reject_submission_updates_reputation(self):
        """Test that rejection updates submitter reputation."""
        SubmitterReputation.objects.create(user=self.user, reputation_score=0.7)

        submission = CommunitySubmission.objects.create(
            icao_hex="A12345",
            agency_name="FBI",
            evidence_type="flight_pattern",
            evidence_description="Test",
            submitted_by=self.user,
            status="pending",
        )

        self.service.reject_submission(submission, self.admin_user, "Invalid")

        reputation = SubmitterReputation.objects.get(user=self.user)
        self.assertEqual(reputation.rejected_submissions, 1)
        self.assertLess(reputation.reputation_score, 0.7)

    def test_reject_submission_invalid_status(self):
        """Test that rejecting already processed submission fails."""
        submission = CommunitySubmission.objects.create(
            icao_hex="A12345",
            agency_name="FBI",
            evidence_type="news",
            evidence_description="Test",
            status="approved",
        )

        with self.assertRaises(ValidationError) as ctx:
            self.service.reject_submission(submission, self.admin_user, "Reason")

        self.assertIn("Cannot reject", str(ctx.exception))

    # =========================================================================
    # Mark Duplicate Tests
    # =========================================================================

    def test_mark_duplicate_success(self):
        """Test marking submission as duplicate."""
        existing_aircraft = CannonballKnownAircraft.objects.create(
            icao_hex="A12345",
            agency_name="FBI",
        )

        submission = CommunitySubmission.objects.create(
            icao_hex="A12345",
            agency_name="FBI",
            evidence_type="news",
            evidence_description="Test",
            submitted_by=self.user,
            status="pending",
        )

        # Create reputation first
        SubmitterReputation.objects.create(user=self.user, pending_submissions=1)

        result = self.service.mark_duplicate(
            submission=submission,
            reviewer=self.admin_user,
            original_aircraft=existing_aircraft,
        )

        self.assertEqual(result.status, "duplicate")
        self.assertEqual(result.created_aircraft, existing_aircraft)

    def test_mark_duplicate_does_not_penalize_reputation(self):
        """Test that marking duplicate doesn't penalize reputation."""
        reputation = SubmitterReputation.objects.create(
            user=self.user,
            pending_submissions=1,
            reputation_score=0.6,
        )

        submission = CommunitySubmission.objects.create(
            icao_hex="A12345",
            agency_name="FBI",
            evidence_type="news",
            evidence_description="Test",
            submitted_by=self.user,
            status="pending",
        )

        self.service.mark_duplicate(submission, self.admin_user)

        reputation.refresh_from_db()
        self.assertEqual(reputation.pending_submissions, 0)
        self.assertEqual(reputation.reputation_score, 0.6)  # Unchanged

    # =========================================================================
    # Request More Info Tests
    # =========================================================================

    def test_request_more_info(self):
        """Test requesting more information from submitter."""
        submission = CommunitySubmission.objects.create(
            icao_hex="A12345",
            agency_name="FBI",
            evidence_type="flight_pattern",
            evidence_description="Test",
            status="pending",
        )

        result = self.service.request_more_info(
            submission=submission,
            reviewer=self.admin_user,
            questions="Please provide specific dates and times of observation",
        )

        self.assertEqual(result.status, "needs_info")
        self.assertIn("specific dates", result.review_notes)

    # =========================================================================
    # Reputation Calculation Tests
    # =========================================================================

    def test_calculate_submission_confidence_new_user(self):
        """Test confidence calculation for new user."""
        reputation = SubmitterReputation.objects.create(user=self.user)

        confidence = self.service._calculate_submission_confidence(reputation, "flight_pattern")

        # New user (0.5 reputation) + flight_pattern (0.05) = ~0.35-0.5
        self.assertGreater(confidence, 0.3)
        self.assertLess(confidence, 0.6)

    def test_calculate_submission_confidence_trusted_user_strong_evidence(self):
        """Test confidence calculation for trusted user with strong evidence."""
        reputation = SubmitterReputation.objects.create(
            user=self.user,
            reputation_score=0.9,
            is_trusted=True,
        )

        confidence = self.service._calculate_submission_confidence(reputation, "foia")

        # Should be high due to trusted status and FOIA evidence
        self.assertGreater(confidence, 0.8)

    def test_calculate_submission_confidence_caps_at_1(self):
        """Test that confidence is capped at 1.0."""
        reputation = SubmitterReputation.objects.create(
            user=self.user,
            reputation_score=1.0,
            is_trusted=True,
        )

        confidence = self.service._calculate_submission_confidence(reputation, "foia")

        self.assertLessEqual(confidence, 1.0)

    def test_update_submitter_reputation_approval(self):
        """Test reputation update on approval."""
        reputation = SubmitterReputation.objects.create(
            user=self.user,
            reputation_score=0.5,
        )

        self.service.update_submitter_reputation(self.user, was_approved=True)

        reputation.refresh_from_db()
        self.assertEqual(reputation.approved_submissions, 1)
        self.assertGreater(reputation.reputation_score, 0.5)

    def test_update_submitter_reputation_rejection(self):
        """Test reputation update on rejection."""
        reputation = SubmitterReputation.objects.create(
            user=self.user,
            reputation_score=0.7,
        )

        self.service.update_submitter_reputation(self.user, was_approved=False)

        reputation.refresh_from_db()
        self.assertEqual(reputation.rejected_submissions, 1)
        self.assertLess(reputation.reputation_score, 0.7)

    def test_trusted_status_earned(self):
        """Test that trusted status is earned after qualifying submissions."""
        reputation = SubmitterReputation.objects.create(
            user=self.user,
            approved_submissions=4,
            reputation_score=0.85,
            is_trusted=False,
        )

        # This approval should push them to trusted status
        self.service.update_submitter_reputation(self.user, was_approved=True)

        reputation.refresh_from_db()
        self.assertTrue(reputation.is_trusted)

    # =========================================================================
    # Ban/Unban Tests
    # =========================================================================

    def test_ban_user_permanent(self):
        """Test permanently banning a user."""
        result = self.service.ban_user(
            user=self.user,
            reason="Repeated spam submissions",
            duration_days=None,
        )

        self.assertTrue(result.is_banned)
        self.assertEqual(result.ban_reason, "Repeated spam submissions")
        self.assertIsNone(result.ban_expires_at)

    def test_ban_user_temporary(self):
        """Test temporarily banning a user."""
        result = self.service.ban_user(
            user=self.user,
            reason="Low quality submissions",
            duration_days=7,
        )

        self.assertTrue(result.is_banned)
        self.assertIsNotNone(result.ban_expires_at)
        self.assertGreater(result.ban_expires_at, timezone.now())

    def test_unban_user(self):
        """Test unbanning a user."""
        SubmitterReputation.objects.create(
            user=self.user,
            is_banned=True,
            ban_reason="Test reason",
        )

        result = self.service.unban_user(self.user)

        self.assertFalse(result.is_banned)
        self.assertEqual(result.ban_reason, "")

    def test_banned_user_cannot_submit(self):
        """Test that banned users cannot create submissions."""
        SubmitterReputation.objects.create(
            user=self.user,
            is_banned=True,
            ban_reason="Spam",
        )

        with self.assertRaises(ValidationError) as ctx:
            self.service.create_submission(
                user=self.user,
                icao_hex="A12345",
                agency_name="FBI",
                evidence_type="news",
                evidence_description="Test submission",
            )

        self.assertIn("banned", str(ctx.exception).lower())

    def test_expired_ban_allows_submission(self):
        """Test that expired temporary ban allows submission."""
        SubmitterReputation.objects.create(
            user=self.user,
            is_banned=True,
            ban_reason="Temporary",
            ban_expires_at=timezone.now() - timedelta(days=1),  # Expired
        )

        # Should not raise - ban is expired
        submission = self.service.create_submission(
            user=self.user,
            icao_hex="A12345",
            agency_name="FBI",
            evidence_type="news",
            evidence_description="Test after ban expired - submission should work now",
        )

        self.assertIsNotNone(submission)

        # Reputation should be unbanned
        reputation = SubmitterReputation.objects.get(user=self.user)
        self.assertFalse(reputation.is_banned)

    # =========================================================================
    # Query Methods Tests
    # =========================================================================

    def test_get_pending_submissions(self):
        """Test getting pending submissions."""
        CommunitySubmission.objects.create(
            icao_hex="A11111",
            agency_name="FBI",
            evidence_type="news",
            evidence_description="Test 1",
            status="pending",
        )
        CommunitySubmission.objects.create(
            icao_hex="A22222",
            agency_name="DEA",
            evidence_type="news",
            evidence_description="Test 2",
            status="pending",
        )
        CommunitySubmission.objects.create(
            icao_hex="A33333",
            agency_name="DHS",
            evidence_type="news",
            evidence_description="Test 3",
            status="approved",
        )

        pending = self.service.get_pending_submissions()

        self.assertEqual(len(pending), 2)

    def test_get_user_submissions(self):
        """Test getting user's submissions."""
        CommunitySubmission.objects.create(
            icao_hex="A11111",
            agency_name="FBI",
            evidence_type="news",
            evidence_description="Test 1",
            submitted_by=self.user,
        )
        CommunitySubmission.objects.create(
            icao_hex="A22222",
            agency_name="DEA",
            evidence_type="news",
            evidence_description="Test 2",
            submitted_by=self.user,
        )
        CommunitySubmission.objects.create(
            icao_hex="A33333",
            agency_name="DHS",
            evidence_type="news",
            evidence_description="Test 3",
            submitted_by=self.admin_user,
        )

        user_submissions = self.service.get_user_submissions(self.user)

        self.assertEqual(len(user_submissions), 2)

    def test_get_submission_stats(self):
        """Test getting submission statistics."""
        CommunitySubmission.objects.create(
            icao_hex="A11111",
            agency_name="FBI",
            evidence_type="news",
            evidence_description="Test",
            status="pending",
        )
        CommunitySubmission.objects.create(
            icao_hex="A22222",
            agency_name="DEA",
            evidence_type="news",
            evidence_description="Test",
            status="pending",
        )
        CommunitySubmission.objects.create(
            icao_hex="A33333",
            agency_name="DHS",
            evidence_type="news",
            evidence_description="Test",
            status="approved",
        )
        CommunitySubmission.objects.create(
            icao_hex="A44444",
            agency_name="ICE",
            evidence_type="news",
            evidence_description="Test",
            status="rejected",
        )

        stats = self.service.get_submission_stats()

        self.assertEqual(stats["total"], 4)
        self.assertEqual(stats["pending"], 2)
        self.assertEqual(stats["approved"], 1)
        self.assertEqual(stats["rejected"], 1)


class GetSubmissionServiceTests(TestCase):
    """Tests for get_submission_service singleton."""

    def test_returns_same_instance(self):
        """Test that get_submission_service returns singleton."""
        service1 = get_submission_service()
        service2 = get_submission_service()

        self.assertIs(service1, service2)

    def test_returns_correct_type(self):
        """Test that get_submission_service returns CommunitySubmissionService."""
        service = get_submission_service()

        self.assertIsInstance(service, CommunitySubmissionService)
