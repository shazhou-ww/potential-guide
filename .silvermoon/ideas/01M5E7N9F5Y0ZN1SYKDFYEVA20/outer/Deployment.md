# Regulation Coordinator 隔离包消费验证

本任务只验证本地 tarballs 的隔离消费，不发布 npm、全局部署或迁移设备配置。实现已由主 Agent 接受为 `implementationRevision=271a21e6881e739c6cb9100dac298a0a4deb8bdf`，接受提交为 `f441ae05bedffb80ec6b1b888672d5947d367f8f`；不编辑其 inner/ideal 或交付源代码。

先同步本合同及 [verification/run.mjs](./verification/run.mjs)、[consumer.test.mjs](./verification/consumer.test.mjs)、[consumer.ts](./verification/consumer.ts)，重新观察 deploymentRevision，再执行 driver。执行结果新增于 `verification/Result.json` 和同世界证据摘要；它们只记录结果，不增加部署要求。driver 记录执行前已同步的 contract revision、合同/fixture hashes 和 source commit；最终提交前用 `--check-evidence` 核对这些输入未改变，避免把后补证据误作新需求或伪造已验证 revision。

## Steps

### D-S01 — 准备可消费的本地产物

沿用现有 release inventory 的 manifest、`pnpm pack` 及 `verifyConsumerGraph`，只构建/打包 Coordinator 的六包传递闭包。记录源码 commit、accepted inner、每包 Git tree、版本、入口 JS/声明 hash、tarball SHA-256 和打包文件摘要；新包源树须与接受提交一致。driver 位于本 worktree，所有实际 pack/install/consumer 目录只在本 worktree 的 `.cache` 下独立创建，不使用其他 worktree 或全局 links。

### D-S02 — 从隔离 consumer 验证

用本地 tarball overrides 安装 effects、Coordinator、旧 Portfolio Supervisor 三个直接入口及完整六包闭包。内部包只使用本地产物，不回退 registry/latest；第三方已声明依赖通过 `--prefer-offline` 优先复用缓存，缺少 metadata 时允许普通下载，仍禁止 lifecycle scripts 与发布。复用现有消费者依赖图检查，确认实际物理解析路径不逃离 consumer、无残留 workspace range；fixtures 仅用公开包 imports。执行 Node consumer 测试和真实 `.d.ts` 编译，禁止 paths 指向 monorepo source。

代表性运行验证：有限命令结束后的资源/结果反馈驻留与两个输出订阅单调度器；非法命令、资源及执行失败后的有效输入恢复；同一 provider 的 L1/L3 独立唤醒、取消一个 root 后共享保留、最后引用终止确认后释放；取消和 stopping 占槽直到 kill 确认；可信 lifetime 预算不能重置；正常同 Effect.scoped 消费者清理；旧 Planner+Coordinator 同一包边界组合 smoke。

### D-S03 — 确认兼容边界并交付证据

使用确定性 in-process runner/resolver，明确不是实际 Agent/process 集成；result/kill 的确认由 fixture 控制并逐项断言。记录测试进程退出、scope/订阅、活动执行和 resolver lease 的归零与隔离目录实际删除。只将摘要放同世界证据，ledger 只勾选执行条目。

不执行全量 pnpm check；只做新增 fixture 语法、公开 types、隔离运行和证据一致性验证。旧 CLI capability-feedback 超时仍是被接受的 baseline 限制，不用本次 smoke 声称其修复。背压仍要求订阅者 drain/取消；cancel/close 没有旁路，预算和权限完全来自可信 options。package-settings 可能并发改变设备状态，本任务只陈述自己的命令与文件边界，不把对方状态当作本任务修改。

## Acceptance criteria

### D-AC01 — 本地产物完整可安装

Result 中六包身份/hash、安装命令和日志摘要、物理依赖图、ESM 断言与独立 tsc 退出 0，证明真实 tarballs 可消费。执行前合同 revision 与输入 hashes 可核对；不使用 npm 发布或全局链接。

### D-AC02 — 隔离运行符合新契约

隔离 Node fixtures 全部退出 0，包含上述 minimum、共享、错误、终止、预算和同 scope 清理断言。运行结果证明所有 fixture 运行句柄、scope、输出订阅和来源 lease 收支相等，无活动执行；测试进程已退出，operation-owned 隔离目录删除后存在性检查为 false。

### D-AC03 — 既有 Supervisor 和设备不变

同一次隔离安装的旧 Planner+Coordinator smoke 退出 0，完成一次达标并清空队列，显式 close 两服务。最终 Git diff 只含本 IDEA outer supporting evidence 和 ledger/event，没有 accepted inner/ideal 或 packages/scripts 交付修改。命令清单无 publish、全局 install/link、设备入口或配置写入；旧 CLI baseline 和模拟 runner/背压/预算限制明确保留。
