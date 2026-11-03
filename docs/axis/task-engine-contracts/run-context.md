# RunContext：作者运行上下文

本契约定义 Task 回调可使用的运行能力与信任边界，不锁定全部 SDK 类型或传输编码。
关联 [Bundle 作者入口](./task-bundle.md#作者入口与生成的-worker)；
实际类型见 [RunContext](../../../packages/task-protocol/src/run.ts)，
Worker 通信见 [协议文档](../../task-bundle-worker.md)。

## 身份与生命周期

1. context 由运行库为当前 Run 构造，不是业务 Input 的一部分。`runId`、`scope` 及宿主提供的
   `generation`、`startedAt` 来自可信运行边界；业务输入不能覆盖它们。
   当前公共类型允许后两项缺省；作者不能据此自行补造宿主身份。
2. context 是当前 Run 的能力入口，不提供 Engine 实例、内部可变状态或原始 Worker 通信端口。
   一个 Run 可以服务多个 Task，context 不代表某个 Task 独占该执行。
3. `signal` 表达 Run 的协作停止请求。收到信号不证明 Worker 已退出、业务副作用已撤销或资源已回收；
   作者负责停止和清理，宿主仍独立执行退出与回收裁决。
4. 回调结束时运行库关闭 inbox、撤回信号并结束通信；不得缓存 context 作为后续 Run 的能力。
   进入结束流程后不接纳新的 progress/checkpoint，日志写入返回通道不可用；
   不承诺后台异步工作或未等待的诊断输出完整交付。
5. SDK 不暴露原始通道不等于 Node 安全沙箱；业务代码自行使用 Node 能力的风险仍在原信任边界内。

## 能力分工与确认

本文列出的成员对应当前 SDK。并发补充的 Context Bundle 只读访问是额外的目标能力，
其具体 SDK 方法仍待落实，见[Bundle 契约](./task-bundle.md)；
不能由下表推断该能力已实现，也不因尚未列出方法而取消该架构要求。

| 成员 | 职责 | 不代表 |
| --- | --- | --- |
| `progress` | 上报 preparation/allocation/execution 阶段、可选 percent 和展示 message | 匹配依据、机器控制、成功或回收证明 |
| `checkpoint` | 上报符合声明 Result Schema 的中间结构化结果证据 | 最终结果、调用栈恢复、已消除重启不确定性 |
| `messages` | 收取路由到当前 Run、各自归属某 Task 的业务消息 | 广播、Run 创建或自动业务接纳 |
| `log` | 写入独立、有界的显式诊断日志 | Result、progress、checkpoint 或生命周期事实 |
| 回调返回值 | 提交符合 Result Schema 的最终业务结果 | Worker 已物理退出或资源已回收 |

1. progress、checkpoint、消息确认采用必要业务输出通道；作者应等待其异步确认并处理拒绝。
   确认在相应校验和宿主接纳边界之后返回，不表示订阅者已收到，也不代替领域证据有效性。
2. 业务消息提供可信 caller、taskId、messageId、payload、独立撤回 signal 及 accept/reject。
   消息撤回与 Run 停止是不同范围；accept/reject 明确表达作者的业务接纳决定，
   同一消息不能重复确认，已撤回或关闭的消息不能继续确认。
   `messageSchema: false` 禁止业务消息，不取消 Run 的其他能力。
3. log 使用独立序号、容量与确认通道，不能占用必要业务输出的无限等待或清理预算。
   持久化成功、容量丢弃及基础设施不可用返回不同回执；非法日志输入明确拒绝。
   基础设施故障不由 SDK 自动转换为任务失败，作者仍可根据回执选择自己的业务策略。
4. 回调抛错表示执行失败；符合约定的取消错误按既有停止流程处理。
   回调返回、抛错、输出确认和运行库释放消息均不能替代宿主观察的物理退出与回收。

日志的可用性、超限、保留与查询见 [Run 诊断日志](./run-logs.md)；
停止和资源清理见 [Run 终止契约](./run-termination.md)。
