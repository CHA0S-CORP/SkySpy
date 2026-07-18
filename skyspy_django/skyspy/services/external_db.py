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

import atexit
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

import httpx
from django.conf import settings
from django.db import DatabaseError, transaction
from tenacity import RetryError, retry, stop_after_attempt, wait_exponential

from skyspy.models import AircraftInfo, AirframeSourceData
from skyspy.services import http_client

logger = logging.getLogger(__name__)

# Thread pool for background file loading
_executor = ThreadPoolExecutor(max_workers=2)
# Register shutdown handler to clean up the executor on program exit
atexit.register(_executor.shutdown, wait=False)

# Data directory for downloaded databases
DATA_DIR = Path(os.environ.get("EXTERNAL_DB_DIR", "/data/external_db"))

# In-memory databases indexed by ICAO hex
_adsbx_db: dict[str, dict] = {}
_tar1090_db: dict[str, dict] = {}
_faa_db: dict[str, dict] = {}
# FAA ACFTREF.txt reference table: MFR MDL CODE -> {manufacturer, model}. Joined
# into _faa_db during load so US regs carry manufacturer/model (MASTER.txt has
# neither — only the code that points here).
_faa_acftref: dict[str, dict] = {}
_opensky_db: dict[str, dict] = {}

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
_route_cache: dict[str, dict] = {}
_route_cache_ttl: dict[str, float] = {}
_route_lock = Lock()
MAX_ROUTE_CACHE_SIZE = 5000  # Max cached routes

# Database metadata
_db_metadata: dict[str, dict] = {
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

# FAA MASTER "TYPE REGISTRANT" code -> authoritative owner type. This is the
# registry's own entity classification and beats regex-guessing LLC/trust from
# the name. (6 is unused by the FAA.)
FAA_REGISTRANT_TYPES = {
    "1": "individual",
    "2": "partnership",
    "3": "corporation",
    "4": "co_owned",
    "5": "government",
    "7": "llc",
    "8": "non_citizen_corp",
    "9": "non_citizen_co_owned",
}

# Keyless community hex-lookup pool (readsb schema). Enrichment round-robins
# across these to spread per-IP rate limits; a source that 429s or errors is put
# on an exponential-backoff cooldown and skipped until it expires.
_HEX_SOURCE_BASES = {
    "adsb.lol": "https://api.adsb.lol/v2/hex/{hex}",
    "adsb.fi": "https://opendata.adsb.fi/api/v2/hex/{hex}",
    "airplanes.live": "https://api.airplanes.live/v2/hex/{hex}",
}
_HEX_COOLDOWN_BASE = 15.0  # seconds; doubles per consecutive failure
_HEX_COOLDOWN_MAX = 300.0
_hex_lock = Lock()
_hex_counter = 0
_hex_cooldown_until: dict[str, float] = {}
_hex_fail_streak: dict[str, int] = {}


def _enrichment_sources() -> list[tuple[str, str]]:
    """Ordered [(name, hex_url_template), ...] from AIRCRAFT_STREAM_FREE_SOURCES."""
    names = getattr(settings, "AIRCRAFT_STREAM_FREE_SOURCES", "") or ""
    ordered = [n.strip() for n in names.split(",") if n.strip() in _HEX_SOURCE_BASES]
    if not ordered:
        ordered = list(_HEX_SOURCE_BASES)
    return [(n, _HEX_SOURCE_BASES[n]) for n in ordered]


def _note_hex_success(name: str) -> None:
    with _hex_lock:
        _hex_fail_streak.pop(name, None)
        _hex_cooldown_until.pop(name, None)


def _note_hex_failure(name: str) -> None:
    with _hex_lock:
        streak = _hex_fail_streak.get(name, 0) + 1
        _hex_fail_streak[name] = streak
        cooldown = min(_HEX_COOLDOWN_BASE * (2 ** (streak - 1)), _HEX_COOLDOWN_MAX)
        _hex_cooldown_until[name] = time.monotonic() + cooldown


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


# =============================================================================
# Retry Helper for External API Calls
# =============================================================================


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=30), reraise=True)
def fetch_with_retry(url: str, timeout: float = 60, stream: bool = False, **kwargs) -> httpx.Response:
    """
    Fetch a URL with retry logic for resilience.

    Args:
        url: The URL to fetch
        timeout: Request timeout in seconds (default 60)
        stream: Whether to use streaming mode for large downloads
        **kwargs: Additional arguments to pass to httpx.Client

    Returns:
        httpx.Response object

    Raises:
        httpx.HTTPStatusError: If the request fails after all retries
    """
    with httpx.Client(timeout=timeout, follow_redirects=True, **kwargs) as client:
        response = client.get(url)
        response.raise_for_status()
        return response


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=30), reraise=True)
def stream_with_retry(
    url: str, target_path: Path, timeout: float = 60, chunk_size: int = 8192 * 1024, **kwargs
) -> Path:
    """
    Stream download a URL with retry logic for large files.

    Args:
        url: The URL to fetch
        target_path: Path to save the downloaded file
        timeout: Request timeout in seconds (default 60)
        chunk_size: Size of chunks to download
        **kwargs: Additional arguments to pass to httpx.Client

    Returns:
        Path to the downloaded file

    Raises:
        httpx.HTTPStatusError: If the request fails after all retries
    """
    target_path.parent.mkdir(parents=True, exist_ok=True)
    with (
        httpx.Client(timeout=timeout, follow_redirects=True, **kwargs) as client,
        client.stream("GET", url) as response,
    ):
        response.raise_for_status()
        with open(target_path, "wb") as f:
            for chunk in response.iter_bytes(chunk_size=chunk_size):
                f.write(chunk)
    return target_path


