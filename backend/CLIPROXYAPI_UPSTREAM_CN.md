# CLIProxyAPI 源码融合与上游参考

## 项目定位

CLIProxyAPI 已经成为当前项目 Go 服务的原生核心代码，不再作为 `backend`（历史曾为嵌套 `backend/cliproxyapi`） 嵌套模块或外部依赖存在。社区源码中的 `cmd`、`internal`、`sdk`、`test` 和 `examples` 已提升到后端模块一级目录（现为 `backend/`），并统一使用当前项目模块路径 `github.com/agodomen/Cli-Proxy-API-Management-Center/backend`。

当前项目可以直接修改协议转换、认证、调度、执行器、插件、模型注册和管理 API。后续社区更新作为实现参考，通过差异分析和人工移植进入当前架构，不再使用覆盖式源码同步。

## 上游基线

- 社区仓库：<https://github.com/router-for-me/CLIProxyAPI>
- 初始融合提交：`5afc0f1d5e9ed8d47809a1bd1f54834bc7e75375`
- 最近同步提交：`27fc3169bb4eb0509e3aba7dde4ab80286b0ae65`（`v7.2.100`，2026-07-26）
- 社区原模块：`github.com/router-for-me/CLIProxyAPI/v7`
- 当前模块：`github.com/agodomen/Cli-Proxy-API-Management-Center/backend`
- Go 版本：1.26
- 上游许可证：MIT，见 `LICENSE.CLIProxyAPI`

精确来源记录在 `backend/.cliproxyapi-upstream-ref`（成功同步后更新；规范见 `doc/architecture/community-sync.md`）。


### 2026-07-27 同步记录

- 对比范围：`285322cd97add6b21f60c267debec44fbec74060..27fc3169bb4eb0509e3aba7dde4ab80286b0ae65`
- 社区提交数：31
- 社区文件变化：约 121 个文件（+20998 / -2223）
- 同步方式：旧上游 / 当前工作区 / 新上游三方合并；`internal/core/` 与 `cmd/cpamc/` 不覆盖
- 主要社区能力：Codex Live WebRTC/TCP 中继、WebSocket 连续性、标准化 Token 计量 v2、Antigravity 签名/推理重放、executor 绑定与 multi-agent v2、Windows 插件响应缓冲
- 有意保留差异：
  - Plugin Store 独立代理（`plugin-proxy` 配置、管理 API、UI 与 `plugin_store` 出站代理）
  - 认证管理兼容文件（安全子路径、OpenAI Compatibility 单凭证禁用、`disabled` 元数据兼容）
  - `modernc.org/sqlite` 运营库依赖
- 前端社区基线保持 `v1.18.6` / `3738c0b7ff21ce7e1423795a26769fff05fd81d6`，无需覆盖；Level 2 注入钩子与商业入口排除策略仍有效
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
cd services
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
cd services
go test ./...
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

脚本会把社区自引用临时转换为当前模块路径，再对比一级 `cmd`、`internal`、`sdk`、`test` 和配置模板。脚本只输出差异，不覆盖当前项目代码。

处理社区更新时应：

1. 判断变化是否适合当前 SQLite 和统一运行架构。
2. 将需要的行为重新实现在当前一级目录中。
3. 保持 `/v0`、`/v1`、SSE、WebSocket、OAuth 和插件 ABI 兼容。
4. 同时运行当前管理中心测试和 CLIProxyAPI 协议测试。
5. 更新 `.cliproxyapi-upstream-ref` 和架构文档中的参考提交。

当前项目不追求与社区文件逐行一致，而是追求外部协议兼容、实现可参考以及本地架构可持续演进。
