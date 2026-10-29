# ExecutorPool、Executor、Engine 与 HTTP Server

本文支撑[通用任务引擎构想](./Idea.md)，记录 2026-10-29 的职责收敛。
这是设计定义，不表示接口已经实现；函数名称仅作示意。包划分见
[系统边界](./system-boundaries.md)，任务时间、取消和递归语义见[概念](./concepts.md)。

## 1. 四个角色

| 角色 | 拥有的职责 | 不承担什么 |
|---|---|---|
| Task Engine | Request 准入/幂等、Task/Series 调度、readiness、allocation 协调、Execution 共享与需求所有权、事实记录及恢复 | 具体运行时加载、启动 worker、数据库驱动或 HTTP listener |
| ExecutorPool | 管理容量与申请等待，创建/复用 Executor，原子授予使用租约，确认回收或淘汰异常实例 | 决定 Task 结局、系列递归、共享 Execution 匹配或绕过权限政策 |
| Executor | 在租约内使用准备输入执行一次 Execution，报告进展/结果/故障，响应 Execution 停止信号并完成清理 | Request 准入、Task 状态修改、Series、内部等待同一执行配额或重复调度自身请求 |
| HTTP Server / 宿主 | 装配 Engine、类型及其 ExecutorPool、Store、Clock；认证、TLS、监听、挂载与进程生命周期 | 复制一套调度器、通过 HTTP 断连隐式取消 Task |

原“资源适配器”的能力收进 ExecutorPool 内部。宿主按类型注入统一的 TaskType，
由它封装校验、可选准备、输入等价判断及 Pool 分配能力，不再分别拼接 Type 和 Pool，
也不注入裸 Executor 和独立资源适配器；不要求每个角色单独建包或进程。

HTTP Router 是 Server 与 Engine 之间的传输适配，不是第五个调度者。它输出基于
Web Request/Response 的 handler，调用同一 Engine 服务接口；Node HTTP 或框架
连接器负责流、背压和断连桥接。业务授权仍在 Engine 中执行，进程内调用不绕过授权。

## 2. 按任务类型注入执行能力

```text
同一个宿主进程
  HTTP listener → Router → Task Engine ← 进程内业务调用方
                              |
                     按 Request.type 分派
                  ┌───────────┼───────────┐
             Check Pool     Probe Pool     Regulate Pool
                  |
             按 Checker runtime/版本选择兼容资源
                  |
             Node Executor 租约（本轮）
```

Engine 支持注册封装对应 ExecutorPool 的 TaskType；同一实例可以承载 check/probe/regulate，
不要求每种业务启动一套引擎。类型注册还包括输入/结果/进展校验、准备与兼容政策，
不能只注入一个执行函数而省略这些约束。未知类型或缺少所需执行能力须明确拒绝。

Check 是内置支持的任务类型，保证前置条件可通过真实 Check Task 验证；具体检查
能力由宿主注入，不代表内核自带所有 runtime、Checker 下载器或任意业务检查代码。
probe/regulate 及其他类型通过适配器注册；将现有生产业务接入的工作仍归来源 idea，
本引擎可先用提供测试 Executor 的 Check Pool 和非制品类型验证扩展性。

Task type 决定执行哪种业务；runtime 分派属于 Check 执行适配侧，不是所有任务共有
的字段。Check Pool 内部可提供 runtime 到子 Pool/具体执行能力的映射，本地实现直接调用
kernel/pool，不通过同一 Engine 的 Check HTTP 准入接口再提交自身任务。
未来远程 adapter 可以携带 Host 地址，但地址、发现和远程恢复不是 Engine 必需概念，
本轮不据此扩张分布式执行能力。

## 3. 依赖关系，而非互相持有具体实现

```text
task-engine ───────────→ Pool/租约/执行/服务端口（task-protocol）
具体 ExecutorPool ────→ Pool/租约/执行端口
具体 Executor ─────────→ 执行端口
task-engine-http ──────→ Engine 服务端口
宿主组装 ──────────────→ Engine + 各类型 ExecutorPool + HTTP + Store
```

Executor 不导入 Task Engine 的实现，不要求持有 Engine 实例；它可独立测试或被其他
调度器调用。执行上下文中的进展回调、结果返回、执行身份和停止信号是端口契约，
不是反向包依赖。Pool 同样不改写 Task snapshot 或持久事实。

Pool 可封装现有 Node kernel/worker pool，将实例管理与资源预留统一在一次租约中。
Executor 是 Pool 管理的执行实例，不要求每次申请都新建线程或进程。具体实现放在适配层，
不能为了共用当前包而让 task-engine 反向导入 checker-host 组装入口。

