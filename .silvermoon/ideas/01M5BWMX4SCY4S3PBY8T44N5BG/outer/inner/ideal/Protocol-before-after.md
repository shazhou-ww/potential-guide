# Haskell 伪代码：Pilot / Regulator 协议与 Behavior 的 Before / After

本文服务于 [Idea](./Idea.md)，形式化解释 [依赖设计](./Dependency-design.md)，不引入额外运行时或兼容协议。Before 描述当前实现，After 描述提议的新协议；两者是对照，不会同时保留。

## 1. 不变的行为范式

以下为 Haskell 风格伪代码，不是可编译模块。省略语言页、运行配额、权限字段与来源适配器细节；它们仍按原协议执行，不表示删除。Before / After 代码块视为独立命名空间。

```haskell
data Effect e a
data Behavior a
data Scoped a
data Cause e

data Envelope a
  = Success a
  | InvocationFault Status Message

data Sample key e a
  = Initial
  | Ready key a
  | Failed key (Cause e)
  | Cancelled key

activateLatest
  :: (input -> Key)
  -> (input -> Effect e output)
  -> Behavior input
  -> Scoped (Behavior (Sample Key e output))
```

- Effect 是可取消、带资源生命周期的单次计算，不是纯函数，也不简化成自动重试的 IO。
- Behavior 是输入/输出快照随时间变化的抽象，对应现有 SubscriptionRef，不要求引入新的 FRP 库。
- Scoped 表示观察输入、替换计算及清理都由作用域拥有。
- Envelope 省略了成功状态 200 与 message 的机械字段；InvocationFault 对应非成功 status、null payload 与 message。
- Failed 对应原生计算失败，InvocationFault 仍是正常计算返回的错误 envelope；业务问题不是这两类错误。

activateLatest 保留现有语义：完整输入 key 改变才取消旧计算并启动新计算；旧 generation 的迟到结果不得覆盖新结果。发送取消不等于已确认退出；替换不等旧 finalizer，关闭作用域须等待清理。相同 key 不会因上次计算已经结束而自动重跑，替换期间可保留带旧 key 的上次 sample。

**本次不改变 Effect 到 Behavior 的提升方式，改变的是被提升的计算内部协议与治理决策。**

## 2. Before：静态 prerequisite 链

### 2.1 类型协议

```haskell
data PilotSpec = PilotSpec
  { objectiveId  :: ObjectiveId
  , levels       :: NonEmpty Level
  , prerequisite :: Maybe Prerequisite
  }

data Prerequisite = Prerequisite
  { childSpec     :: PilotSpec
  , project       :: Subject -> Either ConfigError Subject
  , minimumLevel  :: LevelId
  }

data CheckProblem = CheckProblem ProblemId Parameters
data Problem = Problem ProblemRef Parameters

data CheckResult
  = CheckPassed
  | CheckBlocked (NonEmpty CheckProblem)

data Observation = Observation
  { current     :: LevelRef
  , problems    :: [Problem]
  , gapSummary  :: Text
  , observedAt  :: Timestamp
  , versions    :: Map ObjectiveId Commit
  }

data StopReason
  = TargetReached
  | PrerequisiteUnmet PrerequisiteDemand
  | Exhausted Exhaustion
  | AuthorizationRequired (NonEmpty AuthorizationRequest)

data Outcome = Outcome
  { stopReason        :: StopReason
  , latestObservation :: Envelope Observation
  , iterations        :: Int
  , stalledRuns       :: Int
  }
```

Prerequisite 的 childSpec 来自预加载的递归规范；project 在实现中是确定性 subject 投影，minimumLevel 未填写时默认 terminal。每个 Objective 最多有一个直接 prerequisite。

CheckPassed / CheckBlocked 是对现有 ok 与 problems 一致性约束的代数表达，wire 格式仍是 JSON。

### 2.2 Pilot：可能返回 prerequisite 的 observation

