"""
Aircraft incident/accident records from public safety registries.

Primary source: the NTSB CAROL public query API (US accidents/incidents),
queried by aircraft registration. The API is POST-based and returns records
as ``Results[].Fields[]`` (each field a name + list of values); we flatten
that into a normalized dict and upsert into ``AircraftIncident``.

Aviation Safety Network (ASN) has no official API and is intentionally left as
a future best-effort addition.

Network access goes through the shared ``http_client`` (retry + breaker).
"""

import logging
from datetime import UTC, datetime

from skyspy.services import http_client

logger = logging.getLogger(__name__)

SOURCE = "ntsb"
_CAROL_QUERY_URL = "https://data.ntsb.gov/carol-main-public/api/Query/Main"
# CAROL is a single shared public endpoint; keep our aggregate rate modest.
_RATE = (30, 60)


def _carol_query_body(registration: str, size: int = 25) -> dict:
    """Build the CAROL query payload for 'accidents/incidents by registration'."""
    return {
        "ResultSetSize": size,
        "ResultSetOffset": 0,
        "QueryGroups": [
            {
                "QueryRules": [
                    {
                        "RuleType": "Simple",
                        "Values": [registration],
                        "Columns": ["Aircraft.RegistrationNumber"],
                        "Operator": "is",
                        "overrideColumn": "",
                    }
                ],
                "AndOr": "and",
                "inLastSearch": False,
                "editedSinceLastSearch": False,
            }
        ],
        "AndOr": "and",
        "SortColumn": None,
        "SortDescending": True,
        "TargetCollection": "cases",
        "SessionId": 0,
    }


def _flatten_fields(result: dict) -> dict:
    """Collapse a CAROL Result's Fields[] list into {FieldName: first_value}."""
    flat = {}
    for f in result.get("Fields") or []:
        name = f.get("FieldName")
        values = f.get("Values") or []
        if name and values:
            flat[name] = values[0] if len(values) == 1 else values
    return flat


def _parse_event_date(value) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        # CAROL returns e.g. "2018-04-17T11:03:00Z"
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError:
        return None


def fetch_ntsb_incidents(registration: str) -> list[dict]:
    """
    Query NTSB CAROL for a registration and return normalized incident dicts.

    Returns [] on no match or any failure (best-effort enrichment).
    """
    registration = (registration or "").upper().strip()
    if not registration:
        return []

    payload = http_client.post_json(
        _CAROL_QUERY_URL,
        _carol_query_body(registration),
        source=SOURCE,
        rate=_RATE,
        timeout=25.0,
        headers={"Content-Type": "application/json"},
    )
    if not isinstance(payload, dict):
        return []

    incidents = []
    for result in payload.get("Results") or []:
        fields = _flatten_fields(result)
        ntsb_no = fields.get("NtsbNo")
        if not ntsb_no:
            continue
        mkey = fields.get("Mkey")
        incidents.append(
            {
                "external_id": ntsb_no,
                "event_type": fields.get("EventType"),
                "event_date": _parse_event_date(fields.get("EventDate")),
                "severity": fields.get("HighestInjuryLevel") or fields.get("Damage"),
                "city": fields.get("City"),
                "state": fields.get("State"),
                "country": fields.get("Country"),
                "make": fields.get("VehicleMake"),
                "model": fields.get("VehicleModel"),
                "report_number": fields.get("ReportNo"),
                "url": (f"https://data.ntsb.gov/carol-main-public/summary/{mkey}" if mkey else None),
                "raw_data": fields,
            }
        )
    return incidents


def sync_incidents_for_registration(registration: str, icao_hex: str | None = None) -> int:
    """
    Fetch and upsert NTSB incidents for a registration. Returns the count.

    Deduped on (source, external_id); safe to re-run.
    """
    from skyspy.models import AircraftIncident

    incidents = fetch_ntsb_incidents(registration)
    written = 0
    for inc in incidents:
        AircraftIncident.objects.update_or_create(
            source=SOURCE,
            external_id=inc["external_id"],
            defaults={
                "registration": registration.upper().strip(),
                "icao_hex": (icao_hex or "").upper().strip() or None,
                "event_type": inc["event_type"],
                "event_date": inc["event_date"],
                "severity": inc["severity"],
                "city": inc["city"],
                "state": inc["state"],
                "country": inc["country"],
                "make": inc["make"],
                "model": inc["model"],
                "report_number": inc["report_number"],
                "url": inc["url"],
                "raw_data": inc["raw_data"],
            },
        )
        written += 1
    if written:
        logger.info(f"Synced {written} NTSB incident(s) for {registration}")
    return written
