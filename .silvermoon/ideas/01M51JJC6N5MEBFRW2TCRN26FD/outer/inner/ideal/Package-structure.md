# 函数式改造的包结构与重点导出

本文是包边界讨论方案，不是已实施的包清单，也不代表发布授权。依据[设计结论](./Design-notes.md)与 [functional 模型](./Functional-model.md)，只列职责、依赖、重点类型及其 helper 和关键函数，不展开算法或完整字段定义。导出名称为建议，类型签名使用 Haskell 风格伪代码。

## 1. 包变动清单

| 现有包 / 目录 | 动作 | 目标包 / 目录 | 变动范围 |
| --- | --- | --- | --- |
| `@potential-guide/objective-guide` / `packages/objective-guide` | 淘汰，由新包替代 | `@potential-guide/objective-pilot` / `packages/objective-pilot` | 保留层级、前置关系、校验及 Wiki 能力，改为 PilotSpec、Pilot 和统一探针；不发布旧 API 兼容包装。 |
| 无 | 新建薄适配层（是否独立发布待定） | `@potential-guide/effects` / `packages/effects` | 复用开源 Effect 运行时，只补充项目要求的组合与取消约定，不自研 FRP 引擎。 |
| 无 | 新建通用来源包 | `@potential-guide/git-source` / `packages/git-source` | 获取 Git 提交、跟踪 ref，提供不可变仓库快照及其 Behavior；不解析 PilotSpec。 |
| `@potential-guide/objective-regulator` / `packages/objective-regulator` | 调整 | 包名和目录不变 | 以 RegulatorSpec + Subject 发起完整调节效应；整体问题输入、Agent 单次执行限制及 FRP 装配。 |
| `@potential-guide/objective-portfolio-supervisor` / `packages/objective-portfolio-supervisor` | 必要适配 | 包名和目录不变 | 替换 Guide 依赖、调节输入和执行器；不新增 SupervisorSpec、不重设计组合治理策略。 |
| `@potential-guide/cli-core` / `packages/pguide-cli-core` | 调整 | 包名和目录不变 | 保留 CLI 协议、通用配置、持久化与 ACP 传输；移出解析 Objective 内容的版本逻辑，适配新的执行限制配置。 |
| `@potential-guide/config` / `packages/pguide-config` | 调整 | 包名和目录不变 | 配置命令适配新 schema 与帮助信息，不引入第二套领域类型。 |
| `pguide` / `packages/pguide` | 调整 | 包名和目录不变 | 装配 Pilot / Regulator、适配 Agent、迁移命令参数与报告、scaffold、continue 及 Supervisor 调用。 |

按保留独立 effects 薄适配包计算，结果为 **淘汰 1 个旧包、新建 3 个包、调整 5 个现有包，共 8 个目标包**。若最终直接复用第三方 API 而不独立发布 effects，则为 7 个目标包。淘汰指停止使用旧入口与后续演进，不删除 npm 上已经发布的版本，也不改写历史 idea。

本方案不再为 IDs、Envelope、Wiki、每一种 Probe 或 AgentBinding 单独建包：这些类型有明确领域归属，先作为所属包的模块。Effect 与 FRP 优先复用同一个开源运行时，避免本轮增加不必要的自研层次；未来有独立消费或依赖隔离需求时再拆。

CLI 继续沿用当前可发布的 bin 包布局，不为这次领域改造另建应用或搬迁所有目录。

## 2. 依赖方向与导出规则

以下箭头表示“左侧依赖右侧”：

```text
objective-pilot                -> effects
git-source                     -> effects
objective-regulator            -> objective-pilot, effects
objective-portfolio-supervisor  -> objective-pilot, objective-regulator
cli-core                       -> 通用第三方依赖，不依赖 Objective 领域包
config                         -> cli-core
pguide                         -> effects, git-source, objective-pilot, objective-regulator,
                                  objective-portfolio-supervisor, cli-core, config
effects                        -> effect，不依赖上述业务包
```

`git-source` 不依赖任何 Objective 领域包；`objective-pilot` 的规格加载通过载体无关的 ResourceResolver 完成，不反向依赖 Git。当前由 `pguide` 的薄适配模块连接两者，不默认新建 `pilot-source-git` 包。

