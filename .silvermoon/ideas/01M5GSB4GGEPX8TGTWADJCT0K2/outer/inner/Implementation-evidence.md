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

## Checkpoint 2 静态安全审查与迁移

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

## Checkpoint 2 验证

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

## Checkpoint 2 剩余实施工作（历史检查点）

本检查点包含未完成的 check-host、v3 schema、worker generator、16 个入口、
CLI adapter、业务依赖 requirements/实际观察/重查及部分 fixture 迁移。
已知直接消费脚本和本次 source 测试迁移已得到上述小范围证据；
其他 suites/fixtures 仍须审查与完整验证。长期混合负载/内存/真实冷热点性能、
双 CLI 发现/并发启动/真实共享 Host 生命周期、完整 pnpm check、
完整发布包一致性与其余文档更新尚未完成。
历史清理影响仍未知，不能以本次 28 个通过用例替代历史完整性结论。
不能勾选 I-* 或进入实施提交门禁。

## Checkpoint 3：行为边界、测量与全量验证尝试

本节记录当前实施检查点，不构成实施完成或恢复执行的授权。
旧清理事件的历史影响仍未知；本轮没有盘符扫描、越界删除重现或环境历史完整性验证。
accepted Ideal、Implementation contract、ledger、events 均未改变。

### 已实施并得到局部证据的行为

- worker 登记 `spawn`、`exec`、`execFile`、其 promisified 形式及 `fork` 的所属子进程；
  限制正 PID，拒绝把 Host 自身登记为待终止的子进程。
  CommonJS loader 保留 snapshot 导入边界；worker 不继承调用者 loader/debug flags 或
  `NODE_OPTIONS`。相关测试只创建/终止其实际持有的进程对象或明确记录的 PID。
- 单项流发送终态后结束并释放 observer 槽。单个有界大帧可以排空，
  不允许其后积累无限快照；容量、断线、重订阅、kernel/HTTP 同状态、大结果、
  lost-start response 恢复均有回归用例。
- 增加真实双 CLI 并发 discovery/复用测试，只记录这两个 CLI 在本次独有目录内
  实际启动的 Host PID，认证 readiness 后验证共享、后续线程复用并停止该具体 PID。
  不使用用户默认 Host。半写 startup record 只重试，不按未知所有权删除。
- publication 在准备失败时释放所属锁；安装/rollback 同时失败时保留最后良好的
  previous artifact，不在 finally 删除唯一备份。注入失败测试的 fs mock 在同进程
  串行用例内安装/恢复，删除目标始终是 fixture 自己创建的根。
- source preparation 只验证完整 artifact，实际调用才发布，修复后台 refresh
  提前覆盖旧绑定导致的 revision mismatch；持续 supervise 跟随源码/依赖更新通过。
- regulation 进程停止先发送显式 abort，等待其 run/finalizer 返回的 outcome/error
  acknowledgement（最多 10 秒），再终止所属进程树。事件回调自身拒绝不能冒充
  worker 清理 acknowledgement。强制停止 fixture 改为持有所属子进程，
  不再把共享 Host 的 `process.pid` 当成逐 check 进程。
- 旧 HTTP probe 测试改为明确拒绝旧工厂，并验证 worker subject、业务失败、
  取消、预取消。CLI evidence 检验 caller-owned `result.json`，不要求 worker
  创建不再承诺的逐 check business events 文件。
- 私有 tarball 测试实际调用全部 16 个入口；marker 使用本次创建的具体文件。
  发布清单/工作流静态配置增加 check-host，协议消费使用 v3 并保留 v1/v2 离线导出。
  没有发布、推送、运行发布 workflow 或添加 token。
- 仅格式化本次迁移涉及的文件，修复其 Biome/typecheck 失败。bundle 和资源仅通过
  既有生成器生成；worker 生成器维护包自有 `generated` 文件清单，不扩大扫描豁免。
  紧凑字面量保留既有确定性 projection profile；self-check 当前表达式 4064 bytes，
  接近 4096-byte 上限，后续资源增长需要正面处理，不能靠放宽预算或任意函数绕过。

### 验证命令与结果

- `pnpm exec tsc -b --pretty false`、`pnpm exec tsc -p tsconfig.test.json --pretty false`
  在上述最终运行逻辑修补后通过。所编辑迁移文件的 Biome 检查通过。
- `pnpm self-check:build`、`pnpm health:build`、`pnpm setup:build`、
  `pnpm monorepo:build`、`pnpm workers:build` 均通过；
  最后 `pnpm workers:check` 验证全部 16 个产物通过。
  monorepo/worker bundling 仍有 CJS `import.meta` warning，未将 warning 当作通过证明。
