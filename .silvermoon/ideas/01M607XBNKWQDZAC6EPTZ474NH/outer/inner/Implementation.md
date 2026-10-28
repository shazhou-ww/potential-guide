# Implementation

## Steps

### I-S01: 明确组合与 References 契约

基于 Check 制品定义 Objective 身份、内联准确引用、subject 映射和 References 分层规则；明确与既有 schema 及证据的迁移边界。

### I-S02: 打通业务消费链路

接入协议、Pilot、CLI、声明、regulation 及相关持久化和调度入口；复用 Check 准备能力，不让业务层重新实现下载或 Host 执行。

### I-S03: 验证组合与恢复

以真实多 Check Objective 测试等级、依赖、References 和历史恢复；更新直接相关 API 与使用文档。

## Acceptance criteria

### I-AC01: 声明即准确依赖

测试证明 manifest 的来源和 digest 足以准备依赖，无独立 lock 或范围求解；同名异内容不会被静默替换。

### I-AC02: 组合与指导一致

测试验证 subject 映射、累计等级及依赖观察，覆盖 Reference 继承、精确覆盖、补充、语言及悬空引用。

### I-AC03: 准确恢复且保留旧证据

相关端到端测试验证从持久化记录恢复原制品；错误内容明确失败，旧记录不被重新解释为新身份或新摘要。
