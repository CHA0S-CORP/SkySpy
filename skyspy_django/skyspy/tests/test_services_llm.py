"""
Tests for the LLM service for enhanced transcript analysis.

Tests LLM client, caching, callsign validation, ambiguous resolution,
and deduplication with mocked AI API calls.
"""

import json
import time
from unittest.mock import MagicMock, patch

import pytest
from django.test import TestCase, override_settings

from skyspy.services.llm import (
    LLMClient,
    _llm_cache,
    _stats,
    clear_cache,
    deduplicate_mentions,
    enhance_callsign_extraction,
    get_llm_stats,
    llm_client,
    resolve_ambiguous_callsigns,
    validate_callsigns,
)


@override_settings(
    LLM_ENABLED=True,
    LLM_API_URL="http://localhost:11434/v1",
    LLM_API_KEY="",
    LLM_MODEL="llama2",
    LLM_TIMEOUT=30,
    LLM_MAX_RETRIES=3,
    LLM_CACHE_TTL=300,
    LLM_MAX_TOKENS=500,
    LLM_TEMPERATURE=0.3,
)
class LLMClientTests(TestCase):
    """Tests for LLMClient class."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = LLMClient()
        clear_cache()

    def tearDown(self):
        """Clean up."""
        clear_cache()

    def test_is_available_localhost(self):
        """Test is_available returns True for localhost without API key."""
        self.assertTrue(self.client.is_available())

    @override_settings(LLM_ENABLED=False)
    def test_is_available_disabled(self):
        """Test is_available returns False when LLM is disabled."""
        client = LLMClient()
        self.assertFalse(client.is_available())

    @override_settings(LLM_API_URL="https://api.openai.com/v1", LLM_API_KEY="")
    def test_is_available_remote_no_key(self):
        """Test is_available returns False for remote without API key."""
        client = LLMClient()
        self.assertFalse(client.is_available())

    @override_settings(LLM_API_URL="https://api.openai.com/v1", LLM_API_KEY="sk-test123")
    def test_is_available_remote_with_key(self):
        """Test is_available returns True for remote with API key."""
        client = LLMClient()
        self.assertTrue(client.is_available())

    def test_get_cache_key(self):
        """Test cache key generation."""
        messages = [{"role": "user", "content": "test message"}]

        key1 = self.client._get_cache_key(messages, model="llama2")
        key2 = self.client._get_cache_key(messages, model="llama2")
        key3 = self.client._get_cache_key(messages, model="gpt-4")

        self.assertEqual(key1, key2)
        self.assertNotEqual(key1, key3)

    def test_cache_hit(self):
        """Test cache hit retrieval."""
        cache_key = "test_key"
        response = {"content": "cached response"}

        self.client._set_cache(cache_key, response)
        result = self.client._check_cache(cache_key)

        self.assertEqual(result, response)

    def test_cache_miss(self):
        """Test cache miss."""
        result = self.client._check_cache("nonexistent_key")

        self.assertIsNone(result)

    def test_cache_expired(self):
        """Test expired cache entry is removed."""
        cache_key = "test_key"
        response = {"content": "cached response"}

        # Set with very short TTL (effectively already expired)
        _llm_cache.set(cache_key, response, ttl=1)
        time.sleep(1.1)  # Wait for TTL to expire

        result = self.client._check_cache(cache_key)

        self.assertIsNone(result)
        self.assertIsNone(_llm_cache.get(cache_key))

    @patch("httpx.Client")
    def test_complete_success(self, mock_client_class):
        """Test successful completion request."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "Test response"}}],
            "usage": {"total_tokens": 100},
        }

        mock_client = MagicMock()
        mock_client.post.return_value = mock_response
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client_class.return_value = mock_client

        messages = [{"role": "user", "content": "Hello"}]
        result = self.client.complete(messages, use_cache=False)

        self.assertIsNotNone(result)
        self.assertEqual(result["content"], "Test response")
        self.assertEqual(result["usage"]["total_tokens"], 100)

    @patch("httpx.Client")
    def test_complete_rate_limited(self, mock_client_class):
        """Test handling of rate limiting."""
        mock_response_429 = MagicMock()
        mock_response_429.status_code = 429
        mock_response_429.headers = {"Retry-After": "1"}

        mock_response_200 = MagicMock()
        mock_response_200.status_code = 200
        mock_response_200.raise_for_status = MagicMock()
        mock_response_200.json.return_value = {
            "choices": [{"message": {"content": "Success after retry"}}],
        }

        mock_client = MagicMock()
        mock_client.post.side_effect = [mock_response_429, mock_response_200]
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client_class.return_value = mock_client

        messages = [{"role": "user", "content": "Hello"}]

        # Patch time.sleep to speed up test
        with patch("time.sleep"):
            result = self.client.complete(messages, use_cache=False)

        self.assertIsNotNone(result)
        self.assertEqual(result["content"], "Success after retry")

    @patch("httpx.Client")
    def test_complete_timeout(self, mock_client_class):
        """Test handling of timeout."""
        import httpx

        mock_client = MagicMock()
        mock_client.post.side_effect = httpx.TimeoutException("Timeout")
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client_class.return_value = mock_client

        messages = [{"role": "user", "content": "Hello"}]

        with patch("time.sleep"):
            result = self.client.complete(messages, use_cache=False)

        self.assertIsNone(result)

    def test_complete_not_available(self):
        """Test complete returns None when LLM not available."""
        with patch.object(self.client, "is_available", return_value=False):
            result = self.client.complete([{"role": "user", "content": "test"}])

        self.assertIsNone(result)


