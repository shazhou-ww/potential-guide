# Pilot / Regulator：设计理解与待讨论语义

本文整理用户提供的 Potential-Guided Framework Spec（Pilot + Regulator）及后续讨论；只有“已确认的讨论结论”属于明确澄清，其余不是已获确认的实现设计。忽略粘贴内容中的邮箱界面文字。品牌保留 Potential Guide，理论名称保留 Potential-Guided，代码组件转向 Pilot / Regulator。

## 对“函数式改造”的理解

核心不是把 class 改成 function，而是拆开三件事：

1. **数据描述**：PilotSpec、RegulatorSpec 是可序列化的不可变配方，不携带函数、进程句柄、Agent 会话或订阅对象。
2. **观测与决策**：层级计算、问题归并及修复意图尽可能由显式输入决定；Pilot 只评估，不执行修复。
3. **效应与时间**：探针和 Agent 承担外部效应，AbortSignal 表达生命周期；Behavior 的组合、订阅和调度属于底层 FRP 引擎，不再藏进 Regulator 自有调度循环。

这意味着 Pilot 本身仍会调用有副作用的探针，不应把整个 Pilot 宣称为纯函数。应分离可纯计算的核心与执行边界。

## 已确认的讨论结论

### C1：观测允许尚未取得首次结果的初始状态

Behavior 在首次结果到达前允许持有 unknown / initial 状态，表示尚未观测，而不是业务不合格或调用失败。具体名称待定；此时不编造层级或晋级障碍，也不能将其当成修复依据。

因此，原规范中的 Behavior<PilotObservation> 应在后续类型设计中显式覆盖初始状态，而不是要求立刻产生一个已完成的观测。initial 目前只确定用于首次结果之前；重探测期间保留上次观测还是切换状态尚未讨论。

### C2：单次副作用与 FRP 提升分为两层

第一层将一个静态 spec 映射为单次副作用，不要求业务单元自行实现 Behavior 订阅或 FRP 调度。第二层将该映射统一 lift 到 Behavior：输入 spec 的 Behavior，得到副作用的 Behavior。

概念关系如下，仅表达分层，不规定具体函数签名或 FRP 库：

```text
单次层：(Spec, Subject) -> Effect
统一提升层：lift(Input -> Effect) -> (Behavior<Input> -> Behavior<Effect>)
```

这里的单次指固定 spec 与 subject 发起一次效应；按 C12，一次 regulation 是包含持续观测和修复反馈的完整过程，不是一次 check 或一次 Agent 调用。具体效应的持续时间、异步结果如何发布及资源句柄形状仍待细化。Behavior<Effect> 也不应未经说明等同于 Behavior<PilotObservation>，后者涉及效应结果如何投射。

统一 lift 是可复用基础能力，不为 Pilot 和 Regulator 各造一套订阅机制。效应替换粒度已在 C7 确认；具体接口、配置相等性及下一轮探测协议在实施设计中细化。

### C3：Check 结果与 Pilot 观测不是同一层语义

ok 和 problems 是单个 check 的返回。Pilot 一次观测返回当前实际到达的层级，以及从该层级到下一层之间的 problems 等晋级信息，不再用顶层 ok 表达 Pilot 的整体合格与否。

Pilot 的晋级 problems 是评估所形成的层级差距信息，而不是把任一 check 的返回直接当成整个观测。Regulator 据层级、目标及晋级障碍驱动 Agent，不采用原草案中“PilotObservation.ok=false 就修复”的规则；具体字段形状后续确定。

### C4：调度投递 Abort，Agent 负责执行冲突

调度层原则上在发起新副作用之前，先向旧副作用投递 Abort。投递取消不等于旧效应已经退出，也不承诺远端任务或忽略取消的执行立即停止，因此新旧执行仍可能重叠。

