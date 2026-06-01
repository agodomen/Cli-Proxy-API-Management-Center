#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${CLIPROXYAPI_SOURCE:-}"
if [[ -z "${SOURCE_DIR}" ]]; then
  for candidate in     "/home/gwd/projects/github/CLIProxyAPI"     "/home/gwd/projects/gpt/CLIProxyAPI"     "${ROOT_DIR}/../CLIProxyAPI"     "${ROOT_DIR}/../github/CLIProxyAPI"
  do
    if [[ -d "${candidate}/.git" ]]; then
      SOURCE_DIR="${candidate}"
      break
    fi
  done
  SOURCE_DIR="${SOURCE_DIR:-/home/gwd/projects/github/CLIProxyAPI}"
fi
REF="HEAD"
LOCAL_MODULE="github.com/agodomen/Cli-Proxy-API-Management-Center/backend"

usage() {
  cat <<'EOF'
Usage: bin/compare-cliproxyapi.sh [--source PATH] [--ref REF]

Compares the flattened local CLIProxyAPI implementation with an upstream Git
revision. Upstream Go self-imports are normalized to the local module path before
the comparison. The script never overwrites local source files.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      SOURCE_DIR="$2"
      shift 2
      ;;
    --ref)
      REF="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! -d "${SOURCE_DIR}/.git" ]]; then
  echo "CLIProxyAPI Git repository not found: ${SOURCE_DIR}" >&2
  exit 1
fi

COMMIT="$(git -C "${SOURCE_DIR}" rev-parse "${REF}^{commit}")"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TEMP_DIR}"' EXIT

git -C "${SOURCE_DIR}" archive --format=tar "${COMMIT}" \
  cmd internal sdk test examples config.example.yaml go.mod go.sum \
  $(git -C "${SOURCE_DIR}" ls-tree -r --name-only "${COMMIT}" | rg '^testdata/' || true) | tar -xf - -C "${TEMP_DIR}"

files="$(rg -l 'github.com/router-for-me/CLIProxyAPI/v7' \
  "${TEMP_DIR}/cmd" "${TEMP_DIR}/internal" "${TEMP_DIR}/sdk" "${TEMP_DIR}/test" \
  --glob '*.go' || true)"
if [[ -n "${files}" ]]; then
  printf '%s\n' "${files}" | xargs sed -i \
    "s#github.com/router-for-me/CLIProxyAPI/v7#${LOCAL_MODULE}#g"
fi

gofmt -w \
  "${TEMP_DIR}/cmd" \
  "${TEMP_DIR}/internal" \
  "${TEMP_DIR}/sdk" \
  "${TEMP_DIR}/test"

status=0
for parent in cmd internal sdk test; do
  while IFS= read -r source_path; do
    name="$(basename "${source_path}")"
    if ! diff -ruN "${source_path}" "${ROOT_DIR}/backend/${parent}/${name}"; then
      status=1
    fi
  done < <(find "${TEMP_DIR}/${parent}" -mindepth 1 -maxdepth 1 -type d | sort)
done

if ! diff -u "${TEMP_DIR}/config.example.yaml" "${ROOT_DIR}/backend/config.example.yaml"; then
  status=1
fi

if [[ -d "${TEMP_DIR}/testdata" || -d "${ROOT_DIR}/backend/testdata" ]]; then
  if ! diff -ruN "${TEMP_DIR}/testdata" "${ROOT_DIR}/backend/testdata"; then
    status=1
  fi
fi

if [[ ${status} -eq 0 ]]; then
  echo "Local CLIProxyAPI implementation matches upstream ${COMMIT}."
else
  echo "Differences found against upstream ${COMMIT}." >&2
fi
exit ${status}
