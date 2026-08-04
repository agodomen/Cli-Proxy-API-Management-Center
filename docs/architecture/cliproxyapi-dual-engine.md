# CLIProxyAPI 双引擎集成

## 建设目标

项目已经把 CLIProxyAPI 社区源码融合到 `backend` 单一 Go 模块。`sdk`、`internal`、`cmd`、`test` 和 `examples` 均位于服务一级目录，由 `cpamc` 单一入口统一管理管理服务与代理运行时。

当前阶段不修改社区 `/v0`、`/v1` 等接口路径，通过同一进程中的不同监听端口区分管理 API 和本地推理 API，同时保留协议层、Provider Executor、OAuth、插件和 WebSocket 的社区兼容实现。

## 当前架构

```text
┌──────────────────────────── cpamc 单一进程 ────────────────────────────┐
│                                                                       │
│  :18317 管理与运维 API                 :18318 内置 CLIProxyAPI         │
│  ├─ 系统配置                           ├─ /v1/* 模型协议               │
│  ├─ SQLite 凭证运营                    ├─ /v0/management/*             │
│  ├─ 探测与策略                         └─ CLIProxyAPI SDK Runtime      │
│  └─ 外部 CPA 同步                                  │ Usage Plugin      │
│            │                                        ▼                  │
│            │                            统一 Usage Event Ingestor      │
│            │                                        │                  │
│            └──────────────────────► SQLite + 异步探测                  │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
              │                                      │
              ▼                                      ▼
      后台社区 CLIProxyAPI                         上游模型服务
```

Docker 和本地开发均只启动 `cpamc`。本地引擎默认启用并监听 `18318`，配置保存在数据目录的 `cliproxyapi/config.yaml`。内置引擎的请求 usage 已直接写入当前 SQLite，并复用探测服务；凭证来源目前仍使用 CLIProxyAPI 配置和认证目录，后续再替换为 SQLite 只读适配器。

## 模块边界

```text
backend/
├── go.mod                         # 当前项目唯一核心 Go 模块
├── cmd/cpamc/                     # 当前管理服务入口
├── cmd/server/                    # CLIProxyAPI 社区行为兼容入口
├── sdk/                           # 一级 CLIProxyAPI SDK
├── internal/
│   ├── api/                       # CLIProxyAPI HTTP API
│   ├── auth/                      # 认证实现
│   ├── runtime/                   # Provider Executor
│   ├── translator/                # 协议转换
│   ├── store/                     # CLIProxyAPI 认证存储
│   └── core/
│       ├── localengine/           # SDK 生命周期与 Usage 桥接
│       ├── store/                 # SQLite 运营存储
│       ├── probe/                 # 异步探测
│       └── httpapi/               # 管理与运维 API
├── examples/                      # SDK 与插件示例
└── test/                          # CLIProxyAPI 集成测试
```

CLIProxyAPI 核心和管理中心现在共享一个模块。两套存储仍通过 `internal/store` 与 `internal/core/store` 区分职责，架构融合通过一级 SDK、统一生命周期、Usage 适配器和后续 Repository 接口完成。

## API 路径策略

同一 `cpamc` 进程在不同端口提供管理和推理能力，相同 API 路径不会与后台社区 CPA 冲突：

```text
http://community-cpa:8317/v0/management/*
http://community-cpa:8317/v1/chat/completions

http://cpamc:18317/api/*
http://cpamc:18318/v1/chat/completions
```

因此当前阶段不实施 `/v2` 路径替换。未来如果需要在同一端口暴露双执行引擎，应在入口网关增加路由命名空间或路径适配，而不是全局替换社区源码中的 `/v0`、`/v1` 字符串。

## 上游参考

初始融合基线为 `5afc0f1d5e9ed8d47809a1bd1f54834bc7e75375`。2026-07-24 已同步到社区提交 `285322cd97add6b21f60c267debec44fbec74060`（`v7.2.96`）；2026-07-27 再同步到 `27fc3169bb4eb0509e3aba7dde4ab80286b0ae65`（`v7.2.100`）。详细逐文件审计记录见 `backend/CLIPROXYAPI_UPSTREAM_CN.md`。 社区合并流程与裁决规则见 [社区代码合并约定](./community-sync.md)。 仓库目录权威挂载模型为 `frontend/` + `backend/`，细节见该文档。使用以下命令对比后续社区提交：

```bash
bin/compare-cliproxyapi.sh \
  --source /path/to/CLIProxyAPI \
  --ref main
```

对比脚本不会覆盖当前代码。社区更新需要根据当前 SQLite、统一入口和独立演进目标进行评估，再人工移植到一级目录。

## 构建验证

```bash
# 当前单一 Go 模块
cd backend
go test ./...
go build ./...

# CLIProxyAPI 社区兼容入口
./build.sh cliproxyapi
./build.sh service
```

整体仓库使用 Go 1.26 工具链。构建 `backend/cmd/cpamc` 会在同一模块中编译管理中心逻辑、一级 CLIProxyAPI SDK 和全部运行时依赖。

## 统一配置

`config.json` 和环境变量控制本地引擎生命周期：

| 配置 | 环境变量 | 默认值 |
|---|---|---|
| 是否启用 | `CPAMC_LOCAL_ENGINE_ENABLED` | `true` |
| CLIProxyAPI 配置文件 | `CPAMC_LOCAL_ENGINE_CONFIG` | `<dataDir>/cliproxyapi/config.yaml` |
| 监听地址 | `CPAMC_LOCAL_ENGINE_HOST` | `0.0.0.0` |
| 监听端口 | `CPAMC_LOCAL_ENGINE_PORT` | `18318` |

运行状态可以通过管理端口的 `/status` 和 `/usage-service/info` 查看。



## 接口路由网关（/system/config）

管理口 `:18317` 支持通过 `ManagerConfig.gateway.mode` 选择模型 API 转发策略：

| 模式 | 含义 |
|---|---|
| `dual-port`（默认） | 管理在 18317；客户端直接访问内置 18318 或外部 CPA，不在管理口反代 `/v1` |
| `local-engine` | `http://<host>:18317/v1/*` 反代到内置 CLIProxyAPI（默认 18318） |
| `external-cpa` | `http://<host>:18317/v1/*` 反代到 CPA Upstream（外置地址复用 `cpaBaseUrl`） |

固定规则：

- `/management.html`、`/api/*`、本地 usage 查询始终由管理中心处理
- `/v0/management/*`（除本地 usage）继续按既有逻辑代理到 CPA Upstream
- 只有 `/v1/*` 受 `gateway.mode` 控制
- 外置模式不新增第二套地址字段，直接使用 CPA Upstream

配置入口：系统设置 → 管理服务配置 →「接口路由网关」。

## 后续演进

后续本地执行引擎建议按以下顺序建设：

1. 定义 SQLite 凭证仓库到 CLIProxyAPI 认证模型的只读适配接口。
2. 将状态、优先级、过期时间和提供商策略接入本地账号选择器。
3. 完善请求记录中的执行引擎筛选和统计维度。
4. 使用相同请求对两个引擎执行协议、状态码、Header 和流式事件差异测试。
5. 兼容基线稳定后，再评估 `/v2` 或统一网关设计。

SQLite 应继续作为账号和运营策略的唯一事实来源。后台社区 CPA 通过同步获得凭证，本地执行引擎未来应直接读取 SQLite 适配结果，避免形成第二套可写凭证状态。
