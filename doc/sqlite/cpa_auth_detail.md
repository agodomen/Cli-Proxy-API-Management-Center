# cpa_auth_detail

当前统一凭证主表，保存普通 API Key、认证文件、OAuth、OIDC 和多 Key JSON；词元中心的密钥 CRUD、探测策略和 CPA 同步均以此表为准。

```sql
CREATE TABLE cpa_auth_detail (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auth_index TEXT NOT NULL,
  auth_type INTEGER DEFAULT 1,
  auth_value TEXT NOT NULL DEFAULT '',
  auth_info TEXT NOT NULL DEFAULT '{"schema_version":1,"credential_type":"api_key","api_type":1,"protocols":[]}',
  content TEXT,
  status INTEGER DEFAULT 0,
  priority INTEGER DEFAULT 0,
  expires_at_ms INTEGER,
  probe_policy TEXT NOT NULL DEFAULT '{}',
  param TEXT DEFAULT '{}',
  provider_id INTEGER REFERENCES cpa_provider_info(provider_id) ON DELETE SET NULL,
  owner_id INTEGER,
  create_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  remark TEXT
);
```

索引：`auth_index` 唯一索引，以及 `provider_id`、`status`、`auth_type`、`expires_at_ms` 普通索引。

| 字段 | 说明 |
|---|---|
| `id` | 自增主键，供词元中心 CRUD、批量操作及探测表的 `key_id` 弱关联使用。 |
| `auth_index` | 凭证业务主键。请求已指定时原样保留；缺失时才根据规范化 `auth_value`，为空时回退 `content`，计算 MD5。它用于去重和探测关联，不是安全哈希。 |
| `auth_type` | `1` API Key、`2` Service Account、`3` OAuth2、`4` OIDC、`5` API Key 集合 |
| `auth_value` | 凭证本体；类型 1 为字符串，类型 2~5 为规范 JSON，包含秘密。已指定 `auth_index` 时允许为空。 |
| `auth_info` | v1 元数据 JSON，含 `credential_type`、协议质数积、来源、文件名、`managed_header_keys` / `last_pushed_at` / `source_modtime` 等非敏感字段；不应包含秘密 |
| `content` | 采集、导入或人工录入时保留的来源正文和上下文；`auth_value` 为空时也作为生成 `auth_index` 的回退来源。 |
| `status` | `1` 手动有效；HTTP 2xx 可写正状态码；`0` 未知；手动原因 `-1~-99`；自动 HTTP 无效为 `-HTTP` |
| `priority` | 路由优先级；策略自动增减，并影响 CPA 配置顺序/优先级 |
| `expires_at_ms` | 明确过期毫秒时间；到期后后台设为 `-3` 并触发 CPA 下线 |
| `probe_policy` | 凭证级策略 JSON，覆盖提供商和全局策略 |
| `param` | 凭证级扩展参数，覆盖提供商和渠道参数 |
| `provider_id` | 所属提供商；删除提供商不会物理删除凭证。写入时若请求未带 `provider_id`，会解析 `auth_info` 中的 `base_url`/`baseUrl`/`baseURL`，按规范化 URL 自动匹配 `cpa_provider_info`；匹配不到则保持为空。已显式传入的 `provider_id` 优先生效。 |
| `owner_id` | 可选属主编号，用于标记凭证归属或导入主体；当前不关联独立用户表。 |
| `create_at` | SQLite 创建时间文本，表示凭证首次进入事实库的时间。 |
| `update_at` | SQLite 更新时间文本；编辑、状态、优先级、过期时间和策略动作都会显式刷新。 |
| `remark` | 面向运营人员的自由备注，不参与认证、探测或参数合并。 |

`id` 是数据库自增主键，`auth_index` 是带唯一索引的业务主键。创建、更新和 upsert 都遵循“有 `auth_index` 则保留，无 `auth_index` 才从凭证内容生成”的规则。Upsert 只按最终 `auth_index` 判断：存在则更新同一记录（包括允许修改或清空 `auth_value`），不存在则新增。

列表默认包含全部状态，支持精确状态和 `valid/unknown/invalid` 状态域。删除为物理删除。当前 API 响应仍会返回 `auth_value`，它是敏感字段。
