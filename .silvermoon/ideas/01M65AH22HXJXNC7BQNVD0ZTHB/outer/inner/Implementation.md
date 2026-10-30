# Implementation

实施顺序为 Check + Server MVP、Probe、Regulate；本项以前者的交付和验收为前置。
实现使用现行公开 TaskType、TaskEngine、Store 与 HTTP/SSE，不另建第二套生命周期。
实际验证结果、边界及完整变更清单见 [Evidence.md](Evidence.md)。

## Steps

### I-S01: 定义 Probe 类型与准确观察

建立 `probe-task` 的输入、准备、结果和进展契约，复用或提取已有 Objective/Pilot 解释能力。
明确根与静态 Checker 的准确内容、实际环境及动态依赖选版证据，保留等级、问题、References 和 requirements 语义，
不引入旧 Host 任务协议或新的业务调度器。

将 `objective-host` 的真实制品观察解释提取到 `check-artifacts/observation`：
同一个确定性 effect iterator 同时服务旧适配器、新 Probe 和无 IO 的证据重放。
`check-artifacts/contracts` 继续保持独立验证入口。Probe Prepared 持久化完整根及静态
Checker 字节、语言和真实环境；动态选版在结果 transcript 中保留完整准确内容。
结果包含累计等级、业务问题、组合 References、父执行与每个子任务/执行的因果关联。
Check 增加可选有限 JSON `context` 透传以承载解析后的 requirements，不改变原输入语义。

### I-S02: 组合子 Check 与资源生命周期

通过受信任注入的通用任务接口提交、观察和撤销本次执行拥有的子 Check；
业务进展记录父子因果与准确引用，业务缺口不自动启动治理。
固定父子时间预算、执行匹配、调用深度和数量上界；父观察资源与子 Check 容量分离，
避免父任务等待占满子执行槽位。取消不撤销其他 owner，清理完成才报告资源释放。

Probe 使用真实 Worker 作为观察根和独立有界 Pool；通用可信 `allocationLimit`
把父分配通道与 Check 通道分离。`waitForTaskRelease` 由 Engine 判断共享 owner 与
物理清理边界，不在 Probe 复制所有权状态机。只有 `options.start()` 提交身份后才能
创建 Worker 或提交 Check。根 Worker 退出、所属子任务撤销/清理确认后才复用容量；
无法确认则隔离，绝不把普通 Promise 声称为已强杀。
默认深度 8、观察数 64、Check 数 128、墙钟 60 秒、清理确认 5 秒；请求不能提高权限或限额。
Task deadline 不等于执行取消，迟到事实及未知启动恢复遵守原 Engine 投影。

### I-S03: 接入 Server 并验证包边界

提供同一 Server 注册 Check 与 Probe 的配置及进程内示例，复用公共 HTTP/SSE。
验证旧算法提取后的回归、包导出和独立消费者；明确未迁移旧入口继续使用原语义，
不要求先删除全部 objective-host 或 objective-pilot 才交付本项。

通用 Server 仅增加可信 `bindService` 注入时机与通用分配配置；业务注册留在
`examples/task-server/probe-config.mjs`。`probe-integration.mjs` 是可复跑的生产包消费者
验证入口，覆盖进程内、真实 HTTP/SSE 重连和 SQLite 重开，不代替现实世界部署验收。
源仍使用当前授权 HTTPS API；不实现其他会话负责的本地文件支持。

## Acceptance criteria

### I-AC01: 观察结果与证据准确

用累计等级、多 Check、动态依赖、未知问题和无效结果用例证明业务解释正确；
按准确引用和子任务关联可追溯实际调用，正常业务未达标不误报为执行故障。

### I-AC02: 父子推进与取消可靠

通过单个 Check 槽位及并发父 Probe 的受限容量测试证明没有嵌套资源死锁；
确定性时间、共享取消、物理退出和重启测试证明无权限扩大、无子任务泄漏，
未知执行不会被自动重跑，迟到结果遵守引擎既定投影。

### I-AC03: 公共入口与交付一致

进程内与真实 HTTP/SSE 对照测试证明结果、历史和恢复一致，注册 Probe 不需修改通用 Server 内核。
打包消费者、依赖检查和 `pnpm check` 通过，保留入口的行为没有因算法复用被破坏。
