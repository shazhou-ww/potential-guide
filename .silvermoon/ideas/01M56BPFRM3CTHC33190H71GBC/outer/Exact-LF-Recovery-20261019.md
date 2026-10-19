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
| 当前状态 | `awaiting-external-decision`，尚未观察到决定或完成 |

程序逐字符断言：本次 `toolInput.command` 与 Deployment 的完整命令完全一致，输入的另一个字段只有上述描述；session/chat 与首轮相同，turn 与旧 turn 不同。真实 protocol options 为 `Allow in this Session`、`Allow Once`、`Skip`；仅用户本人可以选择 `Allow Once`，不按 opaque ID 推测语义。

官方专用窗口仍显示原 session，左侧位于 `regulator-ahp-target-20261019-1216-2eb89994 [regulator-ahp-verification]` 分组，状态为 `Attention Needed`。本次精确请求的聊天项 `Chat confirmation required: Run in terminal?: $p = ...` 实际可见；只执行了该项的 `ScrollIntoView`，未触发批准。该会话行还显示可见且 enabled 的原生快捷按钮，其完整可访问名称为 `Allow once: ` 加本次完整 `$p = ... WriteAllBytes(...)` 命令。

**识别注意**：UI 中仍能读到首轮 `$path = ... ReadAllBytes ... Write-Output 'Verified...'` 的旧确认 dialog；它不是本次写入请求，不应为此点 `Allow in this Session`。本次一定以 `$p =`、`Unexpected ready.txt bytes; no write performed`、`WriteAllBytes` 三段核对。可使用原会话行对应这条精确命令的 `Allow once` 快捷按钮，或在本次正确卡片中选择 `Allow Once`；不要批准旧只读自检，也不要选 `Skip All`。

私有 `lf-launch.json`、`lf-preflight.json`、`lf-pending.json`、`lf-pending-audit.json` 和追加 transcript 保存实际过程；token 只由本次包装器从自有 Host 运行数据读入进程环境，所有输出精确脱敏。等待中的 Host/UI/CLI 不清理。本文记录的是 pending，不是用户已经点击、执行成功或 D-AC 通过。
