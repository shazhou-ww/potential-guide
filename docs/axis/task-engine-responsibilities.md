---
frozen: false
---

# Task Engine 职责边界

## Axis 协议冻结标记

Axis 文档使用 YAML frontmatter 的布尔字段 `frozen` 显式标记契约是否冻结：

- `frozen: false` 或未设置：契约可原地修改，相关引用、示例与实现须同步对齐。
- `frozen: true`：标记已发布并明确冻结的契约，不原地改变其协议含义；
  不兼容变化另行定义版本或替代契约，不通过自行清除标记绕过冻结。
- 当前所有 axis 协议均为 `frozen: false`，不冻结任何协议。
  是否冻结以显式标记为准，不从版本号、包发布记录或 IDEA 验收状态推断。
- 该标记不改变文档本身的权威级别；历史草稿仍只是参考，
  可修改协议也不授权自动改写历史数据、迁移旧域或重跑任务。

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
- **C6. 查询 Run 诊断日志**：获取指定 Run 仍保留的独立诊断日志页、限额及可用性状态。
- **C7. 订阅 Run 诊断日志**：按该 Run 的日志序号补读并跟随诊断输出，不使用生命周期 revision。

### 非职责

1. **业务含义与过程**：输入、前置条件、制品和结果的业务含义，以及内部准备、业务资源分配与复用、执行步骤和业务后继决策，由 TaskType 或业务方负责。
2. **业务系列与周期提交**：seriesId 的组织规则和周期性 Request 的产生由外部参与者负责。
3. **通用资产与消费者生命周期**：不接管业务制品、业务缓存、资源池或 UI 的生命周期；停止观察不等于取消任务。
   TaskType 自身交付制品的 IPFS 获取、校验、内容保护、入口装载与 context 内容访问
   属于 Engine 的通用类型装载职责，
   见[Task Bundle、类型装载与运行库](./task-engine-contracts/task-bundle.md)，不扩展为任意业务资产管理。

## 术语表

