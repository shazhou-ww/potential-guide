# 实现验证

## 新 Ideal 修订的证据边界

2026-10-29 用户要求整理统一 Request 生命周期的新设计；本次只修改文档。
下文完整 gate 与针对性结果均属于 `127666e4ec04` 及其先前候选，
不能证明新增 eligible、递归锚点、PENDING、fallback、series events 或未完成 Task
持久恢复已实现。Implementation 的要求已变化，当前 I-* 已重置为未完成；
原成功记录保留，不把历史通过改写为失败，也不将其沿用为新修订验收。

## 已执行的针对性证据

- `pnpm --filter @potential-guide/check-artifacts exec tsx --test test\contracts.test.ts`：
  6 个测试通过。Git SHA-256 独立对象库 oracle 覆盖目录特殊排序、嵌套、Unicode、
  空文件和原始换行；另覆盖 YAML 非 JSON 输入、未知 runtime/版本下界、
  目录页/override/base 来源、未知业务问题、typed reference round-trip、
  getter 不执行及 JSONata selection profile 反例。使用真正 JSONata 2.1.0 核对
  构造/路径/数组向量；Draft 2020-12 prefixItems 反例证明不是静默忽略新方言。
- `pnpm --filter @potential-guide/checker-host exec tsx --test test\task-service.test.ts`：
  3 个确定性测试通过。显式控制 start/finish 与准备完成顺序，覆盖预约共享、
  强/弱 freshness、晚解析保留结果、幂等冲突、独立期限及最后 owner 封口；
  阻塞 timer 的反例证明过期执行不能被新的弱需求复活。
- `pnpm --filter @potential-guide/objective-host test`：
  3 个 HTTP/SDK 真实 worker 用例通过，覆盖自定义前缀同进程挂载、实际运行环境和
  独立执行 revision、语义页/404/不支持语言、动态依赖二次调用、绑定篡改拒绝、
  取消/期限和显式 initial。文件门闩控制真实 worker，证明弱需求共享根执行、
  新强需求另起执行并拥有新子 Task、取消首个需求不伤仍在等待的弱需求。
- `node --test scripts\artifact-host-contracts.test.mjs`：
  1 个端到端用例通过。真实作者目录→归档→安全解析→实际 Checker→Pilot→
  无 Agent 的成功 Regulation→Coordinator schema 3→SQLite 保存/重开/准确恢复。
  SQLite 事实包含真实 observation 及叶子 executionEvidence，不仅保存请求占位。
  检查新摘要没有冒充旧摘要、无 manifest id、运行环境变化拒绝及跨 scope 缓存拒绝。
- `node --test scripts\publish-schemas.test.mjs scripts\objective-artifact.test.mjs
  scripts\artifact-host-contracts.test.mjs`：4 个测试通过，包括原格式的公开 CLI、
  Regulation/continue 与 Coordinator 回放，以及递归新 schema 命名空间的不可变检查。
  原测试 Markdown 子进程遗漏了已有隔离环境；现复用同一隔离 env，
  没有读取/迁移/编辑用户配置，也未跳过原来的输出断言。

## 仓库 gate

2026-10-29 独立 worktree 续作后的 `pnpm check` 已完整退出 0：
build、layers、format、lint、typecheck、test 和 pack consumers 均通过，
25 个制品包及 11 组隔离消费者全部完成，包括新增的 `artifact-hosts`。
工作区诊断日志为 `.cache/artifact-host-contracts-check.log`，不是发布或部署凭证。
所有测试拥有的目录位于仓库 `.cache` 内，测试结束清理；未编辑用户或全局配置。

实施工作与本地证据已就绪，不等于生命周期验收。用户明确禁止自动合并或推送，
本地候选未同步 primary；WIP 分支继续跟踪对应 origin/WIP，Silvermoon 的
upstream/同步前置条件仍未满足。没有追加 submitInner、accept 或任何部署事件，
没有修改 Ideal。后续须先按用户授权处理同步，
再对准确提交与 revision 执行 gate，不得以本页或 I-* 勾选代替验收。

## 后续自主推进与父 agent 门限复核

