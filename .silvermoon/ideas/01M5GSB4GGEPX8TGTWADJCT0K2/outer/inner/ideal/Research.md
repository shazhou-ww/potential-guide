# Pilot 进程与 Check 请求：调研与候选方案

## 状态与已确认方向

2026-10-23 的最新模型为每个 Objective Pilot 定义独立 executable，由它管理内部 check
排队与线程，regulation object 和 subject 随请求传入。后续因独立 CLI 的并发 Regulation
共享进程，用户提出 HTTP 与用户级端口注册文件，并明确同一 Pilot ID 不允许多版本并存：
注册表的 key 为 Pilot ID，既发现同一端口，又对活动进程去重。
版本是实例属性和请求校验条件，不是多实例键。启动竞争、版本切换和共享回收机制仍待细化。

Q01 随后由用户明确：check 纳入 probe 协议，形成统一入口；调度器就是 CLI。
顶层调用 regulation 或 probe 时事先启动所需服务，regulation 内再次 probe 时，
若相同服务已经存在，则直接复用。用户级共享注册要求修正了此前只限顶层调用的推导：
多个 CLI 共同发现和使用同一实例，某个 CLI 结束不能关闭他人仍使用的服务。
无需因此自动引入额外的全局常驻调度进程；CLI 仍是协议参与者和调度入口。
此处沿用 probe 协议的现有术语，不引入新协议名称；服务扩展的 wire 细节仍待讨论。

本 idea 仍只记录调研与逐项澄清，没有授权构想验收、实现或部署；
此前另一 idea 的门限委托不自动沿用到这里。Q02 随后经用户确认：破坏性升级、全量迁移，
不保留旧 executable/裸 subject HTTP 的运行时兼容，保留明确版本及迁移边界。
用户同时要求收敛可解答的其他问题；Q07/Q08/Q09 给出技术方案。
Q03 仅归属方向已收敛，依赖回传、身份/证据闭环、预算取消、死锁及失联处理尚未定稿；
Q04/Q05/Q06 也仍有行为取舍；Q07 重新明确 ID 单实例，Q09/Q10 补充共享生命周期与注册问题，
状态详见 [OpenQuestions.md](./OpenQuestions.md)。

## 性能动机与证据边界

前一轮优化及其固定消费证据见
[probe-efficiency](../../../../01M5EY383YB0ZY4HMKB8BFT7HM/outer/Consumption.md)。
本会话在 `e2f0b1a6d0c761f4df8c1e3529c3f713d075c60e` 上复测：
默认预算三次超时，显式预算两次完整 CLI 调用约 50.5 / 48.5 秒，
结果均 standardized、0 个问题，22 次实际观察、21 次复用、43 次逻辑观察。

后续插桩确认 44 个 check 进程，其中 42 个包进程累计生命周期约 35.0 秒；
启动到首次读取视图约 29.5 秒，其中 bundle 加载和初始化约 18.0 秒。
这些是包含关系，不能相加。视图读取及大 JSON 解析累计约 1.25 秒。
checker bundle 约 4.3 MB，TypeScript 占约 3.58 MB；体积比例不等于 CPU 比例。
两个包级 CPU 样本指向模块编译、CJS 导出分析和顶层初始化。

以上为方向依据，不是本 idea 的实施或部署证据。插桩总观察约 59 秒，其中捕获约 19 秒，
不能与未插桩约 42 秒直接混比；共享机器与首次加载均存在波动。
进程减少不自动构成默认 30 秒 SLA，需后续同环境、同输入、冷/热真实消费验证。

## 仓库现状与可复用能力

调研代码基线为 `5055e96c2271035c641e9eb810c0768e6c7e991e`；
相对上面的测量版本仅并入另一个 idea 的文档，未改变这些产品路径。

