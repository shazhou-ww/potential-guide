---
title: 目标配置不存在
description: 自动发现的目标用户和最近项目位置均无实际 config.jsonc。
references: [pages/bootstrap]
---

用 pguide config path --cwd <workingDirectory> 确认目标，按用户授权创建完整 ID 的
JSONC 配置。subject 不再接受 configPath；默认值或独立 Agent 资源不算主配置文件。
先寻找执行 setup 的 Agent 的真实 ACP 入口；不要从 IDE 会话推断命令。
