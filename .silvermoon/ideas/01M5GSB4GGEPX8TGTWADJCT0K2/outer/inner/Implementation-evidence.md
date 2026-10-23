# 实施中证据与阻断

本文件不构成完成声明。当前 I-* 均保持未完成；没有 submitInner、accept*、
部署或发布。accepted Ideal 未修改。

## 原实施会话已运行

- `pnpm install --reporter=silent`：依赖 manifest 增加 check-host 后成功。
- `pnpm exec tsc -b --pretty false`：通过。
- `pnpm exec tsc -p tsconfig.test.json --pretty false`：通过。
- `pnpm exec tsx --test packages\check-host\test\host.test.ts`：3/3 通过，
  覆盖无 HTTP 的单次执行/SubscriptionRef、线程复用、四路由、断线不取消、
  集合不泄露 Subject、队列、取消、资源 revision、终态过期与清理失败隔离。
- `pnpm workers:build`：生成全部 16 个 worker artifact；
  仍有既有 CJS import.meta warning，不能以此掩盖失败。
- schema/dependency/source 联合测试（shell46）：业务 dependency 测试 9/9 通过；
  source 测试存在尚未修复的资源边界、旧入口错误断言、旧 cwd/cleanup 假设失败。
  该命令已主动停止，不能记作通过；尚未执行 pnpm check。

## 安全阻断：旧测试的清理路径假设失效

shell46 命令：

```powershell
$env:PGUIDE_CHECK_HOST_DIRECTORY = Join-Path (Get-Location) '.cache\validation-check-host'
pnpm exec tsc -b --pretty false
pnpm exec tsx --test packages\pilot-protocol\test\protocol.test.ts packages\objective-pilot\test\dependency.test.ts packages\pguide\test\pilot-source.test.ts
```

