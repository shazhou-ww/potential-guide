# 实现反馈（非阶段验收）

本文件记录 subsession 的实现者反馈。主会话仍独立拥有所有阶段的检查、同步、提交与验收；
ledger 保持未勾选，本会话不修改任何 events.jsonl、ideal 或外层 Deployment。

## 根因与实现

- I-S01：capacity 测试函数内误声明的七个授权测试恢复为独立顶层生命周期，
  保留全部断言和 close 清理。setup 原测试在整体启动十秒内等待 prompt，实际 Windows
  启动链可能尚未进入 Agent；新测试以真实 `session/prompt` 日志为就绪握手，再启动
  100ms 阶段 deadline，通过现有 AbortSignal 超时路径清理，60 秒仅作启动失败 watchdog。
  prompt fixture 另启真实子进程，核验 Agent 及后代消失、scratch/state 与原配置不受污染。
  sanity 不再从总预算武断扣除 8000ms，使有限调节在模块启动阶段就耗尽；外层总 deadline 保留。
- CLI supervisor 原用 15 秒总时长暗示收敛，冷启动、Git 重载与多轮 ACP 规划会消耗该预算。
  新测试等待真实规划输入同时具备 terminal observation 与已清空队列，再触发 CLI 已有
  SIGINT 退出路径；60 秒仅作失败 watchdog。仍断言只执行一次、固定 Git 版本更新、
  权限/能力反馈与持续观察，不改变生产调度或授权行为。
- I-S02：五个已变包推进独立 minor RC，三个无变化上游保留；详见
  [Release-candidates.md](Release-candidates.md)。命令版本与包版本一致并有回归约束。
- I-S03：`deployment-consumer.mjs` 复用 `releaseVersion`，明确 packed / published / latest。
  所有模式顶层仅安装 pguide；本地用内部 tarball overrides，真实 registry 模式无 overrides。
  沿实际父包核验全部传递版本、内嵌错误副本及展开后的 workspace 范围，保留库导入、bins、
  ACP、supervisor、setup 与权限 smoke。单测覆盖版本/模式选择、缺包、不可达包、
  错误嵌套版本、错误范围和 latest 不一致。

## 已执行的实现者反馈

环境：Windows x64，Node 24.11.1 / pnpm 11.22.0；另通过已安装 Node 22.13.0
的进程级 PATH 执行回归，不切换共享设备的全局 Node。
Node 22 命令在同一 PowerShell 进程先执行
`$env:PATH = (Join-Path $env:NVM_HOME 'v22.13.0') + ';' + $env:PATH; node --version`，
输出 `v22.13.0`，然后执行下列对应 pnpm 命令。

- `pnpm install --lockfile-only --ignore-scripts`：成功；manifest 已更改后刷新，
  内部依赖仍为 link 引用，lockfile 无文本差异。
- `pnpm build`：8 个 workspace 构建成功。
- `node --test scripts\deployment-consumer.test.mjs scripts\release-packages.test.mjs scripts\verify-deployment.test.mjs`：
  最终 9/9 通过，含错误范围及禁止从消费者外部祖先目录借用内部包的断言。
- `pnpm --filter pguide exec tsx --test --test-concurrency=1 --test-name-pattern 'sanity timeout during an actual ACP prompt|supervise plans once' test\setup-objective.test.ts test\supervisor-cli.test.ts`：
  Node 24 的初次修复后两项均通过；最终 fixture 在 Node 22.13.0 下再次 2/2 通过，
  0 cancelled。Node 24 最终完整检查也实际执行了这两项。
- Node 22.13.0 下 `pnpm --filter @potential-guide/objective-portfolio-supervisor test`：
  31/31 通过，0 cancelled，七个授权测试不再受父测试取消。
- `pnpm check`：最终退出 0，format / lint / typecheck / test / pack:check 全部完成。
  CLI 实际重跑 76 项：75 pass、0 fail、0 cancelled、1 skip（原有平台 skip），
  supervisor 为 31/31、0 cancelled；根脚本测试 14/14，八包 pack 内容检查通过。
  Turbo 的其他不变任务使用正常缓存，未用旧失败测试的缓存作为成功依据。
- `pnpm exec biome format .`、`git diff --check`：最终通过。

## 失败反馈与复验边界

首轮完整检查与 packed smoke 并发执行时均退出 1；当时 packed 已完成入口安装、传递库导入、
CLI、ACP 和 supervisor，随后 setup 子目录 sanity 的独立 probe 返回 502。
该次失败不作为成功证据，也不据此扩大生产超时或绕过断言；完整检查随后独立复跑退出 0。
packed 独立复验仍在同一点失败，因此不能归因为并发负载。隔离诊断确认是 Git fetch
退出 128：Windows Git 在嵌套 snapshot 路径报告 `fatal: '$GIT_DIR' too big`；
原路径已达 240 字符，`core.longpaths=true` 仍未规避其内部限制。
verifier 将 setup scratch 从 `consumer/setup-scratch` 移到同一操作拥有的 workspace 下 `s`，
保留隔离与统一 cleanup，并将该路径缩短至 219 字符。诊断用的详细输出和 git-source
插桩全部撤销；git-source 源码与原版本完全一致，未因此更改包版本或保留敏感诊断。
完成上述修复并撤销插桩后，`pnpm build` 及完整的
`node scripts\verify-deployment.mjs` 独立运行均退出 0：
八包 pack → 仅入口安装与全部传递版本/范围核验 → 库导入 → CLI →
ACP regulation/persistence/resume/retention/redaction → pinned supervisor →
committed setup 子目录的真实 nonce repair → deny/grant-on-continue/revocation 全部通过。
随后再次 `pnpm check` 退出 0；该次使用正常 Turbo 缓存，先前已实际重跑的回归结果如上。
独立消费者工作目录已由 cleanup 删除，诊断日志和实现者临时日志已清理；
未删除其他已有缓存、未改变依赖 catalog。

