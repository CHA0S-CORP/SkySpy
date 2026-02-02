"""
FAA SWIM FNS (Flight NOTAM System) service.

Connects to FAA's SWIM Solace messaging system to receive real-time NOTAM updates.
Documentation: https://github.com/faa-swim/fns-client

Message format is AIXM 5.1 (Aeronautical Information Exchange Model).
"""
import logging
import threading
import time
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Optional, Dict, Any, Callable

from django.conf import settings
from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

# AIXM namespaces for parsing
AIXM_NAMESPACES = {
    'aixm': 'http://www.aixm.aero/schema/5.1',
    'gml': 'http://www.opengis.net/gml/3.2',
    'xlink': 'http://www.w3.org/1999/xlink',
    'message': 'http://www.faa.aero/aim/fns/1.1',
    'event': 'http://www.aixm.aero/schema/5.1/event',
}

# Global consumer instance
_consumer: Optional['SwimFnsConsumer'] = None
_consumer_lock = threading.Lock()


def is_enabled() -> bool:
    """Check if SWIM FNS is enabled."""
    return getattr(settings, 'SWIM_FNS_ENABLED', False)


def get_connection_config() -> Dict[str, Any]:
    """Get SWIM FNS connection configuration."""
    return {
        'host': getattr(settings, 'SWIM_FNS_HOST', 'ems1.swim.faa.gov'),
        'port': getattr(settings, 'SWIM_FNS_PORT', 55443),
        'vpn': getattr(settings, 'SWIM_FNS_VPN', 'AIM_FNS'),
        'username': getattr(settings, 'SWIM_FNS_USERNAME', ''),
        'password': getattr(settings, 'SWIM_FNS_PASSWORD', ''),
        'queue': getattr(settings, 'SWIM_FNS_QUEUE', ''),
    }


class SwimFnsConsumer:
    """
    SWIM FNS consumer for receiving NOTAMs via Solace messaging.

    Uses the Solace PubSub+ Python API to connect to FAA's SWIM service.
    """

    def __init__(self, message_handler: Optional[Callable] = None):
        self.config = get_connection_config()
        self.message_handler = message_handler or self._default_handler
        self.messaging_service = None
        self.receiver = None
        self.running = False
        self._stats = {
            'messages_received': 0,
            'messages_processed': 0,
            'errors': 0,
            'last_message_time': None,
            'connected_since': None,
        }

    def connect(self) -> bool:
        """Connect to the SWIM FNS Solace broker."""
        try:
            from solace.messaging.messaging_service import MessagingService
            from solace.messaging.config.transport_security_strategy import TLS
            from solace.messaging.resources.queue import Queue

            # Build connection properties
            broker_props = {
                "solace.messaging.transport.host": f"tcps://{self.config['host']}:{self.config['port']}",
                "solace.messaging.service.vpn-name": self.config['vpn'],
                "solace.messaging.authentication.scheme.basic.username": self.config['username'],
                "solace.messaging.authentication.scheme.basic.password": self.config['password'],
            }

            # Create messaging service with TLS
            # FAA SWIM uses government CA certs not in standard bundles
            # Disable validation for now (TODO: add FAA CA cert to trust store)
            transport_security = TLS.create().without_certificate_validation()

            self.messaging_service = MessagingService.builder() \
                .from_properties(broker_props) \
                .with_transport_security_strategy(transport_security) \
                .build()

            # Connect
            self.messaging_service.connect()
            logger.info(f"Connected to SWIM FNS at {self.config['host']}")

            # Create queue receiver (non-exclusive for shared SWIM queue)
            queue = Queue.durable_non_exclusive_queue(self.config['queue'])

            self.receiver = self.messaging_service.create_persistent_message_receiver_builder() \
                .build(queue)

            self.receiver.start()
            logger.info(f"Started receiving from queue: {self.config['queue']}")

            self._stats['connected_since'] = timezone.now()
            return True

        except ImportError:
            logger.error("solace-pubsubplus package not installed. Run: pip install solace-pubsubplus")
            return False
        except Exception as e:
            logger.error(f"Failed to connect to SWIM FNS: {e}")
            return False

    def disconnect(self):
        """Disconnect from the SWIM FNS broker."""
        self.running = False

        try:
            if self.receiver:
                self.receiver.terminate()
                self.receiver = None

            if self.messaging_service:
                self.messaging_service.disconnect()
                self.messaging_service = None

            logger.info("Disconnected from SWIM FNS")
        except Exception as e:
            logger.error(f"Error disconnecting from SWIM FNS: {e}")

    def consume_messages(self, max_messages: Optional[int] = None, timeout_ms: int = 5000):
        """
        Consume messages from the queue.

        Args:
            max_messages: Maximum number of messages to process (None = unlimited)
            timeout_ms: Timeout in milliseconds for each receive
        """
        if not self.receiver:
            logger.error("Not connected to SWIM FNS")
            return

        self.running = True
        message_count = 0

        logger.info("Starting SWIM FNS message consumption...")

        while self.running:
            try:
                # Receive message with timeout
                message = self.receiver.receive_message(timeout_ms)

                if message:
                    self._stats['messages_received'] += 1
                    self._stats['last_message_time'] = timezone.now()

                    # Get message payload
                    payload = message.get_payload_as_string()

                    if payload:
                        try:
                            self.message_handler(payload)
                            self._stats['messages_processed'] += 1
                            message_count += 1
                        except Exception as e:
                            logger.error(f"Error processing NOTAM message: {e}")
                            self._stats['errors'] += 1

                    # Acknowledge message
                    self.receiver.ack(message)

                    # Check message limit
                    if max_messages and message_count >= max_messages:
                        logger.info(f"Reached message limit: {max_messages}")
                        break

            except Exception as e:
                if self.running:
                    logger.error(f"Error receiving message: {e}")
                    self._stats['errors'] += 1
                    time.sleep(1)  # Brief pause before retry

        logger.info(f"Stopped message consumption. Processed {message_count} messages.")

    def _default_handler(self, payload: str):
        """Default message handler - parses and stores NOTAM."""
        notam_data = parse_aixm_notam(payload)
        if notam_data:
            store_notam(notam_data)

    def get_stats(self) -> Dict[str, Any]:
        """Get consumer statistics."""
        return {
            **self._stats,
            'connected': self.messaging_service is not None and self.messaging_service.is_connected if self.messaging_service else False,
            'running': self.running,
        }