| 位置 | 已有行为 | 对本方案的意义 |
| --- | --- | --- |
| [probes.ts](../../../../../../packages/objective-pilot/src/probes.ts) / createHttpCheckProbe | POST subject，HTTP 200 时严格解析现有 CheckResult envelope；支持客户端超时、取消和宿主证据 | 可复用结果语义，但没有服务管理、请求上下文、握手或依赖回调协议 |
| 同文件 / createProcessCheckProbe | 每次创建临时目录并 spawn；经 IPC 处理依赖请求，环境变量提供视图和证据 | 不能只把 spawn 换成 fetch 而忽略这些能力 |
| [pilot-source.ts](../../../../../../packages/cli-runtime/src/pilot-source.ts) | 固定 Git commit/tree/repositoryTree，发现 run/run.*，仅绑定进程 probe；退出删除来源 checkout | HTTP 绑定尚未接入；长期服务必须独立持有来源与文件的寿命，不能引用已清理的 checkout |
| [dependency.ts](../../../../../../packages/objective-pilot/src/dependency.ts) | bindDependencyRequest 捕获调用者观察作用域；createSourceObjectiveDependencyProbe 依赖 process.send 和 requestId | HTTP 服务需把依赖观察路由回本次宿主，继续由宿主验证来源和同轮证据 |
| [regulation-worker.ts](../../../../../../packages/pguide-regulate/src/regulation-worker.ts) | 一次 withPilot 包含一次 regulate；Regulator 在内部循环调用观察 | 当前已非“每次 probe 一个 Pilot 进程”；主要重复的是 check 子进程 |
| [check.mjs](../../../../../../packages/objective-monorepo-standard/check.mjs) | main 可按 phase、scope、subject、evidence、dependencyProbe 调用 checker | 有可复用业务入口，但环境变量、进程绑定和取消仍需请求化 |
| [shared.ts](../../../../../../packages/objective-monorepo-standard/src/shared.ts) | 从进程环境读取视图，要求拥有 IPC 连接，验证 digest/root | 多请求服务不能继续用进程全局环境切换不同请求的视图 |
| [evidence.ts](../../../../../../packages/objective-pilot/src/evidence.ts) | 每个 check 有 runId/checkRunId/attempt，记录与脱敏有既有边界 | 服务日志不能代替调用者证据，也不能跨请求混用目录、身份或秘密值保护集合 |

本次独立运行：

```powershell
pnpm exec tsx --test --test-name-pattern='HTTP|already aborted|transport failures' packages\objective-pilot\test\probes.test.ts
```

4/4 通过，覆盖 HTTP POST/业务失败 envelope、传输故障、预取消不执行及
客户端取消后服务端仍继续完成。它验证已有行为，不证明驻留服务已经实现。

## 外部资料核对

使用 Node v24.11.1 官方文档与 HTTP 标准核对，未将仓库代码或 subject 发送到外部服务：

