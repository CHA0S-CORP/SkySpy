"""
Alert rule caching with pre-compiled optimization hints.

Provides a two-level cache (local memory + Redis) for alert rules
with automatic invalidation via Django signals.
"""
import json
import logging
import re
import hashlib
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional, Dict, Any
from threading import Lock

from django.conf import settings
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.utils import timezone

logger = logging.getLogger(__name__)


@dataclass
class CompiledRule:
    """
    Pre-compiled rule with optimization hints for fast evaluation.

    Contains pre-computed metadata that helps filter aircraft
    before full condition evaluation.
    """
    # Core rule data
    id: int
    name: str
    rule_type: Optional[str]
    operator: str
    value: Optional[str]
    conditions: Optional[Dict]
    priority: str
    cooldown_seconds: int
    api_url: Optional[str]
    owner_id: Optional[int]
    visibility: str
    is_system: bool

    # Scheduling
    starts_at: Optional[datetime]
    expires_at: Optional[datetime]

    # Pre-computed optimization hints
    requires_military: bool = False
    requires_position: bool = False
    requires_altitude: bool = False
    requires_speed: bool = False
    target_icao: Optional[str] = None  # For exact ICAO match rules
    target_callsign_prefix: Optional[str] = None  # For callsign prefix rules
    target_squawk: Optional[str] = None  # For exact squawk match

    # Compiled regex patterns (if rule uses regex)
    compiled_regex: Optional[Any] = field(default=None, repr=False)

    def is_scheduled_active(self, now: Optional[datetime] = None) -> bool:
        """Check if rule is active based on schedule."""
        if now is None:
            now = timezone.now()

        if self.starts_at and self.starts_at > now:
            return False
        if self.expires_at and self.expires_at < now:
            return False
        return True

    def can_match(self, aircraft: dict) -> bool:
        """
        Quick pre-filter to determine if this rule could possibly match.

        This is a fast check that filters out obvious non-matches before
        running the full condition evaluation.
        """
        # Military filter - check both 'military' key and 'dbFlags' bit 0
        if self.requires_military:
            is_military = aircraft.get('military')
            if not is_military:
                # Fall back to dbFlags (bit 0 = military)
                db_flags = aircraft.get('dbFlags', 0)
                is_military = bool(db_flags & 1) if isinstance(db_flags, int) else False
            if not is_military:
                return False

        # Position filter (for distance rules)
        if self.requires_position and not aircraft.get('distance_nm'):
            return False

        # Altitude filter - check both 'alt' and 'alt_baro'
        if self.requires_altitude:
            if aircraft.get('alt') is None and aircraft.get('alt_baro') is None:
                return False

        # Speed filter
        if self.requires_speed and aircraft.get('gs') is None:
            return False

        # Exact ICAO match (fastest path)
        if self.target_icao:
            icao = aircraft.get('hex', '').upper()
            if icao != self.target_icao:
                return False

        # Exact squawk match
        if self.target_squawk:
            squawk = aircraft.get('squawk', '')
            if squawk != self.target_squawk:
                return False

        # Callsign prefix match
        if self.target_callsign_prefix:
            callsign = (aircraft.get('flight') or '').upper()
            if not callsign.startswith(self.target_callsign_prefix):
                return False

        return True

    @classmethod
    def from_db_rule(cls, rule) -> 'CompiledRule':
        """Create a CompiledRule from a database AlertRule instance."""
        # Determine optimization hints
        requires_military = False
        requires_position = False
        requires_altitude = False
        requires_speed = False
        target_icao = None
        target_callsign_prefix = None
        target_squawk = None
        compiled_regex = None

        # Analyze simple rule type
        if rule.rule_type:
            if rule.rule_type == 'military':
                requires_military = True
            elif rule.rule_type == 'distance':
                requires_position = True
            elif rule.rule_type == 'altitude':
                requires_altitude = True
            elif rule.rule_type in ('speed', 'vertical_rate'):
                requires_speed = True
            elif rule.rule_type == 'icao' and rule.operator == 'eq':
                target_icao = (rule.value or '').upper()
            elif rule.rule_type == 'squawk' and rule.operator == 'eq':
                target_squawk = rule.value
            elif rule.rule_type == 'callsign':
                if rule.operator == 'startswith':
                    target_callsign_prefix = (rule.value or '').upper()

        # Compile regex if needed
        if rule.operator == 'regex' and rule.value:
            try:
                compiled_regex = re.compile(rule.value, re.IGNORECASE)
            except re.error as e:
                logger.warning(f"Invalid regex in rule {rule.id}: {e}")

        # Analyze complex conditions
        if rule.conditions:
            cls._analyze_conditions(
                rule.conditions,
                requires_military, requires_position,
                requires_altitude, requires_speed
            )

        # Get visibility with fallback for old rules
        visibility = getattr(rule, 'visibility', 'private')
        is_system = getattr(rule, 'is_system', False)

        return cls(
            id=rule.id,
            name=rule.name,
            rule_type=rule.rule_type,
            operator=rule.operator,
            value=rule.value,
            conditions=rule.conditions,
            priority=rule.priority,
            cooldown_seconds=rule.cooldown_minutes * 60,
            api_url=rule.api_url,
            owner_id=rule.owner_id,
            visibility=visibility,
            is_system=is_system,
            starts_at=rule.starts_at,
            expires_at=rule.expires_at,
            requires_military=requires_military,
            requires_position=requires_position,
            requires_altitude=requires_altitude,
            requires_speed=requires_speed,
            target_icao=target_icao,
            target_callsign_prefix=target_callsign_prefix,
            target_squawk=target_squawk,
            compiled_regex=compiled_regex,
        )

    @staticmethod
    def _analyze_conditions(conditions: dict, *flags) -> None:
        """Analyze complex conditions for optimization hints."""
        # This is a simplified analysis - full implementation would
        # recursively check all nested conditions
        groups = conditions.get('groups', [])
        for group in groups:
            for cond in group.get('conditions', []):
                cond_type = cond.get('type')
                if cond_type == 'military':
                    flags[0] = True  # requires_military
                elif cond_type == 'distance':
                    flags[1] = True  # requires_position
                elif cond_type == 'altitude':
                    flags[2] = True  # requires_altitude
                elif cond_type in ('speed', 'vertical_rate'):
                    flags[3] = True  # requires_speed


