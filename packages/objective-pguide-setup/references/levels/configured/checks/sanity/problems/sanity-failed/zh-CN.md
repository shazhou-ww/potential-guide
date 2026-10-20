---
title: 实际修复尚未通过
description: 调节未达到目标，或独立重新检查没有观察到精确随机 marker。
references: [pages/bootstrap]
---

Agent 自报成功不算证据。确认 Agent 实际具备文件修改能力与会话工作目录支持。
parameters 只提供安全枚举：stage=regulate、reason=quota-exhausted、
exhaustedBy=agent-runs/stall 表示一次 Agent 后未达到目标；stage=recheck 的
reason=nonce-mismatch/target-not-reached 表示独立复核失败。
检查 Agent 的实际文件工具权限，不要盲目放开全部工具，也不要回显原始认证错误或 transcript。
不要自动重试消耗费用；在理解失败并重新考虑授权后再执行一次。
