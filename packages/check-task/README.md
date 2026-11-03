# @potential-guide/check-task

`createCheckTaskType(options).run` 是作者可直接包装的普通 SDK 回调：
`export default (input, context) => check.run(input, context)`。
用 `@potential-guide/task-sdk/build` 将它及全部第三方依赖打进自包含
`worker.cjs`；Engine 只接收 `{bundle:"根CID", ...}` 或 `{bundle:{cid,hint}, ...}`，不注册业务类型、
不安装本包、不提供资源桥。Checker 执行 Worker 已嵌入交付代码，不读取作者
安装目录中的脚本。旧静态工厂元数据保留给库级调用，不是通用 Engine 的注册 API。

业务 Source 权限、可信根目录、资源容量由作者回调显式设置。
Input 是 checker reference、subject、context?、language?；浮动业务 URL 在 Run
内固定，精确业务版本仍使用原 digest。Task Bundle 的根 CID 则覆盖完整可执行文件树，
两者不能混淆。共享与调度由通用 Engine 按完整合法 Input 判等、当前资格协调；
宿主仅设通用容量，没有业务专用全局 allocation lane。

每次执行仍创建独立 Checker Worker。业务结果及准备内容、subject/result、
执行身份和环境证据仍在**当前实际执行**中核验。结果为
`{result,evidence:{prepared,execution,businessProgress}}`；失败是明确
`{failure,evidence}`，没有成功形状 fallback。`executionId` 是 Checker 子阶段，
不是通用 Run ID。messageSchema 为 false；Progress 只展示，
`check-prepared` / `check-progress` 保留机器证据。

历史查询读取持久事实及锁定声明 Schema，不启动旧业务 Worker 复验。
已开始而无退出事实的旧 Run 恢复 stopped，不重演副作用；
未开始的有效 Task 继续按原创建时间/期限协调。环境证据不包含环境变量值。

完整 v5 协议见 [Task Engine](../../docs/task-engine.md)；
作者/宿主分离、直接消费及真实 HTTPS/file 业务样例见
[公共包示例](../../examples/task-server/README.md)。
