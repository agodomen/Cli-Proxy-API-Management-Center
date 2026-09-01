# 后端二次开发架构优化方案

> 状态：设计提案（2026-08-17）
> 适用范围：`backend/`、`bin/sync-community.sh`、`bin/compare-cliproxyapi.sh`、CI
> 关联文档：[社区代码合并约定](./community-sync.md)、[CLIProxyAPI 双引擎集成](./cliproxyapi-dual-engine.md)

## 1. 结论摘要

前端合并轻松的根因不是「目录分开」，而是**存在一层运行期入口重定向**：`index.html` 指向 `src/external/main.tsx`，社区入口文件即使被整体覆盖也不参与运行，二开代码在物理上无法被上游覆盖。

后端缺的正是这一层。当前后端二开与上游**同模块、同目录树**，隔离完全靠人 + 文档 + manifest 约定：

- 编译器不阻止任何人就地修改上游文件；
- `internal/core` 直接 import 上游 `internal/**`，上游重构即编译崩；
- `internal/core/cli/run.go` 是 `cmd/server/main.go` 的 845 行手工克隆，每次同步都要人工重放；
- `go.mod` 每次要重新叠加本地依赖；
- 没有任何 Go CI 门禁，`compare-cliproxyapi.sh` 永远报差异，无法当门禁用。

**建议目标架构：把 `backend/` 拆成两个 Go module。**

```text
backend/upstream/   module github.com/router-for-me/CLIProxyAPI/v7      —— 上游镜像，逐字节一致，只允许整体覆盖
backend/cpamc/      module github.com/router-for-me/CLIProxyAPI/v7/cpamc —— 全部二开，通过 replace 依赖镜像
```

这样做的收益是把「靠人记住」换成「靠工具报错」：

| 现在 | 目标 |
|---|---|
| 同步后人工判断哪些文件是二开 | 镜像目录 `diff -r` 必须为空，否则 CI 红 |
| 手工重放 `go.mod` 本地依赖 | 本地依赖在 `cpamc/go.mod`，镜像 `go.mod` 逐字节复制 |
| 手工搬运 845 行 `run.go` | `go generate` 产出，CI 校验重新生成无 diff |
| 手工重放 `auth.go` 补丁 | `.patch` 文件由脚本 `git apply`，冲突则失败退出 |
| 上游改路由/配置字段后运行期才发现 | 契约测试断言 23 条管理路径与配置字段 |

并且这条路径是**渐进的终局路线**：等 `auth.go` 补丁回流上游、SDK 缺口补齐后，删掉 `backend/upstream/` 与 `replace` 一行，即变成社区衍生版 Home / Business 已在用的「`go get` 升级」模式，同步脚本整体退役。

## 2. 现状实测盘点

以下数据由实际 diff 得出，非推断。基线 pin：`c9417c8`（`v7.2.104`）。

复现方式：

```bash
cd /home/gwd/projects/github/CLIProxyAPI
git archive --format=tar c9417c8 | tar -xf - -C /tmp/up
cd backend && for p in cmd internal sdk test examples assets; do diff -rq /tmp/up/$p ./$p; done
```

### 2.1 后端与上游的真实差异

| 类型 | 路径 | 规模 |
|---|---|---|
| 新增入口 | `cmd/cpamc/` | 1 文件 / 194 行 |
| 新增二开 | `internal/core/` | 66 文件 / 27583 行 |
| **上游文件补丁** | `internal/pluginstore/auth.go` | +20 行（GitHub CDN 签名 URL 放宽） |
| 依赖差异 | `go.mod` / `go.sum` | `modernc.org/sqlite` + 4 个 indirect + `go-isatty` 版本 |
| 残留空目录 | `internal/cluster/` | 空，应删除 |
| 逐字节一致 | `cmd/server`、`sdk`、`test`、`examples`、`assets`、`config.example.yaml` | 无差异 |

**文件级差异已经压到极小**（仅 1 个补丁文件）。所以痛点不在「文件冲突多」，而在下面两节。

### 2.2 二开代码对上游的依赖面

`internal/core` + `cmd/cpamc` 引用的上游包（`grep` 统计）：

| 引用方 | 上游 internal 包 | 说明 |
|---|---|---|
| `internal/core/cli/run.go` | 17 个（`api`、`config`、`cmd`、`home`、`homeplugins`、`logging`、`managementasset`、`misc`、`pluginhost`、`redisqueue`、`registry`、`safemode`、`store`、`translator`、`tui`、`util`、`access/config_access`） | 因为它是 `cmd/server/main.go` 的克隆，import 面 = 上游入口的 import 面 |
| `internal/core/httpapi/{server,plugin_store}.go` | `internal/config`、`internal/pluginhost` | 12 处 `communityconfig.*`，2 处 `pluginhost.*` |
| `internal/core/localengine/runtime.go` | `internal/api`、`internal/pluginhost` | 其余已走 `sdk/cliproxy`、`sdk/config` |
| `cmd/cpamc/main.go` | `internal/buildinfo` | 1 处 |

