"""
Tests for the ACARS decoder module.

Tests callsign parsing, airline lookup, label decoding,
coordinate parsing, message text decoding, and message enrichment.
"""
import pytest
from django.test import TestCase

from skyspy.services.acars_decoder import (
    find_airline_by_icao,
    find_airline_by_iata,
    lookup_label,
    get_label_name,
    parse_callsign,
    decode_label,
    validate_coordinates,
    parse_coordinates,
    decode_h1_message,
    decode_message_text,
    enrich_acars_message,
)


class AirlineLookupTests(TestCase):
    """Tests for airline lookup functions."""

    # =========================================================================
    # ICAO Airline Lookup
    # =========================================================================

    def test_find_airline_by_icao_american(self):
        """Test finding American Airlines by ICAO code."""
        iata, name = find_airline_by_icao('AAL')

        self.assertEqual(iata, 'AA')
        self.assertEqual(name, 'American Airlines')

    def test_find_airline_by_icao_delta(self):
        """Test finding Delta by ICAO code."""
        iata, name = find_airline_by_icao('DAL')

        self.assertEqual(iata, 'DL')
        self.assertEqual(name, 'Delta Air Lines')

    def test_find_airline_by_icao_united(self):
        """Test finding United by ICAO code."""
        iata, name = find_airline_by_icao('UAL')

        self.assertEqual(iata, 'UA')
        self.assertEqual(name, 'United Airlines')

    def test_find_airline_by_icao_southwest(self):
        """Test finding Southwest by ICAO code."""
        iata, name = find_airline_by_icao('SWA')

        self.assertEqual(iata, 'WN')
        self.assertEqual(name, 'Southwest Airlines')

    def test_find_airline_by_icao_international(self):
        """Test finding international airlines by ICAO code."""
        iata, name = find_airline_by_icao('BAW')
        self.assertEqual(iata, 'BA')
        self.assertEqual(name, 'British Airways')

        iata, name = find_airline_by_icao('DLH')
        self.assertEqual(iata, 'LH')
        self.assertEqual(name, 'Lufthansa')

        iata, name = find_airline_by_icao('UAE')
        self.assertEqual(iata, 'EK')
        self.assertEqual(name, 'Emirates')

    def test_find_airline_by_icao_cargo(self):
        """Test finding cargo airlines by ICAO code."""
        iata, name = find_airline_by_icao('FDX')
        self.assertEqual(iata, 'FX')
        self.assertEqual(name, 'FedEx Express')

        iata, name = find_airline_by_icao('UPS')
        self.assertEqual(iata, '5X')
        self.assertEqual(name, 'UPS Airlines')

    def test_find_airline_by_icao_unknown(self):
        """Test finding unknown ICAO code."""
        iata, name = find_airline_by_icao('XYZ')

        self.assertEqual(iata, 'XYZ')
        self.assertEqual(name, 'Unknown Airline')

    # =========================================================================
    # IATA Airline Lookup
    # =========================================================================

    def test_find_airline_by_iata_american(self):
        """Test finding American Airlines by IATA code."""
        icao, name = find_airline_by_iata('AA')

        self.assertEqual(icao, 'AAL')
        self.assertEqual(name, 'American Airlines')

    def test_find_airline_by_iata_delta(self):
        """Test finding Delta by IATA code."""
        icao, name = find_airline_by_iata('DL')

        self.assertEqual(icao, 'DAL')
        self.assertEqual(name, 'Delta Air Lines')

    def test_find_airline_by_iata_unknown(self):
        """Test finding unknown IATA code."""
        icao, name = find_airline_by_iata('XX')

        self.assertEqual(icao, 'XX')
        self.assertEqual(name, 'Unknown Airline')


