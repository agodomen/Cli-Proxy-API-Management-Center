# model_prices

模型价格缓存表，用于 Usage 成本估算和外部价格源同步。

```sql
CREATE TABLE model_prices (
  model TEXT PRIMARY KEY,
  prompt_per_1m REAL NOT NULL,
  completion_per_1m REAL NOT NULL,
  cache_per_1m REAL NOT NULL,
  pricing_mode TEXT NOT NULL DEFAULT 'fixed',
  mapping_json TEXT,
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
| `pricing_mode` | 计价模式：`fixed` 表示直接设置价格，`composite` 表示由多个来源模型按系数计算。旧数据库启动时自动添加该字段并默认为 `fixed`。 |
| `mapping_json` | 组合价格映射数组，元素格式为 `{"model":"gpt-5.6","coefficient":0.8}`；固定价格为空。 |
| `source` | 价格记录的来源名称，用来区分手工配置和外部价格源同步，可空。 |
| `source_model_id` | 外部价格源使用的模型标识；当其命名与本地 `model` 不同时用于追溯映射。 |
| `raw_json` | 外部价格源对应条目的原始 JSON，保留未映射字段，便于核对同步结果和排错。 |
| `updated_at_ms` | 本地记录最近一次被保存或覆盖的 Unix 毫秒时间；批量手工保存时统一刷新。 |
| `synced_at_ms` | 最近一次从外部价格源同步成功的 Unix 毫秒时间；手工价格可以为空。 |

三个价格字段单位均为每 1M Token。手工保存会整体替换当前价格集合；外部同步按 `model` 执行 upsert。

## 组合价格

组合价格的输入、输出和缓存单价分别使用同一组来源模型与系数计算：

```text
auto.prompt = gpt-5.6.prompt * 0.8 + gpt-5.4.prompt * 0.2
auto.completion = gpt-5.6.completion * 0.8 + gpt-5.4.completion * 0.2
auto.cache = gpt-5.6.cache * 0.8 + gpt-5.4.cache * 0.2
```

系数必须为有限正数，但总和不强制等于 `1`，因此同一机制也可表达倍率价格。服务在每次读取价格时重新解析组合关系，来源模型被外部同步更新后，组合价格会自动更新。保存时会拒绝缺失来源、空映射和循环引用。

当请求模型对应组合价格时，成本估算优先使用该组合价格；普通固定价格继续保持“真实模型优先、请求模型兜底”的既有匹配规则。
