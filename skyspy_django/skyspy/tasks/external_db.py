"""
External database synchronization tasks.

Provides Celery tasks for:
- Loading external aircraft databases (ADSBX, tar1090, FAA, OpenSky)
- Syncing databases to PostgreSQL
- Periodic database updates
"""
import logging
from datetime import datetime

from celery import shared_task
from django.conf import settings
from channels.layers import get_channel_layer

from skyspy.utils import sync_group_send

logger = logging.getLogger(__name__)


def broadcast_airframe_error(icao: str, error_message: str, sources_tried: list = None):
    """Broadcast an airframe lookup error to WebSocket clients."""
    try:
        channel_layer = get_channel_layer()
        if channel_layer is None:
            return

        message = {
            'type': 'airframe_error',
            'data': {
                'icao': icao,
                'error': error_message,
                'sources_tried': sources_tried or [],
                'timestamp': datetime.utcnow().isoformat() + 'Z'
            }
        }

        sync_group_send(channel_layer, 'aircraft_aircraft', message)
    except Exception as e:
        logger.warning(f"Failed to broadcast airframe error: {e}")


@shared_task(bind=True, max_retries=3)
def sync_external_databases(self):
    """
    Sync aircraft databases from external sources.

    Sources:
    - ADS-B Exchange database
    - tar1090 database (Mictronics)
    - FAA Registry
    - OpenSky Network database

    Runs daily at 4 AM.
    """
    logger.info("Starting external database sync")

    try:
        from skyspy.services import external_db

        # Initialize/load all databases
        external_db.init_databases(auto_download=True)

        # Sync to PostgreSQL
        external_db.sync_databases_to_postgres()

        # Get stats
        stats = external_db.get_database_stats()
        logger.info(f"External database sync complete: {stats}")

        return stats

    except Exception as e:
        logger.error(f"Failed to sync external databases: {e}")
        raise self.retry(exc=e, countdown=300)


@shared_task(bind=True, max_retries=3)
def update_stale_databases(self):
    """
    Check and update databases if older than 24 hours.

    Runs every 6 hours.
    """
    logger.info("Checking for stale databases")

    try:
        from skyspy.services import external_db

        external_db.update_databases_if_stale()

        return external_db.get_database_stats()

    except Exception as e:
        logger.error(f"Failed to update stale databases: {e}")
        raise self.retry(exc=e, countdown=300)


@shared_task
def load_opensky_database():
    """
    Load the OpenSky Network aircraft database.

    Runs on startup or when OpenSky data is needed.
    """
    if not getattr(settings, 'OPENSKY_DB_ENABLED', True):
        logger.info("OpenSky database disabled in settings")
        return False

    try:
        from skyspy.services import external_db

        result = external_db.load_opensky_database(auto_download=True)

        if result:
            stats = external_db.get_database_stats()
            logger.info(f"OpenSky database loaded: {stats['opensky']}")

        return result

    except Exception as e:
        logger.error(f"Failed to load OpenSky database: {e}")
        return False


