# AGENTS.md

## 1. Background & Core Objective

This project (`Cli-Proxy-API-Management-Center`) is a management panel for CPA (Cli-Proxy-API). It is a **dual-upstream secondary-development monorepo** that composes:

- **Frontend upstream**: `router-for-me/Cli-Proxy-API-Management-Center` (React + TypeScript + Vite + SCSS Modules) mounted at `frontend/`
- **Backend upstream**: `router-for-me/CLIProxyAPI` (Go runtime, management API, executors, plugins) mounted at `backend/`
- **Local synthesis**: CPA operations UI/business, SQLite operations DB, `cpamc` unified entry, docs, and devcontainer at monorepo root control plane

**Authoritative layout**:

- `frontend/` = whole frontend project root (`package.json`, `vite.config.ts`, `index.html`, `src/`, …)
- `frontend/src/external/` = local frontend secondary-development zone
- `backend/` = whole backend Go module root (`go.mod`, `cmd/`, `internal/`, `sdk/`, …)
- `backend/internal/core/` and `backend/cmd/cpamc/` = local backend secondary-development zones
- Monorepo root keeps synthesis control-plane only: `AGENTS.md`, `doc/`, `.devcontainer/`, `build.sh`, local CI；各上游 pin 放在对应挂载点内

**Architecture Principle**:
- **"External" Isolation (Frontend)**: All CPA-specific frontend features live in `frontend/src/external/`. This subsystem is injected via a single `import '@/external/cpa-extension'` in `frontend/src/main.tsx`. It does not modify community Center components beyond Level 2 hooks.
- **"Core" Isolation (Backend)**: All non-community backend business lives in `backend/internal/core/`. Community CLIProxyAPI code remains under `backend/internal/*` (except `core/`) and `backend/sdk/`; do not mix secondary-dev logic into community packages.
- **Minimal Invasiveness**: Prefer not changing community frontend files or community backend packages mirrored from CLIProxyAPI, so upstream maintenance stays easy.
- **Dual-Upstream Mount Model**: Mirror each upstream's implementation/project tree into its mount point; never let upstream README/AGENTS/Docker/CI/docs take over the monorepo root control plane.
- **Community Sync One-liner**: 本仓是双上游合成 monorepo——前端整树挂 `frontend/`、后端整树挂 `backend/`；二开只在 external 与 core/cpamc；同步时优先复用已准备的上游 clone，否则 `/tmp` 只读准备；按 tag 选版本、以 commit 钉基线；**验证成功后再改** `*-upstream-ref`；保护二开与控制面并回归验证。完整规范见 [`doc/architecture/community-sync.md`](doc/architecture/community-sync.md)。

---

## 2. Directory Permission Levels

Below is the modification permission for each part of the codebase. These levels are **hard rules** — agent must follow them at all times.

### ✅ Level 1: Free to Modify（可以随便改）

> Agent 可以自由新增、修改、删除，无需征求用户确认。

| 目录/文件 | 说明 |
|-----------|------|
| `frontend/src/external/` | CPA 扩展模块的全部代码（features / components / pages / stores / hooks / types / utils / i18n / styles / assets） |
| `backend/internal/core/` | 后端二次开发业务（SQLite、探测、公益、采集、管理 API、localengine） |
| `backend/cmd/cpamc/` | 统一运行入口（管理中心 + 内置引擎） |
| `backend/` 其余目录 | Go 模块整体可改，但社区镜像代码（`sdk/`、`internal/*` 除 `core/`、`cmd/server` 等）应最小改动 |
| `bin/` | 发布/打包脚本 |
| `.devcontainer/` | Docker 开发环境：统一 `Dockerfile` + `start.sh`（默认 dev）；`docker-compose*.yml` 区分运行画像 |
| `.dockerignore` | Docker 忽略规则 |
| `doc/` | 项目全部正式文档、VitePress 配置和文档站点资源 |
| `build.sh` | 前端、Go 服务和 VitePress 文档统一构建入口 |
| `.github/workflows/` | 本地 CI / 文档部署工作流 |
| `AGENTS.md` | 本文件 |
| `frontend/.frontend-upstream-ref` | 前端社区同步基线 pin（成功合并后更新；commit 权威，tag 优先记录） |
| `backend/.cliproxyapi-upstream-ref` | 后端社区同步基线 pin（成功合并后更新；commit 权威，tag 优先记录） |

