<div align="center">
  <img src="doc/public/favicon.svg" width="96" height="96" alt="工具猿 / amonkey-tools" />
  <h1>工具猿（amonkey-tools）</h1>
  <p><strong>CLIProxyAPI 可视化管理、兼容代理、请求监控与凭证高可用运维平台</strong></p>
  <p><strong>A visual management, compatible proxy, request monitoring, and credential high-availability platform for CLIProxyAPI.</strong></p>
  <p>
    <a href="https://agodomen.github.io/Cli-Proxy-API-Management-Center/">在线文档 / Documentation</a>
    ·
    <a href="https://github.com/agodomen/Cli-Proxy-API-Management-Center/issues">问题反馈 / Issues</a>
    ·
    <a href="https://github.com/router-for-me/CLIProxyAPI">上游项目 / Upstream</a>
  </p>
  <p>
    <a href="https://github.com/agodomen/Cli-Proxy-API-Management-Center/actions/workflows/docs.yml"><img src="https://github.com/agodomen/Cli-Proxy-API-Management-Center/actions/workflows/docs.yml/badge.svg" alt="Documentation" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-black.svg" alt="MIT License" /></a>
    <img src="https://img.shields.io/badge/React-19-20232a?logo=react" alt="React 19" />
    <img src="https://img.shields.io/badge/Go-1.26-00ADD8?logo=go&logoColor=white" alt="Go 1.26" />
    <img src="https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite" alt="SQLite WAL" />
  </p>
</div>

## 项目简介（Project Overview）

> **建设初衷：** 本项目服务于日常编程与软件开发需求，帮助开发者更高效地建设虚拟世界中的软件服务与实用工具，增加软件与工具的使用体感。
>
> **Motivation:** This project supports everyday programming and software development, helping developers build useful software services and tools for the virtual world more efficiently while improving the overall experience of using them.

CLI Proxy API Management Center 是围绕 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 建设的一体化管理与运维平台。项目保留社区协议、认证、Provider Executor、OAuth、插件和 WebSocket 能力，同时增加 SQLite 数据中心、实时请求监控、异步探测、凭证策略运营、代理管理和 CPA 配置同步。

CLI Proxy API Management Center is an integrated management and operations platform built around [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI). It preserves the community protocol, authentication, provider executor, OAuth, plugin, and WebSocket capabilities while adding SQLite-backed operations, real-time request monitoring, asynchronous probing, credential policy management, proxy management, and CPA configuration synchronization.

当前后端已经融合为一个 Go 模块和一个默认运行进程。`cpamc` 同时提供管理运维 API 和内置 CLIProxyAPI，两套服务通过不同端口隔离，不需要修改社区 `/v0`、`/v1` 协议路径。

The backend is now integrated into one Go module and one default runtime process. `cpamc` serves both the management API and the embedded CLIProxyAPI on separate ports, so the community `/v0` and `/v1` protocol paths remain unchanged.

> **项目状态：** 项目正在持续演进。当前已经完成社区核心源码融合、统一启动、Usage 采集桥接和运维数据闭环；SQLite 凭证直接驱动内置执行引擎仍在后续演进计划中。
>
> **Project Status:** The project is under active development. Community core integration, unified startup, usage ingestion, and the operations data loop are available; direct SQLite credential access for the embedded execution engine remains planned work.

## 项目解决什么问题（What It Solves）

- 集中管理账号、认证文件、API Key、上游提供商、渠道和代理服务器。  
  Centrally manage accounts, authentication files, API keys, upstream providers, channels, and proxy servers.
- 追踪每次请求使用的账号、提供商、模型、状态、延迟、Token 和费用。  
  Track the account, provider, model, status, latency, token usage, and cost of every request.
- 通过真实请求和主动探测持续识别有效、未知、失效、禁用和过期凭证。  
  Continuously identify valid, unknown, invalid, disabled, and expired credentials through real requests and active probing.
