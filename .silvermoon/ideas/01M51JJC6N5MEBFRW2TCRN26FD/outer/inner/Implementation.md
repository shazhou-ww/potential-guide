# Implementation

本契约交付可发布的函数式实现、验证证据及 RC 发布候选；不以 idea 内的实验替代生产实现，不在本阶段发布 npm 产品版本。领域边界依据[讨论结论](./ideal/Design-notes.md)、[函数式模型](./ideal/Functional-model.md)和[包结构方案](./ideal/Package-structure.md)。接受破坏性迁移，不提供旧接口兼容层；Supervisor 只做必要适配，不直接修改 Silvermoon 仓库。

## Steps

用户已授权以子会话分工推进，由主会话依据本契约的验证证据自主审批 Implementation 与 Deployment 门线；仅在无法自主判断或外部权限阻塞时请示。子会话负责有界交付，主会话负责集成、完整验收与发布协调，不以子会话的完成声明替代验收。

### I-S01: 落实包边界与公开契约

- 建立 objective-pilot、git-source 与必要的 effects 薄适配，替代 objective-guide 的消费入口；复用开源运行底座，不重写 Effect / Fiber / Stream。将 [Effect 原型](./effect-frp-prototype/README.md)的实测边界落实为生产测试，最终公开导出以实际职责为准，不为占位包填充假 API。
- 落实 Spec / 实例、Spec / Subject、单次效应 / Behavior 提升的分层。目标 LevelId 和 Agent 单次执行限制只在 RegulationStrategy 中定义；沿用 Objective URI 与局部 ID 的四层寻址，稳定身份与 commit 版本分离。
- git-source 提供领域无关的不可变 GitSnapshot 及其 Behavior；Pilot 负责载体无关的资源解析和规格校验，由组合入口薄适配连接，不默认新建专用 Pilot 来源包。初始、调用故障和业务缺陷分别表达。

### I-S02: 实现观测与收敛效应

- 实现进程、HTTP 与内存统一探针；Pilot 只观测，保留前置链、层级顺序与同层问题聚合，输出当前层级及晋级障碍，不调用 Agent。
- 一次 regulation 内持续执行观测、整体汇报 Agent、修复后重探测；限制只作用于 Agent 单次调用，不扩展为跨轮预算。不引入逐问题任务管理、业务锁、冲突仲裁或回滚机制。
- 实现依赖级替换、先投递 Abort 再启动新效应、父子取消、旧结果隔离和日志旁路。未变化的 Pilot 保留；探针负责自己的资源清理及超时后的兜底终止，HTTP 取消不承诺停止远端业务。

### I-S03: 交付迁移入口与 RC 发布候选

- 同步仓库消费者、CLI、配置、scaffold、恢复记录和必要的 Supervisor 调用；完成面向 Silvermoon 的[迁移指导](../../../../../docs/functional-migration.md)及可运行示例，覆盖 import、规格、探针协议、Agent 输入、执行与取消，明确旧记录或旧输入不兼容时的报错。
- 更新 workspace 依赖、catalog、构建与导出、打包验证、发布 workflow 的逐包映射及 tag 规则和发包文档。RC 的内部依赖必须能由 npm 解析，不能残留 workspace 路径、未发布版本或对退役入口的依赖。
- 按 [Deployment 版本规则](../Deployment.md#版本与发布边界)准备[逐包发布清单](./Release-candidates.md)：实际变更、已发布基线、目标 RC、版本判断理由、依赖顺序与候选 commit。完成 pnpm check、候选 tarball 检查和独立消费者验证后再进入部署；本阶段不创建产品发布 tag 或发布产品包。

## Acceptance criteria

实现证据、候选 commit、逐项覆盖和跨平台 CI 见[验证记录](./Validation.md)。当前产品尚未发布，外部 RC 完成状态由 Deployment 单独判断。

### I-AC01: 公开契约与来源边界可验证

类型检查、包导出测试与协议测试证明：

- Spec 可序列化，目标、subject、Agent 限制和内部观测没有重复配置；同一配方可绑定不同 subject，完整调节入口无需外部观测快照。
- 三种探针业务失败仍是成功调用，调用故障不产生可信层级；Pilot 不调用 Agent，前置观测的 Objective 归属与目标校验正确。
- git-source 不导入 Objective 领域类型；固定 commit、ref 更新与旧快照读取的测试证明快照内容和版本一致，Pilot 适配不丢失版本或静默吞掉来源故障。

### I-AC02: 闭环与生命周期可验证

可控时间、可观测 Agent 和真实探针集成测试证明：完整问题汇报、单次执行限制、故障不误修复、修复后重探测、初始态及父子取消正确；策略 / 绑定更新不重启未变化的 Pilot。事件顺序断言证明 Abort 投递先于替换任务启动且无需等待旧任务清理；预取消不启动用户计算，不合作或不可中断旧任务的迟到结果不覆盖当前状态。需要一致更新的输入通过完整快照提交验证，不把多个独立 ref 的 latest 组合当成事务。资源清理测试覆盖已声明支持的平台，并明确 HTTP 仅取消本端等待的边界。

### I-AC03: 候选产物可迁移且可发布

pnpm check、逐包打包检查及独立临时消费者测试全部通过。消费者仅安装候选 tarball、不引用仓库源码，即可按迁移指导运行新入口与闭环示例；Supervisor 必要适配后的测试通过。发布候选包含可审计的逐包版本清单、匹配的 manifest / tag 规则、实际打包后的可解析依赖和所需导出；所有待发产品版本符合 0.x RC 规则，不含 1.0、稳定版或空占位实现。证据关联到确切候选 commit / 产物；这些结果不冒充 npm 已发布或 Silvermoon 已迁移。
