# 巡检管理支持 API_KEY 提供商方案

**状态：** Phase 1–3 完成（openai-compat 为 provider 级禁用，key 数 < 2）  
**页面：** `/monitor/inspection`  
**日期：** 2026-07-23  
**相关代码：**

- `src/external/pages/CodexInspectionPage.tsx`
- `src/external/features/monitoring/codexInspection.ts`
- `services/internal/watcher/synthesizer/config.go`（API Key 凭证合成）
- `services/internal/api/handlers/management/api_tools.go`（`/api-call` + `$TOKEN$`）

---

## 1. 背景与目标

当前巡检页主要面向 **OAuth 认证文件**（codex / claude / xai / kimi 等），从 `GET /auth-files` 取文件型凭证，走用量/账单/chat 健康探测，并支持 delete / disable / enable。

API_KEY 提供商是另一套凭证：

- 由 config 合成（`ConfigSynthesizer`）
- 多为 `runtime_only=true`
- 凭证在 `attributes.api_key` + `base_url`
- Provider 形如 `openai-compatible-*`、`codex-apikey`、`claude-apikey`、`gemini` API key 等

**目标：**

1. 在同一巡检页支持 API_KEY 账号池的统计与连通性巡检
2. 探测结果可解释（HTTP 状态 + 非 200 响应体）
3. 动作安全：不误删 config key
4. 与 OAuth 巡检并存，可中断后按文档恢复实现

---

## 2. 现状差异

| 维度 | OAuth 认证文件 | API_KEY 提供商 |
|------|----------------|----------------|
| 数据来源 | auth-files 文件型 | 同列表 runtime_only / config 合成 |
| 标识 | `fileName` + `auth_index` | `id` / `auth_index`，可能无真实文件 |
| 凭证 | access_token / refresh | `attributes.api_key` + `base_url` |
| Provider | codex / claude / xai … | `openai-compatible-xxx`、`*-apikey` … |
| 探测语义 | 用量/账单/chat | 连通性：`/models` 或最小 chat |
| 删除 | 可删 auth 文件 | **禁止**当作文件删除 |
| disable | `PATCH /auth-files/status` | 优先 runtime status；持久化写 config 为后续阶段 |

`POST /v0/management/api-call` 已支持 `auth_index` + `$TOKEN$`，token 解析：metadata token → `attributes.api_key`。探测链路可复用。

---

## 3. 总体设计：账号源 × 目标类型

### 3.1 账号源（Account Source）

```text
账号源: [ oauth ]  [ api_key ]
认证类型: 随账号源变化
```

- `oauth`：保持现有逻辑
- `api_key`：只扫描 API Key / runtime 凭证

### 3.2 API Key 类型（Family）

第一期粗类（Family）：

| Family | 匹配规则（示意） |
|--------|------------------|
| `openai-compat` | `provider` 以 `openai-compatible` 开头 |
| `gemini-apikey` | gemini / aistudio 且 runtime_only 或 apikey 形态 |
| `claude-apikey` | claude 且非 OAuth oat token / runtime apikey |
| `codex-apikey` | provider=codex 且 label/source 为 apikey 或 runtime_only |
| `vertex-apikey` | vertex runtime/apikey |

第一期实现优先：

1. **openai-compat**（主）
2. 其他 family 可枚举进池，探测走通用 openai-compat 风格 `/models`，后续再特化

### 3.3 账号枚举

从 `authFilesApi.list()` 全量后过滤：

```ts
isApiKeyInspectionAccount(file) =
  runtime_only === true
  || provider.startsWith('openai-compatible')
  || provider includes 'apikey' / 已知 apikey provider
  || auth_kind === 'api_key'（若暴露）
```

规则：

- 优先 `runtime_only` 判断，避免与 OAuth 文件冲突
- `auth_index` 为空 → 跳过 + warning
- 展示名：`label` / `compat_name` / `provider` + 脱敏，不展示完整 key

---

## 4. 探测协议

### 4.1 统一走 api-call

```ts
apiCallApi.request({
  authIndex,
  method,
  url,
  header: { Authorization: 'Bearer $TOKEN$', ...headers },
  data?: string
})
```

### 4.2 各 Family 探测（Phase 1）

| Family | 首选 | 备选 |
|--------|------|------|
| openai-compat | `GET {base_url}/models` 或规范化 `/v1/models` | `POST chat/completions` 最小请求 |
| 其他 apikey（过渡） | 同上（若有 base_url） | 无 base_url 则 keep + 原因 |

URL 规范化：

- 有 `base_url`：去尾 `/`，若已以 `/v1` 结尾则补 `/models`，否则补 `/v1/models`（可配置）
- 无 `base_url`：跳过探测，action=`keep`，reason=`缺少 base_url`

### 4.3 提示词模式

现有 `probePromptMode`（fixed / math / random）仅对 **chat 探测** 生效。  
Phase 1 默认 `/models`，不强制 chat。

### 4.4 结果判定

