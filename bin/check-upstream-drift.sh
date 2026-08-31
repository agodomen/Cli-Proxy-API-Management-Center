#!/usr/bin/env bash
# check-upstream-drift.sh — assert that backend/ mirrors the pinned upstream tree
# exactly, except for the divergences declared in bin/upstream-allowlist.conf.
#
# Unlike bin/compare-cliproxyapi.sh (which expects differences and prints them for
# a human), this script expects ZERO undeclared differences and is therefore
# usable as a CI gate.
#
# Comparison uses Git blob hashes on both sides, so no upstream tree extraction is
# needed. Local hashes are computed from the working tree, not the index, so a
# dirty checkout is reported too.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOUNT="${ROOT_DIR}/backend"
PIN_FILE="${MOUNT}/.cliproxyapi-upstream-ref"
ALLOWLIST="${ROOT_DIR}/bin/upstream-allowlist.conf"

# Paths under backend/ that mirror upstream. Everything else in backend/ (pin
# file, LICENSE.CLIProxyAPI, .env*.example, CLIPROXYAPI_UPSTREAM_CN.md, ...) is
# monorepo control-plane and is not compared.
MIRRORED_PATHS=(cmd internal sdk test examples assets config.example.yaml go.mod go.sum)

SOURCE_DIR="${CLIPROXYAPI_SOURCE:-}"
VERBOSE=false

usage() {
  cat <<'EOF'
Usage: bin/check-upstream-drift.sh [--source PATH] [--verbose]

Asserts backend/ == upstream@pin + bin/upstream-allowlist.conf.

Exit codes:
  0  mirror matches the pin and every difference is declared
  1  undeclared drift, or a declared divergence disappeared
  2  bad usage / missing prerequisites

Environment:
  CLIPROXYAPI_SOURCE  upstream CLIProxyAPI Git checkout (fetched read-only)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE_DIR="${2:-}"; shift 2 ;;
    --verbose) VERBOSE=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$SOURCE_DIR" ]]; then
  for candidate in \
    "/home/gwd/projects/github/CLIProxyAPI" \
    "${ROOT_DIR}/../CLIProxyAPI" \
    "${ROOT_DIR}/../github/CLIProxyAPI"
  do
    [[ -d "${candidate}/.git" ]] && { SOURCE_DIR="$candidate"; break; }
  done
fi
if [[ ! -d "${SOURCE_DIR}/.git" ]]; then
  echo "Upstream CLIProxyAPI checkout not found. Set CLIPROXYAPI_SOURCE." >&2
  exit 2
fi
[[ -f "$PIN_FILE" ]] || { echo "Upstream pin not found: $PIN_FILE" >&2; exit 2; }
[[ -f "$ALLOWLIST" ]] || { echo "Allowlist not found: $ALLOWLIST" >&2; exit 2; }

COMMIT="$(sed -n 's/^commit=//p' "$PIN_FILE" | head -n 1)"
[[ -n "$COMMIT" ]] || { echo "Unable to read commit= from $PIN_FILE" >&2; exit 2; }

if ! git -C "$SOURCE_DIR" cat-file -e "${COMMIT}^{commit}" 2>/dev/null; then
  git -C "$SOURCE_DIR" fetch --tags --quiet
  git -C "$SOURCE_DIR" cat-file -e "${COMMIT}^{commit}" 2>/dev/null \
    || { echo "Pinned commit $COMMIT not found in $SOURCE_DIR" >&2; exit 2; }
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

read_section() {
  local requested="$1" section="" line
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" ]] && continue
    if [[ "$line" =~ ^\[([^]]+)\]$ ]]; then
      section="${BASH_REMATCH[1]}"
      continue
    fi
    [[ "$section" == "$requested" ]] && printf '%s\n' "$line"
  done < "$ALLOWLIST"
}

# is_declared <section> <path> — true when path is listed, or sits under a
# listed directory entry (trailing slash).
is_declared() {
  local section="$1" path="$2" entry
  while IFS= read -r entry; do
    [[ -z "$entry" ]] && continue
    if [[ "$entry" == */ ]]; then
      [[ "$path" == "$entry"* ]] && return 0
    else
      [[ "$path" == "$entry" ]] && return 0
    fi
  done < <(read_section "$section")
  return 1
}

