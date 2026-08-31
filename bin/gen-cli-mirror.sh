#!/usr/bin/env bash
# gen-cli-mirror.sh — generate backend/internal/core/cli/run.gen.go from the
# community entrypoint backend/cmd/server/main.go.
#
# Why: the cpamc binary must also provide the full community CLI (OAuth login,
# TUI, Home mode, ...), but Go cannot import a `main` package. That used to be
# solved by hand-copying 845 lines, which had to be re-diffed and re-ported on
# every community sync, with nothing detecting a missed port.
#
# The transform is purely mechanical (4 unique anchors), so it is generated and
# verified in CI instead. If an anchor stops matching exactly once, the upstream
# entrypoint changed shape and a human must look — which is precisely the signal
# the old manual process could not produce.
#
# See docs/architecture/backend-extension-architecture.md §6.3
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Overridable so bin/sync-community.sh can regenerate inside its candidate tree
# before the mount is replaced.
SOURCE="${CPAMC_GEN_SOURCE:-${ROOT_DIR}/backend/cmd/server/main.go}"
TARGET="${CPAMC_GEN_TARGET:-${ROOT_DIR}/backend/internal/core/cli/run.gen.go}"
PIN_FILE="${ROOT_DIR}/backend/.cliproxyapi-upstream-ref"

CHECK_ONLY=false
case "${1:-}" in
  --check) CHECK_ONLY=true ;;
  -h|--help)
    cat <<'EOF'
Usage: bin/gen-cli-mirror.sh [--check]

Regenerates backend/internal/core/cli/run.gen.go from backend/cmd/server/main.go.

  (no flag)  write the generated file
  --check    generate to a temp file and fail if it differs from the committed
             one; use this as a CI gate

Exit codes:
  0  generated (or already up to date)
  1  --check found a difference
  2  an anchor did not match exactly once: the upstream entrypoint changed
     shape and the transform needs a human review
EOF
    exit 0 ;;
  "") ;;
  *) echo "Unknown argument: $1" >&2; exit 2 ;;
esac

[[ -f "$SOURCE" ]] || { echo "Community entrypoint not found: $SOURCE" >&2; exit 2; }

# Anchors must be unique. A count other than 1 means the upstream entrypoint was
# restructured and silent mis-generation is possible, so stop.
assert_unique() {
  local anchor="$1" count
  count="$(grep -cF -- "$anchor" "$SOURCE" || true)"
  if [[ "$count" != "1" ]]; then
    echo "锚点匹配 ${count} 次（应为 1 次）：${anchor}" >&2
    echo "上游 cmd/server/main.go 的结构已变化，需人工复核 bin/gen-cli-mirror.sh 的变换规则。" >&2
    exit 2
  fi
}

assert_unique 'package main'
assert_unique 'func init() {'
assert_unique 'func main() {'
assert_unique 'serverOptions := []api.ServerOption(nil)'

# Everything above `package main` must be comments; otherwise the header replacement
# would silently drop real code (build tags, license blocks, ...).
if awk '/^package main$/{exit} /^[[:space:]]*$/{next} !/^\/\//{print; found=1} END{exit !found}' "$SOURCE" > /dev/null; then
  echo "cmd/server/main.go 在 package 声明前出现非注释内容，生成器会丢弃它。请人工处理：" >&2
  awk '/^package main$/{exit} /^[[:space:]]*$/{next} !/^\/\//{print "  " $0}' "$SOURCE" >&2
  exit 2
fi

COMMIT="${CPAMC_GEN_COMMIT:-}"
if [[ -z "$COMMIT" ]]; then
  COMMIT="$(sed -n 's/^commit=//p' "$PIN_FILE" 2>/dev/null | head -n 1 || true)"
fi
[[ -n "$COMMIT" ]] || COMMIT="unknown"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
OUT="${WORK_DIR}/run.gen.go"

