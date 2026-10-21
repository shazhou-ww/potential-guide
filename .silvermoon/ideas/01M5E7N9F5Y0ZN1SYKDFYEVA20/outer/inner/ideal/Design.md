# Coordinator 已确认语义与复用决策

本文支撑本 IDEA 的方向卡，记录基础调度模型及影响可行性的决策，不是第二份验收合同。总讨论入口为 [schema-contracts / Schemas.md](../../../../01M5CR0X2B4R2C6K3183Y1T3SQ/outer/inner/ideal/Schemas.md)。以下语义已经用户确认，不再作为待定建议；具体类型字段和模块划分留给实施阶段。

## 公共边界与驻留

- FRP 入口的第一参数是资源池 Behavior；沿用 `@potential-guide/effects` 的 `SubscriptionRef` 表达随时间变化的当前值，`Stream` 表达命令和事实。可信构造配置包含 runner、精确来源解析器、权限上限、预算、并发及终止策略，不混入业务命令。
- 一个 scoped Coordinator 实例拥有一个内部 priority queue、执行集合和依赖图。没有 `Map<QueueId, Queue>`，也不接受 queue snapshot 或 dependency graph 输入。调用者增加、替换、取消 Regulation 或改变 priority；输出的是已接受、已拒绝、已启动、依赖发现、阻塞、结果、停止等已发生事实，而非指令回声。
- 接口由 scope 管理唯一调度循环和订阅；多个事件消费者不创建多个调度器。空队列及正常命令流结束不关闭服务；资源后续变化和运行中的后续反馈仍有效。显式 scope 关闭才停止接收，终止执行并等待清理。订阅与缓存策略须在实施中说明并测试：不以无限历史数组代替事件流，也不静默丢失在订阅期内必须交付的事实。
- 业务 ID、命令关联 ID、需求 generation、执行 ID 和事件顺序可追踪。替换改变 generation，priority 变化不冒充新工作；过期命令或未知对象产生拒绝事件而不改状态。优先级采用非负整数，小者优先、同级 FIFO，避免没有理由地另造排序模型。

## 依赖发现与所有权

- 只有当前 Regulation 返回 `dependency-required` 才建立等待边和派生工作；不得先借 Planner 周期 observe 预展开整张图。复用 Regulation 自己的观察/重观察闭环；provider 达标只唤醒 consumer 再运行、重新观察，绝不把 provider 的成功当作 consumer 的成功。
- 等待边保留 consumer generation、provider 的 Objective/subject/精确版本与来源、最低 level。共享只发生在相同执行身份及兼容来源/权限边界内，聚合消费者所需的最强 level、最高 priority 和能力约束；不以仅含 Objective URI 与 subject 的旧 key 混合不同版本或信任域。
- 当前 roots 是可达性锚点。取消或替换 root 时移除其旧等待边，再按存活 roots 的可达性回收无引用派生工作，包括下游链条；共享 provider 及仍为 root 的 provider 保留。无引用但仍运行的工作先停止、确认终止后才释放资源；解析得到的来源句柄也必须成对释放。
- 验证 handoff 的成功 envelope、consumer generation、Objective/version/source、dependencies 与观察中的 problems 一致，以及 provider subject/level 合法。异步解析完成前后均校验 generation；旧执行结果或旧版本证据不得改变新图或完成新需求。来源冲突、缺少精确版本、非法证据明确失败，而不是退回 latest。
- 新边先在候选图检查自环和传递环，通过后原子安装；拒绝时不留下半张图。事件标明受影响 consumer 和原因，其他独立工作继续。消费者通过替换或显式重试恢复，而不是服务 crash 或无限自动重试。

## 资源、生命周期与失败

- 动态校验资源 ID、binding、capacity 和 capabilities；合法资源变化唤醒调度，能力不匹配/无容量明确呈现。无效更新产生资源失败事件并停止新分配，直到合法快照恢复，不静默沿用可能已撤销的权限或能力。
- 全局并发和每资源容量均计算 running 与 stopping。资源移除、binding/能力失效及容量收缩触发必要的停止；超额期间禁止新增。P0 可复用既有最少受害者抢占规则，停止中的执行仍占槽位，不重复选作受害者。
- runner.start 抛错、result 拒绝、abort 抛错、kill 拒绝与正常业务阻塞分别转换为可归属事件。abort 只是请求；result settlement 必须代表执行实际结束，或等待 kill 的终止确认，之后才释放槽位。kill 失败保留占用并报告，不能假装停止成功；后续实际结束仍可完成清理。关闭也不虚报清理完成。
- expected failures（命令校验、资源更新、解析/观察、授权/能力不足、依赖、执行和清理失败）在事实流中明确呈现，不传播成顶层退出。只有未处理的缺陷、不可恢复的服务基础设施失败属于 crash；不得把一切异常吞成成功。命令流/资源流异常亦须被监督和明确报告，不能悄悄让调度 fiber 消失。
- 权限和预算取可信构造配置；派生工作没有新增授权，命令中注入 grant/ceiling/budget 被拒绝。授权不足挂起并发事件，不通过自动 continuation 绕过。耗尽、执行失败采用有界、可追踪的重试策略，不能无限提升 stall allowance 或重置总预算；具体默认退避在实施中用测试固定，显式 retry 也受剩余可信预算限制。

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
