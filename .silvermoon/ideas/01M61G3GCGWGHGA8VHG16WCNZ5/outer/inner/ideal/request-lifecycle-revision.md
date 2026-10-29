# Request 生命周期修订：按对象排列的 Before / After

## 修订范围与阅读约定

这是 2026-10-29 对当前 idea 的新 Ideal 草案，不是另建一个已批准的 idea。
Before 以本地候选提交 `127666e4ec04` 为基线；该提交通过的实现和部署实验
不证明本次新增需求已实现。本次只修订设计，不改变代码、历史 schema 或生命周期事件。
本次是一套全新、不兼容的设计，不提供旧协议兼容层或别名；
Before 仅作变化对照，不构成新设计对旧输入、旧存储或旧 SDK 的兼容承诺。

仅列实际变化，按 Request → Task → Series/递归规划 → 制品准备 →
Execution → 持久化恢复 → Events/SDK 的修改对象顺序组织。
字段使用讨论中的概念名，不提前承诺新 wire schema 的版本、大小写或 SDK 签名。
各节区分已确认方向与待确认建议；本文件为 [Idea.md](./Idea.md) 的 supporting document，
不是第四份契约。[objective-service.md](./objective-service.md) 保留组合观察的其余设计。
请求、响应、快照通知及恢复记录的完整 JSON 对照见
[关键数据结构 Before / After](./request-data-examples.md)，其中 After 的具体字段名均为草案。
事件定义、命名变化、归约原则及历史事件示例独立见
[事件与快照投影](./event-projection-model.md)。
判定树、重叠解锁过程、语义分类与事实继承的独立说明见
[任务状态模型](./task-state-model.md)。本次过程分组和原子失败分类以该文为准。

## 1. Request：统一资格时间与系列身份

Request 必含 requestId 与操作 type，并可携带 `eligible_at`、`recurrence` 和 `series_id`，成功受理后形成 Task 的
调度属性；生命周期、pending 位置及系列归属属于 Task，不属于 Artifact。

| 修改点 | Before | After |
|---|---|---|
| 接收时间 | Check/Probe 快照提供 `acceptedAt`，受理时即启动准备。 | 新设计由服务端记录 `received_at`，无需保留旧字段别名。 |
| eligible | Check/Probe 无独立资格时间；Coordinator 已有可选 `eligibleAt`。 | 所有任务请求可指定 `eligible_at`，省略时等于服务端 `received_at`；可早可晚。 |
| timeout | Check/Probe 总期限从受理起计。 | `deadline_at = eligible_at + timeout`，准备/排队晚于 eligible 的部分也消耗预算。 |
| freshness | Check/Probe 以受理序号作为强/弱新鲜度边界。 | 强条件为 `started_at > eligible_at`，弱条件为 `completed_at > eligible_at`。 |
| 身份边界 | Check/Probe 使用幂等键识别重复创建调用，另有 Task ID；旧讨论曾将二者混用。 | Request ID 就是幂等 ID，Task ID 独立分配；Request 解析/准入失败可以不产生 Task。 |
| 实体与传输 | HTTP 幂等键与 Task 跟踪分开，示例未明确完整 Request 实体。 | Request 实体必含 requestId 与 type；HTTP 从 header 还原 requestId，type 留在 body，解析错误仍按合法身份审计。 |
| 操作类型 | 草案依赖入口或 checker/objective 字段形状区分请求。 | type=check/probe/regulate 为必填协议判别字段，脱离入口仍能识别请求；不属于业务自定义载荷。 |
| ID 格式 | 现有生成型身份包含 UUID/任意幂等字符串。 | 新 Request、Task、Series、Execution、Observation、Invocation 等生成型身份统一用规范 ULID；公共 Task 不暴露 Host instance。 |
| series | Check/Probe 没有独立系列属性；Coordinator 用 predecessor 链表示 recurrence。 | 输入 `series_id` 可选，首个 Task 默认以自身 Task ID 为 series ID；后继 Task 继承同一 series。 |
| 后继身份 | Coordinator 已有确定性后继引用，Check/Probe 没有递归需求生成。 | 每轮新 Request/Task 身份，继承 series ID；重试和恢复不重复分配同一轮。 |
| Probe bindings | 当前输入 bindings 同时可固定根 Objective 与运行时依赖，旧示例重复传入根 digest。 | 普通 Probe 只提供根引用，不再重复传根或静态 Checker bindings；动态依赖选择由服务记录。 |
| Regulation Objective | 当前 Coordinator 调用输入需要完整 PilotSpec；其存储元素另用 targetKey/objectiveRevisionKey。 | 调用方输入改为与 Probe 一致的 `objective: {url, digest?}` 加 subject；服务解析后再构造内部定义与存储引用。 |
| 任务前置条件 | 现有 Coordinator 没有这里定义的 prerequisites Check 集合。 | 任意抽象 Task 统一支持 prerequisites；当前仅 Regulation Request 接受，Check/Probe Request 暂不接受，不写入 Objective 制品。 |

**Request 操作判别：**

| type | 操作 | 制品引用与入口校验 |
|---|---|---|
| check | 执行检查 | checker 引用，不接受 objective 或治理专属字段 |
| probe | 观察目标现状 | objective 引用，不接受 checker 或治理专属字段 |
| regulate | 治理目标 | objective 引用，按治理契约处理 desiredLevel/priority 等字段 |

type 统一使用动词；不接受 checker/objective/regulation 等替代字面值。
它选择对应的输入 schema、执行适配器与权限校验，不是调用方自授治理权限。
缺失、未知类型及不匹配的引用/字段须显式拒绝，不能通过字段存在性推断或静默改写。
若有专用路由或 SDK 方法，其操作与实体 type 必须一致；进程内调用也使用完整实体。
本次不因此新增统一 dispatch endpoint 或 Regulation HTTP 服务。

原始 Request 查询和恢复输入保留 type；幂等请求比较包含 type，
同一幂等身份换 type 是冲突，不能以 type 分区绕过冲突创建另一类 Task。
递归后继继承原 type；前置检查产生的独立 Request 明确为 check，
Coordinator 为治理依赖另建的 Request 则为 regulate。
prerequisites 的 Checker/subject 条件声明本身不是完整 Request，不给它机械补 requestId/type。

执行兼容/共享判定必须区分操作类型，probe 与 regulate 即使引用相同 Objective、
输入和时间约束也不得因此混用 Execution；同类型仍须满足原有全部兼容和权限约束，
不因增加 type 而开放有副作用的治理执行共享。
Snapshot 本轮不重复增加 type，按 requestId 查询原始请求；
Request.type 与事件 envelope.type 分别表示操作意图和已发生事实，不相互替代。
body 解析失败时不伪造类型；合法 header 中的 requestId 仍先行用于错误审计。

