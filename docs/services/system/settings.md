# 系统设置

**管理路径：** `/system/config`

系统设置页面用于管理 usage-service 连接配置、请求监控参数、异步探测策略和系统级运行参数，是全局运维配置的核心入口。

## 核心功能与服务

1. **Usage Service 引导同步**：
   - 检测并应用 usage-service 的 Base URL 变更。
   - 引导式配置流程，确保面板与后端服务正常连接。

2. **管理器采集器配置（Manager Collector）**：
   - 队列设置：批量大小、刷新间隔。
   - 轮询间隔（Polling Interval）配置。
   - TLS 选项。

3. **探测配置管理**：
   - 配置异步探测的行为参数。
   - 支持从 localStorage 保存/加载探测配置。
   - 探测提示词（Probe Prompt）配置。

4. **数据清理面板**：
   - 选择性清理历史记录：日志、用量事件、缓存条目。
   - 分类复选框选择清理范围。
   - 预演（dry-run）模式预览待清理数据量。

5. **YAML 源码编辑**：
   - CodeMirror 源码编辑器（懒加载）。
   - 编辑后与服务器配置进行差异对比（DiffModal）。

## 界面交互与 UI 元素

- **Tab 页面**：Visual Config / Source / Manager / Cleanup
- **VisualConfigEditor**：结构化的配置表单，字段带描述说明。
- **DiffModal**：变更对比弹窗，展示本地修改 vs 服务器状态。
- **DataCleanupPanel**：分类复选框 + 预演按钮 + 确认执行。
- **保存/取消操作栏**：dirty 状态指示 + 未保存离开提醒。

## 相关文档

- [系统设置表](../../sqlite/settings.md)
- [异步探测与密钥运营](../../architecture/async-probe-key-operations.md)
