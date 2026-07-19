#!/usr/bin/env bash
# Provision the SkySpy VM on Proxmox using the REST API only (no SSH to the pve
# host, so no FIDO/hardware-key touch). Clones template 9000, sets cloud-init,
# resizes the disk, boots, and waits for the guest agent to report the IP.
#
# Requires: PVE_TOKEN exported, a deploy SSH public key at $SSH_KEY.pub.
# Idempotency: if VM_ID already exists this aborts (safety) — destroy it first.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

log() { printf '\033[1;36m[provision]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[provision] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[ -f "${SSH_KEY}.pub" ] || die "deploy pubkey ${SSH_KEY}.pub missing (run deploy.sh, which generates it)"

# --- Guard: refuse to clobber an existing VM ---
if pve GET "/nodes/${PVE_NODE}/qemu/${VM_ID}/status/current" >/dev/null 2>&1; then
  die "VM ${VM_ID} already exists on ${PVE_NODE}. Destroy it first or set VM_ID."
fi

# --- Wait for a PVE task (UPID) to finish ---
wait_task() {
  local upid="$1" status
  log "waiting for task ${upid} ..."
  while :; do
    status="$(pve GET "/nodes/${PVE_NODE}/tasks/${upid}/status" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["status"])')"
    [ "$status" = "stopped" ] && break
    sleep 3
  done
  local exitst
  exitst="$(pve GET "/nodes/${PVE_NODE}/tasks/${upid}/status" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"].get("exitstatus","?"))')"
  [ "$exitst" = "OK" ] || die "task ${upid} failed: ${exitst}"
}

# --- 1. Clone template -> VM_ID (full clone onto phoenix) ---
log "cloning template ${PVE_TEMPLATE_ID} -> ${VM_ID} (${VM_NAME}) on ${PVE_DATASTORE}"
UPID="$(pve POST "/nodes/${PVE_NODE}/qemu/${PVE_TEMPLATE_ID}/clone" \
  --data-urlencode "newid=${VM_ID}" \
  --data-urlencode "name=${VM_NAME}" \
  --data-urlencode "full=1" \
  --data-urlencode "storage=${PVE_DATASTORE}" \
  --data-urlencode "target=${PVE_NODE}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"])')"
wait_task "$UPID"

# --- 2. Configure CPU/RAM/cloud-init ---
log "configuring cores=${VM_CORES} memory=${VM_MEMORY} ip=${VM_IP}/${VM_CIDR}"
# Proxmox quirk: the sshkeys value must itself be URL-encoded (it gets HTTP-
# decoded once before the param parser), so pre-encode then let curl encode again.
PUBKEY_ENC="$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(open(sys.argv[1]).read().strip(),safe=''))" "${SSH_KEY}.pub")"
pve POST "/nodes/${PVE_NODE}/qemu/${VM_ID}/config" \
  --data-urlencode "cores=${VM_CORES}" \
  --data-urlencode "memory=${VM_MEMORY}" \
  --data-urlencode "agent=enabled=1" \
  --data-urlencode "onboot=1" \
  --data-urlencode "ciuser=${VM_CIUSER}" \
  --data-urlencode "sshkeys=${PUBKEY_ENC}" \
  --data-urlencode "nameserver=${VM_DNS}" \
  --data-urlencode "ipconfig0=ip=${VM_IP}/${VM_CIDR},gw=${VM_GW}" \
  --data-urlencode "tags=skyspy;terraform-free;docker" \
  --data-urlencode "description=SkySpy ADS-B stack (radar.chaos.navy) — API-provisioned" \
  >/dev/null

# --- 3. Grow the boot disk ---
log "resizing ${VM_DISK} to ${VM_DISK_SIZE}"
pve PUT "/nodes/${PVE_NODE}/qemu/${VM_ID}/resize" \
  --data-urlencode "disk=${VM_DISK}" \
  --data-urlencode "size=${VM_DISK_SIZE}" >/dev/null

# --- 4. Start ---
log "starting VM ${VM_ID}"
UPID="$(pve POST "/nodes/${PVE_NODE}/qemu/${VM_ID}/status/start" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"])')"
wait_task "$UPID"

# --- 5. Wait for guest agent to report the expected IP ---
log "waiting for guest agent @ ${VM_IP} (cloud-init first boot can take ~60-120s)"
for i in $(seq 1 60); do
  if pve GET "/nodes/${PVE_NODE}/qemu/${VM_ID}/agent/network-get-interfaces" 2>/dev/null \
      | grep -q "\"${VM_IP}\""; then
    log "VM ${VM_ID} is up at ${VM_IP}"
    exit 0
  fi
  sleep 5
done
die "timed out waiting for ${VM_IP} from guest agent (check console: qm terminal ${VM_ID})"
