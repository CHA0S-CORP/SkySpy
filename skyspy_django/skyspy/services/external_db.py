"""
External aircraft database service.

Provides multi-source aircraft database lookups:
- ADS-B Exchange database
- tar1090 database (Mictronics)
- FAA Registry
- OpenSky Network database
- Route caching via adsb.im API

Data is loaded into memory for fast lookups and periodically synced to PostgreSQL.
"""
import csv
import gzip
import json
import logging
import os
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from threading import Lock
from typing import Dict, Optional, List, Set

import httpx
from django.conf import settings
from django.db import transaction
from django.core.cache import cache

from skyspy.models import AircraftInfo, AirframeSourceData

logger = logging.getLogger(__name__)

# Thread pool for background file loading
_executor = ThreadPoolExecutor(max_workers=2)

# Data directory for downloaded databases
DATA_DIR = Path(os.environ.get("EXTERNAL_DB_DIR", "/data/external_db"))

# In-memory databases indexed by ICAO hex
_adsbx_db: Dict[str, dict] = {}
_tar1090_db: Dict[str, dict] = {}
_faa_db: Dict[str, dict] = {}
_opensky_db: Dict[str, dict] = {}

# Database locks for thread safety
_adsbx_lock = Lock()
_tar1090_lock = Lock()
_faa_lock = Lock()
_opensky_lock = Lock()

# Loading state
_opensky_loaded = False
_opensky_loading = False
_opensky_downloading = False

# Route cache (callsign -> route info)
_route_cache: Dict[str, dict] = {}
_route_cache_ttl: Dict[str, float] = {}
_route_lock = Lock()
MAX_ROUTE_CACHE_SIZE = 5000  # Max cached routes

# Database metadata
_db_metadata: Dict[str, dict] = {
    "adsbx": {"loaded": False, "count": 0, "updated": None, "path": None},
    "tar1090": {"loaded": False, "count": 0, "updated": None, "path": None},
    "faa": {"loaded": False, "count": 0, "updated": None, "path": None},
    "opensky": {"loaded": False, "count": 0, "updated": None, "path": None},
}

# Download URLs
ADSBX_DB_URL = "https://downloads.adsbexchange.com/downloads/basic-ac-db.json.gz"
TAR1090_DB_URL = "https://raw.githubusercontent.com/wiedehopf/tar1090-db/csv/aircraft.csv.gz"
FAA_MASTER_URL = "https://registry.faa.gov/database/ReleasableAircraft.zip"
OPENSKY_DB_URL = "https://opensky-network.org/datasets/metadata/aircraftDatabase.csv"

# OpenSky default paths
OPENSKY_DEFAULT_PATHS = [
    "/data/opensky/aircraft-database.csv",
    "/data/opensky/aircraft-database.csv.gz",
    "/data/aircraft-database.csv",
    "/data/aircraft-database.csv.gz",
]
OPENSKY_DOWNLOAD_PATH = Path("/data/opensky/aircraft-database.csv")

# adsb.im API for routes
ADSB_IM_ROUTE_API = "https://adsb.im/api/0/routeset"
ADSB_LOL_API_BASE = "https://api.adsb.lol"

UPDATE_INTERVAL_HOURS = 24

