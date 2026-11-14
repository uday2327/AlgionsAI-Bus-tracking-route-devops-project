#!/usr/bin/env sh
set -eu

mkdir -p backups
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
output="backups/bus_booking_${timestamp}.dump"
docker compose exec -T db sh -c 'pg_dump -Fc -U "$APP_DB_USER" "$POSTGRES_DB"' > "$output"
echo "Backup created: $output"
