# 函数式概念模型：Haskell 伪代码

本文只描述类型、核心函数的输入输出及组合关系，不写函数体，不定义最终字段、运行算法或具体 FRP 库。它细化[已确认的讨论结论](./Design-notes.md#已确认的讨论结论)，不是可编译的 Haskell 模块或新增的实现要求。

## 1. 三类关系

```haskell
-- Pure
a -> b

-- Effectful
a -> Effect b

-- Time-varying
Behavior a -> Behavior b
```

`Effect a` 表示可由运行时解释、可接收取消的效应计算，结果类型是 `a`；构造它不等于已经启动执行。`Behavior a` 表示随时间变化、具有当前值的状态。两者不是同一个类型构造器。

概念上，`Effect` 提供 Monad 式组合，`Behavior` 只要求 Functor / Applicative 式组合，不要求 Monad；这不表示所有 Behavior 模型都不能有 Monad 实例。这里不定义实例，也不把业务函数设计成订阅管理器。

## 2. 核心对象

```haskell
-- 静态观测规格：Objective 身份、层级、check 引用、前置规格、问题元数据和 Wiki 引用。
data PilotSpec

-- 可复用调节配方：Pilot 规格、运行策略与 Agent 绑定，不包含 subject 或运行观测。
data RegulatorSpec

-- 运行策略：目标 LevelId、探测模式、超时、重试、效应 TTL 与 Agent 单次执行限制。
data RegulationStrategy

-- Agent 的可序列化绑定：身份、能力约束、执行 policy 与会话模板，不重复保存运行策略。
data AgentBinding

-- Agent 单次执行的限制：如本次调用的时限或执行额度，具体维度待定，不是跨轮预算。
data AgentExecutionLimits

-- 本次治理对象的 JSON 描述：身份及探测所需上下文，不是运行实例。
data Subject

-- 目标定义的稳定 URI：Git 仓库地址与仓库内定义路径，不等于 subject 或版本。
data ObjectiveId

-- 定义来源的不可变版本：Git commit hash，与稳定的 Objective URI 分开。
data SpecVersion

-- 层级的稳定身份：标识 Objective 内的 Level，不用数字大小表达层级顺序。
data LevelId

-- 探针引用身份：由运行时解析为具体探针，ID 本身不包含进程或 HTTP 实现。
data CheckId

-- 问题类型的稳定身份：关联问题说明与指引，不标识缺陷实例或修复任务。
data ProblemId

-- 本次探查中的问题汇报：问题类型 ID 与描述具体情况的结构化参数。
data Problem

-- 跨 Objective 的完整层级引用：用于外部寻址或前置观测，不在已知归属的策略中重复存储。
type LevelRef = (ObjectiveId, LevelId)

-- 完整归属路径上的检查引用：在全局 Objective 命名空间中定位一个 check。
type CheckRef = (LevelRef, CheckId)

-- 完整归属路径上的问题类型引用：用于跨仓库指引，不表示某次修复任务。
type ProblemRef = (CheckRef, ProblemId)

-- 单个 check 的业务结果：ok 与检出的问题；ok 为假不代表调用故障。
data CheckResult

-- 一次观测快照：当前 LevelRef、晋级障碍、时间与规格版本，不含顶层业务 ok。
data PilotObservation

-- 调用层信封：状态、成功载荷 a 或故障信息；与载荷内的业务合格状态分离。
data Envelope a

-- 结果可用性：首次结果前为 Initial，取得结果后为 Ready a，不将初始态当失败。
data Sample a

-- 调用故障：类别、状态及必要诊断，如权限、通信或进程错误；不表示业务缺陷。
data InvocationError

-- 一次 Agent 调用的结果：完成、受阻、失败或触及执行限制等状态，不列出内部任务。
data AgentOutcome

-- 不再继续本次调节的原因：达到目标或其他明确停止条件，不暗含跨轮预算。
data StopReason

-- 可运行的效应计算：结果类型为 a；支持依赖组合与取消，不是已执行结果。
data Effect a

-- 随时间变化且具有当前值的状态：支持映射和 Applicative 组合，不要求 Monad。
data Behavior a

-- 本地解释环境：探针与 Agent 绑定解析、执行能力和日志旁路，不进入静态 Spec。
data Runtime

-- 生命周期取消通知：取消状态与原因，可向下派生；不保证接收方已经停止。
data AbortSignal
```

- Spec、Strategy、Binding、AgentExecutionLimits 都是数据，不包含本地函数、会话或订阅。
- `ProblemId` 标识问题类型，不标识修复任务；这里不引入修复任务集合。
- `PilotObservation` 展示当前层级与晋级障碍，不含 check 层的 `ok`。策略中的目标只保存 `LevelId`，其 Objective 由 PilotSpec 确定；观测可能来自前置 Objective，不能一律用根 PilotSpec 推断归属，因此独立观测保留 `LevelRef`。
- `Envelope` 只表达调用层成功或故障；载荷中 check 的 `ok=false` 仍可以是调用成功。此处省略具体状态码和消息字段。
- `Sample` 处理首次结果尚未到达的情况；`Initial` 与调用失败不同。
- 为突出关系，观测时间、版本等元数据没有在伪代码中展开，不表示删除这些要求。

四层采用同构的身份表达：节点由稳定 ID 引用，结构关系与描述信息由规格及 Wiki 提供。

```text
ObjectiveId
  └── LevelId
        └── CheckId
              └── ProblemId
```

这是归属结构，不是函数调用链，也不表示四种 ID 可以混用。Level 的先后与晋级关系由 PilotSpec 定义，不能通过 ID 字符串排序或大小比较来判断。

ObjectiveId 使用 Git 来源 URI，例如：

```text
git+https://github.com/owner/repo.git#objectives/project/pilot.yaml
```

这里将 fragment 解释为仓库内定义路径，是框架的 URI 约定，不假定通用 Git 工具支持此语义。顶层 URI 与逐层归属路径共同组成全局引用；每个下层 ID 必须在所属范围内唯一。完整引用可跨仓库传递，而不依赖调用方本地路径或运行实例。

`ObjectiveId` 与 `SpecVersion` 分别回答“哪个目标”和“哪个版本”；稳定引用再配合 commit 才能指定某一版本的定义。URI 规范化、路径转义及仓库别名的处理由解析边界明确，不能自动将不同 URL 当成同一身份。唯一命名也不保证网络可达、访问权限或远端执行实现可复现。

## 3. 纯数据关系

```haskell
-- 将独立的规格数据组合为完整调节配方，不启动效应。
makeRegulatorSpec
  :: PilotSpec
  -> RegulationStrategy
  -> AgentBinding
  -> RegulatorSpec

-- 从策略读取目标层级；必须属于配方中 PilotSpec 所定义的 Objective。
targetLevel :: RegulationStrategy -> LevelId

-- 从策略读取 Agent 单次执行限制，不在 RegulatorSpec 顶层再复制一份。
agentExecutionLimits :: RegulationStrategy -> AgentExecutionLimits

-- 一次 Pilot 观测的输入：观测规则与被观测对象。
type PilotInput = (PilotSpec, Subject)

-- 一次完整调节过程的输入：可复用配方与本次治理对象；观测由过程内部持续产生。
type RegulationInput =
  (RegulatorSpec, Subject)

-- 从调节输入及内部观测派生的单次执行输入：绑定、对象、目标、完整观测及执行限制。
-- 不要求调用方再次独立填写这些配置，也不向 Agent 传递无关的探测调度配置。
data AgentInput

-- 内部投影：使用本次调节输入与最新可信观测；不让外部调用方预先提供观测。
agentInput :: RegulationInput -> PilotObservation -> AgentInput

-- 从调节输入中提取 PilotSpec 与 subject，忽略与观测无关的调节配置。
pilotInput :: RegulationInput -> PilotInput

-- 纯决策：停止并说明原因，或携带完整 Agent 输入请求一次执行。
data RegulationDecision

-- 内部纯决策：依据配方目标与最新观测决定是否调用 Agent，不是完整调节入口。
decideRegulation :: RegulationInput -> PilotObservation -> RegulationDecision
```

`makeRegulatorSpec` 只组合 PilotSpec、RegulationStrategy、AgentBinding 三项静态数据；subject 在运行时与 RegulatorSpec 配对。`targetLevel` 与 `agentExecutionLimits` 都是策略的只读投影，不增加第二份配置，也不另增同义的 RegulationSpec。组合或解析时应验证目标 LevelId 在配方的 PilotSpec 中存在；有上下文不等于可以跳过引用校验。

`decideRegulation` 是完整调节过程内部使用的纯函数，根据目标与最新完整观测作决策。请求 Agent 执行的决策携带整个观测及本次执行限制，而不是挑选某个 problem 创建任务；限制作用于每一次 `agent` 执行，不解释为整个 Regulator 的累计迭代或停滞退出条件。

### 信息归属与冗余检查

| 概念 | 信息的唯一归属或处理方式 |
| --- | --- |
| 目标层级 | 属于 RegulationStrategy，只保存 LevelId；makeRegulatorSpec 和 composeSpec 不再单独接收目标。 |
| Objective 身份 | 由 PilotSpec 给出；策略不再复制 ObjectiveId 或 LevelRef。完整目标引用在外部执行边界派生。 |
| Agent 执行限制 | 属于 RegulationStrategy；AgentBinding 不保存另一份额度或时限。绑定 policy 表达能力与执行权限，不重复这些运行限制。 |
| AgentInput | 从 RegulationInput 与内部产生的最新观测派生，不是第二份可独立配置的规格；派生目标与限制后不再同时附带整份 Strategy。 |
| PilotInput / RegulationInput | 都是 Spec 与 Subject 的运行时配对；subject 不属于任何 Spec，同一配方可用于不同 subject。 |
| PilotObservation | 是 pilot 的结果、regulate 内部消费的状态以及对外可观测输出，不是完整调节入口的必需参数。 |
| LevelRef / CheckRef / ProblemRef | 用于全局寻址；在所属上下文已明确的规格内只写局部 ID，不强制每层重复完整祖先路径。 |
| 观测来源与版本 | 是产生结果时的来源事实，不能从“当前配置”重新推算；尤其要区分前置观测及旧效应迟到结果。 |
| Sample / Envelope / CheckResult | 分别表达结果是否已到达、调用是否成功、业务检查是否通过，不合并成一个 ok。 |
| RegulationDecision / RegulationOutcome | 分别是执行前的意图和执行后的结果，不是两份任务状态；RegulatorEffect 是连接后的本地运行实例。 |

通用 `liftEffect` 仍只是 `liftB` 的特化名称，不意味着需要另写一份实现。以上保留的是不同语义或边界投影，删除的是可以由同一上下文推导、却要求调用方重复提供的信息。

## 4. 单次效应关系

```haskell
-- 同构探针接口：输入 subject，执行后返回携带业务结果的调用信封。
type CheckProbe =
  Subject -> Effect (Envelope CheckResult)

-- 按完整检查引用取得探针关系，隐藏进程、HTTP 或内存载体。
check :: CheckRef -> CheckProbe

-- 单次观测：调用 checks，评估当前层级与晋级障碍，不调用 Agent。
pilot
  :: PilotInput
  -> Effect (Envelope PilotObservation)

-- 单次 Agent 执行：接收完整汇报，自行组织修复并给出调用结果。
agent
  :: AgentInput
  -> Effect AgentOutcome

-- 一次完整调节结束时的结果：结束原因与最后有效观测等必要信息，不等于一次 Agent 结果。
data RegulationOutcome

-- 完整调节效应：内部持续观测、决策、调用 Agent 并重探测，不管理外部 Behavior 订阅。
regulate
  :: RegulationInput
  -> Effect RegulationOutcome
```

`check` 是按完整引用选择探针的抽象关系；所属规格中的局部 CheckId 先在 Objective / Level 上下文中解析为 CheckRef。引用解析和进程、HTTP、内存等载体由运行时解释，不进入 PilotSpec。`Envelope PilotObservation` 是调用故障与可信观测分离的概念写法，不规定最终 API 必须采用这一外层结构。

`pilot` 调用 checks 并形成一次层级观测，不调用 Agent。`regulate` 表示由固定配方和 subject 发起的一次完整调节过程，其中可以发生多次 Pilot 观测和 Agent 执行；“单次效应”不等于“一轮修复”。观测作为过程内部状态并可向外暴露，不要求调用方先探测再启动调节。`RegulationOutcome` 是过程结束时的结果，不是中间观测流。

过程中的观测、决策及修复反馈属于调节效应的组合语义；外部配置的订阅、定时执行机制与按依赖替换仍交给运行时 / FRP 封装。这不要求在 Regulator 中另造一套 Behavior 引擎，也不引入逐问题任务调度器。

效应之间可以通过 Kleisli 组合连接：

```haskell
-- 按前一个效应的结果串接下一个效应，保留 Effect 上下文。
(>=>)
  :: (a -> Effect b)
  -> (b -> Effect c)
  -> (a -> Effect c)
```

不能把完整入口写成 `pilot >=> regulate`：regulate 接收的是配方与 subject，而不是观测。pilot 的结果在 regulate 内部经过故障分支处理，再进入纯决策和 Agent 输入投影。初始状态和调用故障都不能被当成业务问题交给 Agent 修复。

## 5. 统一提升与运行解释

```haskell
-- 将纯映射提升到随时间变化的输入上。
liftB
  :: (a -> b)
  -> Behavior a
  -> Behavior b

-- Applicative 组合：将两个 Behavior 的当前值交给一个纯函数。
liftB2
  :: (a -> b -> c)
  -> Behavior a
  -> Behavior b
  -> Behavior c

-- 将单次效应工厂提升为效应计算的 Behavior；此步不负责启动执行。
liftEffect
  :: (a -> Effect b)
  -> Behavior a
  -> Behavior (Effect b)

-- 运行与切换效应，暴露结果状态；替换前投递 Abort，首次结果前为 Initial。
activate
  :: Behavior (Effect a)
  -> Effect (Behavior (Sample a))

-- 使用本地环境与取消上下文解释效应，进入实际 IO。
runEffect
  :: Runtime
  -> AbortSignal
  -> Effect a
  -> IO a
```

`liftEffect` 是 `liftB` 在返回类型为 `Effect b` 时的特化，不是第二套业务逻辑：

```text
                pilot
PilotInput --------------------> Effect (Envelope PilotObservation)
    |                                            |
 Behavior                                     Behavior
    |                                            |
    v               liftEffect pilot             v
Behavior PilotInput -----------> Behavior (Effect (Envelope PilotObservation))
```

必须区分：

```text
Behavior (Effect a)           效应计算随时间变化，尚不代表已执行
Effect (Behavior (Sample a))  启动并管理执行后，得到结果的 Behavior
```

从前者到后者不是普通的纯 `map`。`activate` 抽象承载运行调度与生命周期；每个被替换的效应原则上先收到 Abort，再启动新效应。`runEffect` 是最外层解释边界，解析本地绑定并提供取消上下文。

这些签名不宣称存在适用于任意 Monad 的无条件交换律，也不定义相等性、定时器、清理宽限期或具体取消算法。

## 6. 组合图与闭环

```haskell
-- 将各项配置的 Behavior 组合为完整规格的 Behavior。
composeSpec
  :: Behavior PilotSpec
  -> Behavior RegulationStrategy
  -> Behavior AgentBinding
  -> Behavior RegulatorSpec

-- 已连接的本地运行实例：过程内观测与调节结果的 Behavior，关联运行生命周期；不可序列化。
data RegulatorEffect

-- FRP 封装入口：输入是配方与 subject 的 Behavior，暴露过程状态并管理依赖变化。
wireRegulation
  :: Behavior RegulationInput
  -> Effect RegulatorEffect
```

`composeSpec` 只组合三个规格来源；得到的 Behavior RegulatorSpec 再与 Behavior Subject 做 Applicative 配对，形成 Behavior RegulationInput。`wireRegulation` 管理外部输入变化并暴露过程状态，而不是把外部订阅塞回单次 `regulate`。

外部提升与内部持续观测是两种不同关系，不能用一次观测更新来重启整个调节过程：

```text
Behavior PilotSpec × Behavior RegulationStrategy × Behavior AgentBinding
                              |
                         composeSpec
                              |
Behavior RegulatorSpec × Behavior Subject
                              |
                      Applicative 配对
                              |
                   Behavior RegulationInput
                              |
                       wireRegulation
                              |
          过程观测与执行状态 / 最终调节结果

一次 regulate 的内部关系：
RegulationInput
      |
  pilotInput → pilot → 调用结果
                         |
                    可信观测 → decideRegulation
                                  |
                 达到目标 ←───────┤
                                  |
                    agentInput → agent
                                  |
                        完成后再次 pilot
                        触及限制则显式汇报
```

单次 Agent 执行完成后，可以在同一个 regulation 中继续观测，而不是要求整个 regulation 完成后再启动。反馈依赖真实执行结果，不是纯函数之间的瞬时递归，也不依赖 Spec 必须变化。periodic、adhoc 等具体触发机制由运行时 / FRP 层承接。

`liftEffect regulate` 在类型上仍成立，但“每次外部输入变化就整体 Abort 并重建”的直接组合不是依赖级复用的完整实现。wireRegulation 必须保留以下分层依赖；内部观测暴露也不能仅靠等待 RegulationOutcome 的通用 activate 获得。

依赖关系决定替换粒度：

- PilotSpec / Subject 变化影响观测效应及其依赖方。
- AgentBinding 变化影响修复效应，不重新创建未变化的 Pilot。
- Strategy 变化影响相应的调度、单次执行限制或修复效应，不无差别重建整张图。

执行限制约束一次 Agent 调用，不统计 problem 实例数，也不自动定义跨轮停止规则。触及限制后如何重探测或继续，由后续调度策略明确，不能默认为无限重试；执行冲突与 Agent 内部任务仍由 Agent 处理。旧效应的迟到结果不能冒充新输入的当前观测，这是框架状态一致性问题，不是业务冲突仲裁。

## 7. 整体关系

```text
静态数据组合       Spec × Spec → Spec
单次业务效应       Input → Effect Output
统一提升           (Input → Effect Output)
                    → (Behavior Input → Behavior (Effect Output))
调度与结果投射     Behavior (Effect Output) → Effect (Behavior (Sample Output))
本地解释           Runtime × AbortSignal × Effect Output → IO Output
```

核心分工是：领域函数描述一次计算，统一提升负责时间上的组合，运行解释层承担外部执行与生命周期；Agent 自行处理完整问题汇报。

## 8. Git 来源与规格构造的边界

`makeRegulatorSpec` 是纯数据构造，不访问 Git，不启动 Behavior，也不执行 Pilot。`composeSpec` 只是它在三个 Behavior 输入上的 Applicative 组合。

Git 仓库的获取与 ref 跟踪由领域无关的 git-source 负责，包边界见[包结构方案](./Package-structure.md#5-新建-potential-guidegit-source)。它只产生仓库快照及其 Behavior，不解释 PilotSpec。

```haskell
-- 仓库来源及跟踪方式：仓库、ref / 固定 commit 与刷新策略，不含领域定义路径。
data GitSourceSpec

-- 不可变仓库快照：确切 commit、仓库身份及绑定该版本的资源读取能力。
data GitSnapshot

-- 运行依赖：Git 获取、凭据、缓存与时间能力，不进入可序列化 Spec。
data GitSourceEnvironment

-- Git 来源故障：通信、权限、ref 或对象访问错误，不是 check 业务缺陷。
data GitSourceError

-- 首次结果前 Initial；之后明确区分来源故障与成功快照，复用通用初始模型。
type GitSourceState = Sample (Either GitSourceError GitSnapshot)

loadGitSnapshot
  :: GitSourceEnvironment -> GitSourceSpec
  -> Effect (Either GitSourceError GitSnapshot)

watchGitSnapshot
  :: GitSourceEnvironment -> GitSourceSpec
  -> Effect (Behavior GitSourceState)

-- 领域定义在仓库快照内的位置，从 Objective URI 解析，不重复写入 GitSourceSpec。
data PilotDefinitionPath

-- 载体无关的资源读取能力；薄适配将 Git 快照接入它，不让 Pilot 核心依赖 Git。
data ResourceResolver

-- 成功解析的规格与确切 SpecVersion；Objective 身份从规格取得，不复制。
data PilotSpecSnapshot

-- 组合入口的适配：保留仓库身份与版本，不在通用 Git 包中定义领域类型。
createPilotResourceResolver :: GitSnapshot -> ResourceResolver

-- 领域加载是 I/O 效应；纯解析 / 校验只是其中一部分。
loadPilotSpec
  :: ResourceResolver -> PilotDefinitionPath
  -> Effect (Envelope PilotSpecSnapshot)
```

关系为：Git 快照 Behavior → 资源适配与领域加载的通用效应提升 → Pilot 规格状态 Behavior → 配方组合。不能将 I/O 加载写成纯 fmap，也不能静默丢弃初始 / 来源故障状态。Pilot 不负责轮询 Git；Pilot 的 Git 适配先作为组合入口的薄模块，不默认独立成包。

运行机制已开始使用 Effect 4.0.2 做[隔离原型验证](../effect-frp-prototype/README.md)。Effect / Fiber / Stream 属于复用能力，运行句柄的取消不需要在业务 Outcome 中定义；原型并非完整 Behavior 或 Git 来源实现。
