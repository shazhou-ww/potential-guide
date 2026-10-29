# 主体实现验证证据

## 候选与范围

基线 primary 为 `1d2dcbb0a4243cad0804c187cbf4e355291377fc`。
已验收 Ideal tree 固定为 `23bf1b89e48571b18d746dc4184ef448209b9ac3`，本轮不修改 Ideal。
本轮仅交付 Inner：四个包、工作区接线、源码测试和打包消费者测试；不执行 Outer，
不发布 npm/Release，不迁移旧 Check/Probe/Regulate，也不安装或修改设备配置。

| I-* | 交付与可执行证明 |
|---|---|
| I-S01 / I-AC01 | `packages/task-protocol/src` 的有限 JSON、版本/端口及纯投影；`test/protocol.test.ts` 与 `scripts/task-engine-contracts.test.mjs` 证明无 IO/业务反向依赖、拒绝非法结构/未知事实。 |
| I-S02 / I-AC02 | `packages/task-engine/src/engine.ts`、`pool.ts`；`test/engine.test.ts`、`boundaries.test.ts`、`pool.test.ts`、`orchestration.test.ts` 验证真实准备、共享、三维状态、队列、终结及实际资源回收。 |
| I-S02 / I-AC02 | `packages/task-engine-storage/src/index.ts`；`test/storage.test.ts`、`startup.test.ts`、真实子进程 `crash-child.mjs` 验证 SQLite 事务、单 owner、checkpoint 与崩溃窗口。 |
| I-S03 / I-AC03 | `packages/task-engine-http/test/http.test.ts` 使用真实 Web Request/Response 和 ReadableStream 验证身份、路由、SSE 字节、续订和错误；无自行监听。 |
| I-S03 / I-AC01 | `scripts/check-package-consumers.mjs` 的 task-protocol/task-engine/task-adapters 三个隔离安装场景，验证 tarball exports 和可选依赖组合；不是 Outer 的仓库外部署证明。 |

## 精确边界与结果

目标测试命令：

```powershell
pnpm exec tsc -b packages\task-protocol packages\task-engine packages\task-engine-storage packages\task-engine-http --pretty false
pnpm exec tsx --test packages\task-protocol\test\*.test.ts packages\task-engine\test\*.test.ts packages\task-engine-storage\test\*.test.ts packages\task-engine-http\test\*.test.ts
```

2026-10-29，Windows、Node `v24.12.0`、pnpm `11.22.0`：
上述编译退出 0；第二轮评审修复后的四包 **76 tests / 76 pass / 0 fail / 0 cancelled / 0 skipped**。
SQLite 的 ExperimentalWarning 如实保留，不是跳过条件。

