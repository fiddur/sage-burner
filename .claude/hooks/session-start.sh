#!/usr/bin/env bash
set -euo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

NODE_MAJOR="$(sed 's/^v//; s/\..*//' .nvmrc | tr -d '[:space:]')"
PREFIX="/opt/node${NODE_MAJOR}"

if [ ! -x "${PREFIX}/bin/node" ]; then
  echo "📦 Installing Node ${NODE_MAJOR} into ${PREFIX}"
  base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  sums="$(curl -fsSL "${base}/SHASUMS256.txt")"
  tarball="$(printf '%s\n' "${sums}" | awk '/linux-x64\.tar\.xz$/ { print $2 }')"
  tmp="$(mktemp -d)"
  curl -fsSL "${base}/${tarball}" -o "${tmp}/${tarball}"
  (cd "${tmp}" && printf '%s\n' "${sums}" | grep " ${tarball}\$" | sha256sum -c -)
  mkdir "${tmp}/node"
  tar -xJf "${tmp}/${tarball}" -C "${tmp}/node" --strip-components=1
  rm -rf "${PREFIX}"
  mv "${tmp}/node" "${PREFIX}"
  rm -rf "${tmp}"
fi

export PATH="${PREFIX}/bin:${PATH}"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"${PREFIX}/bin:\$PATH\"" >> "${CLAUDE_ENV_FILE}"
fi

PNPM_VERSION="$(node -p "require('./package.json').packageManager.split('@')[1]")"
if [ "$(pnpm --version 2>/dev/null || true)" != "${PNPM_VERSION}" ]; then
  echo "📦 Installing pnpm ${PNPM_VERSION}"
  npm install --global --silent "pnpm@${PNPM_VERSION}"
fi

pnpm install --frozen-lockfile

echo "✅ node $(node --version), pnpm $(pnpm --version)"
