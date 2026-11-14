# Operations Runbook

This runbook covers local development and container operations for the bus booking API. Commands below are examples for Windows PowerShell unless marked Ubuntu. Expected output describes the normal result; it is not evidence that a step has already been run on this machine.

## 1. Prerequisites

**What:** Install the tools used by the containerized setup.
**When:** Before cloning or starting the project.

- Windows 10/11 with Docker Desktop using its WSL 2 backend, or an Ubuntu release supported by Docker Engine.
- Git.
- Docker Engine/Desktop and Docker Compose v2.
- Node.js 22 and npm for local lint/test commands.
- A terminal, plus Postman or curl for API requests.

Verify:

~~~powershell
git --version
node --version
npm --version
docker --version
docker compose version
docker info
~~~

**Expected:** Node reports 22.x and Docker info shows a running engine. If docker info reports a missing Docker Desktop named pipe or cannot contact the daemon, start Docker Desktop and wait until it says the engine is running before continuing. If Docker Desktop reports a WSL backend issue, inspect Docker Desktop WSL Integration and its Troubleshoot panel. Do not unregister a WSL distribution unless its data is backed up and that reset is intentional.

## 2. Clone and configure the environment

**What:** Create a local checkout and a private environment file.
**When:** First setup.

~~~powershell
git clone https://github.com/uday2327/AlgionsAI-Bus-tracking-route-devops-project.git
Set-Location .\AlgionsAI-Bus-tracking-route-devops-project
Copy-Item .env.example .env
notepad .env
~~~

Replace the example values for POSTGRES_ADMIN_PASSWORD and APP_DB_PASSWORD with new local secrets. APP_DB_PASSWORD should be URL-safe because Compose embeds it in DATABASE_URL. Do not paste secrets into documentation, Git, screenshots, or chat. .env is excluded by .gitignore.

Ubuntu equivalent:

~~~sh
git clone https://github.com/uday2327/AlgionsAI-Bus-tracking-route-devops-project.git
cd AlgionsAI-Bus-tracking-route-devops-project
cp .env.example .env
chmod 600 .env
nano .env
~~~

**Expected:** .env exists locally and contains changed passwords; Git status does not list it. The initialization script runs only for a new PostgreSQL data directory. Changing POSTGRES_ADMIN_PASSWORD later does not rotate credentials in an existing volume. Changing APP_DB_PASSWORD later also requires rotating the actual PostgreSQL role password to keep the URL and stored credential aligned.

## 3. Validate Compose configuration

**What:** Render and validate Compose configuration before startup.
**When:** After editing .env or Compose configuration.

~~~powershell
docker compose config --quiet
~~~

**Expected:** The command exits successfully without printing validation errors. It may print warnings for unset optional values depending on Compose version. Never print the rendered config into a public log if it contains secrets.

## 4. Deploy the application

**What:** Build and start PostgreSQL, migration, and API services.
**When:** First run or after changing application files/Dockerfile.

~~~powershell
docker compose up -d --build
docker compose ps
~~~

Ubuntu can prefix the Docker commands with sudo if required.

**Expected:** db becomes healthy, migrate exits with code 0, and api becomes healthy. API startup runs the sample seed script before listening on port 3000. PostgreSQL is reachable only on the private Compose network; the API is bound to 127.0.0.1 on the host.

If startup fails, inspect db, migrate, and api logs before repeating the deployment. Do not remove the PostgreSQL volume to resolve a startup problem.

## 5. Migration and sample data

**What:** Apply checked-in Prisma migrations and ensure sample data exists.
**When:** Normally handled during first Compose startup; use these commands for deliberate operator maintenance.

~~~powershell
docker compose run --rm migrate
docker compose exec api npm run db:seed
~~~

The migration service waits for a healthy database and executes prisma migrate deploy. The seed script upserts three routes and creates trips/seats for two dates relative to the seed run. A seeded seat is marked BOOKED to demonstrate both seat states.

**Expected:** Migration completes successfully. Seed prints a completion message. It is safe to run seed again for sample records; it does not reset existing seat statuses.

## 6. Run the isolated integration tests

