---
title: 按需求检查 pnpm monorepo
description: 先建立结构与需求映射，再观察依赖、构建和交付准备，不执行仓库脚本或线上操作。
references: [levels/initial, levels/structured, levels/terminal]
---

Subject 包含目录协议的 `context`、共通 `policy` 和联合 `deliveries`，不再接受集中契约路径。
按 pnpm 实际发现 workspace，读取每包 standardize 的 Unit/JSONata 声明；
通过 Objective dependency API 调用各包明确的 Pilot 目录 ID 与投影 subject。
结构阶段期望 structured，交付阶段期望 terminal；期望层级属于消费者，不属于清单。
缺失或损坏声明是本 Objective 的 internal problem，调用故障是 error；
真实包未达到期望则返回统一 dependency problem，由 Supervisor 交接并重新观察。
checks 不调用 Agent 或嵌套 regulation。同版本 standalone 检查器由完整 Git snapshot 固定。
先修复结构问题，再重新观察交付层。完整报告保留四态结果、规则、证据、
需求和包关联；`unverified` 不是通过，平台配置准备不等于线上可用。
检查器和目标仓库分离，使用准确源码版本构建的检查器。