Probe/Regulate 若需编排子任务，可额外依赖宿主注入的窄化任务提交/观察端口；
它不是 Executor 基础接口的强制依赖，更不是对 Engine 具体实现的导入。
子请求有独立身份、明确因果关联和权限/预算，不能递归重提当前 Execution 的自身请求。

## 4. allocation 的责任

allocation 的协调、匹配及正式绑定属于 Engine；取得可用 Executor 及资源回收属于 Pool。
从 Pool 等待 Executor 使用租约就是等待 allocation。Executor 接到 execute 时应已有
启动所需资源，不在内部无限排队等待同一执行配额。交给它的是一次 Execution 的输入，
不是把 Task 调度权交给它；多个 Task 可以共享一个 Execution 和一份租约。

```text
Task 已具备执行条件
  → Engine 判断是否可关联兼容 Execution
      → 若可关联：增加需求 owner，不重复申请该执行已经占用的资源
      → 否则：向对应类型 Pool 申请兼容 Executor 的使用租约
          → 暂无可用 Executor：等待 allocation / queued，不能标记 running
          → 最终申请失败：明确 allocation_failed
          → 获得租约：Engine 复核有效需求并提交绑定
              → 启动 Executor，记录准确执行开始事实
              → 校验并记录进展、结果或故障
              → 清理确认后归还租约；Pool 复用健康实例或淘汰异常实例
```

### 使用租约与申请生命周期

Pool 申请必须包含足以选择兼容 Executor 的准备结果、运行环境及执行约束，不仅是
Task type。授予是原子的独占使用权，一份有效租约一次只承载一个 Execution；
共享的是该 Execution 的结果，不是让多个执行同时使用同一份租约。
资源可用性查询不等于租约授予，不能先观察“还有一个空位”再重复占用。
租约表示资源所有权，不是前置条件 TTL，也不隐含自动过期或丢失所有权。

等待申请可撤销；其生命周期属于拟创建的 Execution 的需求集合，不能直接绑定
第一个 Task 的 signal。所有需求消失时撤销申请；如果撤销与授予竞争，Engine 必须
复核需求，未采用的迟到租约立即归还，不启动无主执行。等待期间若转而采用兼容的
共享 Execution，同样撤销多余申请并回收竞态取得的租约。
申请等待和初始化有明确限额，Pool 的等待队列不能演变成另一套 Task/Series 调度器。

Engine 负责确保租约在绑定/启动失败及正常收束路径上归还。归还必须防重复和旧代次：
重复归还不能增加容量，旧 Executor 回报不能归还或污染其后续新租约。
只有已退出执行并完成必要清理的实例才可再次出借；清理失败或状态不明由 Pool 淘汰/
隔离，不因结果已返回或停止信号已发送就入池。具体端口签名在实施阶段确定。

租约句柄可为进程内对象，不进入公共 JSON；持久记录只保留可验证身份与必要恢复事实。
Pool 授予与数据库事务不天然原子：若取得租约后取消、绑定写入失败或启动失败，
必须有可核实的回收/补偿路径，不能漏资源或伪造已启动。耗时外部操作不放进
SQLite 长事务；具体执行开始与持久事实的崩溃窗口在实施契约中验证。

同一 Execution 的全部需求结束时，引擎按执行政策请求停止。单个 Task 取消不能杀死
仍服务其他需求的执行；Task deadline 也不能直接替代共享 Execution 的墙钟上限。
时间失约与实际执行停止分别记录，仍允许超时完成。发出停止信号不等于已清理，
未经确认的资源不得返还可用池。重启的未知执行按既定 execution_interrupted 规则处理，
不把失败记录当成外部进程已经消失的证明。

## 5. 前置 Check 的触发和证据

业务方决定何时提交前置 Check Request、是否再次检查；Engine 具备执行 Check Task
的内置支持，但不因父任务被阻塞就自动派发、轮询、重试或治理。

```text
业务方提交前置 Check Request
  → Engine 正常准入并调度
  → 从 Check Pool 取得 Executor 租约并执行
  → Engine 记录关联 Check Task 的结果
  → 父 Task 的 readiness 采用合格通过证据
```

证据不是业务任意写入的 passed 布尔值：须引用可追溯的 Check Task/Execution，
验证当前 Request/Task、条件关联、eligible 后检查时间和访问作用域。
业务可负责建立关联，但不能直接设置父任务 stage 或 readiness.satisfiedAt。
Check completed 不等于检查通过；正常不通过与执行故障分开处理。