- `pnpm exec tsx --test --test-concurrency=1 packages\check-host\test\boundaries.test.ts packages\objective-pilot\test\dependency.test.ts packages\pilot-protocol\test\protocol.test.ts`：
  当时 17/17 通过；随后增加的 runtime flags、discovery、publication 用例在最新
  全量尝试中归入 check-host 13/13，通过。
- 真实双 CLI 单文件验证 1/1 通过；修补后的 probes 单文件 10/10 通过；
  `node --test --test-concurrency=1 scripts\pilot-packages.test.mjs` 3/3 通过
  （第三项覆盖全部 16 个 tarball worker 入口）。
- Objective 三文件串行验证曾为 63 项：61 通过、1 跳过、1 因包声明失败。
  未记为通过。修补 generated 归属/依赖方向/22 个包计数后，
  real-repository selector 2/2 通过；后续全量日志中 monorepo 53/53、
  setup 35/35 均通过。Linux native dispatch 在 Windows 跳过，不算 Linux 证明。
- 最后针对性命令：
  `pnpm exec tsx --test --test-concurrency=1 packages\pguide\test\regulation-process.test.ts scripts\release-packages.test.mjs`
  8/8 通过，包括正常结束、显式停止和事件回调失败后的所属 Agent 退出。
- `pnpm check` 多次运行：先暴露并修复迁移文件格式、旧 run/HTTP/evidence 假设、
  source refresh 冲突、发布 inventory 17→18 与缺少 check-host trigger。
  一次尝试的 44 个 Turbo tasks 全部成功，但随后根 scripts 的两个发布清单测试失败，
  **不算完整 pnpm check 通过**；相应两个检查后来在上述 targeted 命令中通过。
- 为避免测试调用 `os.tmpdir()` 写入系统临时目录，全量尝试将 TEMP/TMP 指向本次
  `.cache\checkpoint3-check-<随机后缀>\scratch`，并设置所属 state directory。
  用 `createWorkerHost` 提供本次进程内 guard Host，先认证 readiness，正常收尾关闭。
  一次同时替换 HOME/USERPROFILE 的 runner 配置被 Turbo 以
  `Global config path not found` 拒绝；恢复工具原有配置环境后继续，仅隔离 scratch/state。
- **最新尝试已因下述新安全阻断停止，不是通过**。`pnpm check` 已通过 layers、
  format、lint、typecheck；日志中 check-host 13/13、objective-pilot 61/61、
  pilot-protocol 14/14、monorepo 53/53、setup 35/35 通过。
  pguide suite 尚在执行 source 用例，后续根 scripts/完整 pack:check 未完成。
  没有将停止前零失败的局部输出合并成全量通过。

### 可重复测量与限制

`packages/check-host/test/workload.test.ts` 在同一 Node `v24.11.1`/Windows 上，
以同一模块、同一 JSON input 比较 fresh Node process 与 kernel worker。
不执行 target 的 build/check 命令。fixture 输入 66011 bytes；
worker 上限 2、任务数退役阈值 8、record 上限 128、worker samples 上限 64，
源于实现中的实际容量机制，以小阈值强制多代替换而非无限运行。
96 个混合请求要求成功、调用失败、取消均出现，所有计数/资源断言有硬上限；
没有给 RSS 增长设一个未经论证的“无泄漏”阈值，也没有断言任意噪声下必然更快。

一次独立运行记录：

| 指标 | fresh process | worker |
| --- | --- | --- |
| 小 fixture 中位耗时 | 89.31 ms（7 次） | cold 44.93 ms；hot 中位 3.01 ms |
| 初始化次数（timing 阶段） | 7 | 2（包含一个有余量时的预热线程） |
| 混合负载 | — | Completed 77 / Failed 7 / Cancelled 12 |
| 总计 | — | 103 executions / 14 initializations / 12 retirements |
| 峰值资源 | — | 2 workers；queue 0；ownedProcesses 0；retained records 103 |
| RSS 样本 | 单个进程约 55.00–55.16 MiB | 142.98→150.93 MiB，range 7.95 MiB |
| Host heap 样本 | — | 40.60→41.39 MiB，中间有回落 |

