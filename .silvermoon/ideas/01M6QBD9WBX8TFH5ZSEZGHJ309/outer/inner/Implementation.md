# Implementation

## Steps

### I-S01: 明确接口与实施边界

依据[修改建议副本](./ideal/Recommendation.md)和 Idea 边界核对现有实现、数据形状及兼容性，不扩大至外部产品。

### I-S02: 落实改动与针对性回归

在现有交付 supporting files 和 D-* 标识上设计最小结构化报告，生成当前摘要与详情并验证字段完整性；不依赖 Silvermoon 核心改版。

## Acceptance criteria

### I-AC01: 改动满足本地契约

实现、文档和公开入口与本子 IDEA 的范围一致；未验证的根因和来源不被表示为已确认。

### I-AC02: 回归保持既有保护

回放本地成功但公共未测、MCP 恢复但 Reference 未通过、追加 Ubuntu 要求及证据相互冲突等案例。 适用的仓库检查通过，未降低既有约束。