@override_settings(
    LLM_ENABLED=True,
    LLM_API_URL="http://localhost:11434/v1",
    LLM_API_KEY="",
    LLM_MODEL="llama2",
    LLM_TIMEOUT=30,
    LLM_MAX_RETRIES=3,
    LLM_CACHE_TTL=300,
    LLM_MAX_TOKENS=500,
    LLM_TEMPERATURE=0.3,
)
class ValidateCallsignsTests(TestCase):
    """Tests for callsign validation function."""

    def setUp(self):
        """Set up test fixtures."""
        clear_cache()

    def tearDown(self):
        """Clean up."""
        clear_cache()

    def test_validate_empty_list(self):
        """Test validation with empty callsign list."""
        result = validate_callsigns("Test transcript", [])

        self.assertEqual(result, [])

    @patch.object(llm_client, "is_available", return_value=False)
    def test_validate_llm_unavailable(self, mock_available):
        """Test validation when LLM is unavailable."""
        extracted = [{"callsign": "UAL123", "confidence": 0.8}]

        result = validate_callsigns("United one two three", extracted)

        # Should return original list unchanged
        self.assertEqual(result, extracted)

    @patch.object(llm_client, "complete")
    @patch.object(llm_client, "is_available", return_value=True)
    def test_validate_success(self, mock_available, mock_complete):
        """Test successful validation."""
        mock_complete.return_value = {
            "content": json.dumps(
                [
                    {"callsign": "UAL123", "valid": True, "confidence": 0.95, "reason": "Valid airline callsign"},
                ]
            )
        }

        extracted = [{"callsign": "UAL123", "confidence": 0.7}]

        result = validate_callsigns("United one two three descend to flight level 350", extracted)

        self.assertEqual(len(result), 1)
        self.assertTrue(result[0].get("llm_validated"))
        self.assertTrue(result[0].get("llm_valid"))

    @patch.object(llm_client, "complete")
    @patch.object(llm_client, "is_available", return_value=True)
    def test_validate_invalid_callsign(self, mock_available, mock_complete):
        """Test validation marks invalid callsign."""
        mock_complete.return_value = {
            "content": json.dumps(
                [
                    {"callsign": "FAKE123", "valid": False, "confidence": 0.2, "reason": "Not a real callsign format"},
                ]
            )
        }

        extracted = [{"callsign": "FAKE123", "confidence": 0.5}]

        result = validate_callsigns("Some transcript with fake one two three", extracted)

        self.assertEqual(len(result), 1)
        self.assertFalse(result[0].get("llm_valid"))
        self.assertLess(result[0]["confidence"], 0.5)

    @patch.object(llm_client, "complete")
    @patch.object(llm_client, "is_available", return_value=True)
    def test_validate_json_error(self, mock_available, mock_complete):
        """Test validation handles JSON parse error."""
        mock_complete.return_value = {"content": "invalid json response"}

        extracted = [{"callsign": "UAL123", "confidence": 0.7}]

        result = validate_callsigns("United one two three", extracted)

        # Should return original list on parse error
        self.assertEqual(result, extracted)

    @patch.object(llm_client, "complete")
    @patch.object(llm_client, "is_available", return_value=True)
    def test_validate_markdown_code_block(self, mock_available, mock_complete):
        """Test validation handles markdown code blocks in response."""
        mock_complete.return_value = {
            "content": '```json\n[{"callsign": "UAL123", "valid": true, "confidence": 0.9}]\n```'
        }

        extracted = [{"callsign": "UAL123", "confidence": 0.7}]

        result = validate_callsigns("United one two three", extracted)

        self.assertEqual(len(result), 1)


