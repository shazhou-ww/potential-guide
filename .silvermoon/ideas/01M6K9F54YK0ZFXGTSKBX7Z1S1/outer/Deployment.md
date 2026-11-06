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

2026-11-06 独立验收：包含本契约的 primary 提交 `3be07d321a57637e9189eda452cfb2f5703eb295` 的 [CI](https://github.com/shazhou-ww/potential-guide/actions/runs/42209946131) 已成功。逐 job/step 核验 Node 22/24 的 `Run all checks`、Linux/macOS/Windows 的 `Verify packed CLI deployment` 全部实际执行成功；新增的独立消费者及聚合门禁也成功。完整逐步骤回执见 [CurrentCI.json](./CurrentCI.json)，索引见 [Acceptance.md](./Acceptance.md)。此结果满足 D-S01 / D-AC01，不证明性能收益。

保留历史对照：`17cec879cf0f14c5df7dba8ddc551f2047396948` 的[隔离验证第三次尝试](https://github.com/shazhou-ww/potential-guide/actions/runs/41865501035/attempts/3) 仍为 failure，macOS 为 cancelled、零步骤；其余四项成功。见 [PreviousCI.json](./PreviousCI.json)。不将取消改记为通过，也不继续沿用此前暂停记录中的后续审批安排。本次仅获准开展验收，不记录 `acceptOuter`。

### D-AC02: 实际性能收益与入口可验证

核验同机配对八轮退出码均为 0、每个 Node 达到冷轮 10% / 热轮 25% 门槛，且 staging 字节级缓存恢复通过；保存不可变运行链接与完整结果引用。核对主分支的入口及执行代码与证据相符，开发者按文档可执行默认检查和完整验证，不依赖未记录的本地状态。

2026-11-05 已独立下载并核对[配对测量](https://github.com/shazhou-ww/potential-guide/actions/runs/41849316869)的八份原始 artifact：SHA-256、source revision、秒数及退出码与 [Measurements.json](./inner/Measurements.json) 全部一致；Node 22 冷/热改善为 24.44% / 53.35%，Node 24 为 18.26% / 56.96%，均达到既定门槛。父级另运行源码快照、检查编排、真实测量子进程及部署辅助回归，11/11 通过。上述性能结论仅对应文档中的控制与候选提交，不外推到其他并发功能变更后的最新 primary；当时完整部署验收受 D-AC01 阻塞。

2026-11-06 更新：D-AC01 的 CI 阻塞已解除，但 D-S02 / D-AC02 仍未完成。本轮重新下载并保存八份原始字节，通过 [VerifyMeasurements.mjs](./VerifyMeasurements.mjs) 重新校验 SHA-256、所有测量字段和门槛；[MeasurementRecheck.json](./MeasurementRecheck.json) 是历史数据复核，不是新性能测量。`3be07d32` 的构建入口、源码保护、测试并发及 Turbo 图与被测候选 `c50c6fac` 实质不同，不能证明当前 primary 仍达到该收益。独立 store 恢复依赖成功后，本地完整检查在符号链接测试因 Windows `EPERM` 退出 1；不跳过测试、不改变权限或共享配置，不计为成功性能样本。具体漂移、复现命令和阻塞范围见 [Acceptance.md](./Acceptance.md)。未改变验收标准或已接受的 Inner/Ideal，不追加 `submitOuter`。
