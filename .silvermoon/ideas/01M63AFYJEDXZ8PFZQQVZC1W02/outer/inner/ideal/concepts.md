# 关键概念与生命周期

本文定义[通用任务引擎](./Idea.md)的概念、约束与待决问题。
它是新设计的直接定义，不是现有运行时已具备这些能力的声明。

## 1. 对象与身份

| 概念 | 定义 |
|---|---|
| Request | 不可变的调用意图，必含 requestId 与类型判别字段 type；解析或准入失败可不产生 Task |
| Task | 一次已受理需求，独立 taskId，拥有有效时间约束、过程事实与取消/终结裁决 |
| Execution | 实际工作及其结果，一个执行可服务多个被允许共享的 Task |
| Series | 递归需求的关联身份；默认首个 Task ID，后继继承；不是一个永不终结的 Task |
| 任务类型 | 宿主注册的具体输入和行为契约；type 字段是通用的，字面值集合属于应用组合层 |
| 条件 | 调用方声明的启动前提；被求值的业务谓词，不是某个 Task 结束的默认别名 |
| 事件事实 | 已发生且可审计的事实，有固定归属与稳定读取位置 |
| Snapshot | 事件事实的一致视图按技术时间投影出的有界读取结果，不是可独立修改的存储真相 |

公共生成型身份使用规范 ULID，类型名与业务名称可读，digest 不充当 ULID。
HTTP 的 Idempotency-Key 表达 requestId；进程内 API 直接接收完整实体。
幂等比较包含 type 和实际意图；同一幂等身份换 type 是冲突，不新建另一类 Task。
类型、调用作用域及原始省略语义应可恢复；请求查询不把默认值反写到原始输入。

## 2. 时间约束与内驱推进

Task 受理时形成 receivedAt、有效 eligibleAt、deadlineAt。
eligibleAt 默认等于 receivedAt，也允许早于或晚于它；timeoutMs 的锚点是 eligibleAt：

```text
deadlineAt = eligibleAt + timeoutMs
时间条件满足 = t >= eligibleAt
```

到点不要求单独的 eligibility 过程或事件。时间可改变投影，不可伪造工作开始事实。
时长必须有限且满足协议约束，时间运算溢出须显式拒绝，不能退回无限预算。
等待准备、条件和资源都消耗同一预算；超时重试、恢复或取消不能刷新旧 Task 期限。

### 内驱判定树

```text
时间条件
├─ 未到 → pending
└─ 已到
   └─ preparation
      ├─ 未准备好 → preparing
      ├─ 最终失败 → preparation_failed
      └─ 可用
         └─ readiness
            ├─ 未满足/求值中 → blocked
            ├─ 最终失败 → readiness_failed
            └─ 满足
               └─ allocation
                  ├─ 等待资源或执行机会 → queued
                  ├─ 最终失败 → allocation_failed
                  └─ 实际执行
                     ├─ 进行中 → running
                     ├─ 执行故障 → execution_failed
                     └─ 正常完成 → completed
```

树只解释无外部控制时的内驱位置 stage，不是所有实际转移组成的严格树。
各过程允许重叠；已满足的门限可跳过，不伪造过程开始/通过事件。
条件 false 是等待，不是求值故障；正常业务结果“不满足”仍是 completed。
类型适配器的临时失败是否重试由明确政策决定，不能直接把所有异常转成最终失败。
空条件集合直接满足，不强造 readiness.satisfiedAt。

### stage 与实际状态

Snapshot 不输出独立 state；提供 stage 和可选 canceledAt：

```text
deriveState(snapshot) = canceledAt 存在 ? cancelled : stage
isFailed(snapshot) = 派生状态属于协议失败集合
isTerminated(snapshot) = 派生状态属于协议终结集合
```

| 派生状态 | failed | terminated |
|---|---|---|
| pending / preparing / blocked / queued / running | false | false |
| completed | false | true |
| preparation_failed / readiness_failed / allocation_failed / execution_failed | true | true |
| timed_out（暂定保留在 stage） | true | true |
| cancelled（仅由 canceledAt 派生） | false | true |

未知 stage 或非法组合必须报错，不靠字符串后缀分类。
取消只能与五个非终结 stage 组合，不能给 completed/failed/timed_out 追加 canceledAt。
超时最终如何挂接内驱树尚待决策；暂不新增 timedOutAt，也不把到 deadline 等同于已发生的终结裁决。

## 3. 取消与实际执行

全部非终态 Task 可取消，不限于 pending 或 eligibleAt 之前。
取消请求到达不等于取消生效：核心以一致事实边界原子裁决，成功后记录 task.canceled。
canceledAt 是生效时间；stage 按当时的事实及时间计算并冻结，不沿用客户端旧快照。

取消后：

- Task 投影保留取消边界已有的过程和执行事实，stage 不再随时间或执行结果变化。
- timestamp 仍表示本次读取的技术时间；不复制 termination.terminatedAt/lastStage。
- pending 取消后不占 pending 槽位，running 取消后不再作为活跃执行需求 owner。
- 共享 Execution 可继续服务其他 Task；最后 owner 释放时尽力停止，不保证可中断或回滚外部副作用。
- 迟到的执行完成只进入 Execution 历史，不让取消 Task 得到成功 result。
- 重复取消返回原事实；已由其他原因终结则明确冲突，不覆盖结局。

