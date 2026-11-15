# Cloud Deployment & CI/CD — Bus Booking Platform

A backend API for bus trips and seat reservations, with containerization, CI validation, and GHCR image publishing.

**Role:** DevOps & Cloud Engineering<br>
**Organization:** ALGIONS AI LABS PRIVATE LIMITED<br>
**Repository:** https://github.com/uday2327/AlgionsAI-Bus-tracking-route-devops-project



## Business problem and scope

Bus operators need a reliable way to publish trips and seats and reserve seats without selling the same seat twice. The service validates reservations against a trip and route, atomically claims the seat, issues a unique PNR, and releases the seat on cancellation. It does not include a frontend, authentication, payments, bus tracking or dashboards.

## Technology

Node.js 22, Express 5, PostgreSQL 16, Prisma 6, Jest, Supertest, Docker Compose, GitHub Actions and Nginx. No Kubernetes, Terraform or paid cloud service is required.

## System Architecture

The Bus Booking Platform uses Node.js, Express, PostgreSQL, Prisma ORM, Docker Compose, Nginx and GitHub Actions. Its main components are the backend API, database, optional reverse proxy, and CI/CD workflow. Docker Compose coordinates the API, database, migration job and isolated test service. PostgreSQL data is stored in a named volume so it survives ordinary container restarts.

### 1. Application Architecture

Requests can reach the API through Nginx or, for local checks, through the loopback-bound API port. Express handles the request and Prisma Client, running inside the API process, communicates with PostgreSQL. The migration job must complete successfully before Compose starts the API; the test service connects to the dedicated test database.

```mermaid
flowchart TB
    USER["User / reviewer"] --> CLIENT["Postman / API client"]

    subgraph COMPOSE["Docker Compose environment"]
        subgraph NETWORK["Private Compose network"]
            NGINX["Nginx reverse proxy<br/>HTTP 80 / HTTPS 443"]
            API["Node.js + Express API<br/>container port 3000"]
            PRISMA["Prisma Client<br/>inside the API process"]
            DB[("PostgreSQL 16")]
            VOL[("Persistent volume<br/>postgres_data")]
            MIGRATE["Prisma migration job"]
            TEST["Jest + Supertest test service"]

            API --> PRISMA --> DB
            DB --- VOL
            MIGRATE --> DB
            TEST --> DB
        end
    end

    CLIENT -->|"HTTP / HTTPS"| NGINX
    NGINX --> API
    CLIENT -->|"Local access via 127.0.0.1:3000"| API
    MIGRATE -. "must complete successfully before API starts" .-> API
```

### 2. CI/CD Architecture

GitHub Actions validates pull requests and pushes to `main` or version tags. Validation installs dependencies, generates Prisma Client, runs ESLint, applies migrations to PostgreSQL, runs integration tests, audits dependencies, builds the Docker image and runs Trivy. After successful validation, pushes to `main` and version tags publish the image to GHCR. The full development-dependency audit and Trivy scan are configured as non-blocking checks; see the security notes below for the current audit findings.

```mermaid
flowchart TB
    DEV["Developer"] --> REPO["GitHub repository"]
    REPO --> INSTALL

    subgraph CI["GitHub Actions validation"]
        INSTALL["Install dependencies"] --> GENERATE["Prisma generate"]
        GENERATE --> LINT["ESLint"]
        LINT --> MIGRATE["Database migrations"]
        MIGRATE --> TESTS["Jest integration tests"]
        TESTS --> AUDIT["Dependency audits"]
        AUDIT --> BUILD["Docker build"]
        BUILD --> SCAN["Trivy scan"]
    end

    subgraph CD["Image release on main / version tag pushes"]
        PUBLISH["Publish image"] --> GHCR[("GitHub Container Registry")]
        GHCR --> DIGEST["Image tags and digest"]
    end

    SCAN -->|"successful validation on an eligible push"| PUBLISH
```

### 3. Database Architecture

The database has four primary entities:

- **Route:** source, destination and valid boarding/drop stops.
- **Trip:** bus name, route, travel date and departure time.
- **Seat:** trip seat number and availability status.
- **Booking:** passenger details, unique PNR and booking status.

```mermaid
erDiagram
    ROUTE ||--o{ TRIP : serves
    TRIP ||--o{ SEAT : contains
    TRIP ||--o{ BOOKING : records
    SEAT ||--o{ BOOKING : reserved_in
```

### 4. Booking Reliability

Booking claims an available seat with a conditional update inside a PostgreSQL transaction. Only the request that claims the seat can create a confirmed booking and receive a PNR; a conflict returns HTTP 409. Cancellation changes the booking status and releases the seat in the same transaction. See [ARCHITECTURE.md](ARCHITECTURE.md) for more data and concurrency details, and [RUNBOOK.md](RUNBOOK.md) for deployment and operational actions.

