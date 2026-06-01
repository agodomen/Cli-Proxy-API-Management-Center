# 认证文件

**管理路径：** `/auth-files`

认证文件是 CPA 网关中管理账号凭证的核心页面。这里统一展示所有通过 OAuth 授权、手动上传或 Vertex 导入的认证文件，支持状态管理、模型绑定、前缀代理和批量运维操作。

## 核心功能与服务

1. **凭证列表与筛选**：
   - 按提供商类型（Codex、Claude、Antigravity、Kimi、xAI 等）筛选。
   - 支持"仅问题"、"仅已禁用"过滤，以及通配符搜索。
   - 视图模式切换：列表视图 / 图示视图，以及紧凑模式。

2. **凭证卡片操作**：
   - 查看凭证详情（提供商、状态、优先级、关联模型）。
   - 启用 / 禁用单个凭证。
   - 调整优先级。
   - 删除凭证。
   - 查看关联模型列表。

3. **模型别名管理**：
   - 为 OAuth 凭证配置模型别名映射（`AuthFilesOAuthModelAliasEditPage`）。
   - 配置 OAuth 排除规则（`AuthFilesOAuthExcludedEditPage`），指定哪些模型不参与路由。

4. **前缀代理编辑**：
   - 通过 `AuthFilesPrefixProxyEditorModal` 配置前缀代理路由规则，实现按前缀将请求导向不同上游。

5. **批量操作**：
   - 批量启用 / 禁用。
   - 批量删除。
   - 导出选中凭证。

6. **分页与加载**：
   - 支持自定义分页大小。
   - 空状态提示（无数据 / 无匹配结果）。

## 界面交互与 UI 元素

- **过滤工具栏**：搜索框 + 提供商类型下拉 + 问题/禁用开关 + 视图模式切换。
- **凭证卡片（AuthFileCard）**：状态指示灯、操作按钮组、模型计数。
- **弹窗/抽屉**：
  - 模型列表弹窗（`AuthFileModelsModal`）
  - OAuth 排除规则卡片（`OAuthExcludedCard`）
  - 前缀代理编辑器（`AuthFilesPrefixProxyEditorModal`）
- **分页控件**：页码切换 + 每页条数选择。

## 相关文档

- [统一认证字段设计](../../sqlite/cpa_auth_detail.md)
- [凭证高可用与 CPA 同步架构](../../architecture/async-probe-key-operations.md)
