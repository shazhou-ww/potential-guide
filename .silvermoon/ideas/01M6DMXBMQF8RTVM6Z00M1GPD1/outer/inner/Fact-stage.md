# 事实模型实施证据

服务于 [Implementation](Implementation.md)。主 Agent 发现 sharing 错用全 Input canonical，
本次恢复既有 Schema Equals，六个 I-* 先重置，修复后定向、八包及全仓验证完成后才勾回；
D-* 保持未勾选。旧 306 用例与旧 pnpm check 退出 0 不作为本次修复证据；
Schema 修复轮八包 338/338、完整 `pnpm check` 实际 exit 0，独立记录在下方 Schema Equals 小节；
主 Agent 随后独立复验暴露时序失败，不能据此前一次通过宣称最新候选通过；
后续时序及 SSE 关闭修复后，最新完整检查已实际 exit 0，见下方独立记录。

## 当前实现

- protocol v4 仅持久化 Task 受理/取消事实，匹配与 stage 由源事实前缀、可信资格观测和 Run 开始序推导；
  不再写 Task snapshot、binding 或 Task 终结事务。源时间见证只含 observedAt，查询不追加见证。
- Run 可靠 outcome、停止请求、Worker 停止确认、实际退出和宿主回收分别记录；
  未退出的恢复裁决为 stopped，不重新执行，不把恢复当作物理回收证明。
- ULID 窗口下界持久且不可回退，先于幂等查重；保留原始遗漏字段及仍可受理 ID 的凭据。
  SQLite 以完整源重放核验可重建 checkpoint，格式不支持明确拒绝，旧 v3 文件保持原字节和原位置。
- 全域 source revision 用于单体历史、冻结分页及集合补读；集合按完整源事件封装，
  超限明确失败并携带最后完整 revision，不能静默截断。HTTP 贯通十二项操作及配套类型/Request/消息能力。
- Probe 从独立 Run 快照/历史核验子 Check 的环境、结果与来源，不再依赖 Task 混合事件；
  UI 保留同源多成员、原子应用集合及可继续推进的 canceled Task，不修改收藏行为。
- Task updatedAt 只归属可见受理、资格、取消、stage/结果事实；Run progress 不更新 Task，
  两者均按源序最后相关事实取时间，不用最大墙钟时间掩盖回拨。

## 修复前候选的历史验证（非当前候选通过证据）

下列命令均已实际运行完成；其后修改仍需最终复跑，不能将这些结果相加冒充一次全套通过。

| 层 | 命令（仓库根执行） | 实际结果与证明 |
| --- | --- | --- |
| Engine 核心 | `pnpm --filter @potential-guide/task-engine exec tsx --test --test-concurrency=1 test\domain-contract.test.ts test\engine.test.ts test\projection-races.test.ts` | 42/42；三维、终态取消、Q08 基本反例、退出隔离、源序重放、时钟回拨、外部 series 与 recurrence 明确拒绝 |
| 源资格 | `pnpm --filter @potential-guide/task-engine exec tsx --test --test-concurrency=1 test\event-binding.test.ts` | 13/13；同源退出投影全部 Task、停止排除新资格、未知物理回收及无 Task 权威缓存 |
| SQLite | `pnpm --filter @potential-guide/task-engine-storage exec tsx --test --test-concurrency=1 test\facts-v4.test.ts test\storage.test.ts test\startup.test.ts test\catalog.test.ts` | 21/21；真实子进程在指定受理、Run 开始/退出和外部后继受理提交前后崩溃，恢复不重演；旧库保留、前缀一致性与下界 |
| Check | `pnpm --filter @potential-guide/check-task exec tsx --test --test-concurrency=1 test\check.test.ts` | 9/9；独立 Run 仍按可信 allocationLimit 约束业务容量，晚结果由另一有效共享需求保护 |
| Probe | `pnpm --filter @potential-guide/probe-task exec tsx --test --test-concurrency=1 test\probe.test.ts test\input-schema.test.ts test\resource-release.test.ts` | 17/17；保留独立 Run 的环境与业务证据复验，回拨/晚结果测试显式提供有效独立需求，不恢复旧无效需求保护漏洞 |
| 测试类型 | `pnpm exec tsc -p tsconfig.test.json --noEmit --pretty false` | 本轮旧格式测试迁移后 exit 0；未修改范围外消费者 |
| 最终八包 | `pnpm exec turbo run lint typecheck test`，显式筛选八个 workspace | 38/38 tasks，28 个有效缓存，80.293s；306/306：protocol 18、Engine 133、storage 32、HTTP 14、server 10、Check 20、Probe 19、UI 60；此前同一候选八包 build exit 0 |
| 最终全仓 | `pnpm check` | **exit 0**；layers/build、format、lint、typecheck、test、pack:check 全部完成；全仓 test 的 Turbo 阶段 68/68 tasks（67 个有效缓存），随后脚本测试 42/42 及全部独立生产消费完成 |
| 独立生产消费 | `pnpm pack:check` | 单独实际运行 exit 0，随后完整 pnpm check 再次通过；18 类 isolated consumer 均 passed，包含 packed Probe、MVP server/Check、实际文件 Check、SSE 重连和 SQLite 重开 |

