"""
Airframe dossier builder — the "staging" layer for LLM/RAG.

Assembles everything SkySpy knows about one airframe into a single normalized
document: identity + airframe facts, ownership analysis, per-field provenance,
incident history, and a summary of how it has been seen locally. Emits both a
structured dict (for the API) and a compact human-readable text rendering
(what gets embedded for retrieval).

Pure aggregation over models already populated by the other phases — no network
calls — so it is cheap to rebuild whenever ``AircraftInfo`` changes.
"""

import logging

from django.db.models import Avg, Count, Max, Min

logger = logging.getLogger(__name__)


def build_dossier(icao_hex: str) -> dict | None:
    """
    Build the structured dossier for an ICAO hex, or None if unknown.

    Returns {"icao_hex", "text", ...structured sections}. ``text`` is the
    embedding/context input; the rest is for API consumers.
    """
    from skyspy.models import AircraftIncident, AircraftInfo, AircraftSighting

    icao_hex = (icao_hex or "").upper().strip().lstrip("~")
    if not icao_hex:
        return None

    info = AircraftInfo.objects.filter(icao_hex=icao_hex).first()
    if info is None:
        return None

    incidents = list(AircraftIncident.objects.filter(icao_hex=icao_hex).order_by("-event_date")[:20])
    # Incidents are keyed on registration too — catch rows linked before the
    # hex was known.
    if info.registration and not incidents:
        incidents = list(AircraftIncident.objects.filter(registration=info.registration).order_by("-event_date")[:20])

    sightings_agg = AircraftSighting.objects.filter(icao_hex=icao_hex).aggregate(
        count=Count("id"),
        first_seen=Min("timestamp"),
        last_seen=Max("timestamp"),
        max_alt=Max("altitude_baro"),
        min_dist=Min("distance_nm"),
        avg_dist=Avg("distance_nm"),
    )

    dossier = {
        "icao_hex": icao_hex,
        "identity": {
            "registration": info.registration,
            "type_code": info.type_code,
            "type_name": info.type_name,
            "manufacturer": info.manufacturer,
            "model": info.model,
            "serial_number": info.serial_number,
            "year_built": info.year_built,
            "country": info.country,
            "category": info.category,
            "is_military": info.is_military,
        },
        "operator": {
            "operator": info.operator,
            "operator_icao": info.operator_icao,
            "owner": info.owner,
            "owner_type": info.owner_type,
            "city": info.city,
            "state": info.state,
        },
        "ownership_risk": {
            "is_shell_suspected": info.is_shell_suspected,
            "shell_score": info.shell_score,
            "flags": info.ownership_flags,
        },
        "privacy_flags": {
            "is_interesting": info.is_interesting,
            "is_pia": info.is_pia,
            "is_ladd": info.is_ladd,
        },
        "provenance": info.field_sources,
        "sources": (info.source or "").split(",") if info.source else [],
        "incidents": [
            {
                "source": inc.source,
                "id": inc.external_id,
                "type": inc.event_type,
                "date": inc.event_date.isoformat() if inc.event_date else None,
                "location": ", ".join(x for x in [inc.city, inc.state, inc.country] if x),
                "severity": inc.severity,
                "report": inc.report_number,
                "url": inc.url,
            }
            for inc in incidents
        ],
        "observations": {
            "sighting_count": sightings_agg["count"],
            "first_seen": sightings_agg["first_seen"].isoformat() if sightings_agg["first_seen"] else None,
            "last_seen": sightings_agg["last_seen"].isoformat() if sightings_agg["last_seen"] else None,
            "max_altitude_ft": sightings_agg["max_alt"],
            "closest_nm": round(sightings_agg["min_dist"], 1) if sightings_agg["min_dist"] is not None else None,
        },
    }
    dossier["text"] = _render_text(dossier)
    return dossier


def _render_text(d: dict) -> str:
    """Compact prose rendering of a dossier — the string that gets embedded."""
    ident = d["identity"]
    op = d["operator"]
    lines = []

    reg = ident.get("registration") or "unknown registration"
    typ = (
        " ".join(x for x in [ident.get("manufacturer"), ident.get("model")] if x)
        or ident.get("type_code")
        or "unknown type"
    )
    lines.append(f"Aircraft {d['icao_hex']} ({reg}), a {typ}.")

    if ident.get("year_built"):
        lines.append(f"Built {ident['year_built']}.")
    if ident.get("country"):
        lines.append(f"Registered in {ident['country']}.")
    if ident.get("is_military"):
        lines.append("Flagged as military.")

    owner_bits = [x for x in [op.get("owner"), op.get("owner_type")] if x]
    if owner_bits:
        loc = ", ".join(x for x in [op.get("city"), op.get("state")] if x)
        lines.append(f"Owner: {' — '.join(owner_bits)}{f' ({loc})' if loc else ''}.")
    if op.get("operator"):
        lines.append(f"Operator: {op['operator']}.")

    risk = d["ownership_risk"]
    if risk.get("is_shell_suspected"):
        lines.append(f"Ownership flagged as a suspected shell/opaque structure (score {risk.get('shell_score')}).")

    flags = [k.replace("is_", "").upper() for k, v in d["privacy_flags"].items() if v]
    if flags:
        lines.append(f"Privacy flags: {', '.join(flags)}.")

    incs = d["incidents"]
    if incs:
        lines.append(f"{len(incs)} recorded incident(s):")
        for inc in incs[:5]:
            when = (inc["date"] or "")[:10]
            sev = f" ({inc['severity']})" if inc.get("severity") else ""
            lines.append(
                f"- {inc.get('type') or 'Event'} {inc['id']} on {when} at {inc.get('location') or 'unknown'}{sev}."
            )
    else:
        lines.append("No recorded safety incidents.")

    obs = d["observations"]
    if obs.get("sighting_count"):
        seen = f"Seen locally {obs['sighting_count']} time(s)"
        if obs.get("closest_nm") is not None:
            seen += f", closest {obs['closest_nm']} nm"
        if obs.get("last_seen"):
            seen += f", last {obs['last_seen'][:10]}"
        lines.append(seen + ".")

    return " ".join(lines)
