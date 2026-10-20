# Implementation

本契约为准备阶段轻量种子；目标引用、schema 标识与入口采用前置子构想的统一决定，不重复实现迁移基础设施。

## Steps

### I-S01: 规范声明输入边界

区分外部可选 inputSchema 与归一化的有效 schema，保留标准 JSON Schema 语义、Unit 缺省规则和目标 subject 校验。

### I-S02: 贯通 context 与受限路径函数

更新工具侧 context 构造及绑定快照；在受限 AST 校验与求值器中显式加入路径函数，不绕过现有资源边界。

### I-S03: 同步作者样例和迁移验证

更新声明、模板、文档及消费场景；旧 context 的表达式仅在能够明确转换时迁移，复杂表达式不作静默文本替换。

## Acceptance criteria

### I-AC01: 输入语义精确

用缺省、显式 Unit、空 schema、非空对象及 null 等用例证明输入归一化符合约定，并通过目标 schema 拒绝非法投影结果。

### I-AC02: context 和路径可移植

测试 Git 根目录/子目录、无 origin、非 Git 及 Windows/POSIX 组合，证明普通 join 与错误路径规则一致。

### I-AC03: 投影边界未扩大

反例覆盖未授权函数、非法参数、缺失路径、超时或输出限制；集成测试和仓库相关检查证明旧格式拒绝及迁移行为可用。
