# CLIProxyAPI 源码融合与上游参考

## 项目定位

CLIProxyAPI 已经成为当前项目 Go 服务的原生核心代码，不再作为嵌套模块或外部依赖存在。社区源码中的 `cmd`、`internal`、`sdk`、`test` 和 `examples` 镜像到 `backend/`，Go module path 保持社区原值 `github.com/router-for-me/CLIProxyAPI/v7`。

二次开发代码集中在 `internal/core/` 和 `cmd/cpamc/`。社区更新通过 `bin/sync-community.sh` 在候选树镜像覆盖，验证成功后才替换当前挂载点。

## 上游基线

- 社区仓库：<https://github.com/router-for-me/CLIProxyAPI>
- 初始融合提交：`5afc0f1d5e9ed8d47809a1bd1f54834bc7e75375`
- 最近同步提交：`c9417c8ae9b16fabc0386ca35d36f13bf8b1d678`（`v7.2.104`，2026-08-13）
- 当前模块：`github.com/router-for-me/CLIProxyAPI/v7`
- Go 版本：1.26
- 上游许可证：MIT，见 `LICENSE.CLIProxyAPI`

精确来源记录在 `backend/.cliproxyapi-upstream-ref`（成功同步后更新；规范见 `../docs/architecture/community-sync.md`）。

### 2026-08-13 双上游同步记录

- 后端：`v7.2.104` / `c9417c8ae9b16fabc0386ca35d36f13bf8b1d678`
- 前端：`v1.20.0` / `1708314bc7a27e0ad9ef86b083e28e4e00aceeb1`
- 同步方式：`bin/sync-community.sh --force --confirm-manifest` 构建候选树，后端执行 `GOMAXPROCS=1 go test -p 1 ./...`，前端执行冻结 lockfile 安装和生产构建，全部通过后替换挂载点
- 后端社区镜像：`internal/config`、management plugin-store handler、server option/route 等旧 plugin-proxy 注入点均恢复为社区原码
- 插件代理：配置迁入 SQLite `plugin_proxy_v1`，API 改为 `/v0/management/cpamc/plugin-proxy*`
- 代理版插件商店：由 `internal/core/httpapi/plugin_store.go` 提供 `/v0/management/cpamc/plugin-store*`，复用社区 `sdk/pluginstore`，不修改社区 management handler
- 后端 manifest：仅保留 `internal/pluginstore/auth.go` 的 artifact 类型 GitHub CDN 临时签名 URL 兼容补丁
- 运行时状态：`localengine` 显式持有社区 `pluginhost.Host`，只读桥接 `registered/busy` 到 core 插件商店；不修改社区 SDK 或 management handler
- 前端商业排除：不接入 `/quick-start`、`SponsorQuickStartPanel` 和 AI Providers “快速填入”交互；运行入口保持 `src/external/main.tsx`


### 2026-07-27 同步记录（历史架构）

- 对比范围：`285322cd97add6b21f60c267debec44fbec74060..27fc3169bb4eb0509e3aba7dde4ab80286b0ae65`
- 社区提交数：31
- 社区文件变化：约 121 个文件（+20998 / -2223）
- 同步方式：旧上游 / 当前工作区 / 新上游三方合并；`internal/core/` 与 `cmd/cpamc/` 不覆盖
- 主要社区能力：Codex Live WebRTC/TCP 中继、WebSocket 连续性、标准化 Token 计量 v2、Antigravity 签名/推理重放、executor 绑定与 multi-agent v2、Windows 插件响应缓冲
- 有意保留差异：
  - Plugin Store 独立代理（`plugin-proxy` 配置、管理 API、UI 与 `plugin_store` 出站代理）
  - 认证管理兼容文件（安全子路径、OpenAI Compatibility 单凭证禁用、`disabled` 元数据兼容）
  - `modernc.org/sqlite` 运营库依赖
- 当时前端社区基线为 `v1.18.6` / `3738c0b7ff21ce7e1423795a26769fff05fd81d6`；现已由 2026-08-13 记录取代
- 依赖策略：以社区 `go.mod`/`go.sum` 为基线，追加 `modernc.org/sqlite v1.34.5` 并 `go mod tidy`

### 2026-07-24 同步记录

