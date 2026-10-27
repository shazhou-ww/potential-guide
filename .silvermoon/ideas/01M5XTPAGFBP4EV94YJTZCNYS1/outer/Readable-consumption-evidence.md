# 可理解的原生准备：消费验证

## 契约与候选

- 已接受实施：`8e9b4671cf4f07d31c7a12edddecd27e3793b7ac`。
- 消费前已将更新后的 Deployment 契约同步至 primary
  `5d34013a8415c226175b059a73822cc729533a19`，并重新观测
  `deploymentRevision=afe902553f0dda3c209f70892742acc4c9e6fe22`。
- 本次只新增外部消费快照和证明，不修改 packages、docs 或已接受 inner/ideal。
- 环境为 Windows PowerShell 5.1、Node v24.12.0；不声称 Linux/macOS 已完成原生服务实跑。

## 当前页面及说明

从已接受产物取得当前 [Markdown](./readable-consumption/host-manual.md) 与
[HTML](./readable-consumption/host-manual.html)，不改写任何历史快照。
源码阶段已有 YAML 派生一致性检查，这里消费的是生成后的真实手册。

浏览器实际打开新 HTML 的 file: 页面，分别展开初始 state 的两种平台面板：

| 平台说明 | 命令块 | 准备含 Node/JS | 四个有名称的步骤 | 有预期现象 |
| --- | --- | --- | --- | --- |
| Linux/macOS | 4 | 否 | 是 | 是 |
| Windows PowerShell | 4 | 否 | 是 | 是 |

页面仍有 7 个状态正文、脚本数 0。
步骤分别解释唯一目录、访问权限、复制业务样例及检查结果，不再以行数最少为目标。
准备中没有 SDK 动态导入、压缩 try/finally 或手写源码。
必需的启动/revision API 留在下一状态，以有意义的名字和分块说明展示。

## 独立原生命令消费

直接从上述生成 Markdown 的相应状态中读取 PowerShell 命令块，在独立
Windows PowerShell 进程逐块运行，不导入 Test Tree、绑定或手册包装器，
不以运行 manual.test.ts 代替外部操作。
准备只调用系统目录/ACL/复制命令；ready 才调用已文档化的公开启动 API。
按手册要求重复 GET 确认 Running/Cancelling 等状态，不重放 POST。

[去敏现场结果](./readable-consumption/windows-results.json)及
[取消输出](./readable-consumption/cancel-transcript.txt)、
[恢复输出](./readable-consumption/recovery-transcript.txt)记录：

- 取消场景自有 daemon PID 54012：held=Cancelled、cleaned=true、activeCount=0。
- 全新恢复场景自有 daemon PID 53960：fault 仍为 Failed，
  error=`Error: manual injected failure`，恢复前后故障内容相同；
  recovery=Completed，result=`{marker:"tree-manual",calls:2}`，activeCount=0。
- 两个场景均通过手册的空活动列表及自有进程/helper 退出检查，
  hostStopped=true、directoryRemoved=true。
- 本轮创建的四个验证场景均已删除；第一轮结果采样的 PowerShell 数组包装会将
  REST 空数组误报为一项，因此不采纳该计数，再按手册的直接赋值/Count 原样重验，
  最终结果为 0。该修正仅作用于外部采样，不改变服务行为。
- Windows Stop-Process 仍明确为强制终止，不据此宣称优雅关闭。
  任务终态、defer 清理标记和空活动列表均在停止前获得独立证据。

凭据只存在受保护的 host.json 和内存请求头，未打印完整 descriptor、token 或 headers。
目录只在先确认本次进程/helper 退出后删除，没有停止未知进程或修改既有目录权限。
Windows 原生目录先创建为空，再成功限制 ACL，之后才复制样例和启动服务。

## 边界

实际操作验证了这份说明可以不运行 JS 来准备 case 目录，
且分块说明仍能完成真实 daemon 的取消/故障恢复及资源收尾。
这不意味着服务已经提供无需 SDK 的 start/revision 命令，
也不把 Windows 成功扩展为 Linux/macOS 的原生验证结论。
