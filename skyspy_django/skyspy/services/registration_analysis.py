"""
FAA registration analysis service for shell company detection.

Analyzes aircraft registrations to identify potential shell companies
commonly used by law enforcement to obscure aircraft ownership.
"""

import logging
import re
from dataclasses import dataclass, field
from typing import Any

from django.utils import timezone

from skyspy.models import (
    CannonballKnownAircraft,
    RegistrationAnalysis,
    RegistrationTransfer,
)

logger = logging.getLogger(__name__)


# Common patterns indicating shell companies
GENERIC_LLC_PATTERNS = [
    r"^[A-Z]{2,4}\s*AVIATION\s*(LLC|INC|CORP)?$",
    r"^[A-Z]{2,4}\s*AIR\s*(LLC|INC|CORP)?$",
    r"^[A-Z]{2,4}\s*AIRCRAFT\s*(LLC|INC|CORP)?$",
    r"^[A-Z]{2,4}\s*AERO\s*(LLC|INC|CORP)?$",
    r"^[A-Z]{2,4}\s*FLIGHT\s*(LLC|INC|CORP)?$",
    r"^AIRCRAFT\s*(GUARANTY|HOLDINGS|MANAGEMENT)\s*(LLC|CORP)?$",
    r"^AVIATION\s*(HOLDINGS|TRUST|MANAGEMENT)\s*(LLC|CORP)?$",
    r"^\d+\s*AVIATION\s*(LLC|INC)?$",
    r"^N\d+[A-Z]{0,2}\s*(LLC|INC)?$",  # LLC named after registration
    r"^[A-Z]+\s+TRUST$",
    r"^[A-Z]+\s+TRUSTEE$",
    r"^BANK\s+OF\s+UTAH.*TRUSTEE",
    r"^WELLS\s+FARGO.*TRUSTEE",
]

# Registered agent addresses (C/O Corporation Service, CT Corp, etc.)
REGISTERED_AGENT_INDICATORS = [
    "C/O CT CORPORATION",
    "C/O CORPORATION SERVICE",
    "C/O CSC",
    "C/O NATIONAL REGISTERED AGENTS",
    "C/O UNITED AGENT GROUP",
    "C/O COGENCY GLOBAL",
    "REGISTERED AGENT",
    "CORPORATE TRUST CENTER",
    "TRUST COMPANY",
    "TRUSTEE SERVICES",
]

# PO Box patterns
PO_BOX_PATTERNS = [
    r"P\.?\s*O\.?\s*BOX\s*\d+",
    r"POST\s*OFFICE\s*BOX\s*\d+",
    r"PMB\s*\d+",  # Private Mailbox
    r"MAIL\s*BOX\s*\d+",
]

# Known shell company addresses (commonly used by government contractors)
KNOWN_SHELL_ADDRESSES = [
    "151 N MAIN ST",  # Popular Delaware address
    "1209 ORANGE ST",  # Delaware
    "2711 CENTERVILLE RD",  # Delaware
]


@dataclass
class AnalysisResult:
    """Result of a registration analysis."""

    icao_hex: str
    registration: str
    shell_company_score: float
    risk_level: str
    factors: dict[str, float] = field(default_factory=dict)
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "icao_hex": self.icao_hex,
            "registration": self.registration,
            "shell_company_score": self.shell_company_score,
            "risk_level": self.risk_level,
            "factors": self.factors,
            "details": self.details,
        }