一旦本 Task 采用合格通过证据解锁，就不回退 stage；后续检查失败不撤销这次解锁。
不引入 TTL、启动前强制重查或持续条件承诺。Executor 仍应处理实际执行时条件已变化；
后继 Task 需要满足自身 eligible 时间要求。完整 Check 请求/结果及关联接口需在
相应协议中统一定义，不能偷用尚未定案的字段形状。

## 6. 编排与执行资源避免互锁

同 Engine 中，Probe 可能等待 Check，Regulate 可能等待 Probe 或 Agent。
若父任务占满统一执行槽位且等待子任务，而子任务也必须取得同一批槽位，就会死锁。

因此区分编排需求容量与实际运行资源；父任务不能持有子任务必需且不可获得的独占配额。
例如 Probe 使用有界编排槽位，Node Checker 使用独立 worker pool，Agent 使用自己的
执行额度。只是把配额按类型改名还不够：嵌套同类型任务也必须有明确的资源策略。
具体预算由宿主/Pool 配置，引擎管理等待和 owner；不通过无限并发绕过死锁。
按类型注入 Pool 不自动解决互锁；不同 Pool 若底层共享同一个耗尽的容量限制，也必须
证明父等待子时仍有可用执行路径。

## 7. 组装示意与验证重点

以下为伪代码，不定义已存在的 TypeScript API：

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
// 宿主通过 Node/框架连接器挂载 handler，并自行监听。
```

TaskType 统一提供类型契约与分配入口，内部 Pool 仍负责实例容量、租约及回收；
运行时选择为 Check TaskType/Pool 内部的适配配置，不成为所有任务的通用输入。
探测/调节需要子任务端口时由宿主显式装配；通用包不自动导入生产业务类型。

### TaskType 的职责

以下为逻辑签名，结果校验、可信上下文与租约释放细节仍按完整端口契约落实，
不把这组简写误当成已发布 TypeScript API：

```text
TaskType<Input, Prepared>
  validate(input: unknown) → Input
  prepare?(input: Input, context) → Promise<Prepared>
  allocate(prepared: Prepared, signal) → Promise<ExecutorLease<Prepared>>
  equals(a: Input, b: Input) → boolean
```

- validate 在申请 Executor 之前预检业务输入，成功得到可信 Input，失败明确拒绝；
  通用 Request 字段及权限由 Engine 校验。预检本身仍有载荷/深度限制。
- prepare 可选，负责准确配置/内容与执行输入的准备，不要求所有任务都是 artifact +
  subject。无准备需求时 Prepared=Input，直接使用已校验输入，不伪造准备过程事实。
  有 prepare 时须成功后再 allocate；例如取得准确 Checker 定义后按 subjectSchema
  校验 subject，失败也不占 Executor 槽位。下载和准备不能藏在 allocation 等待中。
- allocate 通过内部 Pool 申请与 Prepared 兼容的 Executor 使用租约，可撤销等待；
  不改变已有授予、复核、归还和异常淘汰规则。不准备的类型不能省略 prepare 却假定
  Prepared 是另一种尚未构造的类型；实际类型定义需保证此关联。
- equals 定义完整业务 Input 的等价关系，不比较 requestId、eligibleAt、timeoutMs、
  recurrence、executionMatch 等请求身份或调度策略。确定、无副作用、满足自反/
  对称/传递，不忽略影响执行的业务字段。

分组仍须结合准备后的准确内容、类型、权限及执行环境。原始浮动 URL 相等不证明
两次 prepare 选中同一版本；具体类型须提供可比较、可恢复的准备身份，不能让 equals
绕过这些约束。如何编码准备身份按各类型契约落实，不由 Engine 猜业务对象字段。
请求自己的 executionMatch 再决定兼容执行的时间资格，匹配与结果采用仍由 Engine
协调，Pool 不另做一套 Task 合并。equals 不能替代 Request 幂等比较：同 requestId
改变调度策略仍需按完整请求意图判冲突。

验证应覆盖：Executor 脱离 Engine 可运行；同引擎类型分派与授权；暂无资源不进入
running；共享执行不重复申请租约；撤销/授予竞争、绑定写入失败有回收；
重复归还不增加容量、旧代次不污染新租约、清理失败不返池；
前置检查只由业务触发且通过后不回退；父等待子任务时可取得所需资源；
HTTP 与进程内调用同源，挂载不自行监听或通过自己的 HTTP 入口递归调度。
