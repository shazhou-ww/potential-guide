# Coordinator 业务实体与聚合视图模型草案

本文支撑 [Idea.md](./Idea.md) 与 [Design.md](./Design.md)，不是独立验收合同或已发布 API。先区分业务实体、事实记录与状态投影，按 [五张图](./Diagrams.md) 讨论 RegulationRequests 和 CoordinatorState，再以 TypeScript 补充表达，最后从合法转换推导 Command/Event。[Events.md](./Events.md) 仅作覆盖检查，不反过来决定状态结构。

## 三个核心类型

- RegulationRequests：治理请求状态，按 RegulationTarget 保存最新 RegulationRequest，并维护请求序号水位；请求表达意图而不是已安排的 Task。
- ResourceAllocation：资源分配意图；binding 与期望并发度整体替换，不表示已经分配或已经停止调用。
- CoordinatorState：Coordinator 的完整领域状态，由 current singleton state 与若干 collection states 组成；集合可以表达历史、实体状态或聚合结果，不包含 Promise、进程句柄或调度器内部对象。

## 模型与视图约定

实体 ER 与状态视图是概念模型，不是物理数据库 schema。RegulationRequest 使用递增 requestSeq 单主键，不为整个请求集合设置快照 revision。CoordinatorSnapshot 表达一个 revision 下完整 CoordinatorState 的一致聚合，包含 current singleton 与 collections，不作为业务实体。快照表及成员复合键是后续存储映射问题，不混入业务实体关系图。ER 中 `||` 表示一个，`o|` 表示零或一个，`o{` 表示零到多个。

PK 表示模型中的逻辑唯一键，多列标为 PK 表示复合主键；FK 表示版本归属或对象引用。图中的 targetKey 是由精确 Objective 版本、来源和 subject 推导的身份，不要求在 TypeScript 值中重复保存。嵌套值可以展开成实体以说明关系，不意味着新增存储集合。尚未确定的记录键不虚构为 PK；可选字段、联合类型和跨记录约束由图后规则补充。

requestSeq 在同一个请求序列范围内唯一并按逻辑接收顺序递增，可跨 target 比较；它是请求身份与顺序，不是每个 target 的修订号，也不代表实际调用顺序。CoordinatorState.revision 则是该 Coordinator 内的状态逻辑时序，状态更新、确认和执行事实引用此版本空间；两者不可直接比较。同次 Coordinator 转换可改变多个 target，它们共享该版本。存储混合多个请求序列或 Coordinator 时需宿主提供外部作用域，不因此把实例 ID 加回领域状态。

## 统一业务实体模型

### 实体边界与身份假设

概念上从 Objective source → ObjectiveRevision → RegulationTarget → RegulationRequest 延伸到 RegulationRun 及 Observation、Fault；source 是字符串值，不单独建实体。ObjectiveRevision 表达固定定义版本，RegulationTarget 是该版本在特定 subject 上的投射，不是一次执行；RegulationRequest 是在特定逻辑时序上要求向 desiredLevel 推进的请求，不是 Task。真正有开始与终结的执行叫 RegulationRun，一个请求可能尚未执行，也可能涉及有限依赖编排中的多次调用。命名优先表达单个实体含义，不强制前缀继承父实体名称。

- **Objective source 标识来源。** source 必须标识 Git 仓库中的位置，表达仓库定位地址与仓库内相对路径；可以访问 HTTPS、SSH 或本地 Git 仓库，不要求整个 repo 就是一个 Objective。Git 语义由类型契约与校验保证，不添加 git+ 前缀，也不接受任意非 Git 文件目录。
- **ObjectiveRevision 使用单主键。** objectiveKey 是规范化 source 与固定 version 共同编码后的确定性哈希，标识一份精确定义版本，不再标识跨版本来源。version 是解析后的完整 Git commit object ID，同一 source 的不同 version 得到不同 key；保留 source 和 version 用于读取、追溯及校验，不能在原 key 下静默替换它们。
- **RegulationTarget 绑定精确 definition。** 每个对象只以 objectiveKey 一个外键引用 definition，再结合 subject 身份推导 targetKey，不重复保存 objectiveVersion 外键。同一 subject 使用另一个 definition version 会形成另一个治理对象；一份 definition 可以被多个对象共享。
- **RegulationRequest 表达历次请求。** requestSeq 是单主键，targetKey 仅是指向 RegulationTarget 的外键；desiredLevel、priority 属于请求，不属于 target 身份。同值新请求也获得新序号，不覆盖或修改旧请求记录。
- **每个 RegulationRun 必须且只属于一条 RegulationRequest。** Request 可以由外部提出，也可以由 Coordinator 因依赖编排产生；来源不同不形成两套实体。Run 只引用固定 requestSeq，由不可变 Request 推导 target 和 desiredLevel，不引用 target 的“最新请求”来解释旧调用。

