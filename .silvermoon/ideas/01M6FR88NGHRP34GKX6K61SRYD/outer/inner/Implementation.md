# Implementation

实施固定契约及兼容边界见 [Design.md](Design.md)，可复核命令、结果、源码链接与
独立 tarball/standalone Web UI 证明统一见 [Evidence-v1.md](Evidence-v1.md)。
[Evidence.md](Evidence.md) 仅保留被取代的 v2 历史验证，不作为当前证明。
Deployment 项仍由独立部署门禁核验，本文件不授予部署批准。

## Steps

### I-S01: 定义诊断日志契约

明确日志级别、Run 归属、顺序、输出背压、容量与保留策略，以及不可用和超限的可见语义。
对照[现有 Worker 协议](../../../../../docs/task-bundle-worker.md)，
统一在当前 axis 标记 `frozen: false` 的唯一 v1 内演进日志契约，不由发布状态推断冻结状态。
已移除的 v2 与未来未知版本明确拒绝，不以别名兼容；历史 Evidence 不作为当前 v1 验证。
按当前 axis 的 [RunContext](../../../../../docs/axis/task-engine-contracts/run-context.md)、
[日志契约](../../../../../docs/axis/task-engine-contracts/run-logs.md)及
[C6/C7 职责](../../../../../docs/axis/task-engine-responsibilities.md#c6-查询-run-诊断日志)
核对[实施设计](Design.md)，固定类型、限额和兼容边界，不另建日志生命周期。

### I-S02: 接通作者与消费链路

通过显式 `runTask(callback)` 的 `TaskContext` 提供继承自 `RunContext` 的 Log API，
接通 Worker、Engine、存储及消费侧日志查询/实时订阅 API；
保持业务 Result、progress、checkpoint 和生命周期判断独立。

### I-S03: 展示日志并补齐验证

在 Task Engine Web UI 的 Run 详情中提供独立日志界面，显示详细内容、级别、顺序与可用性，
支持实时跟随、历史分页和重新连接。以通用 SDK 的逐项断言诊断作为使用样例，
验证并发隔离、结束后查询和异常边界；不依赖已退休的 Check 专用适配器。

## Acceptance criteria

### I-AC01: 日志与业务结果独立

通过真实 SDK bundle 执行测试证明：日志可以被消费，Result 仍精简且符合业务 Schema；日志不成为匹配、复用或终结依据。

### I-AC02: 实时与历史链路完整

通过 Engine、存储、HTTP 及 Task Engine Web UI 测试证明：作者 Log API、消费侧查询/订阅 API 与 Run 日志界面完整连通；并发 Run 的日志不串流，订阅与历史查询符合约定的顺序、保留和断连语义。

### I-AC03: 异常与容量边界可验证

用失败、取消、强制停止、输出超限和消费故障测试证明：资源保持有界，日志缺失或截断可见，既有任务生命周期行为不变。
