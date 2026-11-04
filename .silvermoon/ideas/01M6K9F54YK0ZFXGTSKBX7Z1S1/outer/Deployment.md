# Deployment

本次交付仅影响仓库检查工作流，不发布 npm 包。完整验证入口为 `pnpm check && pnpm deployment:verify`；默认检查移出的全部消费者仍由三平台部署矩阵执行。

对照测量的前置门槛为同机配对 Node 22/24 冷轮各至少改善 10%、热轮各至少改善 25%，全部完整退出 0。测量条件与限制沿用 [实施证据](./inner/Performance.md)，不把默认检查收益外推为整个 CI 的同等比例改善。

## Steps

### D-S01: 观察主分支 CI 的完整结果

本契约同步主分支后观察一个绑定该提交的实际 CI；核验 Node 22/24 检查和 Linux/macOS/Windows 打包消费者、CLI 验证全部成功，记录精确提交、运行与重试情况。

### D-S02: 核验日常反馈与完整验证收益

复核真实同机配对 workflow 的原始测量结果、精确 source revision、缓存恢复证明和退出码；核对当前主分支可执行检查逻辑与被测候选一致，以及开发文档正确说明默认和完整入口。本地 Windows 权限与 registry 限制须保留，不作为通过样本。

## Acceptance criteria

### D-AC01: 交付保障在真实 CI 中通过

提供绑定部署契约提交的成功运行链接，五个 CI job 全部成功，证明 Node 兼容性、完整消费者验证和必要的跨平台 CLI 安装运行保障未丢失；不以仅成功的定向测试替代全量结果。

2026-11-05 暂停记录：部署契约及已批准实现已同步 primary，准确验证提交为 `17cec879cf0f14c5df7dba8ddc551f2047396948`。其 [primary CI](https://github.com/shazhou-ww/potential-guide/actions/runs/41856361463) 的四项执行通过，macOS 先因 runner 未分配、后因其他 main 请求优先而取消。为避免并发提交打断，在独立 ref `verification/pnpm-check-performance-01M6K9F5` 对同一提交运行[原有完整 CI](https://github.com/shazhou-ww/potential-guide/actions/runs/41865501035/attempts/3)：Node 22/24、Linux 和 Windows 全部成功，macOS 没有执行任何步骤，因托管 arm64 容量不足而取消；该运行整体不是成功结果。

按用户要求停止今晚的本地监控和后续自动重试。没有记录 `submitOuter` 或 `acceptOuter`，本阶段清单仍未完成。次日先刷新 primary、复核检查入口及并发实现变化，再观察或重新触发隔离验证；只有 macOS 实际执行成功且其余证据仍适用，才可提交部署 revision 并按用户委托审批。不要将旧成功候选、取消、排队或零步骤 job 作为本次 Deploy 通过的替代证明。

### D-AC02: 实际性能收益与入口可验证

核验同机配对八轮退出码均为 0、每个 Node 达到冷轮 10% / 热轮 25% 门槛，且 staging 字节级缓存恢复通过；保存不可变运行链接与完整结果引用。核对主分支的入口及执行代码与证据相符，开发者按文档可执行默认检查和完整验证，不依赖未记录的本地状态。

已独立下载并核对[配对测量](https://github.com/shazhou-ww/potential-guide/actions/runs/41849316869)的八份原始 artifact：SHA-256、source revision、秒数及退出码与 [Measurements.json](./inner/Measurements.json) 全部一致；Node 22 冷/热改善为 24.44% / 53.35%，Node 24 为 18.26% / 56.96%，均达到既定门槛。父级另运行源码快照、检查编排、真实测量子进程及部署辅助回归，11/11 通过。上述性能结论仅对应文档中的控制与候选提交，不外推到其他并发功能变更后的最新 primary；完整部署验收仍受 D-AC01 阻塞。
