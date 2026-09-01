# AGENTS.md

一个以CLIProxyAPI & CLI Proxy API Management Center为基础的衍生项目。

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
- Monorepo root keeps synthesis control-plane only: `AGENTS.md`, `docs/`, `.devcontainer/`, `build.sh`, local CI；各上游 pin 放在对应挂载点内

**Architecture Principle**:
- **"External" Isolation (Frontend)**: All CPA-specific frontend features live in `frontend/src/external/`. Entry point (`main.tsx`, `App.tsx`), layout (`MainLayout.tsx`), and route registration (`externalRoutes.tsx`, `MainRoutes.tsx`) are mirrored into `frontend/src/external/` so that community files under `frontend/src/` can be overwritten without losing secondary-dev integration. Community sync only needs to overwrite `index.html` entry to point to `frontend/src/external/main.tsx`.
- **"Core" Isolation (Backend)**: All non-community backend business lives in `backend/internal/core/`. Community CLIProxyAPI code remains under `backend/internal/*` (except `core/`) and `backend/sdk/`; do not mix secondary-dev logic into community packages.
- **Minimal Invasiveness**: Prefer not changing community frontend files or community backend packages mirrored from CLIProxyAPI, so upstream maintenance stays easy.
- **Dual-Upstream Mount Model**: Mirror each upstream's implementation/project tree into its mount point; never let upstream README/AGENTS/Docker/CI/docs take over the monorepo root control plane.
- **Community Sync One-liner**: 本仓是双上游合成 monorepo——前端整树挂 `frontend/`、后端整树挂 `backend/`；二开只在 external 与 core/cpamc；同步时优先复用已准备的上游 clone，否则 `/tmp` 只读准备；按 tag 选版本、以 commit 钉基线；**验证成功后再改** `*-upstream-ref`；保护二开与控制面并回归验证。完整规范见 [`docs/architecture/community-sync.md`](docs/architecture/community-sync.md)。
- **Sync Tool**: `bin/sync-community.sh` 在候选树中镜像社区代码，跳过 `bin/sync-manifest.conf`，验证成功后再事务式替换挂载点和更新 pin。真实同步必须传 `--confirm-manifest`；同 commit 重铺使用 `--force`。后端清单当前仅 1 个社区兼容补丁；前端清单保护 external 入口、构建依赖和商业入口排除文件。

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
| `docs/` | 项目全部正式文档、VitePress 配置和文档站点资源 |
| `build.sh` | 前端、Go 服务和 VitePress 文档统一构建入口 |
| `.github/workflows/` | 本地 CI / 文档部署工作流 |
| `AGENTS.md` | 本文件 |
| `frontend/.frontend-upstream-ref` | 前端社区同步基线 pin（成功合并后更新；commit 权威，tag 优先记录） |
| `backend/.cliproxyapi-upstream-ref` | 后端社区同步基线 pin（成功合并后更新；commit 权威，tag 优先记录） |

**原则**：`frontend/src/external/` 与 `backend/internal/core/` 是 agent 的主战场，可以自由组织结构、重构、新增、删除。社区 CLIProxyAPI 镜像代码（`backend/sdk/`、`backend/internal/*` 除 `core/`、`backend/cmd/server` 等）仅在必要时做最小改动。

**文档原则**：`docs/` 是唯一正式文档材料目录。除根目录的 `docs/README.md`、`docs/README_CN.md`、`LICENSE`、`AGENTS.md` 等仓库入口文件外，架构、设计、数据库、开发记录、历史方案和运维说明必须放入 `docs/`。`doc.local/` 只允许保留不会发布的本地测试资产或临时数据，不得新增正式 Markdown 文档，也不得将令牌、认证文件或二进制测试材料发布到 VitePress。

---

### ⚠️ Level 2: Modify with Caution（谨慎改）

> Agent 可以改，但必须遵循"最小改动"原则。每次改动前应先了解社区近期提交的上下文，确保自己的修改不会与社区已有改动产生冲突。并告知用户修改了什么文件实现什么效果。