**原则**：`frontend/src/external/` 与 `backend/internal/core/` 是 agent 的主战场，可以自由组织结构、重构、新增、删除。社区 CLIProxyAPI 镜像代码（`backend/sdk/`、`backend/internal/*` 除 `core/`、`backend/cmd/server` 等）仅在必要时做最小改动。

**文档原则**：`doc/` 是唯一正式文档材料目录。除根目录的 `doc/README.md`、`doc/README_CN.md`、`LICENSE`、`AGENTS.md` 等仓库入口文件外，架构、设计、数据库、开发记录、历史方案和运维说明必须放入 `doc/`。`doc.local/` 只允许保留不会发布的本地测试资产或临时数据，不得新增正式 Markdown 文档，也不得将令牌、认证文件或二进制测试材料发布到 VitePress。

---

### ⚠️ Level 2: Modify with Caution（谨慎改）

> Agent 可以改，但必须遵循"最小改动"原则。每次改动前应先了解社区近期提交的上下文，确保自己的修改不会与社区已有改动产生冲突。

| 文件 | 改动目的 | 注意事项 |
|------|---------|---------|
| `frontend/src/main.tsx` | 初始化 external 模块 | 仅保留 `import '@/external/cpa-extension'`，不动社区原有逻辑 |
| `frontend/src/router/MainRoutes.tsx` | 合并 external 路由 | 仅在路由数组中追加 `...externalRoutes`，不动社区已有路由 |
| `frontend/src/components/layout/MainLayout.tsx` | 合并导航项 | 仅在导航数据中追加 `...externalNavGroups`，不动社区已有导航 |
| `frontend/package.json` | 补充依赖和脚本 | 仅添加 external 模块需要的依赖，不随意升级社区已有依赖版本 |

**约束**：
- 自己之前加的代码，后续需要删除、修改、重构，都是合理的——这属于对 integration 自身的维护
- 但**不要顺手改动社区原有逻辑**，即使你觉得那样"更合理"
- 改动前先 `git log` / `git blame` 了解这些文件近期被社区改过什么，避免冲突
- 每次改动后，确保 `git diff` 中看到的变更范围是可控的、与 integration 任务直接相关的

---

### 🚫 Level 3: Must Confirm with User（需要用户确认才能改）

> Agent **不得自行修改**，必须先向用户说明原因、提出方案，获得用户确认后才能动手。

| 目录/文件 | 说明 |
|-----------|------|
| `frontend/src/components/` (除 `layout/MainLayout.tsx`) | 社区已有组件 |
| `frontend/src/features/` | 社区已有功能模块 |
| `frontend/src/pages/` | 社区已有页面 |
| `frontend/src/stores/` | 社区已有状态管理 |
| `frontend/src/types/` | 社区已有类型定义 |
| `frontend/src/utils/` | 社区已有工具函数 |
| `frontend/src/hooks/` | 社区已有 hooks |
| `frontend/src/services/` | 社区已有 API 层（Axios client、providers、config 等） |
| `frontend/src/i18n/` | 社区已有国际化（`frontend/src/external/i18n/` 属 Level 1） |
| `frontend/src/styles/` | 社区已有样式（`frontend/src/external/styles/` 属 Level 1） |
| `frontend/src/assets/` | 社区已有静态资源（`frontend/src/external/assets/` 属 Level 1） |
| `frontend/src/router/` (除 `MainRoutes.tsx`) | 社区已有路由工具 |
| `frontend/vite.config.ts` | 构建配置 |
| `frontend/tsconfig.json` / `frontend/tsconfig.*.json` | TypeScript 配置 |
| `frontend/eslint.config.js` | 代码检查配置 |

