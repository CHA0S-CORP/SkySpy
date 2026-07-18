"""
LLM service for enhanced transcript analysis.

Provides optional LLM-based post-processing for:
- Callsign validation against transcript context
- Confidence rescoring based on semantic analysis
- Ambiguous phonetic resolution
- Multi-mention deduplication and linking

Supports OpenAI-compatible APIs (OpenAI, Anthropic via proxy, local Ollama).
Gracefully degrades to regex-only extraction on any failure.
"""

import hashlib
import json
import logging
import time
from dataclasses import dataclass, field

import httpx
from django.conf import settings

from skyspy.services.cache import BoundedCache

logger = logging.getLogger(__name__)

# Service statistics
_stats = {
    "requests": 0,
    "successes": 0,
    "failures": 0,
    "cache_hits": 0,
    "cache_misses": 0,
    "total_tokens": 0,
    "retries": 0,
    "rate_limits": 0,
}

# Bounded in-memory cache to prevent memory growth
_llm_cache = BoundedCache(maxsize=1000, name="llm")


@dataclass
class LLMClient:
    """
    OpenAI-compatible LLM client with retry logic and caching.

    Supports:
    - OpenAI API
    - Anthropic via OpenRouter or similar proxy
    - Local Ollama with OpenAI-compatible endpoint
    """

    api_url: str = field(default_factory=lambda: settings.LLM_API_URL)
    api_key: str = field(default_factory=lambda: settings.LLM_API_KEY)
    model: str = field(default_factory=lambda: settings.LLM_MODEL)
    timeout: int = field(default_factory=lambda: settings.LLM_TIMEOUT)
    max_retries: int = field(default_factory=lambda: settings.LLM_MAX_RETRIES)
    cache_ttl: int = field(default_factory=lambda: settings.LLM_CACHE_TTL)
    max_tokens: int = field(default_factory=lambda: settings.LLM_MAX_TOKENS)
    temperature: float = field(default_factory=lambda: settings.LLM_TEMPERATURE)

    def is_available(self) -> bool:
        """Check if LLM service is configured and available."""
        if not settings.LLM_ENABLED:
            return False
        return not (not self.api_key and "localhost" not in self.api_url and "127.0.0.1" not in self.api_url)

    def _get_cache_key(self, messages: list[dict], **kwargs) -> str:
        """Generate a cache key from request parameters."""
        content = json.dumps({"messages": messages, **kwargs}, sort_keys=True)
        return hashlib.sha256(content.encode()).hexdigest()

    def _check_cache(self, cache_key: str) -> dict | None:
        """Check cache for a valid response."""
        response = _llm_cache.get(cache_key)
        if response is not None:
            _stats["cache_hits"] += 1
            return response
        _stats["cache_misses"] += 1
        return None

    def _set_cache(self, cache_key: str, response: dict):
        """Store response in cache with TTL."""
        _llm_cache.set(cache_key, response, ttl=self.cache_ttl)

    def complete(self, messages: list[dict], use_cache: bool = True, **kwargs) -> dict | None:
        """
        Send a chat completion request.

        Args:
            messages: List of message dicts with 'role' and 'content'
            use_cache: Whether to use response caching
            **kwargs: Additional parameters for the API

        Returns:
            Response dict with 'content' key, or None on failure
        """
        if not self.is_available():
            logger.debug("LLM not available")
            return None

        # Check cache
        cache_key = self._get_cache_key(messages, model=self.model, **kwargs)
        if use_cache:
            cached = self._check_cache(cache_key)
            if cached:
                return cached

        # Build request
        endpoint = f"{self.api_url.rstrip('/')}/chat/completions"
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        payload = {
            "model": self.model,
            "messages": messages,
            "max_tokens": kwargs.get("max_tokens", self.max_tokens),
            "temperature": kwargs.get("temperature", self.temperature),
        }

        # Retry with exponential backoff. `attempt` counts genuine tries; a 429
        # backs off without consuming the attempt budget (bounded separately so a
        # persistently rate-limited endpoint can't spin forever).
        last_error = None
        _MAX_RATE_LIMIT_WAITS = 5
        rl_waits = 0
        attempt = 0
        while attempt < self.max_retries:
            is_last = attempt == self.max_retries - 1
            try:
                _stats["requests"] += 1

                with httpx.Client(timeout=self.timeout) as client:
                    response = client.post(endpoint, headers=headers, json=payload)

                    # Handle rate limiting — retry without burning an attempt.
                    if response.status_code == 429:
                        _stats["rate_limits"] += 1
                        if rl_waits >= _MAX_RATE_LIMIT_WAITS:
                            logger.error(f"LLM rate limited {rl_waits}x, giving up")
                            _stats["failures"] += 1
                            return None
                        retry_after = int(response.headers.get("Retry-After", 2 ** (rl_waits + 1)))
                        logger.warning(f"LLM rate limited, waiting {retry_after}s")
                        time.sleep(min(retry_after, 60))
                        _stats["retries"] += 1
                        rl_waits += 1
                        continue

                    response.raise_for_status()
                    data = response.json()

                    # Extract content
                    if "choices" in data and data["choices"]:
                        choice = data["choices"][0]
                        content = choice.get("message", {}).get("content", "")

                        # Track token usage
                        if "usage" in data:
                            _stats["total_tokens"] += data["usage"].get("total_tokens", 0)

                        result = {"content": content, "usage": data.get("usage")}
                        _stats["successes"] += 1

                        if use_cache:
                            self._set_cache(cache_key, result)

                        return result

                    logger.warning(f"Unexpected LLM response format: {data}")
                    _stats["failures"] += 1
                    return None

            except httpx.TimeoutException:
                last_error = "timeout"
                logger.warning(f"LLM request timeout (attempt {attempt + 1}/{self.max_retries})")
                _stats["retries"] += 1
                if not is_last:
                    time.sleep(2**attempt)

            except httpx.HTTPStatusError as e:
                last_error = str(e)
                logger.warning(f"LLM HTTP error: {e.response.status_code}")
                _stats["failures"] += 1
                if e.response.status_code >= 500:
                    _stats["retries"] += 1
                    if not is_last:
                        time.sleep(2**attempt)
                    attempt += 1
                    continue
                return None

            except (httpx.HTTPError, ConnectionError, OSError, ValueError, KeyError, TypeError) as e:
                last_error = str(e)
                logger.warning(f"LLM error: {e}")
                _stats["failures"] += 1
                return None

            attempt += 1

        logger.error(f"LLM request failed after {self.max_retries} retries: {last_error}")
        _stats["failures"] += 1
        return None

    def embed(self, texts: list[str]) -> list[list[float]] | None:
        """
        Embed a batch of texts via the OpenAI-compatible /embeddings endpoint.

        Returns a list of vectors aligned with ``texts``, or None on failure.
        Uses EMBEDDING_MODEL / EMBEDDING_API_URL / EMBEDDING_API_KEY, each
        falling back to the corresponding LLM_* setting so a single provider
        config covers both chat and embeddings.
        """
        if not texts:
            return []

        # A blank/comment-only env value (e.g. an inline "# defaults to ..."
        # that leaked in as the value) must not defeat the fallback to LLM_*.
        def _clean(v):
            v = (v or "").strip()
            return "" if v.startswith("#") else v

        api_url = _clean(getattr(settings, "EMBEDDING_API_URL", "")) or self.api_url
        api_key = _clean(getattr(settings, "EMBEDDING_API_KEY", "")) or self.api_key
        model = _clean(getattr(settings, "EMBEDDING_MODEL", "")) or "text-embedding-3-small"

        if not getattr(settings, "LLM_ENABLED", False):
            logger.debug("LLM/embeddings not enabled")
            return None
        if not api_key and "localhost" not in api_url and "127.0.0.1" not in api_url:
            logger.debug("Embeddings not available (no API key)")
            return None

        endpoint = f"{api_url.rstrip('/')}/embeddings"
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        _MAX_RATE_LIMIT_WAITS = 5
        rl_waits = 0
        attempt = 0
        while attempt < self.max_retries:
            is_last = attempt == self.max_retries - 1
            try:
                with httpx.Client(timeout=self.timeout) as client:
                    response = client.post(endpoint, headers=headers, json={"model": model, "input": texts})
                    # Rate limit — back off without consuming an attempt (bounded).
                    if response.status_code == 429:
                        _stats["rate_limits"] += 1
                        if rl_waits >= _MAX_RATE_LIMIT_WAITS:
                            logger.error(f"Embeddings rate limited {rl_waits}x, giving up")
                            return None
                        time.sleep(min(int(response.headers.get("Retry-After", 2 ** (rl_waits + 1))), 60))
                        rl_waits += 1
                        continue
                    response.raise_for_status()
                    data = response.json()
                # OpenAI returns {"data": [{"index": i, "embedding": [...]}, ...]}
                items = sorted(data.get("data", []), key=lambda x: x.get("index", 0))
                vectors = [it["embedding"] for it in items]
                if len(vectors) == len(texts):
                    if "usage" in data:
                        _stats["total_tokens"] += data["usage"].get("total_tokens", 0)
                    return vectors
                logger.warning(f"Embeddings count mismatch: got {len(vectors)} for {len(texts)} inputs")
                return None
            except httpx.HTTPStatusError as e:
                logger.warning(f"Embeddings HTTP error: {e.response.status_code}")
                if e.response.status_code >= 500:
                    if not is_last:
                        time.sleep(2**attempt)
                    attempt += 1
                    continue
                return None
            except (httpx.HTTPError, ConnectionError, OSError, ValueError, KeyError, TypeError) as e:
                logger.warning(f"Embeddings error: {e}")
                return None

            attempt += 1

        return None


