# Task Run Logs 实施证据

> 本文件保留当时 v2 候选的原始证明，不是当前 v1 证明。用户后续明确纠正：
> 项目尚未正式发布，日志统一回到唯一 v1，v2 已移除；以下历史命令和结果已被取代。

## 父任务最终复核

最终有界丢弃通知修订后，父任务实际重跑：

```powershell
pnpm exec tsc -p tsconfig.test.json --pretty false
pnpm run format:check
pnpm exec tsx --test --test-concurrency=1 packages\task-engine\test\run-logs.test.ts packages\task-engine-server\test\run-logs.test.ts packages\task-engine-http\test\run-logs.test.ts packages\task-engine-storage\test\run-logs.test.ts
Set-Location packages\task-sdk
pnpm exec tsx --test --test-concurrency=1 test\bundle.test.ts test\logs.test.ts test\drop-reporting.test.ts
```

结果：类型、格式 exit 0；核心 **13/13**、SDK **9/9** 通过。父任务此前独立重跑
UI 日志、standalone 与既有 diagnostics 测试 **5/5** 通过。
审核发现的容量拒绝通知无限排队已修复：普通累计快照最多一个在途，
超时不授权追加快照，终结时最多补一个不阻塞业务的累计快照；
两项真实 Worker 回归各产生 40,000 次容量拒绝，确认最多两帧且最终计数一致。
全量检查失败和不相关的既有职责分类问题保留在下方，不将其宣称为通过。

## 范围与边界

工作目录：`D:\Code\potential-guide.worktrees\task-run-logs-follow-up`。
验证环境：Windows，Node `v24.11.1`，仓库 pnpm `11.22.0`。
本文件是 I-* 实施证据，不是部署审批。未改动 accepted ideal、Deployment.md、
events.jsonl、Git 分支/索引，也未提交、推送或调用 Silvermoon 门禁。

已接通作者 `context.log` → SDK Worker 独立通道 → 宿主 generation/Run/scope 校验
→ 独立有界持久化 → HTTP history/SSE client → Run 详情 Logs。
日志没有进入 Result、progress、checkpoint、匹配/复用或生命周期事件。

### 源码定位