**除 `run.go` 外，真实耦合只有 3 个上游 internal 包。** 其中大部分已有官方 SDK 等价物：

| 二开在用 | SDK 等价物 | 状态 |
|---|---|---|
| `internal/api.ServerOption` 及 `With*` | `sdk/api` | ✅ 已存在（`sdk/api/options.go` 明确写着 "so external projects can configure the embedded HTTP server without importing internal packages"） |
| `internal/config.Config` / `LoadConfig` / `SaveConfigPreserveComments` | `sdk/config` | ✅ 已存在 |
| `internal/pluginhost.Host` / `New()` | `sdk/pluginhost` | ✅ 已存在 |
| `internal/config.PluginInstanceConfig` | — | ❌ SDK 缺口 |
| `internal/config.ResolvePluginsDir` | — | ❌ SDK 缺口 |
| `internal/pluginhost.ValidatePluginID` | — | ❌ SDK 缺口 |
| `internal/pluginhost.DiscoverPluginFiles` | — | ❌ SDK 缺口 |

也就是说：**只差 4 个符号**，二开就能做到「只 import `sdk/**`」。这 4 个是明确的上游 PR 目标，也是本地 shim 的唯一职责。

### 2.3 编译器抓不到的隐性契约

这类问题「同步后能编译、能跑测试，但功能坏了」，是「需要注意的地方比较多」的真实来源：

| 契约 | 数量 / 内容 | 现状 |
|---|---|---|
| 硬编码上游管理 API 路径 | 23 条出现，其中 **12 条是真正的出站契约**（`/config`、`/config.yaml`、`/auth-files`、`/auth-files/status`、`/proxy-url`、`/usage-queue`、`/usage-statistics-enabled` + 5 个 provider section）；其余 11 条是 core 自己服务的路径 | 无测试；上游改名后运行期 404 |
| 上游 YAML 字段名 | `plugins.dir`、`plugins.configs`、`proxy-url`、`remote-management.secret-key` / `allow-remote` | 无测试；`localengine` 直接按字符串路径改写 YAML |
| cgo / 插件能力探测 | `X-CPA-SUPPORT-PLUGIN` 依赖 `CGO_ENABLED=1`（见 `build.sh:51`） | 靠注释约定 |
| 前端产物内嵌 | `build.sh` 把 `frontend/dist/index.html` 拷进 `backend/internal/core/httpapi/web/management.html` 并入库 | 4.6MB 构建产物进源码树，每次都是脏 diff；且 `server.go:35` 是硬 `//go:embed`，无法简单移出跟踪 |
| 上游入口引导逻辑 | `cmd/server/main.go` 的 flag / 安全模式 / plugin bootstrap 顺序 | 靠 `run.go` 克隆同步，无门禁 |

## 3. 痛点归因

| 编号 | 根因 | 证据 | 后果 |
|---|---|---|---|
| P1 | **无编译期隔离**：二开与上游同 module、同目录树 | `internal/core` 与 `internal/api` 平级 | 「顺手改上游文件」零成本，历史上确实发生过（4 个 auth 兼容文件，后来才下沉） |
| P2 | **上游入口被克隆** | `internal/core/cli/run.go` 845 行 ↔ `cmd/server/main.go` 826 行，diff 仅 89 行 | 每次同步都要人工 diff + 重放；忘了也不会报错 |
| P3 | **依赖与补丁需手工重放** | `go.mod` 叠加 sqlite；`auth.go` +20 行 | 每次同步 2 次手工操作，靠 manifest 提醒 |
| P4 | **无漂移门禁** | `.github/workflows/` 只有 `docs.yml` + `release.yml`，无 Go 测试；`compare-cliproxyapi.sh` 不认识「已批准差异」，永远输出 `Differences found` | 脚本无法当 CI gate，只能人眼看 → 告警疲劳 |
| P5 | **隐性契约无测试** | §2.3 的 23 条路径 + 配置字段 | 编译通过 ≠ 功能正常；只能靠人「注意」 |

补充观察：`internal/core/cli/run.go` 的 `Run(args []string, ...)` 参数其实是**装饰性**的——函数体内 `flag.Parse()` 仍读全局 `os.Args`（`run.go:163`），`args` 只影响 plugin bootstrap 两处。这说明克隆件已经开始产生「看起来对但其实不完全对」的偏差，正是克隆维护模式的典型腐化。

## 4. 关键证据：社区自己的衍生版怎么做

社区作者自己维护两个衍生版，它们**都不是整树 fork**：

| 仓库 | module path | 与基座的关系 |
|---|---|---|
| `CLIProxyAPIHome`（集群版） | `github.com/router-for-me/CLIProxyAPIHome` | `require github.com/router-for-me/CLIProxyAPI/v7 v7.2.83`，无 replace |
| `CLIProxyAPIBusiness`（企业版） | `github.com/router-for-me/CLIProxyAPIBusiness` | `require github.com/router-for-me/CLIProxyAPI/v6 v6.9.28`，无 replace |

它们的升级动作就是一次 `go get`，提交信息直接写着：

