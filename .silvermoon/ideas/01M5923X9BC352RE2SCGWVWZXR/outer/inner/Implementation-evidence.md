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
单纯把十秒改为二十四秒的版本；合并后的候选仍需重新执行完整检查。