def _trunc(value: str | None, length: int) -> str | None:
    """Truncate a string to max length."""
    if value is None:
        return None
    value = str(value).strip()
    return value[:length] if len(value) > length else value


def _safe_int(value) -> int | None:
    """Safely convert a value to int, returning None on failure."""
    if value is None:
        return None
    if isinstance(value, int):
        return value
    try:
        return int(float(value))
    except (ValueError, TypeError):
        return None


def _extract_country_from_registration(registration: str) -> str | None:
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


def _get_faa_acftref_path() -> Path:
    return DATA_DIR / "faa-acftref.csv"


def _get_opensky_path() -> Path | None:
    """Find the OpenSky database file."""
    env_path = getattr(settings, "OPENSKY_DB_PATH", None)
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


def download_adsbx_database() -> Path | None:
    """Download ADS-B Exchange database."""
    target_path = _get_adsbx_path()
    start_time = time.time()

    try:
        logger.info("Downloading ADS-B Exchange database...")

        response = fetch_with_retry(ADSBX_DB_URL, timeout=60)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_bytes(response.content)

        file_size = target_path.stat().st_size
        duration = time.time() - start_time
        logger.info(f"Downloaded ADS-B Exchange database: {file_size / 1024 / 1024:.1f}MB in {duration:.1f}s")
        return target_path

    except (httpx.HTTPError, ConnectionError, OSError, RetryError) as e:
        logger.error(f"Failed to download ADS-B Exchange database: {type(e).__name__}: {e}")
        return None


def _load_adsbx_json(path: Path) -> int:
    """Load ADSBX JSON into memory."""
    global _adsbx_db

    with _adsbx_lock:
        _adsbx_db.clear()

        with gzip.open(path, "rt", encoding="utf-8") as f:
            first_char = f.read(1)
            f.seek(0)

            if first_char == "[":
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

    except (OSError, ValueError, json.JSONDecodeError) as e:
        logger.error(f"Failed to load ADS-B Exchange database: {type(e).__name__}: {e}")
        return False


def lookup_adsbx(icao_hex: str) -> dict | None:
    """Look up aircraft in ADSBX database."""
    if not _db_metadata["adsbx"]["loaded"]:
        return None
    return _adsbx_db.get(icao_hex.upper().strip().lstrip("~"))


# =============================================================================
# tar1090-db (Mictronics) Database
# =============================================================================


