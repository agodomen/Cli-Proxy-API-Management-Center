# 巡检管理

**管理路径：** `/monitor/inspection`

巡检管理页面对 **OAuth 认证文件** 与 **API Key 提供商凭证** 执行可用性巡检，根据探测结果生成禁用/启用（OAuth 另可删除）建议，并支持按策略自动执行。

## 核心功能与服务

1. **巡检任务管理**：
   - 创建和管理巡检任务。
   - 选择账号源：OAuth 认证文件 / API Key 提供商。
   - 选择目标类型：随账号源变化（OAuth 为 codex/claude/xai 等；API Key 为 openai-compat 等 family）。
   - 配置并发 worker 数量、超时时间、重试次数。

2. **探测策略配置**：
   - 自定义 User-Agent（支持 Codex CLI / Claude CLI 预设）。
   - 自定义探测提示词（probe prompt）。
   - 自动操作模式：禁用 / 仅建议 / 自动执行（带确认）。
   - **实时自动执行**（多选）：实时禁用（默认开）、实时启用（默认开）、实时删除（默认关）。
     在自动策略非「什么都不做」时，巡检过程中一出现匹配建议即执行，使结果更快生效；结束时跳过已实时处理的账号。
     API Key 源禁止实时删除。

3. **实时进度追踪**：
   - 展示当前巡检进度（已检查 / 总计）。
   - 实时日志流式输出。
   - 结果摘要卡片：通过数、建议删除数、错误数。

4. **结果筛选与查看**：
   - 过滤条件：建议操作（全部 / 仅删除 / 仅禁用 / 仅启用）+ 按 HTTP 状态码分组（如 `HTTP 200`、`HTTP 401`，无状态码单独成组）。
   - 查看每个账号的探测详情和状态码。
   - 结果区操作：`手动删除` / `手动禁用` / `手动启用` 作用于当前筛选结果；`执行建议操作` 执行系统建议动作。
   - API Key 源下禁止删除（避免误删 config 密钥）；仅建议/执行禁用或启用。
   - 批量执行建议操作采用逐账号结算；单个账号删除、禁用或启用失败不会中断其他账号，失败记录会保留在结果和日志中并统一提示。

5. **设置持久化**：
   - 探测设置保存到 localStorage，刷新不丢失。
   - 一键恢复默认提示词。

## 界面交互与 UI 元素

- **设置面板**：可折叠区块，图标标题栏。
- **摘要卡片**：检查总数、建议操作数、错误数统计。
- **日志查看器**：级别过滤（info/warn/error）、一键复制。
- **操作按钮**：执行 / 暂停、清除结果；结果区提供手动删除/禁用/启用与执行建议操作。
- **确认弹窗**：批量手动操作和自动操作前的二次确认，提示将影响的记录数量。

## API Key 巡检（规划与实现）

- 账号源与 OAuth 并存，不共用 OAuth 用量探测接口。
- API Key 连通性探测：优先 `GET {base_url}/v1/models`；不可用时 chat 回退。Claude API Key 走 `/v1/messages`。经管理端 `/api-call` 注入 `$TOKEN$`。
- 可配置 API Key 探测模型（`probeModel`）、提示词模式，以及提供商关键字过滤（`providerFilter`）。
- API Key 禁用会尽量写回 config（gemini/claude/codex/vertex 用 excluded-models；openai-compat 仅 **provider 级** `disabled`，且仅当该提供商 API Key 数量 < 2 时允许；多 key 需在服务商页处理）。
- 详细设计、阶段划分与中断恢复清单见开发文档：
  - [巡检支持 API_KEY 方案](../../development/inspection-api-key-plan.md)

## 相关文档

- [异步探测与密钥运营](../../architecture/async-probe-key-operations.md)
- [探测结果](../../sqlite/probe_results.md)
- [探测动作日志](../../sqlite/probe_action_logs.md)