真实进程崩溃测试现按指定源事件 arm fault，而不是在异步 Worker 尚未 ready 时提前退出；
比较用公开 projection，不将测试 DTO 写回领域 Task。

## 最终质量边界与失败修复记录

- 旧回归迁移已完整进入八包验证；早期被旧 fake-clock ID/错误 fixture 卡住的试跑均已中止，
  不计为完成。SQLite header 测试改为实际 v4 并始终关闭 inspection handle，避免失败后的 EBUSY 掩盖原断言。
- 已补单见证双成员 HTTP 封装、超限 lastCompleteRevision、并发受理及真实 SQLite 资格提交前/后崩溃；
  重启后先按历史 running/joined 补读，再观察 recovery/stopped，不拿当前终态补旧集合。
- UI 批量目录 fixture 改为等待每个实际 Run 终结及 reclaimed，再创建下一成员；
  不依靠旧“先运行后排队”的 5 秒批量窗口，不改断言、默认预算或全局测试并行度。
  安静流连接确认不写源事实；错误控制帧复用凭据脱敏，完整帧前不转发、不推进锚点。
- 第一轮完整 `pnpm check` 在 pack 阶段发现旧 MVP 消费脚本缺少显式源锚点、仍把 Run 事件计入 Task 历史；
  仅修复直接脚本 `scripts/check-mvp-consumer.mjs`：显式 initial.revision、Task 三个事实变化及独立 Run 开始/退出历史。
  随后独立 `pnpm pack:check` 和完整 `pnpm check` 均实际退出 0，不把前一次失败算通过。
  直接从仓库根执行示例脚本因根包未依赖业务包而 ERR_MODULE_NOT_FOUND，是缺少独立安装消费者的前置条件，
  不安装/伪造根依赖；正确入口为现有 `pnpm pack:check`。
- 最终证据及 ledger 已通过 whitespace、Silvermoon worktree 检查；
  14 篇改动文档、24 个本地链接、六个已完成 I-ID 与仍未勾选的 D-ID 镜像核对通过。
  不提交、推送、追加生命周期或进入 Outer。

## V01–V17 可复跑证据索引

以下索引对应最终八包及完整全仓验证；索引本身不是生命周期接受，命令结果以本文件记录的实际退出为准。
路径相对仓库根，统一由现有 `tsx --test` 运行，不引入框架。

