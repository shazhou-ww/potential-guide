# 终结时间匹配讨论

本项来自 [Regulate 资源协作讨论](../../../../01M65APBJ0WQ9VNWNZPN3BGJAQ/outer/inner/ideal/Discussion.md)。
用户于 2026-10-30 明确要求独立跟踪 `completed-after-eligible` 向
`terminated-after-eligible` 的迁移；并未批准具体协议、实施或任何生命周期门禁。

## 已知事实

在 `1e9abaf4ac1fe1ef2eb5862823b697da75c7554b` 的接口中：

- [ExecutionMatch](../../../../../../packages/task-protocol/src/types.ts)
  提供 `started-after-eligible` 和 `completed-after-eligible`。
- [matchesExecutionTime](../../../../../../packages/task-protocol/src/projection.ts)
  对后者使用 `completedAt > eligibleAt`，不包括 `failedAt`。
- [引擎](../../../../../../packages/task-engine/src/engine.ts)允许兼容的后到请求
  以该策略加入未完成执行；已绑定请求可结算执行失败，但新请求不会匹配历史失败执行。
- Task 有独立期限和取消事实，Execution 有完成、失败及回收事实。
  某个 Task 超时或取消，不必导致仍服务其他请求的 Execution 结束；
  逻辑终结也不等于已确认物理退出。

## 需求方向

同一治理对象的后到请求可能利用已经开始的工作，不必要求 execution 在自己 eligible 后才开始。
用户认为 `completed` 名称未覆盖取消、超时与失败，应以独立 idea 讨论一般终结语义。
这不意味着上述不同层次的终结已决定合并，也不意味着改一个枚举名即可满足需求。

## Open questions

- `terminated` 指 Execution 的哪些事实？Task 的取消、超时如何与之保持明确区分？
- 失败只通知已绑定请求，还是也允许后到请求匹配？不能将失败匹配等同于获得有效治理成果。
- 边界采用何种时间关系，如何处理 eligible 恰好等于终结时间，以及已开始但尚未结束的接纳？
- 旧枚举、持久 Binding、历史重放、客户端和服务端如何兼容，是否需要显式版本迁移？
- 与 Regulate 的按观察提前完成、资源接续及 execution join 如何衔接，
  同时保持时间匹配不替代身份、权限、Prepared 兼容和物理清理规则？

本项的准备种子仅展示可行性与验证方向，待语义明确后再细化，不构成实施计划批准。
