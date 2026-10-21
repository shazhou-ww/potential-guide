# Regulation Coordinator 单一目标命令实施

本文件是修订构想的轻量实施初版，须待新 ideal 验收及先行 level-attainment 协议就绪后细化。[Verification.md](./Verification.md) 记录上一版五命令实现的历史证据，不证明本次需求已完成。

## Steps

### I-S01 — 定义目标请求与调用终结边界

依据 [Design.md](./ideal/Design.md) 明确 Objective/subject 身份、接受顺序、同一需求更新与终结后新尝试、initial 无工作语义及事实关联。先定义意图与 Coordinator 的 initial/公开状态和确定性 reducer，再依据 [Events.md](./ideal/Events.md) 的讨论收敛有类型 delta；同时明确 pending、执行终态与恢复数据持久化边界，不引入长期目标控制器。

### I-S02 — 接入单一命令与有限依赖编排

以单一设置目标命令替代 add/replace/cancel/priority/retry，更新直接相关 API、状态机、文档和 consumer。保留资源第一参数、共享依赖、过期反馈隔离、真实终止确认及可信预算；依赖编排创建新的调用，不复活 blocked 执行，不迁移旧 Supervisor/Planner/Portfolio。

### I-S03 — 补充反例并验证仓库

重写命令及生命周期测试，覆盖先行 initial 契约、相同参数的新尝试、需求覆盖、优先级调整、依赖及故障；用独立 reducer 验证公开事件前缀能重建约定状态，运行定向校验和 pnpm check，明确披露仍存在的基线失败，不复用旧通过记录。

## Acceptance criteria

### I-AC01 — 单命令语义完整

公开类型、运行测试和包 consumer 证明仅有设置目标命令；身份隔离、顺序覆盖及终结后同值新请求成立。initial 不触发检查/Agent、不回滚 subject，priority 更新不无故重复执行，旧命令按明确契约拒绝。

### I-AC02 — 生命周期与依赖安全

反例证明 pending 未进入 Regulation，block/error 后调用终结；新尝试不使用旧活跃执行状态，恢复数据及持久化失败有明确行为。独立 reducer 从约定初值和完整事件前缀重建意图确认、任务、观察、依赖、资源及异常状态；依赖派生、共享撤销及迟到反馈不伪报成功，不提前释放槽位、不绕过权限或补充总预算。

### I-AC03 — 交付与兼容验证可复查

构建、类型、相关测试、打包消费及 pnpm check 有本次命令结果；既有 Supervisor/Planner/Portfolio 保持原接线和行为。基线故障与本次引入问题分开记录，文档与直接相关生成物一致。
