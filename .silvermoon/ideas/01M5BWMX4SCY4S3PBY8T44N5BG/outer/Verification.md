# 受控部署试用结果

## 固定契约、产物与环境

本阶段先将 [Deployment](./Deployment.md) 同步到 primary commit `de90468701d844ab67323430b3a7345ec7ec3ba8`，观察其准确 deploymentRevision `eebbf6b10f5aea6441f59acd491b3abb782a833a` 后执行试用。已接受 implementationRevision 保持 `e94a791d179cd0aaf03ced4789efaa9999680b50`；本阶段只增加 outer 证据并更新 ledger，不改 inner/ideal、真实 Objective 定义或检查代码。

2026-10-20，在 Windows、Node.js `v24.12.0`、pnpm `11.22.0` 下执行 `pnpm build`（12 个工作区构建全部通过），随后独立运行本地 `dist` CLI 和库产物，不通过测试 runner，不发布 npm，不安装全局新版本。关键产物 SHA-256 见 [Proof](./Proof.json)，完整 10 个产物指纹在原始 summary。试用的两个来源在本次独占的临时目录内真实 `git init`、commit；检查脚本是 committed run.mjs，通过 bare `@potential-guide/objective-pilot` import 和实际 Node IPC 绑定，不调用嵌套 check CLI。

试用采用受控本地 ACP 规划/执行程序，不依赖真实用户账户或外部模型。规划程序仅返回当前 candidate ID/priority；执行程序拒绝消费者或错误 subject，只在收到提供者的治理 prompt 时给本次独占 marker 写入指定内容。它真实经过 CLI、进程 worker、ACP initialize/session/new/prompt 和独立文件检查；不将其声称为真实用户 Agent 授权、安全模型或生产接入的验证。

## 实际命令与输入

复现程序在实施会话保留：

```powershell
node C:\Users\Wei\.copilot\session-state\7246033c-6a5b-422e-8d04-10eb223d11ea\files\verify-dependency-deployment.mjs D:\Code\potential-guide.worktrees\parent-child-session-implementation
```

每次执行创建新的临时双仓库、独立状态及证据目录。程序 SHA-256 为 `36cf666115df49ad85290e7b41e150f5b46a6aa1166cb651fad9db8028daf24a`。它核实已同步部署契约的准确树和未变的 accepted inner，再执行 CLI、解析结果和断言，最终清理自己创建的来源及状态。复跑需要相同构建源码和本地 `D:\Code\silvermoon`（只读迁移边界核查），不是将已清理 fixture 当作长期服务。

最终完整运行时间 `2026-10-20T07:17:05.023Z` 至 `07:17:23.102Z`。以下变量只是对**该次实际参数**的缩写；原始逐命令 JSON 包含完整 command、args、cwd、stdin、stdout、stderr、退出码和时间：

```powershell
$build = 'D:\Code\potential-guide.worktrees\parent-child-session-implementation'
$trial = 'C:\Users\Wei\AppData\Local\Temp\pg-dependency-trial-Kz1BmT'
$consumer = 'git+file:///C:/Users/Wei/AppData/Local/Temp/pg-dependency-trial-Kz1BmT/consumer#objective/pilot.yaml'
$provider = 'git+file:///C:/Users/Wei/AppData/Local/Temp/pg-dependency-trial-Kz1BmT/provider#objective/pilot.yaml'
$consumerCommit = 'b0770effec02643f49087b9db9a449c708a9e064'
$providerCommit = '011c2916eeb5f38f0a1f0a882262a470540cec05'
$config = "$trial\pguide-config.json"
```

消费者 stdin subject：

```json
{
  "job": "controlled-release",
  "audit": "C:\\Users\\Wei\\AppData\\Local\\Temp\\pg-dependency-trial-Kz1BmT\\observations.jsonl",
  "provider": {
    "marker": "C:\\Users\\Wei\\AppData\\Local\\Temp\\pg-dependency-trial-Kz1BmT\\provider-ready.txt",
    "expected": "controlled-provider-ready",
    "audit": "C:\\Users\\Wei\\AppData\\Local\\Temp\\pg-dependency-trial-Kz1BmT\\observations.jsonl"
  }
}
```

