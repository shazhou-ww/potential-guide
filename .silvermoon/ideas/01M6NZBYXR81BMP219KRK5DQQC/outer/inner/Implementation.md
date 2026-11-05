# Implementation

## Steps

### I-S01: 核对标准脚手架与迁移边界

实际调用 `task-bundle init` 检查最新模板，对照环境检查的构建、契约、库消费者与回归测试，核对 [分包结构草案](./Package-structure.md) 中的三个独立 Bundle 作者布局、共享包公共 API 和依赖方向。参考 [作者流程](../../../../../packages/pguide-task-bundle/README.md) 和 [环境检查](../../../../../packages/check-environment/README.md)。

### I-S02: 提取共享 Check 包并迁移环境检查

提取独立可复用包 `@potential-guide/check-sdk`，统一结果类型与 Schema、结果组装及传给 `runTask` 的回调工厂，并维护公共 Reference。第一阶段由 `check-sdk/authoring` 从 Check Build YAML 检查声明语言下的定义文件和全部问题文件的名称、路径、存在性与 Reference frontmatter，保留必填 title、description 和可选 references 的元数据约束，不解析章节、正文或正文链接，生成标准 Task Build YAML、契约与已验证资源；第二阶段调用标准 Task 构建器产出 CAR。所有生成文件与最终产物均在包内 `dist/`，最终索引只记录已接受的制品。环境检查复用最新脚手架的显式入口和类型化契约；保留现有库导出与交付引用需求，同步直接相关文档、包分层和测试。

### I-S03: 验证兼容性与新检查复用

验证业务结果、故障、取消与清理边界，并以不同于环境检查的最小作者示例证明新检查可复用公共契约和回调。共享包不得将执行故障或取消转为普通问题；日志仍走 Task Context，具体资源由业务实现清理。

## Acceptance criteria

### I-AC01: 标准作者流程交付三个 Bundle

验证两阶段构建交付三个 CAR，生成的 Task YAML、源码闭包、资源和 CAR 均位于 `dist/`；第二阶段仅消费第一阶段固定的业务输入。验证各自 CID 与目录树一致、实际资源与第一阶段验证的集合和字节一致，不混入其他检查文档。以缺语言定义文件、缺问题文件、命名不匹配、未知语言或问题码、缺失或非法 frontmatter、错误元数据和 CAR 漏选的负例证明失败；完整单语言、多语言及零问题码声明通过。合法 frontmatter 下的空正文、任意章节和正文链接不作为自动文档门禁，不重复实现通用 Bundle 编译器，失败不覆盖有效制品。

### I-AC02: 检查与库消费者行为兼容

用环境检查库测试、Engine 集成测试和相关消费者检查证明原结果格式、超时失败、取消及物理资源回收未退化；提交前运行 `pnpm check`。

### I-AC03: 独立共享包可被新检查复用

环境检查与最小新检查均从独立共享包引用契约和回调适配，不复制结果 Schema 或组装逻辑。构建通过 `check-sdk/authoring` 复用文档校验器，不另拆工具包；验证根入口不加载作者侧校验与 Schema 构建代码，最终 Worker 不携带作者校验依赖。以类型检查、共享包单测和标准脚手架构建执行测试证明；共享包不依赖具体检查包，通用 Task SDK 不引入 Check 业务规则。
