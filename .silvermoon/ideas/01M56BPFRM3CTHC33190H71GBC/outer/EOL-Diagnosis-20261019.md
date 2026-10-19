# 真实 apply_patch 的换行边界与独立复现

## 范围与结论

本次只读调查和独立 scratch 实验没有发起模型轮次、恢复原 turn、批准工具或写入真实验收文件。D-S02 / D-AC01 仍失败；本文不是部署通过证据，也没有 `submitOuter`。

已将本次 LF→CRLF 限定到固定版本 **Copilot SDK 内建文件工具的解析／落盘执行边界**：不是 pguide 读取检查造成，不是 Git checkout 转换，也不是之后那条未获批准的只读 PowerShell 覆盖。尚未取得该 native 内建工具的函数级源码或可独立调用的公开执行入口，因此不能诚实地命名其内部转换函数。

一个重要的排错结果：**不能把官方编辑器扩展的同名 `ApplyPatchTool` 当作本次 SDK 内建 `apply_patch` 的实现，也不能据编辑器复现就把真实根因归为 `files.eol`。** 这纠正了调查中的候选假设，避免将未经验证的设置修改当成修复。

## 实际来源与原调用证据

- 专用桌面 UI 和下载的远端 server 均为 VS Code `1.142.0`，commit `6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1`。桌面 commit 从该实际可执行程序旁的 `6d62b1d5da/resources/app/product.json` 核对。
- server 自带 `@github/copilot-sdk` / `@github/copilot-sdk-win32-x64` 为 `1.0.19-unstable.38345923974.g3754b70`。实际内建工具 runtime 为平台包的 `prebuilds/win32-x64/runtime.node`，114,303,848 字节；`copilot-runtime.exe` 为宿主包装器，不是找到的 TypeScript 编辑工具源码。
- 原调用身份、超时取消和完整字节标准沿用 [External-Run-20261019.md](./External-Run-20261019.md)。`custom_call_uS0DuHaHepNszT6D19FnouGV` 的实际补丁字符串全为 LF，没有 CR；工具成功结果的 `_vscodeEditAttribution.afterDigest` 已为 `14:-516830830:1077832173`。不是直到事后独立检查才首次出现 14 字节。
- 固定版本 [FileEditTracker.completeEdit](https://github.com/microsoft/vscode/blob/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/src/vs/platform/agentHost/node/shared/fileEditTracker.ts#L96-L111) 读取工具完成后的实际文件，底层 `_readFile` 使用文件服务；[attribution](https://github.com/microsoft/vscode/blob/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/src/vs/platform/agentHost/node/shared/agentEditAttributionService.ts#L352) 对该 after 内容生成 digest。这把失败定位在工具执行完成之前，而不是报告显示层。
- 该轮只有文件 patch 和随后未执行的只读 PowerShell。没有外部 `toolCallConfirmed`，也没有后续已执行的写入工具；本次独立读取仍为 `4148502d56455249464945440d0a`。没有观测到另一 Agent 写入覆盖的证据；这不是对整台机器所有可能写入者的审计。
- Host 日志的内部 `result=approve-once` 不能改记为真人单次批准。`Forwarding client tool completion: source=server-envelope` 也不能证明由编辑器扩展执行：[AgentSideEffects](https://github.com/microsoft/vscode/blob/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/src/vs/platform/agentHost/node/agentSideEffects.ts#L440-L449) 对普通 server completion 同样调用这段转发逻辑。
- 固定版本 [client tool SDK policy](https://github.com/microsoft/vscode/blob/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L136-L178) 没有将 `apply_patch` 配为内建覆盖；[注册路径](https://github.com/microsoft/vscode/blob/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L2904-L2964) 不能凭同名工具直接推断替换成功。安装的 Host bundle 中也没有 `sessionFs` 注册或编辑器 EOL 配置／模型 API 的引用。

真实目标是非 Git 目录，没有 `.editorconfig`、`.gitattributes`、`.vscode/settings.json`；本操作的专用 UI 未设置 `files.eol`。未读取其他用户 profile 或复制账户凭据。上述配置事实不能反过来证明 native runtime 必然服从编辑器默认值。

## 官方编辑器 API 的独立对照实验

使用同一固定桌面版本，另建本操作拥有的 `.cache/.../source-eol/repro`、空 extensions 目录及全新测试 profile，通过官方 `--extensionDevelopmentPath` / `--extensionTestsPath` 运行扩展测试；没有连接 Host、调用模型或打开真实目标。测试只写自己目录中的两个 scratch 文本文件；实验中的 `files.eol` 更新也只属于这个可丢弃测试 profile。

| 实验（输入文字均为 LF） | 实际文档 EOL | 实际落盘字节 | 结果 |
| --- | --- | --- | --- |
| Windows `files.eol=auto`，`WorkspaceEdit.createFile` + `insert` | CRLF | 14 / `...440d0a` | 复现转换 |
| 对该已存在 CRLF 文档 `WorkspaceEdit.replace`，再次传 LF | CRLF | 14 / `...440d0a` | 仅重发 LF 无效 |
| `WorkspaceEdit.set(uri, [TextEdit.setEndOfLine(EndOfLine.LF)])` | LF | 13 / `...440a` | 明确元数据有效 |
| 仅将独立测试 profile 设 `files.eol="\n"`，另建新文档 | LF | 13 / `...440a` | 仅证明编辑器新文档路径 |

最终测试 UI 退出 `0`，四项断言全部通过。首次真正启动的测试在第一项之后因为没有持有文档模型、`Document has been closed` 退出 `1`；修正测试自身的文档生命周期并重开模型后得到上表完整结果，没有改原文件或目标标准。更早一次 launcher 参数被 PowerShell 拼成一个参数，未产生测试结果，不计成功。

公开编辑器实现确实能解释**这条独立 API 路径**：[ModelService](https://github.com/microsoft/vscode/blob/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/src/vs/editor/common/services/modelService.ts#L69) 在 Windows 的默认值是 CRLF；[空 buffer 的 EOL 选择](https://github.com/microsoft/vscode/blob/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/src/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder.ts#L27-L40) 采用默认值；[PieceTreeTextBuffer.applyEdits](https://github.com/microsoft/vscode/blob/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/src/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBuffer.ts#L273-L287) 将插入字符串归一化到 buffer 的 EOL。

但另一个公开的 [Copilot Chat ApplyPatchTool](https://github.com/microsoft/vscode/blob/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/extensions/copilot/src/extension/tools/node/applyPatchTool.tsx#L328-L330) 使用 `WorkspaceEdit.insert` 并流式输出 `textEdit`，不等于本次 native SDK 工具。此实验**不证明**给专用 Agents UI 设置 `files.eol` 能修复原 SDK 工具，不据此改任何现用设置。

### 可复现方法

原始 harness、manifest 和结果仍保留在本操作私有目录的 `source-eol/repro`，具体 SHA-256 见 [结构化证据](./EOL-Diagnosis-20261019.json)。重新实验必须复制 harness 到新的自有 `.cache` 目录并指定新的空 profile，不直接在真实目标或证据目录运行：

1. 最小扩展 manifest 使用 `main: "./extension.cjs"`、`activationEvents: ["*"]`，`activate` 为空；`tests.cjs` 导出异步 `run`。
2. 用 `WorkspaceEdit.createFile(uri)`、`insert(uri, new Position(0,0), "AHP-VERIFIED\n")`、`workspace.applyEdit`、`openTextDocument`、`showTextDocument`、`document.save` 创建并持有第一个 scratch 模型。
3. 对全范围 replacement 再传相同 LF，重新 `openTextDocument` 后保存；再用上表 `setEndOfLine` metadata，重开并保存。
4. 对这个新测试 profile 执行 `getConfiguration("files").update("eol", "\n", ConfigurationTarget.Global)`，在另一个 scratch URI 重复第 2 步。
5. 每步只读取 scratch 文件，断言字节数为 `[14, 14, 13, 13]`；运行前有效 `files.eol` 必须为 `auto`。不要将此结果记入 D-S02 / D-AC01。

## 不能靠更多提示词跨越的剩余边界

已安装的 SDK JavaScript facade 只提供工具 handler 注册／覆盖和 session 文件系统转发；实际 native `apply_patch` 解析／写入实现不在这些可访问 TypeScript 文件内。固定 Host 源与安装包未提供该 native 工具可保证 LF 的参数或 `TextEdit.setEndOfLine` 通道。随包 generated RPC 类型没有公开的 `invokeTool` / `executeTool` / `runTool` 或 `tools.invoke` / `tools.execute` / `tools.call` 入口；没有猜测隐藏 RPC、反复发模型或将 Editor API 的结果套到 native 工具上。

因此，本次诊断不声称“已拿到 native 转换函数源码”，也不声称已证明所有编辑工具在逻辑上都不能产生 LF。要在现有禁止新模型／不改目标的边界内继续命名 native 内部函数，需要供应方给出此精确 runtime 的源码、EOL 契约或受支持的无模型工具测试入口；当前不存在可安全自行执行的下一项同路径验证。没有证据要求修改 pguide 产品或重开已接受的 Inner gate。

## 新的最小恢复授权方案（仅提案，未执行）

现有“只通过编辑工具修复、禁止 shell”的执行指引保持有效。若用户希望绕过这个**字节表达能力限制**而非权限机制，下一次应先明确授权一项新方案并同步新的 Deployment 契约，再准备合法的新指令／恢复入口；不能把本提案悄悄塞进持久化 subject、替换固定 Pilot 或重放旧 turn。

提议只增加一次必要的 `powershell` 文件修复调用：仅对原唯一 `ready.txt` 先核对仍为本轮已知 14 字节，随后以 `WriteAllBytes` 写入精确 13 字节。无终端自检、无其他文件、无联网、无 Git、无会话级或永久授权。用户必须在新原生卡片核对完整命令、路径及 **Allow Once**；不是使用已经超时的只读请求，不继承旧文件 grant，Agent 不批准。

```powershell
$p = 'D:\Code\regulator-ahp-target-20261019-1216-2eb89994\ready.txt'
if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($p)) -ne 'QUhQLVZFUklGSUVEDQo=') { throw 'Unexpected ready.txt bytes; no write performed' }
[IO.File]::WriteAllBytes($p, [Text.Encoding]::UTF8.GetBytes("AHP-VERIFIED`n"))
```

预期 diff 只有 `AHP-VERIFIED` 的行末 CRLF→LF；内容仍为 `AHP-VERIFIED`，最终 hex 必须为 `4148502d56455249464945440a`。先决条件不匹配时抛错，不覆写其他状态。`WriteAllBytes` 的输入明确包含 LF，二进制写入不依赖文本编辑模型或平台 EOL。

同一命令主体只在另一个全新自有 scratch `source-eol/repro/data/guarded-correction.txt` 验证：14 字节 CRLF→精确 13 字节 LF 通过；以已为 LF 的不同初始状态再试，guard 拒绝且文件 SHA-256 不变，通过。独立正反两项均通过，不是 native SDK 同路径复现或真实部署证据。**没有执行上述真实路径命令，也没有在真实文件上试写。**

**当前具体外部动作**是：允许后续为这一条精确文件修复准备新的、可核对的单次 shell 授权请求，并确认合法的修正上下文入口；该决定不是点批准，也不是 Outer acceptance。原 `continue` 不支持注入新上下文，若需要产品能力才能提供该入口，应另按 Silvermoon 正式返回实施，而不在部署阶段改实现。即便以后真人批准、写入和重观察都成功，也仍须补足真实 D-AC 证据后才可 `submitOuter`。

## 保留与清理

独立扩展测试的具体 PID `30736`、`41812` 均已退出，未停止共享进程。原专用 UI `28732`（仍为 `REGULATOR-AHP-VERIFICATION - Agents`）、Host 包装器 `36692` 及共享 UI `18136` 保留；`127.0.0.1:51793` 对不带认证的 HTTP 探测返回 `403`，确认服务仍响应，没有借此声称完成新认证会话。原会话和取消终态没有重放。只保存必要公开源码、非敏感复现和原失败证据；没有把 token、带 token URL 或其他 profile 凭据写入本文或结构化证据。Host/UI 的后续清理边界沿用原运行报告。
