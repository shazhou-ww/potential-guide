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

待合同正常同步并 fresh reobserve 后，才允许一次有界原会话 continue。此处尚未记录工具请求出现、真人 Allow Once、执行成功或 D-AC 通过；必须由实际事件补齐，不把准备测试当验收。
