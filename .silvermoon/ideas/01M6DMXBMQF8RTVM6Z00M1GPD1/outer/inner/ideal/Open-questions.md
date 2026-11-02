# 准备阶段未决问题

本文件服务于 [Idea](Idea.md) 及[契约差异](Contract-audit.md)。
以下是精确待定边界，不重问已确定的三维状态、唯一匹配、Worker 退出终结、单调窗口下界、
统一事件 revision 或禁止 Task 批量权威状态的规则。建议不等于决定；未决项不能由创建授权、
旧 Idea 授权、测试通过或本次文档同步自动关闭。

## 已检查的讨论及适用性

- [早期接口的分页与保留规则][old-interfaces]：已有冻结历史上界、域/条件绑定游标、慢消费者有界、历史过期显式失败；
  窗口数值留待实施验证，没有新的 ULID 准入下界边界定义。旧取消冻结、recurrence 与 Execution 绑定解释已被新契约替代。
- [任务目录调研的查询细节][old-catalog]：已讨论创建/更新时间、半开时间区间、稳定排序、轻量摘要；
  明确新进度算更新，并曾排除已取消 Task 的后续进度。该规则须与本轮“Task 不含 progress、取消不冻结”重新核对。
  具体限额和数据结构当时留给实施，旧授权不转移到本 Idea。
- [Schema 发现方案][old-schema]：实际可提交类型、版本、输入 Schema、修订前置条件；
  复用 submit 权限，不自动新增逐类型 ACL。不能因新职责表没列出发现就删除既有能力。
- [TaskType][old-type] 与[运行消息][old-messages]：Input/Result/messageSchema、Never=false、Task 归属与可信 Caller、
  入队不等于接纳、失联保留 unknown、禁止复活 Run 等已讨论。多 Run 共用类型 Worker 和旧未匹配消息路由前提
  不能覆盖本轮单 Run 可终止及即时推导匹配规则；Regulate 示例不构成已确定业务协议。
- 会话历史工具未找到本仓库可用记录；不声称已检索到未落盘的完整对话。上述结论来自已提交讨论和本次用户交接。

## Q01：同一源 revision 的多个成员如何完整交付

关联 B5/C5、X07/X08/X10、V13。新[集合观察][observation]与[订阅][subscription]已明确：
同一源事件可影响多个成员，沿用一个 revision，从最后**完整处理**的源事件后续读，不为 query 保存独立历史。
但尚无识别“R 的全部变化已交付”的公共形状。

待定：采用一个源事件的完整交付封装，还是可分片的成员变化加明确完成边界？
后一种需说明稳定成员身份、重投去重与何时允许推进 fromRevision；前一种需说明超大扇出如何有界交付/失败。
无论选择哪种，都不是把多 Task 状态变成批量写事务，也不能只按 revision 去重丢成员。
建议先确定完成边界和超限语义，再在实施期选择具体传输编码；不在此擅自增加第二个领域 revision。

## Q02：时间派生筛选的集合订阅支持范围

关联 B4/B5/C4/C5、X08/X10、V03/V13/V14。[观察契约][observation]明确纯时间不发事件，
并明确支持范围待定；当前 TaskQuery 只有类型/Run/创建与更新时间，未提供 pending/eligible/timeout 筛选。

待定：首轮是否只支持事实字段的服务端集合订阅，并明确拒绝时间派生筛选；
还是支持客户端在完整候选集合及时间边界上重算成员？
若选客户端重算，还需确定候选集合覆盖范围、冻结分页观察时间和实时“now”切换，
保证尚未在结果中的 pending Task 能在没有事件时加入。不能只给已有成员设定时器就宣称完整。
建议首轮只承诺事实筛选订阅，时间标签仍按 now 展示；这是候选产品边界，尚未接受。

## Q03：公共观察形状与取消结果的剩余语义

关联 A2、B1–B5、C1–C5、V04/V10–V12。新签名明确是逻辑草案，命名/异步/传输不要求照抄；
旧 snapshot 没有域水位，旧 Page 使用 tasks/runs/events，旧订阅混合 snapshots 和 events。

