# 双 Behavior Coordinator 隔离消费证据

本文件仅对应已接受实现 `764bdf07cd0496708947495ae96c8b70f1bdc382` 的本轮部署验证，不替代或复用旧五命令交付的 [Evidence.md](./Evidence.md)。

## 固定候选与复现入口

- 接受的代码提交：`344136c5b47bd4a55663b23089efd7dd7cedef6b`。
- 验证契约及脚本先同步于 primary：`07a5890293504dcaac9ad0ec1d69dd2b0812d806`。
- 当次 deploymentRevision：`c0e526f2594174a3982fa8718637b573e2a9adff`。
- [Deployment.md](./Deployment.md) 的 Git blob：`93709de37a3d054a17c033720027e6cdc5c5be6c`；执行后未修改该契约。
- 环境：Windows，Node `v24.12.0`，pnpm `11.22.0`。
- [完整结构化结果](./verification/behavior-result.json) 包含时间、各包版本、源码 tree、tarball SHA-256 及每个 consumer 的结果。

从仓库根目录执行：

```powershell
node .silvermoon\ideas\01M5E7N9F5Y0ZN1SYKDFYEVA20\outer\verification\verify-behavior.mjs .silvermoon\ideas\01M5E7N9F5Y0ZN1SYKDFYEVA20\outer\verification\behavior-result.json
```

[验证入口](./verification/verify-behavior.mjs) 首先检查 accepted inner tree，以及所有内部依赖包源码 tree 与接受的代码提交一致；不静默使用另一个实现。consumer 在系统临时目录运行，[测试程序](./verification/behavior-consumer.mjs) 只导入安装后的包入口，不导入工作区源码。

## D-S01 / D-AC01：真实隔离包

共构建、打包并安装 7 个内部包：effects、regulation-coordinator、objective-pilot、check-host、pilot-protocol、objective-regulator、objective-portfolio-supervisor。

- 每个 tarball 均记录版本、SHA-256 和对应源码 tree；没有使用 npm 已发布的同名版本替代候选。
- 递归验证依赖版本和实际 realpath：全部位于独立 consumer 内，没有借用工作区的内部包。
- 公开 ESM 入口正常加载；独立 TypeScript consumer 的严格声明类型检查通过。仅编译器工具来自仓库工具链，业务依赖来自 consumer 安装。
- 项目安装仅写入临时 consumer manifest/lockfile 和包管理器缓存，没有改变仓库依赖、全局入口或设备配置。

## D-S02 / D-AC02：执行、观察与进程重启

| 独立 consumer 进程 | runner.start 调用 | 真实 child 启动/退出 | 恢复核实调用 | 结束时占用 | 状态 revision |
| --- | ---: | ---: | ---: | ---: | ---: |
| first | 2 | 1 / 1 | 0 | 0 | 14 |
| resume | 0 | 0 / 0 | 0 | 0 | 14 |
| unknown | 0 | 0 / 0 | 1 | 1 | 6 |

### 首次运行

- no-resource 初值下没有 runner.start，initial 请求直接完成本地处理而不产生业务调用。
- 配置资源后，work 请求启动真实 Node 子进程；等待进程 close 后才返回终结结果。成功 Observation 使用明确标注的测试载荷，固定引用该请求采用的定义与来源。
- denied 请求的 runner.start 明确抛出 fixture `EACCES`，没有启动第二个外部进程；记录 error 结果与故障，不重试扩权、不引入 harness 审批、不伪报成功。
- 两个本地尝试均已终结，实际占用为零；initial 不计为 Run。五层视图和快照纯重放结果相等，所有共享请求的全局 satisfaction 仍为 undetermined，不被本地结果替代。

### 真正重启 consumer

- first consumer 进程完全退出后，另起 resume consumer，打开同一个真实文件快照并输入相同请求。
- 没有再次调用 runner.start 或 recover，没有产生子进程；完整状态与首次保存的状态深度相等，revision 保持 14。
- 这证明跨 consumer 进程恢复不把已结束的意图重新执行，不是同一进程内复用内存的演示。

### 未核实执行反例

- unknown 使用单独 profile 和显式构造的历史 active-run fixture；没有假装存在一个真实失联进程。
- recover 返回 unknown 后，Run 保持 unverified，实际/保守占用仍为 1，没有重复启动；明确报告 `Cannot verify unverified-fixture`。
- 此反例证明消费包对未知执行的保守语义，不证明某个外部 Agent provider 的重关联实现。

## D-S03 / D-AC03：兼容、清理与证明边界

- 每个 consumer 都实际获取并关闭旧 `regulationCoordinator` 的空 scope；没有触发旧 runner 或 resolver。没有迁移或重接既有 Supervisor/Planner/Portfolio。
- 三次新 store scope 均已关闭，关闭后读取明确拒绝；真实 child 启动数与退出数相等，consumer 进程全部正常退出。
- harness 的 finally 删除整个本次专用临时目录，并验证路径已不存在；产物包、安装目录、profile 快照和锁文件随之清理。结构化结果的 cleanup 为 true。
- 本轮不发布 npm，不修改全局/设备配置，不运行中央同步、跨 Host 全局协调或真实 Agent 业务服务。观察载荷、资源拒绝和 unknown 场景是 fixture；真实 Node 子进程与真实文件快照证明的范围已分别注明。
- 实现阶段已披露的独立 check-host 启动恢复测试超时不由此消除，本轮不宣称全仓检查通过。该限制不影响本轮隔离 consumer 的实际通过结果。