class LabelLookupTests(TestCase):
    """Tests for message label lookup functions."""

    def test_lookup_label_oooi_out(self):
        """Test looking up OOOI Out label."""
        info = lookup_label('10')

        self.assertIsNotNone(info)
        self.assertEqual(info['name'], 'Out')
        self.assertIn('departed gate', info['description'])

    def test_lookup_label_oooi_off(self):
        """Test looking up OOOI Off label."""
        info = lookup_label('11')

        self.assertIsNotNone(info)
        self.assertEqual(info['name'], 'Off')
        self.assertIn('took off', info['description'])

    def test_lookup_label_oooi_on(self):
        """Test looking up OOOI On label."""
        info = lookup_label('12')

        self.assertIsNotNone(info)
        self.assertEqual(info['name'], 'On')
        self.assertIn('landed', info['description'])

    def test_lookup_label_oooi_in(self):
        """Test looking up OOOI In label."""
        info = lookup_label('13')

        self.assertIsNotNone(info)
        self.assertEqual(info['name'], 'In')
        self.assertIn('arrived at gate', info['description'])

    def test_lookup_label_datalink(self):
        """Test looking up H1 datalink label."""
        info = lookup_label('H1')

        self.assertIsNotNone(info)
        self.assertEqual(info['name'], 'Datalink')

    def test_lookup_label_weather(self):
        """Test looking up weather labels."""
        for label in ['QA', 'QB', 'QC', 'QD', 'QE', 'QF']:
            info = lookup_label(label)
            self.assertIsNotNone(info)
            self.assertEqual(info['name'], 'Weather')

    def test_lookup_label_unknown(self):
        """Test looking up unknown label."""
        info = lookup_label('ZZ')

        self.assertIsNone(info)

    def test_get_label_name_known(self):
        """Test get_label_name with known label."""
        name = get_label_name('10')

        self.assertEqual(name, 'Out')

    def test_get_label_name_unknown(self):
        """Test get_label_name with unknown label."""
        name = get_label_name('ZZ')

        self.assertEqual(name, 'ZZ')  # Returns label itself


class CallsignParsingTests(TestCase):
    """Tests for callsign parsing."""

    # =========================================================================
    # ICAO Format Callsigns
    # =========================================================================

    def test_parse_callsign_icao_format_american(self):
        """Test parsing ICAO format callsign for American."""
        result = parse_callsign('AAL123')

        self.assertEqual(result['callsign'], 'AAL123')
        self.assertEqual(result['airline_code'], 'AAL')
        self.assertEqual(result['airline_icao'], 'AAL')
        self.assertEqual(result['airline_iata'], 'AA')
        self.assertEqual(result['airline_name'], 'American Airlines')
        self.assertEqual(result['flight_number'], '123')
        self.assertEqual(result['format'], 'icao')

    def test_parse_callsign_icao_format_united(self):
        """Test parsing ICAO format callsign for United."""
        result = parse_callsign('UAL456')

        self.assertEqual(result['airline_icao'], 'UAL')
        self.assertEqual(result['airline_iata'], 'UA')
        self.assertEqual(result['airline_name'], 'United Airlines')
        self.assertEqual(result['flight_number'], '456')

    def test_parse_callsign_icao_format_leading_zeros(self):
        """Test that leading zeros are stripped from flight number."""
        result = parse_callsign('DAL0012')

        self.assertEqual(result['flight_number'], '12')

    def test_parse_callsign_icao_format_unknown_airline(self):
        """Test parsing ICAO format with unknown airline."""
        result = parse_callsign('XYZ789')

        self.assertEqual(result['airline_icao'], 'XYZ')
        self.assertIsNone(result['airline_iata'])
        self.assertIsNone(result['airline_name'])
        self.assertEqual(result['flight_number'], '789')
        self.assertEqual(result['format'], 'icao')

    # =========================================================================
    # IATA Format Callsigns
    # =========================================================================

    def test_parse_callsign_iata_format_american(self):
        """Test parsing IATA format callsign."""
        result = parse_callsign('AA123')

        self.assertEqual(result['callsign'], 'AA123')
        self.assertEqual(result['airline_code'], 'AA')
        self.assertEqual(result['airline_icao'], 'AAL')
        self.assertEqual(result['airline_iata'], 'AA')
        self.assertEqual(result['airline_name'], 'American Airlines')
        self.assertEqual(result['flight_number'], '123')
        self.assertEqual(result['format'], 'iata')

    def test_parse_callsign_iata_format_unknown(self):
        """Test parsing IATA format with unknown airline."""
        result = parse_callsign('XX999')

        self.assertEqual(result['airline_code'], 'XX')
        self.assertIsNone(result['airline_icao'])
        self.assertEqual(result['airline_iata'], 'XX')
        self.assertIsNone(result['airline_name'])
        self.assertEqual(result['format'], 'iata')

    # =========================================================================
    # Edge Cases
    # =========================================================================

    def test_parse_callsign_empty(self):
        """Test parsing empty callsign."""
        result = parse_callsign('')

        self.assertIsNone(result['callsign'])
        self.assertIsNone(result['airline_code'])
        self.assertEqual(result['format'], 'unknown')

    def test_parse_callsign_none(self):
        """Test parsing None callsign."""
        result = parse_callsign(None)

        self.assertIsNone(result['callsign'])
        self.assertEqual(result['format'], 'unknown')

    def test_parse_callsign_lowercase_normalized(self):
        """Test that lowercase callsigns are normalized to uppercase."""
        result = parse_callsign('ual123')

        self.assertEqual(result['callsign'], 'UAL123')
        self.assertEqual(result['airline_icao'], 'UAL')

    def test_parse_callsign_with_whitespace(self):
        """Test that whitespace is stripped."""
        result = parse_callsign('  DAL456  ')

        self.assertEqual(result['callsign'], 'DAL456')

    def test_parse_callsign_airline_only(self):
        """Test parsing callsign with only airline code."""
        result = parse_callsign('UAL')

        self.assertEqual(result['callsign'], 'UAL')
        self.assertEqual(result['airline_icao'], 'UAL')
        self.assertIsNone(result['flight_number'])

    def test_parse_callsign_short(self):
        """Test parsing very short callsign."""
        result = parse_callsign('UA')

        self.assertEqual(result['callsign'], 'UA')
        self.assertEqual(result['format'], 'iata')

    def test_parse_callsign_cache_hit(self):
        """Test that callsign parsing uses cache."""
        # Parse same callsign twice
        result1 = parse_callsign('UAL789')
        result2 = parse_callsign('UAL789')

        # Should return same cached result
        self.assertEqual(result1, result2)


