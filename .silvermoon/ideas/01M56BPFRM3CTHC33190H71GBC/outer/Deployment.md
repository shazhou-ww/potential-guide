# Deployment

## Steps

### D-S01: 准备真实 AHP 验证环境

以 VS Code 作为首个 AHP Host 实现，记录产品、Host 和协议实际版本，确认外部 AHP 入口及能力。使用通用 AHP profile、用户已有授权与隔离测试目标；环境不可用时明确记录阻塞，不以编辑器内聊天或测试替身冒充协议接入。

### D-S02: 实测修复与会话生命周期

在有限执行额度内通过 pguide 驱动真实 VS Code agent session，验证 AHP 修复闭环、取消和原会话恢复，补充一次现有 ACP 使用路径的对照验证。记录可复查且不含敏感信息的证据，明确该结果不代表所有 AHP Host 都已实测。

真实版本、隔离目标、首轮发现及复测结果见 [Verification.md](./Verification.md)。外部环境阻塞与客户端缺陷分开记录；客户端缺陷必须修复并重新验证后才能请求部署验收。

external 复测使用用户已手动连接的专用 loopback Host `127.0.0.1:51793`，不另建连接、不代输凭据。先在官方 Agents UI 选择该已连接 Host，再使用全新的非 Git 隔离目录 `D:\Code\regulator-ahp-target-20261019-1216-2eb89994`；唯一修复是创建精确字节 `AHP-VERIFIED\n` 的 `ready.txt`。只运行一个 Agent 修复 turn，执行等待最多 10 分钟，整体额度最多 11 分钟，不自动重试。通过 CLI 持久化的 session/chat/turn/toolCall 身份在官方 UI 定位对应会话；确认用户可见后才进入人工决定步骤。请求等待期间不发送任何 approve/deny，用户仅可按 native 卡片逐次决定；范围或单次语义不清晰时不要求批准。停止、账户错误和超时如实记录，目标仍由独立 Objective 精确重观察，不以卡片出现或批准推断成功。

首轮已因 CRLF 失败并由 Host 确认取消。2026-10-19 用户在获知完整命令及边界后明确授权准备下面唯一的补救请求，**不授权代点批准**。保持原非 Git 目标、固定 subject / Pilot commit、原 session/chat 与 `confirmations: external`；只允许用公开的 `pguide continue <原 regulation-id>` 恢复。利用既有每次执行重新读取的 `regulationPermissions`，将唯一 execute grant 的 `command` 精确设为以下字符串；`agentPrompt` 的 `Current run authorization` 是本次新增授权信息的受支持入口，不修改已保存的恢复配方，不私发 AHP turn。原“禁止 shell”指导对所有其他命令继续有效，只有本条新授权例外。该 grant 是发起请求的范围描述，不是 Host approval，更不是 `Allow in this Session`。

```powershell
$p = 'D:\Code\regulator-ahp-target-20261019-1216-2eb89994\ready.txt'; if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($p)) -ne 'QUhQLVZFUklGSUVEDQo=') { throw 'Unexpected ready.txt bytes; no write performed' }; [IO.File]::WriteAllBytes($p, [Text.Encoding]::UTF8.GetBytes("AHP-VERIFIED`n"))
```

此补救仅追加一次有界 continue，仍为 Agent 执行最多 10 分钟、整体最多 11 分钟、最多一次 Agent 修复 turn。先核验原文件仍为已知 14-byte CRLF，保持用户已连接的专用窗口可见；只有真实 Agent 发出与上述字符串精确一致、仅此文件且具有明确 `Allow Once` 的 native 请求时才请用户本人决定。若出现更宽或不一致命令，不要求用户批准，取消本次 owned 执行并如实记录；不转而自动重试。执行成功后由 pguide 原 Objective 检查精确 13-byte LF，再补独立读取与 Host 身份证据。不得由 Agent 直接改验收文件、增加终端自检、变更标准或因用户授权 prepare 就提交 Outer。

## Acceptance criteria

### D-AC01: 真实 AHP 修复达成目标

使用无产品专属字段的 AHP 配置，在已记录版本的 VS Code Agent Host 上完成隔离目标修复；证据包含 pguide 发起的真实 agent session 身份、完整上下文和修复前后目标观察，不能只凭连接成功或手动聊天判为通过。

### D-AC02: 恢复与取消符合说明

实测记录能够证明仍需修复时恢复引用原会话，取消传递到当前执行且远端是否确认停止被如实报告；迟到结果无效。不支持的能力或不可恢复情形按文档明确报告，不产生伪成功。

### D-AC03: ACP 路径仍可使用

在同一候选版本上完成 ACP 对照运行并保存结果，确认用户无需为新增 AHP 支持迁移原有可用配置。
