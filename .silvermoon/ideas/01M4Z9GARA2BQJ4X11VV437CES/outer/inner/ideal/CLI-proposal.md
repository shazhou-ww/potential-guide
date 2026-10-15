# Potential Guide CLI 方案

本文定义构想阶段需要确认的 CLI 产品边界和公共契约。实现细节可在 Implementation 阶段调整，但命令身份、扩展模型和用户可观察语义应保持稳定。

## 命令名称

### 推荐

- canonical 可执行文件：`potential`
- npm 包建议：`@potential-guide/cli`

日常文档、脚本和机器集成统一使用 `potential`。不提供 `potential-guide` 顶层别名，因为 Git 风格扩展模型需要把该名称留给独立的 `guide` 子命令。

### 不建议使用 `pg`

`pg` 过短，容易与 POSIX 系统中的 `pg` pager、PostgreSQL 及其常见工具和依赖命名混淆。即使当前开发机的 `PATH` 上没有同名命令，也不足以证明跨平台安装安全，因此不发布 `pg`。

## 命令模型

顶层 CLI 同时支持内置命令和 Git 风格外部子命令：

```text
potential <command> [arguments]
potential-<command> [arguments]
```

包拥有自己的 CLI 和业务语义。顶层 CLI 只负责全局配置、命令发现、可信解析、进程调用以及统一的输出和退出码约定。
所有面向用户的一级子命令使用小写祈使动词，描述用户要求系统执行的动作，而不是对应包或组件的名词。

### 初始命令面

| 顶层调用 | 独立可执行文件 | 所属范围 | 目的 |
| --- | --- | --- | --- |
| `potential guide ...` | `potential-guide` | Objective Guide | 加载、检查和 probe 一个 Guide Instance |
| `potential regulate ...` | `potential-regulate` | Objective Regulator | 对一个 Objective 执行有界 regulation |
| `potential supervise ...` | `potential-supervise` | Portfolio Supervisor | 规划或执行多 Objective directives |
| `potential commands` | 内置 | 顶层 CLI | 列出命令、来源和协议版本 |
| `potential doctor` | 内置 | 顶层 CLI | 检查配置、运行时和外部命令冲突 |
| `potential completion` | 内置 | 顶层 CLI | 生成 shell completion |
| `potential help` | 内置 | 顶层 CLI | 显示顶层或指定命令帮助 |
| `potential version` | 内置 | 顶层 CLI | 显示 CLI 与协议版本 |

包级可执行文件必须可以直接运行。通过顶层 CLI 调用时，命令参数、stdin、信号和最终退出状态不得改变。

## 外部子命令发现

调用 `potential <command>` 时：

1. 只接受小写 ASCII 动词 slug，例如 `regulate` 或 `verify-policy`。
2. 内置命令优先，外部命令不能覆盖 `help`、`version`、`commands`、`doctor` 或 `completion`。
3. 在显式配置的命令目录和 `PATH` 中查找 `potential-<command>`；配置目录优先于 `PATH`。
4. 不隐式搜索当前工作目录，避免仓库内同名文件被意外执行。
5. 同一优先级发现多个候选时显式失败，并在错误中列出所有 real path。
6. `commands` 显示每个命令的来源、解析后的路径、是否内置及协议兼容性。
7. `--no-external-commands` 禁止执行外部子命令，供受限 CI 或安全环境使用。

外部命令通过 `potential-command-v1` 协议声明身份和能力。顶层 CLI 可以请求机器可读 metadata，但不会通过解析帮助文本推断能力。

## 全局参数

全局参数必须位于子命令之前；子命令之后的参数原样交给对应命令。

```text
potential [global options] <command> [command options]
```

| 参数 | 语义 |
| --- | --- |
| `--cwd <path>` | 设置命令工作目录；默认当前目录 |
| `--config <path>` | 使用指定配置文件 |
| `--format human|json` | 选择人类可读或稳定 JSON 输出 |
| `--color auto|always|never` | 控制 human 输出颜色 |
| `--log-level error|warn|info|debug` | 控制 stderr 诊断级别 |
| `--no-external-commands` | 只允许内置命令 |
| `--help` | 显示当前层级帮助 |
| `--version` | 显示顶层 CLI 版本 |

stdout 只承载命令结果，stderr 承载诊断和日志。`--format json` 时 stdout 必须是一个完整 JSON 文档，不能混入进度文本。

## `regulate` 子命令

Regulator 初始只提供无副作用的 `probe` 和可产生现实修改的 `run`：

```text
potential regulate probe [options]
potential regulate run [options]
```

不提供独立 `resume` 命令。Regulator 不持有隐藏会话状态；再次运行相同命令会从真实世界重新 probe 并继续推进。

### `regulate probe`

```powershell
potential regulate probe `
  --guide .\objective-guide.yaml `
  --subject-file .\subject.json `
  --language zh-CN `
  --format human
```

| 参数 | 必需 | 语义 |
| --- | --- | --- |
| `--guide <path-or-uri>` | 是 | Guide manifest 的文件路径或 URI |
| `--subject-file <path|->` | 是 | JSON subject 文件；`-` 表示 stdin |
| `--language <bcp47>` | 否 | Reference 内容语言；默认来自配置 |
| `--report <path>` | 否 | 将完整结果原子写入文件 |

