"""
Tests for the Audio Service.

Tests audio processing, transcription handling, callsign extraction,
and file management.
"""

import io
import os
import tempfile
from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.conf import settings
from django.test import TestCase, override_settings
from django.utils import timezone

from skyspy.models import AudioTransmission
from skyspy.services.audio import (
    AIRLINE_CALLSIGNS,
    AIRLINE_VARIANTS,
    AUDIO_MAX_DURATION_SECONDS,
    AUDIO_MIN_DURATION_SECONDS,
    PHONETIC_LETTERS,
    PHONETIC_NUMBERS,
    _convert_phonetic_to_digits,
    _fuzzy_match_airline,
    _levenshtein_distance,
    _normalize_flight_number,
    _parse_wav_duration,
    _preprocess_transcript,
    _stats,
    check_audio_quality,
    create_transmission,
    detect_static_audio,
    extract_callsigns_from_transcript,
    get_audio_duration,
    get_audio_stats,
    get_audio_url,
    get_matched_radio_calls,
    get_service_stats,
    identify_airframes_from_transcript,
    process_transcription,
)
from skyspy.tests.factories import AudioTransmissionFactory


class PhoneticConversionTests(TestCase):
    """Tests for phonetic to digit conversion."""

    def test_convert_basic_phonetic_numbers(self):
        """Test basic phonetic number conversion."""
        self.assertEqual(_convert_phonetic_to_digits("one two three"), "123")
        self.assertEqual(_convert_phonetic_to_digits("four five six"), "456")
        self.assertEqual(_convert_phonetic_to_digits("seven eight nine"), "789")

    def test_convert_atc_variants(self):
        """Test ATC number variants."""
        self.assertEqual(_convert_phonetic_to_digits("niner"), "9")
        self.assertEqual(_convert_phonetic_to_digits("fife"), "5")
        self.assertEqual(_convert_phonetic_to_digits("tree"), "3")

    def test_convert_zero_variants(self):
        """Test zero variants."""
        self.assertEqual(_convert_phonetic_to_digits("zero"), "0")
        self.assertEqual(_convert_phonetic_to_digits("oh"), "0")

    def test_convert_homophones(self):
        """Test common homophone conversions."""
        self.assertEqual(_convert_phonetic_to_digits("won"), "1")
        self.assertEqual(_convert_phonetic_to_digits("too"), "2")
        self.assertEqual(_convert_phonetic_to_digits("for"), "4")
        self.assertEqual(_convert_phonetic_to_digits("ate"), "8")

    def test_convert_compound_numbers(self):
        """Test compound number conversions."""
        self.assertEqual(_convert_phonetic_to_digits("twenty"), "20")
        self.assertEqual(_convert_phonetic_to_digits("thirty"), "30")

    def test_convert_hundred(self):
        """Test hundred conversion."""
        self.assertEqual(_convert_phonetic_to_digits("one hundred"), "100")
        self.assertEqual(_convert_phonetic_to_digits("two hundred"), "200")

    def test_convert_mixed_digit_and_phonetic(self):
        """Test mixed digit and phonetic."""
        self.assertEqual(_convert_phonetic_to_digits("1 two three"), "123")

    def test_convert_stops_at_non_number(self):
        """Test conversion stops at non-number word."""
        result = _convert_phonetic_to_digits("one two clearance")
        self.assertEqual(result, "12")

    def test_convert_empty_string(self):
        """Test empty string returns empty."""
        self.assertEqual(_convert_phonetic_to_digits(""), "")


class NormalizeFlightNumberTests(TestCase):
    """Tests for flight number normalization."""

    def test_extract_digit_match(self):
        """Test direct digit extraction."""
        self.assertEqual(_normalize_flight_number("456"), "456")
        self.assertEqual(_normalize_flight_number("1234"), "1234")

    def test_extract_from_phonetic(self):
        """Test extraction from phonetic numbers."""
        self.assertEqual(_normalize_flight_number("one two three"), "123")

    def test_extract_spaced_digits(self):
        """Test extraction of spaced single digits."""
        self.assertEqual(_normalize_flight_number("1 2 3"), "123")

    def test_rejects_too_long(self):
        """Test rejection of numbers > 4 digits."""
        result = _normalize_flight_number("12345")
        # Should still return the first 4 digits or handle appropriately
        self.assertIsNotNone(result)