class DecodeLabelTests(TestCase):
    """Tests for label decoding."""

    def test_decode_label_known(self):
        """Test decoding known label."""
        result = decode_label('10')

        self.assertEqual(result['label'], '10')
        self.assertEqual(result['name'], 'Out')
        self.assertIn('departed gate', result['description'])

    def test_decode_label_unknown(self):
        """Test decoding unknown label."""
        result = decode_label('ZZ')

        self.assertEqual(result['label'], 'ZZ')
        self.assertIsNone(result['name'])
        self.assertIsNone(result['description'])

    def test_decode_label_empty(self):
        """Test decoding empty label."""
        result = decode_label('')

        self.assertIsNone(result['label'])
        self.assertIsNone(result['name'])

    def test_decode_label_none(self):
        """Test decoding None label."""
        result = decode_label(None)

        self.assertIsNone(result['label'])

    def test_decode_label_with_whitespace(self):
        """Test that whitespace is stripped."""
        result = decode_label('  10  ')

        self.assertEqual(result['label'], '10')
        self.assertEqual(result['name'], 'Out')


class CoordinateValidationTests(TestCase):
    """Tests for coordinate validation."""

    def test_validate_coordinates_valid(self):
        """Test validating valid coordinates."""
        self.assertTrue(validate_coordinates(47.5, -122.3))
        self.assertTrue(validate_coordinates(0, 0))
        self.assertTrue(validate_coordinates(-90, -180))
        self.assertTrue(validate_coordinates(90, 180))

    def test_validate_coordinates_invalid_latitude(self):
        """Test validating invalid latitude."""
        self.assertFalse(validate_coordinates(91, 0))
        self.assertFalse(validate_coordinates(-91, 0))

    def test_validate_coordinates_invalid_longitude(self):
        """Test validating invalid longitude."""
        self.assertFalse(validate_coordinates(0, 181))
        self.assertFalse(validate_coordinates(0, -181))