这类业务冲突交给具体执行的 Agent 处理，不由框架实现业务互斥、冲突仲裁或状态回滚。原草案中“新旧并行、旧任务排空、TTL”的描述需服从这一澄清；不能继续将“不在切换时发送 Abort”视为默认规则。是否等待清理、如何设置终止宽限期仍是生命周期细节，不能借此推导出框架的无冲突保证。

### C5：Problem ID 是类型，不是修复任务身份

problemId 与现有模型一致，标识问题类型，不标识具体缺陷实例或修复任务。它仅作为一次探查汇报的一部分，为 Agent 提供问题指引。

修复任务如何拆分、组织、关联及统计由 Agent 自行负责；框架不基于 problemId 建立任务台账、跨轮去重、任务计数或逐问题调度。原草案的 RepairEvent 不能据此扩展成框架内的修复任务管理系统，其必要的最小运行状态接口仍待后续整理。

### C6：整体汇报观测，调节规格承载 Agent 单次执行限制

Regulator 将完整观测、目标与取消信号交给 Agent，由 Agent 决定如何处理问题，执行结束后再探测。不再选择 problems[0] 作为框架调度的单个任务。

“止损线”只是比喻，用户进一步明确其含义是给 Agent 单次执行加限定。代码概念使用 AgentExecutionLimits，不使用 StopLoss / stopLoss；先前将其解释成整个 Regulator 闭环的最大迭代或停滞预算不准确，以本次澄清为准。

限制由调节规格提供，随每次 Agent 调用传入执行边界，具体限制维度与执行方式后续定义；不因此引入 Agent 内部任务管理，也不自动沿用现有 Regulator 的跨轮退出策略。此处“Regulation Spec”指原草案 RegulatorSpec 所承载的调节配置，不另引入一个同义规格；最终字段组织在实施阶段统一。

### C7：仅替换受输入变化影响的效应

按依赖粒度进行 FRP 提升和效应替换。AgentBinding 更新时替换相关修复效应，复用未变化的 Pilot；PilotSpec 更新时替换观测效应并更新其下游。Strategy 变化同样只影响依赖该配置的效应，不把所有字段变化都当作重建整个 Pilot 的理由。

每个被替换的效应遵守 C4 的“先投递 Abort、再发起新效应”；共享这一生命周期机制，不在通用 lift 中硬编码 Pilot 的领域判断。此结论不承诺 Agent 执行业务无冲突。

### C8：允许破坏性迁移，交付 Silvermoon 迁移指导

用户确认当前包仅自用，接受破坏性迁移，不要求保留旧 API、包名、manifest 或 CLI 的兼容层。仓库内消费者同步迁移，Supervisor 仅进行必要的依赖和调用适配，不扩展其职责。

本次改造最终交付一份迁移指导文档，说明旧模型到 Pilot / Regulator 的对应关系及消费方操作，供 Silvermoon 项目后续迁移参考。本 idea 不因此扩展为直接修改 Silvermoon 仓库，也不要求实现自动迁移工具。

### C9：Objective / Level / Check / Problem 统一使用 ID 身份

四层结构统一为 ObjectiveId → LevelId → CheckId → ProblemId，各层以稳定 ID 表示节点身份。Level 不以数字位置充当身份；层级顺序和晋级关系由 PilotSpec 定义，当前层级与目标层级都以 Level ID 表达身份；是否携带 Objective 归属取决于上下文，按 C11 区分局部配置与独立观测。

这一同构指身份、引用与归属结构一致，不表示四层职责相同或 ID 类型可混用。跨前置链引用仍需保留 Objective 归属，具体编码不在概念模型中展开；Objective ID 也不等于规格的 Git 版本或一次运行实例。

### C10：Objective URI 与四层全局引用

ObjectiveId 固定以 URI 表达，Git 来源使用仓库地址与仓库内定义路径共同定位 Objective，例如 `git+https://github.com/owner/repo.git#objectives/project/pilot.yaml`。这里 fragment 表示定义路径是框架约定；同仓库可有多个 Objective，不能仅用仓库 URL 区分它们。

