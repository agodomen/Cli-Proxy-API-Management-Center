# Monorepo 目录迁移实施计划（frontend / backend）

> 状态：**已完成（chore/monorepo-frontend-backend-split）**  
> 说明：路径与 Go module 已切到 `frontend/` + `backend/`；本文保留为历史 runbook 与回滚参考。文中若仍出现 `services/`、`start-dev.sh` 等旧名，以 `community-sync.md` / `AGENTS.md` 的权威口径为准。  
> 目标：将双上游合成仓从 `src/` + `services/` 迁移为 `frontend/` + `backend/` 整树挂载（已落地）。  
> 政策依据：[`community-sync.md`](./community-sync.md)、根目录 `AGENTS.md`  
> 不在本文执行范围内：新功能开发、社区版本追新、plugin-proxy 行为变更。

## 0. 一句话目标

把“两个社区工程根 + 本地二开 + 合成控制面”从混叠状态，收成：

```text
frontend/   ← 前端上游整仓挂载点
backend/    ← 后端上游整仓挂载点
doc/ .devcontainer/ build.sh AGENTS.md  ← 合成控制面
```

## 1. 范围与非范围

### 1.1 范围

- 前端工程根下沉到 `frontend/`
- 后端 Go 模块从 `services/` 重命名/搬迁到 `backend/`
- 构建、容器、文档、AGENTS、同步政策路径全量切换
- Go module path 从 `.../services` 改为 `.../backend`
- 迁移后验证与回滚预案

### 1.2 非范围

- 不借机重构 `external` / `core` 业务
- 不合并新的社区 upstream tag（迁移 PR 应基于已对齐基线）
- 不把上游 README/AGENTS/Docker/docs 抢到 monorepo 根
- 不清理历史文档语义（可只改路径，不重写历史方案正文的故事）

## 2. 前置条件（Must Gate）

迁移开始前必须满足：

1. **工作区可审**
   - 当前脏改动已按批次分开，或至少不再与搬家混在同一逻辑提交
   - 建议先完成/暂存：
     - 后端社区同步 v7.2.100
     - plugin-proxy
     - docker 脚本重命名
     - 文档定案（community-sync / AGENTS）
2. **基线冻结**
   - `frontend/.frontend-upstream-ref` 已知（可由根迁移而来）
   - `services/.cliproxyapi-upstream-ref` 已知
3. **验证基线绿**
   - 前端 `type-check` 通过
   - `cd services && go test ./...` 通过
   - `./build.sh docs` 通过
4. **决策已确认**
   - 目录名：`frontend/` + `backend/`
   - Go module：`github.com/agodomen/Cli-Proxy-API-Management-Center/backend`
   - 根 `package.json` **不保留**为前端主工程（避免双根）；根上如需保留，只放转发脚本（可选，默认不留）

未满足前置条件，不开始 `git mv`。

## 3. 目标路径对照表

| 当前 | 目标 | 动作 |
|---|---|---|
| `src/**` | `frontend/src/**` | `git mv` |
| `package.json` | `frontend/package.json` | `git mv` |
| `bun.lock` | `frontend/bun.lock` | `git mv` |
| `package-lock.json`（若保留） | `frontend/package-lock.json` 或删除 | 决策后处理 |
| `index.html` | `frontend/index.html` | `git mv` |
| `vite.config.ts` | `frontend/vite.config.ts` | `git mv` |
| `tsconfig.json` / `tsconfig.app.json` / `tsconfig.node.json` | `frontend/` | `git mv` |
| `eslint.config.js` | `frontend/eslint.config.js` | `git mv` |
| `.prettierrc` | `frontend/.prettierrc` | `git mv` |
| `logo.jpg` | `frontend/logo.jpg` | `git mv` |
| 根 `dist/` | 忽略或改为 `frontend/dist/` | 构建产物，不提交 |
| 根 `node_modules/` | 改为 `frontend/node_modules/` | 本地重装 |
| `services/**` | `backend/**` | `git mv services backend` |
| `services/.cliproxyapi-upstream-ref` | `backend/.cliproxyapi-upstream-ref` | 随目录迁移 |
| `services/CLIPROXYAPI_UPSTREAM_CN.md` | `backend/CLIPROXYAPI_UPSTREAM_CN.md` | 随目录迁移 |
| `.frontend-upstream-ref` | `frontend/.frontend-upstream-ref` | 与 `backend/.cliproxyapi-upstream-ref` 对称；挂载点内本地 pin |
| `doc/` / `.devcontainer/` / `build.sh` / `AGENTS.md` | 仍留仓库根 | 更新内部路径 |