# Singleton client instance
llm_client = LLMClient()


# System prompts for different analysis tasks
VALIDATE_CALLSIGNS_PROMPT = """You are an ATC transcript analyzer specializing in aviation callsign validation.

Given a transcript and extracted callsigns, validate each callsign by checking:
1. Does it appear in context that makes sense for ATC communication?
2. Is the callsign format correct (airline ICAO + 1-4 digits, N-number, or military callsign)?
3. Could the extracted text be a mishearing of another word?

Respond with a JSON array. For each callsign:
{
  "callsign": "the callsign",
  "valid": true/false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation"
}

Only output the JSON array, no other text."""

RESOLVE_AMBIGUOUS_PROMPT = """You are an ATC transcript analyzer specializing in phonetic ambiguity resolution.

Given a transcript with ambiguous callsigns, determine the most likely intended callsign.
Consider:
1. Common airline callsigns and their phonetic pronunciations
2. Context from surrounding ATC communications
3. Standard ATC phraseology

Respond with a JSON array of resolved callsigns:
{
  "original": "the ambiguous text",
  "resolved": "the most likely callsign",
  "confidence": 0.0-1.0,
  "alternatives": ["other possible callsigns"]
}

Only output the JSON array, no other text."""

DEDUPLICATE_MENTIONS_PROMPT = """You are an ATC transcript analyzer specializing in aircraft identification.

Given a transcript with multiple callsign mentions, identify which mentions refer to the same aircraft.
Consider:
1. Variations in how the same callsign might be spoken (full vs abbreviated)
2. Context clues that link mentions together
3. ATC conversation flow (addressing same aircraft multiple times)

Respond with a JSON object grouping related callsigns:
{
  "groups": [
    {
      "primary": "the canonical callsign",
      "mentions": ["list of all text variations that refer to this aircraft"],
      "confidence": 0.0-1.0
    }
  ]
}

Only output the JSON object, no other text."""


