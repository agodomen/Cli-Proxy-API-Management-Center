# api_key_aliases

将 usage 事件中的 `api_key_hash` 映射为用户可读别名。

```sql
CREATE TABLE api_key_aliases (
  api_key_hash TEXT PRIMARY KEY,
  alias TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
```

## 字段说明

| 字段 | 设计作用 |
|---|---|
| `api_key_hash` | API Key 明文的 64 位小写 SHA-256，用作稳定主键并与 `usage_events.api_key_hash` 关联；只用于匹配，不可还原明文。 |
| `alias` | 用户为哈希指定的可读名称，用于监控筛选和列表展示；应用层限制最多 120 个字符，并按忽略大小写的名称防止多个有效哈希占用同一别名。 |
| `updated_at_ms` | 最近一次创建或修改别名的 Unix 毫秒时间，用于判断映射新旧和 API 返回。 |

它不保存 API Key 明文，也不与 `cpa_auth_detail` 建立外键。Usage 搜索会同时查询事件 FTS 和别名 FTS，再通过 `api_key_hash` 匹配事件。
