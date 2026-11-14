#!/usr/bin/env sh
set -eu

backup_file=${1:-}
if [ -z "$backup_file" ] || [ ! -f "$backup_file" ]; then
  echo "Usage: scripts/restore.sh path/to/backup.dump" >&2
  exit 1
fi
echo "WARNING: this replaces the current application database contents."
docker compose exec -T db sh -c 'pg_restore --clean --if-exists --no-owner -U "$APP_DB_USER" -d "$POSTGRES_DB"' < "$backup_file"
docker compose exec -T db sh -c 'psql -U "$APP_DB_USER" -d "$POSTGRES_DB" -c '\''SELECT count(*) AS routes FROM "Route";'\'''
echo "Restore complete; inspect the count above and check /ready."