Supervisor 若直接使用 Effect 类型或运行函数，须显式声明 effects 依赖，而不是依赖传递安装。所有其他新增直接导入也遵循这一规则。

- 类型只在一个包中定义；消费者使用其源包类型，不维护形状相同的平行版本。
- 每个库包导出自有类型，以及必要的构造、解析、校验、投影、引用解析和执行函数；不逐字段机械生成 getter，也不全量导出内部模块。
- 类型 helper 优先是纯函数。I/O 加载、资源获取、运行与取消明确位于效应边界。
- 跨外部输入的解析 / 校验返回明确的结构化失败，不使用默认成功、空对象或未经校验的类型断言。
- Pilot / Regulator 的默认入口保留单次层，也提供薄 FRP 适配入口；只有 effects 拥有通用订阅与切换机制。领域包提供依赖拆分，不另写 FRP 引擎。
- 同一包内先使用一个稳定根导出面；不为每个 helper 增加 exports 子路径。本清单是重点导出，不是把所有内部辅助函数变成公共 API。

## 3. 新建 `@potential-guide/effects`

### 3.1 职责

只处理计算、组合、执行和生命周期，不知道 Objective、Level、Check、Problem 或 Agent。取消能力属于通用运行包装，不属于 AgentOutcome / RegulationOutcome。

已有 [Effect 4.0.2 原型](../effect-frp-prototype/README.md)用于验证复用可行性。下表中的 Effect、Behavior、RunningEffect 是概念导出面，不意味着重新定义第三方已经提供的计算、Fiber、Stream、调度器或逐个包装同义函数。是否独立发布本包，待薄适配的实际规模确定。

### 3.2 类型及其 helper

| 重点类型 | 描述的信息 | 重点 helper / 关联操作 |
| --- | --- | --- |
| `Effect a` | 一项尚待解释的效应计算及其结果类型。 | `pureEffect`、`mapEffect`、`andThen`：构造、映射及依赖组合。 |
| `RunningEffect a` | 启动后的本地句柄，可取消、等待结果；不可序列化。 | `start`、`cancel`、`await`：启动、投递取消、等待完成。 |
| `Behavior a` | 有当前值的时变状态；只要求 Functor / Applicative。 | `constantBehavior`、`liftB`、`liftB2`：常量、映射、组合。 |
| `Sample a` | 首次结果前的 Initial，或结果已可用的 Ready。 | 初始 / 就绪构造及穷尽分支匹配；不为这两种状态再造一组同义类型。 |
| `EffectRuntime` | 通用调度、时间与运行能力，不包含业务绑定注册表。 | `createEffectRuntime`：装配底层依赖；具体调度器保持内部实现。 |

`AbortSignal` / `AbortController` 使用平台类型，不再导出自定义同名类。`EffectRuntime` 是 functional 模型中 Runtime 的通用部分；Check 与 Agent 的绑定解析分别留在领域环境中，不让底层包反向依赖业务。

### 3.3 核心函数关系

```haskell
-- 给效应提供本地运行环境和上层取消信号，立即取得运行句柄而非等待业务结束。
start :: EffectRuntime -> AbortSignal -> Effect a -> IO (RunningEffect a)

-- 请求取消；完成清理由实际执行单元负责，不承诺返回时已完全停止。
cancel :: RunningEffect a -> IO ()

-- 取得结果；执行失败或取消必须明确传播，不能伪造成成功的 a。
await :: RunningEffect a -> IO a

-- 纯时变组合，不启动输入所描述的副作用。
liftB  :: (a -> b) -> Behavior a -> Behavior b
liftB2 :: (a -> b -> c) -> Behavior a -> Behavior b -> Behavior c

-- 启动并替换效应，将完成结果投射为具有初始态的 Behavior。
activate :: Behavior (Effect a) -> Effect (Behavior (Sample a))
```

`liftEffect` 是 `liftB` 的特化写法，可作为文档名称或类型别名，不需要再维护一份实现。`runEffect` 若保留，只是 start + await 的便利入口；它不构成第二种执行模型。