@shared_task
def fetch_aircraft_info(icao_hex: str):
    """
    Fetch aircraft info from external databases.

    Tries multiple sources:
    1. In-memory databases (ADSBX, tar1090, FAA, OpenSky)
    2. HexDB API
    3. adsb.lol API

    Also triggers photo fetch if PHOTO_AUTO_DOWNLOAD is enabled.
    """
    icao = icao_hex.upper().strip()
    logger.debug(f"Fetching aircraft info for {icao}")

    info_found = False

    try:
        from skyspy.services import external_db
        from skyspy.models import AircraftInfo

        # Check if already cached in database
        try:
            existing = AircraftInfo.objects.get(icao_hex=icao)
            if not existing.fetch_failed:
                info_found = True
                # Still try to fetch photos if not cached
                if not existing.photo_url:
                    _trigger_photo_fetch_if_enabled(icao)
                return  # Already have valid data
        except AircraftInfo.DoesNotExist:
            pass

        # Try in-memory databases first
        data = external_db.lookup_all(icao)

        if data:
            AircraftInfo.objects.update_or_create(
                icao_hex=icao,
                defaults={
                    'registration': data.get('registration'),
                    'type_code': data.get('type_code'),
                    'manufacturer': data.get('manufacturer'),
                    'model': data.get('model'),
                    'operator': data.get('operator'),
                    'operator_icao': data.get('operator_icao'),
                    'owner': data.get('owner'),
                    'year_built': data.get('year_built'),
                    'serial_number': data.get('serial_number'),
                    'country': data.get('country'),
                    'category': data.get('category'),
                    'is_military': data.get('is_military', False),
                    'is_interesting': data.get('is_interesting', False),
                    'is_pia': data.get('is_pia', False),
                    'is_ladd': data.get('is_ladd', False),
                    'city': data.get('city'),
                    'state': data.get('state'),
                    'source': ','.join(data.get('sources', [])),
                    'fetch_failed': False,
                }
            )
            logger.debug(f"Got info for {icao} from in-memory databases: {data.get('sources', [])}")
            info_found = True
            _trigger_photo_fetch_if_enabled(icao)
            return

        # Try HexDB API
        import requests
        try:
            url = f"https://hexdb.io/api/v1/aircraft/{icao}"
            response = requests.get(url, timeout=10.0)

            if response.status_code == 200:
                hexdb_data = response.json()

                AircraftInfo.objects.update_or_create(
                    icao_hex=icao,
                    defaults={
                        'registration': hexdb_data.get('Registration'),
                        'type_code': hexdb_data.get('ICAOTypeCode'),
                        'manufacturer': hexdb_data.get('Manufacturer'),
                        'model': hexdb_data.get('Type'),
                        'operator': hexdb_data.get('RegisteredOwners'),
                        'source': 'hexdb',
                        'fetch_failed': False,
                    }
                )
                logger.debug(f"Got info for {icao} from HexDB")
                info_found = True
                _trigger_photo_fetch_if_enabled(icao)
                return

        except Exception as e:
            logger.debug(f"HexDB lookup failed for {icao}: {e}")

        # Try adsb.lol API
        try:
            lol_data = external_db.fetch_aircraft_from_adsb_lol(icao)
            if lol_data:
                AircraftInfo.objects.update_or_create(
                    icao_hex=icao,
                    defaults={
                        'registration': lol_data.get('r'),
                        'type_code': lol_data.get('t'),
                        'source': 'adsb.lol',
                        'fetch_failed': False,
                    }
                )
                logger.debug(f"Got info for {icao} from adsb.lol")
                info_found = True
                _trigger_photo_fetch_if_enabled(icao)
                return
        except Exception as e:
            logger.debug(f"adsb.lol lookup failed for {icao}: {e}")

        # Mark as failed if all sources failed
        AircraftInfo.objects.update_or_create(
            icao_hex=icao,
            defaults={
                'fetch_failed': True,
                'source': 'failed',
            }
        )

        # Broadcast the lookup failure
        broadcast_airframe_error(
            icao,
            'All aircraft info sources failed',
            sources_tried=['in-memory', 'hexdb', 'adsb.lol']
        )
        logger.debug(f"All sources failed for {icao}")

    except Exception as e:
        logger.error(f"Error fetching aircraft info for {icao}: {e}")
        broadcast_airframe_error(icao, str(e), sources_tried=['error'])


def _trigger_photo_fetch_if_enabled(icao: str):
    """Trigger photo fetch if PHOTO_AUTO_DOWNLOAD is enabled."""
    if not getattr(settings, 'PHOTO_AUTO_DOWNLOAD', False):
        return

    if not getattr(settings, 'PHOTO_CACHE_ENABLED', False):
        return

    try:
        fetch_aircraft_photos.delay(icao)
        logger.debug(f"Queued photo fetch for {icao}")
    except Exception as e:
        logger.debug(f"Failed to queue photo fetch for {icao}: {e}")


