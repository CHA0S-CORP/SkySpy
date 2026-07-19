# Public Deployment Checklist

Checklist for exposing SkySpy on the public internet. It complements
[11-deployment.md](11-deployment.md) (how to deploy) and
[03-authentication.md](03-authentication.md) (auth details) with the specific
hardening required when anonymous visitors can reach the app.

## 1. Authentication mode

- `AUTH_MODE` — choose deliberately:
  - `public` — anyone can view the dashboard (read-only). **AI features are still
    blocked for anonymous users** (see §3).
  - `hybrid` (default) — per-feature access via the `FeatureAccess` config.
  - `private` — login required for everything.
- Never leave `AUTH_MODE=public` assuming it also gates AI or system internals —
  those are handled separately below.

## 2. Secrets & core Django

- [ ] `DEBUG=False` (required; the app refuses to start in prod without a secret key).
- [ ] `DJANGO_SECRET_KEY` set to a unique random value.
- [ ] `JWT_SECRET_KEY` set to a **different** random value than `DJANGO_SECRET_KEY`.
- [ ] `ALLOWED_HOSTS` set to your real hostname(s), no wildcard.
- [ ] `CORS_ALLOWED_ORIGINS` = your dashboard origin(s) only (`CORS_ALLOW_ALL_ORIGINS`
      stays `False`).
- [ ] `CSRF_TRUSTED_ORIGINS` set if the SPA/admin is served from another origin
      (defaults to `CORS_ALLOWED_ORIGINS`).

## 3. AI / LLM features (auth + permission gated)

The assistant and chat endpoints require an **authenticated user with the
`assistant.view` permission — even when `AUTH_MODE=public`**. Anonymous visitors
cannot use the LLM (a cost/abuse vector).

- Permission granted by default to the `analyst`, `admin`, and `superadmin` roles
  (migration `0039_assistant_feature`); `viewer`/`operator` are excluded.
- Toggle the whole feature with `ASSISTANT_ENABLED`.
- Gate implemented by `CanUseAssistant` (`skyspy/auth/permissions.py`), applied to
  `/assistant/ask`, `/assistant/stream`, `/assistant/suggest`, and
  `/assistant/sessions/*`.
- **Ancillary LLM endpoints** are gated the same way via `CanUseLLM` (auth +
  `assistant.view`, no `ASSISTANT_ENABLED` requirement): `POST /aviation/explain/`,
  `GET /aviation/pireps/<id>/summary/`, `GET /acars/<id>/ai-summary/`,
  `GET /acars/<id>/ai-analysis/`, `GET /airframes/<icao>/flight-history/`,
  `POST /airframes/type-cards/generate/`. All are rate-limited too.
- Socket.IO namespaces already authenticate on connect and check per-topic
  permissions (`socketio/middleware/auth.py`, `namespaces/main.py`) — no change needed.

> **Dev vs prod:** all the auth gates and owner-scoping in §3–§4 are **relaxed when
> `DEBUG=True`** so local development works without logging in. They enforce only
> when `DEBUG=False` — which is required for any public deploy (§2). Never run a
> public instance with `DEBUG=True`.

## 4. Sensitive & expensive endpoints

Even in `public` mode these are protected:

- **System internals** — `/system/info` and `/metrics` require authentication.
  `/system/status` is reachable (it backs the public Statistics card) but strips
  feeder location, worker PID, scheduled tasks, connection counts, and antenna
  RSSI for anonymous callers. `/health` returns liveness only to anonymous callers.
- **External-fan-out lookups** — `/lookup/aircraft/<hex>` and `/lookup/opensky/<hex>`
  require authentication and are rate-limited (`external_lookup` scope). `/lookup/route`
  stays public but is rate-limited.
- **Audio** — upload / transcribe / match-airframes require authentication
  (transcription is an expensive workload).
- **Metrics scraping** — Prometheus must authenticate with an API key, or be
  isolated at the network layer.

### Throttle scopes (`API_THROTTLE_*`)

| Env var | Default | Applies to |
|---------|---------|-----------|
| `API_THROTTLE_ANON` | `600/minute` | all anonymous requests |
| `API_THROTTLE_USER` | `2000/minute` | all authenticated requests |
| `API_THROTTLE_AUTH` | `5/minute` | login/auth endpoints |
| `API_THROTTLE_UPLOAD` | `10/minute` | audio upload |
| `API_THROTTLE_EXTERNAL_LOOKUP` | `10/minute` | external DB / route lookups |
| `API_THROTTLE_WEATHER` | `30/minute` | METAR/TAF/PIREP/SIGMET/NEXRAD |
| `API_THROTTLE_GEODATA` | `60/minute` | geojson / terrain |

Analytics and stats endpoints are DB-backed and cached; they rely on the global
anon/user throttle rather than a dedicated scope.

## 5. HTTPS / transport (auto-enabled when `DEBUG=False`)

Behind a TLS-terminating reverse proxy, these apply automatically in production:

- `SECURE_PROXY_SSL_HEADER` trusts `X-Forwarded-Proto`.
- `SECURE_SSL_REDIRECT=True` (health checks are exempt) — override with
  `SECURE_SSL_REDIRECT=False` if TLS is handled entirely upstream.
- HSTS: `SECURE_HSTS_SECONDS=31536000`, include-subdomains + preload
  (override the `SECURE_HSTS_*` env vars to tune).
- Secure/HTTPOnly/SameSite cookies for session + CSRF.

## 6. SSO (optional)

See [03-authentication.md §OIDC](03-authentication.md) — set `OIDC_ENABLED=true`,
`OIDC_PROVIDER_URL`, client id/secret, register the callback redirect URI, and
add `OIDCClaimMapping` rows to map IdP groups to roles.

## 7. Final verification

```bash
# Django's own deployment audit
python manage.py check --deploy

# Confirm anonymous users are blocked from AI + sensitive endpoints (public mode)
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://<host>/api/v1/assistant/ask     # 403
curl -sS -o /dev/null -w '%{http_code}\n' https://<host>/api/v1/system/info               # 403
curl -sS https://<host>/api/v1/system/status | grep -c latitude                            # 0
curl -sS -o /dev/null -w '%{http_code}\n' https://<host>/health                            # 200
```
