import asyncio
import csv
import gzip
import json
import logging
import os
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Optional, List, Set
import time

import httpx
import sentry_sdk
from prometheus_client import Counter, Gauge, Histogram
from sqlalchemy.dialects.postgresql import insert

from app.core.config import get_settings
from app.core.database import AsyncSessionLocal
from app.models import AircraftInfo

logger = logging.getLogger(__name__)
settings = get_settings()

def _trunc(value: Optional[str], length: int) -> Optional[str]:
    if value is None:
        return None
    value = str(value).strip()
    return value[:length] if len(value) > length else value

# ... (Previous Metrics Definitions Remain Unchanged) ...
# Copy all EXTERNAL_DB_* and ROUTE_* metrics here
EXTERNAL_DB_AIRCRAFT_COUNT = Gauge(
    "skyspy_external_db_aircraft_count",
    "Number of aircraft loaded in external database",
    ["source"]
)

EXTERNAL_DB_LOOKUP_TOTAL = Counter(
    "skyspy_external_db_lookup_total",
    "Total lookups against external databases",
    ["source", "hit"]
)

EXTERNAL_DB_DOWNLOAD_TOTAL = Counter(
    "skyspy_external_db_download_total",
    "Total database downloads",
    ["source", "status"]
)

EXTERNAL_DB_DOWNLOAD_DURATION = Histogram(
    "skyspy_external_db_download_duration_seconds",
    "Database download duration in seconds",
    ["source"],
    buckets=[1.0, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0, 600.0]
)

EXTERNAL_DB_LOAD_DURATION = Histogram(
    "skyspy_external_db_load_duration_seconds",
    "Database load duration in seconds",
    ["source"],
    buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0]
)

EXTERNAL_DB_SYNC_DURATION = Histogram(
    "skyspy_external_db_sync_duration_seconds",
    "Duration of syncing external DBs to Postgres",
    buckets=[10.0, 30.0, 60.0, 120.0, 300.0, 600.0]
)

ROUTE_CACHE_SIZE = Gauge(
    "skyspy_route_cache_size",
    "Number of routes in cache"
)

ROUTE_LOOKUP_TOTAL = Counter(
    "skyspy_route_lookup_total",
    "Total route lookups",
    ["status"]
)

# Database storage paths
DATA_DIR = Path(os.environ.get("EXTERNAL_DB_DIR", "/data/external_db"))

# In-memory databases indexed by ICAO hex
_adsbx_db: Dict[str, dict] = {}
_tar1090_db: Dict[str, dict] = {}
_faa_db: Dict[str, dict] = {}

# Route cache (callsign -> route info)
_route_cache: Dict[str, dict] = {}
_route_cache_ttl: Dict[str, float] = {}

# Database metadata
_db_metadata: Dict[str, dict] = {
    "adsbx": {"loaded": False, "count": 0, "updated": None, "path": None},
    "tar1090": {"loaded": False, "count": 0, "updated": None, "path": None},
    "faa": {"loaded": False, "count": 0, "updated": None, "path": None},
}

# Download URLs
# NOTE: Using raw.githubusercontent for reliable direct download
ADSBX_DB_URL = "https://downloads.adsbexchange.com/downloads/basic-ac-db.json.gz"
TAR1090_DB_URL = "https://raw.githubusercontent.com/wiedehopf/tar1090-db/csv/aircraft.csv.gz"
FAA_MASTER_URL = "https://registry.faa.gov/database/ReleasableAircraft.zip"

# adsb.lol/adsb.im APIs
ADSB_LOL_API_BASE = "https://api.adsb.lol"
ADSB_IM_ROUTE_API = "https://adsb.im/api/0/routeset"

UPDATE_INTERVAL_HOURS = 24


def _safe_int(value) -> Optional[int]:
    """Safely convert a value to int, returning None on failure."""
    if value is None:
        return None
    if isinstance(value, int):
        return value
    try:
        # Handle strings like "2024" or floats
        return int(float(value))
    except (ValueError, TypeError):
        return None


