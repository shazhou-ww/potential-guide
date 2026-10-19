---
title: 历史证据无效
description: 目标身份不匹配、未来时间、倒序或重复时间戳。
references: []
---

核对 hostname/user/home，禁止混合不同容器或账号。measuredAt 必须严格递增且不晚于
真实当前时间；度量必须非负有限。结构错误属于输入故障，不会成为健康结果。
修复时保留原始证据，重新收集真实样本，不篡改数据。

parameters.index 为零起始的首个无效样本位置，reason 区分 invalid-sample、
identity-mismatch、timestamp-order、future-timestamp。expected 提供目标身份、
前一个时间戳与当前时间上界；actual 只包含八个已定义采样字段。
诊断字符串截断到 256 字符，不回显未知字段或嵌套原始载荷。