def download_tar1090_database() -> Path | None:
    """Download tar1090 database."""
    target_path = _get_tar1090_path()
    start_time = time.time()

    try:
        logger.info("Downloading tar1090-db...")

        response = fetch_with_retry(TAR1090_DB_URL, timeout=60)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_bytes(response.content)

        file_size = target_path.stat().st_size
        duration = time.time() - start_time
        logger.info(f"Downloaded tar1090-db: {file_size / 1024 / 1024:.1f}MB in {duration:.1f}s")
        return target_path

    except (httpx.HTTPError, ConnectionError, OSError, RetryError) as e:
        logger.error(f"Failed to download tar1090-db: {type(e).__name__}: {e}")
        return None


def _load_tar1090_csv(path: Path) -> int:
    """Load tar1090 CSV into memory."""
    global _tar1090_db

    with _tar1090_lock:
        _tar1090_db.clear()

        with gzip.open(path, "rt", encoding="utf-8", errors="replace") as f:
            reader = csv.reader(f, delimiter=";")
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

    except (OSError, ValueError) as e:
        logger.error(f"Failed to load tar1090-db: {type(e).__name__}: {e}")
        return False


def lookup_tar1090(icao_hex: str) -> dict | None:
    """Look up aircraft in tar1090 database."""
    if not _db_metadata["tar1090"]["loaded"]:
        return None
    return _tar1090_db.get(icao_hex.upper().strip().lstrip("~"))


# =============================================================================
# FAA Registry Database
# =============================================================================


def download_faa_database() -> Path | None:
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

        stream_with_retry(FAA_MASTER_URL, zip_path, timeout=60, headers=headers)

        with zipfile.ZipFile(zip_path, "r") as zf:
            master_file = None
            acftref_file = None
            for name in zf.namelist():
                upper = name.upper()
                if upper.endswith("MASTER.TXT"):
                    master_file = name
                elif upper.endswith("ACFTREF.TXT"):
                    acftref_file = name

            if master_file:
                with zf.open(master_file) as src:
                    target_path.write_bytes(src.read())

                duration = time.time() - start_time
                size_mb = target_path.stat().st_size / 1024 / 1024
                logger.info(f"Extracted FAA MASTER: {size_mb:.1f}MB in {duration:.1f}s")
            else:
                logger.error("MASTER.txt not found in FAA zip")
                return None

            # ACFTREF.txt supplies manufacturer/model (joined by MFR MDL CODE).
            # Non-fatal if absent — the registry still yields reg/owner/year.
            if acftref_file:
                with zf.open(acftref_file) as src:
                    _get_faa_acftref_path().write_bytes(src.read())
                logger.info("Extracted FAA ACFTREF (manufacturer/model reference)")
            else:
                logger.warning("ACFTREF.txt not found in FAA zip; manufacturer/model will be blank")

        zip_path.unlink()
        return target_path

    except (httpx.HTTPError, ConnectionError, OSError, zipfile.BadZipFile, RetryError) as e:
        logger.error(f"Failed to download FAA Registry: {type(e).__name__}: {e}")
        return None


def _load_faa_acftref(path: Path) -> int:
    """Load FAA ACFTREF.txt (aircraft reference) into ``_faa_acftref``.

    Keyed by the ``CODE`` column (the ``MFR MDL CODE`` that MASTER.txt rows point
    at) -> {manufacturer, model}. Best-effort: a missing/garbled file just leaves
    the table empty and manufacturer/model stay blank.
    """
    global _faa_acftref

    _faa_acftref.clear()
    try:
        with open(path, encoding="utf-8-sig", errors="replace") as f:
            reader = csv.DictReader(f)
            reader.fieldnames = [name.strip() for name in reader.fieldnames]

            code_col = next((c for c in reader.fieldnames if c.strip().upper() == "CODE"), None)
            if not code_col:
                logger.error("Could not find 'CODE' column in FAA ACFTREF headers")
                return 0

            for row in reader:
                code = row.get(code_col, "").strip()
                if not code:
                    continue
                manufacturer = row.get("MFR", "").strip() or None
                model = row.get("MODEL", "").strip() or None
                if manufacturer or model:
                    _faa_acftref[code] = {"manufacturer": manufacturer, "model": model}
    except (csv.Error, ValueError, OSError) as e:
        logger.error(f"Error parsing FAA ACFTREF: {type(e).__name__}: {e}")
        return 0

    return len(_faa_acftref)