def validate_callsigns(
    transcript: str,
    extracted: list[dict],
) -> list[dict]:
    """
    Validate extracted callsigns against transcript context using LLM.

    Args:
        transcript: The original transcript text
        extracted: List of extracted callsign dicts from regex patterns

    Returns:
        Updated list with LLM validation results merged in
    """
    if not extracted:
        return extracted

    if not llm_client.is_available():
        return extracted

    # Build the prompt
    callsign_list = [cs.get("callsign", "") for cs in extracted]
    user_content = f"""Transcript: "{transcript}"

Extracted callsigns: {json.dumps(callsign_list)}

Validate each callsign."""

    messages = [
        {"role": "system", "content": VALIDATE_CALLSIGNS_PROMPT},
        {"role": "user", "content": user_content},
    ]

    response = llm_client.complete(messages)
    if not response or not response.get("content"):
        return extracted

    try:
        content = response["content"].strip()
        # Handle potential markdown code blocks
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        content = content.strip()

        validations = json.loads(content)

        # Merge validation results
        validation_map = {v["callsign"]: v for v in validations if isinstance(v, dict)}

        for cs in extracted:
            callsign = cs.get("callsign", "")
            if callsign in validation_map:
                validation = validation_map[callsign]
                cs["llm_validated"] = True
                cs["llm_valid"] = validation.get("valid", True)
                cs["llm_reason"] = validation.get("reason", "")

                # Adjust confidence based on LLM validation
                original_confidence = cs.get("confidence", 0.5)
                llm_confidence = validation.get("confidence", 0.5)

                if validation.get("valid", True):
                    # Boost confidence if LLM validates
                    cs["confidence"] = min(1.0, (original_confidence + llm_confidence) / 2 + 0.1)
                else:
                    # Reduce confidence if LLM rejects
                    cs["confidence"] = max(0.1, (original_confidence + llm_confidence) / 2 - 0.2)

        return extracted

    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse LLM validation response: {e}")
        return extracted
    except (KeyError, TypeError, AttributeError, ValueError) as e:
        logger.warning(f"Error processing LLM validation: {e}")
        return extracted


