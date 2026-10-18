# 真实 AHP Host 验证

本文支持 [Deployment.md](./Deployment.md)。真实环境结果与自动替身结果分开记录；未通过的标准不勾选，也不由生命周期授权代替验证。

## 环境与隔离边界

- 日期：2026-10-18。
- VS Code / 独立 Agent Host：`1.142.0`，产品 commit `6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1`。
- 以 `code agent host --new-instance --foreground --host 127.0.0.1 --port 0 --connection-token-file <临时文件> --server-data-dir <会话专用目录>` 启动独占 Host，不使用 `--replace`、`kill` 或接管用户现有会话。
- 连接参数与 token 只在本机临时文件及进程内使用，配置仅保存环境变量名。已有 GitHub 凭据仅用于向 Host 已公布的 protected resources 认证，不保存原文。
- 真实 `initialize` 协商结果为 wire `1.0.0`；root catalogue 公布 `copilotcli` 和 `claude` provider。注册表的 `protocolVersion` 不作为 wire 版本证据。
- 使用独立合成 Git Objective；固定 commit `19694b92f1530fc79fb51e567c8ade8dca2abe15`，subject 指向会话专用测试目录。唯一修复是创建包含精确 `AHP-VERIFIED\n` 的 `ready.txt`，不修改业务项目或 Objective 检查。
- 直接运行候选构建产物 `packages/pguide/dist/bin/regulate.js` / `continue.js`，避免用户已安装的旧 command wrappers 掩盖实际被测版本。

## 第一轮真实验证与发现

被测候选：实现提交 `57ae695281e50d180f4f0239637b04a9fd7931b3`，实施门限通过后 primary `52387a5131764a3098a87ad3a3ce60925e835e81`；当时已同步的 deployment revision 为 `d24c9a9fd07d0f5c757fb668613ebca1974a2766`。

| 检查 | 实际结果 |
| --- | --- |
| 独占 Host 存活及 loopback TCP | 通过 |
| 生产 `diagnose agent real-ahp` | 通过；返回 wire `1.0.0` 和 `copilotcli` provider，没有创建会话 |
| 官方 protected-resource 认证 | 通过；只向选中 provider 公布的 GitHub resources 提交已有进程内凭据 |
| 真实 `regulate` | 创建了 Host 确认存在的 session，但 120 秒后 `exhaustedBy: agent-limit`；没有修复目标，不能算通过 |

首轮 regulation 为 `1a333857-7dac-439f-8c4d-824df8b4dd7f`，真实 session 为 `ahp-session:/1f3bfc8a-12b5-455d-8ac9-d74a6033d47a`。恢复记录确实保存了 Host 确认的 session URI 与 canonical directory；由于尚未发送 turn，不能据此宣称执行、取消或恢复已通过。

真实 Host 订阅及其专用日志定位了两个客户端兼容问题，均已交回原实现 subsession 修复：

1. Host 的 default chat 使用标准 `ahp-chat://default/<编码身份>` 形状；原客户端仅接受单段 `ahp-chat:/<id>`，会拒绝真实身份。
2. Host 明确声明 chat backing 延迟到 first send 才创建，session 在此之前保持 `creating`。原客户端等待 `ready` 才发送首次 turn，形成初始化死锁。不能用放大超时或按产品名特判解决。

第一轮不作为 D-AC01、D-AC02 的成功证据。修复后需按同步后的契约和候选重新运行真实闭环。

## 修复后复测

被测代码提交为 `5fe79a355fc3918697b8eb88da9999b26f353130`；其 implementation revision `41bde3a7d25d1fe689143dffea2f0aee6e48fdd2` 已经重新提交并由父会话按用户委托审批。完整 `pnpm check` 为 267 个测试、265 通过、0 失败、2 个 Windows 预期跳过；两项真实兼容回归定向 39/39 通过。以下均为生产构建产物连接真实 Host 的结果，不是自动替身。

### 身份与目标边界

- 原先仅创建、未发送 turn 的 provisional session 在长时间等待后已被 Host 删除。`continue` 明确返回 RPC `-32001: Session was explicitly deleted`，没有创建替代会话。
- 新 session `ahp-session:/5dd4509c-1689-46f2-ab7b-20f67f722c6f` 已使用真实 authority-form default chat 发出首次 turn，证明原 URI 拒绝和 deferred startup 死锁已消除。
- Host 默认对 Git 工作区创建新 worktree，实际发送 `session/workingDirectoryReplaced` 将执行目录改为另一个目录。客户端按固定执行目标约束立即停止，而不是静默在新路径修复。
- 此次停止的真实 transcript 包含本次 owned turn 的 `chat/turnCancelled` 回执；`pguide/ahp-interruption` 记录 `cancellationSent: true`、`remoteStopConfirmed: true`、`executionState: cancelled`。客户端没有关闭共享 Host，也没有报告目标成功。
- 为继续验证，固定的 Git Objective 与实际执行目录分离：subject 改为独立的非 Git 合成 workspace，避免 Host 默认 worktree 行为，不修改客户端的目标守卫。

### 实际执行与恢复

非 Git workspace 的 regulation 为 `f8b51242-97fb-4b53-b1d2-cc9ae1c2e52a`。Host 确认的 session 为 `ahp-session:/bfae197c-e35c-4818-9fac-d461e45d808e`，chat 为对应的 `ahp-chat://default/<编码身份>`。创建、订阅、目录核验、认证和真实 turn 均已发生。

