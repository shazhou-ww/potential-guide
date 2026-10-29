# 接口与数据示例

本文是[新引擎 idea](./Idea.md)的接口草案，直接定义角色和完整示例，
不提供现有协议对照，也不承诺这里的方法名/URL 已可调用。
固定约束见[概念定义](./concepts.md)，模块所有权见[系统边界](./system-boundaries.md)。

例子使用宿主注册的测试类型 echo；它仅返回文本，用于证明核心不依赖制品业务。
所有 ID、时间和文本都是合成数据，示例类型不是生产内置操作。

## 1. 通用 Request 与具体类型

通用部分包含 requestId、type、executionMatch、可选 eligibleAt/seriesId/recurrence
及本请求 timeoutMs；executionMatch 默认 started-after-eligible，示例显式给出。
默认值在受理的契约绑定中固定，原始 Request 查询不反写省略字段。
type 是判别字段，应用将已注册类型组合为 discriminated union；
所有业务类型（包括 check/probe/regulate）均通过宿主注册，无内置必需业务类型，
也不接受任意未注册字符串；每种类型统一注入 TaskType，包含纯 validate/equals、
必需 prepare 及封装 ExecutorPool 的 allocate，不再分别注入 Type 与 Pool。
类型的具体输入可以与公共字段同层组合，但其 Validator 不能重新定义或覆盖公共字段。
不要求现在把所有输入迁到 input/payload，也不新增 metadata。

```json
{
  "requestId": "01M64000000000000000000001",
  "type": "echo",
  "text": "hello",
  "executionMatch": "started-after-eligible",
  "eligibleAt": "2026-10-29T08:00:10.000Z",
  "timeoutMs": 30000,
  "recurrence": {
    "periodMs": 60000,
    "anchor": "eligible"
  }
}
```

text 属于 echo 输入协议。Check 的 checker/subject、Probe 的 objective 等属于各自类型，
不是每个通用 Request 都必须有 subject/context/artifactRef。
后继继承类型与合法业务输入；默认 seriesId 形成于受理事实，不反写此原始 Request。
此例在 08:00:00 接收，默认 seriesId 为独立分配的首个 taskId。
同一幂等身份重发同一意图返回原受理结果，换类型/输入则明确冲突。
受理重试时返回的快照可有较新 timestamp，不要求字节级重复第一次 HTTP 响应。
TaskType.equals 比较完整类型业务 Input，而非完整 Request；此例业务 Input 包含 text，
不包含身份/时间/递归/executionMatch 策略。请求幂等仍比较完整意图，不复用 equals
来忽略同一 requestId 上的策略变化。executionMatch 不复制到下方 snapshot。

## 2. 核心进程内 API

以下是逻辑签名，不是严格 TypeScript 定义；所有查询和命令都接受宿主可信的调用上下文。

| API | 输入 | 输出 / 行为 |
|---|---|---|
| submit(request, caller) | 完整类型化 Request 与可信身份 | 成功受理后的 Task snapshot；失败不伪造 Task |
| getRequest(requestId, caller) | Request 身份 | 授权后的原始实体，失败请求按可用的审计事实读取 |
| getTask(taskId, caller) | Task 身份 | 一致事实与时间上的 snapshot |
| cancelTask(taskId, caller) | 目标 Task，不接受调用方指定 stage/canceledAt | 取消生效后的 snapshot，重复取消返回原取消事实 |
| readHistory(filter, page, caller) | taskId/executionId/seriesId 之一及游标 | 有界历史页，必要引用授权后单独读取 |
| subscribe(filter, resume, caller) | 作用域、已定义的续读边界 | 可关闭的观察流，不获得 Task 的取消权限 |
| start() / close() | 宿主显式生命周期操作 | 启停主动协调与观察资源；close 不是批量用户取消 |

权限校验在核心也必须执行；caller 不从 Request.text/context 等业务对象反序列化。
核心错误有固定 code/message 及适用身份，业务故障可有可选 details。
未知类型、非法输入、幂等冲突、不可访问和历史缺失不得返回成功形空对象。
通用输入/身份错误与已受理 Task 的 execution.failed 是两个不同层次。

## 3. Task snapshot

