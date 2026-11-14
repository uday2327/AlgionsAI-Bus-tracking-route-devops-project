#!/bin/sh
set -eu

printf '%s\n' '[render] Starting Bus Booking API deployment'
printf '%s\n' '[render] Applying Prisma database migrations'
npx prisma migrate deploy

printf '%s\n' '[render] Seeding database (repeatable seed data)'
npm run db:seed

printf '%s\n' '[render] Starting Express API'
exec node src/server.js
