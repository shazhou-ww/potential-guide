# Implementation

实施固定契约及兼容边界见 [Design.md](Design.md)，可复核命令、结果、源码链接与
独立 tarball/standalone Web UI 运行步骤统一见 [Evidence.md](Evidence.md)。
Deployment 项仍由独立部署门禁核验，本文件不授予部署批准。

## Steps

### I-S01: 定义诊断日志契约

明确日志级别、Run 归属、顺序、输出背压、容量与保留策略，以及不可用和超限的可见语义。
对照[现有 Worker 协议](../../../../../docs/task-bundle-worker.md)，明确协议版本与兼容边界，不原地扩写已固定的协议。
以[简短设计与 Worker API 前后对比](Design.md)为可调整的准备期设计候选；实施时固定类型、限额和兼容方案。

### I-S02: 接通作者与消费链路

提供 SDK Log API，接通 Worker、Engine、存储及消费侧日志查询/实时订阅 API；保持业务 Result、progress、checkpoint 和生命周期判断独立。

### I-S03: 展示日志并补齐验证

在 Task Engine Web UI 的 Run 详情中提供独立日志界面，显示详细内容、级别、顺序与可用性，支持实时跟随、历史分页和重新连接。以 check 的逐项诊断作为使用样例，验证并发隔离、结束后查询和异常边界。

## Acceptance criteria

### I-AC01: 日志与业务结果独立

通过真实 SDK bundle 执行测试证明：日志可以被消费，Result 仍精简且符合业务 Schema；日志不成为匹配、复用或终结依据。

### I-AC02: 实时与历史链路完整

通过 Engine、存储、HTTP 及 Task Engine Web UI 测试证明：作者 Log API、消费侧查询/订阅 API 与 Run 日志界面完整连通；并发 Run 的日志不串流，订阅与历史查询符合约定的顺序、保留和断连语义。

### I-AC03: 异常与容量边界可验证

用失败、取消、强制停止、输出超限和消费故障测试证明：资源保持有界，日志缺失或截断可见，既有任务生命周期行为不变。
