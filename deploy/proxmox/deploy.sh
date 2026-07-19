#!/usr/bin/env bash
# One-shot orchestrator: provision the VM (API), generate the prod .env, install
# docker, sync the repo, and bring the stack up behind nginx + cloudflared.
#
# Required env:
#   PVE_TOKEN='professor_chaos@pve!skyspy=<secret>'
#   CLOUDFLARE_TUNNEL_TOKEN='<tunnel token>'
# Optional: SKIP_PROVISION=1 (VM already exists), OIDC_* (see gen-env.sh)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

log() { printf '\033[1;32m[deploy]\033[0m %s\n' "$*"; }

SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=accept-new \
          -o UserKnownHostsFile="$SCRIPT_DIR/.known_hosts" -o ConnectTimeout=10)
SSH="ssh ${SSH_OPTS[*]} ${VM_CIUSER}@${VM_IP}"

# --- 1. deploy keypair (no hardware key) ---
if [ ! -f "$SSH_KEY" ]; then
  log "generating deploy keypair $SSH_KEY"
  ssh-keygen -t ed25519 -N '' -C "skyspy-deploy" -f "$SSH_KEY" >/dev/null
fi

# --- 2. provision VM ---
if [ "${SKIP_PROVISION:-0}" != "1" ]; then
  log "provisioning VM ${VM_ID}"
  bash "$SCRIPT_DIR/provision.sh"
else
  log "SKIP_PROVISION=1 — assuming VM ${VM_ID} already up at ${VM_IP}"
fi

# --- 3. generate prod .env ---
log "generating prod .env"
bash "$SCRIPT_DIR/gen-env.sh"

# --- 4. wait for SSH ---
log "waiting for SSH on ${VM_IP}"
for i in $(seq 1 40); do
  if $SSH true 2>/dev/null; then break; fi
  sleep 5
  [ "$i" = 40 ] && { echo "SSH never came up" >&2; exit 1; }
done

# --- 5. bootstrap docker ---
log "bootstrapping docker on VM"
$SSH 'bash -s' "$REMOTE_DIR" < "$SCRIPT_DIR/bootstrap.sh"

# --- 6. sync repo ---
log "rsyncing repo -> ${VM_IP}:${REMOTE_DIR}"
rsync -az --delete \
  -e "ssh ${SSH_OPTS[*]}" \
  --exclude '.git' \
  --exclude '**/node_modules' \
  --exclude 'web/dist' \
  --exclude '.env.test' \
  --exclude 'deploy/proxmox/.env' \
  --exclude 'deploy/proxmox/.admin_password' \
  --exclude 'deploy/proxmox/id_ed25519*' \
  --exclude 'deploy/proxmox/.known_hosts' \
  --exclude '**/__pycache__' \
  --exclude '*.pyc' \
  --exclude '.venv' \
  "$REPO_ROOT/" "${VM_CIUSER}@${VM_IP}:${REMOTE_DIR}/"

# --- 7. drop the prod .env at the project root ---
log "installing .env"
scp "${SSH_OPTS[@]}" "$SCRIPT_DIR/.env" "${VM_CIUSER}@${VM_IP}:${REMOTE_DIR}/.env"

# --- 8. build + up (newgrp so the freshly-added docker group applies) ---
log "docker compose up --build (this builds the image; ~10-20 min first run)"
$SSH "cd ${REMOTE_DIR} && sudo docker compose -f docker-compose.yml -f deploy/proxmox/docker-compose.prod.yml --profile acars up -d --build"

log "applying public-radar feature access (data public, AI/admin gated)"
bash "$SCRIPT_DIR/set-public-features.sh" || log "warn: set-public-features failed (run it manually once api is up)"

log "stack status:"
$SSH "cd ${REMOTE_DIR} && sudo docker compose -f docker-compose.yml -f deploy/proxmox/docker-compose.prod.yml --profile acars ps"

log "done. admin password: $(cat "$SCRIPT_DIR/.admin_password")"
log "verify: curl -H 'Host: radar.chaos.navy' http://${VM_IP}/health/   then  https://radar.chaos.navy/"
