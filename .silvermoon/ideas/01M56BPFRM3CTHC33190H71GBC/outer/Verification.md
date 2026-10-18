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
