# Regulation Coordinator 双意图与可恢复状态实施

本文件是修订构想的轻量实施初版，须待新 ideal 验收及先行 level-attainment 协议就绪后细化。[Verification.md](./Verification.md) 记录上一版五命令实现的历史证据，不证明本次需求已完成。

## Steps

### I-S01 — 定义双意图、纯归约与恢复契约

依据 [Design.md](./ideal/Design.md) 与 [Types.md](./ideal/Types.md) 先收敛 RegulationRequests/ResourceAllocation/CoordinatorState 及合法转换，再推导 Command/Event，落实两个纯 reducer、资源意图全量更新、单命令及单次调用边界。区分单条 RegulationRequest 与集合 RegulationRequests；Objective 的 key 只编码稳定来源，ObjectiveRevision 另编码 Objective 与固定 commit，Target 关联 Objective，Request 固定版本并校验归属及 level。明确旧身份和引用的迁移，不将旧版 key 按新语义静默读取。完整状态包含 current singleton 与实体、聚合或历史 collection states，以 activeRuns 替代包含历史的 Task，不含实例 ID、输入通道生命周期或固定日志位置；明确当前待处理需求、输入接续、依赖、终结移除与集合写入、对象最近 Probe 聚合的原子边界、一致快照、适配层查询与接续元数据、存储错误和外部执行核实协议，不预设 processedIntents；[Events.md](./ideal/Events.md) 仅作遗漏检查，不引入长期目标控制器。

### I-S02 — 接入资源意图、资源侧授权与副作用执行

以单一目标命令和 binding/期望并发意图替代五命令、旧资源池及 harness grants/ceiling；使用真实资源授权并保留独立 quota/budget。以 monadic composition 组织调度、runner 和持久化副作用，reducer 回放不执行动作；明确资源更新响应和恢复核实，保留有限依赖、终止确认，不迁移旧服务。

按 [Views.md](./ideal/Views.md) 区分权威基础关系与查询冗余，补齐确认、Probe 顺序、证据选择和依赖归属等来源协议，再从合法转换推导事件；由同一事件序列维护实体及视图，不允许物化字段独立写入。

### I-S03 — 验证归约、资源响应与跨重启恢复

测试 initial、同值新意图、需求覆盖、no-resource 初值及切换、configured 零并发、期望并发低于实际、binding 变更、资源侧拒绝、有限依赖与真实终止。验证输入结束或断开不隐式撤销意图或关闭服务，错误仍明确反馈。独立 reducer 验证纯归约，进程/存储反例验证一致恢复、未知运行核实、无副作用重放与预算不重置；执行定向校验和 pnpm check，披露真实基线限制。

## Acceptance criteria

### I-AC01 — 双意图与纯归约语义完整

公开类型及测试证明单一请求命令、资源意图完整更新和两个纯 reducer 成立；区分 ObjectiveRevision、RegulationTarget、RegulationRequest 与实际 RegulationRun 调用。每条合法新请求分配唯一递增 requestSeq，仅更新相应 target 的最新请求，同值请求不丢失；清理和恢复不复用序号。Coordinator revision 标记 target 状态变化及请求确认，与 requestSeq 分属不同序列；同 priority 按 requestSeq 排序，观察或重复确认不改变排队位置。initial 不执行业务检查或回滚，资源期望不冒充实际占用，非法输入明确拒绝。JSON 往返保留 lastRequestSeq、请求身份、Coordinator 水位及事实引用。

类型与反例测试证明每个 Run 必须且只引用一条已记录的不可变 Request，target/desiredLevel 通过请求推导。依赖派生先形成或明确复用 provider 自己的请求，外部与内部请求共用序号空间及分配路径；拒绝缺失、冲突或错误归属的请求引用。最新映射覆盖、请求归档与恢复不能改变旧 Run/Observation 的对象和目标，纯回放不重复派生请求或启动调用。

类型、查询及恢复反例验证 Fault 的 kind/message 与四层展开归属链，拒绝非法空值组合和跨链引用；按 target/request/run 的 umbrella 查询不漏下层、不混入依赖 consumer、不重复记录。Observation 的主要属性直接可查询而不重复存 value，Run 的 bindingId 和嵌套配置保留当次实际快照；JSON 往返保留可选 provenance/配置的缺省语义，后续资源意图不改写历史执行。

### I-AC02 — 恢复、生命周期与资源边界正确

反例证明 pending/block 边界和有限依赖正确；确认结束的调用从当前切片移除并一致写入终结记录 Collection，当前无用依赖和观察可回收且不误删其他集合记录，查询结果不冒充权威集合，对象聚合区分无 Probe、最新失败和过期反馈，不导致意图重跑、故障静默或依赖提前完成。目标/完整状态可持久化接续，采用日志时由适配层保存一致处理位置，回放不触发副作用、重复历史写入或错误回退聚合，未知执行核实前不释放占用或重复启动。no-resource 是合法初值而非故障兜底，不冒充实际终止；输入通道结束不取消意图或服务。资源拒绝明确返回，不另设 harness 审批；存储故障不静默从零开始，恢复不退还或重置预算。

### I-AC03 — 交付与兼容验证可复查

在 I-AC02 的同一事件前缀与恢复版本上，比较各物化视图和 SELECT 完整重算的逻辑键及值，覆盖空初值、追加、替换、撤销、删除、乱序事实和共享依赖单边撤销。基础事实或充分基线足以重建视图；异步投影版本不混读，历史裁剪不回退预算或请求身份。此项以实际实现后的增量/重算对照测试证明，不以文档 SQL 示例代替运行时证据。

构建、类型、相关测试、打包消费及 pnpm check 有本次命令结果；既有 Supervisor/Planner/Portfolio 保持原接线和行为。基线故障与本次引入问题分开记录，文档与直接相关生成物一致。
