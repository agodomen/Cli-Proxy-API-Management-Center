#!/bin/bash
# CPAMC compose launcher — one script, multiple profiles.
# Default profile: dev
#
# Usage:
#   .devcontainer/start.sh                 # dev up
#   .devcontainer/start.sh up|down|logs|restart
#   .devcontainer/start.sh dev|test|default|prod [up|down|logs|restart]
#   CPAMC_PROFILE=test .devcontainer/start.sh logs

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

DEFAULT_PROFILE="${CPAMC_PROFILE:-dev}"
PROFILE="${DEFAULT_PROFILE}"
ACTION="up"

usage() {
  cat <<EOF
用法: $(basename "$0") [profile] [action]

profile（默认: dev）:
  dev       docker-compose.dev.yml    宿主机 38317/38318
  test      docker-compose.test.yml   宿主机 28317/28318
  default   docker-compose.yml        宿主机 18317/18318
  prod      同 default

action（默认: up）:
  up        如有同名旧容器则删除，再构建并后台启动
  down      停止并移除本 profile 容器
  logs      跟踪日志
  restart   删除同名容器后重新构建启动

环境变量:
  CPAMC_PROFILE          未显式传 profile 时的默认值（当前: ${DEFAULT_PROFILE}）
  MANAGEMENT_PASSWORD    管理登录密钥；up/restart 时若未设置则随机生成并打印
EOF
}

is_profile() {
  case "$1" in
    dev|test|default|prod) return 0 ;;
    *) return 1 ;;
  esac
}

is_action() {
  case "$1" in
    up|down|logs|restart|help|-h|--help) return 0 ;;
    *) return 1 ;;
  esac
}

if [[ $# -gt 0 ]]; then
  if is_profile "$1"; then
    PROFILE="$1"
    shift
    if [[ $# -gt 0 ]]; then
      ACTION="$1"
      shift
    fi
  elif is_action "$1"; then
    ACTION="$1"
    shift
  else
    echo "未知参数: $1" >&2
    usage >&2
    exit 2
  fi
fi

if [[ $# -gt 0 ]]; then
  echo "多余参数: $*" >&2
  usage >&2
  exit 2
fi

case "${ACTION}" in
  help|-h|--help)
    usage
    exit 0
    ;;
esac

case "${PROFILE}" in
  dev)
    COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.dev.yml"
    PROJECT="cpamc"
    CONTAINER_NAME="cpamc-dev"
    MGMT_PORT="38317"
    ENGINE_PORT="38318"
    LABEL="dev"
    ;;
  test)
    COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.test.yml"
    PROJECT="cpamc"
    CONTAINER_NAME="cpamc-test"
    MGMT_PORT="28317"
    ENGINE_PORT="28318"
    LABEL="test"
    ;;
  default|prod)
    COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
    PROJECT="cpamc"
    CONTAINER_NAME="cpamc"
    MGMT_PORT="18317"
    ENGINE_PORT="18318"
    LABEL="default"
    ;;
  *)
    echo "未知 profile: ${PROFILE}" >&2
    usage >&2
    exit 2
    ;;
esac

cd "${REPO_ROOT}"

if ! command -v docker >/dev/null 2>&1; then
  echo "错误: 未找到 docker，请先安装 Docker" >&2
  exit 1
fi

COMPOSE_CMD=(docker compose)
if ! docker compose version >/dev/null 2>&1; then
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose)
  else
    echo "错误: 未找到 docker compose，请安装 Docker Compose V2 或 docker-compose" >&2
    exit 1
  fi
fi

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "错误: 未找到 ${COMPOSE_FILE}" >&2
  exit 1
fi

run_compose() {
  "${COMPOSE_CMD[@]}" -p "${PROJECT}" -f "${COMPOSE_FILE}" "$@"
}

# Ensure MANAGEMENT_PASSWORD is available for compose interpolation.
# Prefer an explicit host env value; otherwise generate a URL-safe random secret
# and export it so docker compose can pass it into the container.
ensure_management_password() {
  if [[ -n "${MANAGEMENT_PASSWORD:-}" ]]; then
    export MANAGEMENT_PASSWORD
    echo "使用已有 MANAGEMENT_PASSWORD（来自环境变量，长度 ${#MANAGEMENT_PASSWORD}）"
    return 0
  fi

  local generated=""
  if command -v openssl >/dev/null 2>&1; then
    generated="$(openssl rand -base64 24 | tr -d '=+/\n' | cut -c1-32)"
  fi
  if [[ -z "${generated}" ]]; then
    generated="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32 || true)"
  fi
  if [[ -z "${generated}" || ${#generated} -lt 16 ]]; then
    echo "错误: 无法生成 MANAGEMENT_PASSWORD，请先 export MANAGEMENT_PASSWORD=..." >&2
    exit 1
  fi

  export MANAGEMENT_PASSWORD="${generated}"
  echo "============================================================"
  echo "  MANAGEMENT_PASSWORD (首次引导 / 本次注入):"
  echo "  ${MANAGEMENT_PASSWORD}"
  echo "============================================================"
  echo "提示: secret-key 已写入 config.yaml 后，后续重启不会再用此 env 覆盖。"
}

# Remove a leftover container that still holds the fixed container_name
# (common after project rename, e.g. old -p cpamc vs new -p cpamc-dev).
remove_name_conflict() {
  local id
  id="$(docker ps -aq --filter "name=^/${CONTAINER_NAME}$" 2>/dev/null || true)"
  if [[ -n "${id}" ]]; then
    echo "发现已占用的容器名 /${CONTAINER_NAME} (${id})，先删除以便重建..."
    docker rm -f "${id}" >/dev/null
  fi
}

bring_up() {
  remove_name_conflict
  # Drop this compose project if it partially exists, then rebuild cleanly.
  run_compose down >/dev/null 2>&1 || true
  ensure_management_password
  echo "构建并启动 CPAMC (${LABEL})..."
  run_compose up --build -d --force-recreate
  echo "服务已启动，管理端口: ${MGMT_PORT}，本地引擎: ${ENGINE_PORT}"
  echo "健康检查: http://localhost:${MGMT_PORT}/health"
  echo "管理登录密码已通过 MANAGEMENT_PASSWORD 注入容器（见上方输出 / 容器启动日志）。"
}

case "${ACTION}" in
  up)
    bring_up
    ;;
  down)
    echo "停止 CPAMC (${LABEL})..."
    run_compose down
    # Also clear a stray same-named container from another compose project.
    remove_name_conflict
    ;;
  logs)
    run_compose logs -f
    ;;
  restart)
    echo "重启 CPAMC (${LABEL})..."
    bring_up
    ;;
  *)
    echo "未知 action: ${ACTION}" >&2
    usage >&2
    exit 2
    ;;
esac
