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
