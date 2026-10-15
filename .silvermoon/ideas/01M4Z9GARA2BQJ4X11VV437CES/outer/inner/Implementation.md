# Implementation

## Steps

### I-S01: 定义可扩展命令契约

定义顶层命令与包级可执行文件的命名、发现、参数转发、取消、退出码、结构化输出及可信来源规则，并通过冲突调查决定 canonical 名称与可选短别名。

### I-S02: 实现顶层 CLI 与包级命令

建立独立 CLI workspace 和共享命令协议，让顶层入口可发现并调用包拥有的子命令，同时让各包命令保持可直接执行、独立测试和独立发布。

### I-S03: 接入 Objective Regulator Agent 执行器

提供 regulation 子命令和可替换 Agent adapter，将每轮 ObjectiveActionRequest 交给 Agent 执行一次动作，再由 Regulator 重新 probe，而不把自主循环或具体 Agent SDK 耦合进核心包。

## Acceptance criteria

### I-AC01: 扩展命令分派稳定

顶层 CLI 以确定性优先级解析内置与外部子命令，完整转发参数、信号和退出状态；通过单元及集成测试证明未知命令、冲突和不可信来源均显式失败。

### I-AC02: 包级 CLI 保持独立

每个纳入范围的软件包提供可直接运行的命令入口并遵循共享协议；通过直接调用和顶层分派两种测试证明结果与错误语义一致。

### I-AC03: Regulation 由 Agent 有界驱动

Objective Regulator CLI 能加载 Guide、subject 与目标 level，通过测试 adapter 完成一次多轮 regulation，并由测试证明每轮只执行一个 problem、re-probe 决定进展且 limits 生效。
