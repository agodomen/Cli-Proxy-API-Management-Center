# probe_action_logs

记录探测服务执行过的自动化动作及成功/失败结果，用于审计 CPA 上下线和策略运营。

```sql
CREATE TABLE probe_action_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at_ms INTEGER NOT NULL,
  auth_index TEXT,
  key_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
```

索引：`created_at_ms DESC`、`(auth_index,created_at_ms DESC)`。

## 字段说明

| 字段 | 设计作用 |
|---|---|
| `id` | 自增主键，为同一毫秒内的多条动作提供稳定顺序，并用于分页。 |
| `created_at_ms` | 动作尝试发生的 Unix 毫秒时间，是审计排序和数据清理的时间基准。 |
| `auth_index` | 被操作凭证的稳定认证索引，用于跨探测结果和凭证表追踪；某些提供商级动作可以为空。 |
| `key_id` | 动作发生时对应的 `cpa_auth_detail.id` 快照，不设外键，凭证删除后仍保留审计记录。 |
| `action` | 机器可读动作类型，例如优先级调整、状态变化、过期续期或 CPA 上下线。 |
| `detail` | 动作参数和变化前后值的摘要，例如 `1 -> -401`、新的过期时间或同步目标。 |
| `success` | 执行结果布尔值，`1` 表示动作成功完成，`0` 表示尝试失败。 |
| `error` | 动作失败时记录错误摘要；成功动作通常为空。 |

常见动作包括 `priority_boost`、`priority_penalty`、`status_invalid`、`status_recover`、`status_expired`、`expiry_renew`、`cpa_offline`、`cpa_online`、`cpa_provider_sync`。失败动作也写入，并在 `error` 保存错误摘要。

`key_id`、`auth_index` 是弱关联，不设外键。可由系统数据清理功能清理。
