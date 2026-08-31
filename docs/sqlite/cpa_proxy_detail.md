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
| `owner_id` | 可选属主编号，用于记录代理归属或提供者；当前不建立外键。写入 API 同时接受 JSON 数字和十进制数字字符串，持久化时统一为 INTEGER。 |
| `create_at` | SQLite 创建时间文本，表示代理记录首次入库时间。 |
| `update_at` | SQLite 更新时间文本；编辑代理时显式刷新，连通性探测结果当前不回写该表。 |
| `remark` | 运营备注，用于搜索和人工辨识，不参与协议解析或 Clash 节点生成。 |

`id` 是数据库自增主键，`proxy_index` 是业务主键。创建、更新和 upsert 都遵循“有 `proxy_index` 则保留，无 `proxy_index` 才从代理内容生成”的规则。Upsert 只按最终 `proxy_index` 判断：存在则更新同一记录（包括允许修改或清空 `proxy_value`），不存在则新增。

启动迁移会将旧的普通 `proxy_index` 索引升级为唯一索引。若旧数据库已经存在重复 `proxy_index`，服务会明确拒绝启动并报告重复值，避免静默删除或合并代理记录。

删除和批量删除均为物理删除。筛选支持状态、代理类型和文本搜索。文本搜索会按空白拆分为多个关键词，每个关键词都可模糊匹配 `proxy_index`、代理 URI、说明、原始内容、备注或 `param`；多个关键词之间为 AND 关系，SQL 通配符会按普通字符处理。

## 批量导入

二开接口 `POST /v0/cpamc/charitable/proxies/batch/import` 接受以下三种输入：

- 每行一个代理 URI；
- Base64 编码的 URI 订阅内容；
- 带有顶层 `proxies` 数组的 Clash YAML。

单次最多处理 1000 个节点。URI 节点从 scheme 推导 `proxy_type`；Clash YAML 节点将完整对象保存在 `param.clash`，原节点 JSON 同时写入 `content`。重复 `proxy_index` 不覆盖现有记录，计入返回结果的 `skipped`。

二开接口 `POST /v0/cpamc/charitable/proxies/batch/delete-by-urls` 接受 `content`（每行一个代理 URL）或 `urls` 数组，按 `proxy_value` 精确匹配全量代理库存（同一 URL 对应多条记录时全部匹配），重复 URL 会先去重，单次最多 500 个。响应返回 `total`、`matched`、`deleted` 和未匹配的 `missing` URL；前端在发起该物理删除请求前会先弹出确认对话框。

## cpa_clash_subscription

Clash 订阅是代理管理模块的二开表，不依赖社区配置或社区 management handler。

```sql
CREATE TABLE cpa_clash_subscription (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  subscription_type INTEGER NOT NULL DEFAULT 2,
  proxy_ids TEXT NOT NULL DEFAULT '[]',
  proxy_urls TEXT NOT NULL DEFAULT '[]',
  access_count INTEGER NOT NULL DEFAULT 0,
  effective_at DATETIME NOT NULL,
  expires_at DATETIME,
  create_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

| 字段 | 说明 |
|---|---|
| `id` | 订阅记录自增主键。 |
| `token` | 创建时生成的 24 字节随机值，以 48 位十六进制字符串表示；作为公开订阅链接的不可猜标识。 |
| `subscription_type` | 订阅类型：`2` 为节点订阅，`3` 为复合订阅。旧库迁移后默认为 `2`。 |
| `proxy_ids` | 类型 `2` 使用的 `cpa_proxy_detail.id` JSON 数组，去重后最多 500 个；类型 `3` 固定保存为空数组。 |
| `proxy_urls` | 类型 `3` 使用的外部 Clash HTTP(S) 订阅地址 JSON 数组，去重后最多 20 个；类型 `2` 固定保存为空数组。 |
| `access_count` | 订阅通过 token 与时间窗口校验后的成功访问次数。 |
| `effective_at` | UTC 生效时间；访问早于此时间返回 HTTP 403。 |
| `expires_at` | 可空 UTC 失效时间；到期后返回 HTTP 410，空值表示永不失效。 |
| `create_at` | 创建时间。 |
| `update_at` | 最近更新时间；管理端修改节点/时间窗口或有效访问递增计数时刷新。 |

管理接口位于 `/v0/cpamc/charitable/proxies/subscriptions`，继续使用管理密钥鉴权。节点订阅（类型 `2`）可直接选择节点，也可粘贴代理 URI：服务先按规范化后的 `proxy_index` 查询已有节点，已有节点直接返回给前端勾选，缺失节点入库后再返回并勾选。

复合订阅（类型 `3`）保存一个或多个外部 Clash 订阅 URL。创建或编辑时，服务会拉取这些地址、解析顶层 `proxies`，并将新节点导入 `cpa_proxy_detail`；`POST /v0/cpamc/charitable/proxies/subscriptions/resolve-urls` 可在保存前执行同样的解析导入并预览节点。单个来源响应上限为 10 MiB，请求超时 20 秒。某个来源失败时会记录在解析结果中，只要至少一个来源提供有效节点即可继续保存。

公开订阅接口为 `GET /v0/cpamc/charitable/subscriptions/{token}/clash`，只有严格匹配 48 位 token 的 GET 路径跳过管理密钥，并由 charitable handler 再确认 token、生效时间与失效时间。类型 `2` 从数据库节点生成 Clash YAML；类型 `3` 在每次访问时动态拉取全部 `proxy_urls` 并组合当前节点，同名节点自动追加数字后缀。全部外部来源都不可用时返回 HTTP 502。访问通过 token 与时间窗口校验后会递增 `access_count`。
