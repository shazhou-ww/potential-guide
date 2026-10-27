# 紧凑准备与真实 discovery daemon：现实消费证据

## 契约及候选身份

- 已接受实施：`9ad453ef66a639deae85a515266671da12a2cd31`；
  `acceptInner#18` 已同步于 `6416fd9b5d38fb61fbb247fbf3c4ce5525799eff`。
- 本次先修订 Deployment 契约并同步 primary
  `33e4e2ae69e4f286abe5a1f516061669cf06e4f4`，重新观测到稳定
  `deploymentRevision=1a54442c2ec44da971d0ee8d69fc111936c7b0ff`，
  然后才开始生成、浏览和实际服务消费。
- 操作日期：2026-10-27，UTC+08:00。所有新快照位于 `compact-consumption`；
  其他消费目录、host.mjs/REPL/manual 历史材料没有改写，不代表当前操作方案。
- 未修改 accepted ideal/inner、packages 或 docs，未发布 npm、未部署公共站点，
  未执行任何 acceptance。

## D-S01 / D-AC01：从同一数据生成并真实浏览

18:29:58，在仓库根执行 `pnpm build` 成功后实际生成：

```powershell
$out = 'D:\Code\potential-guide.worktrees\test-tree-manual-idea\.silvermoon\ideas\01M5XTPAGFBP4EV94YJTZCNYS1\outer\compact-consumption'
pnpm --filter @potential-guide/test-tree manual test\check-host\host.states.yaml tree "$out\host-tree.txt"
pnpm --filter @potential-guide/test-tree manual test\check-host\host.states.yaml markdown "$out\host-manual.md"
pnpm --filter @potential-guide/test-tree manual test\check-host\host.states.yaml html "$out\host-manual.html"
```

三条均退出 0。三种输出来自同一 YAML，保持七个状态和六个观察 ID。
Markdown/HTML 与已接受交付中的对应文件实际 hash 比较均为 True；
文档仍标记 `Not run`，实际消费结果与说明分开记录。

| 数据/产物 | 实际 SHA-256 |
| --- | --- |
| `packages/test-tree/test/check-host/host.states.yaml` | `3EC850B669EA736153C4C9DB7DC09BCDA49364725AE8DD4761095B5CE51B6785` |
| [终端树](./compact-consumption/host-tree.txt) | `6D5C9B78BED6555082D46A5A5FF8ECD07BE31CC537E67642D15C34494767C75A` |
| [Markdown](./compact-consumption/host-manual.md) | `2AB08A11DE1691DD75D64EB98E8867EB4A70B9D072AEB99E82573F128E147F98` |
| [离线 HTML](./compact-consumption/host-manual.html) | `7E6E47F50530EF149FB864AB88C74C6DDCC976E286E4203BB53791D15B7B43E5` |

真实集成浏览器打开上述 HTML 的绝对 `file:` URL，没有启动文档服务：

```text
file:///D:/Code/potential-guide.worktrees/test-tree-manual-idea/.silvermoon/ideas/01M5XTPAGFBP4EV94YJTZCNYS1/outer/compact-consumption/host-manual.html
```

浏览器实际观察而不是字符串测试：

- 7 个 article、40 个平台 details，页面脚本数 0、外部资源列表 `[]`。
- ready 状态树 summary 通过原生 Enter 从 open=true 变为 false，再变回 true。
- 初始 Windows PowerShell 面板实际点击后打开、关闭、再次打开；
  准备 code 为 **7 行**，Linux/macOS code 为 **8 行**，无 worker/host 源码写入。
- 点击状态树 cancelled/recovered 链接，URL 分别变为
  `#state-cancelled` / `#state-recovered`；观察锚点为
  `cancelled.released` / `recovered.result`。
- 各 article 仍为“如何进入 / 在此状态观察 / 可以转向的状态 / 结束操作”；
  不是 before/after/it 或绑定函数视图。打开其 PowerShell 面板实际看到短原生文件/HTTP 命令。

真实浏览器截图：
[七行准备](./compact-consumption/preparation-powershell.png)、
[恢复状态](./compact-consumption/recovered-powershell.png)、
[Windows 退出说明](./compact-consumption/windows-exit.png)。
页面在集成宿主后台时使用 Playwright 原生 force click 发送点击，
没有通过设置 open 属性或注入页面逻辑伪造交互。
资源退出区一次 click 报不可见后，用原生 Enter 展开父区及 Windows 面板；
实际 open、checkVisibility 均为 True，并读到强制终止/不宣称优雅关闭、
空活动列表 guard 和 WaitForExit 句柄等待说明，没有将工具失败当作通过。

## D-S02 / D-AC02：独立 PowerShell 原始操作

环境为 Windows PowerShell **5.1.26100.9711 / Desktop**，Node **v24.12.0**。
本次实际读取**刚生成的 Markdown** 中对应状态/平台的原始代码块，交给独立
PowerShell 进程执行，不导入 YAML 测试模型、绑定、测试 helper，也不运行 manual.test.ts。
准备输出的 CASE_DIRECTORY 作为明确路径参数传入后续操作进程；
服务操作继续在同一 PowerShell 会话保留变量。仅补充手册要求的重复 GET 等待准入，
没有重复 POST、伪造状态或延长 daemon deadline。

