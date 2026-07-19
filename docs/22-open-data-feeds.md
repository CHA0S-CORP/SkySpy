---
title: Feeding with Open Data (No Hardware)
slug: open-data-feeds
category:
  uri: getting-started
position: 4
privacy:
  view: public
---

# 📡 Feeding SkySpy with Open Data (No Hardware)

> Run the full platform with **real** aircraft and ACARS traffic — no SDR, no
> antenna, no receiver. SkySpy pulls from keyless community APIs.

---

## 🎯 When to use this

SkySpy is built for a **local ADS-B receiver** (Ultrafeeder/readsb/dump978).
That is still the best source: lowest latency, no rate limits, full coverage of
your own antenna's range. But you can run the whole stack against **open public
data** instead when you:

- Don't own an SDR/receiver yet and want to evaluate SkySpy on real traffic
- Run a public demo or hosted deployment with no antenna
- Want ACARS in the UI without VHF hardware

Two independent open sources cover the two data planes:

| Data plane | Open source | Setting | Coverage |
|:-----------|:------------|:--------|:---------|
| Aircraft positions | adsb.lol / adsb.fi / airplanes.live | `AIRCRAFT_STREAM_MODE=adsblol` | Anywhere (radius ≤ 250 nm around feeder) |
| ACARS / VDL2 messages | airframes.io firehose | `AIRFRAMES_ACARS_ENABLED=True` | Nationwide feed, filtered to a metro/radius |

> ⚠️ **These are shared community resources.** They are keyless and free — keep
> your poll rates polite (defaults are already tuned) and don't point a
> high-traffic public deployment at them without a token. UAT/978 stays
> simulated in this mode.

---

## ✈️ Aircraft positions — adsb.lol community feed

`AIRCRAFT_STREAM_MODE=adsblol` polls keyless community ADS-B APIs (readsb schema)
for all aircraft within a radius of your feeder location, then feeds them through
the same normalize → broadcast → store pipeline as a real receiver. The map,
list, safety monitor, and alerts all work exactly as they would with hardware.

### Minimal `.env`

```bash
# Where to center the query (also used for distance/range analytics)
FEEDER_LAT=33.9416
FEEDER_LON=-118.4085

# Pull positions from the keyless community feed instead of a local receiver
AIRCRAFT_STREAM_MODE=adsblol
```

That's it — no `ULTRAFEEDER_HOST` needed. Start the stack (`docker compose up -d`)
and aircraft appear on the map within seconds.

### Tuning

| Variable | Default | Notes |
|:---------|:--------|:------|
| `AIRCRAFT_STREAM_MODE` | `sse` | Set to `adsblol` for the open feed. Other modes: `sse`/`tcp` (local receiver), `adsbx` (RapidAPI, keyed), `auto` |
| `AIRCRAFT_STREAM_ADSBLOL_RADIUS` | `250` | Query radius in nautical miles around `FEEDER_LAT/LON`. **Max 250** (API limit) |
| `AIRCRAFT_STREAM_ADSBLOL_INTERVAL` | `2` | Poll interval (s). Community guideline is ≤ 1 req/s per source — **keep ≥ 2** |
| `AIRCRAFT_STREAM_FREE_SOURCES` | `adsb.lol,adsb.fi,airplanes.live` | Sources round-robined per poll. Rotating spreads per-IP rate limits; a `429` from one skips to the next. A full URL template with `{lat}`/`{lon}`/`{radius}` is also accepted |

> 💡 **Why three sources?** Each poll hits a different endpoint in rotation, so
> no single community API sees more than one request every few seconds even at a
> 2 s interval. Leave all three enabled unless one is down.

### Verify it's working

```bash
# Aircraft should be flowing
curl http://localhost:8000/api/v1/aircraft/ | head

# Watch the poller
docker compose logs -f api | grep -i adsblol
```

---

## 📻 ACARS — airframes.io open firehose

The [ACARS guide](./14-acars.md) assumes SDR hardware (acarsdec/dumpvdl2 → UDP).
With no radio, enable the **airframes.io** source instead: `run_acars` polls the
public firehose, keeps only the ground stations near a metro/center you choose,
and ingests them through the **same** normalize/dedupe/store/broadcast path as
the UDP listener. The History → ACARS tab then shows real datalink traffic.

### Minimal `.env`

```bash
ACARS_ENABLED=True
AIRFRAMES_ACARS_ENABLED=True
# Defaults filter to the LAX metro. Change the center + radius for your area.
AIRFRAMES_ACARS_CENTER_LAT=33.9416
AIRFRAMES_ACARS_CENTER_LON=-118.4085
AIRFRAMES_ACARS_RADIUS_NM=100
```

Then run the listener (or add the `acars` compose profile):

```bash
docker compose exec api python manage.py run_acars
# verify
curl http://localhost:8000/api/v1/acars/status/   # -> "running": true
```

### Tuning

| Variable | Default | Notes |
|:---------|:--------|:------|
| `AIRFRAMES_ACARS_ENABLED` | `False` | Master switch for the open ACARS source |
| `AIRFRAMES_ACARS_URL` | `https://api.airframes.io/v1/messages` | Firehose endpoint |
| `AIRFRAMES_ACARS_API_KEY` | *(empty)* | Optional. Keyless works today; a feeder key raises the rate limit |
| `AIRFRAMES_ACARS_POLL_INTERVAL` | `4` | Poll cadence (s). The newest-100 window spans only ~5 s, so **keep low**; the 30 s dedupe cache absorbs overlap. Min 2 |
| `AIRFRAMES_ACARS_AIRPORTS` | LAX metro ICAOs | Comma-separated ICAOs — keep stations whose nearest airport is in this list. Empty = radius filter only |
| `AIRFRAMES_ACARS_CENTER_LAT` / `_LON` | LAX | Center for the radius filter. **Not** `FEEDER_LAT/LON` — airframes coverage is nationwide, so you filter it down explicitly |
| `AIRFRAMES_ACARS_RADIUS_NM` | `100` | Keep stations within this many nm of the center. `0` disables the radius filter |

> 📘 **Why filter?** The firehose is a national aggregate. Without the
> airport/radius filter you'd ingest messages from receivers thousands of miles
> away. Set the center to your area (or wherever you want to watch) and the two
> filters (airport list **OR** radius) narrow it down.

> ⚠️ **Keyless quirk:** the community firehose occasionally returns transient
> `404`s. `run_acars` retries; this is expected, not a misconfiguration.

---

## 🧪 Prefer synthetic data for local dev?

If you just want to click around without touching any external API, `make dev`
runs a **mock feeder** with synthetic traffic — see the [Quick Start](./00-quick-start.md#-development-mode).
You can also point the mock feeder at a live open source (`MOCK_DATA_SOURCE=live`
in `.env.test`) to replay real aircraft through the dev stack. This open-data
guide is for **production/hosted** runs where you want real data with no hardware.

---

## 📚 Related

| Document | Why |
|:---------|:----|
| [Quick Start](./00-quick-start.md) | Full 5-minute setup |
| [Configuration](./02-configuration.md) | All environment variables |
| [ACARS](./14-acars.md) | ACARS pipeline, message formats, hardware path |
| [Deployment](./11-deployment.md) | Production hardening |
