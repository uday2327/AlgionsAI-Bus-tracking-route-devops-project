# System Architecture

This document describes the checked-in implementation. The API is a small bus trip and seat reservation service; it is not a complete consumer booking website. The diagrams distinguish required local services from optional profiles.

## 1. Scope and request flow

The API supports routes, trips, seats, booking creation/retrieval, cancellation, and health/readiness checks. A client may call the API directly through the host loopback port or use the optional Nginx proxy. Nginx is not a mandatory local request path.

~~~mermaid
flowchart TB
    CLIENT["Postman / API client"]
    subgraph COMPOSE["Docker Compose environment"]
      subgraph BACKEND["Private bridge network: backend"]
        NGINX["Optional Nginx proxy profile<br/>host ports 80 and 443"]
        API["API container<br/>Node.js + Express<br/>container port 3000"]
        PRISMA["Prisma Client<br/>inside API process"]
        DB[("PostgreSQL 16<br/>not published to host")]
        VOL[("Named volume<br/>postgres_data")]
        MIGRATE["One-shot migration container"]
        TEST["Optional test-profile container<br/>Jest + Supertest"]
        NGINX --> API
        API --> PRISMA --> DB
        DB --- VOL
        MIGRATE --> DB
        TEST --> DB
      end
    end
    CLIENT -->|"direct local API: 127.0.0.1:3000"| API
    CLIENT -. "optional HTTP/HTTPS through Nginx" .-> NGINX
    DB -. "must become healthy" .-> MIGRATE
    MIGRATE -. "must complete before API" .-> API
    API -. "seed command runs before listener" .-> DB
~~~

A direct request reaches the Express route, controller validation, then Prisma Client. Prisma sends SQL to PostgreSQL over Compose's backend network. Nginx forwards requests to the API when its profile is enabled. The database has no host-published port.

## 2. Components

| Component | Implementation | Responsibility |
|---|---|---|
| API | src/app.js, src/server.js | Express routes, JSON handling, health endpoints, server lifecycle |
| Controllers | src/controllers/apiController.js | Input validation, queries, response status codes |
| Booking service | src/services/bookingService.js | Serializable seat-claim and cancellation transactions |
| Prisma | src/config/database.js, prisma/schema.prisma | PostgreSQL client, data model and migration interface |
| Database | db service in docker-compose.yml | PostgreSQL 16.16 Alpine; private network and persistent volume |
| Initialization | docker/postgres/init-app-user.sh | Creates app role, assigns app DB ownership, creates test DB |
| Migration | migrate service | Waits for healthy DB and runs prisma migrate deploy |
| Seed | prisma/seed.js | Adds/upserts sample route, trip, and seat data before API startup |
| Tests | tests/api.test.js, test profile | Runs Jest/Supertest against a dedicated database ending in _test |
| Proxy | nginx/nginx.conf, proxy profile | HTTP redirect, TLS listener, proxy to api:3000 |
| CI | .github/workflows/ci-cd.yml | Validates code and publishes images to GHCR on eligible pushes |

The test service is an optional profile; it is not part of the normal API startup. The test database is created by the PostgreSQL initialization script and is separate from the application database.

## 3. CI/CD flow

~~~mermaid
flowchart TB
    EVENT["Pull request or push to main / v* tag"]
    EVENT --> VALID["validate job"]
    subgraph VALIDATION["GitHub Actions validation"]
      CHECKOUT["Checkout + Node 22"]
      INSTALL["npm ci"]
      GENERATE["Prisma generate"]
      LINT["ESLint"]
      DB["PostgreSQL 16 test service"]
      MIGRATE["Prisma migrate deploy"]
      TEST["Jest + Supertest"]
      AUDIT["Production audit gate<br/>full audit best effort"]
      BUILD["Docker build"]
      SCAN["Trivy high/critical scan<br/>informational exit code"]
      CHECKOUT --> INSTALL --> GENERATE --> LINT --> MIGRATE --> TEST --> AUDIT --> BUILD --> SCAN
      DB --> MIGRATE
    end
    VALID --> PUBLISH["publish job<br/>only main/tag push after validation"]
    PUBLISH --> GHCR[("GitHub Container Registry")]
    GHCR --> TAGS["SHA tag, version tag,<br/>latest on default branch"]
~~~

The workflow is triggered by pull requests, pushes to main, and v-prefixed tags. Pull requests run validation but do not publish. The publish job requires successful validation and runs only for a push to main or a version tag. It uses the repository's GITHUB_TOKEN with packages: write permission.

Security status is nuanced: npm audit --omit=dev --omit=optional is a blocking production dependency check. The full npm audit step uses continue-on-error. Trivy scans CRITICAL and HIGH findings, ignores unfixed issues, and sets exit-code to 0. These two checks can report findings without failing the job. A successful workflow therefore does not establish that the full development dependency tree or image has zero findings.

The workflow publishes a container image; there is no job that deploys it to a remote host.

## 4. Data model

