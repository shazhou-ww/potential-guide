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
请求、响应、事件及恢复记录的完整 JSON 对照见
[关键数据结构 Before / After](./request-data-examples.md)，其中 After 的具体字段名均为草案。

## 1. Request：统一资格时间与系列身份

Request 携带 `eligible_at`、`recurrence` 和可选 `series_id`，成功受理后形成 Task 的
调度属性；生命周期、pending 位置及系列归属属于 Task，不属于 Artifact。

| 修改点 | Before | After |
|---|---|---|
| 接收时间 | Check/Probe 快照提供 `acceptedAt`，受理时即启动准备。 | 新设计由服务端记录 `received_at`，无需保留旧字段别名。 |
| eligible | Check/Probe 无独立资格时间；Coordinator 已有可选 `eligibleAt`。 | 所有任务请求可指定 `eligible_at`，省略时等于服务端 `received_at`；可早可晚。 |
| timeout | Check/Probe 总期限从受理起计。 | `deadline_at = eligible_at + timeout`，准备/排队晚于 eligible 的部分也消耗预算。 |
| freshness | Check/Probe 以受理序号作为强/弱新鲜度边界。 | 强条件为 `started_at > eligible_at`，弱条件为 `completed_at > eligible_at`。 |
| 身份边界 | Check/Probe 使用幂等键识别重复创建调用，另有 Task ID；旧讨论曾将二者混用。 | Request ID 就是幂等 ID，Task ID 独立分配；Request 解析/准入失败可以不产生 Task。 |
| 实体与传输 | HTTP 幂等键与 Task 跟踪分开，示例未明确完整 Request 实体。 | Request 实体必含 requestId；HTTP 从 header 还原同一个值，解析错误也按它审计。 |
| ID 格式 | 现有生成型身份包含 UUID/任意幂等字符串。 | 新 Request、Task、Series、Execution、Observation、Invocation、Host instance 身份统一用规范 ULID。 |
| series | Check/Probe 没有独立系列属性；Coordinator 用 predecessor 链表示 recurrence。 | 输入 `series_id` 可选，首个 Task 默认以自身 Task ID 为 series ID；后继 Task 继承同一 series。 |
| 后继身份 | Coordinator 已有确定性后继引用，Check/Probe 没有递归需求生成。 | 每轮新 Request/Task 身份，继承 series ID；重试和恢复不重复分配同一轮。 |
| Probe bindings | 当前输入 bindings 同时可固定根 Objective 与运行时依赖，旧示例重复传入根 digest。 | 普通 Probe 只提供根引用，不再重复传根或静态 Checker bindings；动态依赖选择由服务记录。 |
| Regulation Objective | 当前 Coordinator 调用输入需要完整 PilotSpec；其存储元素另用 targetKey/objectiveRevisionKey。 | 调用方输入改为与 Probe 一致的 `objective: {url, digest?}` 加 subject；服务解析后再构造内部定义与存储引用。 |

**调用输入对称：** Check 用 `checker: {url, digest?}`，Probe 与 Regulation
都用 `objective: {url, digest?}`。不让 Regulation 调用方提前物化 Objective、
填数据库 key 或重复提供 manifest/locales/runtime evidence。
desiredLevel、priority 等治理特有需求保留，内部 Coordinator 表示不必与公开输入同形。
这属于既有治理入口的 admission 演进，不扩展为新 Regulation HTTP 服务，
也不因引用同形就假定 Agent 执行可以按 Check 的规则共享。

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

## 2. Task：增加 PENDING，取消只作用于 PENDING

| 修改点 | Before | After |
|---|---|---|
| 生命周期 | Check/Probe 为 accepted/preparing/waiting/running 等状态，无 PENDING。 | 所有 Task 增加 PENDING，表达已受理、尚未激活的计划需求。 |
| 准备进展 | 受理后即可进入 preparing。 | 正式 PREPARING 只能在 eligible 后；提前下载/更新检查仅是 PENDING 中可观察的预优化。 |
| 取消 | Check/Probe 可撤销非终态需求；Coordinator 有 request/recurrence scope。 | 新统一交互只取消 pending Task，不提供“取消 recurrence Task”或另一个系列取消语义。 |
| 重复规划 | 没有跨 Check/Probe 的统一系列去重。 | 冗余新 pending Task 被取消，已有 pending Task 保留；记录明确原因。 |

**已确认：** 用户取消的是被保留的 pending Task；它不能再触发后继，递归链由此停止。
取消冗余 pending Task 不影响原计划。已经运行的 Task 不被该操作取消，
也不能因一个需求被撤销而终止仍服务其他需求的共享 Execution。

默认 eligible 等于 received 时 PENDING 可以短暂，但不能在持久化、幂等或订阅时丢失。
取消与激活/规划必须原子裁决；如果目标已经离开 PENDING，不能成功返回却实际取消另一轮。

**设计边界：** 这是全新的统一生命周期，不承诺兼容旧 Check/Probe 或 Coordinator。
旧取消行为只留在 Before 中，旧入口兼容与数据迁移不属于本次设计要求。
内部超时、服务关闭、父观察失去 owner 时的资源清理仍需保留，
它们不是公开的“单轮运行中取消”能力。

**已确认状态顺序：**

```text
PENDING → 到达 eligible → PREPARING → 等待/执行 → 终态
```