- [Node net](https://github.com/nodejs/node/blob/v24.11.1/doc/api/net.md)：
  listen 端口为 0 时由 OS 分配，listening 后从 address 获取端口；
  省略 host 可能监听所有接口，不应把默认监听地址当成 loopback。
- [Node HTTP](https://github.com/nodejs/node/blob/v24.11.1/doc/api/http.md)：
  server.close 停止接收新连接并关闭空闲连接；closeAllConnections 可强制关闭活动
  HTTP(S) 连接，但不关闭升级后的连接，也不证明应用任务已停止。应用仍需 drain 和 deadline。
- [Node child_process](https://github.com/nodejs/node/blob/v24.11.1/doc/api/child_process.md)：
  detached、unref 与 stdio/IPC 引用决定父子进程退出关系；单个 detached 标志不是完整服务管理，
  也不提供租约、就绪、自动回收或崩溃恢复。
- [RFC 9110 §9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2)：
  非幂等请求在不能确认未执行或语义幂等时不应自动重放。check 可能执行工具或有副作用，
  不能仅因 POST 超时或断线就重发。请求去重、结果未知与业务幂等须单独定义。

HTTP keep-alive 仅复用连接；加载好的 checker 由持续存活的应用进程复用，两者不可混为一谈。
HTTP 不提供远端业务停止保证，这一点同时有仓库测试证明。

## 已明确的调度所有权与候选接线

```text
多个 CLI（按 probe 协议协调服务）
    -> 用户级注册表：Pilot ID -> 一个活动端口/进程
    -> 发现已有实例，或按 ID 协调启动并等待就绪
    -> 各自 probe / regulation 的调度上下文
        -> 每轮 Pilot 观察及证据上下文
        -> HTTP check 请求 -> 同一 Pilot executable 进程
            -> Pilot 内部请求队列与线程分配
            -> check 执行线程（请求 1，subject A / regulation X）
            -> check 执行线程（请求 2，subject B / regulation Y）
    -> 各自结束时释放使用权；共享实例回收机制待定
```

Pilot 保留层级判断和问题聚合；Regulator 保留观察与修复循环；服务调度器不另造业务
Coordinator。CLI 通过共享注册协调服务，内层 probe 借用其调用上下文，
不能在每次 probe 或每个 check 时重新启动服务。
这也不要求把库调用实现为再次执行 CLI 命令。

probe 协议的统一入口属于已确认要求；建议由协议包定义版本化的互操作边界，
执行层提供 HTTP 请求适配，Git 来源适配层提供服务来源绑定，
CLI 负责管理服务注册与使用，具体模块拆分及端点字段在后续协议设计确定。
不将独立常驻调度 app 或新的业务 Coordinator 作为必需架构。
当前采用 HTTP/端口发现方向；跨 CLI 使用权跟踪与失联恢复是必需问题，租约是候选实现。
CLI 管进程生命周期和请求路由，Pilot executable 自己管理内部队列与线程，
两者不是两套重复的 check 排队器。统一 executable 位于每个 Pilot 模型中，
不是所有 Objective 共用一个万能业务程序，也不是为每个 check 保留一个启动脚本。

### 用户明确的进程与线程边界

同一 Pilot 实例对应同一服务进程，check 调用是最小并发单元，可在独立线程执行。
服务可为不同 regulation object 与 subject 处理请求，不按这些业务对象重复创建进程。
不同 CLI 可共享同一 Pilot ID 的活动实例；实例寿命不再简单绑定某个 regulation 或首个启动 CLI。

服务控制面与 check 的 CPU 工作应分离；每个请求显式携带观察/父请求身份、输入视图、
预算、依赖能力和证据，不能使用进程全局的“当前 subject/regulation”。
线程池复用是候选机制而非已确认实现；新建线程也可能重复加载重依赖，
尤其 Node worker_threads 的 JavaScript 执行环境不自动共享模块实例。
后续性能证据需同时统计进程启动、线程启动及每线程初始化次数，
不能只把 44 个进程改为 44 个新线程就宣称重初始化已消除。

### 实例身份与复用粒度

用户明确在用户级注册范围内以规范 Pilot ID 唯一去重。同 ID 只能有一个活动进程和端口，
不按版本或配置扩展注册键。准确 commit/tree/repositoryTree、协议版本和执行配置
是已运行实例的属性，用于请求兼容性及证据校验，不是允许新实例并存的理由。
请求版本不匹配时不静默换版本执行，也不另开端口启动另一版本。
建议明确冲突后按授权停旧启新，但冲突等待、切换授权和固定版本恢复处理仍待讨论。
重启后是否必须保留相同数值端口也未明确；服务停止后注册记录不构成 OS 端口预留。

regulation object、subject、观察 ID、check ref 和语言属于请求，不是“一对象一个服务”的理由。
本仓库根与 package-standard 是两个 Objective；若每个各一实例，
21 个包的 42 次检查可由同一个 package-standard 服务处理，另一个根服务处理根检查。
这是假设一致配置下的目标模型，不承诺所有第三方服务都能跨 subject 安全共享。

### 生命周期

建议模型为 absent -> starting -> ready -> draining -> stopped，失败为明确 fault。
同 ID 并发 acquire 需要跨 CLI 单次启动仲裁，包括不同请求版本的竞争；
ready 需确认协议、来源和实例代际，
不能通过“某个端口能连上”就认定是目标服务。
当前 HTTP 方向下，建议明确 loopback 地址、动态绑定后 ready 握手并原子登记，
仅 loopback 并不等于已认证。动态端口、锁、记录结构和访问能力仍是技术建议，
不得把它们写成用户已经确认的字段或机制。

CLI 在 probe 或 regulation 前发现并验证注册实例；确无运行实例时协调启动，
内层 probe 和独立并发 CLI 都复用该 ID 的同一实例。单个调用结束只释放本调用的使用权，
不得停止另一个调用仍使用的实例。动态依赖同样经过共享 ID 去重。
建议服务维护有界使用租约，在无活动任务和使用者时闲置回收，机制及参数仍待讨论。
CLI 异常退出、旧进程失联但未退出、注册残留和升级竞争必须有明确处理，不盲目再起。
shutdown 须先停止新请求、等待/取消活动任务，
再以明确截止回收；共享来源资源不能随启动 CLI 退出而删除，必须等最后使用结束。
终止需验证实例身份及权限，避免 PID 重用、误杀或删除新代际的注册记录。

### 请求与结果

保留“业务未达成也是成功观察”的现有 envelope；不可将服务故障包装成低层级。
候选管理协议需区分服务/实例、客户端/观察、requestId、完整 level/check ref、
subject、语言、输入视图引用/摘要、剩余预算与证据身份，但不提前锁定 wire schema。
新运行时统一采用版本化的 probe 服务请求，传输方式待 Q10 选择，不保留旧一次性运行协议。
旧输入明确拒绝；可复用现有 envelope 校验、超时与 evidence 代码，
但不能以相同接口静默重新解释旧 POST 语义。
服务可拒绝不匹配版本或未声明 check，不能根据任意路径加载客户端提供的代码。

每轮输入与结果仍刷新；共享服务只保留允许跨请求存在的代码和编译器缓存。
输入视图在请求完成或取消确认前保持有效，不可在 HTTP 客户端返回后立即删除，
除非已确认服务端不再读取。多请求状态必须显式隔离，不能改写全局 process.env/cwd。

### 依赖、调度与取消的关键缺口

根 check 仍会请求 package-standard 的依赖观察。当前建议为 CLI 提供请求级受限回传能力，
将服务依赖请求路由回原观察宿主，由宿主调用现有绑定、预算及证据验证。
跨 regulation worker 边界可转发控制消息，但不另起无关观察；
回调绑定观察及父请求，结束时失效，具体协议字段仍待设计。
不接受任意 subject 内 callback URL，也不让服务另起无宿主观察来冒充原轮证据。
依赖回传不必预设为反向 HTTP：双向消息通道可承载依赖子请求；若选 HTTP，
尚需讨论 CLI 是否临时监听回调、如何路由至 regulation worker 的原观察作用域，
以及迟到响应、登记证据后再响应、预算取消和失联的完整状态；
这些不是已确定的接口细节，问题集中记录于 [Q03](./OpenQuestions.md#q03-依赖请求回到谁如何保持原观察作用域方向已收敛协议闭环待讨论)。

按新明确模型，check 请求在线程中独立执行，容量与队列有界，控制面不执行同步业务工作，
也不排在阻塞业务后方。之前“服务内首轮串行”的建议被该并发模型取代。
不同服务并不自动排除死锁：全局并发上限若被等待依赖的父请求占满，
子服务仍可能无法调度。依赖派发不能被等待的父请求占满全局槽，排队也消耗剩余预算；
同一服务有空闲线程时可处理依赖重入，但线程全被等待子请求的父任务占满仍会死锁；
是否挂起/释放执行容量、预留依赖容量或明确拒绝仍待讨论，不能默默挂起或无限创建线程。

HTTP 断线只表明客户端不再等待。取消应有请求身份及状态确认；
Node 同步 TypeScript 运算应在线程中运行，不能占用进程控制面的事件循环。
建议协作取消加独立宿主截止，不能确认停止时终止对应工作线程并等待退出；
单请求取消不应主动终止其他请求，服务整体崩溃时才涉及所有在途请求。
线程终止对原生调用、外部子进程及资源清理的保证仍需验证，不能直接视为外部任务已停止。
未确认结束前不得复用请求状态、释放输入资源或自动重放。
请求去重以调用/观察/实例代际为边界，重复 ID 不二次执行，不提供跨重启 exactly-once；
显式 Regulation 新尝试需新身份与证据，不由传输层透明重试。

## 迁移、验证与范围建议

Q02 已确认当前执行链全量迁移到新的 probe 服务契约，无 run.* 或旧裸 subject HTTP 回退。
迁移包含全部内置 Objective、脚手架、示例、测试、生成物和直接相关消费入口；
可复用业务函数，不维持两套协议。旧输入明确拒绝并给出迁移要求，历史固定证据不重绑。
若改变 manifest，遵守已发布 schema 字节/URI 不可变并引入新版本；
具体声明形式后续设计，不在调研阶段猜未来 schema 或直接改版本字段。

实施时需同时覆盖：服务启动失败/就绪超时/竞争启动、重复请求与丢响应、
顶层退出/内层借用及异常退出、不同版本隔离、跨 subject 和跨观察刷新、
依赖请求证据及死锁、CPU 阻塞取消、视图与 checkout 保留和最终清理。
固定版本隔离消费再比较真实进程数、初始化次数、冷启动与连续 probe 耗时；
不能以 API 单测或单次启动日志代替完整 Regulation/CLI 路径。

候选首轮限定本机服务，不包含公网托管、远端路径或 secret/subject 上传。
远程 HTTP 能力不代表本地文件路径可跨机器读取；远程部署、授权及输入传输须另行决定。
此限制为建议，尚非用户已确认的排除项。