# Registration prefix to country mapping
REGISTRATION_PREFIXES = {
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


def _trunc(value: Optional[str], length: int) -> Optional[str]:
    """Truncate a string to max length."""
    if value is None:
        return None
    value = str(value).strip()
    return value[:length] if len(value) > length else value


def _safe_int(value) -> Optional[int]:
    """Safely convert a value to int, returning None on failure."""
    if value is None:
        return None
    if isinstance(value, int):
        return value
    try:
        return int(float(value))
    except (ValueError, TypeError):
        return None


def _extract_country_from_registration(registration: str) -> Optional[str]:
    """Extract country from registration prefix."""
    if not registration:
        return None
    reg_upper = registration.upper()
    for prefix in sorted(REGISTRATION_PREFIXES.keys(), key=len, reverse=True):
        if reg_upper.startswith(prefix):
            return REGISTRATION_PREFIXES[prefix]
    return None


# =============================================================================
# Database Path Helpers
# =============================================================================

def _get_adsbx_path() -> Path:
    return DATA_DIR / "adsbx-db.json.gz"


def _get_tar1090_path() -> Path:
    return DATA_DIR / "tar1090-aircraft.csv.gz"


def _get_faa_path() -> Path:
    return DATA_DIR / "faa-master.csv"


def _get_opensky_path() -> Optional[Path]:
    """Find the OpenSky database file."""
    env_path = getattr(settings, 'OPENSKY_DB_PATH', None)
    if env_path:
        p = Path(env_path)
        if p.exists():
            return p

    for path_str in OPENSKY_DEFAULT_PATHS:
        p = Path(path_str)
        if p.exists():
            return p

    return None


# =============================================================================
# ADS-B Exchange Database
# =============================================================================

def download_adsbx_database() -> Optional[Path]:
    """Download ADS-B Exchange database."""
    target_path = _get_adsbx_path()
    start_time = time.time()

    try:
        logger.info("Downloading ADS-B Exchange database...")

        with httpx.Client(timeout=300.0, follow_redirects=True) as client:
            response = client.get(ADSBX_DB_URL)
            response.raise_for_status()

            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_bytes(response.content)

        file_size = target_path.stat().st_size
        duration = time.time() - start_time
        logger.info(f"Downloaded ADS-B Exchange database: {file_size / 1024 / 1024:.1f}MB in {duration:.1f}s")
        return target_path

    except Exception as e:
        logger.error(f"Failed to download ADS-B Exchange database: {e}")
        return None


def _load_adsbx_json(path: Path) -> int:
    """Load ADSBX JSON into memory."""
    global _adsbx_db

    with _adsbx_lock:
        _adsbx_db.clear()

        with gzip.open(path, "rt", encoding="utf-8") as f:
            first_char = f.read(1)
            f.seek(0)

            if first_char == '[':
                data = json.load(f)
            else:
                data = []
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            data.append(json.loads(line))
                        except json.JSONDecodeError:
                            continue

        for entry in data:
            icao = (entry.get("icao") or "").upper()
            if not icao or len(icao) != 6:
                continue

            _adsbx_db[icao] = {
                "registration": entry.get("r"),
                "type_code": entry.get("t"),
                "operator_icao": entry.get("ownOp"),
                "year_built": _safe_int(entry.get("year")),
                "manufacturer": entry.get("manufacturer"),
                "model": entry.get("model"),
                "is_military": entry.get("mil", False),
                "category": entry.get("category"),
                "source": "adsbx",
            }

        return len(_adsbx_db)


def load_adsbx_database(auto_download: bool = True) -> bool:
    """Load ADS-B Exchange database into memory."""
    path = _get_adsbx_path()

    if not path.exists():
        if auto_download:
            path = download_adsbx_database()
            if not path:
                return False
        else:
            return False

    start_time = time.time()
    try:
        logger.info("Loading ADS-B Exchange database...")
        count = _load_adsbx_json(path)

        duration = time.time() - start_time
        _db_metadata["adsbx"]["loaded"] = True
        _db_metadata["adsbx"]["count"] = count
        _db_metadata["adsbx"]["updated"] = datetime.utcnow()
        _db_metadata["adsbx"]["path"] = str(path)

        logger.info(f"Loaded {count:,} aircraft from ADS-B Exchange in {duration:.1f}s")
        return True

    except Exception as e:
        logger.error(f"Failed to load ADS-B Exchange database: {e}")
        return False


def lookup_adsbx(icao_hex: str) -> Optional[dict]:
    """Look up aircraft in ADSBX database."""
    if not _db_metadata["adsbx"]["loaded"]:
        return None
    return _adsbx_db.get(icao_hex.upper().strip().lstrip("~"))


# =============================================================================
# tar1090-db (Mictronics) Database
# =============================================================================

def download_tar1090_database() -> Optional[Path]:
    """Download tar1090 database."""
    target_path = _get_tar1090_path()
    start_time = time.time()

    try:
        logger.info("Downloading tar1090-db...")

        with httpx.Client(timeout=300.0, follow_redirects=True) as client:
            response = client.get(TAR1090_DB_URL)
            response.raise_for_status()

            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_bytes(response.content)

        file_size = target_path.stat().st_size
        duration = time.time() - start_time
        logger.info(f"Downloaded tar1090-db: {file_size / 1024 / 1024:.1f}MB in {duration:.1f}s")
        return target_path

    except Exception as e:
        logger.error(f"Failed to download tar1090-db: {e}")
        return None


def _load_tar1090_csv(path: Path) -> int:
    """Load tar1090 CSV into memory."""
    global _tar1090_db

    with _tar1090_lock:
        _tar1090_db.clear()

        with gzip.open(path, "rt", encoding="utf-8", errors="replace") as f:
            reader = csv.reader(f, delimiter=';')
            for row in reader:
                if len(row) < 2:
                    continue

                icao = row[0].strip().upper()
                if len(icao) != 6:
                    continue

                registration = row[1].strip() if row[1] else None
                type_code = row[2].strip() if len(row) > 2 and row[2] else None

                try:
                    db_flags = int(row[3]) if len(row) > 3 and row[3] else 0
                except ValueError:
                    db_flags = 0

                _tar1090_db[icao] = {
                    "registration": registration,
                    "type_code": type_code,
                    "is_military": bool(db_flags & 1),
                    "is_interesting": bool(db_flags & 2),
                    "is_pia": bool(db_flags & 4),
                    "is_ladd": bool(db_flags & 8),
                    "source": "tar1090",
                }

        return len(_tar1090_db)


def load_tar1090_database(auto_download: bool = True) -> bool:
    """Load tar1090 database into memory."""
    path = _get_tar1090_path()

    if not path.exists():
        if auto_download:
            path = download_tar1090_database()
            if not path:
                return False
        else:
            return False

    start_time = time.time()
    try:
        logger.info("Loading tar1090-db...")
        count = _load_tar1090_csv(path)

        duration = time.time() - start_time
        _db_metadata["tar1090"]["loaded"] = True
        _db_metadata["tar1090"]["count"] = count
        _db_metadata["tar1090"]["updated"] = datetime.utcnow()
        _db_metadata["tar1090"]["path"] = str(path)

        logger.info(f"Loaded {count:,} aircraft from tar1090-db in {duration:.1f}s")
        return True

    except Exception as e:
        logger.error(f"Failed to load tar1090-db: {e}")
        return False


def lookup_tar1090(icao_hex: str) -> Optional[dict]:
    """Look up aircraft in tar1090 database."""
    if not _db_metadata["tar1090"]["loaded"]:
        return None
    return _tar1090_db.get(icao_hex.upper().strip().lstrip("~"))


# =============================================================================
# FAA Registry Database
# =============================================================================

def download_faa_database() -> Optional[Path]:
    """Download FAA Registry database."""
    target_path = _get_faa_path()
    zip_path = DATA_DIR / "faa-releasable.zip"
    start_time = time.time()

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": "https://www.faa.gov/",
    }

    try:
        logger.info("Downloading FAA Registry...")

        with httpx.Client(timeout=600.0, follow_redirects=True, headers=headers) as client:
            with client.stream("GET", FAA_MASTER_URL) as response:
                response.raise_for_status()

                zip_path.parent.mkdir(parents=True, exist_ok=True)

                with open(zip_path, "wb") as f:
                    for chunk in response.iter_bytes(chunk_size=8192 * 1024):
                        f.write(chunk)

        with zipfile.ZipFile(zip_path, "r") as zf:
            master_file = None
            for name in zf.namelist():
                if name.upper().endswith("MASTER.TXT"):
                    master_file = name
                    break

            if master_file:
                with zf.open(master_file) as src:
                    target_path.write_bytes(src.read())

                duration = time.time() - start_time
                size_mb = target_path.stat().st_size / 1024 / 1024
                logger.info(f"Extracted FAA MASTER: {size_mb:.1f}MB in {duration:.1f}s")
            else:
                logger.error("MASTER.txt not found in FAA zip")
                return None

        zip_path.unlink()
        return target_path

    except Exception as e:
        logger.error(f"Failed to download FAA Registry: {e}")
        return None


