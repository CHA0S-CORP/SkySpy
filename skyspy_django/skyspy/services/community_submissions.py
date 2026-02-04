"""
Community submission service for crowdsourced LE aircraft identification.

Handles submission creation, validation, review workflow, and reputation management.
"""

import hashlib
import logging
import re
from typing import Any

from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone

from skyspy.models import (
    CannonballKnownAircraft,
    CommunitySubmission,
    SubmitterReputation,
)

logger = logging.getLogger(__name__)


class ValidationError(Exception):
    """Validation error for submissions."""

    pass


class CommunitySubmissionService:
    """
    Service for managing community aircraft submissions.

    Handles:
    - Submission creation and validation
    - Duplicate detection
    - Review workflow (approve/reject)
    - Submitter reputation tracking
    """

    # ICAO hex validation pattern (4-6 hex characters)
    ICAO_HEX_PATTERN = re.compile(r"^[A-Fa-f0-9]{4,6}$")

    # Registration validation patterns
    US_REGISTRATION_PATTERN = re.compile(r"^N[0-9]{1,5}[A-Z]{0,2}$")
    GENERIC_REGISTRATION_PATTERN = re.compile(r"^[A-Z]{1,2}[-]?[A-Z0-9]{1,6}$")

    def __init__(self):
        pass

    def create_submission(
        self,
        user: User | None,
        icao_hex: str,
        agency_name: str,
        evidence_type: str,
        evidence_description: str,
        registration: str | None = None,
        callsign_observed: str | None = None,
        agency_type: str = "unknown",
        agency_state: str | None = None,
        agency_city: str | None = None,
        evidence_url: str | None = None,
        additional_evidence: list[dict] | None = None,
        ip_address: str | None = None,
    ) -> CommunitySubmission:
        """
        Create a new community submission.

        Args:
            user: Submitting user (can be None for anonymous)
            icao_hex: Aircraft ICAO hex code
            agency_name: Claimed agency name
            evidence_type: Type of evidence provided
            evidence_description: Description of evidence
            registration: Optional aircraft registration
            callsign_observed: Optional observed callsign
            agency_type: Type of agency (federal/state/local/etc)
            agency_state: State abbreviation if applicable
            agency_city: City if applicable
            evidence_url: URL to supporting evidence
            additional_evidence: List of additional evidence items
            ip_address: Submitter IP for abuse prevention

        Returns:
            Created CommunitySubmission

        Raises:
            ValidationError: If validation fails
        """
        # Validate ICAO hex
        icao_hex = icao_hex.upper().strip()
        if not self.validate_icao_hex(icao_hex):
            raise ValidationError(f"Invalid ICAO hex code: {icao_hex}")

        # Validate registration if provided
        if registration:
            registration = registration.upper().strip()
            if not self._validate_registration(registration):
                raise ValidationError(f"Invalid registration format: {registration}")

        # Check if user is banned
        if user:
            reputation = self._get_or_create_reputation(user)
            if reputation.is_banned:
                if reputation.ban_expires_at and reputation.ban_expires_at > timezone.now():
                    raise ValidationError("Your account is temporarily banned from making submissions")
                elif not reputation.ban_expires_at:
                    raise ValidationError("Your account is permanently banned from making submissions")
                else:
                    # Ban expired, unban user
                    reputation.is_banned = False
                    reputation.ban_reason = ""
                    reputation.ban_expires_at = None
                    reputation.save()

        # Check for duplicate
        duplicate = self.check_duplicate(icao_hex)
        if duplicate:
            if duplicate.status == "approved":
                raise ValidationError(f"This aircraft ({icao_hex}) is already in the database")
            elif duplicate.status == "pending":
                raise ValidationError(f"A submission for this aircraft ({icao_hex}) is already pending review")

        # Calculate initial confidence based on submitter reputation
        confidence_score = 0.5
        if user:
            reputation = self._get_or_create_reputation(user)
            confidence_score = self._calculate_submission_confidence(reputation, evidence_type)

        # Hash IP for abuse prevention (no PII stored)
        ip_hash = ""
        if ip_address:
            ip_hash = hashlib.sha256(ip_address.encode()).hexdigest()[:16]

        # Create submission
        with transaction.atomic():
            submission = CommunitySubmission.objects.create(
                icao_hex=icao_hex,
                registration=registration or "",
                callsign_observed=callsign_observed or "",
                agency_name=agency_name,
                agency_type=agency_type,
                agency_state=agency_state or "",
                agency_city=agency_city or "",
                evidence_type=evidence_type,
                evidence_description=evidence_description,
                evidence_url=evidence_url or "",
                additional_evidence=additional_evidence or [],
                submitted_by=user,
                ip_hash=ip_hash,
                confidence_score=confidence_score,
            )

            # Update submitter stats
            if user:
                reputation = self._get_or_create_reputation(user)
                reputation.pending_submissions += 1
                if not reputation.first_submission_at:
                    reputation.first_submission_at = timezone.now()
                reputation.last_submission_at = timezone.now()
                reputation.save()

        logger.info(f"Created submission {submission.id} for {icao_hex} by {user.username if user else 'anonymous'}")

        return submission

    def validate_icao_hex(self, icao_hex: str) -> bool:
        """Validate ICAO hex code format."""
        return bool(self.ICAO_HEX_PATTERN.match(icao_hex))

    def _validate_registration(self, registration: str) -> bool:
        """Validate aircraft registration format."""
        # US N-number
        if self.US_REGISTRATION_PATTERN.match(registration):
            return True
        # Generic international format
        return bool(self.GENERIC_REGISTRATION_PATTERN.match(registration))

    def check_duplicate(self, icao_hex: str) -> CommunitySubmission | None:
        """
        Check if there's an existing submission for this aircraft.

        Returns the existing submission if found, None otherwise.
        """
        # Check for existing submission (any status except rejected)
        existing = CommunitySubmission.objects.filter(
            icao_hex=icao_hex.upper(),
            status__in=["pending", "approved", "needs_info"],
        ).first()

        if existing:
            return existing

        # Also check if already in known aircraft database
        if CannonballKnownAircraft.objects.filter(icao_hex=icao_hex.upper()).exists():
            # Create a fake "approved" submission to indicate it's already known
            return CommunitySubmission(icao_hex=icao_hex, status="approved")

        return None

    def approve_submission(
        self,
        submission: CommunitySubmission,
        reviewer: User,
        notes: str = "",
    ) -> CannonballKnownAircraft:
        """
        Approve a submission and add to known aircraft database.

        Args:
            submission: Submission to approve
            reviewer: Admin user approving
            notes: Optional review notes

        Returns:
            Created CannonballKnownAircraft record
        """
        if submission.status != "pending" and submission.status != "needs_info":
            raise ValidationError(f"Cannot approve submission with status: {submission.status}")

        with transaction.atomic():
            # Create the known aircraft record
            aircraft = CannonballKnownAircraft.objects.create(
                icao_hex=submission.icao_hex,
                registration=submission.registration or "",
                agency_name=submission.agency_name,
                agency_type=submission.agency_type,
                agency_state=submission.agency_state or "",
                agency_city=submission.agency_city or "",
                source="community",
                source_url=submission.evidence_url or "",
                confidence_score=submission.confidence_score,
                evidence_links=[
                    {
                        "type": submission.evidence_type,
                        "description": submission.evidence_description[:500],
                        "url": submission.evidence_url or "",
                    }
                ]
                + (submission.additional_evidence or []),
                notes=f"Community submission by {submission.submitted_by.username if submission.submitted_by else 'anonymous'}",
            )

            # Update submission status
            submission.status = "approved"
            submission.reviewed_by = reviewer
            submission.reviewed_at = timezone.now()
            submission.review_notes = notes
            submission.created_aircraft = aircraft
            submission.save()

            # Update submitter reputation
            if submission.submitted_by:
                self.update_submitter_reputation(submission.submitted_by, was_approved=True)

        logger.info(f"Approved submission {submission.id} - created aircraft {aircraft.id}")

        return aircraft

    def reject_submission(
        self,
        submission: CommunitySubmission,
        reviewer: User,
        reason: str,
    ) -> CommunitySubmission:
        """
        Reject a submission.

        Args:
            submission: Submission to reject
            reviewer: Admin user rejecting
            reason: Reason for rejection

        Returns:
            Updated submission
        """
        if submission.status not in ["pending", "needs_info"]:
            raise ValidationError(f"Cannot reject submission with status: {submission.status}")

        with transaction.atomic():
            submission.status = "rejected"
            submission.reviewed_by = reviewer
            submission.reviewed_at = timezone.now()
            submission.review_notes = reason
            submission.save()

            # Update submitter reputation
            if submission.submitted_by:
                self.update_submitter_reputation(submission.submitted_by, was_approved=False)

        logger.info(f"Rejected submission {submission.id}: {reason[:100]}")

        return submission

    def mark_duplicate(
        self,
        submission: CommunitySubmission,
        reviewer: User,
        original_aircraft: CannonballKnownAircraft | None = None,
    ) -> CommunitySubmission:
        """Mark submission as duplicate of existing record."""
        submission.status = "duplicate"
        submission.reviewed_by = reviewer
        submission.reviewed_at = timezone.now()
        submission.review_notes = (
            f"Duplicate of existing aircraft: {original_aircraft.icao_hex}"
            if original_aircraft
            else "Duplicate submission"
        )
        if original_aircraft:
            submission.created_aircraft = original_aircraft
        submission.save()

        # Don't penalize reputation for duplicates
        if submission.submitted_by:
            reputation = self._get_or_create_reputation(submission.submitted_by)
            reputation.pending_submissions = max(0, reputation.pending_submissions - 1)
            reputation.save()

        return submission

    def request_more_info(
        self,
        submission: CommunitySubmission,
        reviewer: User,
        questions: str,
    ) -> CommunitySubmission:
        """Request more information from submitter."""
        submission.status = "needs_info"
        submission.reviewed_by = reviewer
        submission.reviewed_at = timezone.now()
        submission.review_notes = f"More information needed: {questions}"
        submission.save()

        return submission

    def update_submitter_reputation(self, user: User, was_approved: bool) -> SubmitterReputation:
        """
        Update submitter reputation after a review decision.

        Args:
            user: User whose reputation to update
            was_approved: Whether submission was approved

        Returns:
            Updated reputation record
        """
        reputation = self._get_or_create_reputation(user)
        reputation.record_submission_result(was_approved)

        # Check if user should become trusted
        if reputation.approved_submissions >= 5 and reputation.reputation_score >= 0.8 and not reputation.is_trusted:
            reputation.is_trusted = True
            logger.info(f"User {user.username} is now a trusted submitter")

        reputation.save()
        return reputation

    def _get_or_create_reputation(self, user: User) -> SubmitterReputation:
        """Get or create reputation record for user."""
        reputation, _ = SubmitterReputation.objects.get_or_create(user=user)
        return reputation

    def _calculate_submission_confidence(
        self,
        reputation: SubmitterReputation,
        evidence_type: str,
    ) -> float:
        """
        Calculate confidence score for a submission.

        Based on:
        - Submitter reputation
        - Evidence type quality
        - Trusted status
        """
        base_confidence = 0.3

        # Add reputation factor
        base_confidence += reputation.reputation_score * 0.3

        # Evidence type weights
        evidence_weights = {
            "foia": 0.3,  # FOIA documents are strong evidence
            "news": 0.25,
            "registry": 0.2,
            "public_records": 0.2,
            "livery": 0.15,
            "callsign": 0.1,
            "flight_pattern": 0.05,
            "other": 0.0,
        }
        base_confidence += evidence_weights.get(evidence_type, 0.0)

        # Bonus for trusted submitters
        if reputation.is_trusted:
            base_confidence += 0.1

        return min(1.0, max(0.1, base_confidence))

    def get_pending_submissions(
        self,
        limit: int = 50,
        order_by: str = "-submitted_at",
    ) -> list[CommunitySubmission]:
        """Get pending submissions for admin review."""
        return list(
            CommunitySubmission.objects.filter(status="pending")
            .select_related("submitted_by")
            .order_by(order_by)[:limit]
        )

    def get_user_submissions(
        self,
        user: User,
        limit: int = 50,
    ) -> list[CommunitySubmission]:
        """Get submissions by a specific user."""
        return list(CommunitySubmission.objects.filter(submitted_by=user).order_by("-submitted_at")[:limit])

    def get_submission_stats(self) -> dict[str, Any]:
        """Get submission statistics."""
        from django.db.models import Count

        status_counts = dict(
            CommunitySubmission.objects.values("status").annotate(count=Count("id")).values_list("status", "count")
        )

        return {
            "total": sum(status_counts.values()),
            "pending": status_counts.get("pending", 0),
            "approved": status_counts.get("approved", 0),
            "rejected": status_counts.get("rejected", 0),
            "duplicate": status_counts.get("duplicate", 0),
            "needs_info": status_counts.get("needs_info", 0),
        }

    def ban_user(
        self,
        user: User,
        reason: str,
        duration_days: int | None = None,
    ) -> SubmitterReputation:
        """
        Ban a user from making submissions.

        Args:
            user: User to ban
            reason: Reason for ban
            duration_days: None for permanent, number for temporary

        Returns:
            Updated reputation record
        """
        reputation = self._get_or_create_reputation(user)
        reputation.is_banned = True
        reputation.ban_reason = reason

        if duration_days:
            reputation.ban_expires_at = timezone.now() + timezone.timedelta(days=duration_days)
        else:
            reputation.ban_expires_at = None

        reputation.save()

        logger.warning(
            f"Banned user {user.username} from submissions: {reason}"
            f"{f' for {duration_days} days' if duration_days else ' permanently'}"
        )

        return reputation

    def unban_user(self, user: User) -> SubmitterReputation:
        """Unban a user."""
        reputation = self._get_or_create_reputation(user)
        reputation.is_banned = False
        reputation.ban_reason = ""
        reputation.ban_expires_at = None
        reputation.save()

        logger.info(f"Unbanned user {user.username} from submissions")

        return reputation


# Module-level service instance
_submission_service: CommunitySubmissionService | None = None


def get_submission_service() -> CommunitySubmissionService:
    """Get or create the submission service instance."""
    global _submission_service
    if _submission_service is None:
        _submission_service = CommunitySubmissionService()
    return _submission_service