| HTTP | 建议动作 | 说明 |
|------|----------|------|
| 2xx | keep；若 disabled 且策略允许 → enable | 可用 |
| 401/403 | disable（不 delete） | 密钥无效 |
| 402/429 | keep 或 disable（可配置，默认 keep） | 额度/限流 |
| 5xx / 0 超时 | disable 或 keep（默认 disable 可选，Phase1 用 disable 与 OAuth 非200对齐需谨慎：建议 timeout→disable，5xx→keep/disable 可配置） | 服务问题 |
| Phase1 默认简化 | 401/403 → disable；2xx → keep/enable；其它非200 → disable；timeout → disable | 与现有 OAuth 非200 体验接近但禁 delete |

### 4.5 日志

复用 `formatInspectionProbeBodyLog`：

- HTTP 200 不输出 body
- 非 200 / 超时输出截断 responsePreview

---

## 5. 动作执行（安全）

| 动作 | OAuth | API Key |
|------|-------|---------|
| disable/enable | `auth-files/status` | 尝试同一 status API；失败则记 failed |
| delete | 删文件 | **禁止**；自动策略不含 delete；手动删除按钮禁用或提示 |
| 手动更新 UA/proxy/priority | patch fields | Phase1 可不支持 runtime-only；或仅尝试 fields |

**自动动作模式（API Key 源）：**

- 仅暴露：`none` / `disable` / 后续 recover-enable
- 隐藏或禁用：`delete`、strategy4/5/6 中含删除语义的策略（Phase1：强制 auto 不执行 delete）

**风险备忘：**

- runtime status 可能仅内存态，config reload 后恢复  
- 持久禁用写回 config 列为 Phase 3

---

## 6. UI 改动清单

状态栏（开始巡检行）：

1. **账号源** Select 或 segmented：`OAuth` | `API Key`
2. **认证类型** Select：随源切换选项
3. **刷新统计**（已有）按当前源+类型重算
4. 统计胶囊：当前池 总数/启用/禁用

结果表：

- 可增加 `source` 展示（optional Phase1）
- API Key 行：手动删除禁用
- 显示名优先 label

设置弹窗：

- 保存 `accountSource` +（可选）`apiKeyFamily`
- API Key 源下 auto 模式选项收敛

---

## 7. 数据模型扩展

```ts
type InspectionAccountSource = 'oauth' | 'api_key';

type InspectionApiKeyFamily =
  | 'openai-compat'
  | 'gemini-apikey'
  | 'claude-apikey'
  | 'codex-apikey'
  | 'vertex-apikey'
  | 'all'; // Phase1 可用 all 表示当前源下全部

// Configurable settings 新增：
accountSource: InspectionAccountSource; // default 'oauth'
apiKeyFamily: InspectionApiKeyFamily;   // default 'all' 或 'openai-compat'
```

`CodexInspectionAccount` / ResultItem 可增加：

```ts
accountSource?: InspectionAccountSource;
baseUrl?: string;
```

---

## 8. 代码落点（实现顺序）

### Phase 1（本轮）

1. 文档（本文件）+ 更新 `doc/services/operations/inspection.md`
2. `codexInspection.ts`
   - settings：`accountSource` / `apiKeyFamily`
   - `isApiKeyInspectionAccount` / family 匹配
   - `probeApiKeyAccount`（models 探测）
   - session 枚举按 source 过滤
   - execute actions：api_key 禁止 delete
3. `CodexInspectionPage.tsx`
   - 源切换 UI
   - 类型下拉随源变化
   - 统计刷新兼容
   - 手动删除在 api_key 源禁用
4. i18n
5. 单测 / tsc

### Phase 2

- family 特化探测（claude/gemini/vertex）
- chat 备选 + probeModel 配置
- provider 实例级过滤

### Phase 3

- disable 写回 config 持久化
- 与服务商页连通性测试共用 probe builder

---

## 9. 验收标准（Phase 1）

1. 可切换到 API Key 源，看到 runtime 账号数量统计
2. 开始巡检后对 openai-compat 账号发起 `/models` 探测
3. 日志对非 200 显示响应摘要；200 不显示 body
4. 401/403 建议 disable；执行 disable 不删除任何文件
5. API Key 源下无法批量/自动 delete
6. 切换回 OAuth 源行为与改前一致
7. 设置刷新后 localStorage 恢复 accountSource

---

## 10. 中断恢复检查清单

若任务中断，从下列步骤继续：

- [x] 文档是否已提交到 `doc/development/inspection-api-key-plan.md`
- [x] settings 是否已含 `accountSource`（targetType 在 api_key 源下承载 family）
- [x] 枚举过滤是否只在 api_key 源命中 runtime 凭证
- [x] `probeApiKeyAccount` 是否存在并在 switch 中调用
- [x] execute 路径是否拦截 api_key delete
- [x] 页面是否有源切换 UI
- [x] i18n 是否补齐
- [x] `tsc --noEmit` 是否通过

---

## 11. 非目标（Phase 1）