### 保护目录（迁移中禁止覆盖/删除）

- `src/external/` → `frontend/src/external/`
- `services/internal/core/` → `backend/internal/core/`
- `services/cmd/cpamc/` → `backend/cmd/cpamc/`
- `doc/`
- `.devcontainer/`（只改内容，不丢脚本）

## 4. 分阶段实施

### Phase 0 — 冻结与清单（0.5h）

输出物：

- [ ] 迁移分支名：`chore/monorepo-frontend-backend-split`
- [ ] 当前 `git status` 快照保存到 `doc.local/`（不入库）或 PR 描述
- [ ] 本计划勾选前置条件

命令建议：

```bash
git switch -c chore/monorepo-frontend-backend-split
git status --short > /tmp/cpamc-pre-migration-status.txt
```

### Phase 1 — 机械搬迁（1h）

只做路径移动，不改业务逻辑。

```bash
mkdir -p frontend
git mv src frontend/src
git mv package.json bun.lock index.html vite.config.ts \
  tsconfig.json tsconfig.app.json tsconfig.node.json \
  eslint.config.js .prettierrc logo.jpg frontend/

# package-lock.json：若确认不再使用 npm 锁，删除；否则 git mv 到 frontend/
# tests/：若根或别处存在前端 tests，一并迁入 frontend/tests

git mv services backend
```

验收：

- [ ] `frontend/src/external` 存在
- [ ] `backend/internal/core` 存在
- [ ] `backend/cmd/cpamc` 存在
- [ ] 仓库根不再有业务 `src/`、`services/`

### Phase 2 — 前端工程可构建（1–2h）

修改点：

1. `frontend/package.json` scripts 保持相对 frontend 根
2. `frontend/vite.config.ts` / `tsconfig*` 的 `@` → `frontend/src`
3. 若有 `root` 假设（读 `../`）逐个修正
4. 根 `build.sh`：
   - `cd frontend && bun/npm run build`
   - `frontend/dist/index.html` → `backend/internal/core/httpapi/web/management.html`
5. 可选：根目录保留极简 `package.json` 仅做 workspace 转发（默认不做）

验收：

```bash
cd frontend
bun install   # 或 npm install
bun run type-check
bun run build
```

- [ ] `frontend/dist/index.html` 生成
- [ ] 无残留对旧根路径的硬编码

### Phase 3 — 后端 module 与 import 切换（2–4h）

1. `backend/go.mod` module 改为：

```go
module github.com/agodomen/Cli-Proxy-API-Management-Center/backend
```

2. 全量替换 import 前缀：

```text
github.com/agodomen/Cli-Proxy-API-Management-Center/services
→
github.com/agodomen/Cli-Proxy-API-Management-Center/backend
```

预估规模：约 **1500+** 处 Go 引用（以迁移当日 `rg` 为准）。

3. 更新：
   - `backend` 内 examples 的 `replace`
   - `bin/compare-cliproxyapi.sh` 的 `LOCAL_MODULE` 与默认路径
   - 任何硬编码 `services/` 的脚本

4. `go mod tidy`

验收：

```bash
cd backend
go test ./...
go build -o ./cpamc ./cmd/cpamc
go build -o ./cli-proxy-api ./cmd/server
```

- [ ] 测试全绿
- [ ] 不再出现旧 module path

### Phase 4 — devcontainer / Docker（1–2h）

更新 `.devcontainer/`：

| 文件 | 改动要点 |
|---|---|
| 统一 `.devcontainer/Dockerfile` | web-build → `frontend/`；Go → `backend/`；embed management.html；运行画像由 compose 区分 |
| `docker-compose*.yml` | volume、working_dir、build context 从 `services` 改 `backend`，前端改为 `frontend` |
| `start.sh` / `start.bat`（统一入口，默认 dev） | profile 指向各 compose；镜像由统一 Dockerfile 构建 |
| `.dockerignore` | 按 frontend/backend 重新忽略 `node_modules`、`dist`、缓存 |

