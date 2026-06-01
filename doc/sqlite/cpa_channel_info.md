# cpa_channel_info

公益渠道表，保存渠道级默认参数。渠道是提供商的上层分类，不代表 CPA 的具体协议配置。

```sql
CREATE TABLE cpa_channel_info (
  channel_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_name TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  status       INTEGER DEFAULT 1,
  param        TEXT DEFAULT '{}',
  url          TEXT,
  create_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_cpa_channel_status ON cpa_channel_info(status);
```

| 字段 | 说明 |
|---|---|
| `channel_id` | 自增主键，也是 `cpa_provider_info.channel_id` 的关联目标；预置渠道固定使用 1、2、3，便于初始化时幂等校正。 |
| `channel_name` | 面向运营人员展示和搜索的渠道名称，例如内置、官方或第三方来源。 |
| `description` | 对渠道来源、可信度和使用边界的说明，不参与路由；旧库由启动迁移补齐。 |
| `status` | 生命周期状态：`1` 有效、`0` 未定义、`-1` 软删除；默认查询只返回 `1`。 |
| `param` | 渠道级 JSON 默认参数，是 `channel → provider → auth` 三层浅合并的最底层。 |
| `url` | 渠道主页、社区帖子或来源地址，用于追溯数据来源，可空。 |
| `create_at` | SQLite 创建时间文本，由数据库默认值写入，表示渠道记录首次入库时间。 |
| `update_at` | SQLite 更新时间文本；编辑、软删除和预置记录校正时由应用显式刷新。 |

默认列表只返回 `status=1`，`status=all` 才包含软删除记录。启动时按固定 ID 维护三个预置渠道：1 内置、2 官方、3 第三方；其他 ID 的自定义渠道保留。