```haskell
observe
  :: PilotRuntime
  -> PilotInput
  -> Effect PilotError (Envelope Observation)

observe runtime input = do
  prepared <- prepareWholeChain input
  observePrepared runtime prepared

observePrepared runtime input =
  case prerequisiteOf input of
    Nothing ->
      observeOwnLevels runtime input
    Just requirement -> do
      childInput <- projectChildInput input requirement
      childResult <- observePrepared runtime childInput
      case childResult of
        InvocationFault status message ->
          pure (InvocationFault status message)
        Success childObservation ->
          if reachesChildMinimum requirement childObservation
            then observeOwnLevels runtime input
            else pure (Success childObservation)
```

prepareWholeChain 在任何 probe 前校验整条链。reachesChildMinimum 同时校验 observation 的归属与最低层级；更深祖先阻塞不能误判直接 child 已达标。observeOwnLevels 与来源上下文保留当前实现的版本汇集。

因此观察 A，返回的 current 可能属于 B 或更深祖先。ProblemRef 也属于实际返回的那个 Objective。链上的层级还可被 describeLevels 拼接为跨 Objective 顺序。

### 2.3 Regulator：通过外部 current 识别前置依赖

```haskell
data Decision
  = Stop StopReason
  | Execute AgentInput

decide
  :: RegulationInput
  -> Observation
  -> Either RegulationError Decision

decide input observation
  | ownerOf (current observation) /= rootObjective input = do
      validateKnownAncestor input observation
      demand <- directPrerequisiteDemand input
      pure (Stop (PrerequisiteUnmet demand))
  | reachedTarget input observation =
      Right (Stop TargetReached)
  | otherwise = do
      validateRootProblems input observation
      pure (Execute (agentInput input observation))
```

即使观察定位到更深祖先，交接仍返回规范中已知的直接 prerequisite 及投影 subject，而不是任意外部目标。

## 3. After：当前 Objective 的问题包含外部依赖

### 3.1 类型协议

```haskell
data PilotSpec = PilotSpec
  { objectiveId :: ObjectiveId
  , levels      :: NonEmpty Level
  }

data Dependency = Dependency
  { objectiveId     :: ObjectiveId
  , subject         :: Subject
  , expectedLevelId :: LevelId
  , currentLevelId  :: LevelId
  }

data CheckProblem
  = InternalCheckProblem ProblemId Parameters
  | DependencyCheckProblem Dependency

data Problem
  = InternalProblem ProblemRef Parameters
  | DependencyProblem Dependency

data CheckResult
  = CheckPassed
  | CheckBlocked (NonEmpty CheckProblem)

data StopReason
  = TargetReached
  | DependencyRequired (NonEmpty Dependency)
  | Exhausted Exhaustion
  | AuthorizationRequired (NonEmpty AuthorizationRequest)
```

Observation 和 Outcome 的外层结构沿用 Before，引用本节新的 Problem 与 StopReason。DependencyProblem/DependencyCheckProblem 对应同一个扁平 JSON 结构 kind: dependency，不新增实际 wire 包装层。NonEmpty 保证交接不可能不带依赖；枚举携带载荷对应 TypeScript 的判别联合。

没有 Prerequisite 类型、嵌套 PilotSpec、dependency ProblemRef 或新的顶层 observation dependency。内部问题仍有声明 ID 与补齐后的 ref。

### 3.2 Pilot：只观察本目标，依赖由 check 表达

```haskell
observe
  :: PilotRuntime
  -> PilotInput
  -> Effect PilotError (Envelope Observation)

observe runtime input = do
  prepared <- prepareOwnObjective input
  observeOwnLevels runtime prepared

scopeProblem
  :: CheckRef
  -> CheckProblem
  -> Either PilotError Problem

scopeProblem checkRef (InternalCheckProblem problemId parameters) = do
  validateDeclaredProblem checkRef problemId
  pure (InternalProblem (problemRef checkRef problemId) parameters)
scopeProblem _ (DependencyCheckProblem dependency) =
  Right (DependencyProblem dependency)
```

