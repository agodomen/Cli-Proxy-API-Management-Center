#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

echo "==> structure checks"
test -d frontend/src/external
test -d backend/internal/core
test -d backend/cmd/cpamc
test -f frontend/package.json
test -f frontend/.frontend-upstream-ref
test -f backend/go.mod
rg -n "import '@/external/cpa-extension'" frontend/src/main.tsx
rg -n "externalRoutes" frontend/src/router/MainRoutes.tsx
rg -n "externalNavGroups" frontend/src/components/layout/MainLayout.tsx
rg -n 'module github.com/agodomen/Cli-Proxy-API-Management-Center/backend' backend/go.mod
if rg -n 'github.com/agodomen/Cli-Proxy-API-Management-Center/services' backend --glob '*.go' >/dev/null; then
  echo "old Go module path still present" >&2
  exit 1
fi

echo "==> frontend type-check"
if command -v bun >/dev/null 2>&1; then
  (cd frontend && bun run type-check)
else
  (cd frontend && npm run type-check)
fi

echo "==> backend tests/build"
(
  cd backend
  # Keep tests CGO-flexible; binaries must enable CGO so plugin UI is advertised.
  go test ./...
  CGO_ENABLED=1 go build -o ./cpamc ./cmd/cpamc
  CGO_ENABLED=1 go build -o ./cli-proxy-api ./cmd/server
)

echo "==> docs build"
./build.sh docs

echo "OK: monorepo verification passed"
