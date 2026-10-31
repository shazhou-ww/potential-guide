# @potential-guide/task-protocol

可信宿主资源声明采用 `resourceLifetime: "request"`，或提供独立
`confirmResourceRelease(RunResourceContext)` 证明跨请求 owner/句柄已释放。
上下文包含可信 workerGeneration；这些宿主函数不进入类型 Worker。
失败 Result 与成功 Result 一样经纯 terminal 业务复验，不能改写或在恢复前放宽。

通用 Task/完整 Run 的 JSON、schema、请求、事件、Store 与服务边界。
TaskType 仅声明 type/version/inputSchema/resultSchema/messageSchema 和完整 run 入口；
Host 用 RegisteredType 本地模块描述注册，不传动态函数对象给 Engine。

matchPolicy / MatchPolicy 保持 started-after-eligible、terminated-after-eligible 两值，
时间对应 Run 开始/逻辑终结，不对应业务 Execution。Stage 为 initial/running/completed/run_failed；
Progress 另用 preparation/allocation/execution、可选有限 0–100 percent 与展示字符串。

messageSchema 支持 boolean，false 是 Never，{} / true 不是 Never。
messages 必选、Task 归属及确认与生命周期控制分离；checkpoint 是独立、按 resultSchema 验证的机器证据。
公共服务消息操作使用 taskId/messageId、可信 Caller、持久化状态，不改 Input/deadline。

Facts projection v3；旧版本明确拒绝，无隐式数据迁移。
完整协议与历史/取消/资源边界见 [Task Engine](../../docs/task-engine.md)。
