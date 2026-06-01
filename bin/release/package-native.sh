#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="${VERSION:-dev}"
OUT_DIR="${OUT_DIR:-"${REPO_ROOT}/dist/native"}"
WEB_HTML="${WEB_HTML:-"${REPO_ROOT}/frontend/dist/index.html"}"
README_CN="${README_CN:-"${REPO_ROOT}/doc/README_CN.md"}"
BINARY_NAME="cpamc"

if [ ! -f "${WEB_HTML}" ]; then
  echo "missing ${WEB_HTML}; run frontend build first (cd frontend && bun run build)" >&2
  exit 1
fi

mkdir -p "${REPO_ROOT}/bin/tmp/release"
WORK_DIR="$(mktemp -d "${REPO_ROOT}/bin/tmp/release/native.XXXXXX")"
trap 'rm -rf "${WORK_DIR}"' EXIT

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"

cp -R "${REPO_ROOT}/backend" "${WORK_DIR}/backend"
cp "${WEB_HTML}" "${WORK_DIR}/backend/internal/core/httpapi/web/management.html"

TARGETS=(
  "linux amd64"
  "linux arm64"
  "darwin amd64"
  "darwin arm64"
  "windows amd64"
  "windows arm64"
)

for TARGET in "${TARGETS[@]}"; do
  read -r GOOS GOARCH <<<"${TARGET}"
  PACKAGE_NAME="${BINARY_NAME}_${VERSION}_${GOOS}_${GOARCH}"
  PACKAGE_DIR="${WORK_DIR}/${PACKAGE_NAME}"
  EXE_NAME="${BINARY_NAME}"

  if [ "${GOOS}" = "windows" ]; then
    EXE_NAME="${BINARY_NAME}.exe"
  fi

  mkdir -p "${PACKAGE_DIR}"
  (
    cd "${WORK_DIR}/backend"
    CGO_ENABLED=0 \
      GOOS="${GOOS}" \
      GOARCH="${GOARCH}" \
      GOMAXPROCS="${GOMAXPROCS:-2}" \
      go build \
        -p="${GO_BUILD_PARALLELISM:-2}" \
        -trimpath \
        -ldflags "-s -w" \
        -o "${PACKAGE_DIR}/${EXE_NAME}" \
        ./cmd/cpamc
  )

  cp "${REPO_ROOT}/README.md" "${PACKAGE_DIR}/README.md"
  cp "${README_CN}" "${PACKAGE_DIR}/README_CN.md"
  cp "${REPO_ROOT}/LICENSE" "${PACKAGE_DIR}/LICENSE"

  if [ "${GOOS}" = "windows" ]; then
    (
      cd "${WORK_DIR}"
      zip -qr "${OUT_DIR}/${PACKAGE_NAME}.zip" "${PACKAGE_NAME}"
    )
  else
    (
      cd "${WORK_DIR}"
      tar -czf "${OUT_DIR}/${PACKAGE_NAME}.tar.gz" "${PACKAGE_NAME}"
    )
  fi
done

(
  cd "${OUT_DIR}"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum ./* > checksums.txt
  else
    shasum -a 256 ./* > checksums.txt
  fi
)
