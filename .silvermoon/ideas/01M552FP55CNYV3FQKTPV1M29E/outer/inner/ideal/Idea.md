# 分离单次目标调节与多目标规划调度

## 问题

regulator 混合了一次目标达成与持续维护职责，并可能替多个根目标重复修复共享前置。supervisor 缺少方向规划、资源协调与执行生命周期的清晰边界。

## 结果

regulator 使用指定 Agent 和 quota 完成一次 detect-repair loop；supervisor 分为维护目标组合的 planner 与消费优先队列 Behavior 的 coordinator。规划、资源调度、观测指引和具体修复各司其职。

## 边界

- 主要变更 objective-regulator 与 objective-portfolio-supervisor，联动必要的 Pilot、CLI、配置、测试和文档；不重构无关包。
- planner 是可替换策略，MVP 通过 ACP 接入规划 Agent；coordinator 独占 Agent 资源选择、quota 分配和 run 生命周期控制。
- 不发布 npm，不接入真实付费服务或安装新 Agent；能力建设需求经过规划和授权，不自动扩权。

## 验收标准

- 单次调节可多轮执行，正常返回完成、额度耗尽或前置不满足，不自行周期跟进或修复其他目标；输入错误、执行异常和外部终止可区分。
- planner 根据用户输入、规范变化、观测与执行反馈更新优先队列，达标目标仅在重新发现推进需求后入队；共享前置需求可以归并。
- coordinator 按实时优先级及资源容量调度；普通优先级不抢占，P0 按需抢占且排队告警，支持 abort 后超时 kill；通过构建、自动化与安装产物验证。
