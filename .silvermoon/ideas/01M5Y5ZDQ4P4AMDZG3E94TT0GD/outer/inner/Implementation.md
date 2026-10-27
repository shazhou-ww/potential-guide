# 实现统一请求与周期后继

语义依据为[构想及配套原则](./ideal/Idea.md)。周期请求的既有实现证据见[实施说明](./Recurrence-implementation.md)，仅证明追加退役要求之前的范围；新增退役范围等待修订构想验收后实施。本阶段不开展独立外部部署验收。

## Steps

### I-S01: 调整请求事实与生命周期

扩展 RequestModel 的 eligibleAt、recurrence、recurrence origin 及 replacesRequestRef；让 run-start 原子包含唯一后继，新增可重放的 request-cancel。未带 eligibleAt 的旧记录保留既有 admission 语义，不补造历史时间。

### I-S02: 接入可恢复调度与统一事件

接入到期唤醒、实际派发时间、恢复、同 Target 仲裁、continuedFromRunId 及周期停止；通过已有 run-end 事实及稳定 Host 游标暴露结构化耗尽，不新增结果驱动的自动续跑。

### I-S03: 更新关联视图与验证

更新公共类型、Host / Request 视图、包文档、包出口消费者和受控时钟测试。新增范围迁出 Supervisor 中必要的 helper / 类型后删除 objective-portfolio-supervisor、pguide-supervise 两包；处理 CLI 发现、settings、依赖、lockfile、项目引用、发布清单、workflow 及当前文档。保留 Coordinator legacy API，不实现替代 Planner、MCP server 或跨 Host 一致性。

## Acceptance criteria

### I-AC01: 不可变派发与恢复成立

通过受控时钟、reducer / restore 和崩溃窗口测试，证明请求不可变、初始派发唯一、后继唯一、到期可恢复，长 Run 与离线不产生重叠或积累补跑。

### I-AC02: 事件与共存边界成立

通过集成测试证明一次性及周期请求耗尽均可重读、不自动续跑；额外请求与周期链共存、Target 互斥、显式停止有效，依赖续接不重复生成后继或刷新额度。

### I-AC03: 公共接口与仓库行为一致

通过类型消费者、视图及相关 CLI 测试、活跃依赖和发布面检查、文档示例和 pnpm check，证明两包及旧 supervise 入口已退役，Coordinator 无旧包依赖且历史键与回放兼容，保留的 Pilot / Regulator / Coordinator 能力未被意外改变。旧证据不作为退役完成证明。
