# Regulation Coordinator 实施种子

本轮仅为可行性准备，尚未授权 subagent 开始代码实施。主 Agent 在用户明确委托下审查准确 revision 后继续；设计边界见 [Idea.md](./ideal/Idea.md) 与 [Design.md](./ideal/Design.md)。

## Steps

### I-S01 — 新增独立包与 FRP 生命周期

仅新增 `@potential-guide/regulation-coordinator` 及必要工作区/构建配置，复用 effects、Regulation、公开纯 helpers 和可注入 runner，建立资源 Behavior 第一参数、命令到事实流及单实例驻留/关闭边界。

### I-S02 — 实现单队列与运行时依赖调度

完成命令驱动优先队列、动态资源、执行终止确认、consumer-owned 依赖图、共享与回收、证据/generation 隔离、授权预算和可恢复错误路径。

### I-S03 — 固化反例与兼容回归

为 Design 中关键反例提供确定性测试和包文档，验证新包在失败后继续运行，检查现有 Supervisor/Planner/Portfolio 源码与接线未改变，运行必要定向检查和 `pnpm check`。

## Acceptance criteria

### I-AC01 — 公共包接口与驻留可用

类型检查和测试证明资源第一参数、命令请求/事实事件、单内部队列、空闲/输入结束后的驻留及 scoped 清理；公开接口不含外部 queue snapshot 或 dependency graph。

### I-AC02 — 调度与安全反例通过

可重复测试证明动态容量/能力、共享派生回收、provider 仅唤醒、环/旧证据/过期结果拒绝、权限预算边界，以及失败恢复和终止确认前不释放槽位；证据记录在同世界测试或验证支撑中。

### I-AC03 — 仓库与既有服务保持兼容

`pnpm check` 与针对旧 Supervisor 的回归通过；diff 证明现有 Supervisor/Planner/Portfolio 实现及接线没有改动，新包依赖/产物/文档符合现有 workspace、layers、构建与验证规则。