用户随后要求由子 agent 推进实现与部署、父 agent 负责门限检查。
父 agent 已复核本次生产修复、回归断言及完整 gate 日志；子 agent 使用同一代码候选
完成仓库外的五个 tarball 安装和九组真实 HTTPS/鉴权 HTTP/SDK 验证，
证据见 [deployment-verification.md](../deployment-verification.md)。
父 agent 另行审阅脚本与原始报告、比对附件摘要并检查进程和端口清理；
I-*、D-* 勾选仅记录已执行和核查的工作，不代表生命周期验收。

仓库外验证后只新增 Outer 证据及调整文档/ledger，没有修改已通过完整
`pnpm check` 的生产代码、测试或包清单，故未为文档变化重复运行整条 gate。
最终候选执行 Silvermoon worktree 和 staged snapshot 校验后可保存本地 WIP 提交；
此前禁止自动合并、推送的边界继续有效，未改 upstream 或原工作区。

## 2026-10-29 独立 worktree 续作

- 环境为 Windows、Node `v24.11.1`、pnpm `11.22.0`。
  仅在 `artifact-host-contracts-20261029` worktree 继续；本地分支为
  `wip/artifact-host-contracts-20261029`，基线 HEAD 为 `342de2e120a4`。
  当轮未切换或修改原工作区，未提交、合并或推送。
- 先新增失败回归，复现有限 JSON 校验放过自定义数组原型及带命名属性的稀疏数组；
  现明确拒绝这些输入，不执行继承的 toJSON，也不静默转换为空值。
  映射输入/输出、进展和最终结果/证据现按 UTF-8 JSON 字节计量，
  覆盖精确限额、超出一个字节、中文多字节、映射扩张及进展 getter 不执行。
- Windows 深 worktree 下，旧兼容性测试曾因临时路径触及原生 API 长度限制，
  在目标断言前失败。缩短测试自有的目录层级和 case 名称后原断言通过；
  没有放宽生产文件权限校验、初始化预算、失败条件或跳过测试。
  最初全量运行也读到了尚未修复的新增失败回归；该次 exit 1 不作成功证据。
- 新增真实 HTTP/SDK 语言反例：Objective 通过整页覆盖支持 `zh-CN`，
  仅支持 `en` 的 Checker 仍以 `en` 执行并记录在子快照；根快照保留 `zh-CN`。
  有效问题阻塞 level，Task completed 不冒充业务 attained；base 原页来源不变，
  不存在的中文 base 页仍返回缺页错误。
- 新增 `artifact-hosts` 隔离 tarball 消费者：仅安装公开包，调用
  build/write/pack 作者 API，重新解包校验，挂载服务，经 Checker v3 与 Objective
  SDK 执行真实 worker 并查询准确 References/404。模块不从仓库源码或 workspace
  链接导入；这属于实施 gate，不代替 Deployment 要求的仓库外验证。

### 本次重新取得的针对性证据

- `pnpm --filter @potential-guide/check-artifacts exec tsx --test test\contracts.test.ts`：
  8/8 通过，含独立 Git SHA-256 oracle、可移植 JSONata 对照和新增边界反例。
- `pnpm --filter @potential-guide/checker-host exec tsx --test
  test\discovery.test.ts test\task-service.test.ts test\v2-real.test.ts`：
  7/7 通过。发现恢复覆盖 early/claimed/published 各两次、四调用方只起一个替代 Host；
  内层真实 HTTPS 用例也成功结束，保留原旧版协议和 worker 清理断言。
- `pnpm --filter @potential-guide/objective-host test`：4/4 通过。
- `pnpm --filter @potential-guide/cli-runtime exec tsx --test test\objective-artifact.test.mjs`：
  7/7 通过，原未知问题、浮动来源、悬空链接与循环反例未绕过。
- `pnpm --filter @potential-guide/objective-monorepo-standard exec tsx --test
  test\checker.test.ts`：24/24 通过。