顶层身份和时间由核心定义，过程对象只放已成立的有界事实。
stage 仅是内驱位置，外界信号 canceledAt 与时间约束平行表达，不重复 state/type/Request。
pending 和超时为派生判断，不属于 stage；完成与超时可同时成立。公共分类函数应分别
回答各维度的问题，不用单个互斥状态值掩盖迟到完成；采用 concepts 中的独立纯查询函数。
结果保持类型的业务形状，通用接口不能将所有 result 强制转换成 CheckResult。

### 3.1 已受理，时间尚未到

```json
{
  "requestId": "01M64000000000000000000001",
  "taskId": "01M64000000000000000000002",
  "seriesId": "01M64000000000000000000002",
  "stage": "initial",
  "receivedAt": "2026-10-29T08:00:00.000Z",
  "eligibleAt": "2026-10-29T08:00:10.000Z",
  "deadlineAt": "2026-10-29T08:00:40.000Z",
  "timestamp": "2026-10-29T08:00:00.000Z"
}
```

此例尚无内驱过程，显式使用 stage:initial；stage 不省略。
在 08:00:00 可计算为时间等待；到 08:00:10 时间条件满足，但没有引擎推进事实时，
仍为 initial，不能只因到点补造 preparing 或 preparation.startedAt。

### 3.2 实际执行中

```json
{
  "requestId": "01M64000000000000000000001",
  "taskId": "01M64000000000000000000002",
  "seriesId": "01M64000000000000000000002",
  "stage": "running",
  "receivedAt": "2026-10-29T08:00:00.000Z",
  "eligibleAt": "2026-10-29T08:00:10.000Z",
  "deadlineAt": "2026-10-29T08:00:40.000Z",
  "preparation": {
    "startedAt": "2026-10-29T08:00:10.001Z",
    "completedAt": "2026-10-29T08:00:10.002Z"
  },
  "allocation": {
    "boundAt": "2026-10-29T08:00:10.003Z"
  },
  "execution": {
    "executionId": "01M64000000000000000000003",
    "startedAt": "2026-10-29T08:00:10.004Z"
  },
  "timestamp": "2026-10-29T08:00:11.000Z"
}
```

echo 的 prepare 已实际执行并记录；准备后直接等待分配，不存在额外条件解锁过程。
准备内部结果可以是经校验的文本与处理器版本，不要求 artifactRef 或 resolution。

### 3.3 正常完成

```json
{
  "requestId": "01M64000000000000000000001",
  "taskId": "01M64000000000000000000002",
  "seriesId": "01M64000000000000000000002",
  "stage": "completed",
  "receivedAt": "2026-10-29T08:00:00.000Z",
  "eligibleAt": "2026-10-29T08:00:10.000Z",
  "deadlineAt": "2026-10-29T08:00:40.000Z",
  "preparation": {
    "startedAt": "2026-10-29T08:00:10.001Z",
    "completedAt": "2026-10-29T08:00:10.002Z"
  },
  "allocation": {
    "boundAt": "2026-10-29T08:00:10.003Z"
  },
  "execution": {
    "executionId": "01M64000000000000000000003",
    "startedAt": "2026-10-29T08:00:10.004Z",
    "completedAt": "2026-10-29T08:00:14.000Z"
  },
  "termination": {
    "terminatedAt": "2026-10-29T08:00:14.010Z"
  },
  "result": {
    "text": "hello"
  },
  "timestamp": "2026-10-29T08:00:14.010Z"
}
```

结果来自 Execution 正常完成事实；Task 的成功终结单独引用它，不再复制一份持久结果。
期限比较使用适用于本 Task 的有效完成事实时间，而不是稍后的终结记录处理或读取时间。
因此该例在 deadlineAt 之后再次读取，仍应被解释为按时完成。

### 3.4 运行中取消的互斥分支

本分支从 3.2 继续，与 3.3 的 Task 正常终结互斥。
取消在 08:00:12 生效，之后读取仍冻结原 stage 与已知执行事实；
即使执行稍后完成，也不补成功结果。通用终结诊断按需记录，本例无需额外错误对象。

