# SkySpy → Proxmox deploy (radar.chaos.navy)

Deploys the full SkySpy stack to a single Proxmox VM, fed by 3rd-party data
(adsblol aircraft + airframes.io ACARS + Watch Duty wildfires), in **hybrid
auth**, exposed via a **Cloudflare named tunnel** behind **nginx**.

## What it creates

- Proxmox VM `260` "skyspy" on node `pve` (4 vCPU / 8 GB / 250 GB on `phoenix`),
  cloned from template `9000`, static IP `10.42.252.60/22`.
- Docker stack: `postgres redis api celery-worker celery-beat acars-listener`
  (repo `docker-compose.yml`) + `skyspy` (nginx) + `cloudflared` (this overlay).

## Files

| File | Role |
|---|---|
| `config.sh` | Shared vars + `pve()` API helper |
| `provision.sh` | Clone/config/resize/start the VM via the PVE REST API (no pve-SSH) |
| `gen-env.sh` | Build prod `.env` from repo `.env.test` + overrides + generated secrets |
| `nginx.conf` | HTTP reverse proxy → `api:8000` (WS-aware, trusts `X-Forwarded-Proto`) |
| `docker-compose.prod.yml` | Overlay: `env_file` for feature vars + `skyspy`(nginx) + `cloudflared` |
| `bootstrap.sh` | Runs on the VM: install Docker + prep `/opt/skyspy` |
| `deploy.sh` | Orchestrates key → provision → env → bootstrap → rsync → compose up |

## Run

```bash
export PVE_TOKEN='professor_chaos@pve!skyspy=<secret>'
export CLOUDFLARE_TUNNEL_TOKEN='<tunnel token>'
# Azure OIDC (optional first pass — can be added later):
# export OIDC_ENABLED=True OIDC_PROVIDER_URL=... OIDC_CLIENT_ID=... OIDC_CLIENT_SECRET=...

./deploy.sh
```

Generated secrets land in `.env` / `.admin_password` (both gitignored). The admin
password is printed at the end.

## Azure OIDC + superadmin

Set the `OIDC_*` env before `gen-env.sh` (or edit `.env` and re-run compose up).
Register redirect URI `https://radar.chaos.navy/api/v1/auth/oidc/callback` in the
Azure app. Grant `maxw@chaos.com.co` superadmin via an `OIDCClaimMapping`:

```bash
sudo docker compose ... exec api python manage.py shell -c "
from skyspy.models.auth import OIDCClaimMapping, Role
r = Role.objects.get(name='superadmin')
OIDCClaimMapping.objects.update_or_create(
    name='max-superadmin',
    defaults=dict(claim_name='email', match_type='exact',
                  claim_value='maxw@chaos.com.co', role=r, priority=100, is_active=True))
"
```

## Verify

```bash
curl -H 'Host: radar.chaos.navy' http://10.42.252.60/health/   # 200
curl -sI https://radar.chaos.navy/                             # 200 via tunnel
curl -s https://radar.chaos.navy/api/v1/system/info            # 403 (hybrid gate)
```
