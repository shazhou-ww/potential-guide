# Supervisor 退役后的独立消费与恢复验证

本文支撑 [Deployment](./Deployment.md) 的追加退役范围。原始结果为 [retirement-results.json](./verification/retirement-results.json)；此前 [周期请求证据](./Deployment-evidence.md) 与旧 results.json 保留其历史含义，不覆盖成本次结果。

## 固定范围与验证角色

- 用户明确委托父代理复核并批准 gate，subagent 完成业务实现；父代理实际审查迁移和清理范围、完整测试以及本次独立验证，不以 subagent 的完成声明替代证据。
- 被复核并接受的 implementationRevision 为 `3fcc9bce133a3ba0b41fbd7b4e9d053b78b0b7d0`，业务代码快照为 `36a55f71dfacfefeee5b31f60f2f7a593c0cbffa`。部署阶段未改业务代码。
- 验证工具与部署契约先同步到 primary `13c6baa50ce85c33622ca6108412bdeec6052f25`，当时 deploymentRevision 为 `fffc2a383186de25e4ce52261ab989d92f3e88f7`，再执行外部验证。
- 执行时间为 `2026-10-27T12:40:24.745Z` 至 `2026-10-27T12:40:34.871Z`。Windows、Node v24.12.0、pnpm 11.22.0、TypeScript 5.9.3 与 Node 类型 22.20.5。
- 使用真实 Host / worker 进程、公共包和文件 store；业务结果为 fixture，不声称验证了真实 Objective 的改善效果。未发布 npm、撤销旧 npm 版本、修改设备配置或调用付费 Agent。

## D-AC01：不存在退役包的独立安装

工作区外的新消费者直接安装 Coordinator、effects、pguide、pguide-regulate，内部包通过本地 tarball override 固定。安装闭包共 16 个内部包，记录中保存每个版本及 tarball SHA-256。原用户缓存缺少 CLI 的第三方依赖，安装改为使用现有 workspace 依赖缓存：

```powershell
pnpm --dir <consumer> install --offline --ignore-scripts --store-dir D:\.pnpm-store
```

没有从网络下载旧发布包来替代本地实现；业务包都来自本次打包产物。Coordinator 自身闭包缩为六包：

- @potential-guide/regulation-coordinator
- @potential-guide/effects
- @potential-guide/pilot-protocol
- @potential-guide/objective-pilot
- @potential-guide/objective-regulator
- @potential-guide/check-host

完整消费者 inventory 和安装后的 pnpm-lock.yaml 均断言不含 objective-portfolio-supervisor 或 pguide-supervise，公共运行入口位于独立安装的 node_modules / .pnpm / dist。严格 NodeNext 类型检查无 paths、无 skipLibCheck，退出 **0**。

CLI 使用独立安装的可执行 shim 及 Node 目录构造 PATH，并使用独立 HOME / USERPROFILE / APPDATA / XDG_CONFIG_HOME。初次检查遇到设备旧配置和空 PATH；只修改、同步外层验证工具后重试，未读取或迁移用户配置，也未修改产品以绕过拒绝。

| 安装后命令 | 退出码及断言 |
| --- | --- |
| supervise --format json | 2，明确 Unknown command，无重定向、安装旧包或追加额度建议 |
| --help | 0，不再列出 supervise |
| complete --shell powershell | 0，不再补全 supervise |
| regulate --help | 0，保留单次治理入口 |
| continue --help | 0，保留显式续接入口 |
| probe --help | 0，保留观察入口 |

通用第三方命令发现没有被全局封禁；独立安装旧扩展仍需用户卸载。这与当前包不再交付旧入口是不同边界。

## D-AC02：真实进程不依赖 Supervisor

三个 Host 生命周期 PID 为 58348、57904、11128；同 Target 的三个 worker 启动和退出记录逐项成对，没有重叠。

- 第一次 Run 的 agent-runs 耗尽事件可从原游标两次读取为相同内容；监听者重复提交同一额外请求只启动一次，周期后继仍保留。
- 在周期 Run `external-recurrence-host:13` 活跃时以 SIGKILL 强制退出初始 Host，外部 worker PID **59792** 仍然存活。
- 新 Host 重新附着同一 Run / PID，实际 worker 启动数恢复前后均为 **3**；原 timeoutMs=20000、maxAgentRuns=3、maxStallRuns=2 不变。
- 原 Run 结束后报告 stall-runs，重启后仍能读到原始耗尽身份；没有 Coordinator 自动追加 quota 的 Run。
- 停止周期链后跨过下次 eligibleAt `2026-10-27T12:40:34.106Z`，没有新增执行；停止后重启 revision 仍为 **19**，原请求重投不复活周期链。
- 最终三个 worker 全部实际退出，所有 Host 也退出，控制器确认 noTargetOverlap、noRemainingProcesses 均为 true。

运行器等到 worker 实际退出后才结算 result，不以 abort 请求或写入结束文件代替退出证明。结果证明单次限额不因恢复改变，不暗示当前不存在的累计 Budget 调账已验证。

## 父代理验收依据与收尾

父代理独立复核了上述原始结果和断言，与实现阶段的 **79 项 Coordinator 测试**、**46/46 workspace 测试任务**以及确切提交在干净短路径 worktree 的完整 pnpm check 退出 0 相互印证。原长路径的未改 Check Host 测试曾失败，完整验证环境差异已在[实现证据](./inner/Supervisor-retirement-implementation.md)记录，没有伪称原路径失败已修复。

本次满足追加范围的 D-AC01、D-AC02，具备按用户委托批准部署 gate 的证据。临时 worktree、tarball 安装与验证进程在完成后针对精确路径 / PID 清理；仓库仅保存契约、工具、迁移说明和证据，不提交缓存或设备数据。
