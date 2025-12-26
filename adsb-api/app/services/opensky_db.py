"""
OpenSky Network aircraft database service.

Loads and queries the OpenSky aircraft metadata CSV for fast local lookups.
Download from: https://s3.opensky-network.org/data-samples/metadata/aircraft-database-complete-2025-08.csv

CSV columns:
icao24,registration,manufacturericao,manufacturername,model,typecode,serialnumber,
linenumber,icaoaircrafttype,operator,operatorcallsign,operatoricao,operatoriata,
owner,testreg,registered,reguntil,status,built,firstflightdate,seatconfiguration,
engines,modes,adsb,acars,notes,categoryDescription
"""
import csv
import gzip
import logging
import os
from pathlib import Path
from typing import Optional, Dict
import asyncio

logger = logging.getLogger(__name__)

# In-memory database indexed by ICAO hex
_aircraft_db: Dict[str, dict] = {}
_db_loaded = False
_db_loading = False

# Default paths to check for the database
DEFAULT_DB_PATHS = [
    "/data/opensky/aircraft-database.csv",
    "/data/opensky/aircraft-database.csv.gz",
    "/data/aircraft-database.csv",
    "/data/aircraft-database.csv.gz",
    "./data/aircraft-database.csv",
    "./aircraft-database.csv",
]


def get_db_path() -> Optional[Path]:
    """Find the database file."""
    # Check environment variable first
    env_path = os.environ.get("OPENSKY_DB_PATH")
    if env_path:
        p = Path(env_path)
        if p.exists():
            return p
    
    # Check default locations
    for path_str in DEFAULT_DB_PATHS:
        p = Path(path_str)
        if p.exists():
            return p
    
    return None


def _parse_row(row: dict) -> dict:
    """Parse a CSV row into our format."""
    # Map OpenSky columns to our format
    return {
        "registration": row.get("registration") or None,
        "type_code": row.get("typecode") or None,
        "type_name": row.get("model") or None,
        "manufacturer": row.get("manufacturername") or None,
        "model": row.get("model") or None,
        "serial_number": row.get("serialnumber") or None,
        "year_built": _parse_int(row.get("built")),
        "first_flight_date": row.get("firstflightdate") or None,
        "operator": row.get("operator") or None,
        "operator_icao": row.get("operatoricao") or None,
        "operator_callsign": row.get("operatorcallsign") or None,
        "owner": row.get("owner") or None,
        "country": _extract_country(row.get("registration")),
        "category": row.get("icaoaircrafttype") or None,
        "is_military": _is_military(row),
        "engines": row.get("engines") or None,
        "notes": row.get("notes") or None,
    }


def _parse_int(value: str) -> Optional[int]:
    """Safely parse an integer."""
    if not value:
        return None
    try:
        # Handle year formats like "2007" or "2007-01-01"
        if "-" in str(value):
            value = value.split("-")[0]
        return int(value)
    except (ValueError, TypeError):
        return None


def _is_military(row: dict) -> bool:
    """Check if aircraft is military based on various fields."""
    operator = (row.get("operator") or "").lower()
    owner = (row.get("owner") or "").lower()
    notes = (row.get("notes") or "").lower()
    
    military_keywords = [
        "air force", "airforce", "navy", "army", "military",
        "usaf", "raf", "luftwaffe", "marines", "coast guard",
        "national guard", "defense", "defence"
    ]
    
    combined = f"{operator} {owner} {notes}"
    return any(kw in combined for kw in military_keywords)


