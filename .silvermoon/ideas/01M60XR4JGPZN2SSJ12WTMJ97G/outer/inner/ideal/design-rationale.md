# Check Host v2 的设计逻辑

## 阅读入口

本文说明取舍和范围；具体行为按主题集中记录，避免维护多份互相漂移的协议。

| 文档 | 说明 |
|---|---|
| [API 与 SDK](./api-and-sdk.md) | URL 必填、可选 digest、Task 状态、单一过滤事件入口、CheckTask 对象及错误约定 |
| [制品与版本管理](./artifact-management.md) | 浮动来源确认、固定版本、摘要边界、latest、受控下载和缓存生命周期 |
| [调度与生命周期](./scheduling-and-lifecycle.md) | freshness、Task/Execution 匹配、原子时序、worker pool、超时与取消 |

这些是本构想的设计说明，不是已实现接口或执行证据。具体数值限额、公开 schema URI、
代码模块归属和 v1 迁移步骤在实施契约中落实，不能凭本文宣称交付完成。

## 从“启动执行”变为“请求观察”

Check 请求表达：需要一个对特定准确 Check 和 subject 的观察，并要求它满足时间下界。
Task 是这个需求，Execution 是获得观察的实际调用，Worker 是承载调用的可复用执行单元。
三者不是同一个 ID，也没有一一对应关系。

Task 永远保持独立。共享意味着同一个 Execution 的结果满足多个 Task，不是把请求身份、
期限、取消权或状态合并。多次读取或订阅同一个 Task 也不意味着再执行一次。

## 为什么管理能力进入同一个服务

调用制品准备库本身不必启动额外进程，因此理由不只是“减少起进程”。真正要集中的是
来源确认、并发下载去重、准确缓存、限额、准备状态和清理，避免各调用方重复封装。

服务组装层同时拥有 Artifact Manager 与执行 Scheduler/Kernel；它们可以复用库，
不需要再建一层 HTTP 服务，也不意味着把代码全部堆进一个模块或引入循环依赖。
执行内核仍不理解网络下载、Objective、等级或 References 场景覆盖。

## 选择强语义，同时保留显式弱语义

默认 `started-after-request`，适合修复后重查和目标达成证据。可选
`completed-after-request` 接受请求之后完成的观察，适合明确接受正在执行检查的场景。
完成较晚不证明事实读取较晚；两种语义不能在调度优化中被悄悄互换。

Task 总期限和 freshness 都锚定 Host 受理时点。执行还有独立墙钟和清理保护，
不能由后来加入的等待者无限延长。

## 为什么采用单执行 Worker 与 pool

一个 Worker 可以跨时间复用，但同一时刻只承载一个 Execution。一个 Execution
可以响应多个 Task；同 artifact 的独立并发由多个 worker 提供。
这既保留预热收益，也让执行失控时的强制终止有明确隔离边界。

不在同一个 JavaScript 线程内承诺“任意一个并发执行可以强杀且其余完全不受影响”。
如果未来支持 Worker 内并发，必须先增加每个 Execution 的独立可终止隔离单元。

## API 简化不意味着隐去正确性

普通调用方只提供 URL、subject 和观察条件，不提交服务端本地路径或执行 revision。
digest 可作为底层机制自动产生，也可以由调用方提供准确内容约束；计算出摘要与验证
事先认可的内容不是一回事。最终观察仍必须携带可追踪的准确内容与执行身份。

事件订阅只有 `/v2/events`，单 Task 是列表过滤的特例。SDK 把这一条协议封装为
单个 CheckTask 的方法和多 Task 监听，不再设计两套创建 API。

## 与已有 idea 的关系

前置为已完成的 [Check 制品](../../../../01M607T630T6DSDZYTYA52ED6J/outer/inner/ideal/Idea.md)
和 [Objective 组合](../../../../01M607XBNKWQDZAC6EPTZ474NH/outer/inner/ideal/Idea.md)。
保留它们的历史契约、验收和内容证据；本项有意演进其“调用方物化 Check”的服务边界。

后续的[内置迁移与 Release](../../../../01M6080CXKHSN7HTA91H1VDJ1J/outer/inner/ideal/Idea.md)
在本项后推进，避免刚按旧接口迁移又迁移一次。正式 npm/Release、全量内置内容迁移、
registry、跨机器透明路径迁移和跨重启透明执行恢复不属于本项。

v2 可以抛开 v1 的请求形状设计，但已有生产调用方必须有明确接入与兼容或退出说明。
是否短期双栈及其退出步骤在实施契约确定；不能默默把旧目录参数解释为 URL，也不能
重写旧任务/Objective 的证据。Objective 仍保留内联固定 Check digest，不新增 lock 文件。
