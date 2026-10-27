# Deployment

本阶段验证已接受实施 `9ad453ef66a639deae85a515266671da12a2cd31`
在真实消费场景中的效果，不发布 npm、不启动公共站点，也不修改已接受的理想世界、
主体世界或仓库交付物。先将本契约同步到 primary 并记录稳定修订，再开始外部验证。

## Steps

### D-S01: 验证独立消费生成文档

从同步后的候选使用同一份 YAML 生成三种输出，在浏览器离线打开 HTML，
确认树的展开、节点定位和完整路径可读，不依赖开发服务或隐含环境状态。
从 `packages/test-tree/test/check-host/host.states.yaml` 实际生成终端树、
Markdown 和 HTML，产物放在本世界新的 `compact-consumption` 目录，保留所有旧快照。
通过真实浏览器工具打开 `file:` HTML，验证原生树折叠/展开，
选择 cancelled/recovered 状态锚点，阅读进入操作、状态观察、后继状态及退出说明；
页面按状态呈现，不以 before/after/it 或绑定函数名组织。
实际展开 Linux/macOS shell 与 Windows PowerShell 原生平台面板，确认准备分别为
八行/七行创建及复制命令，不要求手写 worker 或 host.mjs。
记录浏览器实际观察，不以源码字符串断言或测试用例代替；不为展示启动 HTTP 服务。

### D-S02: 按手册完成真实人工复验

在隔离目录依手册走通启动、执行、取消清理及一条故障恢复路径，
不以运行对应自动化测试代替人工操作。保留必要的消费证据，
隐藏凭据并确认清理只影响本次拥有的资源。
依生成手册用两个全新 PowerShell 场景复制普通业务样例；在 ready 状态用短
connectHost 调用显式隔离 host 子目录，通过真实 discovery 预约启动原始 daemon，
关闭启动器自己的私有 backend，随后只用真实 host.json、Invoke-RestMethod 和文件命令。
不使用 REPL、自建 CheckKernel/serve、host.mjs、Test Tree、绑定或手册包装器。
取消路径观察真实执行与清理屏障，遵守原服务 30 秒执行、5 秒清理及 60 秒历史保留期限；
故障恢复路径确认原 fault 仍为 Failed 且保留原始执行异常，
新 recovery 为 Completed、calls=2、活动列表为空。不得运行 manual.test.ts
或其他实施测试作为此阶段的人工消费代理。
记录时间、实际命令和非敏感输出；核对原始 main.js 入口，在任务终态、清理标记、
空活动列表均成立后，仅停止记录的自有 PID，并确认该进程及实际 helper 的句柄退出。
Windows Stop-Process 明确是强制终止，不宣称 daemon 优雅关闭或 dispose hook 已执行；
POSIX SIGTERM 是不同的正常关闭路径，不能混同。
只在确认退出后清理自有目录，
不连接默认 Host、不按进程名终止、不打印或提交凭据。
Linux/macOS 只记录真正可取得的验证；若 WSL 文件系统触发 EPRIVATE，
保留失败事实，不弱化权限或将语法检查、Git Bash 冒充原生服务全流程证明。

## Acceptance criteria

### D-AC01: 输出可独立查阅

记录候选身份、实际生成命令及离线浏览结果，证明终端/Markdown/HTML
均可取得与自动测试同源的 state/transition 结构，HTML 中能定位节点并查看有序操作路径。
证明三种产物来自同一 YAML；记录浏览器 file: 地址、折叠状态变化、
点击后的状态锚点、各状态栏目、无框架术语和无 helper 命令，同时确认页面无脚本和网络依赖。
文档仍标记 Not run；实际消费结果单独记录，不把文档存在当作测试通过。

### D-AC02: 人工复验无需读取实现

记录执行命令、观察结果、平台及资源收尾，证明代表路径可仅依生成手册完成。
若需要从隐藏 helper 推断操作，则视为说明缺口，不宣称人工验收完成。
证明运行/取消/清理与故障恢复两条路径均由已文档化的命令完成；
记录原故障快照未被改写、原始 daemon/实际 helper PID、空活动列表和场景删除结果。
Windows 强制终止与任务资源已经清理分别举证；不把残留 host.json 当作活进程，
也不把强制退出当成优雅释放。报告 Linux/macOS 未验证的部分和实际阻碍。
结果与去敏证据保存在本世界；证据完成后同步并提交准确 deploymentRevision，
由上游作最终门禁决定。
