# @potential-guide/task-engine

协调 Task 需求与完整 Run。Run 从持久化开始事件进入 preparation/allocation/execution，
不以业务 Worker 分配完成作为开始；共享不要求接收 Task 独立准备。

公开协议、静态类型注册、隔离 Worker、消息、证据、取消和存储破坏性边界见
[Task Engine](../../docs/task-engine.md)。Engine 不执行动态 TaskType 的初始化、prepare、validator 或 run。
类型模块通过本地 file URL 注册，在守护内提供最简 TaskType.run。

`EngineOptions.authorize` 仍控制 submit/request/task/cancel/history/subscribe/list/list-runs/message。
`listRuns` 提供独立授权、无载荷且有界的冻结完整 Run 目录；`listTasks({runId})`
列出当前 Caller 可读的已绑定需求，不由消息或历史接口间接授予目录权限。
`allocationLimits` 和资源能力由可信 Host 配置，不由类型插件自授。
`pool` 子入口保留实际业务资源的替换、owner/reclaim 和物理退出确认；不把这些控制当作 Run 匹配政策。

`testing` 子入口为显式非持久 MemoryStore / VirtualClock。测试中的受控 resource fixtures
只用于协调器时序，不是生产生命周期代理；真实隔离与消息证明使用独立模块及 Worker。