```text
src/{config,controllers,middleware,routes,services,utils}/  API implementation
prisma/schema.prisma                                      database models
prisma/migrations/                                        checked-in SQL migration
prisma/seed.js                                            repeatable sample data
tests/                                                    PostgreSQL integration tests
nginx/nginx.conf                                          HTTP redirect and TLS proxy
scripts/                                                  backup, restore, local TLS helper
.github/workflows/ci-cd.yml                               validation and image publishing
Dockerfile, docker-compose.yml                            runtime and local services
ARCHITECTURE.md, RUNBOOK.md                                design and operations
```

## Database and booking safety

`Route` has source, destination and valid boarding/drop stops. A `Trip` belongs to a route and has a date and departure time. `Seat` belongs to a trip and is unique by `(tripId, seatNumber)`. `Booking` has a unique PNR, passenger fields and CONFIRMED/CANCELLED status. Foreign keys and indexes are defined in Prisma and the migration.

The booking service claims a seat with a conditional `updateMany` (`status = AVAILABLE`) inside a serializable transaction. Only the transaction that claims the seat inserts a confirmed booking. A conflict returns HTTP 409; no failed reservation is committed. Cancellation conditionally updates the booking and releases the seat in one transaction.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Process liveness |
| GET | `/ready` | Database readiness |
| GET | `/api/routes` | List routes |
| GET | `/api/trips?routeId=1&travelDate=YYYY-MM-DD` | Search trips; filters optional |
| GET | `/api/trips/:id/seats` | List seat availability |
| POST | `/api/bookings` | Reserve a seat |
| GET | `/api/bookings/:pnr` | Retrieve ticket |
| PATCH | `/api/bookings/:pnr/cancel` | Cancel reservation |