| 运行 | 恢复模式 | 身份与 turn | 实际结果 |
| --- | --- | --- | --- |
| 首次执行 | `new` | 原 session/chat，turn `4ecc5458-6f67-421a-bb9e-bb6758ebf7a4` | Host terminal error `quota: You have exceeded your monthly quota`，CLI 退出 6 |
| 显式继续 | `resumed` | 相同 session/chat，新 turn `1c25c09f-a58c-4517-a3ad-e6f403d8b54a` | 同样明确的 quota 错误，CLI 退出 6，没有重放旧 turn 或替换会话 |

两次之后均核对 `ready.txt` 仍不存在，目标未达成，客户端没有伪报成功。原会话恢复与真实取消已获得证据，但不能将它们替代完整修复闭环。

### 现有 ACP 对照

在同一候选代码和同一非 Git 合成目标上，选择用户已有的 `copilot` ACP profile，没有迁移其配置。regulation `640f02aa-c9d8-4e28-81c6-8043fdc0b85e` 完成真实 ACP 调用并得到 `end_turn`；当前精确文件 grant 未能将该工具请求解释为可靠的操作，因此安全输出 `operation: unknown`、`reason: unrecognized-request` 和 `authorization-required`，CLI 退出 3，没有声称修复成功。

这证明原 profile 和协议调用链仍可使用，并保留授权边界；它不是该工具权限形式已获支持或真实目标已修复的证明。ACP 的既有配置、精确权限和恢复行为另有完整自动回归。

## 2026-10-18 晚间继续部署

按用户继续推进的要求，在 `880c6084e9eb6cc535b536e0929c4715ba4c9723` 候选上重新创建独占 loopback Host，仍使用 VS Code Agent Host `1.142.0`、真实协商 wire `1.0.0` 和 `copilotcli` provider。没有复用已停止的旧 endpoint，也没有接管 editor Host。

本轮不向 Host 注入 GitHub CLI 的 resource token，而是使用 provider 已有的登录；没有切换账户、购买额度、复制登录凭据或改变用户配置。真实 Agent 已产生工具调用，因此本轮没有再现前次的 quota 错误。subject 同时明确给出了目标文件、精确内容和唯一允许的修改，避免将缺少测试指令误判为产品问题。

| 项目 | 本轮真实证据 |
| --- | --- |
| Regulation | `7ea22cf9-d23b-4cbe-b79e-7207046e5a61` |
| Session | `ahp-session:/09e111e8-75e5-4c4a-a8d9-364bf9e8a085` |
| Turn | `e4075683-db7d-4322-a35f-08b7d35e9b38` |
| 实际请求 | Agent 尝试创建隔离 workspace 内的 `ready.txt`，Host 发出真实文件创建确认 |
| 当前显式权限 | 仅为该 `ready.txt` 设置 `operation: edit` ceiling 与 grant，不包含其他路径或执行权限 |
| 安全结果 | 客户端发送拒绝，保存 `operation: unknown`、`reason: unsupported-ahp-operation-and-once-semantics`；Agent 结束后重新观察 |
| CLI 与目标 | `authorization-required`，退出 3；`ready.txt` 仍不存在，没有报告 `target-reached` |

### 权限阻塞的核验

真实确认带有 native `edits.items[].after.uri` 预览，以及 `Allow in this Session` / `Allow Once` / `Skip` 选项，但这些显示内容不能单独证明完整操作范围或供通用客户端信任的单次授权契约。实际 `_meta.permissionRequest` 只有 `diff`，没有可靠的 operation kind 或完整资源声明。

核对与安装版本固定一致的官方源码：

- [permission metadata reader](https://github.com/microsoft/vscode/blob/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/src/vs/platform/agentHost/common/meta/copilotd/agentPermissionRequestMeta.ts) 明确将 raw permission metadata 定位为可随实现变化的兼容/展示桥接，而非稳定协议契约；其 `withPermissionDiff` 也解释了本次只出现 diff 的形状。
- [shared metadata reader](https://github.com/microsoft/vscode/blob/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/src/vs/platform/agentHost/common/meta/agentPermissionRequestMeta.ts) 不能为这个实际请求补出缺失的可靠操作类别。

因此不能根据工具名、文件预览、选项标签或 opaque option ID 推断批准，也不能通过放宽客户端、开启 session-wide 自动批准或手动代写目标文件来通过测试。本轮确认当前主要阻塞已经从额度转为真实文件写入的安全授权能力，仍不满足 D-AC01。

## 当前门限与恢复条件

- D-S01：真实环境与隔离边界已建立。
- D-AC02：真实原 session/chat 恢复和 owned turn 取消回执已验证；自动测试另覆盖迟到状态隔离。
- D-AC03：已有 ACP 配置完成真实对照调用，无需迁移，结果与授权不足明确区分。
- D-S02 / D-AC01：仍未完成。本轮真实 Agent 已到达文件创建，但缺少能安全执行当前精确 grant 的可靠权限契约，`ready.txt` 不存在，不能通过部署验收；前次 quota 错误不再作为本轮当前阻塞。
- 不记录 `submitOuter` 或 `acceptOuter`。恢复需要真实 Host 提供经核验的结构化操作/资源与单次批准语义，或先明确设计并审批独立的人工逐次授权流程，再重新运行完整修复闭环；不能以已有文件 grant 为由猜测未声明的权限。保持现有通用 AHP 拒绝未知请求的边界，不自行扩大权限或反复消耗调用。
- 验证结束后已停止独占 Host，并确认其 PID 消失、loopback 端口关闭，临时连接 token 已删除。没有停止共享 editor Host。恢复时需重新准备明确授权的 Host；不得把已停止的 endpoint 当作仍可恢复的运行环境。
