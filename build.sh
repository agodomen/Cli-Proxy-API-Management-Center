#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="${ROOT_DIR}/frontend"
BACKEND_DIR="${ROOT_DIR}/backend"
DOC_DIR="${ROOT_DIR}/doc"
COMMAND="${1:-all}"

install_docs() {
  if [[ -f "${DOC_DIR}/package-lock.json" ]]; then
    npm --prefix "${DOC_DIR}" ci
  else
    npm --prefix "${DOC_DIR}" install
  fi
}

ensure_docs_dependencies() {
  if [[ ! -x "${DOC_DIR}/node_modules/.bin/vitepress" ]]; then
    install_docs
  fi
}

build_frontend() {
  echo "==> Building management frontend"
  if command -v bun >/dev/null 2>&1; then
    (cd "${FRONTEND_DIR}" && bun run build)
  else
    (cd "${FRONTEND_DIR}" && npm run build)
  fi
}

embed_management_panel() {
  local panel_src="${FRONTEND_DIR}/dist/index.html"
  local panel_dst="${BACKEND_DIR}/internal/core/httpapi/web/management.html"
  if [[ ! -f "${panel_src}" ]]; then
    echo "missing ${panel_src}; frontend build did not produce panel HTML" >&2
    exit 1
  fi
  echo "==> Embedding management panel into backend binary assets"
  mkdir -p "$(dirname "${panel_dst}")"
  cp "${panel_src}" "${panel_dst}"
}

build_service() {
  build_frontend
  embed_management_panel

  echo "==> Building unified Go cpamc service"
  (cd "${BACKEND_DIR}" && go build -p="${GO_BUILD_PARALLELISM:-2}" -o "${BACKEND_DIR}/cpamc" ./cmd/cpamc)

  build_cliproxyapi
}

build_cliproxyapi() {
  echo "==> Building integrated CLIProxyAPI compatibility entry"
  (cd "${BACKEND_DIR}" && go build \
    -p="${GO_BUILD_PARALLELISM:-2}" \
    -o "${BACKEND_DIR}/cli-proxy-api" \
    ./cmd/server)
}

build_docs() {
  ensure_docs_dependencies
  echo "==> Building VitePress documentation"
  npm --prefix "${DOC_DIR}" run build
}

case "${COMMAND}" in
  service|app)
    build_service
    ;;
  cliproxyapi|engine)
    build_cliproxyapi
    ;;
  docs|doc)
    build_docs
    ;;
  all)
    build_service
    build_docs
    ;;
  docs:dev|dev-docs)
    ensure_docs_dependencies
    npm --prefix "${DOC_DIR}" run dev -- --host 0.0.0.0
    ;;
  docs:preview|preview-docs)
    ensure_docs_dependencies
    npm --prefix "${DOC_DIR}" run preview -- --host 0.0.0.0
    ;;
  docs:install|install-docs)
    install_docs
    ;;
  clean)
    rm -rf "${FRONTEND_DIR}/dist" "${ROOT_DIR}/dist" "${DOC_DIR}/.vitepress/dist" "${DOC_DIR}/.vitepress/cache"
    ;;
  *)
    echo "Usage: ./build.sh {service|cliproxyapi|docs|all|docs:dev|docs:preview|docs:install|clean}" >&2
    exit 2
    ;;
esac