- 对比范围：`5afc0f1d5e9ed8d47809a1bd1f54834bc7e75375..285322cd97add6b21f60c267debec44fbec74060`
- 社区提交数：206
- 社区文件变化：新增 145、删除 1、修改 255
- 审计方式：将初始社区提交、当前项目和最新社区提交标准化为相同模块路径后，逐文件执行三方比较
- 同步结果：社区管理范围内 974 个代码文件全部核验；文件集合与社区提交一致，并补齐根目录 `testdata/` 契约数据；另保留 `cmd/cpamc` 和 `internal/core`
- 有意保留差异：8 个插件示例模块路径/本地 `replace`，以及 4 个认证管理兼容文件
- 依赖策略：使用社区 `go.mod`/`go.sum` 为基线，追加 `internal/core` 所需的 `modernc.org/sqlite`

认证管理兼容文件为：

- `internal/api/handlers/management/auth_files.go`：保留安全子路径、运行时认证索引兼容和上传禁用状态同步
- `internal/api/handlers/management/config_apikey_disable.go`：保留 OpenAI Compatibility 单凭证禁用能力
- `internal/api/handlers/management/config_apikey_disable_test.go`：保留对应回归测试
- `internal/watcher/synthesizer/file.go`：兼容布尔、字符串和数字形式的 `disabled` 元数据

## 融合后的目录

```text
backend/
├── go.mod                         # 当前项目唯一核心 Go 模块
├── cmd/
│   ├── cpamc/                    # 默认统一入口
│   └── server/                   # CLIProxyAPI 社区行为兼容入口
├── sdk/                          # 可直接调用的一级 SDK
├── internal/
│   ├── api/                      # CLIProxyAPI HTTP API
│   ├── auth/                     # 认证流程
│   ├── runtime/                  # Provider Executor
│   ├── translator/               # 协议转换
│   ├── store/                    # CLIProxyAPI 认证存储
│   └── core/                      # 二次开发业务（社区无此目录）
│       ├── store/                # SQLite 运营存储
│       ├── probe/                # 异步探测
│       ├── collector/            # 外部 CPA 采集
│       ├── httpapi/              # 管理与运维 API
│       └── localengine/          # SDK 生命周期与 Usage 桥接
├── examples/
└── test/
```

`internal/store` 与 `internal/core/store` 目前保留不同职责：前者来自 CLIProxyAPI 的认证存储抽象，后者负责账号运营、Usage、探测和策略数据。后续通过 Repository 接口逐步融合，避免直接混合不同的数据模型。

## 统一运行

```bash
cd backend
go run ./cmd/cpamc
```

一个 `cpamc` 进程统一管理：

```text
:18317  管理中心、SQLite、探测和运营 API
:18318  内置 CLIProxyAPI /v0、/v1、/v1beta 等协议接口
```

内置 CLIProxyAPI 通过一级 `sdk/cliproxy` 启动，其 Usage 插件直接进入 `internal/core/collector`，写入 SQLite 并触发异步探测。

`cmd/server` 继续保留，用于运行社区形态服务、执行协议差异测试和验证兼容行为，但不是默认发布入口。

## 构建验证

```bash
# 统一服务与全部核心包
cd backend
GOMAXPROCS=1 go test -p 1 ./...
go build ./...

# 社区命令兼容入口
./build.sh cliproxyapi
```

插件 Go 示例保留自己的示例模块，但已经改为依赖当前项目模块并通过相对 `replace` 使用一级 SDK。

## 参考社区更新

使用只读对比脚本检查指定社区提交：

```bash
bin/compare-cliproxyapi.sh \
  --source /path/to/CLIProxyAPI \
  --ref main
```

脚本对比一级 `cmd`、`internal`、`sdk`、`test` 和配置模板。脚本只输出差异，不覆盖当前项目代码。

处理社区更新时应：

1. 判断变化是否适合当前 SQLite 和统一运行架构。
2. 优先将需要的行为重新实现在 `internal/core/`，并定义 `/v0/management/cpamc/*` 新路径。
3. 保持 `/v0`、`/v1`、SSE、WebSocket、OAuth 和插件 ABI 兼容。
4. 同时运行当前管理中心测试和 CLIProxyAPI 协议测试。
5. 更新 `.cliproxyapi-upstream-ref` 和架构文档中的参考提交。

社区镜像代码以逐文件一致为默认目标；只有 `bin/sync-manifest.conf` 中经过人工确认的极小差异允许保留。
