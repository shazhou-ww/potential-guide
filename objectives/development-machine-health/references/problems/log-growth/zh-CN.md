---
title: 日志增长过快
description: 历史首尾日志字节差除以真实秒数超过策略。
references: []
---

actual 和 expected 单位为 bytes/second，相等通过。先确认错误风暴、日志级别、
轮转与审计保留要求，再调整生产者和保留策略。保留诊断证据，不盲删或截断日志，
不把删除日志伪装为修复根因。
