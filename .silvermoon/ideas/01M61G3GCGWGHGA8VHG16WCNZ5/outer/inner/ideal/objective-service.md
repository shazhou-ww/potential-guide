# 可挂载的 Objective 服务、HTTP 与 SDK

## 修订阅读说明

本文保留 `127666e4ec04` 候选之前的服务设计，作为 Before 基线。
2026-10-29 新增的 [Request 生命周期修订](./request-lifecycle-revision.md)
按对象定义本次 After：eligible 时间锚点、PENDING、递归系列、提前准备/fallback、
pending-only 取消、未完成 Task 持久恢复以及 series events。
下文原受理时间、任意非终态取消、仅内存 Task 和 taskId 过滤的描述是旧版语义，
不是新草案的另一套选择；其余组合观察、准确制品与权限边界继续保留。
新参数、状态与版本迁移仍需评审，不表示当前代码已实现。

## 组装边界

服务核心拥有状态机与业务规则，Router 仅适配 HTTP/SSE，统一 Host 管理监听、认证、
配置与生命周期。Check、Objective 及未来 Regulation Router 可挂同一进程不同前缀。
Objective 核心通过 Check Service 接口调用，同进程不绕本地 HTTP；远程 adapter
必须保留来源、主体和授权语义，不能把“可分离”误称为已具备远程多租户部署。

Objective 服务管理制品、解释 Pilot、处理动态依赖及 References，不运行 Agent 或修复。
Coordinator 的治理调度不搬入这里；本项只为后续 Regulation 服务保留可组合接口。
已完成的 Check Host 调度不重做，只适配新 Checker 契约及可挂载入口。

Objective 不声明统一 runtime；Checker Host 按各制品 runtime.type/minVersion 和
entry 选择受支持 adapter。本轮只交付 Node，不因当前实现语言相同而在 Objective
协议中加入同 runtime 限制。实际执行环境不满足声明时在调用前明确失败。

## 路由与数据形状

以 /objectives/v1 为示例挂载点，模块自身不创建 listener 或固定公共前缀。
协议版本独立于 Check v2，结构与其保持对称。制品参数由 check 演进为 checker
时须同步 Check HTTP/SDK schema；不能在旧协议里悄悄改字段。

| 方法 | 相对路径 | 语义 |
|---|---|---|
| POST | /probe-tasks | 创建独立观察需求，201 + Location + 初始快照 |
| GET | /probe-tasks/{id} | 当前权威快照 |
| POST | /probe-tasks/{id}/cancel | 撤销该需求，返回快照 |
| GET | /events?taskId=a&taskId=b | 单一 SSE，可显式 scope=all |
| POST | /artifacts/resolve | 请求 {url}，返回当前准确内容与元数据 |
| GET | /artifacts/{digest} | 仅查询准确缓存，不猜来源 |
| GET | /artifacts/{digest}/references/{id} | 组合后的页面，可显式 language |

Reference ID 作为一个编码路径参数；保留全页元数据、正文与 owning digest/path。
Objective 需多语言与组合；Checker 页面 API 应协调结构，不以 raw 文件接口替代语义页面。
无 resources API。有效语言按请求/Host 策略选择，返回实际语言。所有缓存读取仍需授权。
Objective 总览页面 ID 为 objective，来自所选语言目录的 objective.md；不提供
system/overview 或 system/404 的新格式别名。准确制品的有效页面集合中不存在所请求
ID 时，返回 HTTP 404 和结构化 reference_not_found 错误，不返回 fallback 正文或成功
快照。不支持的语言仍是明确的语言错误，不通过缺页逻辑静默换语言。

创建请求示例：

```json
{
  "objective": {
    "url": "https://example.com/objectives/workspace.tgz",
    "digest": "sha256:<64 hex>"
  },
  "subject": {"root": "D:\\project"},
  "language": "zh-CN",
  "freshness": "started-after-request",
  "timeoutMs": 60000
}
```

context 为可选的有限 JSON 执行上下文，不是权限授予；bindings 可携带既有准确依赖
绑定。普通首次 probe 不需 resolve 或创建会话。默认完整观察，保留显式 initial
输入验证能力；不把 Regulation 目标等级当提前短路观察的参数。

Task 快照与 Check 保持 taskId、hostInstance、revision、state、acceptedAt、
freshness、artifact、executionId、executionStartedAt、executionCompletedAt、
result、error 的结构。新增 language、progress、evidence。state 为 accepted、
preparing、waiting、running、completed、failed、cancelled，可跳中间态但终态不反转。
artifact 返回准确 digest、来源确认时间、manifest 和可用传输摘要；Objective 不伪造
worker revision。result 为演进后的 PilotObservation，current/problems/gapSummary/
observedAt 和准确来源绑定保持业务含义；移除全局 id 后引用使用带类型准确地址。
叶子执行证据同时记录实际 runtime 类型、版本和影响执行的配置；不以 manifest 的
最低版本代替实际环境，也不把 Host 服务自身的实现语言当作 Checker runtime。