| 术语 | 解释 |
| --- | --- |
| 外部参与者（External Actor） | 与 Task Engine 交互的外部主体，可承担调用、订阅等角色。 |
| Request | 专指外部参与者提交的创建 Task 的不可变请求意图，不泛指查询、取消、订阅等接口调用。 |
| Task | Request 被受理后由 Engine 管理的独立对象。 |
| Run | 包含准备、资源分配与实际执行的一次完整尝试，可由多个 Task 共享。 |
| Execution | Run 内部实际业务执行的子过程，不是 Task 的匹配对象。 |
| TaskType | 定义业务输入、输出与消息契约并实现完整 Run 的任务类型。 |
| Task Bundle 根 CID | 新架构中自包含 Task Bundle 的 UnixFS 目录内容身份；Request 使用根 CID 字符串或 `{cid, hint}` 引用，hint 不参与身份。 |
| 数据域 | Task、Run 及其关系和历史的稳定归属范围，详见[数据域归属与运行实例独占绑定](./task-engine-contracts/data-domain.md)。 |
| 运行实例 | 一次初始化后固定绑定一个数据域的 Engine 运行时实例。 |
| 输入 Schema | 描述 TaskType 输入合法结构与约束的声明式契约。 |
| `requestId` | 在数据域内用于幂等受理的 ULID，请求仅在其时间允许的受理窗口内接受，详见[Request 受理与幂等处理](./task-engine-contracts/request-admission.md)。 |
| `matchPolicy` | 定义 Task 与 Run 匹配的时间条件，取 `starts-after-eligible` 或 `terminates-after-eligible`，详见[Task 匹配与 Run 启动](./task-engine-contracts/run-matching.md)。 |
| 状态快照（Snapshot） | 实体在某个观察边界的当前状态。 |
| 变更历史（Change History） | 实体已经发生的不可变变更记录。 |
| Revision | 数据域内严格递增的事件位置，也用于表达查询已覆盖的水位，详见[数据域事件序号与查询 Revision](./task-engine-contracts/revision.md)。 |
| 资格时间见证 | 协调器实际处理新匹配资格、而既有源事实不足以证明时提交的数据域级 `qualification-time-observed`；领域载荷仅有 observedAt，不记录绑定/所选 Run/Task 状态，详见[匹配契约](./task-engine-contracts/run-matching.md)。 |
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
const engine = await openTaskEngine({ dataDomain, ipfsClient });
await engine.getTask(taskId);
```

匹配关系与 stage 依据已提交的资格观测边界，允许协调器处理前出现 initial+eligible；
时间标签仍按 now，查询绝不写资格事实。独立时间推算无事件，实际资格观测形成源事实的限制性澄清见匹配契约。

TaskRequest 对应本文 Request，避免与平台的 Request 类型混淆；其余领域类型只引用名称，字段另行定义。
TaskSnapshot、RunSnapshot 和生命周期 Page 均包含查询水位 `revision`，各生命周期事件也携带自身的 `revision`；
独立 RunLogPage 使用日志 sequence，不包含生命周期 revision，见[日志契约](./task-engine-contracts/run-logs.md)。
快照/摘要的最小事实范围及筛选边界见[观察契约](./task-engine-contracts/observation.md)。
生命周期订阅以 `fromRevision` 为起始锚点，先补读其后的历史再接续实时流；具体语义见[数据域事件序号与查询 Revision](./task-engine-contracts/revision.md)。
C7 的独立日志订阅使用 `afterSequence`，不混用生命周期锚点。
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
| output | 已创建 Task 的受理成功结果、明确拒绝结果，或 preparing 与 tracking token |
| side effects | 持久跟踪待受理 Request，按需准备 Bundle；校验通过后创建 Task，按需协调 Run |

```ts
submit(request: TaskRequest): Promise<SubmissionResult>;
```

提交创建 Task 的请求。可立即返回成功或拒绝；尚未完成准备时返回 preparing 与 tracking token，
调用方可查询或 long poll 最终受理结果。tracking token 直接使用 `requestId`，不额外生成标识；
它对应 Request，不对应多个 Request 可共享的
Bundle preparation；preparing 请求及准备关联跨重启恢复，Task 仍在校验通过后才创建。

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

### C6. 查询 Run 诊断日志

| 项目 | 说明 |
| --- | --- |
| input | Run 标识、afterSequence 及有限 limit |
| output | 独立日志页、续读序号、缺口、限额及可用性/完整性状态 |
| side effects | 可触发日志保留清理，不修改业务生命周期事实 |

```ts
getRunLogs(runId: string, query: RunLogQuery): Promise<RunLogPage>;
```

读取仍保留的诊断，不代替 C2 的 Run 变更历史。
权限、保留、独立序号与错误语义见[Run 诊断日志](./task-engine-contracts/run-logs.md)。

### C7. 订阅 Run 诊断日志

| 项目 | 说明 |
| --- | --- |
| input | Run 标识、afterSequence 及有限页预算 |
| output | 独立日志订阅，交付有界日志页与状态，支持解除观察 |
| side effects | 建立日志订阅，可触发保留清理，不取消 Task/Run |

```ts
subscribeRunLogs(runId: string, query: RunLogQuery): Promise<LogSubscription>;
```

以上仍是逻辑签名；Engine 拉取句柄与 HTTP 异步迭代器是各自传输实现。
补读、实时衔接与容量独立于 C3 的生命周期事件订阅，
见[Run 诊断日志](./task-engine-contracts/run-logs.md#查询与实时续接)。

## 配套能力与可信装配

A1–C7 是核心控制与观察操作，不是删除现有配套能力的名单。本轮继续提供：

- 类型契约获取：Request 通过根 CID 字符串或 `{cid, hint}` 引用自包含 Task Bundle 的 UnixFS 目录，
  Engine 按需获取并验证，不要求显式类型注册；宿主配置容量限制，不另引入来源或执行权限模型。
  Engine 不提供 `discoverTypes` 类型枚举或类型目录，Bundle 的查找由调用方或外部目录负责，
  不将缓存列表视为可提交类型目录。
  内容寻址、装载及公共运行库边界见
  [Task Bundle、类型装载与运行库](./task-engine-contracts/task-bundle.md)。
  Hint 仅为单个 gateway 基址 URI 或有序候选列表；宿主按访问策略决定是否采用，
  不将调用方提示当作可信配置、内容身份或访问授权。
  Bundle 内文件可通过根 CID 加相对路径独立访问；这不是新增 Task/Run 控制或订阅操作。
  业务 Worker 经 Task context 读取当前 Bundle 的相对路径内容，不依赖宿主物理目录；
  本地 IPFS 节点可承担块缓存，资源是否物化由宿主实现决定，完整准入验证仍保留。
  初始化参数 `ipfsClient` 由宿主装配，仅理解 IPFS 节点与内容；
  Bundle 解释与准入属于 Engine，context 访问封装属于 Task SDK，不放入底层 IPFS 接口。
  此替换仅限 Task Engine 新架构，不改变 Check/Probe 等业务制品的引用或传输格式。
- `getRequest`：读取不可变原始请求意图，保留省略与显式值区别；缺失或不可提供明确失败。
- 受理状态查询：以 `requestId` 查询 preparing/accepted/rejected，
  同一操作通过可选 `waitMs` 支持立即查询或有界 long poll；不改变请求处理。
  此能力与读取原始请求的 `getRequest` 分离，见
  [统一状态查询与 long poll](./task-engine-contracts/request-admission.md#统一状态查询与-long-poll)。
- `sendTaskMessage` / `getTaskMessage`：保留 Task 归属、可信 Caller、消息幂等、Never 禁用、
  入队不等于接纳及失联可为 unknown 的约束。按唯一匹配路由，未匹配不向候选 Run 广播；
  进入停止流程后不接纳新业务消息，Worker 退出后不再投递或复活 Run。消息不创建 Run 或改变匹配，
  不把未确认交付报告为已执行；业务消息含义由 TaskType 决定，不新增 Regulate 协议。

配套能力与核心操作一同纳入直接 HTTP、Check/Probe 和 Web UI 的链路验收。
Probe 通过关联 Run 的独立历史核验实际环境及结果证据，不依赖 Task history 混入 Run progress；
Check/Probe 仍对完整 Run 的业务结果与资源释放负责。

可信宿主在开放服务前校验配置、取得数据域独占并验证可支持格式；不支持的旧域明确拒绝且原样保留，
不自动换域、迁移或重跑。宿主停止配置与等待边界遵守[Run 终止](./task-engine-contracts/run-termination.md)。
