# 契约差异与验收索引

本文件服务于 [Idea](Idea.md)，保留准备阶段只读核对的历史证据，并提供本轮验收索引，不是实施设计、完成证据或删除授权。
核对日期为 2026-11-02，代码与文档快照为 `3011dd9bd6dcd920d16987e08c05ecbc8a93bb3b`；
初始职责及十篇契约基线为 `5d44c83d`。代码行号对应核对快照，不表示已重审当前实现；
Q01–Q08 已收敛于[准备决策](Open-questions.md)，本轮按 Q08 精确补齐资格时间见证条文及验收。
表中的 Q 编号指向已决设计，不表示新候选已通过准确 Ideal 验收。
代码差异仍是核对快照的历史记录；已有 Worker 进展不构成 Q08 已实现的证据，本轮不重新审计或修改源码。
新契约优先；旧讨论只用于确认已讨论内容，旧测试是待重审的证据入口，不反向决定规范。

## 覆盖与责任

仅覆盖 task-protocol、task-engine、task-engine-storage、task-engine-http、task-engine-server、
check-task、probe-task、task-engine-web-ui 及直接相关测试、文档、脚本。
下表“责任”是待实现的归属，不表示已实施，也不规定内部类、传输协议或 Task 批量事务。

| workspace | 本轮直接责任与已核对入口 |
| --- | --- |
| task-protocol | 领域类型、纯状态推导、事件与查询/订阅契约；[types.ts][types]、[projection.ts][projection] |
| task-engine | 受理、匹配、调度、终止、恢复与观察；[engine.ts][engine]、[type-supervisor.ts][supervisor]、[type-worker.ts][worker]、[catalog.ts][catalog]、[frozen-catalog.ts][frozen] |
| task-engine-storage | 域独占、持久事件/水位/幂等依据、恢复与保留边界；[index.ts][storage] |
| task-engine-http | 12 项操作的公开映射、错误、分页与断线续读；[index.ts][http] |
| task-engine-server | 可信装配、独占取得后开放服务、停止及资源所有权；[index.ts][server] |
| check-task | 完整 Run 内准备/业务执行、可靠结果与资源释放；[implementation.ts][check] L133–250 |
| probe-task | 完整 Run 与子 Check 的提交、观察、结果证明及释放；[implementation.ts][probe] L472–534、[contracts.ts][probe-contracts] L298–309 |
| task-engine-web-ui | 三维展示、Task/Run 分层观察、完整分页基线与增量处理；[model.ts][ui-model] L325–463、[browser.ts][ui-browser] L432–674 |

旧 check-host/objective-host、objective-pilot/objective-regulator/regulation-coordinator 不改；
不接管收藏、不修改其他 Idea 生命周期、不实施 Regulate、通用资产、数据清理产品或 npm 发布。
Check/Probe 内部使用 Execution、业务证据或资源池不因名称相似而成为删除目标。

## Operations 对照

“部分”表示有可复用机制但不符合全部新契约；“缺失”仅指所需公共能力，不否认内部记录存在。
每行必须连同相应 X 条目和 V 场景验收，方法名称不相同本身不是语义缺陷。

