# 依赖问题模型与治理闭环

本文服务于 [Idea](./Idea.md)，是设计候选，不是实现完成声明。包级修改与测试见 [修改清单](./Change-map.md)，协议和行为抽象的对照见 [Haskell Before / After](./Protocol-before-after.md)。

## 1. 核心决策

1. Observation 始终描述被观察的 Objective。观察 A，current 始终属于 A，不因依赖 B 而切换归属。
2. 两种 problem 都由当前 Objective 的 check 检出，按解决责任区分：internal 由当前 Regulator 治理，dependency 交给 Supervisor。
3. dependency 是统一格式的事实，不需要 ProblemRef、问题 ID、任意参数或嵌套 observation。
4. 未达目标且存在 dependency 时，Regulator 正常结束本次运行，上抛全部依赖，不调用当前 Agent；混合内部问题时也一样。
5. 删除静态 prerequisite 协议，不保留旧规范树、旧结果类型或兼容读取。

## 2. 数据模型

以下是目标协议，沿用现有 ObjectiveId、LevelId、Subject、ProblemRef 和 Envelope：

```ts
interface DependencyProblem {
  readonly kind: "dependency";
  readonly objectiveId: ObjectiveId;
  readonly subject: Subject;
  readonly expectedLevelId: LevelId;
  readonly currentLevelId: LevelId;
}

interface InternalProblem {
  readonly kind: "internal";
  readonly ref: ProblemRef;
  readonly parameters: JsonObject;
}

type Problem = InternalProblem | DependencyProblem;

type CheckProblem =
  | {
      readonly kind: "internal";
      readonly id: ProblemId;
      readonly parameters: JsonObject;
    }
  | DependencyProblem;

type CheckResult =
  | { readonly ok: true; readonly problems: readonly [] }
  | {
      readonly ok: false;
      readonly problems: readonly [CheckProblem, ...CheckProblem[]];
    };
```

### 字段与约束

- objectiveId 为规范化的外部 manifest URI，不是别名、命令或 Agent binding。
- subject 指定外部治理实例，必须是有效 JSON object，不能隐式沿用消费者的 subject。
- expectedLevelId 是需要达到的最低层级，currentLevelId 是本次检查观察到的实际层级。
- terminal 必须显式给出；层级按目标 manifest 的数组顺序比较，不按字符串比较。
- 依赖问题只用于已知 current 低于 expected 的情况。外部观察失败或层级未知走错误路径，不伪造成最低层级。
- 相同目标、subject、阈值的问题可去重；不同消费者的阈值不能丢失。

### Observation 与聚合

保留 PilotObservation 的 current、problems、gapSummary、observedAt、versions，只替换 problems 元素类型。不增加顶层 dependency 或 rootCurrent。

Pilot 按当前 Objective 的层级顺序执行，返回首个未通过层级及其全部问题。内部 CheckProblem 在聚合时补齐当前 check 的 ref，并检查 ID 已声明；DependencyProblem 不需要在 manifest 问题列表登记，不附加 ref。

gapSummary 对内部问题使用现有引用页；依赖问题采用本地化统一描述，显示外部对象、预期和当前层级，不查找 problem Wiki 页。

### 示例

```json
{
  "current": {
    "objectiveId": "git+https://example.org/objectives.git#release/pilot.yaml",
    "levelId": "publish"
  },
  "problems": [{
    "kind": "dependency",
    "objectiveId": "git+https://example.org/objectives.git#environment/pilot.yaml",
    "subject": {"environment": "staging"},
    "expectedLevelId": "ready",
    "currentLevelId": "provisioning"
  }]
}
```

示例省略未改变的 observation 公共字段。它描述发布目标卡在 publish，而不是发布目标变成环境目标。

## 3. 发现依赖与来源证据

静态已知与运行期发现的依赖使用相同协议：check 执行到相关层级时，根据当前输入决定是否观察外部 Objective。入口依赖可写成第一层的 check，中间依赖写在实际需要它的层级。subject 投影属于具体 check 逻辑，可复用现有工具，不再需要 prerequisite 专用配置。

检查应复用外部 Pilot 观察，而不是根据 Agent 自报或命令退出码推测层级。目标达标不产生依赖问题；目标未达标才产生 DependencyProblem。外部 B 自己被 C 阻塞时，A 的问题仍指向 B，currentLevelId 仍是 B 自身层级；C 由之后治理 B 时交接。

### 版本、解析与执行上下文

删除静态加载链后，必须显式补齐动态解析，不能假设外部规范及 probes 已加载：

- Pilot 的来源适配层提供受控的外部观察接口，输入目标、subject、预期层级，输出经过校验的观察和版本证据。
- 保留 memory/HTTP/process 的统一 envelope；process stdin 继续只有 subject，不将内部运行时对象混入 subject。
- 各适配器必须接通外部观察与证据通道；原始 dependency payload 不能只做形状校验就视为可信状态。
- versions 记录当前 Objective 与本次实际观察的所有外部 Objective 的精确提交；同 ID 冲突版本明确失败。
- 复用观察级 versions，不给每个 dependency 重复携带完整 PilotSpec 或提交字段。
- Supervisor 根据交接 observation 的版本表解析目标，不重新使用可变 HEAD；目标与 subject 校验失败明确暴露。