| 场景 | 证据入口及关键断言 |
| --- | --- |
| V01 | Engine `domain-contract.test.ts` 的持久窗口边界/回拨/配置扩大；HTTP `contract-v4.test.ts` 的八次并发重试只写一次受理；storage `storage.test.ts` 的真实受理提交前后崩溃及重启幂等 |
| V02 | server `server.test.ts` 的同库竞争/启动回滚；storage `storage.test.ts` 的真实所有者进程崩溃接管；domain-contract 的跨域 revision 拒绝 |
| V03 | protocol `protocol.test.ts` 与 `qualification.test.ts` 的时间等号/纯查询；Engine `projection-races.test.ts` 的所有结局及 now 回拨，不写 Task 判断 |
| V04 | Engine `engine.test.ts`、`event-binding.test.ts` 的共享、pending 取消、终态首次/重复取消；UI `review-regressions.test.ts` 的乱序收据及取消后 stage 继续推进 |
| V05 | protocol `qualification.test.ts` 的最早开始序/可信前缀；Engine `domain-contract.test.ts` 与 `event-binding.test.ts` 的 active terminates、同刻及回拨 |
| V06 | `event-binding.test.ts`、`projection-races.test.ts` 的停止先成立排除新资格及保留旧匹配；`pool.test.ts` 的旧压力授权不能复活已停 Run |
| V07 | `domain-contract.test.ts` 指定卡死 Run 强杀且同类型另一 Run 继续；`type-supervisor.test.ts`、`boundaries.test.ts` 的真实退出、独立时间预算及有效需求保护 |
| V08 | `run-contract.test.ts`、`supervisor-review.test.ts` 的结果先到/退出后终结、失败证据、宿主资源未结束/清理未知；domain-contract 的协作 AbortError 不伪造业务失败 |
| V09 | storage `startup.test.ts` 的 Run 开始/投递代际原子提交前后；`storage.test.ts` 的退出和资格见证真实进程崩溃；Check/Probe `restart.test.ts` 的 started stopped、不重演和 unstarted 新尝试 |
| V10 | `event-binding.test.ts` 的同一 Run 退出分别投影多 Task 同一源序；HTTP `contract-v4.test.ts` 的单见证双成员完整封装；storage 资格崩溃测试复原历史成员而非当前终态 |
| V11 | Engine/storage `catalog.test.ts`、`execution-catalog.test.ts` 的冻结成员/摘要/时间、完整 5000 成员扫描、签名/授权/域/过期/字节预算错误 |
| V12 | HTTP `http.test.ts`、`contract-v4.test.ts` 的显式 fromRevision、重连、撤销权限及慢消费失败；UI `integration.test.ts` 的断开不取消及连接容量 |
| V13 | HTTP 双成员封装与超限错误 lastCompleteRevision；UI `collection-v4.test.ts` 的整包原子应用/重投/残帧和完整分页基线；SQLite 见证崩溃后补读先重现 joined/running，再重现 recovery/stopped |
| V14 | Engine `catalog.test.ts` 的 progress 仅更新 Run、按最后源序取 updatedAt；protocol/Engine 无新资格 tick 不追加见证；HTTP 拒绝时间推导条件；UI 原始同源成员键 |
| V15 | HTTP 十二操作与消息、server 真 HTTP/CLI、Check 完整业务回归、Probe 独立 Run 环境/证据、UI 真浏览器/代理；生产 tarball 验证入口 `pnpm pack:check` |
| V16 | Engine `engine.test.ts` 的 recurrence 拒绝、外部 series 不互相撤回；storage `format.test.ts`、`facts-v4.test.ts` 的旧文件/sidecar 字节保留与新域；UI 新 ID 重做及观察断开不取消 |
| V17 | protocol 资格最小反例；Engine 查询未处理→见证→回拨；storage `storage.test.ts` 新增两次真实 qualification 提交前/后崩溃，回拨至 5 后恢复及双成员完整历史补读；HTTP/CollectionReplica 跨层封装 |

## Schema Equals 偏差与修复

先前将“原 Input”误解为全 JSON canonical，并同步修改了 guide/测试，属于未获契约授权的偏差；
测试通过只证明错误候选自洽，不证明旧 Schema 共识已被撤销。本次由主 Agent 明确要求恢复。

预约调用绑定类型的 generated Equals；事实 Binding 保存原 inputSchema，并在 Engine 启动时对照注册契约核验。
历史分组只调用同一个 schema 编译器导出的 equivalenceKey，复用 Equals 原有 projection/serializer；
输入仍是原 Input，不是 Prepared。key 不落盘，不形成独立权威，可由绑定 Schema+原 Input 重新计算；
有限编译器缓存可丢弃。requestId 的完整原始 Request canonical 冲突检查不变。

### 本次反例与验证（修复后）

复用 `packages/task-protocol/test/sharing-fixtures.ts` 的八组输入/Schema：
允许但未声明 extra、明确声明 extra、嵌套本地引用、schema-valued 字典
（被声明值不同不共享、未声明嵌套 extra 不同仍共享），以及嵌套 allOf/anyOf/oneOf。
组合比较覆盖未命中验证分支的声明结构，不能降为“任一分支相等”。