旧 `cleanup failure retains the primary CLI error and reports both causes`
测试从检查器的 `process.cwd()` 上溯四层得到 cache，并在 finally 递归删除。
迁移到共享 Host 后 cwd 不再是旧的单检查 checkout；此算法可算出 `D:\`。
发现后立即调用 `stop_powershell` 停止 shell46，未继续运行该测试。
后续 `git status --short`、`.git` 和 `package.json` 检查显示当前工作树源码仍在，
但这些结果不足以排除工作树外路径受影响；不得声称环境完整性已验证。

原检查点已将测试修为显式创建 `.cache\pilot-source-tests\cleanup-<uuid>`，
通过 `cacheDirectory` 注入并仅在该 operation-owned 根目录内定位 cleanup 目标，
finally 只删除该明确拥有的目录。原检查点保存时修复后尚未重跑，须先由协调者处理环境安全评估。

## 协调者只读核查

协调者在执行会话原始 events.jsonl 中核查了以下记录，没有重跑测试或执行清理：

- 2026-10-23T04:52:38.106Z，测试工具调用
  `call_jinpG19pCESFPb5hBNTpSk1X` 的输出显示 shell46 运行超过 120 秒。
  最后一项完成输出为 `source lifetime cancellation waits for active process teardown before removing its source`；
  没有后续 cleanup 用例的完成记录，也没有删除目标或删除清单。
- 2026-10-23T04:52:50.133Z 的代码读取
  `call_D9pzrcRhEdIQ6wLcRD4HI3Tr` 显示迁移中的 cleanup fixture 已改为 worker.cjs，
  仍返回 process.cwd()，测试仍保留从该路径上溯四层的旧逻辑。
- 2026-10-23T04:52:59.951Z，
  `call_UTbbt577dmQtODbr3JIQxrFz` 返回 shell46 已停止。
- 对照已提交旧测试可确认：先执行 `cache = dirname(dirname(dirname(dirname(directory))))`，
  然后才断言 cache 的父目录；finally 中只判断 cache 非空便调用 originalRm。
  因而断言失败本身不会阻止 finally 对已经赋值的错误目录执行清理。

这是实际存在的危险控制流，不只是名称误解。原始日志没有证明该次 worker 返回的真实 cwd、
finally 是否开始调用删除、删除成功/失败的具体路径；测试最后输出停在前一个用例，
也不足以证明下一个用例未开始。当前工作树存在不证明盘符其他位置完整。
因此不能断言已经发生越界删除，也不能断言没有发生；不使用重现危险命令来消除不确定性。

后续 subagent 核查请求已失败并被安全系统阻断，协调者未通过新 agent 或其他执行方式重试。
当前修补后的 cleanupRoot 仅指向操作创建的目录，但这不能恢复或证明先前外部状态。
当时决定在取得机器所有者的文件系统/备份或其他可靠完整性检查结论前，暂停测试和实施推进；
不记录 submitInner/acceptInner。此次安全核查与产品校验结果分开记录。

## 会话交接

2026-10-23，用户明确要求先将当前修改保存为本地提交，再由新会话继续。
本次提交仅为未完成实施的检查点，不是实施验收或恢复执行的授权；不推送、
不发布、不重跑测试，不将先前局部测试通过解释为完整验证。
新会话应先读本文件、Implementation.md 和已接受的 ideal/Design.md，
保留当前实现，先处理上述安全阻断，再继续迁移与验证。
后续 subagent 的通用安全拒绝未指出具体文件夹，不能解释为已经确认
“访问未授权文件夹”，也不能据此证明此前危险清理被成功阻止。

## 恢复与新操作授权（2026-10-23）

先以普通合并 `d29dae24cc73935fafe5168c9ec3a24a6368bd09` 恢复
`2f26d12f743b52b2162d96723d7fa74e1b4d271a`，保留原 HEAD `16f750e`
及 main 后续文档，两项 Silvermoon snapshot check 通过。
该恢复 checkpoint 没有运行产品验证。

随后用户明确指示“好的，那你就继续推进吧，再遇到安全阻断问题我们再回来看”，
协调者批准恢复当前实施操作。这是新的操作授权，取代前述暂停当前实施的安排，
**不是机器所有者的历史完整性结论**。此前是否发生越界删除及其影响仍未知；
没有扩大到盘符或其他未授权目录调查，没有重现原危险控制流。
以下验证只能证明本次受控产品行为，不能排除或恢复历史损失。

## 本次静态安全审查与迁移

- 审查 source/Host 测试、worker fixture、Git source、CLI adapter、Host artifact/kernel/
  discovery/worker 及直接消费 helper 的递归清理、路径祖先和进程终止。
  Git cache、source lease、artifact snapshot 均清理其创建的随机具体子目录；
  不从 worker cwd 推断目录所有权。不运行仓库 `clean`。
- cleanup failure fixture 改用 `mkdtemp` 返回的专属根并显式注入 `cacheDirectory`，
  删除已无用途的 worker cwd 回传；全局 filesystem mock 只在单用例作用域安装，
  finally 先恢复 mock，再删除本次创建的具体目录。
- source suite 创建独有 Host 根，绑定当前测试进程内的 HTTP server/kernel，
  写入独占 descriptor 并经 `connectHost` 做认证 readiness 探测；收尾关闭 server、
  kernel 和其 workers，再删除所属根。没有借用用户 Host，没有启动需要额外终止的
  detached Host PID。worker fixture 只终止其直接创建并持有的 ChildProcess；
  Host 强制收尾只使用本次 worker spawn 登记的具体 PID/进程树。
- Host HTTP 测试不再用 artifact 路径上溯来清理，而是调用 fixture 保存的 owned-root
  清理函数。顶层用例按 Node 默认串行执行，验证命令另显式设置文件并发为 1；
  不让 filesystem monkey patch 与同进程并发用例交错。
- 二进制资源移入 worker 的显式 `resources`，不再读取 Pilot 外的祖先路径。
  重复 ID/旧入口测试验证 level-scoped worker 与 `run.*` 明确拒绝；
  dependency 用例验证 Host snapshot 位于本次 Host 根且可比 source lease 更长寿，
  不再把 worker cwd 误认成 `checkout-1`，也不由回传路径删除目录。
  deadline read mock 限定在本次单独创建的 source cache 内。
- `scripts/pilot-packages.test.mjs` 通过目录/revision 调用 Host，仍验证实际 tarball、
  无目标依赖安装与同版本资源。`scripts/evidence-runtime.test.mjs` 分开验证
  caller-owned worker evidence 与保留的 standalone business helper evidence。
  两者使用 operation-owned、进程内共享 Host helper；生成 bundle 未手改。
- 普通合并整合 primary `4d60ec3ce5ab998f5cc33afafb34c308f259a9ab` 的其他 Idea
  文档；本 Idea accepted Ideal、Implementation contract 和 ledger 未修改。

## 本次验证

- 初次联合 compiler 命令退出 2，未计为通过。后续独立
  `pnpm exec tsc -b --pretty false` 通过。
  测试 typecheck 曾发现新增 Host 导入不在 pguide 依赖范围、目录项未收窄，
  已改用测试相对 dist 导入并显式检查目录项。
- `pnpm exec tsc -p tsconfig.test.json --pretty false`：通过。
- `pnpm exec biome check --write packages\pguide\test\pilot-source.test.ts scripts\worker-test-helpers.mjs scripts\pilot-packages.test.mjs scripts\evidence-runtime.test.mjs`：
  通过，仅格式化/整理上述编辑文件。
- `pnpm exec tsx --test --test-concurrency=1 packages\check-host\test\host.test.ts packages\pguide\test\pilot-source.test.ts`：
  19/19 通过，约 73 秒。包括修补后 cleanup failure、source cancellation、
  dependency lazy preparation deadline 和 input-view 故障隔离。
- `node --test --test-concurrency=1 scripts\evidence-runtime.test.mjs scripts\pilot-packages.test.mjs`：
  9/9 通过，约 39 秒。包括四类 Objective worker 的 caller evidence、
  两个 standalone helper 及私有 tarball 的 Host 消费。
- 删除 cleanup fixture 已无用途的 cwd 回传后，再次执行
  `pnpm exec tsc -p tsconfig.test.json --pretty false` 通过；
  `pnpm exec tsx --test --test-concurrency=1 --test-name-pattern="cleanup failure retains" packages\pguide\test\pilot-source.test.ts`
  1/1 通过。上述四个编辑文件的 `pnpm exec biome check` 无修改通过，
  `git diff --check` 通过。本轮没有手改或重新生成 worker bundle。

## 剩余实施工作（仍未完成）

本检查点包含未完成的 check-host、v3 schema、worker generator、16 个入口、
CLI adapter、业务依赖 requirements/实际观察/重查及部分 fixture 迁移。
已知直接消费脚本和本次 source 测试迁移已得到上述小范围证据；
其他 suites/fixtures 仍须审查与完整验证。长期混合负载/内存/真实冷热点性能、
双 CLI 发现/并发启动/真实共享 Host 生命周期、完整 pnpm check、
完整发布包一致性与其余文档更新尚未完成。
历史清理影响仍未知，不能以本次 28 个通过用例替代历史完整性结论。
不能勾选 I-* 或进入实施提交门禁。