| 文件 | 改动目的 | 注意事项 |
|------|---------|---------|
| `frontend/index.html` | 入口指向二开 main.tsx | 仅修改 `<script src>` 指向 `src/external/main.tsx`，不动其他内容 |
| `frontend/package.json` | 补充依赖和脚本 | 仅添加 external 模块需要的依赖，不随意升级社区已有依赖版本 |

> **注**：`main.tsx`、`App.tsx`、`MainLayout.tsx`、`externalRoutes.tsx` 已镜像到 `frontend/src/external/`（Level 1）。社区对应入口文件由 manifest 保持不存在，`index.html` 直接选择二开入口。

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
| `frontend/src/main.tsx` | 社区入口（二开入口在 `frontend/src/external/main.tsx`，属 Level 1） |
| `frontend/src/App.tsx` | 社区根组件（二开版在 `frontend/src/external/App.tsx`，属 Level 1） |
| `frontend/src/components/` | 社区已有组件 |
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
| `frontend/src/router/MainRoutes.tsx` | 社区路由（二开版在 `frontend/src/external/router/`，属 Level 1） |
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

### 3.0. Documentation (`docs/`)
- `docs/` is the canonical source for all project documentation.
- VitePress entry: `docs/index.md`; configuration: `docs/.vitepress/config.mts`.
- Documentation dependencies are isolated in `docs/package.json`.
- Use `./build.sh docs` to build and `./build.sh docs:dev` to serve locally.
- GitHub Pages is built by `.github/workflows/docs.yml`.
- Organize new documents by domain: `architecture/`, `charitable/`, `sqlite/`, `development/`, `history/`, or `archive/`.
- Do not publish files from `doc.local/test`, credential fixtures, generated binaries, SQLite databases, or secret-bearing JSON.

### 3.1. The `frontend/src/external` Directory (The "Add-on" Zone)
All new logic, components, pages, and stores from CPA must reside here. Runtime entry point is `frontend/src/external/main.tsx`; `frontend/index.html` points directly to it.

### 3.2. The `backend` Directory (The "Backend" Zone)
Go 后端是位于 `backend/` 的单一 Go 模块（module path: `github.com/router-for-me/CLIProxyAPI/v7`），按来源隔离：

**社区镜像（尽量少改）**
- `backend/sdk/` — 对应社区 `CLIProxyAPI/sdk`
- `backend/internal/*`（除 `core/`）— 对应社区 `CLIProxyAPI/internal`
- `backend/cmd/server/` — CLIProxyAPI 社区命令兼容入口
- `backend/examples/`、`backend/test/` — 社区示例与集成测试

**二次开发（主战场）**
- `backend/internal/core/` — 社区不存在的二次开发命名空间：SQLite 运营库、探测、公益运营、采集、管理 HTTP API、代理/加速器抽象
- `backend/internal/core/cli/` — `cmd/server/main.go` 的镜像提取版，`cpamc` 作为统一入口委托调用社区 CLI 逻辑（OAuth 登录、TUI、Home 等）
- `backend/internal/core/localengine/` — 将 CLIProxyAPI SDK 嵌入 `cpamc` 生命周期并桥接 Usage
- `backend/internal/core/proxy/` — 代理/加速器类型、动态 HTTP client 与 URL 重写逻辑
- `backend/cmd/cpamc/main.go` — 项目统一运行入口（管理中心模式 + 社区 CLI 模式双入口分发）

Go 测试文件（`*_test.go`）与源码同目录放置，无需单独 `src/test/` 目录。

