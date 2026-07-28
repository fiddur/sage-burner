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

# The cache purge is part of the same layer, so corepack's downloaded pnpm
# (~24MB) never lands in the image — which watchtower re-pulls on every deploy.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts \
 && rm -rf /root/.cache

# Node runs these as-is; there is no dist/ to copy.
COPY packages/shared/src packages/shared/src
COPY apps/backend/src apps/backend/src
COPY apps/backend/drizzle apps/backend/drizzle

COPY --from=builder /app/apps/web/dist ./apps/web/dist

# The volume mount point, and the only thing the app needs to write. /app stays
# root-owned and world-readable: `node` can read its own code and dependencies
# but cannot modify them, and a recursive chown here would rewrite every copied
# file into a fresh layer — roughly doubling the image, which watchtower re-pulls
# on every deploy.
RUN mkdir -p /data && chown node:node /data

# Everything below runs as a normal user. The container holds contact details
# and allergies; there is no reason for it to be root, and an image that has
# never run as root cannot be talked into it by a bad mount.
USER node

# These are properties of the image itself, and each fails safe: HOST must be
# 0.0.0.0 to be reachable inside Docker at all, and the two paths point at what
# this image actually contains.
#
# TRUST_PROXY is deliberately NOT set here. It describes the topology in front
# of the container, which the image cannot know — and getting it wrong fails
# open: with a hop count and no appending proxy, `request.ip` becomes whatever
# the client claims. The default of trusting nothing stands, and whoever knows
# what is in front declares it (see docker-compose.yml).
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL=/data/sage-burner.sqlite \
    WEB_ROOT=/app/apps/web/dist

ARG BUILD_SHA=unknown
ENV BUILD_SHA=${BUILD_SHA}

EXPOSE 3000

# Hits the app rather than the port, so a process that is up but not serving
# still counts as unhealthy. `start-period` covers migrating a fresh volume.
#
# busybox wget rather than `node -e`: this runs every 30 seconds forever on a
# small box that is also serving SQLite, and spawning a full Node runtime
# (~50MB RSS) for a one-line HTTP GET is a poor trade. wget exits non-zero on a
# non-2xx response, which is the property the check needs.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/version" || exit 1

CMD ["node", "apps/backend/src/server.ts"]