activate 的“结果 Behavior”不等于长运行过程的所有中间观测。中间状态需要运行过程报告，再由 FRP 适配连接；不得用等待最终 Outcome 的方式冒充实时观测。

**不导出**：Envelope、Problem、AgentExecutionLimits、业务重试规则、进程探针清理策略。通用取消传播归本包，具体资源清理归适配器。

## 4. 新建 `@potential-guide/objective-pilot`

### 4.1 职责

承担 Objective 的定义、身份、层级、检查、观测与 Wiki。它只观测，不认识 Agent、RegulatorSpec 或修复任务。

### 4.2 类型及其 helper

| 类型组 | 重点类型与信息 | 重点 helper |
| --- | --- | --- |
| 基础数据 | `JsonValue`、`Subject`、`LanguageTag`；subject 是运行输入，不属于 PilotSpec。 | subject / language 校验；沿用现有 JSON 与语言约束，不重复建通用基础包。 |
| 身份与引用 | `ObjectiveId`、`SpecVersion`、`LevelId`、`CheckId`、`ProblemId`；`LevelRef`、`CheckRef`、`ProblemRef`。 | `parseObjectiveId`、`formatObjectiveId`、`makeLevelRef`、`makeCheckRef`、`makeProblemRef`；格式与归属校验，不以字符串拼接代替规范解析。 |
| 静态规格 | `PilotSpec`、`LevelSpec`、`CheckSpec`、`ProblemSpec`、`PrerequisiteSpec`；明确 ID、结构、允许报告的问题与 Wiki 引用。 | `parsePilotSpec`、`validatePilotSpec`、`levelIds`、`resolveLevel`、`resolveCheck`、`resolveProblem`；从规格解析局部引用，不复制一份索引配置。 |
| 前置与 subject | `SubjectSchema`、`SubjectProjection`、`SubjectValidationIssue`；投影在 Spec 中仍是可序列化描述。 | `validateSubject`、`projectSubject`；保留现有受限 JSONata 能力及限制，不把任意函数放进 Spec。 |
| 检查协议 | `Envelope a`、`InvocationError`、`CheckResult`、`Problem`；区分调用失败与业务缺陷。 | `parseCheckEnvelope`、`validateCheckResult`、调用成功 / 失败构造；问题类型必须属于当前 check 的声明。 |
| 观测 | `PilotObservation`；层级归属、晋级障碍、时间及版本。 | `currentLevel`、`advancementProblems`、`compareLevels`；比较使用规格顺序，不比较 ID 字符串。 |
| Wiki | `WikiRef`、`ReferencePage`、`ReferencePageSummary`；保留语言无关身份及语言内容。 | `validateWikiRefs`、`readPage`、`searchPages`；最后两者属于资源访问边界，不归为纯计算。 |
| 运行能力 | `PilotInput`、`Pilot`、`PilotEnvironment`、`CheckProbe`、`CheckResolver`、`ResourceResolver`、`CheckSchedulingPolicy`。 | `createPilot`、`createProcessProbe`、`createHttpProbe`；内存探针直接符合 CheckProbe，无需包装包。 |

`LevelSpec` / `CheckSpec` / `ProblemSpec` 是 PilotSpec 的组成定义，不是额外独立存储的第二套 manifest。Envelope 先随探针领域定义，Regulator 可导入，不搬进通用 effects 包。

### 4.3 核心函数关系

```haskell
-- 一次观测的函数形状；固定依赖后可独立执行与测试。
type PilotInput = (PilotSpec, Subject)
type Pilot = PilotInput -> Effect (Envelope PilotObservation)

-- 本地能力：探针解析、资源、版本来源、同层调度与日志旁路，不进入 Spec。
data PilotEnvironment

-- 装配环境，得到单次 Pilot 函数。
createPilot :: PilotEnvironment -> Pilot

-- 纯校验与查询：错误类型归 Pilot 包，不强制各包共享一个错误大联合。
validatePilotSpec :: PilotSpec -> Either PilotValidationError PilotSpec
resolveLevel :: PilotSpec -> LevelId -> Either PilotValidationError LevelSpec
compareLevels
  :: PilotSpec -> LevelRef -> LevelRef
  -> Either PilotValidationError Ordering

-- FRP 适配是薄层：调用通用提升 / 执行机制，不另建订阅引擎。
observePilot
  :: PilotEnvironment
  -> Behavior PilotInput
  -> Effect (Behavior (Sample (Envelope PilotObservation)))
```