| ID | [职责入口][responsibilities] | 核对快照差异及证据 | 责任 | 验收 |
| --- | --- | --- | --- | --- |
| A1 | 提交 Request | 部分：完整原意图幂等、Schema、首次时间锚点已有；只校验 ULID 格式，无准入时间窗口。仍接收 recurrence，并在同 series 有 pending 时取消新 Task；[engine][engine] L484–548、728–759。新政策名也被旧枚举拒绝。 | protocol/engine/storage/http；Probe/UI 请求方 | V01、V03、V05、V16；X02–X04 |
| A2 | 请求取消 Task | 部分：独立取消入口已有，但拒绝已终结 Task，取消后冻结 Task；回收先报告 run.failed，且需求统计包含未匹配或过期 Task；[engine][engine] L806–824、987–1004、1350–1420。 | protocol/engine；http/server；Check/Probe/UI | V04、V06–V08；X02、X05 |
| B1 | 单 Task 快照 | 部分：getTask 不附历史，但无查询水位，使用持久 snapshot、冻结结束时刻和 canceledAt；[types][types] L24–44、[projection][projection] L300–371。 | protocol/engine/http/UI | V03–V04、V10 |
| B2 | 单 Task 历史 | 部分：readHistory(taskId) 有冻结水位/分页；混入所关联 Run 的全部事件，包括 progress，依赖 task.run.bound；不是新定义的 TaskEvent 粒度；[engine][engine] L1544–1604。 | protocol/engine/storage/http；Probe/UI | V10–V11、V14；X07–X09 |
| B3 | 单 Task 订阅 | 部分：initial/pull/close 加当前 snapshots；续读输入是旧 stream cursor，不是 fromRevision；没有 resume 时从当前头开始；混入 Run progress；[engine][engine] L1605–1653。 | protocol/engine/http/server/UI | V10、V12、V14；X10 |
| B4 | Task 集合查询 | 部分：冻结成员、顺序、摘要、观察时间及过期机制已有；页无 revision，摘要沿用旧状态，updatedAt 含 Run progress；[catalog][catalog] L87–166、[frozen][frozen] L20–26、150–155。 | protocol/engine/http/UI | V11、V13–V14；Q05 |
| B5 | Task 集合订阅 | 缺失：TaskService 及 HTTP 仅有单 ID/series 观察，无 query 集合加入/更新/移出及补读；[types][types] L285–309、[http][http] L262–288。series 订阅不代替集合订阅。 | protocol/engine/storage/http/server/UI | V12–V14；Q01–Q03 |
| C1 | 单 Run 快照 | 缺失：有 RunRecord 和 RunSummary，但无 getRun/RunSnapshot 公共能力；UI 从列表/历史拼 Run 状态；[types][types] L62–83、259–309、[UI][ui-browser] L573–575、667–674。 | protocol/engine/http/UI；Probe 事实读取 | V08、V10 |
| C2 | 单 Run 历史 | 部分：readHistory(runId) 可读持久 Run 事件，水位分页机制存在；事件终结含义仍旧，页和错误边界需对齐；[engine][engine] L1483–1493、1571–1604。 | protocol/engine/storage/http/UI | V08、V10–V11 |
| C3 | 单 Run 订阅 | 部分：runId 复用旧 pull/SSE，没有明确 fromRevision 入口；正确的退出终结及停止事实尚缺；[engine][engine] L1605–1653。 | protocol/engine/http/server/UI | V08、V12 |
| C4 | Run 集合查询 | 部分：独立冻结目录已有，无 revision；状态只有 running/completed/failed/reclaimed/sealed 布尔组，缺 stopping/stopped；[types][types] L259–284、[catalog][catalog] L183 起。 | protocol/engine/http/UI | V08、V11、V13 |
| C5 | Run 集合订阅 | 缺失：与 B5 相同，无按 query 派生的集合流；不能以多个 Run 详情订阅拼出完整成员发现。 | protocol/engine/storage/http/server/UI | V12–V13；Q01–Q03 |

## 十篇跨操作契约