四层节点以 Objective URI 为全局命名空间，结合逐层归属 ID 定位。局部 ID 在所属范围内唯一，跨仓库引用携带完整上下文；具体编码及规范化规则由解析边界处理。全局身份不依赖本地 checkout 路径或运行实例，也不等同于所有对象都公开可访问。

commit hash 单独作为 SpecVersion，不嵌入稳定 ObjectiveId；版本更新不自动创建新 Objective。稳定引用与版本组合用于定位指定提交的定义，不保证远端探针实现或业务执行可复现。URI 别名、重定向和仓库迁移不能在没有规则时自动视为同一身份。

### C11：目标属于策略，已知上下文不重复编码

targetLevel 属于 RegulationStrategy，不再是 RegulatorSpec 的独立顶层字段，也不作为 makeRegulatorSpec / composeSpec 的额外参数。策略只保存 LevelId；目标所属 Objective 已由配方中的 PilotSpec 确定，需验证该 LevelId 确实存在。

同样，Agent 单次执行限制只在策略中定义。AgentInput 从运行时的配方、subject 与内部观测派生，不让调用方再次独立填写目标、限制或 Objective 身份；AgentBinding 的能力和权限 policy 不复制这些运行配置。

全局 Ref 仍用于跨上下文寻址，不要求局部规格重复写完整路径。独立观测可能来自前置 Objective，其来源与版本不能从根规格或当前配置推断，因此保留必要的来源引用。完整目标引用在 Agent 边界从 PilotSpec 与策略派生，不能错用前置观测的 Objective。

