# external 真实复测准备

## 已完成的阶段与环境操作

- 按主会话明确委托的技术验收决定，重新观察 exact submitted Inner `9461c1245d0541220b9b4ee734219df94234106d` 与 primary 同步后，通过 CLI 记录 `acceptInner#15`，提交 `54a3e3100362a5b1e155c3a8daf7faf744e29a32` 已正常进入 primary。它不是用户亲自批准某次工具操作，也不是 Outer acceptance。
- fresh report 为 `deploying/downstream`。有界执行方案已先同步在 `e2f41ec`，当时 Outer revision `4f065491cbf5`；没有改产品实现。
- 原正式 detached Host 和 UI 继续使用，没有重建或新增连接。专用 UI PID `28732`；Host 包装器 PID `36692` / supervisor PID `32092`；Host 仅配置为 loopback `127.0.0.1:51793`。
- 用户已手动登记的专用 profile 中只有一个正确连接；新传输 token 只在本操作私有数据中比对，没有输出。官方 UI 日志在 `12:07:33` 记录 `Initialized`、`Connected` 和远端 provider 注册，真实 WebSocket 认证探测也成功。
- 官方 Host 入口实测位于新会话 composer 的 Workspace Picker。Agent 仅选择已存在的 `regulator-ahp-verification`，没有代输 token、增加 Host 或触发模型。

## 固定隔离目标及检查

目标是新建的 `D:\Code\regulator-ahp-target-20261019-1216-2eb89994`。`git rev-parse --show-toplevel` 确认该目录不属于 Git worktree，首次检查 `ready.txt` 不存在。

单独的合成 Pilot Git commit `3d654946e6a3854e94ae96b834c2fa885fdc3afc` 固定了检查和指导：只读取该目录内 `ready.txt`，以字节级比较验证 `AHP-VERIFIED\n`，不写目标。真实执行前检查返回 `ok:false` / `not-ready`，不存在用 Agent 代写目标制造成功的情况。

配置明确为 `confirmations: external`、provider `copilotcli`、单个 Agent run，执行上限 600000 ms、整体上限 660000 ms；没有配置 session-wide/always 或新文件 grant。当前候选构建 8/8 成功。真实 CLI 启动脚本已准备，但尚未执行，也没有真实 session/chat/turn/toolCall 可供引用。

## 实际遇到的人类授权点：Folder Trust

在官方 UI 的 `Select Folder on regulator-ahp-verification` 中输入并选择上述隔离目录后，composer 已显示：

```text
Workspace: regulator-ahp-target-20261019-1216-2eb89994 [regulator-ahp-verification]
```

紧接着出现真实原生模态框：

```text
Do you trust the authors of the files in this folder?
An agent session will be able to read files, run commands, and make changes in this folder.
D:\Code\regulator-ahp-target-20261019-1216-2eb89994
Trusting this folder will also mark it as trusted in Visual Studio Code.
```

操作按钮为 `Trust Folder & Continue` / `Cancel`。这是此前仅 Add Host 调查没有触发的新安全边界，不能将“允许选择已存在 Host”解释为 Agent 可以自动信任文件夹。Agent 没有点击任一按钮，没有修改 workspace trust、已有用户 profile 或工具批准策略。

用户随后明确报告本人已确认该 Folder Trust。重新观察确认：模态框消失，composer 仍显示上述精确隔离目录与 `regulator-ahp-verification`，`ready.txt` 仍不存在。该结果只解除目录信任前置条件，不是 `ready.txt` 的一次文件批准，不写为 AHP `toolCallConfirmed`，也不证明模型或工具已获授权。后续仍须在同一官方 UI 核对实际 session/chat/turn/toolCall、精确路径和 native 单次请求。

Host、UI 和连接所需私有资源继续保留，不因报告返回而清理。当前可以开始预先约定的一次有界 external 修复；真实文件请求仍逐次等待用户，不从信任点击推导工具许可。本文此时只记录执行前状态，当前 `ready.txt` 仍不存在，没有 submitOuter / acceptOuter。

## 一次真实执行及当前原生请求

CLI 于 `2026-10-19T12:24:33+08:00` 从精确非 Git 目标目录运行，使用当前构建的 `regulate.js` 和上述固定 Pilot。正式 detached shellId 为 `regulator-ahp-real-external-1224`，包装器 PID `3432`；单 turn 预算至约 `12:34:33+08:00`，不无限等待、不自动重试。Host/UI 不随本次 turn 结束而清理。

真实持久化身份：

| 字段 | 值 |
| --- | --- |
| regulationId | `d34dc7cf-5ec3-4658-9f6f-79ad82910e48` |
| sessionUri | `ahp-session:/82892f7e-476f-4c40-ace3-5764f40ff157` |
| chatUri | `ahp-chat://default/YWhwLXNlc3Npb246LzgyODkyZjdlLTQ3NmYtNGM0MC1hY2UzLTU3NjRmNDBmZjE1Nw` |
| turnId | `4707b654-2e9d-4505-9709-87bbbe54f841` |
| 当前 pending toolCallId | `call_3ZLnVC1GljZcwdRIuu5U3ign` |
| phase | `execution` |

官方 UI 的隔离 workspace 分组实际出现一个 `Potential Guide regulation Target: ...` / `In Progress` 会话。Agent 仅选择这一个真实会话，使其内容及 native 确认卡片可见，没有选取任何批准/拒绝控件。

首个 `apply_patch` 工具由 Host 标为 `confirmed: not-needed` 后创建了文件；没有将此标记解释成人类单次批准，更没有将目录信任点击伪记为 `toolCallConfirmed`。独立字节观察为 `4148502d56455249464945440d0a`，即 14 字节 CRLF；要求的 13 字节 LF 为 `4148502d56455249464945440a`，所以目标仍不通过。这也暴露该 Host 对 trusted workspace 文件编辑的行为：不是每个编辑都产生确认卡片，不能把通用 external 等待能力描述为强制 Host 对每次文件写入询问。

`12:24:53.496+08:00` 的 `pguide/ahp-external-confirmation` 对应下一条原生 **`Run in terminal?`** 请求。工具为 `powershell` / `Run Shell Command`，内容是读取上述唯一 `ready.txt` 的字节，与 `AHP-VERIFIED` + LF 比较，不符则 throw，符合则 Write-Output；它不修复或写入文件。该请求不是文件创建请求，且超出了原计划“不要运行 shell”的指导，Agent 不批准，也不把已有文件授权扩张为执行授权。

协议 options 确实包含 `Allow Once`、`Allow in this Session`、`Skip`；实际卡片的主要可见按钮是 `Allow in this Session` 和 `Skip`，另有 `More Actions...`。没有选取任何 option，`Allow Once` 只可由用户本人通过 native 选项决定；绝不能按默认会话级按钮。若用户要额外允许此条只读校验，必须明确作为独立的单次 shell 操作决定，而不是沿用文件创建许可；也可由用户跳过/取消。没有当前实际请求的明确决定时保持 external 有界等待，不代点任何按钮。

当前没有最终 CLI 结果，不能将文件存在、native 卡片或某个 UI 点击当目标通过；D-S02 / D-AC01 继续未完成，没有 submitOuter / acceptOuter。
