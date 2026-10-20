# Implementation

本契约是准备阶段的可调整初版，不代表本轮已获实现授权。设计依据见 [依赖设计](./ideal/Dependency-design.md) 与 [修改清单](./ideal/Change-map.md)。

## Steps

### I-S01: 替换问题与观察协议

移除静态 prerequisite；新增独立 expected-level check 命令及 probe 的 false 转换，贯通两种问题、观察、校验和摘要；测试 fixture 使用新协议，不迁移两工程现有 Objective 定义。

### I-S02: 贯通治理交接与依赖调度

实现依赖交接结果、多依赖等待、逐消费者阈值恢复及动态目标运行时绑定，保留权限与取消边界。

### I-S03: 完成破坏性迁移验证

更新直接相关文档、测试和示例，验证旧协议明确拒绝及原有非依赖行为不变。

## Acceptance criteria

### I-AC01: 问题协议可验证

通过命令与 Pilot 定向测试证明 true/false 判断及 probe 转换正确、观察归属固定、两种问题结构严格、未知外部状态不伪装为业务阻塞。

### I-AC02: 依赖闭环可恢复

通过 Regulator、Planner、Coordinator 与 CLI 集成测试证明零 Agent 交接、共享阈值恢复、循环诊断和过期结果隔离。

### I-AC03: 核心协议与消费方验证完整

以修改清单的覆盖检查和定向测试证明消费方与非依赖回归正确，并执行 `pnpm check`；若既有 Objective 定义尚未手动迁移导致检查阻塞，明确记录原因，不伪造通过或引入兼容层。