```json
{
  "requestId": "01M64000000000000000000001",
  "taskId": "01M64000000000000000000002",
  "seriesId": "01M64000000000000000000002",
  "stage": "running",
  "canceledAt": "2026-10-29T08:00:12.000Z",
  "receivedAt": "2026-10-29T08:00:00.000Z",
  "eligibleAt": "2026-10-29T08:00:10.000Z",
  "deadlineAt": "2026-10-29T08:00:40.000Z",
  "preparation": {
    "startedAt": "2026-10-29T08:00:10.001Z",
    "completedAt": "2026-10-29T08:00:10.002Z"
  },
  "allocation": {
    "boundAt": "2026-10-29T08:00:10.003Z"
  },
  "execution": {
    "executionId": "01M64000000000000000000003",
    "startedAt": "2026-10-29T08:00:10.004Z"
  },
  "timestamp": "2026-10-29T08:00:15.000Z"
}
```

该 Task 已取消、其需求已撤销，并未因此产生执行失败事实。
这里 cancelled 只描述第二推动力，不是 stage，也不是三维统一枚举的定义。
之前的 deriveState/isTerminated/isFailed 统一分类不再作为本设计接口，改用 concepts
定义的独立查询，不能用超时判断代替过程失败或实际结束。
取消未消费的规划权，但本例采用 eligible 锚点，如果已创建下一轮则不能回溯取消它。

### 3.5 超时后正常完成

这是从 3.2 继续的另一分支，不与取消分支混合。deadlineAt 仍为 08:00:40：
在 08:00:41 读取，stage 可以仍为 running，时间维度已超时；调用方可以放弃等待。
若随后记录有效完成，快照仍如实返回结果：

```json
{
  "requestId": "01M64000000000000000000001",
  "taskId": "01M64000000000000000000002",
  "seriesId": "01M64000000000000000000002",
  "stage": "completed",
  "receivedAt": "2026-10-29T08:00:00.000Z",
  "eligibleAt": "2026-10-29T08:00:10.000Z",
  "deadlineAt": "2026-10-29T08:00:40.000Z",
  "preparation": {
    "startedAt": "2026-10-29T08:00:10.001Z",
    "completedAt": "2026-10-29T08:00:10.002Z"
  },
  "allocation": {
    "boundAt": "2026-10-29T08:00:10.003Z"
  },
  "execution": {
    "executionId": "01M64000000000000000000003",
    "startedAt": "2026-10-29T08:00:10.004Z",
    "completedAt": "2026-10-29T08:00:42.000Z"
  },
  "termination": {
    "terminatedAt": "2026-10-29T08:00:42.010Z"
  },
  "result": {
    "text": "hello"
  },
  "timestamp": "2026-10-29T08:00:43.000Z"
}
```

该 Task 同时已完成且超时；不额外持久化 timed_out stage 或重复布尔值。
引擎发出迟到完成通知，不撤销超时、不保证任何超时任务一定最终完成。
调用方是否接受结果是业务决定；时间经过、停止请求与实际停止分别表达。

## 4. 类型适配与内部准备结果

以下接口角色说明需要交换哪些信息；具体函数签名留到实施阶段，不预建复杂插件框架。

| 角色 | 输入 | 返回 / 报告 |
|---|---|---|
| validate | unknown 业务输入；通用字段与授权由 Engine 另验 | 纯函数得到合法 Input 或明确校验错误，无 IO/修改/隐式转换，申请 Executor 前完成 |
| equals | 合法 input:Input 与 other:unknown | 纯函数，域外 other 返回 false；合法输入域上为等价关系，不替代 validate 或幂等比较 |
| prepare（必需） | Input、预算、取消信号、适配器依赖 | 正式 Prepared 或有分类的故障；无额外工作时以恒等实现返回 Input，记录真实调用 |
| execute | 不可变 prepared、执行上下文、停止信号 | 校验后的 progress、一个正常 result 或执行故障 |
| allocate / 租约归还 | Prepared、执行约束、可信作用域及可撤销申请 | TaskType 通过 Pool 提供 Executor 使用租约；Engine 复核绑定，执行和清理后归还 |

echo 也必须提供 prepare；不需要额外工作时实现为 async input => input，
直接返回类型定义的 Prepared，不引入引擎级 outcome:ready 包装。此例返回：

```json
{
  "text": "hello"
}
```

