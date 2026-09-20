#!/usr/bin/env bash
set -euo pipefail

NODE_MAJOR=24
PNPM_VERSION=10.33.4
PREFIX="/opt/node${NODE_MAJOR}"
IMAGE_PATH="${PATH}"

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

echo "📦 Installing pnpm ${PNPM_VERSION}"
npm install --global --silent "pnpm@${PNPM_VERSION}"

node_dir="$(dirname "$(PATH="${IMAGE_PATH}" command -v node || echo /usr/local/bin/node)")"

for tool in node npm npx corepack pnpm pnpx; do
  if [ -e "${PREFIX}/bin/${tool}" ]; then
    tool_dir="$(dirname "$(PATH="${IMAGE_PATH}" command -v "${tool}" || echo "/usr/local/bin/${tool}")")"
    for dir in "${node_dir}" "${tool_dir}" /usr/local/bin; do
      if [ "${dir}" != "${PREFIX}/bin" ]; then
        ln -sfn "${PREFIX}/bin/${tool}" "${dir}/${tool}"
      fi
    done
  fi
done

echo "✅ node $(node --version), pnpm $(pnpm --version)"

seen="$(PATH="${IMAGE_PATH}" bash -c 'node --version' 2>/dev/null || true)"
case "${seen}" in
  v${NODE_MAJOR}.*) echo "✅ the image's own PATH resolves node to ${seen}" ;;
  *) echo "⚠️  the image's own PATH resolves node to '${seen}'; sessions must prepend ${PREFIX}/bin to PATH (AGENTS.md says how)" ;;
esac
