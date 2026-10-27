# 分平台原始操作手册实施证据

## 范围与事实来源

本轮根据“长 JavaScript 难读”的反馈，细化已接受的原始命令/API 体验；
保持 `idealRevision=ba57abb7cb73af0f88665c4e889dbd18e7ad64d9` 不变。
未改动七个状态 ID、自动化绑定、业务测试 worker 或自动执行/释放语义。
历史 Inner/Outer 消费证据和截图保留，不能视为本轮 Linux/macOS 验证。

- 数据仍只有 `test/check-host/host.states.yaml` 的一棵状态树。
- 说明字段兼容字符串，增加严格的 `{posix, powershell}` 对象；
  缺字段、空说明、未知键和错误类型均明确失败。
- 每个状态的进入、观察、资源退出都分别提供 Linux/macOS shell 与 Windows PowerShell。
  人工视图保持状态、观察、后续状态和资源释放，不出现测试 hook 或绑定函数标题。
- HTML 使用原生 details，不依赖 JavaScript、请求或页面服务。
  Markdown/HTML 已重新由 YAML 生成，测试核对精确一致。

## 原始服务操作与安全边界

已读取实际 `packages/check-host/src/main.ts`：它要求 discovery-owned startup
reservation，并验证 startup 记录；不能把它当作不存在的 start/run/cancel CLI。
因此仅以下操作保留透明 Node/SDK 片段：

1. 创建具备正确权限的独立目录并关闭权限 backend。
2. 公开 CheckKernel/serve 启动、计算实际 artifact revision、私密发布连接信息。
3. 确认内核/worker/Windows helper 全部关闭，成功后写入 closed 标记。

该片段没有业务命令分派器，不提交/观察/取消任务；不是改名后的 manual helper。
演示 worker 明确在初始准备中写入一次，不复制隐藏测试 fixture，也不在每个状态重复。
其余进入、观察、取消、屏障和删除操作均是实际 curl/jq、Invoke-RestMethod、
平台文件及 JSON 命令。代码在准备得到目录时立即输出路径，便于部分准备失败后收尾。

凭据只进入私密连接文件、Windows 内存请求头或私密 curl header 文件；
不打印 descriptor/token，不将 token 放进 curl 参数。HTTP 请求不自动重试。
目录删除要求明确的 SDK 关闭标记、对应 PID 已退出及路径属于本次目录。
SDK 关闭失败时保留诊断和目录，不按进程名终止进程。

## 实际 Windows PowerShell 验证

环境：Windows PowerShell **5.1.26100.9711 / Desktop**，Node **v24.12.0**，
pnpm **11.22.0**。不是仅用 PowerShell 7 或 Node REPL 代替。

除包内命令回归外，独立校验进程从本次 YAML 读取实际 PowerShell 代码块，
直接交给 Windows PowerShell 执行。SDK 前台进程只运行准备块写出的 host.mjs，
后续操作执行的是已发布的原始 HTTP/文件代码，不导入绑定或执行测试文件。
观察中按手册要求重复 GET 等待状态，不重复 POST 或凭固定延迟推断状态。

[去敏现场快照](./platform-verification/windows-flows.json)记录最终两次完整路径：

| 路径 | 自有 Host PID | 最终实际结果 |
| --- | --- | --- |
| 准备 → Host → Running → Cancelling → Cancelled | 46604 | held=Cancelled，活动列表 []，cleaned 存在 |
| 全新准备 → Host → Failed → Completed | 31088 | fault 仍为 Failed，错误仍为 `Error: manual injected failure`；recovery=Completed、marker=tree-manual、calls=2 |

中间状态实际观察到 Running/progress.calls=1，以及 Cancelling 时
cleaning 已出现、cleaned=False；释放后才得到 Cancelled/cleaned=True。
恢复路径的原故障 JSON 前后比较实际为 True，未以新任务成功替代原故障检查。
两次均输入 stop，取得 `Host and workers stopped`、成功退出和关闭标记，
再执行原始目录删除；`Test-Path` 为 False，场景目录无遗留。

首次接入真实 PowerShell 时发现并修正两项本轮兼容性问题：

- Host 要求精确的 `application/json`，附加 charset 会返回 415；
  现在使用该实际 Content-Type 和显式 UTF-8 body bytes，保留非 ASCII 路径兼容性。
- PowerShell 5.1 对 REST 空数组的管道/包裹表现与新版本不同；
  现在直接保存 REST 集合并显示其 Count，避免显示误导性的包装对象。

这些失败没有记作通过；修正后原生命令回归和独立完整路径均通过。

## Linux/macOS：验证范围与限制

实际可用的是 **WSL Linux**，不是 Git Bash：
Node **v24.18.0**、GNU Bash **5.2.21**、curl **8.5.0**、jq **1.7**。
公共 SDK 可导入；实际执行准备命令时，当前 Windows 驱动器挂载不满足 SDK 的
POSIX 隐私要求，返回 **EPRIVATE**，因此**没有声称 Linux 服务全流程通过**。

该失败在发布 token/启动服务之前发生。仅移除了此次创建的空目录；
没有弱化权限检查、改变挂载配置、使用不安全 fallback 或将工作树复制到其他位置。
手册和 README 明确要求能保留真实 POSIX 所有者及 0700/0600 权限的工作树。

另外在真实 WSL Bash 对 **17 个**已发布 Bash 命令块执行 `bash -n`，退出 0。
命令限定为 Bash 3.2 可用语法及常规 BSD/POSIX 文件工具，无 GNU 专属文件操作假设；
curl/jq 的最低版本明确列出。**没有 macOS 原生环境，未声称 macOS 原生验证。**
Bash 语法检查不替代 Linux/macOS 服务消费证明。

## 实际 HTML 浏览与输出

在集成浏览器实际打开 `docs/check-host-manual.html#state-running`：

- 实际有 **7 个 article、40 个分平台 details**；状态和观察锚点保持不变。
- Windows PowerShell 面板初始关闭，原生点击后打开，再次点击关闭，再点击打开；
  Linux/macOS 面板保持独立关闭，没有脚本模拟切换。
- 选中面板显示的是简短原生 JSON / Invoke-RestMethod 操作，不是长 REPL JavaScript。
- 页面脚本数 **0**，实际外部资源列表 **[]**。
- [浏览器截图](./platform-verification/platform-panels.png)来自当前页面，
  展示原生平台分组和人类状态视图；不是渲染字符串测试的替代截图。

## 验证结果与门禁边界

- 包内 **20/20** 通过，包括原有 Node 绑定语义、真实 Host 检查、
  分平台 schema/错误输入/HTML 转义、七状态输出、派生产物一致性及真实原生命令。
- 完整 **`pnpm check` 退出码 0**：层级、格式、lint、类型、测试、隔离打包消费通过。
- Windows 独立原生命令校验退出码 0；WSL 语法校验通过，但服务准备因 EPRIVATE 失败，
  Linux/macOS 完整消费仍是明确限制，不是跳过后冒充成功。
- 本轮只更新实施契约、实现/说明/测试及新的 Inner 证据；
  旧外部快照未改写，Deployment 清单重置等待新候选未来的消费验证。
- 不执行任何 gate acceptance、npm 发布或公共部署；同步后提交准确 submitInner，
  由上游按本证据决定是否接受新的实施修订。
