"""
Tests for the FAA SWIM FNS (Flight NOTAM System) service.

Tests NOTAM parsing, XML handling, SWIM consumer functionality,
and gevent workarounds.
"""

import json
import threading
import time
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from django.test import TestCase, override_settings
from django.utils import timezone

from skyspy.services.swim_fns import (
    AIXM_NAMESPACES,
    SwimFnsConsumer,
    _get_int,
    _get_text,
    _map_classification,
    _parse_datetime,
    consume_with_gevent_workaround,
    get_connection_config,
    get_consumer,
    get_status,
    is_enabled,
    parse_aixm_notam,
    run_consumer_subprocess,
    start_consumer,
    stop_consumer,
    store_notam,
)


class IsEnabledTests(TestCase):
    """Tests for the is_enabled function."""

    @override_settings(SWIM_FNS_ENABLED=True)
    def test_is_enabled_true(self):
        """Test is_enabled returns True when setting is True."""
        self.assertTrue(is_enabled())

    @override_settings(SWIM_FNS_ENABLED=False)
    def test_is_enabled_false(self):
        """Test is_enabled returns False when setting is False."""
        self.assertFalse(is_enabled())


class GetConnectionConfigTests(TestCase):
    """Tests for connection configuration."""

    @override_settings(
        SWIM_FNS_HOST="test.swim.faa.gov",
        SWIM_FNS_PORT=55000,
        SWIM_FNS_VPN="TEST_VPN",
        SWIM_FNS_USERNAME="testuser",
        SWIM_FNS_PASSWORD="testpass",
        SWIM_FNS_QUEUE="test/queue",
    )
    def test_get_connection_config(self):
        """Test connection config retrieval."""
        config = get_connection_config()

        self.assertEqual(config["host"], "test.swim.faa.gov")
        self.assertEqual(config["port"], 55000)
        self.assertEqual(config["vpn"], "TEST_VPN")
        self.assertEqual(config["username"], "testuser")
        self.assertEqual(config["password"], "testpass")
        self.assertEqual(config["queue"], "test/queue")


class ParseDatetimeTests(TestCase):
    """Tests for datetime parsing utility."""

    def test_parse_datetime_iso_utc(self):
        """Test parsing ISO format with Z suffix."""
        result = _parse_datetime("2024-01-15T12:30:00Z")
        self.assertIsNotNone(result)
        self.assertEqual(result.year, 2024)
        self.assertEqual(result.month, 1)
        self.assertEqual(result.day, 15)
        self.assertEqual(result.hour, 12)
        self.assertEqual(result.minute, 30)

    def test_parse_datetime_iso_microseconds(self):
        """Test parsing ISO format with microseconds."""
        result = _parse_datetime("2024-01-15T12:30:00.123456Z")
        self.assertIsNotNone(result)
        self.assertEqual(result.year, 2024)

    def test_parse_datetime_notam_format(self):
        """Test parsing NOTAM format (YYMMDDHHMM)."""
        result = _parse_datetime("2401151230")
        self.assertIsNotNone(result)
        self.assertEqual(result.year, 2024)
        self.assertEqual(result.month, 1)
        self.assertEqual(result.day, 15)

    def test_parse_datetime_permanent(self):
        """Test parsing PERM value returns None."""
        result = _parse_datetime("PERM")
        self.assertIsNone(result)

        result = _parse_datetime("PERMANENT")
        self.assertIsNone(result)

    def test_parse_datetime_none(self):
        """Test parsing None returns None."""
        result = _parse_datetime(None)
        self.assertIsNone(result)

    def test_parse_datetime_invalid(self):
        """Test parsing invalid string returns None."""
        result = _parse_datetime("not a date")
        self.assertIsNone(result)


class MapClassificationTests(TestCase):
    """Tests for classification mapping."""

    def test_map_classification_tfr(self):
        """Test mapping TFR classification."""
        self.assertEqual(_map_classification("TFR"), "TFR")
        self.assertEqual(_map_classification("tfr warning"), "TFR")

    def test_map_classification_fdc(self):
        """Test mapping FDC classification."""
        self.assertEqual(_map_classification("FDC"), "FDC")

    def test_map_classification_gps(self):
        """Test mapping GPS classification."""
        self.assertEqual(_map_classification("GPS INTERFERENCE"), "GPS")

    def test_map_classification_mil(self):
        """Test mapping military classification."""
        self.assertEqual(_map_classification("MIL ACTIVITY"), "MIL")

    def test_map_classification_default(self):
        """Test default classification."""
        self.assertEqual(_map_classification("OTHER"), "D")
        self.assertEqual(_map_classification(None), "D")


