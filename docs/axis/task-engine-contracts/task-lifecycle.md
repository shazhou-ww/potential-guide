# Task 生命周期与三维状态

本契约界定 Task 的三维状态及生效、超时、取消行为，避免将内部推进、外部控制与时间条件混为单一状态。

关联 [职责入口](../task-engine-responsibilities.md)：A1 的受理后行为、A2 的取消效果，以及 B1–B5、C1–C5 中可观察的状态、历史与事件。

## 核心概念：Task 的三维状态

Task 状态由三个独立维度共同表达，不合并为单一互斥状态枚举。

| 维度 | 取值 | 含义 |
| --- | --- | --- |
| 内部推进阶段 | `initial`、`running`、`stopping`、`stopped`、`completed`、`failed` | 未匹配时为 `initial`，匹配后对应关联 Run 的生命周期 stage |
| 外部控制状态 | `canceled: false`、`canceled: true` | 分别表示未取消、已取消；未取消不代表未完成、未超时或仍需调度 |
| 时间状态 | `pending`、`eligible`、`timeout` | 根据当下时间与生效时间、超时期限推算，不单独存储状态字段 |

时间维度只记录时间边界，取消或 Run 终结均不冻结其推算。
代码逻辑分别判断三个维度，不以 UI 聚合标签代替实际条件。

1. stage 只表达 Task 的内部推进位置，不包含 `pending`、`canceled` 或 `timeout`。
2. 取消与时间条件可以约束后续推进，但不能伪造已开始、已终结或已回收的事实。
3. 超时与成功或失败可以同时成立，不因超时自动判定无结果。
4. 生效、超时到点本身不产生事件；当前状态由事实与时间共同确定。
5. 匹配后 Task stage 与关联 Run 的生命周期 stage 一一对应，但不采用 Run progress 中的准备、分配、业务执行阶段；未匹配时保持 `initial`。
6. stage 与匹配关系依赖已提交的资格观测事实，而时间维度仍依赖当前 now；
   因此在协调器处理前允许 `initial + eligible`，处理并形成匹配后即使 now 回拨，也不抹去匹配或冻结时间维度。

## Task 内部推进阶段（stage）

以下 stage 表达 Task 的推进位置；除未匹配时的 `initial` 外，均对应唯一匹配 Run 的生命周期状态。
唯一匹配按[Task 匹配与 Run 启动](./run-matching.md)规定的最早开始顺序确定，不随其他候选变化。

| stage | 含义 |
| --- | --- |
| `initial` | Task 已受理，尚未匹配 Run；可能未生效，也可能已生效并等待匹配。 |
| `running` | Task 已匹配 Run，且 Run 处于 `running`；不表示内部业务 Execution 已开始。 |
| `stopping` | 关联 Run 的 Worker 已接纳协商并开始停止处理。 |
| `stopped` | 关联 Run 已裁决为停止，包括确认停止、确认强制终止或重启后失去跟踪的恢复裁决。 |
| `completed` | Task 已依据匹配 Run 的成功终结形成正常结果；业务结果“不满足”也可以是正常结果。 |
| `failed` | Task 已依据匹配 Run 的失败终结形成失败裁决；包括完整 Run 内准备、分配或执行过程的失败。 |

1. `initial`、`running`、`stopping` 是非终结的内部推进位置，`completed`、`failed`、`stopped` 是内部推进结局。
2. `starts-after-eligible` 根据 Run 开始等已提交资格事实推导匹配；
   `terminates-after-eligible` 在可信资格观测边界确认 Task 已生效、Run 已开始且未终结时即可推导匹配，无需等待 Run 结束。
3. 取消或超时均不冻结 stage；它们分别改变外部控制状态或时间状态，后续关联 Run 的结果仍按事实推进 Task 的 stage。
4. Task 的终结 stage 不额外证明资源已回收；时间维度只表达当前是否已越过时间边界，不判定结果是否按时产生。

## Task 生效与超时

### 时间锚点

