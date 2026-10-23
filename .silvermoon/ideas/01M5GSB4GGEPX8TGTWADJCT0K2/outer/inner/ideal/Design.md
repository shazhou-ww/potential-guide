# Check Host 设计审阅稿

本文集中回答调整范围、worker 消息和 HTTP 接口三个问题，服务于 [Idea.md](./Idea.md)。
已确认：统一 Node、单用户级共享 Host、外部本地 HTTP RPC、内部 MessagePort、
全量迁移、Pilot ID 单执行版本，以及有界复用池、条件退役、受控动态预热。
下列包名、模块 API、消息字段、路由和状态机是供审阅的具体建议，不是已发布契约或已完成实现。
路由中的 v1 只是本设计协议版本示例，不修改现有 schema URI。

## 1. 调整范围

### 1.1 模块职责与依赖

| 位置 | 建议调整 |
| --- | --- |
| 拟议 `packages/check-host` | 可复用 Host 包：loopback HTTP、启动/就绪、注册表、任务状态、有界 worker 池、消息路由与退出；不承载具体业务规则 |
| 现有 `packages/pilot-protocol` | 新 worker descriptor、公共消息/DTO、序列化及验证契约；保留 CheckRef、Subject、CheckResult 的既有业务意义 |
| 现有 `packages/objective-pilot` | Host check adapter 与 worker runner/上下文能力，保留 observe、层级及依赖证据判断；不依赖 CLI 或 Host 运行时 |
| 现有 `packages/cli-runtime` | CLI 侧 Host 发现、会话与注册、准确 Git 来源、观察事件泵和依赖回传；公开客户端接口供其他调用入口复用 |
| probe / regulate / supervise CLI 及 regulation worker | 使用同一 Host，建立各自请求/观察上下文，不再逐 check spawn；取消、恢复、报告和配置接线一致 |
| Regulator / Coordinator / Portfolio | 业务循环保持原意；适配新增执行错误与异步取消，版本变化不得悄悄改绑固定来源 |
| 各 Objective 检查包 | 注册 Node worker 模块，业务函数接入请求级上下文，移除进程级输入/输出/退出假设 |

仓库 workspace 仅使用 `packages/*`，不新增应用目录；Host 作为独立可复用包规划，
不预先拆成独立应用和 runtime 两个 workspace。运行时建议归 business 层，
仅向 protocol/既有允许的 business 能力依赖；启动装配复用现有 CLI 工具层，
business 不反向依赖 CLI。新增包在实施阶段需同步
pnpm/Turbo、package-layers、包自有 objectives、构建/发布清单和测试；
具体包名是建议，不在准备阶段创建空壳包，也不因设计文件出现名字就视为已批准发布。

### 1.2 全部内置检查入口

按调研快照，下面 6 个 Objective 目录共 16 个 check 入口必须迁移：

| Objective 目录（相对 packages） | check IDs | 重点 |
| --- | --- | --- |
| objective-monorepo-standard | structure、deliveries | 根依赖观察、输入视图与源码分析 |
| objective-monorepo-standard/package-standard | structure、deliveries | 同入口反复检查多个包/subject，复用重依赖 |
| objective-devbox-health | identity、system、toolchains、order、sustainability | 外部工具、目标环境、超时及资源责任 |
| objective-pguide-setup | installation、configuration、sanity | 配置、进程/Agent 检查的既有许可边界 |
| objective-pguide-self-check | installation、configuration、sanity | 生成 runtime 与 setup 共享代码一致迁移 |
| objective-pguide-setup/sanity-fixture | marker | 真实消费 fixture 不遗漏 |

生成器、scaffold、独立运行资源、引用文档、测试 fixture、安装/打包消费脚本一起调整。
所有 check 对框架暴露 worker handler，不在 worker 中再执行旧 run.* 来冒充迁移。
业务本身需要调用编译器、系统工具或 Agent 时不擅自删去，但必须使用请求所有的执行/清理能力，
不复用另一请求的权限、认证或目标环境。

新版本 descriptor 在准确来源内声明 Node 模块入口及受支持的 check ref；
Host 独立验证 Git commit/tree/repositoryTree 和模块路径，不接受执行请求携带任意 JS 路径。
旧入口和旧裸 subject HTTP 契约明确拒绝；需要新 schema 时创建新 URI，历史版本不覆盖。

