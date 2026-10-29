# Implementation

这是准备阶段的轻量实施种子，不表示已实现或授权开始实现。
以[系统边界](./ideal/system-boundaries.md)、[概念](./ideal/concepts.md)和
[接口示例](./ideal/interfaces.md)为输入，先收敛阻塞正确性的决策再编写运行时代码。

## Steps

### I-S01: 建立核心协议与纯投影

定义 Request 类型组合、任务事实、内驱 stage/外界信号/时间条件三维投影、错误与服务 API，
以虚拟时钟和非制品测试类型验证纯归约、输入校验及权限边界。
类型注入统一为 TaskType，纯 validate(unknown) 与 equals(Input, unknown) 分开于
具备副作用的必需 prepare/allocate；不强制业务提供 inputSchema 或依赖 Schema 库。
Engine 申请 Executor 前完成预检及必要的准备后校验；恒等 prepare 也必须实际调用，
返回 Input 并记录准备事实，不使用可选分支或返回 undefined 的空实现。
将本设计的 freshness 名称改为 Request.executionMatch，保留两种 eligible 锚点的
时间匹配语义，不复制策略到 snapshot。equals 只比较完整业务输入，不代替请求幂等。
按[包级边界建议](./ideal/system-boundaries.md#7-package-划分与依赖建议)落实经评审的
task-protocol/task-engine 分层，纯协议入口不加载主动运行或业务实现。

### I-S02: 落实调度与可恢复执行

实现准备、分配、执行三个过程协调、原节拍递归、原子取消/终结、Execution 需求所有权，
不以 pending/timed_out 作为内驱 stage；保留超时后的完成事实和通知，时间到期不伪造取消。
建立存储端口及本地持久参考实现；重启时 started 但无可靠结束事实的执行以
execution_interrupted 失败，已记录结果先补齐，尚未开始任务继续调度，不自动重跑未知执行。
引擎无前置条件声明、readiness/blocked 或内置 Check；所有业务类型按需注册。
Executor 自行做轻量前置判断，不满足就正常快速返回业务结果，不保留 Task 等待解锁。
执行故障与业务不满足分开，重试由业务新请求或已声明 recurrence 驱动。
按[执行与宿主组装](./ideal/execution-and-host-composition.md)划分 allocation：
Engine 协调共享匹配与正式绑定，按类型注入的 Pool 原子授予/回收 Executor 使用租约，
Executor 在租约内运行一次 Execution；共享执行不重复申请租约；
验证无资源时不伪造 running、预留失败补偿及父子编排不互锁。
递归后继为新 Request 经准入产生新 Task；唯一派生 Pending 控制等待积压，
持久化前后继规划关联防止超时、迟到终结、命令重试或崩溃恢复重复续作。
内核不导入具体业务类型，类型行为通过宿主装配的适配器调用。
本地持久适配采用 SQLite，独立于引擎；端口契约归协议层，存储驱动不进入核心依赖。
实现事件、幂等索引与前后继关联的原子事务；验证提交失败不报告成功，不降级为内存存储。

### I-S03: 提供传输适配并验证集成

提供可挂载 HTTP handler 与类型化调用辅助，不监听端口；
重用核心命令、查询和订阅，映射身份、错误、游标和 SSE，
运行最小覆盖测试及最终 pnpm check，不在此搬迁来源 idea 的生产业务。
HTTP 包通过注入的服务接口工作，不反向依赖引擎具体实现；新增工作区脚本和 exports
按最终包划分接线，使用独立消费者验证可选组合，而非仅验证 monorepo 内部导入。

## Acceptance criteria

### I-AC01: 抽象边界与类型安全成立

静态依赖检查和两种非制品测试任务证明没有注册 Check 也能运行，
新增任务类型无需改内核即可注册；
Validator/类型测试拒绝未知类型、非法载荷、跨类型幂等复用和跨作用域访问，
业务 progress 不改变生命周期，普通业务不满足不冒充执行失败。
包级导入检查证明 protocol 不依赖核心/适配器，engine 不依赖 HTTP/存储驱动/业务包；
不能仅凭 package-layers.yaml 的同层分类声称满足依赖边界。

### I-AC02: 时序与恢复确定可验

固定事件前缀/时间重放、checkpoint 等价、并发竞争与故障注入证明取消冻结、
完成与取消裁决一致、后继不重复、过期预算不重置、共享执行不伤其他需求。
证明 eligible 到点不凭空推进 stage，按时完成不因晚查询超时，晚完成可同时 completed
且超时；最终分类、同刻边界与超时递归策略须先按概念文档收敛，不用旧互斥终态断言替代。
覆盖显式 initial：未到/已到 eligible 但尚未推进均保持 initial，初始取消冻结 initial，
首次进入后续阶段必须有引擎推进事实，不能省略 stage 或用 pending 代替。
验证所有非终态取消、迟到执行结果、错过节拍和崩溃重启的明确处置。

### I-AC03: 进程内与 HTTP 契约一致

相同场景分别经核心 API 和挂载 handler 执行，比较业务结果及派生状态；
证明 HTTP 断流不取消 Task、分页/续读边界不丢事实、错误映射和授权一致。
所有相关测试及 pnpm check 通过；记录可复核证据，不借用来源 idea 的旧测试结果。

## 验证场景清单（准备阶段，未执行）

下表细化既有验收标准，不增加独立契约或完成声明；待决语义收敛后补全精确边界输入。
执行状态仅在 ledger 的对应 I-AC 项中记录，不把规划场景当作测试通过证据。

| 归属 | 场景与方法 | 应观察到的结果 |
|---|---|---|
| I-AC01 | 仅注册两种非制品 TaskType、包依赖检查及非法载荷 | 不要求 Check 或条件服务，各类型 Pool 可注入，无反向依赖；错误明确拒绝 |
| I-AC02 | 固定事实前缀与虚拟时钟跨 eligible/deadline | initial 不因到点推进，Pending/超时独立派生；按时完成不因晚查询超时 |
| I-AC02 | 超时后正常完成/失败及同一事件重复投递 | 保留迟到事实和通知，时间失约不消失，不复活取消任务 |
| I-AC02 | Executor 前置判断不满足、满足及判断抛错三条路径 | 不满足时不做重工作但正常 completed；满足继续；故障为 execution_failed，无 blocked 或等待解锁 |
| I-AC02 | 前置判断后环境变化，业务选择新请求或周期再试 | Executor 按业务契约处理，不承诺持续满足，不隐藏自动重试或条件事件 |
| I-AC02 | 同 Series 两轮均已 eligible，另有未来轮次 | 可同时存在已 eligible 任务，但最多一项有效 Pending；不套唯一 Active 约束 |
| I-AC02 | eligible 节拍被延迟多个周期及恰好到点 | 严格未来原节拍选点，不补历史；当前执行未结束不阻止规划 |
| I-AC02 | A 超时规划 B，B 已到点后 A 迟到终结 | 仍只关联 B，不因 Pending 已空生成 C；取消不自动续作 |
| I-AC02 | 后继规划/受理中途崩溃并重复恢复 | 恢复同一 Request/Task 关联，不重复执行规划，不丢有效后继 |
| I-AC02 | SQLite 事务在提交前失败、提交后响应前中断 | 未提交操作无部分事件/索引/后继；已提交请求重试恢复原身份，不重复规划 |
| I-AC02 | 重启时分组注入有结果/无结果/未开始/已取消任务 | 有结果补齐，无结束记录的已开始执行标 execution_interrupted；其余保留正确调度与结局 |
| I-AC03 | Web handler 与进程内 API 同场景，Node bridge 断连/背压 | 核心语义一致，无自动 listener，断连不取消 Task，流资源有界释放 |
| I-AC03 | 历史分页、订阅交接和存储 checkpoint | 按最终确定的边界无丢失或重复处理，不用 timestamp 作严格游标 |
| I-AC02 | Pool 无容量、并发申请、撤销/授予竞争及绑定写入失败 | 等租约仍 queued，原子授予不超配，无 Executor 内部隐蔽排队，迟到未采用租约可核实回收 |
| I-AC02 | 同一租约重复归还、旧代次回报、清理失败 | 不增加重复容量、不污染新租约；异常实例淘汰/隔离而非直接重新出借 |
| I-AC02 | 同引擎父编排等待子 Check、多个 Task 共享执行 | 子任务能获得所需资源，共享 Execution 不重复预留；单 owner 取消不影响其他 owner |
| I-AC01 | 脱离 Engine 直接调用测试 Executor | 只需执行/资源端口，无 Engine 实现或 HTTP 自调用依赖 |
| I-AC01 | 输入预检失败、准备后业务校验失败、恒等 prepare | 前两者均不调用 allocate；恒等 prepare 确实调用并返回 Input，有真实开始/完成而无虚构 IO |
| I-AC02 | equals 相等但策略/身份不同、相同浮动引用选出不同版本 | 相等业务输入仍分别按 executionMatch 匹配，版本/权限/环境冲突不共享，Task 身份不合并 |
| I-AC01 | 同 requestId 改 executionMatch、错误的等价关系或抛错比较器 | 幂等仍比较完整意图；等价关系向量覆盖自反/对称/传递，比较故障显式报告 |
| I-AC01 | equals 合法 Input 对比域外 unknown、不同有效输入、对称交换合法参数 | 域外 false，无修改或转换；合法域等价关系成立，不将异常宽泛吞成 false |
| I-AC01 | 纯 Validator/Equals 的输入冻结、IO 监控及无 Schema 库测试类型 | 两个纯函数不做 IO/读可变环境/改输入；不用 inputSchema 也能正常准入及分组 |
| I-AC01 | 同类型两版输入/结果契约及旧版解释器缺失 | 历史按记录的原版校验，缺失明确失败，不回退最新版或改写旧载荷 |
| I-AC02 | 升级后重放 checkpoint、重发旧 requestId 和恢复未执行任务 | 原绑定/语义保持；幂等不创建新版请求，缺少兼容执行能力不自动换 Executor |
| I-AC02 | 完成时间等于 deadline、可靠完成先于取消但处理较晚 | 等于截止按时；按可靠事实顺序裁决，不按客户端时间或队列延迟覆写结果 |
| I-AC02 | terminated 超时规划延迟多个周期、重复恢复 | 以 deadline 为锚点取严格未来周期点，不造终结事实，不补历史轮次 |
| I-AC03 | 同水位分页中新增事件、订阅交接间写入、重复续订与过期游标 | 固定页集、交接不丢事件、位置去重；过期明确 410，不以快照时间作为游标 |
| I-AC02 | 同 SQLite 库重复启动主动引擎、事务锁超限或容量耗尽 | 不出现双重调度或静默存储降级，关键恢复记录不被驱逐 |
| I-AC02 | allocation 等待超时与 Pool 授予竞争、timer 延迟及重启 | 过期 Task 不新启动，未使用迟到租约回收；其他有效需求可继续，不伪造取消或分配失败 |
