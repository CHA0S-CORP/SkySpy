#!/usr/bin/env bash
# Validate (and optionally export) the drf-spectacular OpenAPI schema.
#
# Usage:
#   check_schema.sh            # validate only, warnings are non-fatal
#   check_schema.sh --strict   # validate, exit non-zero on any warning
#   check_schema.sh --out FILE # also write the schema to FILE
#
# Used by `make docs-openapi` and the CI schema gate so both call one thing.
set -euo pipefail

cd "$(dirname "$0")/.."

OUT="/dev/null"
STRICT=0
args=("--validate")

while [ $# -gt 0 ]; do
    case "$1" in
        --strict) STRICT=1; args+=("--fail-on-warn") ;;
        --out) OUT="$2"; shift ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
    shift
done

python manage.py spectacular --file "$OUT" "${args[@]}"

if [ "$STRICT" -eq 1 ]; then
    echo "OpenAPI schema valid (strict: no warnings)."
else
    echo "OpenAPI schema validated (warnings, if any, are non-fatal)."
fi
