@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM CPAMC compose launcher for Windows — one script, multiple profiles.
REM Default profile: dev
REM up/restart: remove same-named leftover container, then rebuild.
REM MANAGEMENT_PASSWORD: use host env if set; otherwise generate and print.

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "REPO_ROOT=%%~fI"

if defined CPAMC_PROFILE (
  set "PROFILE=%CPAMC_PROFILE%"
) else (
  set "PROFILE=dev"
)
set "ACTION=up"

if "%~1"=="" goto :resolve
if /I "%~1"=="dev" goto :set_profile
if /I "%~1"=="test" goto :set_profile
if /I "%~1"=="default" goto :set_profile
if /I "%~1"=="prod" goto :set_profile
if /I "%~1"=="up" goto :set_action
if /I "%~1"=="down" goto :set_action
if /I "%~1"=="logs" goto :set_action
if /I "%~1"=="restart" goto :set_action
if /I "%~1"=="help" goto :usage
if /I "%~1"=="-h" goto :usage
if /I "%~1"=="--help" goto :usage
echo 未知参数: %~1
goto :usage

:set_profile
set "PROFILE=%~1"
shift
if "%~1"=="" goto :resolve
set "ACTION=%~1"
shift
if not "%~1"=="" (
  echo 多余参数: %*
  goto :usage
)
goto :resolve

:set_action
set "ACTION=%~1"
shift
if not "%~1"=="" (
  echo 多余参数: %*
  goto :usage
)
goto :resolve

:resolve
if /I "%PROFILE%"=="dev" (
  set "COMPOSE_FILE=%SCRIPT_DIR%docker-compose.dev.yml"
  set "PROJECT=cpamc"
  set "CONTAINER_NAME=cpamc-dev"
  set "MGMT_PORT=38317"
  set "ENGINE_PORT=38318"
  set "LABEL=dev"
  goto :ready
)
if /I "%PROFILE%"=="test" (
  set "COMPOSE_FILE=%SCRIPT_DIR%docker-compose.test.yml"
  set "PROJECT=cpamc"
  set "CONTAINER_NAME=cpamc-test"
  set "MGMT_PORT=28317"
  set "ENGINE_PORT=28318"
  set "LABEL=test"
  goto :ready
)
if /I "%PROFILE%"=="default" goto :profile_default
if /I "%PROFILE%"=="prod" goto :profile_default
echo 未知 profile: %PROFILE%
goto :usage

:profile_default
set "COMPOSE_FILE=%SCRIPT_DIR%docker-compose.yml"
set "PROJECT=cpamc"
set "CONTAINER_NAME=cpamc"
set "MGMT_PORT=18317"
set "ENGINE_PORT=18318"
set "LABEL=default"
goto :ready

:ready
where docker >nul 2>&1
if errorlevel 1 (
  echo 错误: 未找到 docker，请先安装 Docker Desktop
  exit /b 1
)

docker compose version >nul 2>&1
if errorlevel 1 (
  docker-compose version >nul 2>&1
  if errorlevel 1 (
    echo 错误: 未找到 docker compose，请安装 Docker Compose V2 或 docker-compose
    exit /b 1
  )
  set "COMPOSE_CMD=docker-compose"
) else (
  set "COMPOSE_CMD=docker compose"
)

if not exist "%COMPOSE_FILE%" (
  echo 错误: 未找到 %COMPOSE_FILE%
  exit /b 1
)

cd /d "%REPO_ROOT%"

if /I "%ACTION%"=="up" goto :up
if /I "%ACTION%"=="down" goto :down
if /I "%ACTION%"=="logs" goto :logs
if /I "%ACTION%"=="restart" goto :restart
echo 未知 action: %ACTION%
goto :usage

:remove_conflict
for /f "tokens=*" %%i in ('docker ps -aq --filter "name=^/%CONTAINER_NAME%$" 2^>nul') do (
  echo 发现已占用的容器名 /%CONTAINER_NAME% (%%i)，先删除以便重建...
  docker rm -f %%i >nul
)
exit /b 0

:ensure_password
if defined MANAGEMENT_PASSWORD (
  echo 使用已有 MANAGEMENT_PASSWORD（来自环境变量）
  exit /b 0
)
REM Prefer PowerShell for a URL-safe random secret; fall back to a RANDOM token.
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "$bytes = New-Object byte[] 24; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); $s = [Convert]::ToBase64String($bytes) -replace '[+/=]',''; if ($s.Length -gt 32) { $s.Substring(0,32) } else { $s }"`) do set "MANAGEMENT_PASSWORD=%%i"
if not defined MANAGEMENT_PASSWORD (
  set "MANAGEMENT_PASSWORD=cpamc%RANDOM%%RANDOM%%RANDOM%%RANDOM%"
)
echo ============================================================
echo   MANAGEMENT_PASSWORD (首次引导 / 本次注入):
echo   %MANAGEMENT_PASSWORD%
echo ============================================================
echo 提示: secret-key 已写入 config.yaml 后，后续重启不会再用此 env 覆盖。
exit /b 0

:up
call :remove_conflict
%COMPOSE_CMD% -p %PROJECT% -f "%COMPOSE_FILE%" down  >nul 2>&1
call :ensure_password
if errorlevel 1 exit /b 1
echo 构建并启动 CPAMC (%LABEL%)...
%COMPOSE_CMD% -p %PROJECT% -f "%COMPOSE_FILE%" up --build -d --force-recreate
if errorlevel 1 (
  echo 启动失败
  exit /b 1
)
echo 服务已启动，管理端口: %MGMT_PORT%，本地引擎: %ENGINE_PORT%
echo 健康检查: http://localhost:%MGMT_PORT%/health
echo 管理登录密码已通过 MANAGEMENT_PASSWORD 注入容器（见上方输出 / 容器启动日志）。
exit /b 0

:down
echo 停止 CPAMC (%LABEL%)...
%COMPOSE_CMD% -p %PROJECT% -f "%COMPOSE_FILE%" down
call :remove_conflict
exit /b 0

:logs
%COMPOSE_CMD% -p %PROJECT% -f "%COMPOSE_FILE%" logs -f
exit /b 0

:restart
echo 重启 CPAMC (%LABEL%)...
call :up
exit /b %ERRORLEVEL%

:usage
echo 用法: %~nx0 [profile] [action]
echo.
echo profile（默认: dev）:
echo   dev       docker-compose.dev.yml    宿主机 38317/38318
echo   test      docker-compose.test.yml   宿主机 28317/28318
echo   default   docker-compose.yml        宿主机 18317/18318
echo   prod      同 default
echo.
echo action（默认: up）:
echo   up        如有同名旧容器则删除，再构建并后台启动
echo   down      停止并移除本 profile 容器
echo   logs      跟踪日志
echo   restart   删除同名容器后重新构建启动
echo.
echo 环境变量:
echo   CPAMC_PROFILE          可覆盖默认 profile
echo   MANAGEMENT_PASSWORD    管理登录密钥；up/restart 时若未设置则随机生成并打印
exit /b 1
