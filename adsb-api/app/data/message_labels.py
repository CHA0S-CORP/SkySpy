"""
ACARS message label definitions.
Based on ARINC 618 and common airline usage patterns.
"""

# ACARS message labels - label code -> description
MESSAGE_LABELS = {
    # Standard ACARS labels (ARINC 618)
    "H1": {
        "name": "Flight Plan / Departure Clearance",
        "description": "HF data link message containing flight plan or departure clearance"
    },
    "H2": {
        "name": "Flight Plan Update",
        "description": "Update to existing flight plan"
    },
    "5Z": {
        "name": "Squawk Code Assignment",
        "description": "Transponder squawk code assignment from ATC"
    },
    "SA": {
        "name": "Position Report",
        "description": "Automated position report from aircraft"
    },
    "SQ": {
        "name": "Position Request",
        "description": "Request for position information"
    },
    "B6": {
        "name": "Departure Message",
        "description": "Gate departure or pushback notification"
    },
    "BA": {
        "name": "Arrival Message",
        "description": "Gate arrival notification"
    },
    "QA": {
        "name": "Weather Request",
        "description": "Request for weather information (ATIS/METAR/TAF)"
    },
    "QB": {
        "name": "Weather Response",
        "description": "Weather information response"
    },
    "Q0": {
        "name": "Airline-Specific",
        "description": "Airline-specific operations message"
    },
    "_d": {
        "name": "Data Link",
        "description": "General data link message"
    },
    "80": {
        "name": "OOOI Message",
        "description": "Out/Off/On/In times (gate departure, takeoff, landing, gate arrival)"
    },
    "44": {
        "name": "Weather Data",
        "description": "Weather observation data"
    },
    "10": {
        "name": "Crew Terminal Message",
        "description": "Message between crew and airline operations"
    },
    "15": {
        "name": "TWIP",
        "description": "Terminal Weather Information for Pilots"
    },
    "20": {
        "name": "Crew Scheduling",
        "description": "Crew scheduling and assignment message"
    },
    "RA": {
        "name": "ACARS Link Test",
        "description": "ACARS system link test message"
    },

    # Additional common labels
    "_5": {
        "name": "Media Advisory",
        "description": "Media or information advisory"
    },
    "_7": {
        "name": "Event Advisory",
        "description": "Event notification"
    },
    "__": {
        "name": "General Message",
        "description": "General purpose message"
    },
    "AQ": {
        "name": "Airline Query",
        "description": "Query to airline operations"
    },
    "C1": {
        "name": "CPDLC Message",
        "description": "Controller-Pilot Data Link Communications"
    },
    "CA": {
        "name": "Cabin Message",
        "description": "Cabin crew communication"
    },
    "CB": {
        "name": "Cabin Response",
        "description": "Cabin crew response message"
    },
    "CC": {
        "name": "Cabin Request",
        "description": "Cabin crew request"
    },
    "CF": {
        "name": "Flight Report",
        "description": "Comprehensive flight report"
    },
    "CR": {
        "name": "Cargo Report",
        "description": "Cargo load report"
    },
    "D1": {
        "name": "ATIS Request",
        "description": "Automatic Terminal Information Service request"
    },
    "DA": {
        "name": "ATIS Response",
        "description": "ATIS information"
    },
    "F1": {
        "name": "Fuel Request",
        "description": "Fuel quantity or request message"
    },
    "F3": {
        "name": "Fuel Report",
        "description": "Fuel consumption report"
    },
    "FA": {
        "name": "Flight Authorization",
        "description": "Flight authorization message"
    },
    "FB": {
        "name": "Flight Brief",
        "description": "Pre-flight briefing data"
    },
    "FC": {
        "name": "Flight Close",
        "description": "Flight closing message"
    },
    "H1": {
        "name": "Pre-Departure Clearance",
        "description": "DCL - Departure Clearance"
    },
    "HX": {
        "name": "Holding Pattern",
        "description": "Holding pattern information"
    },
    "LA": {
        "name": "Load Acceptance",
        "description": "Load sheet acceptance"
    },
    "LB": {
        "name": "Load Build",
        "description": "Load planning message"
    },
    "LC": {
        "name": "Load Change",
        "description": "Load change notification"
    },
    "LD": {
        "name": "Load Data",
        "description": "Loading data"
    },
    "LR": {
        "name": "Load Report",
        "description": "Final load report"
    },
    "MA": {
        "name": "Maintenance Alert",
        "description": "Aircraft maintenance alert"
    },
    "MB": {
        "name": "Maintenance Bite",
        "description": "Built-in Test Equipment report"
    },
    "MC": {
        "name": "Maintenance Crew",
        "description": "Maintenance crew message"
    },
    "MD": {
        "name": "Maintenance Data",
        "description": "Aircraft maintenance data"
    },
    "MF": {
        "name": "Maintenance Fault",
        "description": "Fault report from aircraft systems"
    },
    "MR": {
        "name": "Maintenance Request",
        "description": "Maintenance action request"
    },
    "MS": {
        "name": "Maintenance Status",
        "description": "Aircraft maintenance status"
    },
    "OA": {
        "name": "Oceanic Clearance",
        "description": "Oceanic route clearance"
    },
    "OC": {
        "name": "Oceanic Check",
        "description": "Oceanic position check"
    },
    "PA": {
        "name": "Passenger Message",
        "description": "Passenger-related information"
    },
    "PB": {
        "name": "Passenger Briefing",
        "description": "Passenger briefing data"
    },
    "PR": {
        "name": "Progress Report",
        "description": "Flight progress report"
    },
    "PS": {
        "name": "Passenger Count",
        "description": "Passenger count message"
    },
    "Q1": {
        "name": "Weather Update",
        "description": "Weather update request/response"
    },
    "Q2": {
        "name": "NOTAM",
        "description": "Notice to Airmen"
    },
    "QC": {
        "name": "Weather Chart",
        "description": "Weather chart data"
    },
    "QD": {
        "name": "Weather Deviation",
        "description": "Weather deviation report"
    },
    "QE": {
        "name": "QNH Report",
        "description": "Altimeter setting"
    },
    "QF": {
        "name": "Weather Forecast",
        "description": "Weather forecast data"
    },
    "QH": {
        "name": "SIGMET/AIRMET",
        "description": "Significant meteorological information"
    },
    "QK": {
        "name": "Winds Aloft",
        "description": "Upper level wind data"
    },
    "QL": {
        "name": "Lightning Report",
        "description": "Lightning strike data"
    },
    "QM": {
        "name": "METAR",
        "description": "Aviation routine weather report"
    },
    "QN": {
        "name": "TAF",
        "description": "Terminal aerodrome forecast"
    },
    "QP": {
        "name": "PIREP",
        "description": "Pilot weather report"
    },
    "QR": {
        "name": "Radar Weather",
        "description": "Radar weather data"
    },
    "QT": {
        "name": "Turbulence",
        "description": "Turbulence report"
    },
    "QU": {
        "name": "Icing",
        "description": "Icing conditions report"
    },
    "S1": {
        "name": "ETA Update",
        "description": "Estimated time of arrival update"
    },
    "S2": {
        "name": "ETD Update",
        "description": "Estimated time of departure update"
    },
    "SB": {
        "name": "Slot Time",
        "description": "Calculated takeoff time / slot assignment"
    },
    "SC": {
        "name": "Schedule Change",
        "description": "Flight schedule change"
    },
    "SD": {
        "name": "Delay Message",
        "description": "Flight delay notification"
    },
    "SR": {
        "name": "Status Report",
        "description": "Aircraft/flight status report"
    },
    "TA": {
        "name": "TCAS Advisory",
        "description": "Traffic Collision Avoidance System advisory"
    },
    "WR": {
        "name": "Weight Report",
        "description": "Aircraft weight information"
    },
    "WS": {
        "name": "Windshear",
        "description": "Windshear report"
    },
    "XS": {
        "name": "Special",
        "description": "Special message"
    },
    "2Z": {
        "name": "Free Text Down",
        "description": "Free text downlink from aircraft"
    },
    "3N": {
        "name": "Free Text Up",
        "description": "Free text uplink to aircraft"
    },
}


def lookup_label(label: str) -> dict | None:
    """
    Look up the description for an ACARS message label.
    Returns dict with name and description, or None if not found.
    """
    if label in MESSAGE_LABELS:
        return MESSAGE_LABELS[label]
    return None


def get_label_name(label: str) -> str | None:
    """
    Get just the name/title for a message label.
    Returns None if label is not found.
    """
    info = lookup_label(label)
    if info:
        return info.get("name")
    return None
