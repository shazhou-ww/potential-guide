# @potential-guide/task-engine-storage

显式本地 SQLite Store：WAL、foreign keys、FULL durability、事务事件/索引/检查点及独占 lease。
Facts projection 与 SQLite user_version 均为 4。旧版本、未知格式和混合记录在写入前明确拒绝；
不会迁移、覆盖或删除现有用户数据库，请选择新路径。

Task 仅持久化受理/取消事实；必要的资格观测载荷只有 observedAt，不写绑定或 Task 权威快照。
Run 从准备前开始；开始、投递代际、进度、结构化证据、可靠 outcome、停止请求/确认、退出、
消息状态和物理清理分别持久化。未退出的 Run 恢复为 stopped，不伪造其实际退出或回收。
旧 Run 的未知副作用不自动重跑；准备 checkpoint 不恢复调用栈。
检查点是完整源前缀重放可核验的物化视图，不是独立权威。
持久保存数据域身份、单调 ULID 准入下界、仍可受理 ID 的幂等凭据及签名游标密钥；
固定水位分页/SSE 和受引用/未回收资源保护的 compact 不使下界回退。
未确认清理不释放 Engine lease，也不伪造 reclaimed 事实。

业务历史复验在原类型 Worker，不在 Store 加载动态代码；
原配置、版本/契约或内容不可用时明确拒绝，不提供成功形状 fallback。
完整说明见 [Task Engine](../../docs/task-engine.md)。