@shared_task
def fetch_route_info(callsign: str):
    """
    Fetch route information for a callsign from adsb.im.
    """
    try:
        from skyspy.services import external_db

        route = external_db.fetch_route(callsign)
        if route:
            logger.debug(f"Got route for {callsign}: {route}")
            return route
        return None

    except Exception as e:
        logger.error(f"Error fetching route for {callsign}: {e}")
        return None


@shared_task
def fetch_aircraft_photos(icao_hex: str, photo_url: str = None, thumbnail_url: str = None,
                          photo_page_link: str = None, force: bool = False):
    """
    Background task to fetch and cache aircraft photos.

    Downloads from provided URLs or fetches new URLs if needed.
    Supports Planespotters page scraping for full-size images.
    """
    icao = icao_hex.upper().strip()
    logger.debug(f"Fetching photos for {icao}")

    try:
        from skyspy.services.photo_cache import (
            download_photo, update_photo_paths, get_photo_url
        )
        from skyspy.models import AircraftInfo

        # Check if we already have photos cached
        if not force:
            existing_photo = get_photo_url(icao, is_thumbnail=False, verify_exists=True)
            if existing_photo:
                logger.debug(f"Photos already cached for {icao}")
                return

        # If no URLs provided, try to get them from database or fetch from hexdb
        if not photo_url:
            try:
                info = AircraftInfo.objects.get(icao_hex=icao)
                photo_url = info.photo_url
                thumbnail_url = info.photo_thumbnail_url or thumbnail_url
                photo_page_link = info.photo_page_link or photo_page_link
            except AircraftInfo.DoesNotExist:
                pass

        # Try planespotters first (higher quality source)
        if not photo_url:
            import httpx
            try:
                ps_url = f"https://api.planespotters.net/pub/photos/hex/{icao}"
                response = httpx.get(ps_url, timeout=10.0)
                if response.status_code == 200:
                    data = response.json()
                    if data.get("photos"):
                        photo = data["photos"][0]
                        # Priority: thumbnail_large > thumbnail for display
                        # thumbnail_large is usually 800px wide, good quality
                        large_thumb = photo.get("thumbnail_large", {})
                        small_thumb = photo.get("thumbnail", {})

                        # Use large thumbnail as main photo (best available via API)
                        photo_url = large_thumb.get("src") if isinstance(large_thumb, dict) else None
                        thumbnail_url = small_thumb.get("src") if isinstance(small_thumb, dict) else None
                        photo_page_link = photo.get("link")

                        # Update database with URLs
                        if photo_url:
                            AircraftInfo.objects.filter(icao_hex=icao).update(
                                photo_url=photo_url,
                                photo_thumbnail_url=thumbnail_url,
                                photo_page_link=photo_page_link,
                                photo_source='planespotters.net',
                                photo_photographer=photo.get("photographer")
                            )
            except Exception as e:
                logger.debug(f"Planespotters photo check failed for {icao}: {e}")

        # Fallback to hexdb.io if planespotters didn't work
        if not photo_url:
            import httpx
            try:
                hex_photo_url = f"https://hexdb.io/hex-image?hex={icao.lower()}"
                hex_thumb_url = f"https://hexdb.io/hex-image-thumb?hex={icao.lower()}"

                response = httpx.head(hex_photo_url, timeout=10.0, follow_redirects=True)
                if response.status_code == 200:
                    content_type = response.headers.get("content-type", "")
                    if content_type.startswith("image/"):
                        photo_url = hex_photo_url
                        thumbnail_url = hex_thumb_url

                        AircraftInfo.objects.filter(icao_hex=icao).update(
                            photo_url=photo_url,
                            photo_thumbnail_url=thumbnail_url,
                            photo_source='hexdb.io'
                        )
            except Exception as e:
                logger.debug(f"HexDB photo check failed for {icao}: {e}")

        # Download photos if we have URLs
        if photo_url:
            photo_path = download_photo(
                photo_url, icao, is_thumbnail=False,
                photo_page_link=photo_page_link, force=force
            )
            thumb_path = None
            if thumbnail_url:
                thumb_path = download_photo(thumbnail_url, icao, is_thumbnail=True)

            if photo_path or thumb_path:
                update_photo_paths(icao, photo_path, thumb_path)
                logger.info(f"Cached photos for {icao}")
        else:
            logger.debug(f"No photo sources found for {icao}")

    except Exception as e:
        logger.error(f"Error fetching photos for {icao}: {e}")


