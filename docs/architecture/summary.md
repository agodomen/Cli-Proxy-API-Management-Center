# CLI Proxy API Management Center — 项目概览

> 本文档供 AI Agent 快速了解项目上下文，最后更新：2026-05-27

## 1. 项目定位

CLI Proxy API Management Center 是一个 **纯前端单页应用（SPA）**，为 [CLI Proxy API](https://github.com/router-for-me/CLIProxyAPI) 提供可视化管理后台。它通过 CLI Proxy API 的 Management API（`/v0/management`）完成配置管理、凭据上传、日志查看、OAuth 授权等运维操作。

- **它不是代理本身**，不转发任何业务流量。
- 自 v6.0.19 起，Web UI 随主程序分发，可通过 `http://<host>:<api_port>/management.html` 访问。
- 构建产物为 **单个内联 HTML 文件**（`dist/index.html`），所有 JS/CSS/图片资源均内联。

## 2. 技术栈

| 层面 | 技术选型 | 版本 |
|------|---------|------|
| UI 框架 | React | 19.x |
| 语言 | TypeScript | 6.0 |
| 构建工具 | Vite（vite-plugin-singlefile） | 8.x |
| 包管理器 | Bun | 1.3.14 |
| 状态管理 | Zustand | 5.x |
| HTTP 客户端 | Axios | 1.15.2 |
| 路由 | react-router-dom (HashRouter) | 7.x |
| 动画 | Motion (原 Framer Motion) | 12.x |
| YAML 编辑器 | CodeMirror 6 (@uiw/react-codemirror) | 4.x |
| 样式方案 | SCSS Modules | - |
| 国际化 | i18next + react-i18next | 26.x / 17.x |
| YAML 解析 | yaml | 2.x |
| Lint | ESLint + typescript-eslint | 9.x |
| 格式化 | Prettier | 3.x |

## 3. 目录结构

```
Cli-Proxy-API-Management-Center/
├── .github/                  # CI/CD workflows (release.yml)
├── doc.local/                # 本地文档（本文档所在目录）
├── src/
│   ├── assets/               # 静态资源（logo、SVG 图标）
│   ├── components/
│   │   ├── common/           # 通用组件（通知、确认弹窗、启动屏、页面过渡）
│   │   ├── config/           # 配置编辑器组件（可视化编辑、源码编辑、Diff 预览）
│   │   ├── layout/           # 布局组件（MainLayout）
│   │   ├── modelAlias/       # 模型别名映射图组件
│   │   ├── providers/        # AI Provider 状态栏、工具函数
│   │   ├── quota/            # 配额管理组件
│   │   └── ui/               # 基础 UI 组件（Button, Card, Modal, Input, Select, Table 等）
│   ├── features/
│   │   ├── authFiles/        # Auth Files 功能模块（组件、hooks、状态）
│   │   └── providers/        # AI Providers 功能模块（Workbench 页面、适配器、表单）
│   ├── hooks/                # 全局自定义 hooks（useInterval, useLocalStorage, useMediaQuery 等）
│   ├── i18n/                 # 国际化配置与语言文件（en, zh-CN, zh-TW, ru）
│   ├── pages/                # 页面组件
│   ├── router/               # 路由定义（MainRoutes, ProtectedRoute）
│   ├── services/
│   │   ├── api/              # API 服务层（基于 Axios 的各模块 API 封装）
│   │   └── storage/          # 安全存储（secureStorage，密钥混淆）
│   ├── stores/               # Zustand 状态管理 stores
│   ├── styles/               # 全局样式（变量、主题、mixins、reset）
│   ├── types/                # TypeScript 类型定义
│   └── utils/                # 工具函数
├── index.html                # Vite 入口 HTML
├── package.json
├── tsconfig.json / tsconfig.app.json
├── vite.config.ts            # Vite 配置（未列出但隐含）
├── eslint.config.js
└── .prettierrc
```

## 4. 核心功能模块

### 4.1 Dashboard（仪表盘）
- 路由：`/` 或 `/dashboard`
- 展示连接状态、服务器版本/构建日期、快速统计、模型可用性快照

### 4.2 Config（配置管理）
- 路由：`/config`
- 可视化编辑器：`frontend/src/components/config/VisualConfigEditor.tsx`
- 源码编辑器：`frontend/src/components/config/ConfigSourceEditor.tsx`（CodeMirror 6 YAML 高亮）
- Diff 预览：`frontend/src/components/config/DiffModal.tsx`
- 支持的配置段：`debug`, `proxy-url`, `request-retry`, `quota-exceeded`, `request-log`, `logging-to-file`, `api-keys`, `ampcode`, `gemini-api-key`, `codex-api-key`, `claude-api-key`, `vertex-api-key`, `openai-compatibility`, `oauth-excluded-models` 等

### 4.3 AI Providers（AI 提供商管理）
- 路由：`/ai-providers`
- 功能模块：`frontend/src/features/providers/`
- 支持的提供商类型：
  - **Gemini** — API Key 配置
  - **Codex** — API Key 配置
  - **Claude** — API Key 配置
  - **Vertex** — API Key + 项目配置
  - **OpenAI 兼容提供商** — 多 API Key、自定义 Headers、模型别名、连通性测试
  - **Ampcode** — 上游 URL/Key、模型映射
- 适配器模式：`frontend/src/features/providers/adapters.ts` + `descriptors.ts`
- 表单组件：`frontend/src/features/providers/sheets/forms/`

### 4.4 Auth Files（认证文件管理）
- 路由：`/auth-files`, `/auth-files/oauth-excluded`, `/auth-files/oauth-model-alias`
- 功能模块：`frontend/src/features/authFiles/`
- 支持：上传/下载/删除 JSON 凭据文件、批量操作、过滤/搜索/分页、运行时状态标识、查看每个凭据支持的模型、OAuth 排除模型管理（支持 `*` 通配符）、OAuth 模型别名映射

### 4.5 OAuth（OAuth 授权管理）
- 路由：`/oauth`
- 支持的 OAuth 流程：
  - **Codex** — 设备码流程
  - **Anthropic/Claude** — 设备码流程
  - **Antigravity** — 设备码流程
  - **Gemini CLI** — 设备码流程
  - **Kimi** — 设备码流程
  - **xAI/Grok** — 设备码流程
- 功能：启动授权、轮询状态、提交回调 URL、导入 Vertex JSON 凭据、导入 iFlow cookies

### 4.6 Quota（配额管理）
- 路由：`/quota`
- 组件：`frontend/src/components/quota/`
- 管理 Claude、Antigravity、Codex、Gemini CLI 等提供商的配额限制和使用情况

### 4.7 Logs（日志查看）
- 路由：`/logs`
- 功能：增量轮询实时日志、自动刷新、搜索过滤、隐藏管理流量、清除日志、下载请求错误日志文件

### 4.8 System（系统管理）
- 路由：`/system`
- 功能：快速链接、版本更新检查、请求日志开关、本地登录数据清理、获取 `/v1/models`（分组视图）

## 5. 状态管理（Zustand Stores）

| Store | 文件 | 职责 |
|-------|------|------|
| `useAuthStore` | `frontend/src/stores/useAuthStore.ts` | 认证状态（登录/登出、会话恢复、连接状态、API Base/Key 管理） |
| `useConfigStore` | `frontend/src/stores/useConfigStore.ts` | 配置数据（获取/更新/缓存配置，支持分段获取） |
| `useModelsStore` | `frontend/src/stores/useModelsStore.ts` | 模型列表数据 |
| `useQuotaStore` | `frontend/src/stores/useQuotaStore.ts` | 配额数据 |
| `useThemeStore` | `frontend/src/stores/useThemeStore.ts` | 主题（亮/暗模式） |
| `useLanguageStore` | `frontend/src/stores/useLanguageStore.ts` | 语言偏好 |
| `useNotificationStore` | `frontend/src/stores/useNotificationStore.ts` | 全局通知消息 |

## 6. API 服务层

基于 Axios 封装的 `ApiClient`（`frontend/src/services/api/client.ts`） 类，统一管理 API Base URL、Management Key 注入、错误处理、版本信息提取。

| 模块 | 文件 | 主要 API |
|------|------|----------|
| 配置 | `frontend/src/services/api/config.ts` | 获取/更新配置、Debug/代理/重试/日志等开关 |
| Providers | `frontend/src/services/api/providers.ts` | Gemini/Codex/Claude/Vertex/OpenAI/Ampcode 提供商 CRUD |
| Auth Files | `frontend/src/services/api/authFiles.ts` | 认证文件上传/下载/删除、OAuth 排除模型、OAuth 模型别名 |
| OAuth | `frontend/src/services/api/oauth.ts` | OAuth 授权 URL 获取、状态轮询、回调提交 |
| Logs | `frontend/src/services/api/logs.ts` | 日志获取/清除、错误日志下载 |
| Models | `frontend/src/services/api/models.ts` | 模型列表获取 |
| Version | `frontend/src/services/api/version.ts` | 版本检查 |
| API Keys | `frontend/src/services/api/apiKeys.ts` | API Key 管理 |
| API Key Usage | `frontend/src/services/api/apiKeyUsage.ts` | API Key 使用统计 |
| Config File | `frontend/src/services/api/configFile.ts` | 配置文件操作 |
| Transformers | `frontend/src/services/api/transformers.ts` | 响应数据标准化/规范化 |
| Vertex | `frontend/src/services/api/vertex.ts` | Vertex 凭据导入 |
| Ampcode | `frontend/src/services/api/ampcode.ts` | Ampcode 相关 API |

## 7. 路由结构

使用 `react-router-dom` v7 的 **HashRouter**：

| 路径 | 页面 | 说明 |
|------|------|------|
| `/login` | LoginPage | 登录页（无需认证） |
| `/` `/dashboard` | DashboardPage | 仪表盘 |
| `/config` | ConfigPage | 配置管理 |
| `/ai-providers` | ProvidersWorkbenchPage | AI 提供商管理 |
| `/auth-files` | AuthFilesPage | 认证文件管理 |
| `/auth-files/oauth-excluded` | AuthFilesOAuthExcludedEditPage | OAuth 排除模型编辑 |
| `/auth-files/oauth-model-alias` | AuthFilesOAuthModelAliasEditPage | OAuth 模型别名编辑 |
| `/oauth` | OAuthPage | OAuth 授权管理 |
| `/quota` | QuotaPage | 配额管理 |
| `/logs` | LogsPage | 日志查看 |
| `/system` | SystemPage | 系统管理 |

所有非 `/login` 路由均受 `frontend/src/router/ProtectedRoute.tsx` 保护，需要先完成认证。

## 8. 国际化

支持 4 种语言，通过 `frontend/src/i18n/index.ts` 配置：
- 简体中文 (`zh-CN`) — 默认回退语言
- 繁体中文 (`zh-TW`)
- 英文 (`en`)
- 俄语 (`ru`)

语言文件位于 `frontend/src/i18n/locales/` 目录。

## 9. 样式方案

- 全局样式：`frontend/src/styles/`（变量 `_variables.scss`、主题 `_themes.scss`、mixins、reset）
- 组件样式：使用 **SCSS Modules**（`*.module.scss`）实现样式隔离
- 支持亮/暗主题切换

## 10. 安全设计

- Management Key 存储在浏览器 `localStorage` 中，使用轻量混淆格式（`enc::v1::...`），避免明文存储
- 凭据存储服务：`frontend/src/services/storage/secureStorage.ts`
- 认证通过 `Authorization: Bearer <MANAGEMENT_KEY>` 请求头传递

## 11. 构建与发布

```bash
bun install --frozen-lockfile   # 安装依赖
bun run dev                     # 开发服务器 (localhost:5173)
bun run build                   # tsc + Vite 构建 → dist/index.html（单文件）
bun run preview                 # 本地预览构建产物
bun run lint                    # ESLint 检查
bun run format                  # Prettier 格式化
bun run type-check              # TypeScript 类型检查
```

- 构建输出：`dist/index.html`（所有资源内联）
- CI/CD：GitHub Actions（`.github/workflows/release.yml`），tag `vX.Y.Z` 触发发布

## 12. 关键约定

- **路由**使用 Hash 模式（`createHashRouter`），便于单文件部署
- **API 响应标准化**：`frontend/src/services/api/transformers.ts` 处理后端返回的多种字段命名风格（kebab-case/camelCase/snake_case）
- **配置分段缓存**：`useConfigStore` 支持按配置段独立缓存和过期控制
- **组件导出**：各模块通常有 `index.ts` 统一导出
