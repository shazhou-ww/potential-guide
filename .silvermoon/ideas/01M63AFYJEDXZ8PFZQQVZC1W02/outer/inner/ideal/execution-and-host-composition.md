# Executor、资源适配器、Engine 与 HTTP Server

本文支撑[通用任务引擎构想](./Idea.md)，记录 2026-10-29 的职责收敛。
这是设计定义，不表示接口已经实现；函数名称仅作示意。包划分见
[系统边界](./system-boundaries.md)，任务时间、取消和递归语义见[概念](./concepts.md)。

## 1. 四个角色

| 角色 | 拥有的职责 | 不承担什么 |
|---|---|---|
| Task Engine | Request 准入/幂等、Task/Series 调度、readiness、allocation 协调、Execution 共享与需求所有权、事实记录及恢复 | 具体运行时加载、启动 worker、数据库驱动或 HTTP listener |
| 资源适配器 | 判断具体资源可用性、原子预留、返回执行资源句柄、清理与释放/隔离 | 决定 Task 结局、系列递归、绕过共享与权限政策 |
| Executor | 使用已准备输入与已分配资源执行，报告进展/结果/故障，响应 Execution 停止信号并报告清理 | Request 准入、Task 状态修改、Series、重复调度自己的请求 |
| HTTP Server / 宿主 | 装配 Engine、类型、Executor、资源、Store、Clock；认证、TLS、监听、挂载与进程生命周期 | 复制一套调度器、通过 HTTP 断连隐式取消 Task |

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
             Check Executor  Probe Executor  Regulate Executor
                  |
             按 Checker runtime 分派
                  |
             Node 执行适配器（本轮）
```

Engine 支持注册多种任务类型及对应 Executor；同一实例可以承载 check/probe/regulate，
不要求每种业务启动一套引擎。类型注册还包括输入/结果/进展校验、准备与兼容政策，
不能只注入一个执行函数而省略这些约束。未知类型或缺少所需执行能力须明确拒绝。

Check 是内置支持的任务类型，保证前置条件可通过真实 Check Task 验证；具体检查
能力由宿主注入，不代表内核自带所有 runtime、Checker 下载器或任意业务检查代码。
probe/regulate 及其他类型通过适配器注册；将现有生产业务接入的工作仍归来源 idea，
本引擎可先用内置 Check 的测试 Executor 和非制品类型验证扩展性。

Task type 决定执行哪种业务；runtime 分派属于 Check 执行适配侧，不是所有任务共有
的字段。Host 配置可提供 runtime 到具体执行能力的映射。本地 adapter 直接调用
kernel/pool，不通过同一 Engine 的 Check HTTP 准入接口再提交自身任务。
未来远程 adapter 可以携带 Host 地址，但地址、发现和远程恢复不是 Engine 必需概念，
本轮不据此扩张分布式执行能力。

## 3. 依赖关系，而非互相持有具体实现

```text
task-engine ───────────→ 执行/资源/服务端口（task-protocol）
具体 Executor ─────────→ 执行/资源端口
具体资源适配器 ────────→ 资源端口
task-engine-http ──────→ Engine 服务端口
宿主组装 ──────────────→ Engine + Executor + 资源适配器 + HTTP + Store
```

Executor 不导入 Task Engine 的实现，不要求持有 Engine 实例；它可独立测试或被其他
调度器调用。执行上下文中的进展回调、结果返回、执行身份和停止信号是端口契约，
不是反向包依赖。资源适配器同样不改写 Task snapshot 或持久事实。

Executor 与资源适配器可以由同一个对象/包提供，例如 Node kernel/pool 同时提供
资源预留和运行方法；职责分离不要求拆成更多 npm 包或进程。具体实现放在适配层，
不能为了共用当前包而让 task-engine 反向导入 checker-host 组装入口。

Probe/Regulate 若需编排子任务，可额外依赖宿主注入的窄化任务提交/观察端口；
它不是 Executor 基础接口的强制依赖，更不是对 Engine 具体实现的导入。
子请求有独立身份、明确因果关联和权限/预算，不能递归重提当前 Execution 的自身请求。

## 4. allocation 的责任

allocation 的协调、匹配及正式绑定属于 Engine；实际资源的取得与回收属于资源适配器。
Executor 接到 execute 时应已有启动所需资源，不在内部无限排队等待同一执行配额。

```text
Task 已具备执行条件
  → Engine 判断是否可关联兼容 Execution
      → 若可关联：增加需求 owner，不重复申请该执行已经占用的资源
      → 否则：向资源适配器申请新执行所需资源
          → 暂无容量：仍等待 allocation，不能标记 running
          → 最终申请失败：明确 allocation_failed
          → 预留成功：Engine 复核有效需求并提交绑定
              → 启动 Executor，记录准确执行开始事实
              → 校验并记录进展、结果或故障
              → 确认清理后释放资源，无法确认则隔离
```

资源可用性查询不是资源预留；不能先观察“还有一个空位”再由多个请求同时占用。
预留句柄属于具体 Execution 的资源所有权，不按每个共享 Task 再分配一份。
资源句柄可为进程内对象，不进入公共 JSON；持久记录只保留可验证身份与必要恢复事实。
资源预留与数据库事务不天然原子：若预留后取消、绑定写入失败或启动失败，
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
  → 注入的 Check Executor 执行
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
具体预算由宿主/资源适配器配置，引擎管理等待和 owner；不通过无限并发绕过死锁。

## 7. 组装示意与验证重点

以下为伪代码，不定义已存在的 TypeScript API：

```typescript
const nodeChecks = createNodeCheckRuntime({ workerPool });
const engine = createTaskEngine({
  store,
  clock,
  types: {
    check: createCheckType({ runtimes: { node: nodeChecks } }),
    probe: probeType,
    regulate: regulateType,
  },
});
const handler = createTaskHandler({ service: engine, resolveCaller });
// 宿主通过 Node/框架连接器挂载 handler，并自行监听。
```

runtimes 条目提供检查执行及对应资源能力，具体端口签名留给实施定义。
探测/调节需要子任务端口时由宿主显式装配；通用包不自动导入生产业务类型。

验证应覆盖：Executor 脱离 Engine 可运行；同引擎类型分派与授权；暂无资源不进入
running；共享执行不重复占位；预留后取消/写入失败有回收；资源清理失败不返池；
前置检查只由业务触发且通过后不回退；父等待子任务时可取得所需资源；
HTTP 与进程内调用同源，挂载不自行监听或通过自己的 HTTP 入口递归调度。
