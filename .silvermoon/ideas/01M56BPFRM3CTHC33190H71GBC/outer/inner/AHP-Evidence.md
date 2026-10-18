# AHP 实现与自动验证证据

本文件支持 [Implementation.md](./Implementation.md)，不替代三个世界契约或生命周期决定。自动 Host 是测试替身，不是真实 VS Code 验收结果。

## 固定来源与版本

- 调查日期：2026-10-18；实施基线 `26901ec0f7c8fcedfa75676fee0ac7b02f685996`。
- 设备工具：Node.js `v24.12.0`，pnpm `11.22.0`。
- 已发布依赖：`@microsoft/agent-host-protocol@1.0.0`，在 pnpm catalog 固定版本；无新增运行时传输依赖。
- 官方 SDK release commit：`5f16d81bb7045b66d7bc768d244feab75002d943`，tag `typescript/v1.0.0`；[release metadata](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/clients/typescript/release-metadata.json) 声明 wire `1.0.0` / `0.9.0`。客户端只提供配置中的一个版本，并要求 Host 原样协商返回。
- 同时核对的官方规范 main commit：`1ef0642965efaa7ef98caff287bca923fbc80ec6`。规范站点抓取受网络地址检查阻止，实际通过 `gh api` 读取官方仓库原文，没有猜测方法名。

