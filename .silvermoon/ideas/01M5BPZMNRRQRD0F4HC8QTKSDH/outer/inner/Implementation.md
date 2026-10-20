# 实施默认本地证据留存

## Steps

### I-S01: 统一运行与报告配置

审查现有入口与路径语义，实现 Run、独立尝试 CheckRun 及版本化 JSONL。默认启用 `reports`，目录优先级为 `--report-dir`、`reports.directory`、`stateRoot/reports`；保留配置合并、禁用与原 `--report` 行为。

### I-S02: 接入业务证据与安全边界

runtime 与 check 分别单写根流和业务流，通过环境传递明确上下文；保留运行元数据、probe observation、原始 check envelope 与相对路径 artifacts。接入相关 monorepo、machine health、setup/self-check 及生成、打包入口的实际检查和断言事实，明确错误、截断与清理行为。

### I-S03: 完善兼容测试与文档

补充路径优先级、隔离、重试、业务失败、异常、中断、敏感信息及 artifact 越界测试，更新直接相关使用文档并运行针对性测试与 `pnpm check`。

## Acceptance criteria

### I-AC01: 报告结构可关联且可复核

测试证明每次运行独立、每次调用或重试具有身份和 attempt，JSONL 包含 schemaVersion、时间、文件内递增 seq、event、data 及关联 ID；检查事实、断言与 artifact 引用可与原始结果关联。

### I-AC02: 协议与安全边界保持

测试证明 stdout envelope 和旧导出兼容，业务不通过与执行失败区分，中断不推断成功，写入失败与截断显式呈现，artifact 不越出 check 目录且不自动保存完整敏感输入。

### I-AC03: 相关入口与质量检查通过

针对性测试覆盖内置、生成和打包表面，`pnpm check` 通过；直接相关文档说明默认路径、覆盖与禁用方式及证据语义。
