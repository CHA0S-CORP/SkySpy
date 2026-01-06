"""
Alert rule evaluation service.
"""
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.utils import safe_int_altitude
from app.models import AlertRule, AlertHistory

logger = logging.getLogger(__name__)


def evaluate_single_condition(
    aircraft: dict, condition: dict, distance_nm: Optional[float] = None
) -> bool:
    """Evaluate a single condition against an aircraft."""
    cond_type = condition.get("type", "").lower()
    operator = condition.get("operator", "eq").lower()
    value = str(condition.get("value", "")).upper()
    
    if cond_type == "icao":
        ac_val = aircraft.get("hex", "").upper()
        if operator == "eq":
            return ac_val == value
        elif operator == "neq":
            return ac_val != value
        elif operator == "contains":
            return value in ac_val
        return ac_val == value
    
    elif cond_type == "callsign":
        ac_val = (aircraft.get("flight") or "").strip().upper()
        if operator == "eq":
            return ac_val == value
        elif operator == "neq":
            return ac_val != value
        elif operator == "contains":
            return value in ac_val
        return ac_val.startswith(value)
    
    elif cond_type == "squawk":
        ac_val = aircraft.get("squawk", "")
        if operator == "eq":
            return ac_val == value
        elif operator == "neq":
            return ac_val != value
        elif operator == "contains":
            return value in ac_val
        return ac_val == value
    
    elif cond_type == "altitude":
        alt = safe_int_altitude(aircraft.get("alt_baro")) or safe_int_altitude(aircraft.get("alt_geom"))
        if alt is None:
            return False
        try:
            threshold = float(value)
            if operator == "lt":
                return alt < threshold
            elif operator == "gt":
                return alt > threshold
            elif operator == "lte":
                return alt <= threshold
            elif operator == "gte":
                return alt >= threshold
            elif operator == "eq":
                return alt == threshold
            elif operator == "neq":
                return alt != threshold
            return alt == threshold
        except ValueError:
            return False
    
    elif cond_type == "vertical_rate":
        vr = aircraft.get("baro_rate", aircraft.get("geom_rate"))
        if vr is None:
            return False
        try:
            threshold = float(value)
            if operator == "lt":
                return vr < threshold
            elif operator == "gt":
                return vr > threshold
            elif operator == "lte":
                return vr <= threshold
            elif operator == "gte":
                return vr >= threshold
            elif operator == "eq":
                return vr == threshold
            elif operator == "neq":
                return vr != threshold
            return abs(vr) >= abs(threshold)
        except ValueError:
            return False
    
    elif cond_type == "speed":
        gs = aircraft.get("gs")
        if gs is None:
            return False
        try:
            threshold = float(value)
            if operator == "lt":
                return gs < threshold
            elif operator == "gt":
                return gs > threshold
            elif operator == "lte":
                return gs <= threshold
            elif operator == "gte":
                return gs >= threshold
            elif operator == "eq":
                return gs == threshold
            elif operator == "neq":
                return gs != threshold
            return gs == threshold
        except ValueError:
            return False
    
    elif cond_type == "category":
        ac_val = aircraft.get("category", "").upper()
        if operator == "eq":
            return ac_val == value
        elif operator == "neq":
            return ac_val != value
        elif operator == "contains":
            return value in ac_val
        return ac_val == value
    
    elif cond_type == "proximity":
        if distance_nm is None:
            return False
        try:
            threshold = float(value)
            if operator in ["lt", "lte"]:
                return distance_nm <= threshold
            elif operator in ["gt", "gte"]:
                return distance_nm >= threshold
            return distance_nm <= threshold
        except ValueError:
            return False
    
    elif cond_type == "military":
        is_mil = bool(aircraft.get("dbFlags", 0) & 1)
        expected = value.lower() in ["true", "1", "yes"]
        return is_mil == expected
    
    elif cond_type == "emergency":
        squawk = aircraft.get("squawk", "")
        is_emergency = squawk in ["7500", "7600", "7700"]
        expected = value.lower() in ["true", "1", "yes"]
        return is_emergency == expected
    
    elif cond_type == "aircraft_type":
        ac_type = aircraft.get("t", "").upper()
        if operator == "eq":
            return ac_type == value
        elif operator == "neq":
            return ac_type != value
        elif operator == "contains":
            return value in ac_type
        return ac_type == value

    elif cond_type == "registration":
        # Registration/tail number (e.g., N12345, G-ABCD)
        ac_val = (aircraft.get("r") or "").strip().upper()
        if operator == "eq":
            return ac_val == value
        elif operator == "neq":
            return ac_val != value
        elif operator == "contains":
            return value in ac_val
        elif operator == "startswith":
            return ac_val.startswith(value)
        return ac_val == value

    elif cond_type == "operator":
        # Operator ICAO code (e.g., UAL, AAL, DAL)
        ac_val = (aircraft.get("ownOp") or "").strip().upper()
        if operator == "eq":
            return ac_val == value
        elif operator == "neq":
            return ac_val != value
        elif operator == "contains":
            return value in ac_val
        return ac_val == value

    return False