scopeProblem 只说明归属转换，不代替完整验证。所有依赖在此之前必须经过受控外部观察及证据校验；失败走 Envelope/Effect 错误路径。只有已证实外部 current 低于 expected 的结果能成为业务问题。

observeOwnLevels 仍执行当前层的全部 checks，聚合问题，在首个阻塞层返回；没有问题则推进，最终返回本目标 terminal。由此保证：

```haskell
ownerOf (current observation) == rootObjective input
```

例如 A 的 publish check 根据环境输入观察 B，发现 B 尚未 ready，就返回 DependencyCheckProblem。这不使 A 的 current 变成 B，也不强制 A 从第一层就等待 B。

### 3.3 Regulator：通过问题类型决定交接

```haskell
data Decision
  = Stop StopReason
  | Execute AgentInput

decide
  :: RegulationInput
  -> Observation
  -> Either RegulationError Decision

decide input observation = do
  validateOwnObservation input observation
  if reachedTarget input observation
    then Right (Stop TargetReached)
    else case nonEmpty (dependenciesOf (problems observation)) of
      Just dependencies ->
        Right (Stop (DependencyRequired dependencies))
      Nothing -> do
        validateActionableInternalProblems observation
        Right (Execute (agentInput input observation))

dependenciesOf :: [Problem] -> [Dependency]
dependenciesOf problems =
  [dependency | DependencyProblem dependency <- problems]
```

validateOwnObservation 拒绝外部 current、非法层级及无效问题。内部问题的 ref 必须属于本目标当前层；dependency 不要求 ref。先判断本次 target 是否已达成，避免为更高目标才需要的依赖扩大治理范围。

即使 problems 同时包含 InternalProblem 与 DependencyProblem，也返回全部依赖、零次新 Agent 调用；只有纯内部问题进入 Execute。

### 3.4 单次治理循环：交接是正常完成，不是异常

```haskell
regulate
  :: RegulationRuntime
  -> RegulationInput
  -> Effect RegulationError Outcome

regulate runtime input = loop
  where
    loop = do
      observation <- probeWithPolicy runtime input
      publishObservation observation
      decision <- liftDecision (decide input observation)
      case decision of
        Stop reason ->
          finishNormally reason observation
        Execute agentInput -> do
          enforceQuotaAndStallPolicy
          executeAgentWithLimits runtime agentInput
          loop
```

该循环只展示决策骨架：probeWithPolicy 按既有策略处理调用故障，授权请求、Agent 失败、取消、时间截止与 finally 清理仍保留；publishObservation 的事件包装与 Outcome 公共 envelope 由现有运行时负责。

Before 也使用这个观察/决策/执行骨架，但 decide 的依赖来源不同。After 在返回 DependencyRequired 前不增加内部 stall；不把等待当作 Exhausted 或 Effect 失败，也不在本循环内调用另一个 Regulator。

## 4. Pilot / Regulator 的 Behavior 签名不变

```haskell
pilotBehavior
  :: PilotRuntime
  -> Behavior PilotInput
  -> Scoped
       (Behavior
         (Sample Key PilotError (Envelope Observation)))

pilotBehavior runtime =
  activateLatest pilotInputKey (observe runtime)

data RegulatorView = RegulatorView
  { observation :: Behavior
      (Sample Key RegulationError (Envelope Observation))
  , outcome :: Behavior
      (Sample Key RegulationError Outcome)
  }

regulatorBehavior
  :: RegulationRuntime
  -> Behavior RegulationInput
  -> Scoped RegulatorView
```