@override_settings(
    LLM_ENABLED=True,
    LLM_API_URL="http://localhost:11434/v1",
    LLM_API_KEY="",
    LLM_MODEL="llama2",
    LLM_TIMEOUT=30,
    LLM_MAX_RETRIES=3,
    LLM_CACHE_TTL=300,
    LLM_MAX_TOKENS=500,
    LLM_TEMPERATURE=0.3,
)
class ResolveAmbiguousCallsignsTests(TestCase):
    """Tests for ambiguous callsign resolution."""

    def setUp(self):
        """Set up test fixtures."""
        clear_cache()

    def tearDown(self):
        """Clean up."""
        clear_cache()

    def test_resolve_empty_list(self):
        """Test resolution with empty list."""
        result = resolve_ambiguous_callsigns("Test transcript", [])

        self.assertEqual(result, [])

    @patch.object(llm_client, "is_available", return_value=False)
    def test_resolve_llm_unavailable(self, mock_available):
        """Test resolution when LLM unavailable."""
        ambiguous = [{"callsign": "UAL123", "confidence": 0.5, "raw": "united one twenty three"}]

        result = resolve_ambiguous_callsigns("united one twenty three descend", ambiguous)

        self.assertEqual(result, ambiguous)

    def test_resolve_no_ambiguous(self):
        """Test resolution skips high-confidence entries."""
        entries = [{"callsign": "UAL123", "confidence": 0.9, "raw": "UAL123"}]

        result = resolve_ambiguous_callsigns("UAL123 descend", entries)

        self.assertEqual(result, entries)

    @patch.object(llm_client, "complete")
    @patch.object(llm_client, "is_available", return_value=True)
    def test_resolve_success(self, mock_available, mock_complete):
        """Test successful resolution."""
        mock_complete.return_value = {
            "content": json.dumps(
                [
                    {
                        "original": "november one two three alpha bravo",
                        "resolved": "N123AB",
                        "confidence": 0.85,
                        "alternatives": ["N123AB", "N123A8"],
                    }
                ]
            )
        }

        ambiguous = [
            {
                "callsign": "N123A?",
                "confidence": 0.4,
                "raw": "november one two three alpha bravo",
                "fuzzy_matched": True,
            }
        ]

        result = resolve_ambiguous_callsigns("november one two three alpha bravo cleared to land", ambiguous)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["callsign"], "N123AB")
        self.assertTrue(result[0].get("llm_resolved"))


@override_settings(
    LLM_ENABLED=True,
    LLM_API_URL="http://localhost:11434/v1",
    LLM_API_KEY="",
    LLM_MODEL="llama2",
    LLM_TIMEOUT=30,
    LLM_MAX_RETRIES=3,
    LLM_CACHE_TTL=300,
    LLM_MAX_TOKENS=500,
    LLM_TEMPERATURE=0.3,
)
class DeduplicateMentionsTests(TestCase):
    """Tests for mention deduplication."""

    def setUp(self):
        """Set up test fixtures."""
        clear_cache()

    def tearDown(self):
        """Clean up."""
        clear_cache()

    def test_dedupe_empty_list(self):
        """Test deduplication with empty list."""
        result = deduplicate_mentions("Test", [])

        self.assertEqual(result, [])

    def test_dedupe_single_item(self):
        """Test deduplication with single item."""
        entries = [{"callsign": "UAL123", "raw": "UAL123"}]

        result = deduplicate_mentions("UAL123 descend", entries)

        self.assertEqual(result, entries)

    @patch.object(llm_client, "is_available", return_value=False)
    def test_dedupe_llm_unavailable(self, mock_available):
        """Test deduplication when LLM unavailable."""
        entries = [
            {"callsign": "UAL123", "raw": "united one two three"},
            {"callsign": "UAL123", "raw": "united one twenty three"},
        ]

        result = deduplicate_mentions("united one two three", entries)

        self.assertEqual(result, entries)

    @patch.object(llm_client, "complete")
    @patch.object(llm_client, "is_available", return_value=True)
    def test_dedupe_success(self, mock_available, mock_complete):
        """Test successful deduplication."""
        mock_complete.return_value = {
            "content": json.dumps(
                {
                    "groups": [
                        {
                            "primary": "UAL123",
                            "mentions": ["united one two three", "united one twenty three", "UAL123"],
                            "confidence": 0.95,
                        }
                    ]
                }
            )
        }

        entries = [
            {"callsign": "UAL123", "raw": "united one two three"},
            {"callsign": "UAL1", "raw": "united one twenty three"},
        ]

        result = deduplicate_mentions(
            "united one two three descend... united one twenty three turn left", entries
        )

        # Second entry should be marked as linked to first
        for entry in result:
            if entry["raw"] == "united one twenty three":
                self.assertEqual(entry.get("linked_to"), "UAL123")


