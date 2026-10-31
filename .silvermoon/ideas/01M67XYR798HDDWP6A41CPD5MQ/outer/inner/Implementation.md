# Implementation

本文件是可调整的实施初版，不属于构想验收范围。

## Steps

### I-S01: 明确完整尝试的协议边界

定义包含准备的 Execution 起止、准备产物归属及失败语义，对齐事件、持久化、恢复和公开投影；
明确两种 Match Policy 的行为变化及旧格式处置，不把本文初版当作存储迁移授权。

### I-S02: 对齐共享和宿主资源边界

调整 Engine 与 Check/Probe，使相同 Input 的兼容需求共享完整过程。去掉通用 TaskType.authorize
及其专属检查，保留 EngineOptions.authorize、authorizeReplacement 和实际资源动作授权；
不把接收 Task 重新 Prepare 或资源授权作为匹配门槛，不用同名替代 hook 搬移复杂度。

### I-S03: 验证消费者和时序行为

对齐直接相关文档、适配器和测试；覆盖浮动引用、固定 digest、准备失败、事件竞态、
取消、超时、资源撤销和恢复。执行针对性检查及仓库 pnpm check。

## Acceptance criteria

### I-AC01: 完整过程共享与匹配一致

用确定性时序测试证明准备可共享、接收方无需独立准备、两种事件匹配边界清晰，
准备失败与取消/超时不会混淆，单个需求退出不伤害其他需求。

### I-AC02: 内容身份和权限边界清晰

用 Check/Probe 回归证明浮动 URL 可接收所选执行的固定旧内容、pin digest 限定内容身份，
且服务权限、实际资源动作和替换控制仍有效；协议及调用路径不再包含通用 TaskType.authorize。

### I-AC03: 持久化与消费者行为可验证

用恢复、事件原子性及适配器测试证明公开事实与完整过程一致；记录格式变更处置，
通过相关包检查与 pnpm check，不以宿主代码隔离替代本 Idea 的验证。
