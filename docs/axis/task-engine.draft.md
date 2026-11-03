---
frozen: false
---

# Task Engine 设计不动点（参考草稿）

状态：历史整理草稿，仅供参考；不作为当前规范或代码清理依据。
原整理日期：2026-10-31；参考定位更新于 2026-11-02。

当前职责边界与行为契约以[Task Engine 职责边界](./task-engine-responsibilities.md)为讨论入口。
以下保留原整理内容，其中系列、周期续作等陈述不代表当前决定；冲突时不以本草稿覆盖后续明确共识。
其中 Bundle digest、URL 等历史陈述不作为新架构的内容寻址依据；
新架构统一采用 IPFS UnixFS 目录根 CID，见[Task Bundle 契约](./task-engine-contracts/task-bundle.md#内容身份与引用)。

本文从近期 Task Engine 相关 Ideas 的明确讨论、构想及实施契约中提取陈述，
并用必要代码核对实际差异。它不是根据现有代码归纳出来的“现状即正确”，
也不是新的实施计划或验收记录；写入本文不代表用户已逐条接受这份整理。

## 判定基准

本次讨论明确采用以下定义：

- 已确认的设计不动点描述当下共识，是新逻辑的判定基准。
- 与这些共识不同的行为，视为旧逻辑，不以代码年龄、命名或既有测试通过与否判定。
- 为新旧逻辑做适配、转换、双轨选择、缺省回补或语义替换的代码，视为向前兼容。
- 不在共识覆盖范围内的行为是尚未定界，不自动归为旧逻辑。

旧输入的显式拒绝不是新旧桥接。当前契约内的重启恢复、Worker 代际隔离、
任务共享判等及可信资源通信也不是向前兼容；它们是否保留，取决于其行为是否符合不动点。
“两个 Input 兼容、可共享 Run”与“兼容旧协议”是不同含义。

来源中的早期建议、后续明确决定、已接受实施和未决方向分别对待。
后续明确改变的同一设计问题，不同时保留两套互相矛盾的“共识”；
未被改变的早期原则继续有效。代码和测试用于定位符合或偏离共识的行为，
不能反向使旧逻辑成为设计不动点。

## 一、通用边界与对象

### AX-01：Engine 是业务无关的协调器

Engine 协调需求、完整运行、匹配、时间、取消及持久事实。Check、Probe 等业务逻辑、
制品解析、Bundle 调度和业务前置判断属于类型实现。Engine 没有内置保留业务类型，
不提供通用 prerequisite 解锁状态机。

来源：[通用引擎边界][generic]、[完整 Run 构想][whole]、[Check MVP][check]、[Probe][probe]。

### AX-02：Request、Task、Run 和 Execution 是不同对象

Request 是不可变调用意图；Task 是一次受理后的独立需求；Run 是可共享的完整尝试，
包括 Preparation、Allocation 和 Execution；Execution 仅表示类型内部实际业务执行子过程。
多个 Task 共享一个 Run，不合并各自的身份、时间、取消意图或结果资格。

来源：[原始对象定义][concepts]、[完整 Run 命名与讨论][whole-discussion]。

### AX-03：准备属于 Run，不属于接收 Task 的共享资格

Run 的完整尝试从准备之前开始。Engine 先持久化 Run 开始事实，再投递运行入口。
Prepared 是类型内部固定实际内容的中间事实，不是每个接收 Task 必须独立生成的匹配凭证。
准备失败和业务资源分配失败都可以形成该 Run 的失败终结。

来源：[完整 Run 构想][whole]、[已接受的内部设计][runtime]。

### AX-04：类型内部资源复用不定义 Run 共享

Run 共享是多个需求使用同一完整尝试；业务 Worker 热复用是类型内部跨尝试的资源使用。
两者不相互替代。类型负责 Bundle digest、业务资源池和内部调度；
Engine 不因这些内部策略改变需求匹配语义。

来源：[Worker 与复用讨论][whole-discussion]、[完整 Run 实施契约][whole-implementation]。

## 二、需求身份、输入与匹配

### AX-05：每种 type 只注册一个当前版本

每种 type 的当前链路只有一个注册版本，不提供旧版本执行选择或多版本共存通道。
version、contractRevision、模块内容身份和 environment 仍约束绑定身份；
它们不是删除对象，也不允许把旧记录重新解释成当前契约。

来源：本次对话的明确选择；[清理构想][cleanup]。
这条改变了早期“保留多个原版解释器”的方向，不是早期引擎的既有共识。

### AX-06：Input 契约以声明式 Schema 为唯一输入定义

类型作者声明输入 Schema，由共享机制生成 Validate 与 Equals；
不同时保留作者自定义 validate/equals 的旧注入通道。
输入使用 JSON Schema Draft 2020-12 标准语义及明确运行限制，
表单支持范围不反向裁剪服务端任务契约。

来源：[Schema 构想][schema]、[用户明确的 Schema 决定][schema-discussion]、
[Schema 实施契约][schema-implementation]。

### AX-07：Validate 与 Equals 的职责分离

Validate 判断输入合法性；Equals 按 Schema 结构选择并比较字段，
不以完整校验通过作为比较资格，也不推导任意业务等价关系。
结构未纳入比较的额外字段，不因值不同自动使 Input 不等；
这些字段是否允许由 Validate 判定。提交路径仍执行输入校验。

同一 requestId 的幂等比较使用完整原始意图，包含通用请求字段及省略语义，
不替换为这种结构投影判等。

来源：[判等讨论及已撤回建议][schema-discussion]、[原始意图定义][concepts]。

### AX-08：共享匹配基于原 Input、可信身份和 Run 事件

需求能否共享由 Input 判等、type/version/契约/environment/scope 等可信边界、
服务权限和 MatchPolicy 决定，不依赖接收方的 Prepared 或重复资源授权。
started-after-eligible 对应 Run 开始事件；terminated-after-eligible 对应 Run 成功或失败的逻辑终结事件。
绑定发生在对应事件时点，不提前伪造绑定，也不倒查接收之前已终结的 Run。

来源：[终结匹配决定][termination-discussion]、[完整 Run 构想][whole]。

### AX-09：时间资格不承诺浮动引用的新鲜度

浮动 URL 的原 Input 匹配时，接收需求可以共享 Run 已固定的内容，
即使该 URL 后来指向其他内容。MatchPolicy 约束 Run 事件时间，不保证最新制品。
准确内容由 Input 中显式 pin digest 等业务约束表达，实际使用内容可追溯。
重做使用原填写参数，不依据旧结果偷偷补锁、解锁或改写引用。

来源：[浮动引用讨论][whole-discussion]、[UI 的原参数重做要求][ui-requirements]。

## 三、时间、取消与系列

### AX-10：内驱阶段、外部取消和时间是独立维度

Task 的 stage 表示内驱位置，不把 pending、canceled 或 timed_out 混入互斥阶段枚举。
超时可以与成功或失败同时成立；取消表示该 Task 不再需要结果，不等同于 Run 终结。
Task 的终结、Run 的逻辑终结和实际物理退出分别有自己的事实。

来源：[三个推动力][concepts]、[终结匹配澄清][termination-discussion]。
早期文档中的 preparing/queued 等 Task 阶段树不随此原则一并保留；
当前完整 Run 协议的 Task stage 为 initial/running/completed/run_failed。

### AX-11：生效时间、期限和事件先后各有明确含义

`effectiveEligibleAt = max(requestedEligibleAt ?? receivedAt, receivedAt)`；
`deadlineAt = effectiveEligibleAt + timeoutMs`。匹配下界包含等号，
但相同墙钟时间戳不替代“需求接收先于匹配事件”的持久化先后关系。
只有严格超过 deadline 才算超时；deadline 不是普遍的结果匹配上界。
原始 Request 不被默认值回写，幂等重试或重启不重新锚定已受理需求的时间。

来源：[终结匹配的时间决定][termination-discussion]。

### AX-12：需求撤回不误伤其他共享需求

取消只撤回该 Task 的需求，不自动终结其他需求仍持有的 Run，也不承诺回滚业务效果。
超时撤去相应的调度和资源保护保障，不自动取消已运行工作，不抹除符合匹配规则的迟到事实。
运行仍受独立执行安全上限及可信资源替换政策约束。

来源：[终结匹配决定][termination-discussion]、[完整 Run 构想][whole]。

### AX-13：Recurrence 产生独立新需求，不透明重跑旧 Run

recurrence 声明正周期和显式 eligible/terminated 锚点。
每个前驱最多原子规划一次后继；后继有新的 Request/Task 身份，继承 seriesId，
不修改前驱意图。迟到处理跳过错过节拍，不补一批历史 Task，不因迟到结果重复规划。
同系列最多一个尚未生效的有效等待槽位，不等于最多一个活跃 Task。
取消不触发续作，也不追溯撤销已建立后继。

来源：[系列定义][concepts]。其中旧术语和旧类型版本继承选择由 AX-02、AX-05 覆盖，
其余规划原则继续保留；后继不是旧格式迁移器。

## 四、类型执行、权限与可靠性

### AX-14：Engine 面对单一完整运行入口，不代理旧类型生命周期

TaskType 声明 input/result/message Schema，并提供 `run(input, context)`。
准备、业务校验、分配及实际执行由类型内部编排；
Engine 不再调用动态类型的 prepare/validatePrepared/execute 等分段生命周期，
也不通过宿主资源桥换个名字代理这些旧入口。
类型内部仍可存在这些业务函数，函数名称本身不构成旧逻辑。

来源：[TaskType 职责修剪][task-type]、[完整 Run 实施契约][whole-implementation]。

### AX-15：Worker 切分遵循信任边界或真实并行需要

Engine、动态 TaskType 和跨信任边界的定制工作保持独立内存状态和最小消息接口；
类型不能获得 Engine 内部可变对象或完整状态。普通异步 IO 并发或 Run 数量
不自动要求同数量的 Worker。取消一个 Run 不通过杀整个类型守护来实现。
这种隔离不宣称完整 OS 安全沙箱，也不宣称阻止插件发布已经明确传给它的数据。

来源：[用户明确的 Worker 原则][whole-discussion]、[完整 Run 构想][whole]。

### AX-16：权限属于可信服务和宿主资源边界

服务访问、实际资源动作、资源替换及真实 Agent 能力分别受可信授权约束。
删除通用 TaskType.authorize，不删除 Engine 服务授权、Source 动作授权或替换控制。
同 scope 的结果接收不因接收 Task 未准备而要求再次获取资源；
同进程调用、消息 payload 和投入额度都不自授权限。

来源：[authorize 边界澄清][whole-discussion]、[完整 Run 实施契约][whole-implementation]。

### AX-17：Log、Progress、checkpoint 和 Result 不互相冒充

RunProgress 只包含 stage、可选 percent 和展示 message；
percent 是当前阶段预估，缺失表示未知，100 不表示成功或回收，
阶段切换和估计回退不控制调度。展示文字不承载机器控制或 Bundle 证据。
checkpoint 是独立结构化证据，Result 是最终结果；结构合法不替代业务证据有效，
复验在类型隔离边界内执行，不改写验证对象或历史事实。
确认在约定的校验和持久化边界之后返回，不等于订阅者已经收到。

Log 是显式、有界、独立保留的诊断，不替代上述任何业务输出，
不推进生命周期 revision 或参与匹配、复用与终结。
日志不可用、超限、过期及尾部未知需明确可见；诊断确认不能充当退出或回收证明。
context 的身份、消息与确认边界见[RunContext 契约](./task-engine-contracts/run-context.md)，
日志序号、保留与消费边界见[Run 日志契约](./task-engine-contracts/run-logs.md)。

来源：[Progress 讨论][task-type]、[已接受的输出与复验设计][runtime]。

### AX-18：运行消息归属于 Task，并显式确认业务接纳

messageSchema 和 messages 必选；false 表示 Never，拒绝包括 null/{} 在内的一切业务载荷，
而 true/{} 不表示 Never。取消仍走独立控制通道。
消息保留 taskId/messageId/可信 Caller，只投递已绑定且已投递的当前 Run；
没有路由时明确拒绝，不广播、不伪造绑定或自动开启 Run。
入队、业务接纳、实际效果分别表达，同身份改写意图是冲突，
未知不被当作拒绝或成功；消息不直接修改原 Input、续期或复活终结 Run。

来源：[消息讨论][messages]、[已接受的路由与确认设计][runtime]。

### AX-19：逻辑终结不证明资源已经释放

发出取消信号、类型报告 released、资源调用返回或进程失联都不单独证明物理回收。
宿主跟踪 Run/Worker 代际的全部已启动资源动作，包括类型未 await 的动作，
并确认动作结束和真实 owner/句柄释放。只有可信请求级生命周期声明才允许对应的请求结束证明。
等待有界；拒绝、超时、失联保持清理未知，旧代际迟到回调不改变新代际事实。

来源：[宿主资源证明收敛][runtime]、[完整 Run 实施契约][whole-implementation]。

### AX-20：持久恢复重建事实，不创造成功或自动重演副作用

原子受理、事件与后继关联遵守 Store 的明确事务边界；SQLite 不可用时不静默退回内存。
当前契约内可靠终结事实可以复验并补齐相关投影；
已开始而没有可靠终结的 Run 明确中断，保留副作用与清理未知，不自动重跑。
checkpoint 不恢复调用栈，重启不证明外部副作用没有发生，也不承诺跨 Crash exactly-once。
业务“不满足”可以是正常结果，不能与执行故障混成同一种失败。

来源：[恢复原则][concepts]、[完整 Run 内部设计][runtime]、[Check][check]、[Probe][probe]。

## 五、协议消费者与升级边界

### AX-21：公开发现与目录由服务事实定义

发现返回实际可提交类型及输入契约，revision guard 阻止按过期契约静默提交。
任务和 Run 目录覆盖 Endpoint 中获授权且仍保留的记录，不限本工具提交或见过的实体；
本机缓存、事件扫描和当前页不能冒充完整目录。
冻结分页保持成员、顺序及摘要稳定，同时权限撤销和清理及时生效；
失效、预算超限和不支持明确失败，不以空列表或新旧页拼接伪装完整成功。

来源：[Schema 发现][schema]、[任务目录][history]、[UI 实体目录要求][ui-requirements]。

### AX-22：Web UI 是独立的公开协议消费者

UI 不内嵌或启动 Engine，不接管后端生命周期；UI 退出、断流或停止观察不取消 Task。
任务、Run、业务 Execution、提交回执与连接状态分别呈现，
连接持续刷新不证明业务仍运行，结果相同不证明共享，Task 终结不证明 Run 已回收。
UI 不硬编码业务类型，不解析业务 URL 补齐 subject 契约，不承担通用资产管理。

来源：[UI 构想及明确试用反馈][ui]、[UI 需求][ui-requirements]、
[资产管理关闭决定][assets]。

### AX-23：新链路不保留旧契约解释和新旧桥接

协议、数据、配置和接口只支持当前共识。旧字段回补、旧阶段例外、旧版解释器选择、
双格式读取和旧生命周期适配不成为保留要求。遇到不满足当前契约的数据，
不偷换 schema、时间、身份或结果含义；必要拒绝仍明确可见。
开发旧数据已获允许清空，不建设迁移器；实际删除限定明确的数据文件，
运行时拒绝不自动删除用户数据。

来源：本次对话的新旧逻辑定义及开发数据选择；[清理构想][cleanup]。
早期“旧数据保留、历史按原版”的持续支持要求由此改变，
但“不能偷改历史含义、不能把未知当成功”的可靠性原则没有改变。

## 设计演进与尚未定界事项

| 来源中的旧陈述或候选 | 当下整理 |
| --- | --- |
| Task 独立 prepare，Prepared 判等后才能共享；Engine 调用 prepare/execute | AX-03、AX-08、AX-14：完整 Run 共享，类型内部准备，单一 run 入口 |
| TaskType 自定义 validate/equals；比较前先完整 Validate | AX-06、AX-07：Schema 生成，合法性校验与结构判等分离 |
| executionMatch / completed-after-eligible；Execution 同时指整体与子阶段 | AX-02、AX-08：matchPolicy；两种政策指 Run 的开始/成功或失败终结 |
| eligible 可以早于接收；deadline 是匹配结果上界；超时即无结果 | AX-10、AX-11、AX-12：实际 eligible 不早于接收，迟到结果与超时独立 |
| 接收需求重复资源授权；通用 TaskType.authorize | AX-16：服务授权与真实资源动作授权保留，不增加类型通用授权 hook |
| 多原版解释器、历史任务沿旧版执行、缺失字段回补 | AX-05、AX-23：唯一当前注册，无旧版执行和元数据桥接 |
| Engine/Web UI 的通用 TaskType.assets、资产版本查询和清理前置流程 | AX-01、AX-22：该方向已关闭，不因保留讨论就成为当前能力要求 |

以下不是本次已确立的不动点：

- **Regulate 业务协议。** [regulate-task][regulate] 仍 preparing；
  quota、contribution、target level、join 和修订协议不作为已交付 Engine 能力。
  已明确的“不拼接权限、不延长 Task deadline”等边界，不等于具体记账 API 已定稿。
- **通用资产缓存产品。** [资产 Idea][assets] 已 abandoned；
  保留的磁盘缓存需求不自动成为新的 Engine/TaskType 接口。
- **旧收藏的处理细节。** [UI 要求][ui-requirements] 仍含无 Task 身份旧模板保留条款；
  本次对话已说明收藏适配由另一 session 负责。真实 Task 星标和不伪造服务任务的方向明确，
  旧模板是否删除、以何种形状保留的最终结论不在这里擅自决定。
- **精确实现参数。** Worker 数量、心跳间隔、查询预算、缓存结构和内部类名不是自动冻结的设计不动点。
  改动它们是否偏离共识，需要看是否改变上述语义。

## 必要代码核对：现状不是设计依据

| 代码位置 | 与不动点的关系 |
| --- | --- |
| [当前 TaskType 与 RunContext](../../packages/task-protocol/src/run.ts)、[Stage 与 Binding](../../packages/task-protocol/src/types.ts) | 对应 AX-02、AX-05、AX-14、AX-17、AX-18；接口形状可核对，不意味着所有可选字段都属旧逻辑 |
| [Schema 编译与结构判等](../../packages/task-protocol/src/schema.ts) | 对应 AX-06、AX-07；equals 独立做结构投影，提交校验另有入口 |
| [Engine](../../packages/task-engine/src/engine.ts) 的 compatible、bindings、startGroup、start 和 recur | 核对 AX-03、AX-08、AX-13、AX-20；其中 currentVersions 及多版本 key 仍偏离 AX-05 |
| [旧 updatedAt 回补与终结例外](../../packages/task-protocol/src/projection.ts)、[TaskRecord.updatedAt 可选声明](../../packages/task-protocol/src/types.ts) | restoreTaskUpdates 和旧 preparation_failed/allocation_failed 例外偏离 AX-10、AX-23，是明确候选；当前事件重放本身符合 AX-20 |
| [UI 回执模型](../../apps/task-engine-web-ui/src/model.ts)、[当前生命周期展示](../../apps/task-engine-web-ui/src/lifecycle.ts) | validSnapshot 仍接受旧 Task 阶段，偏离 AX-10；连接、业务和物理回收区分仍符合 AX-22 |
| [SQLite 格式检查](../../packages/task-engine-storage/src/index.ts) | 只接受当前格式并拒绝旧格式，符合 AX-23，不是双格式桥接 |
| [类型守护](../../packages/task-engine/src/type-supervisor.ts)、[类型 Worker](../../packages/task-engine/src/type-worker.ts) | 当前结果复验、代际隔离、释放证明对应 AX-15、AX-17、AX-19、AX-20，不按 historical/old generation 命名删除 |
| [Check 内部实现](../../packages/check-task/src/implementation.ts)、[Probe 内部实现](../../packages/probe-task/src/implementation.ts)、[业务 pool](../../packages/task-engine/src/pool.ts) | 真实业务内部 prepare/execute/pool 符合 AX-04、AX-14；只有为旧 Engine 类型接口保留的桥接才属于 AX-23 |
| [UI 收藏服务](../../apps/task-engine-web-ui/src/server.ts) | 仍有 Task 星标与无来源模板路径；由收藏负责 session 收敛，不用本整理替代其决定 |

## 审阅范围

优先审阅 AX-01 至 AX-23 的陈述是否准确表达当下共识，以及演进表是否正确标出被覆盖的设计。
通过审阅的不动点才作为后续清理基准；代码差异和桥接清单随后按编号逐项建立，
不将本文或现有清理候选当作代码删除授权。

本次仍限定 8 个 workspace：task-protocol、task-engine、task-engine-storage、task-engine-http、
task-engine-server、check-task、probe-task、task-engine-web-ui，及直接相关测试、文档、脚本。
旧 check-host/objective-host 和独立 objective-pilot/objective-regulator/regulation-coordinator 不在清理范围。

## 来源索引

这里记录阅读时的生命周期状态，状态本身不把所有历史讨论或实施细节变成永久共识。
本整理不修改这些 Ideas 的内容、历史接受记录或生命周期。

| 引用 | Idea | 阅读时状态 | 本文用途 |
| --- | --- | --- | --- |
| [generic-task-engine][generic] | 通用调度与生命周期 | completed | 基本对象、三维状态、系列、恢复；被后续覆盖的部分单列 |
| [check-server-mvp][check] | Check 与通用服务 MVP | completed | Server 组合、业务与故障分离、制品准确性 |
| [probe-task][probe] | Probe 接入统一服务 | completed | 观察与修复边界、子需求组合 |
| [terminated-after-eligible][termination] | 终结事件匹配 | completed | 时间、取消、匹配和破坏升级 |
| [task-type-schema-discovery][schema] | 输入 Schema 与发现 | completed | Validate/Equals、发现与消费者分工 |
| [task-history-query][history] | 任务目录 | completed | 授权范围、冻结分页、更新事实 |
| [whole-execution-reuse][whole] | 完整 Run | completed | 覆盖早期分段生命周期，隔离、消息和资源证明 |
| [task-engine-web-ui][ui] | 可选调试工作台 | implementing | 当前明确产品边界和试用反馈，不宣称全部交付 |
| [task-type-artifact-management][assets] | 通用资产管理 | abandoned | 关闭方向与不纳入当前职责的边界 |
| [regulate-task][regulate] | 统一治理业务 | preparing | 识别未决范围，不将候选方案写成现有能力 |
| [engine-current-only-cleanup][cleanup] | 新链路清理 | preparing | 本次单版本与开发数据决定；仍未验收 |

[generic]: ../../.silvermoon/ideas/01M63AFYJEDXZ8PFZQQVZC1W02/outer/inner/ideal/Idea.md
[concepts]: ../../.silvermoon/ideas/01M63AFYJEDXZ8PFZQQVZC1W02/outer/inner/ideal/concepts.md
[check]: ../../.silvermoon/ideas/01M65ABHR94EQ14NYTGZAWRRV3/outer/inner/ideal/Idea.md
[probe]: ../../.silvermoon/ideas/01M65AH22HXJXNC7BQNVD0ZTHB/outer/inner/ideal/Idea.md
[termination]: ../../.silvermoon/ideas/01M66MH9YKNJ406ESX7J1HTY7J/outer/inner/ideal/Idea.md
[termination-discussion]: ../../.silvermoon/ideas/01M66MH9YKNJ406ESX7J1HTY7J/outer/inner/ideal/Discussion.md
[schema]: ../../.silvermoon/ideas/01M66MRFCSDK99MAEN8RN3NKBH/outer/inner/ideal/Idea.md
[schema-discussion]: ../../.silvermoon/ideas/01M66MRFCSDK99MAEN8RN3NKBH/outer/inner/ideal/Discussion.md
[schema-implementation]: ../../.silvermoon/ideas/01M66MRFCSDK99MAEN8RN3NKBH/outer/inner/Implementation.md
[history]: ../../.silvermoon/ideas/01M66TPNEMSQ8Y8SDSN2CDN6BA/outer/inner/ideal/Idea.md
[whole]: ../../.silvermoon/ideas/01M67XYR798HDDWP6A41CPD5MQ/outer/inner/ideal/Idea.md
[whole-discussion]: ../../.silvermoon/ideas/01M67XYR798HDDWP6A41CPD5MQ/outer/inner/ideal/Discussion.md
[whole-implementation]: ../../.silvermoon/ideas/01M67XYR798HDDWP6A41CPD5MQ/outer/inner/Implementation.md
[runtime]: ../../.silvermoon/ideas/01M67XYR798HDDWP6A41CPD5MQ/outer/inner/RuntimeDesign.md
[task-type]: ../../.silvermoon/ideas/01M67XYR798HDDWP6A41CPD5MQ/outer/inner/ideal/TaskType.md
[messages]: ../../.silvermoon/ideas/01M67XYR798HDDWP6A41CPD5MQ/outer/inner/ideal/Messages.md
[ui]: ../../.silvermoon/ideas/01M663BC641JV531CXWN5WD2AG/outer/inner/ideal/Idea.md
[ui-requirements]: ../../.silvermoon/ideas/01M663BC641JV531CXWN5WD2AG/outer/inner/ideal/Requirements.md
[assets]: ../../.silvermoon/ideas/01M66N2BDVY4B6VAHVEEVB94EW/outer/inner/ideal/Idea.md
[regulate]: ../../.silvermoon/ideas/01M65APBJ0WQ9VNWNZPN3BGJAQ/outer/inner/ideal/Idea.md
[cleanup]: ../../.silvermoon/ideas/01M6971AA225V1KGH88D2PCXC6/outer/inner/ideal/Idea.md