另用真实 `package-standard/structure` bundle 和同一个 operation-owned 仓库 fixture：
一次并发全套环境下 12 次 fresh-process 中位 733.30 ms、总计 8388.08 ms；
同输入 12 次 Host cold 4262.13 ms、hot 中位 27.54 ms、总计 4577.29 ms，
只有 1 次 worker initialization。**真实 checker 的首次 snapshot/加载明显更慢**，
不能宣称冷启动也有收益；warm/多次复用才出现本次测得的收益。
独立小 fixture 与真实 checker、独立运行与 Turbo 并发样本不能互相替代。
这些是 kernel API 测量，未包含完整 CLI/Git binding/discovery 的端到端时间。
Host RSS 包括测试 runtime 与共享线程，baseline RSS 是一个独立 child，
不能直接宣称绝对内存更低。96 次有界样本不证明长期/无限期无泄漏或跨平台收益。

## 新安全阻断：Windows descriptor ACL 未隔离其他本机用户

只读核查本次 operation-owned 文件：

```powershell
Get-Acl -LiteralPath .cache\checkpoint3-check-ZghIH4\host\host.json
```

实际继承的 Allow ACL 包含：

- `NT AUTHORITY\Authenticated Users`: `Modify, Synchronize`
- `BUILTIN\Users`: `ReadAndExecute, Synchronize`
- Administrators、SYSTEM: FullControl

该 descriptor 含 bearer token。当前 discovery 只在 `process.platform !== "win32"`
检查 mode；`mkdir/open/writeFile` 的 POSIX `0o700/0o600` 不能在 Windows 建立
owner-only NTFS 边界。因而在本轮实际目录上，其他本机账户可读取 token，
且 authenticated users 有修改权限。这里没有运行其他账户、读取/打印 token、
发送恶意请求或调查其他目录；这是当前服务隔离缺失，不是历史删除事件的证据。

发现后立即 `stop_powershell` 停止本次完整验证 shell 195 的进程树；
再以精确 PID 查询确认本次 guard Host `22032` 已不存在。没有按进程名终止、
没有触碰同机其他用户进程，也没有继续产品 tests/build/pnpm check。
停止时日志仍在 source tests，尚无本次真实双 CLI 用例的完成记录；
这不能单独证明该用例未开始，也不能只靠日志排除已脱离进程树的测试 Host。
这里只确认了工具进程树停止和 guard PID 消失，没有做全机进程扫描，
不能笼统声称所有可能的 Host 都已排除。后续核对应依赖明确所属的 PID/journal，
不能按名称、仅凭时间或模糊目录前缀终止进程。
保留 `.cache\checkpoint3-check-sIdWpm\check.log`（44 tasks 成功后两个根脚本失败）
和 `.cache\checkpoint3-check-ZghIH4\check.log`（安全停止时的原始进度）供协调者核查；
仅删除本轮明确创建的运行目录/descriptor，不清理未知 cache 前缀。

恢复条件：先静态修补/审查 Windows 私有 discovery directory 与 descriptor 的
ACL 创建、校验及 fail-closed 行为，不能只改 mode 或假设项目目录天然私有，
也不能自动重写未知/用户现有目录的权限。需要在新建且明确拥有的目录上取得
可靠的 owner-only ACL 验证后，由协调者决定恢复受控验证。
随后重跑最终完整 pnpm check/pack 消费、补充更长内存和真实启动故障压力证据。
当前 I-* 仍全部未完成；不 submit、不 accept、不推送、不发布。

## Checkpoint 4：恢复中断的 ACL candidate

本轮完整读取并保留原会话的 14 个 tracked 修改和两个 untracked 文件，
确认均属于 Windows 私有文件边界及其调用/测试迁移；没有 reset/revert，
未修改 accepted Ideal。Deployment 只保留实现新引入的 PowerShell/.NET
外部环境要求和真实 ACL 验证要求，没有实施部署或记录部署结果。
下述是新操作授权下的受控验证，不是此前危险删除事件的完整性结论。

### 私有边界与失败路径

- 新增 `check-host/src/private-files.ts`，在创建 Windows 目录/文件时原子提供
  owner=current SID、protected DACL，Allow 仅含 current SID、SYSTEM
  `S-1-5-18`、Administrators `S-1-5-32-544`。写秘密前通过 native handle
  验证 owner/DACL、类型、单硬链、大小和本地卷，拒绝 reparse point。
  startup、store mutex、descriptor 和遗留 JSON publication 都需通过校验。
  不修补不可信既有 ACL，不先写 token 再收紧权限。
- Windows 权限后端使用绝对系统 PowerShell/模块路径、无 profile/模块自动加载，
  固定程序与 JSON pipe 数据分离；编译中间文件仅进入本次创建并先验证的私有目录。
  设置/校验失败只返回固定错误码，未将 token 写入命令、日志或证据。
  POSIX 继续验证实际 UID、private mode、no-follow regular file 和单硬链。