- 不改 Go 后端 config 持久禁用
- 不实现 API Key 的 auth 文件导入
- 不做跨 provider 聚合巡检
- 不在日志中输出 api_key 明文

---

## 12. Phase 2 落地记录

已实现：

1. **Family 特化探测**
   - `openai-compat` / `codex-apikey`：`GET /v1/models`，失败或 404/405 时 chat/completions 回退
   - `claude-apikey`：`POST /v1/messages`（`x-api-key: $TOKEN$`）
   - `gemini-apikey` / `vertex-apikey`：`GET /v1beta/models`，必要时 chat 回退

2. **probeModel 配置**
   - settings / localStorage：`probeModel`
   - 设置弹窗可填；空则 family 默认（gpt-4o-mini / claude-3-5-haiku-latest / gemini-2.0-flash）

3. **提示词模式**
   - chat 回退与 Claude messages 使用 `probePromptMode`（fixed/math/random）

4. **UI 安全**
   - API Key 源自动动作仅 `none` / `disable`
   - 手动删除仍禁用

### Phase 2 验收

- [x] claude/gemini/openai-compat 探测路径分支存在
- [x] chat 回退 + probeModel
- [x] 设置可配 probeModel
- [x] tsc 通过

### Phase 3 仍待做

- disable 写回 config 持久化
- 与服务商页连通性测试共用 probe builder
- provider 实例级细过滤（按 compat name）

---

## 13. Phase 3 落地记录

### 13.1 持久禁用（config 写回）

后端 `PATCH /auth-files/status` 对 config 合成 API Key 已有持久化路径：

- gemini / claude / codex / vertex apikey：写 `excluded-models: ["*"]`
- **本轮补齐** openai-compatibility：匹配 auth id 后写 provider 级 `disabled: true/false`，并 reload config

同时增强 status 查找：支持 `id` / `fileName` / `auth_index` / id basename，避免 runtime key 用 id 当 name 时 404。

前端 `executeStatusChange` 对同一账号按多个候选 name 依次尝试 `setStatus`。

### 13.2 Provider 实例过滤

settings 新增 `providerFilter`（localStorage）：

- 仅 API Key 源生效
- 对 provider / label / compatName / base_url / fileName 子串匹配
- 设置弹窗可编辑；状态栏在有过滤时展示

### 13.3 验收

- [x] openai-compat disable 可写回 config.Disabled
- [x] Go 单测 `TestToggleConfigAPIKeyExcludedAll_OpenAICompat` 通过
- [x] providerFilter 进入枚举与统计
- [x] tsc 通过

### 13.4 残留说明

- OpenAI-compat 为 **provider 级** 禁用；仅当该提供商 key 数 **< 2** 时允许巡检切换；多 key 拒绝（不扩展 per-key disabled）
- 列表对 runtime disabled 的隐藏行为依赖 config reload 后 synthesizer 不再生成该 auth
- 与服务商页连通性测试共用 probe builder 仍可后续抽取

---

## 14. openai-compat 禁用口径（provider 级，key 数 < 2）

### 原则

- **不扩展**社区模型 `OpenAICompatibilityAPIKey`（无 per-key `disabled` 字段）。
- openai-compat 禁用/启用只写 **provider 级** `OpenAICompatibility.Disabled`。
- **当且仅当**该提供商非空 API Key 数量 **< 2**（单 key 或 legacy 无 entries）时允许通过巡检/管理 API 切换。
- 多 key（≥2）提供商：返回错误，要求在服务商页管理，避免误伤同实例其他 key。

### 合成

- `synthesizeOpenAICompat` 仅尊重 `compat.Disabled`；整实例跳过。
- 不在 `api-key-entries` 上做 per-key skip。

### 持久化

`toggleConfigAPIKeyExcludedAll`：

- 匹配 auth id 到 provider / entry
- `keyCount >= 2` → error（handled=false）
- `keyCount < 2` 或 legacy 无 entries → `compat.Disabled = disable`

### 测试

- `TestToggleConfigAPIKeyExcludedAll_OpenAICompat_SingleKeyProviderLevel`
- `TestToggleConfigAPIKeyExcludedAll_OpenAICompat_MultiKeyRejected`
- `TestToggleConfigAPIKeyExcludedAll_OpenAICompatLegacyNoEntries`

### 未做

- 多 key 场景的细粒度禁用（需产品另定方案，不污染社区 API Key 模型）
- 与服务商连通性测试完整抽取共用模块


## 实时自动执行（Realtime auto-apply）

配置项 `realtimeAutoActions`（localStorage，随巡检设置持久化）：

| 字段 | 默认 | 说明 |
|------|------|------|
| `disable` | `true` | 探测出现禁用建议时立即禁用 |
| `enable` | `true` | 探测出现启用建议时立即启用 |
| `delete` | `false` | 探测出现删除建议时立即删除（API Key 源强制 false） |

依赖 `autoActionMode !== 'none'`：先按策略映射动作，再按勾选项过滤。运行中串行队列执行，结束时等待队列排空并跳过已成功实时处理的账号，避免重复执行。
