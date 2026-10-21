# 建立长期运行的 Regulation Coordinator

## 问题

现有 Portfolio 把调度与外部队列快照、Planner 观察绑定，不能直接表达由命令驱动、运行时发现依赖且可持续恢复的基础调度服务。

## 结果

新增 `@potential-guide/regulation-coordinator`：资源池 Behavior 为第一参数，接收 CoordinatorCommand Event stream，输出 CoordinatorEvent stream；一个长期驻留的 Coordinator 自主管理一个优先队列及运行时依赖。已确认语义和复用决策见 [Design.md](./Design.md)。

## 边界

- 仅新增包及必要的工作区、构建、验证配置和文档；复用既有 helpers、runner 与 Regulation，不改动、删除、迁移或接线现有 Supervisor、Planner、Portfolio。
- 队列和依赖图均为内部状态；权限与预算来自可信构造配置，命令不得隐式授权。Portfolio 未来是否消解不属本次交付。
- 用户委托主 Agent 逐阶段审查并批准本子 IDEA；不等于总 IDEA 或 package-settings 获批。本轮仅准备和 submitIdeal，实施另候主 Agent 审查；不发布 npm，不改全局入口或用户配置。

## 验收标准

- 公共接口遵守上述 FRP 方向、单队列及请求/事实区分；空闲或单项失败后仍能接收后续工作。
- 动态资源、优先级、共享依赖回收和取消生命周期正确；过期结果、旧证据、成环及授权问题有明确事件，不伪报消费者成功，不提前释放槽位。
- 新包可构建、打包并由隔离 consumer 使用；现有 Supervisor 行为与接线保持不变，有回归证据。