| 证明点 | 输入与断言 |
|---|---|
| 时间三维 | eligible 到点但不驱动 coordinator 仍 initial；deadline 相等按时、+1 ms 为迟到；后续 +10000 ms 读取不改按时结论。 |
| 必需准备与校验 | echo 恒等 prepare 确实计数一次；sum 是另一非制品类型；Infinity、未知字段、无 anchor recurrence 拒绝；非法准备不占执行资源。 |
| 完成/取消 | 最终 Execution 已提交而 Task 尚未处理时 cancel 返回 task_finished；取消先提交则 running 冻结，无迟到成功 result。 |
| 分组 | 两个独立请求共享一次启动；独立取消不伤另一 owner；相同输入但不同准备 contentVersion、scope 或 environment 不复用。 |
| executionMatch | completed-after 可用较早已运行工作；完成恰等 eligible 不接受；匹配/取消/过期后处理不依赖 Promise.then 接收时间。 |
| 启动边界 | 每次读取都递增的时钟仍只有一个持久 startedAt；业务入口可读已提交 started；启动提交失败工作次数为 0，槽位仍可用。 |
| 过期 | 10 ms 排队预算在 +20 ms 观察撤销，不补启动；正在运行的过期任务不因此收到 stop；迟到准备不进入新执行。 |
| 递归 | eligible 周期 10 ms 在 +25 ms 取 +30 ms，再到点取 +40 ms；timeout=10/P=20 在 +55 ms 取 +70 ms；A 迟到完成不在 B 已到点后再生 C。 |
| Pending | 同 Series 两个已 eligible 未结束与一个未来 Task 可共存；每轮 successor 与准确新 Request/Task 原子关联，背压不消费规划。 |
| Pool 回收 | 空闲优先；错误资源 key 不杀候选；新保护 owner 使旧候选授权失败；两次替换不重复计数；旧回报不能污染新 ID。 |
| 真正强杀 | 两个 Worker 测试使用 `while(true)`；协作无效后 `worker.terminate()`，观察 exit，再 cleanup，再允许新 ID/释放槽位；覆盖压力替换和独立墙钟上限，force 与 cleanup 均精确一次。 |
| 独立计时与可信上下文 | 业务时间回拨 10000 ms 后，相对等待 5 ms 仍触发执行上限；工厂接收冻结的 Engine 绑定 scope/version/environment，不读取 body 身份作为权限。 |
| fail closed | cleanup 抛错使 idle=0、quarantined=1；取消与迟到 tracking 仍回收；close 在 tracking 交接之前不能释放 owner。 |
| 业务编排 | 真正执行中的 parent 在 parent 槽位等待 child，child 在独立受限资源域执行，无自身 HTTP 重提和死锁。 |
| 真实恢复 | 子进程 `process.exit(17)` 在受理/后继/启动 commit 前后退出；重开实际 SQLite 文件：已提交身份不重复，未提交无碎片，queued 恢复原身份，started 无 final 为 execution_interrupted，有 final 正常采用。 |
| 所有权 | 第二连接/真实第二进程不能 claim 同库；原进程退出后 OS 释放 owner 锁，不以 PID/过期租期冒充退出。 |
| 原版历史 | 升级为 type version 2 后，原 Request 幂等仍绑定 version 1；移除原解释器明确 unsupported_version。 |
| 历史与投影 | 全量 reducer、checkpoint+后缀、重复前缀相同；固定 watermark 不吸入新增事实或较晚关联的旧 Execution；流重连按位置重复可去重。 |
| 权限与边界 | 每次 pull 重新授权；每页最多 2 的测试不积无界缓存；断流不取消；64 KiB 协议默认、HTTP 独立 128-byte 测试、maxEvents=64 保留最终失败事实且不超限。 |
| 保留 | 活跃引用不清理；整个不活跃闭包到期后 compact；旧 Last-Event-ID 明确 410/history_expired。 |

## 仓库级验证记录

- 初次类型检查发现 exactOptionalPropertyTypes 赋值及 Response.json 的 unknown 用法，
  已按实际类型修复；未放宽 tsconfig。
- 初次 `pnpm check` 在新增 workspace 缺失 objectives.yaml / 根 delivery 覆盖时失败；
  已补齐四个包声明，并把真实仓库数量断言由 26 更新为 30。
- release inventory 的固定 23 项断言随新增四包更新为 27，保留唯一性和逐包 tag 验证。
- 第二轮完整检查通过 build/layers/format/lint/typecheck/全部仓库测试后，
  pack 消费者发现仅安装 task-engine 的测试脚本错误地直接导入其传递依赖 protocol；
  已去掉该非法直接导入，保留“核心单独安装”的更严格验证，不新增虚假依赖掩盖错误。
- 上述消费者修正后完整 `pnpm check` 退出 0，包含所有仓库测试和全部打包消费者；
  随后补充可信执行上下文与独立相对墙钟计时器，再次对最终候选执行同一完整命令。
- 相对计时器的首次接线使 3 条墙钟测试失败；修正为在正常持久启动分支注册计时器后，
  精确目标测试为 55/55，通过真实 Worker 强制退出与业务时钟回拨验证，未跳过失败项。
- 最终候选的门禁命令 `pnpm check` 已退出 **0**；包括 build/layers/format/lint/typecheck、
  仓库测试与 pack:check。三个新增消费者分别报告：
  `task-protocol: 1 selected, 1 internal packages`、
  `task-engine: 1 selected, 2 internal packages`、
  `task-adapters: 3 selected, 4 internal packages`，均为 `packed consumption passed`。
  这三个场景分别不带运行时、只带核心、可选装配 HTTP/SQLite；所有安装 fixture 由 runner 清理。

## 明确限制

