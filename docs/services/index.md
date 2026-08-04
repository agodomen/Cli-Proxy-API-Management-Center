# 功能服务

本栏目与当前管理中心的具体菜单保持一致，按导航分组展示所有功能入口的详细说明。每个页面包含管理路径、核心功能、操作方式和界面交互元素，帮助用户快速理解每个菜单能做什么。

## 菜单分组

### 运行运维
- [运行总览](./operate/dashboard)：管理中心首页仪表盘，连接状态与运行指标总览。

### 网关管理
- [AI 提供商](./gateway/ai-providers)：统一配置 Gemini、Codex、Claude、Vertex、OpenAI 兼容服务等上游提供商。
- [认证文件](./gateway/auth-files)：管理 OAuth 授权凭证，支持模型绑定、前缀代理和批量操作。
- [OAuth 登录](./gateway/oauth)：发起各 AI 提供商的 OAuth 2.0 授权流程，生成账号凭证。

### 观测监控
- [配额管理](./observe/quota)：按提供商和账号查看配额窗口与用量状态。
- [日志查看](./observe/logs)：实时日志流，高级过滤与错误追踪。

### 配置控制
- [配置面板](./control/config)：双模式 YAML 编辑，可视化与源码切换。
- [插件管理](./control/plugins)：安装插件的启停与配置。
- [插件商店](./control/plugin-store)：浏览和安装可用插件。
- [中心信息](./control/system)：版本信息、模型可用性、缓存管理。

### 运营监控（CPA 扩展）
- [请求监控](./operations/monitoring)：用量仪表盘，费用与成功率分析。
- [实时监控](./operations/realtime-request)：SSE 实时请求流，快速发现接入异常。
- [巡检管理](./operations/inspection)：Codex 账号自动化巡检与建议操作。
- [密钥管理](./operations/service-providers)：CPA 提供商密钥管理，测试与同步。

### 公益路由
- [词元中心](./charitable/token-center)：Keys / Providers / Channels 合并统一管理，支持探测和自动测试。
- [代理管理](./charitable/proxies)：代理服务器管理，连通性测试与 Clash 脚本导出。
- [调试开发](./charitable/debug)：SQL 调试 / API 调试 / 密钥调试三合一工作台。

### 系统设置
- [系统设置](./system/settings)：usage-service 连接、采集器、探测策略与数据清理。

菜单事实来源为 `src/components/layout/MainLayout.tsx` 与 `src/external/externalNav.ts`。
