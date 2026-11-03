# @potential-guide/task-protocol

Task Bundle 的完整引用可使用 `URL#sha256:<64 位小写十六进制摘要>`：
`parseBundleReference(reference)` 解析为 `{url, digest}`，
`formatBundleReference(bundle)` 校验并拼合为字符串。两者复用
`validateBundleReference` 的 URL 与 Digest 约束，非法输入抛出
`TaskError`（`invalid_request`）。获取 URL 不得带 fragment，包括空 `#`；
不截短、解码或修正 Digest，不改写 URL。HTTP 请求不发送 fragment。
请求在线路上仍使用 `{url, digest}`；内容判等与缓存使用 Digest，而非完整引用字符串。
辅助函数同时从包根与浏览器安全的 `@potential-guide/task-protocol/bundle-reference`
子入口导出；浏览器使用子入口，不引入 Node Schema 编译与摘要依赖。

可信宿主资源声明采用 `resourceLifetime: "request"`，或提供独立
`confirmResourceRelease(RunResourceContext)` 证明跨请求 owner/句柄已释放。
上下文包含可信 workerGeneration；这些宿主函数不进入类型 Worker。
失败 Result 与成功 Result 一样经纯 terminal 业务复验，不能改写或在恢复前放宽。

通用 Task/完整 Run 的 JSON、schema、请求、事件、Store 与服务边界。
TaskType 仅声明 type/version/inputSchema/resultSchema/messageSchema 和完整 run 入口；
Host 用 RegisteredType 本地模块描述注册，不传动态函数对象给 Engine。

matchPolicy / MatchPolicy 使用 starts-after-eligible、terminates-after-eligible 两值，after 包含等号。
时间对应完整 Run 开始/实际退出，不对应业务 Execution；已开始但未终结的 Run
可在可信源资格边界满足 terminates 条件。Stage 为 initial/running/stopping/stopped/completed/failed；
stage、canceled、按当前 now 推导的时间标签互相独立，取消或终态不冻结后两者。
Progress 另用 preparation/allocation/execution、可选有限 0–100 percent 与展示字符串。

messageSchema 支持 boolean，false 是 Never，{} / true 不是 Never。
messages 必选、Task 归属及确认与生命周期控制分离；checkpoint 是独立、按 resultSchema 验证的机器证据。
公共服务消息操作使用 taskId/messageId、可信 Caller、持久化状态，不改 Input/deadline。

Facts projection v4；Task 仅存受理/取消事实，匹配与状态按源前缀推导。
Task/Run Binding 保留原 inputSchema；实时共享与纯事实重放都使用该 Schema 编译的结构 Equals。
历史分组的 equivalenceKey 与 Equals 共用投影和序列化，由绑定 Schema 与原 Input 重建，不落盘为匹配权威。
允许但未声明的额外字段也参与比较，不能忽略其存在或取值差异。
Request 幂等冲突检查仍比较完整原始 Request，不使用结构 Equals。
全域源 revision、完整集合封装和 fromRevision 补读不使用每 Task 权威快照或绑定事务。
旧版本明确拒绝，无隐式数据迁移或删除。
完整协议与历史/取消/资源边界见 [Task Engine](../../docs/task-engine.md)。
