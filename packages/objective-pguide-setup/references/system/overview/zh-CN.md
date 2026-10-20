---
title: 从控制机 A 配置目标机 B
description: 先确认安装和 ACP 会话，再通过用户授权的一次隔离修复证明可用。
references: [levels/initial, levels/installed, levels/configured, levels/terminal, pages/bootstrap]
---

本 Objective 在已就绪的 A 上调节，subject 指向 B；检查不安装软件或修改配置。
A 的控制 Agent 应先读取本目录 README.md，按用户授权在 B 完成 bootstrap，
优先复用 B **实际存在**的 ACP 入口和已有认证。SSH 仅支持 POSIX B；B 起初不需要
pguide，但 helper 需要 Node。缺 Node 时先引导安装，连接失败绝不改查 A。
省略 target 或使用 local 保留 A=B 的原生本地入口。SSH 不转发 A 的环境或登录态。
IDE 会话本身不等于 ACP 命令。缺少真实入口时应明确报告，不能伪造就绪。
只有允许 sanity 后通过独立的随机 marker 复核才能达到 terminal。
