# One image, one process: Fastify serves the API, the built web app and the ICS
# feed. No nginx — the app is small enough that a second process inside the
# container would buy nothing but moving parts.
#
# Nothing is compiled: Node 24 runs the backend's TypeScript directly via type
# stripping, and the database is `node:sqlite` rather than a native binding. So
# there is no build toolchain in either stage and no coupling to a Node ABI.

# ---------------------------------------------------------------------------
# Build stage — produces the web bundle only.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS builder

RUN corepack enable
WORKDIR /app

# Manifests first, so a source-only change reuses the install layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/backend/package.json apps/backend/

# --ignore-scripts: nothing here needs a postinstall, and the build stage is the
# one place an install runs with the full dev dependency tree.
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/

RUN pnpm --filter sage-burner-web build

# ---------------------------------------------------------------------------
# Runtime stage — backend source, production deps, and the built web app.
# ---------------------------------------------------------------------------
FROM node:24-alpine

RUN corepack enable
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/

RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Node runs these as-is; there is no dist/ to copy.
COPY packages/shared/src packages/shared/src
COPY apps/backend/src apps/backend/src
COPY apps/backend/drizzle apps/backend/drizzle

COPY --from=builder /app/apps/web/dist ./apps/web/dist

# The volume mount point. Created ahead of time and owned by `node` so the
# unprivileged user can write the database into it.
RUN mkdir -p /data && chown -R node:node /data /app

# Everything below runs as a normal user. The container holds contact details
# and allergies; there is no reason for it to be root, and an image that has
# never run as root cannot be talked into it by a bad mount.
USER node

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL=/data/sage-burner.sqlite \
    WEB_ROOT=/app/apps/web/dist

# Apache is the only hop that appends to X-Forwarded-For; Docker's port mapping
# is NAT, not an HTTP proxy, so it adds nothing. Trusting exactly one hop makes
# request.ip the real client address, and a client can only prepend to the
# header while Apache appends what it saw.
ENV TRUST_PROXY=1

ARG BUILD_SHA=unknown
ENV BUILD_SHA=${BUILD_SHA}

EXPOSE 3000

# Hits the app rather than the port, so a process that is up but not serving
# still counts as unhealthy. `start-period` covers migrating a fresh volume.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/version').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/backend/src/server.ts"]
