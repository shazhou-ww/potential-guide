# 以单一目标命令驱动 Regulation Coordinator

## 问题

已交付的 Coordinator 使用 add/replace/cancel/priority/retry，要求调用者操纵任务生命周期，并将 blocked 工作保留为可恢复节点；不能直接表达某个时刻对特定 Objective 与 subject 的一次性目标需求。

## 结果

命令统一为设置特定 Objective 与 subject 的目标 level 和 priority，initial 表示不再需要推进。commands 表达意图 delta，events 表达整个 Coordinator 可观察执行状态的 delta，由明确初值和有序完整前缀归约出 Behavior；保留 pending、有限依赖编排及单次调用终结。原则见 [Design.md](./Design.md)，事件候选见 [Events.md](./Events.md)。

## 边界

- 先完成 [level-attainment](../../../../01M5EFD1DW5J6MBE9BKCRFW5W3/outer/inner/ideal/Idea.md) 的协议语义，再接入统一 initial；本 idea 不重复修改层级协议。
- 保留资源 Behavior 第一参数、单队列及命令/事实分离；不迁移或重接既有 Supervisor、Planner、Portfolio，不增加长期目标控制器。
- 权限和总预算仍来自可信配置；终结调用不靠内存挂起恢复，必要的恢复信息须有明确持久化边界。不发布 npm，不改设备配置。

## 验收标准

- 单一目标命令覆盖提交、目标/优先级更新、撤销及终结后再次尝试；同一工作对象的覆盖顺序明确，initial 不检查、不回滚。
- pending 尚未进入 Regulation；blocked 调用已结束，依赖可自主排新调用，迟到反馈不复活旧执行、不伪报消费者成功。
- 明确初值、公开状态及 delta 归约规则；动态资源、共享依赖、实际终止确认、可信预算及隔离包消费有新证据，不依赖私有内存或旧交付结果冒充新验收。
