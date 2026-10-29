# TaskType、ExecutionTracking、Engine 与 HTTP Server

本文支撑[通用任务引擎构想](./Idea.md)，定义最新的排队启动与资源替换边界。
包职责见[系统边界](./system-boundaries.md)，生命周期见[概念](./concepts.md)。
这里定义待实现的行为，不表示代码或验证已交付。

## 1. 角色与依赖

| 角色 | 职责 | 不承担什么 |
|---|---|---|
| Task Engine | Request 准入/幂等、Task/Series、时间投影、共享匹配、执行绑定、替换授权、事实记录及恢复 | 具体 worker/runtime、业务前置判断、HTTP listener |
| TaskType | 纯 validate/equals、必需 prepare、execute 排队启动并返回 tracking；封装类型及 Pool 能力 | 直接写 Task 状态、另做一套 Request/Series 调度 |
| 内部 ExecutorPool | 容量、兼容实例选择、排队、实际启动、协作及强制停止、清理/复用/淘汰 | 决定哪些 Task 共享或授权回收仍有受保护需求的 Execution |
| Executor | 执行一次准确工作并报告进展/结果/故障，完成必要清理 | Request 幂等、Task/Series、把自身重新提交到 Engine |
| HTTP Server / 宿主 | 装配 Engine、TaskType、Store、Clock、运行配置，认证/TLS/监听和挂载 | 复制核心调度，因断流自动取消 Task |

引擎不再显式申请 ExecutorLease 或调用 TaskType.allocate；资源所有权由 TaskType
及内部 Pool 管理，Engine 通过 ExecutionTracking 管理一次执行。allocation 阶段仍在：
它是提交排队启动请求后、实际执行开始前的等待，不因方法名 execute 就提前标 running。
Pool 可内部使用租约，但不是宿主或 Engine 必须注入/归还的公共对象。

```text
Engine ───────────→ TaskType / ExecutionTracking / 服务端口（task-protocol）
具体 TaskType ───→ 类型契约 + 内部 Pool / Executor
HTTP adapter ───→ Engine 服务端口
宿主 ───────────→ Engine + 各 TaskType + HTTP adapter + Store
```

TaskType、Pool 和 Executor 不依赖 Engine 具体实现。回报接口属于协议端口，不是包环。
check/probe/regulate 都是宿主按需注册类型，无内置必需业务类型；仅 echo 等测试类型
也可以使用引擎。runtime 分派属于 Check TaskType 内部，不强加给所有输入。
本地 Pool 直接调用执行 kernel，禁止向同一 Engine 的任务创建 HTTP 入口递归重提自身。
远程 adapter 不是本轮交付要求。

## 2. 统一注入与纯/副作用边界

以下为逻辑签名；实际泛型、结果验证及可信上下文在实施契约中落实：

```text
TaskType<Input, Prepared = Input>
  validate(input: unknown) → Input
  equals(input: Input, other: unknown) → boolean
  prepare(input: Input, signal) → Promise<Prepared>
  execute(prepared: Prepared, options) → Promise<ExecutionTracking>

ExecuteOptions
  signal
  replaceExecutionId?
  执行开始回报/替换授权的可信端口

ExecutionTracking
  executionId
  startedAt
  进展与最终结果/故障观察
  协作停止、强制回收及清理确认
```

validate/equals 为纯函数，不做 IO、不读可变外部状态、不修改或隐式转换输入。
validate 在受理前验证业务输入，失败明确拒绝；Engine 另验通用字段和权限。
equals 对域外 unknown 返回 false；合法域上自反、对称、传递，真实程序错误不宽泛吞掉。
业务输入包含所有影响执行的类型字段，不含 requestId、时间、recurrence 或 executionMatch；
equals 不替代完整请求幂等，也不绕过类型版本、权限、准确准备身份及运行环境匹配。
具体 Validator 可手写或内部使用 Schema，接口不强制 inputSchema/Schema 库。

