# 主体世界实现证据

## 范围与责任

已实现通用 Task Context 宿主中介调用，不含 Probe 专用 Engine 分支。Task SDK 发出
`task-invoke`，宿主验证 generation、父 demand、继承 caller、独立授权、嵌入 DAG
目录根与输入/结果契约；Probe 继续负责 Level、映射、Check 事实与文档 Override。
父 Bundle 与子 Task 的 CID 都不来自服务配置，Worker 不持有服务地址或凭据。

关联在 `submission.preparing` 的同一次 Store append 中保存；其中包含父/根 Run、
key、深度、意图与截止时间。独立子 Task 的 binding isolation identity 防止与无关
Run 合并。Task/Run 的授权快照暴露 `parent`，便于从业务结果追溯子请求及资源状态。
相同 key 的并发调用与丢失 ACK 重试复用一次 admission；改变意图明确冲突。

每深度单独执行容量消除父等待占满子执行池的问题。默认深度 4、每父并发/每层
容量 4、每根总量 64；调用上限 30 秒，清理 5 秒，并受父 Task、父组合记录及父
执行墙钟截止时间进一步限制。正常子结果须等待物理释放证明。

## I-AC01：契约与边界

- [协议](../../../../../packages/task-protocol/src/run.ts)、
  [SDK](../../../../../packages/task-sdk/src/index.ts)、
  [宿主实现](../../../../../packages/task-engine/src/bundle-engine.ts)与
  [Worker 通道](../../../../../packages/task-engine/src/type-supervisor.ts)共用通用契约。
- [组合测试](../../../../../packages/task-engine/test/composition.test.ts)覆盖：
  默认拒绝授权、子树 CID 不匹配、非法子输入、非法结果、相同 key 的意图冲突。
- 完整 Task Engine 测试 **225/225 通过**，包含组合测试 **20/20 通过**；
  Task Protocol **130/130**、Task SDK **1/1**、Probe SDK **14/14** 通过。
  既有 Probe HTTP 适配器测试保留通过，immutable Bundle 不自动迁移或重写。

## I-AC02：调度、重试、退出与恢复

- 容量 1 的根/子/孙任务全部完成，三份独立 Task、两份不同深度关联可观察。
  深度、并发、总量配额分别拒绝；配额测试不依赖大容量默认值。
- 故障测试实际从 Worker IPC 中丢弃一次 child ACK，再使用原 key 调用；
  返回成功且只有一份持久子 admission。并发相同 key 与完成后的重试同样不复制。
- 父取消、父 Task 超时、正常提前退出均取消/释放子任务；preparing 内容请求被取消
  后，即使内容随后到达也不能创建孤儿 Task。
- 父硬退出后子 Task 已取消并有释放证明，但父副作用没有证明，因此父
  `cleanupUnknown` 与 Store 所有权保留，不被“子清理成功”掩盖。
- 恢复测试将运行中的 source facts 保存到磁盘后重新读取，恢复父/子关系；
  不重演父 Worker，不复制子 Task。子 demand 已取消，但 crash 前缺少物理释放证明，
  子 Run 保留 recovery/stopped/unknown，`waitForTaskRelease` 明确失败。
- 已完成并保留释放证明的父/子 Run 在恢复时不重新授权或取消历史子任务，
  即使新授权策略拒绝历史 caller，原有证明和 source watermark 也保持不变。
- Task Engine Server **15/15 通过**，包括非组合 Bundle 强杀仍报告未知清理。
  开发中曾发现通用子清理证明错误替代父副作用证明；已分离这两项责任并重跑该回归。

## I-AC03：构建与提交解耦

两个真实作者入口仅为 `runTask(createProbeTask(definitions))`；新 Worker 产物扫描
拒绝旧固定 loopback 端口、演示身份与 token。SDK 改变导致新 Check 内容身份改变，
本次显式更新作者 YAML 的 pins，不改写既有 CAR。

构建一次后，两次只执行 `objectives:run`，不再构建；相同 Probe CID 分别通过
受控、短生命周期的 in-process Engine 在不同内容源端口运行。每个 Probe 都返回
terminal Level、真实 IPFS 文档引用及三个独立、已回收的 Check Task/Run。
完整结果见[双端口运行记录](./evidence-probes.txt)：

| 作者包 | 同一 Probe CID | 内容源端口 |
| --- | --- | --- |
| monorepo-standard | `bafybeib3v65w6g6hyaucwpvy35iaxd2brvhljb3trzdh7vypbzddrc22ci` | 56269、58071 |
| task-engine-device | `bafybeibdxrdvxucnxpx6z6u3znyszzklsg5nwtn6bvx25oy4koc25m4jiu` | 56269、58071 |

新增[只读 CAR 内容源](../../../../../scripts/serve-task-cars.mjs)与
[独立提交入口](../../../../../scripts/submit-probe-objective.mjs)，二者均通过
`node --check`；正常构建/服务/提交说明见[作者包文档](../../../../../packages/probe-sdk/examples/objectives/README.md)。
独立持久进程、SQLite 重启及真实 Windows 外部调用验证仍属于 Deployment；
本文件不把上述 in-process 测试报告为现实世界部署。

## 仓库检查与环境限制

验证环境为 Windows，Node.js **v24.12.0**、pnpm **11.22.0**。
2026-11-08 的最终 `pnpm check` **退出 1**；sources、layers/build、format、
lint、typecheck 均完成，随后测试因未改动的 pguide-task-bundle 文件 symlink 权限失败。
该包输出：**119 tests / 112 pass / 7 fail**，包含父测试和子测试的失败计数；
具体操作错误为 `EPERM: operation not permitted, symlink`。不声称全仓通过，
不修改这些既有测试，也不启用机器级特权或豁免门禁。

独立 `pnpm pack:check` **退出 0**，输出 `Package structure verified`。
Task Engine 应用默认测试曾因 PATH 中已有全局 `pguide-task-engine.CMD` 与测试
生成命令重复而失败。仅在该验证进程的 PATH 排除全局 pnpm 命令目录后，
结果为 **6 tests / 5 pass / 0 fail / 1 skipped**。跳过项为未显式配置、未授权写入的
共享 Kubo E2E；未修改全局 PATH、配置、其他 worktree 或共享服务。

早期从仓库根直接运行 Probe workspace 测试时，fixture 无法找到 package-local
依赖；改为 `pnpm --filter @potential-guide/probe-sdk test` 后 **14/14 通过**，
未以该错误为理由安装额外依赖。所有实际命令、关键输出及失败摘要见
[验证记录](./evidence-validation.txt)。

## 尚未承诺的能力

- Worker 不是安全沙箱，父任意 OS 副作用的强杀/崩溃清理仍可未知。
- crash 恢复取消 demand，但不会伪造丢失的物理释放证明或重演父业务。
- 内容来源仍由宿主提供，并须遵守其超时/AbortSignal 契约；不自动发布、pin 或
  启动共享 IPFS 节点，不扩展跨 Engine 路由或远程多租户。
- Windows 独立持久服务的部署证据等待 Inner 验收后按 Outer 契约执行。
