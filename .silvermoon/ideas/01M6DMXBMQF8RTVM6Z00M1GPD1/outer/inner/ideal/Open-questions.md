# 准备决策

本文件服务于 [Idea](Idea.md) 及[契约差异](Contract-audit.md)，沿用文件名与 Q01–Q08 编号以保持追踪。
Q01–Q07 保留既定结论；2026-11-02 新增 Q08，作为需要重新验收准确 Ideal 的实质澄清候选。
Q08 由主 Agent 依据用户明确授予的自主设计与门禁职责选择，不是用户逐条回答；
不可用的交互不构成选择或决定证据。本文件不是生命周期验收、实施证据或删除授权。
旧核对快照中的“待定”不再是实时阻塞；以本文件及同步补齐的职责/契约为准。
数据域独占、三维状态、唯一最早匹配、停止互斥、Worker 退出终结、不重演、单调准入下界、
全域源事件 revision、冻结分页与 fromRevision 补读保持不变。

## Q01：同一源 revision 的多个成员如何完整交付

**决定：每个源事件使用一个完整集合变化封装。** 封装包含源 revision 和该事件对当前订阅产生的全部成员变化；
每项带实体标识、加入/更新/移出种类，加入/更新携带新摘要。成员标识在同一封装中唯一，顺序稳定。
无匹配变化的源事件不必发送；封装不是新的领域事件，不分配第二个 revision，也不要求多 Task 权威状态批量事务。

消费者验证并完整应用整个封装后才能推进 fromRevision；中途断线不推进，重连允许重投整个封装。
以完整源封装去重，不能在处理第一个成员后按 revision 丢掉其余成员。
超出成员数或编码字节预算时，发送任何该源事件的部分变化之前显式终止订阅，
报告容量超限和最后完整交付位置，不截断、不静默跳过。超限不能靠原预算下无限重连解决：
可增大配置、缩小事实筛选范围，或重新取得完整分页基线；不能假称旧锚点已消费成功。
对应 B5/C5、X07/X08/X10、V10/V12/V13，规范见[订阅][subscription]。

## Q02：时间派生筛选的集合订阅支持范围

**决定：首轮服务端集合查询与订阅只接收事实字段条件。** 包括身份、类型、scope/series、匹配 Run、
事实 stage、canceled、创建/更新时间及其明确区间；每类实体只接受其适用字段。
时间区间采用下界包含、上界不含；条件缺省表示不限制，未知或不适用字段明确拒绝。
查询支持的事实筛选同样可用于对应集合订阅；排序仅控制查询页序，不改变集合成员事件的源顺序。

pending/eligible/timeout、相对 now 的年龄、UI 聚合标签等派生筛选明确报告不支持；
不隐式降级成部分候选集合，也不在服务端增设到点事件。
快照/摘要提供时间边界和观察时间，UI 可对完整事实候选集本地展示时间标签；
不承诺按时间派生标签过滤后的服务端完整集合。对应 V03/V13/V14，见[观察][observation]。
Task stage 与匹配 Run 以 Q08 的已提交资格边界为依据，不能由 GET 的原始 now 自行新增匹配；
因此继续保留这两类事实筛选，不改成客户端发现缺失成员的时间重算方案。

## Q03：公共观察形状与取消结果的剩余语义

**决定：按事实分层，终态后取消仍记录撤回需求。**

- 快照至少包含实体身份、数据域归属、查询 revision 与观察时间。Task 提供原 Request 定位、
  receivedAt/effectiveEligibleAt/deadlineAt、stage、canceled、唯一匹配 Run 标识（如有）及结果/失败依据（如有）。
  不另存时间状态，不把 UI 标签或回收结论替代事实。
- Run 快照提供类型/匹配身份、严格开始顺序及开始时间、stage、进入停止流程与 Worker 接纳的区别、
  可靠结果/失败、终结时间及其正常退出/恢复裁决依据（如有）、资源回收的已知或未知状态。
  progress 和完整业务载荷留在单 Run 层；Probe 经 Run 标识读取独立 Run 历史核验实际环境。
- TaskEvent 只表达该 Task 可见的创建、取消、匹配成立、关联 Run stage/结果变化，沿用源 revision；
  Run progress 载荷本身不成为 TaskEvent。独立时间推算和读取不产生事件；
  实际新匹配按 Q08 由证明资格的源事实产生派生变化。
