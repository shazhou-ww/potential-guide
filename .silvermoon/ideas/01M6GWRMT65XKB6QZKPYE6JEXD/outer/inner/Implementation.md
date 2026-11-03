# Implementation

准备阶段的轻量种子，尚未实施。范围见[作者流程](ideal/Authoring.md)；
先验证 TypeBox 与 Engine 支持的 JSON Schema 能力及类型语义，再细化内部设计。

## Steps

### I-S01: 定义作者输入与精确成品契约

落实构建描述、TypeBox 类型推导与 JSON Schema 输出、文件映射和精确成品清单，
同步直接相关的 Axis、机器 Schema、装载校验与作者示例。

### I-S02: 接入 pguide 作者命令并分离发布装配

实现 task-bundle 扩展的 check/build/publish，复用 SDK 与 IPFS 底层能力，
保证 clean 构建和只从成品发布；协调设置键与其他 CLI，不接管服务启动。

### I-S03: 验证类型一致性与构建发布边界

执行类型编译、文件集合、失败原子性、CID 可重复性、CLI 发现和独立消费测试，
更新直接使用者，运行相关测试及 `pnpm check`，如有基线问题单独记录。

## Acceptance criteria

### I-AC01: Schema 和类型一致

以编译期正反例及生成 JSON Schema 的运行验证，证明同源定义不漂移；
不支持能力明确拒绝，成品不依赖作者 Schema 模块求值。

### I-AC02: 成品集合可重复且严格

以新增/删除资源、失败重建、额外/缺失文件和内容变化用例证明无残留或静默纳入，
相同确定输入产生同一 CID，发布不改写或重建成品。

### I-AC03: 命令与消费者贯通

通过 pguide 发现及独立 binary 的测试、SDK 回归和真实 Worker 消费验证三个命令边界，
保存相关测试与 `pnpm check` 结果，不通过 npm 发布来替代本地验证。