这些实体表达业务边界，不强制建立 source 表、独立 Objective 目录服务或新的顶层状态集合。TS 可以嵌套实体值，物理存储也可以用外键；表示方式不能改变上述身份关系。ObjectiveRevision 的 version 是 Git commit 身份，与 CoordinatorState.revision 的数字逻辑时序不是同一个版本空间；objectiveKey 仍标识精确 ObjectiveRevision，本轮不另换主键协议。

### Git 来源与版本的设计不动点

- source 是字符串值，编码“仓库定位地址 + 仓库内相对路径”，不包含版本选择。内部路径相对于 Git 仓库根目录，不能依赖进程当前目录，也不能越出仓库；仓库地址与内部路径的分界必须无歧义，不能从普通 URL 猜测。具体字符串语法仍待确定，不引入 git+https、git+ssh 或 git+local 等前缀。
- version 是仓库级 commit 身份，不是路径内容哈希。branch、tag、HEAD 等可以作为解析入口，但必须解析成完整 commit ID 后才成为 definition version；读取的是该 commit 下指定路径的内容，路径或定义不存在须明确报错。本地未提交修改不属于此版本，不能用工作区内容冒充固定 commit。
- 仓库其他路径的变更也可能产生新 commit，因此同一 Objective 内容可能对应不同 definition version；此模型不自动按路径内容去重。
- objectiveKey = Hash(Encode(Canonicalize(source), resolvedCommitId))，必须同时包含 source 和 version。Encode 必须无歧义，不能简单拼接字符串；规范化、元组编码、哈希算法及输出编码须由统一协议固定，不能由调用方自由选择。具体算法与规则尚未选定，不在本文假定 SHA-1、SHA-256 或某种编码。
- HTTPS、SSH、本地地址即使访问同一仓库，也不天然是相同 source。没有明确等价/别名规则时不自动合并；不得通过丢弃主机、路径等身份信息制造相同 key。source/version 与 key 必须一致，哈希碰撞不得静默合并定义。查询同一来源的全部版本可按规范化 source 筛选，不另建 sourceKey。
- source 不嵌入密码或 token，认证由外部提供；凭据变化不应成为 Objective 身份变化。解析协议与现有 Git 来源结构的适配留待实施，不声称运行时代码已经支持本设计。

