---
title: 包交付准备
description: 验证本包任务、依赖、源码和已有产物。
references: [problems/delivery-incomplete]
---

# 包交付准备

结构通过后验证 build 和 check（或 lint/test/typecheck）scripts 与 Turbo、内部 workspace
范围和明确允许方向、第三方 catalog、包源码导入、已有发布/CLI 产物及本包交付配置。
不会运行上述脚本；缺少产物是未验证，不是执行构建的授权。