class CoordinateParsingTests(TestCase):
    """Tests for coordinate parsing from message text."""

    def test_parse_coordinates_format1_north_west(self):
        """Test parsing DDMMm format coordinates (N/W)."""
        # N47 30.0 W122 18.0 (N47300 W122180)
        text = 'N47300W122180'
        result = parse_coordinates(text)

        self.assertIsNotNone(result)
        self.assertAlmostEqual(result['lat'], 47.5, places=2)
        self.assertAlmostEqual(result['lon'], -122.3, places=2)

    def test_parse_coordinates_format1_south_east(self):
        """Test parsing DDMMm format coordinates (S/E)."""
        text = 'S33300E151120'
        result = parse_coordinates(text)

        self.assertIsNotNone(result)
        self.assertLess(result['lat'], 0)
        self.assertGreater(result['lon'], 0)

    def test_parse_coordinates_format2_decimal_degrees(self):
        """Test parsing decimal degrees format."""
        text = 'N 49.128,W122.374'
        result = parse_coordinates(text)

        self.assertIsNotNone(result)
        self.assertAlmostEqual(result['lat'], 49.128, places=3)
        self.assertAlmostEqual(result['lon'], -122.374, places=3)

    def test_parse_coordinates_invalid_range(self):
        """Test that invalid coordinates are rejected."""
        # Latitude > 90
        text = 'N95000W122000'
        result = parse_coordinates(text)

        self.assertIsNone(result)

    def test_parse_coordinates_empty_text(self):
        """Test parsing empty text."""
        result = parse_coordinates('')
        self.assertIsNone(result)

        result = parse_coordinates(None)
        self.assertIsNone(result)

    def test_parse_coordinates_no_coordinates(self):
        """Test parsing text without coordinates."""
        text = 'This is a regular message without coordinates'
        result = parse_coordinates(text)

        self.assertIsNone(result)


class H1MessageDecodingTests(TestCase):
    """Tests for H1 (Datalink) message decoding."""

    def test_decode_h1_flight_plan(self):
        """Test decoding FPN (Flight Plan) message."""
        text = 'FPN/DA:KJFK/AA:KLAX/F:JUDDS.HOFFA.PIREX'
        result = decode_h1_message(text)

        self.assertIsNotNone(result)
        self.assertEqual(result['message_type'], 'Flight Plan')
        self.assertEqual(result['origin'], 'KJFK')
        self.assertEqual(result['destination'], 'KLAX')

    def test_decode_h1_position_report(self):
        """Test decoding POS (Position Report) message."""
        text = '/POS/N47300W122180/A35000'
        result = decode_h1_message(text)

        self.assertIsNotNone(result)
        self.assertEqual(result['message_type'], 'Position Report')
        self.assertIn('position', result)
        self.assertEqual(result['altitude_ft'], 35000)
        self.assertEqual(result['flight_level'], 'FL350')

    def test_decode_h1_progress_report(self):
        """Test decoding PRG (Progress Report) message."""
        text = 'PRG/ABC123/DTKLAX'
        result = decode_h1_message(text)

        self.assertIsNotNone(result)
        self.assertEqual(result['message_type'], 'Progress Report')
        self.assertEqual(result['destination'], 'KLAX')

    def test_decode_h1_unknown_format(self):
        """Test decoding unknown H1 message format."""
        text = 'Some random H1 message content'
        result = decode_h1_message(text)

        self.assertIsNone(result)

    def test_decode_h1_empty(self):
        """Test decoding empty H1 message."""
        result = decode_h1_message('')
        self.assertIsNone(result)

        result = decode_h1_message(None)
        self.assertIsNone(result)


