# 实现 Probe Task Bundle 与统一作者准备规则

本文件是准备阶段的可调整实施初版，不代表已开始实现。
业务契约见 [Idea](ideal/Idea.md)及其 supporting documents。

## Steps

### I-S01: 验证组合与子调用边界

按[准备度评估](ideal/Check-alignment.md#实施准备度)先用精确 Check CID 验证：
同一个通用 buildTask 保持子根身份、完整闭包及父子清单；
标准 Engine 启动 Probe 并经明确业务装配调用独立 Check，传播取消和错误。
不能用直接 require 子 Worker 或另建编译器替代证明；不满足时先修订方案。

### I-S02: 实现两阶段准备与资源推导

实现 prepareProbe、生成的 Objective 业务资源/契约和通用编译接线。
同步简化 Check 作者格式：移除逐页 references，统一必需页推导、受限 Override 发现、
附加资源选择与源快照；迁移相关作者 Schema、例子和文档，不改历史制品。
完成 publication 解析、锁定与精确 CID 路径，在接受输出前验证全部资源和子树身份。

### I-S03: 装配 Probe 与回归验证

在 Probe Task Worker 内实现阶段推进与有效文档装配，明确子 Check 的独立调用、
取消和错误传播边界，覆盖失败、完成、共享引用及 Override 场景。

## Acceptance criteria

### I-AC01: 格式与语义可验证

配对的 Check/Probe 作者测试证明两者不写 references 仍能生成精确资源索引，
缺必需页、未知 ref/code、无效 Override 和资源越界均失败；无可选 Override 时正确继承。
两者先准备、再使用同一 buildTask，输入/结果 Schema 同源，历史制品语义不变。

### I-AC02: 成品闭包与身份保持

离线 CAR 遍历和物化测试证明所有 Check 内容均可达，嵌入前后的 Check 根 CID 一致；
父子 include/binary 与实际内容一致，锁定的作者、依赖和工具链输入可重复构建。

### I-AC03: Probe 输出符合约定

端到端测试证明标准 Engine 能执行 Probe 并独立调用子 Check；首个失败阶段、
`terminal`、文档 URI、取消和错误传播准确，原始 Check 事实不被修改。
恢复可用验证环境后通过 `pnpm check`，不以环境阻断替代通过证据。
