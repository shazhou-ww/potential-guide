# Implementation

本文件是完整实施候选的主体契约，不改变已接受构想范围。

完整实施候选已通过 `pnpm check`，包括生产 tarball 的独立安装消费者；
修正和重新提交的准确 revision 由生命周期事件记录，仍由父代理监督验收。
具体契约见 [内部设计](./RuntimeDesign.md) 和 [公开协议](../../../../../docs/task-engine.md)；
基础失败、父代理授权及后续完整验证见 [验证证据](./BoundaryEvidence.md)。

## Steps

### I-S01: 明确完整尝试的协议边界

采用 Run 表示完整尝试、Execution 表示实际执行子过程，以及 MatchPolicy / matchPolicy
表示 Task 对 Run 的匹配政策。对齐类型、请求字段、运行标识、事件、持久化、恢复及公开投影，
避免新协议仍把整体称为 Execution；Facts/SQLite 明确采用 v3 并拒旧，
不迁移或覆盖用户数据，不提供旧字段、目录或结果形状 fallback。
保留两种政策值，明确其 Run 事件边界及行为变化。
收敛单一 `run(Input, RunContext)` 入口和独立结构化 checkpoint，
定义类型运行通道的指定 Run 取消、代际、失联与恢复；
类型级守护按注册 type/version/environment 归属，管理多个 Run；
默认独立 JS 堆、最小 JSON 消息和无继承环境，不按 Run 数量机械创建守护。
参考 [接口草案](./ideal/TaskType.md) 定界 Progress 的 Run 归属、顺序、持久化确认与背压，
以及公开结果 schema 和隔离边界内业务复验的分工；不把草案签名当作已批准接口。
落实必选 messageSchema / messages、Task 归属信封、Task signal 及持久化接纳确认，
支持 boolean Message Schema；false 为 Never，不复用只接受 object 根的 Input Schema 编译入口，
明确无 Run 路由、投入追加、目标调整与匹配兼容性的关系，不引入隐式绑定或需求改写；尚未绑定/尚未投递的 Run 拒绝业务消息路由。

### I-S02: 对齐共享和宿主资源边界

调整 Engine 与 Check/Probe，使相同 Input 的兼容需求共享完整过程。去掉通用 TaskType.authorize
及其专属检查，保留 EngineOptions.authorize、authorizeReplacement 和实际资源动作授权；
不把接收 Task 重新 Prepare 或资源授权作为匹配门槛，不用同名替代 hook 搬移复杂度。
将类型动态代码与 Engine 分离，跨信任边界的定制工作不与类型代码混在同一 Worker。
具体资源编排及 Bundle 热复用属于类型实现，可信宿主控制能力与容量；
可信宿主明确声明请求级 resourceLifetime 或提供跨请求所有权的独立清理证明；
按 Run/Worker 代际跟踪所有已启动动作（含插件未 await 的请求），动作结束及证明完成前
不记录物理回收。等待有界，拒绝/超时/失联保持 unknown，旧异步回调不修改新代际状态。
采用独立 JS 堆和最小消息接口，不传 Engine 内部可变引用或共享可变内存，
不为取消单次执行直接杀类型守护 Worker；不扩展为完整安全沙箱。

### I-S03: 验证消费者和时序行为

对齐直接相关文档、适配器和测试；覆盖 Run/Execution 与 MatchPolicy 命名、
浮动引用、固定 digest、准备及分配失败、事件竞态、
取消、超时、资源撤销、类型 Worker 失联和恢复。执行针对性检查及仓库 pnpm check。
Progress 回归覆盖多 Run 归属、旧代际、终结后消息、载荷限制、存储拒绝和有界在途消息。
覆盖标准 stage / percent? / message 结构、未知百分比、合法 0/100 边界、
非有限及越界百分比拒绝和阶段切换；追溯现有结构化进度消费者，不用字符串替代业务证据。
消息回归覆盖必选字段、Never schema 拒绝任意值（含 {} / null）、
{} / true schema 不被误判为 Never，以及可信身份/服务权限、重复追加、接纳确认丢失、
目标调整不伤其他需求、取消/终结竞争、旧代际及不复活旧 Run。
父代理 R01/R02 修正覆盖失败证据拒绝/合法保存/恢复一致性、不可原地改写，
以及未等待资源、取消、旧代际请求/证明迟到、有界未知和真实 Probe 子需求清理证明。

## Acceptance criteria

### I-AC01: 完整过程共享与匹配一致

用确定性时序测试证明完整 Run 可共享、接收方无需独立准备，
matchPolicy 的 start/terminate 指 Run 而非实际 Execution；准备、分配失败与取消/超时
不会混淆，单个需求退出不伤害其他需求。

### I-AC02: 内容身份和权限边界清晰

用 Check/Probe 回归证明浮动 URL 可接收所选执行的固定旧内容、pin digest 限定内容身份，
且服务权限、实际资源动作和替换控制仍有效；协议及调用路径不再包含通用 TaskType.authorize。

### I-AC03: 持久化与消费者行为可验证

用恢复、事件原子性及适配器测试证明公开事实与完整 Run 一致，
请求和类型采用 matchPolicy / MatchPolicy，Run 与 Execution 子阶段不重名；记录格式变更处置，
通过相关包检查与 pnpm check；用隔离与故障测试证明类型代码不阻塞 Engine、
取消单次执行不误杀其他执行，旧代际消息被拒绝且重启不自动重跑未知副作用。
用消息接口与状态隔离测试证明插件不能修改 Engine 内部对象、不能收到未声明的内部数据；
不承诺禁止插件发布已明确传入的数据，不新增完整安全沙箱验收。
通过 Progress 故障与顺序测试证明接纳确认不早于约定的持久化边界，
消息不越过 Run/代际边界，最终结果业务校验及历史复验未因删除旧回调而丢失。
证明标准 RunProgress 可统一展示，未知百分比不被当作 0，
阶段切换和 100 不控制调度、匹配或终结；必要的结构化内容/因果证据仍可按明确契约获取。
用消息及故障回归证明入队不冒充业务接纳、追加不重复计入或重置期限，
共享目标变化按明确契约重新检查且可追溯，终结与恢复不丢已接纳消息或重跑未知操作。
成功/失败 Result 都在隔离边界内执行纯业务复验且不可改写；无效失败证据不保存/公开，
合法失败证据及原错误/清理未知语义保留。宿主资源在途及 owner 清理证明完成前不确认 reclaimed，
通过 Supervisor/Engine/Probe 回归证明该屏障不依赖插件自觉 await。
用协议回归证明统一通道不省略，Never 类型的业务消息不投递、不自动注入空对象，
且仍能通过独立生命周期通道取消 Run。
