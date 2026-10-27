# 统一周期请求调度并退役 Portfolio Supervisor

## 问题

一次达标与周期维持应统一交给 Coordinator。周期请求已完成，但旧 Portfolio Supervisor、Planner 和 supervise 入口仍保留另一套体系，Coordinator 也仍从旧包借用公共能力。

## 结果

保留不可变 Request 的时间、周期后继和耗尽上报语义，迁出必要公共能力，删除 Portfolio Supervisor 及旧 supervise 包，使 Coordinator 不再直接或间接依赖旧监督体系。

## 边界

- 不新增 Maintain 类型、Cycle、替代 Supervisor 或内置 Planner Agent；保留 Coordinator 与 Regulator 的独立能力。
- 时间到期不授予资源或额度；不自动续跑耗尽工作，不实现 MCP 传输或跨 Host 全局协调。
- 核心语义见[请求与派发](./Request-model.md)、[事件与共存](./Events-and-arbitration.md)及[退役边界](./Supervisor-retirement.md)；历史证据保留，不冒充新增范围已完成。

## 验收标准

- 一次性与周期请求共享派发路径；后继、恢复和取消不重复执行或积累补跑。
- 同 Target 请求可共存且本地执行互斥；显式替代不误撤销周期意图。
- 耗尽可追溯且不隐式补充预算；旧两包、命令及活跃依赖与发布配置清除，独立消费者仍可使用 Coordinator。
