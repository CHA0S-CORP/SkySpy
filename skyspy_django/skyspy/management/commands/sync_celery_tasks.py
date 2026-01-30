"""
Management command to sync Celery beat schedule from code to database.

Syncs tasks defined in app.conf.beat_schedule (celery.py) to django_celery_beat
database tables, enabling use of DatabaseScheduler while keeping task definitions
in code.
"""
import json
from django.core.management.base import BaseCommand
from django_celery_beat.models import PeriodicTask, IntervalSchedule, CrontabSchedule


class Command(BaseCommand):
    help = 'Sync Celery beat schedule from celery.py to database'

    def add_arguments(self, parser):
        parser.add_argument(
            '--clear',
            action='store_true',
            help='Clear all existing periodic tasks before syncing',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be synced without making changes',
        )

    def handle(self, *args, **options):
        from skyspy.celery import app

        dry_run = options['dry_run']
        clear = options['clear']

        if clear and not dry_run:
            self.stdout.write('Clearing existing periodic tasks...')
            PeriodicTask.objects.all().delete()

        beat_schedule = app.conf.beat_schedule
        self.stdout.write(f'Found {len(beat_schedule)} tasks in beat_schedule')

        created = 0
        updated = 0
        skipped = 0

        for task_name, task_config in beat_schedule.items():
            task_path = task_config['task']
            schedule = task_config['schedule']
            task_options = task_config.get('options', {})
            task_args = task_config.get('args', [])
            task_kwargs = task_config.get('kwargs', {})

            if dry_run:
                self.stdout.write(f'  [DRY-RUN] Would sync: {task_name}')
                continue

            # Determine schedule type and create appropriate schedule object
            schedule_obj = None
            schedule_type = None

            if isinstance(schedule, (int, float)):
                # It's an interval in seconds
                schedule_type = 'interval'
                seconds = int(schedule)
                schedule_obj, _ = IntervalSchedule.objects.get_or_create(
                    every=seconds,
                    period=IntervalSchedule.SECONDS,
                )
            elif hasattr(schedule, 'minute') and hasattr(schedule, 'hour'):
                # It's a crontab object from celery.schedules
                schedule_type = 'crontab'

                # Extract crontab values - handle celery's internal representation
                def get_crontab_value(attr):
                    val = getattr(schedule, attr, '*')
                    # Celery stores these as sets or special objects
                    if hasattr(val, '__iter__') and not isinstance(val, str):
                        items = list(val)
                        if len(items) == 0:
                            return '*'
                        return ','.join(map(str, sorted(items)))
                    return str(val) if val is not None else '*'

                crontab_kwargs = {
                    'minute': get_crontab_value('minute'),
                    'hour': get_crontab_value('hour'),
                    'day_of_week': get_crontab_value('day_of_week'),
                    'day_of_month': get_crontab_value('day_of_month'),
                    'month_of_year': get_crontab_value('month_of_year'),
                }
                schedule_obj, _ = CrontabSchedule.objects.get_or_create(**crontab_kwargs)
            else:
                self.stdout.write(
                    self.style.WARNING(f'  Skipping {task_name}: unsupported schedule type {type(schedule)}')
                )
                skipped += 1
                continue

            # Build task kwargs
            task_defaults = {
                'task': task_path,
                'args': json.dumps(task_args),
                'kwargs': json.dumps(task_kwargs),
                'enabled': True,
            }

            # Add expires if specified
            if 'expires' in task_options:
                task_defaults['expires'] = None  # PeriodicTask doesn't support expires directly

            # Set the appropriate schedule foreign key
            if schedule_type == 'interval':
                task_defaults['interval'] = schedule_obj
                task_defaults['crontab'] = None
            elif schedule_type == 'crontab':
                task_defaults['crontab'] = schedule_obj
                task_defaults['interval'] = None

            # Create or update the periodic task
            task_obj, was_created = PeriodicTask.objects.update_or_create(
                name=task_name,
                defaults=task_defaults,
            )

            if was_created:
                created += 1
                self.stdout.write(self.style.SUCCESS(f'  Created: {task_name}'))
            else:
                updated += 1
                self.stdout.write(f'  Updated: {task_name}')

        if dry_run:
            self.stdout.write(self.style.WARNING(f'\nDry run complete. Would sync {len(beat_schedule)} tasks.'))
        else:
            self.stdout.write(self.style.SUCCESS(
                f'\nSync complete: {created} created, {updated} updated, {skipped} skipped'
            ))