class RegistrationAnalysisService:
    """
    Service for analyzing aircraft registrations to detect shell companies.

    Shell company indicators:
    - Generic LLC names (e.g., "ABC Aviation LLC")
    - Registered agent addresses
    - PO Box addresses
    - Trust ownership structures
    - Multiple rapid ownership transfers
    - No web presence for owner
    """

    def __init__(self):
        self._generic_llc_patterns = [re.compile(p, re.IGNORECASE) for p in GENERIC_LLC_PATTERNS]
        self._po_box_patterns = [re.compile(p, re.IGNORECASE) for p in PO_BOX_PATTERNS]

    def analyze_registration(
        self,
        icao_hex: str,
        registration: str | None = None,
        owner_name: str | None = None,
        owner_address: str | None = None,
        owner_city: str | None = None,
        owner_state: str | None = None,
        **kwargs,
    ) -> AnalysisResult:
        """
        Analyze a registration for shell company indicators.

        Args:
            icao_hex: Aircraft ICAO hex code
            registration: Aircraft registration (N-number)
            owner_name: Registered owner name
            owner_address: Owner street address
            owner_city: Owner city
            owner_state: Owner state

        Returns:
            AnalysisResult with scores and details
        """
        factors = {}
        details = {}

        # Check for generic LLC name pattern
        if owner_name:
            factors["generic_llc_name"] = self._check_generic_llc_name(owner_name)
            if factors["generic_llc_name"] > 0:
                details["generic_llc_match"] = True

        # Check for registered agent address
        if owner_address:
            factors["registered_agent_address"] = self._check_registered_agent(owner_address)
            if factors["registered_agent_address"] > 0:
                details["registered_agent_detected"] = True

            # Check for PO Box
            factors["po_box_address"] = self._check_po_box(owner_address)
            if factors["po_box_address"] > 0:
                details["po_box_detected"] = True

        # Check for trust ownership
        if owner_name:
            factors["trust_ownership"] = self._check_trust_ownership(owner_name)
            if factors["trust_ownership"] > 0:
                details["trust_ownership_detected"] = True

        # Check transfer history
        if registration:
            transfer_score = self._check_transfer_history(registration)
            factors["multiple_transfers"] = transfer_score
            if transfer_score > 0:
                details["rapid_transfers_detected"] = True

        # LLC with no web presence (placeholder - would need external API)
        factors["llc_no_web_presence"] = 0.0

        # Calculate aggregate score
        shell_score, risk_level = self._calculate_shell_score(factors)

        return AnalysisResult(
            icao_hex=icao_hex,
            registration=registration or "",
            shell_company_score=shell_score,
            risk_level=risk_level,
            factors=factors,
            details=details,
        )

    def _check_generic_llc_name(self, owner_name: str) -> float:
        """Check if owner name matches generic LLC patterns."""
        owner_upper = owner_name.upper().strip()

        for pattern in self._generic_llc_patterns:
            if pattern.match(owner_upper):
                return 0.8

        # Check for LLC/Corp suffix without specific company indicators
        if re.search(r"\bLLC\b|\bINC\b|\bCORP\b", owner_upper):
            # Check if it's a very short name (likely generic)
            words = owner_upper.replace(",", " ").split()
            if len(words) <= 3:
                return 0.5

        return 0.0

    def _check_registered_agent(self, address: str) -> float:
        """Check if address indicates a registered agent."""
        address_upper = address.upper()

        for indicator in REGISTERED_AGENT_INDICATORS:
            if indicator in address_upper:
                return 0.9

        # Check known shell addresses
        for known_addr in KNOWN_SHELL_ADDRESSES:
            if known_addr in address_upper:
                return 0.7

        return 0.0

    def _check_po_box(self, address: str) -> float:
        """Check if address is a PO Box."""
        for pattern in self._po_box_patterns:
            if pattern.search(address):
                return 0.6
        return 0.0

    def _check_trust_ownership(self, owner_name: str) -> float:
        """Check if ownership is through a trust structure."""
        owner_upper = owner_name.upper()

        trust_indicators = [
            "TRUST",
            "TRUSTEE",
            "TTEE",
            "AS TRUSTEE",
            "OWNER TRUSTEE",
            "INDENTURE TRUSTEE",
        ]

        for indicator in trust_indicators:
            if indicator in owner_upper:
                # Bank trustee arrangements are very common for LE shell companies
                if "BANK" in owner_upper or "WELLS FARGO" in owner_upper:
                    return 0.9
                return 0.7

        return 0.0

    def _check_transfer_history(self, registration: str) -> float:
        """
        Check for suspicious transfer patterns.

        Multiple transfers in a short period can indicate shell company activity.
        """
        # Look up transfer history
        recent_transfers = RegistrationTransfer.objects.filter(
            registration=registration,
            transfer_date__gte=timezone.now().date() - timezone.timedelta(days=365 * 3),
        ).order_by("-transfer_date")

        transfer_count = recent_transfers.count()

        if transfer_count == 0:
            return 0.0

        # Multiple transfers in 3 years is suspicious
        if transfer_count >= 3:
            return 0.8
        elif transfer_count >= 2:
            return 0.5

        # Check for rapid succession transfers
        for transfer in recent_transfers:
            if transfer.days_since_last_transfer and transfer.days_since_last_transfer < 90:
                return 0.7

        return 0.2 if transfer_count > 0 else 0.0

    def _calculate_shell_score(self, factors: dict[str, float]) -> tuple[float, str]:
        """
        Calculate aggregate shell company score.

        Returns:
            Tuple of (score, risk_level)
        """
        weights = {
            "llc_no_web_presence": 0.15,
            "registered_agent_address": 0.25,
            "po_box_address": 0.10,
            "multiple_transfers": 0.20,
            "trust_ownership": 0.15,
            "generic_llc_name": 0.15,
        }

        score = 0.0
        for factor, weight in weights.items():
            factor_score = factors.get(factor, 0.0)
            score += factor_score * weight

        # Determine risk level
        if score >= 0.7:
            risk_level = "high"
        elif score >= 0.4:
            risk_level = "medium"
        else:
            risk_level = "low"

        return min(1.0, max(0.0, score)), risk_level

    def save_analysis(self, result: AnalysisResult, **faa_data) -> RegistrationAnalysis:
        """
        Save analysis result to database.

        Args:
            result: Analysis result to save
            **faa_data: Additional FAA data fields
        """
        analysis, created = RegistrationAnalysis.objects.update_or_create(
            icao_hex=result.icao_hex,
            defaults={
                "registration": result.registration,
                "owner_name": faa_data.get("owner_name", ""),
                "owner_address": faa_data.get("owner_address", ""),
                "owner_city": faa_data.get("owner_city", ""),
                "owner_state": faa_data.get("owner_state", ""),
                "owner_zip": faa_data.get("owner_zip", ""),
                "llc_no_web_presence": result.factors.get("llc_no_web_presence", 0.0),
                "registered_agent_address": result.factors.get("registered_agent_address", 0.0),
                "po_box_address": result.factors.get("po_box_address", 0.0),
                "multiple_transfers": result.factors.get("multiple_transfers", 0.0),
                "trust_ownership": result.factors.get("trust_ownership", 0.0),
                "generic_llc_name": result.factors.get("generic_llc_name", 0.0),
                "shell_company_score": result.shell_company_score,
                "risk_level": result.risk_level,
                "aircraft_type": faa_data.get("aircraft_type", ""),
                "aircraft_manufacturer": faa_data.get("manufacturer", ""),
                "aircraft_model": faa_data.get("model", ""),
                "aircraft_year": faa_data.get("year_manufactured"),
                "faa_last_action_date": faa_data.get("last_action_date"),
                "certificate_issue_date": faa_data.get("certificate_issue_date"),
            },
        )

        return analysis

    def analyze_and_flag_known_aircraft(self) -> dict[str, int]:
        """
        Analyze all known LE aircraft that haven't been analyzed.

        Returns:
            Statistics about the analysis run
        """
        stats = {"analyzed": 0, "high_risk": 0, "medium_risk": 0, "low_risk": 0, "errors": 0}

        # Get aircraft without analysis records
        aircraft_to_analyze = CannonballKnownAircraft.objects.exclude(
            icao_hex__in=RegistrationAnalysis.objects.values_list("icao_hex", flat=True)
        )

        for aircraft in aircraft_to_analyze[:500]:  # Batch limit
            try:
                result = self.analyze_registration(
                    icao_hex=aircraft.icao_hex,
                    registration=aircraft.registration,
                    owner_name=aircraft.agency_name,  # Use agency name as proxy
                )

                self.save_analysis(result)
                stats["analyzed"] += 1

                if result.risk_level == "high":
                    stats["high_risk"] += 1
                elif result.risk_level == "medium":
                    stats["medium_risk"] += 1
                else:
                    stats["low_risk"] += 1

            except Exception as e:
                logger.error(f"Error analyzing {aircraft.icao_hex}: {e}")
                stats["errors"] += 1

        return stats

    def get_high_risk_aircraft(self, limit: int = 100) -> list[RegistrationAnalysis]:
        """Get aircraft with high shell company risk scores."""
        return list(
            RegistrationAnalysis.objects.filter(
                risk_level="high",
                manually_reviewed=False,
            ).order_by("-shell_company_score")[:limit]
        )

    def record_transfer(
        self,
        registration: str,
        previous_owner: str,
        new_owner: str,
        transfer_date,
    ) -> RegistrationTransfer:
        """
        Record an ownership transfer for a registration.
        """
        # Calculate days since last transfer
        last_transfer = (
            RegistrationTransfer.objects.filter(registration=registration).order_by("-transfer_date").first()
        )

        days_since = None
        if last_transfer:
            days_since = (transfer_date - last_transfer.transfer_date).days

        transfer = RegistrationTransfer.objects.create(
            registration=registration,
            previous_owner=previous_owner,
            new_owner=new_owner,
            transfer_date=transfer_date,
            days_since_last_transfer=days_since,
            previous_owner_type=self._infer_owner_type(previous_owner),
            new_owner_type=self._infer_owner_type(new_owner),
        )

        # Re-analyze the registration after recording transfer
        analysis = RegistrationAnalysis.objects.filter(registration=registration).first()
        if analysis:
            result = self.analyze_registration(
                icao_hex=analysis.icao_hex,
                registration=registration,
                owner_name=new_owner,
                owner_address=analysis.owner_address,
            )
            analysis.multiple_transfers = result.factors.get("multiple_transfers", 0.0)
            analysis.shell_company_score = result.shell_company_score
            analysis.risk_level = result.risk_level
            analysis.save()

        return transfer

    def _infer_owner_type(self, owner_name: str) -> str:
        """Infer the type of owner from the name."""
        name_upper = owner_name.upper()

        if "LLC" in name_upper:
            return "llc"
        elif "CORP" in name_upper or "INC" in name_upper:
            return "corporation"
        elif "TRUST" in name_upper:
            return "trust"
        elif any(gov in name_upper for gov in ["FEDERAL", "STATE", "COUNTY", "CITY", "DEPARTMENT"]):
            return "government"
        elif "," in owner_name:  # Common pattern for individuals: "Last, First"
            return "individual"

        return "unknown"


# Module-level service instance
_analysis_service: RegistrationAnalysisService | None = None


def get_analysis_service() -> RegistrationAnalysisService:
    """Get or create the analysis service instance."""
    global _analysis_service
    if _analysis_service is None:
        _analysis_service = RegistrationAnalysisService()
    return _analysis_service
