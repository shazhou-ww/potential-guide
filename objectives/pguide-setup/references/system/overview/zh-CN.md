---
title: 当前用户的设备 setup
description: 先确认安装和 ACP 会话，再通过用户授权的一次隔离修复证明可用。
references: [levels/initial, levels/installed, levels/configured, levels/terminal, pages/bootstrap]
---

本 Objective 不安装软件或修改配置。外部 Agent 应先读取本目录 README.md，
按用户授权完成 bootstrap，优先复用自身**实际存在**的 ACP 入口和已有认证。
IDE 会话本身不等于 ACP 命令。缺少真实入口时应明确报告，不能伪造就绪。
只有允许 sanity 后通过独立的随机 marker 复核才能达到 terminal。
