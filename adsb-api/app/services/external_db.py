"""
External aircraft database aggregation service.

Downloads and maintains multiple aircraft databases for comprehensive lookups:
1. ADS-B Exchange - Daily JSON database with ~500k aircraft
2. tar1090-db (Mictronics) - CSV database with detailed aircraft data
3. FAA Registry - US aircraft registrations
4. adsb.lol API - Route lookups and live data

All databases are cached locally and refreshed periodically.
"""
import asyncio
import csv
import gzip
import json
import logging
import os
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Optional
import time

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

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
ADSBX_DB_URL = "https://downloads.adsbexchange.com/downloads/basic-ac-db.json.gz"
TAR1090_DB_URL = "https://github.com/wiedehopf/tar1090-db/raw/csv/aircraft.csv.gz"
FAA_MASTER_URL = "https://registry.faa.gov/database/ReleasableAircraft.zip"

# adsb.lol/adsb.im APIs
ADSB_LOL_API_BASE = "https://api.adsb.lol"
ADSB_IM_ROUTE_API = "https://adsb.im/api/0/routeset"

UPDATE_INTERVAL_HOURS = 24


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

    for db_name, meta in _db_metadata.items():
        if meta["updated"] is None:
            continue

        age = now - meta["updated"]
        if age > timedelta(hours=UPDATE_INTERVAL_HOURS):
            logger.info(f"{db_name} database is {age.total_seconds() / 3600:.1f}h old, updating...")
            if db_name == "adsbx":
                await download_adsbx_database()
                await load_adsbx_database(auto_download=False)
            elif db_name == "tar1090":
                await download_tar1090_database()
                await load_tar1090_database(auto_download=False)
            elif db_name == "faa":
                await download_faa_database()
                await load_faa_database(auto_download=False)


# =============================================================================
# ADS-B Exchange Database
# =============================================================================

def _get_adsbx_path() -> Path:
    return DATA_DIR / "adsbx-db.json.gz"


async def download_adsbx_database() -> Optional[Path]:
    """Download ADS-B Exchange basic aircraft database."""
    target_path = _get_adsbx_path()

    try:
        logger.info(f"Downloading ADS-B Exchange database...")

        async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
            response = await client.get(ADSBX_DB_URL)
            response.raise_for_status()

            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_bytes(response.content)

        file_size = target_path.stat().st_size
        logger.info(f"Downloaded ADS-B Exchange database: {file_size / 1024 / 1024:.1f}MB")
        return target_path

    except Exception as e:
        logger.error(f"Failed to download ADS-B Exchange database: {e}")
        return None


async def load_adsbx_database(auto_download: bool = True) -> bool:
    """Load ADS-B Exchange database into memory."""
    global _adsbx_db

    path = _get_adsbx_path()

    if not path.exists():
        if auto_download:
            path = await download_adsbx_database()
            if not path:
                return False
        else:
            return False

    try:
        logger.info(f"Loading ADS-B Exchange database...")

        loop = asyncio.get_event_loop()
        count = await loop.run_in_executor(None, _load_adsbx_json, path)

        _db_metadata["adsbx"]["loaded"] = True
        _db_metadata["adsbx"]["count"] = count
        _db_metadata["adsbx"]["updated"] = datetime.utcnow()
        _db_metadata["adsbx"]["path"] = str(path)

        logger.info(f"Loaded {count:,} aircraft from ADS-B Exchange")
        return True

    except Exception as e:
        logger.error(f"Failed to load ADS-B Exchange database: {e}")
        return False


def _load_adsbx_json(path: Path) -> int:
    global _adsbx_db
    _adsbx_db.clear()

    with gzip.open(path, "rt", encoding="utf-8") as f:
        data = json.load(f)

    for entry in data:
        icao = (entry.get("icao") or "").upper()
        if not icao or len(icao) != 6:
            continue

        _adsbx_db[icao] = {
            "registration": entry.get("r"),
            "type_code": entry.get("t"),
            "operator_icao": entry.get("ownOp"),
            "year_built": entry.get("year"),
            "manufacturer": entry.get("manufacturer"),
            "model": entry.get("model"),
            "is_military": entry.get("mil", False),
            "category": entry.get("category"),
            "source": "adsbx",
        }

    return len(_adsbx_db)


def lookup_adsbx(icao_hex: str) -> Optional[dict]:
    """Look up aircraft in ADS-B Exchange database."""
    if not _db_metadata["adsbx"]["loaded"]:
        return None
    return _adsbx_db.get(icao_hex.upper().strip().lstrip("~"))


# =============================================================================
# tar1090-db (Mictronics) Database
# =============================================================================

def _get_tar1090_path() -> Path:
    return DATA_DIR / "tar1090-aircraft.csv.gz"


async def download_tar1090_database() -> Optional[Path]:
    """Download tar1090/Mictronics aircraft database."""
    target_path = _get_tar1090_path()

    try:
        logger.info(f"Downloading tar1090-db...")

        async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
            response = await client.get(TAR1090_DB_URL)
            response.raise_for_status()

            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_bytes(response.content)

        file_size = target_path.stat().st_size
        logger.info(f"Downloaded tar1090-db: {file_size / 1024 / 1024:.1f}MB")
        return target_path

    except Exception as e:
        logger.error(f"Failed to download tar1090-db: {e}")
        return None


