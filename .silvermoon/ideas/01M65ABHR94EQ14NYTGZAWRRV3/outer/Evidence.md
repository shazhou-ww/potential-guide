# 独立消费部署验证

本文件服务 [Deployment.md](Deployment.md)，不替代部署契约。
已验收实现为 `4db53c32aa9765262fd0a67626eba114e5e08ae7`；
部署验证不得更改 Inner World 或生产源码。

本次通过 [verification/verify.mjs](verification/verify.mjs) 在此前不存在的仓库外目录
建立三个独立消费者。先将本契约与 harness 同步至 primary，再记录准确的被测试
deploymentRevision，执行真实安装及 HTTP/SSE/进程测试。
结果将由 [verification/results.json](verification/results.json) 保存实际 tarball 身份、
安装图、命令、API 观测、Worker exit/PID 记录和唯一标记目录清理证明。

首个完整仓库外验证已在 `e2d01ad120120f9a578cf323443cc634b8411160` 通过，
三个消费者分别实际安装 16、5、22 个包，目录 a2 已按唯一标记清理。
当前进一步强化 harness：纯契约所有禁止 IO 调用计数必须为零，避免负例中的
`assert.throws` 掩盖调用；已确认消失的 owned PID 不再作为后续兜底 kill 的候选，
避免 PID 复用风险。同步修订并重复全部检查之前 D 项仍未勾选。
上述强化在 `274a46bfa7dcca4157a10568e90e5a1d87edcf7e` 的 a3 独立运行中全部通过。
最终再将 owned child 的 OS 存活检查移到“下一次真实 Worker 创建”的观察点，
并断言单槽所有 worker-start/worker-exit 的严格先后关系，以直接证明物理退出先于复用，
不只在后续任务完成时检查。此项仅增加外部观察，不修改已验收实现。

首次执行在打包首包前发现 harness 的 Windows cmd 参数转义问题，pnpm 收到了带字面引号的
`--dir`。此为验证工具问题，未触及产品实现；已确认 `windowsVerbatimArguments` 的实际
转发行为并修正。原始失败及唯一目录清理记录保留在
[attempts/shell-quoting.json](verification/attempts/shell-quoting.json)。
修订 harness 将重新同步并绑定新的准确 deploymentRevision 后重跑。