Prepared 内容由 TaskType 契约定义，成功返回就是准备完成，异常为准备失败。
需要固定处理器或制品版本的类型可以在其 Prepared 中包含准确身份，但不是所有类型必填。
它作为准备完成的内部不可变事实保留，用于恢复和确定执行输入，不自动摊入 snapshot。
公开历史是否披露该内部对象须经过授权/投影策略；不能把恢复数据默认全量暴露给调用者。
业务版本是可恢复事实，不在重放时重新选 latest；历史按原契约版本解释。
Request、准备结果和事件须能追溯准确类型版本；版本标识的字段及位置仍待接口细化，
不得用某个类型的业务版本字段自动充当所有类型的统一契约版本字段。
Checkpoint 可引用它，但不能只保留进程内 closure 而声称可恢复。

## 5. 事件载荷

下面每个 JSON 都是一条完整示例事件，不声称这些片段包含一个任务的完整历史。
cursor 仅为不透明位置示意；正式分页和续读使用本节末尾定义的同一事实位置语义。

### 5.1 业务进展

```json
{
  "cursor": "echo3-progress1",
  "type": "execution.progress",
  "occurredAt": "2026-10-29T08:00:11.000Z",
  "executionId": "01M64000000000000000000003",
  "data": {
    "progress": {
      "kind": "text-processed",
      "characters": 5
    }
  }
}
```

引擎不理解 characters/kind 的业务含义，不据此改变 stage；
Probe 可以在自己的 progress 协议中表达 Check 调用关联，而不增加通用 child-task-linked 事件。

### 5.2 正常执行结果

```json
{
  "cursor": "echo3-completed",
  "type": "execution.completed",
  "occurredAt": "2026-10-29T08:00:14.000Z",
  "executionId": "01M64000000000000000000003",
  "data": {
    "result": {
      "text": "hello"
    }
  }
}
```

对于其他类型，正常 result 可以表达业务目标尚未达成；这不自动变成 execution.failed。
Task 终结时间与该执行结束时间分别记录。
完成事件可以晚于某个 owner Task 的 deadline；该 Task 的超时判断不会禁止记录
正常 Execution 结果或未取消 Task 的迟到完成通知。不同 owner 使用各自时间约束。

### 5.3 外部取消

```json
{
  "cursor": "echo2-canceled",
  "type": "task.canceled",
  "occurredAt": "2026-10-29T08:00:12.000Z",
  "requestId": "01M64000000000000000000001",
  "taskId": "01M64000000000000000000002",
  "seriesId": "01M64000000000000000000002",
  "data": {
    "stage": "running"
  }
}
```

取消事件属于 3.4 分支；同一分支允许 Execution 后来完成，不允许该 Task 再成功终结。
Snapshot 上的 canceledAt 由 occurredAt 投影，取消前的 stage 必须能由因果前缀复核。

### 5.4 失败详情的形状

以下是独立故障事件，不与以上正常执行/取消示例拼为一个实际执行历史。

```json
{
  "cursor": "echo5-failed",
  "type": "execution.failed",
  "occurredAt": "2026-10-29T08:10:01.000Z",
  "executionId": "01M64000000000000000000005",
  "data": {
    "error": {
      "code": "execution_failed",
      "message": "Execution could not produce a result.",
      "details": {
        "operation": "encode-text",
        "encoding": "unsupported-test-encoding"
      }
    }
  }
}
```

code/message 是固定错误契约，details 是可选的类型诊断对象；不通过 message 推断状态。
错误位置枚举、HTTP 错误码映射在实施契约中统一，不把来源业务的错误 stage 枚举强加给所有类型。
非法或超限业务载荷须明确报告，不允许截断后假装是完整结果。

## 6. 业务前置判断的结果

通用 Request 不声明 prerequisites，API 不接受前置证据提交/解锁命令，snapshot
不包含 readiness 对象或 blocked stage。业务校验拒绝不属于其输入的旧字段，
不能忽略旧条件并以为用户已获得相同的等待保证。

Executor 已取得租约并进入 execution 后可做轻量前置判断，不满足则返回业务结果，
例如某个业务 TaskType 定义如下结果；字段不是通用引擎结果结构：

```json
{
  "performed": false,
  "reason": "target-unavailable"
}
```

