# Coordinator 双意图 Behavior 与纯归约原则

本文支撑 [Idea.md](./Idea.md)，不是第二份验收合同。以下原则记录本轮讨论确定的设计方向，替代上一版五命令、资源池、harness 自有授权和 blocked 节点恢复模型；不等于整份修订构想已验收或代码已实现。事件名称、精确类型、存储格式和响应策略仍须继续细化，候选事件见 [Events.md](./Events.md)。总讨论入口为 [schema-contracts / Schemas.md](../../../../01M5CR0X2B4R2C6K3183Y1T3SQ/outer/inner/ideal/Schemas.md)。

类型讨论入口为 [Types.md](./Types.md)：先定义 RegulationTarget、ResourceAllocation、CoordinatorState 及合法转换，再推导 Command/Event。Events.md 的既有分类仅作遗漏检查，不作为类型设计的先验框架。

## 两个意图输入，一个执行状态输出

```text
Behavior RegulationTarget ────┐
                             ├── Coordinator ── Behavior CoordinatorState
Behavior ResourceAllocation ──┘
```

- RegulationTarget 是治理目标意图：针对特定 Objective 与 subject，在某时刻要求一次向 targetLevel 推进的尝试，具有 priority。它不承诺一定达到，不是持续保持目标的控制器。
- ResourceAllocation 是资源分配意图：期望使用的 agent binding 及并发度，不是实际资源分配、真实空闲数或权限集合；每次以完整值更新，不另建资源 delta 协议。
- CoordinatorState 是整个 Coordinator 的可观察执行状态：已确认的两类意图、pending/运行/停止/终结、已采纳的治理观察、依赖、实际 binding 与占用、累计预算、异常和服务生命周期。
- 外部接口是有状态、带副作用及反馈的二元 Behavior 变换，不是仅依赖当前两个值的无记忆逐点函数。输入保持不变时，runner 反馈、观察及超时仍能改变输出状态。
- 内部可以通过 monadic bind（>>=）组合依赖前一步结果的副作用步骤；monadic composition 不等于 monadic lift，不将整个 Coordinator 称为 liftM2 或普通 applicative lift。

## delta 与两个纯 reducer

```haskell
RegulationTargetReducer :: Command -> RegulationTarget -> RegulationTarget
CoordinatorStateReducer :: Event -> CoordinatorState -> CoordinatorState
```

- commands 描述治理意图的 delta，events 描述 Coordinator 执行状态的 delta。给定明确初值与有序、完整的 delta 前缀，确定性归约得到相应 Behavior。
- RegulationTarget 使用 ObjectKey 到完整意图的映射，TS 表达为 Readonly<Partial<Record<ObjectKey, TargetIntent>>>，key 由规范化 Objective/subject 身份确定。外层 revision 是整个状态的全局版本；条目 updatedAtRevision 是最后更新它的全局版本，两者共用一个版本空间。每条合法 command 令全局版本加一并覆盖对应条目，即使参数相同也保留新发生身份；意图提出与 Coordinator 确认是不同事实。
- 两个 reducer 都是纯的。尤其 CoordinatorStateReducer 不访问当前输入或私有队列、不执行检查、不作调度决策、不启动或停止进程；事件回放不重复任何执行副作用。
- 命令合法性及拒绝行为须明确，不能以静默返回原状态掩盖非法输入。事件必须携带足够身份、修订与变化值，让独立 reducer 无需重新观察现实即可归约。
- 调度与执行过程读取意图和已有状态，作决策、执行动作，并将真实结果形成 events；同一状态变化只有一个权威表达。停止请求不等于终止，异常通知不暗含任务结束。
- level 事件表示 Coordinator 采纳的有来源观察，不声称外部变化完全由本次治理造成；观察允许下降，未知或检查异常不伪装成 level initial。

## 单一治理目标命令与单次调用