### 1.3 边界

本次不是改写层级语义、Regulation 生命周期或引入远程托管。
进程运行数量目标为一个用户级 Host；同 Pilot 版本可以有多个 worker，但不能并存不同执行版本。
Host 不替代观察逻辑或信任 worker 自报的依赖证据，HTTP 可达也不证明来源或任务已完成。

## 2. worker 模块与生命周期

### 2.1 业务模块与 runner 分工

建议由框架 runner 处理 MessagePort，业务模块不自行实现消息循环：

```ts
interface CheckModule {
  initialize(context: WorkerContext): Promise<void>;
  execute(ref: CheckRef, subject: Subject, context: RequestContext):
    Promise<Envelope<CheckResult>>;
  dispose(): Promise<void>;
}
```

这是说明性接口：CheckRef、Subject、Envelope 和 CheckResult 沿用现有类型；
WorkerContext/RequestContext 仍需实现前定义严格类型。
`initialize` 仅加载规则/编译器和允许的 worker 级缓存，不执行真实 check 或产生业务副作用。
`execute` 每次接收独立 subject；RequestContext 提供 signal、受限视图读取、
依赖请求、证据发送和资源清理登记，不允许把它存入无限增长的模块全局集合。
runner 在所有完成路径执行已登记的异步清理；`dispose` 仅用于整个 worker 卸载。
以上方法在 worker 本地调用，函数和 AbortSignal 不通过 structured clone 直接传输。

### 2.2 已确认的池策略

池优先按 Pilot ID 的准确执行版本和兼容入口组织，不按 subject 或 regulation object 拆池。
一个 worker 同时执行一个 check；可先后执行同 Pilot 的不同 check，若入口兼容性要求不同，
可在同一执行版本下细分池，不能用此方法并存两个版本。

```text
starting -> ready -> running -> cleaning -> ready
                  \                  \-> retiring -> exited
                   \-> idle retirement
异常/取消无法完成 -> quarantined -> terminating -> exited
```

- 任务数、存活时间、内存阈值触发正常退役：停止给它分配新任务，当前任务清理后退出。
- 空闲回收：缩减不用的线程，不删除仍被执行请求引用的来源。
- 清理失败或状态不可恢复：显式报告并隔离，不能再回池。
- 可为即将退役的同版本 worker 预热替补；starting、ready、运行中和退役中的线程
  都计入数量及内存预算，没有余量就先退役再启动，不许无限“双倍预热”。
- 不同版本切换不能预热加载新执行版本以绕过单版本原则；先排空/卸载旧版本。
- 特殊检查若无法安全复用，可经明确契约选择一次性 worker；不能默认全量每请求重建。

数量/时间/内存/空闲阈值和并发上限在基线测量后确定。模块缓存不自动跨线程共享；
预热只降低已有执行环境的冷启动成本，不证明可忽略线程内存。

## 3. worker MessagePort 消息

### 3.1 公共身份和数据

建议所有消息带 `protocolVersion`、`hostEpoch`、`workerId`、`workerEpoch`、`type`。
任务消息另带 `sessionId`、`observationId`、`requestId`、`attemptId`。
`attemptId` 由 Host 每次实际派发分配，防止线程退役后的迟到响应完成新请求；
`requestId` 则是客户端提交任务的幂等身份，不因排队/查询变化。
依赖往返另带 `dependencyId`；结果、证据和测量均按相同关联字段归属。

任务负载使用现有 `CheckRef`（objectiveId、levelId、checkId）、subject、有效语言，
以及准确 `registrationId`、本轮 `inputViewId`（可选）、剩余运行预算和 evidence 身份。
Host 校验 registration 与 CheckRef 匹配，worker 不根据请求加载其他任意模块。
Node 数据传递限制为版本化可校验 DTO；Error 转成 code/message/受控 details，
不复制任意异常对象、文件句柄或含秘密的 stack。大数据传递/转移需显式所有权规则，
不得转移后继续使用已脱离的 ArrayBuffer，也不把共享可写内存当作默认输入视图。

### 3.2 消息表

