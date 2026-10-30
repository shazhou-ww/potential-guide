# 终结时间匹配讨论

本项来自 [Regulate 资源协作讨论](../../../../01M65APBJ0WQ9VNWNZPN3BGJAQ/outer/inner/ideal/Discussion.md)。
用户于 2026-10-30 明确要求独立跟踪 `completed-after-eligible` 向
`terminated-after-eligible` 的迁移；并未批准具体协议、实施或任何生命周期门禁。

## 已知事实

在 `ce52458f92b526dc436c95a5cdf58c71c8be496e` 核实的接口中：

- [ExecutionMatch](../../../../../../packages/task-protocol/src/types.ts)
  提供 `started-after-eligible` 和 `completed-after-eligible`。
- [matchesExecutionTime](../../../../../../packages/task-protocol/src/projection.ts)
  对后者使用 `completedAt > eligibleAt`，不包括 `failedAt`。
- [引擎](../../../../../../packages/task-engine/src/engine.ts)允许兼容的后到请求
  以该策略加入未完成执行；已绑定请求可结算执行失败，但新请求不会匹配历史失败执行。
- Task 有独立期限和取消事实，Execution 有完成、失败及回收事实。
  某个 Task 超时或取消，不必导致仍服务其他请求的 Execution 结束；
  逻辑终结也不等于已确认物理退出。
- 引擎当前直接采用显式传入的 `eligibleAt`，未限制其不早于 `receivedAt`，
  并以该时间加 `timeoutMs` 得到 `deadlineAt`；以下已决定的锚点限制尚未实现。
- 当前 `compatible` 要求双方已有 Prepared 且内容相等，`startGroup` 将启动 owner
  直接绑定而未按两种匹配策略分流。这些是现有实现，不是以下目标语义的前提。

## 需求方向

同一治理对象的后到请求可能利用已经开始的工作，不必要求 execution 在自己 eligible 后才开始。
用户认为 `completed` 名称未覆盖取消、超时与失败，应以独立 idea 讨论一般终结语义。
这不意味着上述不同层次的终结已决定合并，也不意味着改一个枚举名即可满足需求。

## 已明确的语义

用户于 2026-10-30 确认以下准备期方向，不构成协议细节或生命周期门禁批准：

- `terminated` 指 Execution 的逻辑终结，成功完成与失败都属于执行结果。
  失败结果不等于成功成果。
- 取消表示意图上不再需要这个 Task 的结果；超时表示这个 Task 未在预期时间内得到结果。
  这两类 Task 不再需要结果匹配，不把它们的取消或超时时间当作 Execution 的终结时间。
- 单个 Task 不再需要结果，不代表其他 owner 也不需要共享执行；
  Execution 的逻辑终结与物理退出、回收保持分离。
- 新 Task 的实际生效时间不能早于接收时间：
  `effectiveEligibleAt = max(requestedEligibleAt ?? receivedAt, receivedAt)`。
  提供过去时间时按接收时间生效，提供未来时间时保留未来时间。
- 结果匹配与超时期限统一使用这个生效锚点：
  `deadlineAt = effectiveEligibleAt + timeoutMs`。
  例如 10:30 收到请求、请求填写 10:15、期限为十分钟，则从 10:30 生效、10:40 截止。
  该限制同时排除接收前的成功或失败结果，不仅针对失败。
- 兼容判定基于 Task 类型和 Input：同一类型、相同 Input 的 Task 在同一组内按规则匹配，
  不依赖准备是否完成或 Prepared 的结果。这不授权越过身份和权限边界。
- 从引擎视角，绑定发生在 Execution start 或 terminate 时：
  start 时匹配可绑定的 `started-after-eligible` Task；
  terminate 时匹配可绑定的 `terminated-after-eligible` Task，成功和失败都参与该规则。
  前者在绑定之后接收执行失败；后者的失败终结与绑定属于同一逻辑处理。
- 此前“Task 已生效，但尚未准备好，因而等到执行失败后才可判定兼容”的例子撤回：
  它错误地把当前 Prepared 兼容限制作为目标语义前提。
  按上述规则，该 Task 不需要等准备完成，可在 Execution terminate 时参与匹配，
  无需为这个例子另设历史失败补绑定政策。

## Open questions

- 边界采用何种时间关系，如何处理 eligible 恰好等于 start 或 terminate 时间？
- Task 超时与执行结果同时被观察到时，如何按事实时间判定是否已有期限内结果？
  超时后到达的结果如何保留历史而不重新参与该 Task 的结果匹配？
- 终结时才绑定结果的 Task，在执行运行期间的需求与 owner 保护如何表达？
  不能把“尚未绑定结果”误当成“没有请求需要该执行”；本项不实现 execution join。
- 旧枚举、持久 Binding、历史重放、客户端和服务端如何兼容，是否需要显式版本迁移？
  原始请求与生效时间如何分别保存和公开、幂等重试如何保持首次锚点、
  既有早于接收时间的记录如何保留原始事实，都需明确兼容约定。
- 与 Regulate 的按观察提前完成、资源接续及 execution join 如何衔接，
  同时保持时间匹配不替代身份、权限和物理清理规则？

本项的准备种子仅展示可行性与验证方向，待语义明确后再细化，不构成实施计划批准。