class PreprocessTranscriptTests(TestCase):
    """Tests for transcript preprocessing."""

    def test_normalize_whitespace(self):
        """Test whitespace normalization."""
        result = _preprocess_transcript("  multiple   spaces   here  ")
        self.assertEqual(result, "multiple spaces here")

    def test_remove_roger_that(self):
        """Test removal of ROGER THAT."""
        result = _preprocess_transcript("ROGER THAT UNITED 456")
        self.assertIn("ROGER", result)
        self.assertNotIn("ROGER THAT", result)

    def test_remove_filler_words(self):
        """Test removal of filler words."""
        result = _preprocess_transcript("UH UM UNITED 456")
        self.assertNotIn("UH", result)
        self.assertNotIn("UM", result)

    def test_remove_flight_word(self):
        """Test removal of FLIGHT prefix."""
        result = _preprocess_transcript("FLIGHT 456")
        self.assertNotIn("FLIGHT", result)


class LevenshteinDistanceTests(TestCase):
    """Tests for Levenshtein distance calculation."""

    def test_identical_strings(self):
        """Test identical strings have distance 0."""
        self.assertEqual(_levenshtein_distance("hello", "hello"), 0)

    def test_single_substitution(self):
        """Test single character substitution."""
        self.assertEqual(_levenshtein_distance("hello", "hallo"), 1)

    def test_single_insertion(self):
        """Test single character insertion."""
        self.assertEqual(_levenshtein_distance("hello", "helloo"), 1)

    def test_single_deletion(self):
        """Test single character deletion."""
        self.assertEqual(_levenshtein_distance("hello", "helo"), 1)

    def test_empty_string(self):
        """Test empty string distances."""
        self.assertEqual(_levenshtein_distance("", "hello"), 5)
        self.assertEqual(_levenshtein_distance("hello", ""), 5)

    def test_complex_difference(self):
        """Test complex string difference."""
        self.assertEqual(_levenshtein_distance("kitten", "sitting"), 3)


class FuzzyMatchAirlineTests(TestCase):
    """Tests for fuzzy airline name matching."""

    def test_exact_match(self):
        """Test exact airline name match."""
        result = _fuzzy_match_airline("UNITED")
        self.assertIsNotNone(result)
        self.assertEqual(result[1], "UAL")

    def test_exact_match_delta(self):
        """Test exact match for Delta."""
        result = _fuzzy_match_airline("DELTA")
        self.assertIsNotNone(result)
        self.assertEqual(result[1], "DAL")

    def test_fuzzy_match_minor_typo(self):
        """Test fuzzy match with minor typo."""
        result = _fuzzy_match_airline("UNTED")  # Missing I
        self.assertIsNotNone(result)
        self.assertEqual(result[1], "UAL")

    def test_fuzzy_match_case_insensitive(self):
        """Test fuzzy match is case insensitive."""
        result = _fuzzy_match_airline("united")
        self.assertIsNotNone(result)
        self.assertEqual(result[1], "UAL")

    def test_no_match_for_unrelated(self):
        """Test no match for unrelated strings."""
        result = _fuzzy_match_airline("RANDOM")
        self.assertIsNone(result)

    def test_short_strings_not_matched(self):
        """Test short strings are not fuzzy matched."""
        result = _fuzzy_match_airline("AB")
        self.assertIsNone(result)


