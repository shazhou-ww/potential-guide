# Deployment

## Steps

### D-S01: 验证打包与独立安装

从六个 workspace 生成真实 tarball，在仓库内的临时隔离 consumer 中仅安装这些产物；审计发布文件、unscoped `pguide`、全部 package-owned bin、`pguide-config` 扩展和安装后的内部依赖链，结束后清理 tarball、consumer 与 `node_modules`。

### D-S02: 验证跨平台子命令调用

以同一可重复脚本覆盖安全 PATH 发现、直接与顶层分派、全局选项前后位置、`--` 边界、stdin、退出码和信号；在仓库 CI 定义 Windows、macOS、Linux 矩阵，并在当前平台完整执行。

### D-S03: 验证真实 Agent regulation

通过 packed CLI 和不含真实凭据的受控 ACP fixture 执行 `regulate`、持久 lineage/transcript、仍满足时的 `continue`、退化后的 ACP resume 修复，并验证报告、retention、redaction 以及 blocked、stalled、timeout 结果。

## Acceptance criteria

### D-AC01: 安装产物可独立使用

隔离 consumer 能从 tarball 运行 unscoped `pguide`、所有 package-owned bin 和 `pguide-config` 分派；产物不含源码、测试或临时文件，且安装后的内部依赖均由同批 tarball 满足。

### D-AC02: 支持平台行为一致

CI 为 Windows、macOS 与 Linux 调用同一 packed CLI 验证脚本，当前平台完整通过；证据明确区分已执行结果与仅由 CI 定义覆盖的平台，不虚报尚未运行的矩阵结果。

### D-AC03: Agent regulation 达到目标

受控真实 ACP transport 在限制范围内把 fixture Objective 推进到目标 level，Regulator 重探针确认进展；持久恢复、脱敏、保留期和 blocked、stalled、timeout 报告均由 packed CLI 的可重复验证证明。
