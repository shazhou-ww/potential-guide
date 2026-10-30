# 将 Regulate 接入统一任务服务

## 问题

统一任务服务能够检查和观察后，仍缺少可接续投入并由受授权 Agent 执行的治理任务，旧治理执行和通用生命周期存在重复职责。

## 结果

在 [Check + Server MVP](../../../../01M65ABHR94EQ14NYTGZAWRRV3/outer/inner/ideal/Idea.md) 和
[Probe](../../../../01M65AH22HXJXNC7BQNVD0ZTHB/outer/inner/ideal/Idea.md) 完成后交付 `@potential-guide/regulate-task`，
注册 `type=regulate`，经同一服务运行观察、修复和再观察，支持资源接续与成果共享，
复用 ACP/AHP 并以 VS Code Copilot AHP 验证真实闭环，
正常返回目标达成、耗尽或无法自行解决的阻碍。

准备期已明确需求、并发治理与 execution join 讨论及未决问题见
[Discussion.md](Discussion.md)；其中候选方案尚未定稿，不代表验收或实施授权。

## 边界

- 通用生命周期复用[任务引擎](../../../../../../docs/task-engine.md)，不新增 Regulation Host 或第二套状态机；同 Digest/Revision、同 subject 且执行条件兼容者可接续投入、共享成果并分别完成，不以 URI 判合流，不改写旧结果。
- 等待期限只用 Task Deadline，移除独立治理时间配额和连续停滞限制；已启用资源额度合取，Token 不强制首版统计，共享 execution 无固定总上限。权限与业务资源竞争属于 Agent 执行环境，不另建全局资源锁。
- 不全量迁移旧入口或正式发布；引擎仍管理 Worker 与退出清理证明，未知修复不自动重放，有可靠证明即可自动释放相应隔离，否则报告阻碍。动态请求不自授权，取消不承诺回滚，不承诺 exactly-once。

## 验收标准

- 独立消费者经同一 Server 提交治理请求，以准确 Objective 和真实 Probe 证据完成修复与重查，目标达成、资源耗尽和阻碍均可正常返回，与执行故障区分。
- 权限不足、配额耗尽、依赖未满足和并发请求均不会产生未授权或错误合并的副作用；修复完成不能替代新的达标观察。
- 进展、结果和故障能经授权历史追溯；取消、资源清理和进程重启有真实证据，未知修复不静默重跑或伪装成已完成。