- Task 摘要包括标识、类型、scope/series、创建/更新时间、时间边界、stage、canceled、匹配 Run；
  Run 摘要包括标识、类型、scope、开始顺序与时间、更新时间、stage、停止流程及终结依据。
  摘要不含原输入、完整结果、progress 或消息载荷；详情从单体入口读取。
  资源回收结论若作为摘要公开，则其事实变化同样必须触发更新，不能产生不可观察的摘要变化。
- 对仍保留的已知 Task，首次取消无论其是否终结都设置 canceled 并持久记录一次撤回事实；
  已终结 Run 不再停止。重复取消返回“已取消”，不新增事件或 revision；不存在/详情不可提供明确报错，
  不借取消创建对象。首次和重复结果均返回 Task 标识、是否本次改变及一致查询水位，
  不把“请求已接纳”写成 Worker 已停止或资源已回收。
- 错误必须可区分非法输入、不支持条件/格式、未知对象、幂等冲突、记录不可用、
  准入过期/过于未来、游标/锚点无效或过期、容量超限、停止未确认；不得用有效空页或成功状态掩盖。
  错误编码拼写、方法别名、传输编码和内部缓存方案属于实施细节，不改变这些可观察语义。

对应 A2/B1–B5/C1–C5、V04/V10–V15，见[观察][observation]及[生命周期][lifecycle]。
UI 优先展示 completed、failed、stopped，再展示 canceled、timeout、pending/eligible；
展示同时保留三维依据，不参与逻辑判断。

## Q04：窗口、限额和等待时限

**决定：公开独立配置及以下默认值，非法配置在开放服务前拒绝。**
时长为毫秒；容量为正整数，字节按传输编码后的 UTF-8 计量。容量配置是硬预算，不是静默裁剪目标。

| 配置族 | 公开默认与边界 |
| --- | --- |
| ULID 准入 | windowMs=86,400,000，futureSkewMs=60,000；时间戳 t 满足持久下界 L <= t <= now+futureSkewMs。每次准入先可靠推进 L=max(旧 L, now-windowMs)，再检查，包括幂等重试；下界含等号，已小于 L 的 ID 永不恢复有效。新域初值同样取 now-windowMs。 |
| 保留 | retentionMs=86,400,000 作为既有显式回收的默认年龄门槛，不自动启动清理产品；不是到龄必删，也不是缩短正确性保证的许可。幂等凭据覆盖 ID 可受理期间；活动对象、唯一匹配/恢复所需依据、水位与窗口下界继续保留。历史补读所需前后事实一旦不足则明确过期/缺失，不以计数器冒充历史。 |
| 分页/视图 | 默认 limit=100、maxLimit=1,000、maxScan=10,000、pageBytes=65,536；views=64、viewBytes=8,388,608、lifetimeMs=60,000。续页可调整合法 limit，不改冻结成员/摘要/排序/水位；超过 maxLimit 或扫描/字节预算明确失败，历史与集合一致。 |
| Run 停止 | stopGraceMs=5,000，自进入终止流程计时；forceExitWaitMs=5,000，自强制终止调用计时。届满仍无退出确认则报告停止未确认，不伪造终结或回收；停止互斥仍有效，继续接纳真实退出事实。 |
| 订阅 | 每实例 subscriptions=128；每个源封装 maxChanges=1,000、maxBytes=65,536；每订阅待消费 sourceEnvelopes=64、bufferBytes=1,048,576。补读与实时使用同一完整性/容量规则；超限在未交付的源封装前显式断流。空闲不推进领域 revision。 |
| 宿主/通道 | worker heartbeatMs=100、healthTimeoutMs=5,000、inFlight=64；业务 executionWallMs=60,000、调度 tickMs=10。HTTP pollMs=100、请求并发=128；server shutdownMs=15,000、requestTimeoutMs=30,000、连接=256。订阅存续不受普通请求总时长截断；正常取消句柄不取消 Task。 |

windowMs、futureSkewMs、retentionMs 和停止时限互不替代；futureSkewMs 可为 0，其余时长须为正。
已持久化下界不能随配置放宽或时钟回拨降低。缩小保留配置也不能丢失仍必要的幂等/匹配/恢复依据。
宿主关闭预算至少覆盖停止宽限加退出确认等待，非法组合初始化失败；预算耗尽不能报告已确认回收。
healthTimeout 只判断通道健康，业务时限只表达 Run 约束，均不冒充物理退出。
实施须在既有测试中验证边界和编码成本，不擅自改变默认值；确需调整则显式更新对应契约与决策候选。
对应 V01/V07/V11–V13；关键窗口、分页及停止规则同时写入各[职责契约][responsibilities]。

## Q05：Task 的 updatedAt 是否仍被 Run progress 更新