| 官方证据 | 实现决策 |
| --- | --- |
| [Lifecycle](https://github.com/microsoft/agent-host-protocol/blob/1ef0642965efaa7ef98caff287bca923fbc80ec6/docs/specification/lifecycle.md) / [Versioning](https://github.com/microsoft/agent-host-protocol/blob/1ef0642965efaa7ef98caff287bca923fbc80ec6/docs/specification/versioning.md) | `initialize` 使用版本列表与 root subscription；不将产品名/产品版本当作能力。禁用自动 reconnect/副作用重发。 |
| [Transport](https://github.com/microsoft/agent-host-protocol/blob/1ef0642965efaa7ef98caff287bca923fbc80ec6/docs/specification/transport.md) / [Authentication](https://github.com/microsoft/agent-host-protocol/blob/1ef0642965efaa7ef98caff287bca923fbc80ec6/docs/specification/authentication.md) | endpoint 认证不是通用 bearer wire 字段。用显式 query 参数加环境变量；protected-resource token 仅发送给选中 Agent 已公布的 resource。 |
| [CreateSessionParams](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-session/commands.ts) / [Session channel](https://github.com/microsoft/agent-host-protocol/blob/1ef0642965efaa7ef98caff287bca923fbc80ec6/docs/specification/session-channel.md) | session URI 由客户端选择，但 Host `createSession` 成功才确认存在。保存该确认身份，等待 `ready`，使用 Host 的 default chat，不伪造 session ID，也不擅自创建替代 chat。 |
| [Chat actions](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/actions.ts) / [Chat channel](https://github.com/microsoft/agent-host-protocol/blob/1ef0642965efaa7ef98caff287bca923fbc80ec6/docs/specification/chat-channel.md) | 执行使用 `chat/turnStarted`，等待同一 turn 的 Host terminal action；取消使用 `chat/turnCancelled`。恢复通过 session/chat subscribe，不套用 ACP `session/load`。 |
| [ResourceResolveParams](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/common/commands.ts) | 将 CLI cwd 作为 Host 可理解的 file URI；Host 解析 canonical directory 后核对 session/chat 执行范围，不自动映射远程路径或改用其他工作区。 |
| [SDK client](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/clients/typescript/src/client/client.ts) | 复用官方 request/subscribe/dispatch 和 reducers；其默认 malformed-frame warning 会包含解析错误，因此增加有界严格传输包装，坏帧显式断开，不输出原始 payload。 |

## 接入与恢复边界

- 顶层 `AcpAgentProfile | AhpAgentProfile`；合法旧 ACP 配置和 schema 2 恢复记录规范化后仍保持原语义，不接受任意缺失 selector 的配置或新旧位置同时声明。
- `authentication: {type: query-token, parameter, tokenEnv}` 是传输层环境引用；`{type: none}` 或省略表示传输已受保护。可选 `resources` 对应官方 `authenticate`，不会替用户获取/复制认证或自动批准工具。
- 所选 provider 必须在 root catalogue；Host 必须实现目录解析、session 创建、ready/default-chat、订阅和标准 turn 生命周期。方法/身份/目录/权限不可用均明确失败，不按 VS Code 名称分派。
- 恢复记录固定 profile、subject、Pilot commit、原 canonical directory、session/chat 与上次 turn ID。已有身份丢失、当前有活动/排队/后台任务或旧 dispatch 没有可确认的 terminal turn，均拒绝自动重放。
- 仍需修复才创建/恢复会话；确认目标达成只来自下一次 observation。Agent 的文本自报完成不是目标证据。
- deadline 覆盖连接、握手、目录/认证和执行；中断后只请求取消本次拥有的 turn，最多额外等待 250 ms 收集确认。transcript 的 `pguide/ahp-interruption` 区分 `cancellationSent`、`remoteStopConfirmed` 与 `executionState`。无确认时保留不确定状态，不声称远端已停。
- 已集成并发 primary 的权限链路：当前 ceiling/grants 随每次 continue 重载；worker 将安全授权请求转交监督器。标准 AHP [ToolCallPendingConfirmationState](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/state.ts) 无 ACP 的 operation kind 或 allow-once 选项契约，不以诊断 toolName、opaque toolInput 或 edits 预览猜测授权。即使配置了表面匹配的 grant，仍用官方 execution/result confirmation action 发送 `approved: false`，记录 `operation: unknown` 与明确不支持的原因；不杀死 prompt，让 Agent 尝试替代方案。最终由新观察决定进展优先，未进展则 `authorization-required`，不是伪成功或静默绕过。
- 所有连接输入总计上限 4 MiB；坏 JSON/非文本帧、无效 snapshot/terminal action、重复或迟到 action 有明确处理。不关闭共享 Host，不 dispose 不属于本次的会话。
- setup Pilot 的既有目标仍是 ACP stdio readiness；仅修复其对规范化 ACP profile 的兼容，选择 AHP 时明确报告该 Pilot 不支持，不扩大其真实部署验证语义。

## 自动验证

- 父会话在冲突集成完成后独立执行 `pnpm exec tsx --test packages\pguide-cli-core\test\ahp.test.ts packages\pguide\test\ahp-cli.test.ts packages\pguide-cli-core\test\config.test.ts packages\pguide-config\test\config-command.test.ts packages\pguide\test\acp-permissions.test.ts`：58 个测试，57 通过、0 失败、1 个 Windows symlink 权限预期跳过，退出 0。覆盖新旧配置、编辑保存、恢复与拒绝重放、逐字节上限、握手取消、官方拒绝动作及 ACP 权限回归。

- 定向 ACP setup 回归：`pnpm exec tsx --test packages\pguide\test\setup-objective.test.ts`，22/22 通过，0 失败。
- 定向 ACP planner/supervisor 回归：`pnpm exec tsx --test packages\pguide\test\supervisor-cli.test.ts`，12/12 通过，0 失败。
- 最终 `pnpm check` 退出 0：format、8 个 workspace 的 lint/typecheck/test、根脚本测试、build 和 8 个包的 pack 检查全部成功。Biome 仍报告既有 warning，不含阻断错误。
- 集成 primary 权限功能后的最终完整测试汇总：261 个测试，259 通过，0 失败，2 个 Windows 平台预期跳过（`real-path deduplication follows platform case sensitivity` 与创建文件 symlink 所需平台权限不足）。workspace 分项：cli-core 49/49、config 6/6、effects 12/12、git-source 15/15、objective-pilot 23/23、objective-regulator 38/38、objective-portfolio-supervisor 31/31、pguide 74 通过/2 跳过；另有根 scripts 11/11。
- AHP 协议、CLI 闭环/恢复、共享 planner/worker 与配置编辑使用实际 WebSocket JSON-RPC 替身。协议测试精确验证 4,194,304 字节允许、4,194,305 字节拒绝；握手和初始化均受取消期限覆盖，坏帧不泄露原文。
- CLI 合成目标验证完整两个 problem 及 scope 参数抵达 Agent、Host 身份和 turn ID 在请求前持久保存、完成后重新观察、目标已满足不触碰会话、当前配置改变不覆盖原配方。Agent 仅自报成功而目标未变时仍为 `exhausted`。
- 权限等价集成自动验证：deny-all、表面匹配的显式 grant、结果确认和拒绝后的替代进展四个 CLI 场景均通过。实际捕获官方 `approved: false` action，断言没有任何 approve、持久记录安全 `unknown` 授权请求与 denial 事件、执行后重新观察；没有进展时 `authorization-required`，替代修复得到观察证明时 `target-reached`。既有 ACP allow-once、精确资源/命令、symlink、恢复权限重载和监督反馈测试完整保留。
- 全量并行运行曾暴露既有 supervisor 测试的 7 秒总预算不足以同时覆盖启动、Git 动态重载、执行和反馈后再规划；定向 12/12 通过。保留全部反馈断言，将该有界测试预算改为 15 秒、启动等待 16 秒后，最终全量通过，未修改生产调度语义。

## 真实 Host 前提与交接

本次实施未启动、关闭或连接共享 Host，也未访问敏感目标或输出连接凭据。父会话负责 Outer World 的真实连接与修复证据。

只读核对本机 `code --version` 为 VS Code `1.142.0`，commit `6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1`，`code agent --help` 有 `host`、`ps`、`stop`、`logs` 和 `endpoints`；这不等于通过 pguide 接入成功。父会话报告现有 editor 注册入口是 `{type,path}`，并非已确认的 WebSocket URL；本实现不接管这个入口或现有会话。注册文件的 `protocolVersion`（editor 为 `1.1.0`、独占 Host 为 `0.1.0`）不能当作 AHP wire 协商证据，实际以 `initialize` 响应为准。

父会话已准备独占 loopback WebSocket Host，使用 `code agent host --new-instance --foreground`，没有 `--replace` 或 `kill` 干预共享 Host。实施会话没有连接该 Host 或读取其 token。连接 token 只在进程内通过指定环境变量使用；`endpoints` 的原始输出不得写入日志/证据。该 Host 是否接受 wire 1.0.0、实际 provider、已登录资源认证、canonical 测试目录、真实修复/恢复/取消仍须由父会话实测，不能用本文件或测试替身代替。

## 并发 primary 集成与提交归属

原基线完成检查后，Silvermoon 检查发现另一 idea 的并发 primary 历史较新。父会话已保存实施更改、快进集成 `78f52f211724ad6cca34199e8a4f26287d058393` 并恢复实施文件；本会话逐处解决六个内容冲突，保留新增 permission policy、恢复重载、supervisor 事件与 ACP 行为，没有整文件 ours/theirs 覆盖或补写事件。

实施会话未编辑任何 events，也未修改另一个 idea。按父会话最新分工，不自行最终 stage/commit、同步或交接生命周期；父会话拥有 Ideal 需求对齐与最终提交顺序。内容冲突均已解决，Git index 的冲突标记由父会话统一 stage 记录；最终交接 `commit: null` 不表示真实部署验收。
