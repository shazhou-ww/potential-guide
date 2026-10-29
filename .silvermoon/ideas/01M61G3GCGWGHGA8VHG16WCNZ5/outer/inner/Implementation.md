# Implementation

实现说明与边界见[implementation-contract.md](./implementation-contract.md)，
旧候选运行证据见[verification.md](./verification.md)。
本次按用户要求修订 Ideal，以下为准备阶段的实施种子，不授权开始代码修改；
旧证据不证明[Request 生命周期修订](./ideal/request-lifecycle-revision.md)已实现。

## Steps

### I-S01: 演进制品契约与工具链

保留 YAML、统一结果、References、语言、runtime 与准确摘要契约；
由服务配置 Task 准备路径的提前选版预优化和显式 fallback，默认无预取/回退；
普通 Probe 不重复传根/静态 Checker bindings，服务记录动态依赖的准确选择，
不把调度属性写入制品或改变历史摘要。
成功选版记录 preparation.resolution=up-to-date/fallback/updated，取代 fallbackUsed；
准确 artifactRef 与选择方式同时确定，未成功时不伪造默认方式。

### I-S02: 服务化 Objective 观察

在可挂载服务中落实统一 eligible、PENDING、递归规划与唯一 pending 仲裁，
恢复所有未完成 Task，保持独立需求、共享执行及资源清理边界。
落实幂等 Request/独立 Task 身份、eligible 后 PREPARING、eligible/terminated 递归、
失败超时续作及错过周期不补齐；恢复细节后续讨论，不以实现细节代替设计决定。
eligible 后继保持原节拍，取严格晚于本次规划时刻的第一个周期点，
不以处理/执行时间重置节拍；已规划后继不因旧轮超时重复生成或改期。
任意抽象 Task 的 prerequisites 用独立子 Check 求值，时间与条件分别仲裁；结构化治理需求交由
Coordinator 按授权处理，完成治理后重查，服务保留 origin 因果审计。
按时间、artifacts、prerequisites、执行资源优先级投影
所有 Task 的 pending/preparing/blocked/queued/running；当前 Check/Probe Request
不接受 prerequisites，因此不从这些入口创建带条件任务，但不裁剪 Task 状态模型。
仍保留探测结果的动态 requirements。pending 无专属 reason。

### I-S03: 对齐 SDK 与现有业务入口

对齐 Check/Probe HTTP、进程内接口、SDK 及现有 Regulation/Coordinator 的请求语义，
周期任务配置统一使用 `recurrence`，建立全新、不兼容的请求与任务协议；
Regulation 调用方改用与 Probe 相同的 Objective URL/digest 引用，由服务构造内部 PilotSpec；
实体必含 requestId，HTTP 从 header 还原并先于 body 解析识别；生成型身份采用 ULID。
提供 series 动态事件和可恢复身份，不以旧协议兼容要求约束新结构。
Task snapshot 在 HTTP/SDK/事件中统一为 stage 与可选 canceledAt 的合法组合，
移除独立 state 与公共 hostInstance；
按[任务状态模型](./ideal/task-state-model.md)落实条件判定树与协议语义分类，
提供 deriveState(snapshot)、isFailed(snapshot)/isTerminated(snapshot) 等公共纯函数，
不新增 substate 或重复布尔字段，未知 stage 与不合法取消组合显式失败。
核心过程事实按 preparation/readiness/allocation/execution 分组，终结用 termination；
receivedAt/eligibleAt/deadlineAt 放顶层，不用 schedule 包装。快照不复制请求体、
freshness 或 recurrence；按 requestId 查询原始 Request，保留失败请求的审计能力。
Request.prerequisites 保留声明语义，失败原子同步采用 readiness_failed/allocation_failed。
过程可重叠，开始时间不冒充阶段转移时间；删除 snapshot 的 progress 与数字 revision，
使用 stage、canceledAt 和本次服务端技术时间 timestamp。详细进展通过事件查询，不在过程里另建同义状态字段。
内驱树只覆盖无外部控制的推进；全部非终态支持取消，裁决记录 task.canceled，
在取消生效边界冻结 stage 与已有事实，时间推进和迟到执行结果不复活该 Task。
取消尽力释放该需求资源，不保证停止实际执行，不伤其他共享 owner；
撤销未消费的后继规划权，不撤回已建立的后继，不因取消再规划下一轮。
所有有序事实视图的后继（含终结/恢复）继承既有事实，timestamp 不属于原值继承的业务字段。
根及独立查询的子 Task snapshot 都仅携带准确 artifactRef，完整 Artifact 按 digest 单独查询，
不得用 latest 替代原内容或用 manifest 代替实际执行证据。
结构化历史事件作为证据事实源，增加 taskId/executionId/seriesId 过滤和游标分页读取；
与 SSE/快照同源，共享 Execution 证据不按 Task 重复存储或展开。
按[事件与快照投影](./ideal/event-projection-model.md)对齐过程事件，
snapshot 由一致事件前缀归约并按显式服务端时间投影；
task.updated 不作为事实输入，重放不触发执行、外部检查或后继规划。
业务输入沿用 subject/context，prerequisite 输入遵守各 Check 契约；
execution.progress.data.progress 取代引擎专用的子 Task 关联事件，
execution.completed.data.result 与失败事件 data.error.details 由业务协议校验，
引擎负责通用载荷限制与隔离，不解释业务依赖或自动治理；暂不新增 metadata。
去掉 result 中的重复根引用、bindings 汇总和机械 gapSummary；
快照事件身份只保留一处，Task 终结引用 Execution 结果事实，缓存投影不独立维护真相。