def parse_aixm_notam(xml_payload: str) -> Optional[Dict[str, Any]]:
    """
    Parse an AIXM 5.1 NOTAM message.

    Args:
        xml_payload: Raw XML message from SWIM

    Returns:
        Parsed NOTAM dictionary or None if invalid
    """
    try:
        root = ET.fromstring(xml_payload)

        # Extract NOTAM data from AIXM structure
        # The structure varies but typically includes:
        # - message:hasMember/aixm:Event or aixm:NOTAM

        notam = {}

        # Try to find NOTAM element
        notam_elem = root.find('.//aixm:NOTAM', AIXM_NAMESPACES)
        if notam_elem is None:
            notam_elem = root.find('.//event:Event', AIXM_NAMESPACES)
        if notam_elem is None:
            # Try without namespace
            notam_elem = root.find('.//*[local-name()="NOTAM"]')

        if notam_elem is None:
            logger.debug("No NOTAM element found in message")
            return None

        # Extract fields with fallback paths
        notam['notam_id'] = _get_text(notam_elem, [
            './/aixm:designator',
            './/aixm:id',
            './/*[local-name()="designator"]',
            './/*[local-name()="id"]',
        ])

        notam['location'] = _get_text(notam_elem, [
            './/aixm:locationIndicator',
            './/aixm:location',
            './/*[local-name()="locationIndicator"]',
        ])

        notam['text'] = _get_text(notam_elem, [
            './/aixm:text',
            './/aixm:description',
            './/*[local-name()="text"]',
            './/*[local-name()="description"]',
        ])

        # Parse classification/type
        classification = _get_text(notam_elem, [
            './/aixm:classification',
            './/aixm:series',
            './/*[local-name()="classification"]',
        ])
        notam['notam_type'] = _map_classification(classification)

        # Parse times
        start_time = _get_text(notam_elem, [
            './/aixm:effectiveStart',
            './/gml:beginPosition',
            './/*[local-name()="effectiveStart"]',
            './/*[local-name()="beginPosition"]',
        ])
        end_time = _get_text(notam_elem, [
            './/aixm:effectiveEnd',
            './/gml:endPosition',
            './/*[local-name()="effectiveEnd"]',
            './/*[local-name()="endPosition"]',
        ])

        notam['effective_start'] = _parse_datetime(start_time)
        notam['effective_end'] = _parse_datetime(end_time)
        notam['is_permanent'] = end_time and end_time.upper() in ('PERM', 'PERMANENT')

        # Parse coordinates
        pos = _get_text(notam_elem, [
            './/gml:pos',
            './/aixm:position//gml:pos',
            './/*[local-name()="pos"]',
        ])
        if pos:
            coords = pos.split()
            if len(coords) >= 2:
                try:
                    notam['latitude'] = float(coords[0])
                    notam['longitude'] = float(coords[1])
                except ValueError:
                    pass

        # Parse altitude
        notam['floor_ft'] = _get_int(notam_elem, [
            './/aixm:lowerLimit',
            './/*[local-name()="lowerLimit"]',
        ])
        notam['ceiling_ft'] = _get_int(notam_elem, [
            './/aixm:upperLimit',
            './/*[local-name()="upperLimit"]',
        ])

        # Parse radius for TFRs
        radius = _get_text(notam_elem, [
            './/aixm:radius',
            './/*[local-name()="radius"]',
        ])
        if radius:
            try:
                # Radius might be in various units
                notam['radius_nm'] = float(radius)
            except ValueError:
                pass

        # Parse reason/purpose
        notam['reason'] = _get_text(notam_elem, [
            './/aixm:purpose',
            './/aixm:reason',
            './/*[local-name()="purpose"]',
        ])

        # Store raw XML for debugging
        notam['source_data'] = {'raw_xml': xml_payload[:2000]}

        # Validate required fields
        if not notam.get('notam_id'):
            logger.debug("NOTAM missing ID")
            return None

        return notam

    except ET.ParseError as e:
        logger.warning(f"Failed to parse AIXM XML: {e}")
        return None
    except Exception as e:
        logger.error(f"Error parsing NOTAM: {e}")
        return None


