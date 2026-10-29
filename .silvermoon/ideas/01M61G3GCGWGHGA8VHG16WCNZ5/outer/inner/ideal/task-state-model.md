# 任务判定树、解锁过程与累积事实

本文是 [Idea.md](./Idea.md) 的设计支持文档，抽象本次讨论确立的任务模型。
这是全新协议的设计，不是当前代码已实现的声明；具体 JSON 见
[完整示例](./request-data-examples.md)，修改对象对照见[修订说明](./request-lifecycle-revision.md)。

## 1. 术语与分层

| 术语 | 定义 |
|---|---|
| Request | 带幂等 requestId 的调用实体，解析/准入失败可不产生 Task |
| Task | 已建立的需求，拥有独立 taskId、时间约束和状态 |
| Execution | 实际执行，可被多个兼容 Task 共享 |
| 解锁条件（gate） | 需求继续推进所必须成立的一层谓词 |
| 解锁过程（enabling process） | 产生该层条件所需事实的工作，可以与其他过程重叠 |
| 判定树（decision tree） | 按优先级逐层增加条件，叶子代表原子 state |
| 原子状态（state） | 判定树选中的具体情况，决定快照的约束 |
| 状态转移（transition） | 新事实或裁决使 Task 从一个原子状态变为另一个 |
| 语义分类（state category） | failed、terminated 等状态集合，可包含或交叉，不要求构成单一树 |
| Snapshot | 已知有界事实与服务端当前时间推导出的状态投影，不是逐次编号的持久化实体 |

不把 transition 命名为 phase，也不强制二级事实对象与 state 同名。
“解锁”是补齐条件合取的一层，不保证下一次对外快照恰好落在相邻叶子。
例如制品已经提前就绪，时间资格到达后可以不出现 preparing 快照。

## 2. 判定树：沿根到叶的路径做条件合取

下面是正常推进与过程最终失败的判定骨架，控制终结另见第 7 节。
prerequisites 是任意抽象 Task 的统一能力，不为 Check/Probe 定义特殊状态机。
当前 Check/Probe Request 准入不支持该字段（包括空数组），因此这些入口暂不生成
带前置条件的任务；无条件任务在这一层直接满足，而不是从全局模型删除该层。

```text
时间资格
├─ 未到 → pending
└─ 已到
   └─ preparation：制品准备
      ├─ 尚未就绪 → preparing
      ├─ 最终失败 → preparation_failed
      └─ 就绪
         └─ readiness：前置条件就绪
            ├─ 未满足/求值中 → blocked
            ├─ 求值最终失败 → readiness_failed
            └─ 满足
               └─ allocation：资源与执行匹配
                  ├─ 等待/预约后尚未开始 → queued
                  ├─ 调度最终失败 → allocation_failed
                  └─ 已进入实际执行
                     └─ execution
                        ├─ 尚未结束 → running
                        ├─ 最终失败 → execution_failed
                        └─ 正常结果 → completed
```

例如 Regulation 的 execution_failed 意味着：
时间已到 AND 制品就绪 AND 治理前置条件通过 AND 已进入执行 AND 执行失败。
这些不是装饰性命名，而是该快照必须继承哪些事实的类型约束。
没有声明 prerequisites 的任务不要求虚构一次条件检查或 satisfiedAt 时间戳。
统一条件层可以空集合成立，记录必须与实际发生的过程一致。

“不满足”与“最终失败”不同：Check 的业务不通过仍是有效结果，
前置条件不通过可使父 Regulation blocked，但不把子 Check 变成 readiness_failed。
临时缺资源是 queued；可重试的获取错误或可采用的 fallback 也不立即终结 Task。
最终失败必须由明确策略裁决，保留过程原因，不能从一个异常字符串猜测状态。

## 3. 解锁过程可以重叠，state 是优先级投影

| 过程/约束 | 作用 | 事实分组 |
|---|---|---|
| 整体时间约束 | 受理、时间资格边界与 Task 总期限，不属于某个执行过程 | 顶层 receivedAt/eligibleAt/deadlineAt |
| eligibility | 服务端确认时间资格已到；不等于立即运行 | eligibility（有需要时记录实际判定时间） |
| preparation | 获取、验证和选择准确制品，提供制品就绪事实 | preparation |
| readiness | 求值 prerequisites、等待依赖就绪并确认可继续 | readiness |
| allocation | 为 Task 分配执行机会，包括可用资源或已有共享 Execution 的匹配/绑定 | allocation |
| execution | 实际工作及其结果 | execution |
| termination | 需求结束的裁决；可发生在执行之前 | termination |

