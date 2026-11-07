# 实现 Objective 作者工具链与 Probe

本文件是准备阶段的可调整实施初版，不代表已开始实现。
业务契约见 [Idea](ideal/Idea.md)及其 supporting documents。

## Steps

### I-S01: 定义并验证新格式

落实 Objective 作者 YAML、业务资源和 Probe 输入/结果契约；按
[Check 对齐约定](ideal/Check-alignment.md)复用 Task 声明、作者路径、资源和文档机制，
与历史协议显式区分，不建立独立 Objective Bundle 编译器。

### I-S02: 构建完整 UnixFS 组合

实现业务准备生成 task.build.yaml，再由通用 Task 编译器构建。
来源解析和 Check 固化在准备阶段完成；验证最终 CAR 资源、父子清单与子树 CID 后才接受输出。

### I-S03: 装配 Probe 与回归验证

在 Objective Task Worker 内实现 Probe 的阶段推进与有效文档装配，明确子 Check 的独立调用、
取消和错误传播边界，覆盖失败、完成、共享引用及 Override 场景。

## Acceptance criteria

### I-AC01: 格式与语义可验证

配对的 Check/Objective 作者测试证明两者均先准备、再使用同一 buildTask 编译入口；
生成 task.yaml 的输入/结果 Schema 与业务定义一致，路径、资源和文档约束一致，
历史 Objective 格式不被误认为新格式。

### I-AC02: 成品闭包与身份保持

离线 CAR 遍历和物化测试证明所有 Check 内容均可达，嵌入前后的 Check 根 CID 一致；
父子 include/binary 与实际内容一致，锁定的作者、依赖和工具链输入可重复构建。

### I-AC03: Probe 输出符合约定

目标测试证明首个失败阶段及 `terminal` 输出准确，文档 URI 覆盖完整且原始 Check 事实不被修改；提交前通过 `pnpm check`。
