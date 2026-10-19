# 外部人工确认适配

## 为什么返回实施阶段

2026-10-19 部署验收未通过：D-S02 / D-AC01 缺少真实文件修复证据。当前客户端始终立即拒绝未知确认，用户无法在另一可信客户端完成当前请求。本适配解决等待能力，不声称给不完整的权限字段补出自动授权语义，也不修改 Ideal World 的真实目标和授权边界。

## 权威依据与可实施路径

安装的 VS Code `1.142.0` / commit `6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1` 的 [chat actions](https://github.com/microsoft/vscode/blob/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/src/vs/platform/agentHost/common/state/protocol/channels-chat/actions.ts) 将 `ChatToolCallApprovedAction`、`ChatToolCallDeniedAction` 和 result confirmation 声明为 client-dispatchable，按 chat / turn / toolCall 定位；Host 回传的 action 进入共享 chat state。因此 pguide 无需成为批准方：可以让已连接同一 Host、能够展示完整 native 请求的人类客户端完成决定，pguide 只消费正常 action 流。

[native chat state](https://github.com/microsoft/vscode/blob/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/src/vs/platform/agentHost/common/state/protocol/channels-chat/state.ts) 的 option 仍只有 approve/deny 类别和展示标签，没有可用于自动选取的 once 语义。拒绝基于 label / toolName / diff / opaque ID 的自动批准，不能用 session 级授权取代当前文件的逐次批准。

VS Code 的 [session link 实现](https://github.com/microsoft/vscode/blob/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/src/vs/platform/agentHost/common/openSessionLink.ts) 可以描述 session/chat/turn 和 connectionAuthority，但单独构造链接不证明编辑器已经连接独占 Host，也不自动建立认证。客户端适配保持通用，不依赖此产品链接。真实部署前必须先证明人类客户端能访问相同 Host 和相同 session。

## 最小契约

- profile 可选 `confirmations: deny | external`，缺省为 deny；ACP 不接受该字段。external 是等待模式，不是 grant、批准回执、自动 UI 或新的权限分类器。
- external 下 owned turn 的 execution/result pending confirmation 仅输出不含 token 的 session/chat/turn/toolCall/phase 索引，保持流读取；不阻塞 action 消费来等待回调、不代选 option、不发送 confirmation。
- 外部客户端逐次决定后，消费 Host 回传动作；pguide 仍以 turn terminal 后的 Objective 重观察判断目标，不能以批准或模型自述成功结束。
- 整个等待计入当前有界执行；取消/超时发送既有 owned-turn 取消并报告是否得到远端确认。断线、目录改变和不确定执行保持既有失败关闭边界，不替换会话或自动重试。
- 配置编辑与恢复使用已有规范化 profile 序列化；未显式改变已保存配方时不得偷偷改用 external。
- 此功能只能用于用户可见、可信的逐次批准客户端；不改变 Host 自身权限策略。用户须拒绝任何超出隔离 `ready.txt` 精确写入的请求，不选择 session-wide/always，不预先授权后续请求。没有该客户端或用户不在场时保持 deny。

## 验证与外部授权点

自动回归覆盖配置拒绝非法/ACP 混用、默认 deny、external 两阶段不发送确认、外部决定驱动完成、等待取消/超时、断线及错误 turn 隔离；CLI 验证 profile 路由、进展与目标重观察，完整 pnpm check。测试 Host 是替身，不能用于部署验收。

实施候选同步并提交后，请用户验收这一显式等待能力；这不是部署验收或文件操作许可。返回 deploying 后，唯一所需的实际人工授权是：在已连接同一独占 Host 的可信界面，核对本次 session/chat/turn/toolCall 及隔离路径，仅对创建精确 `AHP-VERIFIED\n` 的 `ready.txt` 选择当前请求的单次批准。请求内容或实际作用范围无法核实时应拒绝并保留阻塞；不得由 Agent 代点。只有此后真实 pguide 重观察达到目标，才可考虑 submitOuter。
