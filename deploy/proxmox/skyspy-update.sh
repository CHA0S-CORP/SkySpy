#!/usr/bin/env bash
# Release auto-updater — run by skyspy-update.timer. Polls GHCR for a new
# :latest digest of the SkySpy image; if it changed, pulls and recreates the
# app services. DB migrations re-run automatically via the api container's
# startup command. No-op when already current (cheap to run often).
set -euo pipefail

PROJECT_DIR="${SKYSPY_DIR:-/opt/skyspy}"
CTL="${SKYSPYCTL:-/usr/local/bin/skyspyctl}"
IMAGE="ghcr.io/cha0s-corp/skyspy:${SKYSPY_TAG:-latest}"
export SKYSPY_DIR="$PROJECT_DIR"

log() { printf '%s skyspy-update: %s\n' "$(date -u +%FT%TZ)" "$*"; }

# Local digest currently in use (empty on first run).
before="$(sudo docker image inspect "$IMAGE" --format '{{index .RepoDigests 0}}' 2>/dev/null || true)"

log "pulling ${IMAGE}"
"$CTL" pull api celery-worker celery-beat acars-listener >/dev/null 2>&1 || { log "pull failed"; exit 1; }

after="$(sudo docker image inspect "$IMAGE" --format '{{index .RepoDigests 0}}' 2>/dev/null || true)"

if [ "$before" = "$after" ] && [ -n "$before" ]; then
  log "already current (${after}); nothing to do"
  exit 0
fi

log "new image ${after} (was ${before:-none}) — recreating app services"
# Recreate only the app services; postgres/redis/nginx/cloudflared untouched.
"$CTL" up -d api celery-worker celery-beat acars-listener
log "prune old images"
sudo docker image prune -f >/dev/null 2>&1 || true
log "update complete"