Booking JSON example (uses the fixed test fixture; for a live booking, choose a seeded trip/seat from the API and use that trip's date and stops):

```json
{
  "tripId": 1,
  "seatId": 1,
  "passengerName": "Sample Passenger",
  "passengerPhone": "+919876543210",
  "travelDate": "2030-04-05",
  "boardingStop": "Test Board",
  "dropStop": "Test Drop"
}
```

Creation returns HTTP 201 with a 10-character PNR, status and associated trip/seat. Invalid fields/date/stops return 400; missing trip/seat/PNR returns 404; seat conflicts or duplicate cancellation return 409. Errors use `{ "error": "..." }`.

Example successful response (IDs, PNR and timestamp vary):

```json
{
  "id": 1,
  "pnr": "A1B2C3D4E5",
  "tripId": 1,
  "seatId": 1,
  "passengerName": "Sample Passenger",
  "passengerPhone": "+919876543210",
  "boardingStop": "Test Board",
  "dropStop": "Test Drop",
  "status": "CONFIRMED",
  "createdAt": "2026-11-13T22:00:00.000Z",
  "seat": { "id": 1, "tripId": 1, "seatNumber": "T01", "status": "BOOKED" },
  "trip": {
    "id": 1,
    "routeId": 1,
    "busName": "Test Coach",
    "travelDate": "2030-04-05T00:00:00.000Z",
    "departureTime": "09:00",
    "route": { "id": 1, "source": "Test City A", "destination": "Test City B", "boardingStop": "Test Board", "dropStop": "Test Drop" }
  }
}
```

## Local setup (PowerShell)

Prerequisites: Node.js 22, npm and Docker Desktop with Compose. Copy the example config and replace both placeholder passwords:

```powershell
Copy-Item .env.example .env
```

Use a URL-safe app password in `APP_DB_PASSWORD` and `DATABASE_URL`. Compose creates a private bootstrap administrator and a separate application role which owns the app database. Start the all-in-one deployment:

```powershell
docker compose up -d --build
docker compose ps
docker compose logs -f api
Invoke-RestMethod http://localhost:3000/health
Invoke-RestMethod http://localhost:3000/ready
```

Compose waits for PostgreSQL health, applies migrations in a one-shot migration container, then seeds data and starts the API. The API runtime image omits the Prisma CLI and development/test packages. The sample seed creates three routes, six trips over the next two UTC dates and twelve seats per trip. One seat per trip is marked BOOKED to demonstrate both states. Re-running seed is safe for sample rows.

To run the API directly on Windows, point `.env`'s `DATABASE_URL` to a separately running PostgreSQL instance and run:

```powershell
npm.cmd ci
npx.cmd prisma generate
npx.cmd prisma migrate deploy
npm.cmd run db:seed
npm.cmd run dev
```

`docker compose down` removes containers but preserves the named database volume. Do not use `down -v` for ordinary shutdown.

## Ubuntu deployment

These steps use Docker's official APT repository and the Compose plugin. Git and Docker packages can change over time; see the [Docker Engine Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/) for supported Ubuntu releases and any repository updates. Git is available from Ubuntu's package manager ([Git installation instructions](https://git-scm.com/install/linux.html)).

Install Git and Docker Engine on an Ubuntu release supported by Docker:

```sh
sudo apt update
sudo apt install -y ca-certificates curl git openssl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run hello-world
git --version
```

Clone the GitHub repository and configure its local environment. Use the repository URL shown at the top of this README. Keep the generated passwords URL-safe; hexadecimal values from `openssl rand -hex 24` are suitable for the Prisma connection string.

```sh
git clone https://github.com/uday2327/AlgionsAI-Bus-tracking-route-devops-project.git bus-booking-platform
cd bus-booking-platform
cp .env.example .env
nano .env
chmod 600 .env
sudo docker compose up -d --build
sudo docker compose ps
curl --fail http://localhost:3000/health
curl --fail http://localhost:3000/ready
```

Set new values for `POSTGRES_ADMIN_PASSWORD` and `APP_DB_PASSWORD` in `.env` before the first start. If Docker warns that the current user cannot access its socket, continue using `sudo docker`; membership in the `docker` group grants root-equivalent control.

For local HTTPS on Ubuntu, create an untrusted self-signed certificate and start the optional Nginx proxy:

```sh
mkdir -p nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/server.key -out nginx/ssl/server.crt \
  -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
chmod 600 nginx/ssl/server.key
sudo docker compose --profile proxy up -d nginx
curl -k --fail https://localhost/health
```

Browsers warn because this local certificate is not trusted. For a real domain, point DNS at the Ubuntu host, obtain a certificate from a trusted CA, place its full-chain certificate and private key at `nginx/ssl/server.crt` and `nginx/ssl/server.key`, then run `sudo docker compose --profile proxy up -d nginx`. Update `server_name` in `nginx/nginx.conf` to the domain. Protect the private key, exclude it from Git, and refresh the mounted certificate files and restart Nginx after each renewal. Permit inbound TCP 80 and 443 at the host/network firewall; PostgreSQL remains on Compose's private network and the API port binds to loopback.

To restart after a host reboot or application change, use `sudo systemctl status docker` and `sudo docker compose up -d`; the `unless-stopped` policy also restarts the API and database containers. Verify `sudo docker compose ps`, the two health URLs above, and `sudo docker compose logs --tail=100 api db`.

## Environment variables

| Variable | Purpose |
|---|---|
| `POSTGRES_DB`, `POSTGRES_ADMIN_USER`, `POSTGRES_ADMIN_PASSWORD` | Private PostgreSQL initialization account |
| `APP_DB_USER`, `APP_DB_PASSWORD` | Application database owner |
| `DATABASE_URL` | Prisma connection string (`db` hostname inside Compose) |
| `TEST_DATABASE_URL` | Dedicated Jest database; its name must end with `_test` |
| `PORT`, `API_PORT` | API listen and loopback host port |

Never commit `.env`, TLS private keys or database dumps. `.env.example` contains placeholders only.

## Migrations and tests

Integration tests clear and rebuild their fixture before each case. Do not point them at the sample-data database. The Compose bootstrap creates a separate `bus_booking_test` database. Build the test image after changing application/test files or dependencies, then run the already-built image without forcing another build:

```powershell
docker compose --profile test build test
docker compose --profile test run --pull never --rm test
```

The test container migrates that test database and runs Jest/Supertest inside an isolated container on the Compose network. The run command reuses `bus-booking-api:test`; it does not build or pull an image. For a directly installed PostgreSQL, create a dedicated database ending in `_test`, set `TEST_DATABASE_URL`, migrate it, then run `npm.cmd test`. Tests cover health/readiness, route/trip/seat queries, validation, booking, PNR lookup, cancellation and concurrent requests against one seat.

## CI and image releases

`.github/workflows/ci-cd.yml` runs on pull requests, pushes to `main`, and version tags. It installs locked dependencies, runs ESLint and PostgreSQL-backed Jest tests, audits dependencies, builds a commit-tagged Docker image and reports Trivy findings for high and critical image vulnerabilities. The image scan is informational; the production `npm audit` gate blocks on high-severity production dependency advisories. After validation, main/tag pushes publish SHA and release tags to GHCR using `GITHUB_TOKEN`. CI does not deploy. GitHub repository policy must allow Actions to write packages. A publish is confirmed only by a successful workflow and visible GHCR package.

For submission evidence, capture the green Actions run (including test summary), copy the published image's full commit tag and digest from the GHCR package page or `docker buildx imagetools inspect ghcr.io/uday2327/algionsai-bus-tracking-route-devops-project:sha-c7a042d6ce277d38e4dc1e85f132cabe8040727f`, and include those with the repository URL. A local build is not evidence of a GHCR publish.

### Successful GitHub Actions run

The initial CI and container release completed successfully, including validation and image publishing:

![Successful GitHub Actions run showing validation and publish jobs](image.png)

## Docker, Nginx and HTTPS

The API image uses a Node 22 slim base, a non-root user and a health check. Compose exposes the API on host loopback for local tests and keeps PostgreSQL on the internal network. The optional Nginx `proxy` profile exposes ports 80/443.

| Service | Port | Host reachability |
|---|---:|---|
| API | 3000/TCP | Loopback only (`127.0.0.1`) |
| PostgreSQL | 5432/TCP | Compose network only; not published to the host |
| Nginx HTTP | 80/TCP | Host interfaces when the `proxy` profile is enabled |
| Nginx HTTPS | 443/TCP | Host interfaces when the `proxy` profile is enabled |

To create a local self-signed certificate on Windows:

```powershell
./scripts/generate-local-cert.ps1
docker compose --profile proxy up -d nginx
```

Open `https://localhost`; the browser warns because the certificate is untrusted. For a public domain, use a certificate from a trusted CA, configure the real hostname and protect its private key outside Git. Expose only 80/443 at the host firewall.

## Health, logs and recovery

```powershell
docker compose ps
docker compose logs -f api
docker compose logs -f db
docker compose restart api
```

`/health` indicates the process responds. `/ready` queries PostgreSQL and returns 503 if unavailable. JSON logs include timestamp, method, path, status and duration; errors and startup/shutdown messages are JSON. Compose health checks and `unless-stopped` policies support detection and restart. See [RUNBOOK.md](RUNBOOK.md) for failure exercises.

## Backup and restore

Scripts use the app role already present in the Compose database container. Windows PowerShell can use the Node wrappers (no WSL needed):

```powershell
npm.cmd run backup
npm.cmd run restore -- backups/bus_booking_YYYYMMDDTHHMMSSZ.dump
```

The shell scripts are also available in WSL/Git Bash:

```sh
sh scripts/backup.sh
sh scripts/restore.sh backups/bus_booking_YYYYMMDDTHHMMSSZ.dump
```

Restore replaces database objects/data. Create a separate backup first. The script prints the restored route count; also verify `/ready` and `GET /api/routes`. Keep backup files in protected storage outside the repository.

## Rollback

Rollback requires an older, known-good immutable GHCR image tag that is visible in the package registry. The verified tag from the successful run is sha-c7a042d6ce277d38e4dc1e85f132cabe8040727f; it is not an older rollback target if that is the version currently running. No older tag has been verified in this audit.

Set API_IMAGE in .env to a previously verified older SHA tag, then pull and recreate the API. Replace the sample suffix only after confirming the tag exists in GHCR.

~~~text
API_IMAGE=ghcr.io/uday2327/algionsai-bus-tracking-route-devops-project:sha-REPLACE_WITH_VERIFIED_OLDER_SHA
~~~

~~~powershell
docker compose pull api
docker compose up -d --no-build api
docker compose ps
Invoke-RestMethod http://localhost:3000/health
Invoke-RestMethod http://localhost:3000/ready
~~~

This changes the API image only; it does not reverse database migrations. Confirm schema compatibility and verify health, readiness and logs. Rollback is documented but not demonstrated.
## Demo and evidence plan

In a 3-5 minute demo: (1) explain the architecture, (2) show the successful Actions run, (3) after local startup is verified, call health/readiness, (4) create a booking, show the duplicate 409, cancel and confirm release, and (5) show logs. Show restore or rollback only after the procedure has been successfully verified; otherwise disclose that the evidence is pending.

## Security and limitations

API and database container ports are not publicly bound; PostgreSQL is only on the Compose network. The API image omits development and optional dependencies. The 2026-11-14 production dependency audit (`npm audit --omit=dev --omit=optional`) found zero vulnerabilities. A compatible, non-forced audit update moved ESLint to 10.15.0 and its `minimatch` dependencies to 11.0.8, clearing the three moderate findings. The remaining full development audit reports 3 high and 6 low package findings. The high findings involve the Prisma CLI and @prisma/config dependency chain, including vulnerable deepmerge-ts; npm's available fix requires the breaking Prisma 7.10.1 upgrade. Jest 29.7.0's dependency tree also includes vulnerable `deepmerge` 4.3.1; npm only offers a breaking Jest downgrade to 25.1.0, so that change was not applied. CI runs the full audit on a best-effort basis while the production audit remains a gate. These findings are in development tooling, which is excluded from the production image. Local TLS is self-signed, and example passwords must be changed before deployment. No authentication, payment integration, seat pricing, partial-route allocations, production secret manager, remote cloud host or public trusted certificate is included. Seeded dates are relative to the day the seed runs.


## Assessment rubric mapping

The assessment categories total 100 marks. This table maps repository work to the rubric; it does not award marks or guarantee a score.

| Category | Marks | Evidence in this project | Reviewer verification |
|---|---:|---|---|
| Containerization and reproducibility | 20 | Dockerfile, docker-compose.yml, .dockerignore, .env.example | Inspect the files and run docker compose config and a clean local startup |
| CI/CD automation | 20 | .github/workflows/ci-cd.yml | Inspect the successful validation and publish run linked below |
| Deployment, networking and security | 15 | Compose private network, loopback API binding, optional Nginx, non-root runtime | Inspect config; local proxy and public deployment are not verified |
| Observability and troubleshooting | 15 | /health, /ready, JSON logs and service health checks | Run the endpoints and inspect local logs; failure exercise remains |
| Backup, restore and rollback | 15 | scripts/backup.js, scripts/restore.js, GHCR SHA tags | A backup was generated; restore and rollback have not been demonstrated |
| Reliability and documentation | 10 | Booking transactions, integration suite, README, ARCHITECTURE.md, RUNBOOK.md | Inspect implementation and successful CI validation |
| Domain API correctness | 5 | API controllers, booking service, Prisma schema and tests | CI test suite covers validation, cancellation, duplicate and concurrent booking |

## Acceptance criteria status

| Acceptance criterion | Status | Evidence or remaining check |
|---|---|---|
| Conflicting seat bookings fail safely | VERIFIED in GitHub CI | Duplicate and concurrent request tests passed in the successful validation run |
| Clean environment build and startup | NOT VERIFIED locally | CI built the image; local Compose startup was blocked by unavailable Docker engine |
| CI checks and versioned image | VERIFIED in GitHub | Validation and publish jobs succeeded; SHA image tag recorded below |
| Health, logs, failure detection and recovery | NOT VERIFIED locally | Code and Compose checks exist; local operational exercise remains |
| Backup restore or rollback evidence | NOT VERIFIED | Local backup artifact was generated; restore and rollback remain untested |

## Verified project evidence and remaining evidence

| Item | Current evidence |
|---|---|
| Repository | https://github.com/uday2327/AlgionsAI-Bus-tracking-route-devops-project |
| Successful GitHub Actions run | https://github.com/uday2327/AlgionsAI-Bus-tracking-route-devops-project/actions/runs/43605440309 |
| Successful run | Validate and publish jobs; commit c7a042d |
| GHCR image | ghcr.io/uday2327/algionsai-bus-tracking-route-devops-project |
| Published tags | latest and sha-c7a042d6ce277d38e4dc1e85f132cabe8040727f |
| Reported image digest | sha256:1fc477a58c02ed32e079d50a0e7f5c6b6fe8ab5219939b327be7e7a430d2d4f0 |
| Local deployment and endpoint screenshots | Not collected |
| Application logs and failure recovery evidence | Not collected locally |
| Backup artifact | Generated locally; integrity and restoration not verified |
| Restore and rollback evidence | Not available |
| Duplicate booking evidence | Covered by passing CI tests |
| Architecture/runbook documents | ARCHITECTURE.md and RUNBOOK.md |
| Demo video | Not recorded |

The supplied image above is a screenshot of the successful GitHub Actions run. The Actions link is the primary source for the pipeline record. A successful CI run does not prove local deployment, public availability, restore success, or rollback success.

## Remaining operator verification

1. Start Docker Desktop and confirm docker info works.
2. Copy .env.example to .env if needed, replace both example passwords, and keep the file private.
3. Run Compose startup, health/readiness checks, and the isolated integration suite.
4. Create and validate a fresh backup, then perform a planned restore test after preserving the current data.
5. Verify an older known-good image tag exists before attempting rollback.
6. Capture deployment, health, logs, backup/restore, and rollback evidence only after each succeeds; record the 3–5 minute demo.

See [RUNBOOK.md](RUNBOOK.md) for commands and expected results. Do not run docker compose down -v as an ordinary stop; it deletes the database volume.
made final change commit