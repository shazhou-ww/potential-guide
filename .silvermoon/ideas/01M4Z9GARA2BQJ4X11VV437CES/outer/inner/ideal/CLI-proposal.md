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
| `pguide continue ...` | `pguide-continue` | Objective Regulator | 重新激活已有 Regulation 并创建新 Attempt |
| `pguide supervise ...` | `pguide-supervise` | Portfolio Supervisor | 规划或执行多 Objective directives |
| `pguide scaffold ...` | `pguide-scaffold` | Objective Guide 工具 | 创建可加载的 Objective Guide 骨架 |
| `pguide validate ...` | `pguide-validate` | Objective Guide 工具 | 静态验证 Guide manifest、checks 和 References |
| `pguide config ...` | `pguide-config` | 可选配置工具 | 读取、验证和原子修改标准配置 |
| `pguide diagnose` | 内置 | 顶层 CLI | 检查配置、运行时和外部命令冲突 |
| `pguide complete` | 内置 | 顶层 CLI | 生成 shell completion |

帮助和版本使用上下文相关的 `--help` 与 `--version`，不额外占用名词形式的一级子命令。顶层 `--help` 同时列出内置命令与当前可发现的外部 commands；`--help --format json` 提供包含来源、解析路径和协议兼容性的机器可读清单。

包级可执行文件必须可以直接运行。通过顶层 CLI 调用时，命令参数、stdin、信号和最终退出状态不得改变。

## 外部子命令发现

调用 `pguide <command>` 时：

1. 只接受小写 ASCII 动词 slug，例如 `regulate` 或 `verify-policy`。
2. 内置命令优先，外部命令不能覆盖 `diagnose` 或 `complete`。
3. 在显式配置的命令目录和 `PATH` 中查找 `pguide-<command>`；配置目录优先于 `PATH`。
4. 不隐式搜索当前工作目录，避免仓库内同名文件被意外执行。
5. 同一优先级发现多个候选时显式失败，并在错误中列出所有 real path。
6. 顶层 `--help` 显示每个命令的来源、解析后的路径、是否内置及协议兼容性。

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

全局参数名属于协议保留字，包级命令不能以不同语义重新定义。遇到 `--` 后，顶层 CLI 停止识别任何全局参数，并把后续内容逐字传给子命令。由此既允许符合直觉的参数位置，也避免外部命令的参数被意外吞掉。

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
| `--agent <profile-name>` | 条件必需 | `defaultAgent` | 选择配置中预定义的 ACP Agent profile；未指定且没有默认值时失败 |
| `--max-iterations <integer>` | 否 | `8` | 最多请求的 Agent action 数 |
| `--max-stalled-iterations <integer>` | 否 | `2` | 连续未提升 level 的上限 |
| `--timeout <duration>` | 否 | `30m` | 整次 regulation 的 wall-clock deadline |
| `--language <bcp47>` | 否 | 配置值 | Reference 内容语言 |
| `--report <path>` | 否 | 无 | 原子写入包含每轮摘要的最终报告 |

核心 Regulator 保持无持久状态；`pguide` 在其外层显式保存 Regulation、Attempt 和 ACP session reference，并通过独立的 `continue` 命令重新激活。重复执行原 `regulate` 命令会创建新的 Regulation，不会猜测需要恢复哪个历史目标。

命令行不接受 Agent executable、endpoint、protocol、任意 Agent 参数或凭据。除 `--agent <profile-name>` 外，所有 Agent 细节都来自标准配置。

## Agent 配置

Agent profile 与其他 CLI 设置使用同一份 `pguide` YAML 配置：

- 项目配置：从 `--cwd` 向上查找 `.pguide/config.yaml`；
- 用户配置：Windows 使用 `%APPDATA%\pguide\config.yaml`，其他平台使用 `$XDG_CONFIG_HOME/pguide/config.yaml`，未设置时回退到 `~/.config/pguide/config.yaml`；
- 显式配置：全局 `--config <path>` 作为最高优先级配置层。

