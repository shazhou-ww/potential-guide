# 匹配资格的时间观测边界：已实现，待 Inner 接受

本文件服务于 [Implementation](Implementation.md)。2026-11-02 主 Agent 依据用户明确授予的自主设计与门禁职责，
选择持久资格时间见证；这不是用户逐条回答，不可用的交互也不构成选择证据。
定义冲突已决，不再是等待普通实现许可的问题；但这是实质澄清，已写入 Ideal 的
[Q08 决策](ideal/Open-questions.md)。准确 Ideal `564f6709fc0c7c2d152777520b7a9cf49d7aeb94`
已由主 Agent 完成 submitIdeal/acceptIdeal，并在接受提交
`616cc7cf9e12918cc60f06b0bccf786b8dd8c8a9` 同步后继续实施。
代码、完整验证及 V17 真实崩溃/历史集合补读证据见 [事实模型实施证据](Fact-stage.md)；
完整 `pnpm check` 已退出 0，I-* 按完成勾选、D-* 未勾选；这不等于 Inner 已接受。

## 已决边界

- pending/eligible/timeout 越界本身仍只是独立时间推算；GET 不写领域事实，
  没有新资格的 timer tick、心跳和重复处理不生成事实。
- 协调器实际处理尚未匹配且可处理 Task 的新资格时，优先使用真实 Run 开始或其他已能证明资格的源事件。
  只有既有事实不足时，才提交一次数据域级 `qualification-time-observed`；
  其领域载荷仅有 observedAt，不含绑定、所选 Run、Task 状态或受影响 Task 列表。
- 额外见证位于相关 Task 受理与 Run 开始之后；结合源序前后事实、可信观测边界及严格开始顺序，
  推导唯一最早匹配。新对象不能借旧见证，历史也不能按 Run 当前状态重配。
- `initial + eligible` 可以持续到协调器处理；不再承诺墙钟到点同步完成匹配。
  已成立匹配不因 now 或终结墙钟回拨、重启而撤销；时间标签仍按当下 now，取消维度独立保留。
- 资格成立与停止流程互斥；已取消 pending 不新增匹配。
  单个见证可能影响多个 Task，沿用同一源 revision 形成单体与集合的全部派生变化和完整封装，
  不新增每 Task 权威事实/缓存，不往已消费的旧 revision 追加成员。

这是对旧“纯时间不产生事件”的限制性澄清：独立时间标签无事件，实际协调资格观测有源事实；
不能称为文字与语义完全未变。具体规范以
[匹配](../../../../../docs/axis/task-engine-contracts/run-matching.md)、
[revision](../../../../../docs/axis/task-engine-contracts/revision.md)、
[生命周期](../../../../../docs/axis/task-engine-contracts/task-lifecycle.md)、
[观察](../../../../../docs/axis/task-engine-contracts/observation.md)、
[订阅](../../../../../docs/axis/task-engine-contracts/subscription.md)及
[恢复](../../../../../docs/axis/task-engine-contracts/persistence-recovery.md)为准。

## 原反例如何闭合

同域同 Input 的 R 已运行，由 B 保持需求。A 在 0 受理，eligibleAt=10、deadlineAt=60，
policy=terminates-after-eligible；初始源水位 S，筛选 stage=running 或 runId=R 的完整基线只有 B。

| 边界 | 新决策下的结果 |
| --- | --- |
| now=10，仅 GET，未协调 | A 仍 initial/canceled=false/eligible，水位仍 S；没有查询写事实，也没有要求订阅凭空发现 A |
| 协调器实际处理，既有事实不能证明资格 | 提交见证 W，载荷 observedAt=10；截至 W 的事实证明 A 的资格，唯一匹配 R，A 进入 running |
| 从 S 补读 W | 单体历史/订阅和集合完整封装都沿用 W；包含 A 及同源全体受影响成员，不能按 revision 丢成员 |
| 再次 tick/GET/心跳，没有新资格 | 不追加见证，不把时间水位做成 tick 日志 |
| now 回拨至 5 | 事实前缀已经包含 W，故 A→R 仍成立；stage=running、canceled=false、时间 pending |
| R 后续终结墙钟为 5 | 保留既定匹配，按实际 Run 结局推进 stage，不以较小时间重新筛掉 R；时间仍 pending |
| 重启时 R 没有可靠终结事实 | 重放 W 及当时前后边界重建 A→R，R 按 stopped 恢复、A 跟随 stopped，时间 pending；不重跑，不假称物理退出或回收 |

没有经历资格处理的 S 前缀与经历处理后的 W 前缀已经不同，故不再依赖不可恢复的内存匹配缓存区分历史。
真实源事件已经证明资格时不额外写见证；pending 已取消、停止先成立、后来才受理/开始的对象均不能借见证获得非法匹配。
完整验收矩阵见 [Contract-audit 的 V17](ideal/Contract-audit.md#v17资格观测最小反例与反向边界)；
当前已实现资格源事实、回放及完整封装；最终验收索引与实际结果见实施证据。

## 执行状态与证据边界

- 撤回旧草稿及 Worker 检查点属于接受 Q08 前的历史，不再代表当前源码。
- 当前 `qualification.test.ts`、`domain-contract.test.ts` 与 SQLite `facts-v4.test.ts`
  分别证明纯源序资格、真实 Engine 的 initial+eligible→协调→回拨，以及见证的落盘重开。
  测试命令、实际结果及未完成边界集中记录在 [事实模型实施进展](Fact-stage.md)。
- 不修改已接受 Ideal 或 Outer，不把本文件当作第二份规范；生命周期与 Git 同步仍由主 Agent 负责。