这些是过程名，而非 pending/preparing/blocked 等阶段名的机械改写。
核心过程及 snapshot 的二级事实字段统一为
`preparation / readiness / allocation / execution`。
`prerequisites` 只命名前置条件声明，不再用来命名 snapshot 的就绪过程；
readiness 不是时间资格、制品或资源全部就绪的泛称。
allocation 不限定为新建 worker：接入已有兼容执行同样属于为 Task 分配执行机会。
过程名称调整不改变状态名 blocked/queued，也不把声明字段 prerequisites 改名。
整体计划时间放在顶层，不再增加 schedule 对象；eligibility 是时间资格的实际判定事实，
termination 是结束裁决，仍保留各自职责。
时间未到时可能已经获取或验证内容，但 Task 仍是 pending。
准备工作开始于 eligible 前，不等于 Task 提前进入 preparing 或运行。

`preparation.startedAt` 表示为该 Task 开始准备工作的实际时间，允许早于 eligible；
`preparation.completedAt` 表示已形成正式、可使用的准确制品选择。
仅下载完成还不是整个准备过程完成。重用缓存不伪造一次下载；
需要表达 Task 进入 preparing 的时刻时，使用状态转移事件，不借用过程时间。
这取代旧草案“preparationStartedAt 必须晚于 eligible”的阶段时间约定。

过程事实可提前出现，但失败叶子的裁决仍遵守判定路径。
例如 pending 中的预取失败先记录尝试事实，不跳过时间层直接宣称 preparation_failed。
执行前必须原子确认用于解锁的证据仍有效；证据有效期、重试及条件变化策略仍待细化。
不因为过程可以重叠，就允许绕过权限或为治理自动启动未经授权的 Agent。

## 4. 单一 state 与协议定义的语义集合

快照不加入 substate、isFailed 或 isTerminated。原子 state 已唯一表达具体情况；
语义分类由协议中的显式集合定义，SDK 提供公共判定方法。
不能按字符串后缀猜测，也不能只在某个语言 SDK 中私自定义。

| 原子 state | 支持的 Task | isFailed | isTerminated |
|---|---|---|---|
| pending | 全部 | false | false |
| preparing | 全部 | false | false |
| blocked | 全部抽象 Task | false | false |
| queued | 全部 | false | false |
| running | 全部 | false | false |
| completed | 全部 | false | true |
| preparation_failed | 全部 | true | true |
| readiness_failed | 全部抽象 Task | true | true |
| allocation_failed | 全部 | true | true |
| execution_failed | 全部 | true | true |
| timed_out（控制终结暂定命名） | 全部 | true | true |
| cancelled（控制终结暂定命名） | 全部 | false | true |

上表为本轮协议草案的完整分类映射；四个过程失败替代宽泛 failed。
所有 Task 共用这张表与状态约束。当前 Check/Probe 创建入口的字段限制
只是 admission 策略，不用于从 Task schema 或 SDK 分类中移除 blocked/readiness_failed。
超时、取消的既有行为用暂定原子值表达，不宣称它们在正常判定树中的最终挂接方式已确定。
新增状态必须更新协议分类，遇到未知状态须显式报告，不默认为成功或非终态。
`isFailed(state)`、`isTerminated(state)` 是方便消费的纯判定，
并不把允许交叉/包含的语义集合重新编码为 state/substate 二维字段。

## 5. Snapshot：过程分组事实 + 单一状态 + 技术时间

快照顶层保留身份、timestamp、state、receivedAt/eligibleAt/deadlineAt，不再包含 revision。
不嵌入 Request，也不重复 freshness、recurrence 等请求策略；它们通过 requestId 查询。
二级事实分组如下，
只输出已发生的字段，不为路径整齐伪造空过程或缺省时间。

| 分组 | 有界记录性字段示例 | 含义 |
|---|---|---|
| eligibility | satisfiedAt | 实际资格判定时间，不修改计划 eligibleAt |
| preparation | startedAt、completedAt、artifactRef、language、resolution | 准备过程及正式选版方式，定义不内嵌 |
| readiness | satisfiedAt | prerequisites 已被采用的通过事实，不是当前所有 Check 状态 |
| allocation | boundAt | 正式绑定某次执行的时间；仅资源预约不等于绑定 |
| execution | executionId、startedAt、completedAt | 实际执行事实，不是 Task 阶段时刻 |
| termination | terminatedAt、error、lastState、planningConflict | 需求终结原因及必要诊断 |

