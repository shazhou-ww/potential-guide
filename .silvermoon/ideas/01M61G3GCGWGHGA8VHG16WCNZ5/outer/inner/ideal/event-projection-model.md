# 事件事实、Reducer 与 Snapshot 投影

本文是 [Idea.md](./Idea.md) 的独立设计讨论稿。事件定义与变化集中在这里，
不继续扩充[请求数据示例](./request-data-examples.md)；状态判定规则仍见
[任务状态模型](./task-state-model.md)。以下均未实现、未验收，不是现有 API 或最终 wire schema。

## 1. 设计原则：Snapshot 是事件事实在时间上的投影

```text
E(W) = 一致读取边界 W 内，目标 Task 及其所引用 Execution 的必要事实事件
F(W) = reduce(E(W))
Snapshot(W, t) = project(F(W), t)
Snapshot.timestamp = t
```

W 表示因果一致的事件读取边界，不是新增 snapshot.revision 字段。
t 是与该读取边界配套取得的服务端技术时间，不是响应发送时随手补上的时间。
“所有 events”指重建这个对象所需的完整事实，不是整个服务或整个 series 的所有日志。
分页中的一页通常不够，Task 历史中的 executionId 也只是引用，不能假装已经读到了执行结果。

这里不是把 events、当前时间和 reducer 结果拼成三个快照字段。
reducer 得到内部事实状态，project 选择对外的有界字段并计算 stage 与 canceledAt；
实际 state=deriveState(snapshot)，不在 snapshot 另存一份。
原始 events、请求策略、完整执行环境和诊断树不因此进入 snapshot。
reducer 与 project 可以在实现中组合，但输入事实与投影时间必须显式区分。

| 修改点 | 之前的草案 | 本次原则 |
|---|---|---|
| 事实来源 | 要求快照与历史同源，尚未明确如何重建 | 每个快照业务事实都能由事件或其固定引用的事实重建 |
| 状态来源 | 依时间与事实判定，但仍有“每次转移应写事件”的表述 | stage 是内驱投影，结合 canceledAt 派生实际 state；不为纯时间推进强制新增事件 |
| 当前时间 | timestamp 表示本次读取时间 | 同时是投影的显式输入；不是 reducer 内部读取墙钟 |
| task.updated | 快照通知容易与事实事件混称 | 只输出投影，不能作为 reducer 的事实输入 |
| 持久缓存 | cachedSnapshot 为派生视图 | 可用增量归约或带边界的 checkpoint 加速，但不能成为独立真相 |

### 1.1 确定性与副作用边界

- 同一有序事件前缀、同一投影规则及同一 t 必须得到同一 snapshot。
- reduce/project 不下载制品、不运行 Check、不查询 latest、不读取当前可变配置、
  不创建后继 Request，也不靠调用 Date.now 隐藏时间输入。
- 默认 eligibleAt、seriesId、有效 deadlineAt、选版、采用条件结果、绑定和终结裁决
  由命令处理或调度过程产生事实；归约重放不能重新作出这些业务决定。
- 完成一次执行可以触发调度器规划后继；单纯查询、重放 execution.completed
  不得再创建一个后继。规划仍须满足系列唯一 pending 与幂等要求。
- 内部事件可保存必要的有效约束，或引用保留的不可变 Request/策略依据；
  其依赖事实必须包含在重建输入中，不能在 reducer 中临时访问会变的外部来源。
  Request 原文仍通过独立授权查询，不把它复制到 snapshot。
- 重复投递必须按稳定事件身份/位置去重，不能按 timestamp、type 或相同 payload 去重；
  后两者可能是两次真实发生的相同操作。未知事件类型或缺失必要因果事实须明确报错，
  不可静默跳过后返回看似完整的快照。

### 1.2 时间改变状态，不创造已发生的工作

时间资格仅由 `t >= eligibleAt` 判断，恰好到点就满足，不存在主动 eligibility 过程。
相同事件前缀在 eligibleAt 前后可分别投影为 pending、preparing。
若没有 preparation.started 事实，跨过时间边界不能生成 preparation.startedAt；
也不定义 task.preparing、task.eligible 或 task.eligibility.satisfied 这样的到点事实事件。
删除先前草案的可选 eligibility.satisfiedAt，不再保留“实际观察资格已到”的快照事实。
调度器可以设置定时唤醒来推进工作或通知，但唤醒不是时间条件成立的额外前提。
task.updated 可以因为投影变化而通知，但通知本身不成为归约输入。

