"""
Celery tasks for aircraft registration analysis.

Tasks:
- analyze_new_sightings: Daily analysis of newly seen aircraft
- refresh_transfer_history: Weekly update of transfer data
- analyze_high_risk_registrations: Focused analysis of suspicious registrations
"""

import logging
from datetime import timedelta

from celery import shared_task
from django.db.models import Q
from django.utils import timezone

from skyspy.models import (
    CannonballKnownAircraft,
    CannonballSession,
    RegistrationAnalysis,
)
from skyspy.services.registration_analysis import get_analysis_service

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=2)
def analyze_new_sightings(self, days: int = 1, batch_size: int = 100):
    """
    Analyze recently sighted aircraft for shell company indicators.

    Analyzes aircraft that were detected in Cannonball sessions but
    don't have registration analysis records yet.

    Args:
        days: How many days back to look for sightings
        batch_size: Maximum number of aircraft to analyze per run
    """
    try:
        service = get_analysis_service()
        cutoff = timezone.now() - timedelta(days=days)

        # Find recently seen aircraft without analysis
        recent_icaos = (
            CannonballSession.objects.filter(first_seen__gte=cutoff).values_list("icao_hex", flat=True).distinct()
        )

        analyzed_icaos = RegistrationAnalysis.objects.values_list("icao_hex", flat=True)

        to_analyze = set(recent_icaos) - set(analyzed_icaos)

        stats = {
            "candidates": len(to_analyze),
            "analyzed": 0,
            "high_risk": 0,
            "medium_risk": 0,
            "low_risk": 0,
            "errors": 0,
        }

        # Analyze up to batch_size aircraft
        for icao_hex in list(to_analyze)[:batch_size]:
            try:
                # Get associated known aircraft info if available
                known = CannonballKnownAircraft.objects.filter(icao_hex=icao_hex).first()

                owner_name = known.agency_name if known else ""
                registration = known.registration if known else ""

                if not owner_name and not registration:
                    # Skip if we have no data to analyze
                    continue

                result = service.analyze_registration(
                    icao_hex=icao_hex,
                    registration=registration,
                    owner_name=owner_name,
                )

                service.save_analysis(
                    result,
                    owner_name=owner_name,
                    registration=registration,
                )

                stats["analyzed"] += 1

                if result.risk_level == "high":
                    stats["high_risk"] += 1
                elif result.risk_level == "medium":
                    stats["medium_risk"] += 1
                else:
                    stats["low_risk"] += 1

            except Exception as e:  # broad: per-aircraft loop boundary — one bad analysis must not stop the batch
                logger.warning(f"Error analyzing {icao_hex}: {e}")
                stats["errors"] += 1

        logger.info(
            f"Analyzed {stats['analyzed']} new sightings: "
            f"{stats['high_risk']} high, {stats['medium_risk']} medium, "
            f"{stats['low_risk']} low risk"
        )

        return stats

    except Exception as e:  # broad: Celery task top-level guard — triggers retry on any failure
        logger.exception(f"Error in analyze_new_sightings: {e}")
        raise self.retry(exc=e)


@shared_task
def analyze_known_aircraft_batch(batch_size: int = 200):
    """
    Analyze known LE aircraft that haven't been analyzed yet.

    This builds up the registration analysis database from the
    existing known aircraft database.
    """
    try:
        service = get_analysis_service()
        stats = service.analyze_and_flag_known_aircraft()

        logger.info(
            f"Analyzed {stats['analyzed']} known aircraft: "
            f"{stats['high_risk']} high risk, {stats['medium_risk']} medium risk"
        )

        return stats

    except Exception as e:  # broad: Celery task top-level guard — logs and re-raises any failure
        logger.exception(f"Error in analyze_known_aircraft_batch: {e}")
        raise


