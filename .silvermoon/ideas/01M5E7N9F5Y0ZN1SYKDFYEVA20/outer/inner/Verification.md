# Regulation Coordinator 实施证据

实施基线为 `aa59c3b8520030722e624a785b1d401cfcd1463b`；本次补修起点为 `4e6fe621b75b20befb81dc160b664b5043c323d9`，随后普通快进集成并发 primary `5af38b4d2f069933b81a039b73b79d4378de7f6d`，保留其 CLI 与 package-settings 历史。本文件支撑 Implementation，不替代验收合同；不包含 Deployment 完成证据。本 IDEA 的 accepted ideal 与 Deployment seed 未改。

主 Agent 未接受 `implementationRevision=1b73e24427a5c7442513d20d35ee7f8bd9c1d14a`：原 25 项测试只证明最强目标聚合，没有证明 L1/L3 按各 consumer minimum 独立唤醒。此前 I-AC02 的完备声明撤回，相关 ledger 在补修开始时重置；本修订以新的 progress/partial outcome 代码和 9 项增量反例重新建立证据，不把原声明当作已获认可。

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
resolutions.push({ requirement, lease, observedAt });
if (controller.signal.aborted) throw new Error("Obsolete dependency resolution.");
```

解析完成的 mailbox 事务还检查 node UID、retiring、resolution controller 与 closing；旧 generation 不能安装新图。所有候选边先 DFS 检环，之后才安装 additions/sourceUpdates/waits；拒绝、重复解析、取消的 lease 走同一个 finally release。根 spec 不由本包释放。

provider 的当前 run 进展与所有合法停止结果（含 exhausted/authorization-required/dependency-required）均记录经验证的真实 level；每条 consumer wait 按其独立 minimum 判定，不等最强聚合目标。consumer 满足等待后只是变为 queued，仍须自己的 runner Regulation 与新 observation，不能继承 provider 的成功、权限或预算。可达性和终止确认的原规则不变。

新增 `CoordinatorFeedback` 分支 `{ type: "observation", observation: Envelope<PilotObservation> }`。只允许当前节点的 running run，work ID/generation 必须匹配；校验成功 envelope、Objective/version/full source、levels/problems 和时间。旧 run/stopping run/mismatched work 发 stale-result，错误来源/非法内容发 feedback failure。宿主 runner 可桥接已有 RegulationRuntime.onObservation；旧 process runner 没有自动新增回传，不修改旧代码。未支持运行期回传的 runner 仍通过最终 latestObservation 提供部分达成证据。

`recordObservation` 保存当前 level 而非 Math.max 历史值；早于已接受 evidence 时间的证据拒绝，等时按 mailbox 顺序处理。新 start 清空 prior-run readiness，替换有独立节点/generation；新版降级使未启动的 queued consumer 回到 waiting。consumer handoff 中精确匹配 provider 的更新低 level 也可降低缓存，但只有整张候选图通过后才安装；异步 resolver 带回的较旧 handoff 不覆盖更新的直接 progress。target-reached 单独检查启动时 run.target，先通过完整结果验证才记录/发布；即使聚合目标后来变弱，也不能用低于启动目标的结果宣称完成。

默认策略为零自动重试，不进行无限 continuation 或 stall allowance 增长。每次 start 全额预留 quota、不退款；显式 retry、替换、派生、资源变化和抢占共用剩余总预算。权限通过 `makeRegulationPermissions` 固定，命令多余字段拒绝；execution context 的 capability/authorization 请求也只发事实，不能扩权。

## 34 项测试分组

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

### 审查补修的 9 项增量测试

1. 同一当前 L3 provider 收到合法 L1 progress，只有 L1 consumer 启动；provider 未 abort/kill，L3 consumer 继续等待；后续 L3 progress 才释放 L3。
2. 参数化覆盖 exhausted、authorization-required、dependency-required 的合法 L1 latestObservation：只释放 L1；provider 不被自动重试，consumer 仍以原 permissions 执行，consumer 自己可再次 authorization-required，而非伪报成功。
3. lifetime budget 仅容纳 roots 两次 + provider 一次时，provider L1 证据使 L1 consumer 进入预算阻塞，不能额外启动；未达标的 L3 consumer 不被错误释放。
4. 失败 envelope、缺少/错误 source、版本不符、未知 level、非法时间的 progress 全部拒绝，无 observation fact、无消费者启动；随后合法进展恢复。
5. L1 consumer 已 queued 但资源不足时，更新的 initial 降级撤销其 readiness；迟到较早的 L3 证据拒绝；恢复容量不能使用历史高水位，新的 L1 才重新唤醒。
6. 根 provider 替换 generation/version 后，旧 run 高 level 进展和新 run 的旧 source 进展均不能唤醒新版本 consumer；新 run 的准确 L1 证据才可唤醒。
7. 移除 L3 consumer 使聚合目标降低后，原 L3 run 的低目标 target-reached 仍失败，不能利用当前聚合目标变弱绕过启动目标。
8. 真实 Effect.scoped 中先 acquire service，再 forkScoped 一个在 started 后永久等待但 interruptible 的消费者，并制造 bounded 背压。退出 scope 时自动得到 `subscriber-released → abort → kill-confirmed → scope-closed`；watchdog 未介入，不需外部解除订阅。
9. 已有高 level progress 时，更新 consumer handoff 的低 level 撤销缓存，不提前唤醒；反过来 resolver 迟到带回的旧 handoff 不能覆盖更新的高 level progress（两个时间顺序分支）。

第 8 项证明推荐同 scope/LIFO 清理路径没有自身订阅自锁，而非承诺任意外部消费者都无等待。cancel/close 与 result/feedback 都经同一 bounded mailbox，没有旁路。外部消费者必须持续 drain 或先取消；drain 仅保证 PubSub 保留消息已取走，不保证用户副作用完成。需要收取 cleanup facts 的外部订阅应持续消费到服务关闭后再结束，不能在自己的阻塞回调里等待 close。无需改用无界队列或静默丢事件。

资源 Behavior 的标准 SubscriptionRef changes 没有 typed error；资源故障恢复分支另以 Engine mailbox 的确定性测试覆盖。命令流的真实 Stream.fail 经公共入口监督，两个测试层次没有冒充相同观测。

## 实际校验

| 命令 | 结果 |
| --- | --- |
| `pnpm install`（新增 manifest 后） | 成功；lockfile 仅新增本包 workspace importer，无共享版本升级 |
| `pnpm --filter @potential-guide/regulation-coordinator build` | 成功 |
| `pnpm --filter @potential-guide/regulation-coordinator test` | 本次 34/34 通过（原 25 + 审查补修 9）；含 3 类 partial outcome 和 2 种 handoff 时间顺序参数化分支 |
| `pnpm exec tsc -p tsconfig.test.json --pretty false` | 退出 0，包含新包测试类型 |
| 新包 Biome check/lint | 通过，未新增工具 |
| `pnpm --filter @potential-guide/objective-portfolio-supervisor test` | 38/38 通过；旧实现和测试均未改 |
| `pnpm --filter @potential-guide/objective-monorepo-standard exec tsx --test --test-name-pattern "real repository has" test\pilot.test.mjs` | 21 包检查与旧 Supervisor handoff 子例，共 2 项通过；只更新包数量断言 20→21 |
| `pnpm pack:check` | 退出 0；17 个包的清单/exports 校验，10 个 consumer 场景均通过（含新增 coordinator 场景，显式安装 effects + coordinator，传递闭包 6 个内部包，检查 ESM 与 `.d.ts`） |
| `pnpm check` | 在集成 primary 5af38b4 后退出 1：layers/format/lint/typecheck 均通过，test 阶段仅旧 pguide 跨进程 capability-feedback 单例失败；Turbo 41/42 successful。不是全量绿；pack 被短路后已单独执行并退出 0 |

审查补修没有 manifest/lockfile 变化，未重复 install。集成并发 primary 前的完整检查曾退出 0；集成后重新运行得到上述唯一 baseline 失败，不能用集成前成功代替当前结果。本次新包 build、Biome、根 test typecheck、34 项定向测试与单独 pack 通过；pack 包括 exports/types tarball consumer。旧 38 项/21 包独立结果保留原证据，本任务未改其实现；并发上游 CLI 自有改动保留。本轮不再额外循环重跑旧 CLI 独立单例或修改它来制造绿色结果。

首次补修 snapshot check 因 origin/main 已由其他参与方推进、当前 checkout 尚缺其已集成 Idea 而拒绝（不是本任务删除事件）。随后检查精确 incoming diff，普通快进保留完整上游源代码与事件历史，重新验证，不重写历史或把其他 Idea 当作可删除对象。

第一次全量检查曾因新增 package 缺少 package-owned objectives、root delivery 登记及 20→21 断言失败，已逐项补齐；真实仓库检查独立复验通过。首次新增 pack consumer 因只选择 coordinator、却直接 import 未声明的 effects 而类型失败，已按 pnpm 严格边界显式选择这两个直接依赖，完整 pack 再验通过。

自动打包/consumer 是现有 `pnpm check` 的仓库验证，不是推进本 IDEA 的 Deployment；没有勾选任何 D-*、没有 package-specific tag、registry 发布、全局 link/install 或用户设备配置写入。更丰富的隔离 consumer 运行合同留在原 Deployment seed。

## 不掩盖旧 CLI 的独立失败

旧 `packages/pguide/test/supervisor-cli.test.ts` 中以下单例独立、无 Turbo 缓存运行退出 1：

```powershell
pnpm --filter pguide exec tsx --test --test-name-pattern "supervise dynamically binds a cross-process dependency" test\supervisor-cli.test.ts
```

失败发生在旧 fixture 的 worker 发送 `pguide/capability-request` 后等待 `marker + ".planner-feedback"`：15 秒内没有 Planner acknowledgement，stub 抛出 `Planner did not acknowledge capability feedback.`，ACP Agent 退出 1，旧 CLI 返回 70，测试在该文件 `434` 行断言 `70 !== 0`。这定位了失败所属的旧跨进程 capability-feedback/ack 链；没有把尚未精确证实的内部丢失节点写成已修复或已查明。

首轮全量检查的旧 pguide task 是 Turbo cache hit（观测 key `6282150da1331636`），缓存日志同时包含旧 `fail 0` 汇总及上述 failing-tests 文本；该缓存成功不能证明独立单例通过。本次集成 5af38b4 后完整运行约 15 分钟，实际重现同一单例失败（约 60.5 秒），pguide 109 项中 107 pass、1 fail、1 skip，Turbo 41/42 successful、33 cached，`pnpm check` 退出 1。此后只补跑此前被短路的 `pnpm pack:check` 并通过，没有重跑整套去追求偶然绿色。

这里向主 Agent 明确交接 baseline 限制，不跳过测试、改旧测试/服务或伪造无缓存全绿。新包没有出现在旧 CLI 的 manifest/runtime import 图中；lockfile 没有旧依赖变更。失败不是本次新服务的运行路径，旧 Supervisor 单元 38/38 及独立 handoff 的原回归证据保留；主 Agent 可据此决定是否接受这个已披露 baseline 限制或另开旧服务问题，不能据本提交推断旧 CLI 故障已修复。

## 未改变的边界与风险

- 首轮相对 aa59c3b 的旧服务整包 diff 为空。补修相对已集成 primary `5af38b4d2f069933b81a039b73b79d4378de7f6d` 执行 `git diff -- packages/objective-portfolio-supervisor packages/pguide packages/pguide-regulate packages/pguide-supervise` 仍为空；本任务不改旧服务、进程 runner 或接线。并发上游 CLI 自有变更被保留，不能宣称集成后的整支历史相对最初基线完全没有那些上游变更。
- 必需的现有文件改动仅限 workspace/Objective 注册、root tsconfig、package layer、release/pack validation inventory/对应 workflow 选项与数量断言，以及直接相关文档。新增 workflow 选项只是保持现有 inventory 一致，本轮没有运行发布。
- 慢订阅背压、永不 settlement 的 runner/resolver、失败后不能确认的 kill 会阻止安全关闭，这是明确安全边界，不用 timeout 假造清理。release 抛错通过事实和 cleanupFailures 暴露，宿主负责补救。
- 当前 source/permission 域采用保守共享，冲突来源明确阻塞而非自动另找 latest；默认不自动重试，总预算按完整 quota 保守预留，可能早于实际消耗耗尽。需要不同权限或续预算时必须由宿主显式建立新 scope。
- 本阶段的 gate 是补修后准确 implementationRevision 的重新 submitInner/upstream review；旧 submitInner 保留历史但对新 revision 失效，没有 acceptInner，也没有开始 Deployment。