def resolve_ambiguous_callsigns(
    transcript: str,
    ambiguous: list[dict],
) -> list[dict]:
    """
    Resolve ambiguous callsign extractions using LLM context analysis.

    Args:
        transcript: The original transcript text
        ambiguous: List of callsign dicts with low confidence or fuzzy matches

    Returns:
        List of resolved callsigns with updated confidence
    """
    if not ambiguous:
        return ambiguous

    if not llm_client.is_available():
        return ambiguous

    # Only process ambiguous entries (low confidence or fuzzy matched)
    to_resolve = [cs for cs in ambiguous if cs.get("confidence", 1.0) < 0.8 or cs.get("fuzzy_matched", False)]

    if not to_resolve:
        return ambiguous

    # Build the prompt
    ambiguous_texts = [{"text": cs.get("raw", ""), "current": cs.get("callsign", "")} for cs in to_resolve]
    user_content = f"""Transcript: "{transcript}"

Ambiguous callsigns to resolve:
{json.dumps(ambiguous_texts, indent=2)}

Resolve each ambiguous callsign."""

    messages = [
        {"role": "system", "content": RESOLVE_AMBIGUOUS_PROMPT},
        {"role": "user", "content": user_content},
    ]

    response = llm_client.complete(messages)
    if not response or not response.get("content"):
        return ambiguous

    try:
        content = response["content"].strip()
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        content = content.strip()

        resolutions = json.loads(content)

        # Create lookup by original text
        resolution_map = {r["original"]: r for r in resolutions if isinstance(r, dict) and "original" in r}

        for cs in ambiguous:
            raw_text = cs.get("raw", "")
            if raw_text in resolution_map:
                resolution = resolution_map[raw_text]
                resolved_callsign = resolution.get("resolved", "")

                if resolved_callsign and resolved_callsign != cs.get("callsign"):
                    cs["original_callsign"] = cs.get("callsign")
                    cs["callsign"] = resolved_callsign
                    cs["llm_resolved"] = True

                if "confidence" in resolution:
                    cs["confidence"] = resolution["confidence"]

                if "alternatives" in resolution:
                    cs["alternatives"] = resolution["alternatives"]

        return ambiguous

    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse LLM resolution response: {e}")
        return ambiguous
    except (KeyError, TypeError, AttributeError, ValueError) as e:
        logger.warning(f"Error processing LLM resolution: {e}")
        return ambiguous