| ID / 规范 | 核对结论（保留机制与差异分开） | 场景 |
| --- | --- | --- |
| X01 [数据域][domain] | 部分：Store 实例固定注入、SQLite 持久 store_id、owner_path 独占锁与重复实例拒绝已有；[storage][storage] L111–205，[server][server] L136–163。新接口仍需统一域标识与 revision/cursor 绑定，scope 是授权边界，不能当数据域或设备固定定义。 | V02、V11–V12 |
| X02 [Task 三维状态][lifecycle] | 不符：[types][types] L5 仅 initial/running/completed/run_failed；[projection][projection] L84–88、231–260、300–351 冻结取消及结束时间。取消/超时后 stage、结果和 now 推算必须继续；Task 不接收 Run progress。首次 eligible/deadline 锚点计算可复用。 | V03–V04、V14 |
| X03 [匹配][matching] | 不符：旧 started/terminated 名称，terminated 必须已有结束时间；matching 被记录为独立 task.run.bound，终结时才绑定；[projection][projection] L4–17、145–181，[engine][engine] L1005–1055。startedSequence 是可复用的严格顺序依据；Q08 要求按已提交资格边界推导最早匹配，必要见证仅含 observedAt，不写绑定/Task 状态。 | V05–V06、V09、V17；Q08 |
| X04 [Request 准入][admission] | 部分：完整 canonical 原意图、同步受理、SQLite 唯一 request_id 和事务已有；[engine][engine] L728–759，[storage][storage] L268–309。无 ULID 时间窗口/持久单调下界；records.forgotten 同时删除 requests 索引，旧 ID 可被当成新请求；窗口与保留不能由 retentionMs 代替。 | V01、V09；Q04、Q07 |
| X05 [Run 终止][termination] | 不符：一类 TypeSupervisor 一个 Worker，多 Run 共用；complete/failed 消息即提交终结；released 清理消息不是退出；停止没有 Worker 接纳的 stopping，5 秒超时仅报清理未知，不强制终止指定 Run；[supervisor][supervisor] L109–141、400–474、500–504、537–559，[worker][worker] L310–373，[engine][engine] L1380–1420。现 sealed 仅在替换资源授权路径产生，非所有终止入口；取消与匹配需互斥且只统计匹配、eligible、未 canceled 的需求。 | V06–V08 |
| X06 [持久化/恢复][recovery] | 部分：事件/检查点恢复、原时间锚点、不重跑已开始尝试、未知回收事实已有；缺终结的 Run 被恢复为 failed/execution_interrupted，而不是 stopped；[engine][engine] L872–914。检查点携带独立 Task snapshot；新事实推导、资格见证及前后边界、开始顺序和准入下界须跨重启恢复，不能按当前 Run 重选。 | V01–V02、V09、V17；Q07–Q08 |
| X07 [revision][revision] | 部分：Store append 分配全域递增 sequence，水位跨重启持久；[storage][storage] L268–309。同一 Run 事实又提交每个 Task 的 bound/terminated 事件并分别编号；[engine][engine] L1030–1055。Run 事实或单个资格见证影响多个 Task 时只沿用一个源 revision，不把权威缓存事务当领域前提；查询/补读须覆盖同一源边界的全体派生变化。 | V10、V13–V14、V17；Q08 |
| X08 [观察范围][observation] | 部分：详情与历史入口分离、集合摘要不含完整载荷已有；缺 Run 快照及集合流；Task 历史含 Run progress；[engine][engine] L1544–1570。集合按已提交事实及资格边界前后条件推导，不按当前 Run/now 补历史；不为每个 query 保存独立历史。 | V10、V13–V14、V17；Q01–Q03、Q05、Q08 |
| X09 [分页][pagination] | 部分：历史固定上界；目录冻结全部成员、顺序、摘要，权限/删除失效和资源预算有机制；[frozen][frozen] L62–199。历史页超限静默 Math.min，目录超限拒绝；历史第一页从 floor 起，无先前历史缺失提示；无统一 Page.revision，不能用旧 cursor 代替订阅源位置。 | V11；Q03–Q04 |
| X10 [订阅][subscription] | 部分：单体历史补读、pull 有界、SSE 断开 close 而非 cancel 可复用；[engine][engine] L1605–1653、[HTTP][http] 的 stream。缺 fromRevision 与集合事件；[UI][ui-model] L421–446 仅按 sequence 去重不能直接复用为同 revision 多成员消费。独立时间标签无事件，实际资格见证按正常源位置完整补读；未知/跨域/过期锚点明确失败。 | V12–V14、V17；Q01–Q02、Q08 |

## 验收场景（待实施，不是已通过测试）