同理，“到了 deadline”与“何时、为何完成终结裁决”不是同一个事实。
终结原因和实际 terminatedAt 必须有事实依据，不能由当前时间伪造。
截止时刻与执行完成的竞争、裁决落盘前的对外状态仍待专门收敛；
本原则不擅自确定这些优先级，也不以此修改现有超时示例的终结时间。

## 2. 事件分类与命名变化

事件名描述已经发生的事实，而不是命令、将发生的计划或当前状态。
Task 的过程事实用 `task.<process>.<fact>`，对象级事实用 `task.<fact>`；
实际执行仍属于 `execution`，不为形式对称增加 task.execution.started 副本。
下表的“之前”指旧设计草案，不承诺兼容别名。

| 之前 | 本次建议 | 语义及 snapshot 映射 |
|---|---|---|
| 受理事实未独立列出 | task.created | 独立 Task 身份与已确定的有效时间约束；默认值不在重放时重新求值 |
| 准备开始未独立列出 | task.preparation.started | 实际开始 → preparation.startedAt，允许早于 eligible |
| task.artifact-selected | task.preparation.completed | 正式可用的准确版本已确定 → completedAt、artifactRef、language、resolution |
| 获取尝试/更新失败未独立列出 | task.preparation.attempted | 一次已结束尝试及结果；暂定诊断类型，不据此直接终结 Task |
| 准备最终失败未独立列出 | task.preparation.failed | 过程最终失败及依据，不混同可恢复尝试失败 |
| task.readiness-evaluated | task.readiness.evaluated | 一次条件求值及子 Check 引用；false 是未满足，不是故障 |
| 采用条件结果未独立列出 | task.readiness.satisfied | 正式采用就绪证据 → readiness.satisfiedAt，不是所有历史 passed 结果都自动生效 |
| 就绪过程最终失败未独立列出 | task.readiness.failed | 求值/就绪过程的最终故障，不把条件暂不满足归为失败 |
| task.execution-linked | task.allocation.bound | 正式绑定 Execution → allocation.boundAt、execution.executionId；包括共享已有执行 |
| 分配最终失败未独立列出 | task.allocation.failed | 分配过程最终失败，不把临时资源不足当成终结 |
| execution.started | 保留 | 实际 runtime/workerRevision 及开始事实 → execution.startedAt |
| execution.completed | 保留，明确业务载荷边界 | data.result 由对应业务协议定义；正常返回不代表业务目标达成 |
| 执行故障未独立列出 | execution.failed | 实际执行失败；影响哪些 Task 仍依各 Task 的绑定与终结裁决 |
| execution.child-task-linked | execution.progress | 调用关联作为 data.progress 中的业务进展，不再是通用引擎的专用关系类型 |
| 故障详情未定义业务扩展位 | 失败事件的 data.error.details（可选） | 业务诊断对象；通用错误分类不由该对象决定 |
| task.terminated | 非取消终结使用 | data.stage 记录终结位置；成功时引用执行结果，不复制 result |
| 取消混在 task.terminated | task.canceled | 外部取消生效事实，occurredAt → canceledAt，data.stage 冻结内驱位置；不新增 stage=cancelled |
| task.updated | 保留为投影通知 | 不属于上述事实集合，不参与 reduce |

当前 preparation.completedAt 的定义就是“已形成正式、可使用的准确制品选择”，
因此本轮将原选版事件收敛为 preparation.completed，不再同时增加 resolved 事件。
如果未来把“候选选中”与“准备可用”拆成不同事实，应重新定义边界，不能偷换 completed 的含义。
resolution=up-to-date/fallback/updated 是同一种成功事实的三种方式，不拆为三个事件类型。
最终失败没有 resolution；回退前的更新错误仍须保留。

过程 failed 记录的是失败事实，task.terminated 记录的是需求终结裁决。
两者不是可独立修改的两套状态；若某过程最终失败按协议必然终结 Task，
必须在一致提交边界提供相应裁决，不能暴露冲突终态。重复错误详情可引用原失败事实。
正常 Execution 完成与某 Task 终结则不是同一个时点；共享 Execution 的结果不强制所有 Task 成功，
已经超时/取消的 Task 也不会因后来的执行结果重新变成 completed。

