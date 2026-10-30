# 主体世界验证证据

## 验证边界

2026-10-30，在隔离工作树 `D:\Code\potential-guide.worktrees\probe-task-implementation-idea2`
完成实现与验证。实现基线为 `8b7d48a2f1f44889c043a54bafa026af1dad3c71`；
subagent 未进行 Git 写操作。父执行者独立审查、修正时钟边界并验证最终候选，
负责后续提交同步。没有修改已接受的 Ideal 或 Deployment，也未记录实施或部署验收。
本文件记录主体世界事实，不代替现实世界验收。

环境为 Windows、Node.js `v24.11.1`、pnpm `11.22.0`。

## 已取得的结果

| 验证 | 结果与可复跑入口 |
| --- | --- |
| 全仓验证 | 两个时钟边界修正后，父执行者重新运行最终 `pnpm check`，退出码 0；包含层次、格式、lint、类型、测试、构建和全部生产包消费者验证。 |
| Probe | 两个时钟边界审查修正后，`pnpm --filter @potential-guide/probe-task test` 为 14/14 通过，无跳过；此前全仓执行为 12/12。 |
| 通用 Engine 回归 | 58/58 通过；包含单个默认分配槽下，运行中与排队父任务的独立分配通道。 |
| 通用 Server 回归 | 父执行者独立运行 10/10 通过，最终全仓验证再次通过。 |
| Check 回归 | 11/11 通过；原 worker、来源与重启边界保留。 |
| 旧 ObjectiveService 回归 | 4/4 通过；旧进程内/HTTP 客户端、动态依赖、强弱观察共享和语言语义保留。 |
| 仓库声明回归 | 新 workspace 完成所属层次、包级 `objectives.yaml` 和根交付清单登记；实际 33 个包的验证通过。 |
| 脚本测试 | 最终全仓脚本测试 42/42 通过。 |
| 独立生产包 | `pnpm pack:check` 作为全仓验证末段通过；Probe 场景安装 6 个直接入口、9 个内部生产包，没有旧 Checker Host、Objective Host 或 Objective Pilot。 |
| 差异完整性 | `git diff --check` 通过；没有修改 Ideal、事件文件或 Deployment。 |

全仓现有测试保留其平台/能力跳过规则；上述 Probe 用例没有跳过。
初始验证发现的新包清单遗漏已补齐；在并行安装负载下，重启测试的有限进程就绪预算
调整为 60 秒，随后最终全仓验证通过。没有因此放宽生产执行墙钟或清理保证。

## 审查修正：业务时钟回退

父审查指出结果重放错误要求子执行 UTC 启动时间不早于父执行。
新增确定性回归在可信 `children` 回调中、父启动握手之后而子任务提交之前，
将 Engine 业务时钟回拨 20 秒。修正前实际复现
`invalid_probe: Child completion evidence differs.`，父执行没有正常完成事实。

删除该跨执行 UTC 比较。父子因果由持久启动握手、effect transcript 和事件序号证明，
不是由不同执行的 UTC 大小关系证明。回归同时断言父启动事件序号早于子 Task 创建事件；
子执行虽然 UTC 更早，父执行仍保留正常完成事实。Task 结果适用性仍交由 Engine。

父执行者进一步核对通用引擎时间谓词，补充子 Check 已启动后时钟回退 20 秒的回归。
引擎在 `started-after-eligible` 策略下允许完成 UTC 早于启动 UTC，不能额外假设同一
执行内的业务时钟单调递增。Probe 现在直接复用 `matchesExecutionTime`，不自建时间规则；
子执行自己的严格 eligible 边界及完成不晚于 deadline 仍保留，伪造这两个边界仍被拒绝。
实际子任务正常完成，父执行保留正常完成事实，重放验证通过。

修正后的 `probe-task` build、13 项测试、lint，以及
`pnpm exec tsc -p tsconfig.test.json --pretty false` 均通过。
此后父执行者补充的第二个边界修正通过 build 和全部 14 项 Probe 测试。
父执行者独立重跑 Engine 58/58、Server 10/10、旧 ObjectiveService 4/4，均通过。
审查修正仅涉及 Probe 契约、Probe 测试及本证据文件。

## 关键证明

### 准确观察与证据

`packages\probe-task\test\probe.test.ts` 验证：

- 累计等级在较高等级出现问题时保留已达等级，同一级多个 Check 均参与观察；
  正常业务缺口是 `completed`，不是执行故障。
- 根与静态 Checker 完整字节、实际环境、输入快照和 References 来源 digest 一致；
  修改输入、Prepared 字节、结果等级、环境或因果顺序不能改变已固定内容。
- 动态 requirements 生成独立依赖观察与二次 Check；选版进展保留准确内容，
  子启动进展包含任务/执行关联。移除外部依赖源后仍可仅凭持久证据重放验证结果。
- 未声明问题、不一致结果、伪造依赖问题、未知目标等级均明确失败；
  `context.resolutions` 和调用权限不能由 Probe 输入注入。