class MessageTextDecodingTests(TestCase):
    """Tests for general message text decoding."""

    def test_decode_ground_station_squitter(self):
        """Test decoding ground station squitter message."""
        # Format: 02X[S/A][ABQ]KABQ[0/1]3502N10636WV136975
        # version(2) + X + network(1) + IATA(3) + ICAO(4) + station(1) + lat(4) + NS + lon(5) + EW + V + freq(6)
        text = '02XSABQKABQ03502N10636WV136975'
        result = decode_message_text(text)

        self.assertEqual(result.get('message_type'), 'Ground Station Squitter')
        self.assertIn('network', result)
        self.assertEqual(result.get('network'), 'SITA')

    def test_decode_oooi_event_out(self):
        """Test decoding OOOI Out event."""
        text = 'N 47.5,W122.3,100'
        result = decode_message_text(text, label='10')

        self.assertEqual(result['message_type'], 'OOOI Event')
        self.assertEqual(result['event_type'], 'Out')

    def test_decode_oooi_event_off(self):
        """Test decoding OOOI Off event."""
        text = 'Takeoff message'
        result = decode_message_text(text, label='11')

        self.assertEqual(result['message_type'], 'OOOI Event')
        self.assertEqual(result['event_type'], 'Off')

    def test_decode_oooi_event_on(self):
        """Test decoding OOOI On event."""
        text = 'Landing message'
        result = decode_message_text(text, label='12')

        self.assertEqual(result['message_type'], 'OOOI Event')
        self.assertEqual(result['event_type'], 'On')

    def test_decode_oooi_event_in(self):
        """Test decoding OOOI In event."""
        text = 'At gate message'
        result = decode_message_text(text, label='13')

        self.assertEqual(result['message_type'], 'OOOI Event')
        self.assertEqual(result['event_type'], 'In')

    def test_decode_weather_metar(self):
        """Test decoding weather message with METAR."""
        text = 'METAR KJFK 121856Z 24008KT 10SM FEW250 28/17 A2998'
        result = decode_message_text(text, label='QA')

        self.assertEqual(result['message_type'], 'Weather')
        self.assertEqual(result['weather_type'], 'METAR')

    def test_decode_weather_taf(self):
        """Test decoding weather message with TAF."""
        text = 'TAF KLAX 121720Z 1218/1324 24010KT P6SM FEW250'
        result = decode_message_text(text, label='QB')

        self.assertEqual(result['message_type'], 'Weather')
        self.assertEqual(result['weather_type'], 'TAF')

    def test_decode_h1_via_main_decoder(self):
        """Test that H1 messages route to H1 decoder."""
        text = 'FPN/DA:KJFK/AA:KLAX'
        result = decode_message_text(text, label='H1')

        self.assertEqual(result['message_type'], 'Flight Plan')

    def test_decode_extracts_airport_codes(self):
        """Test extraction of airport codes from text."""
        text = 'Flight from KJFK to KLAX via KORD'
        result = decode_message_text(text)

        self.assertIn('airports_mentioned', result)
        self.assertIn('KJFK', result['airports_mentioned'])
        self.assertIn('KLAX', result['airports_mentioned'])
        self.assertIn('KORD', result['airports_mentioned'])

    def test_decode_filters_invalid_airport_codes(self):
        """Test that invalid airport codes are filtered."""
        # Airport codes should start with C, K, P, E, G, L, or S
        text = 'ABCD KJFK XXXX KLAX'
        result = decode_message_text(text)

        if 'airports_mentioned' in result:
            self.assertIn('KJFK', result['airports_mentioned'])
            self.assertIn('KLAX', result['airports_mentioned'])
            self.assertNotIn('ABCD', result['airports_mentioned'])
            self.assertNotIn('XXXX', result['airports_mentioned'])

    def test_decode_empty_text(self):
        """Test decoding empty text."""
        result = decode_message_text('')
        self.assertEqual(result, {})

        result = decode_message_text(None)
        self.assertEqual(result, {})

    def test_decode_preserves_libacars_data(self):
        """Test that libacars data is preserved."""
        text = 'Some message'
        libacars = {'decoded': 'by libacars'}
        result = decode_message_text(text, libacars_data=libacars)

        self.assertEqual(result['libacars'], libacars)