**必须满足以下条件才能申请修改**：

1. 在 `frontend/src/external/` 中无法通过新增文件解决
2. 无法通过 import / re-export / 包装等方式绕开
3. 明确说明修改原因、改动范围、以及对社区代码的影响评估
4. 获得用户确认

---

## 3. Integration Strategy

### 3.0. Documentation (`doc/`)
- `doc/` is the canonical source for all project documentation.
- VitePress entry: `doc/index.md`; configuration: `doc/.vitepress/config.mts`.
- Documentation dependencies are isolated in `doc/package.json`.
- Use `./build.sh docs` to build and `./build.sh docs:dev` to serve locally.
- GitHub Pages is built by `.github/workflows/docs.yml`.
- Organize new documents by domain: `architecture/`, `charitable/`, `sqlite/`, `development/`, `history/`, or `archive/`.
- Do not publish files from `doc.local/test`, credential fixtures, generated binaries, SQLite databases, or secret-bearing JSON.

### 3.1. The `frontend/src/external` Directory (The "Add-on" Zone)
All new logic, components, pages, and stores from CPA must reside here. Entry point: `frontend/src/external/cpa-extension.ts` — one import in `frontend/src/main.tsx` injects i18n, routes, and navigation.

### 3.2. The `backend` Directory (The "Backend" Zone)
Go 后端是位于 `backend/` 的单一 Go 模块（module path: `github.com/agodomen/Cli-Proxy-API-Management-Center/backend`），按来源隔离：

**社区镜像（尽量少改）**
- `backend/sdk/` — 对应社区 `CLIProxyAPI/sdk`
- `backend/internal/*`（除 `core/`）— 对应社区 `CLIProxyAPI/internal`
- `backend/cmd/server/` — CLIProxyAPI 社区命令兼容入口
- `backend/examples/`、`backend/test/` — 社区示例与集成测试

**二次开发（主战场）**
- `backend/internal/core/` — 社区不存在的二次开发命名空间：SQLite 运营库、探测、公益运营、采集、管理 HTTP API
- `backend/internal/core/localengine/` — 将 CLIProxyAPI SDK 嵌入 `cpamc` 生命周期并桥接 Usage
- `backend/cmd/cpamc/main.go` — 项目统一运行入口（管理中心 + 可选内置引擎）

Go 测试文件（`*_test.go`）与源码同目录放置，无需单独 `src/test/` 目录。

维护规则：
- 非社区业务逻辑只放在 `backend/internal/core/`，不要扩散到社区 `internal/*` 包中
- 当前项目拥有一级 `sdk/` 和 `internal/` 源码，允许按项目目标直接演进，不使用嵌套模块或覆盖式上游同步
- 使用 `bin/compare-cliproxyapi.sh` 对比社区提交，再按当前架构人工移植需要的变化
- `internal/core/` 与 CLIProxyAPI 核心共享一个模块，但存储模型不同；通过明确接口融合，不直接混用两套 `config/store`
- `cpamc` 是统一运行入口，通过 `backend/internal/core/localengine/` 管理 CLIProxyAPI SDK 生命周期
- `/v0`、`/v1` 等社区协议路径默认保持不变，通过同一进程的不同监听端口区分管理与推理能力
- `backend/cmd/server` 只用于社区行为对照与兼容验证，发布和容器默认入口始终是 `cmd/cpamc`

### 3.3. Non-Code Assets (The "Shared" Zone)
Do **not** copy static assets (SVGs, images, fonts) if they already exist in the community project.
- **Action**: Import images directly from their original location in `frontend/src/assets/`.
- **Exception**: Only copy an asset if it is a unique, domain-specific graphic for the external feature that doesn't exist in the base project.