维护规则：
- 非社区业务逻辑只放在 `backend/internal/core/`，不要扩散到社区 `internal/*` 包中
- 代理/加速器逻辑只在 `backend/internal/core/proxy/` 中定义，不向社区 `internal/config` 添加字段或方法
- 插件代理、代理版插件商店和模型价格代理都在 `backend/internal/core/httpapi/`，使用 `/v0/management/cpamc/*` 二开路径，不依赖社区 gin 路由注册
- `cmd/cpamc/main.go` 是统一入口：检测到社区 CLI flag（如 `-codex-login`、`-tui`）时委托 `internal/core/cli.Run()`，否则启动管理中心模式
- `internal/core/cli/run.go` 是 `cmd/server/main.go` 的镜像提取版，社区覆盖 `cmd/server` 后需 diff 两个文件并同步变更
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
- **Registration**: External routes are defined in `frontend/src/external/router/externalRoutes.tsx`, merged into `frontend/src/external/router/MainRoutes.tsx` via spread. The `MainRoutes.tsx` in `frontend/src/external/router/` mirrors the community version and adds `...externalRoutes`.
- **Path Convention**: External routes do **not** use a `/external/` prefix. They use domain-specific prefixes (e.g., `/charitable`, `/ai/providers`, `/monitoring`, `/service-providers`, `/plugin/store`).
- **Community Compatibility Paths**: `frontend/src/external/router/MainRoutes.tsx` 保留 `/ai-providers`、`/plugin-store` 等兼容路径，但运行组件由 external 版本接管；`/ai/providers`、`/plugin/store` 等二开路径也只指向 `frontend/src/external/`。
- **Lazy Loading**: All external pages use `React.lazy` + `Suspense` to avoid impacting initial bundle size.

### 3.8. Plugin-Store Proxy (`plugin-proxy`)

Plugin-store list/install uses a dedicated outbound proxy/accelerator independent of global `proxy-url`:

- **Storage**: Proxy config persisted in SQLite settings (`plugin_proxy_v1` key), not YAML config. This ensures config survives community code overwrites.
- **Status**: `0` none / `1` custom proxy / `2` system / `3` accelerator (defined in `core/proxy/types.go` as `StatusNone`/`StatusCustom`/`StatusSystem`/`StatusAccelerator`)
- **Resolution**: `coreproxy.Resolve(globalProxyURL, scoped)` resolves the effective proxy URL and accelerator base; community config has no `plugin-proxy` field.
- **HTTP Handler**: `backend/internal/core/httpapi/plugin_proxy.go` handles `GET/PUT/PATCH /v0/management/cpamc/plugin-proxy` and `POST /v0/management/cpamc/plugin-proxy/validate`.
- **Plugin Store**: `backend/internal/core/httpapi/plugin_store.go` handles `GET /v0/management/cpamc/plugin-store` and `POST /v0/management/cpamc/plugin-store/:id/install`, reusing the community `sdk/pluginstore` package with a SQLite-backed dynamic HTTP client.
- **Community Isolation**: Community `/v0/management/plugin-store*`, `internal/config`, management handlers, server options and route registration stay byte-identical to upstream.
- **Accelerator Logic**: `NormalizeAcceleratorBase`, `ApplyAcceleratorBase`, and `IsGitHubAcceleratorURL` live only in `core/proxy/accelerator.go`.
- **UI**: Lives on the二开 Plugin Store page (`frontend/src/external/features/plugins/PluginStorePage.tsx`); browser does not download plugins — only the backend HTTP client uses the effective proxy/accelerator.

### 3.9. Community Frontend Sync Policy

