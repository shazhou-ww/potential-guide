# Deployment

## Steps

### D-S01: 提供可消费的变更

已将实现提交 `b15becd6dbbe` 同步到 primary，供 Silvermoon 后续适配。

### D-S02: 验证下游升级入口

已确认 README、脚手架和仓库内 manifest 示例统一使用三层声明，并以完整
`pnpm check` 验证所有直接调用面。

## Acceptance criteria

### D-AC01: Primary 可达

实现提交可从刷新后的 `origin/main` 到达；证据记录在
[deployment-evidence.md](./deployment-evidence.md)。

### D-AC02: 下游契约清晰

Objective Guide README 展示完整三层 manifest，且仓库内示例均使用同一结构，
并由完整测试和打包检查证明，详见
[deployment-evidence.md](./deployment-evidence.md)。