载荷解析与资源校验仍属于 Pilot；本包可导出载体无关的 `loadPilotSpec` / ResourceResolver，但不实现 Git clone、fetch 或 ref 轮询。跨包共用的 `PilotSpecSnapshot` 只组合已经解析的 PilotSpec 与 SpecVersion；ObjectiveId 从 PilotSpec 取得，不复制。版本随快照进入运行环境与依赖键，不回写 Git 中的规格，也不成为另一套配置。

Git 获取与持续观察归下一节的通用来源包；将其快照接入 ResourceResolver 的薄适配放在组合入口，不进入 Pilot 纯评估。未提交规格的开发模式仍是已有待讨论项。不能将当前 checkout 的任意内容直接标为 HEAD，也不能把现有 `digestTree` 的内容摘要冒充 commit hash。

### 4.4 从旧包迁入与退出

- `createObjectiveLoader` 的工作拆成规格 / Wiki 加载与 `createPilot` 装配，不再返回负责所有事情的 Guide 对象。
- `ObjectiveGuideManifest` → `PilotSpec`；`ObjectiveObservation` → `PilotObservation`；`ObservedProblem` → `Problem`。
- `ObjectiveCheckRunner` → `CheckProbe` + `CheckResolver`；`CheckRequest` 的共享临时目录协议退出，新探针自行清理资源。
- `ObjectiveGuide` / `ObjectiveGuideInstance` 不保留同名兼容导出；文档读取与探测无需绑定在同一个实例上。
- URI 解析、严格校验、前置映射、同层聚合、Wiki 规则优先复用现有实现，不因换包而重写所有逻辑。

## 5. 新建 `@potential-guide/git-source`

这个包回答“Git 仓库当前解析到哪个提交、什么时候变了”，不解释其中的 PilotSpec、策略或 Agent 配置。按 Git 载体命名而非 GitHub 命名，同样适用于其他 Git 托管服务。

| 重点类型 | 描述的信息 | 重点 helper / 操作 |
| --- | --- | --- |
| `GitSourceSpec` | 仓库来源、要跟踪的 ref 或固定 commit，以及刷新策略；不含 Objective 身份、Pilot 定义路径或 subject。 | `makeGitSourceSpec`、`validateGitSourceSpec`。 |
| `GitSnapshot` | 仓库身份、确切 commit 与绑定该提交的资源读取能力；是不可变版本的本地访问入口，不是会变动的共享 checkout。 | `commitOf`、`readSnapshotFile`、`listSnapshotDirectory`；读取属于效应，不是纯 getter。 |
| `GitSourceEnvironment` | 获取 Git 对象、凭据解析、缓存与时间能力；运行凭据不写入来源 Spec。 | `createGitSource`：注入本地能力。 |
| `GitSource` | 固定环境后的单次加载及持续观察能力。 | `loadGitSnapshot`、`watchGitSnapshot`。 |
| `GitSourceError` | ref 解析、权限、网络或 Git 对象读取的结构化来源故障，不是 Pilot 观测或 check 业务失败。 | 明确分类与穷尽匹配；不依赖 Pilot 的 Envelope。 |
| `GitSourceState` | `Sample (Either GitSourceError GitSnapshot)` 的别名；初始可用性复用 effects，不增加另一套初始状态模型。 | 初始、失败和成功分支匹配。 |

```haskell
-- 单次读取：解析引用，取得确切提交的资源入口，不解释仓库内容。
loadGitSnapshot
  :: GitSourceEnvironment -> GitSourceSpec
  -> Effect (Either GitSourceError GitSnapshot)

-- 持续观察：用通用运行时的刷新与生命周期能力，提供有初始值的状态。
watchGitSnapshot
  :: GitSourceEnvironment -> GitSourceSpec
  -> Effect (Behavior GitSourceState)
```

职责包括：