`receivedAt` 是服务端校验并受理 Request、创建 Task 的时间，不是客户端发送时间或请求刚到达网络入口的时间。
它作为 Task 的创建时间，也是实际生效时间的下界：

```text
effectiveEligibleAt = max(requestedEligibleAt ?? receivedAt, receivedAt)
deadlineAt = effectiveEligibleAt + timeoutMs
```

未指定生效时间或指定了过去时间时，实际生效时间为 `receivedAt`；指定未来时间时采用该未来时间。
这些时间在首次受理时确定，幂等重试和重启不重新锚定，也不将默认值回写到原始 Request。

### 时间状态与处理

| 当前时间 `now` | 推算状态 |
| --- | --- |
| `now < effectiveEligibleAt` | `pending` |
| `effectiveEligibleAt <= now <= deadlineAt` | `eligible` |
| `now > deadlineAt` | `timeout` |

服务端使用同一时间体系判断；客户端可自行推算，允许时钟偏差造成展示差异。
即使 Run 已终结，也不以终结时间替换 `now`。

1. 未取消的 Task 生效后，Engine 进行 Run 匹配与调度判断。
2. 生效不保证立即启动 Run；安排调度不等于 Run 已开始。
3. Task 超时不等同于取消，也不冻结 stage；符合匹配规则的迟到成功或失败结果仍可推进 stage，时间状态仍按 `now` 推算。
4. eligible、timeout 由已知时间边界与当前时间推算，到点本身不产生事件；客户端可自行计算，允许因时钟差出现展示差异。
5. 不发送到点事件不免除 Engine 的匹配、调度及超时处理责任。
   实际发生的 Run 开始、Task 取消、Run 终结等事实仍记录为事件并供订阅。
6. 独立时间标签推算无事件；协调器实际处理新资格、既有源事实又不足以证明时，
   可提交一次仅含 observedAt 的资格见证，具体条件见[匹配契约](./run-matching.md)。
   这是一项限制性澄清，不承诺墙钟到点同步匹配，不允许每次 tick、GET 或心跳生成时间日志。

## Task 取消

1. 收到取消请求，撤回对应 Task 对结果的需要。
2. 取消不冻结内部推进阶段；后续 Task stage 继续对应关联 Run 的生命周期 stage，外部控制状态保持 `canceled: true`。
3. `canceled: true` 可以与 `completed`、`failed` 或 `stopped` 同时成立，分别表达撤回需求与运行结局。
4. `pending` Task 被取消后，不再处理其生效、进行新的 Run 匹配或启动 Run；时间状态仍可按时间边界推算。
5. 已终结 Task 也可撤回需求：首次取消仍记录一次取消事实，已终结 Run 不再进入停止流程。
   重复取消返回已取消，不新增事件或 revision；未知 Task 或详情不可提供明确失败，不创建对象。
   取消结果包含 Task 标识、是否本次改变及一致查询水位，不证明 Worker 已退出或资源已回收。

## 取消或超时后的运行观察

取消或超时可能引发停止关联 Run 的协商，但不保证协商成功，也不保证 Run 已被强制终止。
因此，之后仍可能收到 Run 的 progress，或观察到其成功、失败终结；Task 的 stage 继续依据相应事实推进，
取消标记不因此清除，时间状态继续按当下时间推算。progress 仍只在 Run 层查看和订阅，不成为 Task 的进度或额外 stage。

## UI 聚合与逻辑判断

1. UI 可将三维状态聚合为展示标签，不另存聚合状态。
2. 展示优先级为 `completed`、`failed`、`stopped`，然后为 `canceled`、`timeout`，其余展示 `pending` 或 `eligible` 下的 stage；
   仍保留取消和时间依据，不因聚合标签丢失三维信息。
3. 展示优先级不参与匹配、取消或回收决策，这些逻辑直接判断三个维度。
4. 已完成 Task 日后可以越过 deadline，UI 仍展示完成，二者并不矛盾。

Task 取消、超时对运行的影响，见[Task 取消、超时与 Run 终止](./run-termination.md)；
Task 与 Run 何时建立匹配关系，见[Task 匹配与 Run 启动](./run-matching.md)。