**决定：不包含 Run progress。** Task updatedAt 只随其可见创建、首次取消、匹配成立、
关联 Run stage 或结果事实改变；取消后也继续跟随关联 Run，不恢复冻结。
Run updatedAt 随其开始、进入停止流程、接纳停止、progress、结果、退出/恢复裁决及公开回收事实改变。
同一源事件的派生变化使用该事实时间；若墙钟回拨，更新时间取 max(先前 updatedAt, 事实时间)，
排序并列以稳定实体标识打破，事件顺序仍只由 revision 决定。
重复取消、仅时间流逝、读取或心跳不改变 updatedAt、不制造摘要事件。
Q08 中实际提交资格依据而形成的新匹配，按匹配事实时间更新受影响 Task；
不因一次时间见证就刷新所有 Task/Run 的 updatedAt。
对应 V14；[旧目录][old-catalog]“进度算 Task 更新”和取消冻结规则被本决定替代。

## Q06：职责表之外的现有能力如何归属

**决定：保留并纳入本轮直接链路验收。** discoverTypes、getRequest、
sendTaskMessage/getTaskMessage 是 12 项核心操作的配套能力，不因职责表省略而删除。
类型注册是可信初始化配置；发现实际可提交类型、版本与输入 Schema，提交按相应版本/Schema 前置条件校验；
不新增逐类型自授权或资产发现。getRequest 读取不可变原意图，保留省略与显式值区别，缺失明确不可用。

Task 消息保留 Task 归属、可信 Caller、消息幂等、Never 禁用、入队不等于接纳、
失联可能 unknown 的既有约束；按唯一匹配路由，未匹配不向候选 Run 广播，
进入停止流程不接纳新业务消息，退出后不再投递或复活 Run，未确认交付不得伪报已执行。
消息不新增 Run，不改变匹配/生命周期；具体业务含义仍属于 TaskType，不实施 Regulate。
Check/Probe 的完整 Run、结果证据、真实环境核验和资源释放必须保留；
Probe 从关联 Run 独立历史读取核验依据，不能删除校验以适配 Task history 分层。
UI 原参数重做使用新 requestId，不重放旧 Run；收藏及旧 host/pilot/regulator/coordinator 不在范围。
对应 V15/V16；见[职责入口][responsibilities]及既有[Schema][old-schema]、[消息][old-messages]讨论。

## Q07：已有数据域如何进入新事实契约

**决定：不支持的旧格式显式拒绝，默认不迁移、不删除、不重跑。**
在取得域独占后、开放受理/listener 前校验存储格式和必要事实；不能可靠解释旧 snapshot、
task.run.bound/task.terminated、旧 matchPolicy 或 recurrence 的域拒绝打开，
报告原域标识、格式不支持与可恢复操作，不先改写数据库再报错。
旧库及历史原样留存，继续使用旧版本是域外部署选择；新版本不提供兼容双轨或迁移工具。

需要新域时由宿主/操作者显式指定不同的新域位置与身份；不能自动改路径、清空原库、
复用旧域身份或伪称连续重启。新域窗口/水位是新起点，不接纳旧域 cursor/fromRevision，
也不导入/重演旧 Run。不支持格式与“可支持的新格式缺少补读历史”分别报错；
后者不能通过换域悄悄隐藏。新格式的同域重启仍须满足全部[持久恢复][recovery]规则。
对应 V01/V02/V09/V16；不包含清理工具或旧 Idea 生命周期操作。

## Q08：持久资格观测与纯时间推算的边界

**决定：采用数据域级 `qualification-time-observed` 资格时间见证。**
这是对原“纯时间不产生事件”的限制性澄清：独立时间标签推算无事件，实际协调新匹配资格的可信观测可以形成源事实。
不能伪称文字与语义毫无变化；此候选须重走 preparing、准确 revision 的 submitIdeal/acceptIdeal，
旧 Ideal 接受不能转作本候选的接受。

1. 协调器处理 Task/Run 的已提交事实前后边界。真实 Run 开始或其他已能证明资格的源事件优先充当边界，
   不为同一资格额外造见证。
2. 仅当既有源事实不能证明、且本次实际处理会让至少一个尚未匹配且可处理的 Task 获得新资格时，
   提交一次见证。领域载荷仅有 `observedAt`，不含绑定、所选 Run、Task 状态或受影响 Task 列表；
   标准事件元数据与全域源 revision 照常存在。
3. 额外见证严格位于相关 Task 受理与 Run 开始之后；后来的对象不能借用旧见证。
   截至该源序位置，结合可信观测边界、取消/生效/超时条件及 Run 资格，选择严格开始顺序最早的唯一匹配。
   观测必须与所依据的事实前缀一致，提交前前缀变化须重评；历史重放使用当时事实，不用当前 Run 状态补历史。