| 方向 | type | 主要内容 | 语义 |
| --- | --- | --- | --- |
| Host → runner | worker.initialize | registrationId、已验证模块定位、运行策略 | 初始化一次；入口由 Host 决定，不来自 subject |
| runner → Host | worker.ready | 对应注册、能力与初始化结果 | 初始化完成才可分派；预热不执行 check |
| Host → runner | check.execute | 任务身份、ref、subject、view 引用、剩余预算 | 一个空闲 worker 接受一个任务 |
| runner → Host | check.started | 任务身份 | 已开始执行，不是成功结论 |
| Host → runner | check.cancel | 任务身份、reason | 本地触发 AbortController；不能因此立即宣告已停止 |
| runner → Host | dependency.request | dependencyId、目标 Objective、expectedLevelId、subject、language | 请求原观察逻辑处理依赖，不创建新观察证据权威 |
| Host → runner | dependency.response | dependencyId、既有依赖 check envelope 或结构化故障 | 只接收与本次等待匹配的响应；故障不得转成通过 |
| runner → Host | evidence.emit | 任务身份、序号、允许的证据事件/数据 | 按请求脱敏、限额；不能作为另一请求的证据 |
| runner → Host | check.finished | outcome、cleanup、可选测量 | runner 清理结束后一次发送；结果与清理失败分开 |
| Host → runner | worker.dispose | reason | 空闲/排空后调用模块 dispose 并关闭 runner |
| runner → Host | worker.disposed | 清理报告 | 卸载完成通知；Host 仍需等待真实线程 exit |
| runner → Host | worker.fault | worker/任务身份、结构化故障 | 初始化、协议或 runner 不可恢复错误；隔离线程 |

`check.finished` 建议采用联合形状：

```ts
type FinishOutcome =
  | { kind: "result"; envelope: Envelope<CheckResult> }
  | { kind: "error"; error: Fault }
  | { kind: "cancelled"; reason: string };

type CleanupReport =
  | { status: "released" }
  | { status: "failed"; errors: Fault[] };
```

`Fault` 至少有稳定 code 与可读 message，details 需受控且可序列化。
`result` 中 payload 为 null 仍是调用失败，不能作为业务不达标或成功结果。
业务 `ok:false` 且调用成功则保留原有 200/envelope 语义。
清理失败即使业务结果已产生，也不能发布为正常完成或让线程回池；
可在受控诊断中保留原结果，主任务进入失败/清理未确认状态。
线程意外退出时可能没有 finished，Host 要独立检测并记录任务故障或结果未知。

### 3.3 顺序、重复与取消

Host 是任务状态的单一提交者；同一个 attempt 的重复/错序/错代际消息不能二次推进状态。
终态结果只在 runner 清理成功、待决依赖终结和资源释放确认后提交。
成功与取消竞争由 Host 串行仲裁：终态已提交则取消返回当前终态；已接受取消则不再提交正常成功，
但可报告“取消前可能产生副作用”，不能承诺回滚。超时同理。
Host 强制终止时等待线程退出并回收可管理资源，不能假设 handler finally 被执行。

## 4. 对外 HTTP RPC

### 4.1 共通约束

使用 loopback HTTP、JSON DTO、版本化 `/v1` 路径；不是旧裸 subject check endpoint。
请求带访问凭据及预期 Host 代际；建立会话后以会话能力限制访问，
会话 token 不交给 worker，不写入 URL、日志或证据。不同会话不可读取彼此任务和视图。
注册/停止 Host 等管理能力与普通执行能力分开；同用户 HTTP 鉴权不是对恶意本机同用户代码的沙箱。
Host 需验证 Host/Origin 等来源约束并禁用任意跨域开放，不能仅凭 loopback 认定所有请求合法。

异步提交返回任务资源，不让一个长时间 HTTP POST 连接承担全部执行寿命。
HTTP 成功仅代表受理或读取成功；业务结果在任务的 envelope 中。
所有请求、响应、事件、队列、会话及去重保留均有限额。

### 4.2 建议端点

