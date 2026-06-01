# 背景现状

工具猿（amonkey-tools）用于沉淀个人工具项目的功能说明、架构设计、数据模型与开发过程。当前站点首先收录 CLI Proxy API Management Center 及其 CPA 扩展服务相关文档。

## 项目定位

- 面向 CLI Proxy API 的可视化管理与运维。
- 通过独立的 External 前端模块降低对社区代码的侵入。
- 通过 Go usage-service 提供事件采集、SQLite 存储和异步探测能力。
- 通过凭证策略、优先级和状态管理实现 CPA 账号灵活上下线。

## 当前能力

- [项目概览](../architecture/summary.md)
- [词元中心功能说明](../services/charitable/token-center.md)
- [凭证高可用与异步探测](../architecture/async-probe-key-operations.md)
- [实施计划](../architecture/plan.md)

## 阅读建议

首次了解项目可依次阅读背景现状、功能服务、架构设计和数据模型；需要追踪变化时，可查看里程碑与开发记录。
