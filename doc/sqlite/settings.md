# settings

全局键值配置表，各模块共享并使用 upsert 写入。

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
```

## 字段说明

| 字段 | 设计作用 |
|---|---|
| `key` | 配置项的稳定命名空间和主键；相同键再次保存时执行 upsert，不产生历史版本。 |
| `value` | 业务模块自行解释的配置正文，通常为 JSON，也允许普通文本；数据库层不校验内部结构。 |
| `updated_at_ms` | 最近一次保存该键的 Unix 毫秒时间，由服务端覆盖写入，用于展示配置更新时间。 |

当前已知配置键：

| key | value |
|---|---|
| `setup` | 旧版 CPA 上游地址、Management Key、队列等初始化 JSON |
| `manager_config_v1` | 当前系统配置中心完整 JSON；存在时优先于旧 `setup` |
| `probe_service_config_v1` | 异步探测与自动状态、优先级、CPA 上下线策略 JSON |
| `setting.data.clean` | 数据清理页面的各表保留策略 JSON |

此外 `SaveSetting` 允许业务模块保存其他键。表不提供多版本、过期时间或加密能力；Management Key 等秘密可能存在于 `value`，数据库文件需要按敏感配置保护。