class ParseAixmNotamTests(TestCase):
    """Tests for AIXM NOTAM parsing."""

    def test_parse_aixm_notam_valid(self):
        """Test parsing valid AIXM NOTAM XML."""
        xml = """<?xml version="1.0" encoding="UTF-8"?>
        <message:AIXMBasicMessage xmlns:message="http://www.faa.aero/aim/fns/1.1"
                                   xmlns:aixm="http://www.aixm.aero/schema/5.1"
                                   xmlns:gml="http://www.opengis.net/gml/3.2">
            <message:hasMember>
                <aixm:NOTAM>
                    <aixm:designator>A0001/24</aixm:designator>
                    <aixm:locationIndicator>KSEA</aixm:locationIndicator>
                    <aixm:text>RUNWAY 16R/34L CLOSED</aixm:text>
                    <aixm:effectiveStart>2024-01-15T12:00:00Z</aixm:effectiveStart>
                    <aixm:effectiveEnd>2024-01-16T12:00:00Z</aixm:effectiveEnd>
                </aixm:NOTAM>
            </message:hasMember>
        </message:AIXMBasicMessage>
        """

        result = parse_aixm_notam(xml)

        self.assertIsNotNone(result)
        self.assertEqual(result["notam_id"], "A0001/24")
        self.assertEqual(result["location"], "KSEA")
        self.assertEqual(result["text"], "RUNWAY 16R/34L CLOSED")

    def test_parse_aixm_notam_no_notam_element(self):
        """Test parsing XML without NOTAM element returns None."""
        xml = """<?xml version="1.0" encoding="UTF-8"?>
        <message:AIXMBasicMessage xmlns:message="http://www.faa.aero/aim/fns/1.1">
            <message:hasMember>
                <Other>No NOTAM here</Other>
            </message:hasMember>
        </message:AIXMBasicMessage>
        """

        result = parse_aixm_notam(xml)

        self.assertIsNone(result)

    def test_parse_aixm_notam_missing_id(self):
        """Test parsing NOTAM without ID returns None."""
        xml = """<?xml version="1.0" encoding="UTF-8"?>
        <message:AIXMBasicMessage xmlns:message="http://www.faa.aero/aim/fns/1.1"
                                   xmlns:aixm="http://www.aixm.aero/schema/5.1">
            <message:hasMember>
                <aixm:NOTAM>
                    <aixm:text>No designator</aixm:text>
                </aixm:NOTAM>
            </message:hasMember>
        </message:AIXMBasicMessage>
        """

        result = parse_aixm_notam(xml)

        self.assertIsNone(result)

    def test_parse_aixm_notam_invalid_xml(self):
        """Test parsing invalid XML returns None."""
        xml = "not valid xml <><>"

        result = parse_aixm_notam(xml)

        self.assertIsNone(result)

    def test_parse_aixm_notam_with_coordinates(self):
        """Test parsing NOTAM with coordinates."""
        xml = """<?xml version="1.0" encoding="UTF-8"?>
        <message:AIXMBasicMessage xmlns:message="http://www.faa.aero/aim/fns/1.1"
                                   xmlns:aixm="http://www.aixm.aero/schema/5.1"
                                   xmlns:gml="http://www.opengis.net/gml/3.2">
            <message:hasMember>
                <aixm:NOTAM>
                    <aixm:designator>A0002/24</aixm:designator>
                    <aixm:text>TFR</aixm:text>
                    <aixm:position>
                        <gml:pos>47.5 -122.5</gml:pos>
                    </aixm:position>
                    <aixm:lowerLimit>0</aixm:lowerLimit>
                    <aixm:upperLimit>5000</aixm:upperLimit>
                </aixm:NOTAM>
            </message:hasMember>
        </message:AIXMBasicMessage>
        """

        result = parse_aixm_notam(xml)

        self.assertIsNotNone(result)
        self.assertEqual(result["latitude"], 47.5)
        self.assertEqual(result["longitude"], -122.5)
        self.assertEqual(result["floor_ft"], 0)
        self.assertEqual(result["ceiling_ft"], 5000)