# The transform, in one awk pass:
#   1. drop the upstream package doc comment and `package main` → generated header + `package cli`
#   2. `func init()`  → exported `func Init()` (cpamc calls it explicitly)
#   3. `func main()`  → `func Run(extraServerOptions ...api.ServerOption)`
#   4. inject extraServerOptions right after the serverOptions slice is created
#
# Top-level comment blocks are buffered so the doc comments attached to the two
# rewritten functions can be replaced instead of left describing `main`/`init`.
awk -v commit="$COMMIT" '
function flush() { for (i = 1; i <= np; i++) print pending[i]; np = 0 }

/^\/\// { pending[++np] = $0; next }

$0 == "package main" {
  np = 0
  print "// Code generated from cmd/server/main.go. DO NOT EDIT."
  print "//"
  print "// Source: backend/cmd/server/main.go @ " commit
  print "// Regenerate: bin/gen-cli-mirror.sh"
  print "//"
  print "// Package cli exposes the community CLIProxyAPI entrypoint as an importable"
  print "// package so the cpamc binary can serve both the management center and the"
  print "// full community CLI (OAuth login, TUI, Home mode, ...) from one executable,"
  print "// while cmd/server/main.go stays byte-identical to upstream."
  print "//"
  print "// Differences from the source, all applied mechanically by the generator:"
  print "//   1. package main            -> package cli"
  print "//   2. func init()             -> func Init()"
  print "//   3. func main()             -> func Run(extraServerOptions ...api.ServerOption)"
  print "//   4. serverOptions           -> extraServerOptions prepended"
  print "//"
  print "// Version, Commit and BuildDate below remain -ldflags injection points, now"
  print "// under this package path rather than main."
  print "package cli"
  next
}

$0 == "func init() {" {
  np = 0
  print "// Init performs the process-wide logger and buildinfo setup that the community"
  print "// entrypoint does in init(). It is exported because cpamc only wants it when"
  print "// dispatching to community CLI mode."
  print "func Init() {"
  next
}

$0 == "func main() {" {
  np = 0
  print "// Run executes the community CLI entrypoint. extraServerOptions lets cpamc"
  print "// inject secondary-development server options without touching upstream code."
  print "//"
  print "// Flags are still parsed from os.Args, exactly as upstream does."
  print "func Run(extraServerOptions ...api.ServerOption) {"
  next
}

{
  flush()
  print
  if ($0 == "\tserverOptions := []api.ServerOption(nil)") {
    print "\tif len(extraServerOptions) > 0 {"
    print "\t\tserverOptions = append(serverOptions, extraServerOptions...)"
    print "\t}"
  }
}

END { flush() }
' "$SOURCE" > "$OUT"

if ! gofmt -w "$OUT" 2>"${WORK_DIR}/gofmt.err"; then
  echo "生成结果不是合法 Go 代码，变换规则与上游入口已不匹配：" >&2
  sed 's/^/  /' "${WORK_DIR}/gofmt.err" >&2
  echo "请人工复核 bin/gen-cli-mirror.sh。" >&2
  exit 2
fi

if [[ "$CHECK_ONLY" == "true" ]]; then
  if [[ ! -f "$TARGET" ]]; then
    echo "生成目标不存在：${TARGET#"${ROOT_DIR}/"}，请运行 bin/gen-cli-mirror.sh" >&2
    exit 1
  fi
  if ! diff -u "$TARGET" "$OUT"; then
    echo "" >&2
    echo "run.gen.go 与上游入口不一致。请运行 bin/gen-cli-mirror.sh 重新生成后提交。" >&2
    echo "不要手改该文件：docs/architecture/backend-extension-architecture.md §6.3" >&2
    exit 1
  fi
  echo "run.gen.go 与 cmd/server/main.go 一致。"
  exit 0
fi

mkdir -p "$(dirname "$TARGET")"
cp "$OUT" "$TARGET"
echo "已生成 ${TARGET#"${ROOT_DIR}/"}（来源 cmd/server/main.go @ ${COMMIT}）"

