# Implementation

## Steps

### I-S01: 明确接口与实施边界

依据[修改建议副本](./ideal/Recommendation.md)和 Idea 边界核对现有实现、数据形状及兼容性，不扩大至外部产品。

### I-S02: 落实改动与针对性回归

复用作者声明、生成 Schema 和现有 README 示例，建立消费 fixture 与文档检查，并在公开入口呈现字段约束及执行维度。

## Acceptance criteria

### I-AC01: 改动满足本地契约

实现、文档和公开入口与本子 IDEA 的范围一致；未验证的根因和来源不被表示为已确认。

### I-AC02: 回归保持既有保护

覆盖 network 必填项、directory-unusable、无效问题码、额外结果字段及超时/取消，不增加第二份业务定义。 适用的仓库检查通过，未降低既有约束。