三层实体及其执行事实关系见 [图 1：业务实体关系](./Diagrams.md#1-业务实体关系)，请求的最新映射与确认投影见 [图 2：请求与确认视图](./Diagrams.md#2-请求与确认视图)。图源统一维护在 Diagrams.md，避免实体身份、快照成员和投影关系混在一张 ER 图中。

- **请求序号是身份。** REGULATION_REQUEST 以 requestSeq 为单主键，同值新请求也获得新序号。RegulationRequests.latestByTarget 是每个 target 最新请求的映射，不是历史请求表的全部内容；覆盖映射不改写旧请求，历史保留策略另定。
- **target 身份决定覆盖范围。** A 的新请求只替换 A 的最新请求，不改变 B 的请求；不同 Objective 定义或 subject 不能静默合并。desiredLevel 和 priority 属于请求，不属于 target。REGULATION_TARGET 是共享身份值，不新增独立顶层状态。
- **序号不是数组下标。** requestSeq 为正安全整数，按逻辑接收顺序单调分配，可有空号，删除历史也不重排或复用；耗尽显式失败。并发写入须保证分配和接收/持久化一致，不能把普通数据库自增 ID 自动当成事务提交顺序。
- **只表示期望。** 同 priority 按 requestSeq 升序，不用确认时间或 Probe 更新时间排序。确认、调度和实际调用顺序另由 Coordinator 表达，未就绪请求并不保证先执行。

## Coordinator 状态分图导航

以下五张图的源、分类边界和解释见 [Diagrams.md](./Diagrams.md)。第一张统一表达上游 intention 和下游 state 涉及的业务实体，其余为聚合视图；不再分别维护请求侧和状态侧的实体模型，也不把每个集合连到 snapshot 实体上。

| 图 | 阅读问题 | 独立 SVG |
| --- | --- | --- |
| 1. 业务实体关系 | 定义、指向物、请求、调用及事实如何关联？ | [实体关系](./diagrams/regulation-target.svg) |
| 2. 请求与确认 | 最新提交与已确认请求有何区别？ | [请求视图](./diagrams/request-state.svg) |
| 3. 单个 Target 状态 | 最近 Probe 与当前有效证据有何区别？ | [Target 状态](./diagrams/target-state.svg) |
| 4. 当前执行与依赖 | 哪些调用占用资源，哪些依赖仍有效？ | [执行视图](./diagrams/execution-state.svg) |
| 5. 意图与状态聚合总览 | 请求、资源意图、完整状态及持久化边界如何关联？ | [聚合总览](./diagrams/coordinator-state.svg) |

- 实体和事实具有业务身份或发生意义；ActiveRegulationRun/RegulationRunRecord 是同一次 RegulationRun 的不同生命周期表达，不是两个实体。
- 已确认请求、target 聚合、有效证据可以是持久化权威投影；“视图”不意味着只读 UI 查询或能从现有实体表任意重算。
- 当前依赖是已采用的业务关系；资源确认、预算和生命周期是控制状态。实际占用可由尚未确认退出的调用推导，累计预算不能从裁剪后的历史求和。
- CoordinatorSnapshot 是完整 CoordinatorState 在某个 revision 的一致聚合，不只是 current singleton，也不是新业务实体。业务实体图不表达物理快照成员键。
- 快照归属与事实更新时间不同。依赖、Observation/Fault 的独立身份及存储成员键仍待推导，不为了绘图虚构主键或要求永久保留历史父行。

## 完整状态、Singleton State 与 Collection State

CoordinatorState 是领域状态，不是 CoordinatorReadView 或某次查询的结果。current 是一个 singleton state，用单一对象表达 Coordinator 的当前整体状态；其余 collection states 用记录集合表达多个实体、历史明细或聚合结果。singleton/collection 区分的是状态组织形式，不是现在/过去。累计预算和尚未解除的依赖虽然由过去产生，仍影响当前运行；完整终结结果和诊断明细不因此塞进 current。

Collection<T> 表达领域中的记录集合，选用 Collection 而不是 Table 或 Relation，避免暗示 UI 表格、具体数据库或关系代数接口。QueryResult 是对 Collection 按条件筛选、排序、分页后的派生结果，不属于权威状态，也不把某次查询条件写入 Collection 的定义。

下面暂用 readonly T[] 表达 Collection 的逻辑内容，便于讨论纯归约；不规定物理存储、索引、查询 API、分页或保留策略，也不要求把完整集合加载进内存或随 current 一起传输。它不是把分页查询返回的一小段数组冒充完整集合。

正在进行的 RegulationRun 进入 current.activeRuns，不再用 Task 包装排队、执行和终结的完整生命周期。调用确认结束时，从活跃集合移除并向 runs 写入终结记录；同一事件对 singleton 与 collections 的变化须保持一致。UI 可分别读取 current 对象和查询各个 Collection，实时 Stream 本身不提供持久化或历史查询保证。

例如 regulationTargets 是按精确对象身份维护的聚合状态集合，每个对象一条记录，包含它最后一次 Probe 的时间和结果，而不是每次 Probe 都增加一行的历史表。runs 则示范终结记录集合，两者都是 collection state，不使用 history 分组来限定所有集合的含义。

## TypeScript 补充表达

下面的可独立类型检查代码块表达最新请求映射、序号水位与某一个 Coordinator revision 下的状态值，补充各图中的值类型、可选性与联合分支。CoordinatorState 外层 revision 提供快照作用域，不在每个条目重复 coordinatorRevision；requestSeq 属于独立的请求序列。ObjectiveObservation 暂以导入别名复用已有 PilotObservation 的结构，表示拟采用的领域名称，不声称运行时包已导出新名称；binding 也复用已有类型，不复用旧五命令、资源池或 harness 权限类型。别名暂用普通 string/number；合法标识、有限 JSON、安全整数及引用完整性仍需运行时验证。

```typescript
import type {
  PilotObservation as ObjectiveObservation,
  Subject,
} from "@potential-guide/objective-pilot";
import type { AgentBinding } from "@potential-guide/objective-regulator";

export type { ObjectiveObservation };

export type Revision = number;
export type RequestSeq = number;
export type ObjectiveSource = string;
export type ObjectiveKey = string;
export type TargetKey = string;
export type RegulationRunId = string;
export type Collection<T> = readonly T[];

export interface ObjectiveRevision {
  readonly key: ObjectiveKey;
  readonly version: string;
  readonly source: ObjectiveSource;
}

export interface RegulationTarget {
  readonly objective: ObjectiveRevision;
  readonly subject: Subject;
}

export interface RegulationRequest {
  readonly target: RegulationTarget;
  readonly desiredLevel: string;
  readonly priority: number;
  readonly requestSeq: RequestSeq;
}

export interface RegulationRequests {
  readonly lastRequestSeq: RequestSeq;
  readonly latestByTarget: Readonly<Partial<Record<TargetKey, RegulationRequest>>>;
}

export interface AcknowledgedRegulationRequest extends RegulationRequest {
  readonly acknowledgedAtRevision: Revision;
}

export type ResourceAllocation =
  | { readonly kind: "no-resource" }
  | {
      readonly kind: "configured";
      readonly binding: AgentBinding;
      readonly concurrency: number;
    };

export interface AllocationAcknowledgement {
  readonly revision: Revision;
  readonly value: ResourceAllocation;
}

export interface Fault {
  readonly stage:
    | "input"
    | "resolve"
    | "start"
    | "execution"
    | "observation"
    | "stop"
    | "release"
    | "persistence"
    | "recovery"
    | "infrastructure";
  readonly message: string;
  readonly runId: RegulationRunId | null;
}

export type ActiveExecution =
  | {
      readonly phase: "running";
    }
  | {
      readonly phase: "stopping";
      readonly reason: string;
    };

export interface RegulationRunContext {
  readonly id: RegulationRunId;
  readonly requestSeq: RequestSeq;
  readonly binding: AgentBinding;
}

export interface ActiveRegulationRun extends RegulationRunContext {
  readonly recoveryRef: string | null;
  readonly execution:
    | ActiveExecution
    | {
        readonly phase: "unverified";
        readonly lastKnown: ActiveExecution;
      };
}

export interface CurrentDependency {
  readonly consumer: RegulationTarget;
  readonly provider: RegulationTarget;
  readonly minimumLevel: string;
}

export interface Observation {
  readonly runId: RegulationRunId;
  readonly value: ObjectiveObservation;
}

export type RegulationRunOutcome =
  | { readonly kind: "target-reached" }
  | { readonly kind: "blocked"; readonly reason: string }
  | {
      readonly kind: "exhausted";
      readonly limit: "time" | "agent-runs" | "stall" | "agent-limit";
    }
  | {
      readonly kind: "cancelled" | "superseded";
      readonly reason: string;
    }
  | { readonly kind: "error"; readonly fault: Fault };

export interface RegulationRunRecord extends RegulationRunContext {
  readonly endedAtRevision: Revision;
  readonly outcome: RegulationRunOutcome;
}

export interface ObservationRecord {
  readonly recordedAtRevision: Revision;
  readonly observation: Observation;
}

export interface FaultRecord {
  readonly reportedAtRevision: Revision;
  readonly fault: Fault;
}

export interface ProbeSummary {
  readonly probedAt: string;
  readonly recordedAtRevision: Revision;
  readonly runId: RegulationRunId | null;
  readonly result:
    | { readonly kind: "observed"; readonly observation: ObjectiveObservation }
    | { readonly kind: "error"; readonly fault: Fault };
}

export interface RegulationTargetState {
  readonly target: RegulationTarget;
  readonly updatedAtRevision: Revision;
  readonly lastProbe: ProbeSummary | null;
}

export interface Budget {
  readonly maxStarts: number;
  readonly maxAgentRuns: number;
  readonly maxDurationMs: number;
}

export interface BudgetReservation {
  readonly starts: number;
  readonly agentRuns: number;
  readonly durationMs: number;
}

export interface ExecutionConstraints {
  readonly budget: Budget;
  readonly quota: {
    readonly timeoutMs: number;
    readonly maxAgentRuns: number;
    readonly maxStallRuns: number;
  };
  readonly agentTimeoutMs: number;
}

export type CoordinatorLifecycle =
  | { readonly phase: "recovering" | "open" | "closing" }
  | {
      readonly phase: "closed";
      readonly cleanupFailures: number;
    }
  | {
      readonly phase: "failed";
      readonly fault: Fault;
    };

export interface CoordinatorCurrent {
  readonly acknowledged: {
    readonly requests: {
      readonly latestByTarget: Readonly<
        Partial<Record<TargetKey, AcknowledgedRegulationRequest>>
      >;
    };
    readonly allocation: AllocationAcknowledgement;
  };
  readonly activeRuns: readonly ActiveRegulationRun[];
  readonly dependencies: readonly CurrentDependency[];
  readonly observations: readonly Observation[];
  readonly constraints: ExecutionConstraints;
  readonly reserved: BudgetReservation;
  readonly lifecycle: CoordinatorLifecycle;
}

export interface CoordinatorState {
  readonly revision: Revision;
  readonly current: CoordinatorCurrent;
  readonly requests: Collection<RegulationRequest>;
  readonly regulationTargets: Collection<RegulationTargetState>;
  readonly runs: Collection<RegulationRunRecord>;
  readonly observations: Collection<ObservationRecord>;
  readonly faults: Collection<FaultRecord>;
}

export type Reducer<Delta, State> = (delta: Delta, state: State) => State;

export type RegulationRequestsReducer<Command> =
  Reducer<Command, RegulationRequests>;

export type CoordinatorStateReducer<Event> =
  Reducer<Event, CoordinatorState>;

export interface CoordinatorCheckpoint {
  readonly requests: RegulationRequests;
  readonly coordinator: CoordinatorState;
}
```

## 意图身份与确认

ObjectiveKey 是规范化 Git source 与完整 commit ID 的无歧义编码的确定性哈希；TargetKey = Hash(Encode(objectiveKey, subjectIdentity))，不再额外编码 objectiveVersion，具体规范仍待确定。它不是任意 regulation ID，也不能直接依赖普通 JSON 属性顺序。latestByTarget 按 targetKey 索引，value 是包含 target、desiredLevel、priority、requestSeq 的 RegulationRequest。RegulationTarget 不重复存 key；恢复和输入验证须核对 source/version 与 objectiveKey、target 与 targetKey 一致，哈希碰撞不能静默合并不同来源、版本或 subject。

TS 中的 ObjectiveRevision 独立表达定义实体的身份与来源字段，暂不展开定义正文；RegulationTarget.objective 嵌套此值不表示必须重复存储它。该 source 字符串是本模型的领域来源标识，不照搬现有 GitObjectiveSource 传输结构；未来实现须明确与解析协议的适配。objectiveId 若作为名称保留，不构成另一套身份。

Partial 表达并非每个 TargetKey 都有条目，索引结果为 RegulationRequest | undefined。readonly latestByTarget 限制属性重新赋值，Readonly 限制条目的增删替换；这些是编译期约束，不是运行时冻结或递归不可变保证。只将对象自身属性视为请求条目，查询须区分缺失 key 与原型链属性，构造和恢复不能让特殊 key 改变对象原型。

RegulationRequests 不含集合快照 revision，lastRequestSeq 仅保存请求身份分配水位，不能从当前保留条目的最大值重新计算。RegulationRequest.requestSeq 唯一定位一条请求；CoordinatorState.revision 标识状态转换。RegulationTargetState.updatedAtRevision 和 AcknowledgedRegulationRequest.acknowledgedAtRevision 引用 Coordinator 版本，与 requestSeq 分属两个序列。

外部请求与依赖派生请求共用 requestSeq 身份空间及同一分配水位，不能各自从独立的 lastRequestSeq 发号。内部编排先作出请求决策，再进入串行化的请求形成流程；纯 reducer 不自行发现依赖或执行调度。内部请求的来源与当前 consumer 需求归属必须可追溯，具体关联类型及共享策略仍待细化。

在当前纯 reducer 草案中，每条合法的新请求形成命令（外部提出或内部派生）按以下规则归约：

1. 取 state.lastRequestSeq + 1 作为新 requestSeq，首次为 1；安全整数耗尽显式失败，不读取系统时间或数据库。
2. 创建新的请求及 latestByTarget 映射，只替换对应 targetKey 的最新请求；其他条目不变，不修改旧状态或历史请求。
3. 返回新的 RegulationRequests，并推进 lastRequestSeq。同值新命令仍分配新序号；非法输入明确反馈，不静默修改状态。

例如依次接收 A、B、A 的请求，requestSeq 为 1、2、3；最新映射为 A→3、B→2，水位为 3。允许序号有空号但不重用，清理历史或最新映射不降低水位。这里的 +1 是确定性归约方案，不是要求物理数据库无空号；若改由外部序列分配器发号，须让命令携带固定序号并明确校验和恢复协议，不能把分配副作用藏进 reducer。宿主须串行化或事务化同一序列的接收与持久化，防止并发分配重复身份；重放同一前缀不产生新身份，消息重投与新命令的区分仍须接续协议明确。

调用直接以 requestSeq 引用请求，不再需要 targetKey 加 revision 的 RequestRef。CoordinatorState.current.acknowledged.requests.latestByTarget 逐 target 保留已确认请求及 acknowledgedAtRevision，checkpoint.requests 则是请求形成流程的当前状态，两者允许暂时不同；确认不代表启动或完成调用。两个位置不能独立分配序号，内部派生也必须经过同一身份分配路径，具体 actor 接入与消息原子边界仍待细化。资源输入没有 delta 协议，AllocationAcknowledgement.revision 表达采纳时的 Coordinator 版本，初值为 0，不另建计数器。完整状态 revision 关联 current singleton 与各个 Collection，不是查询页或底层日志位置。

CoordinatorState.requests 按 requestSeq 唯一保留已纳入状态的不可变请求，包含外部与内部来源。latestByTarget 只是最新映射，不能承担旧 Run 的引用解析；采纳请求时保存其完整内容，再允许对应 Run 出现。独立 reducer 从状态中的请求记录解析 target/desiredLevel，不读取外部最新输入或私有缓存。缺失请求、同序号异内容或不匹配的执行引用必须明确拒绝；恢复不能用最新请求补齐旧引用。保留的 Run、Observation 或有效依赖仍需要某条 Request 时不得将其裁剪为悬空引用；归档与保留协议另定。

命令关联 ID、非法输入回执、拒绝原因以及是否需要逐对象确认应在转换讨论中补足；不能把遗漏字段解释为允许静默丢弃请求。revision 也不等于底层消息位置，不能用它代替外部输入的可靠接续协议。

## 映射与优先顺序

请求按 priority 升序、requestSeq 升序排序，不使用 acknowledgedAtRevision、updatedAtRevision 或墙钟时间。例如 A(priority 1, seq 10)、B(1, 12)、C(0, 15) 排为 C、A、B；A 的新请求为 seq 16 后排为 C、B、A。仅 priority 改变也产生新请求序号，但不等于重启调用；重复确认同一请求和 Probe 更新不改变排序。即使多个请求在同一 Coordinator revision 被确认，其 requestSeq 仍区分先后。

映射加上述排序表达意图的优先队列视图，不是已就绪的实际执行队列。Coordinator 仍须结合当前待处理需求、实际调用和依赖决定可执行项；initial 意图不推进，已终结的同一意图不因扫描或恢复被重新执行。派生需求的有效 priority、共享 provider 请求的形成或复用，以及外部与内部需求作用于同一 target 时的合并/覆盖规则仍须细化；latestByTarget 不是所有有效需求来源的集合，不能因最新映射被覆盖就丢失仍有效的 consumer 归属。

## 当前调用、意图进度与依赖

ActiveRegulationRun 只表示已经发起且尚未确认结束的一次调用。requestSeq 必填且固定关联一条已记录的 RegulationRequest，binding 捕获实际执行接入；新请求不改写旧调用身份或请求归属。不再同时维护 TaskId 与 RunId 两套执行身份。RegulationRequest 表达治理要求，不限定为外部输入，不替代当前执行或 pending 状态，也不要求每条请求恰好对应一次调用。

Run → Request → Target 以及 Request → desiredLevel 是模型不变量，因此 Run 不重复保存 target 和 desiredLevel，也没有直连 Target 的关系。依赖派生路径同样是：consumer Run 返回依赖并终结 → Coordinator 采纳需求 → 形成或按明确规则复用 provider Request → 调度 → provider Run。provider Request 必须表达 provider 自己的 target、desiredLevel、priority 与 requestSeq，不能借用 consumer Request。共享或聚合改变执行目标时形成新的不可变请求，不改写旧 Request 或旧 Run；没有外部请求不等于可以没有 Request。

Observation 仅以 runId 关联来源 Run，经 Run → Request → Target 推导治理对象，不重复保存 target。Fault 保留可空 runId，覆盖输入、持久化或恢复等非运行故障，不强制拆成 RunFault。运行历史裁剪或分开存储时必须保留足够的来源关联，使观察仍可解析到准确 target；可以采用明确的归档/查询投影，但不能静默丢失语义。

current.activeRuns 只有 running、stopping 和恢复后尚未核实的 unverified，不含 pending 或 ended。停止请求不移除调用；确认退出后，通过明确的终结事件移除调用、写入 runs，并原子更新仍影响当前运行的信息。RegulationRunRecord 保留启动身份、实际 binding 和终结结果，不包含活跃执行状态；达标仍须有效证据支持。启动前撤销、initial 或未产生外部调用的启动失败不伪造一次 RegulationRun，其意图处理事实的记录类型留待转换设计。启动副作用与持久化之间的故障窗口仍须由恢复协议覆盖，不能因尚未确认启动就漏记可能存在的外部执行。

pending 是尚未执行的当前需求，不预先包装成覆盖完整生命周期的 Task。本稿撤回 processedIntents 这一按对象保存历史处理水位的具体字段，不假定它是当前切片的必需组成。新意图如何进入待处理需求、何时完成或被覆盖、恢复时如何可靠接续，仍须从合法转换推导；不能因为已确认目标仍存在且活跃集合为空，就重新创建需求。历史 Collection 的存在也不自动解决无调用的意图处理记录或输入去重。旧反馈不得完成新意图，有限依赖尚未完成时不得过早结束整个需求；本稿不声称待处理状态类型已经完整。

CurrentDependency 暂以精确 consumer/provider target 和最低 level 表达仍有效的需求关系，不引用必须永久保存的历史 Task。关系须合法、无环且锚定当前未完成需求；需求覆盖或完成时撤销无用边，共享 provider 仍被引用时保留。blocked 调用已经结束，其完整结果进入 runs，current 只提取继续编排必需的当前关系和证据。provider 的结果只能支持新的 consumer 调用，不能复活旧调用。边的 requestSeq 归属、真实执行身份、共享聚合和满足条件仍须在转换设计中细化，本类型不是已定案的依赖协议。

## 对象聚合状态

regulationTargets 表达 Coordinator 已知对象的集合，而不是扫描所有可能外部对象的保证。集合内按规范化 Objective/subject 身份唯一；对象进入集合的时机、失去当前需求后是否保留及移除规则仍待转换设计，不能因缺少活跃调用就认定对象不存在。

updatedAtRevision 表达该对象聚合最近实际改变的 Coordinator 版本，新增对象也记录当次版本；未改变的对象跨快照沿用原值。它不是意图确认时间、Probe 实际时间或对象独立计数器，不因其他对象或仅资源状态变化而刷新。

lastProbe 为 null 表示没有已知 Probe 结果，不伪造时间、成功或 level initial。ProbeSummary 记录实际 Probe 时间、采纳修订、来源调用及结果；probedAt 须由事实提供并验证为 RFC 3339 时间，不在 reducer 中读取系统时钟。最后一次 Probe 失败也须如实表达，不沿用旧成功结果冒充最新结果；当前调度仍需要的成功证据由 current.observations 按自己的有效性规则保留。

“最后一次”必须按明确的 Probe 身份和顺序确定，不按集合枚举顺序、任意生产者时钟或晚到消息的采纳时间猜测；并发、过期反馈和跨重启排序规则仍待推导。recordedAtRevision 只表达采纳顺序，不自动等于实际 Probe 先后。最近一次观察是有时间和来源的已知事实，不承诺对象此刻未发生变化。该聚合由同一事实流确定性更新，不是前端临时查询出来的页面。

## 权威状态与推导值

- ResourceAllocation 的 no-resource 是合法的无资源分配意图，也是输入 Behavior 的初值；不是输入缺失、错误或 dummy binding。configured 表达 binding 与非负安全整数 concurrency，允许 concurrency 为 0 以保留配置。采纳 no-resource 不代表实际调用已停止或占用归零。
- acknowledged.allocation 表达期望，ActiveRegulationRun.binding 表达实际使用；改变前者不修改后者。确认 concurrency 从 4 变为 2 后，实际占用仍可为 4，停止策略不由这个类型自动规定。
- 实际占用从 running、stopping 和尚未核实的 unverified 调用推导，不另存一个可能漂移的 activeCount。未核实调用在确认退出前保守保留占用。
- current.observations 只保留当前调度或有效依赖仍需要的最新成功观察，不作为所有曾访问对象的缓存；失去当前用途时显式移除，不因此删除 observations 的历史记录或 regulationTargets 中的对象摘要。没有当前条目表示未知，不等于 initial。旧调用和错误 envelope 不可作为当前成功观察写入。
- reserved 是累计权威预留，不能仅从当前调用数重算；启动抛错也可能已经预留。limits 来自可信配置，持久化副本用于核对恢复上下文，不允许快照自行扩充限制。
- current 不以 lastFault 保存最近一次历史诊断；诊断记录进入 faults，输入校验、传输和非终结故障仍须明确对外反馈。持续影响当前运行的故障由相应服务或执行状态表达，服务 failed 可以保留当前故障原因。
- collection states 是权威领域状态的一部分，不是对事件存储的一次查询结果，也不要求复制所有原始消息。实体、聚合及历史都可以用集合表达；消息历史与各个 Collections 的持久化映射、记录键、保留策略及是否还需其他集合，留待具体转换与存储协议确定，查询分页不能改变逻辑集合内容。
- 无 resource ID、capabilities、requirements 或 grants/ceiling。AgentBinding 的配置只能使用可持久化的非秘密数据或安全凭据引用，真实资源自行授权；配额和预算仍独立约束执行。

## 初值、恢复与下一步

新建 RegulationRequests 为 { lastRequestSeq: 0, latestByTarget: {} }，没有集合快照 revision。新建 CoordinatorState 的 revision 为 0，current.acknowledged.requests.latestByTarget 为空，current.acknowledged.allocation 为 { revision: 0, value: { kind: "no-resource" } }；当前活跃调用、依赖和观察为空，reserved 全零、服务 open，可信 constraints 由宿主提供；各个 Collections 均为空。这是已知初始基线，不声称收到过外部资源更新；后续采纳资源更新记录当次 Coordinator revision，初值不启动调用。

CoordinatorState 不含 instanceId 或 inputs。Coordinator 身份由宿主、存储 key 或传输 envelope 关联，不能与调用 RegulationRunId 混为一谈；是否另需恢复代次由执行协议决定。输入通道的 open/ended/failed、连接与重连属于适配层；通道结束或断开不撤销目标、不把资源意图变为 no-resource，也不自动取消调用或关闭服务。真正影响服务继续运行的故障以明确诊断和相应服务生命周期变化表达。

CoordinatorCheckpoint 仅封装两份领域状态，不固定日志方案或存储格式。需验证对象唯一性、修订与引用一致性及可信约束，不能把任意时刻分别读取的两个 state 拼成“原子快照”，也不能把 current 和来自不同版本的 Collections 拼成一致状态。持久化适配层可以分开存储 singleton 与各个 collections，但须保证共同的逻辑 revision 和原子转换。若采用快照加日志重放，由适配层在外层封装与快照一致的 command/event 处理位置，并负责可靠接续；不预设两个 string | null 字段，也不默认领域 revision 就是日志位置。恢复先还原状态，采用增量回放时只做纯归约，再以 recovering/unverified 核实外部运行，不清空预算、不重放动作、不把同一已终结意图当新请求；格式版本、重关联协议和存储失败行为待实施时明确。

请求 requestSeq、分配水位 lastRequestSeq 与 Coordinator revision、target 更新时间及确认时间须一致保存，各自在原序列空间继续，不重置或互相代替。Record 使用普通 JSON 对象表达；仍须校验值可持久化、key 与 target 一致、请求序号唯一且不超过分配水位，缺失条目用属性不存在表达，不写入 undefined。清理历史不重用旧 requestSeq，具体快照格式仍待确定。

下一步先明确当前待处理需求和输入接续，检查 current 是否足以调度和恢复，并收敛 Collection 记录身份、依赖归属及终结时当前切片与历史写入的原子更新，再列合法状态转换，最后推导 Command/Event。本稿的 string 原因、诊断粒度、恢复字段及数据结构均为讨论选择，不作为最终 API 或已验收决定。