`probe` 只输出 observation，不加载 Agent，也不执行 action。它替代容易误解的 `run --dry-run`。

### `regulate run`

```powershell
potential regulate run `
  --guide .\objective-guide.yaml `
  --subject-file .\subject.json `
  --target terminal `
  --agent copilot `
  --agent-config .\copilot-agent.json `
  --max-iterations 8 `
  --max-stalled-iterations 2 `
  --timeout 30m `
  --language zh-CN `
  --format human
```

| 参数 | 必需 | 默认值 | 语义 |
| --- | --- | --- | --- |
| `--guide <path-or-uri>` | 是 | 无 | Guide manifest 的文件路径或 URI |
| `--subject-file <path|->` | 是 | 无 | JSON subject 文件；`-` 表示 stdin |
| `--target <level-id|terminal>` | 是 | 无 | 明确目标 level；不隐式假定 terminal |
| `--agent <adapter-id>` | 是 | 无 | 已注册 Agent adapter，例如 `copilot` 或 `process` |
| `--agent-config <path>` | 否 | adapter 默认值 | Agent adapter 的非敏感配置文件 |
| `--max-iterations <integer>` | 否 | `8` | 最多请求的 Agent action 数 |
| `--max-stalled-iterations <integer>` | 否 | `2` | 连续未提升 level 的上限 |
| `--timeout <duration>` | 否 | `30m` | 整次 regulation 的 wall-clock deadline |
| `--language <bcp47>` | 否 | 配置值 | Reference 内容语言 |
| `--report <path>` | 否 | 无 | 原子写入包含每轮摘要的最终报告 |

敏感凭据不允许通过普通命令参数或 `--agent-config` 明文传递。Adapter 应使用宿主凭据存储、环境注入或自己的认证流程。

`process` adapter 可额外接受位于 `--` 之后的 Agent 进程参数：

```powershell
potential regulate run <options> -- --profile autonomous
```

顶层 CLI 不解释 `--` 之后的内容；其他 adapter 可以拒绝不支持的附加参数。

## Agent adapter 契约

Agent adapter 实现现有 `ObjectiveActionExecutor` 语义。每次调用只接收一个 action request：

```json
{
  "protocol": "potential-action-v1",
  "targetLevelId": "terminal",
  "observation": {},
  "problem": {}
}
```

合法结果只有：

```json
{"status":"completed","summary":"Applied one remediation."}
```

或：

```json
{"status":"blocked","reason":"Human authorization is required."}
```

`completed` 只表示 Agent 完成了本轮动作，不表示 Objective 有进展。CLI 必须等待 Regulator re-probe；只有新的 observation 可以证明 level 提升或 target reached。

Adapter 负责自己的 mutation 权限、工具允许列表和人工授权策略。CLI 不提供绕过 Agent 或宿主审批的通用开关。

## Regulation 输出

human 输出按轮显示：

1. 初始 level 和目标 level；
2. 当前最高优先级 problem；
3. Agent action 摘要或 blocked 原因；
4. re-probe 后的新 level；
5. 最终 RegulationResult。

JSON 输出包含稳定字段：

```json
{
  "schemaVersion": 1,
  "status": "target-reached",
  "targetLevelId": "terminal",
  "iterations": 2,
  "latestObservation": {}
}
```

不把 Agent 的自由文本日志混入 JSON；详细 Agent 日志写入 stderr 或 adapter 自己的持久日志。

## 退出码

| 退出码 | 含义 |
| ---: | --- |
| `0` | `target-reached`，或 `probe` 成功 |
| `2` | CLI 参数、配置、Guide、subject 或协议无效 |
| `3` | `action-blocked` 或 `no-actionable-problem` |
| `4` | `no-progress` 或 `max-iterations` |
| `5` | `timed-out` 或外部取消 |
| `6` | Agent adapter、子进程或 I/O 操作失败 |
| `70` | 未分类内部错误 |

所有非零结果在 human 与 JSON 模式中都返回机器可识别的 status，不以解析错误文本作为自动化接口。

## 配置优先级

从高到低：

1. 命令行参数；
2. `POTENTIAL_GUIDE_*` 环境变量；
3. `--config` 指定文件；
4. 从 `--cwd` 向上查找的项目配置；
5. 用户级配置；
6. 内置默认值。

项目配置只描述命令目录、默认语言、输出偏好、limits 和 adapter 标识等非敏感设置。CLI 必须能用 `doctor --format json` 显示每个有效值的来源，但不得输出凭据。

## 明确不包含

- 不让顶层 CLI 复制 Guide、Regulator 或 Portfolio 的业务实现。
- 不允许外部命令覆盖保留的内置命令。
- 不把 Agent 的自报完成当作 Objective 进展。
- 不提供关闭 timeout、iteration 或 stalled-progress 防护的无限运行模式。
- 不在第一版实现远程插件市场、后台 daemon 或隐藏的 regulation session。