- `schema.test.ts` 验证 generated Equals 与同编译器 equivalenceKey 一致及重新编译可重建；
  原有非法输入上的独立判等、引用、字典、预算、组合测试均保留，不另写判等器。
- `qualification.test.ts` 在冷 source replay/克隆 Facts 上检查匹配；注入任意同名 key 不能改变结果。
- Engine `schema-sharing.test.ts` 检查同时预约、已有 Run 加入、原 Input 保留、完整 Request 幂等冲突、
  单体历史、按 runId 的目录/集合补读及恢复裁决。MemoryStore 源复制会产生新域，
  原域 revision 必须拒绝；只在测试显式映射复制源序后核验同一历史，未放宽生产域边界。
- SQLite `facts-v4.test.ts` 实际关闭/重开文件，按持久 Schema 与原 Input 重建相同匹配和原域 revision。
  没有持久 equivalenceKey、权威 Prepared 或第二套比较规则。

| 层 | 修复后实际命令 | 结果 |
| --- | --- | --- |
| 定向 protocol | `pnpm --filter @potential-guide/task-protocol exec tsx --test test\schema.test.ts test\qualification.test.ts` | **exit 0，31/31** |
| 定向 Engine | `pnpm --filter @potential-guide/task-engine exec tsx --test --test-concurrency=1 test\schema-sharing.test.ts test\discovery.test.ts` | **exit 0，12/12** |
| 定向 SQLite | `pnpm --filter @potential-guide/task-engine-storage exec tsx --test --test-concurrency=1 test\facts-v4.test.ts` | **exit 0，12/12** |
| 测试类型 | `pnpm exec tsc -p tsconfig.test.json --noEmit --pretty false` | **exit 0** |
| 八包 | `pnpm exec turbo run lint typecheck test`，显式筛选八个 workspace | **exit 0，38/38 tasks，338/338 tests**；protocol 34、Engine 141、storage 40、HTTP 14、server 10、Check 20、Probe 19、UI 60；12 个缓存，1m48.115s |
| 全仓 | `pnpm check` | **exit 0**；build/layers、format、lint、typecheck、test、pack:check 完成；全仓 test 68/68 Turbo tasks、脚本测试 42/42，18 类真实生产 tarball/独立消费者验证全部通过 |

本次先修复抽出 equivalenceKey 后闭包内 Schema 类型未保持收窄的编译失败；
新增跨域复制测试最初误用原域 revision、SQLite 比较最初误用 fixture 域，均只修正测试域前提，
没有放宽领域隔离或状态断言。新增测试的 unsafe optional chaining lint 也已修正。
这些失败试跑不计为通过；最终定向、八包证据见 `.cache/schema-targeted-*.log`、
`.cache/schema-eight-quality.log`。本次全仓最终输出为 `.cache/schema-final-check.log`，
实际运行句柄 `schema-final-check` 已读取至 **completed exit 0**，没有重复启动已有运行，
不复用旧 `.cache/task-engine-final-check.log`。修复后未发现此精确缺陷的剩余失败项；
该结论不替代主 Agent 的 primary 整合或 Outer 验收，也不扩大到新 TaskBundle Idea。

补充协调检查：`silvermoon check --worktree --audience agent` **exit 1**，
但 `candidateSnapshotValid: true`；唯一报告为相对于本地已 fetch 的
`origin/main` `ed0c4bc07599b2faef23065ea92186485890bbd5`，
当前旧基线尚缺新 Idea `01M6E9Z8MW0W9XBEJY0368HJBP`，报
`removing an integrated idea is not an event repair`。
这不是本次 Schema Equals 的测试失败，也不冒称 Silvermoon 全部通过。
按本次授权不合入、不复制新 Idea、不修改 events；由主 Agent 后续整合 primary 后重跑该检查。
日志为 `.cache/schema-silvermoon.log`。

## 主 Agent 独立复验与时序/关闭修复

主 Agent 安全 fast-forward 至 `ed0c4bc0` 后保留全部 dirty 候选，独立全仓检查 exit 1：
CLI import failure 约 3094ms 被 harness 杀死（`killedForTimeout=true`，预期 false），
Engine `registered environment is detached from subsequent author object mutation` 约 3046ms 失败。
两组原测试隔离复跑分别 4/4、5/5 exit 0，未把非恒定重现当作原失败不存在。