### 3.4. Styling & UI Consistency
- **Do Not** bring over new styling systems (e.g., Tailwind, Styled-Components) — the project uses SCSS Modules.
- **Action**: Re-implement the external features' UI using the community project's existing component library and SCSS Modules.
- **Goal**: The integrated features should look and feel like a native part of the community application.

### 3.5. State Management
- **Isolation**: Define new stores in `frontend/src/external/stores`.
- **Integration**: If an external feature needs to interact with a core store (e.g., user auth), create a "bridge" hook in `frontend/src/external/hooks` that safely consumes the core store.

### 3.6. Type Definitions
- **Isolation**: Define new types in `frontend/src/external/types`.
- **Reuse**: If a type already exists in `frontend/src/types`, import it instead of redefining it.

### 3.7. Routing
- **Registration**: External routes are defined in `frontend/src/external/externalRoutes.tsx`, merged into `frontend/src/router/MainRoutes.tsx` via spread.
- **Path Convention**: External routes do **not** use a `/external/` prefix. They use domain-specific prefixes (e.g., `/charitable`, `/ai-providers`, `/monitoring`, `/service-providers`).
- **Lazy Loading**: All external pages use `React.lazy` + `Suspense` to avoid impacting initial bundle size.

### 3.8. Plugin-Store Proxy (`plugin-proxy`)

Plugin-store list/install uses a dedicated outbound proxy independent of global `proxy-url`:

- YAML: `plugin-proxy.url` (last custom URL retained), `plugin-proxy.status` (`0` none / `1` custom / `2` system)
- Effective proxy: `status=0` → direct; `status=2` → `proxy-url`; `status=1` → `plugin-proxy.url`
- Management API: `GET/PUT/PATCH /v0/management/plugin-proxy`, `POST /v0/management/plugin-proxy/validate`
- UI lives on community Plugin Store page (`frontend/src/features/plugins/PluginStorePage.tsx`); browser does not download plugins — only the backend HTTP client uses the effective proxy

### 3.9. Community Frontend Sync Policy

- Baseline pin: `frontend/.frontend-upstream-ref`（与 `backend/.cliproxyapi-upstream-ref` 对称，挂在 frontend 挂载点内）。
- **Pin 更新时机**：合并开始前**只读** pin；代码移植且验证**成功后**才覆盖写入新 `commit`/`tag`。失败或中止则**不改** pin。禁止先改 pin 再合并。
- **Pin 格式**：规范为 key=value（`branch=main`、`commit`、`tag`）。现有纯文本两行或后端 `ref=` 读取时兼容；下次成功同步再写成规范格式。
- **版本选择**：优先按上游 **tag** 选定目标；pin 记录 **tag + commit**（`commit` 为唯一权威，`branch=main` 仅为跟踪线元数据）。
- **上游代码来源**：若上下文/环境已有准备好的上游 git 仓则直接复用并 `fetch --tags`（快）；否则在 `/tmp`（或 `mktemp -d`）只读准备目标 tag 树。细节见 [`doc/architecture/community-sync.md`](doc/architecture/community-sync.md) §5.3 / §6。
- Sync community frontend pages/features/components/services/stores/i18n/styles/assets into the corresponding non-`frontend/src/external/` trees under `frontend/`.
- Keep secondary-development interaction only in `frontend/src/external/`. After a community overlay, re-apply only the Level 2 integration hooks:
  - `frontend/src/main.tsx` → `import '@/external/cpa-extension'`
  - `frontend/src/router/MainRoutes.tsx` → `...externalRoutes`
  - `frontend/src/components/layout/MainLayout.tsx` → `...externalNavGroups`
- Do **not** modify non-community page/route interaction logic under `frontend/src/external/`.
- Do **not** port commercial advertising interaction from the community frontend. Explicit exclusions:
  - `/quick-start` page, route, nav entry, and dashboard entry
  - AI Providers “快速填入 / quick fill” section and related UI copy
  - `SponsorQuickStartPanel` and any `fixedBrand='apikeyFun'` quick-start presentation
