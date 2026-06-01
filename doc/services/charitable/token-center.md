# 词元中心

**管理路径：** `/charitable`（底部 Tab 切换：密钥 / 提供商 / 渠道）

词元中心是公益路由系统的统一管理入口，将原本分散的「密钥管理」「提供商管理」「渠道管理」三个页面合并为一个带底部标签切换的单页面应用。

## 核心功能与服务

### 1. 密钥管理（Keys 标签）

- **从认证文件同步**：将 CPA `/auth-files` 中的认证文件完整镜像到 `cpa_auth_detail`。
  - 写入完整 `auth_value`，`auth_info.file_name` 必填，`source=auth_file_sync`。
  - 状态映射：`disabled=false -> status=1`，`disabled=true -> status=0`。
  - 按规范化 `base_url` 匹配提供商，多条命中时取 `update_at` 最新，其次更大 `provider_id`。
  - 匹配不到且能解析 `base_url` 时自动创建提供商；同 base_url 仅创建一次（同步并发用锁去重，导入复用内存列表）。
  - 凭证带显式 `base_url` 时只按 URL 精确匹配，绝不回落到同类型名称（例如 `cli-chat-proxy.grok.com` 不会绑到 `api.x.ai`）；未命中则新建，名称带 host 提示。
  - 同步按文件独立处理：单条 4xx/5xx 记失败并继续，不整批中断；提供商创建失败不阻断密钥写入（可无 provider_id 入库），失败明细展示后端错误码。
  - 大批量默认同串行写入（concurrency=1），SQLite 单连接 + busy 重试，降低 `database is locked` 导致的 500；失败明细区分硬失败与“已导入未绑提供商”警告。
  - 无显式 `base_url` 时才用类型名称/别名匹配默认提供商。
  - 同步为手动触发，带进度条；不删除中心多余记录，不联动删除 CPA。
  - 去重：优先 `auth_index`；缺失时按 `auth_info.file_name` 回查已有中心记录并复用其 `auth_index`，避免 token 刷新后重复建行。
  - 已有中心 `param` / `probe_policy` / `remark` 默认保留。
- **同步请求配置到认证文件**：将中心侧提供商/密钥的请求参数字段级写回 CPA `/auth-files`。
  - 入口命名：
    - “从 CPA 导入认证文件”：认证文件 → `cpa_auth_detail`
    - “同步请求配置到认证文件”：提供商/密钥参数 → 认证文件
    - “保存并同步请求配置”：编辑单个认证文件账号时使用
  - 已有文件：调用 `authFilesApi.patchFields()`，只更新 `headers` / `proxy_url` / `prefix` / `priority`；`disabled` 单独走 `setStatus()`。
  - 不存在的文件：才允许用完整 JSON（`saveJsonObject`）创建；创建底稿可来自 `auth_value`，但后续同步不再用旧 `auth_value` 覆盖 Token。
  - Header 合并优先级：**认证文件原始 Header → 提供商 Header → 密钥 Header**。
  - 管理中心写入的 Header 记录在 `auth_info.managed_header_keys`；下次同步时删除“上次由中心写入、现已从配置移除”的 Header，并保留文件原本自带的 Header。
  - 同步元数据（非敏感）：`managed_header_keys`、`last_pushed_at`、`source_modtime`（兼容旧字段 `source_modified`）。
  - 提供商保存成功后**不会静默自动同步**，而是提示关联认证文件数量，用户可选择“稍后同步”或“同步请求配置”，确认后再批量字段级更新并展示影响账号 / 请求头变更 / 失败明细。

- **账号/认证文件导入**：通过「导入」粘贴或上传 Codex/Xai 等认证 JSON，写入 `cpa_auth_detail`。
  - 完整 `auth_value` + `auth_info.file_name`；默认不自动推送到 CPA。
  - 同名 `file_name` 走 upsert 覆盖更新，复用已有 `auth_index`，并保留中心 `param` / `probe_policy` / `remark`。
- **批量探测抽屉**：工具栏「探测全部筛选结果」与多选「批量探测」打开配置弹窗，可设并发度与策略，并滚动显示账号探测进度。
- **密钥 CRUD**：新增、编辑、删除密钥条目。
- **密钥字段**：API Key、协议类型（OpenAI / Anthropic / Gemini / Responses 多选）、状态、优先级、关联提供商、内容备注、自定义参数（JSON）。
- **批量操作**：批量启用 / 禁用 / 删除选中密钥。
- **密钥显示切换**：明文 / 脱敏切换（Eye 图标按钮）。
- **全参查看**：查看密钥的完整合并参数（继承渠道 → 提供商 → 本地）。
- **悬停预览**：鼠标悬停行时弹出 Merged Param 浮层，展示合并后的完整参数 JSON，支持一键复制和推送到 CPA。
- **发送到 CPA**：将当前密钥作为新提供商条目推送到 CPA 的 OpenAI Provider 列表。

### 2. 提供商管理（Providers 标签）

- **提供商列表**：展示提供商 ID、名称、Base URL、协议、状态、优先级、创建时间。
- **提供商编辑**：点击编辑弹出 Sheet 抽屉，配置 API Key、协议类型、状态、优先级、Provider ID、内容、备注和参数。
- **参数编辑器**：可视化的键值对编辑器，支持嵌套结构。
- **探测（Probe）功能**：
  - 每行提供「探测」按钮（CheckCircle 图标）。
  - 探测抽屉中可配置 **Proxy URL**。
  - **测试密钥可用性**：向提供商发送最小化聊天请求，展示 HTTP 状态码。
  - **拉取模型**：调用 `/v1/models` 获取可用模型列表。
  - **模型发现面板**：勾选需要加入配置的模型，支持搜索和全选。
  - **模型详细配置**：模型别名（alias）、Vision（图片输入）支持、Thinking JSON 配置。
  - **自动测试模型**：应用选中的模型后自动逐个发送测试请求，显示各模型的状态码徽章。
  - **保存到提供商**：将 Proxy URL 和模型配置写入提供商的 `param` JSON，该提供商下的所有密钥共享这些配置。

### 3. 渠道管理（Channels 标签）

- **渠道列表**：展示渠道 ID、名称、状态、URL、创建/更新时间。
- **渠道 CRUD**：新增、编辑、删除渠道。
- **渠道参数**：可视化参数编辑器，配置渠道级继承参数。

## 界面交互与 UI 元素

- **底部 Tab 栏**：三个标签按钮（密钥 / 提供商 / 渠道），当前激活标签高亮显示。
- **内容面板**：根据选中标签切换对应子页面内容，共享同一页面容器。
- **表格**：统一表格组件，支持选择框、分页、状态徽章。
- **Sheet 抽屉**：从右侧滑出的编辑表单，带保存/取消底部操作栏。
- **Modal 弹窗**：删除确认、全参查看、重复密钥处理等场景。
- **Tooltip 浮层**：悬停行时显示合并参数详情（Portal 渲染，跟随鼠标）。

## 相关文档

- [统一凭证字段设计](../../sqlite/cpa_auth_detail.md)
- [提供商字段设计](../../sqlite/cpa_provider_info.md)
- [凭证高可用与 CPA 同步架构](../../architecture/async-probe-key-operations.md)
- [最新功能](../../milestones/features.md)
- [最新修复](../../milestones/fixes.md)
- [开发实现日志](../../development/implementation-log.md)
