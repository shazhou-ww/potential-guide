# 主 Agent 审阅与受托验收

## 本 session 的授权

2026-10-31，用户在已呈现构想候选后明确指示：

> 开一个 subagent 去做，你负责 review & acceptance，若无 blocking issue，不用停下来问我。

本授权仅适用于 `task-engine-web-ui` 的既定范围：由一名实现子 agent 完成工作，主 Agent 独立审阅实现、验证证据并负责准确 revision 的阶段接受。没有 blocking issue 时，主 Agent 可按此授权推进构想、实现和外部结果的审阅/接受，不重复请求用户确认；这不是子 agent 自验收，也不是放宽验收标准或继承其他 idea 的授权。

三个 gate 继续使用 explicit。每次接受都必须基于相应已提交、已同步的准确 revision，保留主 Agent 审阅依据，再通过 Silvermoon CLI 记录；不使用 waived 绕过审阅，不直接编辑事件日志。

阻塞问题包括：缺失必需故事或行为、凭据/目标/访问边界失效、错误或未知结果被伪装成成功、关键测试/真实验证失败或证据不足、未经授权扩大范围，以及无法安全隔离或清理资源。优先让实现子 agent 修复；需要用户作实质决定或无法可靠解决时再停下说明。非阻塞 UX 细节在既定范围内自行收敛。

不授权发布 npm 包、部署到用户未指定的生产环境、修改其他会话资源、资产管理或高级 Input 搜索。

## 构想审阅

- 审阅候选：`idealRevision=7c67687959fefb4a1bcd5fad69d3f4bb2c9ab801`，已通过 submitIdeal#3 同步至 primary `05009f4604ccbb1e79050452cdf093172a6b3499`。
- 主 Agent 审阅范围：[构想](ideal/Idea.md)、[需求](ideal/Requirements.md)、[设计](ideal/Design.md)、[最终接口核对](ideal/Research.md#当前接口核对)，以及已准备的 Implementation/Deployment 种子与未勾选 ledger。
- 范围检查：US-01 至 US-06、US-10、US-11；统一提交任务栏、独立 Task/Execution、同机收藏/原参数重做、Endpoint 目录。无资产管理、账号同步、任意地址代理或通用搜索扩展。
- 可行性检查：三个依赖已 completed；类型发现与 revision guard、真实目录/冻结游标、提交/取消/事件均已有公开契约。实现风险已列为完成标准，不以猜测数据替代。
- 工程基线：主 Agent 在本 worktree 对尚未新增 UI 代码的依赖基线运行 pnpm check，退出码 0；这仅证明基线检查通过，不是 UI 实现或外部结果的验收。
- 审阅结论：未发现阻塞构想的问题，主 Agent 依据本次明确授权决定接受上述准确构想候选。接受事实以随后同步的 acceptIdeal 事件为准，不由本段文字代替事件。

## 实现与外部验证审阅

尚无 UI 实现候选或外部结果可接受。实现子 agent 不修改本文件、不记录 submit/accept、不推送 primary；主 Agent 接收其明确提交后独立核查差异、运行验证并推动修复，再对准确同步候选记录后续决定。

具体审阅结论和证据在对应阶段追加到本文件或 Outer World 的验证材料。ledger 仍只镜像执行条目，不承载审阅过程或授权。
