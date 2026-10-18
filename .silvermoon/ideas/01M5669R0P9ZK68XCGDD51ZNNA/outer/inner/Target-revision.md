# 控制端与目标设备修订：验证及阻塞

## 本轮代码

setup Objective 支持明确的本地/SSH 目标，保留旧本地 subject。SSH MVP 仅面向 POSIX 目标，使用已有 SSH 认证与主机信任、非交互连接，传输有界 Node payload 在目标侧执行本机检查。没有指定远端时不连接设备，也不回退为本机成功。目标缺少 Node 等准入条件时由控制端 Agent 按指引处理，不要求目标预先可运行 pguide regulation。

setup 与正式 ACP 客户端在配置中保留字符串版本，但 initialize wire 参数转换为数字并严格验证协商结果。客户端区分服务端请求与响应 ID，未知请求明确拒绝，权限请求默认取消；标准 session/load 用于续接，Agent 文本片段作为摘要，不根据文本猜测协议错误。

直接 bootstrap 的 timeoutMs 可到 300000；Pilot wrapper 保留 24000 上限，防止默认外层 probe 超时。sanity 返回安全 stage/reason 诊断，不暴露原始凭据或日志。

## 自动验证

主会话独立运行 pnpm check，通过 197 项测试，1 项已有平台相关跳过，无失败。setup suite 21 项通过，包含 5 项 SSH 通道测试；新增 ACP suite 11 项通过，强制要求数字协议并覆盖权限请求/响应 ID 隔离。

pnpm deployment:verify 通过：八个包独立安装，严格 ACP 测试替身驱动真实进程、setup Git 子目录读取及 nonce 修复。验证环境显式隔离用户配置和 PATH，不能误用这次刚配置的本机 pguide。

未连接真实 SSH 目标，因此只声明远端通道测试通过，不声明某台远端设备已配置。

## 本机实际配置

用户授权后，确认不存在旧 pguide 配置/入口，建立当前用户的持久命令 shims 和配置。shims 引用本仓库构建产物，不冒充已发布 npm 版本，不修改系统 PATH。已有用户 bin 目录原本就在 PATH。

- 入口：`C:\Users\Wei\bin\pguide.cmd`，七个官方子命令入口同时配置。
- 配置：`C:\Users\Wei\AppData\Roaming\pguide\config.yaml`。
- 默认 Agent：已有 Copilot CLI 的 Node ACP 入口；仅引用 USERPROFILE 环境变量，未读取或复制认证材料。
- 文件写入仅授权默认 cwd 范围，不使用 allow-all-tools、allow-all-paths。
- 命令发现没有 conflicts，config validate 通过。
- 修复后的真实 initialize 返回数字 1，session/new 成功；本地 setup configuration 返回 ok:true。

## 未解除的外部阻塞

本机真实 sanity 没有通过。实际 Copilot 推理返回 `CAPIError: 400 The requested model is not supported`。默认模型及 ACP 宣告可用的 gpt-5-mini、gpt-4.1、claude-haiku-4.5 均未取得成功；session/new 返回的 currentModelId 确认显式选择生效。

Copilot 将错误作为文本片段发送并以 end_turn 结束，regulator 因独立复查无进展正常耗尽停滞额度；不能因此判为目标达成，也不从文本虚构协议层失败类型。

已停止进一步模型请求，恢复默认模型选择，持久 subject 的 allowSanity 恢复 false。独占诊断仓库与测试资源已清理；本机状态文件保留安装/握手通过及 sanity blocked 的事实。

需要用户确认实际 Copilot 账户的模型访问能力或另行提供已授权 ACP Agent，再执行真实 sanity。没有替用户重新登录、申请服务或提取 token。

## 门禁裁决

I-AC01 与 I-AC02 的代码和自动测试成立；I-AC03 要求的真实本机 sanity 仍未成立。保留 implementing 状态，**不 submitInner、不 acceptInner、不 acceptOuter**，不以测试替身替代真实设备可用证据。此前已完成版本的验收记录保留为历史，新 revision 尚未验收。
