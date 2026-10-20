# 用依赖问题替代静态 prerequisite 链

## 问题

当前 prerequisite 把跨 Objective 依赖限定为静态启动前置链，无法自然表达执行中发现或中间层级产生的依赖。递归规范与跨 Objective 观察归属也增加了模型复杂度。

## 结果

Observation 始终描述当前 Objective；从现有 objective-pilot 包导出层级判断与依赖 probe，检查脚本直接复用，probe 将 false 转为依赖问题。Regulator 遇到依赖即交接 Supervisor，满足后重新观察当前目标。

## 边界

- 直接删除旧 prerequisite 协议，不保留兼容链或双轨模型。
- 依赖问题无需 ProblemRef，只描述外部实例、预期层级与当前层级。
- 本轮仅设计；MVP 不新增包或 check 子命令，两工程现有 Objective 定义之后手动迁移。

## 验收标准

- 静态已知、运行期发现及中间层级依赖使用同一问题协议。
- 存在依赖时不调用当前 Agent，全部外部依赖由 Supervisor 接管。
- 共享目标按消费者各自阈值解除等待；失败、循环和过期结果不造成错误放行。

## 支持文档

- [具体模型与治理闭环](./Dependency-design.md)
- [MVP 库函数与依赖 probe](./Dependency-check-api.md)
- [Haskell 伪代码：协议与 Behavior 的 Before / After](./Protocol-before-after.md)
- [修改范围、迁移方式与验证矩阵](./Change-map.md)