async def init_databases(auto_download: bool = True):
    """Initialize all external databases."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    await asyncio.gather(
        load_adsbx_database(auto_download=auto_download),
        load_tar1090_database(auto_download=auto_download),
        load_faa_database(auto_download=auto_download),
        return_exceptions=True
    )

    logger.info(f"External databases initialized: "
                f"ADSBX={_db_metadata['adsbx']['count']}, "
                f"tar1090={_db_metadata['tar1090']['count']}, "
                f"FAA={_db_metadata['faa']['count']}")


async def update_databases_if_stale():
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
                await download_adsbx_database()
                await load_adsbx_database(auto_download=False)
                updated_any = True
            elif db_name == "tar1090":
                await download_tar1090_database()
                await load_tar1090_database(auto_download=False)
                updated_any = True
            elif db_name == "faa":
                await download_faa_database()
                await load_faa_database(auto_download=False)
                updated_any = True
    
    if updated_any:
        await sync_databases_to_postgres()


# =============================================================================
# ADS-B Exchange Database
# =============================================================================
# ... (Same as original code) ...
def _get_adsbx_path() -> Path:
    return DATA_DIR / "adsbx-db.json.gz"


async def download_adsbx_database() -> Optional[Path]:
    target_path = _get_adsbx_path()
    start_time = time.time()

    with sentry_sdk.start_span(op="db.download", description="Download ADSBX database"):
        try:
            logger.info("Downloading ADS-B Exchange database...")

            async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
                response = await client.get(ADSBX_DB_URL)
                response.raise_for_status()

                target_path.parent.mkdir(parents=True, exist_ok=True)
                target_path.write_bytes(response.content)

            file_size = target_path.stat().st_size
            duration = time.time() - start_time
            EXTERNAL_DB_DOWNLOAD_DURATION.labels(source="adsbx").observe(duration)
            EXTERNAL_DB_DOWNLOAD_TOTAL.labels(source="adsbx", status="success").inc()
            logger.info(f"Downloaded ADS-B Exchange database: {file_size / 1024 / 1024:.1f}MB in {duration:.1f}s")
            return target_path

        except Exception as e:
            EXTERNAL_DB_DOWNLOAD_TOTAL.labels(source="adsbx", status="error").inc()
            sentry_sdk.capture_exception(e)
            logger.error(f"Failed to download ADS-B Exchange database: {e}")
            return None


async def load_adsbx_database(auto_download: bool = True) -> bool:
    global _adsbx_db

    path = _get_adsbx_path()

    if not path.exists():
        if auto_download:
            path = await download_adsbx_database()
            if not path:
                return False
        else:
            return False

    start_time = time.time()
    with sentry_sdk.start_span(op="db.load", description="Load ADSBX database"):
        try:
            logger.info("Loading ADS-B Exchange database...")

            loop = asyncio.get_event_loop()
            count = await loop.run_in_executor(None, _load_adsbx_json, path)

            duration = time.time() - start_time
            EXTERNAL_DB_LOAD_DURATION.labels(source="adsbx").observe(duration)
            EXTERNAL_DB_AIRCRAFT_COUNT.labels(source="adsbx").set(count)

            _db_metadata["adsbx"]["loaded"] = True
            _db_metadata["adsbx"]["count"] = count
            _db_metadata["adsbx"]["updated"] = datetime.utcnow()
            _db_metadata["adsbx"]["path"] = str(path)

            logger.info(f"Loaded {count:,} aircraft from ADS-B Exchange in {duration:.1f}s")
            return True

        except Exception as e:
            sentry_sdk.capture_exception(e)
            logger.error(f"Failed to load ADS-B Exchange database: {e}")
            return False


def _load_adsbx_json(path: Path) -> int:
    global _adsbx_db
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


def lookup_adsbx(icao_hex: str) -> Optional[dict]:
    if not _db_metadata["adsbx"]["loaded"]:
        EXTERNAL_DB_LOOKUP_TOTAL.labels(source="adsbx", hit="miss").inc()
        return None
    result = _adsbx_db.get(icao_hex.upper().strip().lstrip("~"))
    EXTERNAL_DB_LOOKUP_TOTAL.labels(source="adsbx", hit="hit" if result else "miss").inc()
    return result


# =============================================================================
# tar1090-db (Mictronics) Database
# =============================================================================

def _get_tar1090_path() -> Path:
    return DATA_DIR / "tar1090-aircraft.csv.gz"


async def download_tar1090_database() -> Optional[Path]:
    target_path = _get_tar1090_path()
    start_time = time.time()

    with sentry_sdk.start_span(op="db.download", description="Download tar1090 database"):
        try:
            logger.info("Downloading tar1090-db...")

            async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
                response = await client.get(TAR1090_DB_URL)
                response.raise_for_status()

                target_path.parent.mkdir(parents=True, exist_ok=True)
                target_path.write_bytes(response.content)

            file_size = target_path.stat().st_size
            duration = time.time() - start_time
            EXTERNAL_DB_DOWNLOAD_DURATION.labels(source="tar1090").observe(duration)
            EXTERNAL_DB_DOWNLOAD_TOTAL.labels(source="tar1090", status="success").inc()
            logger.info(f"Downloaded tar1090-db: {file_size / 1024 / 1024:.1f}MB in {duration:.1f}s")
            return target_path

        except Exception as e:
            EXTERNAL_DB_DOWNLOAD_TOTAL.labels(source="tar1090", status="error").inc()
            sentry_sdk.capture_exception(e)
            logger.error(f"Failed to download tar1090-db: {e}")
            return None


async def load_tar1090_database(auto_download: bool = True) -> bool:
    global _tar1090_db

    path = _get_tar1090_path()

    if not path.exists():
        if auto_download:
            path = await download_tar1090_database()
            if not path:
                return False
        else:
            return False

    start_time = time.time()
    with sentry_sdk.start_span(op="db.load", description="Load tar1090 database"):
        try:
            logger.info("Loading tar1090-db...")

            loop = asyncio.get_event_loop()
            count = await loop.run_in_executor(None, _load_tar1090_csv, path)

            duration = time.time() - start_time
            EXTERNAL_DB_LOAD_DURATION.labels(source="tar1090").observe(duration)
            EXTERNAL_DB_AIRCRAFT_COUNT.labels(source="tar1090").set(count)

            _db_metadata["tar1090"]["loaded"] = True
            _db_metadata["tar1090"]["count"] = count
            _db_metadata["tar1090"]["updated"] = datetime.utcnow()
            _db_metadata["tar1090"]["path"] = str(path)

            logger.info(f"Loaded {count:,} aircraft from tar1090-db in {duration:.1f}s")
            return True

        except Exception as e:
            sentry_sdk.capture_exception(e)
            logger.error(f"Failed to load tar1090-db: {e}")
            return False


def _load_tar1090_csv(path: Path) -> int:
    global _tar1090_db
    _tar1090_db.clear()

    with gzip.open(path, "rt", encoding="utf-8", errors="replace") as f:
        # FIX: The file is semicolon delimited, not comma!
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


def lookup_tar1090(icao_hex: str) -> Optional[dict]:
    if not _db_metadata["tar1090"]["loaded"]:
        EXTERNAL_DB_LOOKUP_TOTAL.labels(source="tar1090", hit="miss").inc()
        return None
    result = _tar1090_db.get(icao_hex.upper().strip().lstrip("~"))
    EXTERNAL_DB_LOOKUP_TOTAL.labels(source="tar1090", hit="hit" if result else "miss").inc()
    return result


# =============================================================================
# FAA Registry Database
# =============================================================================

def _get_faa_path() -> Path:
    return DATA_DIR / "faa-master.csv"


async def download_faa_database() -> Optional[Path]:
    target_path = _get_faa_path()
    zip_path = DATA_DIR / "faa-releasable.zip"
    start_time = time.time()

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Referer": "https://www.faa.gov/",
    }

    with sentry_sdk.start_span(op="db.download", description="Download FAA database"):
        try:
            logger.info("Downloading FAA Registry...")

            async with httpx.AsyncClient(timeout=600.0, follow_redirects=True, headers=headers) as client:
                async with client.stream("GET", FAA_MASTER_URL) as response:
                    response.raise_for_status()
                    
                    zip_path.parent.mkdir(parents=True, exist_ok=True)
                    
                    with open(zip_path, "wb") as f:
                        async for chunk in response.aiter_bytes(chunk_size=8192 * 1024):
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
                    EXTERNAL_DB_DOWNLOAD_DURATION.labels(source="faa").observe(duration)
                    EXTERNAL_DB_DOWNLOAD_TOTAL.labels(source="faa", status="success").inc()
                    
                    size_mb = target_path.stat().st_size / 1024 / 1024
                    logger.info(f"Extracted FAA MASTER: {size_mb:.1f}MB in {duration:.1f}s")
                else:
                    EXTERNAL_DB_DOWNLOAD_TOTAL.labels(source="faa", status="error").inc()
                    logger.error("MASTER.txt not found in FAA zip")
                    return None

            zip_path.unlink()
            return target_path

        except Exception as e:
            EXTERNAL_DB_DOWNLOAD_TOTAL.labels(source="faa", status="error").inc()
            sentry_sdk.capture_exception(e)
            logger.error(f"Failed to download FAA Registry: {e}")
            return None


async def load_faa_database(auto_download: bool = True) -> bool:
    global _faa_db

    path = _get_faa_path()

    if not path.exists():
        if auto_download:
            path = await download_faa_database()
            if not path:
                return False
        else:
            return False

    start_time = time.time()
    with sentry_sdk.start_span(op="db.load", description="Load FAA database"):
        try:
            logger.info("Loading FAA Registry...")

            loop = asyncio.get_event_loop()
            count = await loop.run_in_executor(None, _load_faa_master, path)

            duration = time.time() - start_time
            EXTERNAL_DB_LOAD_DURATION.labels(source="faa").observe(duration)
            EXTERNAL_DB_AIRCRAFT_COUNT.labels(source="faa").set(count)

            _db_metadata["faa"]["loaded"] = True
            _db_metadata["faa"]["count"] = count
            _db_metadata["faa"]["updated"] = datetime.utcnow()
            _db_metadata["faa"]["path"] = str(path)

            logger.info(f"Loaded {count:,} aircraft from FAA Registry in {duration:.1f}s")
            return True

        except Exception as e:
            sentry_sdk.capture_exception(e)
            logger.error(f"Failed to load FAA Registry: {e}")
            return False


def _load_faa_master(path: Path) -> int:
    global _faa_db
    _faa_db.clear()

    # FIX: Use csv.DictReader because index splitting is fragile.
    # The Mode S Hex is NOT in column 21 (that's status code!).
    # It is usually "MODE S CODE HEX" (column ~34).
    
    try:
        with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
            # First, peek to ensure we have headers
            reader = csv.DictReader(f)
            
            # Normalize headers (strip spaces)
            reader.fieldnames = [name.strip() for name in reader.fieldnames]
            
            # Find the Hex column (usually "MODE S CODE HEX")
            hex_col = next((c for c in reader.fieldnames if "MODE S" in c and "HEX" in c), None)
            
            if not hex_col:
                logger.error(f"Could not find 'MODE S CODE HEX' column in FAA headers: {reader.fieldnames}")
                return 0

            for row in reader:
                mode_s_hex = row.get(hex_col, "").strip().upper()

                if not mode_s_hex or len(mode_s_hex) != 6:
                    continue

                year_str = row.get("YEAR MFR", "").strip()
                year = _safe_int(year_str)
                
                n_number = row.get("N-NUMBER", "").strip()
                
                # FAA names are often comma separated "SMITH, JOHN", handled auto by DictReader
                owner_name = row.get("NAME", "").strip()
                
                _faa_db[mode_s_hex] = {
                    "registration": f"N{n_number}" if n_number else None,
                    "serial_number": row.get("SERIAL NUMBER", "").strip() or None,
                    "year_built": year,
                    "owner": owner_name,
                    "city": row.get("CITY", "").strip() or None,
                    "state": row.get("STATE", "").strip() or None,
                    "country": "United States",
                    "source": "faa",
                }
                
    except Exception as e:
        logger.error(f"Error parsing FAA CSV: {e}")
        return 0

    return len(_faa_db)


def lookup_faa(icao_hex: str) -> Optional[dict]:
    if not _db_metadata["faa"]["loaded"]:
        EXTERNAL_DB_LOOKUP_TOTAL.labels(source="faa", hit="miss").inc()
        return None
    result = _faa_db.get(icao_hex.upper().strip().lstrip("~"))
    EXTERNAL_DB_LOOKUP_TOTAL.labels(source="faa", hit="hit" if result else "miss").inc()
    return result


# =============================================================================
# adsb.lol / adsb.im API (Routes)
# =============================================================================

async def fetch_route(callsign: str) -> Optional[dict]:
    """Fetch route info from adsb.im API. Cached for 1 hour."""
    callsign = callsign.upper().strip()
    if not callsign:
        return None

    now = time.time()
    if callsign in _route_cache:
        if _route_cache_ttl.get(callsign, 0) > now:
            ROUTE_LOOKUP_TOTAL.labels(status="cache_hit").inc()
            return _route_cache[callsign]

    with sentry_sdk.start_span(op="http.client", description=f"Route lookup: {callsign}"):
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    ADSB_IM_ROUTE_API,
                    json={"callsigns": [callsign]},
                    headers={"User-Agent": "SkySpyAPI/1.0"}
                )

                if response.status_code == 200:
                    data = response.json()
                    route_data = data.get(callsign)

                    if route_data:
                        _route_cache[callsign] = route_data
                        _route_cache_ttl[callsign] = now + 3600
                        ROUTE_CACHE_SIZE.set(len(_route_cache))
                        ROUTE_LOOKUP_TOTAL.labels(status="success").inc()
                        return route_data

            ROUTE_LOOKUP_TOTAL.labels(status="not_found").inc()

        except Exception as e:
            ROUTE_LOOKUP_TOTAL.labels(status="error").inc()
            logger.debug(f"Route lookup failed for {callsign}: {e}")

    return None


async def fetch_aircraft_from_adsb_lol(icao_hex: str) -> Optional[dict]:
    """Fetch live aircraft data from adsb.lol API."""
    icao_hex = icao_hex.upper().strip()

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{ADSB_LOL_API_BASE}/v2/hex/{icao_hex}",
                headers={"User-Agent": "SkySpyAPI/1.0"}
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
    # ... (Same as original) ...
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

    if merged:
        merged["sources"] = sources
        return merged

    return None

def get_database_stats() -> dict:
    return {
        "adsbx": _db_metadata["adsbx"].copy(),
        "tar1090": _db_metadata["tar1090"].copy(),
        "faa": _db_metadata["faa"].copy(),
        "route_cache_size": len(_route_cache),
    }

def is_any_loaded() -> bool:
    return any(meta["loaded"] for meta in _db_metadata.values())

# =============================================================================
# PostgreSQL Sync Logic
# =============================================================================

async def sync_databases_to_postgres():
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
        
        logger.info(f"Found {len(all_icaos):,} unique aircraft to sync")
        
        # Reduced batch size for RPi stability
        BATCH_SIZE = 500 
        current_batch = []
        processed_count = 0
        batches_processed = 0
        
        async with AsyncSessionLocal() as db:
            for icao in all_icaos:
                data = lookup_all(icao)
                if not data:
                    continue
                
                # FIX: Truncate fields to match database VARCHAR limits
                # This prevents "value too long for type character varying(100)" errors
                model_data = {
                    "icao_hex": _trunc(icao, 10),
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
                    "updated_at": datetime.utcnow()
                }

                current_batch.append(model_data)
                
                if len(current_batch) >= BATCH_SIZE:
                    await _bulk_upsert_batch(db, current_batch)
                    processed_count += len(current_batch)
                    batches_processed += 1
                    current_batch = []
                    
                    if batches_processed % 5 == 0:
                        await db.commit()
                        await asyncio.sleep(0.01)
            
            if current_batch:
                await _bulk_upsert_batch(db, current_batch)
                processed_count += len(current_batch)
                
            await db.commit()
            
        duration = time.time() - start_time
        EXTERNAL_DB_SYNC_DURATION.observe(duration)
        logger.info(f"Synced {processed_count:,} aircraft to PostgreSQL in {duration:.1f}s")
        
    except Exception as e:
        logger.error(f"Error syncing external databases to Postgres: {e}")
        # Log the specific batch that failed helps debugging, though difficult in bulk
        sentry_sdk.capture_exception(e)

async def _bulk_upsert_batch(db, batch: List[dict]):
    """
    Perform a bulk upsert of aircraft data.
    
    Robustness Fixes:
    1. filters keys against actual AircraftInfo model columns to prevent AttributeErrors.
    2. Uses on_conflict_do_update for valid fields only.
    """
    if not batch:
        return

    # 1. Prepare the Insert statement
    stmt = insert(AircraftInfo).values(batch)
    
    # 2. Determine which keys are safe to update
    # Get all keys present in the input data
    batch_keys = set(batch[0].keys())
    
    # Get actual columns defined in the SQLAlchemy model
    # This prevents crashing if 'city' is in the dict but not yet in models.py
    model_columns = {c.name for c in AircraftInfo.__table__.columns}
    
    # Intersection: Keys that are in both the batch AND the model
    valid_keys = batch_keys.intersection(model_columns)
    
    # Remove immutable keys (PK, created_at, unique index)
    keys_to_update = {
        key for key in valid_keys 
        if key not in ["id", "created_at", "icao_hex"]
    }
    
    # 3. Build the Update dict dynamically
    # getattr(stmt.excluded, key) only works if 'key' is a valid column on the model
    update_dict = {
        key: getattr(stmt.excluded, key)
        for key in keys_to_update
    }
    
    # 4. Execute Upsert
    if update_dict:
        on_conflict_stmt = stmt.on_conflict_do_update(
            index_elements=['icao_hex'],
            set_=update_dict
        )
        await db.execute(on_conflict_stmt)
    else:
        # Fallback if no fields to update (ignore duplicates)
        on_conflict_stmt = stmt.on_conflict_do_nothing(
            index_elements=['icao_hex']
        )
        await db.execute(on_conflict_stmt)


async def periodic_database_updater():
    logger.info("Starting periodic database updater")

    while True:
        try:
            await asyncio.sleep(UPDATE_INTERVAL_HOURS * 3600)
            logger.info("Running scheduled database update...")
            await update_databases_if_stale()

        except asyncio.CancelledError:
            logger.info("Periodic database updater stopped")
            break
        except Exception as e:
            logger.error(f"Error in database updater: {e}")
            await asyncio.sleep(3600)