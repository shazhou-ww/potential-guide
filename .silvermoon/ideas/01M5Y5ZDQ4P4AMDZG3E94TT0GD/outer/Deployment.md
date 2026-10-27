# 验证外部消费者的周期请求闭环

依据为[构想](./inner/ideal/Idea.md)及对应实现。先同步本文及[验证工具](./verification/run.mjs)，再在工作区外执行；结果另记外部证据，不以仓库单元测试替代现实验证。

此前周期请求范围的已执行结果见[部署验证证据](./Deployment-evidence.md)及[结构化记录](./verification/results.json)；这些记录包含 Supervisor 传递依赖，不证明新增退役要求已经满足。退役后须用新的独立安装和执行证据重新验证。

本次新增验证工具会同时安装 Coordinator、pguide 与 pguide-regulate 的生产闭包，检查独立 lockfile 不含两个退役包；从安装包执行 unknown supervise、根 help、补全和保留的 regulate / continue / probe help。周期恢复试验继续使用三个实际 Host 生命周期，不改变已有业务源码。

本次退役后的实际结果见[追加部署证据](./Supervisor-retirement-deployment.md)及[新的原始记录](./verification/retirement-results.json)，与此前包含旧包依赖的历史记录分开保存。

## Steps

### D-S01: 准备独立消费者

使用 pnpm pack 打包退役完成后的 Coordinator 及内部生产依赖，在工作区外的新消费者中通过本地 tarball override 安装。严格检查安装闭包无两个退役包、类型与实际入口可用，并验证当前 CLI 分发与发现不再交付 supervise。固定编译器及实际版本，记录 tarball SHA-256 与环境；不得发布 npm、改设备配置或调用付费 Agent。

### D-S02: 演练追加投入与恢复

运行实际 Node Host、独立监听控制器及每 Run 的外部 worker。Host 使用公开文件 store 和有限执行配置；worker 模拟业务结果，不模拟进程退出。先验证耗尽重读与幂等追加，再在周期 Run 活跃时强制退出 Host、重新附着存活 worker，最后停止周期链并再次重启。清理本次验证的精确进程，记录请求、Run、游标及占用。

## Acceptance criteria

### D-AC01: 外部可用且无需内置规划者

由全新独立安装清单、包入口路径检查及编译器退出 0，证明 Coordinator 闭包不再包含 objective-portfolio-supervisor 或 pguide-supervise；普通与周期请求、后继及耗尽能力可用，无内置 Planner。当前 CLI 发现和指引明确反映 supervise 已退役，既有单次治理能力可用。

### D-AC02: 追加决策与恢复有真实证据

由实际 PID、启动/退出日志及三个 Host 生命周期记录证明：耗尽事件重复读取身份不变，重复追加只执行一次；强制退出后相同 Run / worker PID 恢复而不重新启动；执行限额未改变；停止周期链并跨过到期时间、再次重启均无新执行。同 Target 的外部 worker 生命周期不重叠，验证结束无遗留活跃进程。
