# 官方人工确认入口的本机可行性

本文补充 [Deployment.md](./Deployment.md) 的环境准备，不代表 D-S02 / D-AC01 已完成，也不请求部署验收。

## 保留的实施候选

- 产品实现提交：`752121c0c8d1e4bc02ff27b5fa858d3ca0fd9860`。
- 已提交 Inner World：`9461c1245d0541220b9b4ee734219df94234106d`；交接 `submitInner#14`，生命周期仍为 `implementing`，控制权 `upstream`。
- 本次没有修改产品、Inner World 或 ledger，没有记录 acceptInner / submitOuter / acceptOuter，也没有启用 external 或创建修复 turn。主会话已独立复测 external 定向用例 12/12；此前完整检查结果见 [实施证据](./inner/AHP-External-Confirmation.md)。

## 本机实际验证

2026-10-19 使用已安装 VS Code `1.142.0` / commit `6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1`，没有换版本或安装插件：

1. `code --help` 实际提供 `--agents`。该版本安装在版本化目录 `6d62b1d5da\resources\app`，其中实际存在 `out\vs\sessions\sessions.desktop.main.js`；bundle 包含 `sessions.remoteAgentHost.add`，不是仅凭线上源码推断。
2. 当前已有 Agents 窗口保持不动。直接调用 `code --agents --user-data-dir ...` 会在当前宿主环境路由到已有窗口，不能据此声称创建了隔离 UI。因此改为直接启动安装的 `Code.exe`，显式传入 `--agents --user-data-dir <operation-owned-directory>`；仅在该子进程环境移除 CLI IPC / Electron-as-Node 标记，不修改用户或系统环境变量。独立进程和独立 Agents 窗口均实际出现，窗口仍显示 GitHub Sign In，未复制已有登录。
3. 只对隔离 UI 使用 loopback 检查入口，实际打开 Command Palette，搜索但未提交连接数据。真实结果是 **`Agents: Add Remote Agent Host...`**，不是之前方案中按源码 category 猜出的 `Sessions:` 显示前缀。稳定命令 ID 仍是 `sessions.remoteAgentHost.add`。
4. 仅打开该命令的空输入框，实际提示：

   ```text
   Add Remote Agent Host
   Paste a host, host:port, or WebSocket URL. Example: ws://127.0.0.1:8089
   ```

   随后 Escape 取消。没有输入 Host 地址、token 或连接名称。隔离 UI 的 settings 文件中没有 `chat.remoteAgentHosts` 条目，也没有 `chat.remoteAgentHostsEnabled` 覆盖值。