**模型与入口分开：** 撤回“prerequisites 仅属于 Regulation Task”的模型限制，
所有 Task 使用相同的条件层与原子状态，包括 blocked 和 readiness_failed。
当前 Check/Probe Request 不支持携带 prerequisites，因此这些入口不会生成带条件任务；
这是暂时的 admission 策略，而不是探测类 Task 的结构特例。Regulation Request 可声明条件。
这里“任何时候可以探测”不取消显式 eligible、准确制品准入、授权和资源约束。
Check 的结构化动态 requirements 及 Probe 的动态依赖观察仍保留，
它们是探测发现的业务需求，不是探测自身的启动条件。

**调用输入对称：** Check 用 `checker: {url, digest?}`，Probe 与 Regulation
都用 `objective: {url, digest?}`。不让 Regulation 调用方提前物化 Objective、
填数据库 key 或重复提供 manifest/locales/runtime evidence。
desiredLevel、priority 等治理特有需求保留，内部 Coordinator 表示不必与公开输入同形。
这属于既有治理入口的 admission 演进，不扩展为新 Regulation HTTP 服务，
也不因引用同形就假定 Agent 执行可以按 Check 的规则共享。

**业务输入边界：** 沿用 subject 与已有的可选 context，不另加重复 input 或 metadata。
subject 和各 prerequisite 的 subject 按对应业务/Checker 契约校验；
context 是有限 JSON 执行上下文，不是权限授予或任意审计信息容器。
影响执行的业务参数须参与相应的兼容/共享判定，不因字段可扩展就忽略其行为影响。
引擎不根据这些对象的字段名推导业务治理关系，载荷边界统一见
[事件与快照投影](./event-projection-model.md)。

**已确认绑定边界：** Objective 的准确 digest 已固定其声明的 Checker URL/digest，
这部分 Merkle DAG 不需要调用方再传一份绑定。运行时 Checker 提出的其他 Objective
需求不属于根定义中的静态边，因此根 digest 不一定固定这些动态 Objective 的版本。
服务须记录实际解析的准确动态依赖；是否允许调用方显式固定它们另议，
若提供独立能力可称 `dependencyBindings`，本次不将它直接加入普通 Probe Request。
恢复时是否需要由调用方传回动态绑定，留到持久化讨论，不凭当前实现认定必需。

**已确认：** 所有时间按服务端时间域解释，客户端时钟不能裁定 freshness。
向未来调整只延迟执行资格；eligible 前的等待不消耗 Task timeout。
向过去调整不表示倒流执行，已经过去的预算不退还，也不保证缓存保留足够久。
准确版本确认后，可以匹配仍被保留、满足该时间边界及其他兼容条件的旧 Execution。

**建议：** 接收时 deadline 已过，记录可观察的过期终态，不启动执行；
具体受理响应与错误码留给实施契约。不使用回退、重启或幂等重试重置这条期限。
持久化绝对时间，进程内等待使用单调时钟；校时、精度相等和跨重启换算必须有测试，
不能仅用毫秒时间戳替换旧序号而丢失默认受理因果关系。

**已确认身份边界：** Request 是一次幂等调用意图，Task 是成功建立的需求实体，
Execution 是实际工作。Request ID 沿用幂等 ID，Task ID 独立分配；
不要求额外再造一个与幂等 ID 不同的 Request ID，也不为失败的 Request 伪造 Task。
相同 Request ID 的重试不能重复创建 Task；同 ID 不同输入仍须报告幂等冲突。
后继有新的 Request/Task ID，但不能以新 Task ID 覆盖继承的 series ID。
pending 中保存的是 Task，事件按 series 串联的是 Task；Request ID用于关联原始调用。
HTTP 的 `Idempotency-Key` 承载 Request 实体的 requestId；body 不重复传这个字段，
但服务端实体、审计记录和关联错误响应必须保留它。先校验 header 身份，再解析业务 body；
body 解析失败仍能关联 Request，缺失或非法 header 则不能伪造有效 Request ID。
SDK 在首次发送前生成 ID，网络重试复用同一个值；进程内直接传入含 requestId 的实体。
ULID 使用 26 位规范大写 Crockford Base32，生成型实体之间独立分配；
series 默认复用首个 Task ID 是明确例外。ULID 时间部分不用于 freshness、timeout 或权限裁决。
作者定义的 levelId、problemId、局部 Checker 名称保留可读语义；
内容摘要与执行版本明确叫 digest、revision，不叫 ID，也不改成 ULID。

## 2. Task：内驱 stage 与所有非终态的取消

| 修改点 | Before | After |
|---|---|---|
| 生命周期 | Check/Probe 为 accepted/preparing/waiting/running 等状态，无统一资格条件分层。 | 所有 Task 共用时间、制品、前置条件、资源与执行判定树；当前探测入口不带条件，跳过已满足的条件层。 |
| 准备进展 | 受理后即可进入 preparing。 | 正式 PREPARING 只能在 eligible 后；提前下载/更新检查仅是 PENDING 中可观察的预优化。 |
| 取消 | Check/Probe 可撤销非终态需求；Coordinator 有 request/recurrence scope。 | 任意非终态 Task 可取消，不限时间或运行阶段；不等于取消系列，也不保证停止实际执行。 |
| 重复规划 | 没有跨 Check/Probe 的统一系列去重。 | 冗余新 pending Task 被取消，已有 pending Task 保留；记录明确原因。 |
| 快照类型 | ServiceSnapshot 由 state 加大量可选字段组成。 | stage、可选 canceledAt 与累积过程事实；实际 state 由纯函数派生，不输出重复 state 或通用 progress。 |
| 快照时序 | snapshot.revision 按更新递增，用于客户端去重。 | 删除快照 revision，以服务端 timestamp 标明一致事实视图的投影时点；可由时间推导状态，无需制造更新写入。 |
| Host 实例 | Task 快照携带 hostInstance，SDK 以变化判断重启。 | Task 公共契约不携带 hostInstance；路由需要时在外围 envelope 表达，内部实例世代/所有权不暴露为 Task 字段。 |
| 制品数据 | snapshot 内重复完整 artifact/manifest，子 Task 和 SSE 更新也携带。 | 只保留实际选择的 artifactRef（kind、url、digest）；完整定义按准确 digest 单独查询。 |
| 完整证据 | snapshot.evidence 包含运行环境、子 Task 快照和观察过程，与进展事件重复。 | 从 snapshot 移除完整 evidence；通过历史事件 API 查询结构化事实，不维护第二套独立证据模型。 |
| 请求策略 | 旧快照含 freshness，早期新草案还复制 recurrence 和 schedule 包装。 | snapshot 不含请求体/freshness/recurrence；时间约束在顶层，原始 Request 按 requestId 独立查询。 |

