# 共享 Check Host：收敛方案与调研依据

## 当前选定方向

2026-10-23 用户确认：检查器统一为 Node worker 模块，单用户级共享 Check Host
负责全部 Pilot 的 check 执行调度；外部采用本地 HTTP RPC，内部采用 Worker Threads
消息通信。check 是最小并发任务，不同 subject、regulation object 和 CLI 共用执行宿主。

本文件只保留这一方向及其依据。idea alias `http-check-services` 继续用于定位。
已确认全量迁移新运行契约，不保留旧运行协议兼容；历史 schema 和固定证据不改写。
本次是方案收敛，不是构想生命周期验收，也未开始实现。

用户进一步明确本次迁移必须同时覆盖三个方面：全部现有 Objective 的 check 入口
由一次性进程入口改为 worker 入口，消息传递协议随之调整，可复用 worker 的内存和资源
回收成为正式要求，不能继续依赖每次进程退出完成清理。

## 职责与请求链路

```text
CLI A / Regulation A ── 本地 HTTP RPC ──┐
                                       ├─ 用户级 Check Host
CLI B / Regulation B ── 本地 HTTP RPC ──┘    ├─ Pilot ID → Node worker 入口及执行版本
                                            ├─ 有界 check 队列 / 线程调度
                                            ├─ MessagePort → worker A
                                            └─ MessagePort → worker B
```

- CLI 负责发现/必要时协调启动 Host，以及调用者的控制和业务入口；不为每次 check 创建进程。
- Host 负责注册与版本校验、请求路由、队列、执行容量、线程复用和清理。
- worker 执行具体 check，返回 envelope、依赖请求及相关证据消息。
- Pilot 的层级判断、观察作用域和 Regulator 的观察/修复决策不因共享 Host 而被重定义。

检查定义与执行调度分开：每个 Pilot 提供一个准确版本的 worker 模块入口，
Host 根据完整 check ref 路由。请求携带独立的调用者/观察/父请求身份、subject、
语言、输入视图、预算、取消和证据关联；不得保存进程全局的“当前 subject/regulation”。
具体模块 API、wire schema 和上下文所在进程留待协议设计，不提前发明字段集合。

建议以独立 workspace 承载 Host，不把常驻执行服务嵌入 CLI 或某个 Objective 的检查包。
遵循仓库约定：可执行应用入口放在 apps，可复用运行时/客户端能力放在 packages；
协议边界优先复用现有协议包。具体包名、是否拆分运行时与客户端，以实际依赖方向决定，
不在准备阶段增加空壳包。CLI 通过公开契约连接 Host，检查包仅提供 worker 入口和业务规则。

## 全量入口与消息迁移

迁移需盘点所有现有 check，包括 monorepo 根及 package-standard、devbox-health、
setup/self-check、sanity fixture，以及生成器、脚手架、测试 fixture 和真实消费脚本。
迁移后的每项 check 经 worker 消息进入 handler，正常返回不退出整个 worker；
不能仅在 worker 中包装执行原 run.*，继续每请求拉起同一重检查进程。
业务规则所需的外部工具不因此一律禁止，但其子进程、句柄和取消责任须归属当前请求。

外部 HTTP RPC 与内部 MessagePort 都要区分执行请求、结果/错误、取消、依赖请求/响应
及证据事件；版本和关联身份贯穿两层，Host 必须校验和路由而非盲目转发。
不能把 stdin EOF、stdout 输出或进程 exit 当作单次 worker check 的完成标志，
也不能沿用 process.send、进程级环境变量来隐式绑定当前 subject/视图/证据。
跨线程的数据应满足明确的序列化/转移契约；取消、依赖和证据通过请求级消息或能力关联，
不能假设函数闭包、类实例或 AbortSignal 自动保留跨线程语义。
日志不得混入结果消息，迟到消息不得完成后续请求；具体类型与编码仍待设计。

## 内存与资源的分层寿命

可复用 worker 必须区分：

- **请求级**：subject、输入视图引用、大 Buffer、AST/项目图、结果、错误、取消控制器、
  待决依赖/Promise、临时文件、文件/socket 句柄、定时器和监听器。
  成功、失败、超时、取消、客户端断开等结束路径都需释放所属资源并去除强引用。
  错误对象、日志闭包或 Host 的待决表也不能无意保留整份输入。
- **worker 级**：已加载规则和编译器可保留以降低初始化成本；
  仅允许明确可复用且有容量/失效边界的缓存，涉及目标内容的缓存须绑定输入版本，
  不能因复用 worker 而返回旧检查事实。线程卸载或版本切换时释放该级资源。
