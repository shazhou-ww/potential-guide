# Potential Guide CLI 方案

本文定义构想阶段需要确认的 CLI 产品边界和公共契约。实现细节可在 Implementation 阶段调整，但命令身份、扩展模型和用户可观察语义应保持稳定。

## 命令名称

### 推荐

- canonical 可执行文件：`pguide`
- unscoped npm 包：`pguide`

日常文档、脚本和机器集成统一使用 `pguide`。包安装后提供同名 bin，并支持 `npx pguide ...`，避免要求用户了解 scoped 包名。

2026-10-15 的 npm registry 检查中，`pguide` 返回未发布，`potential` 已存在 `2.0.0`。发布准备阶段必须重新确认并实际取得 `pguide` 包名；若届时不可用，应回到命名决策而不是静默发布到其他包名。

### 不建议使用 `pg`

`pg` 过短，容易与 POSIX 系统中的 `pg` pager、PostgreSQL 及其常见工具和依赖命名混淆。即使当前开发机的 `PATH` 上没有同名命令，也不足以证明跨平台安装安全，因此不发布 `pg`。

## 命令模型

顶层 CLI 同时支持内置命令和 Git 风格外部子命令：

```text
pguide <command> [arguments]
pguide-<command> [arguments]
```

包拥有自己的 CLI 和业务语义。顶层 CLI 只负责全局配置、命令发现、可信解析、进程调用以及统一的输出和退出码约定。
所有面向用户的一级子命令使用小写祈使动词，描述用户要求系统执行的动作，而不是对应包或组件的名词。

### 初始命令面

| 顶层调用 | 独立可执行文件 | 所属范围 | 目的 |
| --- | --- | --- | --- |
| `pguide probe ...` | `pguide-probe` | Objective Guide | 加载并 probe 一个 Guide Instance |
| `pguide regulate ...` | `pguide-regulate` | Objective Regulator | 对一个 Objective 执行有界 regulation |
| `pguide supervise ...` | `pguide-supervise` | Portfolio Supervisor | 规划或执行多 Objective directives |
| `pguide scaffold ...` | `pguide-scaffold` | Objective Guide 工具 | 创建可加载的 Objective Guide 骨架 |
| `pguide validate ...` | `pguide-validate` | Objective Guide 工具 | 静态验证 Guide manifest、checks 和 References |
| `pguide list` | 内置 | 顶层 CLI | 列出命令、来源和协议版本 |
| `pguide diagnose` | 内置 | 顶层 CLI | 检查配置、运行时和外部命令冲突 |
| `pguide complete` | 内置 | 顶层 CLI | 生成 shell completion |

帮助和版本使用上下文相关的 `--help` 与 `--version`，不额外占用名词形式的一级子命令。

包级可执行文件必须可以直接运行。通过顶层 CLI 调用时，命令参数、stdin、信号和最终退出状态不得改变。

## 外部子命令发现

调用 `pguide <command>` 时：

1. 只接受小写 ASCII 动词 slug，例如 `regulate` 或 `verify-policy`。
2. 内置命令优先，外部命令不能覆盖 `list`、`diagnose` 或 `complete`。
3. 在显式配置的命令目录和 `PATH` 中查找 `pguide-<command>`；配置目录优先于 `PATH`。
4. 不隐式搜索当前工作目录，避免仓库内同名文件被意外执行。
5. 同一优先级发现多个候选时显式失败，并在错误中列出所有 real path。
6. `list` 显示每个命令的来源、解析后的路径、是否内置及协议兼容性。

外部命令通过 `pguide-command-v1` 协议声明身份和能力。顶层 CLI 可以请求机器可读 metadata，但不会通过解析帮助文本推断能力。

## 全局参数

保留的全局参数可以位于一级子命令之前或之后。顶层 CLI 先确定子命令，再从 `--` 之前的参数中提取已声明的全局参数；其余参数保持原有顺序交给子命令。

```text
pguide [global options] <command> [command options]
pguide <command> [global options] [command options]
```

两种形式语义相同，例如：

```text
pguide --format json probe --guide ./objective-guide.yaml --subject-file ./subject.json
pguide probe --guide ./objective-guide.yaml --subject-file ./subject.json --format json
```

全局参数名属于协议保留字，包级命令不能以不同语义重新定义。遇到 `--` 后，顶层 CLI 停止识别任何全局参数，并把后续内容逐字传给子命令或 Agent adapter。由此既允许符合直觉的参数位置，也避免外部命令的参数被意外吞掉。

| 参数 | 语义 |
| --- | --- |
| `--cwd <path>` | 设置命令工作目录；默认当前目录 |
| `--config <path>` | 使用指定配置文件 |
| `--format <format>` | 输出格式；可选 `markdown` 或 `json`，默认 `markdown` |
| `--color <mode>` | Markdown 输出颜色；可选 `auto`、`always` 或 `never` |
| `--log-level <level>` | stderr 诊断级别；可选 `error`、`warn`、`info` 或 `debug` |
| `--help` | 在命令前显示顶层帮助，在命令后显示该命令帮助 |
| `--version` | 在命令前显示顶层版本，在命令后显示该命令版本 |

stdout 只承载命令结果，stderr 承载诊断和日志。`--format json` 时 stdout 必须是一个完整 JSON 文档，不能混入进度文本。

## `probe` 子命令

`probe` 执行一次无副作用的 Guide probe 并输出 observation。它不加载 Agent，也不执行 action。

```text
pguide probe [options]
```