不是所有过程都必须凑齐 started/completed/failed 三件套。
没有 prerequisites 的 Task 不伪造 readiness 过程；预取、重查、预约等工作可重叠。
详细 observation/invocation、预约释放、取消需求与后继规划的事件载荷仍需继续定义，
上表是此次讨论的核心类型，不宣称它已覆盖所有可恢复业务动作。

### 2.1 固定外壳与业务载荷

通用引擎定义生命周期，Check、Probe、Regulation 的业务协议分别定义输入、进展和结果。
Request.type=check/probe/regulate 是固定操作判别字段，不属于业务载荷；
它用于选择相应适配器/校验及隔离执行共享。事件外层 type 仍表示事实类型，不被请求 type 替换。
原始 Request 的固定类型可由 requestId 引用读取，不重复加入通用 snapshot。
业务层可嵌入内容，但不向每个过程增加一个无边界的 custom 对象。
本轮明确四类边界，**暂不新增 metadata 字段**，也不增加与 subject 重复的 input。

| 边界 | 承载位置 | 谁定义语义 |
|---|---|---|
| 业务输入 | Request.subject 及已有的可选 context | subject 是业务目标/输入；context 是执行上下文，不是权限授予或审计杂项容器 |
| 业务进展 | execution.progress.data.progress | 对应业务协议定义的有限 JSON 对象，描述本次执行已经报告的进展 |
| 正常结果 | execution.completed.data.result | 对应业务协议定义并校验的结果，继续遵守该协议已有形状 |
| 故障详情 | 失败事件的 data.error.details | 可选的有限 JSON 业务诊断对象，不改变通用故障分类 |

type、occurredAt、executionId、游标，以及通用 error.code/stage/message 等外壳字段
由引擎/适配器契约确定。progress/result/details 不展开合并进外壳；
即使载荷中有名为 state、executionId 或 type 的字段，也只是业务数据，
不能覆盖身份、改变生命周期、授予权限或建立引擎内的依赖/绑定关系。
data.progress 与 data.result 分别为命名的业务载荷槽，不把 data 整体定义为任意扩展集合。

业务层自定义不等于任意制品作者都可改写协议。
例如[Checker 契约](./artifact-contracts.md)仍统一规定 ok/problems/requirements，
没有开放每个 Checker 自定义输出 schema；引擎不必理解这些字段，
但 Check 适配器必须按其业务协议校验。Probe 与 Regulation 同样遵守各自协议。
正常返回 ok=false 或未满足的 requirements 仍可产生 execution.completed；
真正执行故障才使用 execution.failed，不能把业务不通过包装成引擎错误。

引擎负责通用载荷的有限 JSON、序列化字节数和资源限制、身份/访问隔离；
业务适配器负责具体 schema、字段词汇和协议约束，非法载荷必须显式报告，
不能静默丢弃或变成成功。业务类型的识别和演进由所属协议管理，
不是靠引擎猜测某个字段名，也不因此新增全局 metadata 或任意制品输出 schema。
errors 的 details 要脱敏，不自动包含原始请求、凭据、堆栈或其他 owner 的上下文。

prerequisites 的 Check 输入仍使用各自 subject；readiness 只消费适配器提供的有效通过判定
及检查引用。业务 requirements/诊断详情从相应 Check 的 progress/result 查询，
不在 readiness 另存一份 custom 或条件业务结果。
影响执行行为的 subject/context 必须进入相应的兼容/共享判定，
不能把有影响的参数当成不参与匹配的附注，也不因加入扩展位就开放 Regulation 执行共享。

### 2.2 业务关联不等于通用调度依赖

Probe 发起 Check 的调用关联通过 execution.progress 记录，业务载荷可以包含
observationId、invocationId 和 childTaskId；引擎保留它，但不解释为依赖图、
prerequisites 或自动治理授权。Coordinator 自己理解 Regulation 的业务结果，
按授权、预算和策略创建依赖治理 Request，并记录自己的编排因果。
通用 Task 层仍负责执行已声明的 prerequisites，不负责推导“应创建哪个治理任务”。

依赖 Regulation 完成只能作为重新检查的信号；若要求某 Objective 达到某 level，
必须检查目标条件，不能以该 Task 已结束代替条件成立。
原 Regulation Task 若已终结并报告未满足的需求，后续创建新的 Request/Task，
可以声明相应 prerequisites，不复活旧终态；
若原 Task 尚未执行、仍在 readiness 的 blocked 状态，则条件通过后继续原 Task，
不因一次依赖完成通知额外创建重复任务。

