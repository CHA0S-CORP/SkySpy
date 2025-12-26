#!/bin/bash
# Download OpenSky aircraft database
# Run this script to populate the local aircraft database for offline lookups
#
# Usage: ./download-opensky-db.sh [output_dir]
#
# The database is ~500MB compressed, ~2GB uncompressed

set -e

OUTPUT_DIR="${1:-/data/opensky}"
DB_URL="https://s3.opensky-network.org/data-samples/metadata/aircraft-database-complete-2025-08.csv"
DB_FILE="$OUTPUT_DIR/aircraft-database.csv"

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Check if database already exists
if [ -f "$DB_FILE" ]; then
    echo "Database already exists at $DB_FILE"
    echo "Size: $(du -h "$DB_FILE" | cut -f1)"
    echo "To re-download, delete the file first."
    exit 0
fi

echo "Downloading OpenSky aircraft database..."
echo "Source: $DB_URL"
echo "Destination: $DB_FILE"
echo ""

# Download with progress
if command -v curl &> /dev/null; then
    curl -L --progress-bar -o "$DB_FILE" "$DB_URL"
elif command -v wget &> /dev/null; then
    wget --show-progress -O "$DB_FILE" "$DB_URL"
else
    echo "Error: curl or wget required"
    exit 1
fi

# Verify download
if [ -f "$DB_FILE" ]; then
    SIZE=$(du -h "$DB_FILE" | cut -f1)
    LINES=$(wc -l < "$DB_FILE")
    echo ""
    echo "Download complete!"
    echo "Size: $SIZE"
    echo "Aircraft records: $((LINES - 1))"
else
    echo "Error: Download failed"
    exit 1
fi