- **Host 级**：线程池、队列、客户端/观察状态、去重记录及消息缓冲必须有界；
  单次请求完成后删除不再需要的任务引用，协议要求保留的最小状态按既定边界回收，
  不能为释放内存而丢弃仍有效的去重身份并允许重复执行。

建议 handler 与 runner 有显式的每请求清理及 worker 卸载职责；API 名称后续确定，
不依赖 GC、FinalizationRegistry 或进程退出去关闭外部资源。
只有请求任务及清理均完成，线程才能回到可复用状态；清理失败须显式报告，
隔离/退役该 worker，不作“清理成功”的返回，也不自动重放原请求。
Host 仍负责被强制终止线程留下的宿主可管理资源，不能假设 finally 必然执行。

建议按空闲、内存压力或不可恢复状态回收 worker，但具体阈值和池策略尚未确定。
不能每次请求都终止线程来掩盖泄漏；Node 的线程 resourceLimits 也不替代
Buffer/外部内存和 Host 总进程占用的治理。

验证需在实现前确定有限并发、负载规模、预热及回收窗口和内存/资源上限，
连续交错执行不同 subject 的成功、失败及取消请求，证明请求数据不串用且保留量不持续累积。
同时观察 worker JS heap、Buffer/外部内存、Host RSS、存活句柄/监听器/定时器和队列状态；
RSS 是进程级指标，不按线程重复相加，不要求每次 GC 后立即回到同一字节数。
受控 GC 可用于诊断，但不能以强制 GC 一次或重启一次作为长期复用无泄漏的验收。
具体待定项归 [OpenQuestions.md](./OpenQuestions.md) 的 Q12。

## 发现、版本与生命周期

用户级发现记录只定位一个 Host 的 endpoint、协议与实例身份；Pilot worker 注册在 Host 内。
建议动态绑定 loopback 端口、启动仲裁、ready 后原子发布记录并验证身份；
这是机制建议，具体配置、认证和启动失败恢复尚待明确。
多个 CLI 并发发现时不能各自启动一个有效 Host。地址可达不等于身份正确，
端口/PID 重用、过期记录和失联恢复都需要代际边界。

Pilot ID 唯一定位 Host 内当前执行版本，不允许不同版本的 worker 同时执行。
一个版本可有多个线程实例；请求的准确来源仍需验证，不把版本从证据中删除。
冲突不静默降级或重绑；升级必须排空并卸载旧 worker 后再加载新版本，
升级授权、等待及固定版本恢复的策略尚待确定。

单个 CLI 退出仅结束自身使用，不误杀其他客户端任务。Host 持有来源和线程资源，
不依赖某个客户端临时 checkout 的寿命。建议有限租约与活动任务计数支撑闲置回收，
具体时长和权限未定。确认任务结束或取消前，输入视图与证据资源不能提前删除。
真正关闭 Host 时先停止受理、完成或取消任务、确认执行资源停止，再清理所属资源。

## 执行、依赖和隔离

线程池复用用于摊薄模块加载；可评估按 Pilot 入口保持线程亲和性。
Node Worker Threads 的 JS 模块缓存通常按线程独立，不能声称所有线程共享一份 TypeScript
实例。池容量、闲置线程回收与内存成本需实测，不能每请求新建线程却宣称初始化已消除。

Host HTTP 控制面不执行 check 的同步 CPU 工作。建议一个 worker 同时运行一个请求，
独立取消和资源清理后才接受下一个请求；必要时终止并重建该 worker。
线程终止对原生代码、外部子进程和副作用的保证需验证；Host 崩溃是共享故障，
不能将线程隔离当作恶意代码沙箱。注册来源授权与执行权限必须明确。

worker 依赖请求可直接通过 MessagePort 回到 Host，但 Host/CLI 之间仍是 HTTP：
若观察上下文位于 CLI 或 regulation worker，需要明确事件投递和响应方式。
不能把内部双向消息误当成外部 HTTP 已有双向回调，也不能另起无关观察伪造同轮证据。
依赖来源和观察证据须在原作用域登记后才能作为父 check 的依赖结论。
请求能力在父请求/观察结束后失效，迟到结果不得流入下一轮。

父任务等待子任务会消耗实际线程，池被占满时仍可能死锁；需设计容量释放、
依赖执行余量或明确失败，保留递归/深度/逻辑次数及整体剩余预算。
不能无限扩线程，也不能以队列计数变化冒充实际执行容量释放。

HTTP 连接取消仅停止客户端等待，不保证 worker 任务停止；取消必须进入 Host 的执行协议。
结果未知时不透明重试，重复请求身份不能二次执行；新尝试使用新身份和独立证据。
不承诺跨 Host 重启的 exactly-once。队列、请求/响应大小及去重记录都要有界。
当前未决点集中在 [OpenQuestions.md](./OpenQuestions.md)，不在此维护另一套状态。

