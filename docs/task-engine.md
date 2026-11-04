# Task Engine

Task 是独立需求；Run 是包含业务 preparation、allocation 和 execution 的完整尝试。
受理前 Bundle preparation 不是 Task 或 Run。
规范依据为 [Axis](axis/task-engine-responsibilities.md)。

v5 使用按需 Bundle、持久受理与下述统一消费协议。Check/Probe 作为自包含作者回调，
不进入通用宿主的注册表或资源桥。本轮不发布 npm；旧域必须由操作者显式切换。

## 按需受理

每个 Request 必带 `bundle: "根CID"` 或 `bundle: {cid, hint}`、`requestId`、`timeoutMs`，
可选 `eligibleAt`、`seriesId`、`matchPolicy`；其余合法字段是业务 Input。
CID 是标准 UnixFS 目录根内容身份；hint 是单个或有序多个 HTTP(S) gateway 基址，
不参与内容匹配。名称只展示、允许重名，不再支持 Task Bundle URL/Digest 或 tgz 链路。
没有 Bundle 注册、当前版本表、`discoverTypes` 或 `/task-types`。

```ts
const engine = createTaskEngine({
  store,
  ipfsClient, // 连接 caller 独立管理的本地 IPFS endpoint 的通用 client
  authorize: (caller, _operation, scope) => caller.scope === scope,
});
await engine.start();
const result = await engine.submit(request, caller);
const status = await engine.getRequestStatus(request.requestId, {waitMs: 1000}, caller);
const original = engine.getRequest(request.requestId, caller);
```

返回结果为：

- `{status:"preparing", requestId, trackingToken:requestId}`：尚未创建 Task。
- `{status:"accepted", requestId, taskId}`：Task 已可靠创建，不承诺仍保留全部 Task 明细。
- `{status:"rejected", requestId, error:{code,message}}`：已持久拒绝，不创建 Task。

Preparing 前保存完整原始意图、可信 Caller、到达时间、窗口资格与 Bundle 关联；
共享准备不共享输入校验和最终结论。accepted 与 Task 创建在同一次 Store append/
SQLite 事务中提交，rejected 同样保持幂等。停止观察不撤回处理。
明确网络/格式/Schema/Input 错误形成终态，不无限重试。

`getRequestStatus` 是唯一状态查询；省略/零 waitMs 立即读取，正值只等待 preparing，
到期仍返回 preparing。未知/已清理明确报错，不启动处理。
long poll 与 Task timeout、Bundle 准备相互独立。

## 窗口、时间和保留

每次新到达（包括重试）先检查
`L <= ULID时间 <= now+futureSkewMs`；
`L=max(持久旧L, now-windowMs)` 只前进。新域初始化下界，重启/回拨不撤回。
原始完整意图比较与 Input Equals 不同；同 ID 改 CID、hint 形状/顺序或任意字段均冲突。
Preparing 已获得的资格跨窗口推进和重启保留；查询 token 不重新检查窗口。

Bundle 全部准备和准入校验完成后，才锚定 Task receivedAt；
eligibleAt 为请求值与最终创建时间的较大者，deadlineAt 为其加 timeoutMs。
下载期间不消耗 Task 预算，已过去的预约时间不回溯生效。

`requestResultRetentionMs` 从首次 terminalAt 起算；查询、重试、重启不续期。
`collectRequestResults()` 不清理 preparing，不删除 Task/Run，
只使终态 token 查询返回 record_unavailable；所需幂等凭据继续保护。
`collect()` 的 Task/Run 历史清理不削弱这些依据。

## 制品、Schema 与运行

作者用 `pguide task-bundle build task.build.yaml` 从 TypeBox 契约与回调生成制品。
底层构建 API 归属 `@potential-guide/pguide-task-bundle/build`；
`task-sdk` 仅保留 Worker 运行时与类型，只允许 Node 内置代码外置。
`task.yaml` 的固定 `$schema` 同时选择声明和通信契约，不加数字格式/协议版本。
共享 Schema 收录完整精确锁定闭包，按 `$id` 离线解析。
声明、Schema、资源、入口和原始文件名/字节都由目录根 CID 覆盖。
见 [SDK](../packages/task-sdk/README.md) 与 [Worker 协议](task-bundle-worker.md)。