- 跟踪 branch / tag 时先解析 commit；同一快照的读取始终绑定该提交，不能将工作树内容与 commit 标签混装。后续刷新不得改变旧快照的读取语义。
- 发布明确的初始、成功或来源故障状态；拉取失败不发布为成功，也不转成 Pilot 业务不合格。
- 定时刷新、取消与资源释放复用 Effect；来源包规定何时检查 Git、如何识别变更，不实现新的 FRP 引擎。
- 不解析领域 manifest，也不运行仓库里的 check、Agent 或其他内容。

### 5.1 Pilot 内容解释：薄适配而非默认独立包

Pilot 保留载体无关的规格解析 / 校验；组合入口用薄适配将 GitSnapshot 绑定成 ResourceResolver，再调用 `loadPilotSpec`。这样既可使用 Git 来源，也可替换为内存或本地资源实现，而无需改动领域评估。

```haskell
-- 组合入口内部的载体适配；不作为 git-source 的领域导出。
createPilotResourceResolver :: GitSnapshot -> ResourceResolver

-- Pilot 的领域加载：读取定义、解析、校验，保留确切来源版本。
loadPilotSpec
  :: ResourceResolver -> PilotDefinitionPath
  -> Effect (Envelope PilotSpecSnapshot)
```

`PilotDefinitionPath` 是快照内的定义位置，不是 GitSourceSpec 的字段；可从已有 Objective URI 解析取得，不再要求消费者重复配置。适配器校验仓库身份并将快照 commit 接入 Pilot 的 SpecVersion，不复制另一套独立版本配置。

读取是效应，不能直接将上述加载当成纯 `fmap`。通过通用效应提升与结果投射，才能得到 Pilot 规格状态的 Behavior。必须保留初始和故障状态，不能静默过滤错误；成功时将规格与版本一同发布，不因拆开映射而丢失 provenance。

```text
GitSourceSpec → watchGitSnapshot → Behavior GitSourceState
                                           |
                         资源适配 + Pilot 定义加载 / 校验
                                  （通用效应提升）
                                           |
                   Behavior (Sample (Envelope PilotSpecSnapshot))
                                           |
                  成功配方组合 + 明确传播初始 / 故障状态
                  × Strategy Behavior × AgentBinding Behavior
                                           |
                            makeRegulatorSpec 的提升
                                           |
                           × Subject Behavior → regulation
```

相关依赖需要一致更新时，采用完整快照提交，不依赖多个独立源的 latest 组合自动具有事务性。Git 来源观察与 Pilot 对 subject 的观测是两件事，后者不会因为来源包被抽出而改变。

Git 来源没有专属的 Outcome 取消按钮；通过通用 RunningEffect 或父 AbortSignal 终止。版本已固定时可以单次加载，不强制所有消费者持续轮询。仅在薄适配确有独立消费或依赖隔离需要时再拆包；当前不计划额外创建 pilot-source-git。本轮原型没有实现 Git 来源，也未验证 Git 抓取行为。

## 6. 调整 `@potential-guide/objective-regulator`

### 6.1 类型及其 helper

| 重点类型 | 描述的信息 | 重点 helper |
| --- | --- | --- |
| `RegulatorSpec` | PilotSpec、RegulationStrategy、AgentBinding；不含 subject、观测或独立 targetLevel。 | `makeRegulatorSpec`、`parseRegulatorSpec`、`validateRegulatorSpec`；验证策略目标属于 PilotSpec。 |
| `RegulationStrategy` | 目标 LevelId、探测策略、重试 / TTL、Agent 单次执行限制。 | `validateRegulationStrategy`、`targetLevel`、`agentExecutionLimits`。 |
| `AgentBinding` | Agent 身份、能力 / 权限约束、会话模板；无活会话、无重复运行策略。 | `validateAgentBinding`；业务绑定解析由 AgentResolver 承担，不能在纯 helper 中启动进程。 |
| `AgentExecutionLimits` | 一次 Agent 执行的限定，不是跨轮调节预算。 | `validateAgentExecutionLimits`；不同限制维度的执行由 Agent 适配边界明确。 |
| `RegulationInput` | RegulatorSpec + Subject。 | `pilotInput`：投影为 PilotSpec + Subject。 |
| `AgentInput` | 从 RegulationInput 与内部可信观测派生的单次完整汇报。 | `agentInput`；派生目标归属、限制，不让调用方重复填写。 |
| `AgentExecutor`、`AgentResolver` | 执行器函数及按绑定取得执行器的本地能力。 | `createRegulator` 接收它们，不在本包写死 ACP 或某个 Agent SDK。 |
| `AgentOutcome` | 一次 Agent 执行结果。 | 验证 / 穷尽匹配结果状态，不提供取消方法。 |
| `RegulationOutcome` | 完整调节过程结束的结果与最后有效观测等信息。 | 验证 / 穷尽匹配结束状态，不等同于 AgentOutcome。 |
| `Regulator`、`RegulatorEnvironment` | 完整调节函数，以及 Pilot / Agent 等本地依赖和过程观测出口。 | `createRegulator`；观测出口用于报告状态，不是第二套输入配置。 |
| `RegulatorEffect` | FRP 连接后的观测、执行状态与运行生命周期。 | `wireRegulation`；取消能力复用 effects 的 RunningEffect，不在 Outcome 中复制。 |

