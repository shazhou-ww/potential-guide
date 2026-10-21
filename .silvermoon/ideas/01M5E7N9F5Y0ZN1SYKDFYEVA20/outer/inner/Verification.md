# Regulation Coordinator 实施证据

实施基线为 `aa59c3b8520030722e624a785b1d401cfcd1463b`。本文件支撑 Implementation，不替代验收合同；不包含 Deployment 完成证据。accepted ideal 与 Deployment seed 未改。

## 实现入口与可核对决策

- `packages/regulation-coordinator/src/types.ts`：严格命令、事实、工作身份、精确 resolver lease、可信预算和可选使用的 Runner execution context。
- `src/index.ts`：一次 scoped acquisition 原子注册唯一 mailbox fiber 的 acquire/release；输入订阅独立监督；输出 PubSub 与 mailbox 均 bounded，关闭前 drain，不重放历史。关闭时仍在外部 scope 的慢消费者必须继续 drain 或显式取消，不能把其背压当作服务静默丢事件。
- `src/engine.ts`：唯一 `handle(message)` 管理 roots、nodes、runs、等待边和预算。异步 start/result/kill/resolve/runner feedback 仅投递 mailbox，不在回调中修改图或队列。没有调用旧 createPortfolioPlanner/createPortfolioCoordinator。
- `src/validation.ts`：复用公开 canonicalJson/levelRank/validateGoal、makeRegulatorSpec 和 Pilot 的 subject/source 校验；根和 provider 都要求 exact Git source。共享身份包含 Objective/version/full source/subject/language，实例共用一个可信权限域；不兼容 source bindings 明确失败，不退回 latest。

核心证明（以源码为准）：

```ts
// 新的 scope 才拥有新的可信预算；业务输入不能补充它。
this.starts++;
this.reservedAgentRuns += this.options.quota.maxAgentRuns;
this.reservedDuration += this.options.quota.timeoutMs;

// choose() 同时计算 running/stopping，并按完整身份排斥重叠执行。
if (runs.length >= this.options.maxConcurrency ||
    runs.some(run => identity(run.node.regulation) === identity(node.regulation)))
  return undefined;

// 精确来源解析，await 前后均检查取消；不接收 latest 回退。
if (controller.signal.aborted) throw new Error("Obsolete dependency resolution.");
const lease = await this.options.resolveObjective(
  requirement.objectiveId,
  version,
  structuredClone(source),
  controller.signal,
);
resolutions.push({ requirement, lease });
if (controller.signal.aborted) throw new Error("Obsolete dependency resolution.");
```

解析完成的 mailbox 事务还检查 node UID、retiring、resolution controller 与 closing；旧 generation 不能安装新图。所有候选边先 DFS 检环，之后才安装 additions/sourceUpdates/waits；拒绝、重复解析、取消的 lease 走同一个 finally release。根 spec 不由本包释放。

provider 的成功只记录其达成 level；consumer 的 waits 满足后只是变为 queued，仍须自己的 runner Regulation 与新 observation。可达性从存活 roots 出发；失去最后引用的 running provider 先进入 stopping，确认终止后才删除及释放。仍有消费者或仍为 root 的 provider 不回收。`kill` 拒绝只发 failure，不调用 terminated；迟到 result settlement 仍能清理。

默认策略为零自动重试，不进行无限 continuation 或 stall allowance 增长。每次 start 全额预留 quota、不退款；显式 retry、替换、派生、资源变化和抢占共用剩余总预算。权限通过 `makeRegulationPermissions` 固定，命令多余字段拒绝；execution context 的 capability/authorization 请求也只发事实，不能扩权。

## 25 项测试分组

所有新测试位于 `packages/regulation-coordinator/test/coordinator.test.ts`，由 tsx + Node test runner 执行，且包含在根 `tsconfig.test.json` 的既有 glob 中。

| 分组 | 可观察断言 |
| --- | --- |
| 驻留及命令 | 空资源后恢复；正常有限输入结束后仍运行；闲置后再 add；FIFO、priority 无新 generation、stale/unknown/注入拒绝；cancel/re-add generation 递增 |
| 订阅 | 两订阅只启动一次执行；bounded 背压不丢订阅期 sequence；晚订阅无历史；事实 deep freeze；close drain 不丢缓冲清理事实 |
| 资源及终止 | capacity 收缩、能力撤销、binding 改变、移除、非法容量/binding；恢复合法快照后分配；P0 在 abort/kill 失败时不抢占 stopping 槽；迟到实际结束才释放 |
| 图所有权 | 两 roots 共享 provider、取消一个保留；provider 自身 root 保留；最后 root 替换回收整条链；聚合最强 level、最高 priority、能力并集，强化 running demand 必须停止后重启 |
| 依赖证据 | provider 成功只启动 consumer 重观察，consumer 可仍 authorization-required；自环、传递环及含合法前缀的多依赖候选全量拒绝；旧版本、source 缺失/冲突、问题不一致、错误 subject/level 和不精确 resolver 均失败 |
| 异步与恢复 | resolver await 中替换/取消与旧运行结果不污染新 generation；被取消但仍作为 provider 可达的 root 不被 stranded；不同版本不共享；blocked 派生 provider 可显式 retry |
| 预算和错误 | 注入权限拒绝、quota/授权阻塞不自动续跑、retry/replace 不恢复预算；start 抛错、result 拒绝后仍处理有效工作；命令流失败可见且资源输入仍可唤醒既有需求；resource-input mailbox 故障撤销及合法更新恢复 |
| 清理/反馈 | scope 等待 kill 确认才释放；release 失败发 failure 且 closed.cleanupFailures 非零；execution context 反馈携带准确 runId/generation，过期请求不扩权 |