def deduplicate_mentions(
    transcript: str,
    callsigns: list[dict],
) -> list[dict]:
    """
    Link multiple mentions of the same aircraft across a transcript.

    Args:
        transcript: The original transcript text
        callsigns: List of all extracted callsigns

    Returns:
        Updated list with deduplication metadata
    """
    if not callsigns or len(callsigns) < 2:
        return callsigns

    if not llm_client.is_available():
        return callsigns

    # Build the prompt
    mentions = [{"callsign": cs.get("callsign", ""), "raw": cs.get("raw", "")} for cs in callsigns]
    user_content = f"""Transcript: "{transcript}"

Callsign mentions found:
{json.dumps(mentions, indent=2)}

Identify which mentions refer to the same aircraft."""

    messages = [
        {"role": "system", "content": DEDUPLICATE_MENTIONS_PROMPT},
        {"role": "user", "content": user_content},
    ]

    response = llm_client.complete(messages)
    if not response or not response.get("content"):
        return callsigns

    try:
        content = response["content"].strip()
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        content = content.strip()

        result = json.loads(content)
        groups = result.get("groups", [])

        # Build mention to primary callsign mapping
        primary_map = {}
        for group in groups:
            primary = group.get("primary", "")
            for mention in group.get("mentions", []):
                primary_map[mention.lower()] = primary

        # Update callsigns with deduplication info
        for cs in callsigns:
            raw_lower = cs.get("raw", "").lower()
            callsign = cs.get("callsign", "")

            if raw_lower in primary_map:
                primary = primary_map[raw_lower]
                if primary and primary != callsign:
                    cs["linked_to"] = primary
                    cs["is_duplicate"] = True

        return callsigns

    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse LLM deduplication response: {e}")
        return callsigns
    except (KeyError, TypeError, AttributeError, ValueError) as e:
        logger.warning(f"Error processing LLM deduplication: {e}")
        return callsigns


def enhance_callsign_extraction(
    transcript: str,
    extracted: list[dict],
    validate: bool = True,
    resolve_ambiguous: bool = True,
    deduplicate: bool = True,
) -> list[dict]:
    """
    Apply all LLM enhancements to extracted callsigns.

    This is the main entry point for LLM-enhanced callsign extraction.
    It applies validation, resolution, and deduplication in sequence.

    Args:
        transcript: The original transcript text
        extracted: List of callsigns from regex extraction
        validate: Whether to validate callsigns
        resolve_ambiguous: Whether to resolve ambiguous matches
        deduplicate: Whether to deduplicate mentions

    Returns:
        Enhanced list of callsigns
    """
    if not extracted:
        return extracted

    if not llm_client.is_available():
        logger.debug("LLM not available, returning regex-only extraction")
        return extracted

    result = extracted.copy()

    try:
        # Step 1: Resolve ambiguous callsigns
        if resolve_ambiguous:
            result = resolve_ambiguous_callsigns(transcript, result)

        # Step 2: Validate callsigns
        if validate:
            result = validate_callsigns(transcript, result)

        # Step 3: Deduplicate mentions
        if deduplicate:
            result = deduplicate_mentions(transcript, result)

        # Re-sort by confidence after all enhancements
        result.sort(key=lambda x: x.get("confidence", 0.5), reverse=True)

        return result

    except Exception as e:  # broad: top-level fallback — must always degrade to regex-only extraction
        logger.error(f"LLM enhancement failed, returning regex-only: {e}")
        return extracted


def _api_url_domain(url: str | None) -> str | None:
    """Host of an API URL for stats display, tolerant of a scheme-less value
    (``split('/')[2]`` used to IndexError on e.g. 'localhost:8000')."""
    if not url:
        return None
    from urllib.parse import urlparse

    parsed = urlparse(url if "//" in url else f"//{url}")
    return parsed.hostname or url


def get_llm_stats() -> dict:
    """
    Get LLM service statistics.

    Returns:
        Dict with request counts, cache stats, token usage, etc.
    """
    return {
        "enabled": settings.LLM_ENABLED,
        "available": llm_client.is_available(),
        "model": settings.LLM_MODEL,
        "api_url": _api_url_domain(settings.LLM_API_URL),  # Domain only
        "cache": _llm_cache.get_stats(),
        "cache_ttl": settings.LLM_CACHE_TTL,
        **_stats,
    }


def clear_cache():
    """Clear the LLM response cache."""
    _llm_cache.clear()
    logger.info("LLM cache cleared")
