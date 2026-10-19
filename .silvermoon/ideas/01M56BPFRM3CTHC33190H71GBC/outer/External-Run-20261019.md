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

以上是等待中的历史观察；自然截止后的终态如下，不能将文件存在、native 卡片或某个 UI 点击当目标通过。

## 自然截止后的最终结果

没有再次要求交互，没有选择默认决定，没有代点 Skip/approve，没有重建请求或发起另一轮模型。对现有执行只做一次有界结束等待。最终 CLI 于 `12:34:39.299+08:00` 退出 `5`，报告 `stopReason: exhausted`、`exhaustedBy: agent-limit`、`iterations: 1`、`Agent execution time limit reached.`。

最终真实 transcript 没有本次工具的 `chat/toolCallConfirmed` / `chat/toolCallResultConfirmed`：没有收到用户单次允许或 Skip 的外部决定。它确实包含同一 owned turn 的 Host `chat/turnCancelled`；`pguide/ahp-interruption` 记录：

```json
{
  "cancellationSent": true,
  "remoteStopConfirmed": true,
  "executionState": "cancelled"
}
```

这不是只发送取消就宣称远端停止，也不是将用户不可用解释成拒绝。CLI `recovery.command` 是 `pguide continue d34dc7cf-5ec3-4658-9f6f-79ad82910e48`，本轮没有运行它。

终态后独立读取的目标仍为 `4148502d56455249464945440d0a`，14 字节 CRLF；没有改写目标，也不把这次只读检查称作修复。CLI 自身 latestObservation 保留执行前的 `not-ready`，因此本文明确区分它与本次终态后独立观察，不伪造一次 CLI 重观察或 `target-reached`。D-S02 / D-AC01 仍不通过，Outer 不提交。

## LF 诊断、修正上下文及下一次最低条件

可以确定的是：真实模型 `apply_patch` 输入使用 LF（补丁为 `+AHP-VERIFIED\n`），真实工具之后落盘成为 CRLF；模型不是没有收到 LF 目标。目标目录没有 `.editorconfig`、`.gitattributes` 或 `.vscode/settings.json`，专用 UI 没有显式 `files.eol`；本机 Node `process.platform` 为 `win32`。不能据此断言转换必定发生在某个特定编辑器设置层，更不能声称设 `files.eol` 就已经验证有效。

固定版本官方 [Copilot approval policy](https://github.com/microsoft/vscode/blob/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/src/vs/platform/agentHost/node/copilot/copilotApprovalPolicy.ts#L31) 将 native `manual` 映射到 `default`；不能仅凭界面显示 Manual 就承诺每次文件写入都必然请求确认。实际文件编辑的 `confirmed: not-needed` 与随后 shell 的真实确认请求，均已在本轮实际协议流中观察。外部等待适配并不改写 Host 的权限或换行策略。

下一次上下文应明确修正为：

> 外部独立检查已确认唯一 ready.txt 当前为 UTF-8 `AHP-VERIFIED` + CRLF（14 字节），不是缺文件。先前 apply_patch 输入虽为 LF，但落盘发生 CRLF 转换，禁止重复同样补丁并声称成功。只允许能够明确保留 LF/raw bytes 的原生编辑工具，将这一个现有文件纠正为 13 字节；不要运行 shell、终端、自检、Git 或其他工具，不修改其他路径或标准。最终字节由外部 Objective 检查，你无需自检。若当前编辑接口不能表达或保证 LF，请直接报告该具体能力阻塞并结束，不改用 shell 或要求扩大权限。若 Host 对实际编辑发出 native 请求，只等待真人核对当前路径、diff 和单次选项。

这是修正后的待用指引，不是已经送达原会话的消息，也不是再次执行的许可。本轮只读调查没有证明当前原生编辑工具有可保证 LF 的接口；在这一点得到可信确认前，不再消耗模型重试。

另一个已查证的恢复限制是：当前 `continue` 只接受 regulation ID / `--report`，重用持久化 subject、profile 和固定 Pilot commit。不能编辑 `regulation.json`、换掉 commit 或改外部 subject 文件，伪称新的指引已被合法续跑采用。若后续确需增加显式修正上下文入口，应先按 Silvermoon 返回实施阶段设计并验收，而不是在部署阶段偷偷改产品；在现有恢复能力范围内，不重新创建会话，不重放已取消的 turn。

### 追加的只读 EOL 调查

后续已查明固定安装来源并完成同版官方编辑器 API 的独立四项复现，详见 [EOL-Diagnosis-20261019.md](./EOL-Diagnosis-20261019.md) 和[结构化证据](./EOL-Diagnosis-20261019.json)。工具完成时的实际文件 digest 已为 14 字节；native SDK 内建工具与编辑器扩展同名工具不可混同，`server-envelope` 日志不是扩展执行证明。编辑器的显式 LF metadata 在 scratch 有效，但没有证明 native 内建工具接受这个通道；不会仅改提示词或现用 `files.eol` 后再花模型重试。新的单次精确字节修复命令仅作为待授权提案保存，未执行、未改变原 Deployment 的禁止 shell 指引、未写真实目标。

## 证据保留与清理

终态证据摘要见 [External-Run-20261019.json](./External-Run-20261019.json)。本操作私有目录内仍保留原 regulation/transcript/脱敏 CLI 结果与固定 Pilot，以便核对和合法恢复，SHA-256 已记录。它们不是另一轮执行。

已结束的真实 CLI 包装器 PID `3432` 不再存活；结束等待辅助进程也已退出。冗余 `connection-sensitive.txt`、本地显示脚本及显示元数据已删除，没有将密钥文件注册为 artifact。为了保留同一真实会话与用户已登记连接，必要的专用 Host PID `36692`（supervisor `32092`）和专用 UI PID `28732` 继续存活；清理后实际认证 WebSocket 仍响应。传输 token 仅留在当前用户/SYSTEM 限定的本操作运行数据中及用户本人登记的专用配置，不输出、不提交。

后续明确放弃恢复或全部依赖验证完成时，只停止 `regulator-ahp-dedicated-host-1203`、`regulator-ahp-dedicated-ui-1203` 对应的自有 detached 进程组，核验端口和具体 PID 后再删除本操作私有目录；不能停止原共享窗口 PID `18136`。当前保留隔离目标作为真实失败证据，不清除或改写其内容。
