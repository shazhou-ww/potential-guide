# 验证外部消费者的周期请求闭环

依据为已接受的[构想](./inner/ideal/Idea.md)及实现。先同步本文及[验证工具](./verification/run.mjs)，再在工作区外执行；结果另记外部证据，不以仓库单元测试替代现实验证。

已执行结果、环境和限制见[部署验证证据](./Deployment-evidence.md)及[结构化记录](./verification/results.json)。

## Steps

### D-S01: 准备独立消费者

使用 pnpm pack 打包 Coordinator 及其内部生产依赖，在会话目录的新消费者中通过本地 tarball override 安装，固定 TypeScript 5.9.3 与 Node 类型 22.20.5。执行无 paths 的 NodeNext 严格类型检查，核实运行时入口位于独立安装目录，记录 tarball SHA-256、实际版本与环境。不得发布 npm、改设备配置或调用付费 Agent。

### D-S02: 演练追加投入与恢复

运行实际 Node Host、独立监听控制器及每 Run 的外部 worker。Host 使用公开文件 store 和有限执行配置；worker 模拟业务结果，不模拟进程退出。先验证耗尽重读与幂等追加，再在周期 Run 活跃时强制退出 Host、重新附着存活 worker，最后停止周期链并再次重启。清理本次验证的精确进程，记录请求、Run、游标及占用。

## Acceptance criteria

### D-AC01: 外部可用且无需内置规划者

由独立安装清单、包入口路径检查及编译器退出 0 证明，通过公共 API 可提交普通与周期请求、读取后继及耗尽事实，不实例化 Portfolio Planner 或内置上层 Agent。既有纯 helper 的传递包依赖不冒充已移除。

### D-AC02: 追加决策与恢复有真实证据

由实际 PID、启动/退出日志及三个 Host 生命周期记录证明：耗尽事件重复读取身份不变，重复追加只执行一次；强制退出后相同 Run / worker PID 恢复而不重新启动；执行限额未改变；停止周期链并跨过到期时间、再次重启均无新执行。同 Target 的外部 worker 生命周期不重叠，验证结束无遗留活跃进程。