def _load_faa_master(path: Path) -> int:
    """Load FAA MASTER.txt into memory."""
    global _faa_db

    with _faa_lock:
        _faa_db.clear()

        try:
            with open(path, encoding="utf-8-sig", errors="replace") as f:
                reader = csv.DictReader(f)
                reader.fieldnames = [name.strip() for name in reader.fieldnames]

                hex_col = next((c for c in reader.fieldnames if "MODE S" in c and "HEX" in c), None)

                if not hex_col:
                    logger.error("Could not find 'MODE S CODE HEX' column in FAA headers")
                    return 0

                for row in reader:
                    mode_s_hex = row.get(hex_col, "").strip().upper()

                    if not mode_s_hex or len(mode_s_hex) != 6:
                        continue

                    n_number = row.get("N-NUMBER", "").strip()

                    # Street + Street2 -> single owner address (drives the
                    # registered-agent / PO-box shell heuristics, previously blind
                    # because only city/state were captured).
                    street = row.get("STREET", "").strip()
                    street2 = row.get("STREET2", "").strip()
                    owner_address = ", ".join(p for p in (street, street2) if p) or None
                    reg_type = FAA_REGISTRANT_TYPES.get(row.get("TYPE REGISTRANT", "").strip())
                    fractional = row.get("FRACT OWNER", "").strip().upper() == "Y"
                    # FAA "TYPE AIRCRAFT": 6=Rotorcraft, 9=Gyroplane -> helicopter-ish.
                    # Lets us classify police/public-safety helos without an ICAO type.
                    faa_rotorcraft = row.get("TYPE AIRCRAFT", "").strip() in ("6", "9")

                    # Join ACFTREF by MFR MDL CODE for manufacturer/model (MASTER
                    # has neither — only this code). Empty when ACFTREF is absent.
                    ref = _faa_acftref.get(row.get("MFR MDL CODE", "").strip())

                    _faa_db[mode_s_hex] = {
                        "registration": f"N{n_number}" if n_number else None,
                        "serial_number": row.get("SERIAL NUMBER", "").strip() or None,
                        "year_built": _safe_int(row.get("YEAR MFR", "").strip()),
                        "manufacturer": ref.get("manufacturer") if ref else None,
                        "model": ref.get("model") if ref else None,
                        "owner": row.get("NAME", "").strip(),
                        "owner_address": owner_address,
                        "owner_zip": row.get("ZIP CODE", "").strip() or None,
                        "faa_registrant_type": reg_type,
                        "fractional_owner": fractional or None,
                        "faa_is_rotorcraft": faa_rotorcraft or None,
                        "city": row.get("CITY", "").strip() or None,
                        "state": row.get("STATE", "").strip() or None,
                        "country": "United States",
                        "source": "faa",
                    }

        except (csv.Error, ValueError, OSError) as e:
            logger.error(f"Error parsing FAA CSV: {type(e).__name__}: {e}")
            return 0

        return len(_faa_db)


def load_faa_database(auto_download: bool = True) -> bool:
    """Load FAA database into memory."""
    path = _get_faa_path()
    acftref_path = _get_faa_acftref_path()

    # Re-download when MASTER is missing OR when the ACFTREF reference (added
    # later) hasn't been extracted yet — otherwise installs with an old cached
    # MASTER would never gain manufacturer/model.
    if not path.exists() or not acftref_path.exists():
        if auto_download:
            path = download_faa_database()
            if not path:
                return False
        elif not path.exists():
            return False

    start_time = time.time()
    try:
        logger.info("Loading FAA Registry...")
        with _faa_lock:
            ref_count = _load_faa_acftref(acftref_path) if acftref_path.exists() else 0
        count = _load_faa_master(path)
        logger.info(f"Loaded {ref_count:,} FAA ACFTREF manufacturer/model entries")

        duration = time.time() - start_time
        _db_metadata["faa"]["loaded"] = True
        _db_metadata["faa"]["count"] = count
        _db_metadata["faa"]["updated"] = datetime.utcnow()
        _db_metadata["faa"]["path"] = str(path)

        logger.info(f"Loaded {count:,} aircraft from FAA Registry in {duration:.1f}s")
        return True

    except (OSError, ValueError) as e:
        logger.error(f"Failed to load FAA Registry: {type(e).__name__}: {e}")
        return False


