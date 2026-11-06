# Implementation

## Steps

### I-S01: 明确接口与实施边界

依据[修改建议副本](./ideal/Recommendation.md)和 Idea 边界核对现有实现、数据形状及兼容性，不扩大至外部产品。

### I-S02: 落实改动与针对性回归

复用 release inventory、包结构检查、verify-release-ci 和既有发布 workflow，集中呈现已观察状态及多包依赖顺序。

## Acceptance criteria

### I-AC01: 改动满足本地契约

实现、文档和公开入口与本子 IDEA 的范围一致；未验证的根因和来源不被表示为已确认。

### I-AC02: 回归保持既有保护

使用漏接线、错误 SHA/attempt、依赖版本不可用及后验失败 fixture 验证报告，保证检查不创建 tag 或更改 registry。 适用的仓库检查通过，未降低既有约束。
