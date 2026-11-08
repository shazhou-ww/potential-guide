# Task Bundle Worker 通信

本文定义唯一 **v1**，包含 [Run Logs](task-run-logs.md) 的独立诊断消息。
项目尚未正式发布，v1 在发布前原地演进；已移除的 Task v2 与未来未知
Schema URL 明确拒绝，不作为 v1 别名。禁用日志和自定义宿主不支持诊断仍明确不可用。

`https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task/v1.json`
同时固定声明与以下协议。没有独立数字版本。运行库为
`@potential-guide/task-sdk`，仅提供 Worker 运行时与类型。
作者使用 [`pguide task-bundle`](../packages/pguide-task-bundle/README.md)；
底层构建、制品校验和发布 API 也归属该作者工具包，不由 SDK 提供。

本协议对应生成的单个 `worker.cjs`，不导入作者 factory、不创建第二层执行 Worker，
也不含历史业务复验或宿主业务资源 RPC。
当前生成、Engine、HTTP 与独立消费测试均已接通。

## 初始化与身份

宿主可从经过完整 CID/DAG 和 Bundle 校验的有界 CommonJS source
以 `new Worker(source, {eval:true, workerData})` 启动，不依赖物理 Bundle 目录。
可信 workerData 为：

```ts
{
  generation: string;
  maxInFlight: number;
  maxPayloadBytes: number;
  bundle: {
    cid: string;
    declaration: ResolvedTaskBundle;
  };
}
```

`declaration` 是同一已验证文件树离线解析后的三份 Schema 与原声明字段。
作者入口显式调用 `runTask(callback)`；构建器只绑定声明，不生成或绑定业务 validator。
Worker 先核对宿主声明与构建锁定声明，再发送 ready。
宿主仍须独立核对握手与已验证 `task.yaml`，不能信任 Worker 自述。

CID 解析、规范化、codec/hash 限制和内容哈希/DAG 校验属于宿主准入。
Worker 仅检查 `bundle.cid` 是长度为 1 至 256 的字符串，将其作为不透明标识
原样放入 ready，不解析 CID，也不解释 DAG-PB/raw 编码。宿主必须将 ready
中的 CID 和三份 Schema 与当前已验证 Bundle 比较，匹配后才投递 Run。
资源读取只传 Bundle 相对路径，由宿主绑定当前根 CID、检查路径并解析内容；
Worker 不能通过资源消息选择另一个 CID。

所有消息带 `generation`；不同 generation 的消息无效。
每个 Worker 最多接收一个 Run；宿主在投递 run 前已持久确立开始事实。

## 消息

Worker → 宿主：

| kind | 其他字段 |
| --- | --- |
| ready | `value: {$schema, cid, inputSchema, resultSchema, messageSchema}` |
| pong | 无 |
| progress | `id, runId, value: RunProgress` |
| checkpoint | `id, runId, value: Result` |
| task-invoke | `id, runId, value: {key, cid, path, input, timeoutMs}` |
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
| ack | `id, value?: Json, error?: {code, message}` |
| log-ack | `runId, logId, value: RunLogReceipt, error?: {code, message}` |
| log-drop-ack | `runId, logId, value: RunLogReceipt, error?: {code, message}` |
| message | `runId, value: {taskId, messageId, caller: {scope, subject}, payload}` |
| withdraw | `runId, taskId, reason?` |
| cancel | `runId` |

需确认的业务 Worker 消息使用从 1 起严格递增的 id，作用域为 generation；
宿主按相同 id ack，错误 ack 拒绝相应操作。不重用旧通道或重复确认身份。
进度、checkpoint 和业务消息确认通过同一有界输出队列排空，之后才报告结果。
三份业务 Schema 都在同一构建内固定，运行中不联网补引用。

`task-invoke` 是通用宿主中介调用，不是 Probe 分支或任意资源 RPC。
`value` 在成功 ACK 中为独立子 Task 的已校验结果；失败 NACK 返回明确错误。
key 在父 Run 内稳定，相同 key 的不同意图被拒绝。宿主继承 caller，验证嵌入
resources 目录根 CID、准入权限、输入/结果和父生命周期；默认拒绝组合。
父子关联与原始请求在 admission 之前原子持久化，重试不产生第二个子 Task。
每深度执行池和深度/并发/总量/截止时间预算防止等待父任务占满子任务容量。
父撤回、退出和恢复执行有界清理；无法证明释放时返回 reclamation_unknown。
调用不占用业务输出队列，但占用同一有界 IPC 在途额度，宿主仍跟踪其清理责任。