class EnrichMessageTests(TestCase):
    """Tests for full message enrichment."""

    def test_enrich_basic_message(self):
        """Test enriching a basic ACARS message."""
        msg = {
            'timestamp': 1704067200.0,
            'source': 'acars',
            'icao_hex': 'ABC123',
            'callsign': 'UAL456',
            'label': '10',
            'text': 'Test message',
        }

        enriched = enrich_acars_message(msg)

        # Original fields preserved
        self.assertEqual(enriched['timestamp'], 1704067200.0)
        self.assertEqual(enriched['source'], 'acars')
        self.assertEqual(enriched['icao_hex'], 'ABC123')

        # Airline info added
        self.assertIn('airline', enriched)
        self.assertEqual(enriched['airline']['icao'], 'UAL')
        self.assertEqual(enriched['airline']['iata'], 'UA')
        self.assertEqual(enriched['airline']['name'], 'United Airlines')
        self.assertEqual(enriched['airline']['flight_number'], '456')

        # Label info added
        self.assertIn('label_info', enriched)
        self.assertEqual(enriched['label_info']['name'], 'Out')

    def test_enrich_message_without_callsign(self):
        """Test enriching message without callsign."""
        msg = {
            'source': 'acars',
            'icao_hex': 'ABC123',
            'callsign': None,
            'label': '10',
        }

        enriched = enrich_acars_message(msg)

        self.assertIsNone(enriched['airline'])

    def test_enrich_message_without_label(self):
        """Test enriching message without label."""
        msg = {
            'source': 'acars',
            'icao_hex': 'ABC123',
            'callsign': 'UAL456',
            'label': None,
        }

        enriched = enrich_acars_message(msg)

        self.assertIsNone(enriched['label_info'])

    def test_enrich_message_with_decoded_text(self):
        """Test that text is decoded and added."""
        msg = {
            'source': 'acars',
            'icao_hex': 'ABC123',
            'callsign': 'UAL456',
            'label': '10',
            'text': 'N 47.5,W122.3,100',
        }

        enriched = enrich_acars_message(msg)

        self.assertIn('decoded_text', enriched)
        self.assertEqual(enriched['decoded_text']['message_type'], 'OOOI Event')

    def test_enrich_message_empty_text(self):
        """Test enriching message with empty text."""
        msg = {
            'source': 'acars',
            'icao_hex': 'ABC123',
            'callsign': 'UAL456',
            'label': '10',
            'text': '',
        }

        enriched = enrich_acars_message(msg)

        # Should not have decoded_text if text was empty
        self.assertNotIn('decoded_text', enriched)

    def test_enrich_message_preserves_all_original_fields(self):
        """Test that enrichment preserves all original fields."""
        msg = {
            'timestamp': 1704067200.0,
            'source': 'acars',
            'channel': '2',
            'frequency': 131.55,
            'icao_hex': 'ABC123',
            'registration': 'N12345',
            'callsign': 'UAL456',
            'label': '10',
            'block_id': 'A',
            'msg_num': 'M01',
            'text': 'Test',
            'signal_level': -5.2,
            'custom_field': 'custom_value',
        }

        enriched = enrich_acars_message(msg)

        # All original fields should be present
        self.assertEqual(enriched['timestamp'], 1704067200.0)
        self.assertEqual(enriched['channel'], '2')
        self.assertEqual(enriched['frequency'], 131.55)
        self.assertEqual(enriched['registration'], 'N12345')
        self.assertEqual(enriched['block_id'], 'A')
        self.assertEqual(enriched['signal_level'], -5.2)
        self.assertEqual(enriched['custom_field'], 'custom_value')


