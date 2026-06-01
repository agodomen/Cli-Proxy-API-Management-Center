# usage_events

> 模块：用量采集 / 查询  
> 源码：`services/internal/core/store/store.go`

## 作用

存储从 CPA / 队列采集到的用量事件明细，是 Usage 查询、汇总、导出、模型统计的主数据表。

## DDL

```sql
CREATE TABLE IF NOT EXISTS usage_events (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id               TEXT,
    event_hash               TEXT    NOT NULL UNIQUE,
    timestamp_ms             INTEGER NOT NULL,
    timestamp                TEXT    NOT NULL,
    provider                 TEXT,
    model                    TEXT    NOT NULL,
    endpoint                 TEXT,
    method                   TEXT,
    path                     TEXT,
    auth_type                TEXT,
    auth_index               TEXT,
    source                   TEXT,
    source_hash              TEXT,
    api_key_hash             TEXT,
    account_snapshot         TEXT,
    auth_label_snapshot      TEXT,
    auth_file_snapshot       TEXT,
    auth_provider_snapshot   TEXT,
    auth_project_id_snapshot TEXT,
    auth_snapshot_at_ms      INTEGER,
    requested_model          TEXT,
    resolved_model           TEXT,
    status_code              INTEGER,
    error_message            TEXT,
    input_tokens             INTEGER NOT NULL DEFAULT 0,
    output_tokens            INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens         INTEGER NOT NULL DEFAULT 0,
    cached_tokens            INTEGER NOT NULL DEFAULT 0,
    cache_tokens             INTEGER NOT NULL DEFAULT 0,
    total_tokens             INTEGER NOT NULL DEFAULT 0,
    latency_ms               INTEGER,
    failed                   INTEGER NOT NULL DEFAULT 0,
    raw_json                 TEXT,
    created_at_ms            INTEGER NOT NULL
);
```

## 索引

```sql
CREATE INDEX IF NOT EXISTS idx_usage_events_timestamp ON usage_events(timestamp_ms);
CREATE INDEX IF NOT EXISTS idx_usage_events_request_id ON usage_events(request_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_model ON usage_events(model);
CREATE INDEX IF NOT EXISTS idx_usage_events_auth_index ON usage_events(auth_index);
CREATE INDEX IF NOT EXISTS idx_usage_events_endpoint ON usage_events(endpoint);
```

## 字段说明

| 字段 | 设计作用 |
|------|------|
| `id` | 自增存储主键，用作 FTS 的 `event_id`、SSE 增量游标和同时间事件的稳定排序；不是上游请求 ID。 |
| `request_id` | CPA 或上游生成的请求关联 ID，用于在请求监控、日志和探测结果之间定位同一次调用，可空。 |
| `event_hash` | 规范化事件内容生成的唯一幂等键；批量写入使用 `INSERT OR IGNORE`，重复采集不会产生第二条记录。 |
| `timestamp_ms` | 原始请求发生的 Unix 毫秒时间，是时间范围查询、统计聚合和保留策略的基准。 |
| `timestamp` | 与 `timestamp_ms` 对应的可读时间文本，保留上游时间表达并用于 API 输出。 |
| `provider` | 事件报告的提供商或认证来源类型，用于提供商维度统计；来自 `provider/type/auth_type` 等兼容字段。 |
| `model` | Usage 主分组模型；优先使用请求别名，缺失时回退实际上游模型，仍为空时写 `-`。 |
| `endpoint` | 标准化请求操作，通常为 `METHOD path`；缺失时由 `method` 与 `path` 合成，仍缺失则写 `-`。 |
| `method` | HTTP 方法大写值，用于方法筛选和全文搜索。 |
| `path` | 请求 URL 路径或路由，用于接口维度分析和全文搜索，不保存域名。 |
| `auth_type` | 上游事件携带的认证类型字符串，用于区分 API Key、认证文件或其他账号来源。 |
| `auth_index` | 上游认证账号的稳定索引，是关联 `cpa_auth_detail`、探测结果和账号统计的弱关联键。 |
| `source` | 对账号、邮箱或密钥来源进行脱敏后的展示文本，用于无认证快照时的账号回退展示。 |
| `source_hash` | 对脱敏前原始来源计算的 SHA-256，用于在不保存原文的情况下稳定归并同一来源。 |
| `api_key_hash` | 对原始 API Key 计算的 SHA-256，用于关联 `api_key_aliases` 和 API Key 维度统计，不保存明文。 |
| `account_snapshot` | 事件写入时解析出的账号展示值，避免认证配置改名后历史统计发生漂移。 |
| `auth_label_snapshot` | 认证条目的可读标签快照，例如邮箱、备注名或账号名。 |
| `auth_file_snapshot` | CPA 认证文件名快照，可用于巡检定位和认证文件上下线。 |
| `auth_provider_snapshot` | 认证文件或账号所属提供商快照，与请求路由的 `provider` 分开保存。 |
| `auth_project_id_snapshot` | 服务账号或云账号的项目 ID 快照，用于区分同一提供商下的项目级凭证。 |
| `auth_snapshot_at_ms` | 上述认证快照生成时的 Unix 毫秒时间；用于判断快照是否早于后续配置变化。 |
| `requested_model` | 调用方请求的模型或别名，用于分析用户侧模型选择。 |
| `resolved_model` | CPA 实际解析并发送到上游的模型，用于路由映射和实际成本核对。 |
| `status_code` | 请求最终 HTTP 状态码；无明确状态时为 `0`，探测服务据此判断明确成功或失效原因。 |
| `error_message` | 从上报载荷中提取的错误摘要，供实时监控和探测失败原因展示。 |
| `input_tokens` | 普通输入 Token 数，用于输入成本和总用量统计。 |
| `output_tokens` | 模型输出 Token 数，用于输出成本和总用量统计。 |
| `reasoning_tokens` | 推理 Token 数，单独保留以展示推理模型消耗。 |
| `cached_tokens` | 一类上游格式上报的缓存 Token 数；与 `cache_tokens` 并存用于兼容不同事件格式。 |
| `cache_tokens` | 另一类上游格式上报的缓存 Token 数；计算缺失总量时与 `cached_tokens` 取较大值，避免重复计数。 |
| `total_tokens` | 本次请求总 Token；上游未提供或小于等于零时由输入、输出、推理和缓存字段推导。 |
| `latency_ms` | 请求耗时毫秒值；缺失时为空，用于平均延迟、排序和性能分析。 |
| `failed` | 规范化后的失败布尔值，以 `0/1` 保存；是成功率、失败筛选和探测转换的直接输入。 |
| `raw_json` | 对敏感字段递归脱敏后的原始事件 JSON，保留未结构化字段用于详情展示和故障排查。 |
| `created_at_ms` | usage-service 完成规范化并准备入库的 Unix 毫秒时间；与业务请求时间分离，用于观察采集延迟。 |

## 兼容迁移

部分 snapshot / model / error 字段通过 `ensureUsageEventSnapshotColumns()` 动态 `ALTER TABLE` 补齐，兼容旧库。

## 关联

- FTS：`usage_events_fts`
- 别名：`api_key_aliases`（经 `api_key_hash`）
- 写入策略：当前以 append-only 为主