**已确认：** 用户可取消目标 Task 的任意非终态；取消撤销它尚未消费的后继规划权，
不因取消本身产生下一轮。已存在的独立后继不回溯取消，取消冗余 pending 不影响原计划。
运行中的 Task 也可终结为取消，但不能因此终止仍服务其他需求的共享 Execution，
也不保证底层工作可中断或既有副作用能撤销。

PENDING 仅表示时间尚未到；因此没有额外 reason，也没有专属 pending 进展对象。
接收时已经 eligible，初始响应就是 preparing 或已满足条件后的更后阶段，
不能为内部调度间隙制造 reason=activation 的 pending。
取消与完成/失败/超时及后继规划必须原子裁决，不能成功返回却实际取消另一轮。
取消生效记录 canceledAt 并冻结当时的 stage，迟到执行结果不改写取消结局。

**设计边界：** 这是全新的统一生命周期，不承诺兼容旧 Check/Probe 或 Coordinator。
旧协议只留在 Before 中，旧入口兼容与数据迁移不属于本次设计要求。
内部超时、服务关闭、父观察失去 owner 时的资源清理仍需保留，
它们与公开的 Task 取消共同遵守 owner 隔离，不等同于保证执行停止。

**已确认状态顺序：** 下列条件层适用于所有抽象 Task。
没有 prerequisites 的任务可跳过条件等待，不伪造一次检查；
当前 Check/Probe Request 准入限制不改变 Task 的统一类型。

```text
时间未到                                   → pending
时间已到，artifacts 未准备好                → preparing
时间已到，artifacts 已就绪，prerequisites 未满足 → blocked
前三项满足，等待执行资源或已预约但尚未开始     → queued
全部条件满足并已关联实际运行的 Execution      → running
```

```text
抽象 Task: pending → preparing → blocked → queued → running
当前 Check/Probe 入口生成的无条件任务: pending → preparing → queued → running
```

这是条件合取的优先级投影，不是强制串行工作流。优先报告第一个未满足的条件，
已满足的阶段可跳过；提前获取制品或独立条件检查不改变父 Task 的优先级。
到 eligible 即释放 pending 槽位；制品未就绪进入 preparing，
有条件的 Task 制品就绪但条件未通过进入 blocked，不能因此继续占 pending。
当前 Check/Probe 入口生成的无条件任务制品就绪后可直接进入资源调度，即使业务外部条件并不满足，
也由执行结果报告，而不是停在 blocked。
准备、条件阻塞和排队都消耗同一个 eligible 锚定预算。
预下载/更新失败可提前报告，但优化失败不直接把 pending Task 终结，
正式 PREPARING 再依据成果及 fallback 策略判定准入。
Request 自身解析失败没有 Task，与 Task 正式准备失败分开。
已过 deadline 的 Task 直接以超时终结，不为了经过 PREPARING 而执行无效工作。
终态优先且不反转。运行前需要原子确认所用的就绪证据和资源分配；
条件证据的刷新/失效规则仍待收敛，不把优先级投影当作运行中自动倒退状态的许可。
blocked 只表示 prerequisite 未满足或尚无有效通过证据，不是下载错误或资源不足的泛称。
检查故障必须在条件进展中显式区分，不能伪装成一次业务不通过。

**取消边界：** 判定树只描述无外部控制时的内驱推进，取消是树外控制转移，
但仍属于同一事件事实模型。已终结 Task 不被取消覆盖；重复取消返回原事实。
没有已存在后继时，取消也停止该轮继续规划；已有后继需独立处理，不隐式取消整个 series。
pending 槽位、活跃 Task 计数及调度均按派生 state 判断；
stage=pending 且 canceledAt 已存在的 Task 已终结，不再占用 pending 槽位，
stage=running 且已取消也不再作为 Execution 的活跃需求 owner。

### 2.1 Snapshot：内驱位置、取消事实与累积过程事实

公共基底是 requestId、taskId、seriesId、timestamp、stage，以及可选 canceledAt，
以及顶层 receivedAt、eligibleAt、deadlineAt。不再有 schedule 包装，
不复制 Request 的 freshness/recurrence 或完整请求体。
内驱位置专属信息随当前 stage 切换，不因为未来可能用到就定义成一组全局可选属性。
Snapshot 包含过程事实、stage、canceledAt 与技术 timestamp；不再输出 state。
deriveState(snapshot) 在 canceledAt 存在时得到 cancelled，否则按 stage 得到实际状态；
isFailed/isTerminated 接收完整 snapshot，不能只凭冻结的 stage 判断需求是否仍活跃。
不增加 substate、isFailed 或 isTerminated 等重复语义字段。
记录性字段一旦出现，所有后继快照都必须以相同字段名、路径和值继承，
不能仅因切换 stage 而删除、移位或改值。未发生的事实不补造，不要求所有任务走过全部阶段。

| 类别 | 字段或内容 | 后继快照规则 |
|---|---|---|
| 受理事实与有效时间约束 | requestId、taskId、seriesId、receivedAt、eligibleAt、deadlineAt | 受理后继承，不重新默认或重置；请求策略另查 Request |
| 已成立的过程事实 | preparation.startedAt/completedAt、readiness.satisfiedAt（实际有条件求值时） | 真实发生时增加，之后原名原值保留 |
| 已确认的选择/执行事实 | preparation.artifactRef/language/resolution、allocation.boundAt、execution.executionId/startedAt/completedAt | 一经正式确认就保留，不等到 completed 才重新出现 |
| 终结事实 | canceledAt、termination 的非取消 terminatedAt/lastStage、error/取消诊断、result | 取消冻结 stage，不重复终结时间；非取消终结依其事实投影，结局不反转 |
| 详细过程变化 | 准备步骤、条件求值、临时预约或业务进展 | 在 SSE/历史事件读取，不增加 snapshot.progress 或分散的同义状态容器 |
| 投影元数据 | stage、timestamp | 未终结时根据事实与时间生成；取消时 stage 冻结，timestamp 仍可更新，不强制递增 revision |

准备过程第一次开始即记录 preparation.startedAt，后续始终使用同一路径；
它不是进入 preparing 位置的时间。preparation 是事实对象，不随 stage 消失。
成功选版时记录 preparation.resolution，后续各状态必须继承；
未确定时不提前填写，避免随后把“已知事实”改成其他选择方式。

此规则针对 Task 的有界事实摘要，不是把所有过程事件复制进快照。
每次获取/求值的时间、子 Check ID 和未满足条件列表保存在事件中，
不要求把这些集合堆进 snapshot。临时预约目标不等于正式绑定的 execution.executionId；
预约变动要有历史事实，不能把临时目标误当成永久执行身份。
同一 Task 向前推进时，已经确认的 artifactRef 和实际执行关联不得静默换版/换执行。
未来若设计重试或重新绑定，须另有显式模型，不借状态更新覆盖旧事实。

