---
title: 有界真实 sanity
description: 经授权在独占目录内执行真实调节，并从固定 Git commit 独立重新检查。
references: [pages/bootstrap]
---

allowSanity 默认 false。获准后确认错误 marker，运行一次 pguide regulate，
再独立 probe 和检查随机 nonce。最多一次 Agent 执行，内部配额至多 12 秒。
总期限默认 20 秒，至多 24 秒；最终终止进程并清理独占的 fixture/config/state。
Agent 自报成功、空操作和错误 marker 都不会成为就绪证据。
