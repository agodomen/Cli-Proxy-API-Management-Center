#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="${ROOT_DIR}/bin/sync-manifest.conf"

DRY_RUN=false
CONFIRM_MANIFEST=false
FORCE=false
SIDE=""
SOURCE_DIR=""
TARGET_REF="HEAD"

usage() {
  cat <<'EOF'
Usage: bin/sync-community.sh --side backend|frontend --source PATH [--ref REF] [--dry-run] [--force] [--confirm-manifest]

Builds a candidate tree, mirrors the selected community revision into it,
preserves local development zones and manifest files, validates the candidate,
then replaces the mount and updates its upstream pin. The real mount and pin are
not changed when preparation or validation fails.

--confirm-manifest is required for a real sync. It records that every file in
bin/sync-manifest.conf was manually reviewed against the target revision.

--force rebuilds the mount even when the target commit already matches the pin.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --side) SIDE="${2:-}"; shift 2 ;;
    --source) SOURCE_DIR="${2:-}"; shift 2 ;;
    --ref) TARGET_REF="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --force) FORCE=true; shift ;;
    --confirm-manifest) CONFIRM_MANIFEST=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "$SIDE" != "backend" && "$SIDE" != "frontend" ]]; then
  echo "--side must be backend or frontend" >&2
  exit 2
fi
if [[ ! -d "$SOURCE_DIR/.git" ]]; then
  echo "Upstream source is not a Git repository: $SOURCE_DIR" >&2
  exit 1
fi
if [[ ! -f "$MANIFEST" ]]; then
  echo "Sync manifest not found: $MANIFEST" >&2
  exit 1
fi

MOUNT="${ROOT_DIR}/${SIDE}"
if [[ "$SIDE" == "backend" ]]; then
  PIN_FILE="${MOUNT}/.cliproxyapi-upstream-ref"
  CANONICAL_REPOSITORY="https://github.com/router-for-me/CLIProxyAPI"
else
  PIN_FILE="${MOUNT}/.frontend-upstream-ref"
  CANONICAL_REPOSITORY="https://github.com/router-for-me/Cli-Proxy-API-Management-Center"
fi

read_pin_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$PIN_FILE" | head -n 1
}

read_manifest() {
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
  done < "$MANIFEST"
}

if [[ ! -f "$PIN_FILE" ]]; then
  echo "Upstream pin not found: $PIN_FILE" >&2
  exit 1
fi

OLD_COMMIT="$(read_pin_value commit)"
OLD_TAG="$(read_pin_value tag)"
[[ -z "$OLD_TAG" ]] && OLD_TAG="$(read_pin_value ref)"
if [[ -z "$OLD_COMMIT" && "$SIDE" == "frontend" ]]; then
  OLD_COMMIT="$(sed -n '1p' "$PIN_FILE")"
  OLD_TAG="$(sed -n '2p' "$PIN_FILE")"
fi
if [[ -z "$OLD_COMMIT" ]]; then
  echo "Unable to read commit from $PIN_FILE" >&2
  exit 1
fi

for revision in "$OLD_COMMIT" "$TARGET_REF"; do
  if ! git -C "$SOURCE_DIR" cat-file -e "${revision}^{commit}" 2>/dev/null; then
    git -C "$SOURCE_DIR" fetch --tags --quiet
  fi
  git -C "$SOURCE_DIR" cat-file -e "${revision}^{commit}"
done

NEW_COMMIT="$(git -C "$SOURCE_DIR" rev-parse "${TARGET_REF}^{commit}")"
NEW_TAG="$(git -C "$SOURCE_DIR" describe --tags --exact-match "$NEW_COMMIT" 2>/dev/null || true)"
[[ -z "$NEW_TAG" && "$TARGET_REF" == v* ]] && NEW_TAG="$TARGET_REF"

if [[ "$NEW_COMMIT" == "$OLD_COMMIT" && "$FORCE" == "false" ]]; then
  echo "Already synchronized to $NEW_COMMIT"
  exit 0
