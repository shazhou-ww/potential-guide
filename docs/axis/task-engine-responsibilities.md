# Task Engine 职责边界

## 概述

### 职责

1. Engine 是业务无关的 Request 受理与运行协调器，在绑定的数据域内管理 Task、完整 Run 及其匹配关系，并对这些事实的持久生命周期负责。
2. 外部参与者提交 Request 创建 Task；取消 Task 使用独立操作，不提交新的 Request。外部参与者不直接创建或取消 Run。
3. 查询、订阅与取消订阅不改变 Task 或 Run 的生命周期。

#### A. Task 控制

- **A1. 提交 Request**：外部参与者提交创建 Task 的请求，获得受理结果，由 Engine 按需协调 Run。
- **A2. 请求取消 Task**：外部参与者取消 Task，由 Engine 终止无其他 Task 需求的 Run 并回收资源。

#### B. Task 观察

- **B1. 查询单个 Task 当前状态**：获取指定 Task 的当前状态快照。
- **B2. 查询单个 Task 变更历史**：获取指定 Task 已发生的不可变变更记录。
- **B3. 订阅单个 Task**：获取该 Task 的后续变更事件流及取消订阅能力。
- **B4. 查询 Task 集合**：获取数据域内符合条件的完整 Task 摘要列表。
- **B5. 订阅 Task 集合**：获取符合条件的 Task 集合概况事件流及取消订阅能力。

#### C. Run 观察

- **C1. 查询单个 Run 当前状态**：获取指定 Run 的当前状态快照。
- **C2. 查询单个 Run 变更历史**：获取指定 Run 已发生的不可变变更记录。
- **C3. 订阅单个 Run**：获取该 Run 的后续变更事件流及取消订阅能力。
- **C4. 查询 Run 集合**：获取数据域内符合条件的完整 Run 摘要列表。
- **C5. 订阅 Run 集合**：获取符合条件的 Run 集合概况事件流及取消订阅能力。

### 非职责

1. **业务含义与过程**：输入、前置条件、制品和结果的业务含义，以及内部准备、业务资源分配与复用、执行步骤和业务后继决策，由 TaskType 或业务方负责。
2. **业务系列与周期提交**：seriesId 的组织规则和周期性 Request 的产生由外部参与者负责。
3. **通用资产与消费者生命周期**：不接管业务制品、缓存、资源池或 UI 的生命周期；停止观察不等于取消任务。

## 术语表

| 术语 | 解释 |
| --- | --- |
| 外部参与者（External Actor） | 与 Task Engine 交互的外部主体，可承担调用、订阅等角色。 |
| Request | 专指外部参与者提交的创建 Task 的不可变请求意图，不泛指查询、取消、订阅等接口调用。 |
| Task | Request 被受理后由 Engine 管理的独立对象。 |
| Run | 包含准备、资源分配与实际执行的一次完整尝试，可由多个 Task 共享。 |
| Execution | Run 内部实际业务执行的子过程，不是 Task 的匹配对象。 |
| TaskType | 定义业务输入、输出与消息契约并实现完整 Run 的任务类型。 |
| 数据域 | Task、Run 及其关系和历史的稳定归属范围，详见[数据域归属与运行实例独占绑定](./task-engine-contracts/data-domain.md)。 |
| 运行实例 | 一次初始化后固定绑定一个数据域的 Engine 运行时实例。 |
| 输入 Schema | 描述 TaskType 输入合法结构与约束的声明式契约。 |
| `requestId` | 在数据域内用于幂等受理的 ULID，请求仅在其时间允许的受理窗口内接受，详见[Request 受理与幂等处理](./task-engine-contracts/request-admission.md)。 |
| `matchPolicy` | 定义 Task 与 Run 匹配的时间条件，取 `starts-after-eligible` 或 `terminates-after-eligible`，详见[Task 匹配与 Run 启动](./task-engine-contracts/run-matching.md)。 |
| 状态快照（Snapshot） | 实体在某个观察边界的当前状态。 |
| 变更历史（Change History） | 实体已经发生的不可变变更记录。 |
| Revision | 数据域内严格递增的事件位置，也用于表达查询已覆盖的水位，详见[数据域事件序号与查询 Revision](./task-engine-contracts/revision.md)。 |
| TaskEvent / RunEvent | Task 或 Run 已发生事实的统一事件模型，分别供历史查询与后续订阅读取。 |
| 摘要（Summary） | 集合成员用于概况展示的精简信息，不包含全部详情。 |
| 订阅句柄（Subscription Handle） | 提供事件流与取消订阅能力的逻辑接口，详见[订阅句柄与订阅生命周期](./task-engine-contracts/subscription.md)。 |
| 协作式取消 | 向类型发送取消信号，由类型配合停止工作和清理。 |
| 强制终止 | 通过可信宿主的能力停止运行，而不依赖类型主动配合。 |
| 资源回收 | 确认运行占用的资源已释放，不等同于 Run 逻辑终结。 |

