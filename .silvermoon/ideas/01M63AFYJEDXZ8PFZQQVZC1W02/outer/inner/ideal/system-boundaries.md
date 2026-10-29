# 系统边界与模块职责

本文定义[通用任务引擎 idea](./Idea.md)的逻辑边界。
这是规划草案，不是已实现 API；逻辑模块与建议的 Package 边界分别定义。
第 7 节为本轮新增的包拆分建议，供评审，不代表包已存在或拆分已经验收。
TaskType、ExecutionTracking、allocation 与统一 HTTP 宿主的详细关系见
[执行与宿主组装](./execution-and-host-composition.md)。

## 1. 交付边界

引擎本体是可嵌入进程的 library，具备完整的命令、查询、订阅和生命周期管理接口。
可选 HTTP 适配器也在本 idea 的计划范围内，但它不成为引擎运行的前提。
服务器进程由宿主组装，负责监听地址、TLS、认证、配置和运行环境。

```text
业务调用方 / Coordinator
        | 进程内 API
        v
     核心应用服务 <--- HTTP 适配器 <--- 远程客户端
        |
        +--- 纯协议与事实投影
        +--- 调度 / 递归 / 取消 / 所有权协调
        +--- 存储端口
        +--- TaskType 纯判定 / 准备 / ExecutorPool

宿主装配上述依赖，独立拥有 HTTP listener 和业务编排策略。
```

允许同一进程直接调用，不要求为了统一接口绕 HTTP。
进程内运行不等于只存内存：持久性来自明确的存储实现，恢复语义由引擎契约约束。
核心的主动调度通过显式 start/close 生命周期控制；构造或导入库不偷偷启动监听器。
停止宿主不默认等同于对每个 Task 发出用户取消，运行中恢复策略须按契约处理。

## 2. 通用内核模块

| 模块 | 拥有的职责 | 不应知道的内容 |
|---|---|---|
| 协议与投影 | 通用身份、事件外壳、内驱 stage、外界信号、独立时间条件及纯投影 | Checker manifest、Objective level、治理目标 |
| 类型目录与准入 | 宿主注册 TaskType、Validator/Equals 和执行能力，验证输入/权限与幂等请求 | 内置业务类型全集、从字段名猜任务类型、强制输入 Schema 依赖 |
| 任务协调 | 按准备、分配、执行三个过程推进，处理 deadline、取消、终结及资源清理 | 业务前置条件是否满足、不满足时应采取哪种治理 |
| 系列规划 | recurrence 锚点、原节拍选点、后继幂等、唯一有效时间等待槽位 | 业务 requirements 产生的依赖图 |
| 执行与需求所有权 | 执行绑定、容量准入、共享需求计数、合作式停止 | 仅凭相同 subject 就认定所有任务可共享 |
| 事实存储与读取 | 原子追加、幂等索引、因果读取边界、checkpoint、分页和恢复 | 用日志打印替代持久事实、把 snapshot 缓存作为第二真相 |
| 观察接口 | 快照查询、事实历史、带交接边界的订阅 | SSE 文本格式、客户端 UI 进度条 |