5. 官方 [配置注册](https://github.com/microsoft/vscode/blob/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/src/vs/workbench/contrib/chat/browser/remoteAgentHost/remoteAgentHost.contribution.ts) 声明 `chat.remoteAgentHostsEnabled` 默认 `true`，命令受此设置控制。本机干净 profile 中入口确实可用；没有读取或更改现有用户 profile 的有效设置。若用户自己的窗口找不到命令，应停止并检查该设置/管理策略，不由 Agent 自动启用。
6. 单独启动 `code agent host --new-instance --foreground --host 127.0.0.1 --port 51783 --connection-token-file <operation-owned-file> --server-data-dir <operation-owned-directory>`，只生成本次 Host 的随机传输 token，不读取或注入 GitHub / Claude 认证。TCP 实际响应；生产 `inspectAhp` 返回：

   ```json
   {"protocolVersion":"1.0.0","provider":"copilotcli","capabilities":{"multipleChats":{"fork":true,"sideChat":true}}}
   ```

   此调用仅协商和读取 provider，不创建 session / turn。它证明真实独占 Host 可连接，不证明额度、文件修复或人工批准已通过。UI 未连接该 Host。

本轮没有向任何 UI 输入 token，没有调用 approve / session-wide / always，没有实际 pending request。检查结束已停止所有自有 Host、隔离 UI 和检查入口；端口 `51783`、`51784` 均确认关闭，相关进程不存在；原 Agents 进程仍在。生成的传输 token、隔离 UI 数据、检查脚本与日志所在的 operation-owned 目录已全部删除。上述端口不是仍可使用的连接地址。

## 已核实的额外授权边界

官方 [Add Host 实现](https://github.com/microsoft/vscode/blob/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/src/vs/sessions/contrib/providers/remoteAgentHost/browser/remoteAgentHostActions.ts) 在用户提交地址和名称后调用 `addWebSocketRemoteAgentHostEntry`。固定版本的 [WebSocket 配置存储](https://github.com/microsoft/vscode/blob/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/src/vs/platform/agentHost/common/remoteAgentHostService.ts) 明确将 `address`、`name`、`connectionToken` 序列化到 `chat.remoteAgentHosts` 设置；不能将此描述为无配置副作用或仅 SecretStorage 里的临时连接。

因此最小方案使用另一个专用、可删除的 UI user-data-dir，不写现有 profile：只登记一个新建、仅 loopback 的独占 Host，并在本次验证结束后删除该 profile 和传输 token。用户本人通过官方空输入框提供该新 Host 的传输 token；Agent 不代输，不复制现有账户认证。干净 UI 无需先登录即可打开 Add Host 输入框已实测；实际连接及远端 session 列表仍须在用户允许并完成该步骤后验证，不能提前判为通过。

## 用户会在哪里确认

当前没有“本次待批准请求”的 session / turn / toolCall ID，因为尚未运行修复。不能给出虚构的 pending link，也不能要求预先批准一次未来文件操作。

实现门限按明确授权完成后，真实运行才可采用：

1. 重建独占 loopback Host 和专用 UI profile；在新 Agents 窗口按 `Ctrl+Shift+P`，执行已实测的 `Agents: Add Remote Agent Host...`。用户输入本机新生成的连接信息并命名为 `regulator-ahp-verification`；不要将含 token 的地址发到聊天或 Git。若提示额外登录或权限，先停止核对，不复制其他 profile 凭据。
2. 先确认该 Host 连接成功且该 Host 下的 session 列表可见，再在独立非 Git 合成 workspace 启动一次有界 pguide 修复。只在这个明确有人值守的 profile 上显式选择 external；此步骤不在本次调查中执行。
3. 在运行状态目录的 `regulation.json` / `transcript.jsonl` 读取此次 Host 确认的 `sessionUri`、`chatUri`、`turnId` 以及 `pguide/ahp-external-confirmation` 的 `toolCallId`、`phase`。在新 Host 的会话列表选择对应会话，打开其 default chat，待批准项应出现在该对话的工具确认卡片/编辑预览中，而不是窗口顶部的 “Allow connections from other machines” 按钮。
4. 身份不能只凭标题猜测。官方 [Developer: Open Agent Host State File](https://github.com/microsoft/vscode/blob/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/src/vs/sessions/contrib/providers/agentHost/browser/openAgentHostStateFileAction.ts) 使用当前 Agents 会话和 chat，可用于核对原始状态身份。必须把实际 session/chat/turn/toolCall 与 pguide 记录对齐；无法对齐就不批准。此卡片和跨客户端确认传播尚未实测，仍是下一轮验证内容，不是现有证据。
5. 用户核对 native 请求的完整作用范围，仅对隔离目录中创建精确 `AHP-VERIFIED\n` 的 `ready.txt` 作当前请求的单次决定。不选 session-wide / always，不批准执行其他命令或其他路径。若 UI 没有可明确识别的单次选项或请求范围不清楚，应拒绝并保留阻塞。
6. pguide 不代选、不把 wire 的 `user-action` 当真人身份认证，也不把点击当修复成功；必须收到 Host 后续结果，再独立重观察 `ready.txt` 的精确内容。只有真实目标达到才能考虑 submitOuter。

## 下一步最小人工操作

所需的不是 approve-all 或抽象部署验收，而是：**允许准备一个本次专用的干净 Agents profile 和独占 loopback Host，并由用户本人将这一个新 Host 的传输连接信息登记在该可删除 profile 的 `chat.remoteAgentHosts` 中，用于随后逐次确认。** 不改现有用户设置、不启用公网、不复制已有账户凭据；若命令在用户选择的 profile 不可见，另行核对设置，不自动修改。

此连接许可不接受实现、不启动修复、不授权任何文件操作。当前 explicit inner gate 仍须由主会话按明确决策处理；未来每个实际文件请求仍须真人在已核对的卡片中逐次批准。未经该许可，本轮可自主完成的真实连接准备已完成，并已安全停止，不重复消耗模型请求。