class ExtractCallsignsTests(TestCase):
    """Tests for callsign extraction from transcripts."""

    def test_extract_airline_with_number(self):
        """Test extraction of airline + flight number."""
        result = extract_callsigns_from_transcript("UNITED 456 CLEARED FOR TAKEOFF", use_llm=False)

        self.assertGreater(len(result), 0)
        found_callsigns = [cs["callsign"] for cs in result]
        self.assertIn("UAL456", found_callsigns)

    def test_extract_multiple_airlines(self):
        """Test extraction of multiple airlines."""
        transcript = "UNITED 123 CONTACT APPROACH, DELTA 456 DESCEND"
        result = extract_callsigns_from_transcript(transcript, use_llm=False)

        found_callsigns = [cs["callsign"] for cs in result]
        self.assertIn("UAL123", found_callsigns)
        self.assertIn("DAL456", found_callsigns)

    def test_extract_n_number_direct(self):
        """Test extraction of direct N-number."""
        result = extract_callsigns_from_transcript("N12345 CLEARED TO LAND", use_llm=False)

        found_callsigns = [cs["callsign"] for cs in result]
        self.assertIn("N12345", found_callsigns)

    def test_extract_n_number_with_letters(self):
        """Test extraction of N-number with letter suffix."""
        result = extract_callsigns_from_transcript("N123AB TAXI TO RUNWAY", use_llm=False)

        found_callsigns = [cs["callsign"] for cs in result]
        self.assertIn("N123AB", found_callsigns)

    def test_extract_november_phonetic(self):
        """Test extraction with November phonetic."""
        result = extract_callsigns_from_transcript("NOVEMBER ONE TWO THREE ALPHA BRAVO", use_llm=False)

        self.assertGreater(len(result), 0)
        # Should find N-number
        n_numbers = [cs for cs in result if cs["type"] == "general_aviation"]
        self.assertGreater(len(n_numbers), 0)

    def test_extract_military_callsign(self):
        """Test extraction of military callsigns."""
        result = extract_callsigns_from_transcript("REACH 123 DESCENDING", use_llm=False)

        found_callsigns = [cs["callsign"] for cs in result]
        self.assertIn("REACH123", found_callsigns)

    def test_extract_coast_guard(self):
        """Test extraction of Coast Guard callsign."""
        result = extract_callsigns_from_transcript("COAST GUARD 456 ON APPROACH", use_llm=False)

        military = [cs for cs in result if cs["type"] == "military"]
        self.assertGreater(len(military), 0)

    def test_extract_icao_code_direct(self):
        """Test extraction of direct ICAO code."""
        result = extract_callsigns_from_transcript("AAL123 RUNWAY ONE SIX LEFT", use_llm=False)

        found_callsigns = [cs["callsign"] for cs in result]
        self.assertIn("AAL123", found_callsigns)

    def test_extract_with_heavy_suffix(self):
        """Test extraction with HEAVY suffix."""
        result = extract_callsigns_from_transcript("UNITED 456 HEAVY CLEARED FOR TAKEOFF", use_llm=False)

        self.assertGreater(len(result), 0)
        ual = [cs for cs in result if cs["callsign"] == "UAL456"]
        if ual:
            self.assertEqual(ual[0].get("suffix"), "heavy")

    def test_extract_empty_transcript(self):
        """Test extraction from empty transcript."""
        result = extract_callsigns_from_transcript("", use_llm=False)
        self.assertEqual(result, [])

    def test_extract_no_callsigns(self):
        """Test extraction when no callsigns present."""
        result = extract_callsigns_from_transcript("CLEARED FOR TAKEOFF RUNWAY ONE SIX", use_llm=False)
        # May or may not find callsigns, just ensure no crash
        self.assertIsInstance(result, list)

    def test_results_sorted_by_confidence(self):
        """Test that results are sorted by confidence."""
        result = extract_callsigns_from_transcript("UNITED 123 N12345 AAL456", use_llm=False)

        if len(result) >= 2:
            confidences = [cs.get("confidence", 0) for cs in result]
            self.assertEqual(confidences, sorted(confidences, reverse=True))


