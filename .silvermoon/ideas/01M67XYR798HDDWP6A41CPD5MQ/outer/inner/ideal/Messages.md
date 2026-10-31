# Task 归属的运行消息

本文支持 [构想契约](./Idea.md) 和 [TaskType 接口草案](./TaskType.md)。
用户于 11:47 要求按类型定义的运行消息方向调整设计，11:57 确认消息 schema 和通道必选，
不需要业务消息时使用 Never schema；具体接口和可靠接纳协议仍待细化，
不将该请求视为构想精确 revision 的验收或代码实施授权。

## Input、Message 与输出

| 通道 | 作用 |
| --- | --- |
| Input | 创建 Task 时的初始契约与匹配依据，不被后续消息直接改写 |
| Message | 调用者对既有需求的增量请求，由 TaskType 定义结构和业务语义 |
| Progress | Run 输出的统一展示进度：stage、percent?、string message |
| Result | Run 的最终公开结果；不由后续消息改写旧结果 |

运行消息是输入方向，不复用 Progress 的 message 文本，也不让 Engine 解析展示文字控制 Run。
每个 TaskType 必须声明 messageSchema，每个 RunContext 必须提供 messages；
无需业务消息的类型显式声明 messageSchema: false，并以 never 表示业务消息类型。
false 是标准 JSON Schema，拒绝包括 {}、null 在内的任意值；
{} 或 true 表示接受任意 JSON，并不是 Never，也不是只接受空对象。
服务在 schema 校验时显式拒绝 Never 类型的业务消息，不投递、不丢弃或假装成功；
不自动注入 {} 消息，也不因当前没有业务消息而把运行通道当作终结。
取消仍是通用生命周期控制，不要求每个类型把 Cancel 定义成自己的业务消息。

## 以 Task 为归属，经可信通道送达类型 Worker

公开操作优先指定 taskId、messageId 和类型定义的 payload。Engine 校验 Caller 与服务操作权限，
核对 Task 的 scope、类型契约、载荷及生命周期，再向对应类型 Worker 投递。
不直接修改 Task 原始 Input，也不默认暴露无归属的 send(runId, JSON)。
业务消息的服务操作权限须沿用 EngineOptions.authorize 边界明确表达，
不能仅有 submit 权限就静默获得消息权限；具体 Operation 名称尚待定义，不新增 TaskType.authorize。

可信投递信封保留 messageId、taskId、Caller 及宿主选定的 Run/Worker 代际路由，
这些身份不是业务 payload 自报的授权。类型只获得处理该消息所需的字段，
不获得 Engine 可变对象或整个内部状态；路由与接纳结果应可审计。
收到信封不代表业务已接受，也不授予文件、网络或 Agent 操作权限。

Run 可能被多个 Task 共享；类型 Worker 对输入消息必须知道具体需求归属。
对于未绑定但具有 terminated-policy 需求的 Task，不能为了送消息伪造结果绑定。
无当前 Run 路由时是拒绝、等待还是由明确关联协议处理，仍待定义；
不得广播给所有同类型 Run 或自动开启新的 Run。

## Regulator 示例及影响

```ts
type RegulationMessage =
  | { kind: "add-quota"; contributionId: string; maxAgentRuns: number }
  | { kind: "set-target-level"; level: string };
```

示例不是已经确定的 Regulator 接口或记账实现。

追加 quota 是一笔归属于请求方/Task 的新投入，不能替换已经消耗的额度；
同一 messageId 重投不得重复计入，contributionId 与投入接纳关联规则须明确。
取消只撤回该参与者未使用部分；实际 Agent 操作权限不按投入方拼接，不因追加而增加。
沿用 [既有资源原则](../../../../01M65APBJ0WQ9VNWNZPN3BGJAQ/outer/inner/ideal/Discussion.md)：
追加修复次数等资源不延长 Task Deadline，不新建可众筹的运行分钟数，
也不取消单次 Agent 的执行安全上限。

target level 消息优先表达发出该消息的 Task 的有效目标调整请求，
不授权一个参与者直接覆盖共享 Run 中其他参与者的目标。
类型接受前必须明确兼容性、各需求完成条件与后续行为；
降目标不导致其他需求错误完成，升目标不隐式提升操作权限。
原 Input 不变时，有效目标变化须有可追溯记录，不能继续把原 Input 当作完整当前需求而忽略变化。
采用新 Task 还是有效需求修订、怎样重新检查兼容性及关联 Run，仍待决定；
不能通过通用 message 接口绕过 Input-only 匹配或产生第二套隐式绑定规则。

## 接纳、结束竞争与恢复

必须区分服务接收/入队、类型业务接纳、实际消耗/效果；只入队不能返回业务成功。
需要有界在途消息、稳定关联身份、持久化接纳或拒绝结果与可查询的处理状态。
业务拒绝显式返回原因；超时或失联而不能确认结果时保留未知状态，
不能把未知当拒绝后换新身份重试追加，以免重复投入。
重投同一消息的幂等语义和类型状态恢复须覆盖“已接纳但确认丢失”的 Crash 窗口。
具体确认接口、状态记录归属及原子边界尚未确定，不承诺跨进程 exactly-once。

追加与 Run 终结/取消存在竞争。终结边界必须覆盖已业务接纳的投入与目标调整，
不能先接受再在结束时无声丢掉。未接纳的消息明确拒绝或保持可确认状态。
已终结 Run 不接受用于复活它的消息；需要接续成果时通过明确的新需求/新 Run，
不改写旧终结、结果与消耗事实，也不自动重跑未知副作用。

Engine 管可信服务入口、通道路由和持久化事实；类型 Worker 解释消息、检查业务状态，
处理共享投入与目标协调。精确接口须支持非阻塞地并行运行与接纳消息，
不把“有消息通道”当作整套治理协议已经完成。
