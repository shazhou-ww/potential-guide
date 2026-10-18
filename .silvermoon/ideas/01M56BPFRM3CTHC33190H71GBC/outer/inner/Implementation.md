# Implementation

## Steps

### I-S01: 核对 AHP 接入与能力边界

核对官方规范、协议版本及 Host 所需能力，确定客户端连接、认证、会话与权限模型；明确 AHP 与现有 ACP 适配的差异。VS Code 仅作为首个真实验证实现，通用接口不依赖产品名。

复用官方 TypeScript SDK 1.0.0，显式协商其声明支持的 wire 1.0.0 / 0.9.0；仅接入明确配置的 WebSocket 地址。传输 query-token 与 AHP protected-resource 认证分离。固定来源、真实入口前提和不支持的能力见 [AHP-Evidence.md](./AHP-Evidence.md)。

### I-S02: 接通配置与执行恢复链路

复用既有 Agent 接入边界，将 AHP 配置、完整观察上下文、执行结果、取消与会话恢复接入 Regulator 及其 CLI 调用链。同步配置校验、配置编辑器和恢复记录，保持 ACP 写法兼容；配置按协议、传输、认证及 Host 内 Agent 标识分工，不新增产品专属语法。

以顶层 `type` 建立规范化的 ACP/AHP union；仅合法旧 ACP profile 可移除 `connection.type` 后读取。配置编辑、诊断、regulate/continue、共享进程 worker 与 planner 均按协议分派。AHP 先验证 Host 目录与 provider，再保存 Host 确认的 session/default-chat/turn 身份；恢复固定原配方，拒绝活动执行、身份缺失、目录变化和不确定重放。Regulator 核心保持协议无关。

集成 primary 并发新增的当前权限 ceiling/grants、恢复重载及监督事件链路；标准 AHP 没有可靠 operation/allow-once 语义时，发送官方 deny 并产生 `unknown` 授权请求，不猜测工具名或输入。保留替代执行机会，以新观察证明的进展优先，否则输出 `authorization-required`。

### I-S03: 补齐协议验证与使用说明

增加 AHP 协议交互和失败路径测试，覆盖共享调用链的 ACP 回归，并更新配置、恢复与支持范围文档。

使用实际 WebSocket JSON-RPC 测试 Host 和 CLI 合成目标证明自动闭环；覆盖逐字节上限、握手/初始化取消、权限阻塞、失联、重复通知、身份保存与恢复。自动替身不作为真实 Host 或 Outer World 证据。已有 ACP-only setup Pilot 兼容规范化配置，并明确拒绝 AHP 就绪验证，不扩大它的职责。

## Acceptance criteria

### I-AC01: AHP 闭环可验证

自动测试证明 AHP Agent 收到完整修复上下文，执行结果映射正确，完成后必须重新观察而非直接相信 Agent 自报成功。

证明入口：`packages/pguide/test/ahp-cli.test.ts`；同时验证共享 planner 和进程 worker 的协议选择。

### I-AC02: 生命周期与故障明确

自动测试证明真实协议会话标识被保存和用于恢复，超时与取消传递到受控执行；断线、恢复失败、认证或能力不足明确报错，不静默降级。

证明入口：`packages/pguide-cli-core/test/ahp.test.ts`，以及 CLI 恢复记录与 transcript。Host 取消确认和本地等待结束分别记录；清理只关闭自有连接。

### I-AC03: ACP 兼容且检查通过

既有 ACP 配置与执行恢复回归测试通过；ACP/AHP 共存配置可解析、编辑保存并选择正确执行链路，测试证明不依赖 Host 产品名。AHP 配置示例与限制说明完整；执行相关测试及仓库要求的 pnpm check 并保留结果。

固定来源、命令结果、支持范围和真实 Host 尚待验证项集中保存在 [AHP-Evidence.md](./AHP-Evidence.md)；Deployment 契约、Outer World 证据和所有生命周期交接由父会话负责。
