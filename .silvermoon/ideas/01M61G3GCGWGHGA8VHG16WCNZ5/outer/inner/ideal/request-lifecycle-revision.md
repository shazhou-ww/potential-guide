# Request 生命周期修订：按对象排列的 Before / After

## 修订范围与阅读约定

这是 2026-10-29 对当前 idea 的新 Ideal 草案，不是另建一个已批准的 idea。
Before 以本地候选提交 `127666e4ec04` 为基线；该提交通过的实现和部署实验
不证明本次新增需求已实现。本次只修订设计，不改变代码、历史 schema 或生命周期事件。

仅列实际变化，按 Request → Task → Series/递归规划 → 制品准备 →
Execution → 持久化恢复 → Events/SDK 的修改对象顺序组织。
字段使用讨论中的概念名，不提前承诺新 wire schema 的版本、大小写或 SDK 签名。
各节区分已确认方向与待确认建议；本文件为 [Idea.md](./Idea.md) 的 supporting document，
不是第四份契约。[objective-service.md](./objective-service.md) 保留组合观察的其余设计。

## 1. Request：统一资格时间与系列身份

新增的 `eligible_at`、`recursive` 和 `series_id` 均属于 Request。

| 修改点 | Before | After |
|---|---|---|
| 接收时间 | Check/Probe 快照提供 `acceptedAt`，受理时即启动准备。 | 服务端记录 `received_at`；与旧 accepted 字段的协议映射显式定义。 |
| eligible | Check/Probe 无独立资格时间；Coordinator 已有可选 `eligibleAt`。 | 所有任务请求可指定 `eligible_at`，省略时等于服务端 `received_at`；可早可晚。 |
| timeout | Check/Probe 总期限从受理起计。 | `deadline_at = eligible_at + timeout`，准备/排队晚于 eligible 的部分也消耗预算。 |
| freshness | Check/Probe 以受理序号作为强/弱新鲜度边界。 | 强条件为 `started_at > eligible_at`，弱条件为 `completed_at > eligible_at`。 |
| series | Check/Probe 没有独立系列属性；Coordinator 用 predecessor 链表示 recurrence。 | 输入 `series_id` 可选，每个 Task 必有 series ID；默认等于该 Request 的 ID。 |
| 后继身份 | Coordinator 已有确定性后继引用，Check/Probe 没有递归需求生成。 | 每轮新 Request/Task 身份，继承 series ID；重试和恢复不重复分配同一轮。 |

**已确认：** 所有时间按服务端时间域解释，客户端时钟不能裁定 freshness。
向未来调整只延迟执行资格；eligible 前的等待不消耗 Task timeout。
向过去调整不表示倒流执行，已经过去的预算不退还，也不保证缓存保留足够久。
准确版本确认后，可以匹配仍被保留、满足该时间边界及其他兼容条件的旧 Execution。

**建议：** 接收时 deadline 已过，记录可观察的过期终态，不启动执行；
具体受理响应与错误码留给实施契约。不使用回退、重启或幂等重试重置这条期限。
持久化绝对时间，进程内等待使用单调时钟；校时、精度相等和跨重启换算必须有测试，
不能仅用毫秒时间戳替换旧序号而丢失默认受理因果关系。

**身份边界：** Request 是一次需求，Task 是服务端对需求的跟踪，Execution 是实际工作。
是否让新协议 request ID 与 task ID 共用值，尚未确定；不为满足 series 默认值
擅自要求所有调用方额外提交一个 ID。series 不是授权凭据，也不是执行兼容键。

## 2. Task：增加 PENDING，取消只作用于 PENDING

| 修改点 | Before | After |
|---|---|---|
| 生命周期 | Check/Probe 为 accepted/preparing/waiting/running 等状态，无 PENDING。 | 所有 Task 增加 PENDING，表达已受理、尚未激活的计划需求。 |
| 准备进展 | preparing 是主状态之一。 | 准备可提前发生，不应仅因开始下载就失去 pending 规划身份；准备进展需可单独观察。 |
| 取消 | Check/Probe 可撤销非终态需求；Coordinator 有 request/recurrence scope。 | 新统一交互只取消 pending Task，不提供“取消 recursive Task”或另一个系列取消语义。 |
| 重复规划 | 没有跨 Check/Probe 的统一系列去重。 | 冗余新 pending Task 被取消，已有 pending Task 保留；记录明确原因。 |

