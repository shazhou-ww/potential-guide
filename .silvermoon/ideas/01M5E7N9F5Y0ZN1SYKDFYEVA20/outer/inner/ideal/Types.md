# Coordinator 核心数据类型草案

本文支撑 [Idea.md](./Idea.md) 与 [Design.md](./Design.md)，不是独立验收合同或已发布 API。以下使用 TypeScript 将讨论对象具体化；先讨论两个 state 与资源意图，再从合法转换推导 Command/Event。旧 [Events.md](./Events.md) 中的分类仅作覆盖检查，不反过来决定状态结构。

## 三个核心类型

- RegulationTarget：治理目标意图的状态；包含多个 Objective/subject 的最新意图及发生修订。
- ResourceAllocation：资源分配意图；binding 与期望并发度整体替换，不表示已经分配或已经停止调用。
- CoordinatorState：Coordinator 已确认输入及实际执行的可观察状态；不包含 Promise、进程句柄或调度器内部对象。

下面是一个可独立类型检查的代码块。复用已有协议的对象、观察与 binding 数据类型，不复用旧五命令、资源池或 harness 权限类型。所有别名暂用普通 string/number；合法标识、有限 JSON、非负安全整数、引用完整性等仍需运行时验证，不能因 TS 通过便视为有效输入。

```typescript
import type {
  GitObjectiveSource,
  PilotObservation,
  Subject,
} from "@potential-guide/objective-pilot";
import type { AgentBinding } from "@potential-guide/objective-regulator";

export type Revision = number;
export type ObjectKey = string;
export type TaskId = string;
export type RunId = string;

export interface RegulationObject {
  readonly objective: {
    readonly id: string;
    readonly version: string;
    readonly source: GitObjectiveSource;
  };
  readonly subject: Subject;
}

export interface IntentRef {
  readonly objectKey: ObjectKey;
  // 引用 TargetIntent.updatedAtRevision，属于 RegulationTarget 的全局版本空间。
  readonly revision: Revision;
}

export interface TargetIntent {
  readonly object: RegulationObject;
  readonly targetLevel: string;
  readonly priority: number;
  readonly updatedAtRevision: Revision;
}

export interface RegulationTarget {
  readonly revision: Revision;
  readonly intents: Readonly<Partial<Record<ObjectKey, TargetIntent>>>;
}

export interface ResourceAllocation {
  readonly binding: AgentBinding;
  readonly concurrency: number;
}

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
  readonly taskId: TaskId | null;
  readonly runId: RunId | null;
}

export interface Run {
  readonly id: RunId;
  readonly binding: AgentBinding;
  readonly intent: IntentRef | null;
  readonly targetLevel: string;
  readonly recoveryRef: string | null;
}

export type ActiveExecution =
  | {
      readonly phase: "running";
      readonly run: Run;
    }
  | {
      readonly phase: "stopping";
      readonly run: Run;
      readonly reason: string;
    };

export type TaskOutcome =
  | { readonly kind: "target-reached" }
  | {
      readonly kind: "blocked";
      readonly reason: string;
    }
  | {
      readonly kind: "exhausted";
      readonly limit: "time" | "agent-runs" | "stall" | "agent-limit";
    }
  | {
      readonly kind: "cancelled" | "superseded";
      readonly reason: string;
    }
  | {
      readonly kind: "error";
      readonly fault: Fault;
    };

export type TaskExecution =
  | {
      readonly phase: "pending";
      readonly reason: string | null;
    }
  | ActiveExecution
  | {
      readonly phase: "unverified";
      readonly lastKnown: ActiveExecution;
    }
  | {
      readonly phase: "ended";
      readonly run: Run;
      readonly outcome: TaskOutcome;
    }
  | {
      readonly phase: "ended";
      readonly run: null;
      readonly outcome: Exclude<TaskOutcome, { readonly kind: "target-reached" }>;
    };

export interface TaskDependency {
  readonly providerTaskId: TaskId;
  readonly minimumLevel: string;
}

export interface Task {
  readonly id: TaskId;
  readonly object: RegulationObject;
  readonly intent: IntentRef | null;
  readonly previousTaskId: TaskId | null;
  readonly targetLevel: string;
  readonly priority: number;
  readonly dependencies: readonly TaskDependency[];
  readonly execution: TaskExecution;
}

export interface ObservedObject {
  readonly object: RegulationObject;
  readonly runId: RunId;
  readonly value: PilotObservation;
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

export type InputState =
  | { readonly phase: "open" | "ended" }
  | {
      readonly phase: "failed";
      readonly fault: Fault;
    };

export interface CoordinatorState {
  readonly instanceId: string;
  readonly revision: Revision;
  readonly acknowledged: {
    readonly targets: RegulationTarget;
    readonly allocation: AllocationAcknowledgement | null;
  };
  readonly inputs: {
    readonly targets: InputState;
    readonly allocation: InputState;
  };
  readonly tasks: readonly Task[];
  readonly observations: readonly ObservedObject[];
  readonly constraints: ExecutionConstraints;
  readonly reserved: BudgetReservation;
  readonly lastFault: Fault | null;
  readonly lifecycle: CoordinatorLifecycle;
}

export type Reducer<Delta, State> = (delta: Delta, state: State) => State;

export type RegulationTargetReducer<Command> =
  Reducer<Command, RegulationTarget>;

export type CoordinatorStateReducer<Event> =
  Reducer<Event, CoordinatorState>;

export interface CoordinatorCheckpoint {
  readonly targets: RegulationTarget;
  readonly coordinator: CoordinatorState;
  readonly positions: {
    readonly commands: string | null;
    readonly events: string | null;
  };
}
```