内部 `RegulationDecision`、`decideRegulation` 可继续在 functional 模型中解释计算关系，但**不默认导出**：它们没有独立消费需求时只是实现细节。同理，不为每个结果创建无必要的 make/get/is helper。

### 6.2 核心函数关系

```haskell
-- 静态配方与运行对象分离。
type RegulationInput = (RegulatorSpec, Subject)
type Regulator = RegulationInput -> Effect RegulationOutcome
type AgentExecutor = AgentInput -> Effect AgentOutcome

makeRegulatorSpec
  :: PilotSpec -> RegulationStrategy -> AgentBinding -> RegulatorSpec

pilotInput :: RegulationInput -> PilotInput
agentInput :: RegulationInput -> PilotObservation -> AgentInput
targetLevel :: RegulationStrategy -> LevelId
agentExecutionLimits :: RegulationStrategy -> AgentExecutionLimits

-- 注入本地执行能力，得到不依赖外部 Behavior 的完整调节函数。
createRegulator :: RegulatorEnvironment -> Regulator

-- 组合三个规格来源，不把 Subject 或观测塞回 RegulatorSpec。
composeSpec
  :: Behavior PilotSpec
  -> Behavior RegulationStrategy
  -> Behavior AgentBinding
  -> Behavior RegulatorSpec

-- 按依赖管理外部输入变化，暴露 regulation 内部持续产生的观测。
wireRegulation
  :: RegulatorEnvironment
  -> Behavior RegulationInput
  -> Effect RegulatorEffect
```

`createPilot` / `createRegulator` 只是将本地环境固定为函数依赖；functional 模型中的 pilot / regulate 就是装配所得的函数，不需要再导出另一套功能相同的“全局默认执行器”。

`wireRegulation` 调用 effects 提供的机制，并提供领域依赖拆分：策略 / AgentBinding 更新不能无条件重建 Pilot；内部观测更新不能重启整个 regulation。RegulatorEnvironment 的过程报告出口如何实现留在运行适配中，不在这里规定一个新的日志或任务协议。

**退出的旧导出**：`createObjectiveRegulator`、旧实例方法式 `ObjectiveRegulator`、逐问题 `ObjectiveActionRequest / ObjectiveActionExecutor`、跨轮 `RegulationLimits` 语义。旧 `RegulationResult` 映射到新的完整过程结果；不把旧字段直接改名为 AgentExecutionLimits。

## 7. 适配 `@potential-guide/objective-portfolio-supervisor`

本轮只修复新核心 API 带来的必要调用变化。现有防御优先、策略覆盖与注册顺序等语义保持，不扩大 Supervisor 的设计范围。

