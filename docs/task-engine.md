# Task Engine

Task 是需求；Run 是包含 preparation、allocation 和 execution 的完整尝试。
Execution 仅表示类型内部的实际业务执行。Task 不独立准备，类型内部资源池和 Bundle 调度不属于
Engine 的业务知识。

## 协议与共享

请求使用 `matchPolicy`，类型为 `MatchPolicy`：

- `starts-after-eligible`：Run 的开始时间不早于 Task 的实际 eligible。
- `terminates-after-eligible`：Run 的终结时间不早于 eligible；after 均包含等号。

实际 eligible 是请求值与接收时间的较大值；deadline 是其加 timeoutMs，生效区间两端包含等号。
stage、canceled、按当前 now 推导的 pending/eligible/timeout 三维独立，取消或终态不冻结时间。
匹配由源前缀推导，选择满足条件的严格 Run 开始序号最早者，不新增 Task 绑定事务。
Run 已开始未终结时，可在可信源边界证明 terminates 条件；既定匹配不因回拨、停止或较小退出墙钟撤销。
单纯越过时间边界及 GET 不写事实，允许 initial+eligible 直到协调处理。
真实源事件不足以证明新资格时，协调器仅提交载荷含 observedAt 的 qualification-time-observed，
一次源事实可以影响多个 Task；没有新资格时不造 tick 日志。
单个 Task 取消不取消其他有效已匹配需求共享的 Run；pending、已过期或已取消需求不保护 Run。
停止请求排除新匹配，但只有 Worker 接纳停止才进入 stopping，实际退出才终结，回收另需宿主证明。

兼容性使用绑定 Input Schema 生成的结构 Equals 比较原 Input，并保持类型/版本、契约、环境及 scope 边界。
允许但未纳入 Schema 结构的额外字段不参与 Equals；明确纳入或 schema-valued 字典字段按编译器规则参与。
不比较 Prepared，也不把 requestId 的完整原始 Request 幂等比较混入共享判等。
浮动 URL 可共享 Run 已固定的旧内容，
不保证最新；需要精确版本时在 Input pin digest。

## 类型隔离

Host 注册 `RegisteredType`：静态 type/version/environment、inputSchema/resultSchema/messageSchema、
本地模块 URL、factory 导出名及 JSON configuration。Engine 不导入或调用动态 TaskType 代码。
每个完整 Run 使用独立 Worker/模块堆；同类型守护是隔离 Worker 的有界管理入口，
取消或强杀指定 Run 不影响同类型其他 Run。历史业务复验使用独立的纯复验 Worker。

模块 factory 返回最简 `TaskType<Input, Result, Message>`，只提供三份 schema 和
`run(input, context)`。messageSchema 必选，`false` 表示 Never；`{}` / `true` 接受任意 JSON。
RunContext 在守护本地构造：可信 runId/scope/signal、progress、checkpoint 和必选 messages。
默认不共享可变内存，不继承主线程环境或 execArgv，不提供 Engine 对象或完整状态。
Checker Bundle 仍在独立业务 Worker，不与类型代码混堆。这不是 OS 安全沙箱。

Host resource bridge 只承载明确的实际资源动作；不能用它代理类型生命周期。
调用必须持有本地真实 RunContext 能力，不能以用户提供的 ID/对象借用别的 Run。
资源权限、容量、替换、owner/reclaim 由可信宿主配置，业务消息不增加 Agent 权限。

模块位置验证为本地普通文件，拒绝远程 URL、查询和片段；模块 digest 纳入契约身份。
守护健康、旧代际、单调请求序号、在途容量和生命周期均在边界验证。
无可靠结果的停止退出为 stopped，无停止意图的意外退出为 failed；可靠成功/失败优先于停止意图。
重启时已开始而无退出事实的 Run 恢复 stopped，物理退出、清理及副作用仍未知；
未开始的有效 Task 继续协调，不重演已开始的 Run，也不将重启当作回收成功。

## 输出与证据

RunProgress 严格为 `{stage, percent?, message}`；stage 是 preparation/allocation/execution，
percent 必须有限且在 0–100，缺失表示未知，允许阶段切换和估计回退。
进度不控制匹配、调度、成功或回收。确认在验证及 Store 持久化后返回，不等待订阅消费。