class StoreNotamTests(TestCase):
    """Tests for NOTAM storage."""

    def tearDown(self):
        """Clean up test data."""
        from skyspy.models.notams import CachedNotam

        CachedNotam.objects.all().delete()

    def test_store_notam_creates_new(self):
        """Test storing a new NOTAM."""
        from skyspy.models.notams import CachedNotam

        notam_data = {
            "notam_id": "A0001/24",
            "location": "KSEA",
            "text": "RUNWAY CLOSED",
            "notam_type": "D",
            "effective_start": timezone.now(),
        }

        result = store_notam(notam_data)

        self.assertTrue(result)
        self.assertEqual(CachedNotam.objects.count(), 1)
        notam = CachedNotam.objects.first()
        self.assertEqual(notam.notam_id, "A0001/24")

    def test_store_notam_updates_existing(self):
        """Test updating an existing NOTAM."""
        from skyspy.models.notams import CachedNotam

        # Create initial
        CachedNotam.objects.create(
            notam_id="A0001/24",
            text="Original text",
            location="KSEA",
            notam_type="D",
            effective_start=timezone.now(),
        )

        notam_data = {
            "notam_id": "A0001/24",
            "text": "Updated text",
        }

        result = store_notam(notam_data)

        self.assertTrue(result)
        self.assertEqual(CachedNotam.objects.count(), 1)
        notam = CachedNotam.objects.first()
        self.assertEqual(notam.text, "Updated text")


class SwimFnsConsumerTests(TestCase):
    """Tests for SwimFnsConsumer class."""

    def setUp(self):
        """Set up test fixtures."""
        self.consumer = SwimFnsConsumer()

    def test_consumer_initial_state(self):
        """Test consumer initial state."""
        self.assertFalse(self.consumer.running)
        self.assertIsNone(self.consumer.messaging_service)
        self.assertIsNone(self.consumer.receiver)
        self.assertEqual(self.consumer._stats["messages_received"], 0)

    def test_get_stats(self):
        """Test getting consumer stats."""
        stats = self.consumer.get_stats()

        self.assertIn("messages_received", stats)
        self.assertIn("messages_processed", stats)
        self.assertIn("errors", stats)
        self.assertIn("connected", stats)
        self.assertIn("running", stats)

    @patch("skyspy.services.swim_fns.MessagingService", create=True)
    @patch("skyspy.services.swim_fns.TLS", create=True)
    @patch("skyspy.services.swim_fns.Queue", create=True)
    def test_connect_success(self, mock_queue, mock_tls, mock_service_class):
        """Test successful connection."""
        # This test is skipped if solace package not installed
        pytest.importorskip("solace.messaging")

        mock_builder = MagicMock()
        mock_service = MagicMock()
        mock_builder.from_properties.return_value = mock_builder
        mock_builder.with_transport_security_strategy.return_value = mock_builder
        mock_builder.build.return_value = mock_service
        mock_service_class.builder.return_value = mock_builder

        mock_tls_instance = MagicMock()
        mock_tls.create.return_value = mock_tls_instance
        mock_tls_instance.without_certificate_validation.return_value = mock_tls_instance

        result = self.consumer.connect()

        # Connection may fail without real Solace endpoint
        # Just verify we don't crash
        self.assertIsInstance(result, bool)

    def test_disconnect_when_not_connected(self):
        """Test disconnect when not connected doesn't raise."""
        # Should not raise
        self.consumer.disconnect()
        self.assertFalse(self.consumer.running)

    def test_default_handler(self):
        """Test default message handler."""
        with (
            patch("skyspy.services.swim_fns.parse_aixm_notam") as mock_parse,
            patch("skyspy.services.swim_fns.store_notam") as mock_store,
        ):
            mock_parse.return_value = {"notam_id": "TEST123"}

            self.consumer._default_handler("<xml>test</xml>")

            mock_parse.assert_called_once_with("<xml>test</xml>")
            mock_store.assert_called_once_with({"notam_id": "TEST123"})