| 类型 / 函数 | 必要调整与 helper |
| --- | --- |
| `ObjectiveRegistration`、`ObjectiveRegistrationId` | 注册项关联新的调节输入与执行能力；不再要求旧 Guide 实例。注册 ID 仍是 portfolio 局部运行身份，不冒充全局 ObjectiveId。 |
| `ObjectiveSafetyThresholds` | 防御阈值和目标使用已绑定 Objective 下的 LevelId；验证 helper 使用 PilotSpec 的层级顺序。 |
| `ObjectivePortfolioEntry / Observation` | 观测改用 PilotObservation，保留 registration 与前置观测归属。 |
| `RegulationDirective` | 执行指令与新策略兼容；执行前将指令目标应用到策略，最终输入只保留一个有效 targetLevel。旧跨轮 limits 不直接映射成单次 Agent 限制。 |
| `ObjectivePortfolioPolicy / Plan`、`DeferredObjective` | 保留计划与推迟语义，类型引用更新到新核心。 |
| `ObjectivePortfolioRunResult` | 每项结果引用新的 RegulationOutcome，不再消费逐问题 action 结果。 |
| `createObjectivePortfolioSupervisor`、`ObjectivePortfolioSupervisor` | 保留 observe / plan / execute 职责；执行桥接新的 Regulator 与 AgentExecutor，必要时注入 effects 运行能力。 |
| `ObjectivePortfolioError` | 保留明确错误边界，调整依赖的校验类型。 |

优先复用 Pilot 的层级 helper 与 Regulator 的输入 / 策略校验，不在 Supervisor 重复定义这些类型。现有私有注册校验与计划校验可继续私有；不为追求全部函数化而增加新的公共 API 或强行拆包。

## 8. 调整 CLI 层

### 8.1 `@potential-guide/cli-core`

本包仍是基础设施库，不依赖 Pilot / Regulator。重点导出：

| 类型 / 能力 | 保留或调整的 helper / 函数 |
| --- | --- |
| `CommandMetadata`、`GlobalOptions`、`CliError`、`COMMAND_PROTOCOL` | 保留 `extractGlobals`、`option`、`rejectUnknownOptions`、`commandMain`、`writeResult`、`expectedCliError` 等协议函数；不因 Guide 更名而无故破坏扩展发现协议。 |
| `PguideConfig`、`LoadedConfig` | 保留 `parseConfig`、`loadConfig`、`redactConfig` 等。旧跨轮 limits 默认值不直接沿用；领域执行选项以扩展配置输入交给 pguide 的领域解析器，不在 CLI Core 复制 AgentExecutionLimits。 |
| `AgentProfile` | 描述本地 ACP 连接 / transport、凭据环境变量引用与能力要求；保留 `validateAgentProfile`、`agentSecretValues`。它不是 AgentBinding 的重复定义：Binding 是领域引用 / policy，Profile 是本地连接方式。 |
| `AcpClient`、`AcpUpdate` | 保留传输层类型及 initialize / session / prompt / cancel / stop 能力；业务到传输的映射由 pguide 提供，不为函数式模型无理由重写稳定协议客户端。 |
| 通用 I/O 与持久化 | 保留 `atomicWrite`、`ensurePrivateDirectory`、`readJsonSubject`、`digest`、`duration`、`stateRoot`、脱敏等函数。纯摘要与版本身份不能混为一谈。 |

**移出 `digestTree` 的 Objective 语义**：它当前解析 prerequisite 并遍历 Guide 目录，其中 Git 来源 / 版本观察归属 git-source，规格结构校验复用 objective-pilot，由组合入口的薄适配连接。通用 `digest` 留在 CLI Core；若新版仍需要内容摘要，作为明确的开发来源或完整性摘要使用，不冒充 Git 版本。

### 8.2 `@potential-guide/config`

目前是 bin 扩展，不是领域类型库。继续提供 `pguide-config`，**不新增库级类型 exports**。

其重点函数仍是配置路径、展示、编辑与验证；复用 CLI Core 的 PguideConfig / AgentProfile / 校验函数。涉及新领域执行配置时，使用明确的扩展配置边界，不在 config 包再造第三份策略 schema。

配置编辑的原子写入、权限与脱敏行为保留。具体扩展配置段的最终布局在实现阶段与 pguide 适配一起确定，本方案不提前规定默认值。

### 8.3 `pguide`

仍是 bin composition 包，**不把命令内部类型当作公共库 exports**。重点是内部函数边界与外部命令契约：

