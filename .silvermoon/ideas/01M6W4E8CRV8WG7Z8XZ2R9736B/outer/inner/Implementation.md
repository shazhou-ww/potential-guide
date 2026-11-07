# 实现 Objective 作者工具链与 Probe

本文件是准备阶段的可调整实施初版，不代表已开始实现。
业务契约见 [Idea](ideal/Idea.md)及其三个 supporting documents。

## Steps

### I-S01: 定义并验证新格式

落实 Objective 成品与 Build YAML 的机器 Schema、输入映射、目标阶段及 Reference 验证规则；与历史协议显式区分。

### I-S02: 构建完整 UnixFS 组合

接入已验证的 Check 内容获取与来源解析边界，固化依赖、保留 Check 子树身份并导出完整 Objective CAR。

### I-S03: 装配 Probe 与回归验证

实现阶段推进和有效文档引用装配，接入通用 Engine 的 Check 执行边界，覆盖失败、完成、共享引用及 Override 场景。

## Acceptance criteria

### I-AC01: 格式与语义可验证

正反例测试证明 YAML 字段、路径、阶段、语言与引用规则被明确执行，历史格式不被误认为新格式。

### I-AC02: 成品闭包与身份保持

离线 CAR 遍历和物化测试证明所有 Check 内容均可达，嵌入前后的 Check 根 CID 一致，锁定输入可重复构建。

### I-AC03: Probe 输出符合约定

目标测试证明首个失败阶段及 `terminal` 输出准确，文档 URI 覆盖完整且原始 Check 事实不被修改；提交前通过 `pnpm check`。