def _load_faa_master(path: Path) -> int:
    """Load FAA MASTER.txt into memory."""
    global _faa_db

    with _faa_lock:
        _faa_db.clear()

        try:
            with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
                reader = csv.DictReader(f)
                reader.fieldnames = [name.strip() for name in reader.fieldnames]

                hex_col = next((c for c in reader.fieldnames if "MODE S" in c and "HEX" in c), None)

                if not hex_col:
                    logger.error(f"Could not find 'MODE S CODE HEX' column in FAA headers")
                    return 0

                for row in reader:
                    mode_s_hex = row.get(hex_col, "").strip().upper()

                    if not mode_s_hex or len(mode_s_hex) != 6:
                        continue

                    n_number = row.get("N-NUMBER", "").strip()

                    _faa_db[mode_s_hex] = {
                        "registration": f"N{n_number}" if n_number else None,
                        "serial_number": row.get("SERIAL NUMBER", "").strip() or None,
                        "year_built": _safe_int(row.get("YEAR MFR", "").strip()),
                        "owner": row.get("NAME", "").strip(),
                        "city": row.get("CITY", "").strip() or None,
                        "state": row.get("STATE", "").strip() or None,
                        "country": "United States",
                        "source": "faa",
                    }

        except Exception as e:
            logger.error(f"Error parsing FAA CSV: {e}")
            return 0

        return len(_faa_db)


