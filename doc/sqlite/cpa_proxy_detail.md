# cpa_proxy_detail

当前代理库存表，保存完整代理 URI、协议类型、探测状态和导出参数。它不再使用旧版 `auth_*` 字段。

```sql
CREATE TABLE cpa_proxy_detail (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proxy_index TEXT NOT NULL,
  proxy_type INTEGER DEFAULT 1,
  proxy_value TEXT NOT NULL,
  proxy_info TEXT NOT NULL,
  content TEXT,
  status INTEGER DEFAULT 0,
  priority INTEGER DEFAULT 0,
  param TEXT DEFAULT '{}',
  owner_id INTEGER,
  create_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  remark TEXT
);
```

索引：`proxy_index` 唯一索引，以及 `status`、`proxy_type` 普通索引。

| 字段 | 说明 |
|---|---|
| `id` | 自增主键，作为代理 CRUD、批量探测和站点连通性测试的记录标识。 |
| `proxy_index` | 代理业务主键。请求已指定时原样保留；缺失时才基于 `proxy_value`，为空时回退 `content` 计算 MD5。数据库唯一索引禁止重复。 |
| `proxy_type` | 1 unknown、2 vmess、3 vless、4 socks、5 http、6 trojan、7 ss、8 ssr、9 hysteria、10 tuic、11 naive、12 juicity、13 overtls、14 wireguard、15 freedom、16 blackhole、17 dokodemo-door |
| `proxy_value` | 完整代理 URI/地址，可能包含认证秘密。已指定 `proxy_index` 时允许为空。 |
| `proxy_info` | 协议标签或说明；为空时由协议类型补齐 |
| `content` | 代理的原始来源文本或导入内容；`proxy_value` 为空时作为生成 `proxy_index` 的回退来源。 |
| `status` | `>0` 有效、`0` 未知、`<0` 无效/禁用 |
| `priority` | 调度优先级；Clash 导出中 `<0` 为公共节点，`>=0` 为私人节点 |
| `param` | JSON 扩展；`param.clash` 可保存无法从 URI 推导的标准 Clash 节点对象 |
| `owner_id` | 可选属主编号，用于记录代理归属或提供者；当前不建立外键。 |
| `create_at` | SQLite 创建时间文本，表示代理记录首次入库时间。 |
| `update_at` | SQLite 更新时间文本；编辑代理时显式刷新，连通性探测结果当前不回写该表。 |
| `remark` | 运营备注，用于搜索和人工辨识，不参与协议解析或 Clash 节点生成。 |

`id` 是数据库自增主键，`proxy_index` 是业务主键。创建、更新和 upsert 都遵循“有 `proxy_index` 则保留，无 `proxy_index` 才从代理内容生成”的规则。Upsert 只按最终 `proxy_index` 判断：存在则更新同一记录（包括允许修改或清空 `proxy_value`），不存在则新增。

启动迁移会将旧的普通 `proxy_index` 索引升级为唯一索引。若旧数据库已经存在重复 `proxy_index`，服务会明确拒绝启动并报告重复值，避免静默删除或合并代理记录。

删除和批量删除均为物理删除。筛选支持状态、代理类型和文本搜索。
