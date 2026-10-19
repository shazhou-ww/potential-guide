# 精确 LF 补救的合法上下文与执行边界

## 已授权的准备范围

用户阅读唯一 guarded PowerShell 命令、原文件绝对路径、仅 CRLF→LF 边界及“实际卡片由本人 Allow Once”的说明后，明确回复“批准你可以去做”。这允许准备并通过真实 Agent 请求这项操作，不是 Host 工具批准、会话级授权或 Outer acceptance。完整命令以 [Deployment.md](./Deployment.md) 为唯一当前执行合同；在合同同步之前不运行。

## 已找到的现有受支持入口

此前调查正确指出 `pguide continue` 没有自由追加指令参数，但这不意味着必须改产品才能表达本次**精确授权差异**。本次使用已有配置和真实 continue，而非任意新提示词：

- `packages/pguide/src/commands/regulator.ts` 的 `run` 每次加载当前配置的 `regulationPermissions`；代码明确规定持久化 ceiling 仅为审计快照，不是新 attempt 的权限来源。
- `agentPrompt` 将当前有效 grants 放入 `Current run authorization`，不把未授予的 ceiling 给模型；旧会话中的拒绝是历史，当前相关 grant 可重新请求 Host 权限评估，但不能自我批准。
- `PermissionGrant` 本来支持 `{ id, operation: "execute", command }`，其中 command 是完整精确字符串，不是 cwd、前缀或通配符。新增本次唯一 grant，不增加 edit、其他 execute 或其他资源。
- `confirmations: external` 分支只记录 `awaiting-external-decision`，不发送 approve/deny，也不将上述 configured grant 自动变成 Host 许可。原文件操作即使曾显示 `not-needed`，也不能沿用为这次 shell 决定。
- `runContinue` 保持原 subject digest、固定 Pilot commit 和原 AHP session/chat 身份。原固定 recipe 和原 regulation 文件均不手工修改；仅由正常 CLI 持久化新 attempt。

因此，本次无需修改已接受的实现或伪造 `continue`，也不需要私自向 Host 直发新 turn。旧固定参考资料中的“不要 shell”对其他命令仍有效，本次唯一新 execute 授权以已同步 Deployment 和当前运行授权信息明确表达。若真实 Agent 因旧指导而拒绝或发出其他命令，记录一次实际结果并停止，不擅改 recipe 或展开模型重试。

## 前置验证

2026-10-19 13:19 后只读核验：专用 UI PID `28732` 仍为 `REGULATOR-AHP-VERIFICATION - Agents`，Host PID `36692` 仍在；loopback `127.0.0.1:51793` 对无认证 HTTP 请求返回 `403`。原 `ready.txt` 的 Base64 仍为 `QUhQLVZFUklGSUVEDQo=`，没有写入目标。

最小相关验证命令：

```text
pnpm exec tsx --test --test-name-pattern "continue uses current grants|effective grants|execution requires exact complete command|external" packages\pguide\test\regulator-cli.test.ts packages\pguide\test\acp-permissions.test.ts packages\pguide\test\ahp-cli.test.ts
```

结果：6 tests，6 passed，0 failed。覆盖真实 CLI continue 重新读取当前 grants／撤销 ceiling、prompt 只暴露有效 grants、完整命令精确匹配及 external 三种结果。测试替身不算真实部署证据。无产品代码或依赖变更，不重复完整 `pnpm check`。

## 本轮执行记录

合同已提交为 `91f8dcfe990bf07a72127a7090c38cad48f5c595` 并确认 primary 可达；fresh report 的执行合同修订为 `4611a39e4e6a`。随后仅在本操作私有配置加入这一个当前 execute grant，保持 external 和固定恢复配方不变，通过公开 `packages/pguide/dist/bin/continue.js` 正常调用原 regulation。

正式 detached shell `regulator-ahp-lf-continue-20261019`、包装器 PID `12916` 于 `13:26:03.941+08:00` 启动。执行预算 600,000 ms，整体预算 660,000 ms，预期执行截止约 `13:36:04+08:00`。新 attempt 为第 2 次，subject digest 和 Pilot commit 均与首轮完全相同；没有重新创建 session、复制凭据、改存储记录或重放旧 turn。

`13:26:27.953+08:00` 实际收到 `pguide/ahp-external-confirmation`：

| 字段 | 实际值 |
| --- | --- |
| regulation | `d34dc7cf-5ec3-4658-9f6f-79ad82910e48` |
| session | `ahp-session:/82892f7e-476f-4c40-ace3-5764f40ff157`（原 session） |
| chat | `ahp-chat://default/YWhwLXNlc3Npb246LzgyODkyZjdlLTQ3NmYtNGM0MC1hY2UzLTU3NjRmNDBmZjE1Nw`（原 chat） |
| 新 turn | `94d57715-8575-4c76-bf50-f93ee4bf1dcc` |
| toolCall | `call_Mcdi2FaUcHrDaqwEagD2ETnJ` |
| 工具 | `powershell` |
| 标题／意图 | `Run in terminal?` / `Apply authorized exact LF recovery to ready.txt` |
| 当时状态 | `awaiting-external-decision`，当时尚未观察到决定或完成 |

程序逐字符断言：本次 `toolInput.command` 与 Deployment 的完整命令完全一致，输入的另一个字段只有上述描述；session/chat 与首轮相同，turn 与旧 turn 不同。真实 protocol options 为 `Allow in this Session`、`Allow Once`、`Skip`；仅用户本人可以选择 `Allow Once`，不按 opaque ID 推测语义。