- Baseline pin: `frontend/.frontend-upstream-ref`（与 `backend/.cliproxyapi-upstream-ref` 对称，挂在 frontend 挂载点内）。
- **Pin 更新时机**：合并开始前**只读** pin；代码移植且验证**成功后**才覆盖写入新 `commit`/`tag`。失败或中止则**不改** pin。禁止先改 pin 再合并。
- **Pin 格式**：规范为 key=value（`branch=main`、`commit`、`tag`）。现有纯文本两行或后端 `ref=` 读取时兼容；下次成功同步再写成规范格式。
- **版本选择**：优先按上游 **tag** 选定目标；pin 记录 **tag + commit**（`commit` 为唯一权威，`branch=main` 仅为跟踪线元数据）。
- **上游代码来源**：若上下文/环境已有准备好的上游 git 仓则直接复用并 `fetch --tags`（快）；否则在 `/tmp`（或 `mktemp -d`）只读准备目标 tag 树。细节见 [`docs/architecture/community-sync.md`](docs/architecture/community-sync.md) §5.3 / §6。
- Sync community frontend pages/features/components/services/stores/i18n/styles/assets into the corresponding non-`frontend/src/external/` trees under `frontend/`.
- Keep secondary-development interaction only in `frontend/src/external/`. Community entry/layout/route files are excluded by the manifest; runtime integration is selected only by `frontend/index.html` pointing to `src/external/main.tsx`.
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
- **后端 manifest 已为空**：不再用「跳过覆盖」保留本地改动。`bin/sync-manifest.conf` 的 `[backend]` 段为空，后端同步无需 `--confirm-manifest`。
  - 必须落在上游文件里的改动放在 `backend/patches/*.patch`，同步时 `git apply --check` 先验后应用，**冲突即整体失败**。当前只有一个：`0001-pluginstore-allow-github-signed-artifact-url.patch`，放宽跟随重定向后的 artifact URL 校验，registry / manifest 声明的 URL 仍严格校验。
  - 上游入口 `cmd/server/main.go` 的镜像由 `bin/gen-cli-mirror.sh` 生成为 `internal/core/cli/run.gen.go`，**禁止手改**。
- **同步后必须全绿的门禁**（CI 亦执行）：
  ```bash
  bin/check-upstream-drift.sh        # 镜像 == 上游@pin + upstream-allowlist.conf，零容忍
  bin/check-import-boundary.sh       # 二开手写代码对上游 internal 的依赖只能减少
  bin/gen-cli-mirror.sh --check      # run.gen.go 与上游入口一致
  cd backend && go test ./internal/core/upstreamcontract/   # 上游路由表与配置键契约
  ```
- Full procedure: [`docs/architecture/community-sync.md`](docs/architecture/community-sync.md)；后端架构演进路线：[`docs/architecture/backend-extension-architecture.md`](docs/architecture/backend-extension-architecture.md)。

## 4. Agent Execution Directives

1. **Analyze Before Coding**: Check if the feature already exists in the community codebase. If a similar component exists, adapt or extend it rather than creating a duplicate.
2. **Respect Permission Levels**: Strictly follow the three-level permission system. Never modify Level 3 files without explicit user approval.
3. **Prioritize Stability**: If a feature is tightly coupled to its original location, refactor it to be self-contained within `frontend/src/external/` before integrating.
4. **Reuse Existing Assets**: Always look for existing icons, utilities, hooks, and UI components in `frontend/src/components/ui/` and `frontend/src/external/components/ui/` before creating new ones.
5. **Consider Upstream Commit Compatibility**: When modifying Level 2 files, review recent community commits via `git log` / `git blame` to understand recent evolution patterns and avoid conflicts.
6. **Own Changes Are Flexible**: You may freely add, modify, or remove your own previous additions in `frontend/src/external/` and Level 2 files — this is normal integration iteration, not a violation.
7. **Documentation Is Part of Delivery**: Architecture, schema, migration, deployment, and operational behavior changes must update the corresponding page under `docs/`; do not add new formal documents under `doc.local/`.
8. **Follow Community Sync Policy**: When merging upstream frontend/backend community code, follow the one-liner in §1 and the full procedure in `docs/architecture/community-sync.md`. Do not invent a one-off overlay strategy.
9. **Upstream source & pin order**: Prefer an already-prepared upstream git checkout from context/env; only if absent, prepare a read-only tree under `/tmp`. Read `*-upstream-ref` before work; update it **only after** a successful merge and verification—never bump the pin first.
10. **CLI Mirror Sync**: `internal/core/cli/run.go` is a mirror of `cmd/server/main.go`. After community overwrites `cmd/server`, diff the two files and port any structural changes to `run.go`. The only intentional differences are: package name (`cli` vs `main`), `init()` → `Init()`, `main()` → `Run(args, extraServerOptions...)`, `os.Args[1:]` → `args`, and `extraServerOptions` injection into `serverOptions`.
11. **Proxy/Accelerator Re-exports**: Community packages (`internal/config`, `internal/pluginstore`) re-export canonical types/functions from `internal/core/proxy/`. After community overwrites, verify these re-exports still compile. If the community added new proxy-related types, port them to `core/proxy/` first, then update re-exports.
12. **API Path Catalog Sync**: `backend/internal/core/store/store_meta_api.go` holds a hand-maintained registry (`metaAPIRegistry`) of every API path in the project — backend HTTP endpoints and frontend router paths — each tagged with `side` (frontend/backend), `source` (secondary/community), `group`, `method`, `path`, `fileRef` (repo-relative file declaring the route), and `description`. On every service startup `Store.SyncMetaAPI` upserts this registry into the SQLite `cpa_api_detail` table, and `GET /v0/cpamc/meta-api/list` exposes it to the `/charitable/debug` → "API 目录" workspace for browsing and in-place debugging. **Whenever you add, remove, rename, or relocate any route** (backend `HandleFunc`/`mux` registration, frontend `externalRoutes` entry, or a new `cpamcBase+` dispatch branch in `server.go`), you **must** update `metaAPIRegistry` in `store_meta_api.go` in the same change set so the catalog stays accurate. After editing the registry, rebuild the backend (`go build ./...`) — the table refreshes automatically on next startup; no SQL migration is needed.

