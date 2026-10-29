# 独立交付验证结果

## 准确对象与执行结果

- 已验收 Inner：`51adbc160975b8287373ddc8eca0e27abb74a95a`。
- 已验收 Ideal：`23bf1b89e48571b18d746dc4184ef448209b9ac3`。
- 先同步的验证合同 commit：`76ede756189d37779a4cf230f6d901baf9c4efe0`。
- 开始证明前观测的 deploymentRevision：`20b9ba7b309c030e1abc0b68e1dc60398f0b2f06`。
- 实际运行：`2026-10-29T15:27:12.0239968+00:00` 至
  `2026-10-29T15:27:14.2086860+00:00`，Windows / Node `v24.12.0` / PowerShell `7.6.9`。
- 引导命令退出 **0**，消费者退出 **0**，**23 个断言组全部通过**。
- 完整机器证据：[verification-result.json](./verification-result.json)。
  该结果与本文是运行后新增的证据，不改变执行前合同的测试行为。

实际命令：

```powershell
& .\.silvermoon\ideas\01M63AFYJEDXZ8PFZQQVZC1W02\outer\verify\run.ps1 `
  -PlanRevision 20b9ba7b309c030e1abc0b68e1dc60398f0b2f06
```

脚本先对四包执行 `pnpm exec tsc -b ... --pretty false`，逐包 `pnpm pack --json`，
然后在全新消费者目录执行：

```powershell
pnpm install --offline --ignore-scripts --no-frozen-lockfile --store-dir .pnpm-store --reporter=append-only
node suite.mjs D:\Code\potential-guide 20b9ba7b309c030e1abc0b68e1dc60398f0b2f06
```

消费者目录为 `D:\Code\potential-guide-consumer-f1b4433c9d184a709a7d845e3fcd490b`，
是仓库的同级目录，非仓库缓存、源码或 workspace 安装。传给脚本的仓库路径仅用于
断言解析路径不属于仓库，不作为 import/loader 搜索路径。

## D-AC01：独立安装与核心嵌入

四个包均为 `0.1.0-rc.0`，以下是实际安装的本地 tarball SHA-256：

| 包 | SHA-256 |
|---|---|
| `@potential-guide/task-protocol` | `37e9cb63dec3fe7af8bdc214a51c80f4f3b0431c6a69a8f573b2431400fd85c8` |
| `@potential-guide/task-engine` | `c35c9d82a024f9c3d1253494c15ddcafdcb767d422ab9369d2defff71c59098a` |
| `@potential-guide/task-engine-http` | `abe01f5008ca06d3517e8d82831872e33bb59376055d9c04fa76c856821455c1` |
| `@potential-guide/task-engine-storage` | `5cf12f687f259a45741e1651fee2ac02d59d19d18db2e8d7ff81070ed75593f9` |

6 个公共入口（包括 pool/testing）通过包名解析并 realpath 验证，全部在上述消费者
目录内，全部不在仓库内；具体绝对路径保存在机器证据的 consumer.modules。
NODE_PATH、NODE_OPTIONS 均未设置，execArgv 为空；没有源码、workspace 或 loader 导入。
安装后 manifest 的运行依赖也逐项核对：protocol 无第三方依赖，其余三包仅依赖 protocol。
所有依赖均为本地 file: tarball，离线安装没有上传或发布制品。

先执行纯进程内证明，再启动任何 HTTP 子进程。核心阶段前后均断言没有 TCPServerWrap：

- echo 恒等 prepare 实际调用；两个等价 Task 共享一次执行、保留独立身份及取消权。
- sum 是另一非制品类型，实际准备计算 `[2,3] -> total=5`，不注册 Check 或 Schema 库。
- 完整 Request 幂等、策略变更冲突、非法旧 prerequisite 字段与未知类型、跨 scope 访问
  均有明确断言；scope 来自可信 caller。
- 原 Task 取消不会停止另一 owner；晚到结果不复活已取消 Task。

## D-AC02：外部行为

| 已运行场景 | 实际断言及观测 |
|---|---|
| 业务前置判断 | skip 返回 `{performed:false,reason:"fixture-unavailable"}` 且 completed；抛错为 execution_failed，不变成等待解锁。 |
| 精确时间边界 | 固定 Clock 将真实完成放在 deadline 或 deadline+1；再延后读取及结算，前者不超时，后者 completed 且超时。 |
| 精确 Prepared | 相同输入准备成不同 resolvedVersion，实际启动 2 个不同 executionId。 |
| 有界排队 | 单槽被占用时第二项 queued；超过其预算后队列撤销，释放原槽仍只有 1 次启动，原运行不因 Task 超时被停止。 |
| eligible 原节拍 | 延迟到 +25ms 规划 +30ms；到点再规划 +40ms，3 个 Task 中有 2 个已 eligible、只有 1 个 Pending。 |
| terminated 超时去重 | timeout=10/P=20，在 +55ms 发现超时规划 +70ms；B 已到点后 A 迟到完成，仍只有 1 条 successor 关联、2 个 Task。 |
| 资源选择与保护 | 有空闲匹配资源时不杀旧候选；候选不能提供目标 resource key 时不杀；排队后旧执行获得有效 owner，二次授权拒绝替换。 |
| 真正父子执行 | 运行中的 parent 在受限 parent 槽位等待 child，child 在另一受限资源域完成，结果 value=6，执行 ID 独立，无自身 HTTP 重提。 |
| 真正隔离强杀 | Worker 发出 ready 后进入 `while(true)`；Task 过期不立即停止。压力替换触发一次 `worker.terminate()`，观察 exit、threadId=-1 和 cleanup 后才启动新 ID。 |
| 显式真实 HTTP | 三次宿主启动均在 loopback 随机端口监听，IPC 报告地址后实际 HTTP 请求返回 401，证明已响应。核心 handler 自身不监听。 |
| 授权与 SSE | 无凭据 401，另一 scope 403；读取真实 SSE 帧、断开、HTTP 查询 Task 未取消，再用 Last-Event-ID 重连读到 after-watermark 进展。 |
| 固定历史水位 | 取 limit=1 首页后追加进展，续页仍只含原 watermark 以内事实；SSE 续读使用提交位置并按 sequence 验证身份。 |
| HTTP 迟到结果 | 在真实网络上先读 running/timedOut，再完成后读 completed/timedOut 和原结果；重启后仍保持超时。 |
| 真实 SQLite kill/restart | 同库同时保留可靠最终结果但无 Task 裁决、未知 running、未来 initial 三组；杀死宿主后用另一 PID 重开同一文件，不复用内存对象。 |
| 恢复裁决 | 可靠 final 投影为 completed，结果 `{text:"durable ended"}`；未知 started 为 execution_interrupted，恢复启动统计为空，不透明重跑。 |
| 原请求与未来任务 | 同 requestId/body 重发返回原 taskId；原 Request 未改写，future eligible/deadline 保持原值，到原点后仅 future 启动。 |
| 原版类型 | 重启使用 currentVersion=2，但旧 Request/准备仍由 version=1 解释，新的 v2 请求绑定 version=2；移除原解释器的独立进程报 unsupported_version。 |
| 单主动 owner | 另一真实进程打开同一 SQLite 文件并尝试启动 Engine，返回 store_owned 并正常退出，不出现双调度。 |
| 保留 | 活跃未知执行仍存在时 collect 不删除其历史；所有引用结束并超过测试保留窗口后 collect，真实 HTTP 续订旧 cursor 返回 410/history_expired。 |

上述业务时间由受控 Clock 明确选择（epoch `1800000000000`），不是把物理墙钟延迟猜测为
业务完成时刻。HTTP 流、SQLite 文件、进程 kill/restart、Worker ready/exit 都是真实对象；
异步交接使用有界 Promise/IPC 握手，不依赖 sleep 恰好满足时序。

## D-AC03：清理与权限范围

- 所有 SSE reader 被关闭；宿主 activeStreams 精确回到 0。
- 5 个操作拥有的子进程均收到 exit 观测：PID 44380 为预期 SIGTERM；
  PID 27848、18584、45172、41200 均退出 0。
- 端口 59534、59540、59544 在对应宿主结束后逐一实际连接，
  均为 ECONNREFUSED，不以“已调用 close”替代释放证明。
- 失控 Worker 的 exit 已观测，threadId=-1，清理已确认；随后才启动替换工作。
- 根目录的 `.deployment-owner` 内容与本次 operationId 严格相等后才删除。
  `markerVerified=true`、`consumerRemoved=true`；删除后独立 Test-Path 再确认目录不存在。
  安装 store、SQLite/owner/WAL、tarball、fixture 与本次凭据随该准确目录移除。
- 仅使用测试生成的随机 Bearer 凭据；报告未保存令牌，未读写用户认证/设备配置。
  未上传源码、未发布 npm/GitHub Release、未运行常驻生产服务。
- 实施源码、Ideal 和 Inner 工作区 diff 为空，两个验收 tree 保持原值。

## 过程修正与未覆盖范围

首次相同外部行为验证已有 23 组通过，四包摘要与本次一致；证据引导层默认
ConvertFrom-Json 会将规范 `.600Z` 重新格式化成 `.6Z`。这不是引擎故障：
只修正 Outer 脚本为 DateKind=String，先重新同步合同，再在另一个随机外部目录完整重跑，
最终报告保留原始规范字符串。未调整任何已验收实现。

本轮平台是 Windows/Node 24/本地 SQLite、loopback 与测试认证，不声称跨平台、
公网 TLS、分布式多主、硬件断电恢复、性能 SLA 或正式发布通过。
SQLite commit 前后故障注入的全部排列、Pool 清理失败隔离、不可强杀 Promise、
独立墙钟强杀以及同时替换/启动竞态的完整向量，引用已验收
[Inner evidence.md](./inner/evidence.md) 的 76/76 证明，本轮不冒称重复了全部向量。
这里的真实 Worker 证明特指压力替换；不向任意同线程 Promise 推广强杀能力。
持续活动 Series 的保守整闭包保留仍可能产生背压，不承诺无限历史。

所有 D-S01—D-S03 与 D-AC01—D-AC03 的独立交付结果均已取得；这仍是 Agent 的
submitOuter 候选证明，最终 acceptOuter 由父代理决定。