| ID | 可重复输入/竞态与必须观察到的结果 | 现有验证入口 |
| --- | --- | --- |
| V01 | 同域同 ID 并发/重启重试只获一个 Task；完整原意图变化冲突，省略不被默认值覆盖。ULID 过旧、过于未来、窗口外幂等、时钟回拨/重启/配置回退均按选定边界拒绝；详情不可用不重建。 | [storage.test.ts][storage-tests] L61、129、232；新增窗口边界断言 |
| V02 | 同域双实例第二个初始化失败且第一实例不受扰；释放/进程崩溃后接管原域，另域不串数据；启动失败不得先开放 listener。 | [server.test.ts][server-tests] L167、247、262；[storage.test.ts][storage-tests] L101 |
| V03 | 假时钟依次取 eligibleAt−1、eligibleAt、deadlineAt、deadlineAt+1；分别 pending/eligible/eligible/timeout，completed/failed/canceled/stopped 后仍按 now 推算。仅标签推算/GET 不增 revision，受理时间不随重试/恢复移动；实际资格协调另按 V17。 | [protocol.test.ts][protocol-tests] L46（旧冻结断言必须重写）；[event-binding.test.ts][binding-tests] L95；Q08 |
| V04 | 两 Task 共享 Run，取消一个后另一个继续；被取消 Task 的 stage 仍跟随 stopping/completed/failed/stopped，canceled 保留；pending 取消不启动/新匹配。终态后首次取消仍记录撤回，重复取消不新增事件；GET/SSE 乱序不撤销取消、不冻结后续 stage。 | [projection-races.test.ts][race-tests] L171、[UI model][ui-model] L325–395 对应测试；Q03 |
| V05 | 两政策使用新名字；同刻及回拨候选按严格开始序号选最早；terminates-policy 在已提交可信资格边界确认 eligible 且 Run 已开始未终结时推导匹配，不等终结；处理前 initial+eligible 合法。停止/后续候选/恢复/较小终结墙钟不重选，不用计划代替开始事实。 | [event-binding.test.ts][binding-tests] L15、59、119；[whole-run.test.ts][whole-tests] L64（旧等待绑定断言须替换）；Q08、V17 |
| V06 | 新 Task 匹配与进入终止流程以两种顺序交错；匹配先成立则计入有效需求，终止先成立则禁止新匹配，即使 Worker 尚未报告 stopping；原匹配永不转移或抹去。 | [event-binding.test.ts][binding-tests] L216；新增所有停止入口竞态 |
| V07 | 取消/超时触发回收，只有已匹配、eligible、未 canceled Task 能保护 Run；pending、未匹配及过期候选不能阻止停止。停止信号不变 stage，Worker 接纳才 stopping；协商超时强制终止指定 Run，另一个同类型 Run 不受影响。 | [type-supervisor.test.ts][supervisor-tests] L78、190；新增指定 Run 卡死与超时隔离 |
| V08 | 成功/失败结果先到、Worker 仍存活时未终结；退出才 completed/failed；停止无结果退出为 stopped，意外无结果退出为 failed。退出关闭信道，旧消息/已排队回调不得更新状态；协商期间可靠结果优先，不假报回收。 | [whole-run.test.ts][whole-tests]、[supervisor-tests][supervisor-tests]；新增结果/退出交错矩阵 |
| V09 | 在 Run 开始、投递、资格见证及终结持久化边界注入进程退出；已开始无终结恢复 stopped 且不重跑，物理退出/副作用/清理仍未知。重放当时资格事实保留原匹配，未匹配有效 Task 继续协调，pending 原锚点不变；开始序号、水位及窗口下界不倒退。 | [startup.test.ts][startup-tests]；[check restart][check-restart]、[probe restart][probe-restart]；V17 |
| V10 | 一个 Run 事件或资格见证影响多 Task，只分配一个源 revision；各单体历史/订阅与集合全体派生变化沿用该位置。单体快照和空/非空集合均返回同事实边界水位，取消、结果与缓存覆盖位置一致，progress 载荷仅 Run 可见。 | [protocol.test.ts][protocol-tests] L64；新增跨实体水位与派生事件断言；Q08、V17 |
| V11 | 多页间并发创建/更新仍固定成员、摘要、顺序及水位；同页重试一致，完整遍历无漏无重。参数非法、跨域/种类/条件 cursor、清理/权限撤销、过期、扫描/字节超限明确失败；历史缺失不以有效空页冒充。 | [catalog.test.ts][catalog-tests] L158、338、410、429、519；[execution-catalog.test.ts][run-catalog-tests] L116、177 |
| V12 | 从查询 R 后补历史，注册期间发生事件不丢；历史尾接实时、断线重连允许重投；跨域/未来/过期/非法 R 明确失败。取消句柄、HTTP 断开只停观察；慢消费者有界且能显式恢复。 | [http.test.ts][http-tests] L214、249、292；新增 fromRevision 与集合补读 |
| V13 | 基线含全部分页；一个源事件（包括资格见证）使多个成员加入/更新/移出，完整封装应用前不推进锚点，断线允许重投，不按 R 丢成员。超大封装/慢消费显式失败且不交付部分；按历史前后事实重建，与同 R/观察时间重查一致，发现原先不在基线中的成员。 | 新增集合协议/Engine/HTTP/UI 场景；使用现有 runner，不造框架；Q01–Q02、Q08、V17 |
| V14 | 独立进度载荷、仅时间标签、实际资格匹配、取消、终结分别验证粒度/摘要/updatedAt；没有新资格的 Run progress 不更新 Task，取消不冻结 stage。GET/空 tick/心跳不造见证，不因一个见证刷新所有实体；时间派生条件拒绝，事实区间下含上不含。 | [catalog.test.ts][catalog-tests] L113、193；[UI EventWindow][ui-model] L421；Q02、Q05、Q08 |
| V15 | 独立 HTTP 消费者及 Web UI 发现类型、提交、取消、查 Task/Run、完整分页并订阅；Check/Probe 保留结果证据、子任务真实环境核验与资源释放。旧 Task 历史不再混入 Run 事件时，Probe 仍能经明确入口核验 Run，不能删除校验换取通过。 | [http.test.ts][http-tests] L8、[server.test.ts][server-tests] L72；Check/Probe 与 UI 集成测试；依 Q06 |
| V16 | 周期与业务系列不再由 Engine 自动创建后继或因同 series 相互取消；取消订阅不取消 Task；UI 重做使用原参数和新 requestId，不重放旧 Run。不支持旧格式在开放服务前明确拒绝且原库不变；新域须显式选择且身份/水位不冒充旧域连续。 | [engine][engine] L728–759、1422–1465；Probe 请求及 UI 原参数重做测试；Q07 |
| V17 | 资格时间见证的未处理/处理/回拨/重启与源水位补读，按下述最小反例矩阵验证；一条见证与全体派生变化一致，无绑定事实、权威缓存或每 tick 时间日志。 | 新增协议/Engine/storage/HTTP/UI 定向场景；Q08、X03/X06/X07/X08/X10；尚未实施 |