| 状态 | 必需的状态信息 | 不允许作为当前信息出现 |
|---|---|---|
| pending | 身份与整体时间约束，可有提前产生的准备事实 | reason/pending 状态对象、请求策略、实际业务执行或结果 |
| preparing | 已发生的 preparation 事实；尚未实际开始时可无该分组 | 虚构准备开始、当前进展、最终 result |
| blocked | 制品准备事实；详细条件判断另查事件 | 父实际执行或最终 result |
| queued | 已就绪事实，已正式绑定时可有 allocation/execution 事实 | 临时预约详情、虚构实际执行开始或结果 |
| running | 准备/就绪事实、execution.executionId/startedAt | 当前进展、result、termination |
| completed | 所有既有事实、execution 完成、result、termination | 活跃 progress、完整 evidence |
| preparation_failed / readiness_failed / allocation_failed / execution_failed | 路径要求的既有事实与 termination 原因 | 活跃 progress、成功 result 或虚构过程 |
| timed_out / cancelled（控制终结暂定命名） | 所有实际已有事实和 termination | 活跃 progress、未发生的过程 |

具体原子分类与路径约束见[任务状态模型](./task-state-model.md)。
所有抽象 Task 都支持 blocked/readiness_failed 与 readiness 过程，
当前 Check/Probe Request 不携带条件不意味着应从 Task 协议中删掉这些类型。
termination.lastStage 仅用于非取消终结前的诊断位置，不用它替代失败过程分类；
取消场景的 stage 已冻结，不再重复该字段。
尚未执行不能出现虚构 Execution；执行后的任何终结必须保留真实关联和所有已有事实。
Check 的 running 可以没有自定义 progress；Objective 的最终观察进展如需保留，
作为结构化历史事件按需查询，不塞进快照 evidence 或 progress。

核心过程和二级事实字段统一为 preparation/readiness/allocation/execution。
preparation 专指 artifacts 准备，fetch 只是其子步骤；readiness 求值 prerequisites，
未就绪时状态为 blocked；allocation 分配执行机会（含共享执行匹配），等待时为 queued。
Request 的 prerequisites 声明不改名；顶层时间约束和 termination 仍承担其他职责。
时间资格只由投影时间与 eligibleAt 比较，不定义 eligibility 过程、快照分组或资格通过事件。
prefetch 只表示提前执行 fetch 的优化，
不再是顶层公共快照对象。pending 可以携带已经成立的 preparation 事实，
但不携带 preparing 的当前进展；提前获取的变化可通过
单独的优化事件/诊断证据观察，其具体 envelope 尚待定义。
提前获取的详细变化通过事件报告；preparation.startedAt 是实际过程开始时间，
允许早于 eligible。未取消的 stage 由事实与时间投影，不强制为纯时间推进写 transition 事件，
也不把过程时间当作状态切换时间。

终态保留从前序继承的全部记录性事实，增加终结结果，移除当前阶段进展。
preparation.resolution=fallback 让调用方立即知道发生了回退，
所选版本在 preparation.artifactRef；完整采用原因、旧版来源和更新错误进入历史事件，
不能为了删除 evidence 而隐去回退错误。详细变化不整份复制到 completed。
若 Task 最后记录为 pending，重新观察时已过 deadline，示例暂用 timed_out，
非取消终结的 termination.lastStage=pending 不表示现在仍是 pending，也不伪造执行。
termination.terminatedAt 不证明曾经 running，控制终结不得全部塞进 execution。

移除 hostInstance 不等于删除内部安全仲裁。服务内部仍需防止旧实例迟到写入，
确保恢复后同一 Task 身份和已成立事实连续；不靠 hostInstance 或快照 revision 判断业务连续性。
本次不定义新的路由 envelope 或持久化机制，恢复细节继续暂缓。
JSON Schema 必须使用互斥分支校验必需/禁止字段，与 SDK 的 discriminated union 一致；
仅提供 TypeScript union 而 HTTP 仍接受跨状态混搭，不算满足该设计。
还须校验相邻快照：前序事实叶子路径集合必须包含于后继，叶子值相等且路径一致，
timestamp 可更新，stage 仅在未终结时继续投影；canceledAt 与取消时 stage 必须继承。
snapshot 不存在 progress 或独立 state。单个 snapshot 通过 schema
不等于转移合法；SSE 跳过中间状态时，后到完整快照仍须继承此前已知事实。
测试覆盖成功、失败、超时、取消及恢复查询，独立假设分支不得拼接成一条时间线。
timestamp 对应实际投影时间和一致事实视图，不是旧内容的发送时间；
相同 timestamp 不能视为重复，跨服务墙钟不能提供严格全序。
异步读取与 SSE 交接需要明确协议，不以响应到达顺序当成事实先后。

**轻量制品引用：** After snapshot 不再内嵌完整 artifact 或 artifacts，
不重复 manifest、subjectSchema、文档索引等大对象；preparation.artifactRef 暂定为
`{kind, url, digest}`，表示本 Task 实际选中的准确内容。未正式选定时不伪造引用，
blocked/queued/running/completed 等已就绪分支必须带准确引用。
完整元数据调用方按这个 digest 从授权 Artifact 查询/resolve API 读取并缓存；
不能重新解析浮动 URL 的 latest 来替代 Task 的准确版本。准确内容已不可查询时
应明确报告不可用，不回退返回其他版本。
实际 runtime、worker revision、依赖执行和 fallback 决策仍属于执行证据，
不能通过重新查询 Artifact 定义替代。它们由结构化历史事件提供，
父 Task 不再嵌入子 Task 快照；调用方沿 taskId/executionId 的关联查询。
snapshot、SSE 内的 snapshot 及独立查询到的子 Task 都遵守同一轻量状态联合。

**同一事实不在一个响应内重复表达：**

| 修改点 | Before | After |
|---|---|---|
| Probe 结果身份 | result.current.objective 与根 bindings 重复根 Objective 版本。 | 根身份由外层 artifactRef 表达；result.current 只保留 levelId，动态解析详情从历史事件查。 |
| 机械结果摘要 | gapSummary 仅由 problems 数量派生，空结果为空字符串。 | 从新结果契约移除，展示层按 problems 生成；不据此删除有独立业务含义的问题信息。 |
| 快照通知 | task.updated 外围与 snapshot 内各自重复 taskId/requestId/seriesId。 | 完整快照通知只需事件 type 和 snapshot，身份在 snapshot 保留一处，游标等事件属性另属 envelope。 |
| 结果事实 | 早期新草案例子同时在 task.terminated 与 execution.completed 保存相同 result。 | 结果事实由 Execution 保存；Task 终结引用该执行，读取快照时投影 result。 |