def _extract_country(registration: str) -> Optional[str]:
    """Extract country from registration prefix."""
    if not registration:
        return None
    
    # Common registration prefixes
    prefixes = {
        "N": "United States",
        "C-": "Canada",
        "G-": "United Kingdom",
        "D-": "Germany",
        "F-": "France",
        "I-": "Italy",
        "EC-": "Spain",
        "JA": "Japan",
        "VH-": "Australia",
        "ZK-": "New Zealand",
        "B-": "China/Taiwan",
        "HL": "South Korea",
        "9V-": "Singapore",
        "VT-": "India",
        "A6-": "UAE",
        "A7-": "Qatar",
        "9M-": "Malaysia",
        "HS-": "Thailand",
        "PH-": "Netherlands",
        "OO-": "Belgium",
        "HB-": "Switzerland",
        "OE-": "Austria",
        "SE-": "Sweden",
        "LN-": "Norway",
        "OH-": "Finland",
        "OY-": "Denmark",
        "EI-": "Ireland",
        "CS-": "Portugal",
        "SX-": "Greece",
        "TC-": "Turkey",
        "4X-": "Israel",
        "RA-": "Russia",
        "SP-": "Poland",
        "OK-": "Czech Republic",
        "OM-": "Slovakia",
        "HA-": "Hungary",
        "YR-": "Romania",
        "LZ-": "Bulgaria",
        "UR-": "Ukraine",
        "EW-": "Belarus",
        "ES-": "Estonia",
        "YL-": "Latvia",
        "LY-": "Lithuania",
        "9H-": "Malta",
        "ZS-": "South Africa",
        "5N-": "Nigeria",
        "SU-": "Egypt",
        "CN-": "Morocco",
        "ET-": "Ethiopia",
        "5Y-": "Kenya",
        "XA-": "Mexico",
        "XB-": "Mexico",
        "XC-": "Mexico",
        "PP-": "Brazil",
        "PR-": "Brazil",
        "PT-": "Brazil",
        "LV-": "Argentina",
        "CC-": "Chile",
        "HC-": "Ecuador",
        "OB-": "Peru",
        "HK-": "Colombia",
        "YV-": "Venezuela",
        "TI-": "Costa Rica",
        "HP-": "Panama",
    }
    
    reg_upper = registration.upper()
    
    # Check longer prefixes first
    for prefix in sorted(prefixes.keys(), key=len, reverse=True):
        if reg_upper.startswith(prefix):
            return prefixes[prefix]
    
    return None


async def load_database(path: Optional[Path] = None) -> bool:
    """
    Load the OpenSky aircraft database into memory.
    
    Args:
        path: Path to CSV file (auto-detected if not provided)
    
    Returns:
        True if loaded successfully
    """
    global _aircraft_db, _db_loaded, _db_loading
    
    if _db_loaded:
        return True
    
    if _db_loading:
        # Wait for other loader to finish
        while _db_loading:
            await asyncio.sleep(0.1)
        return _db_loaded
    
    _db_loading = True
    
    try:
        if path is None:
            path = get_db_path()
        
        if path is None:
            logger.warning("OpenSky database not found. Checked: %s", DEFAULT_DB_PATHS)
            return False
        
        logger.info(f"Loading OpenSky database from {path}...")
        
        # Run in executor to avoid blocking
        loop = asyncio.get_event_loop()
        count = await loop.run_in_executor(None, _load_csv, path)
        
        _db_loaded = True
        logger.info(f"Loaded {count:,} aircraft from OpenSky database")
        return True
    
    except Exception as e:
        logger.error(f"Error loading OpenSky database: {e}")
        return False
    
    finally:
        _db_loading = False


def _load_csv(path: Path) -> int:
    """Synchronous CSV loading (runs in executor)."""
    global _aircraft_db
    
    count = 0
    
    # Handle gzipped files
    if path.suffix == ".gz":
        opener = gzip.open
        mode = "rt"
    else:
        opener = open
        mode = "r"
    
    with opener(path, mode, encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        
        for row in reader:
            icao_hex = (row.get("icao24") or "").upper().strip()
            if not icao_hex or len(icao_hex) != 6:
                continue
            
            _aircraft_db[icao_hex] = _parse_row(row)
            count += 1
            
            # Log progress every million rows
            if count % 1_000_000 == 0:
                logger.info(f"Loaded {count:,} aircraft...")
    
    return count


def lookup(icao_hex: str) -> Optional[dict]:
    """
    Look up aircraft by ICAO hex code.
    
    Args:
        icao_hex: ICAO 24-bit hex address (e.g., "A12345")
    
    Returns:
        Aircraft info dict or None if not found
    """
    if not _db_loaded:
        return None
    
    icao_hex = icao_hex.upper().strip()
    
    # Handle TIS-B prefix
    if icao_hex.startswith("~"):
        icao_hex = icao_hex[1:]
    
    return _aircraft_db.get(icao_hex)


def get_stats() -> dict:
    """Get database statistics."""
    return {
        "loaded": _db_loaded,
        "total_aircraft": len(_aircraft_db),
        "db_path": str(get_db_path()) if get_db_path() else None,
    }


def is_loaded() -> bool:
    """Check if database is loaded."""
    return _db_loaded


# Convenience function for quick checks
def has_aircraft(icao_hex: str) -> bool:
    """Check if aircraft exists in database."""
    if not _db_loaded:
        return False
    icao_hex = icao_hex.upper().strip().lstrip("~")
    return icao_hex in _aircraft_db