@shared_task
def upgrade_aircraft_photo(icao_hex: str):
    """
    Background task to upgrade a low-res photo to higher resolution.

    Fetches fresh photo URLs from hexdb.io or planespotters
    and re-caches if a better version is available.
    """
    icao = icao_hex.upper().strip()
    logger.debug(f"Attempting photo upgrade for {icao}")

    try:
        from skyspy.services.photo_cache import download_photo, update_photo_paths
        from skyspy.models import AircraftInfo
        import httpx

        # Get current photo info
        try:
            info = AircraftInfo.objects.get(icao_hex=icao)
        except AircraftInfo.DoesNotExist:
            logger.debug(f"No aircraft info for {icao}, skipping upgrade")
            return

        old_photo_url = info.photo_url
        old_thumb_url = info.photo_thumbnail_url
        photo_page_link = info.photo_page_link
        photo_source = info.photo_source

        new_photo_url = None
        new_thumb_url = None

        # Try hexdb.io first (provides full-size images)
        try:
            hex_photo_url = f"https://hexdb.io/hex-image?hex={icao.lower()}"
            hex_thumb_url = f"https://hexdb.io/hex-image-thumb?hex={icao.lower()}"

            response = httpx.head(hex_photo_url, timeout=10.0)
            if response.status_code == 200:
                content_type = response.headers.get("content-type", "")
                if content_type.startswith("image/"):
                    new_photo_url = hex_photo_url
                    new_thumb_url = hex_thumb_url
                    photo_page_link = None  # hexdb provides direct URLs
                    logger.info(f"Found hexdb.io photo for {icao}, upgrading")
        except Exception as e:
            logger.debug(f"HexDB photo check failed for {icao}: {e}")

        # If no hexdb photo and we have a planespotters URL without page link, get page link
        if not new_photo_url and not photo_page_link and old_photo_url:
            if "plnspttrs.net" in old_photo_url or photo_source == "planespotters.net":
                try:
                    ps_url = f"https://api.planespotters.net/pub/photos/hex/{icao}"
                    response = httpx.get(ps_url, timeout=10.0)
                    if response.status_code == 200:
                        data = response.json()
                        if data.get("photos"):
                            photo = data["photos"][0]
                            photo_page_link = photo.get("link")
                            if photo_page_link:
                                info.photo_page_link = photo_page_link
                                info.save(update_fields=['photo_page_link'])
                                logger.info(f"Got page link for {icao}: {photo_page_link}")
                except Exception as e:
                    logger.debug(f"Planespotters API failed for {icao}: {e}")

        # Update if we found a better URL
        if new_photo_url and new_photo_url != old_photo_url:
            # Update database
            info.photo_url = new_photo_url
            info.photo_thumbnail_url = new_thumb_url
            info.photo_local_path = None
            info.photo_thumbnail_local_path = None
            info.photo_source = 'hexdb.io'
            info.save(update_fields=[
                'photo_url', 'photo_thumbnail_url',
                'photo_local_path', 'photo_thumbnail_local_path', 'photo_source'
            ])

            # Download new photos
            photo_path = download_photo(
                new_photo_url, icao, is_thumbnail=False,
                photo_page_link=photo_page_link, force=True
            )
            thumb_path = None
            if new_thumb_url:
                thumb_path = download_photo(new_thumb_url, icao, is_thumbnail=True, force=True)

            if photo_path or thumb_path:
                update_photo_paths(icao, photo_path, thumb_path)
                logger.info(f"Upgraded and cached photo for {icao}")

        elif photo_page_link and old_photo_url:
            # Clear old cached path and re-download with scraping
            info.photo_local_path = None
            info.save(update_fields=['photo_local_path'])

            photo_path = download_photo(
                old_photo_url, icao, is_thumbnail=False,
                photo_page_link=photo_page_link, force=True
            )
            thumb_path = None
            if old_thumb_url:
                thumb_path = download_photo(old_thumb_url, icao, is_thumbnail=True)

            if photo_path or thumb_path:
                update_photo_paths(icao, photo_path, thumb_path)
                logger.info(f"Upgraded photo via scraping for {icao}")

    except Exception as e:
        logger.error(f"Error upgrading photo for {icao}: {e}")