def _get_text(elem: ET.Element, paths: list) -> Optional[str]:
    """Get text from first matching path."""
    for path in paths:
        try:
            found = elem.find(path, AIXM_NAMESPACES)
            if found is not None and found.text:
                return found.text.strip()
        except Exception:
            continue
    return None


def _get_int(elem: ET.Element, paths: list) -> Optional[int]:
    """Get integer from first matching path."""
    text = _get_text(elem, paths)
    if text:
        try:
            return int(float(text))
        except ValueError:
            pass
    return None


def _parse_datetime(dt_str: Optional[str]) -> Optional[datetime]:
    """Parse datetime string to datetime object."""
    if not dt_str:
        return None

    # Handle permanent
    if dt_str.upper() in ('PERM', 'PERMANENT'):
        return None

    # Try various formats
    formats = [
        '%Y-%m-%dT%H:%M:%SZ',
        '%Y-%m-%dT%H:%M:%S.%fZ',
        '%Y-%m-%dT%H:%M:%S%z',
        '%Y-%m-%d %H:%M:%S',
        '%y%m%d%H%M',  # NOTAM format: YYMMDDHHMM
    ]

    for fmt in formats:
        try:
            dt = datetime.strptime(dt_str, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue

    return None


def _map_classification(classification: Optional[str]) -> str:
    """Map AIXM classification to NOTAM type."""
    if not classification:
        return 'D'

    classification = classification.upper()

    if 'TFR' in classification:
        return 'TFR'
    elif 'FDC' in classification:
        return 'FDC'
    elif 'GPS' in classification:
        return 'GPS'
    elif 'MIL' in classification:
        return 'MIL'
    else:
        return 'D'


@transaction.atomic
def store_notam(notam_data: Dict[str, Any]) -> bool:
    """
    Store or update a NOTAM in the database.

    Args:
        notam_data: Parsed NOTAM dictionary

    Returns:
        True if stored successfully
    """
    from skyspy.models.notams import CachedNotam

    try:
        notam_id = notam_data.pop('notam_id')

        obj, created = CachedNotam.objects.update_or_create(
            notam_id=notam_id,
            defaults={
                **notam_data,
                'fetched_at': timezone.now(),
            }
        )

        if created:
            logger.debug(f"Created new NOTAM: {notam_id}")
        else:
            logger.debug(f"Updated NOTAM: {notam_id}")

        return True

    except Exception as e:
        logger.error(f"Failed to store NOTAM: {e}")
        return False


def get_consumer() -> SwimFnsConsumer:
    """Get or create the singleton consumer instance."""
    global _consumer

    with _consumer_lock:
        if _consumer is None:
            _consumer = SwimFnsConsumer()
        return _consumer


def start_consumer(max_messages: Optional[int] = None):
    """
    Start the SWIM FNS consumer.

    This is typically called from a Celery task.
    """
    if not is_enabled():
        logger.info("SWIM FNS is disabled")
        return False

    consumer = get_consumer()

    if consumer.connect():
        try:
            consumer.consume_messages(max_messages=max_messages)
        finally:
            consumer.disconnect()
        return True

    return False


def stop_consumer():
    """Stop the SWIM FNS consumer."""
    global _consumer

    with _consumer_lock:
        if _consumer:
            _consumer.disconnect()
            _consumer = None


def get_status() -> Dict[str, Any]:
    """Get SWIM FNS service status."""
    config = get_connection_config()

    status = {
        'enabled': is_enabled(),
        'host': config['host'],
        'vpn': config['vpn'],
        'queue': config['queue'][:50] + '...' if len(config['queue']) > 50 else config['queue'],
        'connected': False,
        'stats': None,
    }

    if _consumer:
        status['connected'] = _consumer.messaging_service is not None
        status['stats'] = _consumer.get_stats()

    return status