```text
bc482ee Update CLIProxyAPI to v6.9.28 and add xxHash dependency in go.mod and go.sum
a7bf7dd Update CLIProxyAPI to v6.9.1 in go.mod and go.sum
```

**上游的合并成本 = 改 go.mod 两行。没有同步脚本、没有 manifest、没有候选树。**

同时要看清它们付的代价：Home 只 import 了 7 个 `sdk/**` 包，其余能力（`config`、`auth`、`access`、`registry`、`watcher`、`managementhttp` …）是**自己在 `internal/` 里重写/硬分叉的**——实测 `Home/internal/config` 与基座 `v7.2.83/internal/config` 已大幅分化且不再同步。

结论：

- 「import 基座为库」这条路**被上游自己验证可行**，而且是上游眼中的正解（`sdk/pluginstore` 的注释原文：`for embedders such as CLIProxyAPIHome`）；
- 但 Home / Business 放弃了跟随上游 internal 的能力。CPAMC 的诉求不同——**要持续白拿上游的新模型、executor、协议修复**，所以不能整体硬分叉，而应该走「镜像 + 独立 module」的中间态，并保留升级到纯依赖模式的可能。

## 5. 目标架构

### 5.1 分层原则

```text
L0  上游镜像层     backend/upstream/    只读、逐字节一致、整体覆盖，永不手改
L1  适配层         backend/cpamc/internal/upstreamshim/   唯一允许 import 上游 internal 的包
L2  二开业务层     backend/cpamc/internal/**              只允许 import sdk/** 与 L1
L3  入口层         backend/cpamc/cmd/cpamc/               组装
```

规则一句话：**上游代码只能被覆盖，不能被修改；二开代码只能被新增，不能被覆盖；两者之间只有一个 shim 包和 SDK。**

### 5.2 目录与模块布局

```text
backend/
├── go.work                      # 工作区：同时 use 两个 module（IDE / 本地测试）
│
├── upstream/                    # ← L0 上游镜像，module github.com/router-for-me/CLIProxyAPI/v7
│   ├── go.mod / go.sum          #   逐字节复制上游，不再叠加本地依赖
│   ├── cmd/ internal/ sdk/ test/ examples/ assets/
│   ├── config.example.yaml
│   ├── .upstream-ref            #   基线 pin（原 .cliproxyapi-upstream-ref）
│   └── patches/                 #   例外：必须打在上游文件上的补丁（.patch 文件，非改动后的源码）
│       └── 0001-pluginstore-github-signed-artifact-url.patch
│
└── cpamc/                       # ← L1~L3 全部二开，module .../CLIProxyAPI/v7/cpamc
    ├── go.mod                   #   require v7 + replace => ../upstream + modernc.org/sqlite
    ├── go.sum
    ├── cmd/cpamc/               #   统一入口
    ├── internal/
    │   ├── upstreamshim/        #   L1 唯一允许 import 上游 internal/** 的包
    │   ├── cli/run.gen.go       #   由 upstream/cmd/server/main.go 生成，禁止手改
    │   ├── httpapi/ store/ probe/ collector/ localengine/ usage/ ...   # 原 internal/core/*
    │   └── ...
    └── test/
        └── upstreamcontract/    #   上游契约测试（路径表、配置字段）
```

对照迁移表：

| 现路径 | 目标路径 |
|---|---|
| `backend/{cmd/server,internal,sdk,test,examples,assets,config.example.yaml,go.mod,go.sum}` | `backend/upstream/` 同名 |
| `backend/.cliproxyapi-upstream-ref` | `backend/upstream/.upstream-ref` |
| `backend/internal/core/**` | `backend/cpamc/internal/**`（去掉 `core` 这一层） |
| `backend/cmd/cpamc/**` | `backend/cpamc/cmd/cpamc/**` |
| `backend/internal/pluginstore/auth.go` 的本地改动 | `backend/upstream/patches/0001-*.patch` |
| `backend/internal/cluster/`（空目录） | 删除 |

### 5.3 为什么 module path 是 `.../CLIProxyAPI/v7/cpamc`

Go 的 internal 可见性规则**只看 import path 前缀，跨 module 依然生效**。已实测验证：

```text
module example.com/base/v7        （被依赖，含 internal/secret）
module example.com/base/v7/ext    （依赖方，replace => ../up）
  → import example.com/base/v7/internal/secret  编译并运行成功
```

同时验证了依赖 module 的 `main` 包可以直接被构建：`go build example.com/base/v7/cmd/srv` 成功。这意味着 `cli-proxy-api` 兼容二进制**不需要镜像也能构建**。

于是 module path 选 `.../CLIProxyAPI/v7/cpamc` 换来两点：

1. `upstreamshim` 与生成的 `run.gen.go` 仍可 import 上游 `internal/**`，迁移不被 SDK 缺口卡死；
2. 未来切成纯依赖模式（§8 Phase 4）时，源码零改动。