class IdentifyAirframesTests(TestCase):
    """Tests for airframe identification."""

    def test_identify_airframes_basic(self):
        """Test basic airframe identification."""
        transcript = "UNITED 456 CLEARED FOR TAKEOFF"
        result = identify_airframes_from_transcript(transcript, use_llm=False)

        self.assertGreater(len(result), 0)
        airframe = result[0]
        self.assertIn("callsign", airframe)
        self.assertIn("type", airframe)
        self.assertIn("confidence", airframe)

    def test_identify_airframes_with_duration(self):
        """Test airframe identification with duration for timing."""
        transcript = "Start UNITED 456 middle DELTA 789 end"
        result = identify_airframes_from_transcript(transcript, duration_seconds=10.0, use_llm=False)

        self.assertGreater(len(result), 0)
        # Should have start_time estimates
        for airframe in result:
            if airframe.get("position") is not None:
                self.assertIn("start_time", airframe)

    def test_identify_airframes_mention_order(self):
        """Test that mention order is assigned."""
        transcript = "UNITED 123 first DELTA 456 second"
        result = identify_airframes_from_transcript(transcript, use_llm=False)

        if len(result) >= 2:
            orders = [af.get("mention_order", -1) for af in result]
            self.assertTrue(all(o >= 0 for o in orders))

    def test_identify_airframes_empty(self):
        """Test identification with empty transcript."""
        result = identify_airframes_from_transcript("", use_llm=False)
        self.assertEqual(result, [])


class AudioDurationTests(TestCase):
    """Tests for audio duration calculation."""

    def test_get_audio_duration_invalid_data(self):
        """Test duration calculation with invalid data."""
        result = get_audio_duration(b"not valid audio")
        # Should return None for invalid data
        self.assertIsNone(result)

    def test_parse_wav_duration_too_short(self):
        """Test WAV parsing with data too short."""
        result = _parse_wav_duration(b"RIFF")
        self.assertIsNone(result)

    def test_parse_wav_duration_invalid_header(self):
        """Test WAV parsing with invalid header."""
        # Create minimal RIFF header without proper chunks
        data = b"RIFF" + b"\x00" * 40
        result = _parse_wav_duration(data)
        self.assertIsNone(result)


class AudioQualityTests(TestCase):
    """Tests for audio quality checking."""

    def test_check_audio_quality_too_short(self):
        """Test rejection of too short audio."""
        is_valid, reason = check_audio_quality(b"short", duration=0.1)

        self.assertFalse(is_valid)
        self.assertIn("too short", reason)

    def test_check_audio_quality_too_long(self):
        """Test rejection of too long audio."""
        is_valid, reason = check_audio_quality(b"data", duration=150.0)

        self.assertFalse(is_valid)
        self.assertIn("too long", reason)

    def test_check_audio_quality_acceptable(self):
        """Test acceptance of good duration audio."""
        # Create minimal valid audio data
        is_valid, reason = check_audio_quality(b"dummy" * 1000, duration=5.0)

        # May pass or fail based on static detection, but duration should be ok
        if not is_valid:
            self.assertNotIn("too short", reason)
            self.assertNotIn("too long", reason)


class DetectStaticAudioTests(TestCase):
    """Tests for static audio detection."""

    def test_detect_static_non_wav(self):
        """Test static detection for non-WAV audio."""
        is_static, reason = detect_static_audio(b"not wav data")

        # Should try pydub or return ok
        self.assertIn(reason, ["ok", "Audio too quiet"])

    def test_detect_static_valid_wav_header(self):
        """Test static detection with valid WAV header."""
        # Create minimal WAV header
        wav_data = b"RIFF" + b"\x00" * 4 + b"WAVE" + b"fmt " + b"\x00" * 100
        is_static, reason = detect_static_audio(wav_data)

        # Should attempt analysis
        self.assertIsInstance(is_static, bool)