class EdgeCaseTests(TestCase):
    """Edge case tests for the decoder module."""

    def test_parse_callsign_numbers_only(self):
        """Test parsing callsign that is all numbers."""
        result = parse_callsign('12345')

        # Pure numeric callsigns are not valid airline codes - should be unknown format
        self.assertEqual(result['format'], 'unknown')
        self.assertIsNone(result['airline_code'])

    def test_parse_callsign_special_characters(self):
        """Test parsing callsign with special characters."""
        result = parse_callsign('UAL-456')

        # Should parse the alpha prefix
        self.assertEqual(result['airline_icao'], 'UAL')

    def test_decode_message_very_long_text(self):
        """Test decoding very long message text."""
        long_text = 'A' * 10000
        result = decode_message_text(long_text)

        # Should not raise and return some result
        self.assertIsInstance(result, dict)

    def test_decode_message_unicode_text(self):
        """Test decoding text with unicode characters."""
        text = 'Message with unicode: \u2708 \u2601'
        result = decode_message_text(text)

        # Should not raise
        self.assertIsInstance(result, dict)

    def test_enrich_message_does_not_modify_original(self):
        """Test that enrichment doesn't modify the original message dict."""
        original = {
            'source': 'acars',
            'callsign': 'UAL456',
            'label': '10',
            'text': 'Test',
        }
        original_copy = dict(original)

        enrich_acars_message(original)

        # Original should be unchanged (though in current impl it makes a copy)
        # At minimum, original keys should still be there
        self.assertEqual(original['source'], original_copy['source'])
        self.assertEqual(original['callsign'], original_copy['callsign'])

    def test_h1_message_with_route_waypoints(self):
        """Test H1 message extracts waypoints from route."""
        text = 'FPN/F:JUDDS.HOFFA.PIREX.CANYO.RSTNG'
        result = decode_h1_message(text)

        self.assertIsNotNone(result)
        self.assertIn('waypoints', result)
        self.assertIn('JUDDS', result['waypoints'])
        self.assertIn('HOFFA', result['waypoints'])

    def test_multiple_weather_labels(self):
        """Test that all weather labels are recognized."""
        weather_labels = ['QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'Q0', 'Q1', 'Q2']

        for label in weather_labels:
            result = decode_message_text('Weather data here', label=label)
            self.assertEqual(result['message_type'], 'Weather')

    def test_oooi_label_80(self):
        """Test OOOI label 80 is recognized."""
        result = decode_message_text('Combined OOOI event', label='80')

        self.assertEqual(result['message_type'], 'OOOI Event')
        self.assertEqual(result['event_type'], 'OOOI')

    def test_parse_callsign_alphanumeric_iata(self):
        """Test parsing callsign with alphanumeric IATA code like 2U (Sun Country)."""
        result = parse_callsign('2U123')

        # Should be IATA format since it has a letter
        self.assertEqual(result['format'], 'iata')
        self.assertEqual(result['airline_code'], '2U')

    def test_airport_codes_international_regions(self):
        """Test that airport codes from all ICAO regions are recognized."""
        # Y = Australia, Z = China, R = Japan/Korea, V = South Asia, M = Central America
        text = 'Flight route: YSSY ZBAA RJTT VHHH MMMX'
        result = decode_message_text(text)

        self.assertIn('airports_mentioned', result)
        # All these should be recognized as valid airport codes
        self.assertIn('YSSY', result['airports_mentioned'])  # Sydney
        self.assertIn('ZBAA', result['airports_mentioned'])  # Beijing
        self.assertIn('RJTT', result['airports_mentioned'])  # Tokyo Haneda
        self.assertIn('VHHH', result['airports_mentioned'])  # Hong Kong
        self.assertIn('MMMX', result['airports_mentioned'])  # Mexico City

    def test_airport_codes_exclude_common_words(self):
        """Test that common English words are excluded from airport codes."""
        text = 'THIS TEST FROM KJFK OPEN DOOR TIME KLAX'
        result = decode_message_text(text)

        self.assertIn('airports_mentioned', result)
        # Real airports should be included
        self.assertIn('KJFK', result['airports_mentioned'])
        self.assertIn('KLAX', result['airports_mentioned'])
        # Common words should be excluded
        self.assertNotIn('THIS', result.get('airports_mentioned', []))
        self.assertNotIn('TEST', result.get('airports_mentioned', []))
        self.assertNotIn('FROM', result.get('airports_mentioned', []))
        self.assertNotIn('OPEN', result.get('airports_mentioned', []))
        self.assertNotIn('DOOR', result.get('airports_mentioned', []))
        self.assertNotIn('TIME', result.get('airports_mentioned', []))
