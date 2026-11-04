# Implementation

准备阶段的轻量实施初版；构想验收不包含本契约。实施前依据最新 primary 复核消费者。

## Steps

### I-S01: 确认消费者并删除旧适配器

复核包依赖和调用入口，删除 `packages/check-task`、`packages/probe-task` 及专属旧协议测试。
当前已知唯一其他 workspace 运行依赖是 `probe-task` 对 `check-task` 的依赖；
通用 Engine／Server 不以这两个业务包为运行前提。删除两包后再判断遗留基础能力，
不得仅因名称或历史来源删除 `check-artifacts`、`check-runtime-files` 或 Engine pool。

### I-S02: 清理自检与交付装配

更新根脚本、Turbo、TypeScript 引用、依赖锁、包分层和包自有标准声明；
移除内嵌 Worker 检查中的两包目标及打包验证 inventory 中的业务条目。
删除或重写 `examples/task-server` 的 Check／Probe 专属构建和集成场景、
`check-task-bundle-consumer`、MVP Check 与其他实际消费者。
业务专属断言退役，仍适用的通用断言转由无旧协议的最小 Task 回调覆盖，
而非把整个消费者测试静默移除。

### I-S03: 补齐回归与退役文档

证明干净安装、构建、类型检查和打包消费不再需要两个包。
保留 Schema／Bundle 构建、标准 Request 受理、Worker 生命周期、日志、
取消、持久恢复及作者／宿主隔离的适用验证。更新文档与发布配置；
历史记录只读保留，不把历史提及当成活跃依赖或自动改写理由。

## Acceptance criteria

### I-AC01: 活跃依赖完整清除

两包目录、工作区和锁文件 importer、生产／测试导入及交付条目均清除；
通过依赖图、导入搜索和退役回归证明，允许历史记载和明确的禁止依赖断言保留名称。

### I-AC02: 自检保留通用保证

根 `pnpm check` 不再调度两包或其旧业务执行场景；运行现有检查并记录结果。
受理、运行、取消、恢复及独立 Bundle 消费仍有真实执行测试，不能用纯搜索替代。
任何既有或环境失败需有单独证据与归因，不修改无关代码、不静默跳过、不声称全绿。

### I-AC03: 不产生隐式替代

通过源码、配置及文档核对，证明没有把旧 Checker／Objective 执行器搬入其他包、
没有兼容注册通道或旧数据自动迁移；业务入口删除后没有成功形状 fallback。
新 Check／Probe 业务契约与全仓 CLI 自检拆分均不在此次交付内。
