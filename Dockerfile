FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN DATABASE_URL=postgresql://generate:generate@localhost:5432/generate npx prisma generate

FROM dependencies AS test
COPY src ./src
COPY tests ./tests
COPY jest.config.js eslint.config.js ./
CMD ["sh", "-c", "npx prisma migrate deploy && npm test"]

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --omit=optional

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package*.json ./
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node src ./src
COPY --chown=node:node scripts/render-start.sh ./scripts/render-start.sh
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "./scripts/render-start.sh"]