- 公共命令只有为特定 Objective/subject 设置目标 level 与 priority，不再分别提供 add、replace、cancel、priority 或 retry。未终结需求可被更新，前次终结后新请求形成新尝试。
- 覆盖身份须包含明确对象，精确 Objective 版本、来源和实际资源身份不能混淆；不依靠任意 regulation ID 区分同一需求更新。按接受顺序区分新旧，不依赖生产者时钟；commandId 用于关联，不默认是幂等键。
- 意图按非负整数 priority 升序、updatedAtRevision 升序排序；同级 FIFO 以最近更新为准，而非首次加入时间。每次更新刷新条目逻辑时间，Record 属性枚举顺序不决定队列顺序；纯 priority 更新可重新排序，但不无故重启。意图发生引用为对象 key 加条目更新版本，旧反馈不能完成新意图。
- 先行 [level-attainment](../../../../01M5EFD1DW5J6MBE9BKCRFW5W3/outer/inner/ideal/Idea.md) 提供无要求 initial。目标 initial 不执行业务检查或 Agent，但仍校验契约、目标和 subject；它撤销推进需求，不将现实降级、不回滚修改、不虚构观察。
- pending 是 Coordinator 等待 regulator 调度的任务，尚未进入 Regulation。Regulation 开始后，达标、block、预算耗尽或 exception/error 都结束本次调用；不存在以 blocked 状态保留活跃调用、等输入后原地复活的 retry。
- Coordinator 只维护当前单次需求和必要的有限依赖编排，不因 subject 后续退化或资源变化自动重跑已终结意图。

## 资源分配意图与实际占用

- ResourceAllocation 的最小核心为 binding 与期望 concurrency；binding 固定时可置于实例配置，使动态部分仅剩 concurrency。具体 API 稍后确定，不预设异构资源池、独立 resource ID、capabilities/requirements 匹配或重复的两级并发约束。
- concurrency 是期望总并发度，不是宿主上报的剩余空闲槽位。实际 running/stopping、每次调用使用的 binding 及资源利用由 CoordinatorState 和 events 表达。
- 从 4 调为 2 只是资源意图变化，不会直接杀掉两个调用；已确认期望为 2、实际占用仍为 4 是合法的过渡状态。binding 更新同样不等于旧调用已经切换。
- 是否等待自然排空、停止哪些调用、如何抢占以及何时采用新 binding，是 Coordinator 的业务响应策略，须后续明确验证；资源输入本身不编码强制停止语义。
- 原始输入、已确认意图及实际响应分开记录。非法资源输入明确报错，不能静默当作合法零并发、成功采纳或凭空宣称权限已撤销；有效性故障后的运行策略也需明确。
- 实际占用包括 running 与 stopping。abort 只提出请求；result settlement 或 kill 必须确认实际退出，才释放槽位。kill 失败保留未确认占用并报告，不能虚构终止。

## 资源侧授权与独立执行约束

- 在当前用户账号已委托的管理范围内，harness 不再维护独立的业务 grants/ceiling、操作白名单或逐任务授权审批；不把旧 makeRegulationPermissions 或内部 authorization-request 作为新模型必需入口。
- 实际操作使用已委托的 OS/外部服务身份，由文件系统 ACL、服务 IAM、凭据 scope 等真实资源边界授权；管理当前账号不等于管理员或所有外部账号权限，独立服务身份不能被混为同一个用户身份。
- binding 描述执行接入，不宣称抽象权限。资源拒绝、登录/授权挑战或提权要求明确返回；无法继续时结束本次调用，不自行扩权、绕过资源卡口或把拒绝伪报成功。真实资源交互如需外部协助，须与 harness 自有审批区分。
- concurrency、单次 quota、累计 budget、超时、输入/证据校验、终止确认及凭据安全交付不是重复授权，仍由可信执行配置和 Coordinator 管理。持久化记录不能包含明文秘密，应关联资源身份及安全凭据引用。
- budget 限制累计消耗，concurrency 表达资源分配期望；槽位释放不补充预算。先保持 budget 为独立可信约束，动态补充或调账语义未定，不把资源全量更新当成预算刷新。
- 新目标请求、依赖派生、抢占、恢复或换执行身份不重置已消费/已预留预算或无界提升 stall allowance。

