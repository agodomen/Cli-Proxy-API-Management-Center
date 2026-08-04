# api_key_aliases_fts

FTS5 虚拟表，为 `api_key_aliases.alias` 提供 Unicode 分词和 2/3/4 字符前缀搜索。

```sql
CREATE VIRTUAL TABLE api_key_aliases_fts USING fts5(
  api_key_hash UNINDEXED,
  alias,
  tokenize='unicode61',
  prefix='2 3 4'
);
```

## 字段说明

| 字段 | 设计作用 |
|---|---|
| `api_key_hash` | 对应 `api_key_aliases.api_key_hash` 的回表键；声明为 `UNINDEXED`，不参与搜索词匹配。 |
| `alias` | 实际建立全文索引的可读别名，支持 Unicode 分词及 2、3、4 字符前缀查询。 |

INSERT、UPDATE、DELETE 触发器保持它与 `api_key_aliases` 同步；启动时还会补齐缺失记录。`api_key_hash` 只用于回表，不参与全文索引。
