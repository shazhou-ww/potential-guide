# 让 Regulator 支持 VS Code AHP Agent

## 问题

现有 Regulator 的 Agent 接入依赖 ACP，无法直接利用 VS Code Agent Host 提供的 AHP 会话。需要新增接入选择，而不是将 AHP 当作 ACP 的另一个名称。

## 结果

用户可配置 VS Code AHP Agent 执行 Regulator 修复，并在同一观察、执行、再观察闭环中获得可恢复的会话与明确结果。

## 边界

- 保留 ACP 行为与协议无关的 Regulator 核心；本次不把 Regulator 改造成 AHP 服务端。
- 以官方 [AHP 规范](https://microsoft.github.io/agent-host-protocol/)和实际 VS Code 版本为准，明确能力与认证前提，不宣称兼容所有版本。
- 不扩展 portfolio 调度语义，不复制凭据、不绕过用户授权，不发布 npm。

## 验收标准

- 真实 VS Code AHP 会话能接收完整修复上下文，执行后经重新观察确认目标状态。
- 超时、取消、断线、授权或能力不足明确可见；恢复使用真实会话身份，不静默新建替代会话。
- ACP 现有配置与闭环保持可用；提供 AHP 配置、支持边界和实测证据。
