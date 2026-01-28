"""
Django management command to manually run any Celery task.

Usage:
    # List all available tasks
    python manage.py run_task --list

    # Run a task immediately (synchronously)
    python manage.py run_task skyspy.tasks.aircraft.poll_aircraft

    # Run a task asynchronously (queue it)
    python manage.py run_task skyspy.tasks.aircraft.poll_aircraft --async

    # Run a task with positional arguments
    python manage.py run_task skyspy.tasks.external_db.fetch_aircraft_info --args '["A1B2C3"]'

    # Run a task with keyword arguments
    python manage.py run_task skyspy.tasks.notifications.send_notification_task --kwargs '{"channel_id": 1}'

    # Combine args and kwargs
    python manage.py run_task some.task --args '["arg1"]' --kwargs '{"key": "value"}'
"""
import json

from django.core.management.base import BaseCommand, CommandError

from skyspy.celery import app


class Command(BaseCommand):
    help = 'Manually run any Celery task'

    def add_arguments(self, parser):
        parser.add_argument(
            'task_name',
            nargs='?',
            help='Full task name (e.g., skyspy.tasks.aircraft.poll_aircraft)'
        )
        parser.add_argument(
            '--list',
            action='store_true',
            help='List all available tasks'
        )
        parser.add_argument(
            '--async',
            action='store_true',
            dest='run_async',
            help='Queue the task instead of running synchronously'
        )
        parser.add_argument(
            '--args',
            type=str,
            default='[]',
            help='JSON array of positional arguments (e.g., \'["arg1", "arg2"]\')'
        )
        parser.add_argument(
            '--kwargs',
            type=str,
            default='{}',
            help='JSON object of keyword arguments (e.g., \'{"key": "value"}\')'
        )

    def handle(self, *args, **options):
        if options['list']:
            self._list_tasks()
            return

        task_name = options['task_name']
        if not task_name:
            raise CommandError('Task name is required. Use --list to see available tasks.')

        # Parse arguments
        try:
            task_args = json.loads(options['args'])
            if not isinstance(task_args, list):
                raise CommandError('--args must be a JSON array')
        except json.JSONDecodeError as e:
            raise CommandError(f'Invalid JSON for --args: {e}')

        try:
            task_kwargs = json.loads(options['kwargs'])
            if not isinstance(task_kwargs, dict):
                raise CommandError('--kwargs must be a JSON object')
        except json.JSONDecodeError as e:
            raise CommandError(f'Invalid JSON for --kwargs: {e}')

        # Get the task
        try:
            task = app.tasks[task_name]
        except KeyError:
            # Try to find partial matches
            matches = [t for t in app.tasks.keys() if task_name in t and not t.startswith('celery.')]
            if matches:
                self.stderr.write(self.style.ERROR(f'Task "{task_name}" not found. Did you mean:'))
                for match in sorted(matches)[:10]:
                    self.stderr.write(f'  - {match}')
            else:
                self.stderr.write(self.style.ERROR(f'Task "{task_name}" not found. Use --list to see available tasks.'))
            return

        self.stdout.write(f'Task: {self.style.SUCCESS(task_name)}')
        if task_args:
            self.stdout.write(f'Args: {task_args}')
        if task_kwargs:
            self.stdout.write(f'Kwargs: {task_kwargs}')

        if options['run_async']:
            # Queue the task
            result = task.delay(*task_args, **task_kwargs)
            self.stdout.write(self.style.SUCCESS(f'Task queued with ID: {result.id}'))
        else:
            # Run synchronously
            self.stdout.write('Running task synchronously...')
            try:
                result = task(*task_args, **task_kwargs)
                self.stdout.write(self.style.SUCCESS('Task completed.'))
                if result is not None:
                    self.stdout.write(f'Result: {result}')
            except Exception as e:
                self.stderr.write(self.style.ERROR(f'Task failed: {e}'))
                raise

    def _list_tasks(self):
        """List all registered Celery tasks."""
        # Filter to only show skyspy tasks (not internal celery tasks)
        tasks = sorted([
            name for name in app.tasks.keys()
            if not name.startswith('celery.')
        ])

        if not tasks:
            self.stdout.write('No tasks registered.')
            return

        self.stdout.write(self.style.SUCCESS('Available tasks:'))
        self.stdout.write('')

        # Group by module
        modules = {}
        for task in tasks:
            parts = task.rsplit('.', 1)
            if len(parts) == 2:
                module, name = parts
            else:
                module, name = 'other', task
            modules.setdefault(module, []).append(name)

        for module in sorted(modules.keys()):
            self.stdout.write(self.style.MIGRATE_HEADING(f'{module}'))
            for name in sorted(modules[module]):
                full_name = f'{module}.{name}'
                self.stdout.write(f'  {name}')
            self.stdout.write('')
