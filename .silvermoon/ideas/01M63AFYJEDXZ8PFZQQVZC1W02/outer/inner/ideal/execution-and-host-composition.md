# ExecutorPool、Executor、Engine 与 HTTP Server

本文支撑[通用任务引擎构想](./Idea.md)，记录 2026-10-29 的职责收敛。
这是设计定义，不表示接口已经实现；函数名称仅作示意。包划分见
[系统边界](./system-boundaries.md)，任务时间、取消和递归语义见[概念](./concepts.md)。

## 1. 四个角色

| 角色 | 拥有的职责 | 不承担什么 |
|---|---|---|
| Task Engine | Request 准入/幂等、Task/Series 调度、prepare/allocation 协调、Execution 共享与需求所有权、事实记录及恢复 | 业务前置条件判定、具体运行时加载、数据库驱动或 HTTP listener |
| ExecutorPool | 管理容量与申请等待，创建/复用 Executor，原子授予使用租约，确认回收或淘汰异常实例 | 决定 Task 结局、系列递归、共享 Execution 匹配或绕过权限政策 |
| Executor | 在租约内使用准备输入执行一次 Execution，报告进展/结果/故障，响应 Execution 停止信号并完成清理 | Request 准入、Task 状态修改、Series、内部等待同一执行配额或重复调度自身请求 |
| HTTP Server / 宿主 | 装配 Engine、类型及其 ExecutorPool、Store、Clock；认证、TLS、监听、挂载与进程生命周期 | 复制一套调度器、通过 HTTP 断连隐式取消 Task |

原“资源适配器”的能力收进 ExecutorPool 内部。宿主按类型注入统一的 TaskType，
由它封装纯校验/输入等价判断、必需准备及 Pool 分配能力，不再分别拼接 Type 和 Pool，
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

check/probe/regulate 都是宿主可选择注册的业务类型，没有一种是 Engine 的必需
内置类型；前面的三类型图是宿主组装示例，不是核心依赖。具体 runtime、Checker
下载器和业务检查由对应 TaskType 提供。生产业务接入仍归来源 idea，
本引擎先用两个非制品测试类型验证扩展性，不要求有 Check Pool 才能启动。

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
Task 已到可调度时间且 prepare 已完成
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

## 5. Executor 的业务前置逻辑与快速返回

```text
Engine：validate → 受理/等待 eligible → prepare → allocate → execute
Executor：                                               轻量业务判断
                                                       ├─ 不满足 → 正常返回
                                                       └─ 满足 → 重业务工作
```

Engine 不再提供 prerequisite/readiness、条件证据关联或 blocked 状态，也不新增
waitUntilReady 之类的替代等待端口。Executor 在已持有租约、execution 已开始时判断
前提，不满足就按类型契约返回，例如报告未执行和业务原因；Engine 记录 completed，
不声称重业务已经执行。检查本身发生异常则为 execution_failed，而不是正常不满足。

该方案节省的是重工作，不是 allocation 和实例初始化成本。快速返回后本次尝试结束，
不会留住同一个 Task 等待未来条件变好；重试由新业务请求或明确 recurrence 驱动。
不在执行器内部长期轮询等待“解锁”，不另造跨请求熔断状态机。业务可在进展/结果
中记录检查依据，但引擎不解释或据此调度条件任务。

前提即便刚检查通过，实际操作仍可能失效；必要保证由业务事务、锁、条件写入或
幂等提供。若 Executor 编排子任务，仍按下一节的资源约束处理，不能重新制造互锁。

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
TaskType<Input, Prepared = Input>
  validate(input: unknown) → Input
  equals(input: Input, other: unknown) → boolean
  prepare(input: Input, signal) → Promise<Prepared>
  allocate(prepared: Prepared, signal) → Promise<ExecutorLease<Prepared>>
```

- validate 是纯 Validator，在受理/申请 Executor 之前预检业务输入，成功得到可信 Input，
  失败明确拒绝；不做 IO、读取可变配置、隐式转换或修改输入。Engine 另验通用字段和
  权限，计算本身仍有载荷/深度限制。不要求 TaskType 提供 inputSchema 或使用特定
  Schema 库，具体类型可以自行选择校验实现。
- prepare 必需，负责准确配置/内容与执行输入的准备，不要求所有任务都是 artifact +
  subject。无准备需求时提供 async input => input，且 Prepared=Input；不得以返回
  undefined 的空函数冒充已准备输入。Engine 始终调用并记录真实的准备开始/完成或失败，
  即时恒等返回不伪造下载动作；可以提供恒等 helper，但不形成可选分支。
  prepare 成功后才 allocate；例如取得准确 Checker 定义后按 subjectSchema
  校验 subject，失败也不占 Executor 槽位。下载和准备不能藏在 allocation 等待中。
- allocate 通过内部 Pool 申请与 Prepared 兼容的 Executor 使用租约，可撤销等待；
  不改变已有授予、复核、归还和异常淘汰规则。prepare/allocate 是具备副作用的能力边界，
  有独立的取消、失败及资源生命周期；不能因恒等 prepare 没有 IO 就把所有实现视为纯函数。
- equals 是纯函数，以合法 Input 为基准比较 unknown；other 不属于合法输入域时返回
  false，不抛业务校验错误、不隐式转换。双方均属合法 Input 时须满足自反/对称/传递；
  正常 Engine 分组的输入都已校验，此放宽不替代准入 validate。真正的实现故障仍
  明确报告，不能宽泛 catch 后伪装“不相等”。不比较 requestId、eligibleAt、timeoutMs、
  recurrence、executionMatch 等身份/调度字段，不忽略影响执行的业务输入。

分组仍须结合准备后的准确内容、类型、权限及执行环境。原始浮动 URL 相等不证明
两次 prepare 选中同一版本；具体类型须提供可比较、可恢复的准备身份，不能让 equals
绕过这些约束。如何编码准备身份按各类型契约落实，不由 Engine 猜业务对象字段。
请求自己的 executionMatch 再决定兼容执行的时间资格，匹配与结果采用仍由 Engine
协调，Pool 不另做一套 Task 合并。equals 不能替代 Request 幂等比较：同 requestId
改变调度策略仍需按完整请求意图判冲突。

验证应覆盖：Executor 脱离 Engine 可运行；同引擎类型分派与授权；暂无资源不进入
running；共享执行不重复申请租约；撤销/授予竞争、绑定写入失败有回收；
重复归还不增加容量、旧代次不污染新租约、清理失败不返池；
Executor 前置不满足快速返回、不进入引擎等待；纯校验与等价判断不触发 IO；
必需 prepare 的恒等实现真实调用，unknown 输入等价反例成立；父等待子任务可获得资源；
HTTP 与进程内调用同源，挂载不自行监听或通过自己的 HTTP 入口递归调度。
