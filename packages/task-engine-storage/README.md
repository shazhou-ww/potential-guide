# @potential-guide/task-engine-storage

显式本地 SQLite Store：WAL、foreign keys、FULL durability、事务事件/索引/检查点及独占 lease。
Facts projection 与 SQLite user_version 均为 3。旧版本、未知格式和混合记录在写入前明确拒绝；
不会迁移、覆盖或删除现有用户数据库，请选择新路径。

Run 从准备前开始；开始、投递代际、进度、结构化证据、终结、消息状态和物理清理分别持久化。
旧 Run 的未知副作用不自动重跑；准备 checkpoint 不恢复调用栈。
保留连续事件、时间更新恢复、固定水位分页/SSE 和受引用/未回收资源保护的 compact。
未确认清理不释放 Engine lease，也不伪造 reclaimed 事实。

业务历史复验在原类型 Worker，不在 Store 加载动态代码；
原配置、版本/契约或内容不可用时明确拒绝，不提供成功形状 fallback。
完整说明见 [Task Engine](../../docs/task-engine.md)。
