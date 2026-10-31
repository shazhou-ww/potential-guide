# @potential-guide/task-engine-http

以可信 resolveCaller 和 EngineOptions.authorize 包装 TaskService，不从请求正文推断 Caller、scope 或能力。
提供 task-types、tasks、requests、event-history 与 SSE；History 使用 taskId/runId/seriesId。
`GET /runs` 使用独立 `list-runs` 权限，返回不含业务载荷的冻结 Run 摘要。
`GET /tasks?runId=…` 使用 Task `list` 权限查询已绑定关联需求；两种权限互不授予。
Run/Task/事件游标域独立，旧 `/executions` 与 `executionId` 查询明确拒绝。
Task 创建采用 Idempotency-Key，If-Match 可固定当前契约 revision；请求使用 matchPolicy。

业务消息为 POST/GET `/tasks/:taskId/messages/:messageId`，POST 正文仅含 payload。
消息使用独立 message 服务授权、schema 校验和当前已绑定/已投递 Run 路由。
202/queued 不代表业务接纳；读取持久化 accepted/rejected/unknown，
重复同身份返回原状态，改变意图为冲突，Never 类型明确拒绝。
取消走 `/tasks/:taskId/cancel`，不受业务消息 schema 限制；断开 SSE 不取消 Task。

展示进度、结构化 checkpoint/Result 证据、deadline、共享与恢复边界见
[Task Engine](../../docs/task-engine.md)。不支持旧 executionMatch 或旧结果形状 fallback。
