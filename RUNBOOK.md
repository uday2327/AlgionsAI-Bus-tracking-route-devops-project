# Operations runbook

## Deploy

1. Configure `.env` from `.env.example` and replace both local placeholder passwords.
2. On Windows, use Docker Desktop; on Ubuntu, install Docker Engine and the Compose plugin from Docker's official repository. Use `sudo docker compose` if the Ubuntu account does not have Docker socket access.
3. Run `docker compose up -d --build` (prefix it with `sudo` on Ubuntu).
4. Check `docker compose ps`, `docker compose logs -f api`, and `/health` plus `/ready` on `http://localhost:3000`.
5. For local TLS, create `nginx/ssl/server.crt` and `nginx/ssl/server.key` with `scripts/generate-local-cert.ps1` on Windows, or the OpenSSL command in README's Ubuntu deployment section. Run `docker compose --profile proxy up -d nginx` and browse to `https://localhost`. The self-signed certificate triggers a browser warning.

## Diagnose and recover

- `docker compose ps` shows service state and health.
- `docker compose logs --tail=100 api` and `docker compose logs --tail=100 db` show recent logs.
- `docker inspect --format='{{json .State.Health}}' CONTAINER_ID` inspects API health.
- Restart a failed service with `docker compose restart api` or `docker compose restart db`.
- `/health` means the API process is up; `/ready` also checks its database connection.
- To simulate a database outage, run `docker compose stop db`, inspect `/ready`, then recover with `docker compose start db`.
- To run the isolated integration suite, rebuild only when its source/dependencies change with `docker compose --profile test build test`, then run the cached image with `docker compose --profile test run --pull never --rm test`.

## Backup, restore, rollback

- Create a timestamped logical backup with `npm run backup` (PowerShell: `npm.cmd run backup`).
- Restore with `npm run restore -- backups/file.dump` (PowerShell: `npm.cmd run restore -- backups/file.dump`). This replaces database contents; make a separate backup first. Verify the route count and `/ready` afterward.
- Set `API_IMAGE` in `.env` to a previous immutable image tag (for example `ghcr.io/OWNER/REPO:sha-<commit>`), then run `docker compose pull api` and `docker compose up -d --no-build api` to roll back the API. Do not remove the database volume.
- Verify with `docker compose ps`, `/health`, `/ready`, and API logs.
