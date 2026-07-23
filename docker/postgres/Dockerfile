# Combined PostGIS + pgvector Postgres image.
#
# SkySpy needs BOTH extensions on one database:
#   - pgvector  — airframe-RAG embedding similarity search (AirframeDocument)
#   - postgis   — spatial box queries + clustering (docs/23-postgis-clustering-design.md)
#
# Neither upstream image ships the other extension, so we start from the working
# pgvector base (RAG already depends on it) and apt-install PostGIS from the PGDG
# repo the base image already configures. pgvector/pgvector:pg16 is Debian
# bookworm on top of postgres:16, so postgresql-16-postgis-3 is available.
FROM pgvector/pgvector:pg16

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        postgresql-16-postgis-3 \
        postgresql-16-postgis-3-scripts \
    && rm -rf /var/lib/apt/lists/*