| 方法与路径 | 输入/输出摘要 | 正常状态 |
| --- | --- | --- |
| GET /v1/host | 授权后读取 hostEpoch、协议/Node 版本、运行状态及限额 | 200 |
| PUT /v1/sessions/{sessionId} | 客户端生成 ID、能力/租约请求；返回会话身份和有效期 | 201；同请求重复为 200 |
| POST /v1/sessions/{sessionId}/renew | 有效会话续用；不恢复已过期观察 | 200 |
| DELETE /v1/sessions/{sessionId} | 吊销新受理、取消所属工作并释放使用权；不关闭他人任务 | 清理中 202，完成 204 |
| POST /v1/registrations | 准确 Objective source、可验证的新 worker descriptor 引用；返回 registrationId | 201；相同有效注册 200 |
| GET /v1/registrations/{registrationId} | 经授权读取准确来源、注册状态及排空/卸载进度 | 200 |
| DELETE /v1/registrations/{registrationId} | 管理权限下排空/卸载；有使用者时冲突而非强制替换 | 卸载中 202，完成 204 |
| PUT /v1/observations/{observationId} | 当前 session、固定绑定及剩余预算；创建观察关联资源 | 201；相同请求重复 200 |
| POST /v1/observations/{observationId}/views | 分大小受限上传只读视图及摘要；Host 校验并返回 inputViewId | 201 |
| DELETE /v1/observations/{observationId} | 停止该观察新请求，取消/等待在途工作后释放视图 | 清理中 202，完成 204 |
| POST /v1/checks | CheckRequest；带 Idempotency-Key，与 requestId 一致 | 202 与 Location；同请求返回现有任务 |
| GET /v1/checks/{requestId} | 读取当前状态、结果/错误、清理状态和代际 | 200 |
| POST /v1/checks/{requestId}/cancel | 取消原因；只影响所属请求和其依赖子请求 | 取消中 202；已终态 200 |
| GET /v1/sessions/{sessionId}/events?after={cursor}&waitMs={n} | 有界长轮询，返回依赖事件、证据和状态通知 | 200，允许空批次 |
| POST /v1/checks/{requestId}/dependencies/{dependencyId}/response | 原观察宿主登记证据后的依赖 envelope 或故障 | 200；相同响应重复 200 |
| PUT /v1/sessions/{sessionId}/events/ack | 连续已处理事件游标；不得确认尚未交付的事件 | 204 |
| POST /v1/host/shutdown | 管理权限下停止受理并 drain；活动使用者冲突策略须明确 | 202 |

`sessionId`、`observationId` 和 `requestId` 在 Host 代际内全局唯一，首次受理即绑定授权会话，
后续请求不得通过 body 修改所有者。所有 mutating POST 在允许重试前均需幂等键或严格状态幂等，
注册及视图上传也需保留对应键与摘要；同键不同内容返回 409。
会话建立的重复响应及短期访问能力须经同一 bootstrap 身份验证，避免丢响应后无主会话。
这些具体路由和幂等规则是本稿建议，尚未写入产品 schema。

### 4.3 核心请求/响应

```ts
interface CheckRequest {
  requestId: string;
  observationId: string;
  registrationId: string;
  ref: CheckRef;
  subject: Subject;
  language: string;
  remainingMs: number;
  inputViewId?: string;
  parent?: { requestId: string; dependencyId: string };
}
```

session 从认证上下文取得，Host 不相信 body 自报的所有者。
requestId 在调用者发出前产生，POST 响应丢失可先 GET 查询，不另造新请求重跑。
remainingMs 在 Host 受理后转为本地单调截止，并受观察剩余预算、队列及 Host 限额约束；
传输耗时由调用者截止继续控制，不要求跨进程/线程时钟严格同步。
线程运行、排队、依赖和清理不得重新起算一整份业务预算；清理可有单独有界宽限但不继续业务。

任务状态建议为 `queued | running | waiting-dependency | cancelling | completed | failed | cancelled`。
completed 保留成功调用 envelope（ok 可为 false），failed 返回结构化调用/资源故障，
cancelled 只在执行停止及必要清理确认后成立；未确认清理可保持 cancelling，
最终以 failed + cleanup-unconfirmed 明确收束并阻止资源复用。
Host 崩溃后内存任务不可查询时，由客户端报告结果未知，不伪造 cancelled 或 completed。
响应同时包含 requestId、hostEpoch、registrationId 和 cleanup 状态；适配器把故障映射到既有
payload:null 调用错误，不能映射为业务问题。

HTTP 错误建议：400 malformed/invalid-input，401/403 身份/权限，
404 未知或不可见资源，409 版本/代际/幂等冲突，410 会话/游标已失效，
413 超出负载限制，429 队列/容量饱和，503 Host drain/暂不可用。
503/连接失败不自动授权重放结果未知的任务；已受理的任务 deadline 属于任务故障而非无条件重新 POST。
错误 DTO 为 `{error:{code,message,details?},hostEpoch}`，不包含秘密值或任意原始异常 stack。