def load_faa_database(auto_download: bool = True) -> bool:
    """Load FAA database into memory."""
    path = _get_faa_path()

    if not path.exists():
        if auto_download:
            path = download_faa_database()
            if not path:
                return False
        else:
            return False

    start_time = time.time()
    try:
        logger.info("Loading FAA Registry...")
        count = _load_faa_master(path)

        duration = time.time() - start_time
        _db_metadata["faa"]["loaded"] = True
        _db_metadata["faa"]["count"] = count
        _db_metadata["faa"]["updated"] = datetime.utcnow()
        _db_metadata["faa"]["path"] = str(path)

        logger.info(f"Loaded {count:,} aircraft from FAA Registry in {duration:.1f}s")
        return True

    except Exception as e:
        logger.error(f"Failed to load FAA Registry: {e}")
        return False


def lookup_faa(icao_hex: str) -> Optional[dict]:
    """Look up aircraft in FAA database."""
    if not _db_metadata["faa"]["loaded"]:
        return None
    return _faa_db.get(icao_hex.upper().strip().lstrip("~"))


# =============================================================================
# OpenSky Network Database
# =============================================================================

def download_opensky_database() -> Optional[Path]:
    """Download the OpenSky aircraft database."""
    global _opensky_downloading

    if _opensky_downloading:
        logger.info("OpenSky download already in progress...")
        return _get_opensky_path()

    _opensky_downloading = True
    target_path = OPENSKY_DOWNLOAD_PATH
    start_time = time.time()

    try:
        target_path.parent.mkdir(parents=True, exist_ok=True)
        logger.info(f"Downloading OpenSky database (~150MB)...")

        with httpx.Client(timeout=600.0, follow_redirects=True) as client:
            with client.stream("GET", OPENSKY_DB_URL) as response:
                response.raise_for_status()
                total_size = int(response.headers.get("content-length", 0))
                downloaded = 0
                last_log_percent = 0

                with open(target_path, "wb") as f:
                    for chunk in response.iter_bytes(chunk_size=1024 * 1024):
                        f.write(chunk)
                        downloaded += len(chunk)
                        if total_size > 0:
                            percent = int(downloaded / total_size * 100)
                            if percent >= last_log_percent + 10:
                                logger.info(f"OpenSky download: {percent}%")
                                last_log_percent = percent

        duration = time.time() - start_time
        file_size = target_path.stat().st_size
        logger.info(f"Downloaded OpenSky database: {file_size / 1024 / 1024:.1f}MB in {duration:.1f}s")
        return target_path

    except Exception as e:
        logger.error(f"Failed to download OpenSky database: {e}")
        if target_path.exists():
            try:
                target_path.unlink()
            except Exception as cleanup_err:
                logger.debug(f"Failed to cleanup partial download {target_path}: {cleanup_err}")
        return None
    finally:
        _opensky_downloading = False


def _is_opensky_military(row: dict) -> bool:
    """Check if aircraft is military based on OpenSky fields."""
    operator = (row.get("operator") or "").lower()
    owner = (row.get("owner") or "").lower()
    notes = (row.get("notes") or "").lower()
    combined = f"{operator} {owner} {notes}"

    military_keywords = [
        "air force", "airforce", "navy", "army", "military",
        "usaf", "raf", "luftwaffe", "marines", "coast guard",
        "national guard", "defense", "defence"
    ]
    return any(kw in combined for kw in military_keywords)