## 接口说明

以下操作均以运行实例绑定的数据域为边界。集合查询覆盖该域内仍保留且符合查询条件的完整实体集合，
不限于本次启动后创建的实体；列表成员以摘要呈现。
output 不规定传输协议；side effects 为“无”指无领域状态或订阅状态变更。

下面的 TypeScript 接口是逻辑签名草案，不代表现有代码 API；命名、异步形式和错误表达仍可调整。
各 operation 均为已绑定数据域的 Engine 实例方法，签名省略外层接口声明。
数据域在初始化时指定并取得独占管理权，后续调用不再传入或切换数据域；初始化入口仅作示意：

```ts
const engine = await openTaskEngine({ dataDomain });
await engine.getTask(taskId);
```

TaskRequest 对应本文 Request，避免与平台的 Request 类型混淆；其余领域类型只引用名称，字段另行定义。
TaskSnapshot、RunSnapshot 和 Page 均包含查询水位 `revision`，各事件也携带自身的 `revision`。
所有订阅以 `fromRevision` 为起始锚点，先补读其后的历史再接续实时流；具体语义见[数据域事件序号与查询 Revision](./task-engine-contracts/revision.md)。
Page 表示有界分页，完整集合可通过续页获取；HistoryQuery、TaskCollectionQueryOptions、
RunCollectionQueryOptions 均包含[历史与集合查询的分页](./task-engine-contracts/pagination.md)定义的 `cursor`、`limit`；
查询条件和订阅条件分别定义，不默认相同。
Subscription 表示包含事件流与取消能力的订阅句柄，示意如下：

```ts
interface Subscription<Event> {
  events: AsyncIterable<Event>;
  unsubscribe(): Promise<void>;
}
```

## A. Task 控制

### A1. 提交 Request

| 项目 | 说明 |
| --- | --- |
| input | Request |
| output | 受理结果及对应 Task |
| side effects | 新请求创建 Task，按需调度 Run |

```ts
submit(request: TaskRequest): Promise<SubmissionResult>;
```

提交创建 Task 的请求，获得受理结果，由 Engine 按需协调 Run。

- 关于提交检查与重复请求的处理，参考[Request 受理与幂等处理](./task-engine-contracts/request-admission.md)。
- 关于受理后的生效与超时，参考[Task 生命周期与三维状态](./task-engine-contracts/task-lifecycle.md)。
- 关于是否调度新 Run 或共享运行，参考[Task 匹配与 Run 启动](./task-engine-contracts/run-matching.md)。

### A2. 请求取消 Task

| 项目 | 说明 |
| --- | --- |
| input | Task 标识 |
| output | 取消结果 |
| side effects | 取消 Task，终止无其他 Task 需求的 Run 并回收资源 |

```ts
cancelTask(taskId: string): Promise<CancellationResult>;
```

取消指定 Task，由 Engine 处理不再被其他 Task 需要的 Run 及其资源。

- 关于 Task 的取消状态，参考[Task 生命周期与三维状态](./task-engine-contracts/task-lifecycle.md)。
- 关于取消对运行终止的影响，参考[Task 取消、超时与 Run 终止](./task-engine-contracts/run-termination.md)。

## B. Task 观察