## 边界

真实 registry 精确版本及 latest 模式未执行：新 RC 未发布，稳定发版仍处于既有 hold，
本地 override 成功不能证明 registry 发布、dist-tag 或 provenance。没有创建 tag、
提交、push、npm publish 或任何阶段 submit/accept。三 OS CI 与主会话独立验收不由本文件代替。

## 主会话独立复核

主会话实际运行 pnpm check 退出零，另绕过 Turbo 缓存执行两项 CLI 回归和九项
发布/消费者脚本测试。Node 24.11.1 为 2/2、9/9；Node 22.13.0 为
supervisor 31/31、CLI 2/2、脚本 9/9，均无取消。所有授权断言保留为顶层独立测试。

prompt 复测以已观察的 session/prompt 为前提，再触发传入的 AbortSignal；
生产总 deadline 和外部 signal 都中止同一 check 内部 controller，并使用相同执行上下文
终止所拥有的进程树，故此回归覆盖 prompt 阶段的终止清理，不假装固定机器启动耗时。
原有整体期限测试仍验证实际 timeoutMs timer，不以注入信号替代全部期限覆盖。
主会话同步修正 setup README 和 sanity Wiki 中过时的“扣除 8 秒”说明。

主会话另执行 `pnpm exec turbo run test --force`，16/16 任务无缓存实际通过，
CLI 为 75 通过、1 个既有平台跳过、0 失败及取消。随后合并并发 primary
`a6a1011524fa17d8f46c2f685e9cb5bc3954329b` 的外部 AHP 确认实现，
保留其生产行为和串行 CLI 测试入口。setup 同一用例的冲突由就绪握手版本替代
单纯把十秒改为二十四秒的版本。

合并后完整 `pnpm check` 再次退出零；CLI 实际执行 79 项，78 通过、0 失败、
0 取消、1 个既有平台跳过，所有脚本与八包 pack 检查通过。随后在 Node 22.13.0
对合并后的两项 CLI 场景再次实际复跑，2/2 通过。产品代码提交为
`e18e5c74e0eab33e213fc1f81eb5000c1b72b232`，后续同步截至
`a15aeb38210f539daf9b3da45b7f97ef7a0769e7` 仅含其他 Idea 的文档。
主会话据此完成 I-AC01 至 I-AC03 的独立检查，阶段接受仍须由准确修订的独立事件记录。

## 交付 CI 发现与重新实施