业务 result 是相对于所属 Task/Execution 上下文的结果；不能再重复根制品定义。
但问题或依赖需求若指向其他 Objective，仍须保留那个目标的准确引用，
不能为了去重丢失业务指向。observedAt、execution.completedAt、termination.terminatedAt
分别是观察、执行完成、需求终结时间，不因为接近就机械合并。
requestId 与 taskId 不同，默认 seriesId 与首轮 taskId 相同也不意味着可以删除 series。
Check 的 ok 与 problems 是结果契约，不把其一致性约束当成无意义的重复字段。

输入与读取投影可在不同接口重复返回同一个值，但必须明确唯一事实源。
snapshot 不嵌入 Request，原始 requestId 实体通过独立授权查询取得；
freshness/recurrence 留在 Request，seriesId 作为实际关联事实保留在 Task。
时间输入省略时，Task 中的有效值可以由服务计算，但不将默认值反写到原始 Request。
解析失败可能没有 Task 或完整业务实体，仍应保留合法 Request ID 及可审计的错误，
不能依赖 Task snapshot 才能追溯这个请求。查询形状与保留期不在此预先定死。
Series 的 pendingRequestId 可由 pendingTaskId 对应的 Task 取得；
latestSuccessor/generation 如保留，只是规划事实的可重建索引。
恢复例子中的 Request 是不可变输入，cachedSnapshot 是派生缓存，
外层不再重复三个身份；缓存不得作为可独立修改的第二份调度事实。
这些只收敛逻辑职责，不在此提前决定持久化事务、物理索引或缓存布局。

### 2.2 Task prerequisites：统一模型与当前入口限制

| 修改点 | Before | After |
|---|---|---|
| 声明位置 | 早期曾将静态 prerequisite 放在 Objective；当前候选已移除，仍有业务运行时依赖需求。 | 所有抽象 Task 可有 prerequisites Check 集合；当前只有 Regulation 请求入口接受其声明，不改变制品 digest。 |
| 条件表达 | 旧 origin 的 dependency 只说明需求产生原因，不是完整条件谓词。 | 用 Checker 引用与 subject 表达条件，初版采用所有 Check 通过；Objective 达到某 level 是一种 built-in Checker。 |
| 不满足 | 原候选未提供统一的 Task 条件阶段。 | 时间与制品就绪后保持 blocked 并记录检查结果；Checker 可返回结构化 Objective/subject/expectedLevelId 需求，不能靠自由文本猜治理规则。 |
| 唤醒 | Coordinator 已有依赖记录，但没有通用前置 Check 条件模型。 | 调度层维护等待方引用和反向索引，相关事件仅触发重新求值，不直接把等待方改为可运行。 |
| 来源审计 | origin 包括 external、dependency、recurrence。 | 服务继续记录创建因果，按独立 Task 身份关联父/前驱；不把 origin 等同于 prerequisites，也不要求外部伪造内部来源。 |

**条件求值（统一 Task 模型）：**

```text
可离开 PENDING = now >= eligible_at（超时/终态另先行处理）
可进入资源调度 = now >= eligible_at 且 artifacts 已就绪
             且 prerequisites 中所有 Check 得到有效通过结果
             且 now < deadline_at
deadline_at = eligible_at + timeout
```

省略或空集合没有额外条件。condition 不写回 eligible_at，也不推迟或刷新 deadline。
当前 Check/Probe Request 不允许传入 prerequisites，即使空数组也不作为扩展接受，
应报告不支持字段，不能忽略后制造“条件已受理”的假象。
Request 准入能力与 Task 状态模型分别校验：所有 Task 共用完整判别联合和语义分类，
不能按 checker/objective 类型拒绝抽象模型合法的 blocked/readiness_failed。
不新增绕过准入限制的外部接口；内部若建立有条件任务，也须经授权并遵守统一模型。
eligible 后等条件、检查以及依赖治理所花的时间消耗该 Task 的剩余预算。
timeout 是时长，deadlineAt 是 Task 截止时间，不是 Request 或结果记录的失效日期。

- Check 有效 `ok: true` 表示该条件通过，不等于其他条件都通过。
- 有效不通过并带 requirements，提供可治理目标；不带 requirements，则只说明条件未满足。
- Check 执行失败是无法判断的故障，必须显式记录，不得冒充业务不满足或条件通过。
- 治理是否启动由 Coordinator 按权限、预算和策略决定；Checker 返回需求不是授予权限，
  不把 Agent 调度职责搬进 Checker/Objective Host。
- 依赖 Regulation 结束后必须重新执行条件 Check；治理结束、甚至目标曾经达标，
  都不能直接替代整个条件 Check 的有效通过结果。

业务依赖的解释与治理编排属于 Coordinator，不通过通用 Execution 的子 Task 关系建模。
Probe 的调用关联是 execution.progress 中的业务事实，不能自动成为 prerequisites 或调度指令。
已终结的 Regulation 若返回未满足的 requirements，Coordinator 可创建新的带条件 Request；
仍在 readiness.blocked 的原 Task 则待条件通过后继续，不复活终态或制造重复需求。
readiness 的通用判定/检查引用与 Check 自己的业务输入、progress/result 分开，
不在 readiness 再复制一份自定义业务结果。

**子任务与所有权：** prerequisite 检查拥有独立 Check Task；父 Task 尚在 blocked
不能阻止这些 Check 自己进入准备/执行。当前子 Check 创建请求不带 prerequisites，
不会自动继承父条件，避免把前提循环施加到探测本身而自锁；
抽象 Task 支持条件不意味着服务必须给每个子任务附加条件。
子 Task 的 requestId/taskId 独立分配，默认 series 为自身 Task ID，
通过服务端的父 Task/条件项关系关联，不占用父 series 的 pending 槽位。
父 Task 取消/超时后应释放自己拥有的检查、订阅和依赖需求；
共享执行仍有其他 owner 时不得一起终止。等待关系需要循环检查和有界资源预算。

**证据与待定策略：** 记录条件项、Check Task/Execution、准确来源、结果与求值时间。
freshness、通过证据有效期、多个条件是否需在同一窗口有效，以及无依赖事件时如何重查
仍须明确，不把一次历史通过当作永久许可。首次检查是否可早于父 eligible 也待确定；
无论何时检查，父 Task 不得早于自己的 eligible 激活。
本次不实现任意条件表达式语言或 all/any 嵌套树，也不恢复 Artifact 静态 prerequisite。
收窄 prerequisites 不删除 CheckerResult.requirements。条件 Check 可以返回正常不通过
及结构化目标，普通 Check/Probe 也可以发现动态依赖；这些执行中的业务语义不被
重解释为其 Task 必须先进入 blocked 才能执行。