in_mirror_scope() {
  local path="$1" prefix
  for prefix in "${MIRRORED_PATHS[@]}"; do
    [[ "$path" == "$prefix" || "$path" == "$prefix"/* ]] && return 0
  done
  return 1
}

# Upstream side: "<path>\t<blob-sha>" for mirrored paths at the pinned commit.
# ls-tree -r emits "<mode> <type> <sha>\t<path>".
git -C "$SOURCE_DIR" ls-tree -r "$COMMIT" | while IFS=$'\t' read -r meta path; do
  set -- $meta
  [[ "${2:-}" == "blob" ]] || continue
  printf '%s\t%s\n' "$path" "$3"
done > "${WORK_DIR}/upstream.raw"

: > "${WORK_DIR}/upstream.list"
while IFS=$'\t' read -r path sha; do
  in_mirror_scope "$path" || continue
  printf '%s\t%s\n' "$path" "$sha" >> "${WORK_DIR}/upstream.list"
done < "${WORK_DIR}/upstream.raw"
sort -o "${WORK_DIR}/upstream.list" "${WORK_DIR}/upstream.list"

# Local side: same shape, hashed from the working tree.
: > "${WORK_DIR}/local.paths"
for prefix in "${MIRRORED_PATHS[@]}"; do
  target="${MOUNT}/${prefix}"
  if [[ -f "$target" ]]; then
    printf '%s\n' "$prefix" >> "${WORK_DIR}/local.paths"
  elif [[ -d "$target" ]]; then
    (cd "$MOUNT" && find "$prefix" -type f) >> "${WORK_DIR}/local.paths"
  fi
done
sort -o "${WORK_DIR}/local.paths" "${WORK_DIR}/local.paths"

if [[ -s "${WORK_DIR}/local.paths" ]]; then
  # git hash-object --stdin-paths resolves relative paths against the repository
  # root, not the current directory, so feed absolute paths.
  sed "s|^|${MOUNT}/|" "${WORK_DIR}/local.paths" > "${WORK_DIR}/local.abs"
  git hash-object --stdin-paths < "${WORK_DIR}/local.abs" > "${WORK_DIR}/local.hashes"
  paste "${WORK_DIR}/local.paths" "${WORK_DIR}/local.hashes" > "${WORK_DIR}/local.list"
else
  : > "${WORK_DIR}/local.list"
fi

declare -A UPSTREAM_SHA=() LOCAL_SHA=()
while IFS=$'\t' read -r path sha; do UPSTREAM_SHA["$path"]="$sha"; done < "${WORK_DIR}/upstream.list"
while IFS=$'\t' read -r path sha; do LOCAL_SHA["$path"]="$sha"; done < "${WORK_DIR}/local.list"

declare -a UNDECLARED_ADDED=() UNDECLARED_MODIFIED=() UNDECLARED_MISSING=()
declare -a SEEN_LOCAL_ONLY=() SEEN_MODIFIED=() SEEN_ABSENT=()

for path in "${!LOCAL_SHA[@]}"; do
  if [[ -z "${UPSTREAM_SHA[$path]:-}" ]]; then
    if is_declared local-only "$path"; then
      SEEN_LOCAL_ONLY+=("$path")
    else
      UNDECLARED_ADDED+=("$path")
    fi
  elif [[ "${LOCAL_SHA[$path]}" != "${UPSTREAM_SHA[$path]}" ]]; then
    if is_declared modified "$path"; then
      SEEN_MODIFIED+=("$path")
    else
      UNDECLARED_MODIFIED+=("$path")
    fi
  fi
done

for path in "${!UPSTREAM_SHA[@]}"; do
  [[ -n "${LOCAL_SHA[$path]:-}" ]] && continue
  if is_declared absent "$path"; then
    SEEN_ABSENT+=("$path")
  else
    UNDECLARED_MISSING+=("$path")
  fi
done

status=0

report() {
  local title="$1"; shift
  (( $# == 0 )) && return 0
  status=1
  printf '\n%s (%d):\n' "$title" "$#" >&2
  printf '%s\n' "$@" | sort | head -n 50 | sed 's/^/  /' >&2
  (( $# > 50 )) && printf '  ... 其余 %d 条已省略\n' "$(( $# - 50 ))" >&2
  return 0
}

report "未声明的本地新增文件（应下沉到 internal/core/ 或加入 allowlist）" \
  "${UNDECLARED_ADDED[@]+"${UNDECLARED_ADDED[@]}"}"
report "未声明的上游文件改动（就地改上游是红线：请下沉到 internal/core/ 或声明为补丁）" \
  "${UNDECLARED_MODIFIED[@]+"${UNDECLARED_MODIFIED[@]}"}"
report "上游存在但本地缺失的文件（同步不完整）" \
  "${UNDECLARED_MISSING[@]+"${UNDECLARED_MISSING[@]}"}"

# A declared divergence that no longer exists is also drift: it means a local
# patch was silently lost during a sync, or the allowlist is stale.
declare -a STALE=()
while IFS= read -r entry; do
  [[ -z "$entry" ]] && continue
  if [[ "$entry" == */ ]]; then
    [[ -d "${MOUNT}/${entry%/}" ]] || STALE+=("[local-only] ${entry} 目录不存在")
  else
    [[ -n "${LOCAL_SHA[$entry]:-}" ]] || STALE+=("[local-only] ${entry} 不存在")
  fi
done < <(read_section local-only)
while IFS= read -r entry; do
  [[ -z "$entry" ]] && continue
  if [[ -z "${LOCAL_SHA[$entry]:-}" ]]; then
    STALE+=("[modified] ${entry} 本地缺失")
  elif [[ -n "${UPSTREAM_SHA[$entry]:-}" && "${LOCAL_SHA[$entry]}" == "${UPSTREAM_SHA[$entry]}" ]]; then
    STALE+=("[modified] ${entry} 与上游已一致：本地补丁可能在同步中丢失，或该条可以删除")
  fi
done < <(read_section modified)
report "allowlist 声明的差异已失效" "${STALE[@]+"${STALE[@]}"}"

if [[ "$VERBOSE" == "true" ]]; then
  printf '\n镜像范围内文件数：上游 %d / 本地 %d\n' "${#UPSTREAM_SHA[@]}" "${#LOCAL_SHA[@]}"
  printf '已声明并命中的差异：modified %d 项 / absent %d 项\n' \
    "${#SEEN_MODIFIED[@]}" "${#SEEN_ABSENT[@]}"
fi

if [[ $status -eq 0 ]]; then
  echo "backend/ 与上游 ${COMMIT} 一致，差异均已在 bin/upstream-allowlist.conf 声明。"
else
  echo "" >&2
  echo "上游镜像出现未声明漂移。处理指引：docs/architecture/backend-extension-architecture.md §6.1" >&2
fi
exit $status