def lookup_faa(icao_hex: str) -> dict | None:
    """Look up aircraft in FAA database."""
    if not _db_metadata["faa"]["loaded"]:
        return None
    return _faa_db.get(icao_hex.upper().strip().lstrip("~"))


# =============================================================================
# OpenSky Network Database
# =============================================================================


def download_opensky_database() -> Path | None:
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
        logger.info("Downloading OpenSky database (~150MB)...")

        stream_with_retry(OPENSKY_DB_URL, target_path, timeout=60, chunk_size=1024 * 1024)

        duration = time.time() - start_time
        file_size = target_path.stat().st_size
        logger.info(f"Downloaded OpenSky database: {file_size / 1024 / 1024:.1f}MB in {duration:.1f}s")
        return target_path

    except (httpx.HTTPError, ConnectionError, OSError, RetryError) as e:
        logger.error(f"Failed to download OpenSky database: {type(e).__name__}: {e}")
        if target_path.exists():
            try:
                target_path.unlink()
            except OSError as cleanup_err:
                logger.debug(
                    f"Failed to cleanup partial download {target_path}: {type(cleanup_err).__name__}: {cleanup_err}"
                )
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
        "air force",
        "airforce",
        "navy",
        "army",
        "military",
        "usaf",
        "raf",
        "luftwaffe",
        "marines",
        "coast guard",
        "national guard",
        "defense",
        "defence",
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

    if not getattr(settings, "OPENSKY_DB_ENABLED", True):
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

    except (OSError, ValueError) as e:
        logger.error(f"Failed to load OpenSky database: {type(e).__name__}: {e}")
        return False
    finally:
        _opensky_loading = False


def lookup_opensky(icao_hex: str) -> dict | None:
    """Look up aircraft by ICAO hex code in OpenSky database."""
    if not _opensky_loaded:
        return None
    return _opensky_db.get(icao_hex.upper().strip().lstrip("~"))


# =============================================================================
# Route Lookup (adsb.im API)
# =============================================================================


def _airport_brief(ap: dict) -> dict:
    """Condense an adsb.im airport entry to the fields the UI consumes."""
    return {
        "iata": ap.get("iata"),
        "icao": ap.get("icao"),
        "name": ap.get("name"),
        "city": ap.get("location"),
        "country": ap.get("countryiso2"),
        "lat": ap.get("lat"),
        "lon": ap.get("lon"),
    }


def _parse_route_response(payload, callsign: str) -> dict | None:
    """Normalize the adsb.im routeset response into an origin/destination dict.

    adsb.im returns a *list* of matches; each entry carries ``_airports``
    (origin first, destination last) plus ``airport_codes``/``airline_code``.
    We collapse it to a stable shape so callers never depend on the upstream
    payload structure.
    """
    if not isinstance(payload, list):
        return None

    # Prefer the entry whose callsign matches; fall back to the first dict.
    entry = next(
        (r for r in payload if isinstance(r, dict) and (r.get("callsign") or "").upper() == callsign),
        None,
    ) or next((r for r in payload if isinstance(r, dict)), None)
    if not entry:
        return None

    airports = [a for a in (entry.get("_airports") or []) if isinstance(a, dict)]
    if len(airports) < 2:
        return None

    return {
        "callsign": entry.get("callsign") or callsign,
        "airline_code": entry.get("airline_code"),
        "flight_number": entry.get("number"),
        "airport_codes": entry.get("airport_codes"),
        "plausible": entry.get("plausible"),
        "origin": _airport_brief(airports[0]),
        "destination": _airport_brief(airports[-1]),
    }