**已确认：** 用户取消的是被保留的 pending Task；它不能再触发后继，递归链由此停止。
取消冗余 pending Task 不影响原计划。已经运行的 Task 不被该操作取消，
也不能因一个需求被撤销而终止仍服务其他需求的共享 Execution。

默认 eligible 等于 received 时 PENDING 可以短暂，但不能在持久化、幂等或订阅时丢失。
取消与激活/规划必须原子裁决；如果目标已经离开 PENDING，不能成功返回却实际取消另一轮。

**兼容边界：** 这是对新统一生命周期的设计，不能默默修改旧 Check v2、
现有 Checker v3 / Objective v1 或 Coordinator 历史取消行为。
已发布协议如何升级、旧入口保留多久，实施前明确。
内部超时、服务关闭、父观察失去 owner 时的资源清理仍需保留，
它们不是公开的“单轮运行中取消”能力。

**待收敛：** 到 eligible 但准备尚未完成时，是离开 PENDING 进入准备/调度等待，
还是继续占有 pending 槽位？该决定必须与下一节递归触发一致，不能由 enum 名称隐式决定。

## 3. Series 与 recursive：一个待规划位置，两个候选锚点

| 修改点 | Before | After |
|---|---|---|
| 适用面 | Coordinator 有 recurrence；Check/Probe 没有。 | Check、Probe、Regulation 都可表达递归请求，调节职责仍归 Coordinator。 |
| 现有周期 | Coordinator 首次 dispatch 时生成后继，eligible 为实际 dispatch 时间加 interval。 | 新模型明确锚点，不把 dispatch、eligible、completed 混为一谈。 |
| pending 约束 | 没有统一 series pending 唯一约束。 | 同一系列同时最多保留一个 pending 计划；重复新计划取消，原计划不被替换。 |
| 触发配置 | 不支持统一的 eligible/completed 选择。 | 建议增加 `recursive.anchor`，让固定周期与完成后间隔显式可选。 |

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

### 3.2 新建议：`recursive.anchor`

用户最后提出同时支持两种触发点。本草案建议如下，**尚未当作最终确认**：

```text
recursive:
  period: 正的有限时长
  anchor: eligible | completed
```

| 候选参数值 | 规划触发 | 下一轮 eligible | 主要效果 |
|---|---|---|---|
| `eligible`（推荐默认） | 本轮资格边界到达并原子消费该轮规划权 | 本轮 `eligible_at + period` | 固定周期；可有重叠需求，再按 freshness 共享 Execution。 |
| `completed` | 本轮 Task 正常 completed | 本轮 Task `completed_at + period` | 完成后间隔；由自身递归产生的轮次不重叠。 |

两种模式每轮都只采用一个锚点，不能 eligible 触发一次、完成再触发一次。
completed 锚点是 **Task 的完成时间**，不是共享 Execution 的完成时间；
一个 Execution 可供多个系列使用，不能据此额外生成请求。
正常 completed 不等于业务通过；有效“不达标”观察也属于 completed。

例如周期 10 秒、首轮 eligible 为 0 秒、Task 在第 25 秒完成：
eligible 模式的后继资格为 10、20、30 秒；completed 模式下一轮为 35 秒。
eligible 模式中，第 10、20 秒的需求在版本/输入等兼容时可用 completed_after
加入同一执行，不能据此承诺所有轮次必然合并或每个叶子都新。

**待确认的建议：**
completed 模式默认仅正常 completed 续作，failed/timeout 不等于 completed；
如需失败后继续，应另定义终态策略，不能隐式重试。
eligible 模式应按资格节拍推进，不随实际 worker 开始时间漂移；
但准备失败早于 eligible、准备跨越 eligible 时如何保存规划权，
须与 PENDING 状态定义一起确认。

停机错过多个 eligible 周期时，“补齐全部、跳到下一未来周期、合并错过轮次”
尚未选择。pending 唯一约束不能代替错过周期策略；不得用循环立即重放制造无限积压。
completed 模式运行期间可能没有 pending Task，届时没有可取消的 pending 对象；
本草案不暗中增设 cancel-series 接口，是否需要提前保留未定 eligible 的后继仍待讨论。

## 4. 制品准备：提前量与可观察的版本回退