其他类型的冗余检查见[概念模型的信息归属表](./Functional-model.md#信息归属与冗余检查)：输入别名是组合、AgentInput 是投影、决策和结果分属执行前后，不能只为减少类型数而抹平不同语义。

### C12：Spec 与 Subject 分离，一次 regulation 包含持续观测

PilotInput = (PilotSpec, Subject)，RegulationInput = (RegulatorSpec, Subject)，两者保持一致。RegulatorSpec 只组合 PilotSpec、RegulationStrategy 与 AgentBinding，不再包含 subject；同一静态配方可以复用于不同治理对象。

regulate 接收配方与 subject，内部持续运行 Pilot、消费观测、调用 Agent 并在执行后重新探测。PilotObservation 是内部产生的状态和可向外暴露的输出，不是完整 regulation 的外部输入。先前将 regulate 定义为“规格 + 观测到一轮修复”的模型过窄，以本结论修正。

内部决策与 Agent 输入投影仍需要最新可信观测，但不要求调用方重复提供；pilotInput 也应从 RegulationInput 提取 subject，而非试图从 RegulatorSpec 取得。外层只对规格与 subject 的变化做提升、组合和按依赖替换，不因内部观测更新就重新启动整个 regulation。外部订阅与定时机制仍属于运行时 / FRP，不意味着 Regulator 自建调度引擎。

### C13：纯规格构造命名为 makeRegulatorSpec

原 assembleSpec 是 PilotSpec、RegulationStrategy 与 AgentBinding 的简单纯构造，改名为 makeRegulatorSpec。构造不加载来源、不启动观察、不执行调节；composeSpec 表示其 Applicative 提升，不是另一个构造模型。

Git 仓库中的 PilotSpec 如何跟踪并变成 Behavior，不与规格纯构造混在一起，也不放进 Pilot 的观测逻辑；具体分层按 C14 调整。

### C14：通用 Git 观察与 Pilot 内容解释分离

按用户确认，独立包改为领域无关的 git-source，而非将 Git 观察绑定到 Pilot 来源。它负责仓库、ref / commit、不变快照及其 Behavior，不依赖 Objective、PilotSpec 或 Pilot 的 Envelope。

Pilot 保留载体无关的资源加载与校验，组合入口的薄适配将 GitSnapshot 转成 ResourceResolver 并保留确切版本；I/O 加载通过通用效应提升形成规格状态 Behavior，不当成纯映射。暂不额外创建 pilot-source-git 包，有实际独立消费或依赖隔离需求时再拆。来源、内容语义与时间组合是三个独立维度。

## 原规范要点与讨论修正

- PilotSpec 包含 levels、仅以 ID 引用的 checks、至多一个串行 prerequisite、problem 元数据与 wikiRefs。版本身份取 Git commit hash；人类可读说明集中在 Markdown Wiki。
- Pilot 的单次层与 FRP 层按 C2 分开，观测初始状态按 C1 表达；完成观测按 C3 返回当前层级和晋级障碍，不保留原草案的顶层 ok。timestamp、specVersion 及调用故障的具体表达后续细化，不能把调用故障当成可信层级评估。
- CheckProbe 统一为 `(subject, signal) => Promise<Envelope<CheckResult>>`。业务失败仍为 status=200、payload.ok=false；4xx 不重试，5xx 按调用方策略处理。
- 进程探针通过 stdin/stdout 交换 JSON，正常业务结果无论合格与否均 exit=0；stderr 仅作旁路日志。HTTP 探针通过 POST 返回相同信封，取消等待不等于取消远端任务；内存探针也遵守同一接口。
- RegulatorSpec 包含 pilotSpec、regulationStrategy 和 agentBinding；subject 按 C12 在运行时单独传入。策略按 C11 承载目标 LevelId，并覆盖 adhoc/periodic、超时、重试及效应 TTL，按 C6 承载 Agent 单次执行限制；绑定描述 Agent ID、能力掩码、policy 和会话模板，不重复目标或执行限制。
- Regulator 创建本地修复效应，按 C3 消费层级与晋级障碍，完成后重新探测。原草案的 observationStream、repairStream、abortSignal 接口需结合两层封装整理；按 C5 不建立逐问题修复任务管理。
- 按 C7 只替换受变化影响的效应，保留未变化的 Pilot。替换时原则上按 C4 先投递 Abort 再发起新效应，不保证执行无重叠；TTL 与资源清理宽限期在此边界下细化。
- 取消向下传播；资源型探针负责自己的临时文件、socket 与子进程清理，优雅终止后才执行硬终止兜底。业务回滚由 Agent 负责。
- 过程日志不进入观测或修复主状态，也不新增 WebSocket 过程日志流。

## 与现有实现的对应关系

- [现有 Guide 类型](../../../../../../packages/objective-guide/src/types.ts)已经有串行 prerequisite、subject schema、层级和可注入 check runner，但运行实例携带语言、文档读取及 probe 方法；当前 CheckResult 使用 pass，而不是 Envelope + ok。
- [现有 Guide 评估](../../../../../../packages/objective-guide/src/guide.ts)已经将检查调度与 runner 分开，但临时目录生命周期仍由上层管理。新规范将清理责任进一步下沉到探针。
- [现有进程 runner](../../../../../../packages/objective-guide/src/runner.ts)主要面向本地脚本；新规范增加 HTTP 同构协议、旁路日志和分层终止要求，不能只通过改名完成。
- [现有 Regulator](../../../../../../packages/objective-regulator/src/index.ts)通过 regulate 和 action executor 执行有界命令式循环。新模型把它改为效应工厂，循环时序与订阅归属需要重新界定。
- [当前公开入口](../../../../../../README.md)还包含 Supervisor 和旧 CLI 名称。按 C8 同步迁移仓库内消费者而不保留旧接口兼容层；Supervisor 不重设计、不顺手删除。

## 待讨论的问题

类型构造器、核心函数与组合箭头见 [Haskell 函数式概念模型](./Functional-model.md)。它只表达关系，不预设最终接口实现。

包的淘汰、新建、调整及类型 / helper / 关键函数导出，另见[包结构讨论方案](./Package-structure.md)。其中包名、导出分配属于待讨论提案，不因写入文档自动成为已确认结论；方案采用通用 RunningEffect 包装取消能力，不将取消入口塞入 Outcome。

既有核心职责与迁移范围已通过 C1 至 C12 确认。C13 更新构造命名，C14 确认 Git 来源与内容解释分离；包的重点导出仍是实施前讨论方案。下列是实施设计待细化项，不再逐项视为需要用户决定的阻塞；整体代码审查若发现新的实质性选择，应单独列出并说明影响。

### Q1：Behavior 的时间语义是什么？

首次异步结果前使用 initial / unknown 已确认，不再作为疑问。重探测期间如何表示已有观测、效应是否需要暴露最小修复状态仍待细化；不以逐问题事件完整性为由引入修复任务追踪。已授权使用 Effect 4.0.2 进行[隔离原型验证](../effect-frp-prototype/README.md)，目前 10 项测试通过，包含跨独立 ref 的混合版本对照与取消边界。该证据不代表完整 FRP 事务语义、Git 来源观察或生产迁移已经完成，最终运行底座与适配导出仍需结合这些边界确定。

### Q2：谁拥有更新与下一轮探测的调度？

静态 spec 到单次效应、再由统一 lift 提升为 Behavior 已确认；按 C7 依赖粒度替换，按 C6 将单次执行限制交给 Agent 执行边界。实施设计需说明修复完成触发重探测、periodic 定时和 adhoc 触发怎样与两层配合，不另增业务组件自有的 FRP 订阅机制。

### Q3：观测语义已确认，字段形状待细化

按 C3，check 返回 ok/problems，Pilot 返回当前层级与通往下一层的 problems。原先关于 Pilot.ok 与 targetLevel 的疑问源于层次混淆，撤回；后续仅需细化终态及 prerequisite 的层级定位等观测字段，不改变已确认语义。

### Q4：冲突责任已确认，取消细节待细化

按 C4，原则上先向旧效应投递 Abort，再发起新效应；可能产生的业务冲突由 Agent 处理。框架不为冲突另加锁或仲裁。剩余只涉及取消传播、资源清理宽限期及 TTL 的具体接口，不再要求框架排空旧业务以消除冲突。

### Q5：问题类型边界已确认，不建立修复任务模型

按 C5，problemId 只是探查汇报中的问题类型指引。撤回此前关于补充逐问题任务身份、跨轮去重及任务统计的要求；任务组织属于 Agent，不是本框架待补齐的能力。

### Q6：调用故障与终止如何呈现？

规范既说全部人类描述进入 Wiki，又给 Envelope.message 留了人类消息字段；可理解为前者约束静态规格、后者为运行诊断，需确认。还需确定超时/主动取消是否产生 error 观测、畸形信封怎样封装、5xx 的重试上限，以及 error 存在时如何阻止误修复。

### Q7：版本与迁移边界在哪里？

破坏性迁移及 Silvermoon 迁移指导已按 C8 确认，不再询问兼容层。代码审查需定位 Git commit 身份的来源、Check ID 与 Agent ID 的本地解析边界，以及现有 subject schema、前置依赖映射和多语言 Wiki 的保留方式；不将包含自身的 commit hash 写回同一提交。

### Q8：跨平台进程终止承诺如何界定？

POSIX 的 SIGTERM / 进程组 SIGKILL 无法原样等同 Windows 的进程树清理。需要定义可验证的平台语义，而不只声明信号名。允许忽略 signal 的简单探针也必须有范围，不能使整体取消无限等待。

## 当前讨论边界

本轮记录已确认结论并审查现有代码，不修改运行代码、不发布软件、不迁移 Silvermoon；破坏性迁移是后续实施边界，不代表已经开始实施或已通过构想验收。

## 现有代码整体审查

审查基于当前仓库的核心实现、CLI 适配、配置与 ACP、测试、打包校验和发布流程；不是对 Silvermoon 消费代码的审查。

### 可保留的领域语义

[Guide 评估](../../../../../../packages/objective-guide/src/guide.ts)已经按层级屏障执行全部同层 checks，按声明顺序聚合 problems，遇到前置未满足时返回前置实例的观测。保留 subject schema、受限 JSONata 前置映射、terminal、文档身份和语言覆盖规则，不因函数式分层而重新发明这些语义。

现有观测中的 current 携带本地 instance 引用，文档查询依赖该实例。改造必须区分本地对象与可传递快照，保留前置观测的来源定位，不能简单用一个无归属的数字取代整个层级模型。

### 必须同步改造的表面

- **探针与资源**：[现有 runner](../../../../../../packages/objective-guide/src/runner.ts)使用 pass 协议，上层为整轮及前置链创建共享临时目录。新 Envelope、直接 subject 输入、独立清理、HTTP 与进程同构会有意改变旧约定；相关测试应转换到新的清理责任，而非机械保留共享目录断言。
- **加载与版本**：[loader](../../../../../../packages/objective-guide/src/loader.ts)按 URI 缓存对象，没有 Git 版本维度。[CLI 的 digestTree](../../../../../../packages/pguide-cli-core/src/index.ts)目前计算包含 checks、references 和前置树的 SHA-256 内容摘要，并非 commit hash。不能直接改字段名称后声称实现版本绑定。
- **修复闭环**：[核心 Regulator](../../../../../../packages/objective-regulator/src/index.ts)和 [CLI 提示词及持久化](../../../../../../packages/pguide/src/commands/regulator.ts)都以第一个 problem 组织 action。需要一起改为整体观测输入，移除逐问题任务意味，但保留必要的调用结果、恢复信息，并接通规格中的 Agent 单次执行限制；现有跨轮迭代与停滞退出不能直接当作这项限制迁入。
- **时间与取消**：当前目录下没有发现 Behavior、通用 lift 或 FRP 依赖。需要新增独立的组合边界；现有核心 action executor 不接收 signal，ACP 取消则在 CLI 内实现。取消要贯通两层，并对旧效应迟到结果做来源隔离，不能让其覆盖新输入的当前观测。
- **配套入口**：[scaffold / validate / probe](../../../../../../packages/pguide/src/commands/guide.ts)、continue、配置 limits、Agent profile 解析，以及 [Supervisor CLI](../../../../../../packages/pguide/src/commands/supervisor.ts)都需适配新契约。保留 CLI Core 与领域包的依赖隔离，不把 ACP 会话或命令行配置塞进静态 Spec。
- **发布与示例**：[打包校验](../../../../../../scripts/check-packages.mjs)、[独立消费者验证](../../../../../../scripts/verify-deployment.mjs)、fixture 探针、workspace 依赖、各包 README 和 [发布工作流](../../../../../../.github/workflows/publish-npm.yaml)固定了旧名或旧导出，应与新入口同步。历史 idea 文档和事件不作为全仓改名对象，npm 发布本身不在当前任务内。

### 验证与待细化项

当前 pnpm check 退出码为 0，格式、类型、测试、构建及打包检查通过；沿用的 lint 有警告，本轮未修改或消除它们。这只是现有代码基线通过，不代表尚未实施的改造已经验证。

后续应覆盖完整问题输入、Agent 单次执行限制、同层聚合、前置来源、initial/调用故障、轻量变化保留 Pilot、Abort 先于替换、迟到结果隔离及跨载体取消。现有 CI 已有 Linux / macOS / Windows 的打包消费者验证，可沿用并扩展，不需要另造一套测试工具。

仍有一个会改变使用流程的具体选择：Git commit 身份如何与本地开发配合。现有 scaffold、测试 fixture 及 CLI 允许直接使用未提交目录；严格只运行已提交规格与保留显式本地开发模式是不同契约，当前尚未选定。同时需明确 commit 标识只覆盖 PilotSpec，还是也约束 Wiki、进程 check 及前置规格的解析来源。不能将任意工作树内容标成 HEAD，也不能假定一个 Check ID 已经固定远端实现版本。

建议由外部解析边界提供可验证的来源与版本，核心只消费已解析规格；未提交内容是否允许及如何表示版本，保留为待讨论事项。Haskell 模型对此保持抽象，不通过伪造默认版本提前作决定。