def _parse_opensky_row(row: dict) -> dict:
    """Parse an OpenSky CSV row into our format."""
    return {
        "registration": row.get("registration") or None,
        "type_code": row.get("typecode") or None,
        "type_name": row.get("model") or None,
        "manufacturer": row.get("manufacturername") or None,
        "model": row.get("model") or None,
        "serial_number": row.get("serialnumber") or None,
        "year_built": _safe_int(row.get("built")),
        "first_flight_date": row.get("firstflightdate") or None,
        "operator": row.get("operator") or None,
        "operator_icao": row.get("operatoricao") or None,
        "operator_callsign": row.get("operatorcallsign") or None,
        "owner": row.get("owner") or None,
        "country": _extract_country_from_registration(row.get("registration")),
        "category": row.get("icaoaircrafttype") or None,
        "is_military": _is_opensky_military(row),
        "source": "opensky",
    }


def _load_opensky_csv(path: Path) -> int:
    """Synchronous CSV loading for OpenSky."""
    global _opensky_db

    with _opensky_lock:
        _opensky_db.clear()
        count = 0

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

                _opensky_db[icao_hex] = _parse_opensky_row(row)
                count += 1

        return count


def load_opensky_database(auto_download: bool = True) -> bool:
    """Load the OpenSky aircraft database into memory."""
    global _opensky_loaded, _opensky_loading

    if _opensky_loaded:
        return True

    if _opensky_loading:
        return False

    if not getattr(settings, 'OPENSKY_DB_ENABLED', True):
        logger.info("OpenSky database disabled in settings")
        return False

    _opensky_loading = True
    start_time = time.time()

    try:
        path = _get_opensky_path()

        if path is None:
            if auto_download:
                logger.info("OpenSky database not found, downloading...")
                path = download_opensky_database()
                if path is None:
                    return False
            else:
                logger.warning("OpenSky database not found")
                return False

        logger.info(f"Loading OpenSky database from {path}...")
        count = _load_opensky_csv(path)

        duration = time.time() - start_time
        _opensky_loaded = True
        _db_metadata["opensky"]["loaded"] = True
        _db_metadata["opensky"]["count"] = count
        _db_metadata["opensky"]["updated"] = datetime.utcnow()
        _db_metadata["opensky"]["path"] = str(path)

        logger.info(f"Loaded {count:,} aircraft from OpenSky in {duration:.1f}s")
        return True

    except Exception as e:
        logger.error(f"Failed to load OpenSky database: {e}")
        return False
    finally:
        _opensky_loading = False


def lookup_opensky(icao_hex: str) -> Optional[dict]:
    """Look up aircraft by ICAO hex code in OpenSky database."""
    if not _opensky_loaded:
        return None
    return _opensky_db.get(icao_hex.upper().strip().lstrip("~"))


# =============================================================================
# Route Lookup (adsb.im API)
# =============================================================================

def fetch_route(callsign: str) -> Optional[dict]:
    """Fetch route info from adsb.im API. Cached for 1 hour."""
    callsign = callsign.upper().strip()
    if not callsign:
        return None

    now = time.time()

    with _route_lock:
        if callsign in _route_cache:
            if _route_cache_ttl.get(callsign, 0) > now:
                return _route_cache[callsign]

    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.post(
                ADSB_IM_ROUTE_API,
                json={"callsigns": [callsign]},
                headers={"User-Agent": "SkySpyAPI/2.6"}
            )

            if response.status_code == 200:
                data = response.json()
                route_data = data.get(callsign)

                if route_data:
                    with _route_lock:
                        # Cleanup if cache is too large
                        if len(_route_cache) > MAX_ROUTE_CACHE_SIZE:
                            _cleanup_route_cache(now)
                        _route_cache[callsign] = route_data
                        _route_cache_ttl[callsign] = now + 3600
                    return route_data

    except Exception as e:
        logger.debug(f"Route lookup failed for {callsign}: {e}")

    return None