## 持久化、纯回放与恢复

- 设计支持 RegulationTarget 和 CoordinatorState 的持久化及恢复。可采用快照加后续增量；初值、快照版本、命令/事件处理位置与接续规则必须明确，不要求现在固定存储技术或永久保留无限日志。
- 保存目标意图的发生修订和 Coordinator 已处理位置，使两者能一致接续。恢复后不能把已完成或 blocked 的同一意图当成新请求重跑，也不能遗漏未处理请求或重复预留预算。
- 保存 RegulationTarget 的全局版本水位与 Record 条目更新版本，不能用剩余条目的最大值替代水位或把版本当作消息游标；使用普通 JSON 对象持久化映射，仍须校验对象身份、版本与可持久化值。
- 持久化的是目标、观察、结果、依赖和恢复元数据，不是 Promise、进程句柄或活跃内存节点；恢复失败明确呈现，不能静默从空状态启动。
- 回放只运行 reducer，不重放启动、停止、文件写入等副作用。恢复出的 running 是历史记录，不是当前存活证明；须核实外部执行能否重关联、是否已结束或是否无法确认，再将恢复事实通过 events 纳入状态。
- 外部执行未核实前，不虚报终止、释放占用、退还预算或启动可能重复的替代调用。具体重关联/失联协议与恢复阶段状态在实施时定义。
- ResourceAllocation 恢复时以可信当前输入为准；是否保存为恢复上下文可后续决定，不仅凭旧分配意图自行执行。实时无重放 Stream 不自动获得历史恢复能力，晚订阅需匹配快照与后续增量或明确只消费后续事实。

## 有限依赖、驻留与复用边界

- 只有当前调用返回合法 dependency-required 才建立依赖并排 provider 调用；原调用已终结。共享依据精确 Objective/subject/版本/来源及真实执行身份，聚合最低需求中的最强目标与最高 priority，不引入旧 capabilities 匹配层。
- provider 的有效证据只支持 consumer 的新调用重新观察，不等于 consumer 成功。新边检查自环/传递环并原子安装；解析前后核对需求修订，拒绝非法或旧证据，不隐式解析 latest。
- 当前有效需求锚定可达性；覆盖目标或设为 initial 后回收不再需要的关系，保留共享 provider。仍在运行的无引用调用按停止策略处理，实际退出后释放资源；resolver acquisition/release 成对，失败明确呈现。
- 保留资源意图为第一参数的 FRP 接口。每实例一个 scoped 调度循环、内部单队列与图；多输出订阅不复制执行，空闲或命令流正常结束不结束服务。
- 输入、执行、证据和清理错误可归属地报告；真正基础设施缺陷可使服务失败，但不得静默失去调度循环或伪报成功。订阅背压、scope 清理与停止策略需测试。
- 沿用 @potential-guide/effects 的 Effect/Stream/SubscriptionRef 及适用的纯比较、runner 和精确来源 helpers；旧资源池、权限模型及有状态 Planner 不是必须复用的契约。
- 历史源码研究基线为 62d16b6fc4afb4a22325878bb2068b6be19ef2cf，仅供定位既有进程终止、来源验证和依赖反例，不代表旧 API 与新原则兼容。已有 Verification 及 outer 证据仅证明历史五命令交付。
- 不迁移或重接既有 Supervisor/Planner/Portfolio，不做 CLI 接线、全局安装或 npm 发布；如共享边界确需配套调整，在实施时明确最小变更及兼容证明，不能以复用旧类型为由保留相冲突的模型。

## 后续仍需收敛

事件清单与原子 delta 边界、资源意图响应策略、快照/存储接口及外部执行恢复协议仍须细化。验证至少包括双 reducer 纯归约、同值新意图、并发期望低于实际占用、binding 变更、资源侧拒绝、有限依赖与共享回收、跨重启恢复、不重复副作用和预算不重置；未实施前不预填完成证据。
