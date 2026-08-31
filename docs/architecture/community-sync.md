# 社区代码合并约定

> 本文定义将上游社区仓库合并进本二次开发 monorepo 时的目标、目录挂载模型、映射表、流程与裁决规则。  
> 上游来源：
>
> - 前端整仓：[`router-for-me/Cli-Proxy-API-Management-Center`](https://github.com/router-for-me/Cli-Proxy-API-Management-Center)
> - 后端整仓：[`router-for-me/CLIProxyAPI`](https://github.com/router-for-me/CLIProxyAPI)
>
> 相关入口：根目录 `AGENTS.md`、`backend/CLIPROXYAPI_UPSTREAM_CN.md`、[双引擎架构](./cliproxyapi-dual-engine.md)。

## 1. 成功标准

社区合并只追求三件事：

1. **协议兼容**：`/v0`、`/v1`、SSE、WebSocket、OAuth、插件 ABI 不回退。
2. **二次开发不丢**：前端扩展、后端 core/cpamc、plugin-proxy 等本地能力可继续演进。
3. **下次还能合并**：同步基线、有意保留差异、验证步骤均可审计。

**不以“与社区文件逐行一致”为成功标准。**

## 2. 三层模型

本仓不是单上游 fork，而是 **双上游合成 monorepo**：

```text
1) 上游挂载层
   - 前端社区工程根
   - 后端社区工程根

2) 二开层
   - 前端 external
   - 后端 internal/core
   - 后端 cmd/cpamc

3) 合成控制面
   - 根 AGENTS.md
   - doc/
   - .devcontainer/
   - build.sh
   - 本地 CI / upstream-ref
```

判断新文件放哪时，先问它属于哪一层。

## 3. 权威布局（frontend / backend）

本仓已完成 monorepo 目录迁移。**执行规则一律使用 `frontend/` 与 `backend/`。**

```text
.
├── frontend/                       # 挂载前端社区整仓
│   ├── package.json
│   ├── bun.lock
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig*.json
│   ├── eslint.config.js
│   ├── .prettierrc
│   ├── logo.jpg
│   ├── .frontend-upstream-ref     # 本地前端上游 pin
│   ├── tests/                      # 上游 tests（若存在）
│   └── src/
│       ├── external/               # 本地二开（上游无）
│       └── ...                     # 上游 src
│
├── backend/                        # 挂载后端社区整仓
│   ├── go.mod / go.sum             # module: .../backend
│   ├── config.example.yaml
│   ├── cmd/
│   │   ├── server/                 # 上游兼容入口
│   │   └── cpamc/                  # 本地统一入口
│   ├── internal/
│   │   ├── core/                   # 本地二开
│   │   └── ...                     # 上游 internal
│   ├── sdk/
│   ├── examples/
│   ├── test/
│   ├── assets/                     # 按需保留上游资产
│   ├── CLIPROXYAPI_UPSTREAM_CN.md
│   └── .cliproxyapi-upstream-ref
│
├── doc/                            # 本地正式文档（不是上游 docs 的替代拷贝）
├── .devcontainer/                  # 统一 Dockerfile + start.sh（默认 dev）+ compose 画像
├── build.sh                        # 根总控
├── AGENTS.md                       # 本地二开/合并总则
├── README.md
└── .github/workflows/              # 本地 CI
```

历史路径对照（迁移前 → 迁移后）：

| 迁移前 | 迁移后 |
|---|---|
| `src/**` | `frontend/src/**` |
| 根前端工程文件（`package.json`、`vite.config.ts`、`index.html`、`tsconfig*` 等） | `frontend/` |
| `services/**` | `backend/**` |
| `src/external/**` | `frontend/src/external/**` |
| `services/internal/core/**` | `backend/internal/core/**` |
| `services/cmd/cpamc/**` | `backend/cmd/cpamc/**` |

Go module path 保持社区原值：`github.com/router-for-me/CLIProxyAPI/v7`。同步时不做 module path 批量改写。


## 4. 双上游整树挂载映射

### 4.1 前端上游 → 本地

前端上游根（示例）包含：`AGENTS.md`、`README*`、`LICENSE`、`package.json`、`bun.lock`、`index.html`、`vite.config.ts`、`tsconfig*`、`eslint.config.js`、`.prettierrc`、`.github/`、`logo.jpg`、`src/`、`tests/` 等。

| 上游路径 | 本地挂载 | 策略 |
|---|---|---|
| `src/**` | `frontend/src/**` | 覆盖式同步；排除 `external/` |
| `tests/**` | `frontend/tests/**` | 同步（若上游有） |
| `package.json` / `bun.lock` | `frontend/` | 同步后检查本地脚本 |
| `index.html` / `vite.config.ts` / `tsconfig*` / eslint / prettier / `logo.jpg` | `frontend/` | 同步 |
| 上游 `AGENTS.md` / `README*` / `LICENSE` | — | 不覆盖 monorepo 根控制面；仅参考 |
| 上游 `.github/` | — | 不直接覆盖本地 CI；按需移植 job |
| （本地）`frontend/src/external/**` | 保护 | 永不覆盖 |
| （本地）`frontend/.frontend-upstream-ref` | 保护 | 永不覆盖；仅成功同步后由本仓更新 |

前端二开入口已经整体迁入 `frontend/src/external/`。`frontend/index.html` 指向 `src/external/main.tsx`，社区 `main.tsx`、`App.tsx`、`MainRoutes.tsx` 和 `MainLayout.tsx` 由 manifest 保持不存在。

商业入口排除（不移植）：

- `/quick-start` 页面、路由、导航、Dashboard 入口
- AI Providers “快速填入 / quick fill”
- `SponsorQuickStartPanel` 以及 `fixedBrand='apikeyFun'` 的 quick-start 展示

普通 AI Providers 工作台所需 sponsor adapter 等 plumbing 可保留，但不得再出现独立 quick-start / quick-fill 入口。

### 4.2 后端上游 → 本地

后端上游根（示例）包含：`AGENTS.md`、`CLAUDE.md`、`README*`、`LICENSE`、`go.mod`、`go.sum`、`config.example.yaml`、Docker/compose、`.env*.example`、`.github/`、`cmd/`、`internal/`、`sdk/`、`examples/`、`test/`、`docs/`、`assets/`、`auths/` 等。

| 上游路径 | 本地挂载 | 策略 |
|---|---|---|
| `cmd/**` | `backend/cmd/**` | 三方/镜像；保留本地 `cmd/cpamc` |
| `internal/**` | `backend/internal/**` | 三方/镜像；保留本地 `internal/core` |
| `sdk/**` | `backend/sdk/**` | 镜像 |
| `test/**` / `examples/**` | `backend/test/**`、`backend/examples/**` | 镜像 |
| `go.mod` / `go.sum` / `config.example.yaml` | `backend/` | 镜像 + 追加本地依赖；module 保持 `.../backend` |
| `assets/**` | `backend/assets/**` | 按需同步 |
| 上游 `docs/` | — | 不替代本仓 `../`；仅参考 |
| 上游 Docker/compose/Dockerfile | — | 不替代 `.devcontainer/`（统一 Dockerfile + compose 画像） |
| 上游 `AGENTS.md` / `README*` / `.github/` | — | 不占领 monorepo 根；仅参考/按需移植 job |
| 上游 `auths/`、运行时敏感目录 | — | 通常不进主跟踪；本地夹具只用 `doc.local/` |
| （本地）`backend/internal/core/**` | 保护 | 永不覆盖 |
| （本地）`backend/cmd/cpamc/**` | 保护 | 永不覆盖 |
| （本地）`backend/.cliproxyapi-upstream-ref` | 保护 | 永不覆盖；仅成功同步后由本仓更新 |

模块路径不改写：本地与社区均为 `github.com/router-for-me/CLIProxyAPI/v7`。

### 4.3 合成控制面（只属于本仓）

这些路径不是上游整树的简单镜像：

- 根 `AGENTS.md`
- `../`（VitePress 正式文档）
- `.devcontainer/`（统一 `Dockerfile` + `start.sh` 默认 dev + 多 compose 画像）
- `build.sh`
- 本地 `.github/workflows/`
- `frontend/.frontend-upstream-ref` / `backend/.cliproxyapi-upstream-ref`（成功同步后更新）
- `backend/CLIPROXYAPI_UPSTREAM_CN.md`（非平凡后端同步叙事）
- 二开实现与有意保留差异

**原则：镜像上游实现树与工程文件到对应挂载点；不让上游 README/AGENTS/Docker/CI/docs 抢 monorepo 根。**

## 5. 同步策略

### 5.0 upstream-ref（基线 pin）规范

路径：

- 前端：`frontend/.frontend-upstream-ref`
- 后端：`backend/.cliproxyapi-upstream-ref`

**角色**：只表达“当前已成功对齐的上游基线”，供**下一次**合并计算 `old..new`。  
**不存**全部历史、也不存最近 N 次；历史看该文件的 `git log`，叙事看同步文档。

推荐字段（key=value，单记录，覆盖写）：

```text
canonical_repository=https://github.com/router-for-me/<repo>
source_repository=git@github.com:<mirror-or-fork>.git   # 可选
branch=main
commit=<full-sha>
tag=<vX.Y.Z>                                          # 有则写
synced_at=<YYYY-MM-DD>                                # 可选
```

字段约定：

| 字段 | 必填 | 含义 |
|---|---|---|
| `commit` | 是 | **唯一权威**冻结点；下次 diff 的 old |
| `tag` | 有则写 | 发布版本友好名；与 commit 对应 |
| `branch` | 是（默认 main） | 跟踪策略/发布线，**不是**冻结点 |
| `canonical_repository` | 是 | 社区权威远程 |
| `source_repository` | 否 | 本地 mirror/fork，仅便携 |
| `synced_at` | 否 | 本次成功写入 pin 的日期 |

版本选择与记录：

1. **优先按上游 tag 选定合并目标**（发布点更稳，便于一版一合）。
2. pin **记录 tag + commit**；`commit` 必写，`tag` 有则写。
3. `branch=main` 表示默认在 main 发布线上找 tag/commit，**禁止只写 branch 当基线**。
4. 无 tag 的紧急提交可以只写 `commit`（+ `branch`），并在同步叙述中说明原因。

**与仓库内现有 pin 文件的过渡**：

- 规范字段名为 `tag=`；若文件仍写 `ref=vX.Y.Z`，读作 tag，**下次成功同步覆盖写时**改为 `tag=`。
- 前端 pin 若仍为「SHA 一行 + tag 一行」的旧纯文本，读法不变；**下次成功同步后**改为与后端相同的 key=value。
- 在过渡期，Agent 解析 pin 时应兼容：`commit=` / 首行 SHA、`tag=` / `ref=` / 次行 `v*`。

**更新时机（硬规则）**：

1. 合并**开始前**只**读取** pin，不得改写。
2. 代码移植与验证**全部成功后**，才**覆盖写** pin 为新 `commit`/`tag`。
3. 合并失败、中途放弃、验证未过：**保持旧 pin 不变**。
4. 禁止“先改 pin 再合并”，禁止把 pin 更新混进尚未验证的半成品工作区就当作已对齐。

### 5.1 前端

**策略：镜像覆盖 + external 入口保护 + 商业入口排除**

- 基线：`frontend/.frontend-upstream-ref`（成功后才更新）
- 覆盖社区前端实现树到 `frontend/src/**`（排除 `frontend/src/external/`）
- `frontend/` 工程根文件按社区更新，但不要覆盖合成控制面，也不覆盖 pin 本身
- 保护 `external/` 和 manifest 中的入口/商业排除文件
- 排除商业 quick-start / apikeyFun quick-fill 等入口（见 AGENTS）

### 5.2 后端

**策略：候选树镜像覆盖 + 极小 manifest**

- 基线：`backend/.cliproxyapi-upstream-ref`（成功后才更新）
- 叙述：`backend/CLIPROXYAPI_UPSTREAM_CN.md`（非平凡同步 prepend 一节）
- 对比：`bin/compare-cliproxyapi.sh`
- 永不覆盖：`backend/internal/core/`、`backend/cmd/cpamc/`、pin 文件
- 社区 module path 保持原样；二开逻辑使用新的 core 路径和 HTTP namespace

**门禁（同步后必须全绿，CI 亦执行）**：

```bash
bin/check-upstream-drift.sh --verbose   # 镜像 == 上游@pin + upstream-allowlist.conf，零容忍
bin/check-import-boundary.sh            # 二开手写代码对上游 internal 的依赖只能减少
bin/gen-cli-mirror.sh --check           # run.gen.go 与上游 cmd/server/main.go 一致
```

两类脚本与 `compare-cliproxyapi.sh` 的分工：后者面向人、预期有差异、用于阅读；门禁面向 CI、预期零意外、用于卡门。已批准差异分别声明在 `bin/upstream-allowlist.conf` 与 `bin/import-boundary-allowlist.conf`。

后端已不再依赖「跳过覆盖」保留本地改动，`bin/sync-manifest.conf` 的 `[backend]` 段为空，后端同步无需 `--confirm-manifest`：

- 必须落在上游文件里的改动放在 `backend/patches/*.patch`，同步时 `git apply --check` 先验后应用，冲突即整体失败
- 上游入口 `cmd/server/main.go` 的镜像由 `bin/gen-cli-mirror.sh` 生成为 `internal/core/cli/run.gen.go`，禁止手改
- 补丁行为另有回归测试 `internal/core/httpapi/plugin_store_patch_test.go` 兜底，补丁静默丢失会被测试点名

后端架构层面的优化路线（双 module 拆分、契约测试、纯依赖模式）见[后端二次开发架构优化方案](./backend-extension-architecture.md)。

### 5.3 上游代码来源（Agent / 人工统一）

准备上游树时按以下优先级，**不要无条件每次全量 clone**：

1. **上下文或环境已提供的现成上游仓库（首选）**  
   - 对话/任务里已指明的路径  
   - 环境变量：  
     - 前端：`FRONTEND_UPSTREAM_SOURCE`  
     - 后端：`CLIPROXYAPI_SOURCE`（与 `bin/compare-cliproxyapi.sh` 一致）  
   - 本机常见路径（存在且为 git 仓即可复用），例如：  
     - `/home/gwd/projects/github/Cli-Proxy-API-Management-Center`  
     - `/home/gwd/projects/github/CLIProxyAPI`  
   - 在此仓上 `git fetch origin --tags`（或等价），**只读**解析 tag/commit，不在上游仓做合成仓的合并提交。

2. **否则：在 `/tmp`（或 `mktemp -d`）做只读临时准备（次选）**  
   - 浅 clone / `git fetch` + checkout 目标 tag，或 `git archive` 出树  
   - 仅用于对比与文件读取  
   - 用完可删；**禁止**把 monorepo 工作区指到该临时目录当长期挂载  
   - 不在 `/tmp` 里对合成仓执行 `git merge` 式整树合并

3. **禁止**  
   - 跳过 pin，直接追 `main` HEAD 或“最新 tag”自动整仓覆盖  
   - 用上游 README/AGENTS/Docker/CI 覆盖 monorepo 根控制面  
   - 在临时目录写回 pin 或改合成仓 git 历史的奇技

口令：

```text
有准备好的上游 clone → 直接用（快）
没有 → /tmp 只读准备目标 tag 的树
无论哪种 → 以 pin.commit 为 old，以选定 tag 解析的 commit 为 new
```

## 6. 标准合并流程

严格顺序（**pin 在验证成功之后才改**）：

1. **读取基线（只读 pin）**  
   - 解析 `commit`（必有）、`tag`（若有）、`branch`（默认 main）  
   - old = pin 的 commit  
   - 此时**不修改** pin

2. **准备上游树**  
   - 按 §5.3：现成 clone 优先，否则 `/tmp` 只读准备  
   - `fetch --tags`，确认候选 tag 落在跟踪线（默认 main）历史中

3. **选定目标版本**  
   - **优先选 tag**（下一需要合入的发布点；未必总是“仓库里最新 tag”，但常以其为默认候选）  
   - new = `git rev-parse <tag>^{commit}`  
   - 记录拟合并区间 `old..new`

4. **只读对比**  
   - 后端：`bin/compare-cliproxyapi.sh --source <upstream> --ref <tag-or-commit>`  
   - 前端：同等思路做路径级 diff（可后补 `bin/compare-frontend.sh`）  
   - 计算提交数、文件清单、高风险模块

5. **自动覆盖社区代码**
   - 运行 `bin/sync-community.sh`（交互模式或非交互模式）
   - 脚本自动覆盖所有非手动合并文件，跳过 `bin/sync-manifest.conf` 中列出的文件
   - 试运行：`bin/sync-community.sh --dry-run --side backend --source <upstream> --ref <tag>`
   - 真实同步：`bin/sync-community.sh --side backend --source <upstream> --ref <tag> --confirm-manifest`
   - 同 commit 强制重铺追加 `--force`；脚本在候选验证通过后才替换挂载点并更新 pin

6. **手动合并**
   - 脚本跳过的文件需要人工检查并合并二开补丁（见 `bin/sync-manifest.conf`）
   - 后端当前仅 `internal/pluginstore/auth.go`：社区未导出的运行期 URL 校验需要允许 GitHub CDN 短期签名参数
   - 前端保护入口、构建依赖和商业入口排除文件
   - 合并方法：`git -C <upstream> show <commit>:<path> > /tmp/upstream.go; diff -u /tmp/upstream.go <local>`

7. **适配二开**  
   - localengine、usage、`/v0/cpamc/*` 二开路由和 external 入口

8. **验证（未通过则停止，pin 保持旧值）**

```bash
cd frontend && bun install --frozen-lockfile && bun run build
cd backend && GOMAXPROCS=1 go test -p 1 ./...
cd backend && go build ./cmd/cpamc/ ./cmd/server/
./build.sh docs   # 若文档/路径受影响
```

按改动面可收缩测试范围，但**不能**用“先改 pin”代替验证。

9. **成功后才更新基线**  
   - **覆盖写**对应 `*-upstream-ref`：新 `commit`、新 `tag`（若有）、`branch=main`、可选 `synced_at`  
   - 非平凡后端同步：`backend/CLIPROXYAPI_UPSTREAM_CN.md` prepend 一节  
   - 前端大同步可按需写简短叙述（或 commit message 足够时从略）

10. **按类型拆分提交**  
    - pin 更新与本次同步代码同属同步提交，或紧随的 `chore(sync): bump *-upstream-ref`  
    - 仍须在验证成功之后

### 提交拆分

1. `chore(sync): frontend <tag>`
2. `chore(sync): backend <tag>`
3. `fix(compat): reapply local divergences`
4. `feat(core|external): ...`
5. 目录结构变更单独提交，不与上游同步混提

## 7. 有意保留差异清单

每次后端同步后必须勾核：

| 差异项 | 路径 | 原因 |
|---|---|---|---|
| 签名下载 URL 兼容 | `backend/internal/pluginstore/auth.go` | 仅允许 artifact 类型的 GitHub CDN 临时签名查询参数；registry/metadata 与非 GitHub URL 仍严格校验 |
| Plugin Store 独立代理 | `backend/internal/core/httpapi/plugin_{proxy,store}.go` | SQLite 存储、新路径，与社区 config/handler 解耦 |
| SQLite 运营库依赖 | `backend/go.mod` | core 需要 `modernc.org/sqlite` |
| 统一运行入口 | `backend/cmd/cpamc/`、`backend/internal/core/localengine/` | 管理面 + 内置引擎 |
| 前端扩展子系统 | `frontend/src/external/` | 全部 CPA 二开 UI/业务 |

手动合并清单（机读）：`bin/sync-manifest.conf`，由 `bin/sync-community.sh` 自动消费。

## 8. 冲突默认裁决

1. 不破坏 external / core / cpamc  
2. 不破坏管理运营语义（禁用、auth_index、probe、usage 入库、plugin-proxy）  
3. 接受社区协议层 bugfix、新模型、executor、translator、WebSocket 修复  
4. 纯展示、i18n、gofmt、import 排序可跟社区  
5. `go.mod`：社区基线 + 本地必要依赖，再 tidy  
6. 长期必须改社区文件时，优先下沉到 external/core，避免分叉加深

## 9. 红线

1. 用社区树直接覆盖整个 monorepo 根  
2. 覆盖 `external` / `core` / `cpamc`  
3. 把新二开逻辑继续写进社区页面“图省事”  
4. 同步时顺手做无关重构  
5. 不更新 ref、不写同步记录就宣称已对齐；或**先改 pin 再合并**/验证未过就改 pin  
6. 只编译通过、不跑 core 与关键 management/usage 测试  
7. 将 `doc.local/`、凭证、sqlite、`.qwen/`、`.codegraph/` 混进同步提交  
8. 重新引入商业 quick-start / apikeyFun quick-fill 入口  
9. 在脏工作区上把“上游同步 + 新功能 + 目录搬家”混成单一不可审提交

## 10. 目录迁移记录（frontend/backend）

迁移已完成。历史 runbook、阶段拆分、验证矩阵与回滚预案见 [Monorepo 目录迁移实施计划](./monorepo-migration-plan.md)。

### 10.1 迁移前置（历史）

- [ ] 本文与 `AGENTS.md` 已定案目标结构
- [ ] 当前脏改动已按“上游同步 / 兼容补丁 / docker / 文档”分类整理
- [ ] 决定 Go module 是否同时改为 `.../backend`（建议是）

### 10.2 已执行步骤（历史）

1. `git mv` 前端工程文件与 `src/`、`tests/` 到 `frontend/`
2. `git mv` `services/` 到 `backend/`
3. 更新 `build.sh`、Vite/TS 路径、devcontainer、CI
4. 保持社区 Go module path，更新本地构建路径
5. 更新所有文档中的路径
6. 全量验证
7. 单独提交 `chore(repo): split monorepo into frontend/ and backend/`

### 10.3 同步口令

```text
同步前端社区
  输入：community frontend root
  输出：./frontend
  保护：./frontend/src/external , ./frontend/.frontend-upstream-ref

同步后端社区
  输入：community backend root
  输出：./backend
  保护：./backend/internal/core , ./backend/cmd/cpamc
```

### 10.4 建议补齐的工具

- `bin/sync-frontend.sh`
- `bin/sync-backend.sh`
- `bin/verify-monorepo.sh`

## 11. 检查清单

### 每次社区同步

- [ ] 已**只读**旧 pin 基线，并选定新上游 tag/commit（尚未改 pin）
- [ ] 已分类 pure / local-only / overlap / intentional / exclusion
- [ ] 未覆盖 external / core / cpamc
- [ ] `index.html` 仍指向 `src/external/main.tsx`
- [ ] 商业 quick-start / quick-fill 未被重新引入
- [ ] 有意保留差异已勾核
- [ ] 验证通过
- [ ] **验证通过后**才更新 pin 与同步文档（失败则 pin 不变）
- [ ] 提交已拆分，未混入本地噪声

### 目录迁移专项

- [x] 路径对照表已执行（`frontend/` + `backend/`）
- [ ] devcontainer 以双工程根工作目录运行
- [ ] `build.sh` 能从根调前端与后端
- [ ] 文档死链已清理
- [x] 同步政策已切到 `frontend/` + `backend/` 口径

## 12. 相关文档

| 文档 | 用途 |
|---|---|
| `AGENTS.md` | 权限级别与权威布局总则 |
| `backend/CLIPROXYAPI_UPSTREAM_CN.md` | 后端上游基线与非平凡同步叙事 |
| [双引擎架构](./cliproxyapi-dual-engine.md) | cpamc 管理面与内置引擎 |
| [迁移/融合方案](./merge.md) | 早期加法式迁移背景 |
