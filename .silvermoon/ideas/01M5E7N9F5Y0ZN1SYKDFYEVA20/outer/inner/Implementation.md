# Regulation Coordinator 双意图与可恢复状态实施

本文件是修订构想的轻量实施初版，须待新 ideal 验收及先行 level-attainment 协议就绪后细化。[Verification.md](./Verification.md) 记录上一版五命令实现的历史证据，不证明本次需求已完成。

## Steps

### I-S01 — 定义双意图、纯归约与恢复契约

依据 [Design.md](./ideal/Design.md) 与 [Types.md](./ideal/Types.md) 先收敛 RegulationTarget/ResourceAllocation/CoordinatorState 及合法转换，再推导 Command/Event，落实两个纯 reducer、资源意图全量更新、单命令及单次调用边界。核心状态不含实例 ID、输入通道生命周期或固定日志位置；明确一致快照、适配层接续元数据、存储错误和外部执行核实协议；[Events.md](./ideal/Events.md) 仅作遗漏检查，不引入长期目标控制器。

### I-S02 — 接入资源意图、资源侧授权与副作用执行

以单一目标命令和 binding/期望并发意图替代五命令、旧资源池及 harness grants/ceiling；使用真实资源授权并保留独立 quota/budget。以 monadic composition 组织调度、runner 和持久化副作用，reducer 回放不执行动作；明确资源更新响应和恢复核实，保留有限依赖、终止确认，不迁移旧服务。

### I-S03 — 验证归约、资源响应与跨重启恢复

测试 initial、同值新意图、需求覆盖、no-resource 初值及切换、configured 零并发、期望并发低于实际、binding 变更、资源侧拒绝、有限依赖与真实终止。验证输入结束或断开不隐式撤销意图或关闭服务，错误仍明确反馈。独立 reducer 验证纯归约，进程/存储反例验证一致恢复、未知运行核实、无副作用重放与预算不重置；执行定向校验和 pnpm check，披露真实基线限制。

## Acceptance criteria

### I-AC01 — 双意图与纯归约语义完整

公开类型及测试证明单一目标命令、资源意图完整更新和两个纯 reducer 成立；目标只读稀疏 Record 每次合法更新递增全局 revision 并写入条目 updatedAtRevision，同值新意图不丢失。同 priority 按最近更新版本排序，更新可改变顺序但不无故重复执行；initial 不执行业务检查或回滚，资源期望不冒充实际占用，旧不兼容输入明确拒绝。Record 的 JSON 往返及恢复保留全局水位和条目版本。

### I-AC02 — 恢复、生命周期与资源边界正确

反例证明 pending/block 边界和有限依赖正确；目标/状态可持久化接续，采用日志时由适配层保存一致处理位置，已终结意图不重跑，回放不触发副作用，未知执行核实前不释放占用或重复启动。no-resource 是合法初值而非故障兜底，不冒充实际终止；输入通道结束不取消意图或服务。资源拒绝明确返回，不另设 harness 审批；存储故障不静默从零开始，恢复不退还或重置预算。

### I-AC03 — 交付与兼容验证可复查

构建、类型、相关测试、打包消费及 pnpm check 有本次命令结果；既有 Supervisor/Planner/Portfolio 保持原接线和行为。基线故障与本次引入问题分开记录，文档与直接相关生成物一致。
