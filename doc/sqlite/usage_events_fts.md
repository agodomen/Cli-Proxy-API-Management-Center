# usage_events_fts

FTS5 虚拟表，为用量页面提供账户、认证、模型、端点和路径前缀搜索。

```sql
CREATE VIRTUAL TABLE usage_events_fts USING fts5(
  event_id UNINDEXED,
  account_snapshot,
  auth_label_snapshot,
  auth_file_snapshot,
  auth_provider_snapshot,
  auth_project_id_snapshot,
  auth_index,
  source,
  api_key_hash,
  provider,
  model,
  requested_model,
  resolved_model,
  endpoint,
  method,
  path,
  tokenize='unicode61',
  prefix='2 3 4'
);
```

## 字段说明

| 字段 | 设计作用 |
|---|---|
| `event_id` | 对应 `usage_events.id` 的回表与清理键；声明为 `UNINDEXED`，不参与关键词匹配。 |
| `account_snapshot` | 索引账号展示快照，使用户可以按邮箱或账号名称搜索历史请求。 |
| `auth_label_snapshot` | 索引认证标签快照，支持按凭证别名定位请求。 |
| `auth_file_snapshot` | 索引认证文件名，支持从文件维度排查账号请求。 |
| `auth_provider_snapshot` | 索引认证所属提供商快照，补充请求路由提供商之外的搜索维度。 |
| `auth_project_id_snapshot` | 索引云项目 ID，便于区分服务账号所属项目。 |
| `auth_index` | 索引稳定认证标识，支持直接按完整或前缀认证索引检索。 |
| `source` | 索引脱敏后的来源展示文本，不把原始敏感来源写入 FTS。 |
| `api_key_hash` | 索引 API Key 哈希，支持与别名检索结果合并并精确回查事件。 |
| `provider` | 索引请求提供商字段。 |
| `model` | 索引 Usage 主模型字段。 |
| `requested_model` | 索引调用方请求模型或别名。 |
| `resolved_model` | 索引 CPA 最终解析模型。 |
| `endpoint` | 索引标准化操作，例如 `POST /v1/chat/completions`。 |
| `method` | 索引 HTTP 方法。 |
| `path` | 索引请求路径，支持路径前缀搜索。 |

分词器为 `unicode61`，前缀长度为 2/3/4。状态码、错误、Token 和原始 JSON 不进入 FTS，避免索引体积无界增长；这些字段通过普通筛选或回表读取。

当前只有 `usage_events` INSERT 触发器自动写入 FTS；启动时 `backfillUsageEventsFTS()` 按 `event_id` 补齐历史缺口。普通业务不会更新 usage 事件。数据清理删除 usage 事件时会显式同步清理 FTS，而不是依赖 DELETE 触发器。

FTS shadow 表由 SQLite 管理，SQL Console 默认隐藏。
