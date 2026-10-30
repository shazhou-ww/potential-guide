# Deployment

在源码仓库外验证已接受的 Probe 交付，不包含 npm 发布、修复 Agent 或 Regulate。
本契约与 harness 必须先同步，再基于准确 deploymentRevision 执行；
编写 harness、语法检查或主体世界测试均不是下述现实世界结果。

## 验证协议

由父执行者同步本契约及 [verification/verify.mjs](verification/verify.mjs) 等支持文件，
重新观测稳定的 deploymentRevision，然后执行：

```powershell
node .silvermoon\ideas\01M65AH22HXJXNC7BQNVD0ZTHB\outer\verification\verify.mjs --external-root D:\Code\probe-deployment-<新的唯一名称> --revision <已同步的deploymentRevision>
```

目标目录必须使用绝对路径、此前不存在、父目录已存在，且物理路径不能与任何已登记
Git 工作树重叠。执行前要求当前工作树干净、HEAD 的 Outer tree 等于传入 revision、
Inner tree 仍为 `d874dd9608e4c17935b6d81e578d2dc509c0620a`，
且 HEAD 与已接受代码提交 `b54b44400925f9853323115c459079bafb405827` 的 packages tree
均为 `8c7910f64171b2392e4bf9c399382a552714bbef`。
父执行者负责构建产物已就绪；harness 不修改已接受代码、不重新构建或替换其算法。

程序打包九个内部生产包，在新目录中通过 tarball 与 pnpm overrides 建立独立生产安装。
记录提交、各包 Git tree、tarball SHA-256、已构建 runtime 文件哈希、命令时间与退出码、
锁文件哈希、安装依赖图和实际 realpath，并检查安装 runtime 文件与打包前字节一致。
消费者只能导入自身安装的公开包；禁止工作树链接、旧 Host、Objective Pilot 和 Agent/Regulate 依赖。
`check-artifacts` 原有 `esbuild`、`tar` 等生产依赖据实登记，不声称安装层面隔离。

夹具由外部消费者使用公开制品 author API 创建，记录 Objective/Checker 的完整内容 digest、
archive 哈希与下载记录。来源是授权 HTTPS 身份到本次拥有 archive 的可信下载器映射，
不是实际远端 HTTPS 服务，也不是本地文件协议功能。
同一个注册 Check/Probe 的独立服务进程提供进程内 IPC 入口和鉴权 HTTP/SSE。
配置固定为两个 Probe worker、一个 Check worker、`maxConcurrent=1`、
16 MiB payload、60 秒执行墙钟和 5 秒清理确认；五个不同父请求必须在 45 秒内完成。
单次 HTTP、IPC、启动、关闭及整体运行均设有限预算，具体取值与实际耗时进入结果。

仅观察的 [worker-probe.cjs](verification/worker-probe.cjs) preload 包装原生 Worker 构造，
不替代生产执行器；记录准确生产 Worker 路径、父/子执行关联、启动与实际 `exit` 事件。
另由受管 Checker 生成固定的 Node 子进程，并检查其准确 PID 消失；
不以 pool 计数、端口关闭或逻辑 Task 终态代替物理退出。
正常关闭经 IPC 请求 `server.close()` 后自然退出，不强制 `process.exit(0)`。
故意 crash 只证明整个拥有进程已消失，不伪称取得被中断线程的优雅退出事件。

SQLite 实验分别保留已完成结果、已启动 Probe/Check 和未启动但已准备的 Probe。
重启前替换根来源 archive，重启后的下载器拒绝读取替换内容。
queued 根使用公开 `targetLevel=initial`，证明原 Prepared 根与静态 References 未被新来源替换；
不将此结果扩大为“所有新建子 Check 均能离线执行”。
另一个已准备但未启动的独立子 Check 可按 Engine 规则执行一次；
这不是重跑已中断的父 Probe，也不假定 crash 自动撤销独立子 Task。

只有执行时才生成 [verification/results.json](verification/results.json)。
结果包含原始快照、分页历史、SSE 帧与序号去重、因果与制品证据、运行限制、进程/线程记录、
未确认事项及清理结果；失败和部分证明都不能勾选 `D-*`。
所有 helper 仅通过本次拥有的 handle/PID 管理，结束后确认消失并删除带唯一 ownership 标记的外部目录。
清理无法确认时明确失败并保留带标记目录供父执行者处置，绝不删除未知目录或报告成功。
若发现已接受代码的缺陷，停止并交父执行者，不在本阶段修改 Inner 或生产代码。

## Steps

### D-S01: 运行独立 Objective 观察

在源码仓库外安装准确打包工具，启动注册 Check 与 Probe 的通用 Server，
以实际 Objective/Checker 制品对照进程内与鉴权 HTTP/SSE：
验证累计等级、多 Check、正常业务缺口、动态 Objective 选版与解析后的二次 Check。
记录准确摘要、References、父子 Task/Execution 关联及授权历史；
证明断线重连、序号去重与幂等请求没有额外调用，跨 scope 与未认证访问被拒绝。

### D-S02: 验证嵌套任务边界

使用受限资源配置验证并发父观察、共享子执行、取消、断线续接和服务重启，
确认独立共享 owner 不受父撤销影响；对独占子执行与活动 SSE 下关闭取得真实 Worker/PID 退出证据。
通过 crash/restart 对照原身份、deadline、调用 marker、下载次数与被替换来源，
证明未知 started 不重跑、queued 准备内容不换版，并清理本次验证拥有的资源。

## Acceptance criteria

### D-AC01: 外部观察可复核

实际服务记录和准确制品摘要证明无需作者目录、旧 Objective Host 或修复 Agent 即可观察；
累计与动态结果符合夹具预期，动态 selection 的实际文件 digest、recheck context 和最终问题一致；
进程内/HTTP 结果一致，子 Check 关联可通过授权历史读取，
SSE 至少一次重放按 sequence 去重，幂等重提与重连后的实际调用数不增加。

### D-AC02: 受限容量下安全结束

真实并发实验在约定预算内完成或显式失败，不因父任务占槽永久等待；
五个父任务在单 Check 槽条件下完成，取消不伤共享需求，恢复不悄悄重做原观察或替换已准备根。
正常撤销/关闭的 Worker exit、独占子 PID 消失、生产容量上界与目录清理可复核；
crash 的非优雅边界及独立 queued 子 Task 的恢复行为明确记录。
只有所有本次拥有 helper 已消失、外部标记目录删除且全部必要案例通过，才具备勾选依据。