def evaluate_condition_group(
    aircraft: dict, group: dict, distance_nm: Optional[float] = None
) -> bool:
    """Evaluate a group of conditions with AND/OR logic."""
    conditions = group.get("conditions", [])
    logic = group.get("logic", "AND").upper()
    
    if not conditions:
        return False
    
    if logic == "OR":
        return any(
            evaluate_single_condition(aircraft, c, distance_nm)
            for c in conditions
        )
    else:  # AND
        return all(
            evaluate_single_condition(aircraft, c, distance_nm)
            for c in conditions
        )


def evaluate_rule(
    aircraft: dict, rule: AlertRule, distance_nm: Optional[float] = None
) -> bool:
    """Evaluate if an aircraft matches a rule."""
    now = datetime.utcnow()
    
    # Check scheduling
    if rule.starts_at and now < rule.starts_at:
        return False
    if rule.expires_at and now > rule.expires_at:
        return False
    
    # Complex conditions
    if rule.conditions:
        groups = rule.conditions.get("groups", [])
        logic = rule.conditions.get("logic", "AND").upper()
        
        if groups:
            if logic == "OR":
                return any(
                    evaluate_condition_group(aircraft, g, distance_nm)
                    for g in groups
                )
            else:  # AND
                return all(
                    evaluate_condition_group(aircraft, g, distance_nm)
                    for g in groups
                )
    
    # Legacy single condition
    if rule.rule_type:
        return evaluate_single_condition(aircraft, {
            "type": rule.rule_type,
            "operator": rule.operator,
            "value": rule.value
        }, distance_nm)
    
    return False


async def check_alerts(
    db: AsyncSession, aircraft: dict, distance_nm: Optional[float] = None
) -> list[dict]:
    """Check all alert rules against aircraft."""
    alerts = []
    icao = aircraft.get("hex", "").upper()
    callsign = (aircraft.get("flight") or "").strip()
    
    try:
        result = await db.execute(
            select(AlertRule).where(AlertRule.enabled == True)
        )
        rules = result.scalars().all()
        
        for rule in rules:
            if evaluate_rule(aircraft, rule, distance_nm):
                msg_parts = [f"Aircraft {callsign or icao}"]
                
                if rule.rule_type == "altitude" or (
                    rule.conditions and "altitude" in str(rule.conditions)
                ):
                    alt = aircraft.get("alt_baro", aircraft.get("alt_geom", "?"))
                    msg_parts.append(f"at {alt}ft")
                elif rule.rule_type == "vertical_rate":
                    vr = aircraft.get("baro_rate", aircraft.get("geom_rate", 0))
                    msg_parts.append(f"VS {vr}fpm")
                elif rule.rule_type == "proximity" and distance_nm:
                    msg_parts.append(f"within {distance_nm:.1f}nm")
                elif rule.rule_type == "squawk":
                    msg_parts.append(f"squawking {aircraft.get('squawk')}")
                
                msg_parts.append(f"triggered alert: {rule.name}")
                
                alerts.append({
                    "type": f"rule_{rule.rule_type or 'complex'}",
                    "rule_id": rule.id,
                    "rule_name": rule.name,
                    "title": f"🔔 {rule.name}",
                    "message": " ".join(msg_parts),
                    "priority": rule.priority,
                    "api_url": rule.api_url
                })
    except Exception as e:
        logger.error(f"Error checking rules: {e}")
    
    # Default emergency check
    squawk = aircraft.get("squawk", "")
    if squawk in ["7500", "7600", "7700"]:
        emergency_types = {
            "7500": "Hijack",
            "7600": "Radio Failure",
            "7700": "Emergency"
        }
        alerts.append({
            "type": "emergency",
            "rule_id": None,
            "rule_name": f"Emergency: {emergency_types[squawk]}",
            "title": f"🚨 {emergency_types[squawk]}",
            "message": f"Aircraft {callsign or icao} squawking {squawk}",
            "priority": "emergency",
            "api_url": None
        })
    
    return alerts


async def store_alert_history(
    db: AsyncSession,
    rule_id: Optional[int],
    rule_name: str,
    icao: str,
    callsign: str,
    message: str,
    priority: str,
    aircraft_data: dict
):
    """Store triggered alert in alert_history table."""
    try:
        history_entry = AlertHistory(
            rule_id=rule_id,
            rule_name=rule_name,
            icao_hex=icao,
            callsign=callsign,
            message=message,
            priority=priority,
            aircraft_data=aircraft_data
        )
        db.add(history_entry)
        await db.commit()
    except Exception as e:
        logger.warning(f"Failed to store alert history: {e}")
        await db.rollback()
