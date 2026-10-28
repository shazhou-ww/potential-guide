# Check Host v2 API 与 SDK

## 资源与信任边界

- Artifact：以逻辑 digest 标识的不可变 Check 制品及通用 References。
- Task：一次独立观察需求，具有自己的期限、新鲜度、取消和结果。
- Execution：实际执行调用；对调用方只提供关联证据，不开放直接启动/取消接口。
- Worker：Host 内执行资源，不属于普通客户端管理面。

v2 首先面向鉴权的本机 Host，不因接受 HTTPS 制品来源而自动变成多租户远程执行平台。
若提供远程访问，必须另外落实传输、身份及资源访问授权；不能仅依靠 URL 或 taskId。
主体隔离必须由服务端验证，SDK 的过滤不是权限边界。

## 接口集合

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/v2/check-tasks` | 创建 Task，自动确认版本与准备制品 |
| GET | `/v2/check-tasks/{taskId}` | 当前权威快照 |
| POST | `/v2/check-tasks/{taskId}/cancel` | 撤销该 Task 的观察需求，终态不反转 |
| GET | `/v2/events?taskId=a&taskId=b` | 一条 SSE 过滤监听一个或多个 Task |
| GET | `/v2/events?scope=all` | 显式监听当前认证主体有权观察的 Task |
| POST | `/v2/artifacts/resolve` | 按 URL 确认当前准确内容与元数据 |
| GET | `/v2/artifacts/{digest}` | 已准备的准确制品元数据 |
| GET | `/v2/artifacts/{digest}/references/{referenceId}` | 读取通用 Check/problem Reference |

不再提供 `/v2/events/{taskId}` 或 `/v2/check-tasks/{taskId}/events`。
没有过滤且未显式请求 all 的订阅应报输入错误，避免不经意地订阅整个可见范围。
Artifact 查询不猜测来源，也不将不在缓存的内容伪装成 ready。

## 创建请求

```http
POST /v2/check-tasks
Idempotency-Key: <调用方请求键>
Content-Type: application/json
```

```json
{
  "check": {
    "url": "https://example.com/check.tgz",
    "digest": "sha256-pguide-check-v1:<64 lowercase hex>"
  },
  "subject": { "root": "D:\\project" },
  "freshness": "started-after-request",
  "timeoutMs": 30000
}
```

- `check.url` 必填；`check.digest` 可选，不提供仅 digest 的创建形式。
- 省略 digest：确认来源当前内容；提供 digest：只接受准确内容，准确缓存可直接复用。
- `subject` 是有限 JSON 对象，按 Check 契约校验；Host 不解释业务达标含义。
- `context` 可选，为影响执行的 JSON 上下文；必须参与兼容与授权判定，不作为绕过权限的通道。
- `freshness` 为 `started-after-request` 或 `completed-after-request`，默认前者。
- `timeoutMs` 从服务端受理到结果交付，包含来源确认、下载、准备、排队和执行。
  省略时使用有界服务默认值；非法值明确拒绝，数值及服务上限在实施时固定。

完成鉴权、结构校验和容量准入后，原子记录受理序号、acceptedAt 和单调期限，创建
Task 并返回 `201 Created` 和 Location。耗时准备在之后进行，不阻塞创建响应直到执行结束。
输入或准入失败直接返回错误；已创建 Task 的后续准备失败进入该 Task 的 failed 快照。

```json
{
  "taskId": "task-123",
  "hostInstance": "host-instance",
  "state": "accepted",
  "acceptedAt": "2026-10-28T09:00:00.000Z",
  "freshness": "started-after-request"
}
```

## 幂等与有限保留

幂等键在来源解析之前判定，并按认证/调用作用域隔离。相同键和相同规范化请求返回
原 Task，不重新设置受理时点、期限或浮动版本；同键不同内容返回 409。
SDK 为创建操作生成并复用键；无幂等保护的网络失败不能触发盲目自动重建。

Task、幂等记录和结果具有公开、有界的保留策略，携带 Host instance。第一版不承诺
跨重启持久或 exactly-once；记录不可用时明确报告，不能透明重跑或将 latest 重绑定为旧请求。
GET 不存在/过期记录的精确错误码及保留窗口在实施协议固定，不虚构永久可查询承诺。

## 快照与终态

| 状态 | 含义 |
|---|---|
| accepted | 已受理，时间下界和期限已建立 |
| preparing | 确认来源、下载、校验或准备准确制品 |
| waiting | 准确制品已确定，等待合适的 Execution |
| running | 关联到正在运行且可满足本请求的 Execution |
| completed | 正常取得业务结果，不代表业务通过 |
| failed | 准备、执行、期限等失败，带结构化原因 |
| cancelled | 本 Task 不再需要结果，不代表共享 Worker 已退出 |

可以跳过不需要的中间状态。解析完成后匹配保留结果，也可以直接 completed，无需
伪造一段 running。completed-after-request 的关联执行可能早于 Task 的受理时点开始。
终态不可反转，Task 超时以 failed 和明确的期限错误表示。

成功快照包含 taskId、hostInstance、executionId、准确 artifact digest、受理和执行
开始/完成时间以及业务 result；时间戳用于展示，内部正确性依赖统一的单调时序。
实际执行 revision 与安全的来源证据应可追踪，不向普通结果泄露服务端目录、token、
私钥、签名 URL 参数或原始远端诊断。

failed 使用 `error: {code, stage, message}`。stage 区分 resolve/download/verify/
schedule/execute/cleanup 等，期限/取消原因明确；不能把调用失败包装成业务不达标。
同步输入/鉴权/容量等 HTTP 错误遵循同一结构；400/401/403/409/429/503 的适用边界
在实施 schema 中落实。错误诊断不能成为凭据泄露通道。

## 单一过滤 SSE

```http
GET /v2/events?taskId=task-a&taskId=task-b
Accept: text/event-stream
```

```text
event: task.updated
data: {"taskId":"task-a","snapshot":{"state":"running"}}
```

列表去重并限制长度；每个 ID 都做授权和存在性检查，初始非法列表明确失败，不静默
忽略缺项。订阅先交付每个 Task 的当前快照（包括终态），再交付变化。
注册监听与捕获初始快照具有一致时序边界，避免刚完成的 Task 丢失通知或快照倒退。
每个快照/事件需有可比较修订标记，SDK 可去重并拒绝旧快照覆盖新状态。

all 范围仅包含认证主体被授权的 Task，并受容量约束；不能由任意 clientId 扩大权限。
事件连接断开或取消本地订阅不取消 Task。事件是有界通知，服务对慢消费者背压或断开；
不承诺进度历史完整重放。重连必须补当前快照并检测记录失效，不能创建新任务代替恢复。
订阅期间记录不可用也必须明确通知，不能让等待者无限等待一个已消失的 Task。

SDK 每个 Client 复用一条过滤流并按 taskId 分发；单 Task 是列表特例。
列表变化可重新建立连接并补快照，不在第一版增加可变 Subscription 资源。
SDK 必须在终态确认前持续覆盖关注列表，不能因为过滤重建丢失最终结果。

## URL 版本查询

`POST /v2/artifacts/resolve` 的请求为 `{url}`，返回本次确认的 digest、checkedAt
和 manifest 等安全元数据。它可能下载并校验制品，不保证是廉价 HEAD 请求；
不是查询旧缓存假装最新，也不是枚举 GitHub 全部历史版本。
调用方可以用查询结果组成后续 URL + digest 请求，将一组检查固定为同一准确版本。
来源放在请求体中，但日志仍须脱敏，不能因为不是 query 参数就任意记录凭据。

## CheckTask SDK

```ts
const task = await client.check({
  check: { url, digest },
  subject,
  freshness: "started-after-request",
  timeoutMs: 30_000,
});
const snapshot = await task.snapshot();
for await (const event of task.events({ signal })) {
  // 同一 SSE 的对象级分发
}
await task.cancel();
```

只有一个创建入口，不另设 createCheckTask。对象具有稳定 taskId。
snapshot 查询服务端当前状态，events 提供当前快照及后续通知，cancel 撤销本 Task。
多 Task 通过 `client.watchTasks([taskA, taskB], {signal})` 使用同一事件协议。

```ts
const result = await task.result();
```

result 等到正常完成后返回业务结果与准确观察证据；业务不通过正常返回，
执行失败、期限和取消明确 reject。多次调用、多个等待者或多次订阅都不触发新执行。
events/watchTasks 的 signal 只结束该订阅；取消任务必须明确 cancel。
不同时保留语义重叠的 result/termination 两种终态约定，也不把同类失败一会儿 resolve
一会儿 reject。SDK 关闭连接不等于取消所有远端 Task。