### B1. 查询单个 Task 当前状态

| 项目 | 说明 |
| --- | --- |
| input | Task 标识 |
| output | 当前状态快照及 revision |
| side effects | 无 |

```ts
getTask(taskId: string): Promise<TaskSnapshot>;
```

获取指定 Task 的当前状态，不附带变更历史。

- 关于快照包含的信息范围，参考[Task 与 Run 的查询范围及订阅粒度](./task-engine-contracts/observation.md)。
- 关于时间与取消状态的含义，参考[Task 生命周期与三维状态](./task-engine-contracts/task-lifecycle.md)。
- 关于 Task 与 Run 关联的含义，参考[Task 匹配与 Run 启动](./task-engine-contracts/run-matching.md)。

### B2. 查询单个 Task 变更历史

| 项目 | 说明 |
| --- | --- |
| input | Task 标识及历史查询条件 |
| output | 不可变变更记录页及本轮 revision |
| side effects | 无 |

```ts
getTaskHistory(taskId: string, query: HistoryQuery): Promise<Page<TaskEvent>>;
```

按条件分页读取指定 Task 已发生的不可变变更记录。

- 关于历史记录的查询范围，参考[Task 与 Run 的查询范围及订阅粒度](./task-engine-contracts/observation.md)。
- 关于分页参数、顺序及续页，参考[历史与集合查询的分页](./task-engine-contracts/pagination.md)。
- 关于历史在重启前后的连续性，参考[持久化与重启后的行为](./task-engine-contracts/persistence-recovery.md)。

### B3. 订阅单个 Task

| 项目 | 说明 |
| --- | --- |
| input | Task 标识及 fromRevision |
| output | 订阅句柄（变更事件流、取消订阅） |
| side effects | 建立订阅 |

```ts
subscribeTask(taskId: string, fromRevision: Revision): Promise<Subscription<TaskEvent>>;
```

从指定 revision 之后补读 Task 事件并接续实时变化，通过返回的句柄消费事件或取消订阅。

- 关于变更事件的范围，参考[Task 与 Run 的查询范围及订阅粒度](./task-engine-contracts/observation.md)。
- 关于事件流消费与取消订阅，参考[订阅句柄与订阅生命周期](./task-engine-contracts/subscription.md)。
- 关于匹配引起的状态变化，参考[Task 匹配与 Run 启动](./task-engine-contracts/run-matching.md)。

### B4. 查询 Task 集合

| 项目 | 说明 |
| --- | --- |
| input | 绑定数据域内的查询条件 |
| output | Task 摘要列表页及本轮 revision，可续页获取完整集合 |
| side effects | 无 |

```ts
listTasks(query: TaskCollectionQueryOptions): Promise<Page<TaskSummary>>;
```

分页查询绑定数据域内符合条件的 Task 集合，以摘要呈现成员。

- 关于集合所属的数据范围，参考[数据域归属与运行实例独占绑定](./task-engine-contracts/data-domain.md)。
- 关于成员摘要的信息范围，参考[Task 与 Run 的查询范围及订阅粒度](./task-engine-contracts/observation.md)。
- 关于完整列表的分页与一致性，参考[历史与集合查询的分页](./task-engine-contracts/pagination.md)。

### B5. 订阅 Task 集合

| 项目 | 说明 |
| --- | --- |
| input | 绑定数据域内的订阅条件及 fromRevision |
| output | 订阅句柄（概况事件流、取消订阅） |
| side effects | 建立订阅 |

```ts
subscribeTasks(
  options: TaskCollectionSubscriptionOptions,
  fromRevision: Revision,
): Promise<Subscription<TaskCollectionEvent>>;
```

从指定 revision 之后补读 Task 集合的加入、摘要更新和移出事件，并接续实时流；不只观察已有成员，也不接收每个成员的全部详情变化。

- 关于集合概况事件的范围，参考[Task 与 Run 的查询范围及订阅粒度](./task-engine-contracts/observation.md)。
- 关于事件流消费与取消订阅，参考[订阅句柄与订阅生命周期](./task-engine-contracts/subscription.md)。