`checkpoint(Json)` 是独立结构化证据通道，按类型 resultSchema 验证，不是 Progress 文本。
内容、Bundle bytes/digest 和因果证据可在准备后、分配前持久化，Crash 后仍能复验；
checkpoint 不恢复调用栈、不授权重跑，不能冒充最终结果。输出按 Run 串行且有界。
最终 Result 与历史证据由原类型 Worker 的 `verifyExportName` 例程复验；
例程必须纯验证，不允许借用活动资源能力。同步查询读取已经复验的持久事实。
成功与 `RunFailure.result` 都执行相同的 terminal 业务复验，
checkpoint 也验证返回值不可改写。复验前固定原内容，拒绝返回不同内容及原地改写。
失败证据被拒绝时不保存/公开该 Result，但保留原业务错误和清理未知语义；
合法失败 Result 保留并在恢复时按原类型再次复验，不用删除全部失败证据回避校验。

Check 最终成功为 `{result, evidence:{prepared, execution, businessProgress}}`；
Probe 保留 observation、references、operations，并在 evidence 中包含 prepared 和 parentRunId。
失败 Result 使用明确的 `{failure, evidence}` 分支，不返回成功形状。
可靠 outcome 不等于终态；只有实际 Worker 退出才公布 completed/failed/stopped。
退出后信道关闭，迟到结果、证据及排队回调不得更新旧 Run 或复活状态。

## 运行消息

`sendTaskMessage(taskId, messageId, payload, caller)` 与 `getTaskMessage` 使用独立 `message` 服务授权。
HTTP 为 `POST/GET /tasks/:taskId/messages/:messageId`；POST 正文仅含 payload。
入队返回 queued，不冒充业务接纳。类型从 messages 取出可信 taskId/messageId/caller/payload，
使用 accept/reject 确认；确认后才可发生业务效果。消息有本地 Task signal，取消/期限撤回不伤其他需求。

仅路由已事实匹配且已经投递、仍有效的当前 Run。尚无唯一活动路由的 Task 明确拒绝 no_run_route；
不广播、不伪造绑定、不自动开启 Run。相同身份/意图返回原状态，改写载荷或 Caller 为幂等冲突。
接纳/拒绝/未知持久化；取消、终结或失联的未确认消息不被假装接受。
accepted 表示接纳决定，不保证实际消耗，跨 Crash 不承诺 exactly-once，不自动重投未知操作。
消息不改原 Input、不延长期限、不复活终结；目标修订应创建明确的新 Task。

当前没有通用 Regulator TaskType 注册。本通道不实现新的 Regulate 记账系统；
治理消费者须自行定义贡献、未使用投入撤回及效果证明，不能拼接权限或覆盖共享需求目标。

## 宿主资源回收证明

类型发出 released 只关闭新消息/动作路由，不直接成为物理回收事实。
宿主按 Run/Worker 代际跟踪已经启动的资源请求，要求它们结束后才处理回收证明；
插件没有 await 的请求同样计入。取消使资源 signal 中止，但中止信号不证明动作已经结束。
旧代际请求保留唯一跟踪 token 和容量占用，迟到 finally 不会删除新代际同数字 ID 的请求。

资源动作的可信 `RunResourceContext` 包含 runId/scope/signal/workerGeneration。
只有宿主明确保证所有动作仅在请求期间存活，才能声明 `resourceLifetime: "request"`；
否则必须提供 `confirmResourceRelease(context)`，缺少声明/证明明确拒绝注册。
回调返回 Json/资源句柄不证明所有外部副作用消失。拥有跨请求资源的适配器必须证明
实际 owner/句柄已经释放；Probe 的宿主桥独立等待其子需求物理释放，并按 Run/代际隔离所有权。
该回调是可信资源适配器的证明，不是恢复动态 TaskType 的通用生命周期 hook，不传入 Worker。

资源请求及证明等待受 Supervisor 的 healthMs 限制；超时、证明拒绝或失联保持
reclamation_unknown，不报告 reclaimed，也不自动重跑。已启动但未结束的请求/证明继续占用
有界容量，close 明确失败而非无限等待；它们迟到结束不会复活旧回收状态。
请求结束只满足请求级生命周期约定，不承诺撤销任意 OS/网络副作用。

## 授权目录与查询

