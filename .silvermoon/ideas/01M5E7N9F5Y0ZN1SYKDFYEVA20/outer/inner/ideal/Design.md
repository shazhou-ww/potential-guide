# Coordinator 单一目标命令与调度边界

本文支撑本 IDEA 的方向卡，不是第二份验收合同。总讨论入口为 [schema-contracts / Schemas.md](../../../../01M5CR0X2B4R2C6K3183Y1T3SQ/outer/inner/ideal/Schemas.md)。本次修订体现单一目标命令讨论，替代上一版五命令与 blocked 节点恢复模型；具体类型字段、持久化接口和实现方案留到实施阶段明确。本候选尚待重新验收，旧验收事件和证据仅证明历史交付。

## Behavior 与 delta 的设计原则

- commands 和 events 都描述特定实体的 delta。给定明确的 initial state 和有序、完整的 delta 前缀，通过确定性的归约规则推演该实体的 Behavior；先定义实体、状态边界与归约规则，再决定消息类型，不从旧通知名称机械分组。
- commands 描述意图的 Behavior：某时刻对特定 Objective 与 subject 产生达到特定 level、具有特定 priority 的一次性意图。发生身份必须保留；前次终结后的同值新请求不等于没有变化。
- events 描述整个 Coordinator 的可观察执行状态的 Behavior：包括确认或拒绝意图变化、pending/运行/停止/终结、已采纳的治理 level 观察、依赖与资源状态，以及异常。events 不仅是单次调用生命周期，也不等于 subject 在外部世界的完整状态。
- command 被提出与被 Coordinator 接受是不同事实。level 事件表示 Coordinator 已采纳的有来源观察，不默认断言外部状态变化由本次调用单独造成；观察可以下降，错误不能伪装成 initial。
- delta 必须包含足以归约的身份、修订和变化值，不能要求 reducer 重新执行检查、读取当前资源 Behavior 或访问私有队列。只有实际改变可观察状态的细节才属于公开事件；内部对象回收不自动成为公共状态。
- 同一状态变化应有一个权威表达。异常报告不隐含任务终结，停止请求不等于实际退出；若一次变化同时影响多个状态分量，需明确原子事件边界或有序事件的中间状态。
- 当前实时无重放 Stream 不因此获得历史恢复能力。从 initial 重建需要完整事件前缀；晚订阅需要匹配的快照及其后事件，或明确只消费后续事实。存储、快照及投递方案仍待讨论，不能承诺已实现事件溯源。

事件类别推导与尚未定案的方案见 [Events.md](./Events.md)。本轮确认的是上述设计原则，不代表候选事件名称、字段或类型数量已经验收。

## 单一目标命令

- 每条请求在被 Coordinator 串行接受时，为特定 Objective 与 subject 指定目标 level 和 priority；它是一次性尝试的需求，不是长期保持目标状态的订阅。资源变化不自动复活已经终结的调用，外部状态退化也不触发无限纠偏。
- 公共命令只有设置目标这一种，不再分别提供 add、replace、cancel、priority 或 retry。当前需求尚未终结时，新请求更新该工作对象的目标与优先级；前次已终结时，即使参数相同，新请求仍表示新的一次尝试，不因值相等被吞掉。commandId 只关联请求，不默认充当幂等键。
- 覆盖对象必须由明确的 Objective 与 subject 身份确定；精确版本、来源及可信权限边界不能混淆。具体键及规范化规则在实施时定义，不能只用 Objective URI 把不同 subject 合并，也不能继续要求调用者靠任意 regulation ID 区分同一需求的更新。
- 对同一工作对象，以接受顺序确定新旧，不依赖生产者时钟。优先级仍为非负整数、小者优先、同级 FIFO；纯 priority 更新不应无故重启执行。目标更新如何替换不再适用的运行须显式说明，并保留请求、需求修订、执行及事件顺序关联。
- 目标 initial 来自先行 [level-attainment](../../../../01M5EFD1DW5J6MBE9BKCRFW5W3/outer/inner/ideal/Idea.md) 的无要求最低层级：不为它启动检查或 Agent，撤销尚未开始的推进需求并停止不再需要的执行。它不是未知状态，不将已达成 subject 降级，不回滚已发生的修改；共享 provider 仍有其他需求时不得被误撤销。

## 任务与单次调用