class AlertRuleCache:
    """
    Two-level cache for alert rules (local memory + Redis).

    Features:
    - Local in-memory cache for fastest access
    - Redis cache for cross-worker consistency
    - Automatic invalidation via Django signals
    - Version-based cache coherency
    """

    REDIS_KEY = "alert:rules:cache"
    VERSION_KEY = "alert:rules:version"
    DEFAULT_TTL = 300  # 5 minutes

    def __init__(self):
        self._local_rules: List[CompiledRule] = []
        self._local_version: str = ""
        self._lock = Lock()
        self._redis = None
        self._initialized = False

    @property
    def redis(self):
        """Lazy-load Redis connection."""
        if self._redis is None:
            try:
                import redis
                redis_url = getattr(settings, 'REDIS_URL', 'redis://redis:6379/0')
                self._redis = redis.from_url(redis_url, decode_responses=True)
                self._redis.ping()
            except Exception as e:
                logger.warning(f"Redis not available for rule cache: {e}")
                self._redis = False
        return self._redis if self._redis else None

    def _get_current_version(self) -> str:
        """Get current cache version from Redis or generate one."""
        if self.redis:
            try:
                version = self.redis.get(self.VERSION_KEY)
                if version:
                    return version
            except Exception as e:
                logger.debug(f"Could not get cache version from Redis: {e}")
        return ""

    def _generate_version(self) -> str:
        """Generate a new cache version string."""
        return hashlib.md5(
            f"{datetime.utcnow().isoformat()}".encode()
        ).hexdigest()[:8]

    def get_active_rules(self, user_id: Optional[int] = None) -> List[CompiledRule]:
        """
        Get all active (enabled) rules from cache.

        Args:
            user_id: Optional user ID to filter by visibility

        Returns:
            List of CompiledRule instances
        """
        with self._lock:
            # Check if local cache is valid
            current_version = self._get_current_version()

            if self._local_version != current_version or not self._local_rules:
                # Refresh from database
                self._refresh_cache()

            rules = self._local_rules

        # Filter by visibility if user_id provided
        if user_id is not None:
            rules = [
                r for r in rules
                if r.visibility == 'public' or
                   r.visibility == 'shared' or
                   r.owner_id == user_id
            ]

        return rules

    def _refresh_cache(self) -> None:
        """Refresh the cache from database."""
        from skyspy.models import AlertRule

        try:
            # Try to get from Redis first
            if self.redis:
                cached_data = self.redis.get(self.REDIS_KEY)
                if cached_data:
                    try:
                        rules_data = json.loads(cached_data)
                        self._local_rules = [
                            self._deserialize_rule(r) for r in rules_data
                        ]
                        self._local_version = self._get_current_version()
                        logger.debug(f"Loaded {len(self._local_rules)} rules from Redis cache")
                        return
                    except (json.JSONDecodeError, KeyError) as e:
                        logger.warning(f"Invalid Redis cache data: {e}")

            # Fetch from database
            db_rules = AlertRule.objects.filter(enabled=True).select_related('owner')
            self._local_rules = [CompiledRule.from_db_rule(r) for r in db_rules]

            # Store in Redis
            if self.redis:
                try:
                    rules_data = [self._serialize_rule(r) for r in self._local_rules]
                    self.redis.setex(
                        self.REDIS_KEY,
                        self.DEFAULT_TTL,
                        json.dumps(rules_data)
                    )
                    new_version = self._generate_version()
                    self.redis.set(self.VERSION_KEY, new_version)
                    self._local_version = new_version
                except Exception as e:
                    logger.warning(f"Failed to store rules in Redis: {e}")
            else:
                self._local_version = self._generate_version()

            logger.debug(f"Refreshed rule cache with {len(self._local_rules)} rules")

        except Exception as e:
            logger.error(f"Failed to refresh rule cache: {e}")
            # Keep existing cache on error
            if not self._local_rules:
                self._local_rules = []

    def _serialize_rule(self, rule: CompiledRule) -> dict:
        """Serialize a CompiledRule for Redis storage."""
        return {
            'id': rule.id,
            'name': rule.name,
            'rule_type': rule.rule_type,
            'operator': rule.operator,
            'value': rule.value,
            'conditions': rule.conditions,
            'priority': rule.priority,
            'cooldown_seconds': rule.cooldown_seconds,
            'api_url': rule.api_url,
            'owner_id': rule.owner_id,
            'visibility': rule.visibility,
            'is_system': rule.is_system,
            'starts_at': rule.starts_at.isoformat() if rule.starts_at else None,
            'expires_at': rule.expires_at.isoformat() if rule.expires_at else None,
            'requires_military': rule.requires_military,
            'requires_position': rule.requires_position,
            'requires_altitude': rule.requires_altitude,
            'requires_speed': rule.requires_speed,
            'target_icao': rule.target_icao,
            'target_callsign_prefix': rule.target_callsign_prefix,
            'target_squawk': rule.target_squawk,
        }

    def _deserialize_rule(self, data: dict) -> CompiledRule:
        """Deserialize a CompiledRule from Redis storage."""
        starts_at = None
        expires_at = None

        if data.get('starts_at'):
            starts_at = datetime.fromisoformat(data['starts_at'])
            if timezone.is_naive(starts_at):
                starts_at = timezone.make_aware(starts_at)

        if data.get('expires_at'):
            expires_at = datetime.fromisoformat(data['expires_at'])
            if timezone.is_naive(expires_at):
                expires_at = timezone.make_aware(expires_at)

        # Recompile regex if needed
        compiled_regex = None
        if data.get('operator') == 'regex' and data.get('value'):
            try:
                compiled_regex = re.compile(data['value'], re.IGNORECASE)
            except re.error as e:
                logger.warning(f"Invalid regex pattern in rule {data.get('id')}: {data.get('value')} - {e}")

        return CompiledRule(
            id=data['id'],
            name=data['name'],
            rule_type=data.get('rule_type'),
            operator=data['operator'],
            value=data.get('value'),
            conditions=data.get('conditions'),
            priority=data['priority'],
            cooldown_seconds=data['cooldown_seconds'],
            api_url=data.get('api_url'),
            owner_id=data.get('owner_id'),
            visibility=data.get('visibility', 'private'),
            is_system=data.get('is_system', False),
            starts_at=starts_at,
            expires_at=expires_at,
            requires_military=data.get('requires_military', False),
            requires_position=data.get('requires_position', False),
            requires_altitude=data.get('requires_altitude', False),
            requires_speed=data.get('requires_speed', False),
            target_icao=data.get('target_icao'),
            target_callsign_prefix=data.get('target_callsign_prefix'),
            target_squawk=data.get('target_squawk'),
            compiled_regex=compiled_regex,
        )

    def invalidate(self) -> None:
        """
        Invalidate the cache, forcing a refresh on next access.

        Called via Django signal when rules are created/updated/deleted.
        """
        with self._lock:
            self._local_version = ""
            self._local_rules = []

        if self.redis:
            try:
                self.redis.delete(self.REDIS_KEY)
                new_version = self._generate_version()
                self.redis.set(self.VERSION_KEY, new_version)
            except Exception as e:
                logger.warning(f"Failed to invalidate Redis cache: {e}")

        logger.debug("Alert rule cache invalidated")

    def get_rule_by_id(self, rule_id: int) -> Optional[CompiledRule]:
        """Get a specific rule by ID from cache."""
        rules = self.get_active_rules()
        for rule in rules:
            if rule.id == rule_id:
                return rule
        return None

    def get_status(self) -> dict:
        """Get cache status information."""
        return {
            'cached_rules': len(self._local_rules),
            'cache_version': self._local_version,
            'redis_available': bool(self.redis),
        }


# Global singleton instance
rule_cache = AlertRuleCache()


def _connect_signals():
    """Connect Django signals for cache invalidation."""
    from skyspy.models import AlertRule

    @receiver(post_save, sender=AlertRule)
    def invalidate_on_save(sender, instance, **kwargs):
        """Invalidate cache when a rule is saved."""
        rule_cache.invalidate()
        logger.debug(f"Rule cache invalidated after save of rule {instance.id}")

    @receiver(post_delete, sender=AlertRule)
    def invalidate_on_delete(sender, instance, **kwargs):
        """Invalidate cache when a rule is deleted."""
        rule_cache.invalidate()
        logger.debug(f"Rule cache invalidated after delete of rule {instance.id}")


# Connect signals when module loads
# Note: This needs to happen after Django is ready, typically in apps.py
def setup_signals():
    """Call this from apps.py ready() method."""
    _connect_signals()