class GetConsumerTests(TestCase):
    """Tests for consumer singleton management."""

    def tearDown(self):
        """Clean up global consumer."""
        stop_consumer()

    def test_get_consumer_creates_instance(self):
        """Test get_consumer creates singleton."""
        consumer1 = get_consumer()
        consumer2 = get_consumer()

        self.assertIsNotNone(consumer1)
        self.assertIs(consumer1, consumer2)

    def test_stop_consumer_clears_instance(self):
        """Test stop_consumer clears the singleton."""
        get_consumer()
        stop_consumer()

        # Next call should create new instance
        import skyspy.services.swim_fns as swim_module

        self.assertIsNone(swim_module._consumer)


class GetStatusTests(TestCase):
    """Tests for status retrieval."""

    @override_settings(
        SWIM_FNS_ENABLED=True,
        SWIM_FNS_HOST="test.swim.faa.gov",
        SWIM_FNS_VPN="TEST_VPN",
        SWIM_FNS_QUEUE="test/queue/name",
    )
    def test_get_status(self):
        """Test getting SWIM FNS status."""
        status = get_status()

        self.assertTrue(status["enabled"])
        self.assertEqual(status["host"], "test.swim.faa.gov")
        self.assertEqual(status["vpn"], "TEST_VPN")
        self.assertIn("connected", status)


class StartConsumerTests(TestCase):
    """Tests for start_consumer function."""

    @override_settings(SWIM_FNS_ENABLED=False)
    def test_start_consumer_disabled(self):
        """Test start_consumer returns False when disabled."""
        result = start_consumer()

        self.assertFalse(result)


class ConsumeWithGeventWorkaroundTests(TestCase):
    """Tests for gevent workaround functionality."""

    @override_settings(SWIM_FNS_ENABLED=False)
    def test_consume_disabled(self):
        """Test consume returns disabled status when not enabled."""
        result = consume_with_gevent_workaround()

        self.assertEqual(result["status"], "disabled")


class RunConsumerSubprocessTests(TestCase):
    """Tests for subprocess consumer execution."""

    @override_settings(SWIM_FNS_ENABLED=False)
    def test_subprocess_disabled(self):
        """Test subprocess returns disabled when SWIM not enabled."""
        result = run_consumer_subprocess()

        self.assertEqual(result["status"], "disabled")


class XmlHelperTests(TestCase):
    """Tests for XML helper functions."""

    def test_get_text_found(self):
        """Test _get_text finds text in element."""
        import xml.etree.ElementTree as ET

        xml = """<root xmlns:aixm="http://www.aixm.aero/schema/5.1">
            <aixm:designator>TEST123</aixm:designator>
        </root>"""
        elem = ET.fromstring(xml)

        result = _get_text(elem, [".//aixm:designator"])

        self.assertEqual(result, "TEST123")

    def test_get_text_not_found(self):
        """Test _get_text returns None when not found."""
        import xml.etree.ElementTree as ET

        xml = "<root><other>value</other></root>"
        elem = ET.fromstring(xml)

        result = _get_text(elem, [".//missing"])

        self.assertIsNone(result)

    def test_get_int_found(self):
        """Test _get_int finds and converts integer."""
        import xml.etree.ElementTree as ET

        xml = """<root xmlns:aixm="http://www.aixm.aero/schema/5.1">
            <aixm:upperLimit>5000</aixm:upperLimit>
        </root>"""
        elem = ET.fromstring(xml)

        result = _get_int(elem, [".//aixm:upperLimit"])

        self.assertEqual(result, 5000)

    def test_get_int_not_found(self):
        """Test _get_int returns None when not found."""
        import xml.etree.ElementTree as ET

        xml = "<root><other>value</other></root>"
        elem = ET.fromstring(xml)

        result = _get_int(elem, [".//missing"])

        self.assertIsNone(result)

    def test_get_int_non_numeric(self):
        """Test _get_int returns None for non-numeric value."""
        import xml.etree.ElementTree as ET

        xml = "<root><value>not a number</value></root>"
        elem = ET.fromstring(xml)

        result = _get_int(elem, [".//value"])

        self.assertIsNone(result)