顶层三个时间字段属于整个 Task，不强塞进 preparation/allocation/execution。
deadlineAt 也适用于尚未开始执行的任务；它是根据有效 eligibleAt 与 Request.timeoutMs
计算的 Task 约束，而不是要求客户端在 Request 中重复声明。

Request 查询保存原始调用实体（包括 requestId 和被省略字段的原貌），
Task 快照只公开其执行需要的有效事实。默认 eligibleAt/seriesId 属于 Task 的受理结果，
不能为了查询方便反写 Request，或把两者变成分别可修改的两份配置。
读取 freshness/recurrence/subject/prerequisites 等请求意图使用独立的授权 Request 查询；
失败 Request 即使没有 Task 也可按合法 requestId 审计，body 无法解析时不得伪造完整实体。
Request 查询的保留期限/错误协议与持久化细节后续收敛，不以快照完整性代替查询授权。

实际已知的执行 ID 应在绑定时进入 execution.executionId 并一直继承，
即使该执行尚未开始；临时预约的详细变化通过事件查询，不能冒充已确认绑定。
Task 加入已有运行执行时，execution.startedAt 可以早于 allocation.boundAt；
不得把共享执行开始时间写成加入时间。completed-after-eligible 与
started-after-eligible 对这个已有执行是否合格仍需各自判断。

`result` 保留在 completed 顶层作为业务读取投影，不重复根 Objective 身份。
详细证据通过历史事件查询，不在过程对象中内嵌全部尝试、worker 日志或子 Task 树。
成功选定准确版本时同时记录 preparation.artifactRef 与 preparation.resolution，
后继沿固定路径继承；预优化找到候选不等于已正式采用。resolution 替代旧草案的
fallbackUsed，不同时保留两份可能矛盾的选版方式。

| preparation.resolution | 成功选版的含义 |
|---|---|
| up-to-date | 已确认既有可用版本满足本次选版要求，直接使用 |
| fallback | 更新检查或新候选准备失败，按服务策略退回既有可用版本 |
| updated | 本次获取并验证制品，使用这次准备得到的版本 |

artifactRef 回答“用了哪个准确内容”，resolution 回答“经哪种路径选定”。
仅有缓存不能声称 up-to-date；没有成功确认但仍按策略使用旧版必须如实记为 fallback。
updated 不保证 digest 与之前不同，首次获取或重新获取同内容也属于该获取路径。
显式 digest 请求中的 up-to-date 指准确满足指定版本，不是全局最新；
fallback 不允许换成另一个 digest，也不能绕过授权、runtime 或输入契约。
尚未成功选定时不填 resolution，不用一个默认值伪造结果。最终选择失败也不产生
resolution；业务检查不通过不触发重新选版。检查时间、失败原因和候选尝试在历史事件中，
snapshot 只保存成功选择的有界事实。

snapshot 不包含通用 progress 或 progress.process，也不在每个过程里复制一套
status/reason/currentStep 来替代它。整体状态只由 state 表达；
过程对象仅放已成立的有界事实。每次 fetch 尝试、未满足条件列表、临时预约和业务进展
通过 SSE/历史事件观察，不随着每个 snapshot 重复传输。
只有已被采用的就绪、准确选版和正式执行关联等事实才进入相应二级分组。

### 5.1 timestamp 与读取投影

timestamp 是服务端生成这份 snapshot 所依据的技术时间，不叫 evaluatedAt，
不是业务修改时间、Task 生命周期事实、发送时间或快照更新序号。
requestId 仍关联创建 Task 的原始 Request，不变成每次 GET 查询的新请求 ID。
timestamp 可以随重新读取变化，其他业务时间和已经成立的过程事实继续继承。

例如相同事实包含 eligibleAt=15:00:00，14:59:59 的投影可为 pending，
15:00:01 的投影可为 preparing；不必为了越过时间边界制造一次持久化写入。
但时间可推算状态，不可推算实际工作：若准备尚未真正开始，
即使 state=preparing 也不能凭空记录 preparation.startedAt。
实际定时调度和 SSE 通知仍需按服务语义推进，只是不为维护 snapshot revision 而强制写入。

