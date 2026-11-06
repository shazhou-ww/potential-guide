# Deployment

本次交付仅影响仓库检查工作流，不发布 npm 包。完整验证入口为 `pnpm check && pnpm deployment:verify`；默认检查移出的全部消费者仍由三平台部署矩阵执行。

2026-11-07 用户明确授权：“我是说 D-S02 和 AC02 可以 skip 了，我们直接 accept 把”。据此将 D-S02 / D-AC02 从本次部署验收范围移除，不把未满足的性能要求标为通过，不改变已接受的 Inner/Ideal。本次只验收下述真实 CI 覆盖；历史测量、当前性能未证明和本地 `EPERM` 失败全部保留于 [Acceptance.md](./Acceptance.md)。

验证源码固定为 `3be07d321a57637e9189eda452cfb2f5703eb295`，对应已实际执行的 CI `42209946131`。本次范围调整与同步提交仅承载元数据，不是新的检查或性能样本；复核其精确提交、job、step 和消费者证据，不把旧数据外推为新性能结论。

## Steps

### D-S01: 观察主分支 CI 的完整结果

本契约同步主分支后复核绑定上述验证源码的实际 CI；核验 Node 22/24 检查和 Linux/macOS/Windows 打包消费者、CLI 验证全部成功，记录精确提交、运行与重试情况。

## Acceptance criteria

### D-AC01: 交付保障在真实 CI 中通过

提供绑定上述验证源码的成功运行链接，五个 CI job 全部成功，证明 Node 兼容性、完整消费者验证和必要的跨平台 CLI 安装运行保障未丢失；不以仅成功的定向测试替代全量结果。

2026-11-06 独立验收：包含本契约的 primary 提交 `3be07d321a57637e9189eda452cfb2f5703eb295` 的 [CI](https://github.com/shazhou-ww/potential-guide/actions/runs/42209946131) 已成功。逐 job/step 核验 Node 22/24 的 `Run all checks`、Linux/macOS/Windows 的 `Verify packed CLI deployment` 全部实际执行成功；新增的独立消费者及聚合门禁也成功。完整逐步骤回执见 [CurrentCI.json](./CurrentCI.json)，索引见 [Acceptance.md](./Acceptance.md)。此结果满足 D-S01 / D-AC01，不证明性能收益。

保留历史对照：`17cec879cf0f14c5df7dba8ddc551f2047396948` 的[隔离验证第三次尝试](https://github.com/shazhou-ww/potential-guide/actions/runs/41865501035/attempts/3) 仍为 failure，macOS 为 cancelled、零步骤；其余四项成功。见 [PreviousCI.json](./PreviousCI.json)。不将取消改记为通过，也不继续沿用此前暂停记录中的后续审批安排。