prepare 必需；无额外准备工作时使用 async input => input，Prepared=Input，
不是返回 undefined 的空函数。每次真实调用均记录准备过程，可立即完成但不伪造下载。
准备准确内容、语义校验在排队启动前完成，失败不占执行实例；不要求所有类型使用 Artifact。
输入已是相同浮动 URL，不代表两次准备得到相同版本，准确准备身份还须匹配。

execute 是具备副作用的排队启动调用，不是返回最终业务结果的 Promise。
等待时可以获取/初始化兼容实例，但实际业务未开始；开始后立即提供 tracking，
后续结果通过 tracking 读取。具体方法名可细化，不得把排队和运行压成同一个开始事实。
新执行必须有新 executionId；取消排队不得隐式重试成另一个执行。

## 3. 排队、绑定与开始边界

```text
validate → 受理/等待 eligible → prepare
  → Engine 尝试匹配兼容 Execution 与 executionMatch
      → 可共享：关联已有 tracking/执行事实，不再次调用 TaskType.execute
      → 需要新执行：调用 TaskType.execute
          → 等实例：allocation / queued
          → 启动失败：明确故障，未开始时为 allocation_failed
          → 实际开始：记录 execution.started，得到 tracking，进入 running
          → 进展/正常结果/故障
          → Pool 确认清理后复用资源或淘汰实例
```

Engine 仍是 Task/Execution 匹配与绑定的裁决者。多个等价等待需求应共享一次拟启动
请求，不是每个 Task 各排队一次。TaskType 不自行合并 Task，内部队列只解决容量。

startedAt 是可信实际启动边界，不是 Promise.then 或 HTTP 回包收到时刻。
开始回报须能让 Engine 在业务代码运行前建立可恢复的启动意图/身份和准确时间边界；
实现采用启动握手或等价机制，不能仅靠执行已开始后返回 tracking 才补事实。
执行身份、回报与持久关联不能丢失，开始记录与 Task.allocation.bound 有一致因果关系。
开始记录已建立但进程在真正调用前崩溃时，按不确定执行处理，不假定可以安全重跑。

排队调用的取消信号属于其需求集合，不直接绑定第一个 Task 的取消或 deadline。
所有待启动需求消失/过期则撤销等待；其他有效需求存在时继续。排队和启动交接必须
复核需求及时间，timer 延迟不能导致过期请求启动。取消恰逢开始时，必须仍能追踪已开始
执行并收束，而不是丢弃 tracking 后留下未知工作。仅过期 Task 不得因重启重新排队。
Pool 与 SQLite 不天然原子，持久记录失败、启动失败、取消竞争均需明确补偿/清理证据。
耗时操作不得放入长数据库事务，回报携带准确执行身份/代次防止污染后继。

## 4. replaceExecutionId 是有边界的回收授权

Engine 可在 execute 时提供一个可替换的旧 executionId，候选属于同一可管理 Pool/
资源域且没有仍需保护的需求（未取消、未结束、未超时的 Task）。指定 ID 不是任意强杀
命令，也不表示立刻回收。用户不能通过业务 Input 伪造此权限。

```text
有兼容空闲资源 → 不替换，直接启动
无空闲资源且提供候选
  → Pool 判断回收该执行后是否能满足本次资源/runtime/容量要求
  → 不能满足：不杀旧执行，继续有界等待或明确拒绝
  → 能满足：回到 Engine 的原子授权边界复核 owner/代次并封闭旧执行的新关联
      → 协作停止
      → 宽限后必要时强制终止
      → 确认旧实例退出、资源清理
      → 启动全新 executionId，返回新 tracking
```

检查有效性不能只在 execute 入队时做一次。候选可能已结束、增加新有效 owner、
被其他请求回收或属于旧代次；必须重新裁决，不能仅凭旧 ID 杀执行。
回收授权、封口和新 Task 关联由同一 Engine 仲裁，封口后不得再向旧执行新增需求。
同一候选不能同时为多次新启动重复计算容量，空闲判断和实际占用也必须原子。

