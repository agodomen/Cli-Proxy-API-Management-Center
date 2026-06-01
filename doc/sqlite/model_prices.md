# model_prices

模型价格缓存表，用于 Usage 成本估算和外部价格源同步。

```sql
CREATE TABLE model_prices (
  model TEXT PRIMARY KEY,
  prompt_per_1m REAL NOT NULL,
  completion_per_1m REAL NOT NULL,
  cache_per_1m REAL NOT NULL,
  source TEXT,
  source_model_id TEXT,
  raw_json TEXT,
  updated_at_ms INTEGER NOT NULL,
  synced_at_ms INTEGER
);
```

## 字段说明

| 字段 | 设计作用 |
|---|---|
| `model` | CPA 请求中使用的模型名称，也是唯一主键；Usage 统计按该名称查找单价，不保存价格历史版本。 |
| `prompt_per_1m` | 每 100 万输入 Token 的价格，用于计算普通提示词输入成本；必须为有限非负数。 |
| `completion_per_1m` | 每 100 万输出 Token 的价格，用于计算模型回复成本；必须为有限非负数。 |
| `cache_per_1m` | 每 100 万缓存 Token 的价格，用于缓存命中相关成本估算；必须为有限非负数。 |
| `source` | 价格记录的来源名称，用来区分手工配置和外部价格源同步，可空。 |
| `source_model_id` | 外部价格源使用的模型标识；当其命名与本地 `model` 不同时用于追溯映射。 |
| `raw_json` | 外部价格源对应条目的原始 JSON，保留未映射字段，便于核对同步结果和排错。 |
| `updated_at_ms` | 本地记录最近一次被保存或覆盖的 Unix 毫秒时间；批量手工保存时统一刷新。 |
| `synced_at_ms` | 最近一次从外部价格源同步成功的 Unix 毫秒时间；手工价格可以为空。 |

三个价格字段单位均为每 1M Token。手工保存会整体替换当前价格集合；外部同步按 `model` 执行 upsert。
