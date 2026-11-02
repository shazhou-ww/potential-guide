# 按组件契约重构 Task Engine

## 问题

Task Engine 的职责、状态与观察协议已重新明确，现有实现及测试不能替代新的契约基准，需要逐项核对并收敛差异。

## 结果

使 Task Engine 及直接消费者符合[职责入口](../../../../../../docs/axis/task-engine-responsibilities.md)与其引用契约。实现责任与验收场景见[契约差异](Contract-audit.md)，含资格时间见证的边界澄清见[准备决策](Open-questions.md)；旧实现不反向定义规范。

## 边界

1. 限定 task-protocol、task-engine、task-engine-storage、task-engine-http、task-engine-server、check-task、probe-task、task-engine-web-ui 八个 workspace 及直接相关测试、文档、脚本。
2. 旧设计 draft 仅供参考；不以既有测试反推设计，不把旧清理 Idea 当作删除授权，不修改其他 Idea 的状态或接管旧收藏工作。
3. 不包含周期性 Request、业务系列编排、Regulate 协议、资产管理或数据清理产品，也不发布 npm；不支持的旧数据明确拒绝，保留原库，不自动迁移或重演。

## 验收标准

1. 各 operation 与跨操作契约有可追踪的实现责任和验证场景，无未声明的语义偏差。
2. 数据域独占、三维状态、资格观测与唯一匹配、Worker 退出终结、恢复裁决和 ULID 幂等窗口符合契约。
3. revision、分页及订阅补读和集合增量通过可重复场景验证，既有业务能力在新边界内可用。
