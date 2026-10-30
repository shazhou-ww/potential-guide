# Endpoint 任务历史查询：能力缺口与最小范围

日期：2026-10-31。本文支撑 [Idea.md](Idea.md)，不是另一份契约或已确认的接口设计。用户授权在项目级独立 session 与独立 worktree 中跟进 `task-history-query` 的准备研究和讨论，保持 preparing；不开始实现、验收、部署或发布，不记录 submit/accept。

来源需求为 [task-engine-web-ui 的 US-11](../../../../01M663BC641JV531CXWN5WD2AG/outer/inner/ideal/Requirements.md)：查询 Endpoint 上所有可访问的历史任务，基础筛选按类型和时间；保留与清理由 Service 配置治理，重做只套用原用户参数。Input 内部参数筛选属于后续高级候选。

## 1. 证据基线与结论

源码与探针基线为 [`248f8ee116abcae18c7e6ad19a044540c4d77706`](https://github.com/shazhou-ww/potential-guide/tree/248f8ee116abcae18c7e6ad19a044540c4d77706)。建档前已整合 primary `fc853bd81016988a7ebd74c52980424285fce5c7`；中间变更仅涉及 idea 文档/事件，未改变本次调查的生产代码。以下行号对应源码基线，不代表客户部署或最新发布包已核验。

### 最新契约复核

独立跟进时已刷新 primary，当前 worktree 与 [`0d54f74a0efc7a0432b6efb49d487dc2c467db6e`](https://github.com/shazhou-ww/potential-guide/tree/0d54f74a0efc7a0432b6efb49d487dc2c467db6e) 一致。相对探针基线，终结语义已有生产代码变更；以下为源码复核，不是重新运行探针或外部验收：

- [当前 Task 协议](../../../../../../packages/task-protocol/src/types.ts)新增 `TaskRecord.receivedSequence`，Facts 使用 `projectionVersion: 2`；TaskSnapshot 仍无 type，TaskService 和 Operation 仍无目录查询。序号来自创建事件，[投影](../../../../../../packages/task-protocol/src/projection.ts)检查其与事件 sequence 一致。这为限定首次查询前已接收任务提供了可复用事实，但不等于已实现列表游标、权限绑定或清理后的一致性保证。
- [存储契约](../../../../../../packages/task-engine-storage/README.md)已明确 SQLite `user_version`、checkpoint 与 Facts 为 v2；旧或未知格式被拒绝，旧数据不迁移、不覆盖、不删除。目录只能面向服务当前能合法加载且仍保留的记录，不承担跨格式历史迁移；“所有历史”不能解释为绕过这一边界读取旧数据库。
- [当前 Engine](../../../../../../packages/task-engine/src/engine.ts)仍保存原请求与 binding，`checkHistory` 使用原绑定版本；服务接收时间仍由服务时钟生成。有效资格时间现在不早于接收时间，但可晚于接收时间，仍不能替代历史筛选的时间口径。
- [终结语义构想](../../../../01M66MH9YKNJ406ESX7J1HTY7J/outer/inner/ideal/Idea.md)区分 Execution 成功/失败终结、取消与超时；目录复用既有投影，不压成互斥状态或重写规则。[Task Schema 构想](../../../../01M66MRFCSDK99MAEN8RN3NKBH/outer/inner/ideal/Idea.md)约定声明式输入和发现能力，但本次所读生产协议仍是 validate/equals。不得把另一 idea 的目标或授权当成本条已实现的前提。

**缺的是公开的任务目录查询，不是任务数据，也不是单任务事件历史。** 可以独立于 Web UI 和 Task Schema 的实现推进契约收敛；不必为了目录先建设另一套存储、通用搜索引擎或治理平台。

| 层面 | 已有事实 | 明确缺口 |
| --- | --- | --- |
| 通用协议 | TaskService 有 submit、getTask、getRequest、readHistory、subscribe；HistoryFilter 必须指定 taskId / executionId / seriesId 之一 | 没有任务目录查询方法、类型/时间过滤或列表权限操作 |
| HTTP | POST `/tasks`，GET `/tasks/:id`、`/requests/:id`，按已知身份查询事件/订阅 | GET `/tasks` 未提供，事件历史不是无 ID 的发现入口 |
| Engine | Facts.tasks 保存所有仍保留的 TaskRecord；含 request、binding、snapshot | 缺受控公开列表投影、过滤、排序、分页规则；不能直接公开整个内部记录 |
| SQLite | 事件、完整 checkpoint、requestId/taskId 索引和恢复能力已有 | 不是已有一张可按 type/receivedAt 查询的公开 Task 表；尚无相应查询索引/API |
| UI | 可通过既有 ID 查询任务、取回原参数后新提交 | 不能枚举未知任务；本机记录或猜测 ID 都不是服务端全量历史 |

### 实际探针结果

使用仓库现有 MemoryStore/VirtualClock 测试夹具和真实 Web handler，在内存中分别通过 Engine 与 HTTP handler 创建任务；没有网络请求、监听端口、用户服务或磁盘数据库。断言验证 Store 确有两项任务，并得到：

| 请求或检查 | 实测结果 |
| --- | --- |
| GET `/tasks` | 404 |
| GET `/tasks?type=echo&from=2026-10-01T00:00:00.000Z` | 404 |
| GET `/event-history` | 400，缺少身份过滤 |
| GET `/event-history?type=echo` | 400，type 不是现有事件过滤条件 |
| GET `/tasks/<由 Engine 创建的 taskId>` | 200 |
| GET `/requests/<对应 requestId>` | 200，原输入保留 |
| 使用另一 scope 访问已知任务，即使测试 authorize 回调允许该 subject | forbidden |

这些结果证明“数据存在但无法枚举”和当前 scope 边界；不证明拟议列表功能已实现，也不是客户环境或吞吐量测试。夹具已关闭。

## 2. 可复用的数据和语义

- **身份与类型**：TaskRecord.request/snapshot 已保存 taskId、requestId、seriesId；binding 保存原 type、version、scope 和提交者 subject。TaskSnapshot 本身没有 type，目录不能只原样返回快照便声称提供了类型信息。
- **时间**：receivedAt 是服务接收时由可信时钟记录的固定字段；eligibleAt 是资格时间，可能由请求指定；execution.startedAt 对尚未运行任务不存在；snapshot.timestamp 是观察时刻，不是提交时刻。
- **状态**：继续使用通用快照/投影语义，不在列表里重写 stage、取消、超时或终结算法。目录枚举当前保留的已创建 Task，不因“历史”一词擅自只保留 completed。
- **详情与重做**：列表只需提供足够的摘要和身份；用户选中后复用现有 getTask/getRequest。原请求重做仍是新提交，既有请求的 requestId 不能复用成新任务身份。
- **恢复**：Store checkpoint 和事实重建已经支持持久化。目录应来自相同权威数据，而不是浏览器记忆或单独长期保存的副本。

来源见 E1、E3、E5。

## 3. 必须保持的边界

### 权限不是“同一个 HTTP 地址就全都可见”

Engine.authorized 明确要求 `caller.scope === recordScope`，然后再调用操作授权；并非 authorize 返回 true 就可以跨 scope 查询。新列表必须在可信 Caller scope 内过滤并鉴权，不能让 query 中的任意 scope 参数绕过这条规则。

同一 scope 内不应仅因记录的原提交者 subject 不同，或由另一客户端发起，就排除它；是否允许当前请求执行列表操作仍由授权策略决定。类型发现、列表读取、原请求读取是不同权限面，不能因为能列出摘要便自动开放全部输入。

返回项、分页和可选统计不得泄露其他 scope 的记录；每次翻页重新验证权限。游标是位置凭据，不是绕过授权的令牌。现有 Operation 没有列表项，新增操作及配置兼容需明确，不静默借用 submit 或放开全部权限。

### 事件分页不能直接改名为任务分页

现有游标绑定 storeId、单个历史过滤条件、watermark、事件 position 和 page/stream 模式。分页内容是事件，不是 Task；同一 Task 对应多个事件。新目录需要自己的语义，不能直接把事件 next 当作任务 next。

建议稳定排序采用固定时间字段加 taskId 作为同刻排序依据，并明确时间范围端点。receivedAt 可能受时钟回拨影响，新任务也可能插入较早时间位置；不能仅凭“按时间翻页”就宣称获得固定成员集合。

首版仍需选择并记录：目录是明确的实时 keyset 分页，还是固定成员边界的分页；状态快照是否为每次读取的最新事实。需要覆盖并发新增、同刻记录、时钟回拨、清理及权限变化，不承诺尚未实现的一致性保证。不要直接套用 offset 后宣称稳定，也不要未经必要性证明先建游标会话缓存。

### 旧契约仍然是历史边界

getTask/getRequest 会经 checkHistory 使用原绑定版本验证 input、Prepared 和 result；Engine.start 也先检查全部保留记录。缺少原类型版本时，现有服务可能在启动阶段就失败，而不只是某条详情打不开。

目录不能用当前版本 validator 重新解释旧输入，也不能以“只查列表”为由绕开恢复检查。Task Schema 的演进由其独立 idea 负责；本条复用稳定的身份/type/time/通用快照，不复制业务校验规则或继承另一会话的 gate 授权。

### 保留配置不等于已存在定期清理

当前 EngineLimits 包含 retentionMs，默认 86,400,000 ms；collect() 会保守地处理整个不活跃且超过保留条件的引用集合，并写 records.forgotten，再 compact。不是每个 Task 到某个精确时点就自动删除。

本次搜索 Engine/Server 生产入口、examples 和 scripts，未发现标准服务定期调用 collect；现有显式调用位于两个测试中。Engine 的周期调度只调用 tick。可信外部组装可以另行调用，但不能将默认 retentionMs 描述为已运行的清理定时器。

列表只查询服务当前仍保留的数据，不恢复已清理记录、不在读查询时触发 collect。自动治理若需补充，应独立明确，不作为本目录查询完成前置。不存在/空列表、拒绝访问、无效或失效游标以及服务故障应能区分，不能吞错返回空数组。

来源见 E3、E4、E6、E7。

## 4. 建议的最小能力与实现归属

以下是准备建议，尚未作为用户已接受的接口或排期：

1. **只读任务目录**：按可选类型和时间范围查询当前授权范围内保留的任务，返回有界的摘要列表和继续读取所需信息；不默认返回全部 input、Prepared、执行文件或大型 result。
2. **与已有详情衔接**：摘要至少能识别 Task、Request、类型与列表时间；通过现有入口打开快照/输入/事件，再走原参数新提交，不新增“服务器替你重跑”操作。
3. **有限且明确的查询契约**：时间口径、稳定排序、翻页一致性、参数校验、响应上限和失效行为有文档及测试；HTTP 路径和方法名在该契约收敛时确定。

用户已明确需要**创建时间与更新时间两种查询**，此前确认服务接收时间并不排除更新时间：

- **创建时间**采用 `receivedAt`（服务接收时间）：周一提交、预约周二运行、周三结束的任务，按创建时间查周一应能找到。未开始或最终失败不改变创建时间归属，不以客户端本地发起时间、资格时间、实际开始或结束时间代替。
- **更新时间**用于查找最近发生变化的任务。用户明确确认：昨天开始、今天只上报了新进度的任务，应出现在“今天更新过”的结果中；不能仅把开始、完成、失败或取消等状态/结果变化算作更新。单纯读取任务不算更新。
- 本次在 `ef01168532f265bb69e6f720ae68c7979670e09f` 源码复核：[投影](../../../../../../packages/task-protocol/src/projection.ts)的 `project` 把 `snapshot.timestamp` 设置为本次读取的 `now`，而 `execution.progress` 在事实归约中不更新任务快照。现有字段不能直接改名为更新时间，也不能只取任务状态时间的最大值来覆盖进度更新。
- 更新归属必须沿用现有 Task 与 Execution 关联和授权语义；共享执行的进度归属、取消后变化是否影响该 Task、纯时间推移产生的超时如何表达，仍须收敛，不重写终结规则。历史进度被压缩后的更新时间保持与重启恢复需有证据，不承诺永远扫描完整事件历史即可恢复。
- 创建时间固定，更新时间会变化；按更新时间筛选或排序时，即使限制首次查询前已创建的任务，后续更新仍可能使记录进出范围或移动位置。因此创建序号不能单独证明双时间查询的分页一致性。时间范围端点、两种过滤同时使用时的规则及分页语义尚未定案。

| 归属 | 本条可能涉及的工作 | 不应顺带扩展 |
| --- | --- | --- |
| task-protocol | 查询输入/结果及权限操作契约 | 通用 Input 查询语言、资产接口 |
| task-engine | 基于权威 Facts 的授权过滤、摘要投影、排序/分页和边界验证 | 新任务执行器、重新执行历史任务、另写终结算法 |
| task-engine-http / task-engine-server | 暴露协议、解析/错误映射、可信授权配置示例 | UI、本机收藏、浏览器任意地址代理 |
| task-engine-storage | 先核实复用现有视图的成本与恢复一致性；需要索引时只增加可验证的派生投影 | 无证据先建第二套历史数据库或数据仓库 |

当前默认 maxTasks 为 10,000，pageSize 为 100，但可由服务配置改变；这些是基线事实，不是新接口已确定的容量承诺。现有 Store.read 返回完整视图，SQLite 类型/时间索引也并未存在。可先验证对既有受限 Facts 过滤和稳定排序的方案，只有实测规模/成本表明必要时再做派生索引；单纯限制返回条数不等于扫描和响应成本已受控。

本条不包含高级 Input 筛选、状态/结果全文搜索、全局 SSE、计数大盘、历史删除 API、定期清理治理、Schema 发现实现或资产管理。

## 5. 验证重点与后续边界

- 不同客户端、同 scope 的任务都能被目录发现；另一 scope、拒绝授权和权限变化不泄漏身份/条数。
- 不同类型、创建时间与更新时间、同刻时间、空结果、边界时间、非法范围、无效 cursor、极端页大小具有明确行为；仅有新进度也能按更新时间找到，重复读取不会制造更新。
- 并发新增、进度/状态更新、清理和时钟回拨符合选定分页契约；不得漏掉符合该契约的记录、重复返回同一项或伪装固定快照。
- 重启后目录与现有详情/原请求一致；原版本绑定不被当前类型/Schema 静默替代；查询不执行任务、不清理数据。
- 缺少旧版本导致启动失败等既有行为要明确记录，不将新增列表宣称为历史迁移方案。

本 idea 的当前授权仅为准备与讨论，不代表立即实施或提交构想验收。双时间查询、创建时间采用服务接收时间及新进度计入更新已确认，继续收敛更新归属、最小摘要和分页一致性；本项目级独立 session 自行推进，不向来源会话汇报或等待其协调，不创建子 agent/session 代替跟进。

## 证据索引

| 编号 | 基线源码/已有测试 | 支撑内容 |
| --- | --- | --- |
| E1 | [协议类型](../../../../../../packages/task-protocol/src/types.ts)，L30–82、L119–142、L200–230 | TaskRecord/Facts 已有数据、scope/Operation、单对象事件历史与无列表方法 |
| E2 | [HTTP handler](../../../../../../packages/task-engine-http/src/index.ts)，L80–86、L148–225 | 完整路由、严格身份过滤及错误处理；无任务目录 |
| E3 | [Engine](../../../../../../packages/task-engine/src/engine.ts)，L42–97、L164–210、L258–366、L413–485 | 限额、原版本校验、scope 隔离、receivedAt、原请求、启动与周期调度 |
| E4 | [Engine 历史与回收](../../../../../../packages/task-engine/src/engine.ts)，L970–1049、L1078–1191 | 现有事件 cursor、授权、分页、collect 和保留条件 |
| E5 | [SQLite Store](../../../../../../packages/task-engine-storage/src/index.ts)，L53–85、L119–162、L174–242；[projection](../../../../../../packages/task-protocol/src/projection.ts)，L50–51、L156–158 | 存储结构、权威 checkpoint、原请求索引、删除/压缩及 TaskRecord 投影 |
| E6 | [Server 组装](../../../../../../packages/task-engine-server/src/index.ts)，L153–165、L227–241 | 可信 Engine/handler 组装与启动，无定期 collect 安排 |
| E7 | [Engine tests](../../../../../../packages/task-engine/test/engine.test.ts)，L362–474；[HTTP tests](../../../../../../packages/task-engine-http/test/http.test.ts)，L116–180 | 手动 collect、事件页边界/恢复、旧版本恢复、过期 cursor 和每次读取授权 |
| E8 | [SQLite tests](../../../../../../packages/task-engine-storage/test/storage.test.ts)，L64–102 | 索引/事务、持久事实与投影一致、独占 Store 约束 |

本轮探针证明缺口与可复用路径；上述已有测试给出回归依据。拟议新列表的测试尚未编写或执行，不能据此把 ledger 的实施/部署项勾选。