```yaml
schemaVersion: 1
defaultAgent: copilot

agents:
  copilot:
    connection:
      type: acp
      protocolVersion: "1"
    transport:
      type: stdio
      command: copilot
      args: [--acp]
      env: [GITHUB_TOKEN]
    requirements:
      sessionResume: true
```

`agents` 是以稳定名称索引的预定义 ACP Agent profile 列表。用户配置先加载，项目配置按 profile 名整体替换，显式配置最后覆盖；单个 profile 不做字段级深度合并，避免从多个来源拼出不可审计的 Agent。

`pguide config list-agents` 列出有效 profile、来源、ACP version 和 transport，但不显示凭据。`pguide diagnose agent <profile-name>` 解析 executable，执行 ACP `initialize` 并验证 regulation 所需 capabilities，不创建 session 或提交 prompt。

配置文件不得包含 token、password 或 API key 字面值。`env` 只声明允许继承的环境变量名；网络认证只引用保存凭据的环境变量名或宿主凭据提供器。

## ACP Agent 契约

v1 Agent profile 的 `connection.type` 只接受 `acp`，其他值在启动任何进程前失败。`pguide` 作为 Agent Client Protocol client，通过 `initialize` 协商 wire protocol version 和 capabilities，再创建或恢复 Agent session。