待定的不是方法拼写，而是：单体 TaskEvent 是否仅表达该 Task 可见事实的派生变化、RunSnapshot 的最小事实范围、
Task/Run 摘要及错误结果的必需信息；哪些事实变更触发摘要更新须有完整清单（与 Q05 对齐）。
三维快照必须能表达 canceled 与 completed/failed/stopped 共存，不把展示标签作为状态。
另一个可观察分歧：新生命周期允许 canceled 与终结 stage 共存，但未明确**先终结、后取消**的 A2 是记录撤回还是返回已终结错误；
旧实现直接 task_finished。需确定该顺序及重复取消的结果，不由旧行为推定。
建议保留身份、事实时间、三维依据、查询水位，结果/progress 仍按单体与集合职责分层；具体类型在上述语义收敛后细化。

## Q04：窗口、限额和等待时限

关联 X04/X05/X09/X10、V01/V07/V11/V12。既有讨论已选择“有界、错误显式”，没有给新契约提供全部数值。
下表仅是核对快照的实现现值，**不是批准的新默认值**。

| 参数族 | 当前依据/数值 | 尚需确定 |
| --- | --- | --- |
| ULID 准入 | 无窗口与未来偏差参数；仅格式检查 | 窗口长度、未来偏差、上下界含等号规则；配置缩紧后的下界只进不退已经确定 |
| 保留 | [engine.ts][engine] L96–114：retentionMs=86,400,000；collect 是显式能力 | 事实/幂等/补读所需信息各自保留窗口，记录不可提供时的明确错误；不新增清理产品 |
| 页/视图 | pageSize=100、scan=10,000、pageBytes=65,536、views=64、viewBytes=8,388,608、lifetime=60,000ms | 默认与上限、续页能否改 limit、历史与集合超限处理统一；新输出形状的字节成本需再测 |
| 运行/停止 | executionWallMs=60,000、tickMs=10；[engine.ts][engine] L1380–1420 硬编码 5,000ms 只等待清理 | 协商停止宽限、强制退出确认期限及无法确认的错误；不要将业务 wall 或心跳时限冒充停止宽限 |
| 订阅/通道 | subscriptions=128、payload=65,536；[engine.ts][engine] L309–315：heartbeat=100ms、health=5,000ms、inFlight=64 | 补读/实时/多成员扇出/慢消费者预算、重投与断流恢复；不可用静默截断 |
| HTTP/服务关闭 | [HTTP][http] L161–164：poll=100ms、请求并发=128；[Server][server] L103–107：shutdown=10,000ms、requestTimeout=30,000ms、连接=256 | 新长流和独立 Run 退出的预算映射，区分正常取消与宿主关闭 |

需要先明确哪些是产品承诺、哪些允许宿主配置并在实施期实测定值。
建议沿用已验证的分页/容量现值作为待测起点；新增准入窗口和停止等待不猜数值，也不把全部窗口合成一个 retentionMs。

## Q05：Task 的 updatedAt 是否仍被 Run progress 更新

关联 B2–B5、X02/X08、V14。[旧目录讨论][old-catalog]明确进度算 Task 更新，
目前 [projection.ts][projection] L279–294 和 [catalog.test.ts][catalog-tests] L113 将其用于筛选，
并排除 canceled Task。新契约明确 progress 只在 Run，Task 取消后 stage 仍跟随 Run。

待定：Task 摘要的 updatedAt 是否仅表示 Task 可见事实（创建/匹配/取消/Run stage/结果）改变；
Run progress 不再推动 Task updatedAt，而留在 Run 观察中？
若仍计入，须明确这是摘要可见变化以及为何不违反 Task 粒度，不能既称“Task 无进度影响”又暗中改变集合条件。
建议前者；无论选择哪种，时间流逝与读取不制造更新时间/事件，不恢复旧取消冻结。

## Q06：职责表之外的现有能力如何归属

关联 A1、B2、C1、V15/V16。当前 TaskService/HTTP 还有 discoverTypes、getRequest、
sendTaskMessage/getTaskMessage；宿主注册是初始化配置。新职责表只列 12 项操作，不能由遗漏推出删除。

建议保留类型发现、原始 Request 读取及通用 Task 归属消息作为明确配套边界，补充它们与职责表的关系；
不新增类型自授权、资产发现或 Regulate 业务含义。待确认它们是否纳入本轮对齐验收，以及注册/发现的版本范围：
旧 draft 的单当前版本方向与旧清理 Idea 不是本轮删除旧解释器或数据的授权。
既有消息幂等、Never、可信 Caller、接纳/unknown 约束保留为核对依据，
但必须重新审视停止/退出后路由和即时匹配；不借通用消息实现 Regulate。

