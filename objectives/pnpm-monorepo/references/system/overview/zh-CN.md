---
title: 按需求检查 pnpm monorepo
description: 先建立结构与需求映射，再观察依赖、构建和交付准备，不执行仓库脚本或线上操作。
references: [levels/initial, levels/structured, levels/terminal]
---

Subject 指定目标仓库绝对路径 `root`、相对需求契约路径 `contract`，以及控制机上
可信构建入口 `checkerModule`；不能让不可信目标选择要执行的模块。
先修复结构问题，再重新观察交付层。完整报告保留四态结果、规则、证据、
需求和包关联；`unverified` 不是通过，平台配置准备不等于线上可用。
检查器和目标仓库分离，使用准确源码版本构建的检查器。