完成、失败、超时与取消必须产生唯一终结裁决。具体同刻优先级在实施前确定，
不能仅按客户端时间或事件名称排序。外部控制在判定树之外，但在事实模型之内。
Task 取消不是取消整个 Series；治理依赖的取消传播由业务所有权规则决定，不靠进展字段自动推导。

## 4. 递归系列

recurrence 使用正周期 periodMs 及显式 anchor；本草案示例不依赖尚未决定的默认锚点。

| anchor | 规划时机 | 后继 eligibleAt |
|---|---|---|
| eligible | 本轮资格被处理时消费一次规划权，不等准备或业务成功 | 原节拍上严格晚于本次规划时刻的第一个点 |
| terminated | 本轮正常、失败或超时终结 | terminatedAt + periodMs |

eligible 模式设本轮 e、周期 P、规划时刻 t >= e：

```text
nextEligibleAt = e + (floor((t - e) / P) + 1) * P
```

错过多轮不补历史 Task、不重置旧轮预算；e=10:00、P=60 秒、t=10:05:20 时取 10:06，
恰好在 10:06 规划则取 10:07。已规划过后继不因旧轮后来超时重新选点。
后继是新 Request/taskId，继承类型与系列；条件和业务输入如何继承必须遵守类型及准入政策。

同系列最多一个派生 state=pending 的 Task。已有 pending 时保留旧项，
冗余新项记录取消事实。原子规划不能先覆盖旧项再回滚。
唯一 pending 不等于最多一个未完成 Task：blocked/running 等仍受容量预算约束。
取消撤销尚未消费的规划权，不因取消再生后继，也不回溯取消已建立的后继。
读取/reduce 重放不执行规划副作用，命令重试与恢复不能重复生成同一轮。

## 5. 事件、投影与所有权

```text
F(W) = reduce(一致边界 W 内的必要事件)
Snapshot(W, t) = project(F(W), t)
```

W 包括目标 Task 和它引用的必要 Execution 事实，不是按 occurredAt <= t 随意拼装。
同一前缀、投影规则及 t 产生相同结果；允许 checkpoint 加后缀替代全量重放。
reducer 不运行任务、不访问网络、不读取当前可变配置、不创建新 Request。
stage 是投影，canceledAt 是固定事实；取消时使用当时边界而非最新共享执行结果。

通用事件目录：

| 事件 | 所有者与事实 |
|---|---|
| task.created | 有效身份、时间与必要的不可变请求引用 |
| task.preparation.started / completed / failed | 准备过程事实；完成记录可包含类型定义的内部准备结果 |
| task.readiness.evaluated / satisfied / failed | 条件求值、正式采用证据或最终故障，不复制业务结果树 |
| task.allocation.bound / failed | 正式绑定执行或最终分配故障 |
| execution.started / progress / completed / failed | 实际执行生命周期及业务载荷 |
| task.terminated | 非取消终结裁决，成功引用 Execution 结果 |
| task.canceled | 外部取消生效及冻结位置 |
| task.updated | 派生快照通知，不是 reducer 输入事实 |

类型业务载荷由协议校验，引擎限制有限 JSON、序列化字节数、资源和可见范围。
业务字段不能覆盖外层身份/时间/type，不因出现 childTaskId 或 requirements 就自动治理。
共享执行结果只存一份；Task 的 result 由执行事实与本 Task 的成功终结裁决投影。
事件身份/位置用于重复投递处理，不按相同时间戳或相同 payload 去重。
分页、订阅交接和历史保留必须显式定义；历史缺失不得伪装为空结果。

## 6. 一致性、权限与恢复

准入幂等、终结裁决、系列占槽和规划权消费需要存储端口提供明确的原子边界。
类型代码只能报告事实/结果，不能直接修改 snapshot 或任意提交终结事件。
存储承诺的成功受理必须可在其声明的持久范围内恢复；内存模式须显式说明不能跨进程恢复。
业务回放和调度恢复分开：先重建事实，再由协调器按已确认政策恢复工作。

同进程身份也必须经核心授权，不以“内部调用”为理由绕过访问边界。
共享兼容至少受类型、执行版本、业务输入/上下文与权限域约束；
未声明支持共享的类型不能仅因相同输入复用带副作用的执行。
大载荷、错误详情、关联 Task 查询都遵守来源作用域，业务 ID 不是访问凭据。

### 实施前决策

1. **终结仲裁：** deadline 与完成/取消同刻如何决定，timed_out 如何挂接内驱模型。
2. **条件有效性：** 采用证据的有效期、重查、失效、重试边界，以及递归条件继承。
3. **执行恢复：** 崩溃时 running 如何处置、幂等副作用和外部执行引用的责任；不默认自动重跑。
4. **存储与流：** 本地持久实现的介质/事务、跨 Task/Execution 读取边界、保留、分页水位与 SSE 续读。
5. **类型演进与资源：** 类型契约版本、准备结果保留、共享兼容标识、容量满时的明确处置。
6. **递归默认值：** 默认锚点及长期积压限制；原节拍选点和取消不续作已经定义，不重新开放。

这些决策不能用静默默认值掩盖；它们不阻止先评审分层与接口方向，
但相关正确性未收敛前不得将该能力标为已实现或已验收。