## 3. 归约结果与事实所有权

| 快照内容 | 来源 |
|---|---|
| requestId/taskId/seriesId、receivedAt/eligibleAt/deadlineAt | task.created 的有效事实 |
| preparation | 准备开始及成功采用事件；尝试细节留在历史 |
| readiness.satisfiedAt | 正式采用条件通过证据的事实，不是看到任一子 Check completed 就通过 |
| allocation.boundAt、execution.executionId | task.allocation.bound |
| execution.startedAt/completedAt | 被引用 Execution 的开始/完成事实，不冒充 Task 加入时间 |
| completed 的 result | 被引用 Execution 的业务结果及该 Task 的成功终结裁决；引擎不读取业务 ok/requirements 来改写终态 |
| termination | Task 自己的终结裁决；不能用共享 Execution 的终结替代 |
| stage、canceledAt、timestamp | 未取消时内驱位置按 t 投影；取消后冻结裁决位置与事实边界，timestamp 仍为读取时间 |

示例中业务阶段时间使用对应事实的 occurredAt；接收时间等可能早于事件创建的值须显式保存。
occurredAt 是业务时间，不作为日志顺序。绑定一个正在运行的共享 Execution 时，
读取边界必须包含已引用的开始事实，且 startedAt 可以早于 boundAt。
不要求对无因果关系的不同 Execution 建立全局业务时间全序。

Snapshot 只提取累积的有界事实，而不是把 reducer 内部状态全部序列化。
先前公开的正式选版、绑定及过程时间继续按原路径继承；各轮尝试或条件重查保留在历史。
条件通过证据的有效期/撤销与重新绑定策略尚未定义，不用“覆盖旧字段”暗中破坏继承规则。
终结后执行仍继续时，Task 结局不可反转；取消按下一节固定其已知事实边界。
timed_out 是否补充后续执行诊断事实仍待明确，不能默认给超时或取消需求添加成功 result。

### 3.1 外部取消与内驱投影复合

判定树只覆盖无外部控制时的内驱推进，取消不硬塞到树根或树叶；
但取消仍是归约输入，与同一事实视图共同决定实际状态：

```text
未取消：stage = 内驱判定(事实边界, t)
已取消：stage = task.canceled.data.stage
        canceledAt = task.canceled.occurredAt
实际状态 = deriveState(stage, canceledAt)
```

task.canceled 必须由服务端原子裁决产生，data.stage 是该边界的真实投影，
不是调用方指定值或旧快照；只能是 pending/preparing/blocked/queued/running。
对应已知过程/执行事实也固定在取消边界，晚到的共享执行结果仍保存在 Execution 历史，
不推进该 Task 的 stage、不添加成功 result。timestamp 随读取更新而不改变冻结边界。
取消前即使已经跨过 eligibleAt，也不能照抄上次 pending；取消后跨时间边界则不能再推进。
重复取消不新增不同的取消事实，已非取消终结则明确冲突；同刻仲裁优先级仍待收敛。
取消与完成等终结互斥，同一 Task 不同时记录生效的 task.canceled 和另一个终结裁决。
task.canceled 保存的 stage 必须可由其因果前缀和 occurredAt 复核；
恢复时不得丢失这个边界后拿最新 Execution 状态覆盖它。
取消时间只由 canceledAt 表达，不重复 termination.terminatedAt 或 lastStage；
termination 可保留 error/planningConflict 诊断。非取消场景的诊断位置统一称 lastStage。
取消撤销尚未消费的规划权，不产生后继，也不撤销已存在的后继；
这是需求撤销，不保证物理停止，更不影响其他 owner 的共享执行。

execution.progress 是可查询的事实事件，不是 task.updated 快照通知，
也不是重新引入 snapshot.progress。通用 reducer 识别该事件，保留其历史，
但不按业务字段修改 state、readiness 或绑定关系；业务层可以归约出自己的观察视图。
属于审计/关联证据的 progress 必须随事实历史可追溯，不能只通过可丢失的 SSE 发送。
“识别 execution.progress 但不解释业务载荷”与“静默忽略未知事件类型”不同。
完成时 result 原样作为业务结果投影，不变成另一份可修改的执行结果。
error.details 留在所属故障事实中；Task 终结通过已知 Execution 关联查询详情，
不为可扩展性再复制一份业务错误对象。Task 自身的准入/准备等错误仍由自身事实提供。

