# probe_results

异步探测结果事实表。每条成功写入的 usage event 会被转换为一次探测结果；`event_hash` 保证同一事件只处理一次。

```sql
CREATE TABLE probe_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_hash TEXT NOT NULL UNIQUE,
  request_id TEXT,
  timestamp_ms INTEGER NOT NULL,
  auth_index TEXT,
  api_key_hash TEXT,
  key_id INTEGER,
  provider_id INTEGER,
  provider_name TEXT,
  account TEXT,
  auth_label TEXT,
  auth_file TEXT,
  auth_provider TEXT,
  model TEXT,
  endpoint TEXT,
  status_code INTEGER DEFAULT 0,
  latency_ms INTEGER,
  failed INTEGER NOT NULL DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  action_applied TEXT,
  action_detail TEXT,
  created_at_ms INTEGER NOT NULL
);
```

索引：`timestamp_ms DESC`、`(auth_index,timestamp_ms DESC)`、`(key_id,timestamp_ms DESC)`、`(provider_id,timestamp_ms DESC)`、`(success,timestamp_ms DESC)`。

## 字段说明

| 字段 | 设计作用 |
|---|---|
| `id` | 自增主键，用于结果分页和相同时间下的稳定倒序。 |
| `event_hash` | 来源 usage 事件的唯一幂等键；`INSERT OR IGNORE` 保证同一请求事件只形成一条探测结果。 |
| `request_id` | CPA 请求关联 ID，用于把探测结果追溯到请求监控或日志中的同一次调用。 |
| `timestamp_ms` | 原始业务请求发生的 Unix 毫秒时间，是窗口统计、趋势和清理的时间基准。 |
| `auth_index` | 事件携带的认证索引，用于匹配 `cpa_auth_detail`、计算连续成功/失败并聚合账号。 |
| `api_key_hash` | API Key 的不可逆哈希；当没有 `auth_index` 或需要别名展示时作为辅助识别信息。 |
| `key_id` | 成功匹配统一凭证后的 `cpa_auth_detail.id` 快照；不设外键，凭证删除后历史仍保留。 |
| `provider_id` | 匹配凭证所属提供商的 ID 快照，用于提供商筛选和触发提供商级 CPA 同步。 |
| `provider_name` | 探测发生时的提供商名称快照，避免后续改名导致历史记录失去可读性。 |
| `account` | 面向页面展示的账号标识，依次取账户快照、认证标签或脱敏来源。 |
| `auth_label` | 事件写入时的认证可读标签快照，例如邮箱或账号名称。 |
| `auth_file` | CPA 认证文件名快照；自动上下线认证文件时作为操作目标。 |
| `auth_provider` | 认证所属类型或提供商快照，优先取事件认证提供商，其次取 usage 的 provider。 |
| `model` | 本次请求使用的模型标识，优先保留用户请求模型，用于排查特定模型的可用性。 |
| `endpoint` | 本次请求的标准化 API 操作或路径，用于区分不同协议探测结果。 |
| `status_code` | HTTP 状态码；没有明确响应码时为 `0`，状态策略可据此写入正值或负 HTTP 状态。 |
| `latency_ms` | 单次请求延迟毫秒值；无数据时为空，用于平均延迟统计。 |
| `failed` | 失败标记；来源事件已失败或 HTTP 状态码 `>=400` 时写 `1`。 |
| `success` | 成功标记，与最终 `failed` 互斥；统计成功率和连续恢复次数时直接聚合该字段。 |
| `error_message` | 上游事件提取出的错误摘要，用于展示最近失败原因和策略排查。 |
| `action_applied` | 本次结果触发并成功应用的动作名，可用逗号连接优先级、状态和 CPA 同步等多个动作。 |
| `action_detail` | 与 `action_applied` 同步写入的细节摘要，可包含状态变化、优先级变化或目标提供商。 |
| `created_at_ms` | 探测服务处理并写入结果的 Unix 毫秒时间；与原始请求时间 `timestamp_ms` 分离以观察处理延迟。 |

本表不声明外键，凭证或提供商删除后历史结果仍保留。可通过系统数据清理功能按时间或全部清理。