fi

mapfile -t MANUAL_FILES < <(read_manifest "$SIDE")
if [[ "$DRY_RUN" == "false" && "$CONFIRM_MANIFEST" == "false" && ${#MANUAL_FILES[@]} -gt 0 ]]; then
  echo "Real sync requires --confirm-manifest after manual review:" >&2
  printf '  %s\n' "${MANUAL_FILES[@]}" >&2
  exit 2
fi

WORK_DIR="$(mktemp -d)"
UPSTREAM_TREE="${WORK_DIR}/upstream"
CANDIDATE="${WORK_DIR}/candidate"
BACKUP="${WORK_DIR}/backup"
mkdir -p "$UPSTREAM_TREE" "$CANDIDATE" "$BACKUP"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "Syncing ${SIDE}: ${OLD_COMMIT} -> ${NEW_COMMIT}${NEW_TAG:+ (${NEW_TAG})}"

git -C "$SOURCE_DIR" archive --format=tar "$NEW_COMMIT" | tar -xf - -C "$UPSTREAM_TREE"
rsync -a --exclude node_modules --exclude dist "$MOUNT/" "$CANDIDATE/"

declare -a RSYNC_EXCLUDES=()
for path in "${MANUAL_FILES[@]}"; do
  RSYNC_EXCLUDES+=("--exclude=/${path}")
done

mirror_backend() {
  local path
  for path in cmd internal sdk test examples testdata assets; do
    if [[ -d "$UPSTREAM_TREE/$path" ]]; then
      mkdir -p "$CANDIDATE/$path"
      local -a excludes=()
      [[ "$path" == "cmd" ]] && excludes+=("--exclude=/cpamc/")
      [[ "$path" == "internal" ]] && excludes+=("--exclude=/core/")
      for manual in "${MANUAL_FILES[@]}"; do
        [[ "$manual" == "$path/"* ]] && excludes+=("--exclude=/${manual#${path}/}")
      done
      rsync -a --delete "${excludes[@]}" "$UPSTREAM_TREE/$path/" "$CANDIDATE/$path/"
    elif [[ -d "$CANDIDATE/$path" && "$path" != "cmd" && "$path" != "internal" ]]; then
      find "$CANDIDATE/$path" -depth -delete
    fi
  done
  for path in go.mod go.sum config.example.yaml; do
    [[ -f "$UPSTREAM_TREE/$path" ]] && cp "$UPSTREAM_TREE/$path" "$CANDIDATE/$path"
  done
}

# apply_backend_patches replays the local modifications that genuinely have to
# live inside upstream files. Storing them as patches (instead of keeping the
# modified source and excluding it from the mirror) means a conflicting upstream
# change fails loudly here, rather than silently dropping the local behaviour or
# silently keeping a stale local copy of an upstream file.
apply_backend_patches() {
  local patch_dir="${CANDIDATE}/patches"
  [[ -d "$patch_dir" ]] || return 0
  shopt -s nullglob
  local patches=("$patch_dir"/*.patch)
  shopt -u nullglob
  (( ${#patches[@]} == 0 )) && return 0

  local patch
  for patch in "${patches[@]}"; do
    echo "Applying patch: $(basename "$patch")"
    if ! (cd "$CANDIDATE" && git apply --check "$patch"); then
      echo "" >&2
      echo "补丁无法应用到新上游树：$(basename "$patch")" >&2
      echo "上游已修改该补丁覆盖的代码。请人工重做补丁，或确认上游已合入后删除它。" >&2
      echo "指引：docs/architecture/backend-extension-architecture.md §6.4" >&2
      return 1
    fi
    (cd "$CANDIDATE" && git apply "$patch")
  done
}

mirror_frontend() {
  local path manual
  mkdir -p "$CANDIDATE/src"
  local -a src_excludes=("--exclude=/external/")
  for manual in "${MANUAL_FILES[@]}"; do
    [[ "$manual" == src/* ]] && src_excludes+=("--exclude=/${manual#src/}")
  done
  rsync -a --delete "${src_excludes[@]}" "$UPSTREAM_TREE/src/" "$CANDIDATE/src/"

  if [[ -d "$UPSTREAM_TREE/tests" ]]; then
    mkdir -p "$CANDIDATE/tests"
    rsync -a --delete "$UPSTREAM_TREE/tests/" "$CANDIDATE/tests/"
  fi
  for path in package.json bun.lock eslint.config.js .prettierrc tsconfig.json tsconfig.node.json vite.config.ts logo.jpg; do
    for manual in "${MANUAL_FILES[@]}"; do
      [[ "$manual" == "$path" ]] && continue 2
    done
    [[ -f "$UPSTREAM_TREE/$path" ]] && cp "$UPSTREAM_TREE/$path" "$CANDIDATE/$path"
  done
}

if [[ "$SIDE" == "backend" ]]; then
  mirror_backend
  apply_backend_patches
  echo "Regenerating community CLI mirror..."
  BIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  CPAMC_GEN_SOURCE="${CANDIDATE}/cmd/server/main.go" \
  CPAMC_GEN_TARGET="${CANDIDATE}/internal/core/cli/run.gen.go" \
  CPAMC_GEN_COMMIT="${NEW_COMMIT}" \
    "${BIN_DIR}/gen-cli-mirror.sh"
else
  mirror_frontend
fi

echo "Manifest review status:"
for path in "${MANUAL_FILES[@]}"; do
  base_state="absent" target_state="absent" local_state="absent"
  git -C "$SOURCE_DIR" cat-file -e "${OLD_COMMIT}:${path}" 2>/dev/null && base_state="present"
  [[ -e "$UPSTREAM_TREE/$path" ]] && target_state="present"
  [[ -e "$MOUNT/$path" ]] && local_state="present"
  printf '  %-70s base=%s target=%s local=%s\n' "$path" "$base_state" "$target_state" "$local_state"
done

if [[ "$DRY_RUN" == "true" ]]; then
  echo "Dry-run changes:"
  rsync -rcin --delete --exclude node_modules --exclude dist --exclude "$(basename "$PIN_FILE")" "$CANDIDATE/" "$MOUNT/"
  exit 0
fi

if [[ "$SIDE" == "backend" ]]; then
  echo "Validating backend candidate..."
  (cd "$CANDIDATE" && go mod tidy && GOMAXPROCS=1 go test -p 1 ./...)
else
  echo "Installing and validating frontend candidate..."
  (cd "$CANDIDATE" && bun install --frozen-lockfile && bun run build)
fi

rsync -a --exclude node_modules --exclude dist "$MOUNT/" "$BACKUP/"
restore_backup() {
  rsync -a --delete --exclude node_modules --exclude dist "$BACKUP/" "$MOUNT/"
}
trap 'restore_backup; rm -rf "$WORK_DIR"' ERR

rsync -a --delete --exclude node_modules --exclude dist --exclude "$(basename "$PIN_FILE")" "$CANDIDATE/" "$MOUNT/"

PIN_TMP="${PIN_FILE}.tmp"
{
  printf 'canonical_repository=%s\n' "$CANONICAL_REPOSITORY"
  source_repository="$(read_pin_value source_repository)"
  [[ -n "$source_repository" ]] && printf 'source_repository=%s\n' "$source_repository"
  printf 'branch=main\n'
  printf 'commit=%s\n' "$NEW_COMMIT"
  [[ -n "$NEW_TAG" ]] && printf 'tag=%s\n' "$NEW_TAG"
  printf 'synced_at=%s\n' "$(date +%F)"
} > "$PIN_TMP"
mv "$PIN_TMP" "$PIN_FILE"

trap 'rm -rf "$WORK_DIR"' EXIT
echo "Sync completed and pin updated: $PIN_FILE"