实际解释逻辑位于 `check-artifacts/observation`，由旧 ObjectiveService、新 Probe
和结果证据重放共同调用；没有保留第二份 Probe 等级/依赖解释器。

### 所有权、时间与物理资源

- 五个并行父 Probe、两个父槽和一个 Check worker，在 Engine 默认分配容量为一时全部完成。
  `allocationLimit` 是可信类型注册元数据，不是请求字段。
- 撤销父执行只撤销该执行创建的子 Task；同一 Check Execution 的独立 owner 继续完成。
- 确定性调整 Engine 时间后，父 Task deadline 到期不会被当作执行取消；
  迟到执行结果保留为执行事实，不反向完成已超时的 Task。
- 在真实子 Check 已跨越启动边界后触发父执行墙钟，确认根 Worker 退出、
  子任务撤销、子执行 `reclaimedAt`、双方资源槽释放，未出现隔离或泄漏。
- 深度、Check 数量和墙钟预算均有失败诊断；未确认清理时由现有 Pool 隔离容量，
  没有用 Promise 完成冒充物理强杀。
- `restart.test.ts` 杀死本测试拥有的实际服务进程，随后重开同一 SQLite：
  已完成结果与执行 ID 保留；已启动 Probe 返回 `execution_interrupted`；
  Checker 实际调用标记没有再次出现，原 Task deadline 保留。

### 公共消费者

`examples\task-server\probe-integration.mjs` 被复制到独立生产 tarball 安装目录运行。
它使用同一配置同时注册 Check/Probe，验证：

1. 进程内与真实 HTTP 提交得到一致的业务问题和准确制品引用。
2. SSE 断开后用 `Last-Event-ID` 重连，结果与 HTTP 一致，重放事件序号严格晚于原 watermark。
3. 子任务历史可经授权 HTTP 与进程内接口读取；未认证请求被拒绝。
4. SQLite 重开保留结果和身份；受管 worker 目录清理完成。

最终消费者输出：

```text
probe-packed: exact artifacts, one Check worker, in-process + real HTTP/SSE reconnect, authorized child history, SQLite recovery, physical cleanup
isolated probe-task: 6 selected, 9 internal packages; packed consumption passed
```

Server 自身的独立消费者仍只安装 5 个通用内部包，没有引入业务或制品依赖。
`check-artifacts/contracts` 的纯验证消费者继续通过；这不意味着安装依赖隔离：
现有 `esbuild`、`tar` 等依赖仍随制品包安装。

## 当前限制与交接

- 默认 ArtifactSource 仍是授权 HTTPS；测试下载器是明确注入的受控夹具，
  没有实现或假定其他会话的本地文件支持。
- 动态准确文件内容进入授权进展/结果历史；部署方需要配置相应 payload、存储和权限预算。
  示例预算为 16 MiB。历史版本/运行环境不匹配仍按 Engine 规则显式拒绝，不能静默换版重跑。
- Worker 是资源隔离，不是任意不可信代码的安全沙箱；仍只能授权可信 Checker 制品。
- 本次没有运行修复 Agent、实现 Regulate、发布 npm，或执行现实世界部署验收。
  独立外部部署、人工审查以及生命周期决定均留给父执行者；全部 `D-*` 保持未勾选。

## 完整变更清单

以下路径均相对该隔离工作树：

```text
.silvermoon\ideas\01M65AH22HXJXNC7BQNVD0ZTHB\ledger.md
.silvermoon\ideas\01M65AH22HXJXNC7BQNVD0ZTHB\outer\inner\Implementation.md
.silvermoon\ideas\01M65AH22HXJXNC7BQNVD0ZTHB\outer\inner\Evidence.md
docs\npm-publishing.md
docs\task-engine.md
docs\task-server.md
examples\task-server\README.md
examples\task-server\probe-config.mjs
examples\task-server\probe-integration.mjs
objectives.yaml
package-layers.yaml
packages\check-artifacts\package.json
packages\check-artifacts\src\observation.ts
packages\check-task\README.md
packages\check-task\src\index.ts
packages\check-task\src\worker.ts
packages\objective-host\src\service.ts
packages\objective-monorepo-standard\test\pilot.test.mjs
packages\probe-task\README.md
packages\probe-task\objectives.yaml
packages\probe-task\package.json
packages\probe-task\src\contracts.ts
packages\probe-task\src\index.ts
packages\probe-task\src\worker.ts
packages\probe-task\test\fixtures.ts
packages\probe-task\test\probe.test.ts
packages\probe-task\test\restart-child.mjs
packages\probe-task\test\restart.test.ts
packages\probe-task\tsconfig.json
packages\task-engine-server\README.md
packages\task-engine-server\src\index.ts
packages\task-engine\src\engine.ts
packages\task-engine\test\orchestration.test.ts
packages\task-protocol\src\types.ts
pnpm-lock.yaml
scripts\check-package-consumers.mjs
scripts\release-packages.mjs
scripts\release-packages.test.mjs
```