资源 Behavior 的标准 SubscriptionRef changes 没有 typed error；资源故障恢复分支另以 Engine mailbox 的确定性测试覆盖。命令流的真实 Stream.fail 经公共入口监督，两个测试层次没有冒充相同观测。

## 实际校验

| 命令 | 结果 |
| --- | --- |
| `pnpm install`（新增 manifest 后） | 成功；lockfile 仅新增本包 workspace importer，无共享版本升级 |
| `pnpm --filter @potential-guide/regulation-coordinator build` | 成功 |
| `pnpm --filter @potential-guide/regulation-coordinator test` | 25/25 通过 |
| `pnpm exec tsc -p tsconfig.test.json --pretty false` | 退出 0，包含新包测试类型 |
| 新包 Biome check/lint | 通过，未新增工具 |
| `pnpm --filter @potential-guide/objective-portfolio-supervisor test` | 38/38 通过；旧实现和测试均未改 |
| `pnpm --filter @potential-guide/objective-monorepo-standard exec tsx --test --test-name-pattern "real repository has" test\pilot.test.mjs` | 21 包检查与旧 Supervisor handoff 子例，共 2 项通过；只更新包数量断言 20→21 |
| `pnpm pack:check` | 退出 0；17 个包的清单/exports 校验，10 个 consumer 场景均通过（含新增 coordinator 场景，显式安装 effects + coordinator，传递闭包 6 个内部包，检查 ESM 与 `.d.ts`） |
| `pnpm check` | 完整命令退出 0；layers、format、lint、typecheck、tests、build/pack 均到达成功退出；保留下面的 Turbo 缓存/历史 CLI 失败限定，不能等同于所有旧 CLI 反例都被本次无缓存证明 |

第一次全量检查曾因新增 package 缺少 package-owned objectives、root delivery 登记及 20→21 断言失败，已逐项补齐；真实仓库检查独立复验通过。首次新增 pack consumer 因只选择 coordinator、却直接 import 未声明的 effects 而类型失败，已按 pnpm 严格边界显式选择这两个直接依赖，完整 pack 再验通过。

自动打包/consumer 是现有 `pnpm check` 的仓库验证，不是推进本 IDEA 的 Deployment；没有勾选任何 D-*、没有 package-specific tag、registry 发布、全局 link/install 或用户设备配置写入。更丰富的隔离 consumer 运行合同留在原 Deployment seed。

## 不掩盖旧 CLI 的独立失败

旧 `packages/pguide/test/supervisor-cli.test.ts` 中以下单例独立、无 Turbo 缓存运行退出 1：

```powershell
pnpm --filter pguide exec tsx --test --test-name-pattern "supervise dynamically binds a cross-process dependency" test\supervisor-cli.test.ts
```

失败发生在旧 fixture 的 worker 发送 `pguide/capability-request` 后等待 `marker + ".planner-feedback"`：15 秒内没有 Planner acknowledgement，stub 抛出 `Planner did not acknowledge capability feedback.`，ACP Agent 退出 1，旧 CLI 返回 70，测试在该文件 `434` 行断言 `70 !== 0`。这定位了失败所属的旧跨进程 capability-feedback/ack 链；没有把尚未精确证实的内部丢失节点写成已修复或已查明。

全量 `pnpm check` 的旧 pguide task 是 Turbo cache hit（观测 key `6282150da1331636`），缓存日志同时包含旧 `fail 0` 汇总及上述 failing-tests 文本，因此单看缓存成功退出不能声称该独立单例通过。这里保留完整限制，向主 Agent 明确交接，而不是跳过测试、改旧测试、改旧服务或伪造无缓存全绿。新包没有出现在旧 CLI 的 manifest/runtime import 图中；lockfile 没有旧依赖变更。基线失败并非本次新服务的运行路径，旧 Supervisor 单元 38/38 及独立 handoff 回归通过；主 Agent 可据此判断是否需要另开旧服务问题，不能据本提交推断旧 CLI 故障已修复。

## 未改变的边界与风险

- 对实施基线执行 `git diff aa59c3b8520030722e624a785b1d401cfcd1463b -- packages/objective-portfolio-supervisor packages/pguide packages/pguide-regulate packages/pguide-supervise` 为空；既有 Planner/Coordinator/Supervisor、进程 runner、CLI 接线与测试完全保留。
- 必需的现有文件改动仅限 workspace/Objective 注册、root tsconfig、package layer、release/pack validation inventory/对应 workflow 选项与数量断言，以及直接相关文档。新增 workflow 选项只是保持现有 inventory 一致，本轮没有运行发布。
- 慢订阅背压、永不 settlement 的 runner/resolver、失败后不能确认的 kill 会阻止安全关闭，这是明确安全边界，不用 timeout 假造清理。release 抛错通过事实和 cleanupFailures 暴露，宿主负责补救。
- 当前 source/permission 域采用保守共享，冲突来源明确阻塞而非自动另找 latest；默认不自动重试，总预算按完整 quota 保守预留，可能早于实际消耗耗尽。需要不同权限或续预算时必须由宿主显式建立新 scope。
- 本阶段的 gate 是准确 implementationRevision 的 submitInner/upstream review；没有 acceptInner，也没有开始 Deployment。
