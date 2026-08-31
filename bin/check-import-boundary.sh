#!/usr/bin/env bash
# check-import-boundary.sh — ratchet on how much upstream internal API the
# secondary-development code depends on.
#
# Rule: every (file, upstream-internal-package) pair used by internal/core/ or
# cmd/cpamc/ must be declared in bin/import-boundary-allowlist.conf. New pairs
# fail the build; removed pairs only print a reminder to prune the allowlist.
#
# Rationale: upstream internal/** carries no compatibility promise, so each
# reference is a latent break on the next community sync. Making the set append-
# hostile keeps the coupling monotonically decreasing.
# See docs/architecture/backend-extension-architecture.md §6.2
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOUNT="${ROOT_DIR}/backend"
ALLOWLIST="${ROOT_DIR}/bin/import-boundary-allowlist.conf"
MODULE_PREFIX="github.com/router-for-me/CLIProxyAPI/v7"

# Secondary-development trees whose imports are constrained.
SCOPES=(internal/core cmd/cpamc)

PRINT_CURRENT=false
case "${1:-}" in
  --print-current) PRINT_CURRENT=true ;;
  -h|--help)
    cat <<'EOF'
Usage: bin/check-import-boundary.sh [--print-current]

Exit codes:
  0  no undeclared dependency on upstream internal packages
  1  a new (file, package) pair appeared
  2  bad usage / missing prerequisites

--print-current dumps the observed pairs in allowlist format, for refreshing
bin/import-boundary-allowlist.conf after an intentional reduction.
EOF
    exit 0 ;;
  "") ;;
  *) echo "Unknown argument: $1" >&2; exit 2 ;;
esac

[[ -f "$ALLOWLIST" ]] || { echo "Allowlist not found: $ALLOWLIST" >&2; exit 2; }

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
: > "${WORK_DIR}/generated.files"

# Observed pairs. internal/core is the secondary-dev tree itself, so references
# to it are not upstream coupling and are filtered out.
#
# Generated files are excluded from the ratchet: their imports mirror upstream's
# entrypoint and change automatically on sync, so failing on them would be noise
# rather than signal. They are still counted and reported for visibility.
(
  cd "$MOUNT"
  for scope in "${SCOPES[@]}"; do
    [[ -d "$scope" ]] || continue
    while IFS= read -r file; do
      if head -n 1 "$file" | grep -q '^// Code generated '; then
        printf '%s\n' "$file" >> "${WORK_DIR}/generated.files"
        continue
      fi
      grep -HoE "\"${MODULE_PREFIX}/internal/[a-zA-Z0-9_/.-]+\"" "$file" || true
    done < <(find "$scope" -name '*.go' -type f | sort)
  done
) | tr -d '"' \
  | grep -v "${MODULE_PREFIX}/internal/core" \
  | sed "s|${MODULE_PREFIX}/||" \
  | sort -u > "${WORK_DIR}/observed"

if [[ "$PRINT_CURRENT" == "true" ]]; then
  cat "${WORK_DIR}/observed"
  exit 0
fi

sed 's/#.*//; s/[[:space:]]*$//; /^$/d' "$ALLOWLIST" | sort -u > "${WORK_DIR}/declared"

comm -23 "${WORK_DIR}/observed" "${WORK_DIR}/declared" > "${WORK_DIR}/new"
comm -13 "${WORK_DIR}/observed" "${WORK_DIR}/declared" > "${WORK_DIR}/gone"

status=0
if [[ -s "${WORK_DIR}/new" ]]; then
  status=1
  printf '新增的上游 internal 依赖 (%d)：\n' "$(wc -l < "${WORK_DIR}/new")" >&2
  sed 's/^/  /' "${WORK_DIR}/new" >&2
  cat >&2 <<'EOF'

二开代码不应新增对上游 internal/** 的直接依赖：这些包没有兼容承诺，下次社区
同步就可能编译失败。请改用 sdk/**；若 SDK 确实缺少该能力，把它集中到
internal/core/upstreamshim（并在其中记录缺口与上游 PR），而不是散落各处。
处理指引：docs/architecture/backend-extension-architecture.md §6.2
EOF
fi

if [[ -s "${WORK_DIR}/gone" ]]; then
  printf '\nallowlist 中已不再使用的条目 (%d)，建议删除以收紧棘轮：\n' \
    "$(wc -l < "${WORK_DIR}/gone")"
  sed 's/^/  /' "${WORK_DIR}/gone"
fi

if [[ $status -eq 0 ]]; then
  printf '上游 internal 依赖：%d 项（手写代码），均已声明。\n' "$(wc -l < "${WORK_DIR}/observed")"
fi

if [[ -s "${WORK_DIR}/generated.files" ]]; then
  while IFS= read -r file; do
    count="$( (cd "$MOUNT" && grep -oE "\"${MODULE_PREFIX}/internal/[a-zA-Z0-9_/.-]+\"" "$file" || true) \
      | tr -d '"' | grep -v "${MODULE_PREFIX}/internal/core" | sort -u | wc -l)"
    printf '生成文件（不纳入棘轮）：%s，%d 项上游 internal 依赖。\n' "$file" "$count"
  done < "${WORK_DIR}/generated.files"
fi
exit $status
