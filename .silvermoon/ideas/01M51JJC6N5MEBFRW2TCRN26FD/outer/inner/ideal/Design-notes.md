# Pilot / Regulator：设计理解与待讨论语义

本文整理用户提供的 Potential-Guided Framework Spec（Pilot + Regulator），不是已获确认的实现设计。忽略粘贴内容中的邮箱界面文字。品牌保留 Potential Guide，理论名称保留 Potential-Guided，代码组件转向 Pilot / Regulator。

## 对“函数式改造”的理解

核心不是把 class 改成 function，而是拆开三件事：

1. **数据描述**：PilotSpec、RegulatorSpec 是可序列化的不可变配方，不携带函数、进程句柄、Agent 会话或订阅对象。
2. **观测与决策**：层级计算、问题归并及修复意图尽可能由显式输入决定；Pilot 只评估，不执行修复。
3. **效应与时间**：探针和 Agent 承担外部效应，AbortSignal 表达生命周期；Behavior 的组合、订阅和调度属于底层 FRP 引擎，不再藏进 Regulator 自有调度循环。

这意味着 Pilot 本身仍会调用有副作用的探针，不应把整个 Pilot 宣称为纯函数。应分离可纯计算的核心与执行边界。

## 从规范读取的明确约束

- PilotSpec 包含 levels、仅以 ID 引用的 checks、至多一个串行 prerequisite、problem 元数据与 wikiRefs。版本身份取 Git commit hash；人类可读说明集中在 Markdown Wiki。
- Pilot 接收 spec、subject、signal，输出 Behavior<PilotObservation>。观测包含 level、ok、problems、timestamp、specVersion；error 只表达调用故障，此时层级评估不可信。
- CheckProbe 统一为 `(subject, signal) => Promise<Envelope<CheckResult>>`。业务失败仍为 status=200、payload.ok=false；4xx 不重试，5xx 按调用方策略处理。
- 进程探针通过 stdin/stdout 交换 JSON，正常业务结果无论合格与否均 exit=0；stderr 仅作旁路日志。HTTP 探针通过 POST 返回相同信封，取消等待不等于取消远端任务；内存探针也遵守同一接口。
- RegulatorSpec 包含 pilotSpec、subject、targetLevel、regulationStrategy 和 agentBinding。策略覆盖 adhoc/periodic、超时、重试及效应 TTL；绑定描述 Agent ID、能力掩码、policy 和会话模板。
- Regulator.spawn 创建本地效应，暴露 observationStream、repairStream、abortSignal。合格时不启动 Agent；发现问题后产出 pending/running/succeeded/failed 修复状态，完成后重新探测。
- Strategy / AgentBinding 更新不重启 Pilot；PilotSpec 版本更新允许新旧效应并行，旧任务排空并受 TTL 限制。
- 取消向下传播；资源型探针负责自己的临时文件、socket 与子进程清理，优雅终止后才执行硬终止兜底。业务回滚由 Agent 负责。
- 过程日志不进入观测或修复主状态，也不新增 WebSocket 过程日志流。

## 与现有实现的对应关系

- [现有 Guide 类型](../../../../../../packages/objective-guide/src/types.ts)已经有串行 prerequisite、subject schema、层级和可注入 check runner，但运行实例携带语言、文档读取及 probe 方法；当前 CheckResult 使用 pass，而不是 Envelope + ok。
- [现有 Guide 评估](../../../../../../packages/objective-guide/src/guide.ts)已经将检查调度与 runner 分开，但临时目录生命周期仍由上层管理。新规范将清理责任进一步下沉到探针。
- [现有进程 runner](../../../../../../packages/objective-guide/src/runner.ts)主要面向本地脚本；新规范增加 HTTP 同构协议、旁路日志和分层终止要求，不能只通过改名完成。
- [现有 Regulator](../../../../../../packages/objective-regulator/src/index.ts)通过 regulate 和 action executor 执行有界命令式循环。新模型把它改为效应工厂，循环时序与订阅归属需要重新界定。
- [当前公开入口](../../../../../../README.md)还包含 Supervisor 和旧 CLI 名称。Supervisor 不纳入本次重设计，但旧依赖如何继续工作必须有明确迁移边界，不能顺手删除。

## 待讨论的问题

以下均未作决定；建议先讨论 Q1、Q2、Q3，其余可随之收敛。

### Q1：Behavior 的时间语义是什么？

Behavior 表示“始终有当前值”，还是允许尚无观测？首次异步探测完成前，PilotObservation 没有可信 level，不能用假成功填充。repairStream 又更像离散事件：同一轮的多个问题是否需要逐条、保序、不可丢失地交付，还是只关心最新修复状态？框架是否已有或希望指定 FRP 引擎？

### Q2：谁拥有更新与下一轮探测的调度？

spawn 接收的是一个静态 RegulatorSpec，但轻量配置更新要求保留 Pilot。若 combineLatest 每次变化都调用 spawn，如何标识同一效应、将更新路由到旧实例？修复完成触发重探测、periodic 定时和 adhoc 触发由 FRP 适配层还是效应内部承接？应先确定所有权，避免既说“不调度”又暗含第二套调度器。

### Q3：层级与 ok、targetLevel 如何共同决定修复？

ok 表示所有检查通过、当前层检查通过，还是已达到目标？Pilot 不接收 targetLevel，Regulator 是否仍应在 ok=false 但目标层已达到时停止修复？prerequisite 未满足时，观测的 level 属于哪一个 Pilot，业务问题如何定位到正确的修复对象？

### Q4：旧效应排空与 TTL 的边界是什么？

建议区分“版本切换时不立即中断”和“TTL 到期后可以取消”，但这是待确认解释，不是已定规则。旧版本停止接新检查和新修复吗？旧 Agent 能否与新 Agent 同时修改同一 subject？版本回切、相同 commit 下不同 PilotSpec，以及依赖版本变化如何识别？

### Q5：修复事件的身份、并发与重试如何定义？

problemId 是问题种类还是一次具体问题实例？同一种问题可能出现多次，单条 RepairEvent 缺少轮次或任务关联信息。需确认串行还是并发、重复观测是否去重、Agent 失败是否重试，以及 AgentBinding 更新是否只影响新任务。已有最大迭代和停滞保护是否保留，避免 periodic 形成无限修复。

### Q6：调用故障与终止如何呈现？

规范既说全部人类描述进入 Wiki，又给 Envelope.message 留了人类消息字段；可理解为前者约束静态规格、后者为运行诊断，需确认。还需确定超时/主动取消是否产生 error 观测、畸形信封怎样封装、5xx 的重试上限，以及 error 存在时如何阻止误修复。

### Q7：版本与迁移边界在哪里？

Git commit hash 是外部解析上下文还是 PilotSpec 字段？不可将包含该字段的提交 hash 自引用写回同一提交。Subject 是否保持 JSON 可序列化，Agent ID 与 Check ID 如何在目标节点解析？是否接受新的包名/API/CLI 破坏性迁移，或需要兼容层？当前 subject schema、前置依赖映射与多语言 Wiki 能力保留到什么程度？

### Q8：跨平台进程终止承诺如何界定？

POSIX 的 SIGTERM / 进程组 SIGKILL 无法原样等同 Windows 的进程树清理。需要定义可验证的平台语义，而不只声明信号名。允许忽略 signal 的简单探针也必须有范围，不能使整体取消无限等待。

## 当前讨论边界

本轮只记录理解和问题，不选择 FRP 库、不改包名或协议、不启动迁移、不发布软件；这些选择应在讨论结论明确后逐步进入实施契约。