@shared_task
def batch_fetch_aircraft_photos(icao_list: list):
    """
    Batch fetch photos for multiple aircraft.

    Queues individual fetch_aircraft_photos tasks with rate limiting.
    """
    import time

    logger.info(f"Batch fetching photos for {len(icao_list)} aircraft")

    for icao in icao_list[:50]:  # Limit batch size
        try:
            fetch_aircraft_photos.delay(icao)
            time.sleep(0.5)  # Rate limit to avoid hammering APIs
        except Exception as e:
            logger.error(f"Error queuing photo fetch for {icao}: {e}")


@shared_task
def refresh_stale_aircraft_info(max_age_days: int = 7, batch_size: int = 100):
    """
    Refresh aircraft info records that are older than max_age_days.

    Also retries records that previously failed lookup after 24 hours.
    Runs daily to keep aircraft info cache fresh.
    """
    from datetime import timedelta
    from django.utils import timezone
    from skyspy.models import AircraftInfo

    logger.info(f"Refreshing stale aircraft info (older than {max_age_days} days)")

    try:
        cutoff = timezone.now() - timedelta(days=max_age_days)
        retry_cutoff = timezone.now() - timedelta(hours=24)

        # Get stale records (successful lookups older than max_age_days)
        stale_records = AircraftInfo.objects.filter(
            updated_at__lt=cutoff,
            fetch_failed=False
        ).values_list('icao_hex', flat=True)[:batch_size]

        # Get failed records ready for retry (failed more than 24 hours ago)
        retry_records = AircraftInfo.objects.filter(
            updated_at__lt=retry_cutoff,
            fetch_failed=True
        ).values_list('icao_hex', flat=True)[:batch_size]

        refreshed = 0
        retried = 0

        # Queue refresh for stale records
        for icao in stale_records:
            try:
                fetch_aircraft_info.delay(icao)
                refreshed += 1
            except Exception as e:
                logger.warning(f"Failed to queue refresh for {icao}: {e}")

        # Queue retry for failed records
        for icao in retry_records:
            try:
                # Delete the failed record so fetch_aircraft_info will re-fetch
                AircraftInfo.objects.filter(icao_hex=icao, fetch_failed=True).delete()
                fetch_aircraft_info.delay(icao)
                retried += 1
            except Exception as e:
                logger.warning(f"Failed to queue retry for {icao}: {e}")

        logger.info(f"Queued {refreshed} stale + {retried} retry aircraft info lookups")
        return {'refreshed': refreshed, 'retried': retried}

    except Exception as e:
        logger.error(f"Error refreshing stale aircraft info: {e}")
        return {'error': str(e)}


@shared_task
def batch_upgrade_aircraft_photos(batch_size: int = 50):
    """
    Batch upgrade photos for aircraft that might have better images available.

    Targets aircraft with:
    - Photos from planespotters but possibly better ones from hexdb
    - Photos without local cache
    - Old photos that might have better versions

    Runs daily to improve photo quality over time.
    """
    import time
    from datetime import timedelta
    from django.utils import timezone
    from django.db.models import Q
    from skyspy.models import AircraftInfo

    logger.info("Starting batch photo upgrade")

    try:
        # Get aircraft with photos from planespotters that might have hexdb alternatives
        candidates = AircraftInfo.objects.filter(
            Q(photo_source='planespotters.net') |
            Q(photo_url__isnull=False, photo_local_path__isnull=True)
        ).exclude(
            photo_url__isnull=True
        ).values_list('icao_hex', flat=True)[:batch_size]

        upgraded = 0
        for icao in candidates:
            try:
                upgrade_aircraft_photo.delay(icao)
                upgraded += 1
                time.sleep(0.5)  # Rate limit
            except Exception as e:
                logger.warning(f"Failed to queue photo upgrade for {icao}: {e}")

        logger.info(f"Queued {upgraded} aircraft for photo upgrade")
        return {'queued': upgraded}

    except Exception as e:
        logger.error(f"Error in batch photo upgrade: {e}")
        return {'error': str(e)}