## 3. Series 与 recurrence：一个 pending Task，两个锚点

| 修改点 | Before | After |
|---|---|---|
| 适用面 | Coordinator 有 recurrence；Check/Probe 没有。 | Check、Probe、Regulation 都可表达递归请求，调节职责仍归 Coordinator。 |
| 现有周期 | Coordinator 首次 dispatch 时生成后继，eligible 为实际 dispatch 时间加 interval。 | 新模型明确 eligible/terminated 锚点，不把 dispatch、资格和终结混为一谈。 |
| pending 约束 | 没有统一 series pending 唯一约束。 | 同一系列同时最多保留一个 pending 计划；重复新计划取消，原计划不被替换。 |
| 触发配置 | 不支持统一的双锚点选择。 | `recurrence.anchor` 区分 eligible 与 terminated；本轮失败/超时不停止递归。 |

### 3.1 已确认的规划不变量

- “一个 pending”不等于“一个未完成 Task”。旧轮可以执行中，下一轮可以 pending。
- 原子保留已有计划，冗余新计划以独立 Task 终态记录取消；不能先覆盖旧计划再回滚。
- 同一轮的后继最多生成一次，重启、重复事件、重试不能多生后继。
  可以使用前驱/轮次等持久证据，不预先规定数据库实现。
- 互斥必须限定授权范围；推荐同一拥有者/调度域内的 series。
  跨 Check/Probe/Regulation 共用同一 series 的作用域与冲突规则须在协议中明确，
  不承诺跨独立 Host 的分布式锁。
- series ID 不进入执行兼容键。不同 series 仍可共享执行；
  相同 series 的不同准确版本或输入也不能强制合并。

### 3.2 已收敛的锚点：`recurrence.anchor`

用户确认本轮结束必须涵盖 failed/timeout，因此以 terminated 取代原草案的
completed 锚点；周期任务顶层名称统一为 `recurrence`，与动态依赖递归区分，
period 单位、其他字段拼写及默认锚点仍属于 wire 设计：

```text
recurrence:
  period: 正的有限时长
  anchor: eligible | terminated
```

Before 保留旧形状以便对照；新设计虽然沿用 recurrence 命名，
不承诺旧子结构兼容，不需要为旧协议限制新双锚点的设计。

| 候选参数值 | 规划触发 | 下一轮 eligible | 主要效果 |
|---|---|---|---|
| `eligible`（推荐默认） | 本轮到达时间资格边界、离开 pending 时原子消费规划权，不等待制品/条件就绪 | 保持原节拍，取严格晚于本次规划时刻的第一个周期点；准时处理即 `eligible_at + period` | 固定周期；可有重叠需求，再按 freshness 共享 Execution。 |
| `terminated` | 本轮 Task 正常完成、失败或超时终结 | 本轮 Task `terminated_at + period` | 本轮结束后间隔；失败不切断系列，自身递归轮次不重叠。 |

两种模式每轮都只采用一个锚点，不能 eligible 触发一次、终结再触发一次。
terminated 锚点是 **Task 的终结时间**，不是共享 Execution 的完成时间；
一个 Execution 可供多个系列使用，不能据此额外生成请求。
terminated 是语义集合，不是 snapshot 的第二个 state/substate；
isTerminated 与 isFailed 的成员关系由协议表定义，保留各过程失败与超时原因。
正常 completed 不等于业务通过；有效“不达标”观察也属于 completed。
**取消例外：** 任意非终态的用户取消和冗余规划取消都会撤销该 Task 尚未消费的后继规划权，
不能因 cancelled 也是终态就生成下一轮；它们不影响原有其他 Task。

例如周期 10 秒、首轮 eligible 为 0 秒、Task 在第 25 秒完成：
eligible 模式的后继资格为 10、20、30 秒；terminated 模式下一轮为 35 秒，
无论第 25 秒本轮是正常完成还是失败终结。
eligible 模式中，第 10、20 秒的需求在版本/输入等兼容时可用 completed_after
加入同一执行，不能据此承诺所有轮次必然合并或每个叶子都新。

eligible 模式应按资格节拍推进，不随实际 worker 开始时间漂移；
它在本轮离开 pending 时规划后继，不能等 artifacts 或 prerequisites 成功才续作。
后续失败/超时不再重复触发同一后继。过期 Task 未实际进入 PREPARING 时，
仍需一次性处理该轮资格和后继规划，不以超时停止系列或生成两次。

**已确认错过周期规则：** 一个早已 eligible、尚未处理的 Task 仍只代表一次资格；
不按错过的周期批量补建，也不反复生成过去 eligible 的后继变相追赶。
处理一次后仅安排一个未来后继。原 `eligible_at + timeout` 已过时该轮超时终结，
不重置预算来强行执行；系列继续安排未来轮次。
eligible 锚点的后继保持原节拍，选择严格晚于本次规划时刻的第一个周期点，
不从处理时刻重新加周期而使节拍漂移；恰好落在周期点时选择下一个点，不生成即时追赶轮次。

设本轮资格时间为 e，周期为 P（P > 0），实际规划裁决使用的服务端时间为 t（t >= e）：

```text
k = floor((t - e) / P) + 1
nextEligibleAt = e + k * P
```

这些是计算变量，不是新增 Request 或 snapshot 字段。nextEligibleAt > t，
且它前一个原节拍点不晚于 t；即一次跳过所有已错过的点，不创建被跳过的 Task。
例如 e=03:20:00、P=60 秒，t=03:25:20 时下一轮为 03:26:00，
不是 03:26:20；t 恰好为 03:26:00 时下一轮为 03:27:00。
新 Task 有自己的 eligibleAt + timeout；原 Task 的 eligibleAt/deadlineAt 不重置。

此规则仅在本轮仍拥有且尚未消费后继规划权时计算新的候选。
若已经规划后继，不因本轮稍后超时或重复处理而再生成、重新选点或修改既有 eligibleAt；
已有 pending 的冲突仍按唯一 pending 仲裁保留原项，不借跳过周期绕开幂等与系列约束。
实际 worker 启动、条件就绪或容量可用时间不成为新的周期锚点；
容量不足如何处置仍是独立策略，不把“下一个时间点”解释为预测资源可用时间。

**条件阻塞不再占 pending：** 有条件的 Task 本轮可在 preparing/blocked/queued，下一轮仍可占
唯一 pending 槽位。因此旧草案的“条件等待与后继争夺 pending 槽位”冲突已消除。
同系列可能同时有多个未完成轮次；deadline 和容量限制必须约束长期阻塞的积压，
不能把唯一 pending 当成未完成 Task 总数上限。后继条件继承与容量满时的处置仍待收敛。