代价：占用了上游命名空间的子路径。因为该 module **永不发布**（只在本仓通过 `replace` / 直接 `require` 使用），风险仅限理论层面。若不接受，可改用自有路径（如 `github.com/gongwendong/cpamc`），但代价是必须先把 §2.2 的 4 个 SDK 缺口和 `run.gen.go` 的 17 个 internal import 全部消除——建议作为 Phase 4 目标，而非前置条件。

> 该结论基于 `replace` 场景实测。切换到走 module proxy 下载的纯依赖模式前，需再验证一次「非 replace 情况下跨 module import internal」。

## 6. 关键机制

### 6.1 镜像纯净化 + 零容忍漂移门禁

`backend/upstream/` 的唯一合法写入方式是**整体替换**：

```bash
# 同步 = 删除 + 解包 + 打补丁，不存在「合并」
rm -rf backend/upstream.new && mkdir backend/upstream.new
git -C "$SRC" archive --format=tar "$TAG" | tar -xf - -C backend/upstream.new
# 只保留上游有的路径；本仓额外文件（.upstream-ref / patches/）单独复制回去
```

随后 `bin/check-upstream-drift.sh` 成为 CI 硬门禁：

```bash
# 目标：输出为空。任何非空输出都是错误，而不是「需要人工判断」
diff -rq --exclude=.upstream-ref --exclude=patches \
  "$UPSTREAM_TREE_AT_PIN" backend/upstream/
```

与现状 `compare-cliproxyapi.sh` 的本质区别：现在的脚本**预期有差异**，所以只能给人看；新脚本**预期零差异**，所以能当门禁。这一条是整个方案里性价比最高的改动——它把 P1（无编译期隔离）从「文档约束」变成「CI 约束」。

`patches/` 目录是唯一例外，见 §6.4。

### 6.2 upstreamshim：唯一允许触碰上游 internal 的包

```go
// backend/cpamc/internal/upstreamshim/config.go
//
// 本包是二开代码访问上游 internal/** 的唯一出口。
// 每个符号都必须写明：为什么 sdk/** 不够用、对应的上游 PR / issue。
// 目标是让本包持续缩小到空包。
package upstreamshim

import (
    internalconfig "github.com/router-for-me/CLIProxyAPI/v7/internal/config"
    internalpluginhost "github.com/router-for-me/CLIProxyAPI/v7/internal/pluginhost"
)

// PluginInstanceConfig: sdk/config 未导出该类型。上游 PR：<待提>
type PluginInstanceConfig = internalconfig.PluginInstanceConfig

// ResolvePluginsDir: sdk/config 未导出。上游 PR：<待提>
func ResolvePluginsDir(dir string) (string, error) { return internalconfig.ResolvePluginsDir(dir) }

// ValidatePluginID / DiscoverPluginFiles: sdk/pluginhost 未导出。上游 PR：<待提>
func ValidatePluginID(id string) bool { return internalpluginhost.ValidatePluginID(id) }
func DiscoverPluginFiles(dir string, want map[string]string) ([]internalpluginhost.PluginFile, error) {
    return internalpluginhost.DiscoverPluginFiles(dir, want)
}
```

配套一个导入边界检查（`bin/check-import-boundary.sh`，CI 执行）：

```bash
# 除 upstreamshim 与生成的 cli/run.gen.go 外，禁止 import 上游 internal/**
go list -deps -json ./... | ... # 或简单 grep
grep -rn 'CLIProxyAPI/v7/internal/' cpamc \
  --include='*.go' \
  | grep -v '^cpamc/internal/upstreamshim/' \
  | grep -v '^cpamc/internal/cli/run.gen.go:' \
  && { echo "违规：二开代码不得直接 import 上游 internal"; exit 1; }
```

**可量化的健康指标**：违规数必须为 0；`upstreamshim` 的符号数应逐版本递减（当前应为 4）。

### 6.3 `cmd/server` 镜像改为代码生成

现状：`internal/core/cli/run.go` 845 行手工克隆。目标：`cpamc/internal/cli/run.gen.go` 由 `bin/gen-cli-mirror.sh` 生成。

已实测确认变换只需 4 个**唯一**锚点（在 `cmd/server/main.go` 中各出现 1 次）：

| 锚点 | 替换为 |
|---|---|
| `package main` | `package cli` + 生成头注释（含来源 commit） |
| `func init() {` | `func Init() {` |
| `func main() {` | `func Run(extraServerOptions ...api.ServerOption) {` |
| `serverOptions := []api.ServerOption(nil)` | 同行 + 追加 `extraServerOptions` 的注入块 |

生成器要求：

1. 每个锚点**必须命中且仅命中一次**，否则立即失败并打印上游文件的相关上下文——这就是「上游改了入口结构」的告警信号；
2. 输出文件头写入 `// Code generated from upstream cmd/server/main.go @ <commit>. DO NOT EDIT.`；
3. 提供 `--check` 模式：重新生成并与工作区比对，有 diff 即失败，用于 CI。