- pending 是 Coordinator 为 regulator 排队的任务状态，此时尚未进入 Regulation；资源容量或能力暂时不足可以保持 pending，后续合法资源变化可触发调度。
- Regulation 一旦开始，达标、业务 block 或内部 exception/error 都结束本次调用。目标 level 是尝试意图，不承诺最终达到；authorization-required、exhausted 等终结结果不能保留成同一调用的挂起态，也不存在专门复活它的 retry 命令。
- 后续尝试使用新的执行身份，必要进展、阻塞原因和恢复信息须可持久化，不能依靠旧 Promise、进程句柄或内存节点跨长时间等待及设备重启。持久化数据、提交责任和失败呈现需在实施合同中明确；不默认承诺整个 Coordinator 的持久化目标数据库。
- Coordinator 只保留当前单次任务与必要的有限依赖编排，不拥有长期业务目标。依赖结束后如需重新调用 consumer，它是读取有效证据后发起的新调用，不是恢复已终结的 Regulation；编排不能绕过授权、总预算或假定 consumer 已达标。

## 公共边界与驻留

- FRP 入口的第一参数是资源池 Behavior；沿用 `@potential-guide/effects` 的 `SubscriptionRef` 表达随时间变化的当前值，`Stream` 表达命令和事实。可信构造配置包含 runner、精确来源解析器、权限上限、预算、并发及终止策略，不混入业务命令。
- 一个 scoped Coordinator 实例拥有一个内部 priority queue、执行集合和依赖图。没有 `Map<QueueId, Queue>`，也不接受 queue snapshot 或 dependency graph 输入。调用者只设置目标与 priority；输出的是已接受、已拒绝、已启动、依赖发现、阻塞、结果、停止等已发生事实，而非指令回声。
- 接口由 scope 管理唯一调度循环和订阅；多个事件消费者不创建多个调度器。空队列及正常命令流结束不关闭服务；资源后续变化和运行中的后续反馈仍有效。显式 scope 关闭才停止接收，终止执行并等待清理。订阅与缓存策略须在实施中说明并测试：不以无限历史数组代替事件流，也不静默丢失在订阅期内必须交付的事实。
- 工作对象身份、命令关联 ID、需求修订、执行 ID 和事件顺序可追踪；旧执行反馈不能完成或修改新需求。非法命令产生拒绝事实且不改变现有需求。仅凭当前需求不存在不能拒绝一条新的合法目标请求。

## 依赖发现与所有权

- 只有当前 Regulation 返回 `dependency-required` 才建立依赖关系和派生任务；返回该结果的调用已经结束，Coordinator 自主为 provider 排一个调用，不保留原调用等待。不得先借 Planner 周期 observe 预展开整张图；provider 达标只支持 consumer 的新调用重新观察，绝不把 provider 的成功当作 consumer 的成功。
- 等待边保留 consumer generation、provider 的 Objective/subject/精确版本与来源、最低 level。共享只发生在相同执行身份及兼容来源/权限边界内，聚合消费者所需的最强 level、最高 priority 和能力约束；不以仅含 Objective URI 与 subject 的旧 key 混合不同版本或信任域。
- 当前有效需求是依赖可达性锚点。新目标覆盖旧目标或目标设为 initial 时，清理不再需要的边，并回收无引用派生工作及下游链条；共享 provider 及仍被独立需求需要的 provider 保留。无引用但仍运行的工作先停止、确认终止后才释放资源；解析得到的来源句柄必须成对释放。
- 验证 handoff 的成功 envelope、consumer generation、Objective/version/source、dependencies 与观察中的 problems 一致，以及 provider subject/level 合法。异步解析完成前后均校验 generation；旧执行结果或旧版本证据不得改变新图或完成新需求。来源冲突、缺少精确版本、非法证据明确失败，而不是退回 latest。
- 新边先在候选图检查自环和传递环，通过后原子安装；拒绝时不留下半张图。事件标明受影响 consumer 和原因，其他独立工作继续；需要再次尝试时通过新的目标请求表达，不引入旧 retry/replace 恢复入口，也不无限自动重试。

## 资源、生命周期与失败

- 动态校验资源 ID、binding、capacity 和 capabilities；合法资源变化唤醒调度，能力不匹配/无容量明确呈现。无效更新产生资源失败事件并停止新分配，直到合法快照恢复，不静默沿用可能已撤销的权限或能力。
- 全局并发和每资源容量均计算 running 与 stopping。资源移除、binding/能力失效及容量收缩触发必要的停止；超额期间禁止新增。P0 可复用既有最少受害者抢占规则，停止中的执行仍占槽位，不重复选作受害者。
- runner.start 抛错、result 拒绝、abort 抛错、kill 拒绝与正常业务阻塞分别转换为可归属事件。abort 只是请求；result settlement 必须代表执行实际结束，或等待 kill 的终止确认，之后才释放槽位。kill 失败保留占用并报告，不能假装停止成功；后续实际结束仍可完成清理。关闭也不虚报清理完成。
- expected failures（命令校验、资源更新、解析/观察、授权/能力不足、依赖、执行和清理失败）在事实流中明确呈现，不传播成顶层退出。只有未处理的缺陷、不可恢复的服务基础设施失败属于 crash；不得把一切异常吞成成功。命令流/资源流异常亦须被监督和明确报告，不能悄悄让调度 fiber 消失。
- 权限和预算取可信构造配置；派生工作没有新增授权，命令中注入 grant/ceiling/budget 被拒绝。授权不足以明确结果结束本次调用，不通过自动 continuation 绕过。新的目标请求、依赖派生、抢占或资源撤销均不补充实例总预算；不保留旧 retry 入口，也不能以更换执行身份无限重置同一编排的 stall allowance。

