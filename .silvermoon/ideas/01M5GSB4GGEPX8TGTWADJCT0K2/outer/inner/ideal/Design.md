# Check Host：MVP 设计

**只做一个可靠的本地执行器，不做可恢复任务平台。**
目标：多个 CLI 共用一个 Node Host，重复执行 check 不反复加载重依赖，
同时保持依赖观察、取消、证据和资源清理正确。以下接口是简化后的审阅建议，尚未实现。

## 1. 调整范围

```text
CLI / Pilot：解析业务检查、准备代码产物、维护观察与证据
                         ↓ 本地 HTTP
Check Host：按目录和 revision 加载产物 → 有界队列 → 复用 worker
                         ↓ MessagePort
worker：执行请求 → 清理本次资源 → 等待下一项
```

只新增 `packages/check-host` 可复用包，不拆多个新包，不新增应用目录。
复用现有 CLI 的启动装配；Host 自己管理线程，不把库调用实现为递归调用 CLI。

| 调整面 | MVP 要做的事 |
| --- | --- |
| check-host | 用户级单 Host、HTTP 请求、产物加载、有界队列/worker 池、取消与清理 |
| pilot-protocol / objective-pilot | worker 契约和 check adapter；层级判断、CheckRef、subject、结果 envelope 及依赖证据语义保留 |
| cli-runtime 与 probe/regulate/supervise | 发现 Host、准备准确来源及稳定产物目录、消费响应消息、在原观察作用域处理依赖 |
| 所有 Objective、生成器、脚手架、消费测试 | 进程入口改为 worker handler，输入/证据/取消改为显式请求上下文 |

**迁移范围不缩减：6 个内置 Objective，16 个 check。**

| packages 下的 Objective | check IDs |
| --- | --- |
| objective-monorepo-standard | structure、deliveries |
| objective-monorepo-standard/package-standard | structure、deliveries |
| objective-devbox-health | identity、system、toolchains、order、sustainability |
| objective-pguide-setup | installation、configuration、sanity |
| objective-pguide-self-check | installation、configuration、sanity |
| objective-pguide-setup/sanity-fixture | marker |

旧一次性入口和旧裸 subject HTTP 契约明确拒绝；不长期维护双轨，
不改写已发布 schema 或历史来源证据。业务需要的外部工具仍可调用，但必须受本请求管理；
不能在 worker 内每次再 spawn 原 check 进程冒充迁移。

### 代码身份与依赖

业务层负责 Objective/level/check 与准确代码的映射；Host 不判断层级或下载 Git 仓库。
调用者提供已准备好的**自包含 Node 产物目录**，首版以 bundle 加显式资源为主；
Host 不安装 npm 依赖，也不从调用者的任意 node_modules 向上解析。
产物 revision 覆盖规范化文件清单、全部代码/资源内容和入口，不只 hash 入口 JS。
**规范化目录是 key，完整内容 hash 是 revision。** 路径标识这份可更新产物的位置，
不单独证明代码内容。客户端直接在 execute 中提供 directory 和预期 revision，无需预注册或卸载 API。
Host 校验并复制到自己管理的不可变目录后才执行，复制后的内容必须匹配预期 hash；
源目录在采集期间变化或内容不匹配时明确拒绝，不从一边修改一边读取的目录执行。
目录必须是经授权的绝对本机路径；按文件系统真实路径和大小写/链接规则取得规范身份，
不能简单把所有平台路径一律小写。目录内入口/资源路径不得通过链接或相对路径越界。
调用方使用相对稳定的产物目录，不能每次创建新临时路径却期望复用同一个池。

Host 内部按目录持有池，加载和切换在该 key 下串行仲裁：

| 状态 | execute 的行为 |
| --- | --- |
| 未加载目录 | 验证 revision、准备不可变副本、初始化 worker 后执行 |
| 已加载且 revision 相同 | 验证请求对应的产物身份，复用已有 worker |
| revision 不同，旧任务已排空 | 停止旧池派发，卸载并确认旧线程退出，再加载请求的新 revision |
| revision 不同，旧版仍有排队/运行/清理任务 | 返回版本冲突，不并存版本、不抢占旧任务；调用者在旧任务结束后可明确发起新请求 |

不提供复杂版本等待队列；排队任务始终绑定受理时的 revision，不能悄悄转到新版。
自动更新指下一次符合切换条件的执行请求触发顺序卸旧载新，不是文件 watcher 热替换。
切换失败明确报错，不执行旧版来冒充新版。预热不得提前加载另一 revision；
代码相同但 Node/执行配置不兼容也不混用线程。
Pilot 到目录的业务映射由 adapter 负责；Host 不再维护 Pilot ID 注册表，也不能识别
两个不同目录是否属于同一 Pilot。业务层仍需维持一致映射，不利用不同目录绕开既有单版本约束。
来源与业务证据由 adapter 保留，不能因为 Host 只看产物就把准确 commit/tree 丢掉。

