# 独立 Run Worker 阶段证据

本文件服务于 [Implementation](Implementation.md)。这是第一个可重复验证的实施阶段，不是完整 Inner、
V01–V16 全部通过、实施验收或外部部署证据。该 Worker 阶段当时未改 Ideal/Outer，I-* / D-* ledger 仍全部未勾选。
后续资格时间见证已形成 Ideal 的 Q08 澄清候选，但尚未实现，不能用本阶段证据替代。

## 已落地行为

- `task-engine/src/type-supervisor.ts` 的类型守护为每个完整 Run 创建独立 Worker；
  历史纯复验使用独立复验 Worker，不跨 Run 共享业务模块堆。
- 指定 Run 的取消、健康失联及强制终止只作用于该 Run；类型内仍共享有界的通道在途和宿主资源证明预算，
  不因拆分 Worker 绕过原容量限制。
- 同类型只串行化 Worker 启动，已就绪的 Run 继续并行；避免独立 Worker 启动风暴耗尽健康握手预算，
  不放宽已接受的健康时限或结果断言。
- 类型结果在隔离通道校验后暂存，只有 Node 宿主观察到该 Worker 的实际 `exit` 才交付 completed/failed 回调。
  Worker 接纳停止与物理退出分别报告；正常结束也终止本 Run Worker，不把清理消息当作退出。
- 守护停止宽限与强制退出确认等待分别默认 5,000ms；强杀超时明确 `stop_unconfirmed`。
  退出等待以真实退出为界，不因宿主结果持久化回调尚未完成而误称 Worker 仍未退出。
- Worker 退出后路由关闭。宿主资源动作及独立清理证明仍需单独结束才能交付 released；
  资源证明等待从实际退出后开始，物理 Worker 退出不伪造外部资源回收，旧代际动作结束不删除新代际跟踪。
- 排队中的旧 Worker 退休后不再投递入口，也不能删除同 ID 的新 Worker 跟踪。
  投递前失败仅在已观察到独立 Worker 退出、入口从未投递且无宿主在途动作/证明时，向 Engine 提供确认依据；
  Engine 此时记录失败与真实回收，不把这个明确已释放的路径一律写成未知并永久保留租约。
  已投递或资源未确认的路径不走此分支。
- 旧协调器测试 fixture 不再通过 permit.complete/fail 直接写 Engine 终结事实，而是把业务结果交给真实 Worker；
  受影响断言等待实际退出/释放。通用 finish helper 等待持久 reclaimedAt，不用固定延时冒充回收完成。

## 变更文件

- 运行：[engine.ts](../../../../../packages/task-engine/src/engine.ts)、
  [type-supervisor.ts](../../../../../packages/task-engine/src/type-supervisor.ts)、
  [type-worker.ts](../../../../../packages/task-engine/src/type-worker.ts)。
- 直接证明：[type-supervisor.test.ts](../../../../../packages/task-engine/test/type-supervisor.test.ts)、
  [supervisor-review.test.ts](../../../../../packages/task-engine/test/supervisor-review.test.ts)、
  [isolated-type.mjs](../../../../../packages/task-engine/test/isolated-type.mjs)。
- 回归与受控端口：[driver.ts](../../../../../packages/task-engine/test/driver.ts)、
  [fixtures.ts](../../../../../packages/task-engine/test/fixtures.ts)、
  [catalog.test.ts](../../../../../packages/task-engine/test/catalog.test.ts)、
  [event-binding.test.ts](../../../../../packages/task-engine/test/event-binding.test.ts)。
- 说明：[task-engine README](../../../../../packages/task-engine/README.md)，以及本目录的 Implementation.md 与本文件。

## 验证及契约对应

### V07：独立停止边界的阶段证据

`type-supervisor.test.ts` 验证指定 Run 强杀后，同类型另一个 Run 仍可路由、协作取消并形成可靠结果；
忽略取消的 Worker 在接纳停止后按独立宽限强杀；不伪造业务结果或宿主回收。
真实 terminate 被阻挡、threadId 仍大于 0 时，强制退出等待超限明确失败、业务消息路由关闭，
但不公布退出或回收；解除阻挡后的真实退出仍可观察。
公共 stage/stopping/stopped、停止互斥与 Engine 取消/超时需求统计尚未改造，因此不声明完整 V07 通过。

### V08：退出终结边界的阶段证据