### V17：资格观测最小反例与反向边界

固定同域同 Input：r1 在 −20 受理 B 并保持有效需求，r2 在 −10 开始 R，B 已匹配；
r3 在 0 受理 A，A 的 eligibleAt=10、deadlineAt=60、policy=terminates-after-eligible。
这些数字只是验收输入，不是执行证据或固定 revision 编码。

| 操作/边界 | 必须观察到的结果 |
| --- | --- |
| now=10，仅 GET，尚未协调 | 仍为 r3；A 是 initial / canceled=false / eligible，无匹配；GET、标签推算均不写事实；stage=running 或 runId=R 的基线只有 B |
| now=10，协调新资格 | 既有事实不足时只提交 r4 qualification-time-observed，领域载荷仅 observedAt=10；A 从完整源前后边界匹配 R，stage=running、canceled=false、时间 eligible |
| 反复 tick、GET、心跳，无其他新资格 | 不再追加见证，不重复制造匹配变化，也不无条件刷新 updatedAt |
| now 回拨至 5 | 仍保留 r4 已成立的 A→R，stage=running、canceled=false、时间 pending；不抹去匹配，不冻结时间，不为回拨造见证 |
| R 后续可靠成功并退出，退出墙钟为 5 | A 保留 R 并跟随 completed，时间仍 pending；不能因终结墙钟小于 10 撤销资格；其他失败/停止结局按对应事实同样验证 |
| 回拨至 5 后重启，R 无可靠终结 | 从 r4 及当时前后事实重建原匹配；R 按 stopped 恢复、A 跟随 stopped，时间 pending，物理退出/清理仍未知，不重跑 R；已有可靠终结的分支恢复原结局 |
| 从 r3 基线/订阅补读 r4 | 单体历史、单体订阅与集合完整封装均使用 r4；若同一见证还影响另一成员，则完整交付全部变化，中途断线不推进锚点，重投不漏成员；同 r4/观察时间重查一致 |
| 真实源事件已经证明资格 | 直接沿用该事件的 revision，不额外写 qualification-time-observed；无任何新资格时不写见证 |
| A 在 pending 时已取消，或 R 先进入停止流程 | 不借后来见证给 A/R 新增匹配；反向顺序中已成立资格计入需求判断，继续覆盖 V06 的互斥裁决 |
| 新 Task 受理或新 Run 开始晚于 r4 | 不能借用旧 r4 为后来对象证明资格；按新的真实源边界或必要新见证评价 |
| 观测与提交之间有新受理/开始/取消/停止源事实 | 按实际提交前缀重评资格与停止互斥，不把过时观测借给后来对象或提交无新资格的见证 |

