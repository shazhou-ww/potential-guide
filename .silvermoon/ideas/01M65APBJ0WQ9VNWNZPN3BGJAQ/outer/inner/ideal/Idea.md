# 将 Regulate 接入统一任务服务

## 问题

统一任务服务能够检查和观察后，仍缺少受授权与配额约束的治理任务，旧治理执行和通用生命周期存在重复职责。

## 结果

在 [Check + Server MVP](../../../../01M65ABHR94EQ14NYTGZAWRRV3/outer/inner/ideal/Idea.md) 和
[Probe](../../../../01M65AH22HXJXNC7BQNVD0ZTHB/outer/inner/ideal/Idea.md) 完成后交付 `@potential-guide/regulate-task`，
注册 `type=regulate`，经同一服务运行有界的观察、修复和再观察，明确报告目标达成、耗尽或需外部处理。

准备期已明确需求、并发治理与 execution join 讨论及未决问题见
[Discussion.md](Discussion.md)；其中候选方案尚未定稿，不代表验收或实施授权。

## 边界

- 通用幂等、调度、递归、取消及恢复复用[任务引擎](../../../../../../docs/task-engine.md)；业务保留目标等级、修复配额和明确授权，不新增 Regulation Host 或第二套任务状态机。
- 动态依赖和 Agent 请求不授予权限，不因同一 Objective 自动共享有副作用的修复；取消不承诺回滚，重启不自动重放未知修复，也不承诺 exactly-once。
- 本项聚焦单次有界治理及其任务接入；跨目标治理策略、人工授权和 Coordinator 的剩余业务职责需明确交接，不顺带删除或改写，不包含正式发布和全量旧入口迁移。

## 验收标准

- 独立消费者经同一 Server 提交治理请求，以准确 Objective 和真实 Probe 证据完成授权修复与重查，正常业务停止和执行故障可区分。
- 权限不足、配额耗尽、依赖未满足和并发请求均不会产生未授权或错误合并的副作用；修复完成不能替代新的达标观察。
- 进展、结果和故障能经授权历史追溯；取消、资源清理和进程重启有真实证据，未知修复不静默重跑或伪装成已完成。
