# 接口与数据示例

本文是[新引擎 idea](./Idea.md)的接口草案，直接定义角色和完整示例，
不提供现有协议对照，也不承诺这里的方法名/URL 已可调用。
固定约束见[概念定义](./concepts.md)，模块所有权见[系统边界](./system-boundaries.md)。

例子使用宿主注册的测试类型 echo；它仅返回文本，用于证明核心不依赖制品业务。
所有 ID、时间和文本都是合成数据，示例类型不是生产内置操作。

## 1. 通用 Request 与具体类型

通用部分包含 requestId、type、可选 eligibleAt/seriesId/recurrence 及本请求 timeoutMs。
type 是判别字段，应用将已注册类型组合为 discriminated union；
引擎不固定 check/probe/regulate 的全集，也不接受任意未注册字符串。
类型的具体输入可以与公共字段同层组合，但其 schema 不能重新定义或覆盖公共字段。
不要求现在把所有输入迁到 input/payload，也不新增 metadata。

```json
{
  "requestId": "01M64000000000000000000001",
  "type": "echo",
  "text": "hello",
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
stage 是内驱位置；实际状态由 stage/canceledAt 派生，不重复 state/type/Request。
结果保持类型的业务形状，通用接口不能将所有 result 强制转换成 CheckResult。

### 3.1 已受理，时间尚未到

```json
{
  "requestId": "01M64000000000000000000001",
  "taskId": "01M64000000000000000000002",
  "seriesId": "01M64000000000000000000002",
  "stage": "pending",
  "receivedAt": "2026-10-29T08:00:00.000Z",
  "eligibleAt": "2026-10-29T08:00:10.000Z",
  "deadlineAt": "2026-10-29T08:00:40.000Z",
  "timestamp": "2026-10-29T08:00:00.000Z"
}
```

到 08:00:10 而实际准备未开始时，stage 可为 preparing，但不能补造 preparation.startedAt。

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

echo 没有额外条件，不伪造 readiness 通过时间。
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

deriveState 为 cancelled，isTerminated 为 true，isFailed 为 false。
取消未消费的规划权，但本例采用 eligible 锚点，如果已创建下一轮则不能回溯取消它。

## 4. 类型适配与内部准备结果

以下接口角色说明需要交换哪些信息；具体函数签名留到实施阶段，不预建复杂插件框架。

| 角色 | 输入 | 返回 / 报告 |
|---|---|---|
| 输入校验与业务授权 | 公共字段已校验的完整 Request、可信 caller | 类型化意图或明确错误，不静默删改字段 |
| prepare | 意图、预算、取消信号、适配器依赖 | 正式 prepared 结果或有分类的故障；过程事实由核心记录 |
| readiness 求值 | 条件声明、必要上下文、证据策略 | 满足/未满足/故障，附证据引用；不自动治理 |
| compatibility | 已准备的准确身份、输入、权限域 | 独立执行或可复核的兼容标识，不能绕过核心类型/作用域隔离 |
| execute | 不可变 prepared、执行上下文、停止信号 | 校验后的 progress、一个正常 result 或执行故障 |

echo 的正式准备返回示例：

```json
{
  "outcome": "ready",
  "prepared": {
    "handlerRevision": "echo-v1",
    "text": "hello"
  }
}
```

outcome 的协议意义由核心定义，prepared 内容由 echo 适配器 schema 定义。
它作为准备完成的内部不可变事实保留，用于恢复和确定执行输入，不自动摊入 snapshot。
公开历史是否披露该内部对象须经过授权/投影策略；不能把恢复数据默认全量暴露给调用者。
业务版本是可恢复事实，不在重放时重新选 latest；其版本策略仍须在实施前明确。
Checkpoint 可引用它，但不能只保留进程内 closure 而声称可恢复。

## 5. 事件载荷

下面每个 JSON 都是一条完整示例事件，不声称这些片段包含一个任务的完整历史。
cursor 仅为不透明位置示意，事件身份、跨流读取水位与传输续读协议仍需收敛。

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

## 6. 条件输入

内核不要求每个条件都以 Checker 制品实现。条件声明应有可识别的求值契约，
本例候选形状由宿主注册的 signal-ready 条件求值器解释：

```json
{
  "requestId": "01M64000000000000000000004",
  "type": "echo",
  "text": "ready",
  "timeoutMs": 30000,
  "prerequisites": [
    {
      "type": "signal-ready",
      "signal": "workspace-ready"
    }
  ]
}
```

echo 测试适配器在此声明支持该条件；具体应用可以限制某任务入口能否接受 prerequisites。
内核收到已声明的不支持条件时必须拒绝，不能忽略后制造“已受理”的假象。
该条件的 signal 与 Check 条件的 subject 均由具体求值器校验，
不允许仅凭一个任务 ID 就认定目标条件通过。
条件的类型组合方式和证据保留仍属实施前接口决策，此例不新增生产 signal 服务。

## 7. HTTP 映射

挂载前缀由宿主选择。以下路由是候选接口，HTTP 适配器不自行监听：

| 操作 | 候选路径 | 语义 |
|---|---|---|
| submit | POST /tasks | header + body 还原实体；成功返回 snapshot 和可查询的 taskId |
| getTask | GET /tasks/{taskId} | 读取投影，不改变事实 |
| cancelTask | POST /tasks/{taskId}/cancel | 显式取消需求，不代替断开 SSE |
| getRequest | GET /requests/{requestId} | 原始意图或明确的审计/不可用响应 |
| readHistory | GET /event-history?taskId=... | 有界分页，不等于实时连接 |
| subscribe | GET /events?taskId=... | 观察流，精确初始水位与续读语义须在实现前定义 |

HTTP body 保留 type，只有 requestId 移入 header；这与核心 submit 输入完全等价。

```http
POST /tasks HTTP/1.1
Host: 127.0.0.1:8080
Content-Type: application/json
Idempotency-Key: 01M64000000000000000000001

{
  "type": "echo",
  "text": "hello",
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
身份授权、速率/字节限制和历史保留应明确，具体协议收敛前不宣称具备无限历史或无缝续读能力。