顺带修掉 §3 提到的偏差：**去掉装饰性的 `args []string` 参数**。因为 `flag.Parse()` 本身读 `os.Args`，传参制造了「可注入 args」的假象。生成件保持与上游一致地使用 `os.Args`，语义更诚实，变换也从 6 步降到 4 步。

> 更彻底的解法是向上游提 PR，把 `cmd/server/main.go` 的主体抽到可导入的包（如 `sdk/cliproxy/cliapp`），并保留 `cmd/server/main.go` 作为 3 行 wrapper。届时 `run.gen.go` 与生成器一起删除。建议同时推进。

### 6.4 内联补丁改为 patch 文件 + 上游回流

`internal/pluginstore/auth.go` 的 +20 行是**唯一**必须落在上游文件里的改动（放宽 GitHub CDN 临时签名 artifact URL 校验）。它无法下沉到二开层，因为 `sdk/pluginstore` 的安装路径会经过这个未导出的校验函数。

三步处理：

1. **短期**：从「保留改动后的源码」改为「保留 `.patch`」。

```bash
# 生成
diff -u "$UP/internal/pluginstore/auth.go" backend/upstream/internal/pluginstore/auth.go \
  > backend/upstream/patches/0001-pluginstore-github-signed-artifact-url.patch

# 同步时应用（失败即整体失败，绝不静默跳过）
for p in backend/upstream/patches/*.patch; do
  git apply --directory=backend/upstream --check "$p" || { echo "补丁 $p 失效，需人工重做"; exit 1; }
  git apply --directory=backend/upstream "$p"
done
```

差别在于**失败模式**：现在是「忘记重放 → 静默丢失能力」，改后是「上游动了这段代码 → `git apply` 立刻报错」。

2. **中期**：为该行为补一条二开侧回归测试（构造带签名参数的 `objects.githubusercontent.com` artifact URL，断言安装校验通过；同时断言 registry / metadata 类型仍被拒绝）。有测试兜底后，补丁丢失也会被 CI 抓到。

3. **长期**：向上游提 PR。这是一个通用性 bugfix（GitHub Release CDN 重定向必然带短期签名参数），合入概率高。合入后 `patches/` 清空，Phase 4（纯依赖模式）的最后一个阻塞点消失。

### 6.5 上游契约测试

已实施：`internal/core/upstreamcontract/`（双 module 拆分后移到 `cpamc/test/upstreamcontract/`）。
两个测试都不开监听、不联网，毫秒级：

- **路由表契约**：按 `sdk/cliproxy` 的方式构造上游 HTTP server，枚举 gin 路由表，
  断言 core 发往 CPA 的每个 `METHOD + path` 仍然存在。失败信息带调用方文件名和
  同前缀的可用路由，直接指出上游把端点改成了什么。
- **配置字段契约**：对 `sdk/config.Config` 做 `yaml.Marshal` 后按键路径断言，
  确保 `localengine` 按字符串路径改写的 YAML 键仍在 schema 内。失败时打印上游全部顶层键。

实施中修正了本节原先两处错误的设计假设：

| 原假设 | 实测 |
|---|---|
| 用 `WithRouterConfigurator` 能读到完整路由表 | 错。它在**基础路由之后、management 路由之前**触发；`WithEngineConfigurator` 更早。两者都读不到最终表——只能在回调里**捕获 engine 指针**，等 `NewServer` 返回后再枚举 |
| 直接构造 server 就有 `/v0/management/*` | 错。management 路由**条件注册**：需要 config `secret-key`、环境变量或 local password 之一。测试必须显式设 `RemoteManagement.SecretKey`，否则路由表里一条都没有 |

为此加了三层哨兵，避免「测试骨架坏了」被误读成「上游删了所有端点」：

```text
路由数为 0              → engine 捕获机制失效
有路由但无 /healthz      → 枚举时机不对
有基础路由但无 management → 上游改了 management 路由的注册门槛
```

第三层已实测：去掉 `SecretKey` 后测试给出准确诊断，而不是 12 条误导性的「上游已不再提供」。

覆盖的 12 条出站端点：

| 端点 | 调用方 |
|---|---|
| `GET /v0/management/config` | `httpapi/server.go`、`probe/cpa_sync.go` |
| `PUT /v0/management/config.yaml` | `cluster/pusher.go` |
| `GET /v0/management/auth-files` | `collector/auth_snapshot.go` |
| `PATCH /v0/management/auth-files/status` | `probe/manager.go` |
| `GET /v0/management/proxy-url` | `httpapi/server.go` |
| `GET /v0/management/usage-queue` | `httpqueue/client.go` |
| `PUT /v0/management/usage-statistics-enabled` | `httpapi/server.go` |
| `PUT /v0/management/{openai-compatibility,gemini-api-key,claude-api-key,codex-api-key,vertex-api-key}` | `probe/cpa_sync.go`，每个 `supportedCPAConfigTypes` 一条 |

§2.3 计的 23 条里，其余 11 条是 core **自己**服务的路径（`/v0/management/cpamc/*`、
`model-prices`、`model-price-proxy`、`api-key-aliases`、本地 usage 查询），不构成上游契约；
通用 `/v0/management/*` 透传代理也不需要逐路径保证。

