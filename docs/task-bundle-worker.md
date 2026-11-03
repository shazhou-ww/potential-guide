# Task Bundle Worker 通信

本文定义唯一 **v1**，包含 [Run Logs](task-run-logs.md) 的独立诊断消息。
项目尚未正式发布，v1 在发布前原地演进；已移除的 Task v2 与未来未知
Schema URL 明确拒绝，不作为 v1 别名。禁用日志和自定义宿主不支持诊断仍明确不可用。

`https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task/v1.json`
同时固定声明与以下协议。没有独立数字版本。运行库为
`@potential-guide/task-sdk`，作者构建入口为其 `/build` 子路径。

本协议对应生成的单个 `worker.cjs`，不导入作者 factory、不创建第二层执行 Worker，
也不含历史业务复验或宿主业务资源 RPC。
当前生成、Engine、HTTP 与独立消费测试均已接通。

## 初始化与身份

宿主直接以 `new Worker(worker.cjs, {workerData})` 启动，可信 workerData 为：

```ts
{
  generation: string;
  maxInFlight: number;
  maxPayloadBytes: number;
  bundle: {
    digest: string;
    declaration: ResolvedTaskBundle;
  };
}
```

`declaration` 是同一已验证文件树离线解析后的三份 Schema 与原声明字段。
生成入口调用 `runTask(callback, buildLockedDeclaration)`，
先核对宿主声明与构建锁定声明，再发送 ready。
宿主仍须独立核对握手与已验证 `task.yaml`，不能信任 Worker 自述。

所有消息带 `generation`；不同 generation 的消息无效。
每个 Worker 最多接收一个 Run；宿主在投递 run 前已持久确立开始事实。

## 消息

Worker → 宿主：

| kind | 其他字段 |
| --- | --- |
| ready | `value: {$schema, digest, inputSchema, resultSchema, messageSchema}` |
| pong | 无 |
| progress | `id, runId, value: RunProgress` |
| checkpoint | `id, runId, value: Result` |
| complete | `id, runId, value: Result` |
| failed | `id, runId, value: {code, message, result?}` |
| message-confirm | `id, runId, value: {taskId, messageId, state: "accepted" \| "rejected", reason?}` |
| log | `runId, logId, value: {level: "debug" \| "info" \| "warn" \| "error", message: string, fields?: JsonObject}` |
| log-drop | `runId, logId, count: number, final?: true` |
| stopping | `runId` |
| released | `runId` |
| uncertain | `runId` |

宿主 → Worker：

| kind | 其他字段 |
| --- | --- |
| run | `runId, scope, input, identity: {generation, startedAt}` |
| ping | 无 |
| ack | `id, error?: {code, message}` |
| log-ack | `runId, logId, value: RunLogReceipt, error?: {code, message}` |
| log-drop-ack | `runId, logId, value: RunLogReceipt, error?: {code, message}` |
| message | `runId, value: {taskId, messageId, caller: {scope, subject}, payload}` |
| withdraw | `runId, taskId, reason?` |
| cancel | `runId` |

需确认的业务 Worker 消息使用从 1 起严格递增的 id，作用域为 generation；
宿主按相同 id ack，错误 ack 拒绝相应操作。不重用旧通道或重复确认身份。
进度、checkpoint 和业务消息确认通过同一有界输出队列排空，之后才报告结果。
三份业务 Schema 都在同一构建内固定，运行中不联网补引用。

诊断消息另用从 1 起严格递增的 `logId`；log 与 log-drop 共用该序列，
不占用业务 `id` 或业务输出队列。宿主验证 generation、当前 Run 和可信 scope，
为接纳条目分配 sequence 和 receivedAt。ACK 必须匹配 generation、runId、logId；
错误 ACK 拒绝相应日志操作（宿主同时附 unavailable/storage receipt）。
RunLogReceipt 是 stored/sequence、dropped/reason 或 unavailable/reason，详见
[日志回执](task-run-logs.md#author-api-and-compatibility)。

SDK 每个 Worker 最多 `min(16, maxInFlight)` 条日志在途，每条 ACK 等待最多 1000 ms。
超时返回 unavailable/timeout，表示写入结果未知，不自动重试；取消立即释放等待，
未 await 的日志不延迟最终 Result 或 released。log-drop 的 count 是安全整数范围内
饱和的累计 SDK 容量拒绝数，不是增量；宿主仅累计增加部分。
常规丢弃通知最多一条未确认快照和一个 1000 ms 定时器；
超时后冻结常规发送，只有匹配的迟到 ACK 可重新开启。
结束时最多额外发送一条 `final: true` 累计快照且不等待 ACK，
因此失联宿主最多保留两条丢弃控制帧，不阻塞业务取消、输出或回收。

`released` 只表示 SDK 已结束回调和必要输出、关闭 inbox 并撤回上下文信号，
不表示 Worker 已物理退出。`uncertain` 表示最终输出或清理未确认；
均不能替代宿主观察的 Worker exit、强制终止和资源回收裁决。
宿主收到结果后仍须独立验证，并等待物理退出，才能形成 Run 的正常终结事实。
不响应取消的回调由宿主按现有宽限和强制终止规则处理。

## 构建和边界

作者只提供 YAML 与 `(input, context) => Promise<result>` 回调。
context 提供 `runId`、`generation`、`startedAt`、`scope`、`signal`、`messages`、`progress`、`checkpoint`、`log`；
不暴露原始 parentPort。每条业务消息提供独立 Task 撤回信号和 accept/reject。
`identity` 来自宿主已持久确立的 Run，不从业务 Input 合并或推导。
作者模块及其顶层业务代码延迟到 Run 命令后才求值；握手不执行作者业务模块。

构建器的共享 Schema 参数为 `{path, digest}` 列表，digest 是该 JSON 文件原始字节的
SHA-256。完整传递闭包必须已锁定且可用；URL 不是更新通道。
构建结果的 Bundle Digest 则是完整文件树的 Git SHA-256 OID，二者不可混称。

根运行入口不导入构建器。除 Node 内置模块外，所有代码依赖必须进入 worker.cjs；
不支持的动态依赖或原生扩展构建失败。Worker 不是安全沙箱。