## C. Run 观察

### C1. 查询单个 Run 当前状态

| 项目 | 说明 |
| --- | --- |
| input | Run 标识 |
| output | 当前状态快照及 revision |
| side effects | 无 |

```ts
getRun(runId: string): Promise<RunSnapshot>;
```

获取指定 Run 的当前状态，不附带变更历史。

- 关于快照包含的信息范围，参考[Task 与 Run 的查询范围及订阅粒度](./task-engine-contracts/observation.md)。
- 关于运行终结的认定，参考[Task 取消、超时与 Run 终止](./task-engine-contracts/run-termination.md)。
- 关于 Run 被多个 Task 共享的含义，参考[Task 匹配与 Run 启动](./task-engine-contracts/run-matching.md)。

### C2. 查询单个 Run 变更历史

| 项目 | 说明 |
| --- | --- |
| input | Run 标识及历史查询条件 |
| output | 不可变变更记录页及本轮 revision |
| side effects | 无 |

```ts
getRunHistory(runId: string, query: HistoryQuery): Promise<Page<RunEvent>>;
```

按条件分页读取指定 Run 已发生的不可变变更记录。

- 关于历史记录的查询范围，参考[Task 与 Run 的查询范围及订阅粒度](./task-engine-contracts/observation.md)。
- 关于分页参数、顺序及续页，参考[历史与集合查询的分页](./task-engine-contracts/pagination.md)。
- 关于历史在重启前后的连续性，参考[持久化与重启后的行为](./task-engine-contracts/persistence-recovery.md)。

### C3. 订阅单个 Run

| 项目 | 说明 |
| --- | --- |
| input | Run 标识及 fromRevision |
| output | 订阅句柄（变更事件流、取消订阅） |
| side effects | 建立订阅 |

```ts
subscribeRun(runId: string, fromRevision: Revision): Promise<Subscription<RunEvent>>;
```

从指定 revision 之后补读 Run 事件并接续实时变化，通过返回的句柄消费事件或取消订阅。

- 关于变更事件的范围，参考[Task 与 Run 的查询范围及订阅粒度](./task-engine-contracts/observation.md)。
- 关于事件流消费与取消订阅，参考[订阅句柄与订阅生命周期](./task-engine-contracts/subscription.md)。
- 关于运行终结事件的含义，参考[Task 取消、超时与 Run 终止](./task-engine-contracts/run-termination.md)。

### C4. 查询 Run 集合

| 项目 | 说明 |
| --- | --- |
| input | 绑定数据域内的查询条件 |
| output | Run 摘要列表页及本轮 revision，可续页获取完整集合 |
| side effects | 无 |

```ts
listRuns(query: RunCollectionQueryOptions): Promise<Page<RunSummary>>;
```

分页查询绑定数据域内符合条件的 Run 集合，以摘要呈现成员。

- 关于集合所属的数据范围，参考[数据域归属与运行实例独占绑定](./task-engine-contracts/data-domain.md)。
- 关于成员摘要的信息范围，参考[Task 与 Run 的查询范围及订阅粒度](./task-engine-contracts/observation.md)。
- 关于完整列表的分页与一致性，参考[历史与集合查询的分页](./task-engine-contracts/pagination.md)。

### C5. 订阅 Run 集合

| 项目 | 说明 |
| --- | --- |
| input | 绑定数据域内的订阅条件及 fromRevision |
| output | 订阅句柄（概况事件流、取消订阅） |
| side effects | 建立订阅 |

```ts
subscribeRuns(
  options: RunCollectionSubscriptionOptions,
  fromRevision: Revision,
): Promise<Subscription<RunCollectionEvent>>;
```

从指定 revision 之后补读 Run 集合的加入、摘要更新和移出事件，并接续实时流；不只观察已有成员，也不接收每个成员的全部详情变化。

- 关于集合概况事件的范围，参考[Task 与 Run 的查询范围及订阅粒度](./task-engine-contracts/observation.md)。
- 关于事件流消费与取消订阅，参考[订阅句柄与订阅生命周期](./task-engine-contracts/subscription.md)。