| 内部类型 / 函数 | 职责 |
| --- | --- |
| `PilotReport`、`RegulationReport` | 面向 CLI 的可序列化投影；不输出 RunningEffect、订阅或本地实例。 |
| `RegulationRecord` | 持久化规格、subject、来源版本及必要恢复信息；subject 可与 spec 并列保存，但不能因此重新成为 RegulatorSpec 字段。 |
| `buildRegulationInput` | 把 CLI / 配置转换为经过校验的 RegulatorSpec + Subject；目标只进入 Strategy。 |
| `createPilotResourceResolver` | 薄适配 GitSnapshot 到 Pilot 的载体无关资源接口，保留仓库身份与 commit；规格加载的 Behavior 提升复用 effects，不再建专用来源包。 |
| `createAgentExecutor` | 用 AgentProfile / AcpClient 实现领域 AgentExecutor；完整观测输入、单次执行限制和取消在这里接通。 |
| `toPilotReport`、`toRegulationReport` | 纯报告投影 helper；不维护逐 problem 修复任务台账，诊断与日志保持旁路。 |
| `runProbe`、`runRegulate`、`runContinue` | 装配领域函数并通过 effects 启动；把进程信号转为取消请求。continue 读取记录后重新绑定 subject，不复活不可序列化句柄。 |
| `runScaffold`、`runValidate`、`runSupervise` | 迁移 Pilot 规格、Envelope 示例及 Supervisor 调用，不扩大命令职责。 |

对外仍使用 probe / regulate / continue 等动作名；将 `--guide`、`scaffold guide`、`validate guide` 及旧 manifest 示例迁移为 Pilot 术语。旧输入不保留兼容别名，需明确报错，不静默猜测转换。旧持久化记录的版本不兼容也须显式说明，不直接用新类型读取。

`pguide` 与 npm scope 中的 guide 是品牌，不是被淘汰的 Guide 组件名，不因此改为另一个品牌。

## 9. 导出与验证的联动清单

1. 更新 workspace 依赖、TypeScript 项目引用、根 exports、发布文件清单和包 README。新增第三方依赖统一放 pnpm catalog，内部依赖使用 workspace 范围。
2. 更新打包校验中的固定包名 / 导出清单、独立消费者脚本与 fixture；增加必要的 effects 适配、objective-pilot 与 git-source，移除 objective-guide，不只让源码类型检查通过。
3. 同步发布 tag 映射、bootstrap 清单及 npm 发布说明。新包的 Trusted Publisher 是后续发布准备，不在本轮实际执行，也不添加 token。
4. 测试类型与 helper 的边界：ID 归属、目标 LevelId、三项 Spec 组合、subject 分离、Envelope 业务语义、完整观测输入、单次执行限制。
5. 测试运行边界：RunningEffect 取消、观测初始态、完整 regulation 内反复探测、迟到结果隔离、按依赖替换以及具体探针资源清理；不让行为测试只验证函数是否存在。
   Git 来源还应验证固定 commit、ref 移动、旧快照读取稳定性、来源故障传播，以及同一个快照可供不同领域消费者解释；Pilot 适配验证定义与资源的版本一致性，并确认 git-source 不导入 Objective 领域类型。
6. 输出独立的 Silvermoon 迁移指导：旧新 import、Guide 实例到函数装配、Wiki 查询、Probe 协议、规格与 subject、执行与取消。本文是包结构讨论，不冒充已完成迁移指导或 Silvermoon 迁移证据。

## 10. 当前建议的收敛点

- 新增 objective-pilot 与 git-source；Pilot 的 Git 内容解释先放组合入口的薄适配模块，不默认额外建包。effects 只在需要独立薄适配时保留。Regulator、Supervisor、CLI 的包名不顺带重构。
- 开源 Effect 提供通用运行基础，effects 适配项目语义；git-source 提供通用仓库快照及其 Behavior；Pilot 拥有 Objective 定义及观测；Regulator 拥有完整调节与 Agent 领域接口；CLI 拥有传输装配和终端呈现。
- helper 随所属类型导出；领域内使用局部 ID，跨上下文使用完整 Ref；不让每层复制配置、运行时或错误模型。
- 这是一套可讨论的导出面，而不是要求实施时逐个生成空接口。新增 helper 只有承担实际解析、校验、投影或装配职责时才成为公共导出。