建议容器语义：

```text
frontend service  working_dir: /workspace/frontend
backend service   working_dir: /workspace/backend
docs（可选）      working_dir: /workspace/doc
```

验收：

- [ ] `bash .devcontainer/start.sh up` 能启动（至少配置解析正确）
- [ ] 镜像构建上下文不再引用旧 `services/` 源码路径

### Phase 5 — 根构建与 CI（0.5–1h）

1. `build.sh`
   - `service/app`：frontend build + embed + backend build
   - `cliproxyapi`：`backend/cmd/server`
   - `docs`：不变（仍 `doc/`）
2. `.github/workflows/release.yml` / `docs.yml`
   - 前端工作目录、缓存路径、artifact 路径
   - Go working-directory: `backend`
3. IDE 配置（若入库）：`.idea` 等按需，不强制

验收：

```bash
./build.sh service
./build.sh docs
```

### Phase 6 — 文档与政策切正（1h）

必须更新（路径口径切到目标布局）：

- [ ] `AGENTS.md`：current=target，删除“pending migration”歧义
- [ ] `doc/architecture/community-sync.md`：执行路径改为 `frontend/` + `backend/`
- [ ] `doc/architecture/cliproxyapi-dual-engine.md`
- [ ] `doc/architecture/monorepo-migration-plan.md`（本文状态改为 completed）
- [ ] `backend/CLIPROXYAPI_UPSTREAM_CN.md` 内路径
- [ ] 其他高流量文档中的 `services/`、`src/external` 引用（至少 architecture/development/sqlite 入口页）

历史方案（`doc/history/**`、`doc/archive/**`）策略：

- **默认只改仍被当操作手册引用的路径**
- 纯历史叙述可不强制全量替换，避免噪声；若替换，使用机械替换并抽查

### Phase 7 — 同步工具与防护（0.5–1h）

最低要求：

- [ ] 更新 `bin/compare-cliproxyapi.sh`
  - `--source` 默认值
  - `LOCAL_MODULE=.../backend`
  - 对比目录改为 `backend/{cmd,internal,sdk,test,...}`

建议紧随补齐（可同 PR 或立即 follow-up）：

- `bin/sync-frontend.sh` 骨架
- `bin/sync-backend.sh` 骨架
- `bin/verify-monorepo.sh`

`verify-monorepo.sh` 最小检查：

```bash
test -d frontend/src/external
test -d backend/internal/core
test -d backend/cmd/cpamc
rg -n "import '@/external/cpa-extension'" frontend/src/main.tsx
rg -n "externalRoutes" frontend/src/router/MainRoutes.tsx
rg -n "externalNavGroups" frontend/src/components/layout/MainLayout.tsx
cd frontend && npm run type-check
cd backend && go test ./...
./build.sh docs
```

## 5. 提交策略

迁移尽量 **单独成 PR/提交序列**，不要夹带功能：

1. `chore(repo): move frontend project root under frontend/`
2. `chore(repo): rename services to backend and retarget go module`
3. `chore(repo): update build, devcontainer, and CI paths`
4. `docs: switch AGENTS and community-sync to frontend/backend paths`

若必须一个 PR，也要在描述里按上述 4 段列出，方便回滚定位。

## 6. 验证矩阵

| 检查项 | 命令/方法 | 通过标准 |
|---|---|---|
| 前端类型 | `cd frontend && npm/bun run type-check` | exit 0 |
| 前端构建 | `cd frontend && npm/bun run build` | 产出 `frontend/dist/index.html` |
| 后端测试 | `cd backend && go test ./...` | 全绿 |
| 后端构建 | `go build ./cmd/cpamc ./cmd/server` | 产出二进制 |
| 嵌入面板 | `./build.sh service` | `backend/.../management.html` 更新且 cpamc 可编译 |
| 文档 | `./build.sh docs` | 无 dead link |
| 钩子 | rg Level 2 三处 | 均存在 |
| 保护目录 | 目录存在性 | external/core/cpamc 都在 |
| 旧路径残留 | `rg '(^|/)services/'` 于脚本/CI/Docker | 仅历史文档或有意说明 |
| 旧 module 残留 | `rg 'Management-Center/services'` | 无 Go 代码命中 |

