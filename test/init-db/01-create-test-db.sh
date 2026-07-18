#!/bin/sh
# Create the isolated database used by the api-test runner (POSTGRES_TEST_DB).
# The postgres image only creates POSTGRES_DB; tests must not share it with the
# dev stack (see docker-compose.test.yaml api-test DATABASE_URL).
set -e
TEST_DB="${POSTGRES_TEST_DB:-adsb_test}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE "$TEST_DB" OWNER "$POSTGRES_USER";
EOSQL
