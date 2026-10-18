# 让 Regulator 支持 AHP Agent

## 问题

现有 Regulator 的 Agent 接入依赖 ACP，无法直接利用 AHP Host 提供的 Agent 会话。需要新增协议接入选择，而不是将 AHP 当作 ACP 的另一个名称。

## 结果

用户可配置任一满足已声明协议版本与能力要求的 AHP Host 和 Agent 执行 Regulator 修复，并在同一观察、执行、再观察闭环中获得可恢复的会话与明确结果。

具体场景、行为约束与验证用例见[需求文档](./Requirements.md)。该文档细化本契约，不另行定义生命周期或验收入口。

## 边界

- 保留 ACP 行为与协议无关的 Regulator 核心；本次不把 Regulator 改造成 AHP 服务端。
- 以官方 [AHP 规范](https://microsoft.github.io/agent-host-protocol/)为准，配置和核心接口不绑定 Host 产品名；VS Code 是首个实测实现，不代表兼容所有 Host 或版本。
- 不扩展 portfolio 调度语义，不复制凭据、不绕过用户授权，不发布 npm。

## 验收标准

- 通过通用 AHP 配置驱动真实 Agent 会话接收完整修复上下文，并经重新观察确认目标状态；以 VS Code agent session 完成首个端到端实测。
- 超时、取消、断线、授权或能力不足明确可见；恢复使用真实会话身份，不静默新建替代会话。
- ACP 现有配置与闭环保持可用；提供 AHP 配置、支持边界和实测证据。
