# 实施设计

## 分层与迁移

`check-runtime-files` 只抽取既有 no-follow、ACL/owner、执行树快照与文件锁。
`check-artifacts` 和 `check-host` 共同依赖该底层，Host 再依赖 artifacts；禁止环。
旧 Host 导出原语的入口保持 re-export，历史格式、制品 digest 和证据不改写。

同一 Host 进程组装 ArtifactManager、TaskScheduler 和 CheckKernel。
Scheduler 的受理、版本绑定、匹配、开始、结束、取消、期限与订阅注册都是同步短事务；
来源、文件和 worker IO 在事务之外，只通过身份关联的完成回调进入状态机。
Kernel 在发送 execute 消息之前回调逻辑开始，不采用 worker 的 started 通知。
Worker 仍独占一次 Execution；旧代次消息继续由 Kernel 的 generation/checkId 检查过滤。

v1 暂时双栈：目录/revision、旧 NDJSON 与内置 npm/Git worker 调用继续明确走 `/checks`。
新 HTTPS 制品 Objective 与普通新客户端改用 v2；不把旧参数静默解释为 URL。
后续 Release idea 才承担内置制品全量迁移和移除 v1；本项不变更历史 schema。
HTTP v2 是新协议，不复用旧 task/evidence schema URI。
v1 集合与单 check 操作只公开 legacy 执行；managed v2 executionId 在 v1 观察/取消中
明确 404，避免旧适配器越过独立 Task 需求直接取消共享 Execution 或暴露其私有目录。
因此 v1 集合不能作为全 Host（含 v2）空闲证明。

## 有界协议

默认 30 秒 Task 总期限，最大 120 秒；期限从鉴权/结构检查后受理锚点计量。
Task/Execution 各保留最多 256 条，终态保留 60 秒；超限拒绝，不透明重跑。
执行墙钟默认 30 秒，初始化/清理默认 5 秒；Task 新需求不能延长执行墙钟。
最多 32 制品、4 并行来源准备、64 事件连接、每条过滤流 64 个 Task。
32 制品为私有目录原语的 64 项扫描上限留出 mutex、暂存及并发准备余量；
服务配置拒绝大于 32 的制品容量，不为增大缓存而放松既有安全原语。
准备最多 30 秒；沿用已有 72 MiB 压缩/64 MiB 交付/256 文件/512 路径限额。
SSE 每连接最多 64 条待发送通知及一个待 drain 帧，超限断开；写操作在状态机外异步批次执行，
避免初始多个大快照在第一次 drain 前必然断连。all 初始可见范围超过 64 条时明确 429。
连接最多 60 秒，
重连补当前快照，不承诺事件日志重放。SDK 每 Client 共享一个过滤流，各订阅队列 64 帧。
不存在或已过期 Task 返回 404/task_unavailable；打开订阅收到 task_expired 后明确失败。

默认 HTTPS 来源 allowlist 为 GitHub 与 Release assets origins；
`PGUIDE_CHECK_SOURCE_ORIGINS` 可由 Host 启动者显式替换，不接受调用方任意扩权。
每跳重新检查 HTTPS/无内嵌凭据/无 fragment/allowlist，最多四跳，正常 TLS，
不携带 cookie 或 Authorization；不允许自动来源降级或陈旧缓存兜底。
普通 provenance 不保存 query、fragment、userinfo 和远端错误正文。
digest 是内容一致性，不代表发行者签名。

provenance 进一步收紧为 origin-only，避免敏感值藏在 URL pathname。
Host 重启后先按准确 digest 验证保留的 capsule；只从内容恢复的元数据使用
`retained-cache` 来源标记，不编造历史网络确认。Task/Execution 仍不恢复或透明重跑。
缓存发布按完整 digest 串行化，网络来源确认仍独立；原始 Reference 返回同一次完整树
验摘要得到的字节。准备/引用/结果持有引用与微任务交接保护，容量满时仅回收无引用内容。

## 检查与证据

[执行记录](./verification.md)记录实际命令与结果；完成之前不得勾选对应 ledger。
实现中以最小编译/状态机测试先收敛，再进行真实 HTTPS、HTTP/SDK、worker 清理、
业务调用链回归，最后运行仓库要求的完整 `pnpm check`。
