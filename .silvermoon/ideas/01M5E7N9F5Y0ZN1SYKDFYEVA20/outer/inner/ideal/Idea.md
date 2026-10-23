# 以双意图 Behavior 驱动 Regulation Coordinator

## 问题

已交付的 Coordinator 使用五类命令、复杂资源池和 harness 授权模型，混淆了意图、实际执行及可恢复状态。

## 结果

Coordinator 将治理请求与资源分配意图两个 Behavior 转换为完整状态 Behavior，保留纯归约与副作用分离。以统一业务 ER 和 Objective/Host 双主视角表达治理对象、要求与实际执行；关键不动点及各层观察需求统一见 [简化设计](./Design.md)。

## 边界

- 先完成 [level-attainment](../../../../01M5EFD1DW5J6MBE9BKCRFW5W3/outer/inner/ideal/Idea.md) 的协议语义，再接入统一 initial；本 idea 不重复修改层级协议。
- 保留资源意图第一参数、单队列与单次尝试；pending 属调度，block 属调用终态，不增加长期目标控制器，不重接既有服务。
- 当前账号委托范围内由实际资源实施授权，harness 不另设 grants/ceiling；预算仍独立受控，恢复不重复执行副作用、不重置预算。不发布 npm，不改设备配置。

## 验收标准

- 统一 ER 区分 Objective、Revision、Target、Request 与 Run；每个 Run 关联准确 Request 与执行 Host，同一 Request 可以跨 Host 执行，不随最新版本改写旧事实。
- 观察层级为 Objective → Target → Request → Run 与 Host → Run；已讨论需求及候选补充均有清楚边界，不以查询实现或局部 Run 结果代替共享请求结论。
- 资源第一参数的双 Behavior 输入、完整状态输出与两个纯 reducer 成立；回放不重做副作用，恢复及终止核实不伪报成功，旧交付证据不冒充本次验证。

## 下一步

先复核 [简化设计](./Design.md) 中 Target、Request、Run 的候选观察需求，再推导必要状态转换与 Command/Event；旧辅助文档移入参考目录，不将本次整理视为整份构想验收。