## 2. worker 复用与清理

由统一 runner 管 MessagePort，业务模块建议只暴露：

```ts
interface WorkerModule {
  initialize(context: WorkerContext): Promise<void>;
  execute(input: JsonValue, context: RequestContext): Promise<JsonValue>;
  dispose(): Promise<void>;
}
```

这些是说明性类型：JsonValue 为有限 JSON 数据，context 在 worker 本地构建。
Pilot adapter 负责把 ref、subject、语言等组装为 input，把返回值校验为既有 check envelope。
RequestContext 提供 signal、输入视图、依赖往返、证据发送及异步清理登记，
不通过线程直接发送函数、AbortSignal 或任意对象实例。

MVP 固定总体线程/队列上限，一线程同时一任务，按准确产物及兼容配置复用。
首版退役只做**任务数上限、异常/清理失败隔离、目录 revision 切换时卸载**；
动态预热只做**容量允许时，为即将按次数退役的同版本 worker 准备一个替补**。
预热、运行及退役中线程均计入额度；没有空位就先退出再启动，不执行真实 check 来预热。
时间、内存压力、自适应扩缩容及特殊一次性策略列为后续能力，不同时实现。

每次请求在成功、失败、取消路径都清理输入引用、AST/Buffer、待决依赖、监听器、
定时器、文件/网络句柄和外部任务。只保留有界、明确允许的模块/编译器缓存。
只有清理成功才回池；失败明确报告并销毁 worker，不能用退役次数掩盖泄漏。
强制终止不保证 finally 执行，Host 仍需收回自己管理的文件与执行资源。
Node worker 不是安全沙箱，模块缓存通常按线程独立；内存验收仍覆盖 heap、
外部内存和 Host RSS，不承诺进程 RSS 每次立即归零。

## 3. worker MessagePort 消息

只保留下面几类，不建设消息重放或持久日志。

| 方向 | 消息 | 内容 |
| --- | --- | --- |
| Host → runner | initialize | 已验证的不可变产物/入口及 revision、worker 代际和配置 |
| runner → Host | ready | 初始化完成；才可接收执行 |
| Host → runner | execute | requestId、worker 代际、input、剩余预算、受限视图引用 |
| Host → runner | cancel | requestId、原因；runner 触发本地 signal |
| runner → Host | dependency | requestId、dependencyId、不透明的依赖请求数据 |
| Host → runner | dependencyResult | 相同关联 ID、结果或调用故障 |
| runner → Host | evidence | requestId、受限且已脱敏的证据数据 |
| runner → Host | done | requestId、结果/错误/取消、清理是否成功 |
| Host → runner | dispose | 停止接新任务并卸载；Host 等待真实线程 exit |

所有消息包含协议版本，任务消息必须匹配当前 worker 代际和 requestId。
初始化/协议异常、线程 error/exit 由 runner 或 Host 明确报错，不依赖额外“完成”消息才处理。
done 在 runner 清理后发送；清理失败不能作为普通业务成功。
Host 返回结果前校验关联身份；迟到消息不能完成下一项任务。日志不充当结果或证据消息。

## 4. 对外 HTTP RPC

### 五个接口，不提供提前注册或 session/observation/view 的独立资源管理

| 方法与路径 | 作用 |
| --- | --- |
| GET /v1/host | 鉴权后读取协议、Host 代际、基本状态 |
| POST /v1/execute | 给定 directory、revision 和 input，按需加载/更新后执行，在原响应中读取依赖、证据和最终结果 |
| POST /v1/execute/{requestId}/cancel | 请求取消指定任务；不把受理取消当成停止确认 |
| POST /v1/execute/{requestId}/dependencies/{dependencyId} | 提交当前待决依赖的结果 |
| POST /v1/shutdown | 管理能力下显式停止；有活动任务时拒绝，不误杀其他客户端 |

不返回 202 然后让客户端查询任务库，也不提供断线后领取结果或恢复事件的承诺。
目录加载/更新在 Host 内与任务受理互斥，不提供显式注册、卸载或版本管理接口。
directory 通过 JSON body 传递并验证授权与路径边界，不能据此读取或执行任意未授权目录。

### 一次执行的请求与响应

```json
{
  "requestId": "client-generated-unique-id",
  "directory": "D:\\workers\\repo-check",
  "revision": "sha256-of-artifact",
  "timeoutMs": 30000,
  "input": {}
}
```

