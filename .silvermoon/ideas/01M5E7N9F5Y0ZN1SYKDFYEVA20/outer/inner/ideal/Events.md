# 从 Coordinator 状态推导事件

本文是 [Design.md](./Design.md) 的讨论支撑，不是独立验收合同。Behavior/delta 原则已由本轮讨论明确；以下状态投影、七类事件、名称及字段仍为提案，不是已批准 API，也不要求现在实现。

## 先界定状态

同一 Coordinator 实例的 initial 假设为：服务已取得并处于 open；没有已确认意图、任务、调用、依赖、观察或协助请求；尚未采纳资源快照；累计预算预留为零。可信配置固定绑定该实例。资源输入即使一开始非空，也必须通过采纳事件进入状态，不能靠 reducer 偷读输入。open 初值不等于资源已就绪，unknown 也不等于 level initial。

候选可观察投影包括：

- 意图：已接受的 Objective/subject 目标、priority、请求发生身份与修订，以及请求处理结果。
- 任务与调用：pending/running/stopping/ended、有效调度要求、依赖关系、来源关联、执行资源与终结结果。
- 观察：按精确 Objective/subject/版本与来源关联的最新有效观察及证据，不维护历史最高 level 作为当前事实。
- 资源：Coordinator 已采纳的资源描述及是否可用于新分配；占用从尚未真正终结的调用推导。
- 协助与异常：已报告的能力/授权需求及可归属故障，不把需求报告视为授权。
- 服务：open/closing/closed/failed、输入生命周期和累计可信预算预留。

这些是公开投影，不要求暴露内部队列布局、Promise、resolver 句柄或保存无限历史数组。精确快照、保留和压缩策略须另定。

## 七类候选 delta

| 类别 | 改变的状态 | 最少需要表达的事实 |
| --- | --- | --- |
| intent-decided | 意图确认与请求处理 | 请求身份、accepted/rejected；接受时给出工作对象、目标、priority 和需求修订，拒绝时保留原因且不覆盖原意图 |
| task-changed | 单次任务、调用与依赖 | 创建/更新/终结，pending/running/stopping/ended，任务及可选 run 身份、原因、有效调度要求、依赖与派生来源、终结 outcome |
| observation-recorded | 已采纳的观察 | 精确对象和来源、有效观察 envelope、观察与采纳顺序、产生它的调用关联 |
| assistance-requested | 执行提出的外部协助需求 | 请求身份、调用及需求修订，能力或授权的有类型内容；只报告，不授予 |
| resources-changed | Coordinator 采纳的资源状态 | 初次采纳、后续更新或失效；给出完整资源描述或可确定归约的增删改，不能只有 IDs |
| fault-reported | 可归属异常记录 | 发生阶段、原因、关联对象及诊断；任务/资源/服务的实际状态效果由对应状态 delta 明确表达 |
| coordinator-changed | 服务、输入与全局约束 | 输入 ended/failed、服务 closing/closed/failed；预算预留必须可由调用启动或失败启动事件明确归约，不以隐藏重算或退还改变 |

这里的 changed 不是任意 JSON patch 或可选字段袋；后续应为每种合法转换定义具体 payload、前置修订和归约规则。七是候选状态分区的数量，不是压低事件 discriminator 数量的指标。

## 生命周期与依赖边界

- task-changed 是任务生命周期的唯一权威表达。blocked 是 ended 的 outcome，不是与 pending 并列的等待状态；pending 被撤销可以 ended，但没有 runId。
- 对已启动的 run，stopping 仍占槽；只有 result 真正 settlement 或 kill 确认终止后才 ended。kill/abort 故障不暗含结束。业务结束和实际终止不能被两个重复终态事件分别宣称。
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
| capability-request、authorization-request | assistance-requested 的两种有类型内容 |
| resources-accepted | resources-changed；补齐实际资源值与失效语义 |
| failure | 调用错误以 task-changed ended(error) 表达；非终结故障以 fault-reported 表达，涉及状态变化时另有明确 delta |
| input-ended、closed | coordinator-changed |
| stale-result | 若需公开可归属异常则 fault-reported，否则仅诊断日志；绝不改变新调用的观察或结果 |
| reclaimed | 内部内存回收不公开；有效任务或依赖从公开状态移除必须有显式 task-changed，不可静默删除 |

## 如何判断提案足够

给定同一个 initial 和同一个完整事件前缀，独立 reducer 应得到相同可观察投影，无需执行调度或访问现有内存。反例至少覆盖：同值新意图、资源首次采纳/失效/恢复、pending 与 block、抢占停止与 kill 失败、依赖建立和撤销、观察下降、旧结果拒绝、启动失败预算预留及非干净关闭。

后续讨论重点是公开状态边界、依赖与资源的可见粒度、协助请求生命周期、跨状态变化的原子性以及快照/事件接续约定；未达共识前不冻结具体消息类型或将本次记录视为整份构想验收。