- CLI 原来把 Node/模块加载与真正失败后的退出混在同一 3000ms 计时中。
  fixture 在真实模块 import 阶段、已建立 ref'ed interval 后通过 IPC 发送包含 mode 的 armed 握手，
  由测试明确触发原 import/factory/rollback 错误路径。加载等待上界 30s，触发后自行退出上界 10s；
  仍严格检查未被 harness kill、signal=null、exit=1、各真实错误诊断以及没有 ready/closed，
  不修改 CLI 生产退出逻辑，不靠延长单个总等待替代真实路径证明。
- Engine environment 测试在真实 Worker 进入受控 prepare 后才修改作者对象，并显式释放 prepare；
  等待实际 work 与 running 事实成立，不用两次固定 flush 猜测 Worker 已完成加载。
  同文件 timestamp/backpressure/wall 测试也等对应 outcome、资源回收或业务 work 的真实条件，
  使用 15s 有界条件等待，不更改产品 wall/health/shutdown 限额。
- 首次本轮全仓检查 `.cache/timing-final-check.log` 实际 **exit 1**：
  CLI/Engine 通过，但 UI `actual browser entry ignores delayed real favorites responses and paginates applied execution filters`
  关闭 Backend 超时；诊断为 allocations=[]、observer=1、Engine closing=false，
  是 HTTP stop 阶段仍持有安静 SSE，不能通过延长资源关闭预算掩盖。
  Server bridge 现在显式拥有 response reader：直接监听其自有 controller 取消 reader，
  并在 aborted guard 前接管 response body，保证迟到响应也进入 finally 的取消/解锁。
  不只依赖 Request 的下游 AbortSignal 传播去唤醒 pending read。
- 新增 `shutdown owns cancellation of a quiet SSE body even when request abort propagation is blocked`，
  对下游 abort 传播作确定性故障注入，验证真实 quiet SSE 可正常关闭；
  移除 bridge 自有取消监听的负对照实际 exit 1、15321ms、`shutdown_failed`，
  恢复监听后约 305ms exit 0。该证据证明取消所有权缺口，不声称已证明原高负载失败的全部底层触发因素。
- 正确 workspace cwd 定向：server CLI/server 11/11、Engine boundaries 5/5、UI workbench-races 2/2，
  均 **exit 0**。先前从 root 混跑 server import 副作用测试因子进程找不到非根依赖包 exit 1，
  已改回现有 `pnpm --filter ... exec tsx --test ...` 入口，没有安装或伪造根依赖。
  新 IPC stdio 的 nullable 类型检查问题也已补明确 pipe 断言。

上述变更不修改 Ideal、Outer、events 或新 Idea；相关 I-S02/I-S03/I-AC02/I-AC03 先重置，
完整检查完成后才勾回。定向日志 `.cache/timing-targeted-server.log`、
`.cache/timing-targeted-engine.log`、`.cache/timing-targeted-ui.log`；
负对照日志 `.cache/timing-sse-negative-control.log`。最新完整检查结果另记，不复用旧 pass。

### 本轮最终结果

`pnpm check`（句柄 `timing-repaired-final-check`）已读取至 **completed exit 0**，
完整日志 `.cache/timing-repaired-final-check.log`；build/layers、format、lint、
typecheck、test、pack:check 全部完成。全仓 test 为 **68/68 Turbo tasks**、
脚本 **42/42**；八包测试总数现为 **339**（新增 Server SSE 所有权反例），
18 类独立生产 tarball 消费全部通过。不是用定向通过替代全仓，也没有重复启动已有完整检查。

主 Agent fast-forward 到 `ed0c4bc0` 后，原先因新 Idea 缺失导致的 Silvermoon 历史检查问题已解除；
本轮 `silvermoon check --worktree --audience agent` **exit 0**（`.cache/timing-silvermoon.log`）。
相关四个 I 项在完整通过后勾回，六个 I 项完成，四个 D 项不变。
目前没有本轮已知剩余失败；保留主 Agent 再次独立验证，不推断接受、不提交或进入 Outer。

## Outer Chrome 发现后的 Inner UI 回修