@shared_task
def cleanup_orphan_aircraft_info(days_without_sighting: int = 30):
    """
    Clean up AircraftInfo records for aircraft not seen in a long time.

    Removes records for aircraft that:
    - Haven't been sighted in days_without_sighting days
    - Have fetch_failed=True
    - Don't have cached photos

    This helps keep the database size manageable.
    Runs weekly.
    """
    from datetime import timedelta
    from django.utils import timezone
    from django.db.models import Q
    from skyspy.models import AircraftInfo, AircraftSighting

    logger.info(f"Cleaning up orphan aircraft info (not seen in {days_without_sighting} days)")

    try:
        cutoff = timezone.now() - timedelta(days=days_without_sighting)

        # Get ICAO codes of aircraft seen recently
        recent_icaos = set(
            AircraftSighting.objects.filter(
                timestamp__gte=cutoff
            ).values_list('icao_hex', flat=True).distinct()
        )

        # Delete failed lookups for aircraft not seen recently
        deleted_failed, _ = AircraftInfo.objects.filter(
            fetch_failed=True
        ).exclude(
            icao_hex__in=recent_icaos
        ).delete()

        # Delete old records without photos for aircraft not seen recently
        deleted_no_photo, _ = AircraftInfo.objects.filter(
            photo_url__isnull=True,
            updated_at__lt=cutoff
        ).exclude(
            icao_hex__in=recent_icaos
        ).delete()

        total_deleted = deleted_failed + deleted_no_photo
        logger.info(
            f"Cleaned up {total_deleted} orphan aircraft info records "
            f"({deleted_failed} failed, {deleted_no_photo} without photos)"
        )

        return {
            'deleted_failed': deleted_failed,
            'deleted_no_photo': deleted_no_photo,
            'total_deleted': total_deleted
        }

    except Exception as e:
        logger.error(f"Error cleaning up orphan aircraft info: {e}")
        return {'error': str(e)}


@shared_task
def get_aircraft_info_stats():
    """
    Get statistics about the aircraft info cache.

    Returns counts by source, photo status, etc.
    """
    from django.db.models import Count, Q
    from skyspy.models import AircraftInfo

    try:
        total = AircraftInfo.objects.count()
        with_photos = AircraftInfo.objects.filter(photo_url__isnull=False).exclude(photo_url='').count()
        with_local_photos = AircraftInfo.objects.filter(photo_local_path__isnull=False).count()
        failed = AircraftInfo.objects.filter(fetch_failed=True).count()
        military = AircraftInfo.objects.filter(is_military=True).count()

        # By source
        by_source = dict(
            AircraftInfo.objects.exclude(source__isnull=True).exclude(source='')
            .values('source').annotate(count=Count('id'))
            .values_list('source', 'count')
        )

        # By photo source
        by_photo_source = dict(
            AircraftInfo.objects.exclude(photo_source__isnull=True).exclude(photo_source='')
            .values('photo_source').annotate(count=Count('id'))
            .values_list('photo_source', 'count')
        )

        return {
            'total': total,
            'with_photos': with_photos,
            'with_local_photos': with_local_photos,
            'failed_lookups': failed,
            'military': military,
            'by_source': by_source,
            'by_photo_source': by_photo_source,
        }

    except Exception as e:
        logger.error(f"Error getting aircraft info stats: {e}")
        return {'error': str(e)}