`input` 对 Host 不透明；check adapter 在其中传递业务 ref/subject 和必要的请求数据。
Host 负责基础协议、大小、目录/revision 和预算校验，业务 handler/adapter 负责业务 schema。
首次加载及 revision 切换也消耗该请求预算，不在加载后重新起算。
视图作为可选的受限运行元数据引用传递：仅允许约定的本机私有 staging 根下文件、
摘要和大小，Host 校验边界/链接并复制至自己持有的请求目录后再使用；
不能让请求触发任意宿主文件读取。调用者保留 staging 到请求结束确认，
断线时 Host 依靠自己的副本清理，不依赖客户端还活着。不新增视图上传/查询 API。
同轮复用仍需原有稳定输入证明；不为了简化把 captured view 改成 live 读取。

响应使用有界 NDJSON 流，每行一种消息：`dependency`、`evidence`、`result` 或 `error`，
均带 requestId；dependency 另带 dependencyId。普通无依赖 check 只返回最终一行。
最后一行在执行与清理确认后产生；HTTP 200 或流开始不代表业务成功，
EOF 前没有终态行则客户端报告调用失败/结果未知。业务失败仍保留原 check envelope 语义。
客户端必须边读边处理消息，不能等完整 body 才处理依赖。

为什么保留流式响应：根 check 的真实依赖需要在父请求等待期间交给客户端处理，
否则会死锁；这不是独立事件队列，没有 cursor、ack、历史保留或重连回放。
过大的响应/积压明确失败并取消任务，不无限缓冲。

### 取消、安全与重复请求

Host 显式 loopback，发现记录及访问凭据限制到同用户，校验 Host/Origin，
不开放任意 CORS；管理操作与执行能力分开。每次 execute 另带不记录日志的请求能力，
cancel/依赖响应必须证明持有该能力，不能仅凭猜到 requestId 操作其他任务。
requestId 绑定 Host 代际和调用者能力；重复 execute 明确拒绝，不重放、不返回旧结果。
Host 只保留有界已受理 ID 标记，不存历史结果；容量满时拒绝新任务而不是淘汰仍有效 ID。
重启更换代际，客户端不能自动把未知任务提交到新 Host。

传输不自动重试执行。依赖响应只完成相同待决项一次，重复/迟到响应拒绝；
丢失确认后父任务明确失败/取消，不重新执行依赖来猜测结果。
客户端取消发 cancel，连接断开也触发 Host 取消；服务端停止仍须单独确认。
队列、执行和依赖共享剩余预算，超时协作取消后有界等待，再终止该线程；
外部工具回收失败明确报告，不让脏 worker 回池。正常结果和取消由 Host 串行仲裁。
前置错误用 400/401/403/409/413/429/503；流已开始后使用 error 终态消息。

## 5. 依赖往返与最小验证链路

```text
CLI 提交根 check → Host → worker
worker dependency → Host 写入当前 HTTP 响应流
CLI 在原观察作用域处理依赖（子 check 仍可经 Host 执行）
CLI 验证并登记依赖证据 → POST dependency result → Host → 原 worker
原 worker 完成并清理 → 最终 result → CLI 校验既有 envelope
```

不需要 CLI 反向监听 HTTP。Host 路由依赖数据，不理解 Objective 的层级或自建观察证据。
客户端断开时本请求及其关联依赖不能无限存活；请求取消及截止继续约束子任务。
调用者传入经 Host 校验的父请求关联/能力后才能继承取消和预算，不能用任意 parent ID
影响另一客户端。所有业务递归/来源/次数检查仍在原观察逻辑中执行。

线程容量仍需防死锁：建议预留有界依赖执行余量，父任务等待时保留其真实占用；
无法提供依赖槽时明确报容量失败并取消相应链路，不能永久排队或无限扩线程。
必须验证本仓库“根 → 包”的实际依赖链成功，及更深/循环请求的明确失败，
具体容量值在实现前确定。不能把拒绝所有依赖当作 MVP。

先验证：两个 CLI → 同一 Host → 根/包依赖检查 → 连续复用 → 取消/清理。
随后完成全部 16 个 check 迁移；验证顺序不缩小最终交付范围。

## 6. 首版不做什么

不做会话租约/续租、自动闲置关闭 Host、任务持久化/恢复、状态查询服务、
事件 cursor/ack/重放、独立视图存储 API、远程部署、在线热升级或 npm 自动安装。
Host 按需启动后保持驻留，提供显式停止；启动锁/ready/身份记录与失败清理仍必需。
worker 的最小预热保留；自适应扩缩容、时间/内存压力退役和特殊一次性模式后续再扩展。
这些是交付分期，不改变正确清理、有界资源和隔离要求。

本稿保留三个实施前细化点：产物/worker schema、容量和退役数值、
staging/启动锁及权限的跨平台细节。设计审阅完成前不创建产品包、不记录生命周期验收。