## 7. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 与未提交功能 diff 混杂 | 无法审、无法回滚 | Phase 0 先清工作区 |
| Go import 漏替换 | 编译失败 | 先改 go.mod，再全量 rg 校验 |
| devcontainer 半更新 | 本地/CI 路径分裂 | Phase 4 单独验收 compose/Dockerfile |
| 文档死链 | docs 构建失败 | Phase 6 后必须 `./build.sh docs` |
| 社区同步脚本仍指向 services | 下次同步写错目录 | Phase 7 同步更新 compare/sync 脚本 |
| 根目录仍留 package.json 造成双前端根 | 安装/构建混乱 | 默认不保留根前端工程文件 |
| Windows 脚本 `start.bat` 漏改 | 部分贡献者环境失败 | 与 sh 脚本一并改 |

## 8. 回滚预案

### 软回滚（迁移 PR 未合入）

```bash
git switch main
git branch -D chore/monorepo-frontend-backend-split
```

### 硬回滚（已合入但快速失败）

1. `git revert` 迁移提交（按 4 段逆序）
2. 或临时 tag 恢复：
   - `pre-frontend-backend-split`
3. 不在回滚时夹带新功能

建议在 Phase 1 前打 tag：

```bash
git tag pre-frontend-backend-split
```

## 9. 执行当日 Runbook（可照抄）

```bash
# 0) gates
git status
cd services && go test ./...
npm run type-check
./build.sh docs

# 1) branch + tag
git switch -c chore/monorepo-frontend-backend-split
git tag pre-frontend-backend-split

# 2) move trees
mkdir -p frontend
git mv src frontend/src
git mv package.json bun.lock index.html vite.config.ts \
  tsconfig.json tsconfig.app.json tsconfig.node.json \
  eslint.config.js .prettierrc logo.jpg frontend/
git mv services backend

# 3) retarget frontend build + backend module/imports + scripts/docs
#    (manual edits / controlled search-replace)

# 4) verify
cd frontend && bun install && bun run type-check && bun run build
cd ../backend && go test ./... && go build ./cmd/cpamc ./cmd/server
cd .. && ./build.sh service && ./build.sh docs

# 5) commit by phase
```

## 10. 工期与人力估算

| 阶段 | 预估 |
|---|---|
| Phase 0 前置 | 0.5h |
| Phase 1 搬迁 | 1h |
| Phase 2 前端可构建 | 1–2h |
| Phase 3 后端 module | 2–4h |
| Phase 4 devcontainer | 1–2h |
| Phase 5 CI/build | 0.5–1h |
| Phase 6 文档切正 | 1h |
| Phase 7 同步工具 | 0.5–1h |
| **合计** | **约 8–13h** |

单人可连续做完；若有未清理脏工作区，前置可能再加 2–6h。

## 11. 完成定义（DoD）

迁移完成仅当：

1. 代码树为 `frontend/` + `backend/`
2. Go module 为 `.../backend`
3. `./build.sh service` 与 `./build.sh docs` 通过
4. `go test ./...`（backend）通过
5. AGENTS / community-sync 已按新路径执行，不再写“pending migration”
6. compare/sync 脚本指向新目录
7. 迁移提交可独立回滚
8. 下次前端/后端社区同步可以按新挂载点口述执行

## 12. 迁移后的第一周约束

- 不同时追新社区大版本
- 不新增跨挂载点的临时相对路径 hack
- 发现漏网 `services/` 引用，记入清单并一次清掉
- 若 devcontainer 有问题，优先修容器而非回退目录结构

## 13. 相关文档

- [`community-sync.md`](./community-sync.md) — 双上游挂载政策与映射表
- [`cliproxyapi-dual-engine.md`](./cliproxyapi-dual-engine.md) — cpamc 双端口运行
- 根 `AGENTS.md` — 权限级别与当前/目标布局总则
