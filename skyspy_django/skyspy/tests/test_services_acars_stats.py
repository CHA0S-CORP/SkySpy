"""
Tests for the AcarsStats service.

Tests ACARS message statistics, aggregations,
airline activity, and trend analysis.
"""

from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from skyspy.models import AcarsMessage
from skyspy.services import acars_stats


class MessageCategoryTests(TestCase):
    """Tests for message category/label handling."""

    def test_get_label_category_oooi(self):
        """Test OOOI label category detection."""
        self.assertEqual(acars_stats.get_label_category("10"), "oooi")
        self.assertEqual(acars_stats.get_label_category("11"), "oooi")
        self.assertEqual(acars_stats.get_label_category("12"), "oooi")
        self.assertEqual(acars_stats.get_label_category("13"), "oooi")
        self.assertEqual(acars_stats.get_label_category("80"), "oooi")

    def test_get_label_category_position(self):
        """Test position report label category detection."""
        self.assertEqual(acars_stats.get_label_category("H1"), "position")
        self.assertEqual(acars_stats.get_label_category("H2"), "position")
        self.assertEqual(acars_stats.get_label_category("2P"), "position")
        self.assertEqual(acars_stats.get_label_category("22"), "position")

    def test_get_label_category_weather(self):
        """Test weather label category detection."""
        self.assertEqual(acars_stats.get_label_category("QA"), "weather")
        self.assertEqual(acars_stats.get_label_category("QB"), "weather")
        self.assertEqual(acars_stats.get_label_category("44"), "weather")
        self.assertEqual(acars_stats.get_label_category("21"), "weather")

    def test_get_label_category_operational(self):
        """Test operational label category detection."""
        self.assertEqual(acars_stats.get_label_category("15"), "operational")
        self.assertEqual(acars_stats.get_label_category("16"), "operational")
        self.assertEqual(acars_stats.get_label_category("17"), "operational")

    def test_get_label_category_system(self):
        """Test system/technical label category detection."""
        self.assertEqual(acars_stats.get_label_category("SA"), "system")
        self.assertEqual(acars_stats.get_label_category("SQ"), "system")
        self.assertEqual(acars_stats.get_label_category("5Z"), "system")

    def test_get_label_category_general(self):
        """Test general/free text label category detection."""
        self.assertEqual(acars_stats.get_label_category("B9"), "general")
        self.assertEqual(acars_stats.get_label_category("_d"), "general")

    def test_get_label_category_unknown(self):
        """Test unknown label category detection."""
        self.assertEqual(acars_stats.get_label_category("XX"), "other")
        self.assertEqual(acars_stats.get_label_category("ZZ"), "other")

    def test_get_label_category_none(self):
        """Test None label returns unknown."""
        self.assertEqual(acars_stats.get_label_category(None), "unknown")

    def test_get_label_category_empty(self):
        """Test empty label returns unknown."""
        self.assertEqual(acars_stats.get_label_category(""), "unknown")


