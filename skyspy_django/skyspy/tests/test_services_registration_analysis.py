"""
Tests for the Registration Analysis Service.

Tests shell company detection, address pattern analysis, and transfer history.
"""

from datetime import date, timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone

from skyspy.models import (
    CannonballKnownAircraft,
    RegistrationAnalysis,
    RegistrationTransfer,
)
from skyspy.services.registration_analysis import (
    AnalysisResult,
    RegistrationAnalysisService,
    get_analysis_service,
)


class RegistrationAnalysisServiceTests(TestCase):
    """Tests for RegistrationAnalysisService."""

    def setUp(self):
        """Set up test fixtures."""
        self.service = RegistrationAnalysisService()

    def tearDown(self):
        """Clean up after tests."""
        RegistrationAnalysis.objects.all().delete()
        RegistrationTransfer.objects.all().delete()
        CannonballKnownAircraft.objects.all().delete()

    # =========================================================================
    # Generic LLC Name Detection Tests
    # =========================================================================

    def test_check_generic_llc_name_matches_patterns(self):
        """Test detection of generic LLC name patterns."""
        # Two-letter aviation LLC
        score = self.service._check_generic_llc_name("AB AVIATION LLC")
        self.assertGreater(score, 0.5)

        # Three-letter aviation LLC
        score = self.service._check_generic_llc_name("ABC AVIATION LLC")
        self.assertGreater(score, 0.5)

        # Aircraft holdings
        score = self.service._check_generic_llc_name("AIRCRAFT HOLDINGS LLC")
        self.assertGreater(score, 0.5)

        # Registration-named LLC
        score = self.service._check_generic_llc_name("N12345 LLC")
        self.assertGreater(score, 0.5)

    def test_check_generic_llc_name_short_llc(self):
        """Test detection of short LLC names."""
        score = self.service._check_generic_llc_name("SKY LLC")
        self.assertGreater(score, 0.0)

    def test_check_generic_llc_name_normal_company(self):
        """Test that normal company names score low."""
        score = self.service._check_generic_llc_name("Delta Air Lines Inc")
        self.assertEqual(score, 0.0)

        score = self.service._check_generic_llc_name("Southwest Airlines")
        self.assertEqual(score, 0.0)

    def test_check_generic_llc_name_trust(self):
        """Test detection of trust patterns."""
        score = self.service._check_generic_llc_name("SMITH TRUST")
        self.assertGreater(score, 0.5)

        score = self.service._check_generic_llc_name("BANK OF UTAH TRUSTEE")
        self.assertGreater(score, 0.5)

    # =========================================================================
    # Registered Agent Detection Tests
    # =========================================================================

    def test_check_registered_agent_ct_corp(self):
        """Test detection of CT Corporation address."""
        score = self.service._check_registered_agent("C/O CT CORPORATION SYSTEM")
        self.assertGreater(score, 0.8)

    def test_check_registered_agent_csc(self):
        """Test detection of CSC address."""
        score = self.service._check_registered_agent("C/O CSC-LAWYERS INCORPORATING SERVICE")
        self.assertGreater(score, 0.8)

    def test_check_registered_agent_national(self):
        """Test detection of National Registered Agents."""
        score = self.service._check_registered_agent("C/O NATIONAL REGISTERED AGENTS INC")
        self.assertGreater(score, 0.8)

    def test_check_registered_agent_known_addresses(self):
        """Test detection of known shell company addresses."""
        # Delaware addresses
        score = self.service._check_registered_agent("151 N MAIN ST, WILMINGTON DE")
        self.assertGreater(score, 0.5)

        score = self.service._check_registered_agent("1209 ORANGE ST")
        self.assertGreater(score, 0.5)

    def test_check_registered_agent_normal_address(self):
        """Test that normal addresses score zero."""
        score = self.service._check_registered_agent("123 Main Street, Anytown USA")
        self.assertEqual(score, 0.0)

    # =========================================================================
    # PO Box Detection Tests
    # =========================================================================

    def test_check_po_box_standard(self):
        """Test detection of standard PO Box format."""
        score = self.service._check_po_box("PO BOX 12345")
        self.assertGreater(score, 0.5)

        score = self.service._check_po_box("P.O. Box 1234")
        self.assertGreater(score, 0.5)

    def test_check_po_box_post_office(self):
        """Test detection of spelled out post office box."""
        score = self.service._check_po_box("POST OFFICE BOX 5678")
        self.assertGreater(score, 0.5)

    def test_check_po_box_pmb(self):
        """Test detection of private mailbox."""
        score = self.service._check_po_box("PMB 123")
        self.assertGreater(score, 0.5)

    def test_check_po_box_normal_address(self):
        """Test that normal addresses score zero."""
        score = self.service._check_po_box("123 Box Elder Lane")
        self.assertEqual(score, 0.0)

    # =========================================================================
    # Trust Ownership Detection Tests
    # =========================================================================

    def test_check_trust_ownership_trust_keyword(self):
        """Test detection of trust keyword."""
        score = self.service._check_trust_ownership("SMITH FAMILY TRUST")
        self.assertGreater(score, 0.5)

    def test_check_trust_ownership_trustee(self):
        """Test detection of trustee."""
        score = self.service._check_trust_ownership("JOHN SMITH AS TRUSTEE")
        self.assertGreater(score, 0.5)

    def test_check_trust_ownership_bank_trustee(self):
        """Test detection of bank as trustee (high indicator)."""
        score = self.service._check_trust_ownership("BANK OF UTAH AS OWNER TRUSTEE")
        self.assertGreater(score, 0.8)

        score = self.service._check_trust_ownership("WELLS FARGO BANK NA TRUSTEE")
        self.assertGreater(score, 0.8)

    def test_check_trust_ownership_individual(self):
        """Test that individual names score zero."""
        score = self.service._check_trust_ownership("JOHN SMITH")
        self.assertEqual(score, 0.0)

    # =========================================================================
    # Transfer History Tests
    # =========================================================================

    def test_check_transfer_history_no_transfers(self):
        """Test that no transfers scores zero."""
        score = self.service._check_transfer_history("N12345")
        self.assertEqual(score, 0.0)

    def test_check_transfer_history_multiple_transfers(self):
        """Test that multiple transfers scores high."""
        today = timezone.now().date()
        # Create 3 transfers in the last 3 years
        for i in range(3):
            RegistrationTransfer.objects.create(
                registration="N12345",
                previous_owner=f"Owner {i}",
                new_owner=f"Owner {i+1}",
                transfer_date=today - timedelta(days=365 * i),
            )

        score = self.service._check_transfer_history("N12345")
        self.assertGreater(score, 0.5)

    def test_check_transfer_history_rapid_succession(self):
        """Test that rapid transfers scores high."""
        today = timezone.now().date()
        # Create transfer with short interval
        RegistrationTransfer.objects.create(
            registration="N12345",
            previous_owner="Owner A",
            new_owner="Owner B",
            transfer_date=today - timedelta(days=60),
            days_since_last_transfer=30,  # Very rapid
        )

        score = self.service._check_transfer_history("N12345")
        self.assertGreater(score, 0.5)

    # =========================================================================
    # Shell Score Calculation Tests
    # =========================================================================

    def test_calculate_shell_score_all_zeros(self):
        """Test shell score with no indicators."""
        factors = {
            "llc_no_web_presence": 0.0,
            "registered_agent_address": 0.0,
            "po_box_address": 0.0,
            "multiple_transfers": 0.0,
            "trust_ownership": 0.0,
            "generic_llc_name": 0.0,
        }

        score, risk = self.service._calculate_shell_score(factors)

        self.assertEqual(score, 0.0)
        self.assertEqual(risk, "low")

    def test_calculate_shell_score_high_risk(self):
        """Test shell score with multiple high indicators."""
        factors = {
            "llc_no_web_presence": 0.8,
            "registered_agent_address": 0.9,
            "po_box_address": 0.6,
            "multiple_transfers": 0.7,
            "trust_ownership": 0.9,
            "generic_llc_name": 0.8,
        }

        score, risk = self.service._calculate_shell_score(factors)

        self.assertGreater(score, 0.7)
        self.assertEqual(risk, "high")

    def test_calculate_shell_score_medium_risk(self):
        """Test shell score for medium risk."""
        factors = {
            "llc_no_web_presence": 0.5,
            "registered_agent_address": 0.5,
            "po_box_address": 0.0,
            "multiple_transfers": 0.5,
            "trust_ownership": 0.0,
            "generic_llc_name": 0.5,
        }

        score, risk = self.service._calculate_shell_score(factors)

        self.assertGreaterEqual(score, 0.4)
        self.assertLess(score, 0.7)
        self.assertEqual(risk, "medium")

    # =========================================================================
    # Full Analysis Tests
    # =========================================================================

    def test_analyze_registration_shell_company(self):
        """Test full analysis of likely shell company."""
        result = self.service.analyze_registration(
            icao_hex="A12345",
            registration="N12345",
            owner_name="AB AVIATION LLC",
            owner_address="C/O CT CORPORATION SYSTEM, 1209 ORANGE ST",
        )

        self.assertEqual(result.icao_hex, "A12345")
        self.assertGreater(result.shell_company_score, 0.5)
        self.assertIn(result.risk_level, ["medium", "high"])
        self.assertGreater(result.factors.get("generic_llc_name", 0), 0)
        self.assertGreater(result.factors.get("registered_agent_address", 0), 0)

    def test_analyze_registration_legitimate(self):
        """Test full analysis of likely legitimate owner."""
        result = self.service.analyze_registration(
            icao_hex="B67890",
            registration="N67890",
            owner_name="DELTA AIR LINES INC",
            owner_address="1030 DELTA BLVD, ATLANTA GA 30320",
        )

        self.assertLess(result.shell_company_score, 0.4)
        self.assertEqual(result.risk_level, "low")

    def test_analyze_registration_trust_ownership(self):
        """Test analysis of trust-owned aircraft."""
        result = self.service.analyze_registration(
            icao_hex="C11111",
            registration="N11111",
            owner_name="WELLS FARGO BANK NA AS OWNER TRUSTEE",
            owner_address="1525 W WT HARRIS BLVD, CHARLOTTE NC",
        )

        self.assertGreater(result.factors.get("trust_ownership", 0), 0.5)

    # =========================================================================
    # Save Analysis Tests
    # =========================================================================

    def test_save_analysis_creates_record(self):
        """Test saving analysis creates database record."""
        result = AnalysisResult(
            icao_hex="A12345",
            registration="N12345",
            shell_company_score=0.75,
            risk_level="high",
            factors={"generic_llc_name": 0.8, "registered_agent_address": 0.9},
        )

        analysis = self.service.save_analysis(
            result,
            owner_name="TEST LLC",
            owner_address="123 Test St",
        )

        self.assertIsNotNone(analysis.id)
        self.assertEqual(analysis.icao_hex, "A12345")
        self.assertEqual(analysis.shell_company_score, 0.75)
        self.assertEqual(analysis.risk_level, "high")

    def test_save_analysis_updates_existing(self):
        """Test saving analysis updates existing record."""
        # Create initial analysis
        RegistrationAnalysis.objects.create(
            icao_hex="A12345",
            registration="N12345",
            owner_name="OLD LLC",
            shell_company_score=0.5,
            risk_level="medium",
        )

        result = AnalysisResult(
            icao_hex="A12345",
            registration="N12345",
            shell_company_score=0.8,
            risk_level="high",
            factors={},
        )

        analysis = self.service.save_analysis(
            result,
            owner_name="NEW LLC",
        )

        self.assertEqual(RegistrationAnalysis.objects.filter(icao_hex="A12345").count(), 1)
        self.assertEqual(analysis.owner_name, "NEW LLC")
        self.assertEqual(analysis.shell_company_score, 0.8)

    # =========================================================================
    # Owner Type Inference Tests
    # =========================================================================

    def test_infer_owner_type_llc(self):
        """Test inferring LLC owner type."""
        self.assertEqual(self.service._infer_owner_type("ABC AVIATION LLC"), "llc")

    def test_infer_owner_type_corporation(self):
        """Test inferring corporation owner type."""
        self.assertEqual(self.service._infer_owner_type("DELTA AIR LINES INC"), "corporation")
        self.assertEqual(self.service._infer_owner_type("UNITED AIRLINES CORP"), "corporation")

    def test_infer_owner_type_trust(self):
        """Test inferring trust owner type."""
        self.assertEqual(self.service._infer_owner_type("SMITH FAMILY TRUST"), "trust")

    def test_infer_owner_type_government(self):
        """Test inferring government owner type."""
        self.assertEqual(self.service._infer_owner_type("FEDERAL BUREAU OF INVESTIGATION"), "government")
        self.assertEqual(self.service._infer_owner_type("STATE OF CALIFORNIA"), "government")
        self.assertEqual(self.service._infer_owner_type("DEPARTMENT OF HOMELAND SECURITY"), "government")

    def test_infer_owner_type_individual(self):
        """Test inferring individual owner type."""
        self.assertEqual(self.service._infer_owner_type("SMITH, JOHN A"), "individual")

    def test_infer_owner_type_unknown(self):
        """Test defaulting to unknown."""
        self.assertEqual(self.service._infer_owner_type("SOME ENTITY"), "unknown")

    # =========================================================================
    # Record Transfer Tests
    # =========================================================================

    def test_record_transfer_creates_entry(self):
        """Test recording a transfer creates database entry."""
        today = timezone.now().date()

        transfer = self.service.record_transfer(
            registration="N12345",
            previous_owner="OWNER A",
            new_owner="OWNER B",
            transfer_date=today,
        )

        self.assertIsNotNone(transfer.id)
        self.assertEqual(transfer.registration, "N12345")
        self.assertEqual(transfer.previous_owner, "OWNER A")
        self.assertEqual(transfer.new_owner, "OWNER B")

    def test_record_transfer_calculates_days_since(self):
        """Test that days since last transfer is calculated."""
        today = timezone.now().date()

        # Create first transfer
        self.service.record_transfer(
            registration="N12345",
            previous_owner="OWNER A",
            new_owner="OWNER B",
            transfer_date=today - timedelta(days=100),
        )

        # Create second transfer
        transfer = self.service.record_transfer(
            registration="N12345",
            previous_owner="OWNER B",
            new_owner="OWNER C",
            transfer_date=today,
        )

        self.assertEqual(transfer.days_since_last_transfer, 100)

    # =========================================================================
    # Batch Analysis Tests
    # =========================================================================

    def test_get_high_risk_aircraft(self):
        """Test getting high-risk aircraft list."""
        # Create some analyses
        RegistrationAnalysis.objects.create(
            icao_hex="A11111",
            registration="N11111",
            owner_name="SHELL LLC",
            shell_company_score=0.9,
            risk_level="high",
            manually_reviewed=False,
        )
        RegistrationAnalysis.objects.create(
            icao_hex="A22222",
            registration="N22222",
            owner_name="NORMAL CO",
            shell_company_score=0.2,
            risk_level="low",
        )

        high_risk = self.service.get_high_risk_aircraft(limit=10)

        self.assertEqual(len(high_risk), 1)
        self.assertEqual(high_risk[0].icao_hex, "A11111")


