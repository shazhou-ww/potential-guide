# 定义自包含的 CID Objective 与目标阶段 Probe

## 问题

现有 Objective 的交付、Level 与文档语义不足以表达新的内容寻址组合；消费者仍缺少一份精确锁定 Check、可完整物化且直接提供有效文档引用的目标定义。

## 结果

形成与 Check 同构的两阶段构建：Objective 作者准备生成 Task 构建输入，再由通用 Task 编译器产出执行 Probe 的自包含 Bundle。Probe 报告当前待完成目标，并为 Objective、阶段、失败 Check 和 Problems 提供应用 Override 后的文档 URI。

## 边界

- Objective 是执行 Probe 的 Task 特化，复用通用 Task 编译器与 Worker 协议；嵌入 Check 保持独立内容身份。
- `initial` 是首个目标阶段的别名，`terminal` 是真实完成状态；历史不可变制品不自动改变语义。
- 来源解析属于作者工具链；运行时不查询 publication，内容自包含不等于运行环境自包含。

## 验收标准

1. [Objective 结构与成品 YAML](Objective-format.md)明确 Task 声明、业务资源、组合关系与 Level，并按[Check 对齐约定](Check-alignment.md)保持结构和命名一致。
2. [作者 Build YAML](Objective-build.md)明确业务准备与通用编译两阶段、精确依赖固化及与 Check 一致的作者配置规则。
3. [Probe 与 Reference](Probe-references.md)明确失败阶段归属、逐节点文档引用和局部覆盖规则。