## 验证边界

原核对只修改当前 Ideal World 文档；本轮收敛另外精确补齐直接职责/契约，仍不修改源码、测试或其他 Idea。
上述 V 项全部是后续验收要求；现有用例即使通过，也不证明新契约满足。
实施前须重新建立必要基线；用户报告原 main 曾在 Web UI test 出现 reclamation_failed，不能宣称历史全套基线通过。
已知基线及主 Agent 隔离复测结果见[准备状态](Open-questions.md#准备状态)，不把局部复测通过宣称为全套通过，也不把旧核对当作当前阻塞。

[responsibilities]: ../../../../../../docs/axis/task-engine-responsibilities.md
[domain]: ../../../../../../docs/axis/task-engine-contracts/data-domain.md
[lifecycle]: ../../../../../../docs/axis/task-engine-contracts/task-lifecycle.md
[matching]: ../../../../../../docs/axis/task-engine-contracts/run-matching.md
[admission]: ../../../../../../docs/axis/task-engine-contracts/request-admission.md
[termination]: ../../../../../../docs/axis/task-engine-contracts/run-termination.md
[recovery]: ../../../../../../docs/axis/task-engine-contracts/persistence-recovery.md
[revision]: ../../../../../../docs/axis/task-engine-contracts/revision.md
[observation]: ../../../../../../docs/axis/task-engine-contracts/observation.md
[pagination]: ../../../../../../docs/axis/task-engine-contracts/pagination.md
[subscription]: ../../../../../../docs/axis/task-engine-contracts/subscription.md
[types]: ../../../../../../packages/task-protocol/src/types.ts
[projection]: ../../../../../../packages/task-protocol/src/projection.ts
[engine]: ../../../../../../packages/task-engine/src/engine.ts
[supervisor]: ../../../../../../packages/task-engine/src/type-supervisor.ts
[worker]: ../../../../../../packages/task-engine/src/type-worker.ts
[catalog]: ../../../../../../packages/task-engine/src/catalog.ts
[frozen]: ../../../../../../packages/task-engine/src/frozen-catalog.ts
[storage]: ../../../../../../packages/task-engine-storage/src/index.ts
[http]: ../../../../../../packages/task-engine-http/src/index.ts
[server]: ../../../../../../packages/task-engine-server/src/index.ts
[check]: ../../../../../../packages/check-task/src/implementation.ts
[probe]: ../../../../../../packages/probe-task/src/implementation.ts
[probe-contracts]: ../../../../../../packages/probe-task/src/contracts.ts
[ui-model]: ../../../../../../apps/task-engine-web-ui/src/model.ts
[ui-browser]: ../../../../../../apps/task-engine-web-ui/src/browser.ts
[storage-tests]: ../../../../../../packages/task-engine-storage/test/storage.test.ts
[server-tests]: ../../../../../../packages/task-engine-server/test/server.test.ts
[protocol-tests]: ../../../../../../packages/task-protocol/test/protocol.test.ts
[binding-tests]: ../../../../../../packages/task-engine/test/event-binding.test.ts
[race-tests]: ../../../../../../packages/task-engine/test/projection-races.test.ts
[whole-tests]: ../../../../../../packages/task-engine/test/whole-run.test.ts
[supervisor-tests]: ../../../../../../packages/task-engine/test/type-supervisor.test.ts
[startup-tests]: ../../../../../../packages/task-engine-storage/test/startup.test.ts
[check-restart]: ../../../../../../packages/check-task/test/restart.test.ts
[probe-restart]: ../../../../../../packages/probe-task/test/restart.test.ts
[catalog-tests]: ../../../../../../packages/task-engine/test/catalog.test.ts
[run-catalog-tests]: ../../../../../../packages/task-engine/test/execution-catalog.test.ts
[http-tests]: ../../../../../../packages/task-engine-http/test/http.test.ts
