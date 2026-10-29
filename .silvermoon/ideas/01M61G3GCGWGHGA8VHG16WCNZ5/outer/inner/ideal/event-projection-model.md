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
reducer 得到内部事实状态，project 选择对外的有界字段并计算单一 state；
原始 events、请求策略、完整执行环境和诊断树不因此进入 snapshot。
reducer 与 project 可以在实现中组合，但输入事实与投影时间必须显式区分。

| 修改点 | 之前的草案 | 本次原则 |
|---|---|---|
| 事实来源 | 要求快照与历史同源，尚未明确如何重建 | 每个快照业务事实都能由事件或其固定引用的事实重建 |
| 状态来源 | 依时间与事实判定，但仍有“每次转移应写事件”的表述 | state 是 project 的结果；不为纯时间推进强制新增事件 |
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

相同事件前缀在 eligibleAt 前后可分别投影为 pending、preparing。
若没有 preparation.started 事实，跨过时间边界不能生成 preparation.startedAt；
也不需要为此写一条 task.preparing 或 task.eligible。
资格确实被服务观察/裁决时可以记录 task.eligibility.satisfied，不能由一次 GET 自动追加。
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
| 资格观察未独立列出 | task.eligibility.satisfied | 可选的实际观察事实 → eligibility.satisfiedAt；不代表每次越过时间边界都写入 |
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
| execution.completed | 保留 | 正常业务结果，包括 Check 的 ok=false；不是执行故障 |
| 执行故障未独立列出 | execution.failed | 实际执行失败；影响哪些 Task 仍依各 Task 的绑定与终结裁决 |
| execution.child-task-linked | 保留 | 执行调用子 Task 的因果关系，不能复制子快照树 |
| task.terminated | 保留 | Task 终结裁决 → termination 与终态；成功时引用执行结果，不复制 result |
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

## 3. 归约结果与事实所有权

| 快照内容 | 来源 |
|---|---|
| requestId/taskId/seriesId、receivedAt/eligibleAt/deadlineAt | task.created 的有效事实 |
| preparation | 准备开始及成功采用事件；尝试细节留在历史 |
| readiness.satisfiedAt | 正式采用条件通过证据的事实，不是看到任一子 Check completed 就通过 |
| allocation.boundAt、execution.executionId | task.allocation.bound |
| execution.startedAt/completedAt | 被引用 Execution 的开始/完成事实，不冒充 Task 加入时间 |
| completed 的 result | 被引用 Execution 的正常结果及该 Task 的成功终结裁决 |
| termination | Task 自己的终结裁决；不能用共享 Execution 的终结替代 |
| state、timestamp | 对上述一致事实按 t 投影；state 规则见任务状态模型 |

示例中业务阶段时间使用对应事实的 occurredAt；接收时间等可能早于事件创建的值须显式保存。
occurredAt 是业务时间，不作为日志顺序。绑定一个正在运行的共享 Execution 时，
读取边界必须包含已引用的开始事实，且 startedAt 可以早于 boundAt。
不要求对无因果关系的不同 Execution 建立全局业务时间全序。

Snapshot 只提取累积的有界事实，而不是把 reducer 内部状态全部序列化。
先前公开的正式选版、绑定及过程时间继续按原路径继承；各轮尝试或条件重查保留在历史。
条件通过证据的有效期/撤销与重新绑定策略尚未定义，不用“覆盖旧字段”暗中破坏继承规则。
终结后执行仍继续时，Task 终态不可反转；是否补充后续执行诊断事实须另行明确，
不能默认给 timed_out/cancelled 添加成功 result。

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
- 无写入跨 eligible 只改变 timestamp/state，不产生准备开始或终结事实。
- 对照完整事件链重建已展示的 Task 快照，而非只验证 JSON 字段合法。
- 同刻的 preparation.completed 与 allocation.bound 按事件边界区分；
  queued 视图可以在绑定之前，不能只按 timestamp 去重或合并。
- 共享 Execution 只存一份结果，多 Task 投影保留各自身份、绑定和终结边界。
- fallback 保留更新错误，三种 resolution 及既有事实不会因重放或失败分支丢失。
- 乱序/重复传输由读取与归约边界处理；未知事实、缺失引用不能静默降级。
- task.updated 不可回灌 reducer；重放不能触发执行、外部检查或递归后继创建。

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
        "state": "completed",
        "executionId": "01M60000000000000000000001"
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
查询 completed Task snapshot 时可以从关联执行投影 result，避免额外请求，
但不能独立维护第二份结果。若未来有 Task 特有的结果转换，需明确记录其独立语义，
不能直接套用“与执行结果相同”的去重规则。

### 6.4 子 Task 与 series 查询：关联，不递归展开整树

[请求数据示例](./request-data-examples.md)第 4.3 节的 Probe 原先内嵌一个子 Task snapshot；
After 可通过下面的完整关联事件追溯。
这是 Observation Execution 拥有的调用关系，执行事实使用 executionId 归属，
共享该 Probe 执行的多个父 Task 沿自己的 task.allocation.bound 事件读取同一份记录。

```json
{
  "cursor": "probe-execution17-child-linked",
  "type": "execution.child-task-linked",
  "occurredAt": "2026-10-29T03:20:00.210Z",
  "executionId": "01M60000000000000000000017",
  "data": {
    "observationId": "01M60000000000000000000015",
    "invocationId": "01M60000000000000000000010",
    "checker": "pass",
    "levelId": "ready",
    "childTaskId": "01M6000000000000000000000C"
  }
}
```

查询 childTaskId 的 Task 历史可找到它与 `01M6000000000000000000000A` 的执行关联，
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
