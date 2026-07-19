#!/usr/bin/env bash
# Make the radar's data/map features publicly readable while keeping AI, system,
# admin, alerts and audio behind login (the "public radar, login for AI/admin"
# hybrid posture for radar.chaos.navy). Idempotent — safe to re-run.
#
# FeatureAccess defaults to read_access=authenticated after migration, so this
# must be (re)applied whenever the database is rebuilt. deploy.sh runs it once
# the stack is up.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=accept-new \
          -o UserKnownHostsFile="$SCRIPT_DIR/.known_hosts" -o ConnectTimeout=10)

# Data/map features that should be world-readable. Everything else (assistant,
# system, users, roles, alerts, audio, cannonball, services) stays gated.
PUBLIC_FEATURES="${PUBLIC_FEATURES:-aircraft safety history acars weather wildfires}"

ssh "${SSH_OPTS[@]}" "${VM_CIUSER}@${VM_IP}" \
  "cd ${REMOTE_DIR} && sudo docker compose -f docker-compose.yml -f deploy/proxmox/docker-compose.prod.yml exec -T api python manage.py shell" <<PY
from skyspy.models.auth import FeatureAccess
from django.core.cache import cache
feats = "${PUBLIC_FEATURES}".split()
n = FeatureAccess.objects.filter(feature__in=feats).update(read_access="public")
try:
    cache.clear()
except Exception:
    pass
print(f"set {n} features public: {feats}")
PY