- `node --test scripts\publish-schemas.test.mjs scripts\objective-artifact.test.mjs
  scripts\artifact-host-contracts.test.mjs`：4/4 通过，包含旧 CLI Regulation/continue、
  新来源 Pilot/Regulator/Coordinator 和 SQLite 保存、重开与准确恢复。

## 历史暂停与续作（用户关机检查点）

- 按用户暂停要求停止实施和测试；没有创建 commit、切换分支、push、
  submitInner、accept 或部署。暂停时分支仍为 `main`，
  HEAD 为 `d8854892447942bac6c1d3dccd8d29b3af72fbab`。父 agent 负责另建检查点分支并提交推送。
- 初始 worktree 干净；当前全部 tracked 修改与 untracked 候选均由本 agent 写入，
  以暂停时 `git status --short` 为准确清单。主要范围为 `packages/check-artifacts`、
  `packages/check-host`、新增 `packages/objective-host`、Pilot/CLI/Regulator/Coordinator
  适配、相关测试、schema/发布清单/工作区配置和本 Inner World 文档。
  Ideal、Deployment、events.jsonl 与 ledger 未修改；I-* 仍未勾选。
- 主干实现及针对性证据已落盘。一次完整 `pnpm check` 曾 exit 0，
  包括 25 个包与 10 组隔离消费者；之后修正了 base 页面命名以匹配 Ideal 示例、
  Host 最低支持策略与带类型来源校验。针对性契约用例仍通过。
- 后一轮完整 gate 出现两个仅报告 test 文件进程失败的并发退出
  （`objective-monorepo-standard/test/checker.test.ts` 与 `check-host/test/v2-real.test.ts`）；
  原样独立重跑分别 24/24 与真实 HTTPS/SDK 用例通过，未放宽断言或改测试绕过。
- 最后一轮 `pnpm check`（shell `artifact-full-check-7`）按用户要求停止。
  已经过 build/layers/format/lint/typecheck/test，正在 pack 的隔离消费者验证；
  最后可见 `isolated objectives` 通过，尚无整条命令 exit 0。
  停止时可能留下操作拥有的 `.cache` 中间目录，均不应进入提交。
- 明日先查看检查点分支与 fresh Silvermoon 状态，复核当前 diff，
  对当前准确候选重跑 `pnpm check`，尤其保留 packed consumers 的最终成功证据；
  不把被中断的最后一轮记为通过。确认代码与测试无缺口后更新证据和 I-*，
  再按父 agent 的 gate 流程同步准确候选及 submitInner；本检查点不构成完成声明。

## 交接分支与恢复入口

- 检查点分支：`wip/artifact-host-contracts-20261029`，远端 `origin`。
  这是用户明确要求的未完成实施备份，不合入 main，不追加 submitInner 或任何验收事件。
  主 agent 尚未完成独立代码/gate 审查；本页的针对性测试记录由实施 agent 提供。
- 2026-10-29 暂停时，实施 agent 已取消，最后完整检查 shell 已停止；没有等待其后台
  完成的任务。不要将进程中断解释为测试失败的根因已解决或候选已通过完整检查。
- 在另一台机器先 `git fetch origin`，再
  `git switch --track origin/wip/artifact-host-contracts-20261029`
  （已有本地分支时直接切换）。按仓库 Node/pnpm 要求恢复依赖后运行 `pnpm check`。
  本机 `.cache` 日志不随分支上传，应在续作环境重新生成；必要的已知结果已摘要于上文。
- 首先检查 `Implementation.md`、`implementation-contract.md`、本页及未完成的 ledger，
  然后核对 accepted Ideal 与实际代码。优先确认最终 pack consumers、上文两个并发测试
  的稳定性，以及完整新旧消费链；不要只根据前一次候选的成功宣布本候选成功。
- 本分支领先 primary 是刻意的暂停状态。续作前刷新 primary、保留并整合并发历史，
  不丢弃检查点，也不强推；达到完整实施候选后再按 Silvermoon 流程同步和 submitInner。
  用户已授权协调 agent 审批后续 gate，但必须审查准确提交与证据。通过 inner 后才开始
  独立 packed-consumer 部署验证，禁止提前勾选 Deployment 或发布 npm/Release。