## Acceptance criteria

### I-AC01: 内容与协议准确

固定向量与 Git SHA-256 oracle 一致；schema、未知问题、目录语言与篡改反例证明无静默转换或内容替换。
通过准备/fallback 反例证明选中的是仍可用的准确版本，更新错误可观察，
显式 digest 不被替换，业务失败不触发回退。
覆盖既有版本经确认、本次获取及回退三种 resolution，验证有缓存不等于已确认新鲜、
updated 不要求 digest 改变，后继快照和选版历史事件使用同一选定方式。

### I-AC02: 任务时序与进展可靠

确定性时间与竞争测试证明 eligible、递归锚点、唯一 pending、取消/激活竞态及
freshness 归并成立；故障恢复测试证明不重复规划、不刷新期限、不复活终态。
覆盖 eligible 准时、跨多个周期延迟及恰好到点的选点，
验证原节拍对齐、严格未来、跳过历史轮次，且与 terminatedAt + period 的模式明确区分。
条件等待测试证明父 Regulation blocked 不阻塞条件子 Check、eligible 后等待消耗预算，
检查故障不冒充不通过、治理结束不冒充条件通过，取消清理不伤共享 owner。

### I-AC03: 调用面一致

Router、SDK、Pilot/regulator 与 Coordinator 的 series 订阅和持久恢复测试通过，
覆盖新轮次动态加入及授权边界；最终执行 pnpm check，不以旧 gate 或类型检查替代运行证据。
组合 schema/运行校验证明派生 completed 必有结果、未取消 pending 不带父 Execution，
各失败叶子继承其路径要求的事实；提前获取不伪造状态转移时间。
覆盖统一 Task 的 stage/canceledAt 组合、派生状态和 failed/terminated 分类，另测各 Request 入口的准入边界，
拒绝当前探测请求的 prerequisites（含空集合），但统一 Task schema 允许有条件任务，
不能按 checker/objective 类型拒绝 blocked；同时保留业务动态 requirements；
初始已 eligible 不返回 pending，元数据从快照移除后仍能
通过准确引用查询原制品；事件中的 snapshot 不携带 manifest 或完整 evidence。
验证未订阅 SSE 也可查询准确 runtime、选版错误与子任务关联，
并覆盖独立历史游标、分页边界及共享执行的授权隔离。
用事件重建快照验证同一前缀/时间的确定性、checkpoint 加后缀与完整归约等价，
同刻事实按读取边界区分；重复投递不重复生效，未知类型或必要事实缺失须显式失败。
验证业务 progress 可通过历史读取而不改变通用快照，载荷同名字段不覆盖外壳；
正常业务不通过仍为 completed，失败详情可查询且不伪造结果，非法/超限载荷显式报错。
验证 Check 统一输出协议未被任意作者 schema 替代，subject/context 的行为差异影响兼容匹配，
共享历史不泄露其他 owner 的业务输入或详情；业务关联不自动建立调度依赖。
验证快照结果可由执行事实投影，动态依赖的业务引用不会被误删，
Before 对照与新设计的派生缓存职责明确，避免身份和调度参数多份可变真相。
增加跨快照校验：事实叶子路径不丢失、值不变、无 progress/revision；
覆盖无写入跨 eligible 的不同读取状态、同刻时间不能直接去重及技术时间不伪造工作事实；
未取消 Task 的时间资格仅为 t >= eligibleAt，覆盖边界前、恰好到点和边界后，
不依赖调度确认或资格通过事件，所有快照（含失败分支）不含 eligibility 分组；
用删除已知事实、改名、改值和失败分支丢失执行身份的反例验证，而非只测单个状态 shape。
验证所有 After snapshot（含事件和缓存视图）不含 schedule 或请求策略，
Request 查询保留原始省略语义，Task 有效期限不被默认值回写污染。
明确区分 execution.startedAt、Task 正式绑定时间和 termination.terminatedAt；
不得靠状态名后缀推断语义分类，未知原子状态显式失败。
取消测试覆盖五个非终态、pending 取消后跨 eligible、running 取消后共享执行完成、
重复取消保留原 canceledAt、终态取消冲突及原子竞争；冻结位置不得取过时缓存。
取消后的 stage 不再用于活跃计数或占槽：验证 pending 槽位及该 Task 的执行需求正确释放。
取消快照不输出 state、重复 terminatedAt 或 lastStage；非取消诊断位置由 lastState 改为 lastStage。
完整归约与增量恢复必须重建相同取消边界，不以取消请求收到时间代替生效事实。