两条现场路径都按原文完成：

1. 独立私有目录 → 复制公开普通业务样例 → ready 的短 connectHost 调用；
2. 真实 host 子目录、真实 host.json、独立 readArtifact revision；
3. 原生 Invoke-RestMethod 与 controls 文件命令；
4. 任务已终结/资源标记和空活动列表 → 停止确切自有 daemon PID；
5. 等待该进程及实际 helper 句柄退出 → 删除本次目录。

服务通过真实 discovery 启动，进程元数据核对实际入口均为
`packages/check-host/dist/main.js`，不是自建 CheckKernel/serve 或 host.mjs。
启动器 finally 关闭自己的私有 backend；daemon 的 helper 单独记录和确认。

### 取消与清理

[现场记录](./compact-consumption/cancel-daemon.json)：

- 场景：`case-d907a405-b22c-4af1-9ac9-b51058e44100`；
  daemon PID **48140**，实际 helper PID **43504**。
- Running，progress=`{entered:true,marker:"tree-manual",calls:1}`。
- Cancelling，`cleaningObserved=true`、`cleanedBeforeRelease=false`。
- 释放屏障后 Cancelled，`cleaned=true`。
- 停止前 `activeCount=0`；只对 PID 48140 执行 Stop-Process。
- helper 已自行退出，目录删除确认 True，无残留场景。

### 执行异常与恢复

[现场记录](./compact-consumption/recovery-daemon.json)：

- 全新场景：`case-fa5d26e8-d870-48ea-adb9-ff22da42cd91`；
  daemon PID **45724**，实际 helper PID **55644**。
- 原 fault 为 Failed，error=`Error: manual injected failure`，是执行异常而非业务不通过。
- 新 recovery 为 Completed，result=`{marker:"tree-manual",calls:2}`。
- 恢复前后的原 fault 对象实际精确比较为 True（`sameOriginalFault=true`），
  未以新任务成功替代旧失败记录检查。
- 停止前 `activeCount=0`；只停止 PID 45724，helper 退出确认 True，场景删除确认 True。

18:32:46 两条路径均完成，现场原始输出见
[去敏 PowerShell transcript](./compact-consumption/windows-transcript.txt)。
凭据只用于私密 host.json/内存请求头，未打印 descriptor/token/header；
该 transcript 另检查没有 Bearer 值或 token/header JSON 字段。

### Windows 停止不等于优雅关闭

本次沿用原 daemon 默认 **30 秒执行 / 5 秒清理 / 60 秒历史保留**；
取消、观察与释放在真实期限内完成，没有修改服务或生成可调期限的替代程序。

两个现场记录都明确包含：

```json
{
  "originalEntry": true,
  "activeCount": 0,
  "helpersExited": true,
  "forcedWindowsStop": true,
  "gracefulShutdownClaimed": false,
  "staleDescriptorAfterStop": true,
  "directoryRemoved": true
}
```

Windows Stop-Process 是强制终止，**不证明 daemon 优雅关闭或 dispose hook 执行**。
任务终态、defer 清理标记、空活动列表是停止前的独立证据；
残留 host.json 符合强制停止语义，只有进程/其实际 helper 都退出后才删除自有目录。
没有按进程名终止、强杀 helper、连接默认 Host 或删除未知资源。

## Linux/macOS 的真实边界

本次对刚生成文档的 **16 个 Bash 块**在真正 WSL Linux 执行 `bash -n`，退出 0。
随后实际执行当前八行准备，Node v24.18.0 在 Windows 驱动器挂载上再次返回 **EPRIVATE**；
尚未启动 daemon 或发布 token，不能声称 Linux 服务全流程成功。
只非递归删除本次 SDK 创建的已确认空目录，没有修改权限检查、挂载配置或复制工作树。
没有 macOS 原生环境；没有将语法检查或 Git Bash 冒充 Linux/macOS 原生服务验证。

## 完整性与提交边界

- 相对 `6416fd9b5d38fb61fbb247fbf3c4ce5525799eff`，
  packages、docs 和本 Idea inner 的实际 Git diff 为空。
- accepted inner 仍为 `9ad453ef66a639deae85a515266671da12a2cd31`，
  ideal 仍为 `ba57abb7cb73af0f88665c4e889dbd18e7ad64d9`。
- 本轮 `pnpm build` 与 **`pnpm check` 均退出 0**；这是附加仓库验证，
  不代替上述从生成文档进行的实际原生进程和浏览器消费。
- 旧消费快照未覆盖；新结果仅在本世界新目录，现场自有场景目录数为 0。
- D-S01、D-S02、D-AC01、D-AC02 均有当前消费证据；同步并提交准确 submitOuter 后，
  停在上游最终验收门禁，不自行接受。
