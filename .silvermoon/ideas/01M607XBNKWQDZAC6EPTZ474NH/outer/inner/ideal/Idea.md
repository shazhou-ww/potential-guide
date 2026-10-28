# 将 Objective 交付为固定组合 Check 的声明式制品

## 问题

Objective 主要表达 Check 组合、等级和指导内容，不应为了这些数据要求独立 npm 包或 registry 版本解析。通用 Check 说明也需要在具体目标下继承和定制。

## 结果

Objective manifest 直接声明每个 Check 的来源与 digest，配合 References 构成可消费的声明式制品；Pilot、CLI 和 regulation 可以观察、指导及恢复准确的内容组合。

## 边界

- 依赖 [Check 制品](../../../../01M607T630T6DSDZYTYA52ED6J/outer/inner/ideal/Idea.md)；保留 subject、等级和问题语义，不设置独立 lock 文件或版本范围求解。
- 默认继承 Check 自身及 problems 的 References，允许按 Objective 场景覆盖或显式补充；不借文档覆盖改变检查结果契约。
- 打通业务消费但不承担内置内容的全量迁移、正式 Release 或离线全集导出。

## 验收标准

- 真实 Objective 可固定组合多个独立 Check，并正确执行输入映射、等级判断和依赖观察。
- References 的继承、局部覆盖和场景化补充可验证，未覆盖内容保持可用。
- 任务恢复使用原有准确制品，缺失或篡改明确失败，不重新选择版本。

设计动机和未定细节见[设计说明](./design-rationale.md)。
