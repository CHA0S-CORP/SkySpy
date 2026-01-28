"""
Django management command to run the ACARS UDP listener.

This runs as a separate process (not Celery) to receive ACARS/VDL2 messages
from acarsdec/vdlm2dec via acars_router.

Usage:
    python manage.py run_acars
    python manage.py run_acars --acars-port 5550 --vdlm2-port 5555

The listener receives JSON messages over UDP and:
- Normalizes message formats
- Enriches with airline and label information
- Stores messages in the database
- Broadcasts to WebSocket clients via Django Channels
"""
import asyncio
import logging
import signal
import sys

from django.core.management.base import BaseCommand
from django.conf import settings

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Run the ACARS/VDL2 UDP listener service'

    def add_arguments(self, parser):
        parser.add_argument(
            '--acars-port',
            type=int,
            default=getattr(settings, 'ACARS_UDP_PORT', 5550),
            help='UDP port for ACARS messages (default: 5550)'
        )
        parser.add_argument(
            '--vdlm2-port',
            type=int,
            default=getattr(settings, 'VDLM2_UDP_PORT', 5555),
            help='UDP port for VDL2 messages (default: 5555)'
        )
        parser.add_argument(
            '--no-acars',
            action='store_true',
            help='Disable ACARS listener'
        )
        parser.add_argument(
            '--no-vdlm2',
            action='store_true',
            help='Disable VDL2 listener'
        )
        parser.add_argument(
            '-v', '--verbosity',
            type=int,
            default=1,
            help='Verbosity level (0=minimal, 1=normal, 2=verbose)'
        )

    def handle(self, *args, **options):
        # Set up logging
        log_level = logging.WARNING
        if options['verbosity'] == 1:
            log_level = logging.INFO
        elif options['verbosity'] >= 2:
            log_level = logging.DEBUG

        logging.basicConfig(
            level=log_level,
            format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
        )

        acars_port = options['acars_port'] if not options['no_acars'] else None
        vdlm2_port = options['vdlm2_port'] if not options['no_vdlm2'] else None

        if not acars_port and not vdlm2_port:
            self.stderr.write(self.style.ERROR('No listeners enabled. Use --acars-port or --vdlm2-port'))
            sys.exit(1)

        self.stdout.write(self.style.SUCCESS('Starting ACARS service...'))
        if acars_port:
            self.stdout.write(f'  ACARS listener: UDP port {acars_port}')
        if vdlm2_port:
            self.stdout.write(f'  VDL2 listener: UDP port {vdlm2_port}')

        # Run the async service
        try:
            asyncio.run(self._run_service(acars_port, vdlm2_port))
        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING('\nShutdown requested...'))
        except Exception as e:
            self.stderr.write(self.style.ERROR(f'Error: {e}'))
            logger.exception('ACARS service error')
            sys.exit(1)

        self.stdout.write(self.style.SUCCESS('ACARS service stopped.'))

    async def _run_service(self, acars_port: int, vdlm2_port: int):
        """Run the ACARS service with signal handling."""
        from skyspy.services.acars import acars_service

        # Set up signal handlers
        loop = asyncio.get_running_loop()
        stop_event = asyncio.Event()

        def signal_handler():
            logger.info('Received shutdown signal')
            stop_event.set()

        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, signal_handler)
            except NotImplementedError:
                # Windows doesn't support add_signal_handler
                pass

        # Start the service
        await acars_service.start(
            acars_port=acars_port,
            vdlm2_port=vdlm2_port
        )

        # Wait for shutdown signal
        await stop_event.wait()

        # Stop the service
        await acars_service.stop()

        # Log final statistics
        stats = acars_service.get_stats()
        logger.info(
            f"Final stats - ACARS: {stats['acars']['total']} messages, "
            f"VDL2: {stats['vdlm2']['total']} messages"
        )
