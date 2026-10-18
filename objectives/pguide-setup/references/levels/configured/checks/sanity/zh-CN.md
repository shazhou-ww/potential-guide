---
title: 有界真实 sanity
description: 经授权在独占目录内执行真实调节，并从固定 Git commit 独立重新检查。
references: [pages/bootstrap]
---

allowSanity 默认 false。获准后确认错误 marker，运行一次 pguide regulate，
再独立 probe 和检查随机 nonce。所有执行发生在 subject 的目标 B，不能使用 A 的成功代替。
最多一次 Agent 执行，不自动重试。总期限默认 20 秒；用户明确同意后直接 helper 可设置
timeoutMs:180000（最大 300000），内部调节留出 8 秒准备/复核余量并受总期限约束。
Pilot 外层默认 30 秒，run.cjs 拒绝总预算超过 24000 的检查；SSH 还需预留 10000
毫秒传输时间。长时限需使用直接 helper，不生成 Pilot terminal receipt。
最终终止进程并清理 B 独占的 fixture/config/state。
Agent 自报成功、空操作和错误 marker 都不会成为就绪证据。