**What:** Build and run Jest/Supertest using the dedicated test database.
**When:** Before sharing a code change or after modifying API/schema behavior.

~~~powershell
docker compose --profile test build test
docker compose --profile test run --pull never --rm test
~~~

**Expected:** Prisma deploys the test migrations, Jest reports seven passing tests, and the command exits 0. The setup resets the dedicated test database before each test. Never point TEST_DATABASE_URL at the normal application database.

For direct Node development, install dependencies and generate Prisma Client:

~~~powershell
npm.cmd ci
npx.cmd prisma generate
npm.cmd run lint
~~~

Direct integration tests additionally require TEST_DATABASE_URL to target a separate database whose name ends with _test. The Compose path supplies this configuration automatically.

## 7. Health and readiness checks

**What:** Check that the API process responds and that PostgreSQL is reachable.
**When:** After deployment, restart, or recovery.

~~~powershell
Invoke-RestMethod http://localhost:3000/health
Invoke-RestMethod http://localhost:3000/ready
docker compose ps
~~~

**Expected:** Liveness returns status ok. Readiness returns status ready and database connected. Compose shows db and api healthy; migrate should have exited successfully. If API_PORT was changed, use that port in the URL.

Health and readiness differ: /health checks the process response; /ready makes a database query and returns HTTP 503 while PostgreSQL is unavailable.

## 8. Inspect logs and restart services

**What:** Read recent JSON output or restart a service.
**When:** Health checks fail, behavior is unexpected, or a code/image update is deployed.

~~~powershell
docker compose logs --tail=100 api
docker compose logs --tail=100 db
docker compose logs --tail=100 migrate
docker compose logs -f api
docker compose restart api
~~~

**Expected:** API logs include JSON request records with timestamp, method, path, status, and duration, along with JSON errors/startup/shutdown events. Exit the follow mode with Ctrl+C. Restarting the API does not remove the database volume.

If the API repeatedly restarts, check API logs and confirm migrations completed and the DB is healthy. If DB logs show initialization/password errors and the volume already existed, do not delete the volume; verify the active credentials and recover with a planned database procedure.

## 9. Failure detection and recovery exercise

**What:** Demonstrate detection of a database outage and recovery.
**When:** During a planned local verification window only.

~~~powershell
docker compose stop db
Invoke-WebRequest http://localhost:3000/ready
docker compose start db
docker compose ps
Invoke-RestMethod http://localhost:3000/ready
~~~

While db is stopped, readiness should return HTTP 503. Invoke-WebRequest may raise a PowerShell exception for that expected non-2xx response; inspect the response status if needed. Start db again and wait until it is healthy; readiness should return 200.

A safe application-only restart is:

~~~powershell
docker compose restart api
Invoke-RestMethod http://localhost:3000/health
Invoke-RestMethod http://localhost:3000/ready
~~~

Do not simulate an outage on a shared or production database without an approved maintenance window.

## 10. Optional Nginx and local HTTPS

**What:** Generate an untrusted local certificate and start the proxy profile.
**When:** When checking the optional Nginx path locally.

~~~powershell
.\scripts\generate-local-cert.ps1 -HostName localhost
docker compose --profile proxy up -d nginx
docker compose ps
curl.exe -k https://localhost/health
~~~

The helper runs an OpenSSL container and writes local certificate files under nginx/ssl. The files are ignored by Git. curl uses -k because the self-signed certificate is not trusted. Browsers show a warning for the same reason. This is not a public TLS setup.

For a real domain, an operator must provision a trusted certificate, configure the matching Nginx hostname, protect the private key, configure DNS/firewall, and renew certificates. Those steps are not a deployment implemented by this repository.

## 11. Create a database backup

**What:** Write a PostgreSQL custom-format logical dump to backups/.
**When:** Before planned database changes or a restore exercise.

~~~powershell
npm.cmd run backup
Get-ChildItem .\backups\*.dump
~~~

The wrapper runs pg_dump -Fc inside the db container and writes a timestamped file. **Expected:** the script prints a backup path and the file exists with nonzero size. Keep an additional protected copy outside the checkout; backups/ is ignored by Git. A generated local archive exists, but its integrity has not been verified.

