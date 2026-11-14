#!/usr/bin/env sh
set -eu

: "${APP_DB_USER:?APP_DB_USER is required}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
  --set=app_user="$APP_DB_USER" --set=app_password="$APP_DB_PASSWORD" \
  --set=app_db="$POSTGRES_DB" --set=app_db_test="${POSTGRES_DB}_test" <<'SQL'
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password';
ALTER DATABASE :"app_db" OWNER TO :"app_user";
CREATE DATABASE :"app_db_test" OWNER TO :"app_user";
SQL
