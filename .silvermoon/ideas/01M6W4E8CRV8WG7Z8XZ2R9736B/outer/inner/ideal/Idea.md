# 定义自包含的 Probe Task Bundle 与目标阶段

## 问题

现有 Objective 的交付、Level 与文档语义不足以表达新的内容寻址组合；消费者仍缺少一份精确锁定 Check、可完整物化且直接提供有效文档引用的目标定义。

## 结果

形成与 Check Task Bundle 同构的两阶段构建：业务准备从声明和目录约定推导资源，再由通用 Task 编译器产出 Probe Task Bundle。Probe 报告当前待完成目标及有效文档 URI。

## 边界

- Objective 是目标定义，Probe 是动作，制品统一称 Probe Task Bundle；复用通用编译器与协议，嵌入 Check 保持身份。
- `initial` 是首个目标阶段的别名，`terminal` 是真实完成状态；历史不可变制品不自动改变语义。
- 来源解析属于作者工具链；运行时不查询 publication，内容自包含不等于运行环境自包含。

## 验收标准

1. [制品结构与 Objective 描述](Objective-format.md)明确 Task 声明、业务资源、组合关系与 Level，并按[Check 对齐约定](Check-alignment.md)保持结构和命名一致。
2. [作者 Build YAML](Objective-build.md)明确两阶段、精确依赖固化与 Check/Probe 共用的文档推导规则，不让作者重复维护可推导清单。
3. [Probe 与 Reference](Probe-references.md)明确失败阶段归属、逐节点文档引用和局部覆盖规则。