async def load_tar1090_database(auto_download: bool = True) -> bool:
    """Load tar1090-db into memory."""
    global _tar1090_db

    path = _get_tar1090_path()

    if not path.exists():
        if auto_download:
            path = await download_tar1090_database()
            if not path:
                return False
        else:
            return False

    try:
        logger.info(f"Loading tar1090-db...")

        loop = asyncio.get_event_loop()
        count = await loop.run_in_executor(None, _load_tar1090_csv, path)

        _db_metadata["tar1090"]["loaded"] = True
        _db_metadata["tar1090"]["count"] = count
        _db_metadata["tar1090"]["updated"] = datetime.utcnow()
        _db_metadata["tar1090"]["path"] = str(path)

        logger.info(f"Loaded {count:,} aircraft from tar1090-db")
        return True

    except Exception as e:
        logger.error(f"Failed to load tar1090-db: {e}")
        return False


def _load_tar1090_csv(path: Path) -> int:
    global _tar1090_db
    _tar1090_db.clear()

    with gzip.open(path, "rt", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)

        for row in reader:
            icao = (row.get("icao24") or "").upper()
            if not icao or len(icao) != 6:
                continue

            _tar1090_db[icao] = {
                "registration": row.get("reg") or None,
                "model": row.get("mdl") or None,
                "type_code": row.get("type") or None,
                "operator": row.get("operator") or None,
                "description": row.get("desc") or None,
                "is_interesting": row.get("interested") == "1",
                "source": "tar1090",
            }

    return len(_tar1090_db)


def lookup_tar1090(icao_hex: str) -> Optional[dict]:
    """Look up aircraft in tar1090-db."""
    if not _db_metadata["tar1090"]["loaded"]:
        return None
    return _tar1090_db.get(icao_hex.upper().strip().lstrip("~"))


# =============================================================================
# FAA Registry Database
# =============================================================================

def _get_faa_path() -> Path:
    return DATA_DIR / "faa-master.csv"


async def download_faa_database() -> Optional[Path]:
    """Download FAA aircraft registry."""
    target_path = _get_faa_path()
    zip_path = DATA_DIR / "faa-releasable.zip"

    try:
        logger.info(f"Downloading FAA Registry...")

        async with httpx.AsyncClient(timeout=600.0, follow_redirects=True) as client:
            response = await client.get(FAA_MASTER_URL)
            response.raise_for_status()

            zip_path.parent.mkdir(parents=True, exist_ok=True)
            zip_path.write_bytes(response.content)

        with zipfile.ZipFile(zip_path, "r") as zf:
            master_file = None
            for name in zf.namelist():
                if name.upper().endswith("MASTER.TXT"):
                    master_file = name
                    break

            if master_file:
                with zf.open(master_file) as src:
                    target_path.write_bytes(src.read())
                logger.info(f"Extracted FAA MASTER: {target_path.stat().st_size / 1024 / 1024:.1f}MB")
            else:
                logger.error("MASTER.txt not found in FAA zip")
                return None

        zip_path.unlink()
        return target_path

    except Exception as e:
        logger.error(f"Failed to download FAA Registry: {e}")
        return None


async def load_faa_database(auto_download: bool = True) -> bool:
    """Load FAA registry into memory."""
    global _faa_db

    path = _get_faa_path()

    if not path.exists():
        if auto_download:
            path = await download_faa_database()
            if not path:
                return False
        else:
            return False

    try:
        logger.info(f"Loading FAA Registry...")

        loop = asyncio.get_event_loop()
        count = await loop.run_in_executor(None, _load_faa_master, path)

        _db_metadata["faa"]["loaded"] = True
        _db_metadata["faa"]["count"] = count
        _db_metadata["faa"]["updated"] = datetime.utcnow()
        _db_metadata["faa"]["path"] = str(path)

        logger.info(f"Loaded {count:,} aircraft from FAA Registry")
        return True

    except Exception as e:
        logger.error(f"Failed to load FAA Registry: {e}")
        return False


def _load_faa_master(path: Path) -> int:
    global _faa_db
    _faa_db.clear()

    with open(path, "r", encoding="latin-1", errors="replace") as f:
        f.readline()  # Skip header

        for line in f:
            parts = line.strip().split(",")
            if len(parts) < 22:
                continue

            n_number = parts[0].strip()
            mode_s_hex = parts[21].strip().upper()

            if not mode_s_hex or len(mode_s_hex) != 6:
                continue

            year_str = parts[4].strip()
            year = int(year_str) if year_str.isdigit() else None

            _faa_db[mode_s_hex] = {
                "registration": f"N{n_number}" if n_number else None,
                "serial_number": parts[1].strip() or None,
                "year_built": year,
                "owner": parts[6].strip() or None,
                "city": parts[9].strip() or None,
                "state": parts[10].strip() or None,
                "country": "United States",
                "source": "faa",
            }

    return len(_faa_db)


def lookup_faa(icao_hex: str) -> Optional[dict]:
    """Look up aircraft in FAA Registry."""
    if not _db_metadata["faa"]["loaded"]:
        return None
    return _faa_db.get(icao_hex.upper().strip().lstrip("~"))


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
            return _route_cache[callsign]

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
                    return route_data

    except Exception as e:
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
    """Look up aircraft in all databases and merge results."""
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
    """Get statistics about all external databases."""
    return {
        "adsbx": _db_metadata["adsbx"].copy(),
        "tar1090": _db_metadata["tar1090"].copy(),
        "faa": _db_metadata["faa"].copy(),
        "route_cache_size": len(_route_cache),
    }


def is_any_loaded() -> bool:
    """Check if any database is loaded."""
    return any(meta["loaded"] for meta in _db_metadata.values())


async def periodic_database_updater():
    """Background task to periodically update databases."""
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