## 4. 读取边界、恢复与讨论边界

事件重建和技术时间必须来自一次有明确一致性保证的读取，不能把读取开始后的任意新事件
拼到旧前缀中，也不能只按 occurredAt <= t 过滤后宣称得到历史上 t 时刻的真实状态。
迟到事实、同刻事件和跨流引用都需要日志顺序/因果边界。
历史重放需要明确当时的事件边界和投影时间；本轮不承诺新增任意 as-of 查询 API。

可以增量维护 F(W)，也可以用 checkpoint 加后缀事件恢复，结果必须等价于同一边界的完整归约。
这不要求每次 GET 都扫描全日志；也不等于已决定底层 event store、事务技术或历史无限保留。
丢失必要事件、引用或 checkpoint 时应显式报告无法重建，不能将部分历史投影为完整成功。

仍待确定：事件稳定身份与去重协议、跨流读取边界、原子提交、水位与 SSE 交接、
保留/压缩和规则演进、deadline/完成/取消同刻仲裁、就绪证据失效及运行中恢复。
分页 cursor、事件身份和内部 checkpoint 边界不是 snapshot revision，
也不能仅凭 snapshot.timestamp 去重或证明严格全序。
拒绝且没有 Task 的 Request 仍须有独立审计，不虚构 task.created；其事件分类另行定义。

## 5. 验证原则

- 同一前缀与 t 重放结果一致；完整归约与 checkpoint 加后缀一致。
- 未取消时无写入跨 eligible（含恰好到点）只改变 timestamp/stage，不产生 eligibility 对象、
  资格通过事件、准备开始或终结事实，也不等待调度器确认。
- 对照完整事件链重建已展示的 Task 快照，而非只验证 JSON 字段合法。
- 同刻的 preparation.completed 与 allocation.bound 按事件边界区分；
  queued 视图可以在绑定之前，不能只按 timestamp 去重或合并。
- 共享 Execution 只存一份结果，多 Task 投影保留各自身份、绑定和终结边界。
- fallback 保留更新错误，三种 resolution 及既有事实不会因重放或失败分支丢失。
- 乱序/重复传输由读取与归约边界处理；未知事实、缺失引用不能静默降级。
- task.updated 不可回灌 reducer；重放不能触发执行、外部检查或递归后继创建。
- 任意非终态取消后 stage 冻结，canceledAt 原值保留；跨 eligible 或迟到执行结果不复活。
  测试重复取消、与终结竞争、保留执行关联及后继规划权，Task 取消不假装停止共享 Execution。
- execution.progress 的业务关联可以完整重放/查询，但不修改通用 snapshot 或触发依赖治理；
  载荷中的同名字段不能覆盖外壳，不新增 snapshot.progress/custom/metadata。
- 正常业务不通过仍为 execution.completed，结果按业务协议校验并原样投影；
  执行故障的 details 可追溯且不改变通用分类。输入匹配与共享隔离不能忽略有效 context。

## 6. 历史查询与完整事件示例

以下例子从请求数据示例的原第 10 节迁入，沿用同一组 Task/Execution 身份。
每个 JSON 块是完整响应或完整事件；分页片段不等于该对象的全部历史。
接口路径、游标和载荷仍是草案，不能发送给现有接口执行。

**Before：** 请求数据示例 4.2/4.3 的完整旧快照携带 evidence（含 runtime、worker revision、
子 Task 快照和观察进展等），没有对应的统一历史分页查询 API。
现有 SSE 主要输出 task.updated，不把它的实时连接冒充历史查询。

**After：** 新快照移除 evidence，以已有身份查询结构化事实。
以下 `/event-history`、事件类型及分页字段是完整示例用的草案，不是现有可调用接口，
不新增 evidenceId 或独立 `/evidence` 数据模型。cursor 为不透明分页位置，
不是 ULID 业务身份、snapshot.timestamp 或客户端时间；不得由客户端解析或据此授予权限。

### 6.1 Task 创建和准备开始：归约前缀