`listRuns` / `GET /runs` 直接投影完整 Run，不扫描本机观察到的 Task 或事件来猜测目录。
独立 `list-runs` 权限与 Task `list`、历史、取消和消息权限互不授予；
scope 及每条记录的历史身份在新查询和冻结分页时重新授权。摘要只包含标识、类型、版本、
开始/终结/回收时间与状态，不泄漏 Input、Result、checkpoint、owner 或资源细节。
按 type 和 startedAt 的含下界、不含上界筛选，started-desc 排序，同刻按 runId 升序；
准备中、分配中也是已开始 Run，兼容共享只计一条。查询快照成员和状态冻结，
Task/Run/事件游标域独立；过期、预算超限、历史清理或重启明确报错，不返回成功形状替代。
`GET /tasks?runId=…` 查询已绑定且当前 Caller 可读的关联需求，不冒充所有 owner 的统计。
UI 保留并发主线的独立 Tab、抽屉、焦点与 glyph 控件，只将事实与授权接口对齐 Run。

## 十二项操作与源观察

- `submit`、`cancelTask`：受理及撤回；终态后首次取消仍记录事实，重复取消返回 changed=false。
- Task：`getTask`、`getTaskHistory`、`subscribeTask`、`listTasks`、`subscribeTasks`。
- Run：`getRun`、`getRunHistory`、`subscribeRun`、`listRuns`、`subscribeRuns`。
- 配套保留 `discoverTypes`、`getRequest`、Task messages 以及明确的历史别名；
  Task 历史不混入 Run progress 或消息载荷，Probe 通过独立 Run 查询/历史核验实际环境。

数据域只有一个源 revision；快照、空/非空集合及历史页面均标明覆盖位置。
页面冻结成员、顺序、摘要和观察时间；完成全部分页后，从该 revision 补读增量，不以分页 cursor 代替源锚点。
集合只接受事实字段筛选，不接受 pending/eligible/timedOut 等时间推导条件。
一次源事实的全部 joined/updated/removed 成员封装后原子应用，完整应用前不得推进 revision；
中断可重投整个封装，不能按相同 sequence/revision 丢弃其中兄弟成员。
未知/跨域/未来/过期锚点、字节/扫描/慢消费超限均明确失败，不返回部分成功冒充完整集合。
SSE task.error 不携带 id；容量错误给出最后完整 revision，客户端可重建完整基线或调整明确预算后继续。

Task updatedAt 取最后改变其可见事实的源位置的时间，Run progress 不更新 Task；
回拨不以最大墙钟时间掩盖后来的事实。查询与标签变化本身不更新实体或制造见证。

`defaultEngineLimits` 公开具体预算：窗口 86,400,000ms、未来偏差 60,000ms、保留期 86,400,000ms；
停止宽限/强制退出等待均为 5,000ms；默认分页 100、最大分页 1000、页字节 65,536、
扫描 10,000、查询视图 64、查询缓存 8,388,608 bytes、查询寿命 60,000ms；
单源封装最多 1000 变化/65,536 bytes，订阅缓冲 64 个源事件/1,048,576 bytes、订阅数 128。
超限是可观察失败，不是提高预算、删除数据或自动切换域的授权。

## 持久准入

Request ULID 时间须位于 `[L, now+futureSkewMs]`，两端包含等号；
`L=max(持久旧L, now-windowMs)` 只前进，在幂等查重前验证，重启、配置扩大及墙钟回拨不使其退回。
原始 Request 的遗漏字段保留；同身份同意图只受理一次，不同意图明确冲突。
Task 明细清理不丢弃仍可受理 ID 的凭据，配套 getRequest 可读取其原意图；
重复提交不能凭此重建已清理的 Task，必须使用显式的新 requestId。
源前缀重放核验物化 facts，Task/Run 缓存不成为另一份独立权威。

## 破坏性边界

Facts projection 与 SQLite `user_version` 为 4；旧版本和混合格式在写入前明确拒绝，旧库原字节留存。
使用新的数据库路径，不迁移、覆盖或删除用户数据库。旧 `executionMatch` 请求明确拒绝。
旧 `/executions` 目录与 `executionId` 查询不提供兼容别名，必须升级所有直接消费者。
原业务类型工厂名称仍存在，但返回静态注册项，不再返回宿主可执行的 TaskType。