class AcarsMessageStatsTests(TestCase):
    """Tests for ACARS message statistics calculation."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AcarsMessage.objects.all().delete()

    def test_calculate_acars_message_stats_empty(self):
        """Test message stats with no data."""
        result = acars_stats.calculate_acars_message_stats(hours=24)

        self.assertEqual(result["total_messages"], 0)
        self.assertEqual(result["by_source"], {})
        self.assertEqual(result["by_label"], [])
        self.assertEqual(result["time_range_hours"], 24)

    def test_calculate_acars_message_stats_with_data(self):
        """Test message stats with ACARS messages."""
        # Create ACARS messages
        for i in range(10):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"ABC{i:03d}",
                label="10",
                text="Test message",
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=self.now - timedelta(hours=i)
            )

        # Create VDL2 messages
        for i in range(5):
            msg = AcarsMessage.objects.create(
                source="vdlm2",
                icao_hex=f"DEF{i:03d}",
                label="H1",
                text="VDL2 message",
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=self.now - timedelta(hours=i)
            )

        result = acars_stats.calculate_acars_message_stats(hours=24)

        self.assertEqual(result["total_messages"], 15)
        self.assertEqual(result["by_source"]["acars"], 10)
        self.assertEqual(result["by_source"]["vdlm2"], 5)

    def test_calculate_acars_message_stats_by_label(self):
        """Test message stats grouped by label."""
        # Create messages with different labels
        for i in range(5):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"ABC{i:03d}",
                label="10",  # OOOI Out
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=self.now - timedelta(minutes=i)
            )

        for i in range(3):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"DEF{i:03d}",
                label="H1",  # Position
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=self.now - timedelta(minutes=i)
            )

        result = acars_stats.calculate_acars_message_stats(hours=24)

        self.assertGreater(len(result["by_label"]), 0)
        # Label 10 should be first (more messages)
        label_10 = next((item for item in result["by_label"] if item["label"] == "10"), None)
        self.assertIsNotNone(label_10)
        if label_10:
            self.assertEqual(label_10["count"], 5)

    def test_calculate_acars_message_stats_by_category(self):
        """Test message stats grouped by category."""
        # Create OOOI messages
        for i in range(5):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"ABC{i:03d}",
                label="10",
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=self.now - timedelta(minutes=i)
            )

        # Create weather messages
        for i in range(3):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"DEF{i:03d}",
                label="QA",
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=self.now - timedelta(minutes=i)
            )

        result = acars_stats.calculate_acars_message_stats(hours=24)

        self.assertGreater(len(result["by_category"]), 0)
        # Find OOOI category
        oooi = next((c for c in result["by_category"] if c["category"] == "oooi"), None)
        self.assertIsNotNone(oooi)

    def test_calculate_acars_message_stats_top_frequencies(self):
        """Test top frequencies in message stats."""
        # Create messages on different frequencies
        for i in range(10):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"ABC{i:03d}",
                frequency=131.55,
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=self.now - timedelta(minutes=i)
            )

        for i in range(5):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"DEF{i:03d}",
                frequency=136.975,
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=self.now - timedelta(minutes=i)
            )

        result = acars_stats.calculate_acars_message_stats(hours=24)

        self.assertGreater(len(result["top_frequencies"]), 0)
        # 131.55 should be first (more messages)
        self.assertEqual(result["top_frequencies"][0]["frequency"], 131.55)

    def test_calculate_acars_message_stats_content_percentage(self):
        """Test content percentage calculation."""
        # Create messages with text
        for i in range(8):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"ABC{i:03d}",
                text="Message with content",
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=self.now - timedelta(minutes=i)
            )

        # Create messages without text
        for i in range(2):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"DEF{i:03d}",
                text="",
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=self.now - timedelta(minutes=i)
            )

        result = acars_stats.calculate_acars_message_stats(hours=24)

        self.assertEqual(result["messages_with_content"], 8)
        self.assertEqual(result["content_percentage"], 80.0)


class AcarsAirlineStatsTests(TestCase):
    """Tests for ACARS airline statistics calculation."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AcarsMessage.objects.all().delete()

    def test_calculate_acars_airline_stats_empty(self):
        """Test airline stats with no data."""
        result = acars_stats.calculate_acars_airline_stats(hours=24)

        self.assertEqual(result["airlines"], [])
        self.assertEqual(result["total_messages"], 0)

    def test_calculate_acars_airline_stats_with_data(self):
        """Test airline stats with callsign data."""
        # Create messages with UAL callsigns
        for i in range(10):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"ABC{i:03d}",
                callsign=f"UAL{i:04d}",
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=self.now - timedelta(minutes=i)
            )

        # Create messages with DAL callsigns
        for i in range(5):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"DEF{i:03d}",
                callsign=f"DAL{i:04d}",
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=self.now - timedelta(minutes=i)
            )

        result = acars_stats.calculate_acars_airline_stats(hours=24)

        self.assertGreater(len(result["airlines"]), 0)
        self.assertEqual(result["total_messages"], 15)

    def test_calculate_acars_airline_stats_unique_flights(self):
        """Test unique flight counting."""
        # Create multiple messages for same flight
        for i in range(5):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex="ABC001",
                callsign="UAL123",  # Same callsign
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=self.now - timedelta(minutes=i)
            )

        result = acars_stats.calculate_acars_airline_stats(hours=24)

        # Should have 1 unique flight for UAL
        if result["airlines"]:
            ual = next((a for a in result["airlines"] if a.get("airline_icao") == "UAL"), None)
            if ual:
                self.assertEqual(ual["unique_flights"], 1)

    def test_calculate_acars_airline_stats_limit(self):
        """Test limit parameter for airline stats."""
        # Create messages for many airlines
        airlines = ["UAL", "DAL", "AAL", "SWA", "JBU"]
        for idx, airline in enumerate(airlines):
            for i in range(5):
                msg = AcarsMessage.objects.create(
                    source="acars",
                    icao_hex=f"A{idx}{i:02d}",
                    callsign=f"{airline}{i:04d}",
                )
                AcarsMessage.objects.filter(pk=msg.pk).update(
                    timestamp=self.now - timedelta(minutes=i + idx * 10)
                )

        result = acars_stats.calculate_acars_airline_stats(hours=24, limit=3)

        self.assertLessEqual(len(result["airlines"]), 3)