释放一个 Executor 不一定满足另一个 runtime/资源规格；Pool 必须确认回收有用，
不能杀掉不相关工作仍然占不到资源。取得空闲资源时不为“已给了 ID”而额外强杀。
回收失败明确报告并隔离不确定资源，不能只改计数器宣布空闲；新工作不能在同一份
尚未确认释放的容量上启动。旧回报不能影响新 executionId。

## 5. Task 超时、强制回收与独立执行限额

Task 超时不自动取消或立即停止已经运行的 Execution；允许迟到正常结果。
这不等于无限占用资源：Engine 保留通过 tracking/Pool 发起回收的能力，
资源紧张时可按上一节替换无受保护需求的旧执行；独立执行墙钟上限和宿主关闭也可
触发受控停止。独立上限不随新 Task 关联延长，不用某个 Task 的 deadline 代替。

回收以 Execution 为单位，不以单一 Task 为单位。受保护需求不能被资源替换误伤；
执行自身触及上限则按执行级故障处理，相关 Task 仍保持各自时间/取消事实。
只发停止信号不算回收完成。协作停止/强制终止/隔离能力必须在所选 runtime 下有
真实证据；不能对不可终止的同线程 JS Promise 宣称能够安全强杀。具体策略数值
由实施测试确定，协议显式报告不支持或清理失败，不以假成功替代。

业务结束/故障和物理回收是不同事实。已经可靠记录的正常结果不被之后清理动作抹掉；
停止竞态中出现的真实结果按记录边界处理，不覆写已有失败或取消。
未知已启动执行重启后以 execution_interrupted 失败，不透明重跑；其外部残留
资源仍须隔离/清理，失败记录不证明实际进程已经退出。

## 6. 业务前置逻辑与嵌套执行

Executor 开始后可以先做轻量业务判断，不满足即返回类型定义的“不执行”结果，
引擎正常 completed；判断抛错则 execution_failed。不保留原 Task 等待以后解锁，
不提供 prerequisite/readiness/blocked 或 waitUntilReady，也无内置 Check 要求。
新尝试由业务新请求或明确 recurrence 触发，不隐式重试或引入跨请求熔断状态机。
前置判断已占实例，只减少后续重业务成本，不提供条件持续有效保证。

Probe/Regulate 可使用宿主注入的窄化子任务端口编排；这不是所有 Executor 的必需
接口，更不是依赖 Engine 具体类。父子有明确身份、权限与预算，禁止递归提交自身。
编排 Pool 与实际运行资源必须避免互锁；只按类型改名仍不够，共享底层容量或嵌套同
类型也需要证明子任务有可用执行路径。不能用无限并发规避死锁。

## 7. 宿主组装与验证

```typescript
const engine = createTaskEngine({
  store,
  clock,
  types: {
    check: checkTaskType,
    probe: probeTaskType,
    regulate: regulateTaskType,
  },
});
const handler = createTaskHandler({ service: engine, resolveCaller });
```

这是组装示意，不是已交付 API。宿主选择注册哪些类型、HTTP 挂载、监听与安全策略；
TaskType 通过 execute 提供 tracking，内部 Pool 如何管理 Executor 不泄露成引擎级租约。
SDK 是各语言实现，不是协议；Web Request/Response handler 不强制具体 HTTP 框架。

验证重点：排队不伪造 running、共享不重复启动、开始记录早于业务且时间准确、
取消启动竞争不漏 tracking、可替换候选二次核实、回收能提供匹配资源才替换、
新 owner 与封口互斥、真实强制终止确认、清理失败不超售资源、旧回报不污染新执行；
以及必需恒等 prepare、纯 Validator/Equals、Executor 快速返回和父子资源隔离。
