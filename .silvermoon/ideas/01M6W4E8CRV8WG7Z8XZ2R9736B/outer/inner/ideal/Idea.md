# 定义自包含的 CID Objective 与目标阶段 Probe

## 问题

现有 Objective 的交付、Level 与文档语义不足以表达新的内容寻址组合；消费者仍缺少一份精确锁定 Check、可完整物化且直接提供有效文档引用的目标定义。

## 结果

形成自包含 UnixFS Objective Bundle，由作者 Build YAML 选择 Check 来源并在构建时固化。Probe 报告当前待完成的目标阶段，并为 Objective、当前阶段、失败 Check 和 Problems 提供应用 Override 后的完整文档 URI。

## 边界

- Check Bundle 原样嵌入，保持独立内容身份；Objective 不包含自己的执行 Worker。
- `initial` 是首个目标阶段的别名，`terminal` 是真实完成状态；历史不可变制品不自动改变语义。
- 来源解析属于作者工具链；运行时不查询 publication，内容自包含不等于运行环境自包含。

## 验收标准

1. [Objective 结构与成品 YAML](Objective-format.md)明确文件布局、组合关系、Level 和完整性边界。
2. [作者 Build YAML](Objective-build.md)明确来源选择、精确版本固化与自包含构建结果。
3. [Probe 与 Reference](Probe-references.md)明确失败阶段归属、逐节点文档引用和局部覆盖规则。