准确提交 cae801bfb60d96afdaa86d6e474b97767669f707 的
[CI 39197422086](https://github.com/shazhou-ww/potential-guide/actions/runs/39197422086)
中三个 OS 的 packed consumer 成功，但 Node 22.13.0 与 24.11.1 全量检查均失败于
regulator 的 overall time quota includes probe retries and retry delays：
strategy.test.ts:161 预期 503、实际 408。其他被 Turbo 终止的测试不计作独立根因。
本地检查成功不能替代此结果；I-S01 / I-AC01 重置，改变 Inner World 后重新实施和验收，
不删除或覆盖此前精确修订的接受事件。

## CI retry 配额回归的限定修复（subsession 实现者反馈）

- 已复核重开的 I-S01 / I-AC01；本次只修改 regulator 的该项测试及本反馈，
  不修改生产代码、其他产品面、ledger、events、ideal 或外层 Deployment。
- 根因是测试把真实 50ms 配额当成首个 503 必定已经发布的前提。生产计时从输入快照验证前
  开始，发布 observation 前也检查同一整体期限；在 CI 负载下，首个 envelope 尚未发布就可能
  耗尽配额，因此返回 README 明确规定的 408，而不是已有 503 被覆盖或重试配额失效。
  原测试在本机定向复跑仍通过，不能以本机成功否定 CI 的竞态。
- 保留原测试名及精确的 `latestObservation.status === 503`，改用 Node 内置
  `t.mock.timers` 和 `performance.now` mock 控制两套计时；真实 `setImmediate`
  仅让异步 continuation 完成，不用固定 sleep 窗口判定成功。虚拟时间线：
  首次 probe 在 10ms 发布 500，20ms retry delay 后在 30ms 开始第二次 probe，
  40ms 发布 503，49ms 尚未结束，50ms 在下一次 retry delay 中整体耗尽。
  断言完整最后 envelope 被保留、Agent 从未执行、再推进 20ms 也没有第三次 probe
  或新 observation。5 秒 test timeout 仅为失败 watchdog，不增加生产配额。
- 两种 Node 均通过各自 PowerShell 进程的 PATH 选择，没有全局切换：
  `$env:PATH = (Join-Path $env:NVM_HOME 'v22.13.0') + ';' + $env:PATH`
  或相同命令的 `v24.11.1`；`node --version` 分别确认版本。
  两个版本均实际执行以下命令，均退出 0：
  - `pnpm --filter @potential-guide/objective-regulator exec tsx --test --test-name-pattern 'overall time quota includes probe retries and retry delays' test\strategy.test.ts`：各 1/1。
  - `pnpm --filter @potential-guide/objective-regulator test`：各 38/38，0 fail、0 cancelled、0 skip。
  - Node 22 另执行 `pnpm --filter @potential-guide/objective-regulator exec tsx --test --test-reporter=spec 'test\*.test.ts'`：38/38。
- `pnpm exec biome check --write packages\objective-regulator\test\strategy.test.ts`
  完成格式整理；`pnpm exec tsc -p tsconfig.test.json --noEmit` 退出 0。
  本反馈不代替主会话独立复测、完整 `pnpm check`、精确修订 CI 或任何生命周期门禁；
  未执行提交、push、tag、发布、submit 或 accept，变更保持未提交。

### 有限 sanity 成功用例的直接 helper watchdog（2026-10-19）

- 主会话在 `8f5ae9e` 后独立运行 `pnpm check`：regulator 通过，CLI 串行
  79 项中仅 `setup-objective.test.ts:575` 的有限修复成功用例失败；
  第 580 行期望 200，实际为整体 deadline 504，用例耗时 25842ms，
  超过 fixture 继承的 24000ms。该冷启动集成耗时不证明生产期限应放宽。
- 仅为 `mode === "fix"` 的直接 helper 调用显式指定 `timeoutMs: 60000`：
  这是包含多次 CLI 冷启动的有限集成工作 watchdog，不是生产 Pilot 24 秒
  guard，也不是全局测试预算。noop/wrong、实际超时测试和生产代码均未修改；
  保留精确 200/成功 envelope、实际 ACP prompt、随机 nonce 修复验证、
  配置不变、工作目录及 scratch/state/index 清理断言，不接受 504 或跳过测试。
- 两个独立 PowerShell 进程分别在 PATH 前置已安装的 Node 版本目录，
  `node --version` 确认 `v24.11.1` / `v22.13.0`；均执行：
  `pnpm --filter pguide exec tsx --test --test-concurrency=1 --test-name-pattern 'real sanity (verifies a finite repair|rejects (noop|wrong) Agent completion)' test\setup-objective.test.ts`。
  两版均退出 0，3/3 通过，0 fail、cancelled、skipped；Node 24 的
  noop/wrong/fix 耗时分别为 20354/19300/25486ms，Node 22 分别为
  19906/19162/24413ms。成功依赖实际修复后验证通过，而非 Agent 自报完成。
- `pnpm exec biome check packages\pguide\test\setup-objective.test.ts` 退出 0。
  未运行完整 `pnpm check`；独立复测及全部门禁仍由主会话负责。
  未提交、push 或发布；未修改 ledger/events/ideal/outer，代码保持未提交。

### 主会话最终 CI 门禁

主会话独立复查两项新测试的断言及变更范围；Node 24 的 quota 定向用例和
Node 22 的完整 regulator 38 项实际通过。候选提交
`0741d143e502c0918a563527c9a4663b29bb6ef1` 已进入 primary。
因其他会话持续同步文档导致 main CI 反复取消，主会话以同一提交的独立 validation ref
运行现有 CI，不修改 workflow 的矩阵或跳过任何检查。

[CI 39199404501](https://github.com/shazhou-ww/potential-guide/actions/runs/39199404501)
完整成功，5/5 jobs：Node 22.13.0 / 24.11.1 的 pnpm check，
Windows / Ubuntu / macOS 的 packed entry-only 独立消费者。真实 registry 模式仍未执行。
此前 39198388317 等因 main 文档并发而取消的运行不计作成功；39197422086 的失败保留。

主会话最终本地 `pnpm check` 也完整退出零：CLI 79 项，78 通过、0 失败、
0 取消、1 个既有平台跳过；format、lint、typecheck、根脚本与八包 pack 均通过。
同步至 cbde95f 仅增加其他 Idea 文档；与 CI 提交相比 packages / scripts /
objectives / .github 的树无差异。I-S01 / I-AC01 据本地结果及完整成功矩阵重新完成。

### 显式协调本地 Pilot 长预算：实现与子会话验证（2026-10-19）

- 按重新打开的 I-S01 / I-AC01 实现真实有界支持，而非放宽生产默认或替换
  Git Pilot 证据：process probe 默认仍为 30000ms，local subject 默认仍为
  20000ms、默认外层所允许的上限仍为 24000ms。runtime 向检查进程注入
  `PGUIDE_PROBE_TIMEOUT_MS`，值来自实际 process timeout，不继承调用者同名环境值。
- 复用已有 `regulationStrategy.probe.timeoutMs`，经 typed `PilotSourceOptions`
  传到 probe、regulate/continue、supervisor observation 和 worker 的 process probe；
  不新增用户配置字段。regulation 中它仍另外约束整个 observation；
  Agent timeout、whole-run quota、权限、sanity consent 和 SSH 原有 cap 均不扩大。
- 仅 local setup opt-in 接受长 subject：外层至少为 subject 加 6000ms
  启动、stdin/输出和清理余量，subject 仍限 100–300000ms。缺元数据按旧
  30000ms 校验；非规范十进制、空白/换行、指数、非整数、非正数和越界元数据
  明确 400，不静默回退；不足预算也明确 `outer-timeout`。
- local Pilot 的独占 fixture/config/state 使用 runtime-owned temp 下的新建短名子目录；
  嵌套 CLI source cache 也位于同一 owner 下，外部取消即使终止 helper，
  process probe 仍终止子树并清理整个 owned 目录，不动无关数据。
  安装 fixture 曾暴露 Windows 深路径 `Could not create Git cache` /
  `fatal: '$GIT_DIR' too big`；缩短 owned 子目录及嵌套 cache 后，verifier 仅在 Windows
  使用较短 process cache cwd。安装入口、subject 工作目录、config、Git URI、revision
  都仍是独立消费者的绝对路径；没有预热、重试、直接 helper receipt 或放松 terminal 断言。
- `verifySetupObjective` 明确选择 subject 60000ms 与 process 75000ms、零 retry；
  后续另一 Idea 的 self-check fixture 仍显式为 24000ms，保留其原合同。
  共享 setup 源码经 `node scripts\build-self-check-runtime.mjs` 正式再生成，
  未手改 generated runtime 或另一 Idea 的合同。
- objective-pilot 的公开 process runtime 元数据属于 feature minor，候选由
  `0.1.0-rc.0` 改为 `0.2.0-rc.0`；候选说明同步，内部依赖保持 `workspace:^`，
  其他已有新 RC/命令 metadata 不变。`pnpm install --lockfile-only --ignore-scripts`
  退出 0，lockfile 无文本变化。
- 验证命令及结果（非父会话门禁验收）：
  - Node 24.11.1、22.13.0 分别执行
    `pnpm --filter @potential-guide/objective-pilot exec tsx --test test\probes.test.ts`：
    各 9/9，覆盖默认/显式元数据、父环境不能伪造、实际 timeout、外部取消、进程树和 scratch 清理。
  - 两版 setup 定向执行保留 noop/wrong、实际 finite repair、实际超时、
    prompt 内取消、Git 固定子目录及 file-auth/缺环境边界；长 Git 用例分别实际通过。
    早期新增 SSH guard 断言误用了带 userHome 的本地主体，修正为原 SSH fixture 后单独复测通过。
  - 最终两版执行
    `pnpm --filter pguide exec tsx --test --test-concurrency=1 --test-name-pattern 'local Pilot deadlines|external Pilot cancellation' test\setup-objective.test.ts`：
    各 2/2，覆盖默认 24s、60s/75s、精确 6s 余量、300000ms 上限、
    无效元数据及真实悬挂后代的外部取消/owned 清理。
  - 两版执行
    `pnpm --filter pguide exec tsx --test --test-concurrency=1 --test-name-pattern 'nested Pilot sources' test\pilot-source.test.ts`：
    各 1/1。新增 fixture 曾因长 Windows 路径及遗漏必填 subject.name 失败，
    修正为短的独占测试目录和合法 subject 后，实际 terminal、source cleanup、
    无关 sentinel 不变、相对 temp 元数据明确失败均通过。
  - Node 22 最终长 Git 定向命令（同文件增加 `Git subdirectory snapshot coordinates` selector）
    3/3 通过；完整用例 122858ms，包含两次真实 Git observation 及认证反例，
    不把此总耗时误当单项 process/subject 预算。
  - `pnpm --filter pguide exec tsx --test --test-concurrency=1 test\pilot-source.test.ts`
    在新增 ownership 用例前 7/7；根 deployment-consumer / verify-deployment
    两文件测试 5/5，候选命令 metadata、独立消费图和清理回归通过。
  - `pnpm exec tsc -b packages\pguide --pretty false` 与
    `pnpm exec tsc -p tsconfig.test.json --noEmit --pretty false` 均退出 0；
    相关文件 Biome check 退出 0，仅保留三个既有 warning；
    `node scripts\build-self-check-runtime.mjs --check` 通过。
  - `node scripts\verify-deployment.mjs` 完整 packed consumer 已实际退出 0：
    八包、CLI/ACP、supervisor、安装 Git setup nonce terminal、另一 Idea self-check
    一次直接修复、permissions deny/grant/continue/revocation 全部通过。
- 本段是子会话实现证据，不接受 I-S01/I-AC01 或替代父会话独立门禁。
  未运行完整 `pnpm check`、未启动 CI、未提交/push/tag/npm 发布；
  未修改 ledger/events/ideal/outer 或另一 Idea 合同，变更保持未提交。

### 父会话完整检查的四个失败：清理竞态及有限语义预算（2026-10-19）

- 父会话独立完整 `pnpm check` 失败：CLI 89 项，84 pass、4 fail、1 skip，
  总耗时 1856842ms。失败为真实 worker 子树强制终止时 `taskkill` exit 128，
  以及 remote nonce、noop、wrong 三个有限语义用例拿到 deadline 504；
  新增长本地预算、边界、owned 外部取消和 Git nonce 用例均通过。
  父会话事后查询相关 PID 均已消失，但不把该查询当作当次清理成功证据。
- 共享 `killProcessTree` 在 Windows 终止前通过有界系统 PowerShell/CIM
  快照记录根与传递后代 PID；`taskkill /PID <owned-root> /T /F` 非零时，
  仅在全部快照 owned PID 实际 `ESRCH` 后成功，最多观察退出 500ms，不重试 kill。
  根进程退出不再吞掉仍存活后代的错误；检查不获准/不可观测也保留失败。
  若根在快照期间已退出，不再向可能复用的根 PID 发送终止；
  快照无效/失败明确上报，活根仍尝试终止，不静默回退。
  不解析任何语言的 taskkill 文本，不按名称终止，不向无关 PID 发送终止信号。
- remote direct nonce subject 明确为 60000ms，传输 watchdog 按原契约为
  subject 加 10000ms；noop/wrong/fix 三种有限业务结果统一 direct 60000ms。
  不改 fixture/生产默认、SSH Pilot cap 或实际 timeout 测试；
  noop/wrong 额外精确断言真实 `sanity-failed` 的
  `{stage:"regulate",reason:"quota-exhausted",exhaustedBy:"stall"}`，
  保留单次 prompt、nonce 实际验证、原配置及清理断言，504 仍明确失败。
- Node 24.11.1、22.13.0 均分别执行并退出 0：
  - `pnpm --filter @potential-guide/cli-core exec tsx --test test\process-tree.test.ts`：
    各 6/6，含真实不合作子树、非零但全部消失、根已退出且后代仍活、
    不可观测、无效快照及快照期间根退出不重复终止的确定性回归。
  - `pnpm --filter pguide exec tsx --test --test-concurrency=1 --test-name-pattern 'force termination stops a live|remote payload uses target authentication|real sanity' test\regulation-process.test.ts test\setup-objective.test.ts`：
    各 5/5；总耗时分别 100376ms / 97014ms，真实树退出和 owned run 删除通过，
    remote、noop、wrong、fix 均得到原业务语义而非 timeout。
- 相关三份代码 Biome check、`tsc -b packages\pguide`、
  `tsc -p tsconfig.test.json --noEmit` 均退出 0；
  使用正式 build-self-check-runtime 脚本再生成共享 process-tree 副本，
  `--check` 通过，未手改 generated 文件或另一 Idea/新 workspace 合同。
  本轮未运行完整 `pnpm check` 或 packed verification，未启动 CI、
  未提交/push/发布，也未修改 ledger/events/outer；独立完整门禁仍由父会话负责。

### 精确候选 CI 39213143819 的跨平台取消跟进（未接受门禁）

- 候选 `4d0cf0abd43580b13da798f0c9dd8ae6ec43a55d` 的 Ubuntu Node 22/24
  均仅在外部 Pilot 取消后的 PID 断言失败；Windows packed 在真实 Git setup
  内返回泛化 regulate 502。原 CI 日志没有内层报告，不能据此认定为超时或 CIM 故障。
- Linux Docker 在真实编译 runtime、原测试及独立 PID namespace/init 下复现：
  取消后 sleeper 为 `Ssl`、PPID 1，其子进程为 `Sl`，均非 zombie。
  根因是 process probe 只杀自身 process group，而 setup 子进程另建 detached group。
  修复在终止父进程前获取 owned 后代快照，同时覆盖 detached 后代；软终止后仅对
  尚存的 owned PID 强杀，并轮询真实 `ESRCH` 确认退出/回收后才删除 owned scratch。
  原测试保留两个 PID 与两层 scratch 清理断言，且收紧为精确 `ESRCH`；
  不以 sleep、根退出或 zombie 状态替代退出证明。
- POSIX `ps` 查询限 1000ms/1MiB，沿用既有 grace，强杀退出确认限 2000ms；
  无效快照、不可观测 PID、仍存活 PID 均显式失败。该清理阶段独立于既有
  30s process/24s subject 默认限制，没有调大生产 deadline、SSH cap、重试或 consent。
  增加四个确定性回归，真实 detached 子进程在 readiness 后主动忽略 SIGTERM，
  验证父进程先退仍必须强杀后代及得到真实退出确认。
- Windows 仅做有证据的诊断改进：setup 错误只附 OS exit code、白名单 CLI status
  及固定故障分类，不转发任意 Agent/config/auth/路径/错误原文；
  canary 回归确认任意内层数据不泄漏，502 仍是失败，不增加 retry 或放宽预算。
  使用正式 `build-self-check-runtime.mjs` 再生成副本，未手改 generated 文件。
- 本机 Windows Node 22.13.0 的 fixture-only packed setup 诊断一次通过；
  最终原样 `node scripts\verify-deployment.mjs` 也一次完整通过
  （CLI、ACP、supervisor、真实 Git nonce/terminal、self-check、permissions）。
  **未复现 CI 的 Windows 根因，不能宣称该平台 CI 问题已修复**；保留上述固定分类，
  供父会话下一次精确候选 CI 分辨 CIM 查询/树清理/内层 probe，而非猜测增加预算。
- Windows Node 22.13.0、24.11.1 的同一 focused selection 各 17/17，
  包含实际 force termination、有限真实 repair、外部 setup 取消、安全诊断、
  原 shared Windows cleanup 六项及新 POSIX 四项；总耗时分别 52848ms/54901ms。
  Linux 实际 Node 22.23.3、24.22.0（复用已有镜像/runtime，未安装依赖）的
  exact cancellation + process cancellation/timeout + POSIX 四项各 7/7，
  耗时 33564ms/20236ms；这是 Linux 实进程证明，不冒充 CI 的精确 Node patch 版本。
- 相关 Biome check、受影响 workspace typecheck、generated `--check` 通过；
  未运行完整 `pnpm check`、未启动/推送 CI、未提交或修改生命周期材料。
  源码与本节证据留为 uncommitted，独立门禁和 Windows CI 结论仍由父会话负责。

### CI 39217516250：仅 Windows CIM command 的精确诊断跟进

- 父会话报告 `d7758af28eda62ac2ebf51ec1dc3c78accf38450` 的精确 Node 22.13/24.11
  全量 check 及 Ubuntu/macOS packed 均通过；仅 Windows job `117944761406`
  在 setup 返回 `exit=6,status=regulation-error,diagnostic=windows-snapshot-command`。
  这已定位 shared `killProcessTree` 的 PowerShell/CIM subprocess 执行失败，
  不是 inner 3s probe、JSON 校验或 POSIX 取消修复。
- 本机 Node 22.13.0 以相同稀疏平台环境、独占 USERPROFILE/HOME，分别省略、
  继承、清空 PSModulePath 及注入 pwsh7 模块路径形态，固定 CIM query 均成功：
  首组约 870–1633ms；另设独立 module-analysis-cache 路径后约 862–1031ms。
  均不带 ProgramFiles/LOCALAPPDATA；本机未发现 pwsh7 可执行文件，因此这些
  环境对比不是复现 GitHub 镜像，也不能据此认定 CI 是 5s timeout 或 module failure。
- 未猜测修改查询/环境或扩大预算。只给固定只读 query 的失败增加可判别字段：
  `kind/exit/errno/signal/killed/elapsedMs/reported/reason`，错误仍抛出并保留 cause。
  PowerShell catch 只将已知 FullyQualifiedErrorId 映射为固定
  command-not-found、module-autoload/load/not-found/manifest、access-denied、
  CIM access/class/namespace/RPC 等标签；未知错误仅为 unclassified，始终 exit 1。
  不回传任意 stderr、命令、路径、Agent/config/Auth 或异常原文。
  setup 仅转发严格格式的固定标签及有界数字；双重 snapshot/taskkill 失败时
  AggregateError 同样保留该安全诊断，不丢失下一次 CI 的分类。
- 下一次 CI 若见
  `windows-snapshot-command[kind=timeout;exit=none;errno=none;signal=SIGTERM;killed=true;elapsedMs=5001;reported=false;reason=unclassified]`
  可确认 Node 的 5s watchdog；若 `kind=exit;exit=1;reported=true;reason=module-autoload`
  则是固定 query 内捕获的模块错误。`reported=false` 表示未收到本命令的固定
  catch 标记，不能把它自动等同于模块错误。实际 CI 细分类仍待父会话下一次运行。
- `pnpm exec tsx --test packages\pguide-cli-core\test\process-tree.test.ts`：
  Windows Node 22.13.0、24.11.1 各 9/9，耗时 10593ms/10496ms。
  原六项均保留；实际不合作 owned 树现在使用新建独占稀疏 profile，
  不继承 PSModulePath/ProgramFiles/LOCALAPPDATA；另以真实 PowerShell 分别注入
  缺命令、模块错误与超过 5s 的命令，验证精确分类及未变的 5000ms 界限。
  非零 taskkill 后的 owned 后代验证、不可观测/存活后代失败均未放宽。
- Node 22.13.0 的 `tsx --test --test-name-pattern='sanity invocation diagnostics'
  packages\pguide\test\setup-objective.test.ts` 1/1，32083ms，
  覆盖新标签跨 setup 报告传递、畸形标签和 canary 不泄漏。
  相关 workspace/test typecheck、Biome、正式 runtime 再生成及 `--check` 均通过。
  临时环境诊断与 module-cache scratch 已清理；未动 Linux 修复、生产
  30s/24s/6s 预算、5s CIM 界限、SSH、其他 workspace 或合同。
  本轮是**诊断就绪，不是 Windows CI 根因修复或绿灯声明**；未跑完整 check、
  packed、Linux 重复测试或 CI，未 commit/push/改 gates/ledger/events/outer。

### CI 39220514441：修复已确认的冷启动 snapshot watchdog 误失败

- 父会话提供候选 `90653d1` 的精确 CI：其他四 job 通过，仅 Windows
  `117954463185` 返回 `kind=timeout;signal=SIGTERM;killed=true;elapsedMs=5037;reported=false`。
  已确认是新引入的 5s CIM measurement watchdog 截断冷启动，不再猜测
  permissions/module/JSON/inner probe；按父会话明确决定，将该内部界限改为
  **10000ms**，唯一生产行为差异是 shared `killProcessTree` 的该项 execFile timeout。
- 查询仍运行于现有 regulator/sanity 执行内，可被现有 subject/outer-process
  取消提前终止；不是给业务或查询额外保证 10s。共享 README 区分此 measurement
  watchdog 与整体执行预算：默认 subject 20s、Pilot cap 24s/process 30s、
  显式 local 60/75s 不变，6s 外围余量属于启动/输出及 outer runtime 自己的
  taskkill/teardown，不是这项 inner query 的预算；SSH、consent、实际整体 timers 不变。
- 原六个 shared cleanup 回归保留。真实不合作 owned 树使用独占稀疏 profile，
  单次 PowerShell fixture 在 query 前延迟 6s，再执行真正 CIM 查询；
  Node 22.13.0/24.11.1 实测分别 **7094ms/7125ms**，均明确 >5s 且 <10s。
  随后实际 taskkill 整树，再注入非零 128 结果，必须通过每个已捕获 owned PID
  的真实缺失验证；没有用根退出、英文 taskkill 输出或忽略错误替代 descendant proof。
- 挂起 fixture 使用实际 `Start-Sleep 20`，仍在 **10000ms** watchdog 下终止并
  显式失败；命令/模块故障、无效快照、不可观测/存活后代及部分终止失败路径均保留。
  无 retry、prewarm、skip 或 snapshot fallback。
- 两个安装 Node 版本均执行
  `pnpm exec tsx --test packages\pguide-cli-core\test\process-tree.test.ts`：
  **各 9/9**，总耗时 25428ms/21626ms。
  core `tsc -b`、test typecheck、Biome、正式 builder 再生成与 `--check`、
  `git diff --check` 均通过。generated process-tree 仅同步该 timeout，
  没有手改副本或更改 Linux 修复。
- 本轮不跑 full check、packed、Linux 重复验证或 CI；五文件（含本节）留为
  uncommitted，未 commit/push/改 gates/ledger/events/outer。
  父会话负责下一次精确候选 CI 与最终独立门禁，本节不宣称 Windows CI 已绿。

### Windows query 输入所有权与固定阶段诊断

- 父会话提供精确候选 `c6df282` / CI `39222027838`：其他四项通过，
  Windows 再次出现 `kind=timeout;elapsedMs=10024;signal=SIGTERM;killed=true;reported=false`。
  因而仅用“5s 冷启动不足”不能解释 CI；本轮不再增加 **10000ms** snapshot watchdog，
  也不改变默认 20/24/30s、显式 local 60/75s、SSH、consent 或整体取消边界。
- 原生 promisified `execFile` 返回 `PromiseWithChild`；真实 fixture 确认返回时其
  `child.stdin.writableEnded` 为 false。固定 query 不接收输入，现在由所有者立即
  `pending.child.stdin?.end()`，随后 await 结果；只关闭这一个 query 的管道，
  不触碰 ACP/root 的输入。生产路径不为 mock 添加 missing-child fallback；
  测试改为保留原生 child 或提供符合该 API 的模拟管道。
- 固定脚本依次写入 `started`、`query-started`、`queried`、`serialized`、`exiting`。
  错误只提取最后一个白名单 phase；没有合法标记时为 `unreported`，未知 phase 和
  任意 stderr/canary 均不透传。setup Fault 边界同步严格白名单，下一次 CI 可区分
  未进入脚本、query 未返回、序列化，以及脚本已完成但 process/stdio 尚未关闭；
  **`exiting` 不代表操作系统进程或管道退出已获确认**。
- 保留原九项 shared 回归，增加必须先收到 stdin EOF 才能完成的确定性回归。
  真实 PowerShell fixture 先执行 `[Console]::In.ReadToEnd()`，再延迟 6s，
  执行真正 CIM query，验证五个阶段、stdin 已结束及 >5s/<10s 的实际完成时间；
  随后实际终止 owned 树，注入非零 taskkill 结果后仍须证明全部捕获 PID 缺失。
  命令/模块错误、真实 10s 挂起失败及存活/不可观测 descendant 失败路径不变。
- 安装 Node **22.13.0 / 24.11.1** 分别执行
  `pnpm exec tsx --test packages\pguide-cli-core\test\process-tree.test.ts`，
  **各 10/10**，总耗时 **24040ms / 24469ms**；EOF-dependent 实际 query
  **7624ms / 7761ms**。Node 22.13.0 定向
  `--test-name-pattern='sanity invocation diagnostics'` **1/1**，安全 phase
  透传及伪造 phase/canary 隔离均通过。
- core build、test typecheck、Biome、正式 runtime builder 及 `--check`、
  `git diff --check` 通过；独占 profile 目录已清理。生成文件仅由正式 builder 更新。
  这是已验证的输入所有权修复与可观测性补足，**尚不宣称 EOF 是 CI 根因**；
  后续精确候选 CI 由父会话验证。本轮未运行 full check、packed、Linux 重复或 CI，
  未 commit/push，也未改 gates/ledger/events/outer；全部修改留为 uncommitted。

### Windows ownership snapshot 改用 Toolhelp32（不再依赖 CIM/WMI）

- 父会话提供精确 `6d3d635` / CI `39224567344`：其他四项通过，Windows
  `117967614585` 为 `timeout;elapsedMs=10026;reported=false;phase=query-started`。
  PowerShell 已进入 Get-Cim 所在 query/pipeline，但未返回；该 phase 不能区分
  cmdlet autoload 与 provider 等内部位置。EOF 生命周期修复仍有效，但不是此 CI
  故障的修复；不再追加阈值或 EOF 实验。
- 仅替换 Windows snapshot backend：同一个固定系统 PowerShell 进程内以
  `Add-Type` 内存编译 C# P/Invoke，调用 `CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS)`
  与 `Process32FirstW/Process32NextW`，直接取得 OS 公开 PID/parent PID；
  没有 CIM sidequery、进程内存读取、额外依赖/二进制/配置、预热、重试或失败降级。
  输出仍为 `{ProcessId,ParentProcessId}` 数组，原严格校验与 owned 集合闭包不变。
- `PROCESSENTRY32W` 明确 sequential/Unicode/Pack=8；DWORD 为 uint、LONG 为 int、
  heap ID 为指针宽度 UIntPtr、文件名为 260 WCHAR。真实 64/32 位 PowerShell
  分别验证 size **568/556**，heap offset **16/12**、parent offset **32/24**、
  filename offset **44/36**，并在两种宿主中找到测试 Node 的实际 PID/parent。
- 检查 `INVALID_HANDLE_VALUE`；仅 `ERROR_NO_MORE_FILES=18` 是枚举正常终点。
  每个有效 snapshot handle 均在 `finally` 关闭；snapshot/first/next/close 错误
  显式失败。只透传固定 `native-*` reason 和 uint 范围的 `nativeCode`，
  增加固定 `compiling/compiled` phase，setup Fault 同步严格白名单；不透传
  任意 stderr、路径或 Auth。保留 owned stdin EOF、**10000ms 总 snapshot watchdog**，
  编译也在此 watchdog 内；整体 subject/process/SSH/consent/取消预算完全不变。
- 原十项 shared 回归保留且 fault/EOF fixtures 已切换到真实 native query。
  新增双宿主 ABI 回归及六种确定性 native fault/end 场景：无效 handle、
  first/next 非 18 错误、first/next 的 18 正常终点，以及实际 close 后注入 close
  错误分支；验证有效句柄在失败/正常返回时确实关闭，无效句柄不关闭。
  真实不合作树额外断言 native snapshot 捕获 child 与正确 parent，再实际 taskkill
  并注入非零结果；必须证明全部捕获 owned PID 缺失，活着/不可观测后代仍失败。
- 最终安装 Node **22.13.0 / 24.11.1** 各运行
  `pnpm exec tsx --test packages\pguide-cli-core\test\process-tree.test.ts`：
  **12/12、12/12**，总耗时 **39241ms/35940ms**，无 skip；
  EOF + 6s 延迟的真实 native query **7328ms/6997ms**，真实 10s 挂起仍显式失败。
  Node 22.13.0 定向 setup `sanity invocation diagnostics` **1/1**：
  native reason/code 可安全透传，伪造 phase/canary 不泄漏。
- core build、test typecheck、Biome、正式 runtime 再生成及 `--check`、
  `git diff --check` 通过，独占 profile 已清理。未运行 full check、packed、Linux
  重复或 CI；未改 POSIX、门禁/账本/事件/outer，保留父会话现有 Implementation
  修改。八个本轮文件留为 uncommitted，未 commit/push；父会话负责 ABI/runtime
  复核及下一精确候选 CI，本地通过不等同 Windows CI 已绿。

### 固定 Windows helper 显式加载可信 Utility，禁用隐式模块发现

- 父会话提供 `928993592df854cc3b6e7fa7a30b4bdb1233b523` / CI
  `39227700246`：其他四项通过，Windows 为
  `timeout;elapsedMs=10303;reported=false;nativeCode=none;phase=compiling`。
  native query 尚未调用，位置在 Add-Type 调用/隐式 autoload/编译范围内。
  旧 Get-Cim 的 `query-started` 同样包含 cmdlet autoload，故先前并未证明
  CIM provider 本身是根因；不再把替换 provider 或本地成功当作 CI 根因证明。
- 固定 helper 子会话设置 `$PSModuleAutoLoadingPreference='None'`，用 Core 内建
  `Import-Module` 从绝对 `$PSHOME\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1`
  加载系统 Utility；不使用会触发其他模块发现的 Join-Path。Add-Type 与
  ConvertTo-Json 均显式 module-qualified，没有发现/导入用户模块或失败 fallback。
  新固定 `importing/imported` phase 区分导入与后续 Add-Type：
  `compiling` 现在明确发生在可信模块导入成功之后。安全白名单及 setup Fault 同步，
  仍只输出固定标签、有限数字，不泄漏路径/Auth/stderr。
- 父会话核实 regulation worker 的 fork 没有 env override，shared helper 继承的是
  setup CLI executionContext 环境（包括存在的 TEMP/TMP），不是 Agent transport.env
  的精简列表。本轮不修改该边界、不追查错误的 Agent profile，也不臆改 TEMP/TMP；
  生产 subprocess 的环境继承保持原样，仅改变其 PowerShell 会话模块加载方式。
- 新真实 sparse-env 回归保留 TEMP/TMP 等允许键，分别省略 PSModulePath 和仅给出
  owned canary 模块目录；该目录含假 Utility 与无关 canary module。
  验证实际加载的 Utility manifest 来自 PSHOME、autoload 为 None、无关命令确实
  CommandNotFound 且模块未加载、canary 不执行，仍获得真实 PID/parent 数组。
  Node 22.13.0 两种环境实际完成 **659/632ms**；Node 24.11.1 **628/589ms**。
  这是本地实测而非对 GitHub runner 全部环境/故障的复现或根因确认。
- 原十二项 shared 回归全部保留，新增 missing trusted-import 的真实显式失败及
  importing timeout 标签回归；native ABI/错误/句柄 finally/非零 taskkill owned
  缺失证明、实际 10s 挂起失败保持。EOF + 6s fixture 改用 .NET Thread.Sleep，
  避免原 Start-Sleep 在生产脚本之前隐式预载 Utility；不是增加预热。
  **10s watchdog、20/24/30s 默认与 60/75s opt-in、SSH/consent/取消、POSIX、
  native ABI 均未改变**；没有新依赖/二进制、策略/AV 绕过、重试或额外预算。
- 两个安装 Node 版本各执行 shared process-tree 定向文件：**13/13、13/13**，
  总耗时 **27080/27349ms**，无 skip；真实 EOF-dependent query **6680/6708ms**。
  Node 22.13.0 setup diagnostic 定向 **1/1**（包括新增 importing 标签安全透传
  和原 native/canary 隔离）。core build、test typecheck、Biome、正式 runtime
  builder 及 `--check`、`git diff --check` 通过，owned profile 已清理。
- 八个本轮文件留为 uncommitted；未运行 full check、packed、Linux 重复或 CI，
  未 commit/push/改 gates/ledger/events/outer。父会话负责下一精确候选 CI；
  若仍为 `compiling`，应继续定位 Add-Type/编译内部，而不是再增 watchdog。
