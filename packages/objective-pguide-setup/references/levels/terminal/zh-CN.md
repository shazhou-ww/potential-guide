---
title: 本次就绪已验证
description: 通过已配置 Agent 完成一次真实隔离修复，并独立复核精确随机结果。
references: [system/overview]
---

terminal 仅为 verified 的目标别名，不是独立层级或观察结果。证据只针对 subject 目标 B 的用户、设备、配置和本次观察。
SSH alias 只是连接名，message 中的 hostname/user 是 B 实际运行 helper 时报告的身份，
不能把 A 上的结果当作 B 的证据。只有 B 上真实 nonce sanity 成功才验证本次就绪。
无需进一步执行；再次观察且保留 sanity 授权会重新运行并可能产生费用。