@shared_task
def refresh_transfer_history(batch_size: int = 100):
    """
    Refresh transfer history for aircraft with high shell scores.

    Focuses on re-analyzing aircraft that already show shell company
    indicators to check for recent ownership changes.
    """
    try:
        service = get_analysis_service()

        # Get high-risk aircraft
        high_risk = RegistrationAnalysis.objects.filter(
            Q(risk_level="high") | Q(shell_company_score__gte=0.5),
            registration__isnull=False,
        ).exclude(registration="")[:batch_size]

        stats = {"checked": 0, "updated": 0, "errors": 0}

        for analysis in high_risk:
            try:
                # Re-analyze with current data
                result = service.analyze_registration(
                    icao_hex=analysis.icao_hex,
                    registration=analysis.registration,
                    owner_name=analysis.owner_name,
                    owner_address=analysis.owner_address,
                )

                # Check if score changed significantly
                if abs(result.shell_company_score - analysis.shell_company_score) > 0.1:
                    analysis.shell_company_score = result.shell_company_score
                    analysis.risk_level = result.risk_level
                    analysis.multiple_transfers = result.factors.get("multiple_transfers", 0.0)
                    analysis.save()
                    stats["updated"] += 1

                stats["checked"] += 1

            except Exception as e:  # broad: per-aircraft loop boundary — one bad re-analysis must not stop the batch
                logger.warning(f"Error refreshing {analysis.registration}: {e}")
                stats["errors"] += 1

        logger.info(f"Refreshed transfer history: {stats['checked']} checked, {stats['updated']} updated")

        return stats

    except Exception as e:  # broad: Celery task top-level guard — logs and re-raises any failure
        logger.exception(f"Error in refresh_transfer_history: {e}")
        raise


@shared_task
def generate_high_risk_report():
    """
    Generate a report of high-risk registrations for review.

    Creates a summary of unreviewed high-risk aircraft for admin attention.
    """
    try:
        # Get high-risk unreviewed aircraft
        high_risk = RegistrationAnalysis.objects.filter(
            risk_level="high",
            manually_reviewed=False,
        ).order_by("-shell_company_score")[:50]

        # Get statistics
        stats = {
            "total_analyzed": RegistrationAnalysis.objects.count(),
            "high_risk_total": RegistrationAnalysis.objects.filter(risk_level="high").count(),
            "high_risk_unreviewed": RegistrationAnalysis.objects.filter(
                risk_level="high",
                manually_reviewed=False,
            ).count(),
            "confirmed_le": RegistrationAnalysis.objects.filter(is_confirmed_le=True).count(),
        }

        # Top unreviewed aircraft
        top_aircraft = [
            {
                "icao_hex": a.icao_hex,
                "registration": a.registration,
                "owner_name": a.owner_name[:50],
                "shell_score": round(a.shell_company_score, 2),
                "factors": {
                    "registered_agent": a.registered_agent_address,
                    "trust": a.trust_ownership,
                    "generic_llc": a.generic_llc_name,
                    "transfers": a.multiple_transfers,
                },
            }
            for a in high_risk[:20]
        ]

        report = {
            "generated_at": timezone.now().isoformat(),
            "statistics": stats,
            "top_unreviewed": top_aircraft,
        }

        logger.info(
            f"High risk report: {stats['high_risk_unreviewed']} unreviewed "
            f"out of {stats['high_risk_total']} high-risk aircraft"
        )

        return report

    except Exception as e:  # broad: Celery task top-level guard — logs and re-raises any failure
        logger.exception(f"Error generating high risk report: {e}")
        raise


@shared_task
def cleanup_old_analyses(retention_days: int = 180):
    """
    Clean up old registration analyses for aircraft no longer seen.

    Removes analyses for aircraft that:
    - Haven't been seen in Cannonball sessions for 6+ months
    - Are not in the known aircraft database
    - Are not confirmed LE
    """
    try:
        cutoff = timezone.now() - timedelta(days=retention_days)

        # Get ICAO hexes of aircraft seen recently or in known database
        recent_sessions = CannonballSession.objects.filter(last_seen__gte=cutoff).values_list("icao_hex", flat=True)

        known_aircraft = CannonballKnownAircraft.objects.values_list("icao_hex", flat=True)

        keep_icaos = set(recent_sessions) | set(known_aircraft)

        # Delete old analyses for aircraft not in keep list
        deleted, _ = (
            RegistrationAnalysis.objects.filter(
                created_at__lt=cutoff,
                is_confirmed_le__isnull=True,  # Not confirmed
                manually_reviewed=False,  # Not reviewed
            )
            .exclude(icao_hex__in=keep_icaos)
            .delete()
        )

        if deleted:
            logger.info(f"Cleaned up {deleted} old registration analyses")

        return {"deleted": deleted}

    except Exception as e:  # broad: Celery task top-level guard — logs and re-raises any failure
        logger.exception(f"Error in cleanup_old_analyses: {e}")
        raise