---

## 5. Concurrent Agent Discipline（并发纪律）

**多个 agent 可能同时在这个工作区里写入。** 以下三条是硬约束，不是建议 —— 每一条都对应一次真实发生过的事故。

### 5.1 禁止 `git commit -a` 和 `git add .`

工作区里可能有别人改到一半的文件。只 `git add` 自己明确改过的路径，逐个列出。

> 事故：`dd62713` 用了 `commit -a`，把另一个 agent 正在改的契约测试半成品一起提交，419 文件 / +42050 行混在一个 commit 里，HEAD 上 CI 变红。

### 5.2 提交前必须跑门禁，并验证暂存版本能自立

```bash
bin/check-upstream-drift.sh && bin/check-import-boundary.sh && bin/gen-cli-mirror.sh --check
```

几秒钟，能挡住越界改上游和生成件漂移。

改动涉及测试或编译时，还要确认**暂存的内容单独就能通过** —— 不依赖工作区里别人未提交的东西：

```bash
WT=$(mktemp -d)/wt && git worktree add --detach --quiet "$WT" HEAD
git diff --cached > /tmp/staged.patch && git -C "$WT" apply /tmp/staged.patch
(cd "$WT/backend" && go build ./... && go test ./internal/core/...)
git worktree remove --force "$WT"
```

用 `git worktree` 而不是 `git stash`：stash 会动到别人的文件。

> 事故：被提交的测试版本缺少一处必要设置，在完整工作区里能过、单独 checkout 就全挂。

### 5.3 新文件必须显式 `git add`

`git commit -a` 不会带上未跟踪文件。

> 事故：`config_keys_test.go` 是新文件，未被 `add`，于是契约测试只进去一半 —— 文档声称覆盖 5/5，实际 0/5。**比完全没提交更危险**，因为看起来像已经覆盖了。

### 5.4 交接前的检查

自己的功能收工时：

- [ ] 只提交自己的文件，`git status` 里剩下的应该都是别人的
- [ ] 已跟踪文件**不得**引用未跟踪目录（否则别人 checkout 后直接编译失败）
- [ ] 新增出站调用上游管理端点时，同步更新 `internal/core/upstreamcontract/` 的端点表
- [ ] 改了 i18n 时，`en / ru / zh-CN / zh-TW` 四个 locale 的 key 集合保持一致（缺 key 不报错，只在界面显示成原始 key 名）

