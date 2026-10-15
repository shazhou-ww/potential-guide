# Implementation

## Steps

### I-S01: 建立共享 CLI 与配置内核

新增独立共享 workspace，统一全局参数提取、Markdown/JSON 结果、退出码、标准 YAML schema、user/project/explicit 分层合并与来源追踪、Agent profile 整体替换、凭据字面值拒绝、脱敏和原子私有写入；所有第三方版本进入 pnpm catalog。

### I-S02: 实现 Guide 与 Portfolio 包级命令

由业务包直接拥有 `probe`、`scaffold`、`validate` 和 `supervise` bins，复用现有 loader、probe、regulator 与 portfolio API；骨架可立即加载，静态验证不执行 check，包级命令能独立发布和调用。

### I-S03: 实现 ACP regulation 与持久恢复

由 Objective Regulator 包拥有 `regulate` 和 `continue` bins；实现 ACP initialize、capability negotiation、session new/resume、prompt/update/cancel，将 protocol-visible update 实时追加到 transcript，并持久化 Regulation lineage、逐次 Attempt、limits、action/observation、恢复方式和不含凭据的 profile 快照。

### I-S04: 实现顶层安全发现与分派

新增 unscoped `pguide` workspace/bin，按配置目录优先于 `PATH` 发现 `pguide-<command>`，拒绝 cwd 隐式搜索、歧义、保留命令覆盖和协议不兼容；保持 stdin/stdout/stderr、参数、信号与退出状态，并提供机器可读 help、`diagnose` 和 `complete`。

### I-S05: 实现官方可选配置扩展

新增独立 `pguide-config` package/bin，按单 token kebab-case 提供配置和 Agent profile 管理；add/update 接收第二位置 source，`-` 从 stdin 读取完整 profile，写入前复用共享 schema、secret 检查和原子写入。

### I-S06: 完成测试、文档与发布打包集成

覆盖所有命令的直接调用和顶层分派、fixture ACP 完整 regulation/continue、配置安全、骨架与验证；更新根文档、发布顺序、workspace/lockfile、package contents 检查，并以完整 `pnpm check` 和实际 pack 产物验证。

## Acceptance criteria

### I-AC01: 命令发现和协议稳定

顶层 help 同时报告内置与已发现外部 commands 及来源；测试证明全局参数前后位置、`--` 停止解析、安全优先级、歧义/未知/不兼容失败、信号和退出状态转发符合已接受契约。

### I-AC02: 全部包级命令可独立运行

`probe`、`regulate`、`continue`、`supervise`、`scaffold`、`validate`、`config` 的独立 bins 和顶层入口均可调用；自动化测试证明 Guide 骨架可加载、validate 静态验证、probe 无副作用且 portfolio 可规划/驱动。

### I-AC03: ACP regulation 有界且可审计

可注入 fixture ACP Agent 在无真实凭据或服务时完成 initialize、session、prompt、update 和 action 后 re-probe；测试证明 `regulate` 输出 regulationId、limits 生效、transcript 实时落盘，Agent 自报完成不替代 observation。

### I-AC04: continue 始终以现实状态为准

测试证明 continue 复用原 Guide/subject/target/profile 和每 Attempt limits，始终先 re-probe；still-satisfied 不启动 Agent，退化时继续，resume 失败时新建 session 并记录恢复方式，不重放历史动作。

### I-AC05: 配置与状态边界安全

测试证明 user/project/explicit 配置层级、profile 整体替换、来源追踪、secret literal 拒绝、脱敏、stdin source 和原子写入；state 使用平台目录和当前用户权限、支持 retention 配置且不保存 credentials。

### I-AC06: 发布产物完整可执行

`pnpm check` 全部通过；标准 pack check 对每个新增/修改包执行真实打包，证明声明 bins、dist、README、LICENSE 完整且不包含 source、tests、临时文件、tarball、node_modules 或凭据。