直接消费者不能漏接：Probe 目前从 Task history 的 run.started 读取真实环境，
新分层后须提供独立 Run 查询/历史与最小核验字段；不能删掉安全/业务证据核验。
原参数重做只创建新 Task；收藏仍由其他会话负责。

## Q07：已有数据域如何进入新事实契约

关联 X01/X03/X04/X06/X07、V01/V09/V16。当前 SQLite v3 保留 Task snapshot、task.run.bound/task.terminated、
旧 matchPolicy 与可能的 recurrence；[projection.ts][projection] L24–45 对不支持的格式要求另用存储。
新契约要求稳定数据域、跨重启事实、窗口下界和不重演旧 Run，却未指定旧持久数据的迁移/拒绝策略。

待定：需要显式、可验证的旧事实迁移，还是允许新版本对不支持格式明确拒绝并由用户另行选择新数据域？
新域不是旧域重启；不能据此声称原历史连续。缺失的新边界事实不得凭当前时间补造，
不能重解释旧 canceled/completed 记录来伪称符合新契约。
无论选择哪种，默认保留旧数据且不删除、不自动迁移、不自动重跑；此处不实施清理工具或兼容双轨。

## 准备状态

- 已完成只读核对：12 项操作、10 篇跨操作契约、八个 workspace，建立 V01–V16 验收索引。
- Q01–Q07 尚未收敛；其中接口命名等普通实现细节不单独阻塞，实质语义与范围需要明确。
- 当前不能声明 Ideal 就绪；保持 preparing，尚不记录 submitIdeal，不请求 acceptIdeal，不进入实施。
- Implementation/Deployment 是原有轻量种子，ledger 全部未勾选；没有执行或验收这些步骤。
- 本轮本地链接及锚点检查通过，操作/契约/场景/问题编号检查通过，`git diff --check` 及 `silvermoon check --worktree --audience agent` 通过。未增加验证框架。
- 本轮在隔离 worktree、源码仍为核对快照时运行 `pnpm check`，退出 1，停在 task-engine test：117 项中 112 通过、5 失败；
  失败位置为 [boundaries.test.ts][baseline-boundaries] L99、[discovery.test.ts][baseline-discovery] L199、
  [engine.test.ts][baseline-engine] L23/L105、[projection-races.test.ts][baseline-races] L171。
  输出包含数量/结果不符及 fixture 缺少预期运行的断言；尚未诊断根因，不归因为本次文档，也不声称只是偶发时序。
  后续完整 test/pack 检查未完成；此前 Web UI reclamation_failed 报告也不因此视为已解决。
  本轮不修改或放宽旧测试，实施前须重新确认必要基线并区分旧语义断言与真实故障。

[old-interfaces]: ../../../../01M63AFYJEDXZ8PFZQQVZC1W02/outer/inner/ideal/interfaces.md
[old-catalog]: ../../../../01M66TPNEMSQ8Y8SDSN2CDN6BA/outer/inner/ideal/Research.md
[old-schema]: ../../../../01M66MRFCSDK99MAEN8RN3NKBH/outer/inner/ideal/Research.md
[old-type]: ../../../../01M67XYR798HDDWP6A41CPD5MQ/outer/inner/ideal/TaskType.md
[old-messages]: ../../../../01M67XYR798HDDWP6A41CPD5MQ/outer/inner/ideal/Messages.md
[observation]: ../../../../../../docs/axis/task-engine-contracts/observation.md
[subscription]: ../../../../../../docs/axis/task-engine-contracts/subscription.md
[engine]: ../../../../../../packages/task-engine/src/engine.ts
[projection]: ../../../../../../packages/task-protocol/src/projection.ts
[http]: ../../../../../../packages/task-engine-http/src/index.ts
[server]: ../../../../../../packages/task-engine-server/src/index.ts
[catalog-tests]: ../../../../../../packages/task-engine/test/catalog.test.ts
[baseline-boundaries]: ../../../../../../packages/task-engine/test/boundaries.test.ts
[baseline-discovery]: ../../../../../../packages/task-engine/test/discovery.test.ts
[baseline-engine]: ../../../../../../packages/task-engine/test/engine.test.ts
[baseline-races]: ../../../../../../packages/task-engine/test/projection-races.test.ts