写这批测试时抓到一个**我自己的笔误**：初版把 `auth-files/status` 记成 `GET`，而
`probe/manager.go:587` 用的是 `PATCH`（与上游一致）。之前只 grep 了 URL 那一行、没看下一行的
method。这类错误正是契约测试的价值——它对着真实路由表核对，而不是对着我的记忆。

这两个测试是本方案里**唯一能覆盖 P5 的手段**——目录拆分和门禁脚本都覆盖不到语义漂移。

### 6.6 go.work、构建与发布

```go
// backend/go.work
go 1.26.0

use (
    ./upstream
    ./cpamc
)
```

`go.work` 只服务本地开发与 CI（一条 `go test ./...` 覆盖两个 module）。`cpamc/go.mod` 里保留 `replace github.com/router-for-me/CLIProxyAPI/v7 => ../upstream`，使 Docker 单 module 构建无需 workspace 也能成立。

`build.sh` 需要的调整：

| 现在 | 改为 |
|---|---|
| `cd backend && go build -o cpamc ./cmd/cpamc` | `cd backend/cpamc && go build -o ../cpamc ./cmd/cpamc` |
| `cd backend && go build -o cli-proxy-api ./cmd/server` | `cd backend/cpamc && go build -o ../cli-proxy-api github.com/router-for-me/CLIProxyAPI/v7/cmd/server`（已实测可行，无需进 upstream 目录） |
| 前端产物拷到 `backend/internal/core/httpapi/web/management.html` | 拷到 `backend/cpamc/internal/httpapi/web/management.html`；该文件因 `//go:embed` 必须保持被跟踪，只能通过 `.gitattributes` 降噪，彻底移出跟踪需要先给 embed 加 fallback（见 Phase 0 说明） |

测试也随之分层，这是一项额外收益：

```bash
cd backend/cpamc && go test ./...        # 二开测试 + 契约测试：每次提交必跑（秒级~分钟级）
cd backend/upstream && go test ./...     # 上游自带测试：只在同步时跑一次（上游 CI 已跑过，可降级为 go build ./...）
```

现状 `sync-community.sh` 在候选树里跑全量 `GOMAXPROCS=1 go test -p 1 ./...`，其中绝大部分是上游自测。拆分后同步验证时间可显著下降。

## 7. 新的后端同步流程

从「10 步 + 人工裁决」压到 5 步，且每步都有工具兜底：

```bash
# 1. 只读 pin，选定目标 tag
cat backend/upstream/.upstream-ref

# 2. 整体重铺镜像（无合并语义）+ 应用 patches
bin/sync-upstream.sh --source /home/gwd/projects/github/CLIProxyAPI --ref v7.2.110

# 3. 三个门禁（任一失败即停，pin 不变）
bin/check-upstream-drift.sh        # 镜像 == 上游@tag + patches，diff 必须为空
bin/check-import-boundary.sh       # 二开未越界 import 上游 internal
bin/gen-cli-mirror.sh --check      # run.gen.go 与上游入口一致

# 4. 验证
cd backend/cpamc && go test ./...          # 含 test/upstreamcontract
cd backend/upstream && go build ./...      # 上游可编译（测试可选）
cd backend/cpamc && go build ./cmd/cpamc github.com/router-for-me/CLIProxyAPI/v7/cmd/server

# 5. 成功后才写 pin + 叙事
```

新增 `.github/workflows/backend.yml`，在 PR 上执行第 3、4 步。当前后端**完全没有 CI**，这是最快见效的一步，且不依赖目录重构——可以在 Phase 0 就单独交付。

`bin/sync-manifest.conf` 的 `[backend]` 段随之退役：手工合并清单归零，后端不再需要 `--confirm-manifest`。前端段保持现状（前端的入口重定向机制已经够用）。

## 8. 分阶段迁移计划

每个阶段可独立交付、独立回滚，不要求一次做完。

### Phase 0：先建门禁（不动目录）—— 已实施

不改一行架构，先把「看不见的漂移」变成「CI 报错」。即使后续阶段搁置，这一步也长期有效。

- [x] `bin/check-upstream-drift.sh` + `bin/upstream-allowlist.conf`：零容忍漂移门禁。
      用 Git blob hash 双向比对（无需解包上游树），断言「差异集合 == 声明集合」。
      已验证三种失败场景：就地改上游文件、新增文件混入上游目录、**本地补丁在同步中丢失**。
      最后一种此前完全不可见。
- [x] `bin/check-import-boundary.sh` + `bin/import-boundary-allowlist.conf`：
      对 25 条 `(文件, 上游 internal 包)` 依赖建立棘轮，新增即失败，删除只提醒。