宿主用标准 UnixFS exporter 解释经 multiformats SHA-256 校验的块，
完整遍历所有文件后验证声明、Schema 闭包、容量、路径、重复与特殊文件；
不截断、改名、替换内容，也不存在延迟读取绕过准入。
`bundleConcurrency` 默认 4，限制获取/验证并发；排队不是整体等待截止。
缓存按 CID 共享，准备与 Run 租约保护有界的自有 verified blocks，
因此节点 GC 不会破坏活动内容；`protectedBytes` 默认总量 256 MiB。
Engine 不调用共享 pin.rm、不关闭 client、不嵌入节点或管理节点进程。
历史只需保留引用，内容可淘汰；需要时只能重取原 CID，不能改写历史或重跑。
hint 默认不授权网络访问，`allowGateway(url)` 由宿主控制；gateway raw block 仍逐块验 CID。

每个 Run 以内存 CommonJS source 启动验证后的 worker.cjs，握手不执行作者业务模块；
Run 开始事实持久后，SDK 才求值回调及其业务模块。
可信 runId/generation/startedAt/scope 不来自 Input。
宿主独立校验跨边界数据、停止、物理退出与回收；结果上报不是终态。
不执行作者 factory 或历史业务复验，事实查询不依赖 Bundle 缓存。
`context.bundle.read(path, {signal?})` 统一返回 `ReadableStream<Uint8Array>`，
由逐 pull IPC 提供背压，取消及创建/消费中途错误明确传播。没有整文件平行 API，
业务自行聚合；不依赖 cwd、`__dirname` 或物理 Bundle 目录。

回调必须完成自己的外部资源清理；无法确认时报告 reclamation_unknown，
不能用 released 自证物理退出或任意 OS 副作用已撤销。Worker 不是安全沙箱。
已开始而失去跟踪的旧 Run 恢复 stopped，清理/副作用未知，不重演。

## 匹配与源观察

`starts-after-eligible` 要求 Run 开始不早于 eligible；
`terminates-after-eligible` 要求实际终结不早于 eligible，两者均含等号。
新增匹配/调度只对未取消、当前 eligible 的 Task 进行；
已成立匹配不因后来 timeout、停止或纯 now 回拨撤销。
实际 Worker 退出早于 eligible 时，提前推导的 terminates 匹配失效，
无有效匹配为 initial；recovery stopped 不是实际退出时间，不触发该例外。

Input Validate、结构 Equals 和 Request 幂等独立。
合法额外 Input 字段也参与判等；同 Bundle/同名不保证共享。
兼容条件下选择严格 Run 开始序号最早者，同一前缀最多一个有效匹配。
后续改配不得借用失效前的旧见证。

Task 不持久绑定或权威 stage；按源前缀推导，必要时提交仅含 observedAt 的
qualification-time-observed。GET、纯标签变化和无新资格的 tick 不造事实。
失效沿实际退出源 revision，后续匹配沿其依据，更新历史、updatedAt、摘要与完整集合封装。
墙钟回拨不以最大时间掩盖后来源事实。

Task/Run 单体、历史、目录与订阅保持独立 scope 授权；
分页冻结成员、顺序、摘要和观察时间，从完整查询 revision 补读增量。
单源全部 joined/updated/removed 原子应用，不能丢弃同 revision 的兄弟成员。
未知/跨域/未来/过期锚点和预算超限明确失败，不返回部分成功。

## HTTP 与消息

`POST /tasks` 的 requestId 在 Idempotency-Key；正文保留完整 Bundle 引用。
preparing 返回 202，终态结果返回 200。旧 If-Match/类型发现 guard 明确拒绝。
`GET /requests/:id` 读取原意图，`GET /requests/:id/status?waitMs=…` 读取处理结果。
断开只结束观察，不取消准备。`TaskClient` 提供同协议的异步客户端。

Task/Run、history/events、完整目录和 Task messages 路由继续独立。
messageSchema:false 不接收业务消息；消息入队不是业务接纳，必须由回调 accept/reject。
消息不改 Input、不续期、不复活终结，不广播或伪造匹配。
未确认消息在终结/失联后保持明确 unknown/rejected，不承诺跨 crash exactly-once。

## 破坏性边界

Facts projection 和 SQLite user_version 为 **5**。
v4 及更旧/混合格式在修改前明确拒绝，保留原库、WAL、SHM、owner 字节。
必须由操作者显式指定新域路径；不自动迁移、删除、换域或重演。
同为未冻结 v5 的旧 URL/Digest Bundle 事实或 submission 也明确拒绝，不做破坏性自动迁移。
查询过期与格式不支持不同，不能靠静默切域掩盖。
通用协调器旧模块/资源 fixtures 仅为内部回归测试，不是公开注册 API。