主 Agent 独立完整检查 exit 0 后已同步候选 `31ba74b0`，Inner `51a9212036d4`
经 submit/accept，开始 Outer。Outer 计划 `e3fc4560` 已同步，但真实 Chrome 冒烟
`engine-outer-browser-9597c5bc-eb4b-468b-a3e2-ec52e9b6fbab` 在旧 fixture 约 L576
等待 Task“观察已结束”失败。该等待沿用旧语义；Task 的 Run 已终结不妨碍首次取消，
不能自动冻结 Task 观察。本次按明确授权回修 Inner，不写 Outer 或生命周期事件。

### 产品修正

- `browser.ts` 删除以 canceledAt / Run completedAt / failedAt / termination 冻结超时的 effectiveEnd。
  详情超时提示与三维 taskStatus 共用当前 `now`，不因取消或 stage 终结冻结；可随时钟回拨重算。
- 取消按钮仅在已有 canceledAt 时禁用，Run 终结不禁止 Task 的首次取消。
- 只有 termination 才展示“Run 已形成结局”；仅有取消事实时明确需求撤回不证明 Run 已退出，
  且提示继续观察 stage，避免把控制事实当作 Run 结局或资源回收证明。
- Run 观察仍遵循既有终结加回收规则，没有改 lifecycle 的 Run 结束判据。

### 新候选验证

- `browser-channels.test.ts` 通过真实 browser entry/回执/SSE 路径增加：
  已取消 running Task 后续变为 completed；终态首次取消按钮可用；取消后按钮禁用且不重复 POST；
  Run 在截止前终结/取消仍会随 now 跨截止显示 timeout，并能随 now 回拨回 eligible。
  本地时钟受控、等待预算采用 performance.now，不用墙钟冻结破坏测试边界。
- 定向入口：
  `pnpm --filter @potential-guide/task-engine-web-ui exec tsx --test test\browser-channels.test.ts test\lifecycle.test.ts test\workbench.test.ts`
  **exit 0，6/6**，日志 `.cache/ui-controls-targeted.log`。
- 原生 Chrome fixture 不再等待 Task 自动结束：
  等待明确 Task ID 的 completed，点击首次取消，检查结果/stage 不变、仅一个 task.canceled；
  对同 ID 重复取消验证 changed=false；等真实时间跨 deadline 验证终态取消后的 timeout；
  显式暂停后才检查 observation stamp 稳定。
  另建立同一 Run 的两个需求：取消一个后仍 running，另一需求未取消并保护 Run；
  原 Task 最终 canceled=true、stage=completed、同一 Run/结果，取消源事实仍仅一个。
- 完整 Chrome/156.0.8078.76 fixture **exit 0**：
  `.cache/engine-inner-ui-controls-ddaa0d6e-2df6-48a6-88e1-44d21528aca2/checks.json`，
  新增检查 terminalTaskStillObserved、terminalTaskFirstCancel、terminalTaskCancelOnce、
  taskTimeContinuesAfterTerminalCancellation、observationStoppedAfterExplicitPause、
  canceledTaskFollowsRun、sharedDemandSurvivesCancellation 全为 true。
  原有 native keyboard/focus、Run 自动结束、抽屉几何、390px、CSP 等检查完整保留并通过；
  新截图 `canceled-task-completed.png`，完整命令日志 `.cache/ui-controls-chrome-pass.log`。
  仅使用自有随机端口和新 profile，避开指定保留端口；结束后关闭自有进程，删除 profile 与临时收藏，
  截图和 checks.json 留存，不接触用户现有浏览器或服务。

以下 fixture 调试失败如实保留，均不计为通过：
首轮新条件在 detail 尚无快照时直接读 textContent；随后发现旧“最近查看”首项其实是外部 survey，
已改为明确 createdId 选取。抽屉比较又发现十二个目录 Run 尚在变化，改为逐个等待真实 completed/reclaimed，
仅目录布置使用 60s Request budget，避免几何检查与合法时间标签变化竞争；
原10s终态超时场景和内容/宽度/滚动断言未删改。新增标识定位最初未展开 details，
已改为原生点击展开、键盘输入和按钮点击。各失败目录保留原 failure.json/failure.png，
未覆盖成功证据或把失败说成验收成功。

三个 I-AC 先重置，完整新候选检查完成后才勾回；旧生产 pack 运行不替代本轮代码的验证。