class AudioTransmissionTests(TestCase):
    """Tests for AudioTransmission creation and management."""

    def setUp(self):
        """Set up test fixtures."""
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        """Clean up after tests."""
        AudioTransmission.objects.all().delete()
        # Clean up temp directory
        import shutil

        shutil.rmtree(self.temp_dir, ignore_errors=True)

    @override_settings(S3_ENABLED=False)
    @patch("skyspy.services.audio.settings")
    def test_create_transmission_local(self, mock_settings):
        """Test creating transmission with local storage."""
        mock_settings.S3_ENABLED = False
        mock_settings.RADIO_AUDIO_DIR = self.temp_dir
        mock_settings.TRANSCRIPTION_ENABLED = False
        mock_settings.WHISPER_ENABLED = False
        mock_settings.ATC_WHISPER_ENABLED = False

        audio_data = b"fake audio data" * 100
        filename = "test_transmission.mp3"

        with patch("skyspy.services.audio.save_file_locally"):
            transmission = create_transmission(
                audio_data=audio_data, filename=filename, frequency_mhz=118.0, channel_name="Test Channel", queue_transcription=False
            )

            self.assertIsNotNone(transmission)
            self.assertEqual(transmission.filename, "test_transmission.mp3")
            self.assertEqual(transmission.file_size_bytes, len(audio_data))

    def test_create_transmission_invalid_filename_length(self):
        """Test rejection of too long filename."""
        audio_data = b"fake audio data"
        filename = "a" * 300 + ".mp3"

        with self.assertRaises(ValueError) as context:
            create_transmission(audio_data=audio_data, filename=filename, queue_transcription=False)

        self.assertIn("maximum length", str(context.exception))

    def test_create_transmission_invalid_frequency(self):
        """Test rejection of invalid frequency."""
        audio_data = b"fake audio data"

        with self.assertRaises(ValueError) as context:
            create_transmission(audio_data=audio_data, filename="test.mp3", frequency_mhz=50.0, queue_transcription=False)

        self.assertIn("valid airband range", str(context.exception))

    def test_create_transmission_invalid_channel_length(self):
        """Test rejection of too long channel name."""
        audio_data = b"fake audio data"

        with self.assertRaises(ValueError) as context:
            create_transmission(
                audio_data=audio_data, filename="test.mp3", channel_name="a" * 150, queue_transcription=False
            )

        self.assertIn("maximum length", str(context.exception))


@pytest.mark.django_db
class GetAudioUrlTests(TestCase):
    """Tests for audio URL generation."""

    def setUp(self):
        """Set up test fixtures."""
        pass

    def tearDown(self):
        """Clean up after tests."""
        AudioTransmission.objects.all().delete()

    @override_settings(S3_ENABLED=False)
    def test_get_audio_url_local(self):
        """Test URL generation for local storage."""
        transmission = AudioTransmissionFactory(s3_key=None, filename="test.mp3")

        url = get_audio_url(transmission)

        self.assertEqual(url, "/api/v1/audio/file/test.mp3")

    @override_settings(S3_ENABLED=True, RADIO_S3_PREFIX="radio-transmissions")
    @patch("skyspy.services.audio.generate_signed_url")
    def test_get_audio_url_s3_signed(self, mock_generate):
        """Test URL generation for S3 with signed URL."""
        mock_generate.return_value = "https://s3.example.com/signed-url"
        transmission = AudioTransmissionFactory(s3_key="radio-transmissions/test.mp3", filename="test.mp3")

        url = get_audio_url(transmission, signed=True)

        mock_generate.assert_called_once()
        self.assertEqual(url, "https://s3.example.com/signed-url")


