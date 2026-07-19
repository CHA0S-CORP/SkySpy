#!/usr/bin/env bash
# Generate the production .env for the VM from local .env.test (carrying the
# adsblol / airframes-ACARS / Watch Duty / OpenAIP values + creds) and layering
# prod overrides + freshly generated secrets on top. Output is gitignored.
#
# Env inputs:
#   SRC_ENV                 (default: repo .env.test)
#   CLOUDFLARE_TUNNEL_TOKEN (required)
#   OIDC_ENABLED            (default: False — flipped True once Azure creds land)
#   OIDC_PROVIDER_URL / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET (optional, for OIDC)
#   ADMIN_PASSWORD          (default: generated; printed at the end)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

SRC_ENV="${SRC_ENV:-$REPO_ROOT/.env.test}"
OUT_ENV="${OUT_ENV:-$SCRIPT_DIR/.env}"
[ -f "$SRC_ENV" ] || { echo "source env $SRC_ENV not found" >&2; exit 1; }
: "${CLOUDFLARE_TUNNEL_TOKEN:?export CLOUDFLARE_TUNNEL_TOKEN=<tunnel token>}"

gen_secret() { openssl rand -hex 32; }
DJANGO_SECRET_KEY="$(gen_secret)"
JWT_SECRET_KEY="$(gen_secret)"
POSTGRES_PASSWORD="$(openssl rand -hex 16)"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)}"

# Keys we own in the override block — strip any copies coming from .env.test so
# the appended values are authoritative (and dev-only pointers don't leak).
STRIP='^(DEBUG|DEV_MODE|AUTH_MODE|LOCAL_AUTH_ENABLED|DJANGO_SECRET_KEY|JWT_SECRET_KEY|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|DATABASE_URL|REDIS_URL|DJANGO_SETTINGS_MODULE|ALLOWED_HOSTS|CORS_ALLOWED_ORIGINS|CSRF_TRUSTED_ORIGINS|DJANGO_SUPERUSER_USERNAME|DJANGO_SUPERUSER_EMAIL|DJANGO_SUPERUSER_PASSWORD|OIDC_[A-Z_]+|CLOUDFLARE_TUNNEL_TOKEN|SECURE_SSL_REDIRECT)='

{
  echo "# ============================================================"
  echo "# SkySpy PROD env for radar.chaos.navy — GENERATED, DO NOT COMMIT"
  echo "# Base values carried from .env.test; prod overrides appended below."
  echo "# ============================================================"
  grep -vE "$STRIP" "$SRC_ENV"

  cat <<EOF

# ---------------- PROD OVERRIDES (generated) ----------------
DEBUG=False
DEV_MODE=False
DJANGO_SETTINGS_MODULE=skyspy.settings
AUTH_MODE=hybrid
LOCAL_AUTH_ENABLED=True

DJANGO_SECRET_KEY=${DJANGO_SECRET_KEY}
JWT_SECRET_KEY=${JWT_SECRET_KEY}

POSTGRES_USER=adsb
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=adsb

ALLOWED_HOSTS=radar.chaos.navy,skyspy,${VM_IP},localhost,127.0.0.1
CORS_ALLOWED_ORIGINS=https://radar.chaos.navy
CSRF_TRUSTED_ORIGINS=https://radar.chaos.navy

DJANGO_SUPERUSER_USERNAME=admin
DJANGO_SUPERUSER_EMAIL=melona380@gmail.com
DJANGO_SUPERUSER_PASSWORD=${ADMIN_PASSWORD}

# Cloudflare named tunnel connector token
CLOUDFLARE_TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}

# Azure OIDC (SSO). Enabled once app-registration creds are provided.
OIDC_ENABLED=${OIDC_ENABLED:-False}
OIDC_PROVIDER_NAME=Azure
OIDC_PROVIDER_URL=${OIDC_PROVIDER_URL:-}
OIDC_CLIENT_ID=${OIDC_CLIENT_ID:-}
OIDC_CLIENT_SECRET=${OIDC_CLIENT_SECRET:-}
OIDC_SCOPES=openid profile email
OIDC_DEFAULT_ROLE=viewer
EOF
} > "$OUT_ENV"

# This Compose build interpolates env_file values, so escape any literal `$` in
# a value as `$$` (Compose un-doubles it back). Without this a secret like a
# Watch Duty password containing `$word` gets blanked in the container.
python3 - "$OUT_ENV" <<'PY'
import re,sys
p=sys.argv[1]; s=open(p).read()
open(p,"w").write(re.sub(r'(?<!\$)\$(?!\$)', '$$', s))
PY

chmod 600 "$OUT_ENV"
echo "wrote $OUT_ENV"
echo "ADMIN_PASSWORD=${ADMIN_PASSWORD}"
# Persist the admin password locally (gitignored) so it survives re-runs.
printf '%s\n' "$ADMIN_PASSWORD" > "$SCRIPT_DIR/.admin_password"
chmod 600 "$SCRIPT_DIR/.admin_password"
