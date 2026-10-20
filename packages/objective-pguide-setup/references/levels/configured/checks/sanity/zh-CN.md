---
title: 有界真实 sanity
description: 经授权在独占目录内执行真实调节，并从固定 Git commit 独立重新检查。
references: [pages/bootstrap]
---

allowSanity 默认 false。获准后确认错误 marker，运行一次 pguide regulate，
再独立 probe 和检查随机 nonce。所有执行发生在 subject 的目标 B，不能使用 A 的成功代替。
最多一次 Agent 执行，不自动重试。总期限默认 20 秒；用户明确同意后直接 helper 可设置
timeoutMs:180000（最大 300000），内部调节使用总期限，不扣除固定启动余量；
准备、执行与复核始终共用外层总期限。
Pilot 外层默认 30 秒，本地 run.cjs 默认仍拒绝超过 24000ms 的检查。
本地可明确协调更长 subject 与启动配置的 regulationStrategy.probe.timeoutMs：
例如 60000ms / 75000ms，外层至少覆盖 subject 加 6000ms 启动/输出/清理余量。
期限通过 runtime-owned PGUIDE_PROBE_TIMEOUT_MS 校验，无效或不足即明确失败。
长时本地 Git Pilot 仍必须实际完成全部检查、nonce 修复和独立复核；直接 helper
成功不生成 Pilot terminal receipt。SSH cap 不变，还需预留 10000ms 传输时间。
最终终止进程并清理 B 独占的 fixture/config/state。
Agent 自报成功、空操作和错误 marker 都不会成为就绪证据。
