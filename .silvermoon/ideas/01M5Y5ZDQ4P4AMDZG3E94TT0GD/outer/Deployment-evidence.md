# 独立消费者与跨进程部署验证证据

本文支撑 [Deployment](./Deployment.md)。原始结构化结果为 [results.json](./verification/results.json)，可重放的验证工具为 [run.mjs](./verification/run.mjs)。

## 固定范围与环境

- 先同步验证契约和工具，再执行：primary commit 为 `8622cf5943fd5629e942cc58433d928dab58f15a`，当时 deploymentRevision 为 `49f5e93acbc2a6579bfaeed45f34ea8d2975c8db`。
- 被接受的 implementationRevision 保持 `3810e6ab64ce28a7962c6eec1b85ced41cb5dcbc`；部署阶段未修改业务代码或已接受的内层契约。
- 实际环境为 Windows `10.0.26300`、Node `v24.12.0`、pnpm `11.22.0`、TypeScript `5.9.3` 和 Node 类型 `22.20.5`。
- 外部验证于 `2026-10-27T09:27:23.905Z` 至 `2026-10-27T09:27:33.121Z` 执行。控制器退出 0，输出 `passed=true, hostEpochs=3, workerStarts=3, typecheckExit=0`。
- Host 和每个 Run 都是实际进程，文件 store 为公开 SQLite 锁和持久化快照。Objective 与业务结果使用明确的 fixture，不代表真实业务达标；没有付费 Agent、MCP server、npm 发布或跨 Host 协调验证。

## D-AC01：独立安装与公共契约

通过 pnpm pack 打包包含 Coordinator 在内的七个内部包生产依赖闭包，逐个记录 tarball SHA-256。只在工作区外的新消费者中声明 Coordinator 和 effects 为直接依赖，通过 pnpm 11 的 pnpm-workspace.yaml overrides 将内部包固定到本地 tarball，并以 `--offline --ignore-scripts` 安装。

| 包 | 实际版本 |
| --- | --- |
| @potential-guide/regulation-coordinator | 0.1.0-rc.0 |
| @potential-guide/effects | 0.1.0-rc.0 |
| @potential-guide/pilot-protocol | 0.1.0-rc.0 |
| @potential-guide/objective-pilot | 0.2.0-rc.0 |
| @potential-guide/objective-regulator | 0.4.0-rc.0 |
| @potential-guide/objective-portfolio-supervisor | 0.4.0-rc.0 |
| @potential-guide/check-host | 0.1.0 |

实际解析的公共入口均位于消费者自己的 node_modules / .pnpm / dist，不指向工作区。严格 NodeNext 类型检查未设置 paths 或 skipLibCheck，使用安装包的声明，退出 0；[consumer.ts](./verification/consumer.ts)涵盖带时间与 recurrence 的请求、事件游标、耗尽投影和停止 API。

本次没有实例化 Portfolio Planner 或上层 Agent。Supervisor 作为纯 helper 的既有传递包依赖仍然存在，不能把“无需 Planner”误写成“已删除 Supervisor 包依赖”。

首次安装暴露的是验证工具的 pnpm 11 设置位置问题：package.json 的 pnpm.overrides 被忽略，离线解析因此失败。已仅修正外层 prepare 工具，重新同步后在全新消费者目录安装通过；业务实现未改动。

## D-AC02：真实进程、恢复与停止

| 验证项 | 实际结果 |
| --- | --- |
| 三次 Host 生命周期 | PID 40216 为初始 Host，27248 为崩溃后恢复，17880 为停止后的再次重启 |
| 初次额度耗尽 | `external-recurrence-host:5` 稳定事件身份；原始游标重读两次内容一致 |
| 外部追加投入 | 重复投递 `extra:external-recurrence-host:5`，实际只启动一次，周期后继没有被替代 |
| Host 被强制退出 | `external-recurrence-host:13` 的 worker PID 35264 继续存活 |
| 重新附着 | 新 Host 恢复同一 Run 和 PID，worker 累计启动数恢复前后均为 3，没有重新调用 start |
| 限额恢复 | 原 Run 的 timeoutMs=20000、maxAgentRuns=3、maxStallRuns=2 保持不变 |
| 第二次耗尽 | 原 Run 结束并记录 stall-runs；原始耗尽事件重启后仍可读取 |
| 停止周期链 | 后继到期时间为 `2026-10-27T09:27:32.350Z`，越过该时间仍无新增 worker |
| 停止后再重启 | Coordinator revision 保持 19；原始请求重投不重新激活已停止链 |
| 实际互斥和清理 | worker 启动 3 次、退出 3 次，启动/退出日志不重叠；结束时所有验证 PID 均已退出 |

耗尽由控制器显式提供给外部 worker，再由 Host 等待实际退出后报告；没有用 Promise 提前结算冒充执行终止。第一次 Host 使用 SIGKILL 强制退出，恢复不是同进程重建服务。

证据证明每个 Run 的可信限额未因重启改变，不声称验证了当前系统尚未提供的累计 Budget 调账。额外请求来自外部控制器的明确决定，不是 Coordinator 自动续跑。

## 复现入口与边界

从上面的固定 commit 构建公共包后，使用全新的工作区外目录执行：

```powershell
pnpm --filter '@potential-guide/regulation-coordinator...' -r pack --pack-destination <packs>
node .silvermoon\ideas\01M5Y5ZDQ4P4AMDZG3E94TT0GD\outer\verification\prepare.mjs <repository> <packs> <consumer>
pnpm --dir <consumer> install --offline --ignore-scripts
node <consumer>\run.mjs 8622cf5943fd5629e942cc58433d928dab58f15a
```

离线安装要求第三方生产依赖和编译器已在 pnpm 缓存中；本次使用已有缓存，没有改用已发布旧版本充当本地实现。首次派发间隔为 3000ms，每个 worker 最多存活 30 秒，Host 有独立看门狗；控制器清理只针对本次记录的精确 PID。

最终仓库保存工具和结构化结果，不提交 node_modules、tarball、设备配置或明文凭据。工作区外的安装缓存副本和本次临时控制文件在验证完成后清理。

外部验证后再次执行 pnpm check，退出 0；26 个 Idea 本地链接、契约与 ledger 镜像条目及结构化证据断言均通过检查。清理前再次确认记录的 Host / worker PID 全部不活跃。