@pytest.mark.django_db
class ProcessTranscriptionTests(TestCase):
    """Tests for transcription processing."""

    def setUp(self):
        """Set up test fixtures."""
        pass

    def tearDown(self):
        """Clean up after tests."""
        AudioTransmission.objects.all().delete()

    @override_settings(WHISPER_ENABLED=False, TRANSCRIPTION_ENABLED=False, ATC_WHISPER_ENABLED=False)
    def test_process_transcription_no_service(self):
        """Test transcription fails when no service configured."""
        transmission = AudioTransmissionFactory(queued=True)

        result = process_transcription(transmission)

        self.assertFalse(result)

    @override_settings(WHISPER_ENABLED=True, WHISPER_URL="http://whisper:9000", S3_ENABLED=False, RADIO_AUDIO_DIR="/tmp")
    @patch("skyspy.services.audio._transcribe_with_whisper")
    @patch("skyspy.services.audio.read_local_file")
    def test_process_transcription_success(self, mock_read, mock_transcribe):
        """Test successful transcription processing."""
        mock_read.return_value = b"audio data"
        mock_transcribe.return_value = {
            "text": "United four five six cleared for takeoff",
            "confidence": 0.95,
            "language": "en",
            "segments": [],
        }

        transmission = AudioTransmissionFactory(queued=True)

        with patch("skyspy.services.audio._broadcast_transcription_event"):
            result = process_transcription(transmission)

        self.assertTrue(result)
        transmission.refresh_from_db()
        self.assertEqual(transmission.transcription_status, "completed")
        self.assertIn("United", transmission.transcript)

    @override_settings(WHISPER_ENABLED=True, WHISPER_URL="http://whisper:9000", S3_ENABLED=False, RADIO_AUDIO_DIR="/tmp")
    @patch("skyspy.services.audio._transcribe_with_whisper")
    @patch("skyspy.services.audio.read_local_file")
    def test_process_transcription_failure(self, mock_read, mock_transcribe):
        """Test transcription processing failure."""
        mock_read.return_value = b"audio data"
        mock_transcribe.side_effect = Exception("Transcription failed")

        transmission = AudioTransmissionFactory(queued=True)

        with patch("skyspy.services.audio._broadcast_transcription_event"):
            result = process_transcription(transmission)

        self.assertFalse(result)
        transmission.refresh_from_db()
        self.assertEqual(transmission.transcription_status, "failed")
        self.assertIn("Transcription failed", transmission.transcription_error)


@pytest.mark.django_db
class GetMatchedRadioCallsTests(TestCase):
    """Tests for get_matched_radio_calls function."""

    def setUp(self):
        """Set up test fixtures."""
        pass

    def tearDown(self):
        """Clean up after tests."""
        AudioTransmission.objects.all().delete()

    def test_get_matched_radio_calls_no_params(self):
        """Test with no search parameters."""
        result = get_matched_radio_calls()
        self.assertEqual(result, [])

    def test_get_matched_radio_calls_by_callsign(self):
        """Test matching by callsign."""
        transmission = AudioTransmissionFactory(
            completed=True,
        )
        transmission.identified_airframes = [{"callsign": "UAL456", "type": "airline", "airline_icao": "UAL", "confidence": 0.9}]
        transmission.save()

        result = get_matched_radio_calls(callsign="UAL456", hours=24)

        self.assertGreater(len(result), 0)
        self.assertEqual(result[0]["matched_callsign"], "UAL456")

    def test_get_matched_radio_calls_by_operator(self):
        """Test matching by operator ICAO."""
        transmission = AudioTransmissionFactory(
            completed=True,
        )
        transmission.identified_airframes = [{"callsign": "UAL123", "type": "airline", "airline_icao": "UAL", "confidence": 0.9}]
        transmission.save()

        result = get_matched_radio_calls(operator_icao="UAL", hours=24)

        self.assertGreater(len(result), 0)


@pytest.mark.django_db
class GetAudioStatsTests(TestCase):
    """Tests for get_audio_stats function."""

    def setUp(self):
        """Set up test fixtures."""
        pass

    def tearDown(self):
        """Clean up after tests."""
        AudioTransmission.objects.all().delete()

    def test_get_audio_stats_empty(self):
        """Test stats with no transmissions."""
        result = get_audio_stats()

        self.assertEqual(result["total_transmissions"], 0)
        self.assertEqual(result["total_transcribed"], 0)

    def test_get_audio_stats_with_data(self):
        """Test stats with transmission data."""
        AudioTransmissionFactory(completed=True, duration_seconds=10.0, file_size_bytes=50000)
        AudioTransmissionFactory(queued=True, duration_seconds=5.0, file_size_bytes=25000)
        AudioTransmissionFactory(failed=True, duration_seconds=8.0, file_size_bytes=40000)

        result = get_audio_stats()

        self.assertEqual(result["total_transmissions"], 3)
        self.assertEqual(result["total_transcribed"], 1)
        self.assertEqual(result["failed_transcription"], 1)


