# Deployment

## Steps

### D-S01: 验证打包与独立安装

打包顶层 CLI 和包级命令，在隔离环境中安装产物，并确认发布内容、可执行入口及内部依赖只来自这些产物。

### D-S02: 验证跨平台子命令调用

在 Windows、macOS 与 Linux 的支持矩阵中验证直接命令、顶层分派、PATH 发现、参数转发、取消和退出码行为。

### D-S03: 验证真实 Agent regulation

使用受控测试仓库和已配置 Agent adapter 运行端到端 regulation，保留不含敏感数据的命令、状态转换及最终 observation 证据。

## Acceptance criteria

### D-AC01: 安装产物可独立使用

隔离 consumer 能从打包产物运行顶层 CLI 和每个包级命令，且产物审计未发现源码、测试、临时文件或未声明依赖。

### D-AC02: 支持平台行为一致

CI 支持矩阵在 Windows、macOS 与 Linux 上通过同一套命令发现与分派场景，并记录 canonical 命令名称及任何可选短别名的冲突调查。

### D-AC03: Agent regulation 达到目标

真实 Agent adapter 在限制范围内把测试 Objective 推进到目标 level；证据显示 Regulator 而非 Agent 声明进展，并能清晰报告 blocked、stalled 与 timeout。
