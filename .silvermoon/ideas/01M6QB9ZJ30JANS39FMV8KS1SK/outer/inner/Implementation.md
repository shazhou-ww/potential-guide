# Implementation

## Steps

### I-S01: 明确接口与实施边界

依据[修改建议副本](./ideal/Recommendation.md)和 Idea 边界核对现有实现、数据形状及兼容性，不扩大至外部产品。

### I-S02: 落实改动与针对性回归

复用 Engine 的标准内容读取实现，设计窄的公开只读适配入口；Check 层解释 resources/check.json 并选择声明语言和资源。

## Acceptance criteria

### I-AC01: 改动满足本地契约

实现、文档和公开入口与本子 IDEA 的范围一致；未验证的根因和来源不被表示为已确认。

### I-AC02: 回归保持既有保护

使用 raw-only Gateway fixture 及损坏/缺块负例，保持路径、容量、时限、取消和禁止额外节点的约束。 适用的仓库检查通过，未降低既有约束。
