# Deployment

## Steps

### D-S01: 提供可消费的变更

将通过仓库检查的变更同步到 primary，形成供 Silvermoon 后续适配的稳定提交。

### D-S02: 验证下游升级入口

确认文档与 manifest 示例足以让 Silvermoon 将现有 Guide 迁移为三层声明。

## Acceptance criteria

### D-AC01: Primary 可达

实现提交可从刷新后的 primary 到达，以 Git 提交可达性检查作为证明。

### D-AC02: 下游契约清晰

Objective Guide README 展示完整三层 manifest，且仓库内示例均使用同一结构，
可由文件检查和完整测试结果证明。
