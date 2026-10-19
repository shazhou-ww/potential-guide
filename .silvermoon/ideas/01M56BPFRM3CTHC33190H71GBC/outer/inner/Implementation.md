# Implementation

## Steps

### I-S01: 核对 AHP 接入与能力边界

核对官方规范、协议版本及 Host 所需能力，确定客户端连接、认证、会话与权限模型；明确 AHP 与现有 ACP 适配的差异。VS Code 仅作为首个真实验证实现，通用接口不依赖产品名。

复用官方 TypeScript SDK 1.0.0，显式协商其声明支持的 wire 1.0.0 / 0.9.0；仅接入明确配置的 WebSocket 地址。传输 query-token 与 AHP protected-resource 认证分离。固定来源、真实入口前提和不支持的能力见 [AHP-Evidence.md](./AHP-Evidence.md)。

### I-S02: 接通配置与执行恢复链路

复用既有 Agent 接入边界，将 AHP 配置、完整观察上下文、执行结果、取消与会话恢复接入 Regulator 及其 CLI 调用链。同步配置校验、配置编辑器和恢复记录，保持 ACP 写法兼容；配置按协议、传输、认证及 Host 内 Agent 标识分工，不新增产品专属语法。

以顶层 `type` 建立规范化的 ACP/AHP union；仅合法旧 ACP profile 可移除 `connection.type` 后读取。配置编辑、诊断、regulate/continue、共享进程 worker 与 planner 均按协议分派。AHP 先验证 Host 目录与 provider，再保存 Host 确认的 session/default-chat/turn 身份；恢复固定原配方，拒绝活动执行、身份缺失、目录变化和不确定重放。Regulator 核心保持协议无关。

集成 primary 并发新增的当前权限 ceiling/grants、恢复重载及监督事件链路；标准 AHP 没有可靠 operation/allow-once 语义时，发送官方 deny 并产生 `unknown` 授权请求，不猜测工具名或输入。保留替代执行机会，以新观察证明的进展优先，否则输出 `authorization-required`。

首轮真实部署暴露的兼容修复：用标准 URI 解析校验 `ahp-chat` 身份并原样保存，兼容带 authority 的 default-chat URI；已确认创建且默认 chat 可订阅、provider/目录/归属一致并无执行历史或在途任务时，允许 `creating` 会话的合法首次 turn 触发惰性 backend，不再以先等 `ready` 形成死锁。失败、无效状态和原身份固定规则不放宽。新增回归与官方固定版本证据见 [AHP-Evidence.md](./AHP-Evidence.md)。

### I-S03: 补齐协议验证与使用说明

增加 AHP 协议交互和失败路径测试，覆盖共享调用链的 ACP 回归，并更新配置、恢复与支持范围文档。

使用实际 WebSocket JSON-RPC 测试 Host 和 CLI 合成目标证明自动闭环；覆盖逐字节上限、握手/初始化取消、权限阻塞、失联、重复通知、身份保存与恢复。自动替身不作为真实 Host 或 Outer World 证据。已有 ACP-only setup Pilot 兼容规范化配置，并明确拒绝 AHP 就绪验证，不扩大它的职责。

### I-S04: 支持外部人工逐次确认

部署未通过后的最小适配：新增显式 AHP profile `confirmations: external`，由用户已连接同一 Host 的可信客户端展示完整请求并作出逐次决定。pguide 仅保持订阅并等待，不发送 approve、deny 或选择 option；缺省及 `deny` 保持原来的拒绝行为。既有 ceiling/grants 不转换成未知 AHP 权限。配置随原会话配方固定，受原运行期限、取消、断线和目标目录守卫约束。没有人类客户端时不得启用；不启动 UI、不连接额外 Host、不复制凭据，不以配置启用或实施验收代替某次操作的人工授权。

具体协议依据、安全边界和验证方案见 [AHP-External-Confirmation.md](./AHP-External-Confirmation.md)。此变更使原 Inner World 验收过期，必须重新完成实施验收后才能返回真实部署。

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

### I-AC04: 外部确认不产生自动授权

配置、核心与 CLI 回归证明：缺省仍拒绝；显式 external 在 execution/result 两阶段均不发送任何确认，能够消费 Host 回传的外部决定并继续重新观察；未确认时超时/取消不伪报成功，断线不自动重放，其他 turn 的决定不能解除本 turn 的等待。仅真实目标重观察可以认定修复。完整 pnpm check 通过。自动测试不替代用户逐次确认或 D-AC01 的真实证据。
