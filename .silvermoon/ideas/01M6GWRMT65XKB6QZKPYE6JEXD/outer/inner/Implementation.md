# Implementation

本候选按[当前作者流程](ideal/Authoring.md)刷新为离线 init/check/build 与 CAR。
[实施验证](Verification.md)和[设备切换交接](Handoff.md)保留历史命令与证据，
其中内置 publish/Kubo 流程不再是当前要求。既有实现复用，但 ledger 针对变更后的
要求重新保持未完成，不由历史接受推导本候选已接受；不发布 npm、不接管外部服务。

## Steps

### I-S01: 定义作者输入与精确成品契约

复核构建描述、TypeBox 类型/离线 Schema、显式 SDK 入口、最终路径映射与精确
include/binary 清单；对齐 UTF-8/LF 及原字节规则、Axis、机器 Schema 和作者示例。

### I-S02: 对齐离线作者命令与 CAR 成品

复核 pguide 发现与独立 executable 的 init/check/build，构建目录和 CAR 使用同一
已验证快照；不恢复 publish/上传/pin/RPC，SDK 仅保留运行时。复用当前实现而非
重建旧作者工具，错误输入不改写未知文件或污染旧输出。

### I-S03: 验证类型一致性与离线消费边界

执行类型编译、精确文件集合、失败原子性、CID 可重复性、显式/委托入口、
LF/binary、同根 CAR 重排和独立消费测试；运行相关检查及 pnpm check，
记录准确候选和基线问题，不复用旧发布证明代替当前验证。

## Acceptance criteria

### I-AC01: Schema 和类型一致

以编译期正反例及生成 JSON Schema 的运行验证，证明同源定义不漂移；
不支持能力明确拒绝，成品不依赖作者 Schema 模块求值。

### I-AC02: 成品集合可重复且严格

以新增/删除资源、失败重建、额外/缺失文件和内容变化用例证明无残留或静默纳入，
相同确定输入产生同一 CID，目录/CAR 字节一致；读取不改写成品，同根 CAR 重排合法，
明确期望 CID 不符时拒绝，缺 binary 或非法文本必须重建而非兼容回退。

### I-AC03: 命令与消费者贯通

通过 pguide 发现及独立 binary 的测试证明 init/check/build 可用、publish 不再提供；
仓库外真实 Engine 消费同一 CAR，保存 SDK 回归及 pnpm check 结果，
不通过上传、pin 或 npm 发布替代离线工具验证。
