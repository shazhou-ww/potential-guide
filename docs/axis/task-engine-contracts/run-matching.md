# Task 匹配与 Run 启动

本契约界定 Task 如何匹配并共享完整 Run，区分请求幂等、独立 Task 与运行复用，避免重复运行或推导出不符合政策的匹配关系。

关联 [职责入口](../task-engine-responsibilities.md)：operation A1 的运行协调，以及 operations B1–B5、C1–C5 中可观察的状态、历史与事件。

1. Request 幂等防止同一次提交重复创建 Task；共享复用则允许不同 Task 使用同一个完整 Run，不合并 Task。
2. 匹配基于原 Input、`matchPolicy` 及其他匹配条件，不要求接收 Task 独立完成准备。
3. matching 是根据 Task、Run 的事实及匹配条件推导出的关系，不是独立的绑定动作。
4. 多个 Task 共享 Run 时仍保留各自的时间约束、取消意图与结果资格。
5. 向正在订阅的外部参与者发送匹配实际引起的状态变更事件。
6. 已进入终止流程的 Run 不再接受新的 Task 匹配或共享，包括 `matchPolicy: terminates-after-eligible`；不能等到协商成功或强制终止完成后才停止匹配。
7. 新匹配与进入终止流程须互斥裁决，不能依赖 Worker 是否已报告 `stopping`；细则见[Task 取消、超时与 Run 终止](./run-termination.md)。

## 唯一匹配与开始顺序

1. 一个 Task 最多匹配一个 Run；多个 Task 可以共享同一个 Run。
2. 在满足匹配条件的候选 Run 中，取开始顺序最早的一个，不另设任意选择的绑定动作。
3. Run 开始顺序由数据域内唯一、严格递增的序号确定，不依赖可能同刻或回拨的墙钟时间。
4. Run ID 只有保证上述顺序时才能兼任开始序号；后来的 Run 不能排到已有 Run 之前。
5. 候选资格依据相关事实成立时的边界判断，不在每次读取时仅按 Run 的当前状态重新筛选。
6. 允许新匹配与保留既有匹配分别判断：Run 进入终止流程后排除新匹配，但不抹去已经成立的匹配。
7. 匹配一旦确定，不因 Run 停止、后续候选出现或历史清理而切换到其他 Run；Task stage 只跟随该 Run。

## Match Policy 的时间条件

| `matchPolicy` | 时间条件 |
| --- | --- |
| `starts-after-eligible` | Run 的开始时间不早于 Task 的实际生效时间 |
| `terminates-after-eligible` | Run 的终结时间不早于 Task 的实际生效时间，终结包括 `completed`、`failed`、`stopped` |

1. 两个名称中的 `after` 均包含等号；实际生效时间为 `effectiveEligibleAt`。
2. Task 已生效、Run 已开始且尚未终结时，其后若终结，时间必然不早于该 Task 的生效时间，因此可推导满足 `terminates-after-eligible`，无需等待终结事实。
3. Run 在 Task 生效后才开始时，两种政策的时间条件均可在开始事实成立后判断。
4. 匹配仍须满足原 Input 及其他匹配条件；时间条件成立不承诺 Run 必然成功或在有限时间内终结。
5. 启动计划不是开始事实，不能据此提前推导 Run 已开始。

## Run 事件边界

1. 开始边界针对完整 Run，即将完整尝试交给 TaskType 的 `run(input, context)` 入口，不等待类型内部准备、分配或业务执行开始。
2. 先确立并持久化 Run 开始事实，再投递调用；开始事实不证明类型代码已经执行到。
3. 正常运行时，用于匹配的终结时间为宿主观察到 Worker 退出的时间；`completed`、`failed`、`stopped` 均遵循此边界，不以提前上报结果的时间代替。
4. 终结包含 `stopped` 不改变禁止新匹配的规则：已进入停止流程的 Run 不接受新匹配，既有匹配继续保留。
5. 重启失去跟踪的恢复裁决属于例外，见[持久化与重启后的行为](./persistence-recovery.md)；它不伪造旧 Worker 的实际退出时间。

Task 状态见[Task 生命周期与三维状态](./task-lifecycle.md)；
取消、超时及运行约束对终止和回收的影响见[Task 取消、超时与 Run 终止](./run-termination.md)。
