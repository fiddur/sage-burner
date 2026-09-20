#!/usr/bin/env bash
set -euo pipefail

TRYOUT_DIR="${TRYOUT_DIR:-/tmp/tryout}"
PIDFILE="${TRYOUT_DIR}/server.pid"

PURGE=no
for argument in "$@"; do
  case "${argument}" in
    --purge) PURGE=yes ;;
    *)
      echo "❌ unknown argument ${argument} — the only flag is --purge" >&2
      exit 2
      ;;
  esac
done

if [ -f "${PIDFILE}" ]; then
  PID="$(cat "${PIDFILE}")"
  if [ -n "${PID}" ] && kill -0 "${PID}" 2> /dev/null; then
    echo "🛑 stopping the server (pid ${PID})"
    kill "${PID}" 2> /dev/null || true
    WAITED=0
    while [ "${WAITED}" -lt 15 ] && kill -0 "${PID}" 2> /dev/null; do
      sleep 1
      WAITED=$((WAITED + 1))
    done
    if kill -0 "${PID}" 2> /dev/null; then
      echo "⚠️  it ignored SIGTERM — sending SIGKILL"
      kill -9 "${PID}" 2> /dev/null || true
    fi
  fi
  rm -f "${PIDFILE}"
fi

if [ "${PURGE}" = yes ]; then
  rm -rf "${TRYOUT_DIR}"
  echo "🧹 removed ${TRYOUT_DIR}"
fi