4. 允许 `initial + eligible`，直到协调器处理并形成已提交资格依据；不承诺墙钟到点同步完成匹配。
   pending/eligible/timeout 仍按当前 now 独立推算，GET 绝不写领域事实或提交见证。
5. 资格成立与停止互斥：资格先成立则计入需求，停止先成立则禁止新匹配；
   已取消 pending 不新增匹配。既定匹配不因 now 回拨、后续较小的终结墙钟或重启而撤销、换选。
6. 单个见证可能影响多个 Task，沿用同一源 revision 生成全部派生变化及完整集合封装，
   不为每个 Task 写新事实或权威缓存，不往已消费的旧 revision 补成员。
   从基线水位 S 补读必须包含随后见证 W 的全部相关变化，完整消费后才推进到 W。
7. 反复处理同一资格、没有新资格的 timer tick、GET、心跳或仅时间标签越界均不生成见证，
   不把时间水位做成无限 tick 日志。见证及前后边界依据必须持久保存或可由等价事实前缀重建，
   不能只留最大 observedAt、所选 Run 或计数器。

最小反例以 now=10 未处理/处理、回拨至 5、重启恢复及集合 S 后补读验证；
并覆盖真实源事实优先、不重复见证、已取消 pending、停止互斥、多成员完整交付与较小终结墙钟。
对应 X03/X06/X07/X08/X10、V03/V05/V09/V10/V13/V14/V17；
细节见[匹配契约][matching]及验收索引。这是已决设计候选，尚未实现或验收。

## 准备状态

- 12 项核心操作、10 篇跨操作契约及八个 workspace 的历史核对保留于 Contract-audit.md；
  Q01–Q08 已收敛，Q08 须重新验收准确 Ideal 后才继续核心实现。方法命名、编码及内部数据结构仍留给实施。
- Idea 仍为短方向卡；已有 Worker 进展不证明 Q08 完成，ledger 全部未勾选。
  本轮仅文档候选；submit/accept、Git 同步与独立验证由主 Agent 负责，执行代理不追加事件或提交。
- 以下为准备初期的历史基线，不能作为当前阻塞或本轮检查结果：当时全量 `pnpm check` 退出 1，117 项中 112 通过、5 失败；
  失败在 boundaries L99、discovery L199、engine L23/L105、projection-races L171。
  当时后续 test/pack 未完成，此前 Web UI reclamation_failed 也未因此解决。
- 主 Agent 在未改源码时，对这五项以现有 tsx/Node runner、`--test-concurrency=1` 和精确 name pattern
  隔离串行复测，5/5 通过，耗时 11.8s。此结果提示负载/时序差异，不证明根因或全套通过。
  实施须区分旧语义断言与真实故障，解决紧耦合脆弱等待，不放宽语义断言换取通过。
- 初期执行代理检查过 11 个 Markdown 文件的 123 个本地链接及锚点、Q/V/X/operation 编号、
  下游种子与未勾选 ledger；检查通过，`git diff --check`、`silvermoon check --worktree --audience agent` 通过。
  现有 Biome 不处理这些 Markdown（报告 0 文件并退出 1），不将其记为格式检查通过；未添加框架或改配置。
  这些是历史文档检查记录，不代替本轮候选检查。既有 Worker 阶段另有已完成回归证据，也不证明新资格语义。
  本轮只检查文档候选，不重新运行源码全量检查；主 Agent 仍负责准确 Ideal 的独立验证、同步与门禁。

[old-catalog]: ../../../../01M66TPNEMSQ8Y8SDSN2CDN6BA/outer/inner/ideal/Research.md
[old-schema]: ../../../../01M66MRFCSDK99MAEN8RN3NKBH/outer/inner/ideal/Research.md
[old-messages]: ../../../../01M67XYR798HDDWP6A41CPD5MQ/outer/inner/ideal/Messages.md
[responsibilities]: ../../../../../../docs/axis/task-engine-responsibilities.md
[observation]: ../../../../../../docs/axis/task-engine-contracts/observation.md
[subscription]: ../../../../../../docs/axis/task-engine-contracts/subscription.md
[lifecycle]: ../../../../../../docs/axis/task-engine-contracts/task-lifecycle.md
[recovery]: ../../../../../../docs/axis/task-engine-contracts/persistence-recovery.md
[matching]: ../../../../../../docs/axis/task-engine-contracts/run-matching.md
