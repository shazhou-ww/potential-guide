# Implementation

## Steps

### I-S01: 明确接口与实施边界

依据[修改建议副本](./ideal/Recommendation.md)和 Idea 边界核对现有实现、数据形状及兼容性，不扩大至外部产品。

### I-S02: 落实改动与针对性回归

复用 deployment-consumer 的版本图及现有 published 消费验证，生成固定组合和安装计划，保留用户选择的目录与前缀。

## Acceptance criteria

### I-AC01: 改动满足本地契约

实现、文档和公开入口与本子 IDEA 的范围一致；未验证的根因和来源不被表示为已确认。

### I-AC02: 回归保持既有保护

覆盖 latest 占位、缺失版本、依赖图偏离及默认脚本限制，验证运行和作者能力的结果分别记录。 适用的仓库检查通过，未降低既有约束。