- 按提供商策略自动调整凭证状态、优先级和过期时间。  
  Automatically adjust credential status, priority, and expiration according to provider policies.
- 将 SQLite 中筛选出的高质量凭证按提供商同步到外部 CPA。  
  Synchronize high-quality credentials selected in SQLite to an external CPA by provider.
- 在保持社区兼容的同时，为后续独立改造协议、调度和账号选择流程提供统一代码基础。  
  Preserve community compatibility while providing a unified codebase for future protocol, scheduling, and account-selection improvements.

## 核心能力（Core Capabilities）

### CPA 管理（CPA Management）

- 提供仪表盘、配置面板、系统状态、日志、配额和运行信息。  
  Provides dashboards, configuration panels, system status, logs, quota information, and runtime details.
- 管理 Gemini、Codex、Claude、Vertex、OpenAI 兼容服务等提供商配置。  
  Manages Gemini, Codex, Claude, Vertex, OpenAI-compatible, and other provider configurations.
- 支持认证文件上传、下载、启停、优先级、模型映射和批量管理。  
  Supports authentication file upload, download, activation, priority, model mapping, and batch operations.
- 保留 Codex、Anthropic、Antigravity、Kimi、xAI 等 OAuth 流程。  
  Preserves OAuth flows for Codex, Anthropic, Antigravity, Kimi, xAI, and other providers.
- 保留插件管理、插件商店和 CLIProxyAPI 社区兼容接口。  
  Preserves plugin management, the plugin store, and CLIProxyAPI-compatible community endpoints.