timestamp 必须与求值所使用的一致事实视图相对应，不能读完旧事实后在发送时补一个新时间。
同一服务时间域若保证时间和事实视图不倒退，可用较晚 timestamp 辅助选择更新观察；
时间戳相同不等于内容相同，不能仅按相同时间丢弃快照。
墙钟校时、重启、多实例与乱序响应不天然有严格全序，不能跨实例比较后声称已解决一致性。
历史事件 cursor 仍用于严格分页位置；查询与订阅交接、乱序处理细节在协议层另行收敛，
不把 cursor 或 ULID 时间当成隐藏的 snapshot revision。

### 5.2 继承不变量

对同一 Task 的前序快照 A 和后继 B：

1. taskId/requestId/seriesId 不变；timestamp/state 为本次读取元数据，不要求原值继承。
2. A 已成立的事实叶子路径，在 B 中必须仍存在且值相等；过程对象可增加新事实。
3. 不因 state 切换把 preparation.startedAt 改成 preparationStartedAt，
   也不把 execution.startedAt 改成 Task 进入 running 的时间。
4. snapshot 没有 progress；过程事实对象不得用可变的当前进展覆盖旧事实。
5. 跳过阶段不等于缺少该路径要求的就绪事实；未发生过程也不凭空填时间。
6. failed/timeout/cancelled 后继必须继承已经记录的事实；没有执行时不要求 execution。
7. 终结后不反转；重试、重新选版或重新绑定如要改变既有事实，必须另有显式模型。

这是一份协议修订中的新字段布局，不要求同时保留旧平铺字段别名。
历史 Before 的对象保持原貌。当前草案统一使用过程分组，不能让不同例子各用一套路径。

## 6. 判定路径约束数据类型

| 原子状态 | 必须满足的主要数据约束 |
|---|---|
| pending | 时间资格未到；可保留已经产生的 preparation 事实，但不能伪造实际执行 |
| preparing | 时间层已到、制品未就绪；尚未实际工作时可无 preparation，不能从 state 推造 startedAt |
| preparation_failed | 时间层已通过且准备最终失败，有真实准备事实和终结原因，不要求 Execution |
| blocked / readiness_failed | 任意有前置条件的抽象 Task；制品正式就绪，有准确引用；条件求值失败不是业务不通过 |
| queued / allocation_failed | 制品已就绪且所声明前置条件通过；尚无实际开始也可有正式绑定事实 |
| running / execution_failed | 存在真实 executionId/startedAt，并继承此前各层已知事实 |
| completed | 有完整执行结果及正常执行完成事实，Task 终结时间独立记录 |
| timed_out / cancelled | 控制终结；继承实际已有事实，不根据错误类别补造任何过程 |

公共方法便于处理错误家族，但 schema 仍按原子叶子约束字段。
只对一个 snapshot 校验形状不够，还需对服务端有序生成的事实视图验证单调扩展，
不要按网络响应到达顺序或相同 timestamp 擅自认定前后关系；
并拒绝缺少所需条件通过证据的任务调度、无执行关联的 execution_failed 等反例。
过程失败不能用 lastState 代替原因：状态为 pending 时也可能发生提前获取错误；
lastState 仅说明终结前观察到的位置，不是失败过程的另一个判别字段。

## 7. 完整快照例子：同一事实不随当前 state 移位

以下两个对象是同一 Task 的连续快照。时间未到时，准备过程已经开始，
所以 pending 可以带 preparation.startedAt；它不是 preparing 的当前进展。

```json
{
  "requestId": "01M60000000000000000000060",
  "taskId": "01M60000000000000000000061",
  "seriesId": "01M60000000000000000000061",
  "state": "pending",
  "preparation": {
    "startedAt": "2026-10-29T06:00:50.000Z"
  },
  "receivedAt": "2026-10-29T06:00:00.000Z",
  "eligibleAt": "2026-10-29T06:01:00.000Z",
  "deadlineAt": "2026-10-29T06:01:30.000Z",
  "timestamp": "2026-10-29T06:00:50.000Z"
}
```

到达时间资格后，准备裁定摘要不匹配且无合法回退，选择 preparation_failed。
准备没有成功完成，所以没有 preparation.completedAt，也没有 execution；
原 receivedAt/eligibleAt/deadlineAt 和 preparation.startedAt 全部保留。不通过 error 文本决定分类。