## 性能动机与证据边界

前一轮固定消费证据见
[probe-efficiency](../../../../01M5EY383YB0ZY4HMKB8BFT7HM/outer/Consumption.md)。
本会话在 `e2f0b1a6d0c761f4df8c1e3529c3f713d075c60e` 上复测：
默认预算三次超时；显式预算完整 CLI 两次约 50.5 / 48.5 秒，
均 standardized、0 problems，22 次实际观察、21 次复用、43 次逻辑观察。

后续插桩确认 44 个 check 进程；42 个包进程累计生命周期约 35.0 秒，
启动到首次读取视图约 29.5 秒，其中 bundle 加载和初始化约 18.0 秒。
这些是包含关系，不能相加。读取视图和解析大 JSON 累计约 1.25 秒。
bundle 约 4.3 MB，TypeScript 约 3.58 MB；体积比例不等于 CPU 比例。
两个包级 CPU 样本主要落在模块编译、CJS 导出分析和顶层初始化。

以上是问题依据，不是共享 Host 已获收益的证据。插桩观察约 59 秒、其中捕获约 19 秒，
不能与未插桩约 42 秒直接混比，也不承诺默认 30 秒 SLA。
后续固定环境/来源/输入比较需统计 Host/线程启动、初始化次数、内存和冷/热时延，
同时验证业务输出、跨客户端隔离、变化后刷新和真正执行停止。

## 现有代码可复用点与缺口

调研代码基线 `5055e96c2271035c641e9eb810c0768e6c7e991e`。

| 位置 | 可复用能力 | 需要改变或补齐 |
| --- | --- | --- |
| [probes.ts](../../../../../../packages/objective-pilot/src/probes.ts) | HTTP 结果解析、超时及宿主 evidence 包装 | 裸 subject POST 不含完整任务上下文；需要新的 Host 请求协议，不能静默重解释旧输入 |
| [pilot-source.ts](../../../../../../packages/cli-runtime/src/pilot-source.ts) | Git commit/tree/repositoryTree 固定与校验 | 当前只发现 run.* 并创建进程 probe；迁移为 worker 注册，来源寿命须覆盖 Host 使用 |
| [dependency.ts](../../../../../../packages/objective-pilot/src/dependency.ts) | 同轮来源、递归预算及依赖证据登记 | 现有 process.send 传输不能直接作为 Host 多客户端协议；需请求级消息路由 |
| [regulation-worker.ts](../../../../../../packages/pguide-regulate/src/regulation-worker.ts) | 一次 runtime 供 Regulation 内多轮观察使用 | 接入共享 Host，同时保留每轮独立上下文 |
| [check.mjs](../../../../../../packages/objective-monorepo-standard/check.mjs) | phase/scope/subject 业务函数入口 | 转为 Node worker handler，视图、证据和取消显式请求化 |
| [shared.ts](../../../../../../packages/objective-monorepo-standard/src/shared.ts) | 受限视图读取及摘要校验 | 环境变量和进程 IPC 前提不能用于多请求切换 |
| [evidence.ts](../../../../../../packages/objective-pilot/src/evidence.ts) | runId/checkRunId/attempt、脱敏及记录限制 | Host 日志不替代每次请求证据，保护集合和目录不能跨客户端混用 |

调研时独立运行以下现有测试，4/4 通过：

```powershell
pnpm exec tsx --test --test-name-pattern='HTTP|already aborted|transport failures' packages\objective-pilot\test\probes.test.ts
```

覆盖业务失败 envelope、传输故障、预取消不执行及客户端取消后服务端仍继续完成。
它只验证已有行为，不证明 Host、线程池或新协议已经实现。

## 官方资料与适用结论

- [Node net](https://github.com/nodejs/node/blob/v24.11.1/doc/api/net.md)：
  端口 0 可由 OS 分配，listening 后获取实际地址；省略 host 可能监听所有接口。
- [Node HTTP](https://github.com/nodejs/node/blob/v24.11.1/doc/api/http.md)：
  close 与 closeAllConnections 控制连接，不保证业务任务停止，Host 仍需执行级 drain/取消。
- [Node child_process](https://github.com/nodejs/node/blob/v24.11.1/doc/api/child_process.md)：
  detached/unref/stdio 影响父子寿命，但不自动提供 Host 的发现、认证、使用权或回收。
- [RFC 9110 §9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2)：
  非幂等请求在不能确认语义幂等或未执行时不应自动重放。

当前按本机、同用户、loopback 和访问能力校验推进，不默认扩展远端输入传输或生产部署。
全量迁移覆盖全部检查器、脚手架和消费面；保持历史契约不变，旧输入明确拒绝，
不同时维护其他运行架构。