完整业务校验统一属于 Engine：input/message 在投递前验证，checkpoint、
complete 和 failed.result 在任何接纳或持久化前验证。Worker 不执行业务 Schema
或输入投影。JSON 形状、结构深度/节点和字节限制、日志/进度载荷也由 Engine
在接纳前检查，Worker 不重复遍历或规范化业务载荷；仍保留队列、身份、启动声明
一致性、ACK/NACK、取消和资源流控制。

不能通过 Node structured clone 的值在发送端以 `invalid_payload` 拒绝；
发送失败不消耗消息序号或在途额度，仍能发送失败报告。可克隆但非 JSON 或超限的
值由宿主 NACK 拒绝。structured clone 可能执行 getter 并将自定义对象转换为普通
对象；宿主验证收到的表示，不保证检查作者原对象的描述符。作者应传普通 JSON。
启动声明比较仍使用 canonical JSON，不属于本次移动的业务载荷校验。
SDK 固定依赖不包含 schema-runtime、自动 validators、Ajv 或 CID 解析器；
作者主动导入 validator 是另外的业务依赖。

错误 ACK 不代表终态已提交。SDK 在 complete 被拒后报告 failed；checkpoint
被拒后，即使业务捕获异常也不能改成成功；failed.result 被拒后，使用宿主错误
重新报告不带被拒证据的 failed。Engine 记住拒绝状态，不允许后续 complete
覆盖它；自定义 Worker 忽略 NACK 后退出，也必须形成失败而非丢失结果。
非取消路径须在终态 ACK 成功后请求正常 released；取消保留 stopping/release 路径。
真正回收仍须等物理退出与资源清理证明。
无法确认终态通道时报告 uncertain，不假装成功。自定义宿主须实现上述责任，
不能仅用 permissive ACK mock 声称完整验证通过。

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
context 提供 `runId`、`generation`、`startedAt`、`scope`、`signal`、`messages`、`progress`、`checkpoint`、`log`、`invokeTask`；
不暴露原始 parentPort。每条业务消息提供独立 Task 撤回信号和 accept/reject。
`identity` 来自宿主已持久确立的 Run，不从业务 Input 合并或推导。
作者模块及其顶层业务代码延迟到 Run 命令后才求值；握手不执行作者业务模块。

构建器的共享 Schema 参数为 `{path, digest}` 列表，digest 是该 JSON 文件原始字节的
SHA-256。完整传递闭包必须已锁定且可用；URL 不是更新通道。
构建结果的 Bundle 身份是标准 UnixFS 目录根 CID，与单个 Schema 文件锁不可混称。

## Bundle 只读流通道

SDK 的 `context.bundle.read(relativePath, {signal?})` 返回标准
`ReadableStream<Uint8Array>`，不提供宿主路径或整文件平行 API。
通道仍带 generation，由当前 Run 的可信上下文限定当前根 CID：

- Worker `bundle-pull {runId, readId, path}`：每个流最多一个在途 pull；
  第一次 pull 创建读取，之后只推进同一个迭代器。
- 宿主 `bundle-data {readId, done, chunk?}` 或 `{readId, error:{code,message}}`：
  区分完整结束、数据与创建/消费中途失败，不把错误或截断当 EOF。
- Worker `bundle-cancel {runId, readId}`：取消底层读取并释放迭代器；
  用户 AbortSignal、Run 停止及 Worker 退出同样取消自有读取。

SDK 使用 highWaterMark:0；不消费则不发送 pull。宿主限制活动流数量，
标准 UnixFS exporter 以 256 KiB range window 有界读取，避免其内部 eager queue
在暂停消费时聚合整个文件。标准库负责 DAG 解释、范围及截断校验。
所有文件、Schema 闭包及 DAG 块在 admission 前已完整验证；运行时流不会绕过准入。

根运行入口不导入构建器。除 Node 内置模块外，所有代码依赖必须进入 worker.cjs；
不支持的动态依赖或原生扩展构建失败。Worker 不是安全沙箱。