新增成功/失败矩阵对真实 Worker 的 terminate 加局部门闩：
已收到可靠结果且 threadId 仍大于 0 时，终结回调、退出和 released 均不可见；
释放真实退出后 threadId 为 -1 才交付结果。另验证意外退出没有伪造结果。
既有 supervisor-review 的失败证据、宿主资源、清理证明与旧代际回归均保留。
完整 Task 三维跟随及 Engine 所有停止路径的终结裁决尚未完成，不能以这些用例代替整个 V08。

### V09：不重演的阶段证据

新增退休排队 Worker 的竞态，验证旧 Run 不会在旧启动槽释放后补投递，也不删除同 ID 的新跟踪。
这是守护内的阶段证据；Engine 重启仍有旧失败恢复裁决，尚不能声明整个 V09 通过。

### 本阶段实际运行

| 命令/范围 | 实际结果 |
| --- | --- |
| task-engine build | 通过 |
| task-engine lint | 退出 0；Biome 仍有警告，不宣称零警告 |
| `pnpm --filter @potential-guide/task-engine exec tsx --test --test-concurrency=1 test\type-supervisor.test.ts test\supervisor-review.test.ts` | 28/28 通过，14.64s；包含退休排队、强杀未确认和投递前释放证据 |
| 早期 Engine/boundaries/projection-races 串行定向回归 | 42/42 通过，103.17s；最终八包检查再次覆盖这些文件 |
| 最终八包及必要依赖的 build/lint/typecheck/test，Turbo concurrency=2 | 38/38 任务成功，16 缓存，2m13.82s。task-engine 127/127、protocol 11/11、storage 26/26、HTTP 8/8、server 10/10、Check 20/20、Probe 18/18、Web UI 53/53 通过 |
| 投递前确认释放修复后 Web UI 单独正常全套 | 53/53 通过，11.05s，无诊断预加载；未修改收藏或其测试 |
| 最终 `pnpm check` | 退出 0；build/层次/格式/lint/typecheck/test/pack:check 全部完成。测试任务 68/68 成功（62 缓存，13m42.53s），其后脚本测试 42/42 通过，打包及包消费验证完成 |

曾先运行 Engine 全套发现 fixture 直接提交终结与真实 Worker 终结重复，随后移除测试旁路并更新受影响退出断言；
不隐藏前序失败，也不删除测试逃避。

修复过程中的前几轮完整 `pnpm check` 均退出 1：build/层次/格式/lint/typecheck 通过，
test 在同一 Web UI reclamation_failed 停止，pack:check 未执行。局部隔离通过没有被冒称为全套通过。
当时 Web UI 为 52/53，失败在 workbench-races L22 的 finally / backend.close；
该文件隔离 2/2 通过仍不能证明整套通过。
随后用临时本地诊断记录到本轮有三个 Run 的实际原因为 `type_unavailable` / 类型守护启动超时，
入口投递失联导致租约无法释放；据此串行化同类型启动，不扩大健康预算、不触碰收藏。
只做启动排队后，独立 UI 全套通过，但并发八包/全库仍复现同类失败；没有将局部通过误记为全部修复。
进一步补齐“未投递入口且实际退出已确认”的资源释放证据与 Engine 接收分支，避免把已证明释放的失败路径永久记为未知。
这解释本轮复现，不证明早期 main 报告必然同因。诊断不含业务载荷，不作为新增工具或框架提交。

最终八包与完整 `pnpm check` 均已通过；验证期间源码与测试保持不变。
文档链接、ledger 镜像、未改 Ideal/Outer、whitespace 与 Silvermoon worktree 检查均通过。
上述质量回归不等于剩余新语义已经实现或 Inner 已就绪。

## 尚未完成的 Inner

1. 协议仍有旧 stage/matchPolicy、Task snapshot 与独立绑定/终结事件；
   Engine 的 reclaim/recovery 仍有旧失败裁决路径。必须整体替换为新事实/时间推导，
   而不是把旧权威快照双写包装成新 revision 语义；守护配置也尚未完整贯通到 Engine/Server 的公开预算。
2. 仍需实现持久准入下界、新格式拒绝/保留策略、公共 Run 快照、统一查询水位、
   冻结分页与 fromRevision 的单体/集合补读及完整源封装。
3. 仍需贯通配套能力、HTTP/Server、Check/Probe 的独立 Run 核验与 Web UI；
   尚未改收藏或范围外 workspace。剩余 V01–V17 适用证据、八包与完整质量检查仍是 Inner 完成条件。

## 可执行复核入口

优先运行上表的两份 supervisor 定向测试，包含真实独立 Worker、卡死强杀、成功/失败退出门闩、
消息及宿主资源证明，不依赖模拟退出。该入口只复核本阶段，不替代后续独立 HTTP/服务消费与外部验证。
