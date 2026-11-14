# Render deployment guide

This service can run on Render as a Docker web service and use Neon PostgreSQL as its database. The image's default command runs `scripts/render-start.sh`; do not replace it with a dashboard start command.

## 1. Create a Neon database

Create a PostgreSQL project and database in Neon. Copy its pooled or direct connection string from the Neon dashboard. Use the connection string for the production database, and keep it private. Do not commit it to the repository or paste it into logs.

## 2. Configure Render

Create or update a Render **Web Service** connected to this repository and configure:

- Branch: `main`
- Runtime: Docker
- Dockerfile Path: `./Dockerfile`
- Docker Context: `.`
- Environment: `production`
- Environment variable: `DATABASE_URL` set to the Neon connection string (including Neon-required TLS parameters, commonly `sslmode=require`)
- Health Check Path: `/health`

Render provides `PORT`; the server listens on `process.env.PORT`. `/health` is a liveness endpoint. `/ready` checks PostgreSQL connectivity and returns HTTP 503 when the database cannot be reached; it can also be used as a readiness probe where supported.

Remove any Render dashboard Docker Command or Start Command override that replaces the image command. The Dockerfile starts the script with `CMD ["sh", "./scripts/render-start.sh"]`.

## 3. Startup sequence

The container startup script uses the configured `DATABASE_URL` and stops on the first failure:

1. `npx prisma migrate deploy` applies checked-in migrations without resetting data.
2. `npm run db:seed` upserts the sample routes, trips, and seats.
3. `exec node src/server.js` starts Express as the container's main process.

The seed uses upserts. Existing seat records are not updated, so booked seats and bookings are not reset or deleted by repeated seed runs. Do not use the test database for this service.

## 4. Verify deployment

After Render reports the service as live, check:

- `https://algionsai-bus-tracking-route-devops-project.onrender.com/health` — expected HTTP 200.
- `https://algionsai-bus-tracking-route-devops-project.onrender.com/ready` — expected HTTP 200 with database connected.

A free Render instance may sleep when idle, so the first request can take time to wake it.

## 5. Troubleshooting

- **`npx`/Prisma command missing:** confirm the latest image was built from this Dockerfile and there is no Render command override. The production dependency stage explicitly installs the pinned Prisma CLI after pruning development packages.
- **Migration cannot connect:** confirm `DATABASE_URL` is set in the Render service environment, points to the Neon database, includes the correct password and TLS parameter, and is not a local Compose URL. Never share the credential in support messages or logs.
- **Migration error:** inspect Render deploy logs and verify the checked-in migration history is compatible with the existing database. Do not reset or drop the production database to resolve a deployment error.
- **Seed/startup failure:** inspect the first failing startup log line. The script uses `set -eu`, so later startup steps do not run after an error.
- **Health check fails:** check `/health` first, then `/ready`; a healthy process with unavailable PostgreSQL responds to `/health` but `/ready` returns 503.
- **Deploy still runs a shell command from the dashboard:** clear the Render Docker Command/Start Command override and redeploy so the Dockerfile CMD is used.
