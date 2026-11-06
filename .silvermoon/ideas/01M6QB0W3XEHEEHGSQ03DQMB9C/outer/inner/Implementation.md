# Implementation

## Steps

### I-S01: 明确接口与实施边界

依据[修改建议副本](./ideal/Recommendation.md)和 Idea 边界核对现有实现、数据形状及兼容性，不扩大至外部产品。

### I-S02: 落实改动与针对性回归

复用 verify-deployment、执行帮助器和服务消费者，以 UTF-8 配置文件替代多层 Shell 参数，按安装、就绪、执行、Reference、清理分阶段记录。

## Acceptance criteria

### I-AC01: 改动满足本地契约

实现、文档和公开入口与本子 IDEA 的范围一致；未验证的根因和来源不被表示为已确认。

### I-AC02: 回归保持既有保护

覆盖中文和空格路径、非交互 PATH、错误导入、报告落盘失败、取消与清理超时，确保工具自身也受 lint/typecheck 和运行测试约束。 适用的仓库检查通过，未降低既有约束。