官方专用窗口仍显示原 session，左侧位于 `regulator-ahp-target-20261019-1216-2eb89994 [regulator-ahp-verification]` 分组，状态为 `Attention Needed`。本次精确请求的聊天项 `Chat confirmation required: Run in terminal?: $p = ...` 实际可见；只执行了该项的 `ScrollIntoView`，未触发批准。该会话行还显示可见且 enabled 的原生快捷按钮，其完整可访问名称为 `Allow once: ` 加本次完整 `$p = ... WriteAllBytes(...)` 命令。

**识别注意**：UI 中仍能读到首轮 `$path = ... ReadAllBytes ... Write-Output 'Verified...'` 的旧确认 dialog；它不是本次写入请求，不应为此点 `Allow in this Session`。本次一定以 `$p =`、`Unexpected ready.txt bytes; no write performed`、`WriteAllBytes` 三段核对。可使用原会话行对应这条精确命令的 `Allow once` 快捷按钮，或在本次正确卡片中选择 `Allow Once`；不要批准旧只读自检，也不要选 `Skip All`。

私有 `lf-launch.json`、`lf-preflight.json`、`lf-pending.json`、`lf-pending-audit.json` 和追加 transcript 保存实际过程；token 只由本次包装器从自有 Host 运行数据读入进程环境，所有输出精确脱敏。等待期间没有清理 Host/UI/CLI。上述是 pending 阶段记录，不是当时已批准；下面才是随后收到的真实终态。

## 真人决定、真实执行与最终目标

对这一既有 detached 执行仅做一次基于文件变更事件的有界终态等待，没有轮询不变状态、选择任何工具选项或新增模型请求。用户随后于 13:31:57 报告“点了 allow once”，此陈述与已经收到的 Host 事件相互印证，而不是单独充当成功证据。

Host 日志与真实 transcript 的顺序如下：

1. `13:31:44.845+08:00`：同一工具的 permission response 为 `approve-once`。wire `serverSeq: 207`、类型 `chat/toolCallConfirmed`，精确匹配 turn `94d57715-8575-4c76-bf50-f93ee4bf1dcc` / toolCall `call_Mcdi2FaUcHrDaqwEagD2ETnJ`，`approved: true`、`confirmed: user-action`、`agentHost.permissionDecisionSource: human_response`、`selectedOptionId: allow-once`。事件 origin client 与 pguide 发起 turn 的 client 不同；客户端没有发送批准。
2. `13:31:46.094+08:00`：Host 记录该工具完成；wire `serverSeq: 211` 为 `chat/toolCallComplete`，`result.success: true`，terminal `exitCode: 0`。实际命令逐字符等于已授权字符串，没有命令前后缀或额外 shell 自检。整个本次 turn 只有这一个 `toolCallStart`。
3. Host 随后给出同一 turn 的 `chat/turnComplete`（`serverSeq: 279`），不是本地连接关闭或仅见输出就推断完成。
4. `13:31:55.962+08:00`：pguide 原固定 Objective 的执行后观察为 `current.levelId: terminal`、`problems: []`；执行前 `13:26:09.094` 则为 `initial` / 一个 `not-ready`。outcome 为 `stopReason: target-reached`、`iterations: 1`。
5. `13:31:59.349+08:00`：真实 CLI 退出 `0`，新 attempt `12cb482e-72e4-4eac-a645-a6eba51319f1` 的 `status: target-reached`、`resumeMode: resumed`。subject digest、Pilot commit、session/chat 与首轮均未改变。
6. 终态后的独立只读复核得到 13 字节、hex `4148502d56455249464945440a`、SHA-256 `82882a098ef81ada63d28fdc13064b92754b8507aab7a8d3159978f841b25758`；与原固定检查的 `AHP-VERIFIED\n` 完全一致。本推进 Agent 未直接写目标；实际写入由真实修复 Agent 通过获真人单次批准的 Host 工具完成。

机器可复查的回执、前后观察和源文件 SHA-256 见 [Exact-LF-Recovery-20261019.json](./Exact-LF-Recovery-20261019.json)。追加后的 transcript 前 `194754` 字节仍与首轮失败终态 SHA-256 完全一致，旧失败证据没有因恢复被覆盖。

## D-AC 与兼容证据

D-S02 / D-AC01 使用上述真实批准、执行、原 Objective 重观察及独立字节复核；D-AC02 联合首轮真实取消确认与本次相同 session/chat 的正常恢复。没有把 scratch 或自动测试算作真实修复。

D-AC03 继续使用 [Verification.md 的原 ACP 实测](./Verification.md#现有-acp-对照)：已有 `copilot` profile 真实调用得到 `end_turn`，授权不足仍安全报告，而非配置迁移或伪修复。本轮没有额外 ACP 模型调用。为确认已有证明适用于当前 ACP 使用路径，比较该真实候选 `5fe79a355fc3918697b8eb88da9999b26f353130` 与当前源码：`executeAcpAgent`、`agentPrompt` 和 `acp-permissions.ts` 均逐字符一致（换行规范化后）；`AcpClient` 的后续差异只包含本使用路径未传入的可选 `maxOutputBytes` / `requireEndTurn` 防护，没有更换协议或 profile。本轮 6/6 回归实际覆盖原 ACP continue 和权限链；完整最终实现回归沿用已记录的通过结果。这不是声称整个跨 Idea 仓库从未变更。

## 资源与权限收尾

CLI 包装器 `12916` 已退出，单次 execute grant 终态后从本操作配置移除，已用 `lf-continue.ps1` 删除；持久化 attempt 和真实 transcript 保留审计快照。没有重放或再次执行命令。

为主会话独立复核暂留原专用 UI `28732`、Host 包装器 `36692` 与真实目标／原会话；共享 UI `18136` 不停止。旧只读卡片不再需要批准，本次已经成功，不应再点击任何旧卡片。主会话复核完成或明确取消后，才停止本操作的具体 detached 进程并删除其私有连接数据；不输出 token、不将敏感文件注册 artifact。
