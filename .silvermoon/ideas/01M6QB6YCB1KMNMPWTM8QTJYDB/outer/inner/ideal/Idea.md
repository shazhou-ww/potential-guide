# 诊断 Task 启动与物理回收失败

父 IDEA：[check-delivery-acceptance-followups](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/Idea.md)；来源建议：[R-09](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/recommendations/R-09-engine-lifecycle.md)。完整内容已复制至[修改建议](./Recommendation.md)。

## 问题

当前 Bundle 消费链路仍需区分配置拒绝、启动超时、测试观察窗口耗尽和物理清理未确认；旧 Probe 适配包已退役，历史失败和重试不能直接证明当前产品根因。

## 结果

基于当前 Engine、Worker 和 Check 消费事实提供有界因果诊断与可控复现，明确失败阶段和仍缺失的证据，而不制造第二套生命周期真相。

## 边界

- 仅覆盖现行 Bundle Engine、宿主、Check 消费和对应测试，不恢复已删除的 check-task/probe-task、旧类型注册或旧 Host。
- 遵守 [Run 终止](../../../../../../docs/axis/task-engine-contracts/run-termination.md)及[独立日志](../../../../../../docs/axis/task-engine-contracts/run-logs.md)边界：诊断是已有事实的有界投影，日志、ACK、结果及连接关闭均不替代物理退出与回收证明。
- 不先假定各故障同根，不通过放宽超时、清除 ownership 或循环重试冒充修复；历史与当前未复现原因保持未知。

## 验收标准

- 失败快照区分配置/准入拒绝、Worker 启动、观察窗口、业务预算与释放未确认，展示可信身份、事实顺序及所缺证明。
- 受控时序案例可定位责任组件，未复现的原因保持待查。
- CI 重试保留首轮诊断，任何修复均保持未知 cleanup 时的安全约束。