这是主 Check 的前两条事实，补全原查询示例省略的创建和准备开始前缀。
prerequisites 的空集合是 Task 已确定的内部约束，不代表当前 Check Request 接受该字段。
receivedAt 是接收 Request 的业务时间，独立记录，不假定所有创建事件都与接收同时发生。

```json
{
  "events": [
    {
      "cursor": "task6-created",
      "type": "task.created",
      "occurredAt": "2026-10-29T03:20:00.000Z",
      "requestId": "01M60000000000000000000002",
      "taskId": "01M60000000000000000000006",
      "seriesId": "01M6000000000000000000001D",
      "data": {
        "receivedAt": "2026-10-29T03:20:00.000Z",
        "eligibleAt": "2026-10-29T03:21:00.000Z",
        "deadlineAt": "2026-10-29T03:21:30.000Z",
        "prerequisites": []
      }
    },
    {
      "cursor": "task6-before-selection",
      "type": "task.preparation.started",
      "occurredAt": "2026-10-29T03:20:50.000Z",
      "requestId": "01M60000000000000000000002",
      "taskId": "01M60000000000000000000006",
      "seriesId": "01M6000000000000000000001D",
      "data": {}
    }
  ],
  "nextCursor": "task6-before-selection"
}
```

该前缀在 03:20:52 为 pending，在 03:21:00.001 为 preparing；
两份视图继承同一 preparation.startedAt，不增加新的状态转移事实。
这里只列快照重建的必要事件；下载尝试等诊断事实可以另外存在。

### 6.2 Task 历史：准备完成和 Execution 绑定

查询[请求数据示例](./request-data-examples.md)第 4.2 节同一个 Task。
本例从服务返回的既有位置继续，展示准备完成及绑定的两条事实，
不是声称完整历史只有这两条：

```http
GET /event-history?taskId=01M60000000000000000000006&after=task6-before-selection&limit=2 HTTP/1.1
Host: 127.0.0.1:8080
Accept: application/json
```

完整分页响应：

```json
{
  "events": [
    {
      "cursor": "task6-selection",
      "type": "task.preparation.completed",
      "occurredAt": "2026-10-29T03:21:00.009Z",
      "requestId": "01M60000000000000000000002",
      "taskId": "01M60000000000000000000006",
      "seriesId": "01M6000000000000000000001D",
      "data": {
        "artifactRef": {
          "kind": "checker",
          "url": "https://example.test/checker/latest.tgz",
          "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        },
        "language": "en",
        "fallbackFromTaskId": "01M60000000000000000000005",
        "updateError": {
          "code": "download_failed",
          "stage": "download",
          "message": "Artifact download failed."
        },
        "resolution": "fallback"
      }
    },
    {
      "cursor": "task6-execution-linked",
      "type": "task.allocation.bound",
      "occurredAt": "2026-10-29T03:21:00.009Z",
      "requestId": "01M60000000000000000000002",
      "taskId": "01M60000000000000000000006",
      "seriesId": "01M6000000000000000000001D",
      "data": {
        "executionId": "01M60000000000000000000001"
      }
    }
  ],
  "nextCursor": "task6-execution-linked"
}
```

两条事件业务时间相同，但有先后位置。数据示例 3.3 的 queued 快照位于第一条之后、
第二条之前；3.4 的 running 和 4.2 的 completed 则都继承第二条的 allocation.boundAt。
cursor 中的可读文字只便于解释，类型改名不要求解析或改写游标。

下一页使用原过滤条件和 nextCursor，不拿 snapshot.timestamp 当作位置：

```http
GET /event-history?taskId=01M60000000000000000000006&after=task6-execution-linked&limit=2 HTTP/1.1
Host: 127.0.0.1:8080
Accept: application/json
```

下例表示当前查询边界内的最后一页。真实实现可能还有其他阶段事件，
快照水位与分页边界需要在持久化设计中固定。

```json
{
  "events": [
    {
      "cursor": "task6-terminated",
      "type": "task.terminated",
      "occurredAt": "2026-10-29T03:21:04.010Z",
      "requestId": "01M60000000000000000000002",
      "taskId": "01M60000000000000000000006",
      "seriesId": "01M6000000000000000000001D",
      "data": {
        "executionId": "01M60000000000000000000001",
        "stage": "completed"
      }
    }
  ],
  "nextCursor": null
}
```