![CPA 管理界面](https://github.com/user-attachments/assets/b0582897-9fc5-49e1-b80a-d6f5a9a5dc19)

### 请求监控（Request Monitoring）

- 采集外部 CPA 和内置执行引擎的请求事件并写入 SQLite。  
  Collects request events from both external CPA instances and the embedded engine into SQLite.
- 基于 SSE 实时展示最新请求，不需要手动刷新请求记录。  
  Displays the latest request records through SSE without manual polling.
- 按账号、提供商、模型、渠道、状态和时间范围筛选。  
  Filters by account, provider, model, channel, status, and time range.
- 统计 Token、费用、成功率、失败来源、延迟和首 Token 时间。  
  Aggregates token usage, cost, success rate, failure sources, latency, and time to first token.
- 支持模型价格维护、请求数据导入导出和 API Key 别名。  
  Supports model pricing, request data import and export, and API key aliases.

![请求监控界面](https://github.com/user-attachments/assets/12db1ee2-03b7-43fe-b3bb-bdc8a6ad7928)

### 凭证高可用（Credential High Availability）

- 使用 `cpa_auth_detail` 统一保存 API Key、认证文件、OAuth、OIDC 和多 Key 凭证。  
  Uses `cpa_auth_detail` to store API keys, authentication files, OAuth, OIDC, and multi-key credentials consistently.
- 将每次真实请求转换为异步探测结果，持续评估账号质量。  
  Converts every real request into an asynchronous probe result for continuous account-quality evaluation.
- 支持主动单个探测、批量探测和全部筛选结果探测。  
  Supports active single-item, batch, and all-filtered-result probing.
- 根据连续成功或失败自动调整状态、优先级和过期时间。  
  Automatically adjusts status, priority, and expiration based on consecutive successes or failures.
- 保护手动禁用、失效和过期等人工状态，避免自动巡检错误覆盖。  
  Protects manually assigned disabled, invalid, and expired states from unintended probe overrides.
- 以提供商策略为主，支持继承全局策略和凭证级例外配置。  
  Uses provider-level policies by default, with global inheritance and credential-level exceptions.

### 公益运营（Charitable Operations）

- 词元中心统一管理渠道、提供商、密钥、策略和探测统计。  
  Centrally manages channels, providers, credentials, policies, and probe statistics in the Token Center.
- 支持多密钥导入、提供商自动匹配、提供商级 CPA 同步和反向覆盖同步。  
  Supports multi-key import, automatic provider matching, provider-level CPA synchronization, and reverse overwrite synchronization.
- 提供商和密钥编辑使用抽屉交互，不切换当前运营页面。  
  Uses drawer-based provider and credential editing without leaving the current operations page.
- 代理库存支持协议识别、连通性测试和预置站点访问测试。  
  Provides protocol detection, connectivity testing, and predefined website access tests for proxy inventory.
- 可将筛选后的代理生成 Clash Verge 全局扩展脚本并复制到剪贴板。  
  Generates a Clash Verge global extension script from filtered proxies and copies it to the clipboard.
- 调试开发提供 SQL 调试、API 调试和密钥识别探测工作区。  
  Provides SQL debugging, API debugging, and credential identification and probing workspaces.

![词元中心](https://github.com/user-attachments/assets/67176813-7d91-4eee-89d7-c74312019738)

![代理管理](https://github.com/user-attachments/assets/529e9c2b-1683-486e-ab28-7deb8c4439fb)

![调试开发](https://github.com/user-attachments/assets/b0de4280-8753-401a-95c7-a1c472d2d7e2)

## 系统架构（System Architecture）

```text
浏览器 / Browser
  └─ React 管理中心 / React Management Center
       ├─ 社区管理功能 / Community Management Features
       └─ src/external CPA 扩展 / CPA Extension
                    │
                    ▼
┌──────────────────────── cpamc 单一进程 / Single Process ────────────────────────┐
│                                                                                 │
│  :18317 管理与运维 API                  :18318 内置 CLIProxyAPI                  │
│  Management and Operations API          Embedded CLIProxyAPI                    │
│  ├─ SQLite 凭证与策略                   ├─ /v1/* 模型协议                       │
│  ├─ 请求监控与 SSE                      ├─ /v0/management/*                     │
│  ├─ 异步探测                            └─ CLIProxyAPI SDK Runtime              │
│  └─ 外部 CPA 同步与采集                           │ Usage Plugin                  │
│            │                                       ▼                             │
│            └──────────────────────────► SQLite Usage + Probe                     │
└─────────────────────────────────────────────────────────────────────────────────┘
          │                                                    │
          ▼                                                    ▼
外部社区 CPA / External Community CPA                    上游模型服务 / Providers
```

### 端口与入口（Ports and Endpoints）

| 入口 | 默认地址 | 用途 |
|---|---|---|
| 管理与运维服务 / Management API | `http://localhost:18317` | 管理界面、SQLite 运营、请求监控、探测和配置同步 |
| 管理健康检查 / Management Health | `http://localhost:18317/health` | 容器和服务健康检查 |
| 管理运行状态 / Management Status | `http://localhost:18317/status` | 查看采集器、数据库和内置引擎状态 |
| 内置代理服务 / Embedded Proxy | `http://localhost:18318/v1` | CLIProxyAPI 兼容模型请求 |
| 内置引擎健康检查 / Engine Health | `http://localhost:18318/healthz` | 内置 CLIProxyAPI 健康检查 |

### 当前数据边界（Current Data Boundary）

SQLite 是账号、提供商、运营策略、探测结果和请求记录的事实来源。高质量凭证可以同步到外部 CPA 使用；内置 CLIProxyAPI 当前仍读取自己的 `config.yaml` 和认证目录，但 Usage 已直接回写同一个 SQLite 数据闭环。

SQLite is the source of truth for accounts, providers, operations policies, probe results, and request records. High-quality credentials can be synchronized to an external CPA. The embedded CLIProxyAPI currently still reads its own `config.yaml` and authentication directory, while its usage records are already written back into the same SQLite operations loop.

## 快速开始（Quick Start）

### 使用 Docker Compose（Using Docker Compose）

环境要求：Docker 和 Docker Compose V2。仓库根目录执行：

Requirements: Docker and Docker Compose V2. Run from the repository root:

```bash
bash .devcontainer/start-service.sh up
```

启动完成后访问：

After startup, open:

- 管理服务 / Management service: <http://localhost:18317>
- 内置 CLIProxyAPI / Embedded CLIProxyAPI: <http://localhost:18318/v1>
- 健康检查 / Health check: <http://localhost:18317/health>

SQLite、内置引擎配置和认证目录保存在 Docker Volume `cpamc-proxy-data` 中。

SQLite data, embedded engine configuration, and authentication files are stored in the `cpamc-proxy-data` Docker volume.

```bash
bash .devcontainer/start-service.sh logs
bash .devcontainer/start-service.sh restart
bash .devcontainer/start-service.sh down
```

### 本地开发（Local Development）

环境要求：Node.js 22 或 Bun 1.3、Go 1.26。

Requirements: Node.js 22 or Bun 1.3, and Go 1.26.

```bash
# 前端 / Frontend
bun install --frozen-lockfile
bun run dev

# 统一 Go 服务 / Unified Go service
cd services
go run ./cmd/cpamc
```

前端开发服务默认监听 <http://localhost:5173>。首次启动 `cpamc` 时会生成 `config.json`，内置引擎配置默认生成在数据目录的 `cliproxyapi/config.yaml`。

The frontend development server listens on <http://localhost:5173> by default. On the first `cpamc` startup, `config.json` is generated, and the embedded engine configuration is created at `cliproxyapi/config.yaml` under the data directory.

### 首次配置（First-time Setup）

1. 打开管理界面，在系统设置中配置需要连接的外部 CPA 地址和 Management Key。  
   Open the management UI and configure the external CPA address and Management Key in System Settings.
2. 在词元中心维护渠道、提供商、密钥和代理，或者通过导入功能批量录入。  
   Maintain channels, providers, credentials, and proxies in the Token Center, or import them in batches.
3. 开启探测服务并配置全局或提供商策略，先观察探测结果和状态变化。  
   Enable probing and configure global or provider policies, then observe probe results and status transitions.
4. 使用提供商级同步将符合策略的凭证发送到外部 CPA。  
   Use provider-level synchronization to send credentials that satisfy the policy to the external CPA.

## 配置说明（Configuration）

管理服务支持 `config.json` 和环境变量；环境变量优先。常用配置如下：

The management service supports both `config.json` and environment variables, with environment variables taking precedence:

| 环境变量 | 默认值 | 说明 |
|---|---:|---|
| `HTTP_ADDR` | `0.0.0.0:18317` | 管理与运维 API 监听地址 |
| `USAGE_DB_PATH` | `<dataDir>/usage.sqlite` | SQLite 数据库路径 |
| `CPA_UPSTREAM_URL` | 空 | 外部 CPA 地址，可在系统设置中维护 |
| `CPA_MANAGEMENT_KEY` | 空 | 外部 CPA Management Key，生产环境建议使用 Secret 文件 |
| `USAGE_COLLECTOR_MODE` | `auto` | 采集模式：`auto`、`http`、`resp` 或 `subscribe` |
| `USAGE_QUERY_LIMIT` | `50000` | 请求查询最大记录数 |
| `USAGE_CORS_ORIGINS` | `*` | 允许的 CORS 来源，公网部署必须收紧 |
| `CPAMC_LOCAL_ENGINE_ENABLED` | `true` | 是否启用内置 CLIProxyAPI |
| `CPAMC_LOCAL_ENGINE_CONFIG` | `<dataDir>/cliproxyapi/config.yaml` | 内置引擎配置路径 |
| `CPAMC_LOCAL_ENGINE_HOST` | `0.0.0.0` | 内置引擎监听地址 |
| `CPAMC_LOCAL_ENGINE_PORT` | `18318` | 内置引擎监听端口 |

完整配置说明请查看[双引擎架构文档](doc/architecture/cliproxyapi-dual-engine.md)和[在线文档](https://agodomen.github.io/Cli-Proxy-API-Management-Center/)。

See the [dual-engine architecture document](doc/architecture/cliproxyapi-dual-engine.md) and the [online documentation](https://agodomen.github.io/Cli-Proxy-API-Management-Center/) for more details.

## 构建与验证（Build and Verification）

```bash
./build.sh service       # 构建前端和统一 Go 服务 / Build frontend and unified Go service
./build.sh cliproxyapi   # 构建社区兼容入口 / Build the community-compatible entry
./build.sh docs          # 构建 VitePress 文档 / Build VitePress documentation
./build.sh all           # 构建服务与文档 / Build service and documentation
./build.sh docs:dev      # 启动本地文档服务 / Start local documentation server
./build.sh docs:preview  # 预览文档构建结果 / Preview documentation build
./build.sh clean         # 清理构建输出 / Clean build outputs
```

前端验证：

Frontend verification:

```bash
npm run type-check
npm run lint
npm run build
```

后端验证：

Backend verification:

```bash
cd services
go test ./...
go build ./...
```

如需核对当前 CLIProxyAPI 核心与指定社区提交的差异，可以运行只读对比脚本：

To compare the current CLIProxyAPI core against a selected community revision, run the read-only comparison script:

```bash
bin/compare-cliproxyapi.sh \
  --source /path/to/CLIProxyAPI \
  --ref main
```

## 项目目录（Project Structure）

```text
├── frontend/                         # 前端社区整仓挂载点 / Frontend upstream mount
│   ├── .frontend-upstream-ref        # 前端上游 pin
│   └── src/external/                 # CPA 扩展页面、服务、状态和国际化
├── backend/                          # 后端社区整仓挂载点 / Backend Go module
│   ├── cmd/cpamc/                    # 默认统一入口 / Default unified entry
│   ├── cmd/server/                   # CLIProxyAPI 社区兼容入口
│   ├── sdk/                          # 一级 CLIProxyAPI SDK / Top-level SDK
│   ├── internal/                     # CLIProxyAPI 核心实现 / CLIProxyAPI core
│   │   └── core/                      # 二次开发业务（SQLite、探测、采集、公益运营）
│   ├── examples/                     # SDK 和插件示例 / SDK and plugin examples
│   └── test/                         # CLIProxyAPI 兼容测试 / Compatibility tests
├── doc/                              # VitePress 正式文档 / Official documentation
├── doc.local/                        # 本地设计材料 / Local design materials
├── .github/workflows/                # Release 和 GitHub Pages 工作流
├── .devcontainer/                    # 统一 Dockerfile、Compose 和启动脚本
├── bin/                              # 对比、构建与发布脚本
└── build.sh                          # 统一构建入口 / Unified build entry
```

## 兼容与演进策略（Compatibility and Evolution）

- 当前项目直接维护 `backend/sdk/` 和 `backend/internal/` 中的 CLIProxyAPI 核心源码，不再使用嵌套模块或覆盖式同步。  
  This project directly maintains the CLIProxyAPI core under `backend/sdk/` and `backend/internal/`, without nested modules or overwrite-based synchronization.
- `backend/cmd/server` 用于社区行为兼容和差异验证，Docker 与默认发布入口使用 `backend/cmd/cpamc`。  
  `backend/cmd/server` is retained for community behavior compatibility and comparison, while Docker and default releases use `backend/cmd/cpamc`.
- 当前保持社区 `/v0`、`/v1` 路径不变，通过 `18317` 和 `18318` 两个端口区分管理与推理能力。  
  Community `/v0` and `/v1` paths remain unchanged; ports `18317` and `18318` separate management and inference capabilities.
- 社区更新先通过 `bin/compare-cliproxyapi.sh` 评估，再结合当前 SQLite 和统一运行架构人工移植。  
  Community updates are evaluated with `bin/compare-cliproxyapi.sh` and then manually adapted to the current SQLite and unified-runtime architecture.

初始融合基线记录在 `backend/.cliproxyapi-upstream-ref`，详细维护说明见 `backend/CLIPROXYAPI_UPSTREAM_CN.md`。

The initial integration baseline is recorded in `backend/.cliproxyapi-upstream-ref`. See `backend/CLIPROXYAPI_UPSTREAM_CN.md` for maintenance details.

## 文档（Documentation）

- [在线文档 / Online Documentation](https://agodomen.github.io/Cli-Proxy-API-Management-Center/)
- [背景现状 / Background](doc/background/index.md)
- [功能服务 / Feature Services](doc/services/index.md)
- [架构设计 / Architecture](doc/architecture/index.md)
- [数据模型 / Data Model](doc/sqlite/index.md)
- [开发记录 / Development Records](doc/development/index.md)
- [里程碑 / Milestones](doc/milestones/index.md)
- [归档文档 / Archive](doc/archive/index.md)

`doc/` 是项目唯一的正式文档目录。`doc.local/` 用于本地设计材料，不参与公开文档站发布。

`doc/` is the only canonical documentation directory. `doc.local/` contains local design materials and is not published to the public documentation site.

## 安全说明（Security）

- Management Key、API Key、OAuth Token、认证文件和代理密码都属于敏感信息。  
  Management keys, API keys, OAuth tokens, authentication files, and proxy passwords are sensitive data.
- SQLite 可能包含管理配置、请求快照和凭证本体，应限制数据库文件和 Volume 的访问权限。  
  SQLite may contain management configuration, request snapshots, and credentials; restrict access to the database file and Docker volume.
- 公网部署前必须配置 TLS、反向代理、访问控制、可信 CORS 来源和网络隔离。  
  Configure TLS, a reverse proxy, access control, trusted CORS origins, and network isolation before public deployment.
- 不要把真实凭证、数据库、认证目录或含秘密的调试结果提交到 Git。  
  Never commit real credentials, databases, authentication directories, or secret-bearing debug output to Git.
- 推荐通过 `CPA_MANAGEMENT_KEY_FILE` 或容器 Secret 注入 Management Key。  
  Prefer `CPA_MANAGEMENT_KEY_FILE` or container secrets for injecting the Management Key.

## 参与贡献（Contributing）

欢迎提交 Issue 和 Pull Request。建议说明问题背景、复现步骤、预期行为、相关版本、UI 截图或接口示例，以及已经执行的测试命令。

Issues and pull requests are welcome. Please include the context, reproduction steps, expected behavior, related versions, UI screenshots or API examples, and the validation commands you have run.

新增 CPA 扩展功能应优先放在 `frontend/src/external/` 或 `backend/internal/core/`，并同步更新 `doc/`。修改社区前端目录前请先阅读 [AGENTS.md](AGENTS.md) 中的权限边界。

New CPA extension features should preferably live in `frontend/src/external/` or `backend/internal/core/`, with corresponding updates under `doc/`. Read the permission boundaries in [AGENTS.md](AGENTS.md) before modifying community frontend directories.

## 相关项目（Related Projects）

- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) — 上游代理内核与协议实现 / Upstream proxy core and protocol implementation
- [Cli-Proxy-API-Management-Center](https://github.com/agodomen/Cli-Proxy-API-Management-Center) — 当前项目仓库 / This project repository

## 开源协议（License）

本项目采用 [MIT License](LICENSE)。CLIProxyAPI 融合源码的上游许可副本见 [`backend/LICENSE.CLIProxyAPI`](backend/LICENSE.CLIProxyAPI)。

This project is licensed under the [MIT License](LICENSE). The upstream license copy for the integrated CLIProxyAPI source is available at [`backend/LICENSE.CLIProxyAPI`](backend/LICENSE.CLIProxyAPI).