| 修改点 | Before | After |
|---|---|---|
| 启动时机 | 接收 Check/Probe 后立即开始来源确认。 | 支持相对于 eligible 的准备提前量；不一定以 received 为准备起点。 |
| 提前收益 | 立即确认准确内容，但未来任务可能很早固定旧版。 | 既提前发现错误、下载预热，又避免必然提前整个递归周期固定版本。 |
| 新版失败 | 来源/下载/验证失败使准备失败，没有选版 fallback。 | 可配置选版 fallback：更新失败或新候选不可用时使用仍可用的准确旧版。 |
| 证据 | 准确 digest、来源确认时间、runtime 等。 | 额外记录更新尝试、失败原因、回退决定和实际选择；不能把回退冒充更新成功。 |

**已确认方向：** 提前准备与执行资格分离，递归下一轮可以重新确认浮动来源。
提前准备可以提前报告来源错误，不必等 eligible 才开始昂贵下载。

**建议概念名及公式：**

```text
preparation_lead >= 0
planned_preparation_at = eligible_at - preparation_lead
earliest_preparation_at = max(received_at, planned_preparation_at)
```

提前量不是轮询周期，也不是保证下载完成的时限。周期 10 分钟、提前量 30 秒时，
可以到 eligible 前 30 秒才准备；若请求更晚收到，则尽快开始。
省略提前量时建议保留接收后立即准备；零提前量表示到 eligible 才开始。
默认值与限额是待确认策略，不能作为已实现 API。
网络确认是一个过程，不能宣称取得 received 或 preparation_at 那一瞬间的远端快照。

**fallback 建议边界：**

- 策略显式开启；建议默认失败即失败，避免隐式掩盖更新问题。
- 仅浮动选版可退回旧候选；显式 digest 或传入准确 bindings 不能被替换。
- 旧版必须具有同来源/授权范围的可信准确记录，重新满足 runtime、输入及组合契约。
  “上一版”候选的选择范围、缓存失效/撤销与最大陈旧度还需确定。
- 可处理更新检查、下载、格式/契约验证及执行前准入失败。
  业务检查“不通过”不能触发回退；执行已开始后的异常不自动换版重跑。
- 不得拼出与 Objective 内固定 Checker digest 不一致的混合闭包。
  动态依赖仍遵守准确绑定，不能用 fallback 绕过冲突或来源授权。
- 无可用旧版时明确失败；fallback 不刷新 eligible/timeout，也不扩张权限。

准备有独立有限预算，不能因 eligible 很远而无限占资源。
准备早完不得早执行；准备超过 eligible 则继续消耗 Task 剩余预算。

## 5. Execution：新的时间边界

| 修改点 | Before | After |
|---|---|---|
| 新鲜度仲裁 | 服务内受理序号 a，与开始 s/完成 c 比较。 | 相对于 eligible 时间边界，并保留服务端因果排序以处理同刻事件。 |
| 旧结果 | 必须满足受理后的 start/completion 条件。 | eligible 设在过去时，接收前完成的保留结果也可能符合要求。 |
| 调度 | 准备后匹配保留、运行或预约执行。 | 额外受 eligible 资格限制，不因提前准备而提前执行。 |

对于未来 eligible 的 completed_after 需求，不能在 eligible 前交付完成结果。
到达资格时可加入兼容运行执行；started_after 仍要求执行开始严格晚于边界。
旧协议使用 started-after-request/completed-after-request 字面值；
新 eligible 语义是否采用新值/新版本必须显式迁移，不能按同一历史字段偷偷换含义。

外层 recursive 不自动使内部每个 Checker 或依赖观察永久递归；
显式子需求的调度仍由拥有它的父执行约束，避免无限扩张工作树。

## 6. 持久化与重启：恢复需求，而非伪造执行连续性

| 修改点 | Before | After |
|---|---|---|
| Check/Probe | 进程内有界保留，重启使 Task 不可用，无透明重跑。 | 所有已受理未完成 Task 都需持久恢复，不限 recursive。 |
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

优先讨论新增的 anchor 参数及默认值，然后联动确定：

1. 到 eligible 但准备未完成/已失败时，pending 槽位与后继规划如何推进。
2. completed 模式的失败/超时续作和无 pending 时的停止方式。
3. 错过周期策略、准备提前量默认值、可用旧版的选择与陈旧上限。
4. series 跨模块作用域、旧协议迁移及中断 Execution 的恢复策略。

这些是显式待决项，不从此前的聊天建议、旧测试成功或 Agent 勾选推断为已接受。