提供者 subject 是上述 `provider` 对象，既不是整个消费者 subject，也不是默认隐式沿用。两个 Manifest 均为 schemaVersion:1，不含 prerequisite。消费者 entry 层检查先正常通过；release 中间层才调用来源绑定的依赖 probe，期望提供者 terminal。

| 原始命令（cwd 为本次 trial） | 退出 | 实际结果 |
| --- | ---: | --- |
| `node "$build\packages\pguide\dist\bin\probe.js" --pilot $consumer --revision $consumerCommit --config $config --format json`，stdin 为上述 subject | 0 | current 为 consumer/release，全部问题为 provider 的 dependency；versions 精确包含两个来源 commit |
| `node "$build\packages\pguide\dist\bin\regulate.js" --pilot $consumer --revision $consumerCommit --config $config --format json --target terminal --agent worker`，同一 stdin | 3 | dependency-required，iterations=0、stalledRuns=0，dependencies 等于同次 observation；此时没有任何 execute 调用 |
| `node "$trial\until-consumer-terminal.mjs" --portfolio-file "$trial\portfolio.json" --planner planner --execute --duration-ms 45000 --config $config --format json` | 0 | wrapper 实际加载构建 `supervise.js`；只有在 planner 收到消费者新 terminal 观察且无候选后才发 SIGINT。45s 是失败 watchdog，不是达标条件 |
| `node "$build\packages\pguide\dist\bin\probe.js" --pilot $provider --revision $providerCommit --config $config --format json`，stdin 为 provider 对象 | 0 | 提供者独立重新检查 marker，terminal |
| 与第一条相同的 consumer probe | 0 | 消费者再次独立观察 terminal，versions 与首次完全一致 |
| consumer probe，revision=`80f8a73a4d07e1970add98c4794dc2f3413bc937` | 2 | 本次隔离来源故意加入被删除 prerequisite；pilot-error，明确 Expected fields，不进入观察 |
| consumer probe，revision=`a16a5c93738ecd70f32c65faf5841f035fd01f8f` | 6 | 同一隔离来源输出旧 `{id,parameters}`；status=502、payload=null、process-protocol: Expected fields: kind, id, parameters |
| 再次使用原始 `$consumerCommit` 的 consumer probe | 0 | 即使来源 HEAD 已有上面无效版本，原合法 schemaVersion:1 仍按明确旧 commit 通过并到 terminal，不无故拒绝未变结构 |

supervise 的实际 result 事件按顺序包含：

1. 消费者 `b0770effec02643f49087b9db9a449c708a9e064`：dependency-required，iterations=0，current=release。
2. 动态派生提供者 `011c2916eeb5f38f0a1f0a882262a470540cec05`：target-reached，iterations=1，current=terminal。
3. 结束报告中 consumer 的**新观察**为 terminal，queue.demands 为空；并在 supervise 退出后另跑 provider 和 consumer probe，再次分别确认 terminal。并非把提供者成功当成消费者成功。

执行日志只有一次 execute prompt，target 明确为 provider/terminal；实际写入事件时间为 `2026-10-20T07:17:14.740Z`，marker 内容为 `controlled-provider-ready`。消费者 entry、environment 的原始观察记录同时保留 false 与后续 true；消费者没有收到代修依赖的 Agent 调用。

## 真实工程切换边界

本阶段的受控闭环已完成；真实工程接入仍被明确阻塞，并未因此迁移或宣布完成。只读核实以下已提交源与工作区 blob 一致，未改定义、真实探针或派生文件：

