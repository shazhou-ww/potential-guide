# Implementation

本契约为准备阶段的轻量实施初版；本轮只修订 axis，不执行后续运行时代码步骤。
实施依据[Task Bundle 契约](../../../../../docs/axis/task-engine-contracts/task-bundle.md)，
仅覆盖新 Task Engine 的 Bundle 链路。

## Steps

### I-S01: 对齐新架构契约与影响范围

维护 axis 及[影响范围](./ideal/Axis.md)，落实 IPFS 身份、目录交付、完整准入与保留边界。

### I-S02: 实现标准 IPFS 交付与装载

复用标准 IPFS 实现，固定可复现的目录导入参数；打通 SDK 目录交付、可验证获取、
本地物化及活动内容保护，移除新架构 URL/Digest 与 tgz 依赖。

### I-S03: 统一新架构身份与消费链路

对齐 Request、preparation、缓存、Run 匹配、持久记录与消费端的 CID 引用；
支持根 CID 字符串与 `{cid, hint}` 的单个或多个候选 gateway 提示，
新增针对性测试，保持原始意图、生命周期及业务制品边界。

## Acceptance criteria

### I-AC01: 架构契约一致

通过范围内文档审阅与引用检查，证明寻址和交付已统一为 IPFS，保留的内容契约及排除项无冲突。

### I-AC02: 获取与执行可验证

通过集成测试证明相同导入参数产生相同 CID、单文件可验证读取、完整 Bundle 可物化执行；
错误 CID、缺块、非法文件或容量超限明确失败，不绕过完整准入。

### I-AC03: 身份与行为连续一致

通过新架构链路测试证明同 CID 的内容复用、不同 CID 的匹配隔离、重启恢复与历史读取正确；
覆盖三种引用形状、hint 不参与内容身份、hint 改变仍触发原始意图冲突，
以及宿主访问策略和 CID 验证不被 hint 绕过；
新入口明确拒绝旧引用，相关检查通过且未改变既有业务制品格式。
