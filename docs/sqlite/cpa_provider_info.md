# cpa_provider_info

提供商是凭证运营、探测策略和 CPA 同步的基本单元。

```sql
CREATE TABLE cpa_provider_info (
  provider_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_name  TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  channel_id     INTEGER REFERENCES cpa_channel_info(channel_id) ON DELETE SET NULL,
  status         INTEGER DEFAULT 1,
  base_url       TEXT NOT NULL,
  protocol_type  TEXT NOT NULL DEFAULT 'openai_compatible',
  cpa_config_type TEXT NOT NULL DEFAULT 'openai-compatibility',
  probe_policy   TEXT NOT NULL DEFAULT '{}',
  param          TEXT DEFAULT '{}',
  create_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

索引：`channel_id`、`status`、`protocol_type`。

| 字段 | 说明 |
|---|---|
| `provider_id` | 自增主键，是凭证归属、探测统计和提供商级 CPA 同步使用的稳定标识。 |
| `provider_name` | 提供商名称；OpenAI-compatible 同步时也是 CPA 配置名称 |
| `description` | 端点、来源和运营说明 |
| `channel_id` | 所属渠道；渠道物理删除时置空，正常删除实际为软删 |
| `status` | 提供商生命周期状态；正值可参与运营与同步，`0` 为未定义，负值不可用，其中删除操作写 `-1`。 |
| `base_url` | 上游服务基础 URL，也是预置提供商去重键；初始化时按去尾斜杠并忽略大小写后的 URL 判断是否已存在。 |
| `protocol_type` | 探测/接入协议。支持单值或多选逗号串，例如 `openai_compatible` 或 `openai_compatible,anthropic,gemini`。单适配器消费方（探测等）取第一项为主协议。合法值：`openai_compatible`、`anthropic`、`gemini`、`codex`、`vertex`。 |
| `cpa_config_type` | 同步到 CPA 时写入的目标配置域，例如 `openai-compatibility`、`claude-api-key`、`gemini-api-key`、`codex-api-key`、`vertex-api-key`。 |
| `probe_policy` | 提供商级探测、优先级、状态和 CPA 上下线策略 JSON；空对象表示继承全局策略，凭证级策略可继续覆盖。 |
| `param` | 提供商级扩展 JSON，保存模型、代理、Header、前缀等配置，并覆盖渠道级同名参数。 |
| `create_at` | SQLite 创建时间文本，表示提供商首次写入时间。 |
| `update_at` | SQLite 更新时间文本；编辑、软删除等写操作显式刷新，便于判断配置最近变化。 |

历史库启动时补齐协议字段并默认映射到 OpenAI-compatible。预置提供商按规范化 `base_url` 判断是否缺失，不按 ID 覆盖用户记录。