- [类型、回执、容量、状态与 JSON 校验](../../../../../packages/task-protocol/src/logs.ts)
  / [RunContext.log](../../../../../packages/task-protocol/src/run.ts)
  / [显式 v2 与不变 v1 的声明校验](../../../../../packages/task-protocol/src/bundle.ts)
  / [当时的 canonical v2 Schema](https://github.com/shazhou-ww/potential-guide/blob/38c872cfd53a9e0343f05c12f73043f1caf6920b/schemas/artifacts/task/v2.json)。
- [SDK 独立 pending/timeout/cancel 与聚合丢弃](../../../../../packages/task-sdk/src/index.ts)；
  [实际独立 SDK bundle 测试](../../../../../packages/pguide-task-bundle/test/logs.test.ts)。
- [Worker 宿主身份校验与独立确认](../../../../../packages/task-engine/src/type-supervisor.ts)；
  [Engine 授权/查询/订阅](../../../../../packages/task-engine/src/engine.ts)；
  [有界日志策略](../../../../../packages/task-engine/src/logs.ts)。
- [SQLite 独立日志存储与故障状态](../../../../../packages/task-engine-storage/src/index.ts)；
  [Server lease 转发](../../../../../packages/task-engine-server/src/index.ts)。
- [HTTP 路由](../../../../../packages/task-engine-http/src/index.ts)、
  [pull-driven SSE](../../../../../packages/task-engine-http/src/logs.ts)、
  [异步 query/subscribe client](../../../../../packages/task-engine-http/src/client.ts)。
- [Run 详情界面与代际隔离](../../../../../apps/task-engine-web-ui/src/browser.ts)、
  [有界浏览器窗口/帧解析](../../../../../apps/task-engine-web-ui/src/run-logs.ts)、
  [受限可信代理路由](../../../../../apps/task-engine-web-ui/src/server.ts)。
- [真正 Check 作者适配器的选定问题诊断](../../../../../packages/check-task/src/index.ts)；
  [精简业务 Result 的逐项 assertion 样例](../../../../../packages/pguide-task-bundle/examples/low-level/check-diagnostics/callback.ts)。
- [API、容量/保留/认证选项和独立 pack/install/run 完整步骤](../../../../../docs/task-run-logs.md)。

## 已执行命令与结果

以下命令从工作目录执行，除非明确 `Set-Location`。测试使用 Node test runner / tsx；
未安装新的项目依赖或新增测试框架。

### 构建与类型

```powershell
pnpm exec turbo run build --filter=@potential-guide/task-engine-server --filter=@potential-guide/task-sdk --filter=@potential-guide/task-engine-web-ui --filter=@potential-guide/check-task --filter=@potential-guide/probe-task --output-logs=errors-only
pnpm exec tsc -p tsconfig.test.json --pretty false
git --no-pager diff --check
```

结果：build **12/12 成功**；测试源码类型检查与 whitespace 检查均 exit 0。
相关文件使用 Biome 格式化；v2 Schema 通过既有同步脚本生成，
check-task runtime identity 通过既有 embed 脚本更新。

### SDK 和显式兼容

```powershell
Set-Location packages\task-sdk
pnpm exec tsx --test --test-concurrency=1 test\bundle.test.ts test\logs.test.ts
```

结果：**7 pass / 0 fail**。实际生成的 v1 bundle 在作者文件移除后仍运行；
v2 日志 timeout、cancel、unawaited 输出、宿主 invalid_log ack 均通过。
日志等待不占用 maxInFlight=1 的必要业务输出队列。
从根目录误跑既有 SDK V01 会因作者临时 fixture 找不到 workspace dependency 失败；
按该包 cwd 重跑通过，这不是运行库依赖回归。

### Engine / SQLite / HTTP 实际链路

```powershell
pnpm exec tsx --test --test-concurrency=1 packages\task-engine\test\run-logs.test.ts packages\task-engine-server\test\run-logs.test.ts
```

结果：**9 pass / 0 fail**，覆盖：

- 真正 SDK bundle、并发 Run 隔离、持久化确认、单调 sequence、host time、
  精简 `{ok:true}` Result、无日志生命周期事件、关闭/重启 SQLite 后一致读取；
- Run 读取 auth：缺凭据 401、其他 scope 的 history/SSE 403、不存在 Run 404、
  invalid cursor 400；history→SSE 续接没有漏掉保留条目；
- 成功、业务失败、cooperative cancel、forced stop、非法输入、超大条目、
  SDK/每 Run 输出超限和聚合丢弃；
- 写故障产生 unavailable receipt，缺失状态跨重启保留，正常 Result/回收不受影响；
- 慢 consumer 无推送队列，历史可补读；保留清理后 expired/gap 可见；
  独立订阅容量上限和释放、正文/metadata/global budget；
- 页面固定 1 MiB transport ceiling，较大 pageSize 仍按游标无缺口继续；
- 旧 v1 是 unsupported，v2 disabled 与“没有输出”明确区分。

Forced stop 测试没有伪造资源清理证明：Worker 的 forced exit 已发生，
日志尾部 unknown；既有生命周期仍报告 cleanupUnknown 并拒绝“假成功关闭”。
这与日志排空无关，正常成功/失败/协作取消可真实回收。

追加边界验证：

```powershell
pnpm exec tsx --test --test-concurrency=1 packages\task-engine-storage\test\run-logs.test.ts packages\task-engine-http\test\run-logs.test.ts
```

结果：**4 pass / 0 fail**。即使 lifecycle busy timeout 配置为 5000 ms，
SQLite 日志 write/prune/status 三项在竞争锁下立即失败（总测试 220 ms），
恢复独立 lifecycle timeout、不保留事务，后续事实/日志存储仍可用。
SSE 在 pending pull 期间 cancel/abort 立即释放容量、不追加读取或 Task 操作；
状态服务故障是明确 error frame，不是成功形状的空页。

最终源码（包括即时锁故障与 cancel/abort 防护）再次合并验证：

```powershell
pnpm exec tsx --test --test-concurrency=1 packages\task-engine\test\run-logs.test.ts packages\task-engine-server\test\run-logs.test.ts packages\task-engine-http\test\run-logs.test.ts packages\task-engine-storage\test\run-logs.test.ts
```

结果：**13 pass / 0 fail**；同轮源码类型/构建验证仍是 **12/12 成功**、
`tsconfig.test.json` exit 0。

### Web UI 与独立构建

```powershell
Set-Location apps\task-engine-web-ui
pnpm exec tsx --test --test-concurrency=1 test\run-logs.test.ts test\run-logs-standalone.test.ts test\run-diagnostics.test.ts
```

结果：**5 pass / 0 fail**。实际 DOM 覆盖 Logs 的 follow/pause/reconnect、
history 页替换、切换 Run 后迟到响应隔离、结构化字段文本渲染、
300 条 / 1 MiB 清理、expired/gap/unknown 可见。生命周期历史拒绝不阻止 Logs。

Standalone 测试复制完整 built UI `dist`，从独立目录启动生产入口；
Node filesystem permission 仅允许复制目录，因此不能借用 workspace
node_modules。实际 SDK assertion bundle → HTTP 后端 → standalone UI proxy
history/SSE 通过，pageSize=1 仍完整补读；Bearer 不进入 bootstrap，
UI token/endpoint binding/受限 query 都通过。业务结果为
`{ok:false, problemCount:1}`，详细逐项内容在独立 Logs。
测试初次误用了当前 Node 已退休的 experimental permission 拼写；
已按 Node 支持能力选择 stable/experimental flag，并复测通过。
最后增加旧宿主 `unsupported_version` 的明确提示验证，再执行
`test\run-logs.test.ts test\run-logs-standalone.test.ts`，**4 pass / 0 fail**；
UI build **10/10 成功**。最后 `pnpm run format:check` 检查 **616 files / exit 0**，
测试源码类型检查、canonical Schema `--check`、check-task embed `--check`
及 `git diff --check` 均 exit 0。

### 相关既有回归与已知 timing 基线的控制重测

```powershell
Set-Location packages\check-task
pnpm exec tsx --test --test-concurrency=1 --test-name-pattern="configured Engine budget|real worker reports normal|SQLite/Node-worker restart" test\check.test.ts test\restart.test.ts
Set-Location ..\task-engine
pnpm exec tsx --test --test-concurrency=1 test\bundle-admission.test.ts test\run-logs.test.ts
Set-Location ..\task-engine-storage
pnpm exec tsx --test --test-concurrency=1 test\storage.test.ts
Set-Location ..\task-engine-http
pnpm exec tsx --test --test-concurrency=1 test\bundle-admission.test.ts test\contract-v4.test.ts test\executions.test.ts test\http.test.ts
```

结果依次：**4/4、7/7、16/16、16/16 pass**。
包括既有 Check 大预算/正常负业务观察、HTTPS/file restart readiness、
Engine V04 preparing capacity、SQLite 真实 crash/restart/事务故障、既有
HTTP 授权/目录/生命周期 SSE/消息语义。没有为 timing 基线修改无关生命周期代码。
此前 UI integration 的 12 项既有代理/认证/取消/断连回归也全部通过。

### 独立本地 tarball 安装验证（未发布 npm）

```powershell
node scripts\check-packages.mjs --task-bundles
```

结果：**exit 0**。10 个本地 package tarball 校验通过，作者与 runtime 生产依赖图
独立安装，production host 不包含 SDK/Check/Probe 作者依赖；
移除作者源码及 node_modules 访问后执行真正 Check/Probe bundles。
新增验证输出原文：

```text
Packed v2 Check diagnostics: HTTP history and realtime replay verified; Result/evidence unchanged.
Independent production host: self-contained Check/Probe Bundles, actual negative business results and evidence verified; author node_modules unavailable.
```

脚本源码：[独立消费验证](../../../../../scripts/check-task-bundle-consumer.mjs)；
SDK-only pack 验证也升级为真实 v2 独立诊断确认。
另实际执行 `node scripts\check-packages.mjs --task-sdk`，**exit 0**；
4 个内部包 tarball 的独立消费通过，dependency control 分别证明可见/缺失，
作者进程退出后 v2 Worker 在没有 node_modules 的消费端完成真实日志确认。
操作者可复制/保留 candidate 的完整步骤、配置与默认限额在
[Run Logs 独立安装章节](../../../../../docs/task-run-logs.md#independent-local-packinstallrun-no-npm-publish)。
此处不将这些 fixture 认证配置当作已批准的部署策略。

## 全量 check 状态与风险

已实际执行 `pnpm check`。首次在新增 standalone 测试 flag 的格式问题停止，
已修复；后续 layers、format、lint、typecheck 通过。默认高并发全量 test
出现此前已报告的 Check 大预算初始等待/正常 Worker timing 失败，并连带中断
新的 Server 日志测试文件和其他 tsx/esbuild 子进程；**没有把中断当作通过**。
上述相关基线与新增链路均已按受控并发独立重测通过。

上一轮实施源码再次执行 `pnpm check`（历史结果，见下文父任务受控全量补充）：**exit 1**，
Turbo 报告 **62 successful / 70 total（58 cached）**；
最终失败项是既有 Check 正常 Worker 负业务观察及 HTTPS/file child readiness。
同轮还出现 Probe 的 4 项约 5.6 秒启动/时钟边界 timing 失败。
随后以当前最终源码受控重测上述 Check 4 项与 Probe 4 项，均 **4 pass / 0 fail**：

```powershell
Set-Location packages\probe-task
pnpm exec tsx --test --test-concurrency=1 --test-name-pattern="known URL paths reject|Probe digest conflicts|backward business clock|clock rollback during child" test\input-schema.test.ts test\probe.test.ts
```

最终独立 tarball proof 曾遭 pnpm native 瞬时退出 `3221226505`；
单独重跑 `pnpm --filter @potential-guide/check-artifacts build` exit 0，
随后重跑 `node scripts\check-packages.mjs --task-bundles` **exit 0**，
同样输出上述 v2 Check history/SSE 成功证据。未为 pnpm 进程异常改项目代码。

额外运行 `pnpm exec turbo run test --concurrency=1 --output-logs=errors-only`
覆盖整个 workspace；约十分钟后仍停留在既有
`packages\pguide\test\execution-output.test.ts` 的 probe CLI 子进程，
输出未形成最终结果。经仅检查该任务自己的 process tree 确认后停止整棵任务树，
避免留下背景进程。该测试通过 Objective Pilot/Host CLI 路径，
其源码/运行模块没有 Task Engine 日志 API 接线；未为此修改无关逻辑。
这是 **未完成的额外全量验证**，不计作通过；全量 check 不是未经证据宣称的“全绿”。

实现保留的操作风险：

- SQLite 同步 I/O 不提供硬实时磁盘延迟保证；逻辑有界不保证物理文件即时缩小。
- 诊断输出是 best-effort；ACK timeout 的写入结果未知，不能自动重试。
- 保留或 metadata 淘汰后有显式缺失/过期状态，不承诺永久历史。
- Worker 非安全 sandbox；作者必须显式挑选非敏感字段，不能把环境/凭据转储进日志。
- Forced stop 的独立清理未知仍按原策略保留 ownership；Logs 不改变该裁决。
- 本文件仅核验实施；D-*、人工部署体验与外部服务认证策略仍由父任务门禁处理。

## 2026-11-03 丢弃报告背压复核修复

父任务指出原 `queueMicrotask(flushDroppedLogs)` 会在不断
`await context.log(...)` 的 capacity rejection 中逐条排入无确认 `log-drop`；
这是新增通道的实际有界性缺陷，已修复，不归类为 timing 基线。

修复：

- [SDK](../../../../../packages/task-sdk/src/index.ts) 只保留一个普通累计快照在途，
  使用独立 `log-drop-ack` 与 1000 ms timer。超时保留未知确认身份并冻结后续发送，
  不释放成新的 IPC 槽位、不自动重试；匹配的迟到 ACK 才恢复聚合。
- 容量拒绝仅增加饱和计数器；结束时最多额外发送一个不等待的终端累计快照。
  即使宿主一直不确认，控制消息在途总计最多两个，不占必要业务输出队列，
  不等待诊断排空，不改变取消/Result/资源回收。
- [宿主](../../../../../packages/task-engine/src/type-supervisor.ts) 校验累计快照和终端标记，
  只计累计值的增量；[日志存储](../../../../../packages/task-engine/src/logs.ts)
  返回明确报告回执，存储/禁用故障不会伪装为成功报告确认。
- `validateRunLog` 移除了 `as unknown as RunLogInput`；枚举、message、
  字段对象逐项 guard 后显式构造返回对象。Engine 新增 imports 已移至文件顶部。
- [新增真实 SDK bundle 回归](../../../../../packages/pguide-task-bundle/test/drop-reporting.test.ts)
  在宿主不确认普通 log 时，分两轮执行共 **40000 次 awaited rejection**，
  第二轮在报告确认 timeout 之后，分别测试一直不确认 drop 与迟到 ACK。
  断言普通报告超时后仍只有一帧、最终最多两帧、最终丢弃总计准确为 40000，
  progress/complete/released 正常完成。Core 实际 Worker 测试追加累计 5→10
  的终端去重，以及 overflow 精确计数 248。

本轮只执行针对性验证，未并发运行全量 suite；父任务的受控 `pnpm check`
与后续部署门禁仍由父任务处理：

```powershell
pnpm exec turbo run build --filter=@potential-guide/task-sdk --filter=@potential-guide/task-engine-server --output-logs=errors-only
node scripts\sync-objective-schemas.mjs
pnpm exec tsc -p tsconfig.test.json --pretty false
Set-Location packages\task-sdk
pnpm exec tsx --test --test-concurrency=1 --test-name-pattern="generated production Worker|awaited diagnostic floods|SDK diagnostic" test\bundle.test.ts test\drop-reporting.test.ts test\logs.test.ts
Set-Location ..\..
pnpm exec tsx --test --test-concurrency=1 packages\task-engine\test\run-logs.test.ts packages\task-engine-server\test\run-logs.test.ts packages\task-engine-http\test\run-logs.test.ts packages\task-engine-storage\test\run-logs.test.ts
```

结果：build **9/9 成功**；测试源码类型检查 **exit 0**；
SDK **7 pass / 0 fail**，core **13 pass / 0 fail**。
本轮相关 8 个源码/测试文件的 Biome format 与 lint（error 级别）
均 **exit 0**；canonical Schema `--check`、`git diff --check` 也 **exit 0**。
本轮开发时新增的 guard 导致一处冗余类型比较和测试块放置错误，
均已修正并完成上述复测。文档/Schema 已同步到累计 ACK 契约；
没有触碰 Git 分支/索引、events、accepted ideal 或 Deployment。

### 父任务已完成的受控全量验证

父任务报告其 `TURBO_CONCURRENCY=2` 条件下的 `pnpm check` 已完成：
**exit 1；68 successful / 70 total；62 cached**。
本次全量运行的 **所有 logging package tests 均通过**。

最终失败已不再是先前记录的启动 timing，而是既有
[objective-monorepo-standard/test/pilot.test.mjs:519/595](../../../../../packages/objective-monorepo-standard/test/pilot.test.mjs)
的 `file-classification unverified`：
`.agent/skills/component-responsibility-docs/SKILL.md`。
父任务已独立核对该文件在 accepted HEAD 中 tracked 且 unchanged
（blob 前缀 `eaefe043...`），monorepo-standard 文件也 **zero diff**。

此结果来自父任务的独立完整验证，不能与本子任务先前高并发 timing 失败混为
当前失败原因；全量 gate 仍未全绿，剩余问题是既有文件分类策略。
按父任务要求未修改该 policy / SKILL 文件或无关 monorepo-standard 逻辑。
本轮丢弃报告修复的 SDK 7 项、core 13 项目标验证结果见上文；
父任务可在同步/门禁前再次检查最终 type/format/check，D-* 仍未授予批准。