~~~mermaid
erDiagram
    ROUTE ||--o{ TRIP : serves
    TRIP ||--o{ SEAT : contains
    TRIP ||--o{ BOOKING : has
    SEAT ||--o{ BOOKING : reserved_in
    ROUTE {
      int id PK
      string source
      string destination
      string boardingStop
      string dropStop
    }
    TRIP {
      int id PK
      int routeId FK
      string busName
      date travelDate
      string departureTime
    }
    SEAT {
      int id PK
      int tripId FK
      string seatNumber
      enum status
    }
    BOOKING {
      int id PK
      string pnr UK
      int tripId FK
      int seatId FK
      string passengerName
      string passengerPhone
      enum status
    }
~~~

| Model | Relationships and constraints |
|---|---|
| Route | Unique source/destination pair; can have many trips |
| Trip | References a Route; unique route/date/bus tuple; indexed by route/date |
| Seat | References a Trip; unique seatNumber per trip; status AVAILABLE or BOOKED |
| Booking | References a Trip and Seat; PNR unique; status CONFIRMED or CANCELLED |

A seat can have multiple historical booking records because cancelled bookings remain in the database. Current seat status and the transaction ensure only one active reservation is created for that seat at a time. The Booking model does not have a database-level unique constraint on an active booking per seat; prevention is implemented in the service transaction.

## 5. Booking and cancellation sequence

~~~mermaid
sequenceDiagram
    participant C as Client
    participant E as Express controller
    participant S as Booking service
    participant P as Prisma transaction
    participant D as PostgreSQL
    C->>E: POST /api/bookings
    E->>E: Validate fields, date and stops
    E->>S: Create booking input
    S->>D: Find trip and verify route/date
    S->>P: Begin serializable transaction
    P->>D: Find seat for selected trip
    P->>D: Update seat where status is AVAILABLE
    alt Exactly one seat claimed
      P->>D: Insert confirmed booking with unique PNR
      D-->>P: Booking created
      P-->>S: Commit
      S-->>C: 201 booking response
    else Seat unavailable or serialization conflict
      P-->>S: Roll back transaction
      S-->>C: 409 Conflict
    end
    Note over C,D: Cancellation updates booking and releases seat in one transaction
~~~

The seat update is conditional on AVAILABLE state. A second request cannot successfully claim a row already marked BOOKED. Serialization conflicts are translated to HTTP 409. Cancellation similarly requires a CONFIRMED booking, marks it CANCELLED, and makes its seat AVAILABLE inside the same transaction.

## 6. Network, ports, and persistence

| Service | Container port | Host exposure |
|---|---:|---|
| API | 3000 | 127.0.0.1:API_PORT, defaults to 127.0.0.1:3000 |
| PostgreSQL | 5432 | Not published; Compose backend network only |
| Nginx HTTP | 80 | Host port 80 when proxy profile is enabled |
| Nginx HTTPS | 443 | Host port 443 when proxy profile is enabled |

Compose uses a bridge network named backend. The API connects to database hostname db inside that network. Host-side tools use localhost only when connecting through an explicitly published host port; PostgreSQL has none in this configuration. The named postgres_data volume persists database files across normal container stop/recreation. docker compose down preserves the volume; docker compose down -v deletes it.

The API service waits for a healthy database and successful migration job. Its startup command runs the seed script, then starts the server. The Compose API health check polls /ready; the Dockerfile default health check polls /health. PostgreSQL health uses pg_isready.

## 7. Security boundaries

- PostgreSQL is not published on a host interface.
- The API host port is bound to loopback by default. Nginx is the host-facing optional profile.
- The Docker runtime uses the non-root node user and production dependencies.
- .env, database dumps, and TLS private keys are excluded from Git; .env.example contains placeholders.
- The application role owns the application database, simplifying schema migration but not providing strict least privilege.
- Local certificates are self-signed and untrusted. A public service requires a trusted CA certificate, correct hostname/DNS, protected private key, firewall controls, and deliberate deployment configuration.
- GitHub Actions scans do not constitute proof of zero vulnerabilities.

## 8. Reliability, health, and recovery

GET /health confirms that the Express process responds. GET /ready runs a database query; it returns 200 when connected and 503 when unavailable. JSON request logs include timestamp, level, method, path, response status, and duration. Errors and server lifecycle events are also logged as JSON.

Compose restart policies cover the long-running db, api, and nginx services. The migration job is one-shot and should be diagnosed from its logs if it exits unsuccessfully. The runbook describes safe status checks, restart, backup, restore, and image rollback. Those procedures are implemented/documented but local restore and rollback execution have not been verified.

## 9. Verified evidence and remaining checks

A successful GitHub Actions run is available at [run #1](https://github.com/uday2327/AlgionsAI-Bus-tracking-route-devops-project/actions/runs/43605440309). Its validate and publish jobs succeeded for commit c7a042d. The reported GHCR image is ghcr.io/uday2327/algionsai-bus-tracking-route-devops-project with tags latest and sha-c7a042d6ce277d38e4dc1e85f132cabe8040727f; reported digest sha256:1fc477a58c02ed32e079d50a0e7f5c6b6fe8ab5219939b327be7e7a430d2d4f0.

The successful CI run verifies the pipeline and its tests/build/publication for that commit. It is not proof of a local Compose deployment, public service, successful restore, or previous-image rollback. The local Docker engine was unavailable during the audit.
final commit to chnage here 