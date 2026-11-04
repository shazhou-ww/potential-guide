# 构建并发布类型安全的 Task Bundle

## 问题

当前作者需手写运行声明并编程调用 SDK 构建/导入；文件选择、Schema 与业务类型缺少统一作者流程，
构建入口还混合了 IPFS 连接和发布能力。

## 结果

以 `task.build.yaml`、TypeBox 契约模块及业务回调生成完整 `dist`，
通过 pguide 的独立 `task-bundle` 扩展检查、构建和发布。具体边界见[作者流程](Authoring.md)。

## 边界

1. 构建规则可用通配符，成品声明生成精确文件清单；作者不再维护第二份顶层 `task.yaml`，不提供独立 include 命令。
2. 生成的 JSON Schema 是 Engine/Worker 共同契约，TypeBox 定义与推导类型不引入运行时第二套校验语义。
3. 构建不联网发布，发布只消费成品且不执行任务；服务启动与可选 Web UI 属于同级 task-engine 扩展，不在本 Idea 实施。

## 验收标准

1. 运行声明、Worker、共享 Schema 和精确清单由构建输入一致生成，推导类型与实际校验可对照验证。
2. clean 成品不带旧输出或未选文件；缺失、额外文件和不支持的 Schema 在校验/发布中明确失败。
3. `pguide task-bundle check/build/publish` 可独立发现与使用，发布 CID 与成品一致，不要求启动 Engine 或安装作者依赖。