def _cleanup_route_cache(now: float):
    """Remove expired route cache entries. Must be called with _route_lock held."""
    expired = [k for k, v in _route_cache_ttl.items() if v < now]
    for k in expired:
        _route_cache.pop(k, None)
        _route_cache_ttl.pop(k, None)

    # If still too large, remove oldest entries
    if len(_route_cache) > MAX_ROUTE_CACHE_SIZE:
        sorted_keys = sorted(_route_cache_ttl.items(), key=lambda x: x[1])
        to_remove = sorted_keys[:len(sorted_keys) // 4]  # Remove oldest 25%
        for k, _ in to_remove:
            _route_cache.pop(k, None)
            _route_cache_ttl.pop(k, None)


def fetch_aircraft_from_adsb_lol(icao_hex: str) -> Optional[dict]:
    """Fetch live aircraft data from adsb.lol API."""
    icao_hex = icao_hex.upper().strip()

    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.get(
                f"{ADSB_LOL_API_BASE}/v2/hex/{icao_hex}",
                headers={"User-Agent": "SkySpyAPI/2.6"}
            )

            if response.status_code == 200:
                data = response.json()
                if data.get("ac"):
                    return data["ac"][0] if data["ac"] else None

    except Exception as e:
        logger.debug(f"adsb.lol lookup failed for {icao_hex}: {e}")

    return None


# =============================================================================
# Aggregated Lookup
# =============================================================================

def lookup_all(icao_hex: str) -> Optional[dict]:
    """
    Look up aircraft in all databases and merge into a single record.

    Priority order (higher priority sources override lower for conflicts):
    1. FAA (authoritative for US registrations)
    2. ADS-B Exchange
    3. tar1090-db
    4. OpenSky Network
    """
    icao_hex = icao_hex.upper().strip().lstrip("~")

    merged = {}
    sources = []

    # FAA first (authoritative for US)
    faa_data = lookup_faa(icao_hex)
    if faa_data:
        merged.update({k: v for k, v in faa_data.items() if v is not None})
        sources.append("faa")

    # ADSBX
    adsbx_data = lookup_adsbx(icao_hex)
    if adsbx_data:
        for k, v in adsbx_data.items():
            if v is not None and (k not in merged or merged[k] is None):
                merged[k] = v
        sources.append("adsbx")

    # tar1090-db
    tar1090_data = lookup_tar1090(icao_hex)
    if tar1090_data:
        for k, v in tar1090_data.items():
            if v is not None and (k not in merged or merged[k] is None):
                merged[k] = v
        sources.append("tar1090")

    # OpenSky Network
    opensky_data = lookup_opensky(icao_hex)
    if opensky_data:
        for k, v in opensky_data.items():
            if v is not None and (k not in merged or merged[k] is None):
                merged[k] = v
        sources.append("opensky")

    if merged:
        merged["sources"] = sources
        return merged

    return None


def lookup_all_by_source(icao_hex: str) -> Dict[str, dict]:
    """
    Look up aircraft in all databases and return data from each source separately.

    Unlike lookup_all(), this does not merge the data. Each source's full
    record is preserved independently, allowing comparison across sources.

    Returns:
        Dict mapping source name to that source's data record.
        Example: {"faa": {...}, "adsbx": {...}, "tar1090": {...}, "opensky": {...}}
    """
    icao_hex = icao_hex.upper().strip().lstrip("~")
    results = {}

    faa_data = lookup_faa(icao_hex)
    if faa_data:
        results["faa"] = faa_data

    adsbx_data = lookup_adsbx(icao_hex)
    if adsbx_data:
        results["adsbx"] = adsbx_data

    tar1090_data = lookup_tar1090(icao_hex)
    if tar1090_data:
        results["tar1090"] = tar1090_data

    opensky_data = lookup_opensky(icao_hex)
    if opensky_data:
        results["opensky"] = opensky_data

    return results


def get_database_stats() -> dict:
    """Get statistics about loaded databases."""
    return {
        "adsbx": _db_metadata["adsbx"].copy(),
        "tar1090": _db_metadata["tar1090"].copy(),
        "faa": _db_metadata["faa"].copy(),
        "opensky": _db_metadata["opensky"].copy(),
        "route_cache_size": len(_route_cache),
    }


def is_any_loaded() -> bool:
    """Check if any database is loaded."""
    return any(meta["loaded"] for meta in _db_metadata.values())


# =============================================================================
# Initialization
# =============================================================================

def init_databases(auto_download: bool = True):
    """Initialize all external databases."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    # Load databases (can be parallelized via thread pool if needed)
    load_adsbx_database(auto_download=auto_download)
    load_tar1090_database(auto_download=auto_download)
    load_faa_database(auto_download=auto_download)
    load_opensky_database(auto_download=auto_download)

    logger.info(f"External databases initialized: "
                f"ADSBX={_db_metadata['adsbx']['count']:,}, "
                f"tar1090={_db_metadata['tar1090']['count']:,}, "
                f"FAA={_db_metadata['faa']['count']:,}, "
                f"OpenSky={_db_metadata['opensky']['count']:,}")


def update_databases_if_stale():
    """Check and update databases if older than UPDATE_INTERVAL_HOURS."""
    now = datetime.utcnow()
    updated_any = False

    for db_name, meta in _db_metadata.items():
        if meta["updated"] is None:
            continue

        age = now - meta["updated"]
        if age > timedelta(hours=UPDATE_INTERVAL_HOURS):
            logger.info(f"{db_name} database is {age.total_seconds() / 3600:.1f}h old, updating...")
            if db_name == "adsbx":
                download_adsbx_database()
                load_adsbx_database(auto_download=False)
                updated_any = True
            elif db_name == "tar1090":
                download_tar1090_database()
                load_tar1090_database(auto_download=False)
                updated_any = True
            elif db_name == "faa":
                download_faa_database()
                load_faa_database(auto_download=False)
                updated_any = True
            elif db_name == "opensky":
                download_opensky_database()
                load_opensky_database(auto_download=False)
                updated_any = True

    if updated_any:
        sync_databases_to_postgres()


# =============================================================================
# PostgreSQL Sync
# =============================================================================

def sync_databases_to_postgres():
    """Sync external databases to PostgreSQL AircraftInfo and AirframeSourceData tables."""
    if not is_any_loaded():
        logger.warning("Cannot sync databases to Postgres: No databases loaded")
        return

    logger.info("Starting sync of external databases to PostgreSQL...")
    start_time = time.time()

    try:
        all_icaos: Set[str] = set()
        all_icaos.update(_faa_db.keys())
        all_icaos.update(_adsbx_db.keys())
        all_icaos.update(_tar1090_db.keys())
        all_icaos.update(_opensky_db.keys())

        logger.info(f"Found {len(all_icaos):,} unique aircraft to sync")

        BATCH_SIZE = 500
        current_batch = []
        source_data_batch = []  # Per-source data batch
        processed_count = 0

        for icao in all_icaos:
            data = lookup_all(icao)
            if not data:
                continue

            icao_truncated = _trunc(icao, 10)

            model_data = {
                "icao_hex": icao_truncated,
                "registration": _trunc(data.get("registration"), 20),
                "type_code": _trunc(data.get("type_code"), 10),
                "manufacturer": _trunc(data.get("manufacturer"), 100),
                "model": _trunc(data.get("model"), 100),
                "serial_number": _trunc(data.get("serial_number"), 50),
                "year_built": _safe_int(data.get("year_built")),
                "operator": _trunc(data.get("operator") or data.get("owner"), 100),
                "operator_icao": _trunc(data.get("operator_icao"), 4),
                "country": _trunc(data.get("country"), 100),
                "category": _trunc(data.get("category"), 20),
                "is_military": data.get("is_military", False),
                "city": _trunc(data.get("city"), 100),
                "state": _trunc(data.get("state"), 10),
                "is_interesting": data.get("is_interesting", False),
                "is_pia": data.get("is_pia", False),
                "is_ladd": data.get("is_ladd", False),
                "source": ",".join(data.get("sources", [])),
            }

            current_batch.append(model_data)

            # Collect per-source data
            source_records = lookup_all_by_source(icao)
            for source_name, source_data in source_records.items():
                source_data_batch.append({
                    "icao_hex": icao_truncated,
                    "source": source_name,
                    "raw_data": source_data,
                    "registration": _trunc(source_data.get("registration"), 20),
                    "type_code": _trunc(source_data.get("type_code"), 10),
                    "type_name": _trunc(source_data.get("type_name"), 100),
                    "manufacturer": _trunc(source_data.get("manufacturer"), 100),
                    "model": _trunc(source_data.get("model"), 100),
                    "serial_number": _trunc(source_data.get("serial_number"), 50),
                    "year_built": _safe_int(source_data.get("year_built")),
                    "operator": _trunc(source_data.get("operator"), 100),
                    "operator_icao": _trunc(source_data.get("operator_icao"), 4),
                    "owner": _trunc(source_data.get("owner"), 200),
                    "country": _trunc(source_data.get("country"), 100),
                    "city": _trunc(source_data.get("city"), 100),
                    "state": _trunc(source_data.get("state"), 10),
                    "category": _trunc(source_data.get("category"), 20),
                    "is_military": source_data.get("is_military", False),
                    "is_interesting": source_data.get("is_interesting", False),
                    "is_pia": source_data.get("is_pia", False),
                    "is_ladd": source_data.get("is_ladd", False),
                })

            if len(current_batch) >= BATCH_SIZE:
                _bulk_upsert_batch(current_batch)
                _bulk_upsert_source_data_batch(source_data_batch)
                processed_count += len(current_batch)
                current_batch = []
                source_data_batch = []

                if processed_count % 50000 == 0:
                    logger.info(f"Sync progress: {processed_count:,} / {len(all_icaos):,} aircraft")

        if current_batch:
            _bulk_upsert_batch(current_batch)
            _bulk_upsert_source_data_batch(source_data_batch)
            processed_count += len(current_batch)

        duration = time.time() - start_time
        logger.info(f"Synced {processed_count:,} aircraft to PostgreSQL in {duration:.1f}s")

    except Exception as e:
        logger.error(f"Error syncing external databases to Postgres: {e}")


def _bulk_upsert_batch(batch: List[dict]):
    """Perform a bulk upsert of aircraft data using Django ORM."""
    if not batch:
        return

    # Create model instances
    instances = []
    for info in batch:
        icao_hex = info.pop('icao_hex')
        instances.append(AircraftInfo(icao_hex=icao_hex, **info))

    # Use bulk_create with update_conflicts for efficient upsert
    update_fields = [
        'registration', 'type_code', 'manufacturer', 'model', 'serial_number',
        'year_built', 'operator', 'operator_icao', 'country', 'category',
        'is_military', 'city', 'state', 'is_interesting', 'is_pia', 'is_ladd', 'source'
    ]

    try:
        AircraftInfo.objects.bulk_create(
            instances,
            update_conflicts=True,
            unique_fields=['icao_hex'],
            update_fields=update_fields
        )
    except Exception as e:
        # Fallback to individual updates if bulk_create fails
        logger.warning(f"Bulk upsert failed, falling back to individual updates: {e}")
        with transaction.atomic():
            for instance in instances:
                AircraftInfo.objects.update_or_create(
                    icao_hex=instance.icao_hex,
                    defaults={f: getattr(instance, f) for f in update_fields}
                )


def _bulk_upsert_source_data_batch(batch: List[dict]):
    """Bulk upsert per-source airframe data using Django ORM."""
    if not batch:
        return

    # Group by icao_hex to get aircraft_info FKs efficiently
    icao_set = {item['icao_hex'] for item in batch}
    aircraft_map = {
        ai.icao_hex: ai for ai in
        AircraftInfo.objects.filter(icao_hex__in=icao_set)
    }

    instances = []
    for item in batch:
        aircraft_info = aircraft_map.get(item['icao_hex'])
        if not aircraft_info:
            continue

        icao_hex = item.pop('icao_hex')
        source = item.pop('source')
        instances.append(AirframeSourceData(
            aircraft_info=aircraft_info,
            source=source,
            **item
        ))

    if not instances:
        return

    update_fields = [
        'raw_data', 'registration', 'type_code', 'type_name', 'manufacturer',
        'model', 'serial_number', 'year_built', 'operator', 'operator_icao',
        'owner', 'country', 'city', 'state', 'category', 'is_military',
        'is_interesting', 'is_pia', 'is_ladd'
    ]

    try:
        AirframeSourceData.objects.bulk_create(
            instances,
            update_conflicts=True,
            unique_fields=['aircraft_info', 'source'],
            update_fields=update_fields
        )
    except Exception as e:
        # Fallback to individual updates
        logger.warning(f"Bulk source data upsert failed, falling back to individual updates: {e}")
        with transaction.atomic():
            for instance in instances:
                AirframeSourceData.objects.update_or_create(
                    aircraft_info=instance.aircraft_info,
                    source=instance.source,
                    defaults={f: getattr(instance, f) for f in update_fields}
                )
