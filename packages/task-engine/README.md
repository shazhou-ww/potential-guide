# @potential-guide/task-engine

按 Bundle 根 CID 字符串或 `{cid, hint}` 受理 Request，协调独立 Task 与可共享的完整 Run。
没有类型注册、当前版本选择或 `discoverTypes`。名称只展示，CID 确定内容。

```ts
const engine = createTaskEngine({
  store,
  ipfsClient, // caller 创建的通用 IPFS client，连接独立本地 Kubo endpoint
  authorize: (caller, _operation, scope) => caller.scope === scope,
});
await engine.start();
const submitted = await engine.submit(request, caller);
const result = submitted.status === "preparing"
  ? await engine.getRequestStatus(request.requestId, {waitMs: 1000}, caller)
  : submitted;
if (result.status === "accepted") {
  const task = engine.getTask(result.taskId, caller);
}
```

`preparing` 不是 Task。返回前保存原 Request、窗口资格与恢复依据；
accepted 与 Task 创建原子持久化，rejected 也保留幂等依据。
共享获取按规范化根 CID，不共享逐 Request 的输入校验或结果；hint 不参与匹配。
准备没有整体截止；停止观察不取消处理，Task 时间只在最终创建时锚定。
`getRequest` 读取原始意图，`getRequestStatus` 独立读取处理结果。

每 Run 以内存 CommonJS source 启动已验证 `worker.cjs`，不加载作者 factory，也不启动历史业务复验 Worker。
`context.bundle.read(path, {signal?})` 返回背压/取消友好的 `ReadableStream<Uint8Array>`，
不提供宿主路径或平行的整文件 API。需要完整字节时由调用方聚合。
SDK 延迟到 Run 命令后才求值作者模块。宿主确认物理退出后裁决终态，回收是另一事实。
历史查询使用持久事实，不要求缓存仍在，也不重演旧 Run。

Facts/SQLite v5 明确拒绝 v4 等旧格式；操作者必须显式选择新域。
`collectRequestResults()` 只清理终态跟踪可见性，不删除 Task；
`collect()` 继续管理 Task/Run 历史的受保护保留边界。

宿主可配置 `bundleLimits`、`bundleConcurrency`（默认 4）及通用 Engine limits。
`maxPreparing` 默认 1000，`maxWaitMs` 默认 30,000ms，
`requestResultRetentionMs` 默认 86,400,000ms。队列等待不构成 preparation 超时。
完整 DAG、声明、Schema 闭包、路径和容量校验在 Task 创建前完成。
内部内存复用使用有界 verified blocks 及租约保护在途准备/运行，不提供公开缓存管理 API；
Engine 不维护额外的 Bundle 文件缓存目录，持久内容、pin 与 GC 由独立 IPFS 节点管理。
`bundleLimits.protectedBytes` 默认 256 MiB，是所有受保护块的总量预算；超限明确拒绝。
Engine 不启动/停止节点、不关闭共享 client，也不删除共享或发布者 pin。
gateway 默认禁止访问；宿主通过 `allowGateway(url)` 明确授权，所有 gateway 块仍须 CID 校验。

原 Input 判等包含合法额外字段；实际提前退出可使 terminates 匹配失效，
纯 now 回拨及 recovery stopped 不触发该例外。失效和后续匹配沿源 revision 观察。
冻结分页、订阅补读、完整集合封装和 scope 授权保持不变。

`testing` 提供非持久 MemoryStore / VirtualClock；旧协调器资源 fixtures
只是内部回归测试，不是生产注册 API。`pool` 保留业务资源协调工具。
Worker 不是 OS 安全沙箱。

完整接口与边界见 [Task Engine](../../docs/task-engine.md)、
[Worker 协议](../../docs/task-bundle-worker.md)。
`EngineOptions.logs` configures bounded diagnostic storage independently from
lifecycle facts. `getRunLogs` and pull-based `subscribeRunLogs` authorize Run
reads and expose capacity, expiry, gaps and completeness. Existing v1 bundles
use the sole evolving v1 protocol; unsupported stored URL/Digest submissions are
explicitly rejected without migration. See
[Run Logs](../../docs/task-run-logs.md).