- Windows 原生独占 mutex 串行化 publication/删除；expected-content
  compare/replace 使旧 reservation 和旧 shutdown 无法覆盖/删除新内容。
  失败 replacement 保留旧 descriptor，清理本次独有 publication 文件。
  discovery claim 使用随机 reservation；发现 live descriptor 不重复启动。
- 所有相关 fixture 和 CLI artifact publication 在使用前验证私有 discovery 根。
  真实双 CLI 保留精确 spawn journal（PID、main、directory），仅终止 journal
  对应操作拥有的 Host，不信任 descriptor PID 作为终止授权。
- 后端正常关闭、客户端被强制结束后的 pipe closure 均有真实退出测试；
  本轮另修复 helper 重启时的 process exit listener 回收，并断言 listener 不累积。
  私有后端额外 Windows 进程未被算进 kernel-only 性能/RSS 优势。

### 恢复已有有界验证

定向读取 `.cache/checkpoint4-check-be42d318-25d2-4f54-8958-b19fd7af69de/check.log`，
发现原会话的全量 runner 尚在运行，而非重复启动另一份全量检查。
先只查询 descriptor 指定 PID，再独立查询其精确 parent command line：
guard `11888` 的 parent `28952` 明确为该目录下的 `pnpm check` wrapper，
其 direct children 只按已确认的 parent PID 查询。未全机扫描或停止无关进程。
随后 runner 自行完成并退出，旧 descriptor 被正常移除；旧日志包括 20 个
Host tests、真实双 CLI 与 isolated combined 消费通过，但退出码未被恢复捕获，
因此不把旧日志拼接成完整 `pnpm check` 成功证据。
最终结果以本轮下述带持久 exit code 的新检查为准。

### 本轮针对性验证与实测

- `pnpm exec tsc -b --pretty false` 与
  `pnpm exec tsc -p tsconfig.test.json --pretty false` 均 exit 0。
- `pnpm exec biome check --write` 针对新增/修补的三个 Host 文件通过；
  `git diff --check` 通过。未添加依赖或重新安装工作区依赖；
  pack 消费测试按既有脚本安装其操作拥有目录内的待验 tarball。
- 一次串行 targeted runner：
  `pnpm exec tsx --test --test-concurrency=1`，选择 private-files、discovery、
  workload、shared-host-cli 四个测试文件，**13/13、0 fail，exit 0**，48.44 s。
  日志与持久 exit code 在
  `.cache/checkpoint4-target-2de9edea-e369-4754-be9d-fda71cfba71c/{target.log,result.json}`。
- 真实 ACL 独立读取新建目录和文件，owner=current SID、protected=true，
  allowed 恰为 current SID/SYSTEM/Administrators；分别向目录和文件增加
  Authenticated Users、Users、Everyone（用 SID，不依赖本地化名称）的授权，
  均在任何凭据写入前拒绝，且不改写宽 ACL。宽 descriptor/startup/mutex/
  legacy publication 在 HTTP 前拒绝（fetch 次数为 0）。
- 四个独立 Node/权限后端进程并发 compare/replace 同一 startup reservation，
  恰好一个成功；旧 expected-content 删除失败，不残留 publication 文件。
  read-only replacement 故障保留旧内容，后端启动故障无降级，
  junction alias 被拒绝；正常/强制客户端关闭仅回收本次拥有的 helper。
  真实双 CLI 1/1 通过，检查实际 descriptor ACL，共用一个 Host 并复用 worker；
  收尾只用精确 spawn journal PID，删除操作拥有的随机 fixture 根。
- 新增 **512 次混合任务**跨 32 个 retention window：
  Completed 448 / Failed 32 / Cancelled 32；17 initializations、16 retirements，
  peakWorkers=2、peakRecords=16；每批过期后 records=0，queue/ownedProcesses=0；
  每个已保存 worker sample 的 timers/processes=0，sample 数量不超过 64。
  kernel.close 后 workers/records 均为 0。32 个 RSS 样本 141.91→134.09 MiB，
  range 131.49–141.91 MiB；heap 29.79→36.89 MiB，中间有回落。
  这是有界样本与资源回收断言，不声称无限期无泄漏。