本轮最终 `pnpm check` 已读取句柄 `ui-controls-final-check` 至 **completed exit 0**，
新日志 `.cache/ui-controls-final-check.log`。build/layers、format、lint、typecheck、
全仓 test 及 pack:check 全部完成，包含 UI 的完整 60 用例与所有18类独立生产消费者；
不是引用主 Agent 尚在运行的旧 pack，也没有重启重复完整检查。三个 I-AC 此后才勾回。
原生证据目录内 `.profile` 与 `.favorites.json` 均已确认不存在，截图与 checks.json 保留。
本轮只改 UI browser、直接回归、browser-smoke 及 Inner/ledger，不修改 Ideal、events、
Outer 计划或旧 Outer 失败证据；不提交或推送。已接受的旧 Inner revision 不代表此新候选已接受，
仍由主 Agent 对新 implementationRevision 重新 submit/acceptInner，再继续 Outer。

## Outer 列表文本不变量误判：仅修 fixture

主 Agent 已同步 `59643dbb`，新 Inner `fd81e6762dce` 重新 submit/accept 后，
Outer 计划 `1cdf67c4` 的 Chrome 在 browser-smoke 约 L683 再次失败。
原始证据 `.cache/engine-outer-final-4c6a25ae-465c-44a4-b556-bd90cf47f399` 保持未改：
sameContent=false，但宽度前后均1383、滚动前后均100，drawer right1440/width630/viewport1440。
这不足以证明详情打开破坏列表。核对产品代码发现 renderDirectory 合法展示实时连接状态、
全域 revision 和按 now 推算的时间标签；分页完成后 monitorDirectory 异步接入流，
旧 fixture 仅等十四行就抓整段 textContent，没有等待完整实时基线，且错误禁止合法文本更新。

本轮没有修改 browser.ts、model、presentation、服务或生产包：

- fixture 等完整分页与“完整实时集合”就绪，再通过原生键盘录入未应用过滤草稿。
- 记录真实 Backend GET /tasks 的 URL/query 请求序列，详情前后必须完全相同；
  不是只检查表单值，也不把用户未应用的草稿当作已应用查询。
- `fixture/directory-invariants.ts` 精确比较成员 ID/key 及顺序、四个过滤控件的值/checked、
  宽度和滚动；原生 Chrome 额外比较所有行及过滤控件的 DOM 对象身份。
  drawer 几何、模态单层、关闭后焦点、用户草稿及后续滚动断言仍保留。
- 在详情已打开时，由另一个可信调用者首次取消已终结的 external Task，
  必须观察到该行“已取消”的真实源增量，且所有上述结构不变量仍成立。
  两次最终运行均为 sameContent=false；这现在是预期的合法状态更新诊断，
  并新增 drawerAllowsLiveStatusUpdates=true，不能通过冻结流或吞掉源事件取巧。
- 精准单测验证仅文本/状态/时间/revision 展示变化可通过，十组 query 增减、
  成员替换/删除/顺序/key、草稿/checkbox、滚动/宽度变化必须抛错，
  没有简单删除“不变”要求。

第一次新 Chrome 的上述抽屉检查均通过，但后续既有 shared-Run 场景失败：
`.cache/engine-inner-drawer-invariants-6ee70b8e-112b-4816-90d9-539851d5c9c6` 的
failure.json 显示精确目标 Task 已 completed，5秒业务运行在 UI 操作前就结束了，
不是查询错对象或产品拒绝取消。没有原样重试掩盖。
现仅在 smoke 使用 `fixture/smoke-worker.mjs` 包装原示例类型，对指定测试输入走
fixture 专用 Resource 握手，保持 Run 直到 UI 取消确认后才显式释放；
companion 需求保护共享 Run，随后正常结束。finally 也释放 gate，所有观察仍有上界。
不用更长固定 sleep 猜测运行窗口，不修改产品运行/取消规则。

### 本轮实际验证

- UI 定向：
  `pnpm --filter @potential-guide/task-engine-web-ui exec tsx --test test\directory-invariants.test.ts test\collection-v4.test.ts test\rows.test.ts`
  **exit 0，12/12**；日志 `.cache/drawer-fixture-targeted.log`。
