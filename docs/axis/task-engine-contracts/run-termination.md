# Task 取消、超时与 Run 终止

本契约规定何时停止 Run、如何请求停止及确认终止完成；Task 取消或超时不代表 Run 已停止。

关联 [职责入口](../task-engine-responsibilities.md)：A2 的运行回收效果，以及 B1–B5、C1–C5 中可观察的状态、历史与事件。

## 执行前提

Run 的类型代码在独立于 Engine 的 Worker 中执行，Engine 可向指定 Run 发送取消信号，请其协作停止并清理。
这里执行的是 Run，不是 Task 本身；承载 Run 的 Worker 必须支持单独终止该 Run，不误伤其他 Run。

## Run 回收条件

1. Run 的创建与停止由 Engine 协调，不由外部参与者直接控制。
2. Task 取消或超时时，检查关联 Run 是否需要回收。
3. 若没有已匹配该 Run、时间状态为 `eligible` 且 `canceled: false` 的 Task，则停止 Run 并回收资源。
4. 已为 `completed`、`failed` 或 `stopped` 的 Run 不再进入停止流程。

## Run 的协商终止与强制终止

1. 触发 Run 终止时，先发送协商终止信号，给予其清理和退出的时间。
2. 在约定时限内未完成停止与清理，则强制终止承载该 Run 的 Worker；该操作不得终止其他 Run。
   公开配置 stopGraceMs 默认 5,000ms，自进入终止流程计时；forceExitWaitMs 默认 5,000ms，自强制终止调用计时。
   两者均为正，不与业务 wall time 或通道健康时限混用。
3. 发出停止请求不等于终止完成；无法确认时不报告成功。
4. 协商终止和强制终止均不承诺回滚已发生的业务副作用。
5. 强制退出等待到期仍无宿主退出确认时，明确报告停止未确认，不伪造终结或回收成功；
   禁止新匹配的边界继续有效，之后的真实退出事实仍正常处理。
   宿主关闭预算须至少覆盖停止宽限与强制退出等待之和，非法配置在开放服务前拒绝。

## Run 终结阶段的认定

正常运行时，`completed`、`failed`、`stopped` 均以宿主观察到对应 Worker 终止为时间边界。
Worker 提前上报结果不代表 Run 已终结；结果与退出事实共同决定终结 stage。
重启后失去跟踪的旧 Run 例外按 `stopped` 裁决，见[持久化与重启后的行为](./persistence-recovery.md)；这不证明物理退出。

| 事实 | stage 的变化 |
| --- | --- |
| Engine 发送停止信号 | 不因此改变 stage |
| Worker 确认接纳协商并开始停止处理 | `stopping` |
| 宿主观察到 Worker 终止，且已有可靠成功结果 | `completed` |
| 宿主观察到 Worker 终止，且已有可靠失败结果 | `failed` |
| 宿主观察到 Worker 因停止要求退出，且未形成上述结果 | `stopped` |
| Worker 自身意外退出且没有可靠结果 | `failed` |

1. 收到消息的回执不等于接纳协商，不能仅凭回执认定 `stopping`。
2. 强制终止可直接形成 `stopped`，不必补造 `stopping`。
3. 协商期间形成的可靠成功或失败结果，在 Worker 退出时用于裁决 `completed` 或 `failed`，不因协商停止而改写成 `stopped`。
4. Worker 自身意外退出且没有可靠结果时，认定为 `failed`；这不同于 Engine 重启后失去跟踪的 `stopped` 恢复裁决。
5. 正常停止以宿主观察到对应 Worker 终止为唯一标记，不需要 Worker 另发消息声明 `stopped`，也不以清理完成消息代替退出事实。
6. Worker 退出时关闭其通信信道，按此前已接纳的结果与退出事实裁决终结，不等待退出后的消息。
7. 终结后不再处理该 Worker 的消息；即使宿主队列中残留回调，也不改变 Run 或已匹配 Task 的 stage。

## 终止后的复用边界

1. Run 一旦进入终止流程，就不再接受新的 Task 匹配或共享，不等待协商成功或强制终止完成。
2. `matchPolicy: terminates-after-eligible` 也不例外；新的 Task 不能匹配已进入终止流程的 Run。
3. 进入终止流程后可能已释放部分资源，不能再视为可用；终止流程不因新 Task 到来而撤回。
4. 此限制不影响原已匹配 Task 继续接收实际发生的运行结果。
5. 禁止新匹配从 Engine 进入终止流程时生效，不等待 Worker 确认 `stopping`，也不能只依据 stage 判断是否可复用。
6. 新匹配与进入终止流程必须在一致边界互斥裁决：先成立的新匹配计入回收判断；终止流程先成立则拒绝新匹配。

## 停止请求后的事实

1. `pending` Task 被取消后，不再为其处理生效、进行新的 Run 匹配或启动 Run。
2. 已有 Run 匹配的 Task 即使取消或超时，仍可接收该 Run 的迟到结果。
3. Run 仍可能产生 progress，并最终成功或失败。
4. 实际发生的事实照常记录，不能因已请求停止而丢弃。
5. 已匹配 Task 的 stage 仍可推进；取消和超时状态保持独立。

Task 自身的状态与时间含义见[Task 生命周期与三维状态](./task-lifecycle.md)；
完整 Run 的开始和逻辑终结匹配边界见[Task 匹配与 Run 启动](./run-matching.md)。