协议依据为 [Agent Client Protocol](https://github.com/agentclientprotocol/agent-client-protocol) 公开规范。实现必须根据 `initialize` 握手和 capabilities 判断兼容性，不能根据 SDK 或 schema artifact 的包版本推断 wire compatibility。

`pguide` 不定义私有 Agent wire protocol，也不接受任意 `process` adapter。连接实现负责把 `ObjectiveActionRequest` 映射到标准 session/turn 消息，并将一次 Agent 结果映射为现有 `ObjectiveActionExecutor` 的 `completed` 或 `blocked` 结果。

`completed` 只表示 Agent 完成了本轮动作，不表示 Objective 有进展。CLI 必须等待 Regulator re-probe；只有新的 observation 可以证明 level 提升或 target reached。

ACP agent/client capabilities 负责 mutation 权限、工具允许列表和人工授权流程。CLI 不提供绕过协议参与方审批的通用开关。

Agent profile 必须支持 ACP session resume，供 `continue` 恢复上下文。`pguide` 在实时运行期间持久化收到的协议可见 `session/update`；历史 replay 是补全能力，不能作为审计记录的唯一来源。隐藏 chain-of-thought、Agent 未发送的内部日志和 backend tracing 不属于 ACP transcript。

微软 Agent Host Protocol 的多客户端 authoritative state、action sequencing 和 reconnect replay 对未来多端共享有价值，但不是 v1 regulation 的前置依赖。若以后加入 AHP，应作为 ACP Agent 之上的可选 host integration，而不是改变 Regulation 的进度语义。

## Regulation 与 Attempt

`regulate` 创建持久 **Regulation**，并立即运行第一个 **Attempt**：

- Regulation 保存稳定的 Guide identity/revision、subject digest、target、Agent profile 快照和历史摘要；
- Attempt 保存一次调用的 limits、ACP session、observations、actions、结果和时间范围；
- 命令成功创建后始终输出 `regulationId`，即使首个 Attempt blocked、stalled 或 timed out。

`pguide` 自己持久化 Regulation ledger 和 ACP transcript。ACP Agent 保存可恢复的会话上下文；两者都不能替代重新 probe 得到的现实状态。

## `continue` 子命令

```powershell
pguide continue <regulation-id>
```

`continue` 使用原 Regulation 参数创建一个新 Attempt，不要求重复 Guide、subject、target 或 Agent 参数：

1. 加载 Regulation、Agent profile 快照、ACP session ID 和历史摘要；
2. 恢复 ACP session；无法恢复时创建新 session 并注入精简历史摘要，同时记录恢复方式；
3. 始终先重新 probe；
4. 目标仍满足时记录 `still-satisfied`，不调用 Agent；
5. 现实已退化或此前未达标时，从当前 observation 继续 regulation；
6. 绝不重放已完成的现实动作，也不以历史 observation 覆盖当前 probe。

Guide identity/revision、subject 和 target 发生不兼容变化时，`continue` 拒绝执行并要求创建新的 Regulation。Agent profile 后续更新或删除不改变历史快照；若要采用新 profile，应创建新 Regulation，未来可另行提供显式 fork。

每个 Attempt 获得新的 `maxIterations`、`maxStalledIterations` 和 invocation timeout；Regulation 保留累计 attempts、actions 和活跃时间用于审计及可选总预算策略。不能通过 `continue` 静默放宽配置定义的预算。

默认 state 路径：

- Windows：`%LOCALAPPDATA%\pguide\regulations\<regulation-id>`；
- macOS/Linux：`$XDG_STATE_HOME/pguide/regulations/<regulation-id>`，未设置时使用 `~/.local/state/pguide/regulations/<regulation-id>`。

state 不保存凭据。subject、observations 和 transcript 可能敏感，必须采用仅当前用户可访问的权限，并支持配置保留期限。

## `config` 可选扩展

`pguide-config` 是官方可选外部命令。没有安装时，用户仍可手工编辑标准 YAML；核心 `pguide` 始终负责 schema、加载、合并和运行时验证。

```text
pguide config show
pguide config path
pguide config validate
pguide config edit
pguide config get <key>
pguide config set <key> <value>
pguide config unset <key>
pguide config list-agents
pguide config show-agent <name>
pguide config add-agent <name> <source>
pguide config update-agent <name> <source>
pguide config remove-agent <name>
```

`<source>` 是配置文件路径；传入 `-` 时从 stdin 读取到 EOF。source 不可省略，也不根据 TTY 自动推断。

```powershell
pguide config add-agent copilot .\copilot-agent.yaml --scope user
Get-Content .\copilot-agent.yaml -Raw | pguide config update-agent copilot - --scope project
```

`add-agent` 遇到同名 profile 时失败；`update-agent` 遇到不存在的 profile 时失败；两者都解析一个完整 YAML/JSON profile，经 schema 与 secret literal 检查后原子写入，不进行字段级 patch。`remove-agent` 只删除注册信息，不删除历史 Regulation 中保存的脱敏 profile 快照。

配置管理扩展与核心必须复用同一配置库，负责 schema、配置路径、层级合并、来源追踪、脱敏和原子写入，不能复制规则。

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

不把 Agent 的自由文本日志混入 JSON；详细 Agent 日志写入 stderr 或协议实现自己的持久日志。

## 退出码

| 退出码 | 含义 |
| ---: | --- |
| `0` | `target-reached`、`still-satisfied`，或 `probe` 成功 |
| `2` | CLI 参数、配置、Guide、subject 或协议无效 |
| `3` | `action-blocked` 或 `no-actionable-problem` |
| `4` | `no-progress` 或 `max-iterations` |
| `5` | `timed-out` 或外部取消 |
| `6` | ACP 握手、Agent session、transport 或 I/O 操作失败 |
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

项目配置只描述命令目录、默认语言、输出偏好、limits 和 Agent profile 等非敏感设置。CLI 必须能用 `diagnose --format json` 显示每个有效值的来源，但不得输出凭据。

## 明确不包含

- 不让顶层 CLI 复制 Guide、Regulator 或 Portfolio 的业务实现。
- 不允许外部命令覆盖保留的内置命令。
- 不把 Agent 的自报完成当作 Objective 进展。
- 不支持绕过预定义 ACP Agent profile 的临时 Agent 命令行参数。
- 不提供关闭 timeout、iteration 或 stalled-progress 防护的无限运行模式。
- 不在第一版实现 AHP、多客户端并发控制、远程插件市场或后台 daemon。