## 源码研究与最简单完整方案

研究基线为 `62d16b6fc4afb4a22325878bb2068b6be19ef2cf`，可在以下源码核对：

- `packages/effects/src/index.ts`：已提供 `Effect`/`Stream`/`SubscriptionRef`、`startEffect`、`watchSnapshot`、scoped `activate` 和 latest-slot generation 清理语义。复用这些基础设施；latest-slot 不能直接替代多并发调度器。
- `packages/objective-regulator/src/index.ts`：复用 `RegulationInput`/`RegulationOutcome`、`makeRegulatorSpec`、`makeRegulationPermissions` 和 `regulate`。Regulation 已产生 `dependency-required`，不重写观察或 Agent 执行循环；`regulatorBehavior` 是单输入快照的单次执行，不是本服务。
- `packages/objective-portfolio-supervisor/src/decisions.ts` 和 `types.ts`：已有 canonical JSON、level/capability/资源选择、P0 最少抢占、runner handle 协议。允许新包过渡依赖旧包的公开纯 helpers 和结构类型，使用内部适配以适配原 helper 的 goal 形状；只复用适用规则，旧 `objectiveKey` 不足以担任版本/授权身份。依赖方向是新包到旧纯决策，不让旧 Supervisor 依赖新服务，不修改旧文件，也不在本次抽取迁移公共包。
- `packages/objective-portfolio-supervisor/src/planner.ts`：已有 waits、roots/derived、可达性回收、handoff evidence 和环检查，但它是有外部 goals、周期观察和 queue snapshot 输出的完整 Planner；其有状态 machinery 未独立导出。本次参考其已验证算法与测试案例，在新包内实现必要的 consumer-owned 图状态，不整份复制 Planner，不强行复用其生命周期。
- `packages/objective-portfolio-supervisor/src/coordinator.ts`：已有资源计数、取消/kill 确认，但输入是 queue Behavior，输出是有限历史 state/callback，业务失败还写入 state.error；不能套一个 Stream 外壳冒充新契约。本次由新包拥有唯一串行调度状态机，以受监督的命令/资源/执行反馈更新状态，并单独维护 typed 事实流。
- `packages/pguide-regulate/src/regulation-process.ts`：现成 `createProcessRegulationRunner` 的 `start(input, resource)`、`result`/`abort`/`kill` 结构可注入；result 在清理和进程关闭后才 settlement，kill 等待 process tree 关闭。新核心包不依赖 CLI/profile/config，也不复制 worker；隔离 consumer 可注入既有 runner 或测试 runner。进程 capability/authorization callback 要适配为执行 ID 关联反馈，不能成为绕过命令授权的通道。

过渡依赖是可行性取舍，不代表新包交付旧 Planner/Coordinator 的薄适配。新包独立承担命令语义、单队列、依赖所有权、驻留和错误恢复，并以失败后继续处理有效命令的测试证明。日后抽取 helpers 或消解 Portfolio 属另一 IDEA。本次不新增公共持久化格式、CLI 接线、全局安装、npm 发布或现有包升级。

## 必要反例与验证边界

实施至少覆盖：空闲后加任务；同级排序/priority 更新；动态 capacity/能力/移除；P0 停止确认前不抢占槽位；两个 roots 共享 provider 后取消/替换其中一个；最后引用消失及整条依赖链回收；provider 达标后 consumer 再观察但尚未成功；自环/传递环；异步解析中取消；旧 generation 结果、旧来源/版本证据；权限和预算注入；失败后后续有效命令继续；abort/kill 失败与迟到终止；scope 清理和事件订阅生命周期。

部署验证只在仓库内隔离 consumer 安装本地打包产物及所需 workspace tarballs，核对 exports/types、真实运行和旧 Supervisor 回归；不依赖全局 pnpm link，不改变用户设备入口。没有产物或测试通过前，不预填任何完成证据。