```json
{
  "requestId": "01M60000000000000000000060",
  "taskId": "01M60000000000000000000061",
  "seriesId": "01M60000000000000000000061",
  "state": "preparation_failed",
  "eligibility": {
    "satisfiedAt": "2026-10-29T06:01:00.000Z"
  },
  "preparation": {
    "startedAt": "2026-10-29T06:00:50.000Z"
  },
  "termination": {
    "terminatedAt": "2026-10-29T06:01:00.010Z",
    "lastState": "preparing",
    "error": {
      "code": "digest_mismatch",
      "stage": "verify",
      "message": "Artifact digest does not match the requested digest."
    }
  },
  "receivedAt": "2026-10-29T06:00:00.000Z",
  "eligibleAt": "2026-10-29T06:01:00.000Z",
  "deadlineAt": "2026-10-29T06:01:30.000Z",
  "timestamp": "2026-10-29T06:01:00.010Z"
}
```

下面是另一个 Check 的 execution_failed；其创建入口没有接受前置条件，
无须补造 readiness 求值过程。并非抽象 Check Task 被禁止有此能力。
本例制品从已确认满足指定 digest 的既有内容中选定，所以 resolution=up-to-date；
随后的执行故障不改变该选版事实。
这是实际执行失败而非单个 Task 超时：执行已结束但未正常完成，
因此记录 termination 原因，不伪造 execution.completedAt 或成功 result。
详细 execution 结束错误仍可从历史事件查询。

```json
{
  "requestId": "01M60000000000000000000062",
  "taskId": "01M60000000000000000000063",
  "seriesId": "01M60000000000000000000063",
  "state": "execution_failed",
  "preparation": {
    "startedAt": "2026-10-29T06:02:00.010Z",
    "completedAt": "2026-10-29T06:02:00.100Z",
    "artifactRef": {
      "kind": "checker",
      "url": "https://example.test/checker/v1.tgz",
      "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    "language": "en",
    "resolution": "up-to-date"
  },
  "allocation": {
    "boundAt": "2026-10-29T06:02:00.110Z"
  },
  "execution": {
    "executionId": "01M60000000000000000000064",
    "startedAt": "2026-10-29T06:02:00.120Z"
  },
  "termination": {
    "terminatedAt": "2026-10-29T06:02:00.500Z",
    "lastState": "running",
    "error": {
      "code": "execution_failed",
      "stage": "observe",
      "message": "Checker execution failed."
    }
  },
  "receivedAt": "2026-10-29T06:02:00.000Z",
  "eligibleAt": "2026-10-29T06:02:00.000Z",
  "deadlineAt": "2026-10-29T06:02:30.000Z",
  "timestamp": "2026-10-29T06:02:00.500Z"
}
```

这两个失败原子都满足 isFailed 和 isTerminated，却要求不同的过程事实。
不能给 preparation_failed 填一个空 execution 来凑统一字段，也不能从 execution_failed
删除已经发生的制品选择和执行身份。更多成功/超时/取消完整例子见[数据示例](./request-data-examples.md)。

## 8. 控制终结、周期与待决边界

Task 超时不必由 Execution 引起；Task 已终结时，共享 Execution 仍可能服务其他需求。
因此 Task 的 termination 与 execution.completedAt 分开，所有失败不统一塞进 execution。
控制终结在异常/时间竞争下的具体优先级、deadline 同刻裁决及判定树挂接位置仍待收敛。
已提交终态不可被迟到结果反转；此原则不取决于最终选择哪个控制终结原子名。

`isTerminated` 不等于“应生成后继”。recurrence.anchor=terminated
处理正常完成及失败/超时续作；取消 pending 则撤销后继规划权。
isFailed(cancelled)=false 不表示它会继续周期；控制策略与分类判定不能混为一谈。
当前公开取消仍限 pending，是否扩展 queued/blocked 等不由本文暗中决定。

### 本次收敛与尚未定稿

已确立：路径条件合取、可重叠解锁过程、单一原子 state、协议级语义分类、
过程分组的有界事实、固定路径继承、snapshot 无 revision/progress、
技术时间 timestamp 与业务时间分开、详细历史按事件查询。
本文暂定术语与字段名供评审；不新增独立的 phase/substate 状态机。
具体控制终结分支、过程最终失败策略、证据有效期和崩溃重试机制仍需单独讨论。
不以这些待决项否定已明确的抽象，也不把文档示例当作完成实现或验收。
