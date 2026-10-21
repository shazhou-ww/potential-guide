# Implementation

## Steps

### I-S01: 明确协议与迁移边界

定义保留 initial、累计达成判定和最高业务层级语义；识别 schema、历史 terminal 目标及证据的迁移要求。遵守已发布 schema URI 不可变约束。

### I-S02: 对齐运行链路与自有 Objective

调整协议、观察、目标比较、Regulator、Coordinator 及依赖验证的直接相关消费面；迁移仓库内 Objective、引用文档及必要生成物，不合并 command 简化。

### I-S03: 验证层级与兼容性反例

补充达成矩阵、异常、依赖证据和旧输入反例，执行相关测试及 pnpm check，更新直接相关说明。

## Acceptance criteria

### I-AC01: 达成判定准确

测试证明首层失败、逐层通过、全部通过及观察异常的结果准确；current 与未达层级问题引用保持区分，initial 目标不触发不必要的检查或 agent。

### I-AC02: 消费面与迁移一致

相关集成测试证明目标比较、依赖交接和仓库内 Objective 使用同一层级语义；旧契约显式迁移或明确拒绝，已发布 schema 不被原地修改。

### I-AC03: 仓库校验通过

相关测试、生成物检查及 pnpm check 通过，文档能指导消费者使用新契约。