class AcarsTrendsTests(TestCase):
    """Tests for ACARS trend calculation."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AcarsMessage.objects.all().delete()

    def test_calculate_acars_trends_empty(self):
        """Test trends with no data."""
        result = acars_stats.calculate_acars_trends(hours=24)

        self.assertEqual(result["intervals"], [])
        self.assertEqual(result["total_messages"], 0)
        self.assertEqual(result["time_range_hours"], 24)

    def test_calculate_acars_trends_with_data(self):
        """Test trends with message data."""
        # Create messages at different hours
        for hours_back in range(6):
            target_timestamp = self.now - timedelta(hours=hours_back)
            for i in range(5):
                msg = AcarsMessage.objects.create(
                    source="acars",
                    icao_hex=f"A{hours_back}{i:02d}",
                )
                AcarsMessage.objects.filter(pk=msg.pk).update(
                    timestamp=target_timestamp
                )

        result = acars_stats.calculate_acars_trends(hours=24, interval="hour")

        self.assertGreater(len(result["intervals"]), 0)
        self.assertEqual(result["total_messages"], 30)

    def test_calculate_acars_trends_by_source(self):
        """Test trends breakdown by source."""
        # Create ACARS messages
        for i in range(10):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"ABC{i:03d}",
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=self.now - timedelta(minutes=i)
            )

        # Create VDL2 messages
        for i in range(5):
            msg = AcarsMessage.objects.create(
                source="vdlm2",
                icao_hex=f"DEF{i:03d}",
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=self.now - timedelta(minutes=i)
            )

        result = acars_stats.calculate_acars_trends(hours=24, interval="hour")

        # Intervals should have source breakdown
        if result["intervals"]:
            self.assertIn("acars", result["intervals"][-1])
            self.assertIn("vdl2", result["intervals"][-1])

    def test_calculate_acars_trends_peak_detection(self):
        """Test peak interval detection."""
        # Create more messages at current hour
        for i in range(20):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"ABC{i:03d}",
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=self.now
            )

        # Create fewer messages earlier
        for i in range(5):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"DEF{i:03d}",
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=self.now - timedelta(hours=5)
            )

        result = acars_stats.calculate_acars_trends(hours=24, interval="hour")

        self.assertIsNotNone(result["peak_interval"])
        self.assertGreater(result["peak_interval"]["count"], 0)

    def test_calculate_acars_trends_hourly_distribution(self):
        """Test hourly distribution in trends."""
        # Create messages at specific hour
        base_time = self.now.replace(hour=10, minute=0, second=0, microsecond=0)
        for i in range(10):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"ABC{i:03d}",
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=base_time
            )

        result = acars_stats.calculate_acars_trends(hours=24)

        self.assertIn("hourly_distribution", result)
        self.assertEqual(len(result["hourly_distribution"]), 24)

    def test_calculate_acars_trends_peak_quiet_hours(self):
        """Test peak and quietest hour detection."""
        # Create messages at hour 14
        base_time_14 = self.now.replace(hour=14, minute=0, second=0, microsecond=0)
        for i in range(20):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"P14{i:03d}",
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=base_time_14
            )

        # Create messages at hour 3
        base_time_3 = self.now.replace(hour=3, minute=0, second=0, microsecond=0)
        for i in range(2):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"P03{i:03d}",
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=base_time_3
            )

        result = acars_stats.calculate_acars_trends(hours=24)

        self.assertIn("peak_hour", result)
        self.assertIn("quietest_hour", result)


class AcarsCategoryTrendsTests(TestCase):
    """Tests for ACARS category trend calculation."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AcarsMessage.objects.all().delete()

    def test_calculate_acars_category_trends_empty(self):
        """Test category trends with no data."""
        result = acars_stats.calculate_acars_category_trends(hours=24)

        self.assertIn("hourly_category_trends", result)
        self.assertEqual(len(result["hourly_category_trends"]), 24)
        self.assertIn("category_totals", result)

    def test_calculate_acars_category_trends_with_data(self):
        """Test category trends with message data."""
        base_time = self.now.replace(hour=10, minute=0, second=0, microsecond=0)
        # Create OOOI messages
        for i in range(5):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"OOO{i:03d}",
                label="10",  # OOOI
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=base_time
            )

        # Create weather messages
        for i in range(3):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"WEA{i:03d}",
                label="QA",  # Weather
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=base_time
            )

        result = acars_stats.calculate_acars_category_trends(hours=24)

        self.assertIn("category_totals", result)
        self.assertIn("oooi", result["category_totals"])
        self.assertIn("weather", result["category_totals"])


