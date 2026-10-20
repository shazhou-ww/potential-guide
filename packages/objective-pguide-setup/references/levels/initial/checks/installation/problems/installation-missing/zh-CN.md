---
title: pguide 可执行入口缺失
description: 指定 command 不存在或不能解析。
references: [pages/bootstrap]
---

外部 Agent 按 README 安装明确版本或构建准确源码，并更新 command/args。
Windows npm shim 使用绝对 .cmd 路径或 Node + 绝对入口；不要自动安装。