外部观察辅助接口与 HTTP/process 证据传递属于必做实现点。其具体传输应沿用已有来源与探针设施，在实现阶段确定并用集成测试证明；不以提前加载静态 prerequisite 链兜底，也不要求本轮另建通用服务框架。

同一观察作用域内固定来源快照、共享截止时间并传递 AbortSignal。递归观察以 Objective ID + canonical subject 检测调用栈重入；限制深度和总预算，错误明确可诊断。

## 4. Regulator

将 prerequisite-unmet 替换为 dependency-required；删除 RegulationPrerequisite 和 regulationPrerequisite。RegulationOutcome 改为判别联合，其中依赖分支示意为：

```ts
type DependencyRequiredOutcome = RegulationOutcomeBase & {
  readonly stopReason: "dependency-required";
  readonly dependencies: readonly [
    DependencyProblem,
    ...DependencyProblem[],
  ];
};
```

公共部分保留 iterations、latestObservation、stalledRuns 等现有字段。dependencies 必须与 latestObservation 中的依赖问题一致；该字段是显式交接载荷，不是第二套可独立修改的状态。其他停止分支不携带 dependencies。

决策顺序：

1. 验证 observation 的 current 属于当前 Objective，层级与问题结构合法。
2. 已达到本次 targetLevel，返回 target-reached；不因更高目标才需要的依赖扩大当前治理范围。
3. 未达目标且有 dependency，返回 dependency-required，全部上抛且不调用 Agent。
4. 只有 internal 问题，按原有权限、配额和停滞策略调用 Agent。

混合问题也立即交接，不尝试挑选可独立治理的内部问题。交接不是错误或 exhausted，不新增 Agent 次数；依赖等待不累计内部 stall。已有内部运行历史仍保留。

Regulator 不递归运行另一个 Regulator、不自动授权、不接受 Agent 用自然语言 blocked 原因创建外部目标。运行中新发现的依赖须经后续 check 确认为结构化问题。

## 5. Supervisor

顶层业务接口与行为范式保持不变：仍接收目标、资源并通过已有 result 事件处理治理结果，不增加独立依赖提交接口。RegulationOutcome 的更新会传递到事件载荷类型；内部调度与运行时解析接线需要修改，不能将「抽象接口不变」理解为所有类型和实现都不动。形式化对照见 [Supervisor 协议边界](./Protocol-before-after.md#5-supervisor顶层交互范式不变)。

### 接收与派生目标

对当前 demand revision 的交接，校验成功 observation、依赖载荷及来源版本证据；解析外部规范和运行时，验证 subject、层级与 current < expected，再创建或合并提供者 goal。

以 Objective ID + canonical subject 作为实例身份；相同身份不同固定规范版本明确报冲突，不静默合并。共享目标取最高所需层级及既有规则下的较紧急优先级。

Planner 注入异步目标解析接口，CLI 实现受控 Git 来源与运行时绑定；策略不能返回任意 spec、binding、命令或权限。解析失败在状态与调用错误中可见，不静默放行或忙重试。

### 每个消费者独立满足

等待关系保存消费者、提供者及最低层级，而不是每个消费者仅保存一个 child ID。一次交接可产生多个等待项：

```text
A 需要 B >= L1
C 需要 B >= L3
共享 B goal 推进至 L3
B 到达 L1：A 可恢复，C 仍等待
```

观察提供者时逐项判断，消费者的全部当前要求满足后，更新其 demand revision 并重新观察它。不能仅以共享提供者 goal 完成、Agent completed 或旧 currentLevelId 判断满足。

### 生命周期与资源

- 每次有效交接替换该消费者当前 revision 的依赖集合，不累积历史问题。
- 删除根目标或替换配方时释放旧等待；旧 revision 的迟到反馈不能创建派生目标或唤醒新目标。
- 派生目标仅在不再被存活根目标通过等待关系引用、且未显式注册时回收；一个消费者删除不应清除共享目标。
- 周期观察提供者，外部自行达标也能恢复消费者；恢复后重新观察，不直接标记消费者成功。
- 退化后按新观察重新建立问题，不将一次满足视为永久保证。
- 当前治理已让出执行，因此在实际未满足的实例等待图上检测自依赖和闭环，显式报告路径；不因规范潜在互引就拒绝。
- Coordinator 等执行实际退出后释放槽；保留 stopping 占槽、P0、取消与确认清理的既有行为。

## 6. 删除与排除项

直接删除 Manifest.prerequisite、PilotSpec.prerequisite、递归加载/校验、跨目标 describeLevels 拼接及旧停止原因。不把它们改名后继续保留。

不引入 OR 依赖、可选依赖、任意工作流步骤、依赖规则实体或额外持久化事件系统。历史交付凭证与当前层级不同，本版不混用。

不做向前兼容，也不自动迁移当前工程和 Silvermoon 工程已有 Objective 定义；两个工程均留待之后单独手动迁移。协议更新期间旧定义不可运行是明确的过渡边界，不通过兼容读取掩盖。