class FreeTextAnalysisTests(TestCase):
    """Tests for free-text message analysis."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AcarsMessage.objects.all().delete()

    def test_calculate_free_text_analysis_empty(self):
        """Test free-text analysis with no data."""
        result = acars_stats.calculate_free_text_analysis(hours=24)

        self.assertIn("top_airports_mentioned", result)
        self.assertIn("weather_content", result)
        self.assertIn("message_patterns", result)

    def test_calculate_free_text_analysis_airport_detection(self):
        """Test airport code detection in messages."""
        # Create messages mentioning airports
        msg1 = AcarsMessage.objects.create(
            source="acars",
            icao_hex="ABC001",
            text="METAR KJFK 120000Z 27010KT",
        )
        AcarsMessage.objects.filter(pk=msg1.pk).update(timestamp=self.now)

        msg2 = AcarsMessage.objects.create(
            source="acars",
            icao_hex="ABC002",
            text="ATIS KLAX INFO A",
        )
        AcarsMessage.objects.filter(pk=msg2.pk).update(timestamp=self.now)

        result = acars_stats.calculate_free_text_analysis(hours=24)

        # Should detect KJFK and KLAX
        airports = [a["airport"] for a in result["top_airports_mentioned"]]
        self.assertIn("KJFK", airports)
        self.assertIn("KLAX", airports)

    def test_calculate_free_text_analysis_weather_detection(self):
        """Test weather content detection."""
        # Create METAR message
        msg1 = AcarsMessage.objects.create(
            source="acars",
            icao_hex="ABC001",
            text="METAR KJFK 120000Z 27010KT 10SM FEW200",
        )
        AcarsMessage.objects.filter(pk=msg1.pk).update(timestamp=self.now)

        # Create SIGMET message
        msg2 = AcarsMessage.objects.create(
            source="acars",
            icao_hex="ABC002",
            text="SIGMET CHARLIE VALID UNTIL 1200Z",
        )
        AcarsMessage.objects.filter(pk=msg2.pk).update(timestamp=self.now)

        result = acars_stats.calculate_free_text_analysis(hours=24)

        self.assertIn("weather_content", result)
        self.assertGreater(result["weather_content"].get("metar_taf", 0), 0)

    def test_calculate_free_text_analysis_pattern_detection(self):
        """Test message pattern detection."""
        # Create position report
        msg1 = AcarsMessage.objects.create(
            source="acars",
            icao_hex="ABC001",
            text="/POS/N4032.5W07412.3/FL350",
        )
        AcarsMessage.objects.filter(pk=msg1.pk).update(timestamp=self.now)

        # Create fuel message
        msg2 = AcarsMessage.objects.create(
            source="acars",
            icao_hex="ABC002",
            text="FUEL REMAINING 12500 LBS FOB",
        )
        AcarsMessage.objects.filter(pk=msg2.pk).update(timestamp=self.now)

        result = acars_stats.calculate_free_text_analysis(hours=24)

        self.assertIn("message_patterns", result)


class AcarsSummaryStatsTests(TestCase):
    """Tests for ACARS summary statistics."""

    def setUp(self):
        """Set up test fixtures."""
        AcarsMessage.objects.all().delete()  # Clear before each test
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AcarsMessage.objects.all().delete()

    def test_get_acars_summary_stats_empty(self):
        """Test summary stats with no data."""
        result = acars_stats.get_acars_summary_stats(hours=24)

        self.assertEqual(result["total_messages"], 0)
        self.assertEqual(result["unique_aircraft"], 0)
        self.assertEqual(result["unique_flights"], 0)

    def test_get_acars_summary_stats_with_data(self):
        """Test summary stats with message data."""
        # Create recent messages
        for i in range(20):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"ABC{i:03d}",
                callsign=f"UAL{i:04d}",
                label="10",
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=self.now - timedelta(minutes=i * 3)
            )

        result = acars_stats.get_acars_summary_stats(hours=24)

        self.assertEqual(result["total_messages"], 20)
        self.assertEqual(result["unique_aircraft"], 20)
        self.assertEqual(result["unique_flights"], 20)
        self.assertIn("messages_per_hour", result)

    def test_get_acars_summary_stats_last_hour(self):
        """Test last hour count in summary."""
        # Create messages in last hour
        # Note: timestamp has auto_now_add=True, so we need to update after creation
        for i in range(10):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"ABC{i:03d}",
            )
            # Update timestamp directly to bypass auto_now_add
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=self.now - timedelta(minutes=i * 5)
            )

        # Create messages from 2 hours ago
        for i in range(5):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"DEF{i:03d}",
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=self.now - timedelta(hours=2)
            )

        result = acars_stats.get_acars_summary_stats(hours=24)

        self.assertEqual(result["last_hour"], 10)

    def test_get_acars_summary_stats_top_label(self):
        """Test top label detection in summary."""
        # Create messages with label 10
        for i in range(10):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"ABC{i:03d}",
                label="10",
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=self.now - timedelta(minutes=i)
            )

        # Create messages with label H1
        for i in range(5):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"DEF{i:03d}",
                label="H1",
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=self.now - timedelta(minutes=i)
            )

        result = acars_stats.get_acars_summary_stats(hours=24)

        self.assertEqual(result["top_label"], "10")
        self.assertEqual(result["top_label_count"], 10)


class CacheManagementTests(TestCase):
    """Tests for cache management functions."""

    @patch("skyspy.services.acars_stats.cache")
    @patch("skyspy.services.acars_stats.broadcast_acars_stats_update")
    def test_refresh_acars_stats_cache(self, mock_broadcast, mock_cache):
        """Test refreshing ACARS stats cache."""
        acars_stats.refresh_acars_stats_cache(broadcast=True)

        mock_cache.set.assert_called()
        mock_broadcast.assert_called()

    @patch("skyspy.services.acars_stats.cache")
    @patch("skyspy.services.acars_stats.broadcast_acars_stats_update")
    def test_refresh_acars_stats_cache_no_broadcast(self, mock_broadcast, mock_cache):
        """Test refreshing cache without broadcast."""
        acars_stats.refresh_acars_stats_cache(broadcast=False)

        mock_cache.set.assert_called()
        mock_broadcast.assert_not_called()

    @patch("skyspy.services.acars_stats.cache")
    def test_get_cached_acars_stats(self, mock_cache):
        """Test getting ACARS stats from cache."""
        mock_cache.get.return_value = {"cached": True}

        result = acars_stats.get_cached_acars_stats()

        self.assertEqual(result, {"cached": True})

    @patch("skyspy.services.acars_stats.cache")
    @patch("skyspy.services.acars_stats.refresh_acars_stats_cache")
    def test_get_cached_acars_stats_cache_miss(self, mock_refresh, mock_cache):
        """Test getting ACARS stats when cache is empty."""
        mock_cache.get.return_value = None

        acars_stats.get_cached_acars_stats()

        mock_refresh.assert_called_once_with(broadcast=False)

    @patch("skyspy.services.acars_stats.cache")
    def test_get_cached_acars_trends(self, mock_cache):
        """Test getting ACARS trends from cache."""
        mock_cache.get.return_value = {"intervals": []}

        result = acars_stats.get_cached_acars_trends()

        self.assertEqual(result, {"intervals": []})

    @patch("skyspy.services.acars_stats.cache")
    def test_get_cached_acars_airlines(self, mock_cache):
        """Test getting ACARS airline stats from cache."""
        mock_cache.get.return_value = {"airlines": []}

        result = acars_stats.get_cached_acars_airlines()

        self.assertEqual(result, {"airlines": []})


class BroadcastTests(TestCase):
    """Tests for broadcasting functionality."""

    @patch("skyspy.socketio.utils.sync_emit")
    def test_broadcast_acars_stats_update(self, mock_sync_emit):
        """Test broadcasting ACARS stats update."""
        mock_sync_emit.return_value = True

        acars_stats.broadcast_acars_stats_update("acars_stats", {"test": True})

        mock_sync_emit.assert_called_once()

    @patch("skyspy.socketio.utils.sync_emit")
    def test_broadcast_handles_exception(self, mock_sync_emit):
        """Test broadcast handles exceptions gracefully."""
        mock_sync_emit.side_effect = Exception("Socket error")

        # Should not raise
        acars_stats.broadcast_acars_stats_update("acars_stats", {"test": True})


class EdgeCaseTests(TestCase):
    """Edge case tests for ACARS stats."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AcarsMessage.objects.all().delete()

    def test_message_stats_filters_common_non_airports(self):
        """Test that common non-airport codes are filtered."""
        # Create message with METAR (not an airport)
        msg = AcarsMessage.objects.create(
            source="acars",
            icao_hex="ABC001",
            text="METAR NOTAM ATIS SIGMET AIRMET",
        )
        AcarsMessage.objects.filter(pk=msg.pk).update(timestamp=self.now)

        result = acars_stats.calculate_free_text_analysis(hours=24)

        # METAR, NOTAM, etc. should not be in airports
        airports = [a["airport"] for a in result["top_airports_mentioned"]]
        self.assertNotIn("METAR", airports)
        self.assertNotIn("NOTAM", airports)
        self.assertNotIn("ATIS", airports)

    def test_airline_stats_handles_invalid_callsigns(self):
        """Test airline stats handles invalid callsigns."""
        # Create message with non-standard callsign
        msg = AcarsMessage.objects.create(
            source="acars",
            icao_hex="ABC001",
            callsign="INVALID123",  # Not a standard airline callsign
        )
        AcarsMessage.objects.filter(pk=msg.pk).update(timestamp=self.now)

        result = acars_stats.calculate_acars_airline_stats(hours=24)

        # Should complete without error
        self.assertIn("airlines", result)

    def test_message_stats_handles_none_label(self):
        """Test message stats handles None labels."""
        msg = AcarsMessage.objects.create(
            source="acars",
            icao_hex="ABC001",
            label=None,
        )
        AcarsMessage.objects.filter(pk=msg.pk).update(timestamp=self.now)

        result = acars_stats.calculate_acars_message_stats(hours=24)

        self.assertEqual(result["total_messages"], 1)

    def test_trends_handles_empty_interval(self):
        """Test trends handles intervals with no data."""
        result = acars_stats.calculate_acars_trends(hours=1, interval="hour")

        # Should handle empty intervals
        self.assertIn("intervals", result)

    def test_summary_stats_messages_per_hour(self):
        """Test messages per hour calculation."""
        # Create 24 messages over 24 hours
        for i in range(24):
            msg = AcarsMessage.objects.create(
                source="acars",
                icao_hex=f"ABC{i:03d}",
            )
            AcarsMessage.objects.filter(pk=msg.pk).update(
                timestamp=self.now - timedelta(hours=i)
            )

        result = acars_stats.get_acars_summary_stats(hours=24)

        # Should be 1.0 message per hour
        self.assertEqual(result["messages_per_hour"], 1.0)


class TimestampTests(TestCase):
    """Tests for timestamp handling in ACARS stats."""

    def test_message_stats_includes_timestamp(self):
        """Test that message stats includes ISO timestamp."""
        result = acars_stats.calculate_acars_message_stats(hours=24)

        self.assertIn("timestamp", result)
        self.assertIn("Z", result["timestamp"])

    def test_airline_stats_includes_timestamp(self):
        """Test that airline stats includes ISO timestamp."""
        result = acars_stats.calculate_acars_airline_stats(hours=24)

        self.assertIn("timestamp", result)
        self.assertIn("Z", result["timestamp"])

    def test_trends_includes_timestamp(self):
        """Test that trends includes ISO timestamp."""
        result = acars_stats.calculate_acars_trends(hours=24)

        self.assertIn("timestamp", result)
        self.assertIn("Z", result["timestamp"])

    def test_summary_stats_includes_timestamp(self):
        """Test that summary stats includes ISO timestamp."""
        result = acars_stats.get_acars_summary_stats(hours=24)

        self.assertIn("timestamp", result)
        self.assertIn("Z", result["timestamp"])