到 eligible 即可原子激活 Task 并释放 pending 槽位，不需要预优化先完成；
正式准备未完成则在 PREPARING 继续，消耗原 eligible 锚定的预算。
预下载/更新失败可提前报告，但优化失败不直接把 pending Task 终结，
正式 PREPARING 再依据成果及 fallback 策略判定准入。
Request 自身解析失败没有 Task，与 Task 正式准备失败分开。
已过 deadline 的 Task 直接以超时终结，不为了经过 PREPARING 而执行无效工作。

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
| `eligible`（推荐默认） | 本轮资格边界到达并原子消费该轮规划权 | 本轮 `eligible_at + period` | 固定周期；可有重叠需求，再按 freshness 共享 Execution。 |
| `terminated` | 本轮 Task 正常完成、失败或超时终结 | 本轮 Task `terminated_at + period` | 本轮结束后间隔；失败不切断系列，自身递归轮次不重叠。 |

两种模式每轮都只采用一个锚点，不能 eligible 触发一次、终结再触发一次。
terminated 锚点是 **Task 的终结时间**，不是共享 Execution 的完成时间；
一个 Execution 可供多个系列使用，不能据此额外生成请求。
terminated 是终结范畴，不抹去 completed、failed 和超时原因的区别。
正常 completed 不等于业务通过；有效“不达标”观察也属于 completed。
**取消 pending 例外：** 用户取消和冗余规划取消都会撤销该 Task 的后继规划权，
不能因 cancelled 也是终态就生成下一轮；它们不影响原有其他 Task。

例如周期 10 秒、首轮 eligible 为 0 秒、Task 在第 25 秒完成：
eligible 模式的后继资格为 10、20、30 秒；terminated 模式下一轮为 35 秒，
无论第 25 秒本轮是正常完成还是失败终结。
eligible 模式中，第 10、20 秒的需求在版本/输入等兼容时可用 completed_after
加入同一执行，不能据此承诺所有轮次必然合并或每个叶子都新。

eligible 模式应按资格节拍推进，不随实际 worker 开始时间漂移；
它在本轮激活时规划后继，不能等正式 PREPARING 成功才续作。
后续失败/超时不再重复触发同一后继。过期 Task 未实际进入 PREPARING 时，
仍需一次性处理该轮资格和后继规划，不以超时停止系列或生成两次。

**已确认错过周期规则：** 一个早已 eligible、尚未处理的 Task 仍只代表一次资格；
不按错过的周期批量补建，也不反复生成过去 eligible 的后继变相追赶。
处理一次后仅安排一个未来后继。原 `eligible_at + timeout` 已过时该轮超时终结，
不重置预算来强行执行；系列继续安排未来轮次。
后继保持原节拍的下一个未来点，还是从本次处理时刻加周期，稍后细化。

terminated 模式运行期间可能没有 pending Task，届时没有可取消的 pending 对象；
本草案不暗中增设 cancel-series 接口，是否需要提前保留未定 eligible 的后继仍待讨论。

## 4. 服务配置与制品准备：提前量及可观察的版本回退

| 修改点 | Before | After |
|---|---|---|
| 配置归属 | 当前服务没有统一提前量/fallback 配置，先前草案例子误放在 Request。 | preparation policy 属于服务配置，不是调用方请求参数。 |
| 启动时机 | 接收 Check/Probe 后立即开始来源确认。 | 默认不预取，到 eligible 后正式准备；服务配置了预取才按 eligible 减提前量安排优化。 |
| 提前收益 | 立即确认准确内容，但未来任务可能很早固定旧版。 | 既提前发现错误、下载预热，又避免必然提前整个递归周期固定版本。 |
| 新版失败 | 来源/下载/验证失败使准备失败，没有选版 fallback。 | 可配置选版 fallback：更新失败或新候选不可用时使用仍可用的准确旧版。 |
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
| 恢复身份 | Host instance 用于识别服务重启。 | 保留 Request/Task/series 身份，另记录新的 Host/执行尝试身份。 |
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
| 进展 | level、invocation、依赖关系及子 Task/Execution。 | 增加 PENDING、准备/回退、重复规划取消与恢复信息。 |
| 重连 | 当前有界快照，不重建 Task、不重放全部中间事件。 | 动态系列快照与后续轮次连续可观察；不能把增加过滤宣称为无限历史回放。 |

series 订阅不能只在订阅时展开为现存 task IDs；首次快照与后续创建之间不能漏事件。
授权仍按拥有者/作用域校验，不能因猜到 series ID 跨权限读日志。
同一 Execution 可服务多个 series，事件投影不得泄露其他系列的 subject/context。
单轮 result 仍返回该 Task 的结果；系列持续观察不应伪装成一个永不结束的单轮 result。
过滤组合、保留游标、历史分页和容量限制在实施契约明确。

## 当前评审焦点

已确认方向包括 Request 字段归属、可前后调整的 eligible、统一时间锚点、
默认 series 身份、唯一 pending 计划、pending-only 取消、提前准备、
可选选版 fallback、全部未完成 Task 恢复和动态 series events。

本轮已确认 Request ID 与幂等 ID 同义、Task ID 独立、默认 series 为 Task ID、
eligible 后才正式 PREPARING、terminated 包含失败/超时续作，以及错过周期只处理一次。
剩余前序问题：

1. 默认递归锚点，以及 terminated 模式无 pending 时是否需要可停止的预留计划。
2. 错过周期后下一个未来点的选法、服务预优化限额、旧版选择与陈旧上限。
3. series 跨模块作用域，是否需要独立的调用方动态依赖固定能力。

中断 Execution 与持久化恢复细节待上述问题解决后再讨论。

这些是显式待决项，不从此前的聊天建议、旧测试成功或 Agent 勾选推断为已接受。
