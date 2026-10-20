# MVP：objective-pilot 层级判断与依赖 probe

本文服务于 [Idea](./Idea.md)，补充 [依赖模型](./Dependency-design.md) 与 [Haskell 对照](./Protocol-before-after.md)。以下均为待实现 API，不是现有导出或实现完成声明。

## 1. MVP 范围

优先在现有 `@potential-guide/objective-pilot` 包导出两个能力：

1. checkObjectiveLevel：复用 Pilot.observe，判断外部目标是否达到 expected level。
2. createObjectiveDependencyProbe：复用上述判断，将 false 转为统一依赖问题。

运行脚本直接 import 并调用；不新增独立包、不新增 check 子命令或 --as-probe 模式，不引入布尔 stdout 解析、临时 report 中转和嵌套命令进程。已有 CLI 的 probe 功能保持不变。

```text
来源组合层绑定 spec + runtime
  → checkObjectiveLevel：passed + 同次 observation
  → dependency probe：true 通过，false 变为依赖问题
  → 现有检查运行入口输出统一 envelope
  → Pilot 聚合 → Regulator 交接 → Supervisor 调度
```

## 2. 层级判断函数

目标 API 的类型形状：

```ts
interface ObjectiveLevelCheckInput extends PilotInput {
  readonly expectedLevelId: LevelId;
}

interface ObjectiveLevelCheck {
  readonly passed: boolean;
  readonly observation: PilotObservation;
}

declare function checkObjectiveLevel(
  input: ObjectiveLevelCheckInput,
  runtime: PilotRuntime,
): Effect.Effect<Envelope<ObjectiveLevelCheck>, Error>;
```

沿用现有 Effect 计算范式，构造不执行、运行才观察。错误 envelope 与 Effect 原生失败的区别保持不变，取消通过 Effect 运行边界传入，不新增另一套异步取消模型。

- 接收已绑定的 PilotSpec、subject、语言和 runtime；核心包不新增 Git/CLI 配置依赖或隐式解析服务。
- 验证 subject、expectedLevelId 及 observation 归属；expected 没有默认值，terminal 必须显式填写。
- 执行一次 observe，按规范数组顺序比较 current 与 expected，相等或更高为 true，更低为 false。
- 成功时同时返回 passed 与同次 observation；不复制一份 report 类型、不在 false 后重新观察。
- 调用故障不包装成 passed: false；只有可信的成功观察可以产生布尔业务结果。
- 该函数不生成 problem、不执行 Agent、不调度外部目标。

## 3. 依赖 probe

createObjectiveDependencyProbe 绑定外部 spec、expectedLevelId、语言与 runtime，返回符合现有 CheckProbe 调用形状的函数。补齐证据收集回调的类型，避免示例依赖未定义的服务：

```ts
type ObjectiveDependencyTarget = Omit<ObjectiveLevelCheckInput, "subject">;

interface DependencyObservationContext {
  readonly recordObservation: (
    input: PilotInput,
    observation: PilotObservation,
  ) => void;
}

declare function createObjectiveDependencyProbe(
  target: ObjectiveDependencyTarget,
  runtime: PilotRuntime,
  context: DependencyObservationContext,
): CheckProbe;
```

这是同进程的最小证据贡献契约：回调核对本次来源身份并合并 versions，冲突或缺失证据抛出显式错误。它不是可省略的日志，也不执行第二次观察。来源绑定层提供回调，检查作者不需要自行实现状态存储或报告解析。

调用示意：

```ts
import {
  createObjectiveDependencyProbe,
} from "@potential-guide/objective-pilot";

// spec/runtime 由检查的来源组合层提供；以下不是完整进程入口。
const probe = createObjectiveDependencyProbe(
  { spec, expectedLevelId: "ready" },
  runtime,
  observationContext,
);

const envelope = await probe(externalSubject, signal);
```

observationContext 的类型是 DependencyObservationContext，不是新增业务 subject 字段或通用服务。返回的 CheckProbe 保持现有 Promise/envelope 调用形状；它内部在调用者 signal 下运行 checkObjectiveLevel 的 Effect，并等待该次运行清理完成，不增加脱离调用者的后台任务。

probe 内部运行 checkObjectiveLevel，并在同一计算中完成转换：

| 判断结果 | 输出 |
| --- | --- |
| passed: true | status 200，payload 为 ok: true、problems: [] |
| passed: false | status 200，payload 为 ok: false、包含统一 dependency problem |
| 调用故障 | 错误 envelope，payload: null；取消保持原生取消 |

依赖问题直接从目标与返回 observation 得到 objectiveId、subject、expectedLevelId、currentLevelId，不附加 ProblemRef。仅 probe 构造业务问题，判断函数保持独立复用。

probe 将同次 observation 的 versions 贡献给父观察上下文，true 和 false 都要记录。重复 ID 的冲突版本明确失败；不从另一份可变 HEAD 或历史缓存补证据。

## 4. 运行脚本与来源绑定

检查脚本只做目标绑定/subject 投影、调用 probe 和既有 stdin/stdout 协议读写，不手写布尔解析或 problem 转换。subject 必须是外部 Objective 所需对象，不能默认等于消费者对象。

一个 level 可以用单个组合 probe 判断多个目标，也可拆成多个 check 分别复用。均应聚合全部未满足依赖，而不是碰到第一个 false 就丢掉剩余结果。

import 不会消除实际进程边界：外部来源的精确版本、递归调用栈、截止时间、取消与清理仍由来源/探针适配层显式关联。MVP 复用既有绑定与运行脚本设施，仅补齐依赖观察所需的最小上下文传递，不另建进程执行框架、通用服务或新包。

现有 process probe 仍接收 Envelope<CheckResult>，而不是裸 boolean。运行脚本调用库函数转换后输出该 envelope；依赖证据必须通过受控适配关联回父观察作用域，不能只相信脚本输出的目标与层级字段。

**尚需实施阶段确定并验证的接线**：recordObservation 回调只能在同进程贡献状态，不能穿过 stdout 自动修改父观察。跨进程版本贡献的传递格式与来源绑定仍需在现有探针适配层落地；预算/调用栈关联也需跨进程测试证明。在完成这一步之前，只能说进程内 API 分层已定义，不能宣称“任意 run.js 只 import 就已端到端可用”。本设计不以重新增加 CLI/report 框架来掩盖这一边界。

## 5. 验证与排除项

- 库函数的 passed 与同次 observation 一致，覆盖非字典序层级、相等、超过及 terminal。
- 无效 subject/层级、归属错误、调用失败与取消均不伪装成 false。
- probe 复用单次观察，正确转换 true/false，并贡献成功与失败依赖的版本。
- 运行脚本可以只 import 现有包并调用，不要求安装新包或启动 check 子命令。
- 组合与拆分检查得到相同未满足依赖集合；同层聚合和 Regulator 立即交接语义保持不变。
- 跨进程绑定验证版本冲突、预算、取消与清理；不省略上下文传递后宣称已支持直接使用。

本轮仅收敛设计，不实现 API、不发布软件。当前工程和 Silvermoon 工程既有 Objective 定义之后单独手动迁移；不提供兼容层。独立包、CLI 入口及更多便利封装只在后续出现明确需求时再评估。
