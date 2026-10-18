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

## 当前门限与恢复条件

- D-S01：真实环境与隔离边界已建立。
- D-AC02：真实原 session/chat 恢复和 owned turn 取消回执已验证；自动测试另覆盖迟到状态隔离。
- D-AC03：已有 ACP 配置完成真实对照调用，无需迁移，结果与授权不足明确区分。
- D-S02 / D-AC01：仍未完成。真实 AHP 修复被账户月额度阻止，`ready.txt` 不存在，不能通过部署验收。
- 不记录 `submitOuter` 或 `acceptOuter`。恢复条件是账户已有可用额度/授权后，在同样的隔离目标和固定候选上重跑完整修复，确认新 observation 达到目标；不自行购买额度、切换账户、扩大权限或重复消耗调用。
- 验证结束后已停止独占 Host，并确认其 PID 消失、loopback 端口关闭，临时连接 token 已删除。没有停止共享 editor Host。恢复时需重新准备明确授权的 Host；不得把已停止的 endpoint 当作仍可恢复的运行环境。
