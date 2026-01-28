"""
Management command to populate initial aviation data.

Runs on startup to ensure all aviation data is populated:
- Airports and navaids from Aviation Weather Center
- GeoJSON overlays (ARTCC, military zones, etc.)
- PIREPs from Aviation Weather Center
- METARs and TAFs from Aviation Weather Center
- Airspace boundaries from OpenAIP (if enabled)
- Airspace advisories (G-AIRMETs, SIGMETs)

Usage:
    python manage.py populate_data
    python manage.py populate_data --skip-openaip
    python manage.py populate_data --force
"""
import logging
import time
from django.core.management.base import BaseCommand
from django.conf import settings

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Populate initial aviation data (airports, navaids, PIREPs, METARs, airspace)'

    def add_arguments(self, parser):
        parser.add_argument(
            '--skip-openaip',
            action='store_true',
            help='Skip OpenAIP airspace boundary fetch',
        )
        parser.add_argument(
            '--force',
            action='store_true',
            help='Force refresh even if data exists',
        )
        parser.add_argument(
            '--async',
            action='store_true',
            dest='run_async',
            help='Queue tasks asynchronously via Celery instead of running synchronously',
        )

    def handle(self, *args, **options):
        skip_openaip = options['skip_openaip']
        force = options['force']
        run_async = options['run_async']

        self.stdout.write(self.style.NOTICE('Starting aviation data population...'))
        start_time = time.time()

        results = {}

        if run_async:
            results = self._queue_async_tasks(skip_openaip)
        else:
            results = self._run_sync_tasks(skip_openaip, force)

        elapsed = time.time() - start_time
        self.stdout.write(self.style.SUCCESS(f'\nData population complete in {elapsed:.1f}s'))
        self.stdout.write(self.style.SUCCESS(f'Results: {results}'))

    def _run_sync_tasks(self, skip_openaip: bool, force: bool) -> dict:
        """Run data population tasks synchronously."""
        results = {}

        # 1. Geographic data (airports, navaids, GeoJSON)
        self.stdout.write('  [1/6] Refreshing geographic data (airports, navaids, GeoJSON)...')
        try:
            from skyspy.services import geodata

            if force or geodata.should_refresh():
                geo_results = geodata.refresh_all_geodata()
                results['geodata'] = geo_results
                self.stdout.write(self.style.SUCCESS(
                    f'    ✓ Airports: {geo_results.get("airports", 0)}, '
                    f'Navaids: {geo_results.get("navaids", 0)}, '
                    f'GeoJSON: {geo_results.get("geojson", 0)}'
                ))
            else:
                stats = geodata.get_cache_stats()
                results['geodata'] = {'status': 'skipped', 'reason': 'data fresh'}
                self.stdout.write(self.style.WARNING(
                    f'    - Skipped (data fresh): {stats["airports"]["count"]} airports, '
                    f'{stats["navaids"]["count"]} navaids'
                ))
        except Exception as e:
            results['geodata'] = {'error': str(e)}
            self.stdout.write(self.style.ERROR(f'    ✗ Error: {e}'))

        # 2. PIREPs
        self.stdout.write('  [2/6] Fetching PIREPs from Aviation Weather Center...')
        try:
            from skyspy.services import weather_cache

            stored = weather_cache.fetch_and_store_pireps()
            results['pireps'] = {'stored': stored}
            self.stdout.write(self.style.SUCCESS(f'    ✓ Stored {stored} new PIREPs'))
        except Exception as e:
            results['pireps'] = {'error': str(e)}
            self.stdout.write(self.style.ERROR(f'    ✗ Error: {e}'))

        # 3. METARs
        self.stdout.write('  [3/6] Fetching METARs from Aviation Weather Center...')
        try:
            from skyspy.services import weather_cache

            metars = weather_cache.fetch_and_cache_metars()
            results['metars'] = {'count': len(metars)}
            self.stdout.write(self.style.SUCCESS(f'    ✓ Cached {len(metars)} METARs'))
        except Exception as e:
            results['metars'] = {'error': str(e)}
            self.stdout.write(self.style.ERROR(f'    ✗ Error: {e}'))

        # 4. TAFs
        self.stdout.write('  [4/6] Fetching TAFs from Aviation Weather Center...')
        try:
            from skyspy.services import weather_cache

            tafs = weather_cache.fetch_and_cache_tafs()
            results['tafs'] = {'count': len(tafs)}
            self.stdout.write(self.style.SUCCESS(f'    ✓ Cached {len(tafs)} TAFs'))
        except Exception as e:
            results['tafs'] = {'error': str(e)}
            self.stdout.write(self.style.ERROR(f'    ✗ Error: {e}'))

        # 5. NOTAMs
        self.stdout.write('  [5/7] Fetching NOTAMs from Aviation Weather Center...')
        try:
            from skyspy.services import notams

            count = notams.refresh_notams()
            results['notams'] = {'count': count}
            self.stdout.write(self.style.SUCCESS(f'    ✓ Cached {count} NOTAMs'))
        except Exception as e:
            results['notams'] = {'error': str(e)}
            self.stdout.write(self.style.ERROR(f'    ✗ Error: {e}'))

        # 6. Airspace advisories (G-AIRMETs, SIGMETs)
        self.stdout.write('  [6/7] Fetching airspace advisories (G-AIRMETs)...')
        try:
            from skyspy.tasks.airspace import refresh_airspace_advisories

            # Run synchronously (not via Celery)
            refresh_airspace_advisories()

            from skyspy.models import AirspaceAdvisory
            from django.utils import timezone
            now = timezone.now()
            count = AirspaceAdvisory.objects.filter(
                valid_from__lte=now,
                valid_to__gte=now
            ).count()
            results['advisories'] = {'active': count}
            self.stdout.write(self.style.SUCCESS(f'    ✓ {count} active advisories'))
        except Exception as e:
            results['advisories'] = {'error': str(e)}
            self.stdout.write(self.style.ERROR(f'    ✗ Error: {e}'))

        # 7. Airspace boundaries (OpenAIP)
        if skip_openaip:
            self.stdout.write('  [7/7] Skipping OpenAIP airspace boundaries (--skip-openaip)')
            results['boundaries'] = {'status': 'skipped'}
        elif not getattr(settings, 'OPENAIP_ENABLED', False):
            self.stdout.write(self.style.WARNING(
                '  [7/7] Skipping OpenAIP (OPENAIP_ENABLED=False or no API key)'
            ))
            results['boundaries'] = {'status': 'disabled'}
        else:
            self.stdout.write('  [7/7] Fetching airspace boundaries from OpenAIP...')
            try:
                from skyspy.tasks.airspace import refresh_airspace_boundaries

                # Run synchronously
                result = refresh_airspace_boundaries()
                results['boundaries'] = result
                self.stdout.write(self.style.SUCCESS(
                    f'    ✓ Processed {result.get("processed", 0)} airspaces, '
                    f'{result.get("total", 0)} total in database'
                ))
            except Exception as e:
                results['boundaries'] = {'error': str(e)}
                self.stdout.write(self.style.ERROR(f'    ✗ Error: {e}'))

        return results

    def _queue_async_tasks(self, skip_openaip: bool) -> dict:
        """Queue data population tasks via Celery."""
        results = {}

        self.stdout.write('  Queuing tasks via Celery...')

        try:
            from skyspy.tasks.geodata import (
                refresh_all_geodata,
                refresh_pireps,
                refresh_metars,
                refresh_tafs,
            )
            from skyspy.tasks.airspace import (
                refresh_airspace_advisories,
                refresh_airspace_boundaries,
            )
            from skyspy.tasks.notams import refresh_notams

            # Queue all tasks
            refresh_all_geodata.delay()
            results['geodata'] = 'queued'
            self.stdout.write('    ✓ Queued: refresh_all_geodata')

            refresh_pireps.delay()
            results['pireps'] = 'queued'
            self.stdout.write('    ✓ Queued: refresh_pireps')

            refresh_metars.delay()
            results['metars'] = 'queued'
            self.stdout.write('    ✓ Queued: refresh_metars')

            refresh_tafs.delay()
            results['tafs'] = 'queued'
            self.stdout.write('    ✓ Queued: refresh_tafs')

            refresh_notams.delay()
            results['notams'] = 'queued'
            self.stdout.write('    ✓ Queued: refresh_notams')

            refresh_airspace_advisories.delay()
            results['advisories'] = 'queued'
            self.stdout.write('    ✓ Queued: refresh_airspace_advisories')

            if not skip_openaip and getattr(settings, 'OPENAIP_ENABLED', False):
                refresh_airspace_boundaries.delay()
                results['boundaries'] = 'queued'
                self.stdout.write('    ✓ Queued: refresh_airspace_boundaries')
            else:
                results['boundaries'] = 'skipped'
                self.stdout.write('    - Skipped: refresh_airspace_boundaries (OpenAIP disabled)')

        except Exception as e:
            results['error'] = str(e)
            self.stdout.write(self.style.ERROR(f'    ✗ Error queuing tasks: {e}'))

        return results