nextCursor=null 只表示此查询边界没有下一页，不承诺未来不再产生事件；
历史接实时需要独立的交接水位，不能用 null 自动推导为可以无缝订阅。

### 6.3 Execution 历史：实际执行证据只记录一次

使用上一页关联到的 executionId 查询。该执行可以服务多个 Task，
事件不复制各 Task 的完整输入，也不公开全部 owner 列表：

```http
GET /event-history?executionId=01M60000000000000000000001&limit=2 HTTP/1.1
Host: 127.0.0.1:8080
Accept: application/json
```

完整两条执行事实如下；workerRevision 对应原 evidence.revision，
不是 artifactRef 的内容 digest，与已移除的 Task 数字 revision 也不是一回事。
示例刻意把 actual runtime 和 workerRevision 留在事件中，证明精简 snapshot 不等于丢弃证据。

```json
{
  "events": [
    {
      "cursor": "execution1-started",
      "type": "execution.started",
      "occurredAt": "2026-10-29T03:21:00.010Z",
      "executionId": "01M60000000000000000000001",
      "data": {
        "artifactRef": {
          "kind": "checker",
          "url": "https://example.test/checker/latest.tgz",
          "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        },
        "runtime": {
          "type": "node",
          "version": "24.11.1",
          "platform": "win32",
          "architecture": "x64",
          "adapter": "node-commonjs-v1",
          "configuration": "{\"cleanupMs\":5000,\"deadlineMs\":30000,\"directories\":64,\"messageBytes\":8388608,\"observers\":64,\"queue\":64,\"records\":256,\"retentionMs\":60000,\"retireAfter\":100,\"workers\":4}"
        },
        "workerRevision": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
      }
    },
    {
      "cursor": "execution1-completed",
      "type": "execution.completed",
      "occurredAt": "2026-10-29T03:21:04.000Z",
      "executionId": "01M60000000000000000000001",
      "data": {
        "result": {
          "ok": true,
          "problems": []
        }
      }
    }
  ],
  "nextCursor": null
}
```

execution.completed 是实际结果的唯一事实来源；task.terminated 只记录该需求的
状态/终结时间并引用 executionId，不重复存储同一个业务 result。
此处的 ok/problems 属于 Check 结果协议，不是所有 Execution 的必填业务字段。
业务不通过的完整 Check 结果见[请求数据示例](./request-data-examples.md)第 9.3 节，
它也是正常完成的结果，不因 ok=false 改成 execution.failed。
查询 completed Task snapshot 时可以从关联执行投影 result，避免额外请求，
但不能独立维护第二份结果。若未来有 Task 特有的结果转换，需明确记录其独立语义，
不能直接套用“与执行结果相同”的去重规则。

### 6.4 业务进展与 series 查询：调用关联，不是通用依赖

[请求数据示例](./request-data-examples.md)第 4.3 节的 Probe 原先内嵌一个子 Task snapshot；
After 可通过下面的完整 execution.progress 事件追溯。
这是 Probe 业务协议定义的调用关系，kind=check-linked 只是其业务词汇，
不是引擎的事件类型或调度指令。执行事实使用外层 executionId 归属，
共享该 Probe 执行的多个父 Task 沿自己的 task.allocation.bound 事件读取同一份记录。

```json
{
  "cursor": "probe-execution17-child-linked",
  "type": "execution.progress",
  "occurredAt": "2026-10-29T03:20:00.210Z",
  "executionId": "01M60000000000000000000017",
  "data": {
    "progress": {
      "kind": "check-linked",
      "observationId": "01M60000000000000000000015",
      "invocationId": "01M60000000000000000000010",
      "checker": "pass",
      "levelId": "ready",
      "childTaskId": "01M6000000000000000000000C"
    }
  }
}
```

理解该业务协议的消费方查询 childTaskId 的 Task 历史，
可找到它与 `01M6000000000000000000000A` 的执行关联，
再读该 Execution 的实际 runtime/result；不用把子快照复制进父 snapshot。
observation/level/invocation 进展同样记录为结构化事实，不维护第二份完整 evidence 树。

系列历史读取使用同一分页模型，过滤将来加入的各轮 Task，具体查询边界仍以服务游标为准：

```http
GET /event-history?seriesId=01M6000000000000000000001D&limit=20 HTTP/1.1
Host: 127.0.0.1:8080
Accept: application/json
```

