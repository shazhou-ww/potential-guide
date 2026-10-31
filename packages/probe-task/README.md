# @potential-guide/probe-task

宿主资源桥按 Run/Worker 代际记录子需求所有权，`confirmResourceRelease` 独立等待
取消后的子需求物理释放。child-submit 返回句柄、类型发送 released 或 callback 返回，
都不能替代这项证明；旧代际 dispose 不影响新代际所有权。

`createProbeTaskType(options)` 是静态 Host 注册工厂。类型守护负责完整 Run；
观察业务 Worker 保持独立，Child Task 通过最小、可信、按 Run 所有权限制的资源桥访问服务。
Caller/scope、Check 环境、容量及 Source 权限来自 Host，不从 Input 或消息拼接。

Input 保持 objective、subject、context?、bindings?、language?、targetLevel?。
父 Run 从准备前开始，兼容需求无需再次准备。Child 使用自己的 Task/Run identity，
独立等待预算和物理所有权 barrier；取消一个共享需求不误杀其他需求。

messageSchema 为 false，业务消息均拒绝；取消不受 Never schema 限制。
标准 Progress 只展示 stage/percent?/message。
`probe-prepared` 和 `probe-progress` checkpoint 保留固定 Bundle 与因果机器证据。
成功 Result 保持 observation、references、evidence.operations，
evidence 另含 prepared、parentRunId 和完整 Run 的 startedAt；失败是明确 failure/evidence 分支。
Check 子阶段 executionId 来自 Check Result 业务证据，不把它当成父 Run 标识。

历史复验在原类型守护中读取已固定 bytes/digest 和 Child 事实重放纯观察，不下载、不创建 Child、
不运行旧业务副作用。跨实体墙钟回退依赖持久化事件顺序，不伪造统一的物理时钟。
本包不注册通用 Regulator、不实现新的治理记账。

完整协议及新数据库边界见 [Task Engine](../../docs/task-engine.md)。