class RegistrationAnalysisModelTests(TestCase):
    """Tests for RegistrationAnalysis model methods."""

    def test_calculate_shell_score(self):
        """Test model's calculate_shell_score method."""
        analysis = RegistrationAnalysis.objects.create(
            icao_hex="A12345",
            registration="N12345",
            owner_name="TEST",
            llc_no_web_presence=0.5,
            registered_agent_address=0.8,
            po_box_address=0.0,
            multiple_transfers=0.3,
            trust_ownership=0.7,
            generic_llc_name=0.6,
        )

        score = analysis.calculate_shell_score()

        self.assertGreater(score, 0.0)
        self.assertLessEqual(score, 1.0)
        self.assertEqual(analysis.shell_company_score, score)
        self.assertIn(analysis.risk_level, ["low", "medium", "high"])


class GetAnalysisServiceTests(TestCase):
    """Tests for get_analysis_service singleton."""

    def test_returns_same_instance(self):
        """Test that get_analysis_service returns singleton."""
        service1 = get_analysis_service()
        service2 = get_analysis_service()

        self.assertIs(service1, service2)

    def test_returns_correct_type(self):
        """Test that get_analysis_service returns RegistrationAnalysisService."""
        service = get_analysis_service()

        self.assertIsInstance(service, RegistrationAnalysisService)
