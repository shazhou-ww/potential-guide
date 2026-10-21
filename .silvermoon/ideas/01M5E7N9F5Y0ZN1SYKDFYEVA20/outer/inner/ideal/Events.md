# 从 Coordinator 状态推导事件

本文是 [Design.md](./Design.md) 的讨论支撑，不是独立验收合同。以下七类是事件讨论的候选分区，已按后续确定的双意图、资源侧授权及纯恢复原则修正；类别数量、名称及字段仍需重新推导，不是已批准 API，也不要求现在实现。

当前先讨论 [Types.md](./Types.md) 的 state 数据类型与合法转换。下列分类退回为历史候选及覆盖检查，不冻结事件数量，也不据此强行划分 CoordinatorState。

## 先界定状态

新建 Coordinator 实例的候选 initial 为：服务已取得并处于 open；没有已确认意图、任务、调用、依赖、观察或资源侧协助请求；尚未确认资源分配意图；累计预算预留为零。可信约束绑定该实例。恢复实例应从持久化状态及处理位置接续，不能套用新建空初值。资源意图即使一开始已经提供，也须通过确认事件进入状态；reducer 不偷读输入。open 不等于资源已就绪，unknown 不等于 level initial。

候选可观察投影包括：

- 意图：已接受的 Objective/subject 目标、priority、请求发生身份与修订，以及请求处理结果。
- 任务与调用：pending/running/stopping/ended、有效调度要求、依赖关系、来源关联、执行资源与终结结果。
- 观察：按精确 Objective/subject/版本与来源关联的最新有效观察及证据，不维护历史最高 level 作为当前事实。
- 资源：已确认的分配意图（binding/期望并发度）与实际使用的 binding/占用分别表达；占用从尚未真正终结的调用推导，期望小于实际是合法过渡。
- 协助与异常：真实资源返回的拒绝、必要的登录/授权交互及可归属故障；不保留 harness 自有 grants/ceiling 审批或 capabilities 匹配需求。
- 服务：open/closing/closed/failed、输入生命周期和累计可信预算预留。

这些是公开投影，不要求暴露内部队列布局、Promise、resolver 句柄或保存无限历史数组。精确快照、保留和压缩策略须另定。

## 七类候选 delta

| 类别 | 改变的状态 | 最少需要表达的事实 |
| --- | --- | --- |
| intent-decided | 意图确认与请求处理 | 请求身份、accepted/rejected；接受时给出工作对象、目标、priority 和需求修订，拒绝时保留原因且不覆盖原意图 |
| task-changed | 单次任务、调用与依赖 | 创建/更新/终结，pending/running/stopping/ended，任务及可选 run 身份、原因、有效调度要求、依赖与派生来源、终结 outcome |
| observation-recorded | 已采纳的观察 | 精确对象和来源、有效观察 envelope、观察与采纳顺序、产生它的调用关联 |
| assistance-requested | 真实资源需要的外部协助（是否独立保留待定） | 如确有登录/授权挑战，关联实际请求及调用；不是 harness 自建审批，不等于自动授予权限 |
| resources-changed | 已确认的资源分配意图，不是已经完成的分配 | 记录完整 binding/期望 concurrency 及修订；不带资源池增删改或只给 IDs，不用期望覆盖实际占用 |
| fault-reported | 可归属异常记录 | 发生阶段、原因、关联对象及诊断；任务/资源/服务的实际状态效果由对应状态 delta 明确表达 |
| coordinator-changed | 服务、输入与全局约束 | 输入 ended/failed、服务 closing/closed/failed；预算预留必须可由调用启动或失败启动事件明确归约，不以隐藏重算或退还改变 |

这里的 changed 不是任意 JSON patch 或可选字段袋；后续应为每种合法转换定义具体 payload、前置修订和归约规则。七是候选状态分区的数量，不是压低事件 discriminator 数量的指标。

## 生命周期与依赖边界

- task-changed 是任务生命周期的唯一权威表达。blocked 是 ended 的 outcome，不是与 pending 并列的等待状态；pending 被撤销可以 ended，但没有 runId。
- 对已启动的 run，stopping 仍占槽；只有 result 真正 settlement 或 kill 确认终止后才 ended。kill/abort 故障不暗含结束。业务结束和实际终止不能被两个重复终态事件分别宣称。
- 资源意图从并发 4 变为 2 只改变期望，实际占用可仍为 4。是否排空、抢占或停止由 Coordinator 策略决定，实际响应须以调用状态 delta 表达；binding 意图改变不冒充旧调用已经切换。
- 目标 initial 可以只改变已确认意图及撤销相关任务，不伪造观察或 running。纯 priority 更新不能自动构成新的调用。更新意图与旧调用清理必须分别可追踪，不能把新修订挂到旧 run 上。
- 单个任务的依赖引用是公开状态，依赖图由这些引用推导。因此不再单独公开一份 dependencies 图事件；引用增加、撤销、provider 身份及 minimumLevel 变化须进入 task-changed，不能只报告 dependency-required 就省略后续实际采用的关系。
- provider/consumer 的新任务通过 task-changed 明确创建与关联。provider 证据可支持重新排 consumer，但不直接将其标记达标；旧调用已经 ended，不能从 ended 回到 running。
- 已消费的总预算不能因为调用终结或意图更新消失。成功和失败的 start 尝试都必须携带明确预留事实或独立的有类型预留变体；详细原子边界留给类型设计。
- 一次终结若携带最终观察，应规定先采纳 observation-recorded 再结束任务，或由一个原子 delta 承载两者，不能让两个事件竞争更新同一观察。
- fault-reported 记录一次异常，不默认创建一个永久未解决的故障状态。需要持续阻止分配或标记服务失败时，资源/任务/服务状态及恢复也必须有显式 delta。

## 原有事件的候选归宿

| 原有事件 | 候选归宿 |
| --- | --- |
| accepted、rejected | intent-decided |
| started、stopping、terminated、result、终态 blocked | task-changed 的合法状态转换及 outcome |
| 资源不足时的 blocked | task-changed 的 pending 及等待原因，不是 Regulation block |
| observation | observation-recorded；运行中与最终观察使用同一采纳规则 |
| dependencies | task-changed 中被采用的依赖引用及派生任务来源 |
| capability-request、authorization-request | harness 自有审批/匹配模型取消；真实资源协助如仍需要，另行定义 assistance-requested，不照搬旧 union |
| resources-accepted | 资源分配意图的确认 delta；实际分配和占用仍从任务/调用 delta 推导 |
| failure | 调用错误以 task-changed ended(error) 表达；非终结故障以 fault-reported 表达，涉及状态变化时另有明确 delta |
| input-ended、closed | coordinator-changed |
| stale-result | 若需公开可归属异常则 fault-reported，否则仅诊断日志；绝不改变新调用的观察或结果 |
| reclaimed | 内部内存回收不公开；有效任务或依赖从公开状态移除必须有显式 task-changed，不可静默删除 |

## 如何判断提案足够

给定同一个初值或一致快照与同一个后续完整事件前缀，独立 reducer 应得到相同投影，不执行调度、读取输入或重放副作用。反例至少覆盖：同值新意图、资源意图确认与实际占用分离、binding 更新、资源侧拒绝、pending 与 block、停止与 kill 失败、依赖关系变化、观察下降、启动失败预留及跨重启处理位置接续；恢复不复活已终结意图、不清空未核实占用或预算。

后续按双意图接口、纯 reducer、资源侧授权和持久化恢复原则重新审视公开状态边界、资源侧协助是否必要、原子性与快照接续；未达共识前不冻结消息类型或把原则确认当作整份构想验收。
