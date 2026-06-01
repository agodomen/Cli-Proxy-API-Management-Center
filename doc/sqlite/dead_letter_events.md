# dead_letter_events

保存采集、解析或入库失败的原始事件载荷，避免错误数据静默丢失。

```sql
CREATE TABLE dead_letter_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payload TEXT NOT NULL,
  error TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
```

## 字段说明

| 字段 | 设计作用 |
|---|---|
| `id` | 自增主键，用于唯一定位一条失败载荷和分页清理。 |
| `payload` | 无法正常解析或写入的原始载荷文本，保留失败现场以便人工排查。 |
| `error` | 捕获失败时的错误消息，说明载荷进入死信表的直接原因。 |
| `created_at_ms` | 写入死信表的 Unix 毫秒时间，不等同于载荷中的业务事件时间；用于保留天数清理。 |

本表不参与 Usage 和探测统计，不提供自动重放。可通过系统数据清理功能按时间或全部清理；`payload` 可能包含上游原始数据，应按敏感日志处理。