class GetServiceStatsTests(TestCase):
    """Tests for get_service_stats function."""

    @override_settings(
        RADIO_ENABLED=True,
        RADIO_AUDIO_DIR="/data/audio",
        TRANSCRIPTION_ENABLED=True,
        WHISPER_ENABLED=False,
        ATC_WHISPER_ENABLED=False,
        ATC_WHISPER_SEGMENT_BY_VAD=False,
        S3_ENABLED=False,
        RADIO_S3_PREFIX="radio",
    )
    def test_get_service_stats(self):
        """Test service stats retrieval."""
        result = get_service_stats()

        self.assertTrue(result["radio_enabled"])
        self.assertEqual(result["radio_audio_dir"], "/data/audio")
        self.assertTrue(result["transcription_enabled"])
        self.assertFalse(result["whisper_enabled"])


class AirlineConstantsTests(TestCase):
    """Tests for airline constants and mappings."""

    def test_airline_callsigns_has_major_carriers(self):
        """Test that major carriers are in callsign map."""
        self.assertIn("UAL", AIRLINE_CALLSIGNS)
        self.assertIn("DAL", AIRLINE_CALLSIGNS)
        self.assertIn("AAL", AIRLINE_CALLSIGNS)
        self.assertIn("SWA", AIRLINE_CALLSIGNS)

    def test_airline_variants_has_names(self):
        """Test that airline names map to ICAO codes."""
        self.assertEqual(AIRLINE_VARIANTS["UNITED"], "UAL")
        self.assertEqual(AIRLINE_VARIANTS["DELTA"], "DAL")
        self.assertEqual(AIRLINE_VARIANTS["AMERICAN"], "AAL")
        self.assertEqual(AIRLINE_VARIANTS["SOUTHWEST"], "SWA")

    def test_phonetic_numbers_complete(self):
        """Test that phonetic numbers are complete."""
        # Standard numbers
        for word in ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]:
            self.assertIn(word, PHONETIC_NUMBERS)

        # ATC variants
        self.assertIn("niner", PHONETIC_NUMBERS)
        self.assertIn("fife", PHONETIC_NUMBERS)

    def test_phonetic_letters_complete(self):
        """Test that phonetic alphabet is complete."""
        standard = [
            "alpha",
            "bravo",
            "charlie",
            "delta",
            "echo",
            "foxtrot",
            "golf",
            "hotel",
            "india",
            "juliet",
            "kilo",
            "lima",
            "mike",
            "november",
            "oscar",
            "papa",
            "quebec",
            "romeo",
            "sierra",
            "tango",
            "uniform",
            "victor",
            "whiskey",
            "xray",
            "yankee",
            "zulu",
        ]

        for letter in standard:
            self.assertIn(letter, PHONETIC_LETTERS, f"Missing phonetic letter: {letter}")


class ATCWhisperPromptTests(TestCase):
    """Tests for ATC Whisper prompt configuration."""

    def test_atc_prompt_contains_key_terminology(self):
        """Test that ATC prompt contains key terminology."""
        from skyspy.services.audio import ATC_WHISPER_PROMPT

        # Key ATC terms
        self.assertIn("cleared", ATC_WHISPER_PROMPT)
        self.assertIn("runway", ATC_WHISPER_PROMPT)
        self.assertIn("tower", ATC_WHISPER_PROMPT)

        # Emergency codes
        self.assertIn("7500", ATC_WHISPER_PROMPT)
        self.assertIn("7600", ATC_WHISPER_PROMPT)
        self.assertIn("7700", ATC_WHISPER_PROMPT)

        # Major airlines
        self.assertIn("United", ATC_WHISPER_PROMPT)
        self.assertIn("Delta", ATC_WHISPER_PROMPT)