Ubuntu/shell wrapper:

~~~sh
sh scripts/backup.sh
~~~

## 12. Restore a database backup

**What:** Replace matching application database objects/data from a dump and query the restored Route count.
**When:** Only for a planned restore/recovery exercise after a separate current backup has been saved.

> Restore uses pg_restore --clean and can replace existing data. Confirm the chosen file and database first. Do not proceed without a separate backup of the current state.

~~~powershell
npm.cmd run backup
Get-Item .\backups\your-backup.dump
npm.cmd run restore -- backups\your-backup.dump
Invoke-RestMethod http://localhost:3000/ready
Invoke-RestMethod http://localhost:3000/api/routes
~~~

**Expected:** restore exits 0, prints a Route count and a completion message; readiness succeeds and API data matches the intended backup. If pg_restore exits nonzero, preserve the backup and current logs, and do not repeatedly retry with different files against the same database.

Restore is implemented but has not been demonstrated for this repository.

## 13. Roll back an API image

**What:** Pin API to a previously published immutable GHCR tag.
**When:** An API release causes a failure and an older, compatible image tag has been verified in GHCR.

First inspect the GHCR package and confirm the older SHA tag exists and is a known-good version. The reviewed run confirms tag sha-c7a042d6ce277d38e4dc1e85f132cabe8040727f exists; it is not an older rollback target if that is the version currently deployed. The audit did not verify an earlier tag.

Set API_IMAGE in .env to the complete image name and previously verified older SHA tag. If the package is private, authenticate with an appropriately scoped GitHub token using Docker's interactive login; never put the token into a command or file committed to Git.

~~~text
API_IMAGE=ghcr.io/uday2327/algionsai-bus-tracking-route-devops-project:sha-REPLACE_WITH_VERIFIED_OLDER_SHA
~~~

After replacing the sample suffix with a real tag that you confirmed in GHCR:

~~~powershell
docker compose pull api
docker compose up -d --no-build api
docker compose ps
Invoke-RestMethod http://localhost:3000/health
Invoke-RestMethod http://localhost:3000/ready
docker compose logs --tail=100 api
~~~

**Expected:** Compose reports api healthy and both endpoints succeed. This rolls back the API image only; it does not reverse database migrations. Check that the old application version is compatible with the current schema. Rollback is documented but not yet demonstrated.

## 14. Common incidents

| Incident | Checks and response |
|---|---|
| Docker daemon unavailable | Start Docker Desktop/Engine and wait for the engine-ready state; then run docker info |
| PostgreSQL not healthy | Inspect docker compose ps and db logs; verify credentials and existing-volume history |
| Migration exits nonzero | Inspect migrate logs and DB readiness; do not delete the database volume |
| API readiness is 503 | Check API and DB status/logs; confirm DATABASE_URL uses hostname db inside Compose |
| Host port collision | Set API_PORT to an unused port in .env and recreate API |
| Invalid booking | Check positive IDs, passenger fields, actual trip date, and route stops |
| Booking returns 409 | Seat may already be BOOKED or another request won; select an AVAILABLE seat |
| Browser certificate warning | Expected for local self-signed TLS; trusted CA is required for public hostname |
| Backup/restore command fails | Check Docker engine, DB health, file path, free space, and role permissions; preserve original dump |

## 15. Safe shutdown

**What:** Stop project containers while preserving database data.
**When:** Ending a local session or preparing maintenance.

~~~powershell
docker compose down
docker compose ps
~~~

**Expected:** project containers and network are removed; postgres_data remains and will be reused on next startup. Do not run docker compose down -v for routine shutdown; it deletes the database volume.

## 16. Current verification status

The GitHub Actions run [43605440309](https://github.com/uday2327/AlgionsAI-Bus-tracking-route-devops-project/actions/runs/43605440309) succeeded for validation and image publication. It verifies the CI test/build/publish workflow for the recorded commit. The local Docker engine was unavailable during the previous audit, so local Compose startup, health checks, Nginx, backup integrity, restore, and rollback are not represented as completed operational evidence. Run the procedures above and retain logs/screenshots when you verify them.
