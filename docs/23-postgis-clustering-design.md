# 23 — PostGIS Conditional Clustering & Spatial Box Queries (Design)

**Status:** PR1 (PostGIS foundation + spatial box queries for reference geodata)
**implemented**; PR2 (persist live positions + conditional aircraft clustering
via `ST_ClusterDBSCAN`) still pending. Captures the plan for issue #12 ("make the
map use conditional clustering and spatial box queries with PostGIS").

**PR1 as shipped:** combined PostGIS + pgvector DB image
(`docker/postgres/Dockerfile`); `django.contrib.gis` + PostGIS engine; `geom`
columns (geography Point on airports/navaids/pireps/wildfires, geometry
MultiPolygon on airspace) dual-written beside lat/lon; migrations
`0046_enable_postgis` + `0047_spatial_geom_columns` (backfill); radius filters
rewritten to `geom__dwithin` in `mixins/aviation_data.py`, `api/aviation.py`,
`services/geodata.py` (also fixed the REST cos(lat) gap). Airspace containment
via `geom__contains` is available but not yet wired into `turbulence.py` (deferred).

## Why

Today SkySpy uses **no PostGIS**:

- No `django.contrib.gis` in `INSTALLED_APPS`; the DB engine is plain
  `django.db.backends.postgresql` (the image is `pgvector/pgvector:pg16` for the
  airframe-RAG embeddings, not PostGIS).
- **Live aircraft** are held in an in-memory TTL cache (`services/cache.py`),
  never queried from the DB on the hot path. The map/list are fed from that
  cache through the Socket.IO stream.
- **Reference geodata** (airports, navaids, airspace, cached GeoJSON) lives in
  ordinary tables and is filtered with plain `latitude__range` / `longitude__range`
  bounding-box queries (see `socketio/namespaces/mixins/aviation_data.py`, now
  with a `cos(lat)` correction).

This works for one feeder / a few thousand aircraft, but:

- Bounding-box filtering is a flat-earth approximation (no true great-circle
  distance, no antimeridian handling).
- There is **no server-side clustering** — at low zoom the client receives every
  point and the browser (Leaflet) clusters. Fine at current volume; it does not
  scale to dense multi-feeder / wide-area views.
- "Which aircraft are inside this airspace polygon?" is not answerable in SQL.

## Scope of the change

Two capabilities:

1. **Spatial box queries** — replace lat/lon range filters with true geometry
   (`geom__within=bbox`, `geom__distance_lte`) backed by a GIST index.
2. **Conditional clustering** — at low zoom return server-side *clusters*
   (centroid + count) instead of raw points; at high zoom return raw points
   inside the viewport bbox.

## Database / Django wiring

1. **Image:** swap Postgres for one that has **both** pgvector and PostGIS
   (airframe RAG still needs pgvector). Options: build a combined image
   (`postgis/postgis` + `CREATE EXTENSION vector`) or `pgvector/pgvector` +
   `CREATE EXTENSION postgis`. Both extensions coexist. Update all compose files
   + the RPi notes.
2. `INSTALLED_APPS += ["django.contrib.gis"]`; DB `ENGINE =
   "django.contrib.gis.db.backends.postgis"`.
3. **Migration** `CREATE EXTENSION IF NOT EXISTS postgis;` (RunSQL, reversible).
4. Add a geometry column to the spatially-queried models
   (`CachedAirport`, `CachedNavaid`, and any persisted aircraft-position table):
   `geom = gis_models.PointField(geography=True, srid=4326, null=True)` +
   `GistIndex(fields=["geom"])`. Backfill `geom = Point(lon, lat)` in a data
   migration; keep the existing `latitude`/`longitude` columns for
   serialization/back-compat.

## Spatial box queries

```python
from django.contrib.gis.geos import Polygon
bbox = Polygon.from_bbox((min_lon, min_lat, max_lon, max_lat))  # srid 4326
qs = CachedAirport.objects.filter(geom__within=bbox)
# radius: geography PointField → metres
qs = CachedNavaid.objects.filter(geom__distance_lte=(center, D(nm=radius)))
```

Replaces the hand-rolled `cos(lat)` bbox math with index-accelerated, correct
geometry (incl. antimeridian when the bbox is built correctly).

## Conditional clustering

The map view already knows its **zoom** and **viewport bbox**. Thread both into
the aircraft/geodata request (Socket.IO request payload + REST query params) and
branch server-side:

- **High zoom (≥ threshold, e.g. z ≥ 9):** return raw points within the bbox —
  same shape clients render today.
- **Low zoom (< threshold):** aggregate. Two viable approaches:
  - **Grid snap (cheap, no PostGIS needed):** bucket points to a zoom-derived
    grid cell (`round(lat/cell)`, `round(lon/cell)`), return one marker per cell
    with a count. Pure Python over the in-memory cache — works for the hot-path
    aircraft *without persisting positions*.
  - **`ST_ClusterDBSCAN` (PostGIS, for persisted/geodata layers):**
    ```sql
    SELECT ST_ClusterDBSCAN(geom, eps := :eps, minpoints := 1) OVER () AS cid,
           geom
    FROM cached_airport WHERE geom && :bbox;
    ```
    then group by `cid` → centroid (`ST_Centroid(ST_Collect(geom))`) + count.
    `eps` scales with zoom.

Response shape (both modes) — a `clustered` flag so the client picks marker vs
cluster-bubble rendering:

```json
{ "clustered": true,
  "clusters": [{"lat": 47.9, "lon": -122.0, "count": 34, "bbox": [...]}] }
```

## The hot-path trade-off (decide before implementing)

Live aircraft are **cache, not DB**. Two paths:

- **A — Cluster in Python over the cache (recommended first step).** The
  low-zoom grid-snap clustering runs on the in-memory `current_aircraft` set. No
  writes, no PostGIS needed for aircraft, no hot-path DB load. PostGIS is then
  used only for the *reference geodata* box queries + airspace-containment.
- **B — Persist positions to a PostGIS table and cluster in SQL.** Enables
  `ST_ClusterDBSCAN` and "aircraft inside airspace polygon" in SQL, but adds a
  write on every position batch (the cold-path 5s DB writer already exists and
  could carry `geom`). Higher write load; only worth it if SQL-side spatial
  analytics on live traffic become a real requirement.

**Recommendation:** ship **A** (Python clustering for live aircraft + PostGIS box
queries/containment for geodata & airspace) first; treat **B** as a later step
gated on a concrete need for SQL analytics over live positions.

## Rollout / risks

- Extension swap touches every compose file + CI DB image — verify pgvector
  (airframe RAG) still loads alongside PostGIS.
- `geography=True` distance is metres and slower than `geometry` planar; fine at
  this scale, revisit if profiling shows hot-path cost.
- Keep lat/lon columns during transition (dual-write) so serializers/tests don't
  break; drop only after everything reads `geom`.
- New env: `MAP_CLUSTER_ZOOM_THRESHOLD`, `MAP_CLUSTER_EPS_BASE` — document in
  `settings.py`, `.env.test`, `.env.example`, and the root `CLAUDE.md` per the
  "adding env vars" rule.

## Verification (when built)

- `manage.py shell`: `CachedAirport.objects.filter(geom__within=bbox).count()`
  matches the old range-filter count.
- Map at low zoom returns `clustered:true` with plausible counts; zooming past
  the threshold flips to raw points.
- `EXPLAIN ANALYZE` confirms the GIST index is used (not a seq scan).
- Existing aviation-layer + socket tests stay green.
