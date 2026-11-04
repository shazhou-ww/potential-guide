# Implementation

默认 `pnpm check` 保留源码漂移、构建/分层、格式、lint、生产与测试类型、测试和 tarball 结构检查；完整隔离消费者独立为 `pnpm consumers:check`，也完整保留在跨平台 `deployment:verify` 中。CI 的完整消费者由五轮收敛为 Linux/macOS/Windows 三轮，保留 macOS file fail-closed 等平台独有断言；Node 22/24 矩阵继续执行默认检查。完整交付入口为 `pnpm check && pnpm deployment:verify`，不包含发布。

Objective 的 `.staging/<package>` 纳入各自 Turbo build outputs；测试入口以快照保护已检入的 settings/task Worker 源码，在构建提供校验所需依赖后检测漂移，并无条件恢复原始源码，避免构建静默修复漂移；保留所有生成运行时和 schema 校验。修复 self-check bundler 对调用目录的隐式依赖，确保从 workspace 构建和根目录校验产生相同字节。不调整测试并发。

Linux Node 22 的逐阶段诊断证明异常等待发生在 `/slow` acquisition 内部，而不是 backend 关闭后；仅调整服务端清理或子进程退出不足以修复。preparation 改为显式拥有 deadline controller/timer，并在完整操作结束时清理；对独立/组合 caller signal 的慢响应体各验证 150ms 预算在 5 秒内失败，保留空缓存断言及所有原有 digest、重定向、大小、篡改、离线复用覆盖。测试上下文取消同时终止其子进程，避免失败测试再等待 HTTP 默认超时。

性能测量使用独立 workflow，对精确提交在同类 Ubuntu runner、同版本 Node/pnpm 下运行完整成功的冷、热 `pnpm check`。冷缓存仅指无构建/Turbo 产物，不含依赖安装；热缓存在同一 checkout 紧接冷运行。历史运行和本地权限失败仅作诊断，不作为收益证据。完整结果、覆盖映射和复现命令在本阶段辅助证据中记录。

## Steps

### I-S01: 建立检查职责与性能基线

梳理根脚本、Turbo 依赖图、生成产物和 CI 重复执行关系，建立同环境完整成功的冷、热缓存基线；明确测量口径与改善目标。

### I-S02: 收敛重复执行与异常等待

分离结构与隔离消费者入口并迁移 CI；补齐 Objective staging 缓存输出和生成器输入后，移除测试入口的无条件 workers 重建，但保留独立生成一致性校验；为 HTTPS 服务端清理增加有界回归。

### I-S03: 验证覆盖并更新开发入口

验证缓存命中与未命中的执行路径、独立脚本和完整流程，保留失败传播；同步脚本、CI 与直接相关开发文档，说明默认检查和完整交付验证的使用方式。

## Acceptance criteria

### I-AC01: 性能对照可复现

记录提交、环境、缓存条件、执行命令、各阶段耗时和退出码；用完整成功的对照运行证明达到细化后的改善目标，不混用本地与 CI 数据。

### I-AC02: 检查覆盖不退化

提供每项删除、合并或迁移检查的职责映射与验证结果，证明包内容、生成源码一致性、依赖隔离、测试类型和跨平台 CLI 契约仍被覆盖。

### I-AC03: 构建缓存与错误传播可靠

冷、热缓存及独立入口均完成所需前置生成；失效产物、契约失败和消费者失败仍返回失败。通过相关回归测试和完整 `pnpm check` 证明。
