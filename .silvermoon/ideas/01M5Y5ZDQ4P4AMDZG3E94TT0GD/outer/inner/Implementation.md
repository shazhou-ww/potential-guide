# 实现统一请求与周期后继

语义依据为已接受的[构想及配套原则](./ideal/Idea.md)。实现边界、兼容选择及验证证据见[实施说明](./Recurrence-implementation.md)；本阶段不开展独立外部部署验收。

## Steps

### I-S01: 调整请求事实与生命周期

扩展 RequestModel 的 eligibleAt、recurrence、recurrence origin 及 replacesRequestRef；让 run-start 原子包含唯一后继，新增可重放的 request-cancel。未带 eligibleAt 的旧记录保留既有 admission 语义，不补造历史时间。

### I-S02: 接入可恢复调度与统一事件

接入到期唤醒、实际派发时间、恢复、同 Target 仲裁、continuedFromRunId 及周期停止；通过已有 run-end 事实及稳定 Host 游标暴露结构化耗尽，不新增结果驱动的自动续跑。

### I-S03: 更新关联视图与验证

更新公共类型、Host / Request 视图、包文档、包出口消费者和受控时钟测试。旧 legacy API 与纯 helper 依赖保留，不删除仍有消费者的 Supervisor 包，不实现上层 Agent、MCP server 或跨 Host 一致性。

## Acceptance criteria

### I-AC01: 不可变派发与恢复成立

通过受控时钟、reducer / restore 和崩溃窗口测试，证明请求不可变、初始派发唯一、后继唯一、到期可恢复，长 Run 与离线不产生重叠或积累补跑。

### I-AC02: 事件与共存边界成立

通过集成测试证明一次性及周期请求耗尽均可重读、不自动续跑；额外请求与周期链共存、Target 互斥、显式停止有效，依赖续接不重复生成后继或刷新额度。

### I-AC03: 公共接口与仓库行为一致

通过类型消费者及相关视图测试、文档示例和 pnpm check 证明公共行为与约定一致，既有一次性能力及明确保留的兼容入口未被意外改变。
