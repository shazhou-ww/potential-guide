# @potential-guide/check-task

`createCheckTaskType(options)` 返回可信 Host 的静态 RegisteredType，不在 Host 创建业务执行池或调用类型代码。
完整 run、准备和资源调度在类型守护；Checker Bundle 在独立业务 Worker。

Input 保持 checker reference、subject、context?、language?，Input Schema 为 object。
浮动 URL 的内容在 Run 内固定，可被兼容需求共享；精确版本用 digest。接收方不再次准备或资源授权。
实际 resolve / Checker 使用仍经 Source 资源动作授权；权限不来自 Task 或运行消息。

messageSchema 为 false（Never），统一 messages 通道存在，但任何业务消息都拒绝；取消走独立控制通道。
Progress 使用统一展示结构，不能读取 message 中的机器 JSON。
准备内容通过 `check-prepared` checkpoint 持久化，业务进度通过 `check-progress` 保留机器证据。
最终结果为 `{result, evidence:{prepared, execution, businessProgress}}`；
失败为 `{failure,evidence}`，没有成功形状 fallback。
execution 中的 executionId/startedAt/completedAt 仅是实际 Checker 子阶段，不是 Run。

历史 Bundle、digest、subject/result 和环境一致性在原类型 Worker 纯复验，不下载、不执行旧 Checker。
环境身份只含指纹，展示/证据不携带环境变量值；scratch directory 不定义执行环境身份。
当前每次业务执行仍创建新 Checker Worker，不宣称已实现 Bundle 热 Worker 复用。

完整共享、消息及 SQLite v3 边界见 [Task Engine](../../docs/task-engine.md)。