regulatorBehavior 抽象对应现有 observation 与 outcome 两个输出 ref：内部观察可多次发布，最后发布本次治理结果；用 generation 过滤旧回调。其真实 API 的 close 资源管理在此抽象为 Scoped，不表示它与 Pilot 的返回实现完全相同，也不承诺两个输出 ref 原子更新。

Before / After 的签名形状一致，载荷类型发生改变：

```haskell
-- Before
Ready key (Success observationOwnedByPrerequisite)
Ready key (Outcome (PrerequisiteUnmet directChild) ...)

-- After
Ready key (Success observationOwnedByCurrentObjective)
Ready key (Outcome (DependencyRequired dependencies) ...)
```

DependencyRequired 是 Ready 中的正常结果，不是 Failed，也不是 Cancelled。它结束当前执行 generation，不会自行保持一个阻塞中的 Agent，或自行等待外部目标后继续原循环。

Supervisor 收到交接后调度提供者；所有要求满足时，先重新观察消费者，并按现有 demand revision/执行槽生命周期安排新的治理。相同输入的 activateLatest 不会自行重启，因此不能仅将同一个输入快照再写一次就当作恢复机制；需要新运行的生命周期，不能为了唤醒而给业务 subject 塞入伪字段。

## 5. Supervisor：顶层交互范式不变

Supervisor 仍然接收 goals 与资源状态、安排 Regulator 运行并消费运行结果；不增加单独的「提交依赖」命令或第二条反馈通道。以已有结果反馈入口为例，其抽象形状在两版中相同：

```haskell
feedback
  :: Supervisor
  -> CoordinatorEvent
  -> Effect PortfolioError ()

-- Before: 已有 result 事件携带旧 Outcome。
handleResult demand (Outcome (PrerequisiteUnmet child) ...) =
  arrangePrerequisite demand child

-- After: 同一 result 事件携带新 Outcome。
handleResult demand (Outcome (DependencyRequired dependencies) ...) =
  arrangeDependencies demand dependencies
```

这里的 handleResult 是内部处理伪代码，不是新增公共方法。goals 更新、queue/state 输出与 Coordinator 事件通道的交互形状均保持原有范式。

「接口不变」指顶层业务交互与行为范式，不表示所有 TypeScript 类型定义或回调配置逐字不变：CoordinatorEvent 的 result 载荷引用 RegulationOutcome，该联合类型已不兼容更新。动态目标解析所需服务属于运行时依赖接线；可能需要调整构造 options，但不应扩展成第二套业务协议。

内部必须支持多个等待项、各消费者独立阈值及动态来源绑定。它们是履行同一调度职责的实现变化，不能因为抽象接口不变便省略。

## 6. 差异总结

| 维度 | Before | After |
| --- | --- | --- |
| 规范组合 | 每个规范静态嵌套一个 prerequisite | 当前规范独立，无递归依赖字段 |
| Pilot current | 可能属于前置链其他 Objective | 始终属于当前 Objective |
| 业务问题 | 只有声明 ID/ref 的内部问题 | 内部问题与无 ref 的统一依赖问题 |
| 依赖触发 | 开始本目标检查前先观察前置链 | 相关层 check 在实际需要时产生 |
| Regulator 判断 | current 外部归属 + 已知直接前置 | problems 中出现 DependencyProblem |
| 交接载荷 | 一个已知直接 prerequisite 的治理要求 | 本次观察的全部外部依赖 |
| 混合问题 | 无独立依赖问题分支 | 立即交接，不调用当前 Agent |
| 跨目标治理 | Supervisor 推进静态链派生目标 | Supervisor 统一调度动态目标与多等待项 |
| Supervisor 顶层交互 | 目标、资源与治理结果反馈 | 不变，结果载荷随 Regulator 协议更新 |
| Effect/Behavior | 可取消、快照替换、迟到隔离 | 不变，不增加自动重跑或递归治理 |

本次是协议替换，不是同时支持两个范式。当前工程和 Silvermoon 工程既有 Objective 定义仍留待之后手动迁移。