- Reason: these are commercial advertising entry points, not core management functionality for this project.
- Provider plumbing that remains required by the normal AI Providers workbench (for example sponsor adapters shared by other brands) may stay, but `apikeyFun` must not appear as a dedicated quick-start page or quick-fill entry.

### 3.10. Community Backend Sync Policy

- Baseline pin: `backend/.cliproxyapi-upstream-ref`；叙事历史：`backend/CLIPROXYAPI_UPSTREAM_CN.md`。
- **Pin 更新时机**与前端相同：成功验证**之后**才改 pin；之前只读。
- **Pin 格式**与前端相同；若仍为 `ref=` 视为 `tag`，下次成功同步改为 `tag=`。
- **版本选择**：优先 tag；记录 tag + commit；默认跟踪 `main` 发布线。
- **上游代码来源**：优先上下文/环境中的现成 CLIProxyAPI clone（如 `CLIPROXYAPI_SOURCE`），否则 `/tmp` 只读准备；用 `bin/compare-cliproxyapi.sh` 对比后人工移植。
- Never overwrite `backend/internal/core/` or `backend/cmd/cpamc/`（以及 pin 本身）。
- Keep intentional local compatibility patches inventory-driven (auth file safety/index compatibility, OpenAI-compat single-key disable, disabled metadata compatibility, plugin-proxy, sqlite dependency, localengine wiring).
- Full procedure: [`doc/architecture/community-sync.md`](doc/architecture/community-sync.md).

## 4. Agent Execution Directives

1. **Analyze Before Coding**: Check if the feature already exists in the community codebase. If a similar component exists, adapt or extend it rather than creating a duplicate.
2. **Respect Permission Levels**: Strictly follow the three-level permission system. Never modify Level 3 files without explicit user approval.
3. **Prioritize Stability**: If a feature is tightly coupled to its original location, refactor it to be self-contained within `frontend/src/external/` before integrating.
4. **Reuse Existing Assets**: Always look for existing icons, utilities, hooks, and UI components in `frontend/src/components/ui/` and `frontend/src/external/components/ui/` before creating new ones.
5. **Consider Upstream Commit Compatibility**: When modifying Level 2 files, review recent community commits via `git log` / `git blame` to understand recent evolution patterns and avoid conflicts.
6. **Own Changes Are Flexible**: You may freely add, modify, or remove your own previous additions in `frontend/src/external/` and Level 2 files — this is normal integration iteration, not a violation.
7. **Documentation Is Part of Delivery**: Architecture, schema, migration, deployment, and operational behavior changes must update the corresponding page under `doc/`; do not add new formal documents under `doc.local/`.
8. **Follow Community Sync Policy**: When merging upstream frontend/backend community code, follow the one-liner in §1 and the full procedure in `doc/architecture/community-sync.md`. Do not invent a one-off overlay strategy.
9. **Upstream source & pin order**: Prefer an already-prepared upstream git checkout from context/env; only if absent, prepare a read-only tree under `/tmp`. Read `*-upstream-ref` before work; update it **only after** a successful merge and verification—never bump the pin first.

---

## 5. Target File Structure

