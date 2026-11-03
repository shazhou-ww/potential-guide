# @potential-guide/probe-task

`createProbeTaskType(options).run` 是可由 SDK 打包的普通业务回调。
作者固定 `checkBundle:"根CID"` 或 `{cid,hint}`，显式配置 Source、可信 scoped child
client 和 Check 内容身份；不要从 Input 或消息拼装权限。
Engine 直接启动 SDK Worker，不注册 Check/Probe、不桥接业务资源、
不安装这些业务包。观察 Worker 已嵌入代码，无作者安装目录依赖。
静态工厂元数据保留给库级调用，不是通用 Engine 的注册 API。

Input 是 objective、subject、context?、bindings?、language?、targetLevel?。
Child Check 使用标准 Request/Task/Run API 与三态受理结果，有独立身份、
等待预算和物理释放 barrier；preparing token 不被当作 Task。
取消父需求只撤销其拥有的 Child Task，不误杀共享 Run 的其他需求。
子 Task 终态不是实际执行证据：当前执行会读取独立 Run/Run history，
核对真实身份、完成结果、开始历史及精确 Check Bundle CID；hint 不参与身份比较。
Generic Run.environment 仍是实际 Node 环境，不伪装成业务内容身份。

messageSchema 为 false，业务消息均拒绝；取消走独立控制通道。
Progress 仅展示 stage/percent?/message；
`probe-prepared` / `probe-progress` 保存固定内容及因果机器证据。
成功结果保留 observation、references、evidence.operations 和 prepared、
parentRunId、startedAt。失败保留已有机器证据，不生成成功 fallback。
Checker executionId 不等于父或子通用 Run ID。

当前业务结果/证据核验保留；**历史查询不再启动旧业务代码重放观察**，
只读取通用持久事实和声明 Schema。重启时已开始而没有退出事实的
Probe/Check Run 恢复 stopped，不再次观察，不伪造退出时间或资源释放。
本包不引入新的 Regulator、治理记账或权限模型。

完整协议见 [Task Engine](../../docs/task-engine.md)。
[公共包样例](../../examples/task-server/README.md)提供自包含 Bundle、
真实独立 Child HTTP 及 SQLite 重启验证。
