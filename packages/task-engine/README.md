# @potential-guide/task-engine

协调 Task 需求与完整 Run。Run 从持久化开始事件进入 preparation/allocation/execution，
不以业务 Worker 分配完成作为开始；共享不要求接收 Task 独立准备。

公开协议、静态类型注册、隔离 Worker、消息、证据、取消和存储破坏性边界见
[Task Engine](../../docs/task-engine.md)。Engine 不执行动态 TaskType 的初始化、prepare、validator 或 run。
类型模块通过本地 file URL 注册，在守护内提供最简 TaskType.run。

类型守护为每个完整 Run 创建独立 Worker，不跨 Run 共享模块堆；历史复验使用独立的复验 Worker。
同类型的 Worker 启动按序排队，避免启动风暴耗尽健康握手预算；已就绪的 Run 仍并行执行。
指定 Run 的协作取消、健康失联或强制终止不停止同类型的其他 Run。
类型上报结果先在隔离通道校验，宿主观察到该 Worker 退出后才交付终结回调；
宿主资源动作及独立清理证明仍须完成后才能确认回收，Worker 退出不替代这些证明。
守护的 `stopGraceMs`、`forceExitWaitMs` 均默认 5,000ms；停止接纳与实际退出分别通过通道报告，
强制退出等待超时明确报告 `stop_unconfirmed`，不伪造资源回收成功。

`EngineOptions.authorize` 仍控制 submit/request/task/cancel/history/subscribe/list/list-runs/message。
`listRuns` 提供独立授权、无载荷且有界的冻结完整 Run 目录；`listTasks({runId})`
列出当前 Caller 可读的事实匹配需求，不由消息或历史接口间接授予目录权限。
`allocationLimits` 和资源能力由可信 Host 配置，不由类型插件自授。
`pool` 子入口保留实际业务资源的替换、owner/reclaim 和物理退出确认；不把这些控制当作 Run 匹配政策。

`testing` 子入口为显式非持久 MemoryStore / VirtualClock。测试中的受控 resource fixtures
只用于协调器时序，不是生产生命周期代理；真实隔离与消息证明使用独立模块及 Worker。

`defaultEngineLimits` 公开默认预算。默认 ULID 窗口为 24 小时、未来偏差 60 秒；
持久下界只前进，接收范围两端包含等号，并在幂等查重前验证。
Task 由受理/取消和 Run 源事实推导，不持久化绑定或权威 Task 状态；必要时只补单个 observedAt 资格见证。
Task progress 只从独立 Run 查询，取消及终态不冻结当前时间标签或后续 stage。
全域源 revision 支持冻结分页、fromRevision 补读及完整集合封装；超限不返回部分成功。