该结果走 execution.completed 及 Task completed 正常路径，不表示重工作执行成功。
判断故障抛错走 execution.failed，不通过专用通用 stage 表达业务“不满足”。
再次尝试使用新业务请求或显式 recurrence；引擎不保留当前 Task 等待将来解锁，
不新增 waitUntilReady、条件 TTL 或隐式重试。具体业务可报告子任务引用作为
进展/结果，引擎只验证契约和可见性，不据此增加条件调度。

运行能力见[执行与宿主组装](./execution-and-host-composition.md)；
所有类型使用纯 Validator/Equals 与必需 Prepare/Allocate，不要求 inputSchema。

## 7. HTTP 映射

挂载前缀由宿主选择。以下路由是候选接口，HTTP 适配器不自行监听：

| 操作 | 候选路径 | 语义 |
|---|---|---|
| submit | POST /tasks | header + body 还原实体；成功返回 snapshot 和可查询的 taskId |
| getTask | GET /tasks/{taskId} | 读取投影，不改变事实 |
| cancelTask | POST /tasks/{taskId}/cancel | 显式取消需求，不代替断开 SSE |
| getRequest | GET /requests/{requestId} | 原始意图或明确的审计/不可用响应 |
| readHistory | GET /event-history?taskId=... | 有界分页，不等于实时连接 |
| subscribe | GET /events?taskId=... | 观察流，按下文的初始水位与事实位置续读 |

HTTP body 保留 type，只有 requestId 移入 header；这与核心 submit 输入完全等价。
executionMatch 同样保留在 body，类型提供的 equals 不将其纳入业务输入比较。

```http
POST /tasks HTTP/1.1
Host: 127.0.0.1:8080
Content-Type: application/json
Idempotency-Key: 01M64000000000000000000001

{
  "type": "echo",
  "text": "hello",
  "executionMatch": "started-after-eligible",
  "eligibleAt": "2026-10-29T08:00:10.000Z",
  "timeoutMs": 30000,
  "recurrence": {
    "periodMs": 60000,
    "anchor": "eligible"
  }
}
```

认证凭据省略仅为示例可读，不表示这些端点匿名公开。
若宿主保留专用路由，其操作与 body.type 必须一致；未知类型或冲突不能静默改写。
错误候选映射：格式/类型校验失败为 400，认证/授权失败为 401/403，
幂等冲突及对其他终态的取消为 409；资源不可用、游标过期等必须另有明确错误契约。
body 解析失败仍用合法 header 身份审计，不伪造完整 Request 或默认 type。

HTTP 重连、分页面和实时流交接必须来自同一事实边界；
不能用 snapshot.timestamp 作为严格游标，也不能把 task.updated 回灌 reducer。
身份授权、速率/字节限制和历史保留应明确，不宣称无限历史。

### 分页、SSE 与保留规则

历史查询首轮捕获一致水位 W，分页只读取该过滤条件下不超过 W 的事件，按提交序号排序；
续页游标绑定存储域、过滤条件、水位及已读位置，不使用 occurredAt/timestamp 排序去重。
cursor 对外不透明，每次读取重新授权，游标不是访问凭据。数据库替换或过滤条件变化
不得无声复用旧游标；无效游标返回明确错误。

新订阅先在一致边界捕获 snapshot 与水位 W，再接续 W 后的事实；两步之间的事件必须
保留/补读，不能依赖无锁的“先查询后注册”。续订从最后确认的位置补读，允许重复投递，
按事件位置去重；不承诺 exactly-once 传输，也不通过重连新建 Task。
Last-Event-ID/续读令牌使用此事实位置，不使用快照生成时间。

task.updated 和时间经过产生的快照通知不是持久事实，不能推进事实位置或回灌 reducer；
重连时可重新投影当前时间状态，不承诺重放每次纯时间通知。若未来增加帧序号，
必须与持久事实 cursor 区分。慢消费者的缓存必须有界，超限断流并允许按游标补读。

保留策略由宿主显式配置并持久记录清理水位；超出保留范围的游标返回 410/history_expired，
不伪装为空页或从当前头静默继续。仍被未完成任务、未处理后继、有效幂等窗口或恢复所需
的事实不得删去。活跃/恢复所需记录不能为了满足容量上限被驱逐；容量不足应背压或拒绝
新准入。内存缓存和持久历史的保留不混为一谈；准确窗口数值在实施验证中固定。