terminated 模式运行期间可能没有 pending Task，但可以直接取消尚未终结的当前 Task，
从而撤销其后继规划权；不必为可取消性提前保留未定 eligible 的后继。
本草案不新增 cancel-series 接口，也不把取消当前轮解释为取消已经建立的其他轮次。

## 4. 服务配置与制品准备：提前量及可观察的版本回退

| 修改点 | Before | After |
|---|---|---|
| 配置归属 | 当前服务没有统一提前量/fallback 配置，先前草案例子误放在 Request。 | preparation policy 属于服务配置，不是调用方请求参数。 |
| 启动时机 | 接收 Check/Probe 后立即开始来源确认。 | 默认不预取，到 eligible 后正式准备；服务配置了预取才按 eligible 减提前量安排优化。 |
| 提前收益 | 立即确认准确内容，但未来任务可能很早固定旧版。 | 既提前发现错误、下载预热，又避免必然提前整个递归周期固定版本。 |
| 新版失败 | 来源/下载/验证失败使准备失败，没有选版 fallback。 | 可配置选版 fallback：更新失败或新候选不可用时使用仍可用的准确旧版。 |
| 成功选版方式 | 旧快照没有方式枚举，早期新草案仅有 fallbackUsed 布尔值。 | preparation.resolution 统一为 up-to-date/fallback/updated，成功确定后继承，不与布尔值并存。 |
| 证据 | 准确 digest、来源确认时间、runtime 等。 | 额外记录更新尝试、失败原因、回退决定和实际选择；不能把回退冒充更新成功。 |

**已确认方向：** 提前下载是预优化，递归下一轮可以重新确认浮动来源。
预优化可提前报告来源错误，不必等 eligible 才开始昂贵下载；
它不推进 Task 的 PREPARING 状态，也不赋予执行资格。
Request 只表达 eligible、timeout、freshness、recurrence、series 等需求，
不携带 `preparationPolicy`；Response/Events 仍记录服务实际执行的预优化与准备过程。

**配置预取时的概念名及公式：**

```text
preparation_lead >= 0
planned_prefetch_at = eligible_at - preparation_lead
earliest_prefetch_at = max(received_at, planned_prefetch_at)
formal_preparing_at >= eligible_at
```

提前量不是轮询周期，也不是保证下载完成的时限。周期 10 分钟、提前量 30 秒时，
可以到 eligible 前 30 秒才准备；若请求更晚收到，则尽快开始。
未配置预取时，不在接收时提前选版，到 eligible 后才开始正式准备。
零提前量也不提供提前预取；具体配置字段与限额仍为草案，不是已实现 API。
网络确认是一个过程，不能宣称取得 received 或 prefetch_at 那一瞬间的远端快照。

**fallback 建议边界：**

resolution 的三种成功方式及准确语义见[任务状态模型](./task-state-model.md)：
既有且经确认满足要求为 up-to-date，更新失败后使用旧版为 fallback，
本次获取并验证后使用为 updated。有缓存不等于已确认新鲜；updated 不保证内容摘要变化。
最终选版失败没有 resolution，确认时间和尝试错误仍通过历史事件追溯。

- fallback 同样由服务配置显式开启，默认不回退；它影响执行内容，不能仅当作无语义的预优化。
- 仅浮动选版可退回旧候选；显式 digest、制品内静态绑定及已固定动态依赖不能被替换。
- 旧版必须具有同来源/授权范围的可信准确记录，重新满足 runtime、输入及组合契约。
  “上一版”候选的选择范围、缓存失效/撤销与最大陈旧度还需确定。
- 可处理更新检查、下载、格式/契约验证及执行前准入失败。
  业务检查“不通过”不能触发回退；执行已开始后的异常不自动换版重跑。
- 不得拼出与 Objective 内固定 Checker digest 不一致的混合闭包。
  动态依赖仍遵守准确绑定，不能用 fallback 绕过冲突或来源授权。
- 无可用旧版时明确失败；fallback 不刷新 eligible/timeout，也不扩张权限。

预优化有独立有限预算，不能因 eligible 很远而无限占资源。
预优化早完不得早执行；到 eligible 仍需正式准备时，继续消耗 Task 剩余预算。

## 5. Execution：新的时间边界

| 修改点 | Before | After |
|---|---|---|
| 新鲜度仲裁 | 服务内受理序号 a，与开始 s/完成 c 比较。 | 相对于 eligible 时间边界，并保留服务端因果排序以处理同刻事件。 |
| 旧结果 | 必须满足受理后的 start/completion 条件。 | eligible 设在过去时，接收前完成的保留结果也可能符合要求。 |
| 调度 | 准备后匹配保留、运行或预约执行。 | 额外受 eligible 资格限制，不因提前准备而提前执行。 |

对于未来 eligible 的 completed_after 需求，不能在 eligible 前交付完成结果。
到达资格时可加入兼容运行执行；started_after 仍要求执行开始严格晚于边界。
Before 使用 started-after-request/completed-after-request 字面值；
新设计按 eligible 定义 freshness，独立确定协议字段，不要求兼容别名或历史迁移。

外层 recurrence 不自动使内部每个 Checker 或依赖观察永久递归；
显式子需求的调度仍由拥有它的父执行约束，避免无限扩张工作树。

## 6. 持久化与重启：恢复需求，而非伪造执行连续性

本节保留先前方向，用户要求先收敛身份/状态/递归，崩溃恢复细节暂缓讨论。
本轮仅同步已确认的 Task 身份与状态术语，不新增持久布局或执行重试决定。

| 修改点 | Before | After |
|---|---|---|
| Check/Probe | 进程内有界保留，重启使 Task 不可用，无透明重跑。 | 所有已受理未完成 Task 都需持久恢复，不限 recurrence。 |
| Regulation | Coordinator 已有持久事件/恢复，不是从零建设。 | 增加统一系列、时间和规划证据的持久化与恢复。 |
| 恢复身份 | 公共 hostInstance 用于识别服务重启。 | 保留 Request/Task/series 身份及事实连续性；新读取生成 timestamp，不在 Task 快照暴露 hostInstance 或 revision。 |
| 恢复期限/版本 | 原格式准确恢复与服务内快照分开。 | 原 eligible、deadline、固定版本及 bindings 不变；不得重置 timeout 或追 latest。 |

**已确认：** 所有未完成 Task 的恢复都是范围内需求；跨重启透明执行本身不是承诺。
接收成功应有可恢复事实；选择版本、生成后继和取消都必须能重放而不重复执行状态变更。
尚未完成选版的请求如无准确绑定，恢复不能伪造“此前已固定”的版本证据。