这些模块可以共享一个应用服务边界，不要求分别建进程或建立插件系统。
模块之间的命令协调不是纯 reducer；产生副作用的代码不得进入重放路径。
遵守[三个推动力](./concepts.md#2-三个推动力设计原则)：引擎推进、外界信号、时间流逝
平行建模。时间到点本身不写 pending/timed_out stage，不假造准备开始或执行终结。
deadline 失约允许与真实完成并存；停止逾期工作的政策与时间投影分离。

## 3. 类型与运行时端口

| 扩展角色 | 提供什么 | 引擎要求 |
|---|---|---|
| TaskType | 纯 validate/equals、必需 prepare、execute 排队启动并返回 tracking、业务载荷契约 | 统一注入而非手工拼接 Type/Pool；不提供引擎级 allocate，不直接写 Task 状态 |
| 准备实现 | 得到可执行的准确内容/参数，提供可恢复的准备结果 | 完成事实有依据；候选不等于正式采用；失败不可伪装就绪 |
| 输入等价与执行匹配 | 纯 equals(Input, unknown) 比较业务输入，Engine 校验准确准备身份及 executionMatch | 不跨任务类型/权限域/不兼容版本共享，不将 equals 当作请求幂等规则 |
| 执行器 | 执行工作、报告 progress/result/故障、接收停止信号 | 不保证停止即无副作用；报告须经校验，不可覆盖事件外壳 |
| 内部 ExecutorPool | 为 TaskType.execute 管理容量、等待、启动、复用、回收与淘汰 | 不暴露 Engine 必须归还的租约，不裁决 Task；Engine 协调匹配、正式绑定和替换授权 |
| 存储实现 | 明确的原子性、稳定顺序、持久性与恢复保证 | 内存实现不能冒充可重启恢复；缺失事实不可成功形回退 |
| 宿主安全策略 | 已认证调用身份、允许的操作与可见范围 | 内核执行授权检查，进程内调用同样适用；身份不来自任意业务载荷 |
| 时钟与唤醒 | 服务端时间、可控定时器及停止能力 | 单调等待与业务时间分开；测试可注入虚拟时间，不按客户端时间仲裁 |

执行器的停止信号归 Execution 所有，不能直接使用第一个 Task 的取消信号或 deadline；
单个需求结束只释放它的 owner，其他需求仍有效时执行继续，执行级限额另行明确。
类型目录是宿主在启动时装配的代码和校验器集合，不接受 Request 指定任意模块路径或远程代码。
check/probe/regulate 均由宿主按需注册，与其他 TaskType 同等；核心没有必须注入的
Check 或条件判定适配器，新增类型不修改内核。仅注册非制品测试类型也能独立运行。
同一 type 的历史按原契约版本解释，类型目录须支持依据已记录的版本选择对应解释器；
不将“当前注册的最新版”当作历史默认值。具体版本编码和注册接口在实施时落实，
缺少原版支持须明确失败，不通过隐式迁移改变旧输入/结果含义。

## 4. 具体业务层拥有的内容

| 具体内容 | 归属 |
|---|---|
| check/probe/regulate 等类型输入联合 | 宿主按需注册的业务 TaskType，无引擎内置保留类型 |
| checker/objective 引用、下载、digest、artifactRef | 制品准备适配器 |
| preparation 的 up-to-date/fallback/updated 选择方式 | 制品准备契约，不是所有类型都必须有的引擎字段 |
| language、subject/context 的业务含义、desiredLevel、治理预算 | 各任务类型协议；通用内核调用对应纯 Validator 并正确保留 |
| Check 的 ok/problems/requirements、Probe 的观察结果 | 对应结果协议，不是通用 completed 判据 |
| started-after-eligible/completed-after-eligible | Request.executionMatch 的时间条件，由 Engine 在类型/输入/版本/权限兼容后判定 |
| 对依赖目标创建新治理请求、治理后重查 | Coordinator 的业务编排 |

preparation 的通用事实是 prepare 调用何时开始、何时完成；TaskType.prepare 必需，
不强制要求 Artifact。无需准备时提供 async input => input；即时完成仍是真实调用，
可以记录开始/完成，但不能伪造下载等业务动作。
Executor 在执行开始后自行判断业务前提，不满足时按类型协议快速返回；
Engine 不提供条件等待/解锁机制，也不保证重业务已执行或目标达成。
allocation 由 Engine 协调匹配，TaskType.execute 内部等待可用实例期间体现为 queued；
实际开始后立即返回 ExecutionTracking，最终结果另行观察，不以 tracking 接收时间冒充开始。
Pool 管理资源，不要求 Engine 显式 allocate/归还租约；可替换 executionId 由 Engine
授权，Pool 确认回收有效并实际释放后才启动新执行，详见执行关系文档。
execution 的通用职责是实际执行及其证据，进展和正常结果的内部字段由业务协议拥有。

通用 snapshot 保留有界过程事实，不铺设各阶段的任意 custom 对象。
准备适配器的持久结果由其类型契约定义，不强制 Schema 库，核心保存不可变记录以供恢复/匹配；
该结果不是公开 snapshot 的必填业务字段。载荷示意见[接口定义](./interfaces.md)。

## 5. HTTP 适配与宿主

HTTP 适配器负责 Request 实体与 header/body 的转换、路径、错误状态码、分页和 SSE 编码，
复用同一核心 API。JSON body 解析属于传输边界；解析后的类型校验属于统一准入。
认证由宿主完成，可信调用上下文进入核心；type=regulate 等字段不能自授权限。

handler 不拥有端口、TLS、进程退出策略或业务类型注册。
断开订阅只释放观察连接，不是取消 Task；取消必须是独立的显式命令。
传输层不能因为自己的短超时改写 Task 的 eligibleAt/deadlineAt。
HTTP 和进程内 API 的错误外形可以不同，但业务事实和终结语义不能不同。
调用方到期停止等待不自动产生 Task 取消；未取消任务后来正常完成仍可查询和通知。
接口不能把超时之后所有更新一律丢弃，也不承诺迟到结果一定存在。
HTTP handler 可以有框架连接器，但不能要求核心导入 Web 框架。
输出采用 WHATWG Fetch 的 Request/Response 与 Web Streams 的可挂载 Web handler。
这些对象是 Web 标准且 Node 22 已提供；(Request) => Promise<Response> 是本包采用的
handler 约定，不是 node:http.createServer 的原生接口，也不是一种新 HTTP 线协议。
可信 caller 由宿主认证边界注入，不从业务 body 获得。具体注入签名在实施时固定。
Node HTTP 或特定框架通过连接器桥接，正确处理挂载前缀、响应头、流/背压及断连；
连接器不把传输 AbortSignal 当 Task cancel。核心/适配包不绑定某个宿主 HTTP 框架。

## 6. 与来源 idea 的分工

来源为 `01M61G3GCGWGHGA8VHG16WCNZ5`，本地设计基线为
`eaa0cf6a1f42d981e75106bd4ebc80351be01aa9`。
本 idea 拥有通用契约和测试引擎；来源 idea 继续拥有制品、三种业务适配器、
现有入口迁移及端到端业务验收。来源文档是设计依据，不是第二份可独立修改的通用规范。
通用决定在本 idea 收敛后，由来源 idea 适配引用；不把旧候选测试算作新引擎证据。

初期用 echo 与另一个纯计算测试类型证明可扩展性，避免必须先实现所有制品业务。
测试类型不是生产内置操作，也不扩张来源 idea 的业务范围。
包级职责、依赖和组装方式见下节；执行应用留在 apps，可复用实现留在 packages。

## 7. Package 划分与依赖（建议）

以四个包隔离纯契约、主动运行、HTTP 和持久化依赖，不把第 2 节每个逻辑模块都拆包。
以下名称均使用 @potential-guide/ 前缀，新增目录置于 packages/；本节只记录计划，
不在准备阶段创建 package.json、修改工作区依赖或发布配置。

| Package / 计划目录 | 拥有的职责与公共入口 | 不承担什么 |
|---|---|---|
| task-protocol / packages/task-protocol | 通用 Request/Task/Execution/事件数据、错误契约、核心服务与扩展端口的类型、纯 reducer/projector、多维分类及载荷校验 | 主动调度、IO、当前时钟读取、具体业务类型或框架 |
| task-engine / packages/task-engine | submit/query/cancel/subscribe、start/close、类型准入、准备/分配/执行协调、系列规划、执行共享与需求所有权；通过端口访问存储、时钟和类型实现 | HTTP 编码、数据库驱动、业务条件判定、Checker 下载或治理策略 |
| task-engine-http / packages/task-engine-http | 将 header/body、路由、错误码、分页/SSE 映射到注入的核心服务接口 | 创建引擎、选择存储、注册业务类型、监听端口、TLS 或认证凭据管理 |
| task-engine-storage / packages/task-engine-storage | 存储端口的本地持久参考实现、事务/索引/一致读取/checkpoint/恢复读取；显式 open/close 与迁移 | 调度、业务重放副作用、自动选版、HTTP、决定任务结局 |

端口定义与实现分离：服务接口、Store/Clock/类型适配器的抽象契约归 task-protocol，
task-engine 使用它们，外围实现遵守它们。端口类型不泄露数据库连接、HTTP Request、
Effect Fiber、worker 句柄等实现对象；纯投影接收显式事实和时间。
task-protocol 是当前语言中的协议承载包，不意味着其他语言必须依赖 TypeScript 包。
协议文档/schema 和跨实现测试向量才是互操作依据，SDK 不是协议。

### 7.1 编译依赖方向

箭头 A -> B 表示 A 导入/依赖 B，不是一次任务调用或事件传播方向。

```text
task-engine         ──→ task-protocol
task-engine-http    ──→ task-protocol
task-engine-storage ──→ task-protocol

宿主组装 ──→ task-engine
         ├─→ task-engine-http       （按需）
         ├─→ task-engine-storage    （持久模式）
         └─→ 业务 TaskType（纯判定、prepare、ExecutorPool）
```

HTTP 和存储包通过协议包定义的端口工作，不需要运行时依赖 task-engine 的具体类。
它们的集成测试可以 devDependency 引用 task-engine，但不能把测试组装变成生产反向依赖。
task-engine 不导入 HTTP/存储包；task-protocol 不导入其他三个包。禁止循环依赖，
也禁止通过根入口 re-export 把可选数据库或 Web 依赖重新带进纯核心。

第三方依赖按实际需要使用 pnpm catalog，内部用 workspace: 范围：

- task-protocol 定义通用 Validator/Equals 函数端口，不因业务输入校验强制引入 Schema
  库；具体 TaskType 可自行选择手写校验或使用 Schema 工具，纯协议不依赖业务实现。
- task-engine 可复用现有 effects 包协调异步过程；Effect 是实现选择，不进入线协议。
- 数据库驱动归 task-engine-storage，Web 框架连接器归 HTTP 适配侧，不强加给核心。

第一版本地持久参考实现采用 SQLite，由 task-engine-storage 实现 Store 端口；
task-engine/task-protocol 不直接依赖 SQLite 或其驱动。事件追加、请求幂等索引和
Series 后继关联在要求原子性的操作中使用同一数据库事务，避免成功记录与索引分裂。
本地文件采用 WAL、foreign_keys=ON、synchronous=FULL 和单主动 Engine 所有者；
具体驱动、表结构、事务及所有权实现在实施契约落实，不因选择 SQLite 就宣称已满足
恢复保证。文件日志不作为本轮另一个持久后端，不扩展分布式部署。
内存参考 Store 和虚拟时钟可从 task-engine 的独立 testing 入口提供，明确无跨进程持久性，
不为两种测试类型或每个 Store 端口新增包。持久适配使用同一端口一致性测试。

### 7.2 与现有业务 Package 的关系

现有 checker-host、objective-host、check-artifacts 及业务执行包并不等于通用引擎。
以下是后续接入的目标方向，不是当前 package.json 的依赖图；业务迁移由来源 idea 承担。

| 现有 Package | 后续职责 | 与通用引擎的关系 |
|---|---|---|
| checker-host | Checker 准备/检查类型适配、runtime/kernel、特有元数据与 References API | 使用 task-protocol 的类型/端口，服务组装可依赖 task-engine；通用内核不得反向导入它 |
| objective-host | Probe 类型适配、等级与动态依赖观察、组合 References | 注入 Check 服务并接入通用引擎；不另复制一套 Task/Series 调度器 |
| check-artifacts | 制品解析、校验、打包及摘要等能力 | 供业务准备适配器使用，不作为通用引擎前提 |
| objective-pilot / objective-regulator | 观察和单次调节的业务算法 | 保持业务层职责，通过适配接口消费引擎能力，不把算法塞进通用任务状态机 |
| regulation-coordinator | 治理请求、业务依赖与策略编排 | 后续适配通用请求/系列能力，业务条件及治理授权不进入核心 |

具体业务包若提供组合便捷入口，可以依赖 task-engine-http；仅需要进程内业务算法的
入口不应加载 HTTP 或存储。现有所有依赖不要求在本 idea 中一次性搬迁，
但新增通用包不得反向依赖具体 Checker/Objective Host、runtime 或 Coordinator 实现。
具体 Check 输入/结果契约归业务层；无需为前置条件往协议层加入 Check 分支或关联
接口，也不能通过引入高层生产包制造循环依赖。

仓库现有 package-layers.yaml 的 protocol/business/tools 是粗分层；计划将上述通用包
列入基础 protocol 层，并增加同层的包级依赖约束。仅列同一层不能证明
task-engine 没有导入 checker-host，须以导入/依赖检查单独验证上述方向。

### 7.3 宿主组装与可验证边界

宿主创建 Store、Clock 及封装各类型 ExecutorPool 的 TaskType，统一注入 engine，
再按需挂载 HTTP handler；不再用 { ...checkType, pool: checkPool } 分别拼装。
TaskType、tracking 和 Pool 依赖协议端口，不依赖 Engine 实现；无需新增独立资源适配器包或 Pool 包。
Executor 可在执行时做业务前置判断并快速返回；宿主无需装配额外的条件证据服务。
宿主先打开存储、再启动引擎；关闭时停止准入并按契约收束引擎与观察连接，最后关闭存储，
不把 close 变成批量用户取消。具体运行中恢复与停止政策仍按概念文档待决项收敛。

通用引擎本轮不新增独立服务器产品或必须安装的总包。统一进程/CLI 属宿主组装，
测试宿主可放测试夹具；需要交付可执行应用时放 apps/，不要求每个适配包自带 listener。

包级验证应证明：

- 只安装 task-protocol 可以运行纯投影，不启动 IO 或读取当前时间。
- 只安装 task-engine 及其必要依赖、注入内存 Store 即可运行非制品任务，不需 HTTP/数据库。
- HTTP/持久存储分别可选组装，进程内和 HTTP 场景共享同一引擎与事实源。
- 独立 tarball 消费者能解析公开 exports，无源码/workspace 链接依赖或循环。

构建、lint、test、typecheck、exports 和工作区依赖在实施阶段与 turbo.json 对齐；
发布仍遵守既有包级标签规则，本次文档规划不授权 npm 或 Release。
