# 以不可变请求的周期后继统一 Coordinator 调度

## 问题

一次达标与周期维持不应分别依赖 Coordinator 和 Portfolio Supervisor。现有请求替代、终结及额度规则尚不能清楚表达周期派发，也缺少让上层按具体耗尽情况决定追加投入的统一边界。

## 结果

统一使用带固定 eligibleAt 和可选 recurrence 的不可变 Request；派发时生成新的周期后继，Run 保持相同执行语义。耗尽可靠上报，由外部决定是否额外推进。

## 边界

- 不新增 Maintain 类型、Cycle 或内置 Planner Agent；周期调度由 Coordinator 承担。
- 时间到期不授予资源或额度；不自动续跑耗尽工作，不实现 MCP 传输或跨 Host 全局协调。
- 核心语义见[请求与派发](./Request-model.md)、[事件与共存](./Events-and-arbitration.md)；旧设计只作背景，不自动成为本次契约。

## 验收标准

- 一次性与周期请求共享派发路径；后继、恢复和取消不重复执行或积累补跑。
- 同 Target 请求可共存且本地执行互斥；显式替代不误撤销周期意图。
- 所有请求的额度耗尽均可追溯、可重读；额外推进不隐式补充预算。