## 意图身份与确认

ObjectKey 由精确 Objective 身份、版本、来源与 subject 的规范化语义确定，可对规范化值哈希，具体规则待定；不是任意 regulation ID，也不能直接依赖普通 JSON 属性顺序。intents 是按此 key 索引的只读稀疏 Record，value 保留完整 RegulationObject、targetLevel、priority 与 updatedAtRevision。RegulationObject 不再重复存 key；恢复和输入验证须核对 key 与完整对象一致，并明确哈希碰撞处理，不能静默合并不同对象。

Partial 表达并非每个 ObjectKey 都有条目，索引结果为 TargetIntent | undefined。readonly intents 限制属性重新赋值，Readonly 限制条目的增删替换；这些是编译期约束，不是运行时冻结或递归不可变保证。只将对象自身属性视为意图条目，查询须区分缺失 key 与原型链属性，构造和恢复不能让特殊 key 改变对象原型。

RegulationTarget.revision 是整个意图状态迭代的全局版本号；TargetIntent.updatedAtRevision 表示该对象当前意图最后在哪个全局版本更新。两者共用一个版本空间，不是对象各自递增的两个计数器。

每条合法目标更新按以下规则纯归约：

1. 取 nextRevision = state.revision + 1，不依赖系统时间。
2. 创建新的 Record 对象，在指定 key 上覆盖完整意图，并令 updatedAtRevision = nextRevision；其他条目保持不变，不修改旧 state 或其条目。
3. 返回 revision = nextRevision 的 RegulationTarget。同值新请求也推进版本；非法更新明确报错，不静默消耗版本或更改意图。

例如全局 revision = 8，A.updatedAtRevision = 8、B = 5、C = 7，表示 B 从全局版本 5 起未更新，而非 B 已被修改五次。条目版本是正安全整数且不超过全局版本；版本耗尽须显式失败，不回绕。全局版本作为独立水位保存，不通过当前条目最大值代替；未来即使压缩条目也不能重用旧版本号。

IntentRef 由对象 key 与该条目的 updatedAtRevision 组成，其 revision 引用意图发生时的全局版本，而非随集合更新而改变。CoordinatorState.acknowledged.targets 是已确认的目标意图，而 checkpoint.targets 是调用方当前意图，两者允许暂时不同；确认目标不代表创建、启动或完成任务。资源输入本身没有 delta 协议，AllocationAcknowledgement.revision 只是 Coordinator 采纳顺序的元数据，不属于治理意图版本空间。

命令关联 ID、非法输入回执、拒绝原因以及是否需要逐对象确认应在转换讨论中补足；不能把遗漏字段解释为允许静默丢弃请求。revision 也不等于底层消息位置，不能用它代替外部输入的可靠接续协议。

## 映射与优先顺序

意图顺序按 priority 升序、updatedAtRevision 升序确定，不依赖 Record 的属性枚举顺序或墙钟时间。同优先级下按最近更新的先后排序，不保留首次加入位置：A(priority 1, revision 10)、B(1, 12)、C(0, 15) 排为 C、A、B；再次更新 A 得到全局版本 16 后排为 C、B、A。仅 priority 更新也刷新逻辑时间，但重新排序不等于无故重启正在运行的调用。