- [x] `.github/workflows/backend.yml`：后端首个 CI（此前只有 docs / release）。
- [x] 删除残留空目录 `backend/internal/cluster/`。
- [x] `.gitattributes` 把 `management.html` 标记为 `-diff -merge linguist-generated`，
      4.6MB 产物不再产生文本 diff 与合并冲突。
      **未采纳**「移出 Git 跟踪」：`internal/core/httpapi/server.go:35` 是硬 `//go:embed`，
      文件缺失会直接导致 `go build` 失败。要真正移出跟踪，需先把 embed 改成可降级
      （构建标签或 `embed.FS` + 占位文件），属独立改动，不适合放在 Phase 0。

### Phase 1：消除克隆与内联补丁 —— 已实施

- [x] `bin/gen-cli-mirror.sh`（含 `--check`）：`internal/core/cli/run.go`（845 行手写）→
      `run.gen.go`（生成）。已验证三种失败模式：手改生成件、上游入口锚点消失、
      生成结果不是合法 Go。`bin/sync-community.sh` 在候选树里自动重新生成。
- [x] 去掉了 `Run(args []string, ...)` 里装饰性的 `args` 参数（`flag.Parse()` 本来就读
      `os.Args`），调用方 `cmd/cpamc/main.go` 同步改为 `cli.Run()`。行为不变。
- [x] `auth.go` 的本地改动转为 `backend/patches/0001-pluginstore-allow-github-signed-artifact-url.patch`，
      `sync-community.sh` 用 `git apply --check` 先验后应用，冲突即整体失败。
      已验证补丁对上游原始文件可干净应用且**逐字节还原**当前本地文件。
- [x] `bin/sync-manifest.conf` 的 `[backend]` 段清空：后端同步不再需要 `--confirm-manifest`。
- [x] 行为回归测试 `internal/core/httpapi/plugin_store_patch_test.go`：
      走真实的 `sdk/pluginstore` 安装路径，用内存 HTTPDoer 模拟「registry 声明干净 URL
      → 302 跳到带签名参数的 CDN」。已验证移除补丁后该测试失败并直接点名补丁文件。
- [ ] 向上游提两个 PR：签名 URL 修复、入口逻辑抽包（**待你确认**，见 §11）

实施中发现的一处事实修正：上游有**两处**敏感查询参数校验，本地补丁只覆盖其中一处。

| 位置 | 校验对象 | 是否被补丁放宽 |
|---|---|---|
| `internal/pluginstore/auth.go: validatePluginStoreRequestURL` | 每次实际请求的 URL，**包括跟随重定向后的 URL** | 是（仅 artifact + `*.githubusercontent.com`） |
| `internal/pluginstore/{registry,manifest}.go` | registry / manifest **声明**的 artifact URL | 否，仍然严格拒绝 |

这个区分是对的：CDN 签名参数只应出现在重定向目标里，不应出现在 registry 声明里。
写回归测试时若按「registry 直接声明带 token 的 URL」建模，会被第二处校验拦下，
从而对补丁得出错误结论——测试因此改用重定向场景。

### Phase 2：契约测试 —— 已实施

- [x] `internal/core/upstreamcontract/`：路由表契约（12 条出站端点）+ 配置字段契约（5 个键路径）。
      两个测试都验证过会失败：注入不存在的键 / 去掉 management secret，均给出准确诊断。
- [x] 三层哨兵区分「骨架坏了」与「上游删了端点」。
- [ ] 把出站路径集中成一份常量表，供实现与测试共用。当前测试里的路径是**独立抄写**的，
      与实现各自硬编码——好处是能抓出实现侧的笔误（已抓到一次），坏处是新增出站调用时
      要记得同步。等 Phase 3 拆分后再统一收口，避免现在为它改动大量文件。

顺带修掉一个会阻塞 CI 的既存问题：`internal/core/proxy/service/service_test.go:259`
用 `fmt.Sprintf("%s:%d", host, port)` 拼地址，`go vet` 的 IPv6 检查拒绝该写法。
改为 `net.JoinHostPort`，语义等价（该 helper 只用 `127.0.0.1` 调用）。
该目录是尚未提交的 WIP，且 `httpapi/server.go` 里对它的 import 也未提交。

### Phase 3：双 module 拆分（3~5 天，一次性结构变更）

- [ ] `git mv` 上游镜像到 `backend/upstream/`，`internal/core` → `backend/cpamc/internal/`
- [ ] 建 `backend/cpamc/go.mod`（`replace => ../upstream`）、`backend/go.work`
- [ ] 上游 `go.mod` / `go.sum` 恢复为逐字节复制（本地依赖迁到 cpamc）
- [ ] 建 `upstreamshim`，其余二开包改为只 import `sdk/**`
- [ ] 更新 `build.sh`、Dockerfile、CI、release 工作流路径
- [ ] 单独提交，不与任何上游同步或功能改动混提

### Phase 4：评估纯依赖模式（阻塞项清零后再启动）

前置条件：

1. `patches/` 为空（签名 URL 修复已合入上游）；
2. `upstreamshim` 为空 或 4 个符号已进 SDK；
3. `run.gen.go` 已被上游抽出的 `cliapp` 包取代（或确认走 module cache 生成可行）；
4. 已验证非 replace 场景下跨 module import internal 的行为。