| 工程/固定版本 | 实际核查 | 结果 |
| --- | --- | --- |
| potential-guide `de90468701d844ab67323430b3a7345ec7ec3ba8` | `packages/objective-monorepo-standard/check.mjs` 实际 `main("structure", {root, contract:"missing-controlled-migration-proof.json"})` 输出，再调用新 parser | 原始问题仍无 kind；严格拒绝 Expected fields: kind, id, parameters。缺失路径未创建 |
| 同上 | `packages/objective-pguide-setup/src/contract.mjs` 真实 `problem("environment-unavailable", {stage:"configuration"})` 输出，再调用新 parser | 原始问题仍无 kind；同样明确拒绝 |
| Silvermoon `5c256bb76829240dafe648e3d5b7c7198a7927ea` | 只读 `src/business/objectives/project/manifest.yaml` 与 `idea/manifest.yaml`，对完整真实内容调用新 `parseManifest` | 两者仍含 prerequisite；分别明确拒绝 Expected fields: schemaVersion, domainSchema, levels, defaultLanguage, languages。没有调用新运行时接管真实 Silvermoon |

真实文件的提交 blob 及 SHA-256 见 Proof。保留已由实施和父会话独立复现的三项旧协议集成阻塞：monorepo 的 invalid-contract、valid-internal-package 两项实际 probe，以及 setup 的 Git snapshot 缺失环境变量分支一项；本阶段未重新执行整套 `pnpm check`，不将受控试用通过改写为其通过。

恢复真实接入的必要条件：由用户之后分别手动迁移两工程需要变更的 Manifest/检查输出及其派生产物，按新协议在真实来源上独立复核；确认 monorepo 两项、setup 一项集成阻塞消除，再执行全仓检查与真实治理验证。既有合法且不含删除字段的定义无需无关 schemaVersion 升级。本阶段不代做、不兼容读取、不发布 npm，也没有用户项目切换。

## 外部证据、清理与限制

最终原始证据目录：

```text
C:\Users\Wei\.copilot\session-state\7246033c-6a5b-422e-8d04-10eb223d11ea\files\dependency-deployment-xpQyQl
```

关键文件为 `summary.json`（完整原始结果与命令）、`18-initial-consumer-probe.json`、`19-consumer-regulate-handoff.json`、`20-actual-supervise-closed-loop.json`、`21-independent-provider-after.json`、`22-independent-consumer-after.json`、`26-deleted-prerequisite-rejected.json`、`30-old-problem-rejected.json`、`31-original-valid-schema-still-accepted.json`、`agent-calls.jsonl`、`observations.jsonl`；还保留实际 config/portfolio/subject/ACP 程序和 report 目录。

`consumer.bundle` 与 `provider.bundle` 保留本次精确 Git 对象（包括两个拒绝版本），都已执行 `git bundle verify` 成功。复现程序创建新 trial，不能直接使用已清理旧目录运行上表命令；bundle 可供独立审阅来源内容，指纹见 Proof。会话本地证据不保证跨设备可用，因此本文件及仓库 Proof 同步保留固定版本、命令和结果索引，不使用会变动的 branch 链接替代。

退出前确认本次 `.cache/pguide-probes`、`pguide-runs`、`pguide-sources` 的子目录均为空，再删除整个**本次 mkdtemp 独占 trial 目录**；原始证据目录单独保留。构建产生的无内容 THIRD_PARTY_NOTICES 换行变化也已清理，未提交真实派生产物。13 个受控试用断言组均通过。

前三次临时试用程序调整未计作成功证据：首次规划器误读了已有 `goalSummary.objectiveId` 字段；第二次 750ms 轮询在提供者实际写 marker 后提前观察达标并取消其退出，无法证明本次要求的完整 provider result，于是将本次配置观测间隔设为 60s、依靠 result 驱动恢复；第三次拒绝用例写到了临时来源根而非 objective 目录。修正只发生在会话试用程序，没有改动已接受实现。之后在全新目录完整通过，并额外重跑一次加入已验证 bundles 的最终证据。

本阶段验证限于本机 Windows 构建产物、受控 ACP 和本地两个 Git 来源。没有新的 Linux/远端 SSH/HTTP 服务、任意第三方 Agent 或真实生产环境治理结论。D-S01/D-AC01 对应上述实际交接恢复；D-S02/D-AC02 对应成功/拒绝对照、两个真实工程仍未迁移的只读证明及明确恢复条件，最终 acceptOuter 仍由父会话独立判断。
