# Implementation

## Steps

### I-S01: 分离阶段语义并注入同级调度策略

细化 guide API 与 probe 流程，使同阶段 checks 相互独立，由调度控制执行并行度，
并由完整的阶段结果决定推进。保留前置条件屏障和明确的操作错误。

建议在 `ObjectiveLoaderOptions` 中增加 `checkSchedulingPolicy` 函数，与现有
`checkRunner` 注入并列，由 loader 传入 guide，并用于同一 loader 加载的前置 guide。
每次 probe 在前置条件和前序阶段均满足、即将执行当前 level 时调用一次策略；
策略接收只读的 `instance`、`levelId` 和 `checkIds`，返回本次该 level 的最大并行度，
允许同步或异步返回。策略通过闭包接入宿主资源预算，无需写入 manifest，
也不改变现有无参数 `probe()` 及 regulator 的调用方式。

以下为实施阶段待细化的最小接口草案，不是现有 API：

```ts
type ObjectiveCheckSchedulingPolicy = (context: {
  readonly instance: ObjectiveGuideInstance;
  readonly levelId: ObjectiveLevelId;
  readonly checkIds: readonly CheckId[];
}) => number | Promise<number>;

const loader = createObjectiveLoader({
  checkSchedulingPolicy: ({ checkIds }) =>
    Math.min(4, Math.max(1, checkIds.length)),
});
```

未注入时默认并行度为一，仅保留串行执行的资源使用习惯，不保留失败短路。
策略返回值必须为正的安全整数；无效值和策略异常明确导致 probe 失败，不静默回退。
空 check 集合直接满足推进条件，不调用策略。核心负责限流执行、结果校验与按 manifest
顺序汇总问题；业务失败不跳过同级 checks，所有结果通过后才进入下一 level。
策略不接收 runner 或执行回调，不能筛掉 checks、伪造结果或提前推进。
并行度限制作用于单次 probe 的当前 level，不承诺跨实例或跨 probe 的全局限流。
操作异常时，已启动的任务必须结束后才能清理共享临时目录并报告失败。

### I-S02: 验证阶段与调度行为

添加确定性测试，覆盖 checks 重叠执行、受限并行与串行调度、同阶段多项失败、
阶段屏障及前置条件行为。对受影响的 regulator 和 portfolio 集成进行验证。
同时覆盖策略上下文、每阶段调用次数、默认并行度、无效返回值、策略异常，
以及操作异常时已启动任务与临时目录的生命周期。

### I-S03: 记录阶段契约

更新直接相关的包文档，区分已达成的 levels、独立 checks 与实际调度。
记录公共 API 的变更及共享临时目录带来的影响。
明确调度策略在 loader 上的注入方式、对前置链的适用范围与单次 probe 的限流边界。

## Acceptance criteria

### I-AC01: 注入策略控制独立 checks 的并行度

通过确定性的 runner 测试证明：同阶段 checks 在允许时重叠执行，遵守配置的并行度，
且同级 check 失败后其他 checks 仍具备执行资格，串行执行时也不例外。
证明调用方策略通过 loader 注入后获得正确的阶段上下文，并在前置链及重复 probe
中按阶段调用；未注入时并行度为一，无效策略结果和策略异常不会静默回退。

### I-AC02: 阶段观测与屏障保持正确

通过测试证明：当前阶段的失败信息以确定性方式报告，后续阶段等待当前阶段的所有
checks 通过，前置条件保持原有解锁行为，无效结果或 runner 错误明确导致操作失败。
证明操作失败时不会在已启动任务结束前清理共享临时目录。

### I-AC03: 集成与文档保持一致

受影响的包测试、仓库类型检查和 lint 均通过，包文档准确描述实现的语义和调度 API。