- 本次同输入实测（Windows / Node v24.11.1）：
  小 fixture fresh-process median 87.49 ms，worker cold 44.64 ms、
  hot median 6.35 ms；原 96 次混合任务仍是 77/7/12，workers≤2。
  此 96 次 RSS 从 144.64 到 172.59 MiB（range 27.95 MiB），如实保留，
  不用另一 workload 的下降样本覆盖它。
  真实 package-standard/structure：12 fresh-process 总 5533.42 ms、
  median 463.57 ms；12 Host 总 3552.00 ms，cold **3369.50 ms**、
  hot median 16.42 ms、1 initialization。冷启动仍明显更慢，
  多次复用才有本次总耗时收益；不替代完整 CLI/Git/discovery 的性能测量。

### 本轮全量检查的首个失败与收敛

第一次新 `pnpm check` 取得明确 exit 1，而非安全停止：
`.cache/checkpoint4-final-91d58d4c-da2d-42f2-bb81-179355e9bb02/{check.log,result.json}`。
layers/format/lint/typecheck 通过，Turbo test 阶段的 revision boundary 测试失败：
它用 200 ms sleep 假设旧任务仍在执行；并发全量负载下写入/读取新 artifact
已超过此时长，故 `/busy/` 断言没有拒绝。未把这次 40 successful tasks
当作完整成功，pack 阶段尚未进入。

将该 fixture 改成明确等待取消的 hold，而非放大 sleep；
先验证在途 revision 拒绝，再明确取消、确认 Cancelled，最后切换 revision。
更改未放宽产品断言或改变内核规则。
修补后单次串行 **完整 Host suite 23/23、0 fail、exit 0**（54.51 s），
日志 `.cache/checkpoint4-target-2de9edea-e369-4754-be9d-fda71cfba71c/host-final.log`；
对应文件 Biome 检查通过。

### 最终全量检查与资源收尾

修补后的第二次新 **`pnpm check` exit 0**，包含完整 layers/format/lint/typecheck、
生成物校验、workspace/root tests 和 **`pack:check`**。持久证据：
`.cache/checkpoint4-final-0e69cfd6-4071-44da-9e24-15cd00fb3650/{check.log,runner.json,result.json}`。
Turbo test 为 44/44 successful（16 cached，12m36.559s），Host 23/23，
Objective Pilot 61/61；根 scripts 36/36。pguide 与 devbox-health
各有一项平台 skip，没有将其解释为 Linux 实机通过。
打包 **18 个包**，10 组 isolated tarball 消费全部通过，
含 combined 7 selected/17 internal 的消费；worker 校验及全部 16 个
内置入口的 tarball 资源/执行测试通过。没有发布包、push 或生命周期提交事件。

本轮新执行的产品验证顶层命令计数为：`tsc` 两次、四文件 targeted 一次、
完整 Host suite 一次、`pnpm check` 两次（首次 1、最终 0）；
另有两次定向 Biome。恢复中的旧 runner 不算本轮新启动的命令，
没有用旧退出码未知的结果替代最终成功结果。

最终 guard 在写 descriptor 前验证私有边界，并经真实认证请求确认 readiness。
全量结束时正常 close server/kernel、按 expected-content 删除自己的 descriptor、
关闭权限 helper。再只按已记录精确 PID 查询，最终 guard `11612`、其 direct
children、`pnpm check` child `34576` 均已不存在；首次新 runner `5712`、
其 direct children/child `4452`，以及恢复的旧 `11888`/`28952`/`8312` 也已退出。
最终 descriptor 已不存在。该结论只覆盖这些已核实归属的进程，
不扩大成已排除此前所有未知 detached Host 的断言。

只清理本轮三个明确拥有的 runner 根下 `scratch`、`state`、`host-state`、
`host` 子目录；保留日志/result/runner journals。测试本身正常删除其随机 fixture 根，
新 512 任务用例在 kernel.close 后断言 workers/records=0。
未清理未知 cache 前缀、工作区祖先、机器其他目录或旧 session 的未知资源。

### 本 checkpoint 仍不代表完整实施验收

I-* 继续保持 unchecked，不追加 submit/accept，也不推送或发布。
Windows 的真实 ACL 与互斥测试不是 POSIX 实机证据；当前 POSIX
expected-content 读/改/删仍是分离操作，没有 Windows 后端对应的跨进程 mutex，
尚不能据此宣称多进程 compare/replace 在 POSIX 也原子成立。
需要后续收敛这一并发边界及启动保留/发布中途崩溃的真实故障压力测试。
512 次负载只证明有限运行中的资源断言，不证明长期无限运行无泄漏；
包含权限 helper 的完整共享服务内存，以及完整 CLI/Git/discovery 的端到端性能，
仍不能由现有 kernel-only 测量代替。部署与跨平台消费证明留在其对应阶段。