- format 检查、UI `lint`、UI `typecheck`、`pnpm exec tsc -p tsconfig.test.json --noEmit --pretty false`
  均 **exit 0**；lint 有 warnings，无 errors。日志 `.cache/drawer-fixture-lint.log`、
  `.cache/drawer-fixture-typecheck.log`、`.cache/drawer-fixture-test-types.log`。
- 在最终代码不变的同一执行中，两个不同全新 Chrome/156.0.8078.76 profile
  **连续完整运行，两次 exit 0**，不是挑选若干重试成功：
  1. `.cache/engine-inner-drawer-invariants-0f33dbfb-9fe2-42e6-a05d-208b7af8a5e9/checks.json`
  2. `.cache/engine-inner-drawer-invariants-b2d4f5f0-a5cd-4d19-8e02-5b2ca5460fb2/checks.json`
  日志 `.cache/drawer-verified-chrome-1.log`、`.cache/drawer-verified-chrome-2.log`。
  两次 drawerAllowsLiveStatusUpdates、drawerPreservesQuery、drawerPreservesMembersAndOrder、
  drawerPreservesFilterDrafts、drawerPreservesRowAndControlIdentity、drawerPreservesList 均 true；
  两次宽度1383→1383、滚动100→100、sameContent=false，且 canceledTaskFollowsRun=true。
  既有 terminal cancellation、Run 结束、键盘/焦点、窄屏和 CSP 全套仍通过。
- I-AC02/I-AC03 在上述验证后勾回。不重跑全 pack，不修改正在运行的主 Agent pack，
  不拿旧全仓通过冒充本次重新执行；产品文件和生产包未变。
  本轮只修改 fixture、精准测试和 Inner/ledger，不改 Outer/Ideal/events，不提交或推送，
  由主 Agent 按新 implementationRevision 再次门禁。

## 改动范围与实际边界

- 八包：task-protocol 的 v4 事实/投影/形状；task-engine 的协调/Worker/观察/目录及 fixtures；
  task-engine-storage 的来源核验/窗口/签名密钥；task-engine-http 的十二操作/SSE；
  task-engine-server 的组合关闭预算；Check 的可信整体容量；Probe 的独立 Run/环境/大观察证据；
  task-engine-web-ui 的三维/源序/完整集合/错误控制帧及直接测试。
- 直接配套：各包 README、`docs/task-engine.md`、`docs/task-server.md`、
  `examples/task-server/README.md`、`probe-integration.mjs`、`scripts/check-mvp-consumer.mjs`；
  Inner 三篇支持/契约文件及最终 ledger。未改旧 host/pilot/regulator/coordinator、收藏产品逻辑、
  通用资产、其他 Idea、已接受 Ideal、Outer 或生命周期事件。
- 外部可执行入口：仓库根 `pnpm check` 为完整检查；`pnpm pack:check` 为真实生产 tarball 安装与
  独立消费（包含 packed Probe、MVP server/Check、HTTP/SSE、SQLite 恢复、实际资源清理）。
  子域复核可直接运行表中的各 `pnpm --filter ... exec tsx --test ...` 命令。
- v4 是显式破坏性格式边界，不提供旧库迁移/删除或域连续性假象；旧客户端须更新政策名、SSE 锚点、
  Task/Run 历史分离及取消后仍推进的状态。尚在窗口内的 Request 凭据可能长于 Task 明细保留。
- 隔离 Worker 不是 OS 安全沙箱；外部副作用和未知清理不因重启/强杀变成“已回收”，
  资源证明不足时保留未知/租约并明确失败，需可信组合外部核验。
- 单源封装、慢消费者、完整基线和 UI 缓存均有公开有限预算；超限需显式刷新基线或调整允许预算，
  不承诺任意规模 fan-out，也不以残缺数据冒充完整集合。initial+eligible 不承诺墙钟到点同步调度。
- 未修改全局测试并行度或默认语义预算，未放宽新契约结果断言；旧语义断言按新契约迁移，
  不删测试逃避，UI fixture 的可靠等待针对真实退出/reclaimed。
  八包验证过程中曾出现 UI 清理超时和 Server 测试文件异常退出，不能倒推当时通过；
  后续以最终八包和完整全仓命令的实际退出结果为准，不把隔离复测当全套通过。