**尚需设计：** 崩溃时 running 的执行如何终结/重试；结果已产生但未持久化的窗口；
依赖任务与父执行恢复所有权；旧制品缓存缺失或环境变化如何报告；
这些尤其影响可能运行 Agent 的 Regulation，不能默认它们都可无副作用重跑。
不承诺 Execution exactly-once、无限历史或跨服务比较客户端时间。

## 7. Events、日志、HTTP 与 SDK：动态追踪整个系列

| 修改点 | Before | After |
|---|---|---|
| 过滤 | Check/Probe SSE 按 taskId 或显式 scope=all 过滤。 | 增加按 series ID 过滤，包含订阅之后新产生的该系列 Task。 |
| 身份 | task.updated 关联 Task 与 Execution，缺少独立系列。 | 请求、快照、日志及事件携带 series，必要时保留前驱/轮次。 |
| 进展 | 快照含 level/invocation 等进展集合。 | snapshot 只保存有界过程事实、stage 和可选 canceledAt，详细进展由结构化 SSE/历史事件读取。 |
| 重连 | 当前有界快照，不重建 Task、不重放全部中间事件。 | 动态系列快照与后续轮次连续可观察；不能把增加过滤宣称为无限历史回放。 |
| 证据查询 | Task 快照内嵌完整 evidence，没有统一可分页的证据事件读取面。 | 增加按 taskId/executionId/seriesId 过滤的历史事件查询和稳定游标分页，证据来自事件事实而非独立 evidence 数据模型。 |

series 订阅不能只在订阅时展开为现存 task IDs；首次快照与后续创建之间不能漏事件。
授权仍按拥有者/作用域校验，不能因猜到 series ID 跨权限读日志。
同一 Execution 可服务多个 series，事件投影不得泄露其他系列的 subject/context。
单轮 result 仍返回该 Task 的结果；系列持续观察不应伪装成一个永不结束的单轮 result。
### 7.1 Snapshot、SSE、历史查询：同一事实的三种读取方式

- snapshot = project(reduce(一致事件前缀), timestamp)，包含适用时的业务结果，没有 progress。
- SSE 是实时状态/进展通知，可输出轻量 snapshot 或结构化事实；
  task.updated 是投影通知，不是 reducer 输入，不能分别维护互相矛盾的真相。
- 历史事件 API 按已有 taskId、executionId、seriesId 过滤，以稳定游标分页。
  不再新增专门的 `/evidence` 模型或 evidenceId；汇总如有需要也从事件投影。

类型变化、纯归约边界、读取一致性和完整事件例子集中于
[事件与快照投影](./event-projection-model.md)，本节不再维护第二份事件目录。

历史必须保存足以追溯的结构化事实，而非只存“正在运行”文字通知：
准确制品选择、fallback 和更新失败、实际 runtime/worker revision、Execution 开始/结束、
结果、Task 与 Execution 关联，以及业务层报告的调用关联和观察进展。
受理、需求取消、制品选择及关联属于 Task 事实；实际运行环境、worker revision 与执行结果
属于 Execution 事实。共享执行只记录一份，通过 executionId 关联，
不因多个 Task/series 使用它而复制多份执行历史。
execution.progress.data.progress、execution.completed.data.result 和失败事件的
data.error.details 是明确的业务载荷位置；引擎固定外壳与生命周期，
各业务协议校验并解释内容，Check 的统一结果约束不因此放开。
progress 不重新进入 snapshot，不构成通用依赖图；
正常返回未满足需求不等于执行故障，自定义详情也不能覆盖外层身份或状态。
正常 Task 终结事件引用 executionId，不重复记录相同执行结果；
Task snapshot.result 由该执行事实投影。Task 特有的结果转换如果未来引入，
须作为独立业务语义定义，不默认所有结果都能无损删除。
没有执行的失败/取消 Task 则记录自己的 error/原因，不虚构 executionId。

未订阅或错过 SSE 的调用方仍能查询历史。SSE 断流或中间快照合并不能被当成
“历史事实没有发生”；快照轻量化也不能删除原本必须保存的执行证据。
历史查询要与实时流明确区分，不把一次历史 GET 误解释为无限 SSE 连接。

### 7.2 游标、关联与权限

历史事件有独立的稳定位置/游标，不使用 snapshot.timestamp、ULID 时间部分或客户端时间代替。
游标是分页位置，不是新业务 ID；snapshot 已无 revision，历史位置也不是快照版本。
分页必须具有明确边界，避免新事件写入时重复、遗漏或无限追赶；
历史接实时的交接点需可表达，具体快照水位、保留期及 SSE 游标续读协议在持久化讨论中确定。

taskId 查询获取该 Task 的事实及相关 execution/child 引用；
executionId 查询读取授权的执行事实；seriesId 查询追踪系列内各 Task 的事实。
过滤组合、是否提供一跳关联展开仍需明确，默认不递归复制整个执行树。
共享 Execution 的可见性必须依据关联授权，不能泄露其他 owner 的 subject/context、
来源能力或全部 Task 成员。分页游标同样绑定查询与授权范围，不作为访问凭据。
已清理、过期游标、找不到对象或无权限必须明确响应，不能返回空历史冒充“从未发生”；
具体错误码、保留期限及存储事务机制留待后续讨论。

## 当前评审焦点

已确认方向包括 Request 字段归属、可前后调整的 eligible、统一时间锚点、
默认 series 身份、唯一 pending 计划、全部非终态可取消与 stage/canceledAt 投影、提前准备、
可选选版 fallback、全部未完成 Task 恢复和动态 series events。

本轮已确认 Request ID 与幂等 ID 同义、Task ID 独立、默认 series 为 Task ID、
eligible 后才正式 PREPARING、terminated 包含失败/超时续作，
以及错过周期只处理一次并按原节拍选择下一个严格未来点。
剩余前序问题：

1. 默认递归锚点；terminated 模式可通过取消当前非终态 Task 停止其后继规划，不再需要为此预留 pending。
2. 服务预优化限额、旧版选择与陈旧上限。
3. series 跨模块作用域，是否需要独立的调用方动态依赖固定能力。
4. 条件证据 freshness/有效期、首次检查与重查策略、后继条件继承及积压容量策略。
5. 取消与完成/失败/超时的同刻原子仲裁，以及超时在内驱模型中的最终挂接方式。

中断 Execution 与持久化恢复细节待上述问题解决后再讨论。
历史事件 API 的具体路径/游标协议、保留期限及 SSE 续读也在该阶段收敛；
当前已确认需要独立历史读取能力，不能因未定持久化细节而退回只靠 SSE 保存证据。

这些是显式待决项，不从此前的聊天建议、旧测试成功或 Agent 勾选推断为已接受。