completed 表示有有效观察，不表示已达 Regulation 目标。失败使用
error:{code,stage,message}，区分 resolve/download/verify/validate/schedule/observe/
cleanup。创建前错误为 HTTP 错误，受理后准备/执行错误进入失败快照；具体 status/code
表在实施契约固定。返回源信息脱敏，不暴露本地缓存目录或凭据。

总期限从服务准入起计，含来源确认、准备、排队、检查、依赖和结果交付。内部调用只用
剩余预算；独立执行另有不可由后来请求延长的墙钟保护。限额数值在实施阶段确定并测试，
不能直接照抄单 Check 的预算假定整个 Objective 够用。

## 双 freshness 与共享

Task 是独立需求，Observation Execution 是一次实际组合观察，不合并 Task。
受理 a、实际观察开始 s、正常完成 c 在同一 Objective 调度域的单调时序中仲裁：

- started-after-request（默认）：s > a。
- completed-after-request：c > a，允许加入已运行且兼容的整个观察。

兼容键至少包含准确根 digest、固定依赖绑定约束、规范化 subject/context、有效语言、
授权与资源作用域、实际 runtime/adapter 环境及执行策略。freshness 为逐 Task 条件，不必放进兼容键。准确绑定
冲突不得共享；晚解析请求在原子仲裁中匹配保留结果/运行执行/预约新执行，不能因网络
完成顺序不同丢失可用结果。只有在前一执行封口前才能关联。

多个排队强请求可共享后来开始的一次执行，运行后到达的强请求要新执行。弱请求可以
使用受理前已完成的部分 Check，只要求整次观察在受理后完成；不能宣传为每个叶子都新。
新建 Observation Execution 后才创建强语义叶子 Check Task，固定其准确版本，动态
依赖同样遵循该因果边界。强观察不直接复用先前执行的叶子结果；跨服务不比较客户端
墙钟。使用现有 Check Host 调度可在满足其强条件时共享叶子执行。

此定义不承诺工作区原子快照，也不能修复 Checker 内部擅自使用旧业务缓存的行为。
Observation Execution 开始点必须早于任何业务观察，不能迟到收到通知才标记开始。

一个 Probe 取消/到期不伤其他需求；最后需求撤销后封口并取消本执行拥有的子 Task，
不能直接杀仍服务其他需求的共享 worker。迟到结果不能复活终态，清理未确认不宣称资源
已释放。取消后新任务不加入退出中的执行。

## 事件与阶段进展

沿用 task.updated，数据为 {taskId,snapshot}，单/多 Task 共用 SSE。首次订阅发当前
快照，之后按 revision 更新；不订阅无过滤的隐式 all。恢复订阅不重新创建任务。

progress 展示当前 level、已达成 level、逐 level 状态、逐 invocation 的 Check
Task/Execution 关联及依赖观察父子关系。每条 invocation 包含根/依赖来源、level
及局部 checker 名称，避免同名或依赖解析后二次调用互相覆盖。外层服务投影子任务
状态，不原样代理底层 SSE。Check completed 不等于 ok，level 结束不等于 attained。
默认展示业务阶段，不需要 Checker 任意内部日志。

Task 自身 revision 同时覆盖进展与终态；共享执行的变化投影到各个仍有效 Task，
取消的 Task 不继续推进。重连得到当前有界快照，不承诺所有中间状态重放。详细历史
属于 evidence；动态依赖不假装固定总量或百分比。限制深度、invocation、快照和队列。

## SDK 对称

本节为当前 TypeScript SDK 的实现约定，不是跨语言协议。其他语言分别实现自己的
SDK，无需模仿 JS 类、Promise 或 AsyncIterable；须遵守相同 HTTP 数据与生命周期语义。

```typescript
const client = new ObjectiveTaskClient(address);
const task = await client.probe({
  objective: { url, digest },
  subject: { root },
  language: "zh-CN",
  freshness: "completed-after-request",
  timeoutMs: 60000,
});
const completed = await task.result();
console.log(completed.result.current);
```

与 CheckTaskClient/CheckTask 保持相同范式：

- client.probe(request,{idempotencyKey?}) 返回 ProbeTask，不先 resolve 成 ObjectiveHandle。
- task.snapshot()/events({signal})/result()/cancel()。
- client.watchTasks(tasks,{signal})、taskSnapshot(id)、cancelTask(id)。
- resolveArtifact(url)、artifact(digest)、reference(digest,id,{language?})、close()。

SDK 校验有限 JSON，不调用 getter/toJSON 隐式转换；创建网络重试复用幂等键。相同键
不同规范化请求报冲突；原 Task 的受理时点、期限、版本不重置。断流、关闭 SDK 和取消
本地监听不取消服务端 Task；显式 cancel 才撤销需求。失败、取消、过期和 Host 重启
明确区分，不透明重跑，不承诺跨重启 exactly-once 或永久保留。

HTTP adapter 和进程内 adapter 使用相同服务语义及可序列化形状，统一 Host 的共享
认证/日志/关闭不改变各模块任务所有权、预算与缓存边界。