## 6. Target File Structure

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
│       ├── components/            # Level 3 — 社区通用组件
│       ├── features/              # Level 3 — 社区功能模块
│       ├── hooks/                 # Level 3 — 社区 hooks
│       ├── i18n/                  # Level 3 — 社区国际化
│       ├── pages/                 # Level 3 — 社区页面
│       ├── router/                # Level 3 — 社区路由（运行版在 external/router）
│       ├── services/              # Level 3 — 社区 API 层
│       ├── stores/                # Level 3 — 社区状态管理
│       ├── styles/                # Level 3 — 社区样式
│       ├── types/                 # Level 3 — 社区类型
│       ├── utils/                 # Level 3 — 社区工具函数
│       ├── external/              # Level 1 — CPA 扩展模块（自由改）
│       │   ├── main.tsx            #   二开入口（社区 main.tsx 镜像）
│       │   ├── App.tsx             #   二开根组件（社区 App.tsx 镜像）
│       │   ├── cpa-extension.ts   #   扩展入口（i18n + 路由 + 导航注入）
│       │   ├── router/            #   二开路由（externalRoutes + MainRoutes 镜像）
│       │   ├── components/layout/ #   二开布局（MainLayout 镜像）
│       │   ├── externalNav.ts     #   扩展侧边栏导航（含"社区" super-group）
│       │   ├── features/          #   扩展功能模块（含二开 PluginStorePage 等）
│       │   ├── hooks/             #   扩展 hooks
│       │   ├── i18n/              #   扩展国际化
│       │   ├── pages/             #   扩展页面
│       │   ├── services/          #   扩展 API 层
│       │   ├── stores/            #   扩展状态管理
│       │   ├── styles/            #   扩展样式
│       │   ├── types/             #   扩展类型
│       │   ├── utils/             #   扩展工具函数
│       │   └── assets/            #   扩展静态资源
│       ├── main.tsx               # Level 3 — 社区入口（二开在 external/ 中）
│       └── App.tsx                # Level 3 — 社区根组件（二开在 external/ 中）
│
├── backend/                       # 后端社区整仓挂载点 + 本地 core/cpamc
│   ├── go.mod / go.sum            # module: .../backend
│   ├── cmd/cpamc/main.go          # Level 1 — 统一入口（管理中心 + CLI 模式分发）
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
│   │       ├── localengine/       #   统一运行时桥接
│   │       ├── proxy/            #   代理/加速器类型与逻辑规范定义
│   │       ├── cli/              #   run.gen.go：由 cmd/server/main.go 生成，禁止手改
│   │       └── upstreamcontract/  #   上游契约测试（路由表 + config.yaml 键）
│   ├── patches/                   # Level 1 — 必须落在上游文件里的改动（.patch，同步时 git apply）
│   ├── examples/                  #   SDK 与插件示例
│   ├── test/                      #   CLIProxyAPI 集成测试
│   ├── .cliproxyapi-upstream-ref
│   └── CLIPROXYAPI_UPSTREAM_CN.md
│
├── bin/                           # Level 1 — 发布/打包脚本 + 同步工具 + 门禁
│   ├── sync-community.sh           #   社区代码覆盖 + 应用 patches + 重新生成 run.gen.go
│   ├── sync-manifest.conf           #   手动清单（[backend] 已空；仅前端保护项）
│   ├── compare-cliproxyapi.sh      #   后端只读对比（面向人，预期有差异）
│   ├── check-upstream-drift.sh     #   门禁：镜像零容忍漂移
│   ├── upstream-allowlist.conf     #     已批准的镜像差异声明
│   ├── check-import-boundary.sh    #   门禁：上游 internal 依赖棘轮
│   ├── import-boundary-allowlist.conf #  已声明的 internal 依赖
│   ├── gen-cli-mirror.sh           #   生成 run.gen.go（--check 用于 CI）
│   └── verify-monorepo.sh           #   结构验证
├── .devcontainer/                 # Level 1 — Docker 开发环境
├── docs/                          # Level 1 — 全部正式文档 + VitePress 站点
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

- [`docs/architecture/community-sync.md`](docs/architecture/community-sync.md)
- [`docs/architecture/monorepo-migration-plan.md`](docs/architecture/monorepo-migration-plan.md)