```powershell
pguide probe `
  --guide .\objective-guide.yaml `
  --subject-file .\subject.json `
  --language zh-CN `
  --format markdown
```

| 参数 | 必需 | 语义 |
| --- | --- | --- |
| `--guide <path-or-uri>` | 是 | Guide manifest 的文件路径或 URI |
| `--subject-file <path>` | 是 | JSON subject 文件；传入 `-` 表示 stdin |
| `--language <bcp47>` | 否 | Reference 内容语言；默认来自配置 |
| `--report <path>` | 否 | 将完整结果原子写入文件 |

## `scaffold` 子命令

`scaffold` 创建一个可被 loader 读取、但仍明确包含待实现业务内容的 Objective Guide 骨架：

```powershell
pguide scaffold guide .\my-objective `
  --language en-US `
  --language zh-CN
```

| 参数 | 必需 | 默认值 | 语义 |
| --- | --- | --- | --- |
| `guide` | 是 | 无 | 当前支持的骨架类型；为未来其他 artifact 保留扩展位 |
| `<directory>` | 是 | 无 | 新建的 Guide 根目录 |
| `--language <bcp47>` | 否，可重复 | `en-US` | 生成的 Reference 语言；首项为 default language |
| `--level <level-id>` | 否 | `initial` | 首个显式 level 的稳定 ID |
| `--check <check-id>` | 否 | 无 | 可选首个 check；提供后同时生成 `checks/<id>/run.*` 占位入口 |

输出包含 `objective-guide.yaml`、必需的 `system/overview` 与 `system/404` References、首个 level 与 `terminal` References，以及可选 check 的目录和 Reference。目标目录必须不存在或为空；命令不提供覆盖现有文件的强制选项。

## `validate` 子命令

```powershell
pguide validate guide .\my-objective\objective-guide.yaml
```

`validate guide` 加载并静态验证 manifest、domain schema、prerequisite、level/check 标识、check entry 和全部语言的必需 References，但不执行业务 check。成功时输出规范化摘要，失败时返回所有可安全聚合的配置问题。

## `regulate` 子命令

`regulate` 直接执行一次完整、有界的 regulation，不再增加与独立 `probe` 重复的 observation 模式或语义冗余的 `run` 二级命令。

```powershell
pguide regulate `
  --guide .\objective-guide.yaml `
  --subject-file .\subject.json `
  --target terminal `
  --agent copilot `
  --agent-config .\copilot-agent.json `
  --max-iterations 8 `
  --max-stalled-iterations 2 `
  --timeout 30m `
  --language zh-CN `
  --format markdown
```

| 参数 | 必需 | 默认值 | 语义 |
| --- | --- | --- | --- |
| `--guide <path-or-uri>` | 是 | 无 | Guide manifest 的文件路径或 URI |
| `--subject-file <path>` | 是 | 无 | JSON subject 文件；传入 `-` 表示 stdin |
| `--target <level-id>` | 是 | 无 | 明确目标 level；也接受 `terminal`，但不隐式假定 |
| `--agent <adapter-id>` | 是 | 无 | 已注册 Agent adapter，例如 `copilot` 或 `process` |
| `--agent-config <path>` | 否 | adapter 默认值 | Agent adapter 的非敏感配置文件 |
| `--max-iterations <integer>` | 否 | `8` | 最多请求的 Agent action 数 |
| `--max-stalled-iterations <integer>` | 否 | `2` | 连续未提升 level 的上限 |
| `--timeout <duration>` | 否 | `30m` | 整次 regulation 的 wall-clock deadline |
| `--language <bcp47>` | 否 | 配置值 | Reference 内容语言 |
| `--report <path>` | 否 | 无 | 原子写入包含每轮摘要的最终报告 |

Regulator 不持有隐藏会话状态，也不提供独立 `resume` 命令。再次运行相同命令会从真实世界重新 probe 并继续推进。

敏感凭据不允许通过普通命令参数或 `--agent-config` 明文传递。Adapter 应使用宿主凭据存储、环境注入或自己的认证流程。

`process` adapter 可额外接受位于 `--` 之后的 Agent 进程参数：

```powershell
pguide regulate <options> -- --profile autonomous
```

顶层 CLI 不解释 `--` 之后的内容；其他 adapter 可以拒绝不支持的附加参数。

## Agent adapter 契约

Agent adapter 实现现有 `ObjectiveActionExecutor` 语义。每次调用只接收一个 action request：

```json
{
  "protocol": "pguide-action-v1",
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

Markdown 输出按轮显示：

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

所有非零结果在 Markdown 与 JSON 模式中都返回机器可识别的 status，不以解析错误文本作为自动化接口。

## 配置优先级

从高到低：

1. 命令行参数；
2. `PGUIDE_*` 环境变量；
3. `--config` 指定文件；
4. 从 `--cwd` 向上查找的项目配置；
5. 用户级配置；
6. 内置默认值。

项目配置只描述命令目录、默认语言、输出偏好、limits 和 adapter 标识等非敏感设置。CLI 必须能用 `diagnose --format json` 显示每个有效值的来源，但不得输出凭据。

## 明确不包含

- 不让顶层 CLI 复制 Guide、Regulator 或 Portfolio 的业务实现。
- 不允许外部命令覆盖保留的内置命令。
- 不把 Agent 的自报完成当作 Objective 进展。
- 不提供关闭 timeout、iteration 或 stalled-progress 防护的无限运行模式。
- 不在第一版实现远程插件市场、后台 daemon 或隐藏的 regulation session。
