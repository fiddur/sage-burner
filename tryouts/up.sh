#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"

TRYOUT_DIR="${TRYOUT_DIR:-/tmp/tryout}"
export TRYOUT_DIR
TRYOUT_PORT="${TRYOUT_PORT:-8082}"
STATE="${TRYOUT_DIR}/state.json"
PIDFILE="${TRYOUT_DIR}/server.pid"
LOGFILE="${TRYOUT_DIR}/server.log"
BASE_URL="http://127.0.0.1:${TRYOUT_PORT}"
DEMO_EMAIL="${DEMO_EMAIL:-demo@sage-burner.test}"

FRESH=no
for argument in "$@"; do
  case "${argument}" in
    --fresh) FRESH=yes ;;
    *)
      echo "❌ unknown argument ${argument} — the only flag is --fresh" >&2
      exit 2
      ;;
  esac
done

cd "${ROOT}"

WANTED_MAJOR="$(sed 's/^v//; s/\..*//' .nvmrc | tr -d '[:space:]')"
FOUND_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2> /dev/null || echo none)"
if [ "${FOUND_MAJOR}" != "${WANTED_MAJOR}" ]; then
  echo "❌ this rig needs node ${WANTED_MAJOR} (found $(node --version 2> /dev/null || echo 'no node'))." >&2
  echo "   In a cloud session: CLAUDE_CODE_REMOTE=true .claude/hooks/session-start.sh" >&2
  echo "   then export PATH=\"/opt/node${WANTED_MAJOR}/bin:\$PATH\" for every later command." >&2
  exit 1
fi

random() {
  node -e 'process.stdout.write(require("node:crypto").randomBytes(+process.argv[1]).toString(process.argv[2]))' \
    "$1" "$2"
}

state_field() {
  [ -f "${STATE}" ] || return 0
  node -e '
    const { readFileSync } = require("node:fs")
    try {
      const value = JSON.parse(readFileSync(process.argv[1], "utf8"))[process.argv[2]]
      if (typeof value === "string") process.stdout.write(value)
    } catch {}
  ' "${STATE}" "$1"
}

"${HERE}/down.sh"

mkdir -p "${TRYOUT_DIR}"
chmod 700 "${TRYOUT_DIR}"

if [ "${FRESH}" = yes ]; then
  echo "🧹 fresh run — dropping the old database, state and cookie"
  rm -f "${TRYOUT_DIR}"/sage-burner.sqlite* "${STATE}" "${TRYOUT_DIR}/token.txt"
fi

SESSION_SECRET="${SESSION_SECRET:-$(state_field sessionSecret)}"
[ -n "${SESSION_SECRET}" ] || SESSION_SECRET="$(random 48 base64)"
export SESSION_SECRET

DEMO_PASSWORD="$(state_field password)"
if [ -z "${DEMO_PASSWORD}" ]; then
  if [ -f "${TRYOUT_DIR}/sage-burner.sqlite" ]; then
    echo "❌ ${TRYOUT_DIR} has a database but no stored password, and create-admin never" >&2
    echo "   rewrites an existing one — so a new password would not sign in. Use --fresh." >&2
    exit 1
  fi
  DEMO_PASSWORD="$(random 16 hex)"
fi

echo "📦 installing dependencies"
pnpm install --frozen-lockfile

echo "🏗️  building the web app"
pnpm --filter sage-burner-web build

export NODE_ENV="${NODE_ENV:-production}"
export HOST="${HOST:-127.0.0.1}"
export PORT="${TRYOUT_PORT}"
export LOG_LEVEL="${LOG_LEVEL:-info}"
export DATABASE_URL="${TRYOUT_DIR}/sage-burner.sqlite"
export WEB_ROOT="${ROOT}/apps/web/dist"
BUILD_SHA="$(git -C "${ROOT}" rev-parse HEAD)"
export BUILD_SHA

echo "🌱 ensuring the demo admin ${DEMO_EMAIL}"
(
  cd apps/backend
  ADMIN_EMAIL="${DEMO_EMAIL}" ADMIN_PASSWORD="${DEMO_PASSWORD}" node src/cli/create-admin.ts
)

TRYOUT_STATE="${STATE}" \
  TRYOUT_BASE_URL="${BASE_URL}" \
  TRYOUT_EMAIL="${DEMO_EMAIL}" \
  TRYOUT_PASSWORD="${DEMO_PASSWORD}" \
  TRYOUT_SESSION_SECRET="${SESSION_SECRET}" \
  node -e '
    const { existsSync, readFileSync, writeFileSync } = require("node:fs")
    const path = process.env.TRYOUT_STATE
    const before = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}
    const after = {
      ...before,
      baseUrl: process.env.TRYOUT_BASE_URL,
      email: process.env.TRYOUT_EMAIL,
      password: process.env.TRYOUT_PASSWORD,
      sessionSecret: process.env.TRYOUT_SESSION_SECRET,
    }
    writeFileSync(path, JSON.stringify(after, null, 2) + "\n", { mode: 0o600 })
  '
chmod 600 "${STATE}"

echo "🚀 starting the server on ${BASE_URL}"
: > "${LOGFILE}"
nohup node apps/backend/src/server.ts >> "${LOGFILE}" 2>&1 &
SERVER_PID=$!
echo "${SERVER_PID}" > "${PIDFILE}"

echo "⏳ waiting for ${BASE_URL}/api/version"
READY=no
WAITED=0
while [ "${WAITED}" -lt 60 ]; do
  if ! kill -0 "${SERVER_PID}" 2> /dev/null; then break; fi
  if curl -fs -m 2 "${BASE_URL}/api/version" -o "${TRYOUT_DIR}/version.json"; then
    READY=yes
    break
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done

if [ "${READY}" != yes ]; then
  kill "${SERVER_PID}" 2> /dev/null || true
  rm -f "${PIDFILE}"
  echo "❌ the server never answered ${BASE_URL}/api/version — last 40 lines of ${LOGFILE}:" >&2
  tail -n 40 "${LOGFILE}" >&2
  exit 1
fi

node "${HERE}/login.mjs"

mkdir -p "${TRYOUT_DIR}/run/shots"

SERVED_SHA="$(node -e '
  const { readFileSync } = require("node:fs")
  process.stdout.write(JSON.parse(readFileSync(process.argv[1], "utf8")).build_sha)
' "${TRYOUT_DIR}/version.json")"

echo "✅ sage-burner is up"
echo "   base URL   ${BASE_URL}"
echo "   build sha  ${SERVED_SHA}"
echo "   state      ${STATE}"
echo "   cookie     ${TRYOUT_DIR}/token.txt"
echo "   log        ${LOGFILE}"
echo "   scratch    ${TRYOUT_DIR}/run (screenshots in ${TRYOUT_DIR}/run/shots)"