这是单主动本地 Store，不是分布式调度。SQLite 要求本地文件系统。
原版解释器须由宿主保留；恢复中断不是外部副作用未发生的证明。
普通同线程 Promise 无强杀能力；不可靠适配器的交接/清理失败保留所有权并明确报错。
保留采用整个不活跃引用闭包清理，持续活跃 Series 可触发背压；不承诺无限历史或 SLA。
Series 帧快照有 pageSize 上限，事实仍逐页完整续读。详细数值与端口见 design.md。
本轮未运行独立生产监听器、Outer 消费者部署或任何发布动作。

## 父代理门禁回归修复

父代理独立验证原候选 `d0aef76083675f87b063b4d6169af0906be30fea` 的 55 条目标测试及
完整 `pnpm check` 通过，但拒绝 acceptInner：覆盖不足不能证明以下两个竞态正确。
本轮未改 Ideal、未代验收或开展 Outer。

1. **Pool 丢失替换唤醒。** A/B 两个资源都被占用，A 替换等待 cleanup 时排入 B 替换；
   原 pump 的 finally 只检查 idle，因此 B 不能自行开始授权。现用一次性 pumpRequested
   标记保留活动扫描期间的实际唤醒，退出后再扫描一次；没有新唤醒/可用槽位不持续调度。
   `pool.test.ts` 分别验证 B 授权成功和拒绝：只释放 A 的 cleanup 后 B 授权恰好一次，
   成功路径两个替换均启动且 idle=0，拒绝路径保持 queued=1、不热自旋。
2. **可靠结束后短暂误判超时。** `projection-races.test.ts` 在 .001 提交 Execution 最终事实，
   Task deadline=.100，在 .102 查询且未运行 coordinator，覆盖成功和失败；
   同时覆盖 .101 真迟到、正常完成匹配边界、未绑定结果及共享执行取消先行。
   project 只对未取消已绑定 Task 加入适用的可靠结束时间，不写事件、不伪造
   Task termination/result/stage。原 Request.executionMatch 仍控制正常结果的适用性，
   取消边界不推进。cancel 对先已可靠结束者仍返回 task_finished；裁决前后期限结论相同。

先添加回归、未修代码时，两个目标文件共 **19 tests / 13 pass / 6 fail**，准确复现问题；
修复后四包 **63/63** 通过、无跳过。本实施者对该轮候选执行的完整 `pnpm check` 已退出 0
（`.cache/generic-review-full-check.log`，全部独立 tarball 消费者通过），之后同步并重新
submitInner；验收仍由父代理负责。原提交事件保留，新提交绑定更新后的准确 Inner tree。

## 第二轮评审：结算与投影适用性一致

父代理重新执行 63/63 通过，但发现已绑定 settle 分支未检查时间适用性；
其对 `d0d8f0a2b415518a03d3297d4cc0d8557eb07e58` 的完整检查 shell206 被主动停止，
没有完成结果，本轮不把该中断运行算作通过。

协议层纯函数 matchesExecutionTime 现在由候选匹配、project 和 settle 共用。
已绑定身份不免除正常完成的 executionMatch 检查；真正执行失败仍独立处理，
sealed 只排斥新 owner，不抹掉原 owner 的适用结果。

`projection-races.test.ts` 用真实两个 Task 共享运行中 Execution，绑定后调整 Clock，
在 eligible-1 / eligible / eligible+1 分别提交成功或失败；再到 deadline+1，
分别直接 cancel 或先 tick 再 cancel。12 个端到端向量不修改存储事实：
不适用成功保持超时、允许取消且无成功结果；适用成功及执行故障先结算后拒绝取消。
另验证压力封口与真实迟到完成竞争，原 owner 的适用结果仍被保留。

先只添加回归时该文件 **19 tests / 15 pass / 4 fail**，四个失败均为不适用完成的
真实结算/取消路径；统一判定后四包 **76/76**，无失败、取消或跳过。

**实际完整验证结果：** 本实施者于 `2026-10-29T23:03:53+08:00` 完成该修复候选的
`pnpm check`，进程退出码 **0**；记录为 `.cache/generic-consistency-full-check.log`。
build、分层、格式、lint、typecheck、全部仓库测试及 pack:check 均完成；
task-protocol、task-engine、task-adapters 和所有既有隔离消费者均报告
`packed consumption passed`。这是本轮独立完成的验证，不是父代理中断运行的推断。
