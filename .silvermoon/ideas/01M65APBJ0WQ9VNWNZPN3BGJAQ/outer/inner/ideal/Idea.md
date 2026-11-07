# 将 Regulate 接入统一任务服务

## 问题

统一任务服务能够检查和观察后，仍缺少可接续投入并由受授权 Agent 执行的治理任务，旧治理执行和通用生命周期存在重复职责。

## 结果

以自包含 Task Bundle 交付治理回调，经根 CID Request 在现行 Engine 上完成
观察、授权修复与新观察；复用 ACP/AHP，并以 VS Code Copilot AHP 的真实闭环证明
目标达成、资源耗尽或无法自行解决的阻碍，不要求注册 type=regulate 或恢复旧 MVP 适配包。

资源接续与协作仍是业务目标；当前架构映射及保留的历史讨论见
[Discussion.md](Discussion.md)，旧 execution join 候选不直接扩展 Engine 协议。

## 边界

- 通用生命周期遵守 [Axis](../../../../../../docs/axis/task-engine-responsibilities.md)：Bundle 按 CID 装载，无预注册；共享完整 Run 仍须满足 Input、scope 与匹配政策。Objective 的准确 Digest/Revision 是业务身份，不能替代 Bundle CID 或绕过共享条件；不同目标的结果不能借业务投影提前终结 Task。
- 等待期限只用 Task Deadline，不因追加投入延长；已启用额度合取、首版不强制 Token、单次 Agent 限额与无固定共享 execution 总上限均属于业务策略。业务消息保留 Task 归属，投入不自授权；资源竞争由 Agent 环境处理，不新增 Engine prerequisites、周期状态机或全局资源锁。
- 复用现有治理/Check 库但不恢复退役 check-task/probe-task，不全量迁移或正式发布；未知已启动修复不自动重演。取消、逻辑结果、宿主退出和物理回收分别证明，不将 AHP 断连或日志当作远端退出，不承诺回滚或 exactly-once。

## 验收标准

- 独立消费者经当前 Server 提交 Bundle CID 请求，以准确 Objective 和真实新观察完成修复与重查；目标达成、资源耗尽和阻碍均是可靠业务结果，与执行故障区分。
- 权限不足、配额耗尽、依赖未满足和并发请求均不会产生未授权或错误合并的副作用；修复完成不能替代新的达标观察。
- 进展、结果和故障能经授权历史追溯；共享与消息不改变 Task/Run 事实模型，取消、资源清理和重启有真实证据，未知修复不静默重跑或伪装成已完成。
