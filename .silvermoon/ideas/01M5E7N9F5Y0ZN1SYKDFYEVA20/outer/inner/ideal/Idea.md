# 以双意图 Behavior 驱动 Regulation Coordinator

## 问题

已交付的 Coordinator 使用五类命令、复杂资源池和 harness 授权模型，混淆了意图、实际执行及可恢复状态。

## 结果

Coordinator 将治理目标意图与资源分配意图两个 Behavior 转换为执行状态 Behavior。Command/Event 分别由纯 reducer 归约，资源意图全量更新；支持目标与状态持久化恢复，副作用通过 monadic composition 组织，不称为 monadic lift。原则见 [Design.md](./Design.md)，事件候选见 [Events.md](./Events.md)。

## 边界

- 先完成 [level-attainment](../../../../01M5EFD1DW5J6MBE9BKCRFW5W3/outer/inner/ideal/Idea.md) 的协议语义，再接入统一 initial；本 idea 不重复修改层级协议。
- 保留资源意图第一参数、单队列与单次尝试；pending 属调度，block 属调用终态，不增加长期目标控制器，不重接既有服务。
- 当前账号委托范围内由实际资源实施授权，harness 不另设 grants/ceiling；预算仍独立受控，恢复不重复执行副作用、不重置预算。不发布 npm，不改设备配置。

## 验收标准

- 单一目标命令保留意图发生身份；initial 不执行业务检查、不回滚。资源 binding/并发度全量更新表达期望，不伪报实际占用。
- 两个纯 reducer 可重建约定状态；目标及执行状态可一致恢复，已终结意图不被重跑，失联调用核实前不虚报终止或释放占用。
- pending、依赖、真实终止、资源拒绝及累计预算均有新验证；event 类型仍待推导，旧证据不冒充新验收。

## 下一步

依据已确定原则继续讨论 events 的公开状态及原子 delta 边界；事件契约收敛后再提交整份构想验收。
