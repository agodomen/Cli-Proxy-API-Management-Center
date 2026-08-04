# SQLite 表文档索引

> 校对日期：2026-07-17  
> 事实来源：`services/internal/core/store/store.go`、`services/internal/core/probe/store.go`、`services/internal/core/store/cleanup.go`

本目录描述 usage-service 当前实际创建、迁移和读写的 SQLite 对象。DDL 展示目标结构；旧库可能先以旧结构存在，再由启动迁移补齐字段。

## 运行参数

数据库启动时设置：

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
```

## 表清单

| 表 / 虚拟表 | 用途 | 当前状态 |
|---|---|---|
| [`usage_events`](./usage_events.md) | CPA 请求用量事件事实表 | 主用 |
| [`usage_events_fts`](./usage_events_fts.md) | 用量事件全文检索 | 主用，FTS5 |
| [`dead_letter_events`](./dead_letter_events.md) | 采集失败原始载荷 | 主用 |
| [`settings`](./settings.md) | 系统、探测、清理配置 | 主用 |
| [`model_prices`](./model_prices.md) | 模型价格与同步来源 | 主用 |
| [`api_key_aliases`](./api_key_aliases.md) | API Key 哈希到展示名映射 | 主用 |
| [`api_key_aliases_fts`](./api_key_aliases_fts.md) | API Key 别名全文检索 | 主用，FTS5 |
| [`cpa_channel_info`](./cpa_channel_info.md) | 公益渠道默认参数 | 主用 |
| [`cpa_provider_info`](./cpa_provider_info.md) | 提供商、协议、CPA 同步目标与策略 | 主用 |
| [`cpa_auth_detail`](./cpa_auth_detail.md) | API Key、认证文件、OAuth 等统一凭证 | 主用 |
| [`cpa_proxy_detail`](./cpa_proxy_detail.md) | 代理 URI、状态和 Clash 导出来源 | 主用 |
| [`probe_results`](./probe_results.md) | 每次真实请求探测结果 | 主用 |
| [`probe_action_logs`](./probe_action_logs.md) | 自动状态、优先级及 CPA 上下线动作 | 主用 |

## 核心关系

```text
cpa_channel_info
  └─ cpa_provider_info
       └─ cpa_auth_detail

cpa_proxy_detail                    独立代理库存

usage_events ──auth_index──> cpa_auth_detail
probe_results ──key_id/auth_index──> cpa_auth_detail
probe_action_logs ──key_id/auth_index──> cpa_auth_detail
```

数据库未为探测表声明外键；`key_id`、`provider_id`、`auth_index` 是历史快照/弱关联，避免业务记录删除后丢失探测历史。

## 参数与状态约定

- 参数浅合并顺序：`channel.param → provider.param → auth.param`。
- 渠道、提供商删除为软删除：`status=-1`。
- 凭证、代理删除为物理删除。
- 凭证状态：`>0` 有效、`0` 未知、`<0` 无效；自动 HTTP 原因使用负状态码，如 `-401`。
- 代理优先级：业务调度使用数值排序；Clash 导出中 `<0` 为公共节点，`>=0` 为私人节点。

## 清理范围

系统清理功能允许处理 `usage_events`、`dead_letter_events`、`probe_results`、`probe_action_logs`；不会清理渠道、提供商、凭证、代理、价格和设置等业务配置表。
