# Task Engine

Task 是需求；Run 是包含 preparation、allocation 和 execution 的完整尝试。
Execution 仅表示类型内部的实际业务执行。Task 不独立准备，类型内部资源池和 Bundle 调度不属于
Engine 的业务知识。

## 协议与共享

请求使用 `matchPolicy`，类型为 `MatchPolicy`：

- `started-after-eligible`：Run 的开始事件不早于 Task 的实际 eligible。
- `terminated-after-eligible`：Run 的逻辑终结事件不早于 eligible。

实际 eligible 是请求值与接收时间的较大值。接收的持久化顺序必须先于匹配事件；
不倒查接收前已终结的 Run。deadline 是独立等待预算，不是所有结果的匹配上界。
单个 Task 取消不取消其他需求共享的 Run；最后需求撤回、独立 Run wall limit 或资源压力可终结
Run，逻辑终结与物理回收分别记录。

兼容性保持原 Input Schema 的结构投影、类型/版本、契约、环境及 scope 边界。
未声明、被投影忽略的输入字段不能承担业务身份或授权语义。浮动 URL 可共享 Run 已固定的旧内容，
不保证最新；需要精确版本时在 Input pin digest。

## 类型隔离

Host 注册 `RegisteredType`：静态 type/version/environment、inputSchema/resultSchema/messageSchema、
本地模块 URL、factory 导出名及 JSON configuration。Engine 不导入或调用动态 TaskType 代码。
模块在独立类型守护 Worker 中初始化；守护可管理多个 Run，取消投递指定 Run，不杀整个类型。

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
Crash/卡死使相关 Run 失败并记录未知清理/副作用；新需求可按需建立新代际，
不自动重跑旧 Run，也不将重启当作回收成功。

## 输出与证据

RunProgress 严格为 `{stage, percent?, message}`；stage 是 preparation/allocation/execution，
percent 必须有限且在 0–100，缺失表示未知，允许阶段切换和估计回退。
进度不控制匹配、调度、成功或回收。确认在验证及 Store 持久化后返回，不等待订阅消费。

`checkpoint(Json)` 是独立结构化证据通道，按类型 resultSchema 验证，不是 Progress 文本。
内容、Bundle bytes/digest 和因果证据可在准备后、分配前持久化，Crash 后仍能复验；
checkpoint 不恢复调用栈、不授权重跑，不能冒充最终结果。输出按 Run 串行且有界。
最终 Result 与历史证据由原类型 Worker 的 `verifyExportName` 例程复验；
例程必须纯验证，不允许借用活动资源能力。同步查询读取已经复验的持久事实。

Check 最终成功为 `{result, evidence:{prepared, execution, businessProgress}}`；
Probe 保留 observation、references、operations，并在 evidence 中包含 prepared 和 parentRunId。
失败 Result 使用明确的 `{failure, evidence}` 分支，不返回成功形状。
晚于逻辑失败的业务输出可作为 `run.evidence` 留存，不改写已终结的主结果、不复活 Run。

## 运行消息

`sendTaskMessage(taskId, messageId, payload, caller)` 与 `getTaskMessage` 使用独立 `message` 服务授权。
HTTP 为 `POST/GET /tasks/:taskId/messages/:messageId`；POST 正文仅含 payload。
入队返回 queued，不冒充业务接纳。类型从 messages 取出可信 taskId/messageId/caller/payload，
使用 accept/reject 确认；确认后才可发生业务效果。消息有本地 Task signal，取消/期限撤回不伤其他需求。

仅路由已绑定且已经投递的当前 Run。未绑定 terminated-policy Task 明确拒绝 no_run_route；
不广播、不伪造绑定、不自动开启 Run。相同身份/意图返回原状态，改写载荷或 Caller 为幂等冲突。
接纳/拒绝/未知持久化；取消、终结或失联的未确认消息不被假装接受。
accepted 表示接纳决定，不保证实际消耗，跨 Crash 不承诺 exactly-once，不自动重投未知操作。
消息不改原 Input、不延长期限、不复活终结；目标修订应创建明确的新 Task。

当前没有通用 Regulator TaskType 注册。本通道不实现新的 Regulate 记账系统；
治理消费者须自行定义贡献、未使用投入撤回及效果证明，不能拼接权限或覆盖共享需求目标。

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

## 破坏性边界

Facts projection 与 SQLite `user_version` 为 3；旧版本和混合格式明确拒绝。
使用新的数据库路径，不迁移、覆盖或删除用户数据库。旧 `executionMatch` 请求明确拒绝。
旧 `/executions` 目录与 `executionId` 查询不提供兼容别名，必须升级所有直接消费者。
原业务类型工厂名称仍存在，但返回静态注册项，不再返回宿主可执行的 TaskType。
