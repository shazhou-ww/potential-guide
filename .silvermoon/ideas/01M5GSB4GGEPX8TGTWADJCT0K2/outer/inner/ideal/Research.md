# 驻留 HTTP Check 服务：调研与候选方案

## 状态与已确认方向

2026-10-22 的用户讨论明确选择 HTTP，而非为每次 check 启动 executable：
每个 Objective Pilot 提供服务启动入口，所有 check 变为对该服务的请求；
统一调度器管理进程生命周期。一次 Regulation 内多次 probe 可复用服务，
无需再为观察逻辑创建一个 Pilot 进程。

用户本次只要求充分调研、新建 idea 和保留疑问，待后续讨论。没有授权本 idea 的
构想验收、实现或部署；此前另一 idea 的门限委托不自动沿用到这里。
跨独立 CLI 的共享范围、默认驻留策略、兼容形态均未确认，详见 [OpenQuestions.md](./OpenQuestions.md)。

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

## 候选职责模型，尚未定稿

```text
CLI / Regulator / Coordinator
    -> 宿主侧观察与证据上下文
    -> 服务调度客户端 acquire / release
    -> Objective check HTTP 服务

统一服务调度器
    -> 实例注册与准确来源绑定
    -> 启动 / 就绪 / 使用权 / drain / 停止
```

Pilot 保留层级判断和问题聚合；Regulator 保留观察与修复循环；服务调度器不另造业务
Coordinator。底层接口不能依赖 CLI 命令递归调用；CLI 只是一个客户端和装配入口。

建议由协议包定义版本化的互操作边界，执行层提供 HTTP 请求适配，
Git 来源适配层提供服务来源绑定，进程外宿主负责共享实例。
是否新增 workspace、命令或采用库内托管模式留待 Q01/Q09，不预先决定包名与端点布局。

### 实例身份与复用粒度

建议按 Objective 规范身份、准确目录内容及仓库支撑来源、服务协议版本、
启动配置和权限/使用者边界识别实例。不能只比较 executable 路径或仅使用移动 HEAD。
同代码树但不同检索 commit 是否允许共用，需明确逐请求来源审计后再定。

subject、观察 ID、check ref 和语言属于请求，不是“一包一个服务”的理由。
本仓库根与 package-standard 是两个 Objective；若每个各一实例，
21 个包的 42 次检查可由同一个 package-standard 服务处理，另一个根服务处理根检查。
这是假设一致配置下的目标模型，不承诺所有第三方服务都能跨 subject 安全共享。

### 生命周期

建议模型为 absent -> starting -> ready -> draining -> stopped，失败为明确 fault。
同身份并发 acquire 需要单次启动的仲裁；ready 需确认协议、来源和实例代际，
不能通过“某个端口能连上”就认定是目标服务。
建议首轮仅本机明确 loopback 地址，由 OS 分配端口并返回就绪消息；
仅 loopback 并不等于已认证，仍需调用者与控制接口的能力限制。

客户端结束只释放自身使用权；最后租约结束后何时回收、是否跨独立 CLI 存活尚待决定。
失联需处理租约过期、占用请求和未知执行状态。shutdown 须先停止新请求、等待/取消活动任务，
再以明确截止回收，仅终止持有身份且由本管理器拥有的进程，避免 PID 重用和误杀。

### 请求与结果

保留“业务未达成也是成功观察”的现有 envelope；不可将服务故障包装成低层级。
候选管理协议需区分服务/实例、客户端/观察、requestId、完整 level/check ref、
subject、语言、输入视图引用/摘要、剩余预算与证据身份，但不提前锁定 wire schema。
现有裸 subject HTTP adapter 可作为已绑定端点的基础；
若引入新 envelope/headers/路由，不得静默改变其旧 POST 语义。
服务可拒绝不匹配版本或未声明 check，不能根据任意路径加载客户端提供的代码。

每轮输入与结果仍刷新；共享服务只保留允许跨请求存在的代码和编译器缓存。
输入视图在请求完成或取消确认前保持有效，不可在 HTTP 客户端返回后立即删除，
除非已确认服务端不再读取。多请求状态必须显式隔离，不能改写全局 process.env/cwd。

### 依赖、调度与取消的关键缺口

根 HTTP check 仍会请求 package-standard 的依赖观察。建议保留调用者宿主为证据权威：
服务通过请求作用域能力把依赖请求交回宿主，由宿主调用现有绑定与证据验证。
宿主回调、调度器中转或请求挂起/续传是备选，尚未选择。
不接受任意 subject 内 callback URL，也不让服务另起无宿主观察来冒充原轮证据。

建议初版业务执行串行且队列有界，但控制面不能排在阻塞业务后方。
不同服务并不自动排除死锁：全局并发上限若被等待依赖的父请求占满，
子服务仍可能无法调度。需定义等待依赖时的容量处理和递归/深度/逻辑观察预算。

HTTP 断线只表明客户端不再等待。取消应有请求身份及状态确认；
Node 同步 TypeScript 运算占据事件循环时，服务甚至无法及时处理取消 HTTP 请求。
可选独立执行线程或超时终止整个服务；后者影响其他请求，不能宣称逐请求隔离。
未确认结束前不得复用请求状态、释放输入资源或自动重放。

## 迁移、验证与范围建议

是否保留 run.* 和已部署裸 subject HTTP endpoint，见 Q02。
若改变 manifest，必须遵守已发布 schema URI 不可变；也可考虑独立服务 descriptor，
但不能在调研阶段猜一个未来 schema 或直接编辑版本号。

实施时需同时覆盖：服务启动失败/就绪超时/竞争启动、重复请求与丢响应、
两客户端释放/异常退出、不同版本隔离、跨 subject 和跨观察刷新、
依赖请求证据及死锁、CPU 阻塞取消、视图与 checkout 保留和最终清理。
固定版本隔离消费再比较真实进程数、初始化次数、冷启动与连续 probe 耗时；
不能以 API 单测或单次启动日志代替完整 Regulation/CLI 路径。

候选首轮限定本机服务，不包含公网托管、远端路径或 secret/subject 上传。
远程 HTTP 能力不代表本地文件路径可跨机器读取；远程部署、授权及输入传输须另行决定。
此限制为建议，尚非用户已确认的排除项。
