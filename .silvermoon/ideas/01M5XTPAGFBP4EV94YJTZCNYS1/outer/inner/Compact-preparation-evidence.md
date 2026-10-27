# 紧凑准备与真实 daemon 复审证据

## 本轮边界

保持已接受 ideal `ba57abb7cb73af0f88665c4e889dbd18e7ad64d9` 不变。
这是当前实施候选的复审修正，不是新产品要求；七个状态 ID、自动化绑定和原有自动执行
语义均未修改。此前所有实施/外部证据和截图保留，旧的自建 SDK 服务证据不冒充本轮证明。

准备状态现在只有：

- Linux/macOS **8 行**，Windows PowerShell **7 行**实际命令；
- 创建权限正确的独立场景及 controls 目录；
- 复制预先提供、可直接检查的普通业务 artifact；
- 输出本次路径，便于部分准备失败时只处理自有资源。

没有 worker 源码 heredoc、WriteAllText、host.mjs、服务脚本或另一套操作 dispatcher。
测试同时约束行数和禁止源码/启动脚本生成，不只是把大段代码移到另一个页面块。

## 普通业务样例

`packages/check-host/examples/cancellable/worker.cjs` 是普通 Check Host artifact：
只导出业务 execute，使用标准 fs/path、输入 marker/hold/fail/controls，
返回实际调用计数；没有测试框架、测试 helper、HTTP 操作或 CLI 参数分派。
它与自动化 fixture 分开，并通过 check-host 的 files 列表随包提供。
`examples/README.md` 明确其输入、资源所有权与真实 deadline，便于人先查看再复制。

## 启动属于 ready 状态

读取并遵守实际 discovery.ts/main.ts 的启动预约协议：

1. 一行透明 `connectHost(<case>/host)` 调用负责真实 startup reservation 和原始 daemon；
   finally 关闭**启动器自己的**私有 backend。
2. Host 子目录与 artifact/controls 分开，避免把业务输入当作私有 Host 元数据。
3. 一行原始 readArtifact 调用计算被复制样例的实际 revision。
4. 后续请求只读取真实 `host/host.json`；不生成 connection.json、替代 descriptor、
   自写内核/serve 程序或不存在的 start/run/cancel CLI。

所有业务提交、观察、取消、屏障和删除仍是 curl/jq 或 Invoke-RestMethod/平台文件操作。
token 不回显、不放进 curl 参数，连接文件留在私密目录。

## 真实服务限制与退出语义

原始 daemon 使用默认 **30 秒执行、5 秒清理、60 秒历史保留**，本轮没有修改它。
手册要求先备好取消/查询/释放命令，在 5 秒清理期限内完成；超时 Failed 不当作 Cancelled。
不能用自建服务延长期限掩盖原始服务的限制。

- POSIX：空活动列表后向唯一记录 PID 发 SIGTERM，等待退出并确认 host.json 被正常移除；
  超时不改用强杀冒充正常关闭。
- Windows：先证明任务终态、清理标记和空活动列表，再停止唯一自有 daemon PID。
  **Stop-Process 是强制终止，不能证明 daemon 优雅关闭或 dispose hook 已执行。**
  停止前取得 daemon 和实际 helper 的进程句柄，停止后等待这些句柄退出；不按名称杀 helper。
  helper 未退出时不删目录。强制退出后 host.json 残留是预期现象，不伪造正常退出标记。

最初验证发现 Stop-Process 与后续按 PID 调用 Wait-Process 之间有“进程已经退出”的竞态；
现已改为停止前取得句柄再等待。该修正只在原始操作说明内，不增加包装器或修改 daemon。

## 独立原始 daemon 现场验证

环境为 Windows PowerShell **5.1.26100.9711 / Desktop**、Node **v24.12.0**。
除回归测试外，独立进程直接执行当前 YAML 的原始 PowerShell 代码块，
没有运行 manual.test.ts、绑定或测试 helper 作为现场证明。

[去敏现场记录](./compact-verification/windows-daemon.json)包括：

| 路径 | 原始 daemon PID | 实际 helper PID | 结果 |
| --- | --- | --- | --- |
| Running → Cancelling → Cancelled | 49320 | 28016 | progress.calls=1，先 cleaning=True/cleaned=False，释放后 Cancelled/cleaned=True，活动列表 0 |
| 全新场景 Failed → Completed | 44976 | 47588 | 原 fault 仍 Failed 且原始错误不变，新任务 Completed、marker=tree-manual、calls=2，活动列表 0 |

另通过进程元数据核对实际入口为 check-host/dist/main.js，而不是替代服务。
每个场景只捕获自己的一个 helper，均已确认退出；两个目录均删除。
记录明确包含 `forcedWindowsStop=true`、`gracefulShutdownClaimed=false`、
`staleDescriptorAfterStop=true`，没有将 Windows 强制停止包装为优雅释放。

## Linux/macOS 与页面

实际尝试当前八行准备命令的环境为 WSL Linux / Node v24.18.0，
不是 Git Bash。当前 Windows 驱动器挂载仍被 SDK 以 **EPRIVATE** 拒绝；
未启动 daemon、未发布 token，不弱化权限或改变挂载配置。
只删除本次产生的已确认空目录，没有声称 Linux 服务全流程通过。
全部 **16 个**当前 Bash 代码块通过真实 WSL `bash -n`。
没有 macOS 原生环境，未声称 macOS 原生验证；说明仍以 Bash 3.2 与常规 BSD/POSIX 工具为限。

真实浏览器重载当前 HTML，实际保持七个状态 article；打开初始状态的 Windows 面板，
显示的是上述七行创建/复制操作，没有业务 worker 或 host 源码。
[当前准备区截图](./compact-verification/compact-preparation.png)来自该页面；
脚本数为 0、外部资源列表为空，原生平台折叠与人工状态组织保留。

## 验证记录

- 包内 **21/21** 通过，包括准备限制、真实 discovery daemon 原生命令、
  原有绑定/释放语义、平台说明及派生产物一致性。
- 两次完整 `pnpm check` 在**未改动的** check-host 崩溃恢复用例
  `real startup and published Host crashes recover once without replaying old tasks`
  出现 ECONNREFUSED（不同随机端口）。
- 对该用例独立选择运行为 1/1 通过；完整 check-host 包独立运行是
  **31 通过、2 个真实 POSIX 条件跳过、0 失败**。
  没有修改 production discovery 或该测试，也没有把这两次全仓失败抹掉。
- 再次执行原样的 **`pnpm check` 最终退出码 0**，包括全部测试和隔离打包消费；
  没有降低并发、修改测试、跳过失败项、注入测试缓存或放宽 SDK 校验。
  上述两次失败仍保留为已观察到的并发/时序敏感结果，不因最后通过而删除。
- production discovery/kernel 和原崩溃恢复测试未改动；普通样例随包打包验证通过。
  原绑定路径、已接受 ideal 和旧外部快照未改写；提交新实施修订后停在上游门禁。