映射加上述排序表达意图的优先队列视图，不是已就绪的实际执行队列。Coordinator 仍结合已处理意图修订、实际调用和依赖决定可执行项；initial 意图不推进，已终结的同一意图不因扫描或恢复被重新执行。派生任务的有效 priority 与排序关联仍需在 CoordinatorState 的转换讨论中明确。

## 任务、调用与依赖

Task 是一次排队到终结的执行任务，不是长期业务目标。intent 非空表示关联外部的一次意图；派生 provider 可以没有自己的外部意图，由其他任务的 dependencies 引用。previousTaskId 关联有限依赖编排中新排的 consumer 调用，不表示旧调用复活；共享 provider 的引用从消费者记录推导，不再重复存反向依赖表。

Task 的 targetLevel/priority 是实际采用的调度要求，可以因共享聚合与新意图确认而不同于单个外部意图。Run.intent/targetLevel 捕获启动时的关联与目标，不能仅凭任务更新后的 targetLevel 判定旧 run 的成功；更新和终结证据的完整规则仍需细化。

pending 不包含 Run；running/stopping 才包含当前调用。恢复时先保留为 unverified，再核实是否重关联或已经退出。ended 是终态，run 为 null 允许尚未启动就撤销或启动失败，但不能声称 target-reached；有 run 的达标结果仍须有效证据支持，类型检查不能代替事实验证。initial 无工作需求的完成方式仍需定义，不伪造一次 run 或 observation。

dependencies 是真实采用的编排关系，而不是所有可能依赖；providerTaskId 必须存在、对象/level 合法且图无环。blocked outcome 不保存活跃调用，但仍可以保留不可变的终结结果和持久化关系，为 provider 调用及后续新 consumer 调用提供上下文。

## 权威状态与推导值

- acknowledged.allocation 表达期望，Run.binding 表达实际使用；改变前者不修改后者。确认 concurrency 从 4 变为 2 后，实际占用仍可为 4，停止策略不由这个类型自动规定。
- 实际占用从 running、stopping 和尚未核实的 unverified 调用推导，不另存一个可能漂移的 activeCount。未核实调用在确认退出前保守保留占用。
- observations 每个精确对象保留最新采纳的成功观察；没有条目表示未知，不等于 initial。旧 run 和错误 envelope 不可作为成功观察写入，终结时的历史证据引用是否独立保留需继续讨论。
- reserved 是累计权威预留，不能仅从当前任务数重算；启动抛错也可能已经预留。limits 来自可信配置，持久化副本用于核对恢复上下文，不允许快照自行扩充限制。
- lastFault 只投影最近一次诊断，不表示所有历史错误或永久未解决故障；完整历史如需保留属于事件存储。任务终结错误、输入失败与服务失败存于各自类型，诊断记录不自动改变它们。
- 无 resource ID、capabilities、requirements 或 grants/ceiling。AgentBinding 的配置只能使用可持久化的非秘密数据或安全凭据引用，真实资源自行授权；配额和预算仍独立约束执行。

## 初值、恢复与下一步

新建 RegulationTarget 为 revision 0、intents 为 {}。新建 CoordinatorState 的 acknowledged.targets 同为空，allocation 为 null、tasks/observations 为空、reserved 全零、lastFault 为 null、输入 open，服务 open；instanceId 与可信 constraints 由宿主提供，未确认资源意图前不自行启动。

Checkpoint 是两份状态与消息处理位置的一致保存边界，不是公布持久化文件格式。需要验证对象唯一性、修订与引用一致性、可信约束及消息位置；不能把任意时刻分别读取的两个 state 拼成“原子快照”。恢复先纯归约，再以 recovering/unverified 核实外部运行，不清空预算、不重放动作、不把同一已终结意图当新请求；格式版本、重关联协议和存储失败行为待实施时明确。

全局 revision 与各条目的 updatedAtRevision 必须一起保存，恢复从保存的全局水位继续。Record 使用普通 JSON 对象表达，无需 Map 专用的 entries 转换；仍须校验所有值可持久化、key 与对象身份一致及版本有效，缺失条目用属性不存在表达，不写入 undefined。具体快照格式仍待确定。

下一步先检查这些类型的对象身份、确认粒度、任务与调用边界、终结证据及保留策略，再列合法状态转换，最后推导 Command/Event。本稿的 string 原因、诊断粒度、恢复字段及数据结构均为讨论选择，不作为最终 API 或已验收决定。