@override_settings(
    LLM_ENABLED=True,
    LLM_API_URL="http://localhost:11434/v1",
    LLM_API_KEY="",
    LLM_MODEL="llama2",
    LLM_TIMEOUT=30,
    LLM_MAX_RETRIES=3,
    LLM_CACHE_TTL=300,
    LLM_MAX_TOKENS=500,
    LLM_TEMPERATURE=0.3,
)
class EnhanceCallsignExtractionTests(TestCase):
    """Tests for the main enhancement entry point."""

    def setUp(self):
        """Set up test fixtures."""
        clear_cache()

    def tearDown(self):
        """Clean up."""
        clear_cache()

    def test_enhance_empty_list(self):
        """Test enhancement with empty list."""
        result = enhance_callsign_extraction("Test", [])

        self.assertEqual(result, [])

    @patch.object(llm_client, "is_available", return_value=False)
    def test_enhance_llm_unavailable(self, mock_available):
        """Test enhancement when LLM unavailable."""
        extracted = [{"callsign": "UAL123", "confidence": 0.8}]

        result = enhance_callsign_extraction("united one two three", extracted)

        self.assertEqual(result, extracted)

    @patch.object(llm_client, "complete")
    @patch.object(llm_client, "is_available", return_value=True)
    def test_enhance_full_pipeline(self, mock_available, mock_complete):
        """Test full enhancement pipeline."""
        # Different responses for different prompts
        mock_complete.side_effect = [
            # Resolution response
            {"content": "[]"},
            # Validation response
            {
                "content": json.dumps(
                    [{"callsign": "UAL123", "valid": True, "confidence": 0.9, "reason": "Valid"}]
                )
            },
            # Deduplication response
            {"content": json.dumps({"groups": []})},
        ]

        extracted = [{"callsign": "UAL123", "confidence": 0.8}]

        result = enhance_callsign_extraction("united one two three descend", extracted)

        self.assertEqual(len(result), 1)

    @patch.object(llm_client, "complete")
    @patch.object(llm_client, "is_available", return_value=True)
    def test_enhance_exception_fallback(self, mock_available, mock_complete):
        """Test enhancement falls back on exception."""
        mock_complete.side_effect = Exception("LLM error")

        extracted = [{"callsign": "UAL123", "confidence": 0.8}]

        result = enhance_callsign_extraction("united one two three", extracted)

        # Should return original on error
        self.assertEqual(result, extracted)


@override_settings(
    LLM_ENABLED=True,
    LLM_API_URL="http://localhost:11434/v1",
    LLM_API_KEY="",
    LLM_MODEL="llama2",
    LLM_TIMEOUT=30,
    LLM_MAX_RETRIES=3,
    LLM_CACHE_TTL=300,
    LLM_MAX_TOKENS=500,
    LLM_TEMPERATURE=0.3,
)
class GetLLMStatsTests(TestCase):
    """Tests for LLM statistics."""

    def test_get_stats(self):
        """Test getting LLM stats."""
        stats = get_llm_stats()

        self.assertIn("enabled", stats)
        self.assertIn("available", stats)
        self.assertIn("model", stats)
        # cache is now a dict with BoundedCache stats
        self.assertIn("cache", stats)
        self.assertIn("size", stats["cache"])
        self.assertIn("maxsize", stats["cache"])
        self.assertIn("requests", stats)
        self.assertIn("successes", stats)
        self.assertIn("failures", stats)


class ClearCacheTests(TestCase):
    """Tests for cache clearing."""

    def test_clear_cache(self):
        """Test cache clearing."""
        # Add something to cache
        _llm_cache.set("test_key", {"content": "test"}, ttl=300)

        clear_cache()

        self.assertEqual(len(_llm_cache), 0)
