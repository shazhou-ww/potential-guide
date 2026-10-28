# Implementation

## Steps

### I-S01: 明确组合与 References 契约

使用独立且不可变的 `objective-artifact/v1.json` schema；`objective.json` 与显式 References 组成制品。稳定身份为 `objective:<id>`，准确摘要为 `sha256-pguide-objective-v1`，覆盖 manifest（含内联 Check/Objective 依赖摘要）和全部声明文件。每个局部 Check 引用直接持有来源、准确逻辑摘要及 bounded JSONata subject 映射；HTTPS Check 另声明现有传输摘要。没有 lock、npm 身份、范围求解、Objective JavaScript 入口或隐式更新。

References 使用整页替换，不作字段合并或 Markdown 拼接。按请求语言、Objective 默认语言、可用的 Check 原文回退；覆盖可精确到局部 Check 引用/problem/level occurrence。`pages/base-*` 保留明确可链接的基础原文；`pages/*` 为显式场景附加页。所有有效语言检查悬空/循环及未知 problem，页面携带原所属制品的 `origin` 和资源 `resourceBase`。完整规则、限制和迁移边界见[公开契约](../../../../../docs/objective-artifacts.md)。

### I-S02: 打通业务消费链路

`cli-runtime` 导出 `inspectObjectiveArtifact`、`objectiveArtifactLocation`、`withObjectiveArtifact`，并将新来源接入既有 `withPilot`。公开 CLI 支持 `validate artifact`、目录加准确 `--revision`、`artifact+file:` 准确地址及 `objectives.yaml` 声明。准备过程复用 Check 制品获取/缓存/校验以及 Host 的通用有界 no-follow 读取与私有文件能力；Host 不理解 Objective 或下载渠道。

将业务字段投影到未修改的 v3 Pilot 累计等级契约，保留 initial、terminal、依赖观察及 Pilot 不调用 Agent 的边界。Objective 业务依赖仅能从 manifest 的固定来源闭包选择。新 regulation 持久化使用 v6，Coordinator artifact Request projection 使用 v2，并保留明确 `artifactDigest` 字段；旧 Git/npm 记录仍走原路径，不把 commit/packageDigest 改释为制品摘要。

### I-S03: 验证组合与恢复

交付可执行的真实组合示例：两个独立 Check、同一 Check 的两个局部引用、两个业务等级及一个固定 Objective 依赖。测试走公开 API/声明/CLI/指导/regulate/continue，并实际调度和恢复 Coordinator store。恢复重新验证原 Objective、Check 内容及实际 Host revision/依赖闭包；缺失、篡改或闭包冲突明确失败，不解析 latest/range。

直接相关文档和[主体执行证据](./execution-evidence.md)覆盖契约、运行命令、发现并修复的兼容问题及限制。Deployment seed 保持不变；仓库内测试不宣称独立消费者部署或正式 Release。

## Acceptance criteria

### I-AC01: 声明即准确依赖

新 schema、协议证据测试和组合测试证明来源、准确逻辑/传输摘要及局部引用足以准备固定闭包，无 lock/范围求解；同身份异内容、错误 Check 字节和漂移 Host revision 明确失败。历史 schema 字节未改写。

### I-AC02: 组合与指导一致

公开消费测试证明映射不同输入、initial/累计等级/terminal、真实依赖观察及完整问题作用域；覆盖同 Check 两次引用、未覆盖继承、整页局部覆盖、中文局部条目/默认语言回退、显式基础页/附加页和资源所属制品；未知 problem、悬空/循环引用拒绝。

### I-AC03: 准确恢复且保留旧证据

端到端测试在原始来源删除后通过 continue 恢复原制品，并实际执行 Coordinator 调度、持久化和重放；证据保留真实 Check 逻辑摘要、Host revision 和依赖闭包。篡改/缺失 fail closed；旧 npm/Git 回归测试保持原证据语义。最小相关测试及项目要求的 `pnpm check` 结果见执行证据。