本例每次只选一个过滤维度；多维过滤的交并规则未定，不在示例里隐式猜测。
Task/Series 历史返回自己的事实和执行引用，不默认递归展开所有共享执行或其他 owner。
所有查询均需鉴权（示例省略凭据）；关联与游标不能绕过来源/作用域隔离。
历史缺失、清理或游标过期必须明确返回不可用，不能把空列表冒充没有发生过工作。
保留期限、SSE 游标续读和具体存储事务规则仍留到持久化讨论。

### 6.5 条件检查的详细进展：事件，不是 snapshot.progress

[请求数据示例](./request-data-examples.md)第 9.2 节的父 Task 为 blocked；
其具体哪个条件尚未满足，由下列完整历史事件表达，
不在 snapshot 的 readiness 分组内加一套可变 conditions/status。
这条事实与之前的 blocked 快照使用同一个父 Task、子任务和时间，
去掉 progress 不等于丢弃诊断证据。通过后的条件重查同样记录 evaluated 事件，
最终采用的就绪证据通过 task.readiness.satisfied 记录，对应 readiness.satisfiedAt；
本段只展示尚未通过的一次求值，不冒充就绪过程的全部事件。

```json
{
  "cursor": "task31-readiness-evaluated",
  "type": "task.readiness.evaluated",
  "occurredAt": "2026-10-29T04:20:02.000Z",
  "requestId": "01M60000000000000000000030",
  "taskId": "01M60000000000000000000031",
  "seriesId": "01M60000000000000000000031",
  "data": {
    "satisfied": false,
    "checks": [
      {
        "index": 0,
        "taskId": "01M60000000000000000000034",
        "executionId": "01M60000000000000000000035",
        "state": "not-met"
      },
      {
        "index": 1,
        "taskId": "01M60000000000000000000037",
        "executionId": "01M60000000000000000000038",
        "state": "passed"
      }
    ]
  }
}
```

事件的 occurredAt 是业务事实发生时间，snapshot.timestamp 是读取投影时间；
数值可以恰好相同，但不能因此把它们定义成同一个字段或排序游标。

### 6.6 故障详情：通用错误与业务诊断分开

下例对应[任务状态模型](./task-state-model.md)第 7 节 execution_failed 场景的
Execution `01M60000000000000000000064`。这里只展示一条完整失败事件，
不是它的全部历史；实际执行先失败，Task 在 06:02:00.500Z 作出终结裁决。
诊断字段由该 Check 业务适配器定义，不是所有失败都必须包含 operation/exitCode。

```json
{
  "cursor": "execution64-failed",
  "type": "execution.failed",
  "occurredAt": "2026-10-29T06:02:00.490Z",
  "executionId": "01M60000000000000000000064",
  "data": {
    "error": {
      "code": "execution_failed",
      "stage": "observe",
      "message": "Checker execution failed.",
      "details": {
        "operation": "inspect-workspace",
        "component": "layout",
        "exitCode": 2
      }
    }
  }
}
```

Task 快照保留原通用错误摘要，通过执行引用读取详细故障事实，不增加自定义诊断树。
业务适配器判断此次是执行故障，不能由通用 reducer 看见 details.exitCode 就自行推断；
同样，业务结果中的 ok=false 或 requirements 不是此类错误详情。

### 6.7 取消生效：内驱树之外的控制事实

对应[请求数据示例](./request-data-examples.md)第 6.1 节 running 取消分支，
与第 6.2 节所展示的主 Check 正常终结历史互斥，不可拼接为同一条实际历史。
此处的 stage 是取消裁决时已确认的内驱位置，不是把 running 标记为执行停止。

```json
{
  "cursor": "task6-canceled",
  "type": "task.canceled",
  "occurredAt": "2026-10-29T03:21:02.000Z",
  "requestId": "01M60000000000000000000002",
  "taskId": "01M60000000000000000000006",
  "seriesId": "01M6000000000000000000001D",
  "data": {
    "stage": "running",
    "error": {
      "code": "task_cancelled",
      "stage": "observe",
      "message": "Task demand cancelled; execution may continue."
    }
  }
}
```

occurredAt 投影为 canceledAt，data.error 投影为 termination.error；
已有准备、绑定和执行开始事实照常继承，03:21:05Z 读取仍为 stage=running。
task.canceled 的单 l 拼写与 canceledAt 一致；派生状态 cancelled 保留既有拼写。