def fetch_route(callsign: str) -> dict | None:
    """Fetch route info from the adsb.im routeset API. Cached for 1 hour."""
    callsign = callsign.upper().strip()
    if not callsign:
        return None

    now = time.time()

    with _route_lock:
        if callsign in _route_cache and _route_cache_ttl.get(callsign, 0) > now:
            return _route_cache[callsign]

    # adsb.im expects a ``planes`` array (position is optional and only affects
    # the plausibility score) and replies with a JSON list. The shared client
    # adds retry + a circuit breaker that the old single-shot POST lacked.
    payload = http_client.post_json(
        ADSB_IM_ROUTE_API,
        {"planes": [{"callsign": callsign}]},
        source="adsb.im",
        headers={"User-Agent": "SkySpyAPI/2.6"},
        timeout=10.0,
    )
    route_data = _parse_route_response(payload, callsign) if payload is not None else None

    # Fall back to ADSBdb (free, keyless) when adsb.im has no match. Lazy import
    # keeps the dependency one-directional (adsbdb imports http_client only).
    if not route_data:
        from skyspy.services import adsbdb

        route_data = adsbdb.get_route_by_callsign(callsign)

    # Last resort: hexdb callsign-route (keyless). Returns a plain-text
    # "ICAO-ICAO[-ICAO...]" leg string — codes only, no names/coords — so it is
    # strictly a lower-fidelity fallback after the two rich sources above.
    if not route_data:
        route_data = _fetch_route_hexdb(callsign)

    if route_data:
        with _route_lock:
            # Cleanup if cache is too large
            if len(_route_cache) > MAX_ROUTE_CACHE_SIZE:
                _cleanup_route_cache(now)
            _route_cache[callsign] = route_data
            _route_cache_ttl[callsign] = now + 3600
        return route_data

    return None


def _fetch_route_hexdb(callsign: str) -> dict | None:
    """Fetch a codes-only route from hexdb's callsign-route endpoint.

    hexdb returns a bare "EGLL-KLAX" (or multi-leg "EGLL-EGCC-KLAX") text body.
    We take the first leg as origin and the last as destination and fill only
    the icao codes; names/coords are unknown from this source. Returns the
    shared route shape so it is a drop-in fallback, or None.
    """
    from urllib.parse import quote

    # get_text swallows network/circuit/rate errors and returns None itself.
    text = http_client.get_text(
        f"https://hexdb.io/callsign-route?callsign={quote(callsign)}",
        source="hexdb",
        timeout=8.0,
    )
    if not text or not isinstance(text, str):
        return None
    legs = [seg.strip().upper() for seg in text.strip().split("-") if seg.strip()]
    # Guard against error/HTML bodies: legs must look like 3-4 char ICAO idents.
    if len(legs) < 2 or not all(3 <= len(seg) <= 4 and seg.isalnum() for seg in legs):
        return None

    def _brief(icao: str) -> dict:
        return {"iata": None, "icao": icao, "name": None, "city": None, "country": None, "lat": None, "lon": None}

    return {
        "callsign": callsign,
        "airline_code": None,
        "flight_number": None,
        "airport_codes": "-".join(legs),
        "plausible": None,
        "origin": _brief(legs[0]),
        "destination": _brief(legs[-1]),
    }