### 4.4 注册、输入与事件所有权

注册不是上传任意模块路径执行。Host 验证调用者权限、规范 Pilot ID、准确 Git source，
自行持有或校验移交的来源快照，并验证 descriptor 的相对入口与允许的模块依赖。
模块只在 worker 加载，不在 Host HTTP 主线程执行。注册是业务代码执行信任边界。
同 Pilot ID 不同版本返回冲突，不能旁路新建另一注册；升级先卸载旧版本且确认退出。

建议视图作为带摘要、受大小/条目/路径规则约束的数据上传到 Host 所有的存储，
不让客户端提交任意宿主路径。HTTP 上传按路由设大小上限并流式接收/校验，
避免完整 JSON 同时无限复制到 HTTP、队列和每个 worker。
inputViewId 绑定观察和会话，worker 仅取得 Host 授予的只读引用；保留现有
captured/live 区别，不要求原先未声明只读契约的 check 伪造视图或缓存成功。

事件为 session 内单调序号、带请求/观察身份；依赖事件含 dependencyId 和规范目标/subject，
不携带可执行代码。长轮询由 CLI 后台事件泵持续驱动，不等待父 check 完成才读取，
因此 CLI 不必额外监听 HTTP 回调端口。
事件可重投递，客户端用身份去重；依赖响应在证据登记后提交并成功确认，再推进 ack。
GET 不自动删除事件，ack 不代表 check 成功。已 ack 事件可回收；
未确认事件达到容量上限时背压/明确失败，不丢失依赖请求。
游标失效返回 410，不能静默从最新位置续接。客户端进程重启后原内存观察作用域不能重建，
不得凭事件回放伪造已登记证据；原会话终止并显式报告未知状态。

## 5. 三条端到端流转

### 正常与依赖检查

```text
CLI 发现 Host → 创建 session → 注册准确 Pilot → 建立 observation/上传视图
CLI POST checks → Host 排队 → MessagePort check.execute → worker 执行
worker dependency.request → Host session event → CLI 事件泵
CLI 在原观察作用域检查依赖（必要时再次 POST checks）
CLI 登记依赖证据 → POST dependency response → Host → worker
worker 结束并清理 → check.finished → Host 提交终态 → CLI 获取结果
```

建议 CLI/调用者保留现有 observe 与 bindDependencyRequest 的证据权威，
Host 只路由执行请求和消息。不同调用者的依赖不能共享观察状态。
线程池全被等待父任务占用时仍需明确容量策略；本消息流不声称已解决该调度问题。

### 取消

客户端 signal/预算到期 → cancel 请求 → Host 取消排队或向运行 worker 发送 check.cancel，
并吊销相关依赖能力；协作停止与清理结束后提交 cancelled。
超出宽限时终止该 worker 并等待 exit，回收 Host 可管理资源，结果未知/清理失败明确可见。
不影响其他客户端独立任务；lease 过期走同一流程，而不是释放视图后放任 worker 继续读取。

### 同版本退役与预热

Host 标记旧 worker retiring，不再派新任务；预算有余量时先 initialize 同版本替补。
替补 ready 且旧任务清理结束后卸载旧 worker，等待 exit 才减去资源计数。
预热失败不执行真实 check，明确记录失败；健康旧 worker 是否延长服务由策略决定，
不得突破硬内存/运行限制，也不透明重跑已执行任务。

## 6. 本稿仍需审阅的具体决定

- worker descriptor/module API、注册来源移交和 Node 版本支持范围。
- HTTP 长轮询事件泵与原观察宿主的接线，及上述路由/DTO 是否足够简洁。
- 依赖等待的真实线程容量策略、跨客户端公平性和可控过载。
- Host/session/worker 的容量、任务数、时间、内存及闲置参数；需测量后给出可测试上限。
- 外部工具/原生资源的终止保证，以及允许加载的检查代码信任范围。

实施和部署仍按 [Implementation.md](../Implementation.md) 与
[Deployment.md](../../Deployment.md) 逐步细化，不以本设计稿中的示例接口代替实现验收。
