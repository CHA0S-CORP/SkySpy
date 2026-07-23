#!/bin/sh
# Create the isolated database used by the api-test runner (POSTGRES_TEST_DB).
# The postgres image only creates POSTGRES_DB; tests must not share it with the
# dev stack (see docker-compose.test.yaml api-test DATABASE_URL).
set -e
TEST_DB="${POSTGRES_TEST_DB:-adsb_test}"

# When POSTGRES_DB already IS the test DB (e.g. the E2E stack sets
# POSTGRES_DB=adsb_test), the base image created it — creating it again aborts
# init under ON_ERROR_STOP and the container exits (3). Only create it when it
# differs, and idempotently (skip if it somehow already exists).
if [ "$TEST_DB" != "$POSTGRES_DB" ]; then
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
        SELECT 'CREATE DATABASE "$TEST_DB" OWNER "$POSTGRES_USER"'
        WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$TEST_DB')\gexec
EOSQL
fi