def _cleanup_route_cache(now: float):
    """Remove expired route cache entries. Must be called with _route_lock held."""
    expired = [k for k, v in _route_cache_ttl.items() if v < now]
    for k in expired:
        _route_cache.pop(k, None)
        _route_cache_ttl.pop(k, None)

    # If still too large, remove oldest entries
    if len(_route_cache) > MAX_ROUTE_CACHE_SIZE:
        sorted_keys = sorted(_route_cache_ttl.items(), key=lambda x: x[1])
        to_remove = sorted_keys[: len(sorted_keys) // 4]  # Remove oldest 25%
        for k, _ in to_remove:
            _route_cache.pop(k, None)
            _route_cache_ttl.pop(k, None)


def _fetch_hex_from_source(name: str, template: str, icao_hex: str) -> tuple[dict | None, bool]:
    """Query one community source. Returns (record_or_None, ok) where ok=False means
    the source failed (429/network/parse) and should be put on cooldown."""
    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.get(template.format(hex=icao_hex), headers={"User-Agent": "SkySpyAPI/2.6"})
        if response.status_code == 429:
            logger.debug(f"{name} hex lookup rate-limited (429) for {icao_hex}, backing off")
            return None, False
        if response.status_code == 200:
            ac = response.json().get("ac")
            return (ac[0] if ac else None), True
        logger.debug(f"{name} hex lookup HTTP {response.status_code} for {icao_hex}")
        return None, False
    except (httpx.HTTPError, ConnectionError, OSError, ValueError) as e:
        logger.debug(f"{name} lookup failed for {icao_hex}: {type(e).__name__}: {e}")
        return None, False


def fetch_aircraft_from_adsb_lol(icao_hex: str) -> dict | None:
    """Fetch live aircraft data from the keyless community hex-lookup pool.

    Round-robins across adsb.lol / adsb.fi / airplanes.live to spread the per-IP
    rate limit, with per-source exponential backoff: a source that 429s or errors
    is skipped until its cooldown expires. If every source is cooled down, one
    best-effort attempt is still made so enrichment never goes fully dark.
    (Name kept for callers; no longer adsb.lol-specific.)
    """
    icao_hex = icao_hex.upper().strip()
    sources = _enrichment_sources()
    count = len(sources)

    global _hex_counter
    with _hex_lock:
        start = _hex_counter % count
        _hex_counter += 1

    now = time.monotonic()
    attempted = False
    for offset in range(count):
        name, template = sources[(start + offset) % count]
        with _hex_lock:
            if _hex_cooldown_until.get(name, 0.0) > now:
                continue  # source is backing off, skip it
        attempted = True
        record, ok = _fetch_hex_from_source(name, template, icao_hex)
        if ok:
            _note_hex_success(name)
            return record
        _note_hex_failure(name)

    # All sources cooled down: make one forced attempt on the rotation head so
    # enrichment degrades gracefully rather than returning nothing.
    if not attempted:
        name, template = sources[start]
        record, ok = _fetch_hex_from_source(name, template, icao_hex)
        if ok:
            _note_hex_success(name)
            return record
        _note_hex_failure(name)

    return None


# =============================================================================
# Aggregated Lookup
# =============================================================================

# Boolean identity flags merged with OR semantics: any source reporting True wins.
# Fill-if-empty merging would let an earlier source's explicit False (e.g. adsbx
# "mil" absent -> False) mask a later source's True (e.g. tar1090 dbFlags bit 1).
_OR_MERGED_FLAGS = frozenset({"is_military", "is_interesting", "is_pia", "is_ladd"})


def _merge_source_record(merged: dict, data: dict) -> None:
    """Merge one source's record into the aggregate (fill-if-empty; OR for boolean flags)."""
    for k, v in data.items():
        if v is None:
            continue
        if k in _OR_MERGED_FLAGS:
            merged[k] = bool(merged.get(k)) or bool(v)
        elif k not in merged or merged[k] is None:
            merged[k] = v


def lookup_all(icao_hex: str) -> dict | None:
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
    field_sources: dict[str, str] = {}

    # Meta keys that live alongside real airframe fields but aren't provenance-worthy.
    _PROVENANCE_SKIP = {"source", "sources", "field_sources"}

    def _apply(data: dict | None, source: str, first: bool = False) -> None:
        """Merge a source and attribute any newly-filled fields to it."""
        if not data:
            return
        before = {k: merged.get(k) for k in data}
        if first:
            merged.update({k: v for k, v in data.items() if v is not None})
        else:
            _merge_source_record(merged, data)
        for k in data:
            # A field's provenance is the first source that gave it a value.
            # Skip meta keys that aren't real airframe fields.
            if k in _PROVENANCE_SKIP:
                continue
            if not before.get(k) and merged.get(k) and k not in field_sources:
                field_sources[k] = source
        sources.append(source)

    # Priority order (higher first): FAA is authoritative for US registrations.
    _apply(lookup_faa(icao_hex), "faa", first=True)
    _apply(lookup_adsbx(icao_hex), "adsbx")
    _apply(lookup_tar1090(icao_hex), "tar1090")
    _apply(lookup_opensky(icao_hex), "opensky")

    if merged:
        merged["sources"] = sources
        merged["field_sources"] = field_sources
        return merged

    return None


def lookup_all_by_source(icao_hex: str) -> dict[str, dict]:
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

    logger.info(
        f"External databases initialized: "
        f"ADSBX={_db_metadata['adsbx']['count']:,}, "
        f"tar1090={_db_metadata['tar1090']['count']:,}, "
        f"FAA={_db_metadata['faa']['count']:,}, "
        f"OpenSky={_db_metadata['opensky']['count']:,}"
    )


def update_databases_if_stale():
    """Check and update databases if older than UPDATE_INTERVAL_HOURS."""
    global _opensky_loaded

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
                # load_opensky_database short-circuits when already loaded -
                # reset the flag so the freshly downloaded CSV is re-parsed
                _opensky_loaded = False
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
        all_icaos: set[str] = set()
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
                source_data_batch.append(
                    {
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
                    }
                )

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

    except (DatabaseError, ValueError, TypeError) as e:
        logger.error(f"Error syncing external databases to Postgres: {type(e).__name__}: {e}")


def _bulk_upsert_batch(batch: list[dict]):
    """Perform a bulk upsert of aircraft data using Django ORM."""
    if not batch:
        return

    # Create model instances
    instances = []
    for info in batch:
        icao_hex = info.pop("icao_hex")
        instances.append(AircraftInfo(icao_hex=icao_hex, **info))

    # Use bulk_create with update_conflicts for efficient upsert
    update_fields = [
        "registration",
        "type_code",
        "manufacturer",
        "model",
        "serial_number",
        "year_built",
        "operator",
        "operator_icao",
        "country",
        "category",
        "is_military",
        "city",
        "state",
        "is_interesting",
        "is_pia",
        "is_ladd",
        "source",
    ]

    try:
        AircraftInfo.objects.bulk_create(
            instances, update_conflicts=True, unique_fields=["icao_hex"], update_fields=update_fields
        )
    except DatabaseError as e:
        # Fallback to individual updates if bulk_create fails
        logger.warning(f"Bulk upsert failed, falling back to individual updates: {type(e).__name__}: {e}")
        with transaction.atomic():
            for instance in instances:
                AircraftInfo.objects.update_or_create(
                    icao_hex=instance.icao_hex, defaults={f: getattr(instance, f) for f in update_fields}
                )


def _bulk_upsert_source_data_batch(batch: list[dict]):
    """Bulk upsert per-source airframe data using Django ORM."""
    if not batch:
        return

    # Group by icao_hex to get aircraft_info FKs efficiently
    icao_set = {item["icao_hex"] for item in batch}
    aircraft_map = {ai.icao_hex: ai for ai in AircraftInfo.objects.filter(icao_hex__in=icao_set)}

    instances = []
    for item in batch:
        aircraft_info = aircraft_map.get(item["icao_hex"])
        if not aircraft_info:
            continue

        item.pop("icao_hex")
        source = item.pop("source")
        instances.append(AirframeSourceData(aircraft_info=aircraft_info, source=source, **item))

    if not instances:
        return

    update_fields = [
        "raw_data",
        "registration",
        "type_code",
        "type_name",
        "manufacturer",
        "model",
        "serial_number",
        "year_built",
        "operator",
        "operator_icao",
        "owner",
        "country",
        "city",
        "state",
        "category",
        "is_military",
        "is_interesting",
        "is_pia",
        "is_ladd",
    ]

    try:
        AirframeSourceData.objects.bulk_create(
            instances, update_conflicts=True, unique_fields=["aircraft_info", "source"], update_fields=update_fields
        )
    except DatabaseError as e:
        # Fallback to individual updates
        logger.warning(f"Bulk source data upsert failed, falling back to individual updates: {type(e).__name__}: {e}")
        with transaction.atomic():
            for instance in instances:
                AirframeSourceData.objects.update_or_create(
                    aircraft_info=instance.aircraft_info,
                    source=instance.source,
                    defaults={f: getattr(instance, f) for f in update_fields},
                )