达成后：删除 `backend/upstream/`、删除 `replace`、`require` 真实版本号。同步动作变成 `go get github.com/router-for-me/CLIProxyAPI/v7@v7.2.110 && go mod tidy`，`sync-community.sh` 的后端部分整体退役——与 Home / Business 的做法一致。

## 9. 方案比较

| 方案 | 隔离强度 | 跟随上游能力 | 迁移成本 | 结论 |
|---|---|---|---|---|
| A. 维持现状 + 只加门禁（Phase 0~2） | 中（靠 CI） | 强 | 低 | **必做**，且可独立成立 |
| B. 双 module：镜像 + 独立二开 module（Phase 3） | 强（编译期） | 强 | 中 | **推荐目标态** |
| C. 纯依赖 `go get`（Phase 4） | 最强 | 强（但只能用 sdk + internal 前缀） | 中，但有上游阻塞项 | **终局**，需先清零阻塞项 |
| D. 硬 fork（Home / Business 模式） | 最强 | 弱（放弃跟随 internal） | 高 | **不采纳**：与「白拿上游协议修复」的核心诉求冲突 |

B 相对 A 的增量价值，本质是把三件事从「约定」变成「不可能」：

1. 二开代码不可能被上游覆盖（不在同一目录树）；
2. 上游文件不可能被就地修改而不被发现（镜像 diff 必须为零，例外只有显式 patch）；
3. 本地依赖不可能污染上游 `go.mod`（不是同一个 module）。

主要风险与应对：

| 风险 | 应对 |
|---|---|
| 双 module 提高本地开发/IDE 复杂度 | `go.work` 覆盖 gopls；文档给出两条 `go test` 命令 |
| Docker / release 路径全面变化 | Phase 3 单独提交，先在 CI 跑通 release 工作流的 dry-run |
| 一次性大 `git mv` 影响 blame | 用纯 `git mv` 提交（不夹带内容修改），`git log --follow` 仍可追溯 |
| module path 占用上游命名空间 | 该 module 永不发布；若不接受，见 §5.3 备选路径 |
| 上游把 `sdk/**` 也重构 | 契约测试 + `upstreamshim` 集中承接；`sdk` 被上游明确定位为 embedder API，稳定性预期高于 internal |

## 10. 验收指标

用可测量的数字替代「感觉好维护了」：

| 指标 | 起点 | 现在（Phase 0+1） | Phase 3 后 |
|---|---|---|---|
| 需人工合并的上游文件数 | 1（`auth.go`） | 0（补丁自动应用，冲突即失败） | 0 |
| 手工搬运的上游代码行数 | 845（`run.go`） | 0（生成 + `--check` 门禁） | 0 |
| 二开**手写**代码直接 import 上游 internal 的条目 | 25 | 7 | ≤ 4（仅 `upstreamshim`） |
| 上游镜像的允许差异 | 未定义（脚本永远报差异） | 声明式：3 项 + 2 个 local-only 目录 | 0（patches 外） |
| 后端 CI 门禁数 | 0 | 6 步（编译 / 入口构建 / vet / 测试 / 漂移 / 边界 / 生成一致） | 同 |
| 「本地补丁静默丢失」可检测 | 否 | 是（漂移门禁 + 行为回归测试双保险） | 是 |
| 上游出站端点被契约测试覆盖 | 0 / 12 | **12 / 12** | 12 / 12 |
| 上游配置键被契约测试覆盖 | 0 / 5 | **5 / 5** | 5 / 5 |
| 同步验证需跑的上游测试 | 全量 | 全量 | 仅 `go build` |

## 11. 待决策项

需要确认后才能进入实施：

1. **是否接受双 module 拆分（Phase 3）**，还是先只做 Phase 0~2 观察一轮同步的实际收益？
2. **cpamc module path**：用 `github.com/router-for-me/CLIProxyAPI/v7/cpamc`（可 import internal，迁移平滑）还是自有路径（更干净，但需先清 SDK 缺口）？
3. **是否向上游提 PR**（签名 URL 修复、入口抽包、4 个 SDK 符号导出）？这直接决定 Phase 4 是否可达。
4. **`management.html` 是否移出 git 跟踪**？会改变 release 流程对构建顺序的依赖。
5. **`internal/core` 拆分后是否保留 `core` 命名层级**（`cpamc/internal/core/httpapi` vs `cpamc/internal/httpapi`）？后者更短，但会产生更大的 import 路径改动面。

## 12. 相关文档

| 文档 | 关系 |
|---|---|
| [社区代码合并约定](./community-sync.md) | 现行流程与裁决规则；本方案落地后需同步改写第 5、6、7 节 |
| [CLIProxyAPI 双引擎集成](./cliproxyapi-dual-engine.md) | 运行期架构（端口、网关、Usage 桥接），本方案不改变其语义 |
| `backend/CLIPROXYAPI_UPSTREAM_CN.md` | 上游基线与同步叙事，Phase 3 后路径改为 `backend/upstream/` |
| `AGENTS.md` | 权威布局总则，Phase 3 后需更新目录约定 |