```text
Cli-Proxy-API-Management-Center/
├── frontend/                      # 前端社区整仓挂载点 + 本地 external
│   ├── package.json / bun.lock
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig*.json
│   ├── eslint.config.js
│   ├── .prettierrc
│   ├── logo.jpg
│   ├── .frontend-upstream-ref     # 前端上游 pin（本地，同步时保护）
│   ├── tests/                     # 上游前端 tests（若存在）
│   └── src/
│       ├── assets/                # Level 3 — 社区静态资源
│       ├── components/            # Level 3 — 社区通用组件（除 MainLayout.tsx 为 Level 2）
│       ├── features/              # Level 3 — 社区功能模块
│       ├── hooks/                 # Level 3 — 社区 hooks
│       ├── i18n/                  # Level 3 — 社区国际化
│       ├── pages/                 # Level 3 — 社区页面
│       ├── router/                # Level 2 — MainRoutes.tsx 谨慎改
│       ├── services/              # Level 3 — 社区 API 层
│       ├── stores/                # Level 3 — 社区状态管理
│       ├── styles/                # Level 3 — 社区样式
│       ├── types/                 # Level 3 — 社区类型
│       ├── utils/                 # Level 3 — 社区工具函数
│       ├── external/              # Level 1 — CPA 扩展模块（自由改）
│       │   ├── cpa-extension.ts   #   扩展入口（i18n + 路由 + 导航注入）
│       │   ├── externalRoutes.tsx #   扩展路由定义
│       │   ├── externalNav.ts     #   扩展侧边栏导航
│       │   ├── components/        #   扩展组件
│       │   ├── features/          #   扩展功能模块
│       │   ├── hooks/             #   扩展 hooks
│       │   ├── i18n/              #   扩展国际化
│       │   ├── pages/             #   扩展页面
│       │   ├── services/          #   扩展 API 层
│       │   ├── stores/            #   扩展状态管理
│       │   ├── styles/            #   扩展样式
│       │   ├── types/             #   扩展类型
│       │   ├── utils/             #   扩展工具函数
│       │   └── assets/            #   扩展静态资源
│       ├── main.tsx               # Level 2 — 谨慎改（仅 import cpa-extension）
│       └── App.tsx                # Level 3 — 不动
│
├── backend/                       # 后端社区整仓挂载点 + 本地 core/cpamc
│   ├── go.mod / go.sum            # module: .../backend
│   ├── cmd/cpamc/main.go          # Level 1 — 程序入口
│   ├── cmd/server/                #   CLIProxyAPI 社区兼容入口
│   ├── sdk/                       #   一级 CLIProxyAPI SDK
│   ├── internal/                  #   CLIProxyAPI 核心实现
│   │   └── core/                  # Level 1 — 二次开发业务命名空间（社区无此目录）
│   │       ├── config/            #   二次开发配置
│   │       ├── store/             #   SQLite 运营持久层
│   │       ├── httpapi/           #   管理与运维 API
│   │       ├── collector/         #   事件采集器
│   │       ├── charitable/        #   公益运营
│   │       ├── probe/             #   异步探测
│   │       ├── usage/             #   Usage 事件模型
│   │       └── localengine/       #   统一运行时桥接
│   ├── examples/                  #   SDK 与插件示例
│   ├── test/                      #   CLIProxyAPI 集成测试
│   ├── .cliproxyapi-upstream-ref
│   └── CLIPROXYAPI_UPSTREAM_CN.md
│
├── bin/                           # Level 1 — 发布/打包脚本
├── .devcontainer/                 # Level 1 — Docker 开发环境
├── doc/                           # Level 1 — 全部正式文档 + VitePress 站点
│   ├── .vitepress/                #   VitePress 配置与构建输出（输出不提交）
│   ├── architecture/              #   系统架构与集成设计
│   ├── charitable/                #   公益管理、凭证与探测运营
│   ├── sqlite/                    #   SQLite 表、索引与迁移说明
│   ├── development/               #   开发日志与实现说明
│   ├── history/                   #   历史 PR、问题与阶段方案
│   ├── package.json               #   文档站独立依赖
│   └── index.md                   #   文档站首页
├── doc.local/                     # 仅本地测试资产/临时数据，禁止正式文档和发布
├── build.sh                       # Level 1 — frontend/backend/docs 构建入口
├── .github/workflows/             # Level 1 — CI / GitHub Pages

├── README.md
├── LICENSE
└── AGENTS.md                      # Level 1 — 本文件
```

路径与同步细则：

- [`doc/architecture/community-sync.md`](doc/architecture/community-sync.md)
- [`doc/architecture/monorepo-migration-plan.md`](doc/architecture/monorepo-migration-plan.md)
