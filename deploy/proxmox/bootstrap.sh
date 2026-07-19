#!/usr/bin/env bash
# Runs ON the VM (piped in over SSH by deploy.sh). Installs Docker Engine +
# compose plugin and prepares the app dir. Idempotent.
set -euo pipefail

REMOTE_DIR="${1:-/opt/skyspy}"

echo "[bootstrap] apt prerequisites"
sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl rsync >/dev/null

if ! command -v docker >/dev/null 2>&1; then
  echo "[bootstrap] installing docker via get.docker.com"
  curl -fsSL https://get.docker.com | sudo sh
else
  echo "[bootstrap] docker already present: $(docker --version)"
fi

echo "[bootstrap] enabling docker + adding $USER to docker group"
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER" || true

echo "[bootstrap] preparing ${REMOTE_DIR}"
sudo mkdir -p "$REMOTE_DIR"
sudo chown -R "$USER":"$USER" "$REMOTE_DIR"

echo "[bootstrap] done"
