# 以双意图 Behavior 驱动 Regulation Coordinator

## 问题

已交付的 Coordinator 使用五类命令、复杂资源池和 harness 授权模型，混淆了意图、实际执行及可恢复状态。

## 结果

Coordinator 将治理请求与资源分配意图两个 Behavior 转换为执行状态 Behavior。ObjectiveRevision 在 subject 上具体化为 RegulationTarget，RegulationRequest 表达对该 target 的 desiredLevel 与 priority 请求，实际执行仍为 RegulationRun。Command/Event 分别由纯 reducer 归约，资源意图全量更新；支持请求与状态持久化恢复，副作用通过 monadic composition 组织。原则见 [Design.md](./Design.md)，先参考 [Types.md](./Types.md) 讨论 state，再推导 Command/Event。

## 边界

- 先完成 [level-attainment](../../../../01M5EFD1DW5J6MBE9BKCRFW5W3/outer/inner/ideal/Idea.md) 的协议语义，再接入统一 initial；本 idea 不重复修改层级协议。
- 保留资源意图第一参数、单队列与单次尝试；pending 属调度，block 属调用终态，不增加长期目标控制器，不重接既有服务。
- 当前账号委托范围内由实际资源实施授权，harness 不另设 grants/ceiling；预算仍独立受控，恢复不重复执行副作用、不重置预算。不发布 npm，不改设备配置。

## 验收标准

- 单一请求命令保留递增 requestSeq 身份，每次运行必须归属一条不可变请求并由其推导对象与目标；依赖派生也先形成请求再执行。initial 不执行业务检查、不回滚；资源 binding/并发度全量更新表达期望，不伪报实际占用。
- 两个纯 reducer 可重建约定状态；目标及执行状态可一致恢复，已终结意图不被重跑，失联调用核实前不虚报终止或释放占用。
- pending、依赖、真实终止、资源拒绝及累计预算均有新验证；event 类型仍待推导，旧证据不冒充新验收。

## 下一步

先讨论 Types.md 的核心 state 与合法转换，再推导 Command/Event；类型及增量契约收敛后提交整份构想验收。
